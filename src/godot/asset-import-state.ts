/**
 * Asset import-state detection for Godot 4.4+.
 *
 * Godot 4.4 replaced the legacy "import on demand" heuristic with an
 * import-on-open pipeline: every binary or external asset a project
 * references must have a matching `<asset>.import` sidecar written by the
 * editor before the runtime `Resource.load()` / `load()` API will
 * resolve it. Without the sidecar the editor prints a noisy warning and
 * the runtime gets back `null`, which surfaces as a silent no-op in our
 * GDScript `load_sprite` handler.
 *
 * This helper gives the TypeScript layer a deterministic way to detect
 * the missing-sidecar state BEFORE the operation runner is launched, so
 * callers see a typed `isError: true` envelope naming the asset and the
 * Godot CLI command needed to import it (`godot --headless --path <project>
 * --editor --quit --import`).
 *
 * The helper is a side-effect-free library module — no `executeOperation`,
 * no Godot spawn, no `PathPolicy` instance mutation. The package wires it
 * into `handleLoadSprite`, `handleCreateResource`, and `handleManageResource`
 * via a small typed `detectAssetImportState` call at the request boundary.
 */

import { existsSync as fsExistsSync } from 'node:fs';
import * as nodePath from 'node:path';
import { PathPolicy } from '../security/path-policy.js';

/**
 * Extensions whose Godot 4.4+ loader requires a generated `<asset>.import`
 * sidecar. Keep this list exhaustive: every importer type Godot ships in
 * `editor/import/` ships an `.import` sidecar, so the union of importer
 * file extensions is the union of extensions that need the sidecar.
 *
 * If a future Godot version adds a new extension, add it here AND in the
 * corresponding optional-importer doc; the wire-level test in
 * `tests/asset-import-prerequisite.test.ts` will then document its
 * membership.
 */
const IMPORT_ELIGIBLE_EXTENSIONS = new Set<string>([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.svg',
  '.ktx2',
  '.tga',
  '.bmp',
  '.exr',
  '.hdr',
  '.gif',
  '.aseprite',
  '.ase',
  // `.pck` packs and `.json` data files are loaded directly by Godot APIs;
  // they do not receive generated `<asset>.import` sidecars.
  '.glb',
  '.gltf',
  '.blend',
  '.fbx',
  '.obj',
  '.wav',
  '.ogg',
  '.mp3',
]);

/**
 * The diagnostic verdict for a single asset import-state probe.
 *
 * `state: 'imported'` means the asset exists on disk and its `.import`
 * sidecar is present, so headless operations may proceed.
 * `state: 'missing-sidecar'` means the asset exists but the import sidecar
 * does not; the caller must run the Godot CLI once to import the asset.
 * `state: 'not-an-asset'` means the path's extension is not on the
 * import-eligible list (e.g. `.gd`, `.cs`, `.tscn`, `.uid`).
 * `state: 'missing-source'` means the path's source file does not exist
 * (a separate failure mode the caller should handle).
 */
export type AssetImportState =
  | 'imported'
  | 'missing-sidecar'
  | 'not-an-asset'
  | 'missing-source';

export interface AssetImportProbe {
  state: AssetImportState;
  /** Project-relative path the probe was asked about. */
  relativePath: string;
  /** Lowercase extension including the leading dot, when applicable. */
  extension?: string;
  /** Project-relative `.import` sidecar path (always present, used in the
   *  diagnostic when missing). */
  sidecarPath: string;
  /** Human-readable diagnostic suitable for inclusion in a typed MCP error. */
  diagnostic: string;
}

export interface AssetImportProbeOptions {
  /**
   * Filesystem probe to use. Defaults to `existsSync` from `node:fs`.
   * Tests inject a stub.
   */
  exists?: (path: string) => boolean;
  /**
   * Optional `PathPolicy` for canonical resolution. When omitted the
   * helper uses the bounded in-function resolver that requires an absolute
   * project path and a relative project member.
   */
  pathPolicy?: PathPolicy;
}

/**
 * Detect whether a project-relative asset path has its matching `.import`
 * sidecar. Pure: takes a `PathPolicy` (or the built-in resolver) and an
 * `exists` predicate; returns a typed `AssetImportProbe`. Throws a typed
 * error when the path is absolute or traverses outside the project root —
 * that is the same closed-list policy `PathPolicy.resolveProjectMember`
 * enforces, so the wire handler does not need to handle two layers of
 * failure modes.
 */
