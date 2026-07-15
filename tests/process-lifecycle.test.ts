import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  BoundedLineBuffer,
  LaunchError,
  observeStartup,
  terminateProcessTree,
  type ProcessLike,
} from '../src/godot/process-lifecycle.js';

class FakeProcess extends EventEmitter implements ProcessLike {
  pid = 42;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  killed = false;

  kill(): boolean {
    this.killed = true;
    return true;
  }

  exit(code: number | null = 0, signal: NodeJS.Signals | null = null): void {
    this.exitCode = code;
    this.signalCode = signal;
    this.emit('exit', code, signal);
  }
}

describe('BoundedLineBuffer', () => {
  it('keeps complete lines across chunk boundaries and drops the oldest lines', () => {
    const buffer = new BoundedLineBuffer(3);
    buffer.append('one\ntw');
    buffer.append('o\nthree\nfour\n');

    expect(buffer.toArray()).toEqual(['two', 'three', 'four']);
    expect(buffer.droppedLines).toBe(1);
  });

  it('flushes a final partial line', () => {
    const buffer = new BoundedLineBuffer(5);
    buffer.append('partial');
    buffer.flush();
    expect(buffer.toArray()).toEqual(['partial']);
  });
});

describe('observeStartup', () => {
  it('returns after a healthy grace period', async () => {
    const child = new FakeProcess();
    const errors = new BoundedLineBuffer(10);
    await expect(observeStartup(child, errors, { graceMs: 5 })).resolves.toBeUndefined();
  });

  it('can use an external readiness signal instead of a fixed grace period', async () => {
    const child = new FakeProcess();
    const errors = new BoundedLineBuffer(10);
    let ready!: () => void;
    const readiness = new Promise<void>(resolve => {
      ready = resolve;
    });
    const startedAt = Date.now();
    const observed = observeStartup(child, errors, { graceMs: 1000, readiness });
    ready();
    await expect(observed).resolves.toBeUndefined();
    expect(Date.now() - startedAt).toBeLessThan(100);
  });

  it('fails with retained diagnostics when Godot reports a launch error', async () => {
    const child = new FakeProcess();
    const errors = new BoundedLineBuffer(10);
    const observed = observeStartup(child, errors, { graceMs: 100 });
    errors.append('ERROR: Parse Error: broken scene\n');

    await expect(observed).rejects.toMatchObject({
      name: 'LaunchError',
      diagnostics: ['ERROR: Parse Error: broken scene'],
    });
  });

  it('fails when the process exits before readiness', async () => {
    const child = new FakeProcess();
    const errors = new BoundedLineBuffer(10);
    const observed = observeStartup(child, errors, { graceMs: 100 });
    child.exit(1);

    await expect(observed).rejects.toBeInstanceOf(LaunchError);
  });
});

describe('terminateProcessTree', () => {
  it('awaits normal process exit', async () => {
    const child = new FakeProcess();
    const terminate = vi.fn(async (_process: ProcessLike, force: boolean) => {
      expect(force).toBe(false);
      child.exit(0);
    });

    await terminateProcessTree(child, { terminate, gracefulTimeoutMs: 20, forceTimeoutMs: 20 });
    expect(terminate).toHaveBeenCalledOnce();
  });

  it('escalates when graceful termination does not exit', async () => {
    const child = new FakeProcess();
    const terminate = vi.fn(async (_process: ProcessLike, force: boolean) => {
      if (force) child.exit(null, 'SIGKILL');
    });

    await terminateProcessTree(child, { terminate, gracefulTimeoutMs: 5, forceTimeoutMs: 20 });
    expect(terminate.mock.calls.map(call => call[1])).toEqual([false, true]);
  });
});
