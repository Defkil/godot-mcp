/**
 * Wire-level regression for the `game_connect_signal` tool-registry migration.
 *
 * Mirrors `tests/registry-migration-rename-file.test.ts` and the previous
 * sibling migrations. The tool is registered in `toolRegistry` with `edit`
 * capability (matching the existing `legacy-capabilities.ts` entry), its
 * legacy flat-list block and `case 'game_connect_signal':` switch arm are
 * removed, its schema is preserved verbatim, and every dispatch + runtime
 * gate contract is enforced through the real MCP `tools/call` request
 * handler against a stubbed `gameConnection.bridgeClient` that mimics the
 * live bridge envelope.
 *
 * The fixture is a temporary Godot project under the OS temp directory,
 * removed in `afterEach`. The test stubs the bridge client only; nothing
 * else relevant to the gate.
 */

import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GodotServer } from '../src/server.js';
import { PathPolicy } from '../src/security/path-policy.js';

const tempRoots: string[] = [];

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'godot-mcp-connect-signal-registry-'));
  tempRoots.push(root);
  writeFileSync(
    join(root, 'project.godot'),
    'config_version=5\n\n[application]\nconfig/name="ConnectSignalRegistryTest"\nfeatures=PackedStringArray("4.7")\n',
    'utf8',
  );
  return root;
}

function requestHandler(server: GodotServer, method: 'tools/list' | 'tools/call') {
  const handlers = (server as any).server._requestHandlers as Map<string, Function>;
  const handler = handlers.get(method);
  if (!handler) throw new Error(`Missing MCP request handler: ${method}`);
  return handler;
}

async function toolsCall(
  server: GodotServer,
  name: string,
  args: Record<string, unknown> | null,
) {
  return requestHandler(server, 'tools/call')(
    { method: 'tools/call', params: { name, arguments: args } },
    {},
  );
}

function stubBridge(
  server: GodotServer,
  payload: Record<string, unknown>,
) {
  // Satisfy the `gameCommand` runtime gate: a fake GodotProcess (any object
  // works — the runtime gate only checks truthiness) plus a connected bridge
  // client that returns the canned payload from `sendCommand`.
  (server as any).activeProcess = { __stub: true };
  (server as any).gameConnection.connected = true;
  (server as any).gameConnection.bridgeClient = {
    isConnected: () => true,
    sendCommand: async (_command: string, _params: Record<string, unknown>) => payload,
  };
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('game_connect_signal registry migration', () => {
  it('is registered in the in-memory tool registry with the edit capability', () => {
    const server = new GodotServer({ registerSignalHandlers: false });
    const registry = (server as any).toolRegistry;
    const definition = registry.tools.get('game_connect_signal');
    expect(definition).toBeDefined();
    expect(definition.capability).toBe('edit');
    expect(definition.description).toBe(
      'Connect a signal from one node to a method on another node in the running game',
    );
    expect(definition.inputSchema).toEqual({
      type: 'object',
      properties: {
        nodePath: { type: 'string', description: 'Path to the source node that emits the signal' },
        signalName: { type: 'string', description: 'Name of the signal to connect' },
        targetPath: { type: 'string', description: 'Path to the target node that receives the signal' },
        method: { type: 'string', description: 'Method name to call on the target node' },
      },
      required: ['nodePath', 'signalName', 'targetPath', 'method'],
    });
  });

  it('advertises game_connect_signal exactly once in the MCP tools list', async () => {
    const server = new GodotServer({ registerSignalHandlers: false });
    const response = await requestHandler(server, 'tools/list')(
      { method: 'tools/list', params: {} },
      {},
    );
    const names = response.tools.map((tool: { name: string }) => tool.name);
    expect(names.filter((name: string) => name === 'game_connect_signal')).toHaveLength(1);
  });

  it('dispatches game_connect_signal through the real MCP tools/call boundary with a typed bridge envelope', async () => {
    const root = makeProject();
    const server = new GodotServer({
      pathPolicy: new PathPolicy([root]),
      registerSignalHandlers: false,
    });
    stubBridge(server, {
      ok: true,
      node_path: '/root/Player',
      signal_name: 'health_changed',
      target_path: '/root/HUD',
      method: 'on_health_changed',
    });

    const response = await toolsCall(server, 'game_connect_signal', {
      nodePath: '/root/Player',
      signalName: 'health_changed',
      targetPath: '/root/HUD',
      method: 'on_health_changed',
    });

    expect(response.isError).not.toBe(true);
    const text = response.content?.[0]?.text ?? '';
    expect(text).toMatch(/node_path/);
    expect(text).toMatch(/health_changed/);
  });

  it('returns a structured error envelope when required arguments are missing', async () => {
    const root = makeProject();
    const server = new GodotServer({
      pathPolicy: new PathPolicy([root]),
      registerSignalHandlers: false,
    });

    const response = await toolsCall(server, 'game_connect_signal', {
      nodePath: '/root/Player',
      signalName: 'health_changed',
    });

    expect(response.isError).toBe(true);
    const text = response.content?.[0]?.text ?? '';
    expect(text).toMatch(/nodePath|signalName|targetPath|method|required/i);
  });

  it('does not have a legacy case statement in the dispatch switch', async () => {
    const source = (await import('node:fs')).readFileSync(
      new URL('../src/server.ts', import.meta.url),
      'utf8',
    );
    expect(source).not.toContain(`case 'game_connect_signal':`);
  });

  it('does not advertise a duplicate game_connect_signal flat-list block in the tools list', async () => {
    const source = (await import('node:fs')).readFileSync(
      new URL('../src/server.ts', import.meta.url),
      'utf8',
    );
    // The legacy flat-list block lives inside `ListToolsRequestSchema` setup
    // and looks like `{ name: 'game_connect_signal', ... }`. After registry
    // migration it should appear at most once (in the merged `tools` array
    // assembled from the registry).
    const matches = source.match(/name:\s*'game_connect_signal'/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(1);
  });
});