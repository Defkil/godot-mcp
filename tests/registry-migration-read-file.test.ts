/**
 * Wire-level regression for the `read_file` tool-registry migration.
 *
 * Mirrors `tests/registry-migration-read-project-settings.test.ts`. The
 * tool is registered in `toolRegistry` with `inspect` capability, its
 * legacy flat-list block and `case 'read_file':` switch arm are removed,
 * its schema is preserved verbatim, and every dispatch + readback +
 * PathPolicy denial contract is enforced through the real MCP
 * `tools/call` request handler.
 *
 * The fixture is a temporary Godot project under the OS temp directory,
 * removed in `afterEach`. The test stubs nothing relevant to the gate.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GodotServer } from '../src/server.js';
import { PathPolicy } from '../src/security/path-policy.js';

const tempRoots: string[] = [];

function makeProject(): { root: string; projectFile: string } {
  const root = mkdtempSync(join(tmpdir(), 'godot-mcp-read-file-registry-'));
  tempRoots.push(root);
  const projectFile = join(root, 'project.godot');
  writeFileSync(
    projectFile,
    'config_version=5\n\n[application]\nconfig/name="ReadFileRegistryTest"\nfeatures=PackedStringArray("4.7")\n',
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

describe('read_file registry migration', () => {
  it('is registered in the in-memory tool registry with the inspect capability', () => {
    const server = new GodotServer({ registerSignalHandlers: false });
    const registry = (server as any).toolRegistry;
    const definition = registry.tools.get('read_file');
    expect(definition).toBeDefined();
    expect(definition.capability).toBe('inspect');
    expect(definition.description).toBe('Read a text file from a Godot project');
    expect(definition.inputSchema).toEqual({
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Godot project path' },
        filePath: { type: 'string', description: 'File path relative to project root' },
      },
      required: ['projectPath', 'filePath'],
    });
  });

  it('advertises read_file exactly once in the MCP tools list', async () => {
    const server = new GodotServer({ registerSignalHandlers: false });
    const response = await requestHandler(server, 'tools/list')(
      { method: 'tools/list', params: {} },
      {},
    );
    const names = response.tools.map((tool: { name: string }) => tool.name);
    expect(names.filter((name: string) => name === 'read_file')).toHaveLength(1);
  });

  it('dispatches read_file through the real MCP tools/call boundary and returns the file content', async () => {
    const { root } = makeProject();
    const server = new GodotServer({
      pathPolicy: new PathPolicy([root]),
      registerSignalHandlers: false,
    });
    const target = join(root, 'script.gd');
    const body = 'extends Node\n\nfunc hello() -> void:\n    print("hi")\n';
    writeFileSync(target, body, 'utf8');

    const response = await toolsCall(server, 'read_file', {
      projectPath: root,
      filePath: 'script.gd',
    });
    expect(response.isError).not.toBe(true);
    expect(response.content).toEqual([{ type: 'text', text: body }]);
  });

  it('returns a structured error envelope when filePath is outside the project root', async () => {
    const { root } = makeProject();
    const server = new GodotServer({
      pathPolicy: new PathPolicy([root]),
      registerSignalHandlers: false,
    });

    const response = await toolsCall(server, 'read_file', {
      projectPath: root,
      filePath: '../escape.txt',
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

    const response = await toolsCall(server, 'read_file', {
      projectPath: 'C:\\Users\\Public\\evil-project',
      filePath: 'project.godot',
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
    expect(source).not.toContain(`case 'read_file':`);
  });

  it('does not advertise a duplicate read_file flat-list block in the tools list', async () => {
    const source = (await import('node:fs')).readFileSync(
      new URL('../src/server.ts', import.meta.url),
      'utf8',
    );
    // The legacy flat-list block lives inside `ListToolsRequestSchema` setup
    // and looks like `{ name: 'read_file', ... }`. After registry migration
    // it should appear at most once (in the merged `tools` array assembled
    // from the registry).
    const matches = source.match(/name:\s*'read_file'/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(1);
  });
});
