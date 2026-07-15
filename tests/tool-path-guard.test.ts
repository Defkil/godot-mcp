import { describe, expect, it } from 'vitest';
import { PathPolicy } from '../src/security/path-policy.js';
import { assertSafeToolPaths } from '../src/security/tool-path-guard.js';

const policy = new PathPolicy(['/workspace'], {
  platform: 'linux',
  exists: value => ['/workspace', '/workspace/game', '/workspace/game/assets'].includes(value),
  canonicalize: value => value,
});

describe('assertSafeToolPaths', () => {
  it('accepts project-relative resource arguments', () => {
    expect(() => assertSafeToolPaths(policy, {
      projectPath: '/workspace/game',
      scenePath: 'scenes/Main.tscn',
      script_path: 'res://scripts/player.gd',
      scriptPaths: ['scripts/a.gd', 'scripts/b.gd'],
    })).not.toThrow();
  });

  it.each([
    ['scenePath', '../outside.tscn'],
    ['filePath', '/etc/passwd'],
    ['new_path', 'res://../../outside.gd'],
    ['outputPath', 'C:\\outside.exe'],
  ])('rejects unsafe member argument %s', (key, value) => {
    expect(() => assertSafeToolPaths(policy, {
      projectPath: '/workspace/game',
      [key]: value,
    })).toThrow();
  });

  it('rejects member arrays containing traversal', () => {
    expect(() => assertSafeToolPaths(policy, {
      projectPath: '/workspace/game',
      scriptPaths: ['scripts/good.gd', '../outside.gd'],
    })).toThrow('scriptPaths');
  });

  it('rejects projects and project-search directories outside configured roots', () => {
    expect(() => assertSafeToolPaths(policy, { projectPath: '/other/game' })).toThrow('allowed roots');
    expect(() => assertSafeToolPaths(policy, { directory: '/other' })).toThrow('allowed roots');
  });
});
