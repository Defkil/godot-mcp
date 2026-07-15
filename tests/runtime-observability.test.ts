import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { ByteLogBuffer, ByteLogCursor } from '../src/runtime/log-buffer.js';
import { terminateProcess, waitForSpawn } from '../src/runtime/process-lifecycle.js';

class FakeChild extends EventEmitter {}

class FakeTerminableChild extends EventEmitter {
  exitCode: number | null = null;
  readonly kill = vi.fn(() => true);
}

describe('ByteLogBuffer', () => {
  it('evicts the oldest bytes and bounds oversized chunks', () => {
    const buffer = new ByteLogBuffer(5);
    buffer.append('abc');
    buffer.append('def');
    expect(buffer.toString()).toBe('bcdef');
    expect(buffer.byteLength).toBe(5);

    buffer.append('oversized');
    expect(buffer.toString()).toBe('sized');
    expect(buffer.byteLength).toBe(5);
  });

  it('retains complete UTF-8 code points at the byte boundary', () => {
    const buffer = new ByteLogBuffer(4);
    buffer.append('é🙂');
    expect(buffer.toString()).toBe('🙂');
    expect(buffer.toString()).not.toContain('�');
    expect(buffer.byteLength).toBe(4);
  });

  it('decodes a multibyte character split across Buffer chunks', () => {
    const bytes = Buffer.from('🙂');
    const buffer = new ByteLogBuffer(16);
    buffer.append(bytes.subarray(0, 2));
    buffer.append(bytes.subarray(2));
    expect(buffer.toString()).toBe('🙂');
  });

  it('returns stable line output without retaining unbounded data', () => {
    const buffer = new ByteLogBuffer(9);
    buffer.append('one\ntwo\nthree');
    expect(buffer.lines()).toEqual(['two', 'three']);
    expect(buffer.byteLength).toBeLessThanOrEqual(9);
  });

  it('provides monotonic bounded cursors and reports eviction', () => {
    const buffer = new ByteLogBuffer(6);
    buffer.append('one');
    const first = buffer.readSince(0);
    expect(first).toEqual({ text: 'one', nextOffset: 3, truncated: false });

    buffer.append('two');
    expect(buffer.readSince(first.nextOffset)).toEqual({
      text: 'two',
      nextOffset: 6,
      truncated: false,
    });

    buffer.append('THREE');
    expect(buffer.readSince(first.nextOffset)).toEqual({
      text: 'oTHREE',
      nextOffset: 11,
      truncated: true,
    });
  });

  it('recovers when a cursor belongs to a replaced process buffer', () => {
    const buffer = new ByteLogBuffer(16);
    buffer.append('new');

    expect(buffer.readSince(99)).toEqual({
      text: 'new',
      nextOffset: 3,
      truncated: true,
    });
  });

  it('stays byte-bounded across many tiny chunks', () => {
    const buffer = new ByteLogBuffer(64);
    for (let index = 0; index < 10_000; index += 1) buffer.append('x');
    expect(buffer.byteLength).toBe(64);
    expect(buffer.toString()).toBe('x'.repeat(64));
  });
});

describe('ByteLogCursor', () => {
  it('resets offsets when a new process receives a fresh buffer', () => {
    const cursor = new ByteLogCursor();
    const firstProcess = new ByteLogBuffer(32);
    firstProcess.append('old output\n');
    expect(cursor.read(firstProcess).lines).toEqual(['old output']);
    expect(cursor.read(firstProcess).lines).toEqual([]);

    cursor.reset();
    const nextProcess = new ByteLogBuffer(32);
    nextProcess.append('new\n');
    expect(cursor.read(nextProcess)).toEqual({ lines: ['new'], truncated: false });
  });
});

describe('waitForSpawn', () => {
  it('resolves on spawn and removes temporary listeners', async () => {
    const child = new FakeChild();
    const waiting = waitForSpawn(child, 1000);
    child.emit('spawn');
    await expect(waiting).resolves.toBeUndefined();
    expect(child.listenerCount('spawn')).toBe(0);
    expect(child.listenerCount('error')).toBe(0);
  });

  it('rejects the truthful spawn error and removes listeners', async () => {
    const child = new FakeChild();
    const error = new Error('spawn ENOENT');
    const waiting = waitForSpawn(child, 1000);
    child.emit('error', error);
    await expect(waiting).rejects.toBe(error);
    expect(child.listenerCount('spawn')).toBe(0);
    expect(child.listenerCount('error')).toBe(0);
  });

  it('rejects a bounded timeout and removes listeners', async () => {
    vi.useFakeTimers();
    const child = new FakeChild();
    const waiting = waitForSpawn(child, 25);
    const assertion = expect(waiting).rejects.toThrow('did not emit spawn within 25ms');
    await vi.advanceTimersByTimeAsync(25);
    await assertion;
    expect(child.listenerCount('spawn')).toBe(0);
    expect(child.listenerCount('error')).toBe(0);
    vi.useRealTimers();
  });
});

describe('terminateProcess', () => {
  it('keeps waiting until the child confirms exit', async () => {
    const child = new FakeTerminableChild();
    const termination = terminateProcess(child, 1000);
    expect(child.kill).toHaveBeenCalledOnce();

    child.exitCode = 0;
    child.emit('exit', 0);
    await expect(termination).resolves.toBeUndefined();
    expect(child.listenerCount('exit')).toBe(0);
    expect(child.listenerCount('close')).toBe(0);
  });

  it('rejects when the child refuses the termination signal', async () => {
    const child = new FakeTerminableChild();
    child.kill.mockReturnValue(false);
    await expect(terminateProcess(child, 1000)).rejects.toThrow('refused the termination signal');
    expect(child.listenerCount('exit')).toBe(0);
    expect(child.listenerCount('close')).toBe(0);
  });

  it('cleans listeners when sending the termination signal throws', async () => {
    const child = new FakeTerminableChild();
    child.kill.mockImplementation(() => {
      throw new Error('kill failed');
    });
    await expect(terminateProcess(child, 1000)).rejects.toThrow('kill failed');
    expect(child.listenerCount('exit')).toBe(0);
    expect(child.listenerCount('close')).toBe(0);
  });

  it('rejects a bounded termination timeout and removes listeners', async () => {
    vi.useFakeTimers();
    const child = new FakeTerminableChild();
    const termination = terminateProcess(child, 25);
    const assertion = expect(termination).rejects.toThrow('did not exit within 25ms');
    await vi.advanceTimersByTimeAsync(25);
    await assertion;
    expect(child.listenerCount('exit')).toBe(0);
    expect(child.listenerCount('close')).toBe(0);
    vi.useRealTimers();
  });
});
