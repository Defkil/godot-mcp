import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sdkMocks = vi.hoisted(() => ({
  connect: vi.fn(async () => undefined),
  transportConstructor: vi.fn(),
}));

vi.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: class {
    onerror?: (error: Error) => void;

    setRequestHandler() {}

    connect = sdkMocks.connect;

    async close() {}
  },
}));

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: class {
    constructor() {
      sdkMocks.transportConstructor();
    }
  },
}));

vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => {
    const callback = args.at(-1) as (error: Error) => void;
    callback(new Error('not a Godot executable'));
  },
  spawn: vi.fn(),
}));

describe('library entrypoint', () => {
  const originalGodotPath = process.env.GODOT_PATH;
  const originalAllowedDirs = process.env.GODOT_MCP_ALLOWED_DIRS;

  beforeEach(() => {
    vi.resetModules();
    sdkMocks.connect.mockClear();
    sdkMocks.transportConstructor.mockClear();
    process.env.GODOT_PATH = process.execPath;
    process.env.GODOT_MCP_ALLOWED_DIRS = JSON.stringify([process.cwd()]);
  });

  afterEach(() => {
    if (originalGodotPath === undefined) {
      delete process.env.GODOT_PATH;
    } else {
      process.env.GODOT_PATH = originalGodotPath;
    }
    if (originalAllowedDirs === undefined) {
      delete process.env.GODOT_MCP_ALLOWED_DIRS;
    } else {
      process.env.GODOT_MCP_ALLOWED_DIRS = originalAllowedDirs;
    }
  });

  it('exports a constructible server without starting stdio on import', async () => {
    const module = await import('../src/index.js');
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(module.GodotServer).toBeTypeOf('function');
    expect(() => new module.GodotServer({ godotPath: process.execPath })).not.toThrow();
    expect(sdkMocks.transportConstructor).not.toHaveBeenCalled();
    expect(sdkMocks.connect).not.toHaveBeenCalled();
  });

  it('rejects startup failures without terminating the embedding process', async () => {
    delete process.env.GODOT_PATH;
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`unexpected process.exit(${code})`);
    }) as never);
    const { GodotServer } = await import('../src/index.js');
    const server = new GodotServer({
      godotPath: 'definitely-not-a-godot-binary',
      strictPathValidation: true,
    });

    await expect(server.run()).rejects.toThrow(/Could not find a valid Godot executable/);
    expect(exit).not.toHaveBeenCalled();
    exit.mockRestore();
  });
});
