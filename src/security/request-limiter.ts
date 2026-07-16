/**
 * Bounded request-size, per-tool rate, and global concurrency limiter
 * enforced at the MCP `tools/call` boundary.
 *
 * Three independent knobs, each tunable from the environment:
 *
 * - `GODOT_MCP_MAX_REQUEST_BYTES` — the maximum serialised argument body
 *   accepted in a single `tools/call` request. Defaults to 1 MiB.
 * - `GODOT_MCP_MAX_CONCURRENT_REQUESTS` — the maximum number of in-flight
 *   tool calls the server will process simultaneously. Defaults to 8.
 * - `GODOT_MCP_RATE_PER_MINUTE` — the per-tool token-bucket capacity, refilled
 *   every minute. Defaults to 120.
 *
 * The limiter does not depend on any Node-specific clock: tests inject one.
 * The production default uses `Date.now()` and provides a single, narrowly
 * typed `assertRequestSize` / `acquireConcurrency` / `consumeToken` API so
 * the request boundary can apply all three guards in two lines.
 */

export type RateLimitKind = 'concurrency' | 'rate';

export class RequestTooLargeError extends Error {
  public readonly tool: string;
  public readonly size: number;
  public readonly maxBytes: number;
  public readonly remediation: string;

  constructor(tool: string, size: number, maxBytes: number) {
    const remediation =
      `Request too large: tool '${tool}' sent ${size} bytes, but the configured maximum is ${maxBytes} bytes. ` +
      `Remediation: shrink the tool arguments, or raise GODOT_MCP_MAX_REQUEST_BYTES for the server.`;
    super(remediation);
    this.name = 'RequestTooLargeError';
    this.tool = tool;
    this.size = size;
    this.maxBytes = maxBytes;
    this.remediation = remediation;
  }
}

export class RateLimitExceededError extends Error {
  public readonly tool: string;
  public readonly kind: RateLimitKind;
  public readonly limit: number;
  public readonly remediation: string;

  constructor(tool: string, kind: RateLimitKind, limit: number) {
    const env =
      kind === 'concurrency'
        ? 'GODOT_MCP_MAX_CONCURRENT_REQUESTS'
        : 'GODOT_MCP_RATE_PER_MINUTE';
    const remediation =
      `Rate limit exceeded: tool '${tool}' tripped the ${kind} limit (${limit}). ` +
      `Remediation: slow the caller down, or raise ${env} for the server.`;
    super(remediation);
    this.name = 'RateLimitExceededError';
    this.tool = tool;
    this.kind = kind;
    this.limit = limit;
    this.remediation = remediation;
  }
}

export interface RequestLimiterOptions {
  maxRequestBytes: number;
  maxConcurrentRequests: number;
  ratePerMinute: number;
  /** Optional clock injection for deterministic tests. */
  clock?: () => number;
}

const DEFAULT_MAX_REQUEST_BYTES = 1_048_576; // 1 MiB
const DEFAULT_MAX_CONCURRENT_REQUESTS = 8;
const DEFAULT_RATE_PER_MINUTE = 120;
const RATE_WINDOW_MS = 60_000;

/**
 * Mutable token bucket per tool name. Each bucket has a fixed capacity
 * (ratePerMinute) and refills one token per (60_000 / ratePerMinute) ms.
 *
 * The bucket is intentionally simple: it does not borrow from the next
 * window, it does not coalesce calls, and it does not log. Any of those
 * additions must come with a focused test.
 */
interface TokenBucket {
  /** Remaining tokens at the recorded timestamp. */
  tokens: number;
  /** Timestamp (ms) of the last refill calculation. */
  windowStart: number;
}

export class RequestLimiter {
  public readonly maxRequestBytes: number;
  public readonly maxConcurrentRequests: number;
  public readonly ratePerMinute: number;
  private readonly clock: () => number;
  private readonly buckets: Map<string, TokenBucket> = new Map();
  private inflight = 0;

