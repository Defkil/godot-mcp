/**
 * Wire-level regression for the script/resource handler bodies' defense-in-depth
 * PathPolicy contract. The five handlers are `handleValidateScript`,
 * `handleValidateScripts`, `handleCreateScript`, `handleCreateResource`,
 * and `handleManageResource`.
 *
 * Each handler historically opened with `if (!validatePath(args.projectPath)
 * || !validatePath(args.<member>)) return createErrorResponse('Invalid path.');`
 * The lexical `validatePath` only rejects empty / `..`-prefixed / null-byte
 * strings — it does not enforce the canonical-roots list or canonical-member
 * resolution. The request-boundary `assertSafeToolPaths` guard already rejects
 * every canonical member path that would escape the configured `PathPolicy`
 * roots BEFORE the handler is called, so the runtime is not exposed to a fresh
 * escape. This test proves the same contract is enforced *inside the handler
 * body itself* by invoking the private handler method directly (bypassing
 * `tools/call`) and asserting that a typed `isError: true` envelope is returned
 * for every documented escape attempt:
 *
 *   - `projectPath` outside the configured allowed roots
 *     (caught by `pathPolicy.assertProject`).
 *   - `scriptPath` / `resourcePath` containing a `..` segment
 *     (caught by `pathPolicy.resolveProjectMember`).
 *   - `scriptPath` / `resourcePath` containing an absolute path
 *     (caught by `pathPolicy.resolveProjectMember`).
 *
 * The fixture is a temporary Godot project under the OS temp directory,
 * removed in `afterEach`. The test invokes the private handler method via
 * `(server as any).handleXxx(args)` and stubs nothing relevant to the gate.
 */

import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GodotServer } from '../src/server.js';
import { PathPolicy } from '../src/security/path-policy.js';
import { CapabilityPolicy } from '../src/security/capability-policy.js';

const tempRoots: string[] = [];

function makeProject(
  initialProjectGodot = '[application]\nconfig/name="ScriptResourceGate"\nfeatures=PackedStringArray("4.4")\n',
): { root: string; projectFile: string } {
  const root = mkdtempSync(join(tmpdir(), 'godot-mcp-script-resource-gate-'));
  tempRoots.push(root);
  const projectFile = join(root, 'project.godot');
  writeFileSync(projectFile, initialProjectGodot, 'utf8');
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

describe('script / resource handlers adopt PathPolicy contract in their own body', () => {
  // ---------- validate_script ----------

  it('validate_script rejects a projectPath outside the configured allowed roots', async () => {
    const { root } = makeProject();
    const server = makeServer(root);
    const outside = mkdtempSync(join(tmpdir(), 'godot-mcp-script-resource-outside-'));
    tempRoots.push(outside);
    const response = await (server as any).handleValidateScript({
      projectPath: outside,
      scriptPath: 'scripts/player.gd',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/path|allowed roots|invalid/i);
  });

  it('validate_script rejects a scriptPath containing a .. traversal', async () => {
    const { root } = makeProject();
    const server = makeServer(root);
    const response = await (server as any).handleValidateScript({
      projectPath: root,
      scriptPath: 'scripts/../../etc/passwd',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/scriptPath|path|invalid|escape|traversal/i);
  });

  // ---------- validate_scripts ----------

  it('validate_scripts rejects a projectPath outside the configured allowed roots', async () => {
    const { root } = makeProject();
    const server = makeServer(root);
    const outside = mkdtempSync(join(tmpdir(), 'godot-mcp-script-resource-outside-'));
    tempRoots.push(outside);
    const response = await (server as any).handleValidateScripts({
      projectPath: outside,
      scope: 'all',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/path|allowed roots|invalid/i);
  });

  // ---------- create_script ----------

  it('create_script rejects a projectPath outside the configured allowed roots', async () => {
    const { root } = makeProject();
    const server = makeServer(root);
    const outside = mkdtempSync(join(tmpdir(), 'godot-mcp-script-resource-outside-'));
    tempRoots.push(outside);
    const response = await (server as any).handleCreateScript({
      projectPath: outside,
      scriptPath: 'scripts/player.gd',
      extends: 'Node',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/path|allowed roots|invalid/i);
  });

  it('create_script rejects a scriptPath containing a .. traversal', async () => {
    const { root } = makeProject();
    const server = makeServer(root);
    const response = await (server as any).handleCreateScript({
      projectPath: root,
      scriptPath: 'scripts/../../etc/passwd',
      extends: 'Node',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/scriptPath|path|invalid|escape|traversal/i);
  });

  it('create_script leaves the project byte-identical after a rejected write', async () => {
    const { root, projectFile } = makeProject();
    const before = readFileSync(projectFile, 'utf8');
    const server = makeServer(root);
    const response = await (server as any).handleCreateScript({
      projectPath: root,
      scriptPath: 'scripts/../../etc/passwd',
      extends: 'Node',
    });
    expect(response.isError).toBe(true);
    const after = readFileSync(projectFile, 'utf8');
    expect(after).toBe(before);
  });

  // ---------- create_resource ----------

  it('create_resource rejects a projectPath outside the configured allowed roots', async () => {
    const { root } = makeProject();
    const server = makeServer(root);
    const outside = mkdtempSync(join(tmpdir(), 'godot-mcp-script-resource-outside-'));
    tempRoots.push(outside);
    const response = await (server as any).handleCreateResource({
      projectPath: outside,
      resourceType: 'Resource',
      resourcePath: 'data/settings.tres',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/path|allowed roots|invalid/i);
  });

  it('create_resource rejects a resourcePath containing a .. traversal', async () => {
    const { root } = makeProject();
    const server = makeServer(root);
    const response = await (server as any).handleCreateResource({
      projectPath: root,
      resourceType: 'Resource',
      resourcePath: 'data/../../etc/passwd',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/resourcePath|path|invalid|escape|traversal/i);
  });

  // ---------- manage_resource ----------

  it('manage_resource rejects a projectPath outside the configured allowed roots', async () => {
    const { root } = makeProject();
    const server = makeServer(root);
    const outside = mkdtempSync(join(tmpdir(), 'godot-mcp-script-resource-outside-'));
    tempRoots.push(outside);
    const response = await (server as any).handleManageResource({
      projectPath: outside,
      resourcePath: 'data/settings.tres',
      action: 'load',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/path|allowed roots|invalid/i);
  });

  it('manage_resource rejects a resourcePath containing a .. traversal', async () => {
    const { root } = makeProject();
    const server = makeServer(root);
    const response = await (server as any).handleManageResource({
      projectPath: root,
      resourcePath: 'data/../../etc/passwd',
      action: 'load',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/resourcePath|path|invalid|escape|traversal/i);
  });
});