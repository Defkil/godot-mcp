/**
 * Wire-level regression for the sibling-of-[tugcantopaloglu#9] injection
 * bug present in `handleSetMainScene` and `handleManageTranslations`.
 *
 * `handleSetMainScene` historically concatenated
 *   `run/main_scene="<scenePath>"`
 * directly into `project.godot` and only escaped the lexical `validatePath`
 * boundary on `projectPath`, not on the user-controlled `scenePath`. A
 * caller could pass
 *   scenePath = "evil.tscn\n[autoload]\nMcpInteractionServer=\"*res://evil.gd\""
 * and silently corrupt the project's `[autoload]` table or any other
 * section.
 *
 * `handleManageTranslations` historically built
 *   `translations=PackedStringArray(..., "<resPath>")` for `add`
 * without validating `translationPath` against a strict `res://` plus
 * canonical project-member regex, and used a regex-constructed
 * `remove` pattern that escaped regex metas but did not enforce a
 * canonical `res://` boundary. A caller could inject the same
 * class of newline / quote / bracket payload and corrupt unrelated
 * `[internationalization]` lines or wipe sibling translations.
 *
 * The package closes the wire contract that the typed gate must hold:
 *
 *   - `set_main_scene` requires `scenePath` to start with `res://`
 *     followed by a relative project member that contains no newline,
 *     no double quote, no equals sign, no opening bracket, no `..`
 *     segment, and at least one `.` extension character. A caller that
 *     violates any rule gets a typed `isError: true` envelope BEFORE
 *     any file is written.
 *   - `manage_translations` `add` and `remove` enforce the same
 *     `res://` + canonical-project-member gate on `translationPath`,
 *     so a caller cannot smuggle newlines, quotes, brackets or `..`
 *     escapes through either branch.
 *   - `manage_translations` `list` is unchanged: it returns the parsed
 *     table without writing `project.godot`.
 *   - Both handlers resolve the project through
 *     `this.pathPolicy.assertProject(args.projectPath)`, replacing the
 *     lexical `validatePath` boundary with the same canonical-root
 *     enforcement the sibling `manage_autoloads` / `manage_layers` /
 *     `manage_plugins` gates already use.
 *
 * The fixture is a temporary Godot project under the OS temp directory,
 * removed in `afterEach`. The test drives the real MCP `tools/call`
 * handler with `set_main_scene` and `manage_translations` and stubs
 * nothing relevant to the gate (these tools write `project.godot`
 * directly, no `executeOperation` exists).
 */

import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { GodotServer } from '../src/server.js';
import { PathPolicy } from '../src/security/path-policy.js';
import { CapabilityPolicy } from '../src/security/capability-policy.js';

const tempRoots: string[] = [];