  constructor(options: RequestLimiterOptions) {
    if (!Number.isFinite(options.maxRequestBytes) || options.maxRequestBytes <= 0) {
      throw new Error(
        `RequestLimiter: maxRequestBytes must be a positive integer (received ${String(options.maxRequestBytes)}).`,
      );
    }
    if (!Number.isInteger(options.maxRequestBytes)) {
      throw new Error(
        `RequestLimiter: maxRequestBytes must be an integer (received ${options.maxRequestBytes}).`,
      );
    }
    if (!Number.isFinite(options.maxConcurrentRequests) || options.maxConcurrentRequests <= 0) {
      throw new Error(
        `RequestLimiter: maxConcurrentRequests must be a positive integer (received ${String(options.maxConcurrentRequests)}).`,
      );
    }
    if (!Number.isInteger(options.maxConcurrentRequests)) {
      throw new Error(
        `RequestLimiter: maxConcurrentRequests must be an integer (received ${options.maxConcurrentRequests}).`,
      );
    }
    if (!Number.isFinite(options.ratePerMinute) || options.ratePerMinute <= 0) {
      throw new Error(
        `RequestLimiter: ratePerMinute must be a positive integer (received ${String(options.ratePerMinute)}).`,
      );
    }
    if (!Number.isInteger(options.ratePerMinute)) {
      throw new Error(
        `RequestLimiter: ratePerMinute must be an integer (received ${options.ratePerMinute}).`,
      );
    }
    this.maxRequestBytes = options.maxRequestBytes;
    this.maxConcurrentRequests = options.maxConcurrentRequests;
    this.ratePerMinute = options.ratePerMinute;
    this.clock = options.clock ?? (() => Date.now());
  }

  /**
   * Compute the JSON-serialised size of a request argument payload.
   *
   * The dispatch handler passes the raw arguments object; we serialize
   * deterministically so the size reflects what actually crosses the
   * JSON boundary rather than `arguments.length`.
   */
  measureRequestSize(arguments_?: Record<string, unknown> | null): number {
    if (arguments_ === undefined || arguments_ === null) return 4; // "{}"
    return JSON.stringify(arguments_).length;
  }

  assertRequestSize(tool: string, arguments_: Record<string, unknown> | undefined | null): void {
    const size = this.measureRequestSize(arguments_);
    if (size > this.maxRequestBytes) {
      throw new RequestTooLargeError(tool, size, this.maxRequestBytes);
    }
  }

  /**
   * Acquire a concurrency slot. Returns a release function that callers
   * MUST invoke when the request finishes (success, failure, or thrown
   * error). The release function is idempotent so dispatch can safely
   * call it in a `finally`.
   */
  acquireConcurrency(tool: string): () => void {
    if (this.inflight >= this.maxConcurrentRequests) {
      throw new RateLimitExceededError(tool, 'concurrency', this.maxConcurrentRequests);
    }
    this.inflight += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.inflight = Math.max(0, this.inflight - 1);
    };
  }

  consumeToken(tool: string): void {
    const now = this.clock();
    const existing = this.buckets.get(tool);
    if (!existing) {
      this.buckets.set(tool, { tokens: this.ratePerMinute - 1, windowStart: now });
      return;
    }
    const elapsed = now - existing.windowStart;
    if (elapsed >= RATE_WINDOW_MS) {
      // Full refill at the start of a new window.
      existing.tokens = this.ratePerMinute - 1;
      existing.windowStart = now;
      return;
    }
    if (existing.tokens <= 0) {
      throw new RateLimitExceededError(tool, 'rate', this.ratePerMinute);
    }
    existing.tokens -= 1;
  }

  /** Test/observability helper. Production code never reads this directly. */
  currentConcurrency(): number {
    return this.inflight;
  }
}

export function parsePositiveIntegerEnv(env: NodeJS.ProcessEnv, key: string): number | undefined {
  const raw = env[key];
  if (raw === undefined || raw === '') return undefined;
  if (!/^-?\d+$/.test(raw.trim())) {
    throw new Error(
      `${key} must be a positive integer (received '${raw}'). Pass a non-negative whole number.`,
    );
  }
  const value = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(
      `${key} must be a positive integer greater than zero (received '${raw}').`,
    );
  }
  return value;
}

export function parseRequestLimiterFromEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): RequestLimiter {
  const maxRequestBytes =
    parsePositiveIntegerEnv(env, 'GODOT_MCP_MAX_REQUEST_BYTES') ?? DEFAULT_MAX_REQUEST_BYTES;
  const maxConcurrentRequests =
    parsePositiveIntegerEnv(env, 'GODOT_MCP_MAX_CONCURRENT_REQUESTS') ??
    DEFAULT_MAX_CONCURRENT_REQUESTS;
  const ratePerMinute =
    parsePositiveIntegerEnv(env, 'GODOT_MCP_RATE_PER_MINUTE') ?? DEFAULT_RATE_PER_MINUTE;
  return new RequestLimiter({ maxRequestBytes, maxConcurrentRequests, ratePerMinute });
}

export interface RequestLimiterSummary {
  maxRequestBytes: number;
  maxConcurrentRequests: number;
  ratePerMinute: number;
}

export function describeRequestLimiter(limiter: RequestLimiter): RequestLimiterSummary {
  return {
    maxRequestBytes: limiter.maxRequestBytes,
    maxConcurrentRequests: limiter.maxConcurrentRequests,
    ratePerMinute: limiter.ratePerMinute,
  };
}