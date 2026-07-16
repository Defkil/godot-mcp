import { createServer, type Server, type Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BridgeAuthenticationError,
  BridgeClient,
  BridgeConnectionError,
  BridgeFrameError,
} from '../src/godot/bridge/client.js';

interface ScriptedBridge {
  start(): Promise<{ port: number }>;
  stop(): Promise<void>;
  /**
   * Handler invoked for every JSON-encoded line the client writes. The handler
   * may mutate `socket` directly (e.g. to send a broadcast or close the
   * connection). Return one or more newline-terminated JSON strings to reply
   * synchronously. Return `undefined` to send no reply.
   */
  onRequest?: (request: { command: string; params?: any; id?: number }, socket: Socket) => string | string[] | undefined;
  readonly received: string[];
}

function createScriptedBridge(): ScriptedBridge {
  const received: string[] = [];
  let server: Server | undefined;
  const script: ScriptedBridge = {
    received,
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
            const reply = script.onRequest?.(parsed, socket);
            if (reply !== undefined) {
              const replies = Array.isArray(reply) ? reply : [reply];
              for (const r of replies) socket.write(r.endsWith('\n') ? r : r + '\n');
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
      if (!addr || typeof addr === 'string') throw new Error('Failed to acquire test port');
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

function clientFor(overrides: Partial<ConstructorParameters<typeof BridgeClient>[0]> = {}): BridgeClient {
  return new BridgeClient({
    port: 0, // overridden by tests after start
    token: 'a'.repeat(64),
    connectMaxAttempts: 1,
    connectRetryDelayMs: 0,
    connectInitialDelayMs: 0,
    ...overrides,
  });
}

describe('BridgeClient', () => {
  it('connects, authenticates with protocol version 1, and surfaces connected state', async () => {
    const bridge = createScriptedBridge();
    bridges.push(bridge);
    bridge.onRequest = req =>
      JSON.stringify({ id: req.id, result: { authenticated: true, protocolVersion: 1 } });
    const { port } = await bridge.start();

    const client = clientFor({ port });
    const auth = await client.connect();
    expect(auth).toEqual({ authenticated: true, protocolVersion: 1 });
    expect(client.isConnected()).toBe(true);
    expect(bridge.received.some(line => line.includes('"command":"__authenticate"'))).toBe(true);

    await client.disconnect();
    expect(client.isConnected()).toBe(false);
  });

  it('rejects with BridgeAuthenticationError when the bridge refuses the token', async () => {
    const bridge = createScriptedBridge();
    bridges.push(bridge);
    bridge.onRequest = req => JSON.stringify({ id: req.id, error: 'invalid token' });
    const { port } = await bridge.start();

    const client = clientFor({ port });
    await expect(client.connect()).rejects.toBeInstanceOf(BridgeAuthenticationError);
    await expect(client.connect()).rejects.toThrow(/invalid token/);
    await client.disconnect();
  });

  it('rejects with BridgeAuthenticationError on protocol version mismatch', async () => {
    const bridge = createScriptedBridge();
    bridges.push(bridge);
    bridge.onRequest = req =>
      JSON.stringify({ id: req.id, result: { authenticated: true, protocolVersion: 99 } });
    const { port } = await bridge.start();

    const client = clientFor({ port });
    await expect(client.connect()).rejects.toBeInstanceOf(BridgeAuthenticationError);
    await expect(client.connect()).rejects.toThrow(/protocol version 99/);
    await client.disconnect();
  });

  it('retries connect up to the configured attempt limit before failing', async () => {
    // No bridge listening on this port: connect attempts will be refused.
    const client = clientFor({
      port: 1, // privileged port nothing listens on
      connectMaxAttempts: 2,
      connectRetryDelayMs: 1,
    });
    await expect(client.connect()).rejects.toBeInstanceOf(BridgeConnectionError);
    await client.disconnect();
  });

  it('exchanges typed commands after authentication', async () => {
    const bridge = createScriptedBridge();
    bridges.push(bridge);
    bridge.onRequest = req => {
      if (req.command === '__authenticate') {
        return JSON.stringify({ id: req.id, result: { authenticated: true, protocolVersion: 1 } });
      }
      if (req.command === 'ping') {
        return JSON.stringify({ id: req.id, result: 'pong' });
      }
      return JSON.stringify({ id: req.id, error: 'unknown command' });
    };
    const { port } = await bridge.start();

    const client = clientFor({ port });
    await client.connect();
    const response = await client.sendCommand<{ id: number; result: string }>('ping', {});
    expect(response.result).toBe('pong');
    await client.disconnect();
  });

  it('rejects oversized NDJSON frames with BridgeFrameError and tears the socket down', async () => {
    const bridge = createScriptedBridge();
    bridges.push(bridge);
    bridge.onRequest = (req, socket) => {
      if (req.command === '__authenticate') {
        return JSON.stringify({ id: req.id, result: { authenticated: true, protocolVersion: 1 } });
      }
      // Inject an oversized frame once the bridge acknowledges.
      socket.write(JSON.stringify({ result: 'x'.repeat(2048) }) + '\n');
      return undefined;
    };
    const { port } = await bridge.start();

    const client = clientFor({ port, maxFrameBytes: 128 });
    await client.connect();
    await expect(client.sendCommand('anything', {})).rejects.toBeInstanceOf(BridgeFrameError);
    expect(client.isConnected()).toBe(false);
    await client.disconnect();
  });

  it('rejects pending commands with timeout error when no response arrives', async () => {
    const bridge = createScriptedBridge();
    bridges.push(bridge);
    bridge.onRequest = (req, socket) => {
      if (req.command === '__authenticate') {
        return JSON.stringify({ id: req.id, result: { authenticated: true, protocolVersion: 1 } });
      }
      // Never reply after authentication.
      return undefined;
    };
    const { port } = await bridge.start();

    const client = clientFor({ port, commandTimeoutMs: 50 });
    await client.connect();
    await expect(client.sendCommand('never', {})).rejects.toThrow(/timed out after/);
    await client.disconnect();
  });

  it('rejects all pending requests when the socket closes', async () => {
    const bridge = createScriptedBridge();
    bridges.push(bridge);
    bridge.onRequest = (req, socket) => {
      if (req.command === '__authenticate') {
        return JSON.stringify({ id: req.id, result: { authenticated: true, protocolVersion: 1 } });
      }
      // Destroy the socket from the server side once a non-auth command arrives.
      setTimeout(() => socket.destroy(), 5);
      return undefined;
    };
    const { port } = await bridge.start();

    const client = clientFor({ port, commandTimeoutMs: 1_000 });
    await client.connect();
    await expect(client.sendCommand('never', {})).rejects.toThrow();
    await client.disconnect();
  });

  it('connect() is idempotent while already connected', async () => {
    const bridge = createScriptedBridge();
    bridges.push(bridge);
    bridge.onRequest = req =>
      JSON.stringify({ id: req.id, result: { authenticated: true, protocolVersion: 1 } });
    const { port } = await bridge.start();

    const client = clientFor({ port });
    await client.connect();
    await client.connect();
    const authLines = bridge.received.filter(line => line.includes('__authenticate'));
    expect(authLines).toHaveLength(1);
    await client.disconnect();
  });

  it('disconnect() is safe to call twice', async () => {
    const bridge = createScriptedBridge();
    bridges.push(bridge);
    bridge.onRequest = req =>
      JSON.stringify({ id: req.id, result: { authenticated: true, protocolVersion: 1 } });
    const { port } = await bridge.start();

    const client = clientFor({ port });
    await client.connect();
    await client.disconnect();
    await client.disconnect();
    expect(client.isConnected()).toBe(false);
  });

  it('does not retry on BridgeAuthenticationError when retryOnAuthenticationFailure is false', async () => {
    const bridge = createScriptedBridge();
    bridges.push(bridge);
    bridge.onRequest = req =>
      JSON.stringify({ id: req.id, error: 'invalid token' });
    const { port } = await bridge.start();

    const client = clientFor({
      port,
      connectMaxAttempts: 5,
      connectRetryDelayMs: 10,
      retryOnAuthenticationFailure: false,
    });
    await expect(client.connect()).rejects.toBeInstanceOf(BridgeAuthenticationError);
    // Only one __authenticate round trip should have occurred.
    const authAttempts = bridge.received.filter(line => line.includes('__authenticate'));
    expect(authAttempts).toHaveLength(1);
    await client.disconnect();
  });
});