import { createConnection, type Socket } from 'node:net';

export interface BridgeClientOptions {
  host?: string;
  port: number;
  token: string;
  expectedProtocolVersion?: number;
  maxFrameBytes?: number;
  connectTimeoutMs?: number;
  commandTimeoutMs?: number;
  connectInitialDelayMs?: number;
  connectMaxAttempts?: number;
  connectRetryDelayMs?: number;
  /**
   * When `true` (default), authentication failures still go through the
   * connection retry loop. When `false`, an authentication failure is
   * propagated immediately on the first attempt; the server keeps its
   * historical behavior of refusing a wrong token without retrying a bridge
   * that already proved it would not accept the token.
   */
  retryOnAuthenticationFailure?: boolean;
  socketFactory?: (host: string, port: number) => Socket;
  onDebug?: (message: string) => void;
}

export interface BridgeAuthResult {
  authenticated: boolean;
  protocolVersion: number;
}

interface PendingResolver {
  resolve: (value: BridgeResponse) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout | null;
}

export interface BridgeResponse {
  id?: number;
  result?: unknown;
  error?: string;
}

export class BridgeAuthenticationError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'BridgeAuthenticationError';
  }
}

export class BridgeConnectionError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'BridgeConnectionError';
  }
}

export class BridgeFrameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BridgeFrameError';
  }
}

const DEFAULT_MAX_FRAME_BYTES = 1024 * 1024;
const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;
const DEFAULT_COMMAND_TIMEOUT_MS = 10_000;
const DEFAULT_CONNECT_INITIAL_DELAY_MS = 0;
const DEFAULT_CONNECT_MAX_ATTEMPTS = 10;
const DEFAULT_CONNECT_RETRY_DELAY_MS = 500;
const DEFAULT_EXPECTED_PROTOCOL_VERSION = 1;
const DEFAULT_RETRY_ON_AUTHENTICATION_FAILURE = true;
const DEFAULT_HOST = '127.0.0.1';

function defaultSocketFactory(host: string, port: number): Socket {
  return createConnection({ host, port });
}

/**
 * Loopback NDJSON client for the Godot runtime interaction bridge.
 *
 * Owns the entire transport boundary: TCP connection lifecycle, bounded NDJSON
 * frame buffering, request/response correlation, the versioned token handshake,
 * and structured error envelopes. The previous implementation kept all of this
 * inline inside GodotServer, which made handshake regressions impossible to
 * unit-test without standing up the whole server.
 *
 * The class is single-instance-per-session; every public method is idempotent.
 */
export class BridgeClient {
  private readonly options: Required<
    Omit<
      BridgeClientOptions,
      'socketFactory' | 'onDebug' | 'expectedProtocolVersion' | 'retryOnAuthenticationFailure'
    >
  > & {
    expectedProtocolVersion: number;
    retryOnAuthenticationFailure: boolean;
    socketFactory: (host: string, port: number) => Socket;
    onDebug: ((message: string) => void) | undefined;
  };
  private socket: Socket | null = null;
  private connected = false;
  private responseBuffer = '';
  private readonly pending = new Map<number, PendingResolver>();
  private nextRequestId = 1;

