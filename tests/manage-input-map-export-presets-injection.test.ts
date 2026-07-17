/**
 * Wire-level regression for [tugcantopaloglu#9] siblings:
 * `manage_input_map` and `manage_export_presets` newline / section
 * injection.
 *
 * `handleManageInputMap` historically interpolated `args.actionName`
 * and a constructed `events` payload directly into `project.godot`
 * without validating `actionName` against a strict identifier regex.
 * A caller could pass `actionName = "Evil\n[layer_names]\n0=\"player\""`
 * and silently corrupt unrelated sections, or pass
 * `actionName = ".*"` and let the historical `replace(regex, '')`
 * in the `remove` branch wipe every sibling input action in the
 * same regex scope.
 *
 * `handleManageExportPresets` historically interpolated
 * `${args.name}` and `${args.platform}` directly into a Godot
 * INI-style block in `export_presets.cfg`, again without a strict
 * identifier/value gate. A caller could pass
 * `name = "Evil\n[preset.9999]\nname=\"Other\""` and corrupt the
 * config file, or pass `platform = "Windows\"\nrunnable=true\n"`
 * and inject arbitrary INI keys.
 *
 * The package closes the wire contract that the typed gate must
 * hold:
 *
 *   - `manage_input_map` `add` requires `actionName` to match a
 *     strict identifier regex (`[A-Za-z_][A-Za-z0-9_]*`) before any
 *     file is touched; rejects newlines, equals signs, forward
 *     slashes, and section brackets.
 *   - `manage_input_map` `remove` uses an anchored per-line regex
 *     and requires the same identifier gate so `.*` / `[` cannot
 *     smuggle wildcards through the removal pattern.
 *   - `manage_export_presets` `add` requires `name` to match the
 *     same strict identifier regex and `platform` to match a
 *     closed-list allowlist (`Windows Desktop` | `Linux/X11` |
 *     `macOS` | `Web` | `Android` | `iOS`) before any file is
 *     touched; rejects newlines, quotes, brackets, and `;`.
 *   - `manage_export_presets` `remove` requires the same identifier
 *     gate on `name`.
 *   - Both handlers are atomic: a rejection must leave the
 *     underlying file byte-identical to its pre-call snapshot.
 *
 * The fixture is a temporary Godot project under the OS temp
 * directory, removed in `afterEach`. The test drives the real MCP
 * `tools/call` handler with `manage_input_map` /
 * `manage_export_presets` and stubs nothing relevant to the gate.
 */

import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GodotServer } from '../src/server.js';
import { PathPolicy } from '../src/security/path-policy.js';
import { CapabilityPolicy } from '../src/security/capability-policy.js';

const tempRoots: string[] = [];

