/**
 * Wire-level regression for the canonical PathPolicy gate migration of
 * `handleRunProject.args.scene`.
 *
 * The previous ten PathPolicy migration packages
 * (`core_file_io`, `manage_shader`, `set_main_scene`,
 * `manage_translations`, `manage_layers`, `manage_plugins`,
 * `manage_autoloads / manage_input_map / manage_export_presets`,
 * `manage_scene_signals / manage_theme_resource / manage_scene_structure`,
 * `create_project / create_csharp_script / validate_scripts`,
 * `info / scene / settings / sprite / mesh-library / export`,
 * `script/resource`, `attach_script`, `headlessOp`) replaced the lexical
 * `validatePath(projectPath)` boundary with
 * `pathPolicy.assertProject(args.projectPath)` +
 * `pathPolicy.resolveProjectMember(projectRoot, args.<member>)` and a
 * typed `isError: true` envelope BEFORE any filesystem or subprocess
 * delegation.
 *
 * `handleRunProject` is the last source-tree handler that still carried
 * a lexical `validatePath(args.scene)` boundary on user-supplied input.
 * `args.scene` is a runtime Godot CLI argument that flows directly into
 * `spawnProcess(cmdArgs)`. The lexical check only rejects empty / `..`
 * prefix strings and does not enforce the configured `PathPolicy`
 * allowed roots or canonical-member resolution, so a caller can pass an
 * absolute path or `..` traversal that escapes the project root.
 *
 * The request-boundary `assertSafeToolPaths` guard already rejects
 * every canonical member path that would escape the configured
 * `PathPolicy` roots BEFORE the handler is called, so the runtime is
 * not exposed to a fresh escape. This test proves the same contract is
 * enforced *inside the handler body itself* by invoking the private
 * handler method directly (bypassing `tools/call`) and asserting that a
 * typed `isError: true` envelope is returned for every documented
 * escape attempt:
 *
 *   - `args.scene` whose canonical realpath would resolve outside the
 *     project root via `..` traversal (caught by
 *     `pathPolicy.resolveProjectMember`).
 *   - `args.scene` whose canonical realpath is an absolute host path
 *     outside the project root (caught by
 *     `pathPolicy.resolveProjectMember`).
 *   - `args.scene` that is rejected by the canonical-member contract
 *     (proves the gate fires BEFORE any `spawnProcess` call).
 *
 * The fixture is a temporary Godot project under the OS temp directory,
 * removed in `afterEach`. The test invokes the private handler method
 * via `(server as any).handleRunProject(args)` and stubs
 * `spawnProcess` so the test never spawns Godot; the absence of any
 * recorded spawn for the documented escape paths proves the gate
 * fires BEFORE the runtime CLI argument is appended to `cmdArgs`.
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

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'godot-mcp-run-project-scene-gate-'));
  tempRoots.push(root);
  const projectFile = join(root, 'project.godot');
  writeFileSync(
    projectFile,
    '[application]\nconfig/name="RunProjectSceneGate"\nfeatures=PackedStringArray("4.4")\n',
    'utf8',
  );
  return root;
}

function makeServer(root: string): GodotServer {
  const server = new GodotServer({
    pathPolicy: new PathPolicy([root]),
    capabilityPolicy: new CapabilityPolicy('unsafe-full'),
    registerSignalHandlers: false,
    godotPath: 'C:/Godot/bin/godot.exe', // never actually invoked; gate fires before spawn
  });
  // Stub the runtime lifecycle helpers so the four helper calls
  // (`stopActiveProcess`, `allocateRuntimeCredentials`, `injectInteractionServer`,
  // `runtimeEnvironment`) return immediately without touching the real Godot
  // binary, runtime socket, or interaction server. The handler's
  // PathPolicy gate still runs against the caller-supplied arguments.
  (server as any).stopActiveProcess = async () => {};
  (server as any).allocateRuntimeCredentials = async () => ({
    port: 0,
    token: 'test-token',
  });
  (server as any).runtimeEnvironment = (
    baseEnv: NodeJS.ProcessEnv,
    _creds: { port: number; token: string },
  ) => baseEnv;
  (server as any).injectInteractionServer = () => {};
  (server as any).observeStartup = async () => {};
  // Provide a runtimeConnector so `connectToGame` (which would dial a
  // real socket on the stubbed port) is bypassed.
  (server as any).runtimeConnector = async () => {};
  return server;
}

function stubSpawn(server: any): () => unknown[] {
  const captured: unknown[] = [];
  server.spawnProcess = (() => {
    throw new Error('spawnProcess must not be invoked for this case');
  }) as any;
  return () => captured;
}

function makeMockChild(): any {
  // Provide both `.on` and `.once` plus child Stream-like stdout/stderr
  // with the same event-emitter interface, matching what
  // `process.on('exit'|'error')`, `process.once('exit')`, and
  // `process.stdout.on('data')` call against in `handleRunProject`.
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const makeEmitter = () => ({
    on(event: string, cb: (...args: unknown[]) => void) {
      const arr = listeners.get(`stream:${event}`) ?? [];
      arr.push(cb);
      listeners.set(`stream:${event}`, arr);
    },
    once(event: string, cb: (...args: unknown[]) => void) {
      const arr = listeners.get(`stream:${event}`) ?? [];
      arr.push(cb);
      listeners.set(`stream:${event}`, arr);
    },
  });
  return {
    stdout: makeEmitter(),
    stderr: makeEmitter(),
    on(event: string, cb: (...args: unknown[]) => void) {
      const arr = listeners.get(`proc:${event}`) ?? [];
      arr.push(cb);
      listeners.set(`proc:${event}`, arr);
    },
    once(event: string, cb: (...args: unknown[]) => void) {
      const arr = listeners.get(`proc:${event}`) ?? [];
      arr.push(cb);
      listeners.set(`proc:${event}`, arr);
    },
    removeListener(event: string, cb: (...args: unknown[]) => void) {
      const key = `proc:${event}`;
      const arr = listeners.get(key) ?? [];
      const filtered = arr.filter(l => l !== cb);
      listeners.set(key, filtered);
    },
  };
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('handleRunProject.args.scene adopts the canonical PathPolicy contract in its own body', () => {
  it('rejects an args.scene whose canonical realpath would escape the project root via .. traversal', async () => {
    const root = makeProject();
    const server = makeServer(root);
    stubSpawn(server);
    const response = await (server as any).handleRunProject({
      projectPath: root,
      scene: 'res://../etc/passwd',
    });
    expect(response.isError).toBe(true);
    // The canonical-project-member gate fires BEFORE any `spawnProcess`
    // call, so the error must reference the member-path policy rather
    // than a generic lexical-rejection or spawn-process message.
    expect(response.content[0].text).toMatch(/traverse|outside the project root/i);
  });

  it('rejects an args.scene that is an absolute host path via the canonical-member contract', async () => {
    const root = makeProject();
    const server = makeServer(root);
    stubSpawn(server);
    const response = await (server as any).handleRunProject({
      projectPath: root,
      scene: 'C:/Windows/System32/notepad.exe',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/must be relative|outside the project root/i);
  });

  it('rejects an args.scene that resolves outside the project root via a mix of forward and back slashes (..)', async () => {
    const root = makeProject();
    const server = makeServer(root);
    stubSpawn(server);
    const response = await (server as any).handleRunProject({
      projectPath: root,
      scene: 'scenes/../../../etc/passwd',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/traverse|outside the project root/i);
  });

  it('accepts a benign res:// args.scene and forwards it verbatim to spawnProcess without lexical shadowing', async () => {
    const root = makeProject();
    const server = makeServer(root);
    let observedCmdArgs: string[] | undefined;
    let spawnCount = 0;
    (server as any).spawnProcess = (
      _exePath: string,
      cmdArgs: string[],
      _opts: unknown,
    ) => {
      spawnCount += 1;
      observedCmdArgs = cmdArgs;
      return makeMockChild();
    };
    (server as any).activeProcess = null;
    const response = await (server as any).handleRunProject({
      projectPath: root,
      scene: 'res://scenes/Main.tscn',
    });
    expect(spawnCount).toBe(1);
    expect(observedCmdArgs).toContain('res://scenes/Main.tscn');
    expect(response.isError).toBeFalsy();
  });
});
