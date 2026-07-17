/**
 * Wire-level regression for [Coding-Solo#103] — detect a missing Godot 4.4+
 * `.import` sidecar before the operation runner is reached, and surface a
 * typed diagnostic with the exact project-root path and the Godot CLI command
 * the user needs to run.
 *
 * Godot 4.4+ ships an import-on-open pipeline; assets a caller asks
 * `load_sprite` / `create_resource` / `manage_resource` to load get
 * registered through `<asset>.import` sidecars that the editor writes the
 * first time it scans the project. Prior to this package, the server blindly
 * forwarded `texturePath` / `resourcePath` to the Godot headless op, which
 * then printed a noisy import warning and silently produced `null` for
 * textures (`var texture = load(full_texture_path) → null`). The defect
 * started as a UX report (#103) but it is also a release-readiness issue
 * because every tool that loads a binary asset has the same failure mode.
 *
 * The package:
 *   1. adds a pure `detectAssetImportState` helper in
 *      `src/godot/asset-import-state.ts` that resolves the asset through
 *      the OS-native `node:path` resolver, classifies the result against
 *      an exhaustive allowlist of import-eligible extensions, and reports
 *      whether the matching `.import` sidecar is present;
 *   2. wires the helper into `handleLoadSprite`, `handleCreateResource`,
 *      and `handleManageResource` so the typed diagnostic is returned
 *      BEFORE `executeOperation` is reached;
 *   3. preserves every existing success path; passes the gate when the
 *      sidecar is present, when the path is not an import-eligible asset
 *      (`.gd` / `.cs` / `.tres` / `.tscn` / `.uid`), or when the project
 *      root has never been imported (any asset fails, with a single
 *      actionable diagnostic covering every missing-sidecar path);
 *   4. carries `Coding-Solo#103` from `open` to `partial` in
 *      `docs/maintainers/issue-inventory.md`.
 *
 * The fixture is a temporary Godot project under the OS temp directory that
 * is removed in `afterEach`. The test exercises the real
 * `GodotServer` + `PathPolicy` + `CapabilityPolicy` + MCP `tools/call`
 * dispatch by stubbing the headless `executeOperation` so a successful
 * call still observably reaches the runner, and a rejected call does not.
 */

import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GodotServer } from '../src/server.js';
import { PathPolicy } from '../src/security/path-policy.js';
import { CapabilityPolicy } from '../src/security/capability-policy.js';
import {
  detectAssetImportState,
  resolveAssetImportRequirement,
} from '../src/godot/asset-import-state.js';

const tempRoots: string[] = [];

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'godot-mcp-asset-import-'));
  tempRoots.push(root);
  writeFileSync(
    join(root, 'project.godot'),
    '[application]\nconfig/name="AssetImportGate"\nfeatures=PackedStringArray("4.4")\n',
    'utf8',
  );
  return root;
}

function writeFile(root: string, relativePath: string, content = 'data'): string {
  const fullPath = join(root, relativePath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content, 'utf8');
  return fullPath;
}

function writeAsset(root: string, relativePath: string, withSidecar: boolean): string {
  const fullPath = writeFile(root, relativePath, 'binary-asset-stub');
  if (withSidecar) {
    mkdirSync(dirname(`${fullPath}.import`), { recursive: true });
    writeFileSync(`${fullPath}.import`, '[remap]\nimporter="texture"\n', 'utf8');
  }
  return relativePath;
}

