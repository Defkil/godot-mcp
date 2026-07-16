import { EventEmitter } from 'node:events';
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import {
  HeadlessOperationError,
  runHeadlessOperation,
  type HeadlessOperationProcess,
} from '../src/godot/operation-runner.js';

class FakeOperationProcess extends EventEmitter implements HeadlessOperationProcess {
  pid = 42;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  killed = false;
  stdout = new EventEmitter();
  stderr = new EventEmitter();

  kill(): boolean {
    this.killed = true;
    return true;
  }

  writeStdout(chunk: string): void {
    this.stdout.emit('data', Buffer.from(chunk));
  }

  writeStderr(chunk: string): void {
    this.stderr.emit('data', Buffer.from(chunk));
  }

  exit(code: number | null = 0, signal: NodeJS.Signals | null = null): void {
    this.exitCode = code;
    this.signalCode = signal;
    this.emit('exit', code, signal);
    this.emit('close', code, signal);
  }
}

function createSpawner(child: FakeOperationProcess) {
  return vi.fn((
    _command: string,
    _args: readonly string[],
    _options: SpawnOptionsWithoutStdio,
  ) => child as unknown as ChildProcessWithoutNullStreams);
}

describe('runHeadlessOperation', () => {
  it('uses argument-array process execution and parses the last typed result marker amid Godot noise', async () => {
    const child = new FakeOperationProcess();
    const spawnProcess = createSpawner(child);
    const running = runHeadlessOperation<{ changed: number }>({
      godotPath: 'C:\\Program Files\\Godot\\Godot.exe',
      projectPath: 'C:\\Projects\\Unicode Game Ω',
      scriptPath: 'C:\\Tools\\godot operations.gd',
      operation: 'modify_scene_node',
      params: { scene_path: 'res://Main.tscn' },
      spawnProcess,
      startupGraceMs: 1,
      timeoutMs: 100,
    });

    child.writeStdout('Godot Engine v4.7\r\nGODOT_MCP_RESULT={"changed":0}\r\n');
    child.writeStderr('WARNING: harmless import warning\n');
    child.writeStdout('GODOT_MCP_RESULT={"changed":1}\n');
    setTimeout(() => child.exit(0), 5);

    await expect(running).resolves.toMatchObject({
      result: { changed: 1 },
      exitCode: 0,
      stdout: expect.arrayContaining(['Godot Engine v4.7', 'GODOT_MCP_RESULT={"changed":1}']),
      stderr: ['WARNING: harmless import warning'],
    });
    expect(spawnProcess).toHaveBeenCalledWith(
      'C:\\Program Files\\Godot\\Godot.exe',
      [
        '--headless',
        '--path',
        'C:\\Projects\\Unicode Game Ω',
        '--script',
        'C:\\Tools\\godot operations.gd',
        'modify_scene_node',
        '{"scene_path":"res://Main.tscn"}',
      ],
      expect.objectContaining({ shell: false, windowsHide: true }),
    );
  });

  it('rejects exit zero when no result marker is emitted', async () => {
    const child = new FakeOperationProcess();
    const running = runHeadlessOperation({
      godotPath: 'godot',
      projectPath: '/project',
      scriptPath: '/tools/operation.gd',
      operation: 'noop',
      params: {},
      spawnProcess: createSpawner(child),
      startupGraceMs: 1,
      timeoutMs: 100,
    });

    child.writeStdout('Operation complete\n');
    setTimeout(() => child.exit(0), 5);

    await expect(running).rejects.toMatchObject({
      name: 'HeadlessOperationError',
      kind: 'missing-result',
      exitCode: 0,
    });
  });

  it('rejects malformed result JSON with bounded diagnostics', async () => {
    const child = new FakeOperationProcess();
    const running = runHeadlessOperation({
      godotPath: 'godot',
      projectPath: '/project',
      scriptPath: '/tools/operation.gd',
      operation: 'broken',
      params: {},
      spawnProcess: createSpawner(child),
      startupGraceMs: 1,
      timeoutMs: 100,
      maxDiagnosticLines: 2,
    });

    child.writeStdout('one\ntwo\nGODOT_MCP_RESULT={bad json}\n');
    setTimeout(() => child.exit(0), 5);

    await expect(running).rejects.toMatchObject({
      name: 'HeadlessOperationError',
      kind: 'malformed-result',
      stdout: ['two', 'GODOT_MCP_RESULT={bad json}'],
    });
  });

  it('applies operation-specific result validation', async () => {
    const child = new FakeOperationProcess();
    const running = runHeadlessOperation<number>({
      godotPath: 'godot',
      projectPath: '/project',
      scriptPath: '/tools/operation.gd',
      operation: 'typed',
      params: {},
      spawnProcess: createSpawner(child),
      startupGraceMs: 1,
      timeoutMs: 100,
      parseResult: value => {
        if (!value || typeof value !== 'object' || !Number.isInteger((value as { changed?: unknown }).changed)) {
          throw new Error('changed must be an integer');
        }
        return (value as { changed: number }).changed;
      },
    });

    child.writeStdout('GODOT_MCP_RESULT={"changed":"one"}\n');
    setTimeout(() => child.exit(0), 5);

    await expect(running).rejects.toMatchObject({
      name: 'HeadlessOperationError',
      kind: 'invalid-result',
      message: expect.stringContaining('changed must be an integer'),
    });
  });

  it('terminates when either output stream exceeds its byte limit', async () => {
    const child = new FakeOperationProcess();
    const terminate = vi.fn(async () => {
      child.exit(null, 'SIGTERM');
    });
    const running = runHeadlessOperation({
      godotPath: 'godot',
      projectPath: '/project',
      scriptPath: '/tools/operation.gd',
      operation: 'noisy',
      params: {},
      spawnProcess: createSpawner(child),
      startupGraceMs: 50,
      timeoutMs: 100,
      maxOutputBytes: 8,
      terminate,
      terminateGracefulTimeoutMs: 20,
      terminateForceTimeoutMs: 20,
    });

    child.writeStdout('123456789');

    await expect(running).rejects.toMatchObject({
      name: 'HeadlessOperationError',
      kind: 'output-limit',
    });
    expect(terminate).toHaveBeenCalledOnce();
  });

  it('rejects oversized serialized parameters before spawning Godot', async () => {
    const child = new FakeOperationProcess();
    const spawnProcess = createSpawner(child);

    await expect(runHeadlessOperation({
      godotPath: 'godot',
      projectPath: '/project',
      scriptPath: '/tools/operation.gd',
      operation: 'bounded',
      params: { value: 'too large' },
      spawnProcess,
      maxArgumentBytes: 8,
    })).rejects.toMatchObject({
      name: 'HeadlessOperationError',
      kind: 'input',
      message: expect.stringContaining('8-byte limit'),
    });
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it('rejects startup parse errors before a success envelope can be claimed', async () => {
    const child = new FakeOperationProcess();
    const terminate = vi.fn(async () => {
      child.exit(null, 'SIGTERM');
    });
    const running = runHeadlessOperation({
      godotPath: 'godot',
      projectPath: '/project',
      scriptPath: '/tools/operation.gd',
      operation: 'broken',
      params: {},
      spawnProcess: createSpawner(child),
      startupGraceMs: 50,
      timeoutMs: 100,
      terminate,
      terminateGracefulTimeoutMs: 20,
      terminateForceTimeoutMs: 20,
    });

    child.writeStderr('SCRIPT ERROR: Parse Error: Unexpected token\n');

    await expect(running).rejects.toMatchObject({
      name: 'HeadlessOperationError',
      kind: 'startup',
      stderr: ['SCRIPT ERROR: Parse Error: Unexpected token'],
    });
    expect(terminate).toHaveBeenCalledOnce();
  });

  it('terminates a runaway process tree on timeout', async () => {
    const child = new FakeOperationProcess();
    const terminate = vi.fn(async (_process: HeadlessOperationProcess, force: boolean) => {
      expect(force).toBe(false);
      child.exit(null, 'SIGTERM');
    });

    const running = runHeadlessOperation({
      godotPath: 'godot',
      projectPath: '/project',
      scriptPath: '/tools/operation.gd',
      operation: 'hang',
      params: {},
      spawnProcess: createSpawner(child),
      startupGraceMs: 1,
      timeoutMs: 5,
      terminate,
      terminateGracefulTimeoutMs: 20,
      terminateForceTimeoutMs: 20,
    });

    await expect(running).rejects.toMatchObject({
      name: 'HeadlessOperationError',
      kind: 'timeout',
    });
    expect(terminate).toHaveBeenCalledOnce();
  });

  it('reports non-zero process exit even when a result marker was printed', async () => {
    const child = new FakeOperationProcess();
    const running = runHeadlessOperation({
      godotPath: 'godot',
      projectPath: '/project',
      scriptPath: '/tools/operation.gd',
      operation: 'failed',
      params: {},
      spawnProcess: createSpawner(child),
      startupGraceMs: 1,
      timeoutMs: 100,
    });

    child.writeStdout('GODOT_MCP_RESULT={"claimed":true}\n');
    setTimeout(() => child.exit(3), 5);

    await expect(running).rejects.toMatchObject({
      name: 'HeadlessOperationError',
      kind: 'process-exit',
      exitCode: 3,
    });
  });
});

it('uses a typed operation error surface', () => {
  const error = new HeadlessOperationError('missing-result', 'missing marker', {
    stdout: [],
    stderr: [],
    droppedStdoutLines: 0,
    droppedStderrLines: 0,
    exitCode: 0,
    signal: null,
  });
  expect(error).toBeInstanceOf(Error);
});
