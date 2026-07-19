import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  it('advertises all 157 legacy contracts plus the migrated/registered tools exactly once', async () => {
    const server = new GodotServer({ registerSignalHandlers: false });
    const response = await requestHandler(server, 'tools/list')(
      { method: 'tools/list', params: {} },
      {},
    );
    const names = response.tools.map((tool: { name: string }) => tool.name);

    // 148 legacy contracts + the migrated/registered tools: modify_project_settings,
    // list_project_files, launch_editor, read_scene, modify_scene_node,
    // remove_scene_node, classdb_inspect, get_project_info, read_project_settings,
    // read_file.
    expect(names).toHaveLength(158);
    expect(new Set(names).size).toBe(158);
    expect(names.filter((name: string) => name === 'list_project_files')).toHaveLength(1);
    expect(names.filter((name: string) => name === 'modify_project_settings')).toHaveLength(1);
    expect(names.filter((name: string) => name === 'launch_editor')).toHaveLength(1);
    expect(names.filter((name: string) => name === 'read_scene')).toHaveLength(1);
    expect(names.filter((name: string) => name === 'modify_scene_node')).toHaveLength(1);
    expect(names.filter((name: string) => name === 'remove_scene_node')).toHaveLength(1);
    expect(names.filter((name: string) => name === 'classdb_inspect')).toHaveLength(1);
    expect(names.filter((name: string) => name === 'get_project_info')).toHaveLength(1);
    expect(names.filter((name: string) => name === 'read_project_settings')).toHaveLength(1);
    expect(names.filter((name: string) => name === 'read_file')).toHaveLength(1);
    expect((server as any).toolRegistry.definitions().map((tool: { name: string }) => tool.name))
      .toEqual([
        'modify_project_settings',
        'list_project_files',
        'launch_editor',
        'read_scene',
        'modify_scene_node',
        'remove_scene_node',
        'classdb_inspect',
        'get_project_info',
        'read_project_settings',
        'read_file',
      ]);
    expect((server as any).toolRegistry.capabilityFor('modify_project_settings')).toBe('edit');
    expect((server as any).toolRegistry.capabilityFor('modify_scene_node')).toBe('edit');
    expect((server as any).toolRegistry.capabilityFor('remove_scene_node')).toBe('edit');
    expect((server as any).toolRegistry.capabilityFor('read_scene')).toBe('inspect');
    expect((server as any).toolRegistry.capabilityFor('launch_editor')).toBe('runtime');
    expect((server as any).toolRegistry.capabilityFor('classdb_inspect')).toBe('inspect');
    expect((server as any).toolRegistry.capabilityFor('get_project_info')).toBe('inspect');
    expect((server as any).toolRegistry.capabilityFor('read_project_settings')).toBe('inspect');
    expect((server as any).toolRegistry.capabilityFor('read_file')).toBe('inspect');
  });

  it('executes the migrated project-settings mutation through the real MCP call boundary', async () => {
    const root = mkdtempSync(join(tmpdir(), 'godot-mcp-settings-parity-'));
    tempRoots.push(root);
    const projectFile = join(root, 'project.godot');
    writeFileSync(projectFile, 'config_version=5\n\n[application]\nconfig/name="Before"\n', 'utf8');
    const server = new GodotServer({
      pathPolicy: new PathPolicy([root]),
      registerSignalHandlers: false,
    });

    const response = await requestHandler(server, 'tools/call')(
      {
        method: 'tools/call',
        params: {
          name: 'modify_project_settings',
          arguments: {
            projectPath: root,
            section: 'application',
            key: 'config/name',
            value: '"After"',
          },
        },
      },
      {},
    );

    expect(response.isError).not.toBe(true);
    expect(response.content[0].text).toContain('Setting updated: [application] config/name="After"');
    expect(readFileSync(projectFile, 'utf8')).toContain('config/name="After"');
  });

  it('executes the migrated file-list handler through the real MCP call boundary', async () => {
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
