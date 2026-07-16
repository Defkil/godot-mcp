import { createServer, type Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { BridgeAuthenticationError } from '../src/godot/bridge/client.js';
import { GodotServer } from '../src/server.js';

/**
 * Behavioral coverage for the BridgeClient wiring inside GodotServer.
 *
 * These tests exercise the real production wiring: GodotServer.connectToGame
 * delegates the transport to BridgeClient, sendGameCommand propagates typed
 * errors from the bridge, and disconnectFromGame tears the bridge down
 * idempotently. The legacy inline socket path is removed; the existing
 * runtime-authentication.test.ts covers the public surface but uses a
 * stringly-typed wrapper.
 */

const openSockets = new Set<Socket>();
afterEach(() => {
  for (const socket of openSockets) socket.destroy();
  openSockets.clear();
});

interface ScriptedBridge {
  start(): Promise<{ port: number; received: string[]; stop: () => Promise<void> }>;
}

function createScriptedBridge(handler: (req: any, socket: Socket) => string | string[] | undefined): ScriptedBridge {
  const received: string[] = [];
  let server: ReturnType<typeof createServer> | undefined;
  return {
    async start() {
      server = createServer(socket => {
        openSockets.add(socket);
        let buffer = '';
        socket.on('data', chunk => {
          buffer += chunk.toString();
          let idx = buffer.indexOf('\n');
          while (idx !== -1) {
            const line = buffer.slice(0, idx).trim();
            buffer = buffer.slice(idx + 1);
            if (line.length > 0) {
              try {
                const parsed = JSON.parse(line);
                received.push(line);
                const reply = handler(parsed, socket);
                if (reply !== undefined) {
                  const replies = Array.isArray(reply) ? reply : [reply];
                  for (const r of replies) socket.write(r.endsWith('\n') ? r : r + '\n');
                }
              } catch {
                /* ignore parse errors */
              }
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
      if (!addr || typeof addr === 'string') throw new Error('Missing test bridge address');
      const port = addr.port;
      const stop = () => new Promise<void>(resolve => server!.close(() => resolve()));
      return { port, received, stop };
    },
  };
}

function makeServer(): GodotServer {
  return new GodotServer({
    godotPath: process.execPath,
    registerSignalHandlers: false,
    runtimeConnectInitialDelayMs: 0,
  });
}

describe('GodotServer wires BridgeClient', () => {
  it('connectToGame authenticates through the wired BridgeClient and exposes connected state', async () => {
    const bridge = createScriptedBridge(req =>
      JSON.stringify({
        id: req.id,
        result: req.command === '__authenticate'
          ? { authenticated: true, protocolVersion: 1 }
          : { ok: true },
      }),
    );
    const { port, received, stop } = await bridge.start();

    const server = makeServer();
    (server as any).activeProcess = {};
    (server as any).gameConnection.port = port;
    (server as any).gameConnection.token = 'a'.repeat(64);

    await (server as any).connectToGame('C:/fixture');

    // BridgeClient now owns the socket; we must reach the typed envelope
    // through the public accessor rather than touching internal state.
    const bridgeClient = (server as any).gameConnection.bridgeClient;
    expect(bridgeClient).toBeTruthy();
    expect(typeof bridgeClient.isConnected).toBe('function');
    expect(bridgeClient.isConnected()).toBe(true);
    expect(received.some(line => line.includes('"command":"__authenticate"'))).toBe(true);

    (server as any).disconnectFromGame();
    expect(bridgeClient.isConnected()).toBe(false);
    await stop();
  });

  it('connectToGame refuses a wrong token with the typed BridgeAuthenticationError', async () => {
    const bridge = createScriptedBridge(req =>
      JSON.stringify({ id: req.id, error: 'invalid token' }),
    );
    const { port, stop } = await bridge.start();

    const server = makeServer();
    (server as any).activeProcess = {};
    (server as any).gameConnection.port = port;
    (server as any).gameConnection.token = 'a'.repeat(64);

    await expect((server as any).connectToGame('C:/fixture')).rejects.toBeInstanceOf(
      BridgeAuthenticationError,
    );
    await expect((server as any).connectToGame('C:/fixture')).rejects.toThrow(/invalid token/);
    await stop();
  });

  it('sendGameCommand correlates responses through the wired BridgeClient', async () => {
    const bridge = createScriptedBridge(req => {
      if (req.command === '__authenticate') {
        return JSON.stringify({
          id: req.id,
          result: { authenticated: true, protocolVersion: 1 },
        });
      }
      return JSON.stringify({ id: req.id, result: { value: 'pong' } });
    });
    const { port, stop } = await bridge.start();

    const server = makeServer();
    (server as any).activeProcess = {};
    (server as any).gameConnection.port = port;
    (server as any).gameConnection.token = 'a'.repeat(64);

    await (server as any).connectToGame('C:/fixture');
    const response = await (server as any).sendGameCommand('ping', {}, 2000);
    expect(response).toMatchObject({ result: { value: 'pong' } });

    (server as any).disconnectFromGame();
    await stop();
  });

  it('disconnectFromGame is idempotent when called twice', async () => {
    const bridge = createScriptedBridge(req =>
      JSON.stringify({
        id: req.id,
        result: req.command === '__authenticate'
          ? { authenticated: true, protocolVersion: 1 }
          : {},
      }),
    );
    const { port, stop } = await bridge.start();

    const server = makeServer();
    (server as any).activeProcess = {};
    (server as any).gameConnection.port = port;
    (server as any).gameConnection.token = 'a'.repeat(64);

    await (server as any).connectToGame('C:/fixture');
    const wiredClient = (server as any).gameConnection.bridgeClient;
    expect(wiredClient).toBeTruthy();
    expect(() => {
      (server as any).disconnectFromGame();
      (server as any).disconnectFromGame();
    }).not.toThrow();
    expect((server as any).gameConnection.bridgeClient).toBeNull();
    expect(wiredClient.isConnected()).toBe(false);
    await stop();
  });
});
