import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PathPolicy,
  PathPolicyError,
  isUncPath,
  parseAllowedDirectories,
  secureToolArguments,
} from '../src/security/path-policy.js';

const temporaryRoots: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'gi-go-path-policy-'));
  temporaryRoots.push(directory);
  return directory;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of temporaryRoots.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('parseAllowedDirectories', () => {
  it('recognizes Windows UNC paths with either separator style', () => {
    expect(isUncPath('\\\\server\\share', 'win32')).toBe(true);
    expect(isUncPath('//server/share', 'win32')).toBe(true);
    expect(isUncPath('C:\\Games', 'win32')).toBe(false);
    expect(isUncPath('//server/share', 'linux')).toBe(false);
  });

  it('accepts JSON arrays and rejects malformed JSON arrays', () => {
    expect(parseAllowedDirectories('["/one", "/two"]', 'linux')).toEqual(['/one', '/two']);
    expect(() => parseAllowedDirectories('["/one"', 'linux')).toThrow(PathPolicyError);
    expect(() => parseAllowedDirectories('[1]', 'linux')).toThrow(PathPolicyError);
  });

  it('does not split Windows drive letters on colons', () => {
    expect(parseAllowedDirectories('C:\\Games;D:\\Work,E:\\Safe', 'win32')).toEqual([
      'C:\\Games',
      'D:\\Work',
      'E:\\Safe',
    ]);
  });

  it('supports POSIX colon/comma lists and empty configuration', () => {
    expect(parseAllowedDirectories('/one:/two,/three', 'linux')).toEqual(['/one', '/two', '/three']);
    expect(parseAllowedDirectories('  ', 'linux')).toEqual([]);
  });
});

describe('PathPolicy', () => {
  it('allows an exact configured root and its real descendants', () => {
    const root = temporaryDirectory();
    const project = path.join(root, 'project');
    mkdirSync(project);
    const policy = new PathPolicy([root]);

    expect(policy.resolveExistingDirectory(root)).toBe(realpathSync.native(root));
    expect(policy.resolveExistingDirectory(project)).toBe(realpathSync.native(project));
  });

  it('rejects traversal, sibling-prefix, null-byte, and unsupported URI paths', () => {
    const parent = temporaryDirectory();
    const root = path.join(parent, 'safe');
    const sibling = path.join(parent, 'safe-elsewhere');
    mkdirSync(root);
    mkdirSync(sibling);
    const policy = new PathPolicy([root]);

    expect(() => policy.resolveExistingDirectory(path.join(root, '..', 'safe-elsewhere'))).toThrow(
      PathPolicyError
    );
    expect(() => policy.resolveExistingDirectory(sibling)).toThrow(PathPolicyError);
    expect(() => policy.resolveExistingDirectory(`${root}\0escape`)).toThrow(PathPolicyError);
    expect(() => policy.resolveExistingDirectory('user://outside')).toThrow(PathPolicyError);
  });

  it('validates future projects through their nearest existing parent', () => {
    const root = temporaryDirectory();
    const policy = new PathPolicy([root]);
    const future = path.join(root, 'nested', 'new-project');

    expect(policy.resolveFutureDirectory(future)).toBe(path.resolve(future));
    expect(() => policy.resolveFutureDirectory(path.join(root, '..', 'outside'))).toThrow(PathPolicyError);
  });

  it('detects a symlink or junction that escapes a configured root', () => {
    const parent = temporaryDirectory();
    const root = path.join(parent, 'safe');
    const outside = path.join(parent, 'outside');
    const link = path.join(root, 'escape');
    mkdirSync(root);
    mkdirSync(outside);

    try {
      symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
      if (process.platform === 'win32') {
        console.warn(`Skipping Windows junction assertion: ${String(error)}`);
        return;
      }
      throw error;
    }

    const policy = new PathPolicy([root]);
    expect(() => policy.resolveExistingDirectory(link)).toThrow(PathPolicyError);
    expect(() => policy.resolveFutureDirectory(path.join(link, 'new-project'))).toThrow(PathPolicyError);
  });

  it('remains compatible without configured roots while canonicalizing existing paths', () => {
    const root = temporaryDirectory();
    const policy = new PathPolicy([]);
    expect(policy.isRestricted).toBe(false);
    expect(policy.resolveExistingDirectory(root)).toBe(realpathSync.native(root));
  });
});

describe('secureToolArguments', () => {
  it('uses existing and future project modes and preserves scene-tree paths', () => {
    const root = temporaryDirectory();
    const existing = path.join(root, 'existing');
    mkdirSync(existing);
    writeFileSync(path.join(existing, 'project.godot'), '[application]\n');
    const future = path.join(root, 'future');
    const policy = new PathPolicy([root]);

    const existingArgs = {
      projectPath: existing,
      nodePath: 'Root/Player',
      parentNodePath: 'Root',
    };
    expect(secureToolArguments('read_scene', existingArgs, policy)).toMatchObject({
      projectPath: realpathSync.native(existing),
      nodePath: 'Root/Player',
      parentNodePath: 'Root',
    });
    expect(secureToolArguments('create_project', { project_path: future }, policy)).toEqual({
      project_path: path.resolve(future),
    });
  });

  it('validates only the list_projects directory discovery argument', () => {
    const root = temporaryDirectory();
    const policy = new PathPolicy([root]);

    expect(secureToolArguments('list_projects', { directory: root }, policy)).toEqual({
      directory: realpathSync.native(root),
    });
    expect(secureToolArguments('unrelated_tool', { directory: 'Root/Node' }, policy)).toEqual({
      directory: 'Root/Node',
    });
  });
});
