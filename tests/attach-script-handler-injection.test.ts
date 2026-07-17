/**
 * Wire-level regression for the canonical PathPolicy gate migration of
 * `handleAttachScript` (the last `headlessOp` caller that still relied
 * only on the shared helper's lexical `validatePath` boundary).
 *
 * The previous eight PathPolicy migration packages
 * (`core_file_io`, `manage_shader`, `set_main_scene`, `manage_translations`,
 * `manage_autoloads / manage_input_map / manage_export_presets`,
 * `manage_scene_signals / manage_theme_resource / manage_scene_structure`,
 * `create_project / create_csharp_script / validate_scripts`,
 * `info / scene / settings / sprite / mesh-library / export`) replaced
 * the lexical `validatePath(projectPath)` boundary with
 * `pathPolicy.assertProject(args.projectPath)` + `pathPolicy.resolveProjectMember
 * (projectRoot, args.<member>)` and a typed `isError: true` envelope
 * BEFORE any `headlessOp` delegation. `handleAttachScript` was the
 * one remaining `headlessOp` caller that delegated straight through
 * without that handler-body gate; the lexical `validatePath` inside
 * `headlessOp` only rejects empty / `..`-prefixed / null-byte strings
 * and does not enforce the canonical-roots list or canonical-member
 * resolution.
 *
 * The request-boundary `assertSafeToolPaths` guard already rejects every
 * canonical member path that would escape the configured `PathPolicy`
 * roots BEFORE the handler is called, so the runtime is not exposed to
 * a fresh escape. This test proves the same contract is enforced
 * *inside the handler body itself* by invoking the private handler
 * method directly (bypassing `tools/call`) and asserting that a typed
 * `isError: true` envelope is returned for every documented escape
 * attempt:
 *
 *   - `projectPath` outside the configured allowed roots
 *     (caught by `pathPolicy.assertProject`).
 *   - `scenePath` whose canonical realpath would resolve outside the
 *     project root (caught by `pathPolicy.resolveProjectMember`).
 *   - `scriptPath` whose canonical realpath would resolve outside the
 *     project root (caught by `pathPolicy.resolveProjectMember`).
 *   - absolute-path `scenePath` that is rejected by the canonical-member
 *     contract (proves the gate fires BEFORE any headless delegation or
 *     `isDotnetProject` check).
 *
 * The fixture is a temporary Godot project under the OS temp directory,
 * removed in `afterEach`. The test invokes the private handler method
 * via `(server as any).handleAttachScript(args)` and stubs nothing
 * relevant to the gate.
 */

import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GodotServer } from '../src/server.js';
import { PathPolicy } from '../src/security/path-policy.js';
import { CapabilityPolicy } from '../src/security/capability-policy.js';

const tempRoots: string[] = [];

