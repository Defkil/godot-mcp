/**
 * Wire-level regression for the next-follow-up PathPolicy gate migration
 * batch. Closes the canonical-root contract for the three sibling handlers
 * that still inline a lexical `validatePath` boundary on `projectPath`:
 *
 *   - `handleManageSceneSignals`  (args.projectPath + args.scenePath)
 *   - `handleManageThemeResource` (args.projectPath + args.resourcePath)
 *   - `handleManageSceneStructure`(args.projectPath + args.scenePath)
 *
 * Each handler historically delegated straight to `headlessOp`, which opens
 * with a single `if (!validatePath(projectPath)) return createErrorResponse('Invalid path.');`
 * and then `join(projectPath, 'project.godot')`-ed the user-supplied value
 * into `existsSync`. The lexical `validatePath` only rejects empty /
 * `..`-prefixed / null-byte strings — it does not enforce the canonical-roots
 * list or canonical-member resolution. A caller could pass
 * `projectPath = '<directory outside configured allowed roots>'` and bypass
 * the canonical-root contract entirely; `scenePath` and `resourcePath` are
 * passed through verbatim to the Godot headless operation as `res://` paths
 * (with an auto-prepend fallback in the GDScript side), so a caller can also
 * pass `scenePath = '../etc/passwd'` or `'C:/Windows/System32/notepad.exe'`
 * and bypass the canonical-project-member contract.
 *
 * The request-boundary `assertSafeToolPaths` guard already rejects every
 * canonical member path that would escape the configured `PathPolicy` roots
 * BEFORE the handler is called, so the runtime is not exposed to a fresh
 * escape. This test proves the same contract is enforced *inside the handler
 * body itself* by invoking the private handler method directly (bypassing
 * `tools/call`) and asserting that a typed `isError: true` envelope is
 * returned for every documented escape attempt:
 *
 *   - `projectPath` outside the configured allowed roots
 *     (caught by `pathPolicy.assertProject`).
 *   - `scenePath` / `resourcePath` whose canonical realpath would resolve
 *     outside the project root (caught by `pathPolicy.resolveProjectMember`).
 *
 * The fixture is a temporary Godot project under the OS temp directory,
 * removed in `afterEach`. The test invokes the private handler methods via
 * `(server as any).handleXxx(args)` and stubs nothing relevant to the gate.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GodotServer } from '../src/server.js';
import { PathPolicy } from '../src/security/path-policy.js';
import { CapabilityPolicy } from '../src/security/capability-policy.js';

const tempRoots: string[] = [];

function makeProject(
  initialProjectGodot = '[application]\nconfig/name="ProjectManageSceneSignalsThemeResourceSceneStructureGate"\nfeatures=PackedStringArray("4.4")\n',
): { root: string; projectFile: string } {
  const root = mkdtempSync(join(tmpdir(), 'godot-mcp-manage-scene-signals-theme-resource-scene-structure-gate-'));
  tempRoots.push(root);
  const projectFile = join(root, 'project.godot');
  writeFileSync(projectFile, initialProjectGodot, 'utf8');
  return { root, projectFile };
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

describe('manage_scene_signals / manage_theme_resource / manage_scene_structure handlers adopt PathPolicy contract in their own body', () => {
  // ---------- handleManageSceneSignals ----------

  it('manage_scene_signals rejects a projectPath outside the configured allowed roots', async () => {
    const { root } = makeProject();
    const outside = mkdtempSync(join(tmpdir(), 'godot-mcp-manage-scene-signals-outside-'));
    tempRoots.push(outside);
    const server = makeServer(root);
    const response = await (server as any).handleManageSceneSignals({
      projectPath: outside,
      scenePath: 'res://main.tscn',
      action: 'list',
    });
    expect(response.isError).toBe(true);
    // The canonical-root gate fires BEFORE the `existsSync(project.godot)`
    // check, so the error must reference the allowed-roots policy, not a
    // missing-project file.
    expect(response.content[0].text).toMatch(/outside the (configured )?allowed roots/i);
    expect(response.content[0].text).not.toMatch(/Not a valid Godot project/i);
  });

  it('manage_scene_signals rejects a scenePath that would escape the project root via .. traversal', async () => {
    const { root } = makeProject();
    const server = makeServer(root);
    const response = await (server as any).handleManageSceneSignals({
      projectPath: root,
      scenePath: 'res://../etc/passwd',
      action: 'list',
    });
    expect(response.isError).toBe(true);
    // The canonical-project-member gate fires BEFORE the lexical project-root
    // check, so the error must reference the member-path policy, not a
    // missing-project file.
    expect(response.content[0].text).toMatch(/outside the project root|res\.|traverse|reject/i);
  });

  // ---------- handleManageThemeResource ----------

  it('manage_theme_resource rejects a projectPath outside the configured allowed roots', async () => {
    const { root } = makeProject();
    const outside = mkdtempSync(join(tmpdir(), 'godot-mcp-manage-theme-resource-outside-'));
    tempRoots.push(outside);
    const server = makeServer(root);
    const response = await (server as any).handleManageThemeResource({
      projectPath: outside,
      resourcePath: 'res://theme.tres',
      action: 'read',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/outside the (configured )?allowed roots/i);
    expect(response.content[0].text).not.toMatch(/Not a valid Godot project/i);
  });

  it('manage_theme_resource rejects a resourcePath that would escape the project root via .. traversal', async () => {
    const { root } = makeProject();
    const server = makeServer(root);
    const response = await (server as any).handleManageThemeResource({
      projectPath: root,
      resourcePath: 'res://../etc/passwd',
      action: 'read',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/outside the project root|res\.|traverse|reject/i);
  });

  // ---------- handleManageSceneStructure ----------

  it('manage_scene_structure rejects a projectPath outside the configured allowed roots', async () => {
    const { root } = makeProject();
    const outside = mkdtempSync(join(tmpdir(), 'godot-mcp-manage-scene-structure-outside-'));
    tempRoots.push(outside);
    const server = makeServer(root);
    const response = await (server as any).handleManageSceneStructure({
      projectPath: outside,
      scenePath: 'res://main.tscn',
      action: 'list',
      nodePath: 'root',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/outside the (configured )?allowed roots/i);
    expect(response.content[0].text).not.toMatch(/Not a valid Godot project/i);
  });

  it('manage_scene_structure rejects a scenePath that would escape the project root via .. traversal', async () => {
    const { root } = makeProject();
    const server = makeServer(root);
    const response = await (server as any).handleManageSceneStructure({
      projectPath: root,
      scenePath: 'res://../etc/passwd',
      action: 'list',
      nodePath: 'root',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/outside the project root|res\.|traverse|reject/i);
  });
});
