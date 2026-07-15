import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { GodotServer } from '../src/server.js';
import { PathPolicy } from '../src/security/path-policy.js';

class FakeChildProcess extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  stdin = new PassThrough();
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  killed = false;
  pid = undefined;

  kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    if (this.exitCode !== null || this.signalCode !== null) return false;
    this.killed = true;
    queueMicrotask(() => this.exit(null, signal));
    return true;
  }

  exit(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.exitCode = code;
    this.signalCode = signal;
    this.stdout.end();
    this.stderr.end();
    this.emit('exit', code, signal);
  }

  asChildProcess(): ChildProcessWithoutNullStreams {
    return this as unknown as ChildProcessWithoutNullStreams;
  }
}

function createProject(): { path: string; original: string } {
  const path = mkdtempSync(join(tmpdir(), 'godot-mcp-lifecycle-'));
  const original = '; test project\n\nconfig_version=5\n';
  writeFileSync(join(path, 'project.godot'), original, 'utf8');
  return { path, original };
}

function createServer(
  child: FakeChildProcess,
  projectPath: string,
  connector: () => Promise<void> = async () => {},
) {
  return new GodotServer({
    godotPath: process.execPath,
    pathPolicy: new PathPolicy([projectPath]),
    registerSignalHandlers: false,
    runtimeConnector: connector,
    spawnProcess: () => child.asChildProcess(),
  });
}

describe('GodotServer process lifecycle', () => {
  it('waits for readiness, retains bounded diagnostics, and stops cleanly', async () => {
    const project = createProject();
    const child = new FakeChildProcess();
    const server = createServer(child, project.path);

    const started = await (server as any).handleRunProject({ projectPath: project.path });
    expect(started.isError).not.toBe(true);
    expect(started.content[0].text).toContain('interaction bridge is ready');

    child.stdout.write('runtime ready\n');
    child.stderr.write('warning only\n');
    await new Promise(resolve => setImmediate(resolve));

    const stopped = await (server as any).handleStopProject();
    expect(stopped.isError).not.toBe(true);
    expect(child.killed).toBe(true);
    expect(readFileSync(join(project.path, 'project.godot'), 'utf8')).toBe(project.original);
    expect(existsSync(join(project.path, 'mcp_interaction_server.gd'))).toBe(false);

    const diagnostics = await (server as any).handleGetDebugOutput();
    const parsed = JSON.parse(diagnostics.content[0].text);
    expect(parsed.state).toBe('stopped');
    expect(parsed.output).toContain('runtime ready');
    expect(parsed.errors).toContain('warning only');
  });

  it('returns startup errors and cleans the injected bridge', async () => {
    const project = createProject();
    const child = new FakeChildProcess();
    let releaseReadiness!: () => void;
    const readiness = new Promise<void>(resolve => {
      releaseReadiness = resolve;
    });
    const server = createServer(child, project.path, () => readiness);

    queueMicrotask(() => child.stderr.write('ERROR: Parse Error: broken Main.tscn\n'));
    const result = await (server as any).handleRunProject({ projectPath: project.path });
    releaseReadiness();

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('broken Main.tscn');
    expect(child.killed).toBe(true);
    expect(readFileSync(join(project.path, 'project.godot'), 'utf8')).toBe(project.original);
    expect(existsSync(join(project.path, 'mcp_interaction_server.gd'))).toBe(false);
  });
});
