/**
 * Wire-level regression for the `list_projects` tool-registry migration.
 *
 * Mirrors `tests/registry-migration-create-directory.test.ts`. The tool is
 * registered in `toolRegistry` with `inspect` capability, its legacy
 * flat-list block and `case 'list_projects':` switch arm are removed, its
 * schema is preserved verbatim, and every dispatch + filesystem walk +
 * PathPolicy denial contract is enforced through the real MCP `tools/call`
 * request handler.
 *
 * The fixture is a temporary parent directory containing one or more
 * `project.godot` children under the OS temp directory, removed in
 * `afterEach`. The test stubs nothing relevant to the gate.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GodotServer } from '../src/server.js';
import { PathPolicy } from '../src/security/path-policy.js';

const tempRoots: string[] = [];

function makeParent(): { root: string; childA: string; childB: string; loose: string } {
  const root = mkdtempSync(join(tmpdir(), 'godot-mcp-list-projects-registry-'));
  tempRoots.push(root);
  const childA = join(root, 'ProjectA');
  const childB = join(root, 'ProjectB');
  const loose = join(root, 'Loose');
  mkdirSync(childA);
  mkdirSync(childB);
  mkdirSync(loose);
  writeFileSync(
    join(childA, 'project.godot'),
    'config_version=5\n\n[application]\nconfig/name="ProjectA"\nfeatures=PackedStringArray("4.7")\n',
    'utf8',
  );
  writeFileSync(
    join(childB, 'project.godot'),
    'config_version=5\n\n[application]\nconfig/name="ProjectB"\nfeatures=PackedStringArray("4.7")\n',
    'utf8',
  );
  return { root, childA, childB, loose };
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

describe('list_projects registry migration', () => {
  it('is registered in the in-memory tool registry with the inspect capability', () => {
    const server = new GodotServer({ registerSignalHandlers: false });
    const registry = (server as any).toolRegistry;
    const definition = registry.tools.get('list_projects');
    expect(definition).toBeDefined();
    expect(definition.capability).toBe('inspect');
    expect(definition.description).toBe('List Godot projects in a directory');
    expect(definition.inputSchema).toEqual({
      type: 'object',
      properties: {
        directory: {
          type: 'string',
          description: 'Directory to search for Godot projects',
        },
        recursive: {
          type: 'boolean',
          description: 'Whether to search recursively (default: false)',
        },
      },
      required: ['directory'],
    });
  });

  it('advertises list_projects exactly once in the MCP tools list', async () => {
    const server = new GodotServer({ registerSignalHandlers: false });
    const response = await requestHandler(server, 'tools/list')(
      { method: 'tools/list', params: {} },
      {},
    );
    const names = response.tools.map((tool: { name: string }) => tool.name);
    expect(names.filter((name: string) => name === 'list_projects')).toHaveLength(1);
  });

  it('dispatches list_projects through the real MCP tools/call boundary and returns found projects', async () => {
    const { root, childA, childB } = makeParent();
    const server = new GodotServer({
      pathPolicy: new PathPolicy([root]),
      registerSignalHandlers: false,
    });

    const response = await toolsCall(server, 'list_projects', {
      directory: root,
      recursive: false,
    });
    expect(response.isError).not.toBe(true);
    expect(Array.isArray(response.content)).toBe(true);
    const parsed = JSON.parse(response.content[0].text);
    const foundNames = parsed.map((p: { name: string }) => p.name).sort();
    expect(foundNames).toEqual(['ProjectA', 'ProjectB']);
    const foundPaths = parsed.map((p: { path: string }) => p.path).sort();
    expect(foundPaths).toEqual([childA, childB].sort());
  });

  it('returns an empty result when no project.godot children are present', async () => {
    const root = mkdtempSync(join(tmpdir(), 'godot-mcp-list-projects-empty-'));
    tempRoots.push(root);
    const server = new GodotServer({
      pathPolicy: new PathPolicy([root]),
      registerSignalHandlers: false,
    });

    const response = await toolsCall(server, 'list_projects', {
      directory: root,
      recursive: false,
    });
    expect(response.isError).not.toBe(true);
    const parsed = JSON.parse(response.content[0].text);
    expect(parsed).toEqual([]);
  });

  it('returns a structured error envelope when directory is outside the configured allowed roots', async () => {
    const { root } = makeParent();
    const server = new GodotServer({
      pathPolicy: new PathPolicy([root]),
      registerSignalHandlers: false,
    });

    const response = await toolsCall(server, 'list_projects', {
      directory: 'C:\\Users\\Public\\evil-directory',
    });
    expect(response.isError).toBe(true);
    const text = response.content?.[0]?.text ?? '';
    expect(text).toMatch(/allowed roots|directory/i);
  });

  it('returns a structured error envelope when directory is missing', async () => {
    const { root } = makeParent();
    const server = new GodotServer({
      pathPolicy: new PathPolicy([root]),
      registerSignalHandlers: false,
    });

    const response = await toolsCall(server, 'list_projects', {});
    expect(response.isError).toBe(true);
    const text = response.content?.[0]?.text ?? '';
    expect(text).toMatch(/directory is required/i);
  });

  it('does not have a legacy case statement in the dispatch switch', async () => {
    const source = (await import('node:fs')).readFileSync(
      new URL('../src/server.ts', import.meta.url),
      'utf8',
    );
    expect(source).not.toContain(`case 'list_projects':`);
  });

  it('does not advertise a duplicate list_projects flat-list block in the tools list', async () => {
    const source = (await import('node:fs')).readFileSync(
      new URL('../src/server.ts', import.meta.url),
      'utf8',
    );
    // The legacy flat-list block lives inside `ListToolsRequestSchema` setup
    // and looks like `{ name: 'list_projects', ... }`. After registry migration
    // it should appear at most once (in the merged `tools` array assembled
    // from the registry).
    const matches = source.match(/name:\s*'list_projects'/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(1);
  });
});