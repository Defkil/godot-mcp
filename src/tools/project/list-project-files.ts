import { readdirSync } from 'fs';
import { isAbsolute, join, relative, resolve, sep } from 'path';

export const DEFAULT_LIST_PROJECT_FILES_MAX_ENTRIES = 1_000;
export const DEFAULT_LIST_PROJECT_FILES_MAX_BYTES = 256 * 1024;
export const DEFAULT_LIST_PROJECT_FILES_MAX_SCANNED_ENTRIES = 10_000;

export interface ListProjectFilesOptions {
  subdirectory?: string;
  extensions?: string[];
  maxEntries?: number;
  maxBytes?: number;
  maxScannedEntries?: number;
}

export interface ProjectFileList {
  count: number;
  files: string[];
  truncated: boolean;
}

function isProjectMember(projectRoot: string, candidate: string): boolean {
  const member = relative(projectRoot, candidate);
  return member === '' || (!member.startsWith(`..${sep}`) && member !== '..' && !isAbsolute(member));
}

function normalizeBound(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error('List bounds must be positive safe integers.');
  }
  return Math.min(value, fallback);
}

export function listProjectFiles(
  projectPath: string,
  options: ListProjectFilesOptions = {},
): ProjectFileList {
  const projectRoot = resolve(projectPath);
  const baseDir = resolve(projectRoot, options.subdirectory ?? '.');
  if (!isProjectMember(projectRoot, baseDir)) {
    throw new Error('Subdirectory must remain inside the project root.');
  }

  const maxEntries = normalizeBound(options.maxEntries, DEFAULT_LIST_PROJECT_FILES_MAX_ENTRIES);
  const maxBytes = normalizeBound(options.maxBytes, DEFAULT_LIST_PROJECT_FILES_MAX_BYTES);
  const maxScannedEntries = normalizeBound(
    options.maxScannedEntries,
    DEFAULT_LIST_PROJECT_FILES_MAX_SCANNED_ENTRIES,
  );
  const extensionFilter = options.extensions && options.extensions.length > 0
    ? new Set(options.extensions)
    : undefined;
  const files: string[] = [];
  let encodedBytes = 2; // JSON array brackets.
  let scannedEntries = 0;
  let truncated = false;

  const scan = (directory: string): void => {
    const entries = readdirSync(directory, { withFileTypes: true })
      .filter(entry => !entry.name.startsWith('.'))
      .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);

    for (const entry of entries) {
      if (truncated) return;
      scannedEntries += 1;
      if (scannedEntries > maxScannedEntries) {
        truncated = true;
        return;
      }
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        scan(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;

      const relativePath = relative(projectRoot, fullPath).split(sep).join('/');
      const extension = `.${entry.name.split('.').pop()}`;
      if (extensionFilter && !extensionFilter.has(extension)) continue;

      const entryBytes = Buffer.byteLength(JSON.stringify(relativePath), 'utf8') + (files.length > 0 ? 1 : 0);
      if (files.length >= maxEntries || encodedBytes + entryBytes > maxBytes) {
        truncated = true;
        return;
      }
      files.push(relativePath);
      encodedBytes += entryBytes;
    }
  };

  scan(baseDir);
  return { count: files.length, files, truncated };
}
