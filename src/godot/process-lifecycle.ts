import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

type ExitListener = (code: number | null, signal: NodeJS.Signals | null) => void;
type ErrorListener = (error: Error) => void;

export interface ProcessLike {
  pid?: number;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  killed: boolean;
  kill(signal?: NodeJS.Signals | number): boolean;
  once(event: 'exit', listener: ExitListener): this;
  once(event: 'error', listener: ErrorListener): this;
  removeListener(event: 'exit', listener: ExitListener): this;
  removeListener(event: 'error', listener: ErrorListener): this;
}

export class BoundedLineBuffer {
  private readonly lines: string[] = [];
  private readonly listeners = new Set<(line: string) => void>();
  private partial = '';
  droppedLines = 0;

  constructor(private readonly maxLines: number) {
    if (!Number.isInteger(maxLines) || maxLines < 1) {
      throw new Error('maxLines must be a positive integer.');
    }
  }

  append(chunk: string | Buffer): void {
    const text = this.partial + chunk.toString();
    const parts = text.split(/\r?\n/);
    this.partial = parts.pop() ?? '';
    for (const line of parts) this.push(line);
  }

  flush(): void {
    if (this.partial.length === 0) return;
    this.push(this.partial);
    this.partial = '';
  }

  toArray(): string[] {
    return [...this.lines];
  }

  onLine(listener: (line: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private push(line: string): void {
    this.lines.push(line);
    if (this.lines.length > this.maxLines) {
      this.lines.splice(0, this.lines.length - this.maxLines);
      this.droppedLines += 1;
    }
    for (const listener of this.listeners) listener(line);
  }
}

export class LaunchError extends Error {
  readonly diagnostics: string[];

  constructor(message: string, diagnostics: string[]) {
    super(message);
    this.name = 'LaunchError';
    this.diagnostics = diagnostics;
  }
}

interface StartupOptions {
  graceMs?: number;
  failurePatterns?: RegExp[];
  readiness?: Promise<void>;
}

const DEFAULT_LAUNCH_FAILURE_PATTERNS = [
  /(?:ERROR|SCRIPT ERROR):\s*Parse Error/i,
  /ERROR:\s*Failed loading (?:scene|resource)/i,
  /ERROR:\s*(?:Can't|Cannot|Could not) (?:load|open) (?:project|scene|resource)/i,
];

export function observeStartup(
  child: ProcessLike,
  errors: BoundedLineBuffer,
  options: StartupOptions = {},
): Promise<void> {
  const graceMs = options.graceMs ?? 750;
  const patterns = options.failurePatterns ?? DEFAULT_LAUNCH_FAILURE_PATTERNS;

  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: NodeJS.Timeout;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener('exit', onExit);
      child.removeListener('error', onError);
      unsubscribe();
      callback();
    };
    const fail = (message: string) =>
      finish(() => reject(new LaunchError(message, errors.toArray())));
    const onExit: ExitListener = (code, signal) =>
      fail(`Godot exited before startup completed (code=${code}, signal=${signal ?? 'none'}).`);
    const onError: ErrorListener = error => fail(`Godot failed to start: ${error.message}`);
    const unsubscribe = errors.onLine(line => {
      if (patterns.some(pattern => pattern.test(line))) {
        fail(`Godot reported a startup error: ${line}`);
      }
    });

    child.once('exit', onExit);
    child.once('error', onError);

    if (options.readiness) {
      timer = setTimeout(
        () => fail(`Godot did not become ready within ${graceMs}ms.`),
        graceMs,
      );
      options.readiness.then(
        () => finish(resolve),
        error => fail(`Godot readiness failed: ${error instanceof Error ? error.message : String(error)}`),
      );
    } else {
      timer = setTimeout(() => finish(resolve), graceMs);
    }
  });
}

type TerminateAdapter = (child: ProcessLike, force: boolean) => Promise<void>;

interface TerminateOptions {
  terminate?: TerminateAdapter;
  gracefulTimeoutMs?: number;
  forceTimeoutMs?: number;
}

export async function terminateProcessTree(
  child: ProcessLike,
  options: TerminateOptions = {},
): Promise<void> {
  if (hasExited(child)) return;
  const terminate = options.terminate ?? defaultTerminate;
  const gracefulTimeoutMs = options.gracefulTimeoutMs ?? 3000;
  const forceTimeoutMs = options.forceTimeoutMs ?? 3000;

  let exitPromise = waitForExit(child, gracefulTimeoutMs);
  await terminate(child, false);
  if (await exitPromise) return;

  exitPromise = waitForExit(child, forceTimeoutMs);
  await terminate(child, true);
  if (await exitPromise) return;

  throw new Error(`Process tree ${child.pid ?? '<unknown>'} did not exit after forced termination.`);
}

function hasExited(child: ProcessLike): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function waitForExit(child: ProcessLike, timeoutMs: number): Promise<boolean> {
  if (hasExited(child)) return Promise.resolve(true);
  return new Promise(resolve => {
    const onExit: ExitListener = () => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      child.removeListener('exit', onExit);
      resolve(false);
    }, timeoutMs);
    child.once('exit', onExit);
  });
}

async function defaultTerminate(child: ProcessLike, force: boolean): Promise<void> {
  if (hasExited(child)) return;
  if (process.platform === 'win32' && child.pid) {
    const args = ['/PID', String(child.pid), '/T'];
    if (force) args.push('/F');
    try {
      await execFileAsync('taskkill', args, { windowsHide: true });
      return;
    } catch {
      if (hasExited(child)) return;
    }
  }

  child.kill(force ? 'SIGKILL' : 'SIGTERM');
}
