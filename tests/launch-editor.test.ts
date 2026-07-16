import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GodotServer } from '../src/server.js';
import { PathPolicy } from '../src/security/path-policy.js';
import { launchEditor, type LaunchEditorSpawn } from '../src/tools/editor/launch-editor.js';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type { ProcessLike } from '../src/godot/process-lifecycle.js';

class FakeChild extends EventEmitter implements ProcessLike {
  pid = 1234;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  killed = false;

  stdout = new EventEmitter();
  stderr = new EventEmitter();

  kill(): boolean {
    this.killed = true;
    return true;
  }

  exit(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.exitCode = code;
    this.signalCode = signal;
    this.emit('exit', code, signal);
  }
}

function requestHandler(server: GodotServer, method: 'tools/list' | 'tools/call') {
  const handlers = (server as any).server._requestHandlers as Map<string, Function>;
  const handler = handlers.get(method);
  if (!handler) throw new Error(`Missing MCP request handler: ${method}`);
  return handler;
}

const tempRoots: string[] = [];

function makeProject(): { root: string; projectFile: string } {
  const root = mkdtempSync(join(tmpdir(), 'godot-mcp-launch-editor-'));
  tempRoots.push(root);
  const projectFile = join(root, 'project.godot');
  writeFileSync(projectFile, '[application]\nconfig/name="LaunchEditorTest"\n', 'utf8');
  return { root, projectFile };
}

function makeSpawn(child: FakeChild): LaunchEditorSpawn {
  return (_command: string, _args: readonly string[], _options: { stdio: 'pipe'; env?: NodeJS.ProcessEnv }) =>
    child as unknown as ChildProcessWithoutNullStreams;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('launchEditor handler', () => {
  it('returns success diagnostics after a healthy observation window', async () => {
    const { root } = makeProject();
    const child = new FakeChild();
    const spawn = vi.fn<LaunchEditorSpawn>(makeSpawn(child));

    const observed = launchEditor({
      projectPath: root,
      godotPath: '/usr/bin/godot',
      pathPolicy: new PathPolicy([root]),
      graceMs: 25,
      spawn,
    });

    await new Promise(resolve => setTimeout(resolve, 50));
    child.stdout.emit('data', Buffer.from('Godot Engine v4.7.stable\n'));
    await expect(observed).resolves.toMatchObject({
      content: [
        {
          type: 'text',
          text: expect.stringContaining('Godot editor launched'),
        },
      ],
    });

    expect(spawn).toHaveBeenCalledTimes(1);
    const [command, args] = spawn.mock.calls[0];
    expect(command).toBe('/usr/bin/godot');
    expect(args).toEqual(['-e', '--path', root]);
  });

  it('fails with retained stderr when Godot exits before readiness', async () => {
    const { root } = makeProject();
    const child = new FakeChild();
    const spawn = vi.fn<LaunchEditorSpawn>(makeSpawn(child));

    const observed = launchEditor({
      projectPath: root,
      godotPath: '/usr/bin/godot',
      pathPolicy: new PathPolicy([root]),
      graceMs: 200,
      spawn,
    });

    await new Promise(resolve => setTimeout(resolve, 20));
    child.stderr.emit('data', Buffer.from('ERROR: Cannot load project\n'));
    child.exit(1);

    await expect(observed).rejects.toMatchObject({
      name: 'LaunchError',
      diagnostics: ['ERROR: Cannot load project'],
    });
  });

  it('fails when a parse error is observed before the grace window completes', async () => {
    const { root } = makeProject();
    const child = new FakeChild();
    const spawn = vi.fn<LaunchEditorSpawn>(makeSpawn(child));

    const observed = launchEditor({
      projectPath: root,
      godotPath: '/usr/bin/godot',
      pathPolicy: new PathPolicy([root]),
      graceMs: 500,
      spawn,
    });

    await new Promise(resolve => setTimeout(resolve, 30));
    child.stderr.emit('data', Buffer.from('ERROR: Parse Error: missing colon\n'));
    child.exit(1);

    await expect(observed).rejects.toMatchObject({
      name: 'LaunchError',
      diagnostics: ['ERROR: Parse Error: missing colon'],
    });
  });

  it('rejects project paths outside the configured allowed roots', async () => {
    const { root } = makeProject();
    const other = mkdtempSync(join(tmpdir(), 'godot-mcp-launch-editor-other-'));
    tempRoots.push(other);
    const spawn = vi.fn<SpawnProcess>(makeSpawn(new FakeChild()));

    await expect(
      launchEditor({
        projectPath: other,
        godotPath: '/usr/bin/godot',
        pathPolicy: new PathPolicy([root]),
        spawn,
      }),
    ).rejects.toThrow(/outside the configured allowed roots|absolute|null byte/i);

    expect(spawn).not.toHaveBeenCalled();
  });

  it('rejects project paths that do not contain a project.godot file', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'godot-mcp-launch-editor-empty-'));
    tempRoots.push(empty);
    const spawn = vi.fn<SpawnProcess>(makeSpawn(new FakeChild()));

    await expect(
      launchEditor({
        projectPath: empty,
        godotPath: '/usr/bin/godot',
        pathPolicy: new PathPolicy([empty]),
        spawn,
      }),
    ).rejects.toThrow(/Not a valid Godot project/);

    expect(spawn).not.toHaveBeenCalled();
  });
});

describe('GodotServer launch_editor registration', () => {
  it('is registered through the tool registry with the runtime capability', () => {
    const server = new GodotServer({ registerSignalHandlers: false });
    const registry = (server as any).toolRegistry;
    expect(registry.has('launch_editor')).toBe(true);
    expect(registry.capabilityFor('launch_editor')).toBe('runtime');
  });

  it('keeps the legacy launch_editor contract in the advertised flat tool list', async () => {
    const server = new GodotServer({ registerSignalHandlers: false });
    const response = await requestHandler(server, 'tools/list')(
      { method: 'tools/list', params: {} },
      {},
    );
    const launch = response.tools.find((tool: { name: string }) => tool.name === 'launch_editor');
    expect(launch).toBeDefined();
    expect(launch.description).toContain('Launch Godot editor');
    expect(launch.inputSchema.required).toContain('projectPath');
  });

  it('returns truthful diagnostics through the MCP call boundary when the process exits early', async () => {
    const { root } = makeProject();
    const child = new FakeChild();
    const spawn = vi.fn<LaunchEditorSpawn>(makeSpawn(child));

    const server = new GodotServer({
      registerSignalHandlers: false,
      godotPath: '/usr/bin/godot',
      spawnProcess: spawn,
      runtimeConnector: () => new Promise(() => undefined),
      runtimeConnectInitialDelayMs: 5,
      pathPolicy: new PathPolicy([root]),
    });

    const observed = requestHandler(server, 'tools/call')(
      {
        method: 'tools/call',
        params: {
          name: 'launch_editor',
          arguments: { projectPath: root },
        },
      },
      {},
    );

    await new Promise(resolve => setTimeout(resolve, 20));
    child.stderr.emit('data', Buffer.from('ERROR: Failed loading scene\n'));
    child.exit(1);

    const response = await observed;
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/Godot exited before startup|Failed loading scene/);
  });
});
