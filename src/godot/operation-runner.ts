import {
  spawn,
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio,
} from 'node:child_process';
import {
  BoundedLineBuffer,
  LaunchError,
  observeStartup,
  terminateProcessTree,
  type ProcessLike,
} from './process-lifecycle.js';

const RESULT_PREFIX = 'GODOT_MCP_RESULT=';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_STARTUP_GRACE_MS = 750;
const DEFAULT_MAX_DIAGNOSTIC_LINES = 200;
const DEFAULT_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_ARGUMENT_BYTES = 1024 * 1024;

type DataListener = (chunk: string | Buffer) => void;

interface ReadableOutput {
  on(event: 'data', listener: DataListener): this;
  removeListener(event: 'data', listener: DataListener): this;
}

export interface HeadlessOperationProcess extends ProcessLike {
  stdout: ReadableOutput;
  stderr: ReadableOutput;
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  once(event: 'error', listener: (error: Error) => void): this;
  once(
    event: 'close',
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): this;
  removeListener(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  removeListener(event: 'error', listener: (error: Error) => void): this;
  removeListener(
    event: 'close',
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): this;
}

export type SpawnHeadlessOperation = (
  command: string,
  args: readonly string[],
  options: SpawnOptionsWithoutStdio,
) => ChildProcessWithoutNullStreams;

export type TerminateHeadlessOperation = (
  child: ProcessLike,
  force: boolean,
) => Promise<void>;

export type HeadlessOperationErrorKind =
  | 'input'
  | 'spawn'
  | 'startup'
  | 'timeout'
  | 'output-limit'
  | 'process-exit'
  | 'missing-result'
  | 'malformed-result'
  | 'invalid-result';

export interface HeadlessOperationDiagnostics {
  stdout: string[];
  stderr: string[];
  droppedStdoutLines: number;
  droppedStderrLines: number;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

export class HeadlessOperationError extends Error implements HeadlessOperationDiagnostics {
  readonly kind: HeadlessOperationErrorKind;
  readonly stdout: string[];
  readonly stderr: string[];
  readonly droppedStdoutLines: number;
  readonly droppedStderrLines: number;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;

