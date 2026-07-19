/**
 * Wire-level regression for the `game_disconnect_signal` tool-registry migration.
 *
 * Mirrors the adjacent `game_connect_signal` migration. The tool is registered
 * in `toolRegistry` with `edit` capability, its legacy flat-list block and
 * switch arm are removed, its schema and advertised position are preserved,
 * and dispatch is exercised through the real MCP `tools/call` boundary against
 * a stubbed connected bridge client.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GodotServer } from '../src/server.js';

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
  calls: Array<{ command: string; params: Record<string, unknown> }>,
) {
  (server as any).activeProcess = { __stub: true };
  (server as any).gameConnection.connected = true;
  (server as any).gameConnection.bridgeClient = {
    isConnected: () => true,
    sendCommand: async (command: string, params: Record<string, unknown>) => {
      calls.push({ command, params });
      return payload;
    },
  };
}

describe('game_disconnect_signal registry migration', () => {
  it('is registered with edit capability and the exact legacy schema', () => {
    const server = new GodotServer({ registerSignalHandlers: false });
    const registry = (server as any).toolRegistry;
    const definition = registry.tools.get('game_disconnect_signal');

    expect(definition).toBeDefined();
    expect(definition.capability).toBe('edit');
    expect(definition.description).toBe('Disconnect a signal connection in the running game');
    expect(definition.inputSchema).toEqual({
      type: 'object',
      properties: {
        nodePath: { type: 'string', description: 'Path to the source node' },
        signalName: { type: 'string', description: 'Name of the signal' },
        targetPath: { type: 'string', description: 'Path to the target node' },
        method: { type: 'string', description: 'Method name on the target' },
      },
      required: ['nodePath', 'signalName', 'targetPath', 'method'],
    });
  });

  it('advertises exactly once between game_connect_signal and game_emit_signal', async () => {
    const server = new GodotServer({ registerSignalHandlers: false });
    const response = await requestHandler(server, 'tools/list')(
      { method: 'tools/list', params: {} },
      {},
    );
    const names = response.tools.map((tool: { name: string }) => tool.name);
    const connectIndex = names.indexOf('game_connect_signal');
    const disconnectIndex = names.indexOf('game_disconnect_signal');
    const emitIndex = names.indexOf('game_emit_signal');

    expect(names.filter((name: string) => name === 'game_disconnect_signal')).toHaveLength(1);
    expect(connectIndex).toBeGreaterThanOrEqual(0);
    expect(disconnectIndex).toBe(connectIndex + 1);
    expect(emitIndex).toBe(disconnectIndex + 1);
  });

  it('dispatches the exact disconnect_signal bridge command and success envelope', async () => {
    const server = new GodotServer({ registerSignalHandlers: false });
    const payload = { ok: true, disconnected: true };
    const calls: Array<{ command: string; params: Record<string, unknown> }> = [];
    stubBridge(server, payload, calls);

    const response = await toolsCall(server, 'game_disconnect_signal', {
      nodePath: '/root/Player',
      signalName: 'health_changed',
      targetPath: '/root/HUD',
      method: 'on_health_changed',
    });

    expect(calls).toEqual([{
      command: 'disconnect_signal',
      params: {
        node_path: '/root/Player',
        signal_name: 'health_changed',
        target_path: '/root/HUD',
        method: 'on_health_changed',
      },
    }]);
    expect(response).toEqual({
      content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    });
  });

  it('preserves the exact missing-required-arguments error', async () => {
    const server = new GodotServer({ registerSignalHandlers: false });

    const response = await toolsCall(server, 'game_disconnect_signal', {
      nodePath: '/root/Player',
      signalName: 'health_changed',
    });

    expect(response).toEqual({
      content: [{
        type: 'text',
        text: 'nodePath, signalName, targetPath, and method are required.',
      }],
      isError: true,
    });
  });

  it('does not retain a legacy dispatch case', () => {
    const source = readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8');
    expect(source).not.toContain(`case 'game_disconnect_signal':`);
  });

  it('has exactly one game_disconnect_signal name definition in server source', () => {
    const source = readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8');
    const matches = source.match(/name:\s*'game_disconnect_signal'/g);
    expect(matches).not.toBeNull();
    expect(matches).toHaveLength(1);
  });
});
