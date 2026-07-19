/**
 * Wire-level regression for the canonical-member contract in
 * `handleValidateScripts`.
 *
 * Two layers are covered:
 *
 *   1. `handleValidateScripts` (args.scriptPaths user-supplied array) —
 *      gated at the request-boundary by `pathPolicy.resolveProjectMember`
 *      so `..` segments and absolute-path bypasses cannot escape the
 *      project root.
 *   2. `handleValidateScripts` inner-loop scanner output — the
 *      `listChangedGdFiles` / `listAllGdFiles` scanners walk from the
 *      canonical project root, but the per-`rel` validation that runs
 *      after the scanner is still a single lexical `validatePath(rel)`
 *      check that lets absolute paths through. The migration replaces
 *      that lexical check with `pathPolicy.resolveProjectMember(projectRoot,
 *      rel)` so a hijacked or future scanner (or a future code path that
 *      feeds non-scanner rel values through the same loop) cannot route
 *      an absolute host path into `existsSync`/`runGdScriptCheck`.
 *
 * The fixture is a temporary Godot project under the OS temp directory,
 * removed in `afterEach`. The test invokes the private handler method via
 * `(server as any).handleXxx(args)` and stubs nothing relevant to the gate.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GodotServer } from '../src/server.js';
import { PathPolicy } from '../src/security/path-policy.js';
import { CapabilityPolicy } from '../src/security/capability-policy.js';

const tempRoots: string[] = [];

function makeProject(): { root: string; projectFile: string } {
  const root = mkdtempSync(join(tmpdir(), 'godot-mcp-validate-scripts-handler-gate-'));
  tempRoots.push(root);
  const projectFile = join(root, 'project.godot');
  writeFileSync(
    projectFile,
    '[application]\nconfig/name="ProjectValidateScriptsHandlerGate"\nfeatures=PackedStringArray("4.4")\n',
    'utf8',
  );
  return { root, projectFile };
}

function makeServer(root: string): GodotServer {
  return new GodotServer({
    pathPolicy: new PathPolicy([root]),
    capabilityPolicy: new CapabilityPolicy('unsafe-full'),
    registerSignalHandlers: false,
  });
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('validate_scripts handler adopts PathPolicy resolveProjectMember on args.scriptPaths', () => {
  it('rejects a projectPath outside the configured allowed roots', async () => {
    const { root } = makeProject();
    const outside = mkdtempSync(join(tmpdir(), 'godot-mcp-validate-scripts-outside-'));
    tempRoots.push(outside);
    const server = makeServer(root);
    const response = await (server as any).handleValidateScripts({
      projectPath: outside,
      scope: 'all',
    });
    expect(response.isError).toBe(true);
    // The canonical-root gate fires BEFORE the `existsSync(project.godot)`
    // check, so the error must reference the allowed-roots policy, not a
    // missing-project file.
    expect(response.content[0].text).toMatch(/outside the (configured )?allowed roots/i);
    expect(response.content[0].text).not.toMatch(/Not a valid Godot project/i);
  });

  it('rejects an explicit scriptPaths entry whose absolute path would escape the project root', async () => {
    const { root } = makeProject();
    const server = makeServer(root);
    const response = await (server as any).handleValidateScripts({
      projectPath: root,
      scriptPaths: ['C:/Windows/System32/evil.gd'],
    });
    expect(response.isError).toBe(true);
    // The canonical-member gate fires BEFORE the `existsSync` /
    // `runGdScriptCheck` flow, so the error must reference the member-path
    // policy, not a runtime spawn failure.
    expect(response.content[0].text).toMatch(/outside the project root|relative to the project root|absolute|traverse|reject/i);
  });

  it('rejects an explicit scriptPaths entry whose `..` traversal would escape the project root', async () => {
    const { root } = makeProject();
    const server = makeServer(root);
    const response = await (server as any).handleValidateScripts({
      projectPath: root,
      scriptPaths: ['res://../etc/passwd.gd'],
    });
    expect(response.isError).toBe(true);
    // The canonical-member gate fires BEFORE the lexical
    // `validatePath(rel)` check, so the error must reference the
    // member-path policy.
    expect(response.content[0].text).toMatch(/outside the project root|traverse|reject/i);
  });
});

describe('validate_scripts inner-loop scanner output is gated by PathPolicy.resolveProjectMember', () => {
  /**
   * The inner-loop `rel` validation that runs after the
   * `listChangedGdFiles` / `listAllGdFiles` scanners historically relied
   * on `validatePath(rel)` (lexical: rejects empty / `..` / null-byte).
   * A scanner-produced relative path whose canonical realpath resolves
   * outside the project root (for example via a symlink that points to
   * a host directory outside the project) passes that lexical check
   * (no `..` substring) and reaches `existsSync(join(projectRoot, rel))`,
   * which `existsSync` follows and returns `true` for. The migration
   * replaces the lexical check with
   * `pathPolicy.resolveProjectMember(projectRoot, rel)`, which throws
   * for any path whose canonical realpath would escape the project
   * root.
   *
   * These tests prove the gate fires for scanner-produced symlink-escape
   * paths BEFORE `runGdScriptCheck` is reached.
   */
  it('drops a scanner-produced symlink escape before runGdScriptCheck fires', async () => {
    const { root } = makeProject();
    // Create a symlink at <root>/scripts that points OUTSIDE the
    // project root, so `existsSync(join(root, 'scripts/evil.gd'))`
    // follows the symlink and returns `true` while
    // `pathPolicy.resolveProjectMember(root, 'scripts/evil.gd')` throws
    // because the canonical realpath escapes the project root.
    const outside = mkdtempSync(join(tmpdir(), 'godot-mcp-validate-scripts-outside-symlink-'));
    tempRoots.push(outside);
    writeFileSync(join(outside, 'evil.gd'), 'extends Node\n', 'utf8');
    const scriptsLink = join(root, 'scripts');
    // symlinkSync requires the destination not to exist; the parent's
    // previous afterEach cleans up the entire root, so a fresh
    // mkdtempSync cannot collide.
    let symlinkCreated = false;
    try {
      const { symlinkSync } = await import('node:fs');
      symlinkSync(outside, scriptsLink, 'dir');
      symlinkCreated = true;
    } catch {
      // Symlink creation failed (insufficient privilege on this
      // host). The test is defense-in-depth, not a release-blocker;
      // skip it gracefully.
    }
    if (!symlinkCreated) return;

    const server = makeServer(root);
    const runSpy = vi.fn(async () => ({ completed: true, errors: [] as string[] }));
    (server as any).runGdScriptCheck = runSpy;
    (server as any).listAllGdFiles = () => ['scripts/evil.gd'];
    const response = await (server as any).handleValidateScripts({
      projectPath: root,
      scope: 'all',
    });
    expect(response.isError).not.toBe(true);
    // The malicious rel must NOT have been queued for a Godot script
    // check. The canonical-member gate must have intercepted it
    // because the symlink target escapes the project root.
    expect(runSpy).not.toHaveBeenCalled();
    const parsed = JSON.parse(response.content[0].text);
    expect(parsed.fileCount).toBe(0);
    expect(parsed.results).toEqual([]);
  });

  it('accepts a scanner-produced project-relative .gd path and forwards it to runGdScriptCheck', async () => {
    const { root } = makeProject();
    // Create one .gd file under scripts/ so existsSync accepts it.
    const scriptsDir = join(root, 'scripts');
    mkdirSync(scriptsDir, { recursive: true });
    const rel = 'scripts/player.gd';
    const relPath = join(root, rel);
    writeFileSync(relPath, 'extends Node\n', 'utf8');
    expect(existsSync(relPath)).toBe(true);

    const server = makeServer(root);
    const runSpy = vi.fn(async () => ({ completed: true, errors: [] as string[] }));
    (server as any).runGdScriptCheck = runSpy;
    (server as any).listAllGdFiles = () => [rel];

    const response = await (server as any).handleValidateScripts({
      projectPath: root,
      scope: 'all',
    });
    expect(response.isError).not.toBe(true);
    // The benign rel must have been forwarded to runGdScriptCheck.
    expect(runSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(response.content[0].text);
    expect(parsed.fileCount).toBe(1);
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0].scriptPath).toBe(rel);
  });
});
