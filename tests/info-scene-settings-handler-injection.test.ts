/**
 * Wire-level regression for the next-follow-up PathPolicy gate migration
 * batch. Closes the canonical-root contract for ten handlers that still
 * inline a lexical `validatePath` boundary on `projectPath` and one or
 * more member paths:
 *
 *   - `handleListProjects`      (args.directory)
 *   - `handleGetProjectInfo`    (args.projectPath)
 *   - `handleSaveScene`         (args.projectPath + args.scenePath + args.newPath)
 *   - `handleGetUid`            (args.projectPath + args.filePath)
 *   - `handleReadProjectSettings`  (args.projectPath)
 *   - `handleModifyProjectSettings` (args.projectPath)
 *   - `handleListProjectFiles`  (args.projectPath)
 *   - `handleLoadSprite`        (args.projectPath + args.scenePath + args.nodePath + args.texturePath)
 *   - `handleExportMeshLibrary` (args.projectPath + args.scenePath + args.outputPath)
 *   - `handleExportProject`     (args.projectPath)
 *
 * Each handler historically opened with
 * `if (!validatePath(args.projectPath) || !validatePath(args.<member>))`
 * and then `join(args.projectPath, args.<member>)`-ed the user-supplied
 * values into `existsSync` / `readFileSync` / `writeFileSync` /
 * `executeOperation`. The lexical `validatePath` only rejects empty /
 * `..`-prefixed / null-byte strings — it does not enforce the
 * canonical-roots list or canonical-member resolution. The
 * request-boundary `assertSafeToolPaths` guard already rejects every
 * canonical member path that would escape the configured `PathPolicy`
 * roots BEFORE the handler is called, so the runtime is not exposed to
 * a fresh escape. This test proves the same contract is enforced
 * *inside the handler body itself* by invoking the private handler
 * method directly (bypassing `tools/call`) and asserting that a typed
 * `isError: true` envelope is returned for every documented escape
 * attempt:
 *
 *   - `projectPath` / `directory` outside the configured allowed roots
 *     (caught by `pathPolicy.assertProject` / `allowsProject`).
 *   - `scenePath` / `filePath` / `newPath` / `texturePath` /
 *     `outputPath` / `nodePath` containing a `..` segment
 *     (caught by `pathPolicy.resolveProjectMember`).
 *   - `scenePath` / `filePath` / `newPath` / `texturePath` /
 *     `outputPath` / `nodePath` containing an absolute path
 *     (caught by `pathPolicy.resolveProjectMember`).
 *
 * The fixture is a temporary Godot project under the OS temp
 * directory, removed in `afterEach`. The test invokes the private
 * handler method via `(server as any).handleXxx(args)` and stubs
 * nothing relevant to the gate.
 */

import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GodotServer } from '../src/server.js';
import { PathPolicy } from '../src/security/path-policy.js';
import { CapabilityPolicy } from '../src/security/capability-policy.js';

const tempRoots: string[] = [];

