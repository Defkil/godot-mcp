import type { PathPolicy } from '../../security/path-policy.js';

/**
 * Result envelope produced by one Godot headless operation. Mirrors the
 * `executeOperation` shape used by `GodotServer.headlessOp`.
 */
export interface ClassdbInspectResult {
  stdout: string;
  stderr: string;
  result:
    | { operation: string; status: 'ok' }
    | { operation: string; status: 'error'; errors?: unknown[] };
}

/**
 * Failure raised when the GDScript operation records a `status: error`
 * postcondition failure. Carries the raw error list so callers can surface a
 * faithful, non-fabricated diagnostic message.
 */
export class ClassdbInspectPostconditionError extends Error {
  readonly operation: string;
  readonly errors: unknown[];
  constructor(operation: string, errors: unknown[]) {
    const description = Array.isArray(errors)
      ? errors.map(entry => String(entry)).join('\n')
      : `Operation ${operation} reported postcondition failures without an error list.`;
    super(`Operation ${operation} reported postcondition failures:\n${description}`);
    this.name = 'ClassdbInspectPostconditionError';
    this.operation = operation;
    this.errors = errors;
  }
}

/**
 * Boundary the tool module needs to invoke a Godot headless operation. Tests
 * inject a fake implementation that returns a scripted `ClassdbInspectResult`
 * without spawning a real Godot process.
 */
export interface ClassdbInspectRunner {
  run(operation: string, params: Record<string, unknown>, projectPath: string): Promise<ClassdbInspectResult>;
}

/**
 * Tool module resolves canonical paths through `PathPolicy.assertProject`.
 */
export interface ClassdbInspectContext {
  pathPolicy: PathPolicy;
  operationRunner: ClassdbInspectRunner;
}

export interface ClassdbInspectInput {
  projectPath: string;
  className: string;
}

export interface ClassdbInspectOptions {
  pathPolicy: ClassdbInspectContext['pathPolicy'];
  operationRunner: ClassdbInspectContext['operationRunner'];
}

export interface ClassdbInspectSuccess {
  content: Array<{ type: 'text'; text: string }>;
}

export interface ClassdbInspectErrorResponse {
  isError: true;
  content: Array<{ type: 'text'; text: string }>;
}

export type ClassdbInspectResponse = ClassdbInspectSuccess | ClassdbInspectErrorResponse;

const REQUIRED_KEYS: ReadonlyArray<keyof ClassdbInspectInput> = ['projectPath', 'className'];

/**
 * Identifiers resolve through ClassDB / global class names. They are
 * strictly snake_case ASCII tokens — anything that looks like a path,
 * includes a slash, dot, or file extension is rejected so the agent cannot
 * pivot through `classdb_inspect` to load arbitrary resources. This mirrors
 * the two-layer node-class fix adopted from upstream PR #99.
 */
const CLASSDB_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function validateClassdbInspectInput(raw: unknown): ClassdbInspectInput {
  if (!raw || typeof raw !== 'object') {
    throw new Error('classdb_inspect expects an object input.');
  }
  const value = raw as Record<string, unknown>;
  for (const key of REQUIRED_KEYS) {
    if (value[key] === undefined || value[key] === null || value[key] === '') {
      throw new Error(`'${key}' is required for classdb_inspect.`);
    }
  }
  const className = String(value.className);
  if (!CLASSDB_IDENTIFIER.test(className)) {
    throw new Error(
      `'className' must be a Godot class identifier (letters, digits, underscore; not a path or .gd extension). Got: ${className}`,
    );
  }
  return {
    projectPath: String(value.projectPath),
    className,
  };
}

export async function classdbInspect(
  input: ClassdbInspectInput,
  context: ClassdbInspectOptions,
): Promise<ClassdbInspectResponse> {
  const projectPath = context.pathPolicy.assertProject(input.projectPath);

  const execution = await context.operationRunner.run(
    'classdb_inspect',
    {
      class_name: input.className,
    },
    projectPath,
  );

  return renderClassdbInspectResult(execution);
}

export function renderClassdbInspectResult(result: ClassdbInspectResult): ClassdbInspectResponse {
  if (result.result.status === 'error') {
    const errors = result.result.errors ?? [];
    const description = Array.isArray(errors)
      ? errors.map(entry => String(entry)).join('\n')
      : 'Operation reported postcondition failures without an error list.';
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `classdb_inspect failed:\n${description}`,
        },
      ],
    };
  }

  const stdout = result.stdout.trim();
  const stderr = result.stderr.trim();
  if (stdout.length === 0) {
    const fallback = stderr.length > 0
      ? `classdb_inspect produced no output.\nGodot diagnostics:\n${stderr}`
      : 'classdb_inspect produced no output.';
    return {
      isError: true,
      content: [{ type: 'text', text: fallback }],
    };
  }
  return {
    content: [{ type: 'text', text: stdout }],
  };
}