  constructor(options: BridgeClientOptions) {
    if (!options || typeof options.port !== 'number' || !options.token) {
      throw new BridgeConnectionError('BridgeClient requires port and token');
    }
    this.options = {
      host: options.host ?? DEFAULT_HOST,
      port: options.port,
      token: options.token,
      expectedProtocolVersion: options.expectedProtocolVersion ?? DEFAULT_EXPECTED_PROTOCOL_VERSION,
      maxFrameBytes: options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES,
      connectTimeoutMs: options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
      commandTimeoutMs: options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS,
      connectInitialDelayMs:
        options.connectInitialDelayMs ?? DEFAULT_CONNECT_INITIAL_DELAY_MS,
      connectMaxAttempts: options.connectMaxAttempts ?? DEFAULT_CONNECT_MAX_ATTEMPTS,
      connectRetryDelayMs: options.connectRetryDelayMs ?? DEFAULT_CONNECT_RETRY_DELAY_MS,
      retryOnAuthenticationFailure:
        options.retryOnAuthenticationFailure ?? DEFAULT_RETRY_ON_AUTHENTICATION_FAILURE,
      socketFactory: options.socketFactory ?? defaultSocketFactory,
      onDebug: options.onDebug,
    };
  }

  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Open the loopback socket, perform the versioned token handshake, and return
   * the negotiated protocol version. Retries up to {@link connectMaxAttempts}
   * times with {@link connectRetryDelayMs} between attempts.
   *
   * Idempotent: calling connect while already connected returns the existing
   * session without re-negotiating.
   */
  async connect(): Promise<BridgeAuthResult> {
    if (this.connected && this.socket) {
      return { authenticated: true, protocolVersion: this.options.expectedProtocolVersion };
    }

    if (this.options.connectInitialDelayMs > 0) {
      await delay(this.options.connectInitialDelayMs);
    }

    const maxAttempts = this.options.connectMaxAttempts;
    const retryDelay = this.options.connectRetryDelayMs;
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.openSocket();
        const auth = await this.authenticate();
        return auth;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        this.debug(`Connection attempt ${attempt}/${maxAttempts} failed: ${lastError.message}`);
        this.teardownSocket();
        // Authentication failures are not transient: a bridge that already
        // refused the token will not accept it on a retry. Honor the
        // configured policy (default: retry; server wiring: do not retry).
        if (
          lastError instanceof BridgeAuthenticationError &&
          !this.options.retryOnAuthenticationFailure
        ) {
          throw lastError;
        }
        if (attempt < maxAttempts) {
          await delay(retryDelay);
        }
      }
    }

    const message = `Failed to connect to game interaction server after ${maxAttempts} attempts`;
    // Authentication errors propagate verbatim so callers can distinguish
    // "wrong token / version" from "could not reach the bridge at all".
    if (lastError instanceof BridgeAuthenticationError) throw lastError;
    throw new BridgeConnectionError(message, lastError);
  }

  /**
   * Send a typed command and await its correlated response. Each command uses
   * an internally generated monotonic request id; callers do not see ids.
   */
  async sendCommand<T = unknown>(
    command: string,
    params: Record<string, unknown> = {},
    timeoutMs?: number,
  ): Promise<T> {
    if (!this.connected || !this.socket) {
      throw new BridgeConnectionError('Not connected to the runtime interaction bridge.');
    }
    const id = this.nextRequestId++;
    const timeout = timeoutMs ?? this.options.commandTimeoutMs;
    return new Promise<T>((resolve, reject) => {
      const resolver: PendingResolver = {
        resolve: value => resolve(value as T),
        reject,
        timer: null,
      };
      resolver.timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Bridge command '${command}' timed out after ${timeout / 1000}s`));
      }, timeout);
      this.pending.set(id, resolver);

      try {
        const payload = JSON.stringify({ command, params, id }) + '\n';
        this.socket!.write(payload);
      } catch (err) {
        this.pending.delete(id);
        if (resolver.timer) clearTimeout(resolver.timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /**
   * Idempotently close the socket, drop pending requests, and reset the
   * response buffer. Subsequent sendCommand calls will reject until connect()
   * is called again.
   */
  disconnect(): void {
    this.teardownSocket();
    this.rejectAllPending(new Error('Bridge disconnected'));
  }

  private async openSocket(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const socket = this.options.socketFactory(this.options.host, this.options.port);

      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        socket.removeAllListeners();
        if (!socket.destroyed) socket.destroy();
        reject(err);
      };
      const succeed = () => {
        if (settled) return;
        settled = true;
        resolve();
      };

      const connectTimer = setTimeout(() => {
        fail(new BridgeConnectionError(
          `Bridge socket connect exceeded ${this.options.connectTimeoutMs}ms`,
        ));
      }, this.options.connectTimeoutMs);

      socket.once('connect', () => {
        clearTimeout(connectTimer);
        this.socket = socket;
        this.responseBuffer = '';
        this.connected = true;
        this.debug(`Connected to bridge on ${this.options.host}:${this.options.port}`);
        this.attachSocketListeners(socket);
        succeed();
      });
      socket.once('error', err => {
        clearTimeout(connectTimer);
        fail(err instanceof Error ? err : new BridgeConnectionError(String(err)));
      });
    });
  }

  private attachSocketListeners(socket: Socket): void {
    socket.on('data', (data: Buffer) => this.handleData(data));
    socket.on('close', () => this.handleClose());
    socket.on('error', err => {
      this.debug(`Bridge socket error: ${err.message}`);
    });
  }

  private handleData(data: Buffer): void {
    this.responseBuffer += data.toString();
    if (Buffer.byteLength(this.responseBuffer, 'utf8') > this.options.maxFrameBytes) {
      this.debug('Bridge response exceeded the configured frame buffer limit');
      this.rejectAllPending(
        new BridgeFrameError(
          `Bridge response exceeded the ${this.options.maxFrameBytes} byte limit`,
        ),
      );
      this.teardownSocket();
      return;
    }
    let newlinePos = this.responseBuffer.indexOf('\n');
    while (newlinePos !== -1) {
      const line = this.responseBuffer.substring(0, newlinePos).trim();
      this.responseBuffer = this.responseBuffer.substring(newlinePos + 1);
      if (line.length > 0) {
        try {
          const parsed = JSON.parse(line) as BridgeResponse;
          this.resolvePending(parsed);
        } catch (err) {
          this.debug(`Failed to parse bridge response: ${(err as Error).message}`);
        }
      }
      newlinePos = this.responseBuffer.indexOf('\n');
    }
  }

  private handleClose(): void {
    this.debug('Bridge connection closed');
    this.connected = false;
    this.socket = null;
    this.rejectAllPending(new Error('Connection closed'));
  }

  private teardownSocket(): void {
    this.connected = false;
    if (this.socket && !this.socket.destroyed) {
      this.socket.removeAllListeners();
      this.socket.destroy();
    }
    this.socket = null;
    this.responseBuffer = '';
  }

  private resolvePending(parsed: BridgeResponse): void {
    const pending = this.pending;
    let id: number | undefined;
    if (parsed && typeof parsed.id === 'number') {
      if (!pending.has(parsed.id)) return;
      id = parsed.id;
    } else if (pending.size > 0) {
      // Server-driven (id-less) frames are routed to the oldest pending request.
      id = pending.keys().next().value;
    }
    if (id === undefined) return;
    const resolver = pending.get(id);
    if (!resolver) return;
    pending.delete(id);
    if (resolver.timer) clearTimeout(resolver.timer);
    resolver.resolve(parsed);
  }

  private rejectAllPending(error: Error): void {
    for (const resolver of this.pending.values()) {
      if (resolver.timer) clearTimeout(resolver.timer);
      resolver.reject(error);
    }
    this.pending.clear();
  }

  private async authenticate(): Promise<BridgeAuthResult> {
    let auth: BridgeResponse;
    try {
      auth = await this.sendCommand<BridgeResponse>(
        '__authenticate',
        { token: this.options.token },
        this.options.connectTimeoutMs,
      );
    } catch (err) {
      throw new BridgeAuthenticationError(
        err instanceof Error ? err.message : String(err),
        err,
      );
    }
    if (auth?.error) {
      throw new BridgeAuthenticationError(auth.error);
    }
    const result = auth?.result as Partial<BridgeAuthResult> | undefined;
    if (!result || result.authenticated !== true) {
      throw new BridgeAuthenticationError(
        'Bridge refused the runtime authentication token.',
      );
    }
    if (
      typeof result.protocolVersion !== 'number' ||
      result.protocolVersion !== this.options.expectedProtocolVersion
    ) {
      throw new BridgeAuthenticationError(
        `Bridge protocol version ${result.protocolVersion} does not match expected ${this.options.expectedProtocolVersion}`,
      );
    }
    return { authenticated: true, protocolVersion: result.protocolVersion };
  }

  private debug(message: string): void {
    if (this.options.onDebug) this.options.onDebug(message);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}