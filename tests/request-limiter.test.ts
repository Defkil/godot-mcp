import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GodotServer } from '../src/server.js';
import { PathPolicy } from '../src/security/path-policy.js';
import { CapabilityPolicy } from '../src/security/capability-policy.js';
import {
  RequestLimiter,
  RequestTooLargeError,
  RateLimitExceededError,
  parseRequestLimiterFromEnvironment,
  describeRequestLimiter,
} from '../src/security/request-limiter.js';

function requestHandler(server: GodotServer, method: 'tools/list' | 'tools/call') {
  const handlers = (server as unknown as { server: { _requestHandlers: Map<string, Function> } })
    .server._requestHandlers;
  const handler = handlers.get(method);
  if (!handler) throw new Error(`Missing MCP request handler: ${method}`);
  return handler;
}

const tempRoots: string[] = [];

function makeProject(): { root: string; projectFile: string } {
  const root = mkdtempSync(join(tmpdir(), 'godot-mcp-rate-'));
  tempRoots.push(root);
  const projectFile = join(root, 'project.godot');
  writeFileSync(projectFile, '[application]\nconfig/name="RateLimitTest"\n', 'utf8');
  return { root, projectFile };
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('RequestLimiter (unit)', () => {
  it('accepts a request below the byte limit', () => {
    const limiter = new RequestLimiter({
      maxRequestBytes: 1024,
      maxConcurrentRequests: 4,
      ratePerMinute: 60,
    });
    const body = { projectPath: '/x/y', payload: 'a'.repeat(100) };
    expect(() => limiter.assertRequestSize('get_godot_version', body)).not.toThrow();
  });

  it('rejects a request above the byte limit with a structured error', () => {
    const limiter = new RequestLimiter({
      maxRequestBytes: 128,
      maxConcurrentRequests: 4,
      ratePerMinute: 60,
    });
    const body = { payload: 'a'.repeat(1024) };
    expect(() => limiter.assertRequestSize('game_eval', body)).toThrow(RequestTooLargeError);
    try {
      limiter.assertRequestSize('game_eval', body);
    } catch (error) {
      expect(error).toBeInstanceOf(RequestTooLargeError);
      if (error instanceof RequestTooLargeError) {
        expect(error.tool).toBe('game_eval');
        expect(error.size).toBe(limiter.measureRequestSize(body));
        expect(error.maxBytes).toBe(128);
        expect(error.message).toContain('game_eval');
        expect(error.message).toContain(String(error.size));
        expect(error.message).toContain('128');
      }
    }
  });

  it('admits a concurrent slot under the limit', () => {
    const limiter = new RequestLimiter({
      maxRequestBytes: 1024,
      maxConcurrentRequests: 2,
      ratePerMinute: 60,
    });
    const release1 = limiter.acquireConcurrency();
    const release2 = limiter.acquireConcurrency();
    expect(release1).toBeTypeOf('function');
    expect(release2).toBeTypeOf('function');
    release1();
    release2();
    expect(limiter.currentConcurrency()).toBe(0);
  });

  it('rejects a concurrent slot at the limit', () => {
    const limiter = new RequestLimiter({
      maxRequestBytes: 1024,
      maxConcurrentRequests: 1,
      ratePerMinute: 60,
    });
    const release1 = limiter.acquireConcurrency();
    expect(() => limiter.acquireConcurrency()).toThrow(RateLimitExceededError);
    release1();
    expect(limiter.currentConcurrency()).toBe(0);
  });

  it('tracks per-tool rate tokens and rejects overflow', () => {
    const limiter = new RequestLimiter({
      maxRequestBytes: 1024,
      maxConcurrentRequests: 4,
      ratePerMinute: 2,
    });
    limiter.consumeToken('list_projects');
    limiter.consumeToken('list_projects');
    expect(() => limiter.consumeToken('list_projects')).toThrow(RateLimitExceededError);
  });

  it('separates per-tool token buckets', () => {
    const limiter = new RequestLimiter({
      maxRequestBytes: 1024,
      maxConcurrentRequests: 4,
      ratePerMinute: 1,
    });
    limiter.consumeToken('list_projects');
    expect(() => limiter.consumeToken('list_projects')).toThrow(RateLimitExceededError);
    // Different tool: separate bucket.
    expect(() => limiter.consumeToken('get_godot_version')).not.toThrow();
  });

  it('refills tokens after the window passes', () => {
    let now = 1_000_000;
    const limiter = new RequestLimiter({
      maxRequestBytes: 1024,
      maxConcurrentRequests: 4,
      ratePerMinute: 2,
      clock: () => now,
    });
    limiter.consumeToken('list_projects');
    limiter.consumeToken('list_projects');
    expect(() => limiter.consumeToken('list_projects')).toThrow(RateLimitExceededError);
    now += 60_000;
    expect(() => limiter.consumeToken('list_projects')).not.toThrow();
  });

  it('summarises the active configuration honestly', () => {
    const limiter = new RequestLimiter({
      maxRequestBytes: 2048,
      maxConcurrentRequests: 8,
      ratePerMinute: 120,
    });
    expect(describeRequestLimiter(limiter)).toEqual({
      maxRequestBytes: 2048,
      maxConcurrentRequests: 8,
      ratePerMinute: 120,
    });
  });

  it('exposes a structured remediation message on errors', () => {
    const sizeErr = new RequestTooLargeError('tool_a', 999, 100);
    expect(sizeErr.remediation).toMatch(/GODOT_MCP_MAX_REQUEST_BYTES/);
    const rateErr = new RateLimitExceededError('tool_b', 'concurrency');
    expect(rateErr.remediation).toMatch(/GODOT_MCP_MAX_CONCURRENT_REQUESTS|GODOT_MCP_RATE_PER_MINUTE/);
  });
});

describe('RequestLimiter environment parsing', () => {
  it('falls back to safe defaults when no env vars are set', () => {
    const limiter = parseRequestLimiterFromEnvironment({});
    expect(describeRequestLimiter(limiter)).toEqual({
      maxRequestBytes: 1_048_576,
      maxConcurrentRequests: 8,
      ratePerMinute: 120,
    });
  });

  it('reads explicit overrides from the environment', () => {
    const limiter = parseRequestLimiterFromEnvironment({
      GODOT_MCP_MAX_REQUEST_BYTES: '4096',
      GODOT_MCP_MAX_CONCURRENT_REQUESTS: '3',
      GODOT_MCP_RATE_PER_MINUTE: '15',
    });
    expect(describeRequestLimiter(limiter)).toEqual({
      maxRequestBytes: 4096,
      maxConcurrentRequests: 3,
      ratePerMinute: 15,
    });
  });

  it('rejects malformed env values with an actionable error', () => {
    expect(() =>
      parseRequestLimiterFromEnvironment({ GODOT_MCP_MAX_REQUEST_BYTES: 'lots' }),
    ).toThrow(/GODOT_MCP_MAX_REQUEST_BYTES/);
    expect(() =>
      parseRequestLimiterFromEnvironment({ GODOT_MCP_RATE_PER_MINUTE: '-1' }),
    ).toThrow(/GODOT_MCP_RATE_PER_MINUTE/);
  });
});

describe('RequestLimiter at the MCP tools/call boundary', () => {
  it('rejects an oversized payload before any handler runs', async () => {
    const { root } = makeProject();
    const server = new GodotServer({
      registerSignalHandlers: false,
      godotPath: '/usr/bin/godot',
      runtimeConnector: () => new Promise(() => undefined),
      runtimeConnectInitialDelayMs: 5,
      pathPolicy: new PathPolicy([root]),
      capabilityPolicy: new CapabilityPolicy('legacy-full'),
      requestLimiter: new RequestLimiter({
        maxRequestBytes: 64,
        maxConcurrentRequests: 4,
        ratePerMinute: 60,
      }),
    });

    const response = await requestHandler(server, 'tools/call')(
      {
        method: 'tools/call',
        params: {
          name: 'read_file',
          arguments: { projectPath: root, filePath: 'project.godot' },
        },
      },
      {},
    );

    expect(response.isError).toBe(true);
    const text = JSON.stringify(response);
    expect(text).toMatch(/request too large/i);
    expect(text).toContain('read_file');
    expect(text).toMatch(/GODOT_MCP_MAX_REQUEST_BYTES/);
  });

  it('admits a normal-sized payload through the gate', async () => {
    const { root } = makeProject();
    const server = new GodotServer({
      registerSignalHandlers: false,
      godotPath: '/usr/bin/godot',
      runtimeConnector: () => new Promise(() => undefined),
      runtimeConnectInitialDelayMs: 5,
      pathPolicy: new PathPolicy([root]),
      capabilityPolicy: new CapabilityPolicy('legacy-full'),
      requestLimiter: new RequestLimiter({
        maxRequestBytes: 8 * 1024,
        maxConcurrentRequests: 4,
        ratePerMinute: 60,
      }),
    });

    const response = await requestHandler(server, 'tools/call')(
      {
        method: 'tools/call',
        params: {
          name: 'read_file',
          arguments: { projectPath: root, filePath: 'project.godot' },
        },
      },
      {},
    );

    // The gate must NOT have tripped on size. Whatever the handler returns,
    // it must not contain the request-too-large message.
    const text = JSON.stringify(response);
    expect(text).not.toMatch(/request too large/i);
  });

  it('rejects a burst above the configured per-minute rate', async () => {
    const { root } = makeProject();
    const server = new GodotServer({
      registerSignalHandlers: false,
      godotPath: '/usr/bin/godot',
      runtimeConnector: () => new Promise(() => undefined),
      runtimeConnectInitialDelayMs: 5,
      pathPolicy: new PathPolicy([root]),
      capabilityPolicy: new CapabilityPolicy('legacy-full'),
      requestLimiter: new RequestLimiter({
        maxRequestBytes: 8 * 1024,
        maxConcurrentRequests: 4,
        ratePerMinute: 2,
      }),
    });

    const callTool = requestHandler(server, 'tools/call');
    const args = { projectPath: root, filePath: 'project.godot' };

    // First two calls pass the rate gate (whatever the handler returns, it is not RateLimitExceededError).
    await callTool({ method: 'tools/call', params: { name: 'read_file', arguments: args } }, {});
    await callTool({ method: 'tools/call', params: { name: 'read_file', arguments: args } }, {});

    // Third call trips the rate gate.
    const response = await callTool(
      { method: 'tools/call', params: { name: 'read_file', arguments: args } },
      {},
    );

    expect(response.isError).toBe(true);
    const text = JSON.stringify(response);
    expect(text).toMatch(/rate limit exceeded/i);
    expect(text).toContain('read_file');
  });

  it('releases the concurrency slot on the registry-dispatch path so many sequential tool calls do not leak', async () => {
    const { root } = makeProject();
    // maxConcurrentRequests=1 makes any leaked slot visible: the second
    // successful call would otherwise trip the concurrency gate forever.
    const server = new GodotServer({
      registerSignalHandlers: false,
      godotPath: '/usr/bin/godot',
      runtimeConnector: () => new Promise(() => undefined),
      runtimeConnectInitialDelayMs: 5,
      pathPolicy: new PathPolicy([root]),
      capabilityPolicy: new CapabilityPolicy('legacy-full'),
      requestLimiter: new RequestLimiter({
        maxRequestBytes: 8 * 1024,
        maxConcurrentRequests: 1,
        ratePerMinute: 1000,
      }),
    });

    const callTool = requestHandler(server, 'tools/call');
    // `list_project_files` is registered through the tool registry (not the
    // legacy switch). Five sequential calls would saturate inflight after
    // one if the slot leaks on the registry-dispatch path.
    const args = { projectPath: root };
    for (let i = 0; i < 5; i += 1) {
      const response = await callTool(
        { method: 'tools/call', params: { name: 'list_project_files', arguments: args } },
        {},
      );
      const text = JSON.stringify(response);
      expect(text).not.toMatch(/rate limit exceeded/i);
    }
  });
});