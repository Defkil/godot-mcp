import { describe, expect, it } from 'vitest';
import { PathPolicy, createPathPolicyFromEnvironment, parseAllowedRoots } from '../src/security/path-policy.js';

const windowsCanonical = (value: string) => value.replace(/\//g, '\\');
const posixCanonical = (value: string) => value;

describe('parseAllowedRoots', () => {
  it('preserves Windows drive colons while splitting configured roots', () => {
    expect(parseAllowedRoots('C:\\Games;D:\\Projects,C:\\Work', 'win32')).toEqual([
      'C:\\Games',
      'D:\\Projects',
      'C:\\Work',
    ]);
  });

  it('splits POSIX roots on colon and comma', () => {
    expect(parseAllowedRoots('/games:/workspace,/tmp', 'linux')).toEqual([
      '/games',
      '/workspace',
      '/tmp',
    ]);
  });
});

describe('PathPolicy', () => {
  it('allows the exact configured root and descendants', () => {
    const policy = new PathPolicy(['C:\\Workspace\\Games'], {
      platform: 'win32',
      canonicalize: windowsCanonical,
      exists: () => true,
    });

    expect(policy.allowsProject('c:\\workspace\\games')).toBe(true);
    expect(policy.allowsProject('C:\\Workspace\\Games\\Wargrid')).toBe(true);
  });

  it('rejects sibling-prefix escapes', () => {
    const policy = new PathPolicy(['/workspace/game'], {
      platform: 'linux',
      canonicalize: posixCanonical,
      exists: () => true,
    });

    expect(policy.allowsProject('/workspace/game-evil')).toBe(false);
  });

  it('rejects null bytes and relative project roots', () => {
    const policy = new PathPolicy(['/workspace'], {
      platform: 'linux',
      canonicalize: posixCanonical,
      exists: () => true,
    });

    expect(policy.allowsProject('/workspace/game\0outside')).toBe(false);
    expect(policy.allowsProject('relative/game')).toBe(false);
  });

  it('resolves res:// and relative members inside a project', () => {
    const policy = new PathPolicy(['/workspace'], {
      platform: 'linux',
      canonicalize: posixCanonical,
      exists: () => true,
    });

    expect(policy.resolveProjectMember('/workspace/game', 'res://scenes/main.tscn')).toBe(
      '/workspace/game/scenes/main.tscn',
    );
    expect(policy.resolveProjectMember('/workspace/game', 'scripts/player.gd')).toBe(
      '/workspace/game/scripts/player.gd',
    );
  });

  it('rejects member traversal, absolute members, and unsupported URI schemes', () => {
    const policy = new PathPolicy(['/workspace'], {
      platform: 'linux',
      canonicalize: posixCanonical,
      exists: () => true,
    });

    expect(() => policy.resolveProjectMember('/workspace/game', '../secret.txt')).toThrow();
    expect(() => policy.resolveProjectMember('/workspace/game', '/etc/passwd')).toThrow();
    expect(() => policy.resolveProjectMember('/workspace/game', 'file:///etc/passwd')).toThrow();
  });

  it('defaults to the process working directory instead of unrestricted access', () => {
    const policy = createPathPolicyFromEnvironment({}, '/workspace/default', {
      platform: 'linux',
      exists: () => true,
      canonicalize: posixCanonical,
    });

    expect(policy.allowsProject('/workspace/default/game')).toBe(true);
    expect(policy.allowsProject('/workspace/other')).toBe(false);
  });

  it('canonicalizes through the nearest existing parent for future files', () => {
    const existing = new Set(['/workspace', '/workspace/game']);
    const policy = new PathPolicy(['/workspace'], {
      platform: 'linux',
      exists: value => existing.has(value),
      canonicalize: value => (value === '/workspace/game' ? '/workspace/real-game' : value),
    });

    expect(policy.resolveProjectMember('/workspace/game', 'new/deep/file.gd')).toBe(
      '/workspace/real-game/new/deep/file.gd',
    );
  });
});
