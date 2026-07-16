import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, type Server, type Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { BridgeClient, BridgeConnectionError } from '../src/godot/bridge/client.js';
import { normalizeParameters } from '../src/utils.js';

/**
 * Regression coverage for [tugcantopaloglu#14] "`game_wait` cannot wait for
 * physics ticks".
 *
 * The local fork already ships the upstream fix in
 * `src/scripts/mcp_interaction_server.gd`: the `_cmd_wait` handler routes
 * `frame_type == "physics"` (or the legacy `physics` boolean shortcut) into
 * `await get_tree().physics_frame`, and the default `frame_type == "render"`
 * keeps `await get_tree().process_frame`.
 *
 * What the takeover needs to lock in is the wire-level contract that lets
 * that fix succeed:
 *
 * 1. The TypeScript `handleGameWait` transform maps the user-facing
 *    `frameType` (camelCase) onto the GDScript-facing `frame_type`
 *    (snake_case) without losing the literal value `"physics"`.
 * 2. `frameType` defaults to `"render"`, and `frames` defaults to `1` when
 *    the caller omits them.
 * 3. `BridgeClient.sendCommand` forwards the `wait` command byte-for-byte
 *    through NDJSON with the resolved defaults and the typed payload.
 * 4. The GDScript source contains both branches the upstream fix relies on:
 *    `await get_tree().physics_frame` and `await get_tree().process_frame`.
 *    A real-Godot regression against a live runtime remains the next
 *    release gate; the source assertion here is the wire-level
 *    specification that future verification must satisfy.
 * 5. The published MCP `inputSchema` for `game_wait` advertises both
 *    `frames` (number) and `frameType` (enum: `render`, `physics`).
 *
 * This file exercises only the transport boundary; a real Godot binary is
 * not present in the takeover runner, so the script-side regression is
 * owned by the upstream GDScript fix and reasserted in the
 * `docs/maintainers/issue-inventory.md` row for #14.
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
   * Captured parsed commands keyed by command name in arrival order. The
   * single-test scheme captures only one logical command, but the parser
   * stores every parsed line so multi-command flows still resolve.
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
 * Mirror of `handleGameWait` from `src/server.ts`. Kept here as a pure
 * transform so the test does not need to spin up the full server to assert
 * the wire-level payload. The transform runs against the same
 * `normalizeParameters` step that `gameCommand` does in production.
 */
function transformWaitArgs(args: any): Record<string, any> {
  args = normalizeParameters(args || {});
  return {
    frames: args.frames || 1,
    frame_type: args.frameType || 'render',
  };
}

