/**
 * Wire-level regression for the canonical PathPolicy gate inside the shared
 * `GodotServer.headlessOp` helper.
 *
 * The previous nine PathPolicy migration packages (`core_file_io`,
 * `manage_shader`, `set_main_scene`, `manage_translations`,
 * `manage_autoloads / manage_input_map / manage_export_presets`,
 * `manage_scene_signals / manage_theme_resource / manage_scene_structure`,
 * `create_project / create_csharp_script / validate_scripts`,
 * `info / scene / settings / sprite / mesh-library / export`, and the
 * `handleAttachScript` repair) replaced the lexical
 * `validatePath(projectPath)` boundary inside every `headlessOp` caller
 * with `pathPolicy.assertProject(args.projectPath)` +
 * `pathPolicy.resolveProjectMember(projectRoot, args.<member>)` and a
 * typed `isError: true` envelope BEFORE any `headlessOp` delegation.
 *
 * The lexical `validatePath` boundary inside `headlessOp` itself only
 * rejects empty / `..` / null-byte strings and does not enforce the
 * configured `PathPolicy` allowed roots; the request-boundary
 * `assertSafeToolPaths` guard catches canonical-root violations on the
 * public `CallToolRequest` path, but the private handler methods can
 * still call `headlessOp` with an untrusted `projectPath` when the
 * handler body skips the canonical-root gate. To make the shared helper
 * the single source of truth for the headless-operation path, the
 * lexical `validatePath` boundary was replaced with
 * `pathPolicy.assertProject(projectPath)`. The shared helper now returns
 * a typed `Project path is outside the configured allowed roots: …`
 * envelope BEFORE the project-file existence check, BEFORE the operation
 * runner spawns Godot, and BEFORE any stderr escapes into the caller.
 *
 * The fixture is a temporary Godot project under the OS temp directory,
 * removed in `afterEach`. The test invokes the private `headlessOp`
 * helper directly (bypassing `tools/call`) and asserts the canonical
 * PathPolicy envelope is returned for every documented escape attempt.
 */

import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GodotServer } from '../src/server.js';
import { PathPolicy } from '../src/security/path-policy.js';
import { CapabilityPolicy } from '../src/security/capability-policy.js';

const tempRoots: string[] = [];

function makeProject(): { root: string; projectFile: string } {
  const root = mkdtempSync(join(tmpdir(), 'godot-mcp-headless-op-path-policy-gate-'));
  tempRoots.push(root);
  const projectFile = join(root, 'project.godot');
  writeFileSync(
    projectFile,
    '[application]\nconfig/name="HeadlessOpPathPolicyGate"\nfeatures=PackedStringArray("4.4")\n',
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
  while (tempRoots.length > 0) {
    const root = tempRoots.pop()!;
    rmSync(root, { recursive: true, force: true });
  }
});

describe('headlessOp enforces the canonical PathPolicy contract in its own body', () => {
  it('rejects a projectPath outside the configured allowed roots with the canonical-root envelope', async () => {
    const { root } = makeProject();
    const outside = mkdtempSync(join(tmpdir(), 'godot-mcp-headless-op-outside-'));
    tempRoots.push(outside);
    const server = makeServer(root);
    const response = await (server as any).headlessOp(
      'noop_probe',
      { projectPath: outside, params: {} },
      (a: any) => ({ projectPath: a.projectPath, params: a.params }),
    );
    expect(response.isError).toBe(true);
    // The canonical-root gate fires BEFORE the project-file existence
    // check and BEFORE the operation runner, so the error must reference
    // the allowed-roots policy rather than the project file.
    expect(response.content[0].text).toMatch(/outside the (configured )?allowed roots/i);
    expect(response.content[0].text).not.toMatch(/Not a valid Godot project/i);
  });

  it('rejects a relative projectPath that would resolve outside the allowed roots via .. traversal', async () => {
    const { root } = makeProject();
    const server = makeServer(root);
    const response = await (server as any).headlessOp(
      'noop_probe',
      { projectPath: '../escape-target', params: {} },
      (a: any) => ({ projectPath: a.projectPath, params: a.params }),
    );
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/outside the (configured )?allowed roots/i);
  });

  it('rejects an absolute projectPath that is not under the configured allowed roots', async () => {
    const { root } = makeProject();
    const server = makeServer(root);
    // Use a Windows-system path that exists and is outside any plausible
    // allowed root; the test must NOT spawn Godot or read the project
    // file, because the canonical-root gate fires first.
    const response = await (server as any).headlessOp(
      'noop_probe',
      { projectPath: 'C:/Windows/System32', params: {} },
      (a: any) => ({ projectPath: a.projectPath, params: a.params }),
    );
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/outside the (configured )?allowed roots/i);
  });

  it('still rejects empty / undefined projectPath with the existing message (no regression)', async () => {
    const { root } = makeProject();
    const server = makeServer(root);
    const response = await (server as any).headlessOp(
      'noop_probe',
      { params: {} },
      (a: any) => ({ projectPath: a.projectPath, params: a.params }),
    );
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/projectPath is required/i);
  });

  it('forwards the canonical project root to the operation runner (no lexical shadowing)', async () => {
    const { root } = makeProject();
    const server = makeServer(root);
    let observedOperationProjectPath: string | undefined;
    (server as any).executeOperation = async (
      _operation: string,
      _params: unknown,
      projectPath: string,
    ) => {
      observedOperationProjectPath = projectPath;
      return {
        stdout: 'noop_probe ok',
        stderr: '',
        result: { operation: 'noop_probe', status: 'ok' as const },
      };
    };
    const response = await (server as any).headlessOp(
      'noop_probe',
      { projectPath: `${root}/./`, params: {} },
      (a: any) => ({ projectPath: a.projectPath, params: a.params }),
    );
    expect(response.isError).toBeFalsy();
    // The shared helper must canonicalize the project root before
    // delegating to the operation runner; the operation must observe
    // the canonical path, not the caller's non-canonical spelling.
    expect(observedOperationProjectPath).toBe(root);
  });
});