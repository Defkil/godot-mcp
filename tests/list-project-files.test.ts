import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { listProjectFiles } from '../src/tools/project/list-project-files.js';

const tempRoots: string[] = [];

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'godot-mcp-list-files-'));
  tempRoots.push(root);
  mkdirSync(join(root, 'zeta'));
  mkdirSync(join(root, 'alpha'));
  mkdirSync(join(root, '.godot'));
  writeFileSync(join(root, 'zeta', 'last.gd'), 'extends Node\n');
  writeFileSync(join(root, 'alpha', 'first.gd'), 'extends Node\n');
  writeFileSync(join(root, 'alpha', 'notes.md'), '# notes\n');
  writeFileSync(join(root, '.godot', 'generated.gd'), 'generated\n');
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('listProjectFiles', () => {
  it('returns deterministic project-relative paths and excludes hidden trees', () => {
    const root = fixture();

    expect(listProjectFiles(root)).toEqual({
      count: 3,
      files: ['alpha/first.gd', 'alpha/notes.md', 'zeta/last.gd'],
      truncated: false,
    });
  });

  it('filters extensions and preserves project-relative paths for a subdirectory', () => {
    const root = fixture();

    expect(listProjectFiles(root, { subdirectory: 'alpha', extensions: ['.gd'] })).toEqual({
      count: 1,
      files: ['alpha/first.gd'],
      truncated: false,
    });
  });

  it('stops deterministically at the configured entry bound', () => {
    const root = fixture();

    expect(listProjectFiles(root, { maxEntries: 2 })).toEqual({
      count: 2,
      files: ['alpha/first.gd', 'alpha/notes.md'],
      truncated: true,
    });
  });

  it('bounds encoded output and total filesystem traversal', () => {
    const root = fixture();

    expect(listProjectFiles(root, { maxBytes: 10 })).toEqual({
      count: 0,
      files: [],
      truncated: true,
    });
    expect(listProjectFiles(root, { maxScannedEntries: 1 })).toEqual({
      count: 0,
      files: [],
      truncated: true,
    });
  });

  it('rejects subdirectories outside the project root', () => {
    const root = fixture();
    expect(() => listProjectFiles(root, { subdirectory: '..' }))
      .toThrow('inside the project root');
  });
});
