import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GodotServer } from '../src/server.js';
import { PathPolicy } from '../src/security/path-policy.js';
import { CapabilityPolicy, CapabilityDeniedError } from '../src/security/capability-policy.js';

function requestHandler(server: GodotServer, method: 'tools/list' | 'tools/call') {
  const handlers = (server as unknown as { server: { _requestHandlers: Map<string, Function> } })
    .server._requestHandlers;
  const handler = handlers.get(method);
  if (!handler) throw new Error(`Missing MCP request handler: ${method}`);
  return handler;
}

const tempRoots: string[] = [];

function makeProject(): { root: string; projectFile: string } {
  const root = mkdtempSync(join(tmpdir(), 'godot-mcp-cap-gate-'));
  tempRoots.push(root);
  const projectFile = join(root, 'project.godot');
  writeFileSync(projectFile, '[application]\nconfig/name="CapabilityGateTest"\n', 'utf8');
  return { root, projectFile };
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('CapabilityPolicy at the MCP tools/call boundary', () => {
  it('lets inspect-only callers reach inspect-class tools through the legacy case path', async () => {
    const { root } = makeProject();
    const server = new GodotServer({
      registerSignalHandlers: false,
      godotPath: '/usr/bin/godot',
      runtimeConnector: () => new Promise(() => undefined),
      runtimeConnectInitialDelayMs: 5,
      pathPolicy: new PathPolicy([root]),
      capabilityPolicy: new CapabilityPolicy('inspect-only'),
    });

    const call = requestHandler(server, 'tools/call')(
      {
        method: 'tools/call',
        params: {
          name: 'get_godot_version',
          arguments: {},
        },
      },
      {},
    );

    const response = await call;
    // get_godot_version returns an isError envelope for a missing executable,
    // but it MUST NOT be a CapabilityDeniedError; the gate is silent when the
    // requested capability is granted.
    expect(response.isError).toBe(true);
    const text = JSON.stringify(response);
    expect(text).not.toMatch(/Capability denied/i);
    expect(text).not.toContain('unsafe-full');
  });

  it('denies a strict profile before the legacy case handler ever runs', async () => {
    const { root } = makeProject();
    const server = new GodotServer({
      registerSignalHandlers: false,
      godotPath: '/usr/bin/godot',
      runtimeConnector: () => new Promise(() => undefined),
      runtimeConnectInitialDelayMs: 5,
      pathPolicy: new PathPolicy([root]),
      capabilityPolicy: new CapabilityPolicy('inspect-only'),
    });

    const response = await requestHandler(server, 'tools/call')(
      {
        method: 'tools/call',
        params: {
          name: 'manage_autoloads',
          arguments: { projectPath: root, action: 'list' },
        },
      },
      {},
    );

    expect(response.isError).toBe(true);
    const text = response.content[0].text as string;
    expect(text).toContain('Capability denied');
    expect(text).toContain('manage_autoloads');
    expect(text).toContain('edit');
    expect(text).toContain('inspect-only');
    expect(text).toMatch(/remediation/i);
    expect(text).toContain('unsafe-full');
  });

  it('denies unsafe tools (game_eval) to every profile except unsafe-full', async () => {
    const { root } = makeProject();
    for (const profile of ['inspect-only', 'safe-mutations', 'runtime-control', 'legacy-full'] as const) {
      const server = new GodotServer({
        registerSignalHandlers: false,
        godotPath: '/usr/bin/godot',
        runtimeConnector: () => new Promise(() => undefined),
        runtimeConnectInitialDelayMs: 5,
        pathPolicy: new PathPolicy([root]),
        capabilityPolicy: new CapabilityPolicy(profile),
      });

      const response = await requestHandler(server, 'tools/call')(
        {
          method: 'tools/call',
          params: {
            name: 'game_eval',
            arguments: { code: 'return 1' },
          },
        },
        {},
      );

      expect(response.isError).toBe(true);
      const text = response.content[0].text as string;
      expect(text).toContain('Capability denied');
      expect(text).toContain('game_eval');
      expect(text).toContain('unsafe');
      expect(text).toContain(profile);
    }
  });

  it('lets unsafe-full call arbitrary tools after explicit operator opt-in', async () => {
    const { root } = makeProject();
    const server = new GodotServer({
      registerSignalHandlers: false,
      godotPath: '/usr/bin/godot',
      runtimeConnector: () => new Promise(() => undefined),
      runtimeConnectInitialDelayMs: 5,
      pathPolicy: new PathPolicy([root]),
      capabilityPolicy: new CapabilityPolicy('unsafe-full'),
    });

    // attach_script is classified `unsafe` so it must reach the handler
    // (which still rejects because no real script exists) instead of being
    // blocked at the capability gate.
    const response = await requestHandler(server, 'tools/call')(
      {
        method: 'tools/call',
        params: {
          name: 'attach_script',
          arguments: { projectPath: root, scenePath: 'scenes/Main.tscn', nodePath: 'root', scriptPath: 'scripts/missing.gd' },
        },
      },
      {},
    );
    const text = JSON.stringify(response);
    // Capability gate must not produce a CapabilityDeniedError; downstream
    // errors come from the path policy/project-file check.
    expect(text).not.toMatch(/Capability denied/i);
  });

  it('also gates registered tools through the registry dispatch path', async () => {
    const { root } = makeProject();
    // modify_project_settings is classified `edit` in the registry; `inspect-only`
    // must reject it without invoking the handler.
    const server = new GodotServer({
      registerSignalHandlers: false,
      godotPath: '/usr/bin/godot',
      runtimeConnector: () => new Promise(() => undefined),
      runtimeConnectInitialDelayMs: 5,
      pathPolicy: new PathPolicy([root]),
      capabilityPolicy: new CapabilityPolicy('inspect-only'),
    });

    const response = await requestHandler(server, 'tools/call')(
      {
        method: 'tools/call',
        params: {
          name: 'modify_project_settings',
          arguments: { projectPath: root, section: 'application', key: 'config/name', value: '"X"' },
        },
      },
      {},
    );

    expect(response.isError).toBe(true);
    const text = response.content[0].text as string;
    expect(text).toContain('Capability denied');
    expect(text).toContain('modify_project_settings');
    expect(text).toContain('edit');
    expect(text).toContain('inspect-only');
  });

  it('throws a structured CapabilityDeniedError, not a generic Error', () => {
    const policy = new CapabilityPolicy('inspect-only');
    expect(() => policy.assertAllowed('any_tool', 'edit')).toThrow(CapabilityDeniedError);
  });
});
