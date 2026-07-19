/**
 * Wire-level regression for the `create_directory` tool-registry migration.
 *
 * Mirrors `tests/registry-migration-delete-file.test.ts`. The tool is
 * registered in `toolRegistry` with `edit` capability, its legacy
 * flat-list block and `case 'create_directory':` switch arm are removed,
 * its schema is preserved verbatim, and every dispatch + filesystem
 * creation + PathPolicy denial contract is enforced through the real
 * MCP `tools/call` request handler.
 *
 * The fixture is a temporary Godot project under the OS temp
 * directory, removed in `afterEach`. The test stubs nothing relevant
 * to the gate.
 */

import {
  existsSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GodotServer } from '../src/server.js';
import { PathPolicy } from '../src/security/path-policy.js';

const tempRoots: string[] = [];

function makeProject(): { root: string; projectFile: string } {
  const root = mkdtempSync(join(tmpdir(), 'godot-mcp-create-directory-registry-'));
  tempRoots.push(root);
  const projectFile = join(root, 'project.godot');
  writeFileSync(
    projectFile,
    'config_version=5\n\n[application]\nconfig/name="CreateDirectoryRegistryTest"\nfeatures=PackedStringArray("4.7")\n',
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

describe('create_directory registry migration', () => {
  it('is registered in the in-memory tool registry with the edit capability', () => {
    const server = new GodotServer({ registerSignalHandlers: false });
    const registry = (server as any).toolRegistry;
    const definition = registry.tools.get('create_directory');
    expect(definition).toBeDefined();
    expect(definition.capability).toBe('edit');
    expect(definition.description).toBe(
      'Create a directory inside a Godot project',
    );
    expect(definition.inputSchema).toEqual({
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Godot project path' },
        directoryPath: { type: 'string', description: 'Directory path relative to project root' },
      },
      required: ['projectPath', 'directoryPath'],
    });
  });

  it('advertises create_directory exactly once in the MCP tools list', async () => {
    const server = new GodotServer({ registerSignalHandlers: false });
    const response = await requestHandler(server, 'tools/list')(
      { method: 'tools/list', params: {} },
      {},
    );
    const names = response.tools.map((tool: { name: string }) => tool.name);
    expect(names.filter((name: string) => name === 'create_directory')).toHaveLength(1);
  });

  it('dispatches create_directory through the real MCP tools/call boundary and creates the directory on disk', async () => {
    const { root } = makeProject();
    const server = new GodotServer({
      pathPolicy: new PathPolicy([root]),
      registerSignalHandlers: false,
    });
    const relPath = 'scenes/levels';
    const targetDir = join(root, relPath);
    expect(existsSync(targetDir)).toBe(false);

    const response = await toolsCall(server, 'create_directory', {
      projectPath: root,
      directoryPath: relPath,
    });
    expect(response.isError).not.toBe(true);
    // Preserve the existing exact success wording (`Directory created: ${args.directoryPath}`).
    expect(response.content).toEqual([
      { type: 'text', text: `Directory created: ${relPath}` },
    ]);
    expect(existsSync(targetDir)).toBe(true);
    expect(statSync(targetDir).isDirectory()).toBe(true);
  });

  it('returns a structured error envelope when directoryPath is outside the project root', async () => {
    const { root } = makeProject();
    const server = new GodotServer({
      pathPolicy: new PathPolicy([root]),
      registerSignalHandlers: false,
    });

    const response = await toolsCall(server, 'create_directory', {
      projectPath: root,
      directoryPath: '../escape',
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

    const response = await toolsCall(server, 'create_directory', {
      projectPath: 'C:\\Users\\Public\\evil-project',
      directoryPath: 'scenes/levels',
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
    expect(source).not.toContain(`case 'create_directory':`);
  });

  it('does not advertise a duplicate create_directory flat-list block in the tools list', async () => {
    const source = (await import('node:fs')).readFileSync(
      new URL('../src/server.ts', import.meta.url),
      'utf8',
    );
    // The legacy flat-list block lives inside `ListToolsRequestSchema` setup
    // and looks like `{ name: 'create_directory', ... }`. After registry migration
    // it should appear at most once (in the merged `tools` array assembled
    // from the registry).
    const matches = source.match(/name:\s*'create_directory'/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(1);
  });
});