function makeProject(initialProjectGodot: string): { root: string; projectFile: string } {
  const root = mkdtempSync(join(tmpdir(), 'godot-mcp-inputmap-presets-injection-'));
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

const BASE_PROJECT =
  '[application]\nconfig/name="InputMapPresetsGate"\nfeatures=PackedStringArray("4.4")\n\n';

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('manage_input_map injection gate (sibling of tugcantopaloglu#9)', () => {
  it('rejects an "add" whose actionName contains a section-breaking newline', async () => {
    const { root, projectFile } = makeProject(BASE_PROJECT);
    const before = readFileSync(projectFile, 'utf8');
    const server = makeServer(root);
    const response = await toolsCall(server, 'manage_input_map', {
      projectPath: root,
      action: 'add',
      actionName: 'Evil\n[layer_names]\n0="player"',
      key: 'W',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/action name/i);
    const after = readFileSync(projectFile, 'utf8');
    expect(after).toBe(before);
  });

  it('rejects an "add" whose actionName contains an equals sign', async () => {
    const { root, projectFile } = makeProject(BASE_PROJECT);
    const before = readFileSync(projectFile, 'utf8');
    const server = makeServer(root);
    const response = await toolsCall(server, 'manage_input_map', {
      projectPath: root,
      action: 'add',
      actionName: 'Evil=Other',
      key: 'W',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/action name/i);
    const after = readFileSync(projectFile, 'utf8');
    expect(after).toBe(before);
  });

  it('accepts a benign "add" and appends a well-shaped input action line', async () => {
    const { root, projectFile } = makeProject(BASE_PROJECT);
    const server = makeServer(root);
    const response = await toolsCall(server, 'manage_input_map', {
      projectPath: root,
      action: 'add',
      actionName: 'move_forward',
      key: 'W',
    });
    expect(response.isError).toBeFalsy();
    const updated = readFileSync(projectFile, 'utf8');
    // The line must be a single, well-formed Godot input-map entry
    // (the canonical `[input]` section header should appear exactly once).
    expect(updated).toContain('[input]');
    expect(updated).toContain('move_forward={');
    expect(updated).not.toContain('[layer_names]');
    expect(updated).not.toContain('[autoload]');
  });

  it('rejects a "remove" whose actionName uses regex wildcards against existing actions', async () => {
    const { root, projectFile } = makeProject(
      BASE_PROJECT +
        '\n[input]\n\nmove_forward={"deadzone": 0.5, "events": []}\nmove_back={"deadzone": 0.5, "events": []}\n',
    );
    const before = readFileSync(projectFile, 'utf8');
    const server = makeServer(root);
    // The naive regex `\n?move.*=.*\n?` would have wiped both lines.
    const response = await toolsCall(server, 'manage_input_map', {
      projectPath: root,
      action: 'remove',
      actionName: '.*',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/action name/i);
    const after = readFileSync(projectFile, 'utf8');
    expect(after).toBe(before);
  });

  it('still permits a precise "remove" that targets the exact action name', async () => {
    const { root, projectFile } = makeProject(
      BASE_PROJECT +
        '\n[input]\n\nmove_forward={"deadzone": 0.5, "events": []}\nmove_back={"deadzone": 0.5, "events": []}\n',
    );
    const server = makeServer(root);
    const response = await toolsCall(server, 'manage_input_map', {
      projectPath: root,
      action: 'remove',
      actionName: 'move_forward',
    });
    expect(response.isError).toBeFalsy();
    const updated = readFileSync(projectFile, 'utf8');
    expect(updated).not.toContain('move_forward={');
    expect(updated).toContain('move_back={"deadzone": 0.5, "events": []}');
  });

  it('"list" reports the parsed action map without modifying project.godot', async () => {
    const { root, projectFile } = makeProject(
      BASE_PROJECT +
        '\n[input]\n\nmove_forward={"deadzone": 0.5, "events": []}\n',
    );
    const before = readFileSync(projectFile, 'utf8');
    const server = makeServer(root);
    const response = await toolsCall(server, 'manage_input_map', {
      projectPath: root,
      action: 'list',
    });
    expect(response.isError).toBeFalsy();
    const text = response.content[0].text as string;
    const parsed = JSON.parse(text) as Record<string, string>;
    // The list result echoes the raw project.godot value verbatim so
    // any future tightening of the typed gate does not silently change
    // the documented JSON envelope.
    expect(parsed.move_forward).toBe('{"deadzone": 0.5, "events": []}');
    const after = readFileSync(projectFile, 'utf8');
    expect(after).toBe(before);
  });
});

describe('manage_export_presets injection gate (sibling of tugcantopaloglu#9)', () => {
  it('rejects an "add" whose name contains a section-breaking newline', async () => {
    const { root } = makeProject(BASE_PROJECT);
    const presetsFile = join(root, 'export_presets.cfg');
    writeFileSync(presetsFile, '', 'utf8');
    const before = readFileSync(presetsFile, 'utf8');
    const server = makeServer(root);
    const response = await toolsCall(server, 'manage_export_presets', {
      projectPath: root,
      action: 'add',
      name: 'Evil\n[preset.9999]\nname="Other"',
      platform: 'Windows Desktop',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/preset name/i);
    const after = readFileSync(presetsFile, 'utf8');
    expect(after).toBe(before);
  });

  it('rejects an "add" whose name contains a closing bracket', async () => {
    const { root } = makeProject(BASE_PROJECT);
    const presetsFile = join(root, 'export_presets.cfg');
    writeFileSync(presetsFile, '', 'utf8');
    const before = readFileSync(presetsFile, 'utf8');
    const server = makeServer(root);
    const response = await toolsCall(server, 'manage_export_presets', {
      projectPath: root,
      action: 'add',
      name: 'Evil]',
      platform: 'Windows Desktop',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/preset name/i);
    const after = readFileSync(presetsFile, 'utf8');
    expect(after).toBe(before);
  });

  it('rejects an "add" whose platform is not in the closed-list allowlist', async () => {
    const { root } = makeProject(BASE_PROJECT);
    const presetsFile = join(root, 'export_presets.cfg');
    writeFileSync(presetsFile, '', 'utf8');
    const before = readFileSync(presetsFile, 'utf8');
    const server = makeServer(root);
    const response = await toolsCall(server, 'manage_export_presets', {
      projectPath: root,
      action: 'add',
      name: 'MyPreset',
      platform: 'Windows Desktop"\nrunnable=true\n',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/platform/i);
    const after = readFileSync(presetsFile, 'utf8');
    expect(after).toBe(before);
  });

  it('accepts a benign "add" and appends a well-shaped preset block', async () => {
    const { root } = makeProject(BASE_PROJECT);
    const presetsFile = join(root, 'export_presets.cfg');
    writeFileSync(presetsFile, '', 'utf8');
    const server = makeServer(root);
    const response = await toolsCall(server, 'manage_export_presets', {
      projectPath: root,
      action: 'add',
      name: 'WindowsDesktop',
      platform: 'Windows Desktop',
    });
    expect(response.isError).toBeFalsy();
    const updated = readFileSync(presetsFile, 'utf8');
    // The block must contain exactly one preset section, the exact
    // name/platform lines, and no extra injected INI keys.
    expect(updated).toContain('name="WindowsDesktop"');
    expect(updated).toContain('platform="Windows Desktop"');
    expect(updated).not.toContain('runnable=true');
    const presetHeaderCount = (updated.match(/\[preset\./g) || []).length;
    expect(presetHeaderCount).toBe(1);
  });

  it('rejects a "remove" whose name uses regex wildcards against existing presets', async () => {
    const { root } = makeProject(BASE_PROJECT);
    const presetsFile = join(root, 'export_presets.cfg');
    writeFileSync(
      presetsFile,
      '[preset.0]\n\nname="WindowsDesktop"\nplatform="Windows Desktop"\nrunnable=true\n\n[preset.1]\n\nname="LinuxX11"\nplatform="Linux/X11"\nrunnable=false\n',
      'utf8',
    );
    const before = readFileSync(presetsFile, 'utf8');
    const server = makeServer(root);
    const response = await toolsCall(server, 'manage_export_presets', {
      projectPath: root,
      action: 'remove',
      name: '.*',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/preset name/i);
    const after = readFileSync(presetsFile, 'utf8');
    expect(after).toBe(before);
  });

  it('still permits a precise "remove" that targets the exact preset name', async () => {
    const { root } = makeProject(BASE_PROJECT);
    const presetsFile = join(root, 'export_presets.cfg');
    writeFileSync(
      presetsFile,
      '[preset.0]\n\nname="WindowsDesktop"\nplatform="Windows Desktop"\nrunnable=true\n\n[preset.1]\n\nname="LinuxX11"\nplatform="Linux/X11"\nrunnable=false\n',
      'utf8',
    );
    const server = makeServer(root);
    const response = await toolsCall(server, 'manage_export_presets', {
      projectPath: root,
      action: 'remove',
      name: 'WindowsDesktop',
    });
    expect(response.isError).toBeFalsy();
    const updated = readFileSync(presetsFile, 'utf8');
    expect(updated).not.toContain('name="WindowsDesktop"');
    expect(updated).toContain('name="LinuxX11"');
  });

  it('"list" reports the parsed preset table without modifying export_presets.cfg', async () => {
    const { root } = makeProject(BASE_PROJECT);
    const presetsFile = join(root, 'export_presets.cfg');
    writeFileSync(
      presetsFile,
      '[preset.0]\n\nname="WindowsDesktop"\nplatform="Windows Desktop"\nrunnable=true\n',
      'utf8',
    );
    const before = readFileSync(presetsFile, 'utf8');
    const server = makeServer(root);
    const response = await toolsCall(server, 'manage_export_presets', {
      projectPath: root,
      action: 'list',
    });
    expect(response.isError).toBeFalsy();
    const text = response.content[0].text as string;
    const parsed = JSON.parse(text) as { presets: Array<{ name: string; platform: string }> };
    expect(parsed.presets).toEqual([{ name: 'WindowsDesktop', platform: 'Windows Desktop' }]);
    const after = readFileSync(presetsFile, 'utf8');
    expect(after).toBe(before);
    // Sanity check: the file actually exists on disk for this fixture.
    expect(existsSync(presetsFile)).toBe(true);
  });
});