  constructor(
    kind: HeadlessOperationErrorKind,
    message: string,
    diagnostics: HeadlessOperationDiagnostics,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'HeadlessOperationError';
    this.kind = kind;
    this.stdout = diagnostics.stdout;
    this.stderr = diagnostics.stderr;
    this.droppedStdoutLines = diagnostics.droppedStdoutLines;
    this.droppedStderrLines = diagnostics.droppedStderrLines;
    this.exitCode = diagnostics.exitCode;
    this.signal = diagnostics.signal;
  }
}

export interface HeadlessOperationResult<T> extends HeadlessOperationDiagnostics {
  result: T;
}

export interface RunHeadlessOperationOptions<T> {
  godotPath: string;
  projectPath: string;
  scriptPath: string;
  operation: string;
  params: unknown;
  parseResult?: (value: unknown) => T;
  spawnProcess?: SpawnHeadlessOperation;
  terminate?: TerminateHeadlessOperation;
  timeoutMs?: number;
  startupGraceMs?: number;
  terminateGracefulTimeoutMs?: number;
  terminateForceTimeoutMs?: number;
  maxDiagnosticLines?: number;
  maxOutputBytes?: number;
  maxArgumentBytes?: number;
  debugGodot?: boolean;
}

interface ExitOutcome {
  code: number | null;
  signal: NodeJS.Signals | null;
  spawnError?: Error;
}

type FirstOutcome =
  | { type: 'exit'; value: ExitOutcome }
  | { type: 'startup-ok' }
  | { type: 'startup-error'; error: LaunchError }
  | { type: 'output-limit'; stream: 'stdout' | 'stderr' }
  | { type: 'timeout' };

/**
 * Execute one Godot headless operation through an argument-array process boundary.
 * Success requires exit code zero and a parseable, optionally validated result marker.
 */
export async function runHeadlessOperation<T = unknown>(
  options: RunHeadlessOperationOptions<T>,
): Promise<HeadlessOperationResult<T>> {
  const maxDiagnosticLines = positiveInteger(
    options.maxDiagnosticLines ?? DEFAULT_MAX_DIAGNOSTIC_LINES,
    'maxDiagnosticLines',
  );
  const maxOutputBytes = positiveInteger(
    options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
    'maxOutputBytes',
  );
  const maxArgumentBytes = positiveInteger(
    options.maxArgumentBytes ?? DEFAULT_MAX_ARGUMENT_BYTES,
    'maxArgumentBytes',
  );
  const timeoutMs = positiveInteger(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 'timeoutMs');
  const startupGraceMs = positiveInteger(
    options.startupGraceMs ?? DEFAULT_STARTUP_GRACE_MS,
    'startupGraceMs',
  );

  requireNonEmpty(options.godotPath, 'godotPath');
  requireNonEmpty(options.projectPath, 'projectPath');
  requireNonEmpty(options.scriptPath, 'scriptPath');
  requireNonEmpty(options.operation, 'operation');

  let paramsJson: string;
  try {
    paramsJson = JSON.stringify(options.params);
  } catch (cause) {
    throw inputError('Operation parameters are not JSON serializable.', cause);
  }
  if (paramsJson === undefined) {
    throw inputError('Operation parameters must serialize to a JSON value.');
  }
  if (Buffer.byteLength(paramsJson, 'utf8') > maxArgumentBytes) {
    throw inputError(`Operation parameters exceed the ${maxArgumentBytes}-byte limit.`);
  }

  const args = [
    '--headless',
    '--path',
    options.projectPath,
    '--script',
    options.scriptPath,
    options.operation,
    paramsJson,
  ];
  if (options.debugGodot) args.push('--debug-godot');

  const spawnProcess = options.spawnProcess ?? defaultSpawn;
  let child: HeadlessOperationProcess;
  try {
    child = spawnProcess(options.godotPath, args, {
      shell: false,
      windowsHide: true,
      stdio: 'pipe',
    }) as HeadlessOperationProcess;
  } catch (cause) {
    throw new HeadlessOperationError('spawn', 'Godot could not be spawned.', emptyDiagnostics(), {
      cause,
    });
  }

  const stdout = new BoundedLineBuffer(maxDiagnosticLines);
  const stderr = new BoundedLineBuffer(maxDiagnosticLines);
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let lastResultMarker: string | undefined;
  let resolveOutputLimit!: (outcome: FirstOutcome) => void;
  const outputLimit = new Promise<FirstOutcome>(resolve => {
    resolveOutputLimit = resolve;
  });
  let outputLimitReported = false;

  const onStdout = (chunk: string | Buffer) => {
    stdoutBytes += Buffer.byteLength(chunk);
    if (stdoutBytes > maxOutputBytes) {
      if (!outputLimitReported) {
        outputLimitReported = true;
        resolveOutputLimit({ type: 'output-limit', stream: 'stdout' });
      }
      return;
    }
    stdout.append(chunk);
  };
  const onStderr = (chunk: string | Buffer) => {
    stderrBytes += Buffer.byteLength(chunk);
    if (stderrBytes > maxOutputBytes) {
      if (!outputLimitReported) {
        outputLimitReported = true;
        resolveOutputLimit({ type: 'output-limit', stream: 'stderr' });
      }
      return;
    }
    stderr.append(chunk);
  };
  const unsubscribeMarker = stdout.onLine(line => {
    if (line.startsWith(RESULT_PREFIX)) lastResultMarker = line;
  });
  child.stdout.on('data', onStdout);
  child.stderr.on('data', onStderr);

  const completion: Promise<FirstOutcome> = waitForClose(child).then(value => ({ type: 'exit', value }));
  const startup: Promise<FirstOutcome> = observeStartup(child, stderr, { graceMs: startupGraceMs }).then(
    (): FirstOutcome => ({ type: 'startup-ok' }),
    (error): FirstOutcome => ({
      type: 'startup-error',
      error: error instanceof LaunchError
        ? error
        : new LaunchError(String(error), stderr.toArray()),
    }),
  );
  let timeoutHandle: NodeJS.Timeout;
  const timeout = new Promise<FirstOutcome>(resolve => {
    timeoutHandle = setTimeout(() => resolve({ type: 'timeout' }), timeoutMs);
  });

  try {
    let outcome = await Promise.race([completion, startup, outputLimit, timeout]);
    if (outcome.type === 'startup-ok') {
      outcome = await Promise.race([completion, outputLimit, timeout]);
    }

    if (outcome.type === 'startup-error') {
      // A short, successful command can exit during the observation grace period.
      // Defer classification to its exit/result evidence in that case.
      if (child.exitCode === null && child.signalCode === null) {
        await stopChild(child, options);
        stdout.flush();
        stderr.flush();
        throw operationError('startup', outcome.error.message, child, stdout, stderr, outcome.error);
      }
      outcome = await completion;
    }

    if (outcome.type === 'timeout') {
      await stopChild(child, options);
      stdout.flush();
      stderr.flush();
      throw operationError(
        'timeout',
        `Godot operation exceeded the ${timeoutMs}ms timeout.`,
        child,
        stdout,
        stderr,
      );
    }

    if (outcome.type === 'output-limit') {
      await stopChild(child, options);
      stdout.flush();
      stderr.flush();
      throw operationError(
        'output-limit',
        `Godot ${outcome.stream} exceeded the ${maxOutputBytes}-byte limit.`,
        child,
        stdout,
        stderr,
      );
    }

    if (outcome.type !== 'exit') {
      throw operationError(
        'startup',
        'Godot operation did not reach a terminal process state.',
        child,
        stdout,
        stderr,
      );
    }

    stdout.flush();
    stderr.flush();
    const { code, signal, spawnError } = outcome.value;
    if (spawnError) {
      throw operationError('spawn', `Godot failed to start: ${spawnError.message}`, child, stdout, stderr, spawnError);
    }
    if (code !== 0) {
      throw operationError(
        'process-exit',
        `Godot operation exited unsuccessfully (code=${code}, signal=${signal ?? 'none'}).`,
        child,
        stdout,
        stderr,
      );
    }
    if (!lastResultMarker) {
      throw operationError(
        'missing-result',
        'Godot operation exited without a result marker.',
        child,
        stdout,
        stderr,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(lastResultMarker.slice(RESULT_PREFIX.length));
    } catch (cause) {
      throw operationError(
        'malformed-result',
        'Godot operation result marker contained malformed JSON.',
        child,
        stdout,
        stderr,
        cause,
      );
    }

    let result: T;
    try {
      result = options.parseResult ? options.parseResult(parsed) : parsed as T;
    } catch (cause) {
      throw operationError(
        'invalid-result',
        `Godot operation result was invalid${cause instanceof Error ? `: ${cause.message}` : '.'}`,
        child,
        stdout,
        stderr,
        cause,
      );
    }

    return {
      result,
      ...diagnostics(child, stdout, stderr),
    };
  } finally {
    clearTimeout(timeoutHandle!);
    unsubscribeMarker();
    child.stdout.removeListener('data', onStdout);
    child.stderr.removeListener('data', onStderr);
  }
}

function defaultSpawn(
  command: string,
  args: readonly string[],
  options: SpawnOptionsWithoutStdio,
): ChildProcessWithoutNullStreams {
  return spawn(command, [...args], options) as ChildProcessWithoutNullStreams;
}

function waitForClose(child: HeadlessOperationProcess): Promise<ExitOutcome> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise(resolve => {
    let settled = false;
    const finish = (outcome: ExitOutcome) => {
      if (settled) return;
      settled = true;
      child.removeListener('close', onClose);
      child.removeListener('error', onError);
      resolve(outcome);
    };
    const onClose = (code: number | null, signal: NodeJS.Signals | null) =>
      finish({ code, signal });
    const onError = (error: Error) =>
      finish({ code: child.exitCode, signal: child.signalCode, spawnError: error });
    child.once('close', onClose);
    child.once('error', onError);
  });
}

async function stopChild(
  child: HeadlessOperationProcess,
  options: RunHeadlessOperationOptions<unknown>,
): Promise<void> {
  await terminateProcessTree(child, {
    terminate: options.terminate,
    gracefulTimeoutMs: options.terminateGracefulTimeoutMs,
    forceTimeoutMs: options.terminateForceTimeoutMs,
  });
}

function operationError(
  kind: HeadlessOperationErrorKind,
  message: string,
  child: HeadlessOperationProcess,
  stdout: BoundedLineBuffer,
  stderr: BoundedLineBuffer,
  cause?: unknown,
): HeadlessOperationError {
  return new HeadlessOperationError(kind, message, diagnostics(child, stdout, stderr), { cause });
}

function diagnostics(
  child: ProcessLike,
  stdout: BoundedLineBuffer,
  stderr: BoundedLineBuffer,
): HeadlessOperationDiagnostics {
  return {
    stdout: stdout.toArray(),
    stderr: stderr.toArray(),
    droppedStdoutLines: stdout.droppedLines,
    droppedStderrLines: stderr.droppedLines,
    exitCode: child.exitCode,
    signal: child.signalCode,
  };
}

function emptyDiagnostics(): HeadlessOperationDiagnostics {
  return {
    stdout: [],
    stderr: [],
    droppedStdoutLines: 0,
    droppedStderrLines: 0,
    exitCode: null,
    signal: null,
  };
}

function inputError(message: string, cause?: unknown): HeadlessOperationError {
  return new HeadlessOperationError('input', message, emptyDiagnostics(), { cause });
}

function requireNonEmpty(value: string, name: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw inputError(`${name} must be a non-empty string.`);
  }
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw inputError(`${name} must be a positive integer.`);
  }
  return value;
}
