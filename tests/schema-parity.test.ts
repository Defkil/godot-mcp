import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GodotServer } from '../src/server.js';
import { PathPolicy } from '../src/security/path-policy.js';

const tempRoots: string[] = [];

function requestHandler(server: GodotServer, method: 'tools/list' | 'tools/call') {
  const handlers = (server as any).server._requestHandlers as Map<string, Function>;
  const handler = handlers.get(method);
  if (!handler) throw new Error(`Missing MCP request handler: ${method}`);
  return handler;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('MCP schema and dispatch parity', () => {
  it('advertises all 157 unique legacy contracts and the migrated tool exactly once', async () => {
    const server = new GodotServer({ registerSignalHandlers: false });
    const response = await requestHandler(server, 'tools/list')(
      { method: 'tools/list', params: {} },
      {},
    );
    const names = response.tools.map((tool: { name: string }) => tool.name);

    expect(names).toHaveLength(157);
    expect(new Set(names).size).toBe(157);
    expect(names.filter((name: string) => name === 'list_project_files')).toHaveLength(1);
    expect((server as any).toolRegistry.definitions().map((tool: { name: string }) => tool.name))
      .toEqual(['list_project_files']);
  });

  it('executes the migrated handler through the real MCP call boundary', async () => {
    const root = mkdtempSync(join(tmpdir(), 'godot-mcp-schema-parity-'));
    tempRoots.push(root);
    writeFileSync(join(root, 'project.godot'), '[application]\n', 'utf8');
    writeFileSync(join(root, 'player.gd'), 'extends Node\n', 'utf8');
    const server = new GodotServer({
      pathPolicy: new PathPolicy([root]),
      registerSignalHandlers: false,
    });

    const response = await requestHandler(server, 'tools/call')(
      {
        method: 'tools/call',
        params: {
          name: 'list_project_files',
          arguments: { projectPath: root, extensions: ['.gd'] },
        },
      },
      {},
    );

    expect(response.isError).not.toBe(true);
    expect(JSON.parse(response.content[0].text)).toEqual({
      count: 1,
      files: ['player.gd'],
      truncated: false,
    });
  });
});
