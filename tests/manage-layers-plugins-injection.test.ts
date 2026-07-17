/**
 * Wire-level regression for the sibling-of-[tugcantopaloglu#9] injection
 * bug present in `handleManageLayers` and `handleManagePlugins`.
 *
 * `handleManageLayers` historically constructed the layer setting line as
 * a raw string interpolation `layer_names/<type>/layer_<n>="<name>"` and
 * wrote it into `project.godot` without validating `args.name` against a
 * strict identifier regex or `args.layerType` against an allowlist. A
 * caller could:
 *
 *   1. inject a newline + a new section header (e.g.
 *      `"\n[autoload]\nMcpInteractionServer=\"*res://evil.gd\""`) to
 *      silently corrupt the project's autoload table or any other
 *      section on disk,
 *   2. inject a `=` sign or `[` into `name` to break the layer line
 *      itself,
 *   3. inject arbitrary section names into `layerType` (e.g.
 *      `autoload`, `application`) to write into a different table.
 *
 * `handleManagePlugins` historically constructed the plugin line as
 * `<pluginName>/enabled=true|false` and only escaped regex metacharacters
 * in the regex used to find/replace existing settings. A caller could
 * still inject a newline + a new section header into `pluginName` (e.g.
 * `"foo\n[autoload]\nMcpInteractionServer=\"*res://evil.gd\""`) and
 * silently corrupt unrelated sections.
 *
 * The package closes the wire contract that the typed gate must hold:
 *
 *   - `manage_layers` `set` requires `layerType` to be one of the
 *     documented enum values (`render_2d`, `physics_2d`, `render_3d`,
 *     `physics_3d`, `navigation_2d`, `navigation_3d`, `avoidance`) and
 *     `name` to match a strict identifier regex
 *     (`[A-Za-z_][A-Za-z0-9_]*`), and `layer` to be an integer in
 *     `[1, 32]`. A caller that violates any rule gets a typed
 *     `isError: true` envelope BEFORE any file is written.
 *   - `manage_plugins` `enable`/`disable` requires `pluginName` to
 *     match the same strict identifier regex so a caller cannot smuggle
 *     newlines, equals signs, or section brackets into the project.
 *   - Both `set` and `enable`/`disable` are atomic: a failure or rule
 *     violation must leave `project.godot` byte-identical to its
 *     pre-call snapshot.
 *   - `list` (for both tools) reports the parsed table without
 *     modifying `project.godot` (already true; locked in for
 *     regression).
 *
 * The fixture is a temporary Godot project under the OS temp
 * directory, removed in `afterEach`. The test drives the real MCP
 * `tools/call` handler with `manage_layers` / `manage_plugins` and
 * stubs nothing relevant to the gate (these tools write
 * `project.godot` directly, no `executeOperation` exists).
 */

import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GodotServer } from '../src/server.js';
import { PathPolicy } from '../src/security/path-policy.js';
import { CapabilityPolicy } from '../src/security/capability-policy.js';

const tempRoots: string[] = [];

function makeProject(
  initialProjectGodot = '[application]\nconfig/name="LayerPluginGate"\nfeatures=PackedStringArray("4.4")\n',
): { root: string; projectFile: string } {
  const root = mkdtempSync(join(tmpdir(), 'godot-mcp-layers-plugins-injection-'));
  tempRoots.push(root);
  const projectFile = join(root, 'project.godot');
  writeFileSync(projectFile, initialProjectGodot, 'utf8');
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
  args: Record<string, unknown>,
) {
  const handler = requestHandler(server, 'tools/call');
  return handler(
    { method: 'tools/call', params: { name, arguments: args } },
    {},
  );
}

