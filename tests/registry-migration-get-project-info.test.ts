import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GodotServer } from '../src/server.js';
import { PathPolicy } from '../src/security/path-policy.js';

const tempRoots: string[] = [];

function makeProject(): { root: string; projectFile: string } {
  const root = mkdtempSync(join(tmpdir(), 'godot-mcp-get-project-info-'));
  tempRoots.push(root);
  const projectFile = join(root, 'project.godot');
  writeFileSync(projectFile, '[application]\nconfig/name="GetProjectInfoTest"\n', 'utf8');
  writeFileSync(join(root, 'player.gd'), 'extends Node\n', 'utf8');
  writeFileSync(join(root, 'level.tscn'), '[gd_scene]\n', 'utf8');
  return { root, projectFile };
}

function requestHandler(server: GodotServer, method: 'tools/list' | 'tools/call') {
  const handlers = (server as any).server._requestHandlers as Map<string, Function>;
  const handler = handlers.get(method);
  if (!handler) throw new Error(`Missing MCP request handler: ${method}`);
  return handler;
}

async function toolsCall(server: GodotServer, name: string, args: Record<string, unknown> | null) {
  return requestHandler(server, 'tools/call')(
    { method: 'tools/call', params: { name, arguments: args } },
    {},
  );
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('get_project_info registry migration', () => {
  it('is registered in the in-memory tool registry with the inspect capability', () => {
    const server = new GodotServer({ registerSignalHandlers: false });
    const registry = (server as any).toolRegistry;
    expect(registry.has('get_project_info')).toBe(true);
    expect(registry.capabilityFor('get_project_info')).toBe('inspect');
  });

  it('advertises a snake_case schema in the real MCP tools/list with the same projectPath-only contract', async () => {
    const server = new GodotServer({ registerSignalHandlers: false });
    const response = await requestHandler(server, 'tools/list')(
      { method: 'tools/list', params: {} },
      {},
    );
    const tools = response.tools as Array<{
      name: string;
      inputSchema: { required?: string[]; properties?: Record<string, unknown> };
    }>;
    const tool = tools.find(entry => entry.name === 'get_project_info');
    expect(tool).toBeDefined();
    expect(tool?.inputSchema.required).toEqual(['projectPath']);
    expect(tool?.inputSchema.properties).toHaveProperty('projectPath');
  });

  it('routes tools/call through the registry dispatch (calls handleGetProjectInfo exactly once with the supplied args)', async () => {
    const { root } = makeProject();
    const server = new GodotServer({
      pathPolicy: new PathPolicy([root]),
      registerSignalHandlers: false,
    });
    // Stub the private handler so the registry dispatch path is exercised
    // without depending on a real Godot binary. The stub records the
    // argument shape and returns a deterministic success envelope that
    // matches the real handler's documented response contract.
    const handlerSpy = vi.fn(async (args: any) => ({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            name: 'GetProjectInfoTest',
            path: args.projectPath,
            godotVersion: '4.7-stable (mocked)',
            isDotnet: false,
            structure: { scenes: 1, scripts: 1, assets: 0, other: 0 },
          }),
        },
      ],
    }));
    (server as any).handleGetProjectInfo = handlerSpy;

    const response = await toolsCall(server, 'get_project_info', { projectPath: root });
    expect(response.isError).not.toBe(true);
    expect(handlerSpy).toHaveBeenCalledTimes(1);
    expect(handlerSpy.mock.calls[0][0].projectPath).toBe(root);
    const body = JSON.parse(response.content[0].text);
    expect(body.name).toBe('GetProjectInfoTest');
    expect(body.path).toBe(root);
    expect(body.godotVersion).toBe('4.7-stable (mocked)');
  });

  it('surfaces a projectPath-outside-allowed-roots error through the registry dispatch path', async () => {
    const { root } = makeProject();
    const server = new GodotServer({
      pathPolicy: new PathPolicy([root]),
      registerSignalHandlers: false,
    });
    // An outside-roots sibling that the configured PathPolicy does not allow.
    const outside = join(root, '..', 'outside-project-info-' + Date.now());
    rmSync(outside, { recursive: true, force: true });
    const response = await toolsCall(server, 'get_project_info', { projectPath: outside });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/outside the (configured )?allowed roots/);
    expect(existsSync(outside)).toBe(false);
  });

  it('no longer appears in the legacy switch dispatch (case statement removed)', () => {
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const { fileURLToPath } = require('node:url') as typeof import('node:url');
    const { dirname, join } = require('node:path') as typeof import('node:path');
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'server.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/case 'get_project_info':/);
  });
});
