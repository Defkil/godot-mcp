import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GodotServer } from '../src/server.js';
import { PathPolicy } from '../src/security/path-policy.js';

const tempRoots: string[] = [];

function makeProjectWithTwoSections(): { root: string; projectFile: string } {
  const root = mkdtempSync(join(tmpdir(), 'godot-mcp-read-project-settings-'));
  tempRoots.push(root);
  const projectFile = join(root, 'project.godot');
  // Two sections + multiple key/value pairs to prove the structured JSON
  // contract is preserved verbatim, including string-typed values.
  const body = [
    '; Engine configuration file.',
    '; It is highly recommended to backup the file before making changes.',
    '',
    'config_version=5',
    '',
    '[application]',
    '',
    'config/name="ReadProjectSettingsTest"',
    'config/features=PackedStringArray("4.7", "Forward Plus")',
    'config/icon="res://icon.svg"',
    '',
    '[rendering]',
    '',
    'renderer/rendering_method="forward_plus"',
    'renderer/rendering_method.mobile="mobile"',
    '',
  ].join('\n');
  writeFileSync(projectFile, body, 'utf8');
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

describe('read_project_settings registry migration', () => {
  it('is registered in the in-memory tool registry with the inspect capability', () => {
    const server = new GodotServer({ registerSignalHandlers: false });
    const registry = (server as any).toolRegistry;
    expect(registry.has('read_project_settings')).toBe(true);
    expect(registry.capabilityFor('read_project_settings')).toBe('inspect');
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
    const tool = tools.find(entry => entry.name === 'read_project_settings');
    expect(tool).toBeDefined();
    expect(tool?.inputSchema.required).toEqual(['projectPath']);
    expect(tool?.inputSchema.properties).toHaveProperty('projectPath');
    // No other property is added by the migration — the legacy contract is
    // the projectPath-only contract.
    expect(Object.keys(tool?.inputSchema.properties ?? {})).toEqual(['projectPath']);
  });

  it('routes tools/call through the registry dispatch (calls handleReadProjectSettings exactly once with the supplied args)', async () => {
    const { root } = makeProjectWithTwoSections();
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
            application: { 'config/name': `"ReadProjectSettingsTest"` },
            rendering: { 'renderer/rendering_method': '"forward_plus"' },
            _projectPath: args.projectPath,
          }),
        },
      ],
    }));
    (server as any).handleReadProjectSettings = handlerSpy;

    const response = await toolsCall(server, 'read_project_settings', { projectPath: root });
    expect(response.isError).not.toBe(true);
    expect(handlerSpy).toHaveBeenCalledTimes(1);
    expect(handlerSpy.mock.calls[0][0].projectPath).toBe(root);
    const body = JSON.parse(response.content[0].text);
    expect(body._projectPath).toBe(root);
    expect(body.application['config/name']).toBe('"ReadProjectSettingsTest"');
  });

  it('reads a real project.godot with two sections through the real MCP tools/call boundary and preserves the structured JSON contract with string-typed values', async () => {
    const { root, projectFile } = makeProjectWithTwoSections();
    const server = new GodotServer({
      pathPolicy: new PathPolicy([root]),
      registerSignalHandlers: false,
    });

    const response = await toolsCall(server, 'read_project_settings', { projectPath: root });

    expect(response.isError).not.toBe(true);
    const body = JSON.parse(response.content[0].text);
    // Two sections are surfaced as two top-level keys, each with their
    // key/value pairs preserved verbatim as strings (no JSON coercion of
    // numbers / booleans / array literals).
    expect(Object.keys(body).sort()).toEqual(['application', 'rendering']);
    expect(body.application).toEqual({
      'config/name': '"ReadProjectSettingsTest"',
      'config/features': 'PackedStringArray("4.7", "Forward Plus")',
      'config/icon': '"res://icon.svg"',
    });
    expect(body.rendering).toEqual({
      'renderer/rendering_method': '"forward_plus"',
      'renderer/rendering_method.mobile': '"mobile"',
    });
    // The file is unchanged on disk — read_project_settings is read-only.
    expect(readFileSync(projectFile, 'utf8')).toContain('config/name="ReadProjectSettingsTest"');
  });

  it('surfaces a projectPath-outside-allowed-roots error through the registry dispatch path before any filesystem reach', async () => {
    const { root } = makeProjectWithTwoSections();
    const server = new GodotServer({
      pathPolicy: new PathPolicy([root]),
      registerSignalHandlers: false,
    });
    // An outside-roots sibling that the configured PathPolicy does not allow.
    const outside = join(root, '..', 'outside-read-project-settings-' + Date.now());
    rmSync(outside, { recursive: true, force: true });
    const response = await toolsCall(server, 'read_project_settings', { projectPath: outside });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/outside the (configured )?allowed roots/);
    expect(existsSync(outside)).toBe(false);
  });

  it('no longer appears in the legacy switch dispatch (case statement removed)', () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'server.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/case 'read_project_settings':/);
  });

  it('advertises read_project_settings between game_wait and game_connect_signal in the real MCP tools/list', async () => {
    const server = new GodotServer({ registerSignalHandlers: false });
    const response = await requestHandler(server, 'tools/list')(
      { method: 'tools/list', params: {} },
      {},
    );
    const names = (response.tools as Array<{ name: string }>).map(tool => tool.name);
    const idxGameWait = names.indexOf('game_wait');
    const idxRead = names.indexOf('read_project_settings');
    const idxConnect = names.indexOf('game_connect_signal');
    expect(idxGameWait).toBeGreaterThanOrEqual(0);
    expect(idxRead).toBeGreaterThanOrEqual(0);
    expect(idxConnect).toBeGreaterThanOrEqual(0);
    // Position preserved by the registry splice: the migrated
    // read_project_settings now sits inside the registry defs block, which
    // is inserted between the legacy game_* cluster and the post-splice
    // legacy cluster (game_connect_signal, ...). Concretely, it must come
    // after game_wait and at or before game_connect_signal (the registry
    // splice happens immediately before game_connect_signal).
    expect(idxRead).toBeGreaterThan(idxGameWait);
    expect(idxRead).toBeLessThan(idxConnect);
  });
});
