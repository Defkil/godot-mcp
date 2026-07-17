/**
 * Wire-level regression for the next-follow-up PathPolicy gate migration
 * batch. Closes the canonical-root contract for the three sibling handlers
 * that still inline a lexical `validatePath` boundary on `projectPath`:
 *
 *   - `handleManageAutoloads`      (args.projectPath)
 *   - `handleManageInputMap`      (args.projectPath)
 *   - `handleManageExportPresets` (args.projectPath)
 *
 * Each handler historically opened with
 * `if (!validatePath(args.projectPath)) return createErrorResponse('Invalid path.')`
 * and then `join(args.projectPath, 'project.godot')`-ed the user-supplied
 * value into `existsSync` / `readFileSync` / `writeFileSync`. The lexical
 * `validatePath` only rejects empty / `..`-prefixed / null-byte strings —
 * it does not enforce the canonical-roots list. The request-boundary
 * `assertSafeToolPaths` guard already rejects every projectPath that
 * escapes the configured `PathPolicy` roots BEFORE the handler is called,
 * so the runtime is not exposed to a fresh escape. This test proves the
 * same contract is enforced *inside the handler body itself* by invoking
 * the private handler method directly (bypassing `tools/call`) and
 * asserting that a typed `isError: true` envelope is returned for every
 * documented escape attempt:
 *
 *   - `projectPath` outside the configured allowed roots
 *     (caught by `pathPolicy.assertProject`).
 *   - `projectPath` whose canonical realpath does not contain a
 *     `project.godot` is still rejected as outside the allowed roots
 *     BEFORE any `existsSync(join(projectPath, 'project.godot'))` check.
 *
 * The fixture is a temporary Godot project under the OS temp
 * directory, removed in `afterEach`. The test invokes the private
 * handler method via `(server as any).handleXxx(args)` and stubs
 * nothing relevant to the gate.
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
  initialProjectGodot = '[application]\nconfig/name="ProjectManageAutoloadsInputMapExportPresetsGate"\nfeatures=PackedStringArray("4.4")\n',
): { root: string; projectFile: string } {
  const root = mkdtempSync(join(tmpdir(), 'godot-mcp-manage-autoloads-input-map-export-presets-gate-'));
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

describe('manage_autoloads / manage_input_map / manage_export_presets handlers adopt PathPolicy contract in their own body', () => {
  // ---------- handleManageAutoloads ----------

  it('manage_autoloads rejects a projectPath outside the configured allowed roots', async () => {
    const { root } = makeProject();
    const outside = mkdtempSync(join(tmpdir(), 'godot-mcp-manage-autoloads-outside-'));
    tempRoots.push(outside);
    const server = makeServer(root);
    const response = await (server as any).handleManageAutoloads({
      projectPath: outside,
      action: 'list',
    });
    expect(response.isError).toBe(true);
    // The canonical-root gate fires BEFORE the `existsSync(project.godot)`
    // check, so the error must reference the allowed-roots policy, not a
    // missing-project file.
    expect(response.content[0].text).toMatch(/outside the (configured )?allowed roots/i);
    expect(response.content[0].text).not.toMatch(/Not a valid Godot project/i);
  });

  it('manage_autoloads rejects an add request whose projectPath is outside the configured allowed roots', async () => {
    const { root } = makeProject();
    const outside = mkdtempSync(join(tmpdir(), 'godot-mcp-manage-autoloads-add-outside-'));
    tempRoots.push(outside);
    const server = makeServer(root);
    const response = await (server as any).handleManageAutoloads({
      projectPath: outside,
      action: 'add',
      name: 'MyAutoload',
      path: 'res://autoload.gd',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/outside the (configured )?allowed roots/i);
    expect(response.content[0].text).not.toMatch(/Not a valid Godot project/i);
  });

  // ---------- handleManageInputMap ----------

  it('manage_input_map rejects a projectPath outside the configured allowed roots', async () => {
    const { root } = makeProject();
    const outside = mkdtempSync(join(tmpdir(), 'godot-mcp-manage-input-map-outside-'));
    tempRoots.push(outside);
    const server = makeServer(root);
    const response = await (server as any).handleManageInputMap({
      projectPath: outside,
      action: 'list',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/outside the (configured )?allowed roots/i);
    expect(response.content[0].text).not.toMatch(/Not a valid Godot project/i);
  });

  it('manage_input_map rejects an add request whose projectPath is outside the configured allowed roots', async () => {
    const { root } = makeProject();
    const outside = mkdtempSync(join(tmpdir(), 'godot-mcp-manage-input-map-add-outside-'));
    tempRoots.push(outside);
    const server = makeServer(root);
    const response = await (server as any).handleManageInputMap({
      projectPath: outside,
      action: 'add',
      actionName: 'jump',
      key: 'SPACE',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/outside the (configured )?allowed roots/i);
    expect(response.content[0].text).not.toMatch(/Not a valid Godot project/i);
  });

  // ---------- handleManageExportPresets ----------

  it('manage_export_presets rejects a projectPath outside the configured allowed roots', async () => {
    const { root } = makeProject();
    const outside = mkdtempSync(join(tmpdir(), 'godot-mcp-manage-export-presets-outside-'));
    tempRoots.push(outside);
    const server = makeServer(root);
    const response = await (server as any).handleManageExportPresets({
      projectPath: outside,
      action: 'list',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/outside the (configured )?allowed roots/i);
    expect(response.content[0].text).not.toMatch(/Not a valid Godot project/i);
  });

  it('manage_export_presets rejects an add request whose projectPath is outside the configured allowed roots', async () => {
    const { root } = makeProject();
    const outside = mkdtempSync(join(tmpdir(), 'godot-mcp-manage-export-presets-add-outside-'));
    tempRoots.push(outside);
    const server = makeServer(root);
    const response = await (server as any).handleManageExportPresets({
      projectPath: outside,
      action: 'add',
      name: 'WindowsDesktop',
      platform: 'Windows Desktop',
      runnable: true,
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/outside the (configured )?allowed roots/i);
    expect(response.content[0].text).not.toMatch(/Not a valid Godot project/i);
  });
});
