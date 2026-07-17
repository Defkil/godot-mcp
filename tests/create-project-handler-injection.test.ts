/**
 * Wire-level regression for the next-follow-up PathPolicy gate migration
 * batch. Closes the canonical-root / canonical-member contract for the
 * two `create_*` sibling handlers that still inline a lexical
 * `validatePath` boundary on `projectPath` (and, for `create_csharp_script`,
 * also on the `scriptPath` member):
 *
 *   - `handleCreateProject`      (args.projectPath — target may not exist yet)
 *   - `handleCreateCsharpScript` (args.projectPath + args.scriptPath)
 *
 * Each handler historically opened with
 * `if (!validatePath(args.projectPath)) return createErrorResponse('Invalid path.');`
 * and then `join(args.projectPath, 'project.godot')`-ed the user-supplied
 * value into `existsSync` / `readFileSync` / `writeFileSync`. The lexical
 * `validatePath` only rejects empty / `..`-prefixed / null-byte strings —
 * it does not enforce the canonical-roots list, and it does not enforce a
 * canonical project-member contract on the `scriptPath`.
 *
 * `handleCreateProject` is a genuine create-the-root handler: the target
 * `args.projectPath` may not yet exist on disk. `PathPolicy.assertProject`
 * still works for non-existent paths because `canonicalizeNearest` walks
 * up to the nearest existing ancestor and prefixes the new segments. Both
 * the project root resolution and the resulting `mkdirSync` / `writeFileSync`
 * calls now flow through the canonical path, so a caller can never
 * receive a successful write that leaks outside the configured
 * `PathPolicy` allowed roots.
 *
 * `handleCreateCsharpScript` is an existing .NET project plus a new
 * script: the project root exists, but the script does not. The handler
 * now resolves `projectPath` through `assertProject` and the new
 * `scriptPath` through `resolveProjectMember` before any filesystem
 * call. An absolute or `..`-bearing `scriptPath` returns a typed
 * `isError: true` envelope instead of reaching `mkdirSync` /
 * `writeFileSync`.
 *
 * The request-boundary `assertSafeToolPaths` guard already rejects every
 * canonical member path that would escape the configured `PathPolicy`
 * roots BEFORE the handler is called, so the runtime is not exposed to
 * a fresh escape. This test proves the same contract is enforced
 * *inside the handler body itself* by invoking the private handler
 * method directly (bypassing `tools/call`) and asserting that a typed
 * `isError: true` envelope is returned for every documented escape
 * attempt. The tests cover both `projectPath` outside the configured
 * allowed roots AND a `scriptPath` whose canonical realpath would
 * escape the project root via `..` traversal.
 *
 * The fixture is a temporary Godot project under the OS temp directory,
 * removed in `afterEach`. The test invokes the private handler methods
 * via `(server as any).handleXxx(args)` and stubs nothing relevant to
 * the gate.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GodotServer } from '../src/server.js';
import { PathPolicy } from '../src/security/path-policy.js';
import { CapabilityPolicy } from '../src/security/capability-policy.js';

const tempRoots: string[] = [];

function makeOutsideRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'godot-mcp-create-project-outside-'));
  tempRoots.push(root);
  return root;
}

function makeServer(root: string): GodotServer {
  return new GodotServer({
    pathPolicy: new PathPolicy([root]),
    capabilityPolicy: new CapabilityPolicy('unsafe-full'),
    registerSignalHandlers: false,
  });
}

function makeDotnetProjectRoot(): { root: string; projectFile: string; csprojFile: string } {
  const root = mkdtempSync(join(tmpdir(), 'godot-mcp-create-csharp-script-project-'));
  tempRoots.push(root);
  const projectFile = join(root, 'project.godot');
  const csprojFile = join(root, 'Demo.csproj');
  const csproj = [
    '<Project Sdk="Godot.NET.Sdk/4.4.0">',
    '  <PropertyGroup>',
    '    <TargetFramework>net6.0</TargetFramework>',
    '    <EnableDynamicLoading>true</EnableDynamicLoading>',
    '  </PropertyGroup>',
    '</Project>',
    '',
  ].join('\n');
  writeFileSync(projectFile, '[application]\nconfig/name="ProjectCSharpScriptGate"\nfeatures=PackedStringArray("4.4", "C#")\n', 'utf8');
  writeFileSync(csprojFile, csproj, 'utf8');
  return { root, projectFile, csprojFile };
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('create_project / create_csharp_script handlers adopt PathPolicy contract in their own body', () => {
  // ---------- handleCreateProject ----------

  it('create_project rejects a projectPath outside the configured allowed roots', async () => {
    const allowedRoot = mkdtempSync(join(tmpdir(), 'godot-mcp-create-project-allowed-'));
    tempRoots.push(allowedRoot);
    const outside = makeOutsideRoot();
    const server = makeServer(allowedRoot);
    const response = await (server as any).handleCreateProject({
      projectPath: outside,
      projectName: 'SomeNewProject',
    });
    expect(response.isError).toBe(true);
    // The canonical-root gate fires BEFORE the `existsSync(project.godot)`
    // check, so the error must reference the allowed-roots policy, not a
    // missing-project file or an `mkdirSync` failure.
    expect(response.content[0].text).toMatch(/outside the (configured )?allowed roots/i);
    // The unrelated filesystem rejection strings must remain absent.
    expect(response.content[0].text).not.toMatch(/Failed to create project/i);
  });

  it('create_project rejects an absolute projectPath that resolves outside the configured allowed roots', async () => {
    const allowedRoot = mkdtempSync(join(tmpdir(), 'godot-mcp-create-project-allowed-2-'));
    tempRoots.push(allowedRoot);
    // Build a sibling temp directory OUTSIDE the configured allowed roots
    // and pass its absolute path. The handler previously would have happily
    // `mkdirSync`-ed it and written a `project.godot`; PathPolicy must
    // reject this BEFORE the handler reaches the filesystem so it can
    // never silently escape the configured allowed roots.
    const outsideSentinel = mkdtempSync(join(tmpdir(), 'godot-mcp-create-project-outside-sentinel-'));
    tempRoots.push(outsideSentinel);
    const server = makeServer(allowedRoot);
    const response = await (server as any).handleCreateProject({
      projectPath: outsideSentinel,
      projectName: 'EvilProject',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/outside the (configured )?allowed roots/i);
    // The unrelated filesystem rejection strings must remain absent.
    expect(response.content[0].text).not.toMatch(/Failed to create project/i);
    // The handler must NOT have created a `project.godot` inside the
    // outside-roots sentinel: the directory may still exist (it was
    // created by `mkdtempSync`), but no `project.godot` file should
    // appear inside it. This proves the canonical-root gate fires
    // BEFORE `mkdirSync` / `writeFileSync`, exactly like the sibling
    // `core_file_io` / `manage_shader` / `set_main_scene` gates.
    expect(await import('node:fs').then(({ existsSync }) => existsSync(join(outsideSentinel, 'project.godot')))).toBe(false);
  });

  // ---------- handleCreateCsharpScript ----------

  it('create_csharp_script rejects a projectPath outside the configured allowed roots', async () => {
    const allowedRoot = mkdtempSync(join(tmpdir(), 'godot-mcp-create-csharp-script-allowed-'));
    tempRoots.push(allowedRoot);
    const outside = makeOutsideRoot();
    const server = makeServer(allowedRoot);
    const response = await (server as any).handleCreateCsharpScript({
      projectPath: outside,
      scriptPath: 'res://Player.cs',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/outside the (configured )?allowed roots/i);
    // The .NET-project gate (`Not a Godot .NET project`) must NOT fire —
    // the canonical-root gate is supposed to win.
    expect(response.content[0].text).not.toMatch(/Not a Godot \.NET project/i);
  });

  it('create_csharp_script rejects a scriptPath that would escape the project root via .. traversal', async () => {
    const { root } = makeDotnetProjectRoot();
    const server = makeServer(root);
    const response = await (server as any).handleCreateCsharpScript({
      projectPath: root,
      // `..` plus the lexical `validatePath` boundary passes nothing because
      // it would attempt to escape the project root. PathPolicy
      // `resolveProjectMember` rejects it BEFORE any `mkdirSync` /
      // `writeFileSync` runs.
      scriptPath: 'res://../etc/passwd.cs',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/outside the project root|traverse|reject/i);
  });

  it('create_csharp_script rejects an absolute scriptPath that escapes the project root', async () => {
    const { root } = makeDotnetProjectRoot();
    const server = makeServer(root);
    const response = await (server as any).handleCreateCsharpScript({
      projectPath: root,
      // The lexical `validatePath` boundary only rejects empty / `..` /
      // null-byte strings; `C:/Windows/System32/evil.cs` slips through.
      // PathPolicy `resolveProjectMember` rejects the absolute escape
      // BEFORE any `mkdirSync` / `writeFileSync` runs.
      scriptPath: 'C:/Windows/System32/evil.cs',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/outside the project root|relative to the project root|absolute|traverse|reject/i);
  });
});
