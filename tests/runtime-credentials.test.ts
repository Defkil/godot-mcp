import { createServer } from 'node:net';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { allocateRuntimeCredentials, runtimeEnvironment } from '../src/godot/runtime-credentials.js';

describe('runtime credentials', () => {
  it('allocates a loopback port and a high-entropy per-session token', async () => {
    const first = await allocateRuntimeCredentials();
    const second = await allocateRuntimeCredentials();

    expect(first.port).toBeGreaterThan(0);
    expect(first.port).not.toBe(9090);
    expect(first.token).toMatch(/^[a-f0-9]{64}$/);
    expect(second.token).not.toBe(first.token);

    await new Promise<void>((resolve, reject) => {
      const server = createServer();
      server.once('error', reject);
      server.listen(first.port, '127.0.0.1', () => server.close(() => resolve()));
    });
  });

  it('passes credentials through an isolated child environment', () => {
    expect(runtimeEnvironment({ BASE: 'kept' }, { port: 43123, token: 'secret' })).toMatchObject({
      BASE: 'kept',
      GODOT_MCP_PORT: '43123',
      GODOT_MCP_TOKEN: 'secret',
    });
  });

  it('keeps the Godot bridge fail-closed, authenticated, loopback-only, and bounded', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, '../src/scripts/mcp_interaction_server.gd'), 'utf8');

    expect(source).toContain('OS.get_environment("GODOT_MCP_TOKEN")');
    expect(source).toContain('OS.get_environment("GODOT_MCP_PORT")');
    expect(source).toContain('_server.listen(_port, "127.0.0.1")');
    expect(source).toContain('command != "__authenticate"');
    expect(source).toContain('MAX_REQUEST_BUFFER_CHARS');
    expect(source).not.toContain('const PORT: int = 9090');
  });
});