function stubRunner() {
  return vi.fn(async (operation: string, params: Record<string, unknown>, _projectPath: string) => ({
    stdout: `op ${operation} ok`,
    stderr: '',
    result: { operation, status: 'ok' as const, params },
  }));
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

function getError(response: any): string | undefined {
  if (response?.isError === true) {
    return response?.content?.[0]?.text;
  }
  return undefined;
}

function isHappy(response: any): boolean {
  return response?.isError !== true && Array.isArray(response?.content);
}

function makeServer(root: string, runnerSpy = stubRunner()): GodotServer {
  const server = new GodotServer({
    pathPolicy: new PathPolicy([root]),
    capabilityPolicy: new CapabilityPolicy('unsafe-full'),
    registerSignalHandlers: false,
  });
  (server as any).executeOperation = runnerSpy;
  return server;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('detectAssetImportState — pure helper (Coding-Solo#103)', () => {
  it('reports "imported" when the .import sidecar is present', () => {
    const root = makeProject();
    writeAsset(root, 'assets/icon.png', true);
    const result = detectAssetImportState(root, 'assets/icon.png', {
      exists: existsSync,
    });
    expect(result.state).toBe('imported');
    expect(result.sidecarPath).toBe('assets/icon.png.import');
  });

  it('reports "missing-sidecar" when the asset lacks its .import sidecar', () => {
    const root = makeProject();
    writeAsset(root, 'assets/icon.png', false);
    const result = detectAssetImportState(root, 'assets/icon.png', {
      exists: existsSync,
    });
    expect(result.state).toBe('missing-sidecar');
    expect(result.extension).toBe('.png');
    expect(result.diagnostic).toMatch(/icon\.png/);
    expect(result.diagnostic).toMatch(/\.import/);
  });

  it('reports "not-an-asset" for paths that have no sidecar requirement', () => {
    const root = makeProject();
    writeFile(root, 'scripts/player.gd', 'extends Node\n');
    const result = detectAssetImportState(root, 'scripts/player.gd', {
      exists: existsSync,
    });
    expect(result.state).toBe('not-an-asset');
  });

  it('rejects paths outside the project root with a typed diagnostic', () => {
    const root = makeProject();
    expect(() =>
      detectAssetImportState(root, '../etc/passwd', { exists: existsSync }),
    ).toThrow(/cannot traverse outside the project root/i);
  });

  it('rejects absolute paths with a typed diagnostic', () => {
    const root = makeProject();
    const absolutePath = process.platform === 'win32'
      ? `C:${sep}Windows${sep}System32${sep}notepad.exe`
      : '/usr/bin/not-a-real-binary';
    expect(() =>
      detectAssetImportState(root, absolutePath, { exists: existsSync }),
    ).toThrow(/relative/i);
  });

  it('reports "missing-source" when the asset itself does not exist on disk', () => {
    const root = makeProject();
    const result = detectAssetImportState(root, 'assets/missing.png', {
      exists: existsSync,
    });
    expect(result.state).toBe('missing-source');
    expect(result.diagnostic).toMatch(/missing\.png/);
  });

  it.each(['data.json', 'archive.pck'])(
    'does not require an .import sidecar for non-import file %s', (relativePath) => {
      const root = makeProject();
      writeFile(root, relativePath, 'resource data');
      const result = detectAssetImportState(root, relativePath, {
        exists: existsSync,
      });
      expect(result.state).toBe('not-an-asset');
      expect(result.diagnostic).not.toMatch(/--import/);
    },
  );
});

describe('resolveAssetImportRequirement — actionable remediation string', () => {
  it('names the exact project-root path and the Godot CLI command to import', () => {
    const root = makeProject();
    writeAsset(root, 'assets/icon.svg', false);
    const result = resolveAssetImportRequirement(root, 'assets/icon.svg');
    expect(result).toContain('assets/icon.svg');
    expect(result).toContain('--import');
    expect(result).toContain(root);
  });
});

describe('handleLoadSprite — wire-level preflight (Coding-Solo#103)', () => {
  it('rejects a PNG with no .import sidecar and never calls executeOperation', async () => {
    const root = makeProject();
    const texturePath = writeAsset(root, 'art/missing-sidecar.png', false);
    // load_sprite requires an existing scene to even reach the texture
    // path-check; create one so the preflight is exercised at the right
    // location rather than failing the earlier scene-existence check.
    writeFile(root, 'scenes/Main.tscn', '[gd_scene]\n');
    const runnerSpy = stubRunner();
    const server = makeServer(root, runnerSpy);
    const response = await toolsCall(server, 'load_sprite', {
      projectPath: root,
      scenePath: 'scenes/Main.tscn',
      nodePath: 'root/Sprite',
      texturePath,
    });
    const errorText = getError(response);
    expect(errorText).toBeDefined();
    expect(errorText).toMatch(/missing-sidecar\.png/);
    expect(errorText).toMatch(/\.import/);
    expect(errorText).toMatch(/--import/);
    expect(runnerSpy).not.toHaveBeenCalled();
  });

  it('still forwards a PNG with a sidecar to executeOperation', async () => {
    const root = makeProject();
    const texturePath = writeAsset(root, 'art/with-sidecar.png', true);
    writeFile(root, 'scenes/Main.tscn', '[gd_scene]\n');
    const runnerSpy = stubRunner();
    const server = makeServer(root, runnerSpy);
    const response = await toolsCall(server, 'load_sprite', {
      projectPath: root,
      scenePath: 'scenes/Main.tscn',
      nodePath: 'root/Sprite',
      texturePath,
    });
    expect(isHappy(response)).toBe(true);
    expect(getError(response)).toBeUndefined();
    expect(runnerSpy).toHaveBeenCalledOnce();
    expect(runnerSpy.mock.calls[0][0]).toBe('load_sprite');
  });

  it('passes a non-asset path (e.g. .gd) through the gate', async () => {
    const root = makeProject();
    writeFile(root, 'scripts/player.gd', 'extends Node\n');
    writeFile(root, 'scenes/Main.tscn', '[gd_scene]\n');
    const runnerSpy = stubRunner();
    const server = makeServer(root, runnerSpy);
    const response = await toolsCall(server, 'load_sprite', {
      projectPath: root,
      scenePath: 'scenes/Main.tscn',
      nodePath: 'root/Sprite',
      texturePath: 'scripts/player.gd',
    });
    expect(isHappy(response)).toBe(true);
    expect(getError(response)).toBeUndefined();
    expect(runnerSpy).toHaveBeenCalledOnce();
  });
});

describe('handleCreateResource — wire-level preflight (Coding-Solo#103)', () => {
  it('rejects a PNG create_resource call when the source asset has no .import sidecar', async () => {
    const root = makeProject();
    writeFile(root, 'sprites/raw.png', 'data');
    const runnerSpy = stubRunner();
    const server = makeServer(root, runnerSpy);
    const response = await toolsCall(server, 'create_resource', {
      projectPath: root,
      resourceType: 'Texture2D',
      resourcePath: 'sprites/raw.png',
    });
    const errorText = getError(response);
    expect(errorText).toBeDefined();
    expect(errorText).toMatch(/raw\.png/);
    expect(errorText).toMatch(/\.import/);
    expect(runnerSpy).not.toHaveBeenCalled();
  });

  it('passes a non-import-eligible resourcePath (e.g. .tres) through the gate', async () => {
    const root = makeProject();
    writeFile(root, 'data.tres', 'data');
    const runnerSpy = stubRunner();
    const server = makeServer(root, runnerSpy);
    const response = await toolsCall(server, 'create_resource', {
      projectPath: root,
      resourceType: 'Resource',
      resourcePath: 'data.tres',
    });
    expect(isHappy(response)).toBe(true);
    expect(getError(response)).toBeUndefined();
    expect(runnerSpy).toHaveBeenCalledOnce();
  });
});

describe('handleManageResource — wire-level preflight (Coding-Solo#103)', () => {
  it('rejects a `load` action on a PNG with no .import sidecar', async () => {
    const root = makeProject();
    writeFile(root, 'sprites/raw.png', 'data');
    const runnerSpy = stubRunner();
    const server = makeServer(root, runnerSpy);
    const response = await toolsCall(server, 'manage_resource', {
      projectPath: root,
      resourcePath: 'sprites/raw.png',
      action: 'load',
    });
    const errorText = getError(response);
    expect(errorText).toBeDefined();
    expect(errorText).toMatch(/raw\.png/);
    expect(runnerSpy).not.toHaveBeenCalled();
  });

  it('does NOT block non-load actions (e.g. `create`/`delete`)', async () => {
    const root = makeProject();
    writeFile(root, 'data.tres', 'data');
    const runnerSpy = stubRunner();
    const server = makeServer(root, runnerSpy);
    const createResponse = await toolsCall(server, 'manage_resource', {
      projectPath: root,
      resourcePath: 'data.tres',
      action: 'create',
    });
    expect(isHappy(createResponse)).toBe(true);
    expect(runnerSpy).toHaveBeenCalled();
    const deleteResponse = await toolsCall(server, 'manage_resource', {
      projectPath: root,
      resourcePath: 'data.tres',
      action: 'delete',
    });
    expect(isHappy(deleteResponse)).toBe(true);
    expect(runnerSpy).toHaveBeenCalledTimes(2);
  });
});