export function detectAssetImportState(
  projectRoot: string,
  relativePath: string,
  options: AssetImportProbeOptions = {},
): AssetImportProbe {
  if (!projectRoot || !relativePath) {
    throw new Error('detectAssetImportState: projectRoot and relativePath are required');
  }
  const exists = options.exists ?? fsExistsSync;
  const absoluteProject = options.pathPolicy
    ? options.pathPolicy.assertProject(projectRoot)
    : requireAbsoluteProjectRoot(projectRoot);
  const absoluteMember = options.pathPolicy
    ? options.pathPolicy.resolveProjectMember(projectRoot, relativePath)
    : resolveRelativeMember(absoluteProject, relativePath);

  const normalizedRelative = relativePath.replace(/\\/g, '/');
  const sidecarPath = `${normalizedRelative}.import`;
  const extension = extractExtension(normalizedRelative);
  const isImportEligible = extension ? IMPORT_ELIGIBLE_EXTENSIONS.has(extension) : false;

  if (!exists(absoluteMember)) {
    return {
      state: 'missing-source',
      relativePath: normalizedRelative,
      extension,
      sidecarPath,
      diagnostic:
        `Asset source does not exist on disk: ${normalizedRelative}. ` +
        `Confirm the path is relative to ${absoluteProject} and points at a file Godot can read.`,
    };
  }

  if (!isImportEligible) {
    return {
      state: 'not-an-asset',
      relativePath: normalizedRelative,
      extension,
      sidecarPath,
      diagnostic:
        `Path ${normalizedRelative} is not subject to the Godot 4.4+ import pipeline ` +
        `(${extension ?? 'no extension'} is hand-authored or a managed sidecar).`,
    };
  }

  const sidecarAbsolute = `${absoluteMember}.import`;
  if (!exists(sidecarAbsolute)) {
    return {
      state: 'missing-sidecar',
      relativePath: normalizedRelative,
      extension,
      sidecarPath,
      diagnostic:
        `Godot 4.4+ requires a generated \`.import\` sidecar for ${normalizedRelative}. ` +
        `Run \`godot --headless --path ${quoteForShell(absoluteProject)} --editor --quit --import\` ` +
        `(or open the project in the Godot editor once) to create ${sidecarPath}, then retry.`,
    };
  }

  return {
    state: 'imported',
    relativePath: normalizedRelative,
    extension,
    sidecarPath,
    diagnostic: `Asset ${normalizedRelative} is imported (sidecar ${sidecarPath} present).`,
  };
}

function quoteForShell(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

/**
 * Build a one-shot, human-readable remediation string for any caller that
 * wants to surface the prerequisite in their own error envelope. Returns
 * the absolute project path and the exact Godot CLI command needed to
 * import the sidecar.
 */
export function resolveAssetImportRequirement(
  projectRoot: string,
  relativePath: string,
  godotBin: string = 'godot',
): string {
  if (!projectRoot || !relativePath) {
    throw new Error('resolveAssetImportRequirement: projectRoot and relativePath are required');
  }
  const normalized = relativePath.replace(/\\/g, '/');
  return (
    `Run \`${godotBin} --headless --path ${quoteForShell(projectRoot)} --editor --quit --import\` ` +
    `to generate the \`.import\` sidecar for ${normalized}, then retry the original command.`
  );
}

function extractExtension(relativePath: string): string | undefined {
  const lastDot = relativePath.lastIndexOf('.');
  const lastSlash = Math.max(relativePath.lastIndexOf('/'), relativePath.lastIndexOf('\\'));
  if (lastDot <= lastSlash || lastDot === -1) return undefined;
  return relativePath.slice(lastDot).toLowerCase();
}

function requireAbsoluteProjectRoot(value: string): string {
  if (!value || value.includes('\0')) {
    throw new Error('Project root is empty or contains a null byte.');
  }
  if (!nodePath.isAbsolute(value)) {
    throw new Error('Project root must be absolute.');
  }
  return value;
}

function resolveRelativeMember(projectRoot: string, relativePath: string): string {
  if (!relativePath || relativePath.includes('\0')) {
    throw new Error('Project member path is empty or contains a null byte.');
  }
  if (relativePath.match(/^[A-Za-z][A-Za-z0-9+.-]*:\/\//)) {
    throw new Error('Unsupported project member URI scheme.');
  }
  if (nodePath.isAbsolute(relativePath)) {
    throw new Error('Project member path must be relative to the project root.');
  }
  const segments = relativePath.split(/[\\/]+/).filter(Boolean);
  if (segments.some((segment) => segment === '..')) {
    throw new Error('Project member path cannot traverse outside the project root.');
  }
  // OS-native resolve handles both POSIX and Windows project-root values
  // correctly (Node normalizes backslashes on POSIX, accepts forward
  // slashes on Windows). The earlier posix-only implementation broke on
  // Windows because posix.resolve treats `C:\\foo` as a relative path
  // relative to cwd.
  return nodePath.resolve(projectRoot, ...segments);
}
