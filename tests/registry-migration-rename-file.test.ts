/**
 * Wire-level regression for the `rename_file` tool-registry migration.
 *
 * Mirrors `tests/registry-migration-delete-file.test.ts` and
 * `tests/registry-migration-create-directory.test.ts`. The tool is
 * registered in `toolRegistry` with `edit` capability, its legacy
 * flat-list block and `case 'rename_file':` switch arm are removed,
 * its schema is preserved verbatim, and every dispatch + filesystem
 * rename + PathPolicy denial contract is enforced through the real MCP
 * `tools/call` request handler.
 *
 * The fixture is a temporary Godot project under the OS temp
 * directory, removed in `afterEach`. The test stubs nothing relevant
 * to the gate.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GodotServer } from '../src/server.js';
import { PathPolicy } from '../src/security/path-policy.js';

const tempRoots: string[] = [];

function makeProject(): { root: string; projectFile: string } {
  const root = mkdtempSync(join(tmpdir(), 'godot-mcp-rename-file-registry-'));
  tempRoots.push(root);
  const projectFile = join(root, 'project.godot');
  writeFileSync(
    projectFile,
    'config_version=5\n\n[application]\nconfig/name="RenameFileRegistryTest"\nfeatures=PackedStringArray("4.7")\n',
    'utf8',
  );
  return { root, projectFile };
}

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

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('rename_file registry migration', () => {
  it('is registered in the in-memory tool registry with the edit capability', () => {
    const server = new GodotServer({ registerSignalHandlers: false });
    const registry = (server as any).toolRegistry;
    const definition = registry.tools.get('rename_file');
    expect(definition).toBeDefined();
    expect(definition.capability).toBe('edit');
    expect(definition.description).toBe('Rename or move a file within the project');
    expect(definition.inputSchema).toEqual({
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Godot project path' },
        filePath: {
          type: 'string',
          description: 'Current file path (relative to project)',
        },
        newPath: {
          type: 'string',
          description: 'New file path (relative to project)',
        },
      },
      required: ['projectPath', 'filePath', 'newPath'],
    });
  });

  it('advertises rename_file exactly once in the MCP tools list', async () => {
    const server = new GodotServer({ registerSignalHandlers: false });
    const response = await requestHandler(server, 'tools/list')(
      { method: 'tools/list', params: {} },
      {},
    );
    const names = response.tools.map((tool: { name: string }) => tool.name);
    expect(names.filter((name: string) => name === 'rename_file')).toHaveLength(1);
  });

  it('dispatches rename_file through the real MCP tools/call boundary, moves the file on disk, and creates the destination directory', async () => {
    const { root } = makeProject();
    const server = new GodotServer({
      pathPolicy: new PathPolicy([root]),
      registerSignalHandlers: false,
    });
    const relPath = 'scripts/old.gd';
    const relDest = 'subdir/renamed.gd';
    const source = join(root, relPath);
    const dest = join(root, relDest);
    mkdirSync(join(root, 'scripts'), { recursive: true });
    writeFileSync(source, 'extends Node\n', 'utf8');
    expect(existsSync(source)).toBe(true);
    expect(existsSync(dirname(dest))).toBe(false);

    const response = await toolsCall(server, 'rename_file', {
      projectPath: root,
      filePath: relPath,
      newPath: relDest,
    });
    expect(response.isError).not.toBe(true);
    // Preserve the existing exact success wording (`Renamed ${filePath} → ${newPath}`).
    expect(response.content).toEqual([
      { type: 'text', text: `Renamed ${relPath} \u2192 ${relDest}` },
    ]);
    expect(existsSync(source)).toBe(false);
    expect(existsSync(dest)).toBe(true);
    expect(readFileSync(dest, 'utf8')).toBe('extends Node\n');
  });

  it('returns a structured error envelope when filePath is outside the project root', async () => {
    const { root } = makeProject();
    const server = new GodotServer({
      pathPolicy: new PathPolicy([root]),
      registerSignalHandlers: false,
    });

    const response = await toolsCall(server, 'rename_file', {
      projectPath: root,
      filePath: '../escape.txt',
      newPath: 'in-project.txt',
    });
    expect(response.isError).toBe(true);
    const text = response.content?.[0]?.text ?? '';
    expect(text).toMatch(/path policy|outside|invalid/i);
  });

  it('returns a structured error envelope when newPath is outside the project root', async () => {
    const { root } = makeProject();
    const server = new GodotServer({
      pathPolicy: new PathPolicy([root]),
      registerSignalHandlers: false,
    });

    const response = await toolsCall(server, 'rename_file', {
      projectPath: root,
      filePath: 'in-project.txt',
      newPath: '../escape.txt',
    });
    expect(response.isError).toBe(true);
    const text = response.content?.[0]?.text ?? '';
    expect(text).toMatch(/path policy|outside|invalid/i);
  });

  it('returns a structured error envelope when projectPath is outside the configured allowed roots', async () => {
    const { root } = makeProject();
    const server = new GodotServer({
      pathPolicy: new PathPolicy([root]),
      registerSignalHandlers: false,
    });

    const response = await toolsCall(server, 'rename_file', {
      projectPath: 'C:\\Users\\Public\\evil-project',
      filePath: 'project.godot',
      newPath: 'other.godot',
    });
    expect(response.isError).toBe(true);
    const text = response.content?.[0]?.text ?? '';
    expect(text).toMatch(/allowed roots|project path/i);
  });

  it('does not have a legacy case statement in the dispatch switch', async () => {
    const source = (await import('node:fs')).readFileSync(
      new URL('../src/server.ts', import.meta.url),
      'utf8',
    );
    expect(source).not.toContain(`case 'rename_file':`);
  });

  it('does not advertise a duplicate rename_file flat-list block in the tools list', async () => {
    const source = (await import('node:fs')).readFileSync(
      new URL('../src/server.ts', import.meta.url),
      'utf8',
    );
    // The legacy flat-list block lives inside `ListToolsRequestSchema` setup
    // and looks like `{ name: 'rename_file', ... }`. After registry
    // migration it should appear at most once (in the merged `tools` array
    // assembled from the registry).
    const matches = source.match(/name:\s*'rename_file'/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(1);
  });
});