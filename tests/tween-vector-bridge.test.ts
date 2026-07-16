import { createServer, type Server, type Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BridgeClient,
  BridgeConnectionError,
} from '../src/godot/bridge/client.js';
import { normalizeParameters } from '../src/utils.js';

/**
 * Regression coverage for [tugcantopaloglu#11] "tween vectors/colors crash the
 * bridge; subsequent command must still work."
 *
 * The local fork already contains the upstream fix in
 * `src/scripts/mcp_interaction_server.gd`:
 *   - `_cmd_tween_property` null-checks the returned `PropertyTweener` so a
 *     type mismatch no longer crashes the channel;
 *   - `_json_to_variant` accepts a JSON-string-encoded dictionary for
 *     `Vector2`/`Vector3`/`Color` payloads (so callers can ship either a
 *     plain object or a stringified JSON literal).
 *
 * What the takeover needs to lock in is the wire-level contract that lets
 * those fixes succeed:
 *   1. `BridgeClient.sendCommand` forwards `Vector2`/`Vector3`/`Color`
 *      `final_value` payloads byte-for-byte through NDJSON (no script-side
 *      mutation, no id loss).
 *   2. The bridge connection survives a `tween_property` round trip with a
 *      typed-vector payload, so a subsequent command (`get_scene_tree`) still
 *      receives its correlated response on the same socket.
 *   3. The TypeScript handler layer forwards a structured Vector/Color object
 *      (not a stringified JSON literal) when one is passed by the caller.
 *
 * This file exercises only the transport boundary; the real-Godot script
 * side requires a Godot binary that the takeover runner does not have, so
 * the GDScript regression is owned by the upstream fix and reasserted in the
 * `docs/maintainers/issue-inventory.md` row for #11.
 */

interface ScriptedBridge {
  start(): Promise<{ port: number }>;
  stop(): Promise<void>;
  onRequest?: (
    request: { command: string; params?: any; id?: number },
    socket: Socket,
  ) => string | string[] | undefined;
  readonly received: string[];
  /**
   * Captured parsed commands keyed by command name in arrival order. Useful
   * for asserting that the bridge received both the tween and the follow-up
   * command on the same socket.
   */
  readonly commands: Array<{ command: string; params?: any; id?: number }>;
}

function createScriptedBridge(): ScriptedBridge {
  const received: string[] = [];
  const commands: Array<{ command: string; params?: any; id?: number }> = [];
  let server: Server | undefined;
  const script: ScriptedBridge = {
    received,
    commands,
    async start() {
      server = createServer(socket => {
        let buffer = '';
        socket.on('data', chunk => {
          buffer += chunk.toString();
          let idx = buffer.indexOf('\n');
          while (idx !== -1) {
            const line = buffer.slice(0, idx).trim();
            buffer = buffer.slice(idx + 1);
            if (line.length === 0) {
              idx = buffer.indexOf('\n');
              continue;
            }
            let parsed: { command: string; params?: any; id?: number };
            try {
              parsed = JSON.parse(line);
            } catch {
              idx = buffer.indexOf('\n');
              continue;
            }
            received.push(line);
            commands.push(parsed);
            const reply = script.onRequest?.(parsed, socket);
            if (reply !== undefined) {
              const replies = Array.isArray(reply) ? reply : [reply];
              for (const r of replies)
                socket.write(r.endsWith('\n') ? r : r + '\n');
            }
            idx = buffer.indexOf('\n');
          }
        });
      });
      await new Promise<void>((resolve, reject) => {
        server!.once('error', reject);
        server!.listen(0, '127.0.0.1', resolve);
      });
      const addr = server!.address();
      if (!addr || typeof addr === 'string')
        throw new Error('Failed to acquire test port');
      return { port: addr.port };
    },
    async stop() {
      if (!server) return;
      await new Promise<void>(resolve => server!.close(() => resolve()));
      server = undefined;
    },
  };
  return script;
}

const bridges: ScriptedBridge[] = [];

afterEach(async () => {
  await Promise.all(bridges.splice(0).map(b => b.stop()));
});

function clientFor(
  overrides: Partial<ConstructorParameters<typeof BridgeClient>[0]> = {},
): BridgeClient {
  return new BridgeClient({
    port: 0,
    token: 'a'.repeat(64),
    connectMaxAttempts: 1,
    connectRetryDelayMs: 0,
    connectInitialDelayMs: 0,
    ...overrides,
  });
}

/**
 * Mirror of `handleGameTweenProperty` from `src/server.ts`. Kept here as a
 * pure transform so the test does not need to spin up the full server to
 * assert what gets sent on the wire.
 */
function transformTweenArgs(args: any): Record<string, any> {
  args = normalizeParameters(args || {});
  if (!args.nodePath || !args.property || args.finalValue === undefined) {
    throw new Error('nodePath, property, and finalValue are required.');
  }
  return {
    node_path: args.nodePath,
    property: args.property,
    final_value: args.finalValue,
    duration: args.duration || 1.0,
    trans_type: args.transType || 0,
    ease_type: args.easeType || 2,
  };
}

