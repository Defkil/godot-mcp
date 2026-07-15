import { existsSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';

export type PathPolicyErrorCode =
  | 'INVALID_CONFIGURATION'
  | 'INVALID_PATH'
  | 'NOT_A_DIRECTORY'
  | 'OUTSIDE_ALLOWED_ROOTS';

export class PathPolicyError extends Error {
  constructor(
    public readonly code: PathPolicyErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'PathPolicyError';
  }
}

export function parseAllowedDirectories(
  raw: string | undefined,
  platform: NodeJS.Platform = process.platform
): string[] {
  const value = raw?.trim();
  if (!value) return [];

  if (value.startsWith('[')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new PathPolicyError(
        'INVALID_CONFIGURATION',
        'GODOT_MCP_ALLOWED_DIRS must be a valid JSON string array or a delimited list.'
      );
    }
    if (
      !Array.isArray(parsed) ||
      parsed.some((entry) => typeof entry !== 'string' || entry.trim().length === 0)
    ) {
      throw new PathPolicyError(
        'INVALID_CONFIGURATION',
        'GODOT_MCP_ALLOWED_DIRS JSON entries must be non-empty strings.'
      );
    }
    return parsed.map((entry) => entry.trim());
  }

  const delimiter = platform === 'win32' ? /[;,]/ : /[:,]/;
  return value
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function isUncPath(
  rawPath: string,
  platform: NodeJS.Platform = process.platform
): boolean {
  return platform === 'win32' && /^[\\/]{2}/.test(rawPath);
}

function rejectUnsafeSyntax(rawPath: string): void {
  if (typeof rawPath !== 'string' || rawPath.trim().length === 0) {
    throw new PathPolicyError('INVALID_PATH', 'A non-empty filesystem path is required.');
  }
  if (rawPath.includes('\0')) {
    throw new PathPolicyError('INVALID_PATH', 'Filesystem paths cannot contain null bytes.');
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(rawPath)) {
    throw new PathPolicyError('INVALID_PATH', 'Filesystem URI schemes are not accepted here.');
  }
  if (rawPath.split(/[\\/]+/).includes('..')) {
    throw new PathPolicyError('INVALID_PATH', 'Parent-directory traversal is not allowed.');
  }
}

function canonicalExistingDirectory(rawPath: string): string {
  rejectUnsafeSyntax(rawPath);
  let canonical: string;
  try {
    canonical = realpathSync.native(path.resolve(rawPath));
  } catch {
    throw new PathPolicyError('INVALID_PATH', 'The requested directory does not exist.');
  }
  if (!statSync(canonical).isDirectory()) {
    throw new PathPolicyError('NOT_A_DIRECTORY', 'The requested path is not a directory.');
  }
  return canonical;
}

function comparisonPath(value: string): string {
  const normalized = path.normalize(value);
  return process.platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized;
}

function contains(root: string, target: string): boolean {
  const comparedRoot = comparisonPath(root);
  const comparedTarget = comparisonPath(target);
  if (comparedRoot === comparedTarget) return true;
  const relative = path.relative(comparedRoot, comparedTarget);
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
}

export class PathPolicy {
  readonly allowedRoots: readonly string[];

  constructor(allowedRoots: readonly string[]) {
    this.allowedRoots = allowedRoots.map(canonicalExistingDirectory);
  }

  get isRestricted(): boolean {
    return this.allowedRoots.length > 0;
  }

  resolveExistingDirectory(rawPath: string): string {
    this.rejectImplicitUnc(rawPath);
    const canonical = canonicalExistingDirectory(rawPath);
    this.assertAllowed(canonical);
    return canonical;
  }

  resolveFutureDirectory(rawPath: string): string {
    rejectUnsafeSyntax(rawPath);
    this.rejectImplicitUnc(rawPath);

    const absoluteTarget = path.resolve(rawPath);
    let existingAncestor = absoluteTarget;
    while (!existsSync(existingAncestor)) {
      const parent = path.dirname(existingAncestor);
      if (parent === existingAncestor) {
        throw new PathPolicyError('INVALID_PATH', 'No existing parent directory could be resolved.');
      }
      existingAncestor = parent;
    }

    const canonicalAncestor = canonicalExistingDirectory(existingAncestor);
    const suffix = path.relative(existingAncestor, absoluteTarget);
    const canonicalTarget = path.resolve(canonicalAncestor, suffix);
    this.assertAllowed(canonicalTarget);
    return canonicalTarget;
  }

  private rejectImplicitUnc(rawPath: string): void {
    if (isUncPath(rawPath) && !this.allowedRoots.some((root) => isUncPath(root))) {
      throw new PathPolicyError(
        'OUTSIDE_ALLOWED_ROOTS',
        'UNC paths require an explicitly configured UNC allowed root.'
      );
    }
  }

  private assertAllowed(target: string): void {
    if (!this.isRestricted) return;
    if (!this.allowedRoots.some((root) => contains(root, target))) {
      throw new PathPolicyError(
        'OUTSIDE_ALLOWED_ROOTS',
        'The requested path is outside the configured project roots.'
      );
    }
  }
}

export type ToolArguments = Record<string, unknown>;

export function secureToolArguments(
  toolName: string,
  input: ToolArguments | undefined,
  policy: PathPolicy
): ToolArguments | undefined {
  if (!input) return input;
  const secured = { ...input };
  const projectKey =
    typeof secured.projectPath === 'string'
      ? 'projectPath'
      : typeof secured.project_path === 'string'
        ? 'project_path'
        : undefined;

  if (projectKey) {
    const rawProjectPath = secured[projectKey] as string;
    secured[projectKey] =
      toolName === 'create_project'
        ? policy.resolveFutureDirectory(rawProjectPath)
        : policy.resolveExistingDirectory(rawProjectPath);
  }

  if (toolName === 'list_projects' && typeof secured.directory === 'string') {
    secured.directory = policy.resolveExistingDirectory(secured.directory);
  }

  return secured;
}

let permissiveWarningEmitted = false;

export function pathPolicyFromEnvironment(
  raw: string | undefined = process.env.GODOT_MCP_ALLOWED_DIRS
): PathPolicy {
  const policy = new PathPolicy(parseAllowedDirectories(raw));
  if (!policy.isRestricted && !permissiveWarningEmitted) {
    permissiveWarningEmitted = true;
    console.error(
      '[SECURITY] GODOT_MCP_ALLOWED_DIRS is not configured. Project roots remain permissive for compatibility.'
    );
  }
  return policy;
}