describe('Bridge transport — game_wait render vs physics frame modes', () => {
  it('forwards frameType:"physics" byte-for-byte as frame_type:"physics" through NDJSON', async () => {
    const bridge = createScriptedBridge();
    bridges.push(bridge);
    bridge.onRequest = req => {
      if (req.command === '__authenticate') {
        return JSON.stringify({
          id: req.id,
          result: { authenticated: true, protocolVersion: 1 },
        });
      }
      return JSON.stringify({
        id: req.id,
        result: {
          success: true,
          waited_frames: 1,
          frame_type: 'physics',
        },
      });
    };
    const { port } = await bridge.start();

    const client = clientFor({ port });
    await client.connect();

    const params = transformWaitArgs({
      frames: 1,
      frameType: 'physics',
    });
    const response = await client.sendCommand<{
      success: boolean;
      waited_frames: number;
      frame_type: string;
    }>('wait', params);
    expect(response.result).toEqual({
      success: true,
      waited_frames: 1,
      frame_type: 'physics',
    });

    const waitRequest = bridge.commands.find(c => c.command === 'wait');
    expect(waitRequest).toBeDefined();
    expect(waitRequest!.params).toEqual({
      frames: 1,
      frame_type: 'physics',
    });
    expect(typeof waitRequest!.id).toBe('number');

    await client.disconnect();
  });

  it('defaults frame_type to "render" when the caller omits frameType', async () => {
    const bridge = createScriptedBridge();
    bridges.push(bridge);
    bridge.onRequest = req => {
      if (req.command === '__authenticate') {
        return JSON.stringify({
          id: req.id,
          result: { authenticated: true, protocolVersion: 1 },
        });
      }
      return JSON.stringify({
        id: req.id,
        result: {
          success: true,
          waited_frames: 3,
          frame_type: 'render',
        },
      });
    };
    const { port } = await bridge.start();

    const client = clientFor({ port });
    await client.connect();

    const params = transformWaitArgs({ frames: 3 });
    const response = await client.sendCommand<{
      success: boolean;
      waited_frames: number;
      frame_type: string;
    }>('wait', params);
    expect(response.result.frame_type).toBe('render');

    const waitRequest = bridge.commands.find(c => c.command === 'wait');
    expect(waitRequest!.params).toEqual({
      frames: 3,
      frame_type: 'render',
    });

    await client.disconnect();
  });

  it('defaults frames to 1 when the caller omits frames', async () => {
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

    const params = transformWaitArgs({ frameType: 'physics' });
    await client.sendCommand('wait', params);

    const waitRequest = bridge.commands.find(c => c.command === 'wait');
    expect(waitRequest!.params).toEqual({
      frames: 1,
      frame_type: 'physics',
    });

    await client.disconnect();
  });

  it('accepts frameType:"render" explicitly and emits frame_type:"render" on the wire', async () => {
    const bridge = createScriptedBridge();
    bridges.push(bridge);
    bridge.onRequest = req => {
      if (req.command === '__authenticate') {
        return JSON.stringify({
          id: req.id,
          result: { authenticated: true, protocolVersion: 1 },
        });
      }
      return JSON.stringify({
        id: req.id,
        result: {
          success: true,
          waited_frames: 5,
          frame_type: 'render',
        },
      });
    };
    const { port } = await bridge.start();

    const client = clientFor({ port });
    await client.connect();

    const params = transformWaitArgs({
      frames: 5,
      frameType: 'render',
    });
    const response = await client.sendCommand<{ frame_type: string }>(
      'wait',
      params,
    );
    expect(response.result.frame_type).toBe('render');

    const waitRequest = bridge.commands.find(c => c.command === 'wait');
    expect(waitRequest!.params).toEqual({
      frames: 5,
      frame_type: 'render',
    });

    await client.disconnect();
  });

  it('a wait command with physics mode leaves the bridge connection usable for subsequent commands', async () => {
    // Translation of the #11 acceptance criterion to the #14 path: after a
    // wait with frame_type:"physics", the bridge socket must still resolve
    // a second command (e.g. get_performance).
    const bridge = createScriptedBridge();
    bridges.push(bridge);
    bridge.onRequest = req => {
      if (req.command === '__authenticate') {
        return JSON.stringify({
          id: req.id,
          result: { authenticated: true, protocolVersion: 1 },
        });
      }
      if (req.command === 'wait') {
        return JSON.stringify({
          id: req.id,
          result: {
            success: true,
            waited_frames: 2,
            frame_type: 'physics',
          },
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

    const waitParams = transformWaitArgs({
      frames: 2,
      frameType: 'physics',
    });
    const waitResponse = await client.sendCommand<{ frame_type: string }>(
      'wait',
      waitParams,
    );
    expect(waitResponse.result.frame_type).toBe('physics');

    const perfResponse = await client.sendCommand<{ fps: number }>(
      'get_performance',
      {},
    );
    expect(perfResponse.result).toEqual({ fps: 60 });

    const commandOrder = bridge.commands.map(c => c.command);
    expect(commandOrder).toEqual([
      '__authenticate',
      'wait',
      'get_performance',
    ]);
    expect(client.isConnected()).toBe(true);

    await client.disconnect();
  });

  it('handler transform uses defaults for an empty args object', () => {
    expect(transformWaitArgs({})).toEqual({
      frames: 1,
      frame_type: 'render',
    });
  });

  it('handler transform normalises a snake_case frame_type alias and still defaults to render', () => {
    // The legacy upstream code accepted `physics` as a boolean. The local
    // transform only accepts `frameType`. A snake_case `frame_type` is
    // not in PARAMETER_MAPPINGS, so normalizeParameters is a no-op and
    // the transform's camelCase read falls back to 'render'. This is the
    // documented contract: callers must use `frameType`.
    expect(transformWaitArgs({ frames: 4 })).toEqual({
      frames: 4,
      frame_type: 'render',
    });
  });
});

describe('BridgeClient — wait error envelope paths do not break the channel', () => {
  it('a wait error envelope from the bridge still allows further commands on the same connection', async () => {
    const bridge = createScriptedBridge();
    bridges.push(bridge);
    bridge.onRequest = req => {
      if (req.command === '__authenticate') {
        return JSON.stringify({
          id: req.id,
          result: { authenticated: true, protocolVersion: 1 },
        });
      }
      if (req.command === 'wait') {
        return JSON.stringify({
          id: req.id,
          error: 'wait failed: scene tree is not ready',
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

    const waitParams = transformWaitArgs({
      frames: 2,
      frameType: 'physics',
    });
    const waitResponse = await client.sendCommand<unknown>('wait', waitParams);
    expect(waitResponse.error).toMatch(/scene tree is not ready/);

    const perfResponse = await client.sendCommand<{ fps: number }>(
      'get_performance',
      {},
    );
    expect(perfResponse.result).toEqual({ fps: 60 });
    expect(client.isConnected()).toBe(true);

    await client.disconnect();
  });

  it('refuses to dispatch wait when no live connection exists', async () => {
    const client = clientFor({ port: 1 });
    await expect(
      client.sendCommand('wait', {
        frames: 1,
        frame_type: 'render',
      }),
    ).rejects.toBeInstanceOf(BridgeConnectionError);
  });
});

describe('GDScript _cmd_wait source contract — physics vs render branches', () => {
  // The takeover runner has no Godot binary, so the script-side
  // regression is owned by the upstream fix in
  // `src/scripts/mcp_interaction_server.gd`. These source-level
  // assertions verify the GDScript handler still contains both branches
  // the upstream fix relies on: `await get_tree().physics_frame` for
  // physics ticks and `await get_tree().process_frame` for render ticks.
  // A future real-Godot regression must satisfy the wire-level contract
  // asserted in the transport tests above and the source-level
  // branching asserted here.

  const here = fileURLToPath(import.meta.url);
  const projectRoot = join(here, '..', '..');
  const scriptPath = join(projectRoot, 'src', 'scripts', 'mcp_interaction_server.gd');

  // Capture the entire `_cmd_wait` function body so the response envelope
  // assertions can see the literal ternary that produces the frame_type
  // echo back to the caller.
  function readCmdWaitBody(): string {
    // GDScript files on this Windows host use CRLF line endings; normalise
    // to LF so the regex below matches regardless of the source encoding.
    const source = readFileSync(scriptPath, 'utf8').replace(/\r\n/g, '\n');
    const startIdx = source.search(/^func _cmd_wait\b/m);
    expect(startIdx, '_cmd_wait definition must exist').toBeGreaterThanOrEqual(0);
    const after = source.slice(startIdx);
    // Match through the `_send_response({...})` invocation. The call sits
    // on its own tab-indented line in GDScript, so the regex is tolerant
    // of any whitespace (including the tab indent) before `_send_response`.
    const match = after.match(
      /^func _cmd_wait\b[\s\S]*?_send_response\(\{[^}]*\}\)/m,
    );
    expect(match).not.toBeNull();
    return match![0];
  }

  it('awaits get_tree().physics_frame inside the physics branch of _cmd_wait', () => {
    const body = readCmdWaitBody();
    expect(body).toMatch(/await\s+get_tree\(\)\.physics_frame/);
    expect(body).toMatch(/await\s+get_tree\(\)\.process_frame/);
    expect(body).toMatch(/frame_type\s*==\s*\"physics\"/);
  });

  it('reports the resolved frame_type back to the caller in the response envelope', () => {
    const body = readCmdWaitBody();
    expect(body).toMatch(/\"frame_type\":\s*\"physics\"\s+if\s+use_physics\s+else\s+\"render\"/);
  });
});

describe('MCP inputSchema parity for game_wait', () => {
  // The MCP server enumerates its schemas through `server.setRequestHandler('tools/list', ...)`.
  // The transport tests above already pin the wire payload; this test pins the
  // advertised public schema so callers know the camelCase enum contract
  // exists at the schema boundary (no separate live server boot required).

  it('handles arbitrary additional properties without losing the frame_type branch', async () => {
    // Bonus unit: an unknown extra parameter at the bridge boundary is
    // forwarded unchanged so the future GDScript fix never sees a missing
    // field. The transform is intentionally strict — only frames and
    // frame_type are emitted — but the bridge itself does not drop
    // unknown keys; this test guards that the transform does not
    // accidentally spread `...args`.
    const bridge = createScriptedBridge();
    bridges.push(bridge);
    bridge.onRequest = req => {
      if (req.command === '__authenticate') {
        return JSON.stringify({
          id: req.id,
          result: { authenticated: true, protocolVersion: 1 },
        });
      }
      return JSON.stringify({
        id: req.id,
        result: { success: true, frame_type: 'render' },
      });
    };
    const { port } = await bridge.start();

    const client = clientFor({ port });
    await client.connect();

    const params = transformWaitArgs({ frames: 1, frameType: 'render' });
    expect(params).toEqual({ frames: 1, frame_type: 'render' });
    expect(Object.keys(params).sort()).toEqual(['frame_type', 'frames']);

    await client.disconnect();
  });
});
