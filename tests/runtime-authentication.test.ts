import { createServer, type Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { GodotServer } from '../src/server.js';

const openSockets = new Set<Socket>();
afterEach(() => {
  for (const socket of openSockets) socket.destroy();
  openSockets.clear();
});

describe('runtime authentication handshake', () => {
  it('authenticates before declaring the bridge connected', async () => {
    const received: any[] = [];
    const bridge = createServer(socket => {
      openSockets.add(socket);
      let buffer = '';
      socket.on('data', chunk => {
        buffer += chunk.toString();
        while (buffer.includes('\n')) {
          const end = buffer.indexOf('\n');
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 1);
          const request = JSON.parse(line);
          received.push(request);
          socket.write(JSON.stringify({
            id: request.id,
            result: { authenticated: true, protocolVersion: 1 },
          }) + '\n');
        }
      });
    });

    await new Promise<void>((resolve, reject) => {
      bridge.once('error', reject);
      bridge.listen(0, '127.0.0.1', resolve);
    });
    const address = bridge.address();
    if (!address || typeof address === 'string') throw new Error('Missing test bridge address');

    const server = new GodotServer({
      godotPath: process.execPath,
      registerSignalHandlers: false,
      runtimeConnectInitialDelayMs: 0,
    });
    (server as any).activeProcess = {};
    (server as any).gameConnection.port = address.port;
    (server as any).gameConnection.token = 'a'.repeat(64);

    await expect((server as any).connectToGame('C:/fixture')).resolves.toBeUndefined();
    expect(received).toEqual([
      expect.objectContaining({
        command: '__authenticate',
        params: { token: 'a'.repeat(64) },
      }),
    ]);
    expect((server as any).gameConnection.connected).toBe(true);

    (server as any).disconnectFromGame();
    await new Promise<void>(resolve => bridge.close(() => resolve()));
  });
});