describe('Bridge transport — tween_property with Vector/Color payloads', () => {
  it('forwards a Vector2 final_value byte-for-byte through NDJSON', async () => {
    const bridge = createScriptedBridge();
    bridges.push(bridge);
    bridge.onRequest = req => {
      if (req.command === '__authenticate') {
        return JSON.stringify({
          id: req.id,
          result: { authenticated: true, protocolVersion: 1 },
        });
      }
      return JSON.stringify({ id: req.id, result: { success: true } });
    };
    const { port } = await bridge.start();

    const client = clientFor({ port });
    await client.connect();

    const params = transformTweenArgs({
      nodePath: '/root/Sprite',
      property: 'position',
      finalValue: { x: 12.5, y: -7.25 },
      duration: 0.75,
    });
    const response = await client.sendCommand<{ success: boolean }>(
      'tween_property',
      params,
    );
    expect(response.result).toEqual({ success: true });

    const tweenRequest = bridge.commands.find(c => c.command === 'tween_property');
    expect(tweenRequest).toBeDefined();
    expect(tweenRequest!.params).toEqual({
      node_path: '/root/Sprite',
      property: 'position',
      final_value: { x: 12.5, y: -7.25 },
      duration: 0.75,
      trans_type: 0,
      ease_type: 2,
    });
    expect(typeof tweenRequest!.id).toBe('number');

    await client.disconnect();
  });

  it('forwards a Vector3 final_value byte-for-byte through NDJSON', async () => {
    const bridge = createScriptedBridge();
    bridges.push(bridge);
    bridge.onRequest = req => {
      if (req.command === '__authenticate') {
        return JSON.stringify({
          id: req.id,
          result: { authenticated: true, protocolVersion: 1 },
        });
      }
      return JSON.stringify({ id: req.id, result: { success: true } });
    };
    const { port } = await bridge.start();

    const client = clientFor({ port });
    await client.connect();

    const params = transformTweenArgs({
      nodePath: '/root/Camera3D',
      property: 'position',
      finalValue: { x: 1, y: 2, z: 3 },
      duration: 2,
      transType: 1,
      easeType: 3,
    });
    const response = await client.sendCommand<{ success: boolean }>(
      'tween_property',
      params,
    );
    expect(response.result).toEqual({ success: true });

    const tweenRequest = bridge.commands.find(c => c.command === 'tween_property');
    expect(tweenRequest!.params).toEqual({
      node_path: '/root/Camera3D',
      property: 'position',
      final_value: { x: 1, y: 2, z: 3 },
      duration: 2,
      trans_type: 1,
      ease_type: 3,
    });

    await client.disconnect();
  });

  it('forwards a Color final_value byte-for-byte through NDJSON', async () => {
    const bridge = createScriptedBridge();
    bridges.push(bridge);
    bridge.onRequest = req => {
      if (req.command === '__authenticate') {
        return JSON.stringify({
          id: req.id,
          result: { authenticated: true, protocolVersion: 1 },
        });
      }
      return JSON.stringify({ id: req.id, result: { success: true } });
    };
    const { port } = await bridge.start();

    const client = clientFor({ port });
    await client.connect();

    const params = transformTweenArgs({
      nodePath: '/root/Sprite2D',
      property: 'modulate',
      finalValue: { r: 0.25, g: 0.5, b: 0.75, a: 1 },
      duration: 0.5,
    });
    const response = await client.sendCommand<{ success: boolean }>(
      'tween_property',
      params,
    );
    expect(response.result).toEqual({ success: true });

    const tweenRequest = bridge.commands.find(c => c.command === 'tween_property');
    expect(tweenRequest!.params).toMatchObject({
      node_path: '/root/Sprite2D',
      property: 'modulate',
      final_value: { r: 0.25, g: 0.5, b: 0.75, a: 1 },
    });

    await client.disconnect();
  });

  it('preserves the bridge connection after a tween_property with Vector payload so subsequent commands still work', async () => {
    const bridge = createScriptedBridge();
    bridges.push(bridge);
    bridge.onRequest = req => {
      if (req.command === '__authenticate') {
        return JSON.stringify({
          id: req.id,
          result: { authenticated: true, protocolVersion: 1 },
        });
      }
      if (req.command === 'tween_property') {
        return JSON.stringify({
          id: req.id,
          result: { success: true, node: req.params.node_path },
        });
      }
      if (req.command === 'get_scene_tree') {
        return JSON.stringify({
          id: req.id,
          result: { tree: [{ name: 'root', type: 'Node' }] },
        });
      }
      return JSON.stringify({ id: req.id, error: 'unknown command' });
    };
    const { port } = await bridge.start();

    const client = clientFor({ port });
    await client.connect();

    const tweenParams = transformTweenArgs({
      nodePath: '/root/Sprite2D',
      property: 'position',
      finalValue: { x: 100, y: 50 },
    });
    const tweenResponse = await client.sendCommand<{ success: boolean; node: string }>(
      'tween_property',
      tweenParams,
    );
    expect(tweenResponse.result).toEqual({
      success: true,
      node: '/root/Sprite2D',
    });

    // Subsequent command on the same socket must still resolve; this is the
    // acceptance criterion of [tugcantopaloglu#11] ("subsequent command must
    // still work") translated to the wire-level contract.
    const treeResponse = await client.sendCommand<{
      tree: Array<{ name: string; type: string }>;
    }>('get_scene_tree', {});
    expect(treeResponse.result).toEqual({ tree: [{ name: 'root', type: 'Node' }] });

    const commandOrder = bridge.commands.map(c => c.command);
    expect(commandOrder).toEqual([
      '__authenticate',
      'tween_property',
      'get_scene_tree',
    ]);
    expect(client.isConnected()).toBe(true);

    await client.disconnect();
  });

  it('accepts a stringified JSON literal as final_value (matches _json_to_variant string-parse path)', async () => {
    // The upstream `_json_to_variant` fix added a JSON-string-encoded
    // dictionary shortcut so callers that ship a stringified payload still
    // resolve to the right Vector/Color type. We cannot exercise the GDScript
    // parser from a Vitest unit, but we can prove the TypeScript handler
    // passes the string literal through unchanged so the GDScript parser
    // sees it as a String (and then parses it).
    const bridge = createScriptedBridge();
    bridges.push(bridge);
    bridge.onRequest = req => {
      if (req.command === '__authenticate') {
        return JSON.stringify({
          id: req.id,
          result: { authenticated: true, protocolVersion: 1 },
        });
      }
      return JSON.stringify({ id: req.id, result: { success: true } });
    };
    const { port } = await bridge.start();

    const client = clientFor({ port });
    await client.connect();

    const literal = '{"x":4,"y":5,"z":6}';
    const params = transformTweenArgs({
      nodePath: '/root/Camera3D',
      property: 'position',
      finalValue: literal,
    });
    await client.sendCommand('tween_property', params);

    const tweenRequest = bridge.commands.find(c => c.command === 'tween_property');
    expect(tweenRequest!.params.final_value).toBe(literal);

    await client.disconnect();
  });

  it('handler transform rejects missing finalValue before sending on the wire', async () => {
    // Mirrors the existing `handleGameTweenProperty` guard: a missing
    // finalValue must surface as a typed error and never reach the bridge.
    expect(() =>
      transformTweenArgs({ nodePath: '/root/Sprite', property: 'position' }),
    ).toThrow(/finalValue/i);
  });
});