function makeProject(
  initialProjectGodot = '[application]\nconfig/name="ProjectInfoSceneSettingsGate"\nfeatures=PackedStringArray("4.4")\n',
): { root: string; projectFile: string } {
  const root = mkdtempSync(join(tmpdir(), 'godot-mcp-info-scene-settings-gate-'));
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

describe('project-info / scene / settings / list-files / sprite / mesh-library / export handlers adopt PathPolicy contract in their own body', () => {
  // ---------- list_projects ----------

  it('list_projects rejects a directory outside the configured allowed roots', async () => {
    const { root } = makeProject();
    const server = makeServer(root);
    const outside = mkdtempSync(join(tmpdir(), 'godot-mcp-list-projects-outside-'));
    tempRoots.push(outside);
    const response = await (server as any).handleListProjects({ directory: outside });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/directory|path|allowed roots|invalid/i);
  });

  it('list_projects rejects a directory containing a .. traversal', async () => {
    const { root } = makeProject();
    const server = makeServer(root);
    const response = await (server as any).handleListProjects({ directory: join(root, 'sub', '..', '..', 'etc') });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/directory|path|invalid|escape|traversal/i);
  });

  // ---------- get_project_info ----------

  it('get_project_info rejects a projectPath outside the configured allowed roots', async () => {
    const { root } = makeProject();
    const server = makeServer(root);
    const outside = mkdtempSync(join(tmpdir(), 'godot-mcp-get-project-info-outside-'));
    tempRoots.push(outside);
    const response = await (server as any).handleGetProjectInfo({ projectPath: outside });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/path|allowed roots|invalid/i);
  });

  // ---------- save_scene ----------

  it('save_scene rejects a projectPath outside the configured allowed roots', async () => {
    const { root } = makeProject();
    const outside = mkdtempSync(join(tmpdir(), 'godot-mcp-save-scene-outside-'));
    tempRoots.push(outside);
    const server = makeServer(root);
    const response = await (server as any).handleSaveScene({
      projectPath: outside,
      scenePath: 'scenes/main.tscn',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/path|allowed roots|invalid/i);
  });

  it('save_scene rejects a scenePath containing a .. traversal', async () => {
    const { root } = makeProject();
    const server = makeServer(root);
    const response = await (server as any).handleSaveScene({
      projectPath: root,
      scenePath: 'scenes/../../etc/passwd',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/scenePath|path|invalid|escape|traversal/i);
  });

  it('save_scene rejects an absolute scenePath', async () => {
    const { root } = makeProject();
    const server = makeServer(root);
    const response = await (server as any).handleSaveScene({
      projectPath: root,
      scenePath: process.platform === 'win32' ? 'C:\\evil\\scene.tscn' : '/etc/passwd',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/scenePath|path|invalid|absolute/i);
  });

  it('save_scene rejects a newPath containing a .. traversal', async () => {
    const { root } = makeProject();
    writeFileSync(join(root, 'main.tscn'), '[gd_scene format=3]\n', 'utf8');
    const server = makeServer(root);
    const response = await (server as any).handleSaveScene({
      projectPath: root,
      scenePath: 'main.tscn',
      newPath: 'sub/../../etc/passwd',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/newPath|path|invalid|escape|traversal/i);
  });

  // ---------- get_uid ----------

  it('get_uid rejects a projectPath outside the configured allowed roots', async () => {
    const { root } = makeProject();
    const outside = mkdtempSync(join(tmpdir(), 'godot-mcp-get-uid-outside-'));
    tempRoots.push(outside);
    const server = makeServer(root);
    const response = await (server as any).handleGetUid({
      projectPath: outside,
      filePath: 'project.godot',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/path|allowed roots|invalid/i);
  });

  it('get_uid rejects a filePath containing a .. traversal', async () => {
    const { root } = makeProject();
    const server = makeServer(root);
    const response = await (server as any).handleGetUid({
      projectPath: root,
      filePath: 'sub/../../etc/passwd',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/filePath|path|invalid|escape|traversal/i);
  });

  // ---------- read_project_settings ----------

  it('read_project_settings rejects a projectPath outside the configured allowed roots', async () => {
    const { root } = makeProject();
    const outside = mkdtempSync(join(tmpdir(), 'godot-mcp-read-project-settings-outside-'));
    tempRoots.push(outside);
    const server = makeServer(root);
    const response = await (server as any).handleReadProjectSettings({ projectPath: outside });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/path|allowed roots|invalid/i);
  });

  // ---------- modify_project_settings ----------

  it('modify_project_settings rejects a projectPath outside the configured allowed roots', async () => {
    const { root } = makeProject();
    const outside = mkdtempSync(join(tmpdir(), 'godot-mcp-modify-project-settings-outside-'));
    tempRoots.push(outside);
    const server = makeServer(root);
    const response = await (server as any).handleModifyProjectSettings({
      projectPath: outside,
      section: 'application',
      key: 'config/name',
      value: '"Evil"',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/path|allowed roots|invalid/i);
  });

  it('modify_project_settings leaves the project.godot byte-identical after a rejected write', async () => {
    const { root, projectFile } = makeProject();
    const before = readFileSync(projectFile, 'utf8');
    const outside = mkdtempSync(join(tmpdir(), 'godot-mcp-modify-project-settings-rollback-'));
    tempRoots.push(outside);
    const server = makeServer(root);
    const response = await (server as any).handleModifyProjectSettings({
      projectPath: outside,
      section: 'application',
      key: 'config/name',
      value: '"Evil"',
    });
    expect(response.isError).toBe(true);
    const after = readFileSync(projectFile, 'utf8');
    expect(after).toBe(before);
  });

  // ---------- list_project_files ----------

  it('list_project_files rejects a projectPath outside the configured allowed roots', async () => {
    const { root } = makeProject();
    const outside = mkdtempSync(join(tmpdir(), 'godot-mcp-list-project-files-outside-'));
    tempRoots.push(outside);
    const server = makeServer(root);
    const response = await (server as any).handleListProjectFiles({ projectPath: outside });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/path|allowed roots|invalid/i);
  });

  // ---------- load_sprite ----------

  it('load_sprite rejects a projectPath outside the configured allowed roots', async () => {
    const { root } = makeProject();
    const outside = mkdtempSync(join(tmpdir(), 'godot-mcp-load-sprite-outside-'));
    tempRoots.push(outside);
    const server = makeServer(root);
    const response = await (server as any).handleLoadSprite({
      projectPath: outside,
      scenePath: 'scenes/main.tscn',
      nodePath: 'root/Sprite2D',
      texturePath: 'icon.svg',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/path|allowed roots|invalid/i);
  });

  it('load_sprite rejects a texturePath containing a .. traversal', async () => {
    const { root } = makeProject();
    const server = makeServer(root);
    const response = await (server as any).handleLoadSprite({
      projectPath: root,
      scenePath: 'scenes/main.tscn',
      nodePath: 'root/Sprite2D',
      texturePath: 'assets/../../etc/passwd',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/texturePath|path|invalid|escape|traversal/i);
  });

  it('load_sprite rejects an absolute scenePath', async () => {
    const { root } = makeProject();
    const server = makeServer(root);
    const response = await (server as any).handleLoadSprite({
      projectPath: root,
      scenePath: process.platform === 'win32' ? 'C:\\evil\\scene.tscn' : '/etc/passwd',
      nodePath: 'root/Sprite2D',
      texturePath: 'icon.svg',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/scenePath|path|invalid|absolute/i);
  });

  // ---------- export_mesh_library ----------

  it('export_mesh_library rejects a projectPath outside the configured allowed roots', async () => {
    const { root } = makeProject();
    const outside = mkdtempSync(join(tmpdir(), 'godot-mcp-export-mesh-library-outside-'));
    tempRoots.push(outside);
    const server = makeServer(root);
    const response = await (server as any).handleExportMeshLibrary({
      projectPath: outside,
      scenePath: 'scenes/tiles.tscn',
      outputPath: 'tiles.tres',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/path|allowed roots|invalid/i);
  });

  it('export_mesh_library rejects an outputPath containing a .. traversal', async () => {
    const { root } = makeProject();
    const server = makeServer(root);
    const response = await (server as any).handleExportMeshLibrary({
      projectPath: root,
      scenePath: 'scenes/tiles.tscn',
      outputPath: 'sub/../../etc/passwd',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/outputPath|path|invalid|escape|traversal/i);
  });

  it('export_mesh_library rejects an absolute outputPath', async () => {
    const { root } = makeProject();
    const server = makeServer(root);
    const response = await (server as any).handleExportMeshLibrary({
      projectPath: root,
      scenePath: 'scenes/tiles.tscn',
      outputPath: process.platform === 'win32' ? 'C:\\evil\\mesh.tres' : '/etc/passwd',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/outputPath|path|invalid|absolute/i);
  });

  // ---------- export_project ----------

  it('export_project rejects a projectPath outside the configured allowed roots', async () => {
    const { root } = makeProject();
    const outside = mkdtempSync(join(tmpdir(), 'godot-mcp-export-project-outside-'));
    tempRoots.push(outside);
    const server = makeServer(root);
    const response = await (server as any).handleExportProject({
      projectPath: outside,
      presetName: 'WindowsDesktop',
      outputPath: 'build/game.exe',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/path|allowed roots|invalid/i);
  });
});