function makeProject(): { root: string; projectFile: string } {
  const root = mkdtempSync(join(tmpdir(), 'godot-mcp-attach-script-handler-gate-'));
  tempRoots.push(root);
  const projectFile = join(root, 'project.godot');
  writeFileSync(
    projectFile,
    '[application]\nconfig/name="AttachScriptHandlerGate"\nfeatures=PackedStringArray("4.4")\n',
    'utf8',
  );
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

describe('handleAttachScript adopts the canonical PathPolicy contract in its own body', () => {
  it('rejects a projectPath outside the configured allowed roots', async () => {
    const { root } = makeProject();
    const outside = mkdtempSync(join(tmpdir(), 'godot-mcp-attach-script-outside-'));
    tempRoots.push(outside);
    const server = makeServer(root);
    const response = await (server as any).handleAttachScript({
      projectPath: outside,
      scenePath: 'scenes/Main.tscn',
      nodePath: 'root',
      scriptPath: 'scripts/player.gd',
    });
    expect(response.isError).toBe(true);
    // The canonical-root gate fires BEFORE the lexical `validatePath` inside
    // `headlessOp`, the `isDotnetProject(args.projectPath)` check, or any
    // `existsSync(join(projectRoot, 'project.godot'))` check, so the error
    // must reference the allowed-roots policy rather than the project file.
    expect(response.content[0].text).toMatch(/outside the (configured )?allowed roots/i);
    expect(response.content[0].text).not.toMatch(/Not a valid Godot project/i);
  });

  it('rejects a scenePath whose canonical realpath would escape the project root via .. traversal', async () => {
    const { root } = makeProject();
    const server = makeServer(root);
    const response = await (server as any).handleAttachScript({
      projectPath: root,
      scenePath: 'res://../etc/passwd',
      nodePath: 'root',
      scriptPath: 'scripts/player.gd',
    });
    expect(response.isError).toBe(true);
    // The canonical-project-member gate fires BEFORE the lexical
    // `validatePath` inside `headlessOp` and BEFORE the `isDotnetProject`
    // check, so the error must reference the member-path policy rather than
    // the project file.
    expect(response.content[0].text).toMatch(/outside the project root|res\.|traverse|reject|must be relative/i);
    expect(response.content[0].text).not.toMatch(/Not a valid Godot project/i);
  });

  it('rejects a scriptPath whose canonical realpath would escape the project root via .. traversal', async () => {
    const { root } = makeProject();
    const server = makeServer(root);
    const response = await (server as any).handleAttachScript({
      projectPath: root,
      scenePath: 'scenes/Main.tscn',
      nodePath: 'root',
      scriptPath: 'res://../etc/passwd.gd',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/outside the project root|res\.|traverse|reject|must be relative/i);
    expect(response.content[0].text).not.toMatch(/Not a valid Godot project/i);
  });

  it('rejects an absolute scenePath that escapes the project root via the canonical-member contract', async () => {
    const { root } = makeProject();
    const server = makeServer(root);
    const response = await (server as any).handleAttachScript({
      projectPath: root,
      scenePath: 'C:/Windows/System32/notepad.exe',
      nodePath: 'root',
      scriptPath: 'scripts/player.gd',
    });
    expect(response.isError).toBe(true);
    // The canonical-project-member gate fires BEFORE the lexical
    // `validatePath` inside `headlessOp` and BEFORE the `isDotnetProject`
    // check, so the error must reference the member-path policy rather than
    // the project file.
    expect(response.content[0].text).toMatch(/outside the project root|res\.|absolute|reject|must be relative/i);
    expect(response.content[0].text).not.toMatch(/Not a valid Godot project/i);
  });

  it('rejects an absolute scriptPath that escapes the project root via the canonical-member contract', async () => {
    const { root } = makeProject();
    const server = makeServer(root);
    const response = await (server as any).handleAttachScript({
      projectPath: root,
      scenePath: 'scenes/Main.tscn',
      nodePath: 'root',
      scriptPath: 'C:/Windows/System32/evil.cs',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/outside the project root|res\.|absolute|reject|must be relative/i);
    expect(response.content[0].text).not.toMatch(/Not a valid Godot project/i);
  });

  it('accepts a benign .gd attach_script call once the canonical gate validates the inputs', async () => {
    const { root } = makeProject();
    const scriptDir = join(root, 'scripts');
    mkdirSync(scriptDir, { recursive: true });
    writeFileSync(join(scriptDir, 'player.gd'), 'extends Node\n', 'utf8');
    const sceneDir = join(root, 'scenes');
    mkdirSync(sceneDir, { recursive: true });
    writeFileSync(join(sceneDir, 'Main.tscn'), '[gd_scene]\n', 'utf8');
    // Stub executeOperation so the test never spawns Godot and never leaves
    // the worktree dirty. The canonical-root gate must run BEFORE
    // executeOperation is reached.
    const server = makeServer(root);
    let executeOperationCalls = 0;
    (server as any).executeOperation = async () => {
      executeOperationCalls += 1;
      return {
        stdout: `attach_script ok`,
        stderr: '',
        result: { operation: 'attach_script', status: 'ok' as const },
      };
    };
    const response = await (server as any).handleAttachScript({
      projectPath: root,
      scenePath: 'scenes/Main.tscn',
      nodePath: 'root',
      scriptPath: 'scripts/player.gd',
    });
    expect(response.isError).toBeFalsy();
    expect(executeOperationCalls).toBe(1);
  });
});