function makeProject(
  initialProjectGodot =
    '[application]\nconfig/name="MainSceneTranslationsGate"\nfeatures=PackedStringArray("4.4")\n',
): { root: string; projectFile: string } {
  const root = mkdtempSync(join(tmpdir(), 'godot-mcp-mainscene-translations-injection-'));
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

describe('set_main_scene injection gate (sibling of tugcantopaloglu#9)', () => {
  it('rejects a scenePath containing a section-breaking newline', async () => {
    const { root, projectFile } = makeProject();
    const before = readFileSync(projectFile, 'utf8');
    const server = makeServer(root);
    const response = await toolsCall(server, 'set_main_scene', {
      projectPath: root,
      scenePath: 'evil.tscn\n[autoload]\nMcpInteractionServer="*res://evil.gd"',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/scenePath/i);
    const after = readFileSync(projectFile, 'utf8');
    expect(after).toBe(before);
  });

  it('rejects a scenePath containing a double-quote break-out', async () => {
    const { root, projectFile } = makeProject();
    const before = readFileSync(projectFile, 'utf8');
    const server = makeServer(root);
    const response = await toolsCall(server, 'set_main_scene', {
      projectPath: root,
      scenePath: 'evil.tscn"\n[autoload]\nFoo="bar',
    });
    expect(response.isError).toBe(true);
    const after = readFileSync(projectFile, 'utf8');
    expect(after).toBe(before);
  });

  it('rejects a scenePath lacking the res:// prefix', async () => {
    const { root, projectFile } = makeProject();
    const before = readFileSync(projectFile, 'utf8');
    const server = makeServer(root);
    const response = await toolsCall(server, 'set_main_scene', {
      projectPath: root,
      scenePath: 'scenes/main.tscn',
    });
    expect(response.isError).toBe(true);
    const after = readFileSync(projectFile, 'utf8');
    expect(after).toBe(before);
  });

  it('rejects a scenePath that uses .. to escape the project root', async () => {
    const { root, projectFile } = makeProject();
    const before = readFileSync(projectFile, 'utf8');
    const server = makeServer(root);
    const response = await toolsCall(server, 'set_main_scene', {
      projectPath: root,
      scenePath: 'res://../etc/passwd',
    });
    expect(response.isError).toBe(true);
    const after = readFileSync(projectFile, 'utf8');
    expect(after).toBe(before);
  });

  it('rejects a scenePath containing an opening bracket section break', async () => {
    const { root, projectFile } = makeProject();
    const before = readFileSync(projectFile, 'utf8');
    const server = makeServer(root);
    const response = await toolsCall(server, 'set_main_scene', {
      projectPath: root,
      scenePath: 'evil.tscn[autoload]',
    });
    expect(response.isError).toBe(true);
    const after = readFileSync(projectFile, 'utf8');
    expect(after).toBe(before);
  });

  it('accepts a benign res:// scenePath and writes one well-shaped setting line', async () => {
    const { root, projectFile } = makeProject(
      '[application]\nconfig/name="MainSceneTranslationsGate"\nfeatures=PackedStringArray("4.4")\n',
    );
    const server = makeServer(root);
    const response = await toolsCall(server, 'set_main_scene', {
      projectPath: root,
      scenePath: 'res://scenes/main.tscn',
    });
    expect(response.isError).toBeFalsy();
    const updated = readFileSync(projectFile, 'utf8');
    expect(updated).toContain('run/main_scene="res://scenes/main.tscn"');
    expect(updated).not.toContain('[autoload]');
  });

  it('replaces an existing run/main_scene line without corrupting other sections', async () => {
    const { root, projectFile } = makeProject(
      '[application]\nconfig/name="MainSceneTranslationsGate"\nfeatures=PackedStringArray("4.4")\nrun/main_scene="res://scenes/old.tscn"\n\n[autoload]\n\nFooAutoload="*res://scripts/foo.gd"\n',
    );
    const server = makeServer(root);
    const response = await toolsCall(server, 'set_main_scene', {
      projectPath: root,
      scenePath: 'res://scenes/new.tscn',
    });
    expect(response.isError).toBeFalsy();
    const updated = readFileSync(projectFile, 'utf8');
    expect(updated).toContain('run/main_scene="res://scenes/new.tscn"');
    expect(updated).not.toContain('run/main_scene="res://scenes/old.tscn"');
    // Sibling autoload line must survive untouched.
    expect(updated).toContain('FooAutoload="*res://scripts/foo.gd"');
  });
});

describe('manage_translations injection gate (sibling of tugcantopaloglu#9)', () => {
  it('rejects "add" whose translationPath contains a section-breaking newline', async () => {
    const { root, projectFile } = makeProject();
    const before = readFileSync(projectFile, 'utf8');
    const server = makeServer(root);
    const response = await toolsCall(server, 'manage_translations', {
      projectPath: root,
      action: 'add',
      translationPath: 'res://locales/en.csv\n[application]\nconfig/name="pwned"',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/translationPath/i);
    const after = readFileSync(projectFile, 'utf8');
    expect(after).toBe(before);
  });

  it('rejects "add" whose translationPath lacks the res:// prefix', async () => {
    const { root, projectFile } = makeProject();
    const before = readFileSync(projectFile, 'utf8');
    const server = makeServer(root);
    const response = await toolsCall(server, 'manage_translations', {
      projectPath: root,
      action: 'add',
      translationPath: 'locales/en.csv',
    });
    expect(response.isError).toBe(true);
    const after = readFileSync(projectFile, 'utf8');
    expect(after).toBe(before);
  });

  it('rejects "add" whose translationPath uses .. to escape the project root', async () => {
    const { root, projectFile } = makeProject();
    const before = readFileSync(projectFile, 'utf8');
    const server = makeServer(root);
    const response = await toolsCall(server, 'manage_translations', {
      projectPath: root,
      action: 'add',
      translationPath: 'res://../etc/passwd',
    });
    expect(response.isError).toBe(true);
    const after = readFileSync(projectFile, 'utf8');
    expect(after).toBe(before);
  });

  it('rejects "remove" whose translationPath lacks the res:// prefix', async () => {
    const { root, projectFile } = makeProject(
      '[internationalization]\n\ntranslations=PackedStringArray("res://locales/en.csv")\n',
    );
    const before = readFileSync(projectFile, 'utf8');
    const server = makeServer(root);
    const response = await toolsCall(server, 'manage_translations', {
      projectPath: root,
      action: 'remove',
      translationPath: 'locales/en.csv',
    });
    expect(response.isError).toBe(true);
    const after = readFileSync(projectFile, 'utf8');
    expect(after).toBe(before);
  });

  it('accepts a benign "add" and writes a canonical translations line under [internationalization]', async () => {
    const { root, projectFile } = makeProject(
      '[application]\nconfig/name="MainSceneTranslationsGate"\nfeatures=PackedStringArray("4.4")\n',
    );
    const server = makeServer(root);
    const response = await toolsCall(server, 'manage_translations', {
      projectPath: root,
      action: 'add',
      translationPath: 'res://locales/en.csv',
    });
    expect(response.isError).toBeFalsy();
    const updated = readFileSync(projectFile, 'utf8');
    expect(updated).toContain('[internationalization]');
    expect(updated).toContain('translations=PackedStringArray("res://locales/en.csv")');
  });

  it('accepts a benign "remove" that strips one matching line and leaves siblings untouched', async () => {
    const { root, projectFile } = makeProject(
      '[application]\nconfig/name="MainSceneTranslationsGate"\nfeatures=PackedStringArray("4.4")\n\n[internationalization]\n\ntranslations=PackedStringArray("res://locales/en.csv", "res://locales/de.csv")\n',
    );
    const server = makeServer(root);
    const response = await toolsCall(server, 'manage_translations', {
      projectPath: root,
      action: 'remove',
      translationPath: 'res://locales/en.csv',
    });
    expect(response.isError).toBeFalsy();
    const updated = readFileSync(projectFile, 'utf8');
    expect(updated).toContain('"res://locales/de.csv"');
    expect(updated).not.toContain('"res://locales/en.csv"');
  });

  it('"list" reports the parsed translations table without modifying project.godot', async () => {
    const { root, projectFile } = makeProject(
      '[application]\nconfig/name="MainSceneTranslationsGate"\nfeatures=PackedStringArray("4.4")\n\n[internationalization]\n\ntranslations=PackedStringArray("res://locales/en.csv", "res://locales/de.csv")\n',
    );
    const before = readFileSync(projectFile, 'utf8');
    const server = makeServer(root);
    const response = await toolsCall(server, 'manage_translations', {
      projectPath: root,
      action: 'list',
    });
    expect(response.isError).toBeFalsy();
    const parsed = JSON.parse(response.content[0].text as string) as { translations: string[] };
    expect(parsed.translations).toEqual(['res://locales/en.csv', 'res://locales/de.csv']);
    const after = readFileSync(projectFile, 'utf8');
    expect(after).toBe(before);
  });
});
