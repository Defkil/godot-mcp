import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('package entrypoints', () => {
  it('separates the importable library from the executable CLI', () => {
    const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    const librarySource = readFileSync(join(root, 'src', 'index.ts'), 'utf8');

    expect(packageJson.bin['godot-mcp']).toBe('./build/bin.js');
    expect(packageJson.exports['.'].import).toBe('./build/index.js');
    expect(librarySource).toContain("export { GodotServer } from './server.js'");
    expect(librarySource).toContain('runGodotMcpCli');
    expect(librarySource).not.toContain('new GodotServer(');
  });
});
