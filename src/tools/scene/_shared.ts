import type { PathPolicy } from '../../security/path-policy.js';

/**
 * Result envelope produced by one Godot headless operation. Mirrors the
 * `executeOperation` shape used by `GodotServer.headlessOp`.
 */
export interface SceneOperationResult {
  stdout: string;
  stderr: string;
  result: { operation: string; status: 'ok' } | { operation: string; status: 'error'; errors?: unknown[] };
}

/**
 * Failure raised when the GDScript operation record a `status: error`
 * postcondition failure. Carries the raw error list so callers can surface a
 * faithful, non-fabricated diagnostic message.
 */
export class SceneOperationPostconditionError extends Error {
  readonly operation: string;
  readonly errors: unknown[];
  constructor(operation: string, errors: unknown[]) {
    const description = Array.isArray(errors)
      ? errors.map(entry => String(entry)).join('\n')
      : `Operation ${operation} reported postcondition failures without an error list.`;
    super(`Operation ${operation} reported postcondition failures:\n${description}`);
    this.name = 'SceneOperationPostconditionError';
    this.operation = operation;
    this.errors = errors;
  }
}

/**
 * Boundary the tool modules need to invoke a Godot headless operation. The
 * server implementation resolves the godot binary and the operations script
 * path; tests inject a fake implementation that returns a scripted
 * `SceneOperationResult` without spawning a real Godot process.
 */
export interface SceneOperationRunner {
  run(operation: string, params: Record<string, unknown>, projectPath: string): Promise<SceneOperationResult>;
}

/**
 * Tool modules resolve canonical paths through `PathPolicy.assertProject` /
 * `resolveProjectMember`. Passing the policy through keeps handlers faithful to
 * the canonical path-root contract that closes
 * [Coding-Solo#39](https://github.com/Coding-Solo/godot-mcp/issues/9) and
 * `tugcantopaloglu#9`.
 */
export interface SceneToolContext {
  pathPolicy: PathPolicy;
  operationRunner: SceneOperationRunner;
}

/**
 * Validate that the supplied properties payload is a plain JSON object so the
 * downstream operation can iterate over it without tripping on undefined
 * properties or arrays of mixed types. Returns the typed value so callers can
 * branch on the failure mode they want to surface.
 */
export function requirePropertiesObject(
  properties: unknown,
): Record<string, unknown> {
  if (properties === null || typeof properties !== 'object' || Array.isArray(properties)) {
    throw new Error("'properties' must be an object describing property name to value pairs.");
  }
  return properties as Record<string, unknown>;
}