function makeServer(root: string): GodotServer {
  return new GodotServer({
    pathPolicy: new PathPolicy([root]),
    capabilityPolicy: new CapabilityPolicy('unsafe-full'),
    registerSignalHandlers: false,
  });
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('manage_layers injection gate (sibling of tugcantopaloglu#9)', () => {
  it('rejects a "set" whose name contains a section-breaking newline', async () => {
    const { root, projectFile } = makeProject();
    const before = readFileSync(projectFile, 'utf8');
    const server = makeServer(root);
    const response = await toolsCall(server, 'manage_layers', {
      projectPath: root,
      action: 'set',
      layerType: 'render_2d',
      layer: 1,
      // The literal newline + section header is what previously allowed
      // a caller to corrupt unrelated tables.
      name: 'player\n[autoload]\nMcpInteractionServer="*res://evil.gd"',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/layer name/i);
    const after = readFileSync(projectFile, 'utf8');
    expect(after).toBe(before);
  });

  it('rejects a "set" whose name contains an equals sign', async () => {
    const { root, projectFile } = makeProject();
    const before = readFileSync(projectFile, 'utf8');
    const server = makeServer(root);
    const response = await toolsCall(server, 'manage_layers', {
      projectPath: root,
      action: 'set',
      layerType: 'render_2d',
      layer: 1,
      name: 'player=evil',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/layer name/i);
    const after = readFileSync(projectFile, 'utf8');
    expect(after).toBe(before);
  });

  it('rejects a "set" whose layerType is not a documented enum value', async () => {
    const { root, projectFile } = makeProject();
    const before = readFileSync(projectFile, 'utf8');
    const server = makeServer(root);
    const response = await toolsCall(server, 'manage_layers', {
      projectPath: root,
      action: 'set',
      layerType: 'autoload',
      layer: 1,
      name: 'PlayerLayer',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/layerType/i);
    const after = readFileSync(projectFile, 'utf8');
    expect(after).toBe(before);
  });

  it('rejects a "set" whose layer is outside [1, 32]', async () => {
    const { root, projectFile } = makeProject();
    const before = readFileSync(projectFile, 'utf8');
    const server = makeServer(root);
    const response = await toolsCall(server, 'manage_layers', {
      projectPath: root,
      action: 'set',
      layerType: 'render_2d',
      layer: 0,
      name: 'PlayerLayer',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/layer/i);
    const after = readFileSync(projectFile, 'utf8');
    expect(after).toBe(before);
  });

  it('accepts a benign "set" and writes a well-shaped layer_names line', async () => {
    const { root, projectFile } = makeProject(
      '[application]\nconfig/name="LayerPluginGate"\nfeatures=PackedStringArray("4.4")\n',
    );
    const server = makeServer(root);
    const response = await toolsCall(server, 'manage_layers', {
      projectPath: root,
      action: 'set',
      layerType: 'render_2d',
      layer: 3,
      name: 'PlayerLayer',
    });
    expect(response.isError).toBeFalsy();
    const updated = readFileSync(projectFile, 'utf8');
    expect(updated).toContain('[layer_names]');
    expect(updated).toContain('layer_names/render_2d/layer_3="PlayerLayer"');
    expect(updated).not.toContain('[autoload]');
  });

  it('"list" reports the parsed layer table without modifying project.godot', async () => {
    const { root, projectFile } = makeProject(
      '[application]\nconfig/name="LayerPluginGate"\nfeatures=PackedStringArray("4.4")\n\n[layer_names]\n\nlayer_names/render_2d/layer_3="PlayerLayer"\n',
    );
    const before = readFileSync(projectFile, 'utf8');
    const server = makeServer(root);
    const response = await toolsCall(server, 'manage_layers', {
      projectPath: root,
      action: 'list',
    });
    expect(response.isError).toBeFalsy();
    const parsed = JSON.parse(response.content[0].text as string) as {
      layers: Array<{ type: string; layer: number; name: string }>;
    };
    expect(parsed.layers).toEqual([
      { type: 'render_2d', layer: 3, name: 'PlayerLayer' },
    ]);
    const after = readFileSync(projectFile, 'utf8');
    expect(after).toBe(before);
  });
});

describe('manage_plugins injection gate (sibling of tugcantopaloglu#9)', () => {
  it('rejects an "enable" whose pluginName contains a section-breaking newline', async () => {
    const { root, projectFile } = makeProject();
    const before = readFileSync(projectFile, 'utf8');
    const server = makeServer(root);
    const response = await toolsCall(server, 'manage_plugins', {
      projectPath: root,
      action: 'enable',
      // The literal newline + section header is what previously allowed
      // a caller to corrupt unrelated tables.
      pluginName: 'myplugin\n[autoload]\nMcpInteractionServer="*res://evil.gd"',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/plugin name/i);
    const after = readFileSync(projectFile, 'utf8');
    expect(after).toBe(before);
  });

  it('rejects an "enable" whose pluginName contains a forward slash', async () => {
    const { root, projectFile } = makeProject();
    const before = readFileSync(projectFile, 'utf8');
    const server = makeServer(root);
    const response = await toolsCall(server, 'manage_plugins', {
      projectPath: root,
      action: 'enable',
      pluginName: 'myplugin/sub',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/plugin name/i);
    const after = readFileSync(projectFile, 'utf8');
    expect(after).toBe(before);
  });

  it('accepts a benign "enable" and writes a well-shaped plugin enabled line', async () => {
    const { root, projectFile } = makeProject(
      '[application]\nconfig/name="LayerPluginGate"\nfeatures=PackedStringArray("4.4")\n',
    );
    const server = makeServer(root);
    const response = await toolsCall(server, 'manage_plugins', {
      projectPath: root,
      action: 'enable',
      pluginName: 'MyPlugin',
    });
    expect(response.isError).toBeFalsy();
    const updated = readFileSync(projectFile, 'utf8');
    expect(updated).toContain('[editor_plugins]');
    expect(updated).toContain('MyPlugin/enabled=true');
    expect(updated).not.toContain('[autoload]');
  });

  it('accepts a benign "disable" that targets an existing plugin', async () => {
    const { root, projectFile } = makeProject(
      '[application]\nconfig/name="LayerPluginGate"\nfeatures=PackedStringArray("4.4")\n\n[editor_plugins]\n\nMyPlugin/enabled=true\n',
    );
    const server = makeServer(root);
    const response = await toolsCall(server, 'manage_plugins', {
      projectPath: root,
      action: 'disable',
      pluginName: 'MyPlugin',
    });
    expect(response.isError).toBeFalsy();
    const updated = readFileSync(projectFile, 'utf8');
    expect(updated).toContain('MyPlugin/enabled=false');
  });

  it('"list" reports enabled and available plugins without modifying project.godot', async () => {
    const { root, projectFile } = makeProject(
      '[application]\nconfig/name="LayerPluginGate"\nfeatures=PackedStringArray("4.4")\n\n[editor_plugins]\n\nMyPlugin/enabled=true\n',
    );
    const before = readFileSync(projectFile, 'utf8');
    const server = makeServer(root);
    const response = await toolsCall(server, 'manage_plugins', {
      projectPath: root,
      action: 'list',
    });
    expect(response.isError).toBeFalsy();
    const parsed = JSON.parse(response.content[0].text as string) as {
      enabled: string[];
      available: string[];
    };
    expect(parsed.enabled).toContain('MyPlugin');
    const after = readFileSync(projectFile, 'utf8');
    expect(after).toBe(before);
  });
});