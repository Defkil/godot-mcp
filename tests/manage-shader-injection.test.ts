/**
 * Wire-level regression for the sibling-of-[tugcantopaloglu#9] injection
 * bug present in `handleManageShader`.
 *
 * The handler historically wrote and read shader files via:
 *
 *   const fullPath = join(args.projectPath, args.shaderPath);
 *   writeFileSync(fullPath, source, 'utf8');   // 'create'
 *   readFileSync(fullPath, 'utf8');            // 'read'
 *
 * behind only a lexical `validatePath` boundary on both inputs. The
 * lexical check rejects empty / null-byte strings and rejects paths that
 * start with `..`, but it does NOT reject:
 *
 *   *   a section-breaking newline (`shaderPath = "evil.gdshader\n..."`)
 *       — irrelevant for the file itself, but allows arbitrary write
 *       through user-named directories because `dirname(fullPath)` is
 *       recomputed from the joined path;
 *   *   a `..` segment inside the joined path (`shaderPath = "sub/../etc/passwd"`)
 *       — escapes the project root entirely;
 *   *   a Windows-style backslash or absolute path;
 *   *   missing `res://` prefix (`shaderPath = "shaders/spatial.gdshader"`)
 *       — caller-supplied relative project member.
 *
 * The package closes the wire contract that the typed gate must hold:
 *
 *   - `manage_shader` requires `shaderPath` to match a strict canonical
 *     `res://` + relative-project-member regex that rejects newlines,
 *     double quotes, brackets, equals signs, and `..` segments BEFORE
 *     any file is opened or created.
 *   - `shaderPath` MUST start with `res://` (the legacy auto-prepend
 *     shortcut is intentionally dropped, matching the sibling
 *     `manage_autoloads` / `manage_layers` / `manage_plugins` /
 *     `set_main_scene` / `manage_translations` gates).
 *   - The handler resolves the project through
 *     `this.pathPolicy.assertProject(args.projectPath)`, replacing the
 *     lexical `validatePath` boundary with the canonical-root
 *     enforcement those sibling gates already use.
 *   - Unknown `action` values (anything other than `read` / `create`)
 *     are rejected with a typed error envelope before any filesystem
 *     call.
 *
 * The fixture is a temporary Godot project under the OS temp directory,
 * removed in `afterEach`. The test drives the real MCP `tools/call`
 * handler for `manage_shader` and stubs nothing relevant to the gate
 * (the tool writes/reads `.gdshader` files directly, no `executeOperation`
 * exists).
 */

import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { GodotServer } from '../src/server.js';
import { PathPolicy } from '../src/security/path-policy.js';
import { CapabilityPolicy } from '../src/security/capability-policy.js';

const tempRoots: string[] = [];

function makeProject(
  initialProjectGodot =
    '[application]\nconfig/name="ManageShaderGate"\nfeatures=PackedStringArray("4.4")\n',
): { root: string; projectFile: string } {
  const root = mkdtempSync(join(tmpdir(), 'godot-mcp-manage-shader-injection-'));
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

describe('manage_shader injection gate (sibling of tugcantopaloglu#9)', () => {
  it('rejects a shaderPath containing a section-breaking newline', async () => {
    const { root, projectFile } = makeProject();
    const before = readFileSync(projectFile, 'utf8');
    const server = makeServer(root);
    const response = await toolsCall(server, 'manage_shader', {
      projectPath: root,
      shaderPath: 'evil.gdshader\n[autoload]\nMcpInteractionServer="*res://evil.gd"',
      action: 'read',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/shaderPath/i);
    const after = readFileSync(projectFile, 'utf8');
    expect(after).toBe(before);
  });

  it('rejects a shaderPath containing a double-quote break-out', async () => {
    const { root, projectFile } = makeProject();
    const before = readFileSync(projectFile, 'utf8');
    const server = makeServer(root);
    const response = await toolsCall(server, 'manage_shader', {
      projectPath: root,
      shaderPath: 'evil.gdshader"\n[autoload]\nFoo="bar',
      action: 'read',
    });
    expect(response.isError).toBe(true);
    const after = readFileSync(projectFile, 'utf8');
    expect(after).toBe(before);
  });

  it('rejects a shaderPath lacking the res:// prefix', async () => {
    const { root, projectFile } = makeProject();
    const before = readFileSync(projectFile, 'utf8');
    const server = makeServer(root);
    const response = await toolsCall(server, 'manage_shader', {
      projectPath: root,
      shaderPath: 'shaders/spatial.gdshader',
      action: 'read',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/shaderPath/i);
    const after = readFileSync(projectFile, 'utf8');
    expect(after).toBe(before);
  });

  it('rejects a shaderPath that uses .. to escape the project root', async () => {
    const { root, projectFile } = makeProject();
    const before = readFileSync(projectFile, 'utf8');
    const server = makeServer(root);
    const response = await toolsCall(server, 'manage_shader', {
      projectPath: root,
      shaderPath: 'res://../etc/passwd',
      action: 'read',
    });
    expect(response.isError).toBe(true);
    const after = readFileSync(projectFile, 'utf8');
    expect(after).toBe(before);
  });

  it('rejects an unknown action without touching the filesystem', async () => {
    const { root, projectFile } = makeProject();
    const before = readFileSync(projectFile, 'utf8');
    const server = makeServer(root);
    const response = await toolsCall(server, 'manage_shader', {
      projectPath: root,
      shaderPath: 'res://shaders/spatial.gdshader',
      action: 'delete',
    });
    expect(response.isError).toBe(true);
    const target = join(root, 'shaders', 'spatial.gdshader');
    expect(existsSync(target)).toBe(false);
    const after = readFileSync(projectFile, 'utf8');
    expect(after).toBe(before);
  });

  it('accepts a benign read of an existing res:// shader', async () => {
    const { root } = makeProject();
    const shaderDir = join(root, 'shaders');
    mkdirSync(shaderDir, { recursive: true });
    const shaderPath = join(shaderDir, 'spatial.gdshader');
    const expected = 'shader_type spatial;\n\nvoid fragment() {}\n';
    writeFileSync(shaderPath, expected, 'utf8');
    const server = makeServer(root);
    const response = await toolsCall(server, 'manage_shader', {
      projectPath: root,
      shaderPath: 'res://shaders/spatial.gdshader',
      action: 'read',
    });
    expect(response.isError).toBeFalsy();
    expect(response.content[0].text).toBe(expected);
  });

  it('accepts a benign create of a new res:// shader and writes only the named file', async () => {
    const { root, projectFile } = makeProject();
    const before = readFileSync(projectFile, 'utf8');
    const server = makeServer(root);
    const response = await toolsCall(server, 'manage_shader', {
      projectPath: root,
      shaderPath: 'res://shaders/spatial.gdshader',
      action: 'create',
      shaderType: 'spatial',
    });
    expect(response.isError).toBeFalsy();
    const target = join(root, 'shaders', 'spatial.gdshader');
    expect(existsSync(target)).toBe(true);
    const written = readFileSync(target, 'utf8');
    expect(written).toContain('shader_type spatial');
    // The gate must not touch sibling files or project.godot itself.
    const after = readFileSync(projectFile, 'utf8');
    expect(after).toBe(before);
  });

  it('accepts a benign read of a missing res:// shader with a not-found error envelope', async () => {
    const { root } = makeProject();
    const server = makeServer(root);
    const response = await toolsCall(server, 'manage_shader', {
      projectPath: root,
      shaderPath: 'res://shaders/missing.gdshader',
      action: 'read',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/not found/i);
  });
});
