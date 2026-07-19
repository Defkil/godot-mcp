/**
 * Wire-level regression for the `write_file` tool-registry migration.
 *
 * Mirrors `tests/registry-migration-read-file.test.ts`. The tool is
 * registered in `toolRegistry` with `edit` capability, its legacy
 * flat-list block and `case 'write_file':` switch arm are removed,
 * its schema is preserved verbatim, and every dispatch + writeback +
 * PathPolicy denial contract is enforced through the real MCP
 * `tools/call` request handler.
 *
 * The fixture is a temporary Godot project under the OS temp
 * directory, removed in `afterEach`. The test stubs nothing
 * relevant to the gate.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GodotServer } from '../src/server.js';
import { PathPolicy } from '../src/security/path-policy.js';

const tempRoots: string[] = [];

function makeProject(): { root: string; projectFile: string } {
  const root = mkdtempSync(join(tmpdir(), 'godot-mcp-write-file-registry-'));
  tempRoots.push(root);
  const projectFile = join(root, 'project.godot');
  writeFileSync(
    projectFile,
    'config_version=5\n\n[application]\nconfig/name="WriteFileRegistryTest"\nfeatures=PackedStringArray("4.7")\n',
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

describe('write_file registry migration', () => {
  it('is registered in the in-memory tool registry with the edit capability', () => {
    const server = new GodotServer({ registerSignalHandlers: false });
    const registry = (server as any).toolRegistry;
    const definition = registry.tools.get('write_file');
    expect(definition).toBeDefined();
    expect(definition.capability).toBe('edit');
    expect(definition.description).toBe(
      'Create or overwrite a text file in a Godot project',
    );
    expect(definition.inputSchema).toEqual({
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Godot project path' },
        filePath: { type: 'string', description: 'File path relative to project root' },
        content: { type: 'string', description: 'File content to write' },
      },
      required: ['projectPath', 'filePath', 'content'],
    });
  });

  it('advertises write_file exactly once in the MCP tools list', async () => {
    const server = new GodotServer({ registerSignalHandlers: false });
    const response = await requestHandler(server, 'tools/list')(
      { method: 'tools/list', params: {} },
      {},
    );
    const names = response.tools.map((tool: { name: string }) => tool.name);
    expect(names.filter((name: string) => name === 'write_file')).toHaveLength(1);
  });

  it('dispatches write_file through the real MCP tools/call boundary and writes the file to disk', async () => {
    const { root } = makeProject();
    const server = new GodotServer({
      pathPolicy: new PathPolicy([root]),
      registerSignalHandlers: false,
    });
    const relPath = 'nested/sub/script.gd';
    const body = 'extends Node\n\nfunc hello() -> void:\n    print("hi")\n';

    const response = await toolsCall(server, 'write_file', {
      projectPath: root,
      filePath: relPath,
      content: body,
    });
    expect(response.isError).not.toBe(true);
    // Preserve the existing exact success wording (`File written: ${args.filePath}`).
    expect(response.content).toEqual([
      { type: 'text', text: `File written: ${relPath}` },
    ]);
    expect(readFileSync(join(root, relPath), 'utf8')).toBe(body);
  });

  it('returns a structured error envelope when filePath is outside the project root', async () => {
    const { root } = makeProject();
    const server = new GodotServer({
      pathPolicy: new PathPolicy([root]),
      registerSignalHandlers: false,
    });

    const response = await toolsCall(server, 'write_file', {
      projectPath: root,
      filePath: '../escape.txt',
      content: 'evil',
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

    const response = await toolsCall(server, 'write_file', {
      projectPath: 'C:\\Users\\Public\\evil-project',
      filePath: 'project.godot',
      content: 'evil',
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
    expect(source).not.toContain(`case 'write_file':`);
  });

  it('does not advertise a duplicate write_file flat-list block in the tools list', async () => {
    const source = (await import('node:fs')).readFileSync(
      new URL('../src/server.ts', import.meta.url),
      'utf8',
    );
    // The legacy flat-list block lives inside `ListToolsRequestSchema` setup
    // and looks like `{ name: 'write_file', ... }`. After registry migration
    // it should appear at most once (in the merged `tools` array assembled
    // from the registry).
    const matches = source.match(/name:\s*'write_file'/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(1);
  });
});