describe('BridgeClient — error envelope paths do not break the channel', () => {
  it('a tween_property error envelope from the bridge still allows further commands on the same connection', async () => {
    const bridge = createScriptedBridge();
    bridges.push(bridge);
    bridge.onRequest = req => {
      if (req.command === '__authenticate') {
        return JSON.stringify({
          id: req.id,
          result: { authenticated: true, protocolVersion: 1 },
        });
      }
      if (req.command === 'tween_property') {
        return JSON.stringify({
          id: req.id,
          error: 'tween_property failed: value type does not match property',
        });
      }
      if (req.command === 'get_performance') {
        return JSON.stringify({
          id: req.id,
          result: { fps: 60 },
        });
      }
      return JSON.stringify({ id: req.id, error: 'unknown command' });
    };
    const { port } = await bridge.start();

    const client = clientFor({ port });
    await client.connect();

    // Bridge sends back an error envelope; sendCommand resolves to the JSON
    // object (the `error` key is propagated by the server-side wrapper).
    const tweenParams = transformTweenArgs({
      nodePath: '/root/Sprite',
      property: 'position',
      finalValue: { x: 0, y: 0 },
    });
    const tweenResponse = await client.sendCommand<unknown>(
      'tween_property',
      tweenParams,
    );
    expect(tweenResponse.error).toMatch(/value type does not match property/);

    // Subsequent command on the same socket must still succeed.
    const perfResponse = await client.sendCommand<{ fps: number }>(
      'get_performance',
      {},
    );
    expect(perfResponse.result).toEqual({ fps: 60 });
    expect(client.isConnected()).toBe(true);

    await client.disconnect();
  });

  it('refuses to dispatch when no live connection exists (sanity guard for the tween path)', async () => {
    const client = clientFor({ port: 1 }); // port 1 will refuse
    await expect(
      client.sendCommand('tween_property', {
        node_path: '/root/Sprite',
        property: 'position',
        final_value: { x: 0, y: 0 },
        duration: 1.0,
        trans_type: 0,
        ease_type: 2,
      }),
    ).rejects.toBeInstanceOf(BridgeConnectionError);
  });
});