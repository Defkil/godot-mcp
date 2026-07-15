import { existsSync, realpathSync } from 'node:fs';
import { posix, win32 } from 'node:path';

export type SupportedPlatform = 'win32' | 'linux' | 'darwin';

export interface PathPolicyOptions {
  platform?: SupportedPlatform;
  exists?: (value: string) => boolean;
  canonicalize?: (value: string) => string;
}

export function parseAllowedRoots(raw: string, platform: SupportedPlatform = process.platform as SupportedPlatform): string[] {
  if (!raw.trim()) return [];
  const separator = platform === 'win32' ? /[;,]/ : /[:,]/;
  return raw
    .split(separator)
    .map(value => value.trim())
    .filter(Boolean);
}

export class PathPolicy {
  private readonly platform: SupportedPlatform;
  private readonly pathApi: typeof posix | typeof win32;
  private readonly exists: (value: string) => boolean;
  private readonly canonicalize: (value: string) => string;
  private readonly roots: string[];

  constructor(allowedRoots: string[], options: PathPolicyOptions = {}) {
    this.platform = options.platform ?? (process.platform as SupportedPlatform);
    this.pathApi = this.platform === 'win32' ? win32 : posix;
    this.exists = options.exists ?? existsSync;
    this.canonicalize = options.canonicalize ?? (value => realpathSync.native(value));
    this.roots = allowedRoots.map(root => this.canonicalizeNearest(root));
  }

  get restricted(): boolean {
    return this.roots.length > 0;
  }

  allowsProject(projectPath: string): boolean {
    try {
      this.assertSafeAbsolutePath(projectPath, 'project path');
      if (!this.restricted) return true;
      const target = this.canonicalizeNearest(projectPath);
      return this.roots.some(root => this.isWithin(root, target));
    } catch {
      return false;
    }
  }

  assertProject(projectPath: string): string {
    this.assertSafeAbsolutePath(projectPath, 'project path');
    const canonical = this.canonicalizeNearest(projectPath);
    if (this.restricted && !this.roots.some(root => this.isWithin(root, canonical))) {
      throw new Error('Project path is outside the configured allowed roots.');
    }
    return canonical;
  }

  resolveProjectMember(projectPath: string, memberPath: string): string {
    const project = this.assertProject(projectPath);
    if (!memberPath || memberPath.includes('\0')) {
      throw new Error('Project member path is empty or contains a null byte.');
    }

    let relativePath = memberPath;
    const scheme = relativePath.match(/^([A-Za-z][A-Za-z0-9+.-]*):\/\//);
    if (scheme) {
      if (scheme[1].toLowerCase() !== 'res') {
        throw new Error(`Unsupported project member URI scheme: ${scheme[1]}.`);
      }
      relativePath = relativePath.slice(scheme[0].length);
    }

    if (this.pathApi.isAbsolute(relativePath) || win32.isAbsolute(relativePath) || posix.isAbsolute(relativePath)) {
      throw new Error('Project member path must be relative to the project root.');
    }

    const segments = relativePath.split(/[\\/]+/);
    if (segments.some(segment => segment === '..')) {
      throw new Error('Project member path cannot traverse outside the project root.');
    }

    const target = this.canonicalizeNearest(this.pathApi.resolve(project, ...segments));
    if (!this.isWithin(project, target)) {
      throw new Error('Project member path resolves outside the project root.');
    }
    return target;
  }

  private assertSafeAbsolutePath(value: string, label: string): void {
    if (!value || value.includes('\0')) {
      throw new Error(`${label} is empty or contains a null byte.`);
    }
    if (!this.pathApi.isAbsolute(value)) {
      throw new Error(`${label} must be absolute.`);
    }
  }

  private canonicalizeNearest(value: string): string {
    this.assertSafeAbsolutePath(value, 'path');
    let probe = this.pathApi.resolve(value);
    const suffix: string[] = [];

    while (!this.exists(probe)) {
      const parent = this.pathApi.dirname(probe);
      if (parent === probe) break;
      suffix.unshift(this.pathApi.basename(probe));
      probe = parent;
    }

    const canonicalParent = this.exists(probe) ? this.canonicalize(probe) : probe;
    return this.pathApi.resolve(canonicalParent, ...suffix);
  }

  private isWithin(root: string, target: string): boolean {
    const normalizedRoot = this.comparable(root);
    const normalizedTarget = this.comparable(target);
    const relative = this.pathApi.relative(normalizedRoot, normalizedTarget);
    return relative === '' || (!relative.startsWith('..') && !this.pathApi.isAbsolute(relative));
  }

  private comparable(value: string): string {
    const normalized = this.pathApi.normalize(value);
    return this.platform === 'win32' ? normalized.toLowerCase() : normalized;
  }
}

export function createPathPolicyFromEnvironment(
  env: NodeJS.ProcessEnv = process.env,
  defaultRoot: string = process.cwd(),
  options: PathPolicyOptions = {},
): PathPolicy {
  const configuredRoots = parseAllowedRoots(
    env.GODOT_MCP_ALLOWED_DIRS ?? '',
    options.platform ?? (process.platform as SupportedPlatform),
  );
  return new PathPolicy(configuredRoots.length > 0 ? configuredRoots : [defaultRoot], options);
}
