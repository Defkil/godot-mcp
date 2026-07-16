/**
 * Wire-level regression for [Coding-Solo#114] — `attach_script` C# / .NET
 * project gate.
 *
 * `handleCreateCsharpScript` already rejects `scriptPath` ending in `.cs` when
 * the project is not a Godot .NET project (no `.csproj` on disk). The
 * matching `attach_script` handler, however, blindly forwarded every script
 * path to the Godot `attach_script` operation. The GDScript side just calls
 * `load()` + `set_script()`, which silently no-ops for `.cs` files on a
 * non-.NET project (and conversely warns when a `.gd` is attached to a C#
 * project that has not built that script). The package:
 *
 *   1. adds a typed gate in `handleAttachScript` that rejects `.cs` scripts
 *      against non-.NET projects with the same diagnostic
 *      `create_csharp_script` already uses;
 *   2. accepts `.gd` scripts on every project type;
 *   3. accepts `.cs` scripts on .NET projects (no false reject);
 *   4. exercises the gate through the real MCP `tools/call` boundary with
 *      a scripted `executeOperation` so the test never spawns Godot and
 *      never leaves the worktree dirty.
 *
 * The fixture is a temporary Godot project under the OS temp directory that
 * is removed in `afterEach`. No `.csproj` is created, so the gate must fire
 * when the script path ends in `.cs`.
 */

import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GodotServer } from '../src/server.js';
import { PathPolicy } from '../src/security/path-policy.js';
import { CapabilityPolicy } from '../src/security/capability-policy.js';

const tempRoots: string[] = [];

function makePlainProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'godot-mcp-attach-cs-gate-'));
  tempRoots.push(root);
  writeFileSync(
    join(root, 'project.godot'),
    '[application]\nconfig/name="AttachCsGate"\nfeatures=PackedStringArray("4.4")\n',
    'utf8',
  );
  return root;
}

function makeDotnetProject(): string {
  const root = makePlainProject();
  writeFileSync(join(root, 'Game.csproj'), '<Project Sdk="Godot.NET.Sdk/4.4.0" />\n', 'utf8');
  return root;
}

function stubRunner() {
  return vi.fn(async (operation: string, _params: Record<string, unknown>, _projectPath: string) => ({
    stdout: `op ${operation} ok`,
    stderr: '',
    result: { operation, status: 'ok' as const },
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

function makeServer(root: string, runnerSpy = stubRunner()): GodotServer {
  const server = new GodotServer({
    pathPolicy: new PathPolicy([root]),
    capabilityPolicy: new CapabilityPolicy('unsafe-full'),
    registerSignalHandlers: false,
  });
  // Replace the headless executeOperation with a stub so the test never
  // spawns Godot. The C# gate must run BEFORE executeOperation is reached.
  (server as any).executeOperation = runnerSpy;
  return server;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('attach_script C# / .NET project gate (Coding-Solo#114)', () => {
  it('rejects a .cs script on a plain (non-.NET) Godot project', async () => {
    const root = makePlainProject();
    const runnerSpy = stubRunner();
    const server = makeServer(root, runnerSpy);
    const response = await toolsCall(server, 'attach_script', {
      projectPath: root,
      scenePath: 'scenes/Main.tscn',
      nodePath: 'root',
      scriptPath: 'scripts/Player.cs',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/not a godot \.net project/i);
    expect(response.content[0].text).toMatch(/\.csproj/i);
    // The headless op must NOT be reached when the gate rejects.
    expect(runnerSpy).not.toHaveBeenCalled();
  });

  it('accepts a .cs script on a .NET Godot project (no false reject)', async () => {
    const root = makeDotnetProject();
    const runnerSpy = stubRunner();
    const server = makeServer(root, runnerSpy);
    // Provide a real-looking .cs file so the headless stub does not crash on
    // unrelated filesystem checks. The C# gate runs before any file checks.
    const scriptDir = join(root, 'scripts');
    mkdirSync(scriptDir, { recursive: true });
    writeFileSync(join(scriptDir, 'Player.cs'), 'public partial class Player : Node {}\n', 'utf8');
    const sceneDir = join(root, 'scenes');
    mkdirSync(sceneDir, { recursive: true });
    writeFileSync(join(sceneDir, 'Main.tscn'), '[gd_scene]\n', 'utf8');
    const response = await toolsCall(server, 'attach_script', {
      projectPath: root,
      scenePath: 'scenes/Main.tscn',
      nodePath: 'root',
      scriptPath: 'scripts/Player.cs',
    });
    // The headless stub returns a successful envelope; the gate must NOT
    // inject a typed error envelope for a valid (.NET + .cs) combination.
    expect(response.isError).toBeFalsy();
    expect(runnerSpy).toHaveBeenCalledTimes(1);
    // The stub replaces executeOperation directly, so it sees the
    // camelCase params headlessOp forwards; the shared runner would
    // additionally convert to snake_case before talking to Godot.
    const [operation, params, projectPath] = runnerSpy.mock.calls[0];
    expect(operation).toBe('attach_script');
    expect(params).toMatchObject({
      scenePath: 'scenes/Main.tscn',
      nodePath: 'root',
      scriptPath: 'scripts/Player.cs',
    });
    expect(projectPath).toBe(root);
  });

  it('accepts a .gd script on a plain (non-.NET) project', async () => {
    const root = makePlainProject();
    const runnerSpy = stubRunner();
    const server = makeServer(root, runnerSpy);
    const scriptDir = join(root, 'scripts');
    mkdirSync(scriptDir, { recursive: true });
    writeFileSync(join(scriptDir, 'player.gd'), 'extends Node\n', 'utf8');
    const sceneDir = join(root, 'scenes');
    mkdirSync(sceneDir, { recursive: true });
    writeFileSync(join(sceneDir, 'Main.tscn'), '[gd_scene]\n', 'utf8');
    const response = await toolsCall(server, 'attach_script', {
      projectPath: root,
      scenePath: 'scenes/Main.tscn',
      nodePath: 'root',
      scriptPath: 'scripts/player.gd',
    });
    expect(response.isError).toBeFalsy();
    expect(runnerSpy).toHaveBeenCalledTimes(1);
    // The stub replaces executeOperation directly, so it sees the
    // camelCase params headlessOp forwards; the shared runner would
    // additionally convert to snake_case before talking to Godot.
    const [operation, params, projectPath] = runnerSpy.mock.calls[0];
    expect(operation).toBe('attach_script');
    expect(params).toMatchObject({
      scenePath: 'scenes/Main.tscn',
      nodePath: 'root',
      scriptPath: 'scripts/player.gd',
    });
    expect(projectPath).toBe(root);
  });

  it('rejects an unknown script extension with a typed diagnostic before any headless I/O', async () => {
    const root = makePlainProject();
    const runnerSpy = stubRunner();
    const server = makeServer(root, runnerSpy);
    const response = await toolsCall(server, 'attach_script', {
      projectPath: root,
      scenePath: 'scenes/Main.tscn',
      nodePath: 'root',
      scriptPath: 'scripts/player.txt',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/scriptPath must end with \.gd or \.cs/);
    expect(runnerSpy).not.toHaveBeenCalled();
  });
});
