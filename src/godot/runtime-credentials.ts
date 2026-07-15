import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';

export interface RuntimeCredentials {
  port: number;
  token: string;
}

export async function allocateRuntimeCredentials(): Promise<RuntimeCredentials> {
  let port = 9090;
  while (port === 9090) {
    port = await reserveEphemeralLoopbackPort();
  }
  return {
    port,
    token: randomBytes(32).toString('hex'),
  };
}

export function runtimeEnvironment(
  base: NodeJS.ProcessEnv,
  credentials: RuntimeCredentials,
): NodeJS.ProcessEnv {
  return {
    ...base,
    GODOT_MCP_PORT: String(credentials.port),
    GODOT_MCP_TOKEN: credentials.token,
  };
}

function reserveEphemeralLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Failed to allocate a loopback port.'));
        return;
      }
      const port = address.port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}
