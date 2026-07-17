/**
 * Wire-level regression for the next-follow-up PathPolicy gate migration
 * batch. Closes the canonical-member contract for user-supplied
 * `args.scriptPaths` in `handleValidateScripts`:
 *
 *   - `handleValidateScripts` (args.scriptPaths user-supplied array)
 *
 * The handler already calls `pathPolicy.assertProject` on `args.projectPath`
 * (matching the sibling gates in commits `571ef14` / `68b45be`), but the
 * inner candidate loop at line 7062 still relies on
 * `if (!/\.gd$/i.test(rel) || !validatePath(rel))`. The lexical `validatePath`
 * only rejects empty / `..`-prefixed / null-byte strings; an absolute
 * `scriptPath` like `C:/Windows/System32/evil.gd` slips through and is then
 * `existsSync`-checked against `join(projectRoot, 'C:/Windows/System32/evil.gd')`
 * — which always returns false on POSIX and returns the Windows file
 * existence on Windows, never surfacing the canonical-member escape in the
 * handler body's own defense.
 *
 * This test proves the same canonical-member contract the sibling
 * `core_file_io` / `manage_shader` / `set_main_scene` / `manage_translations` /
 * `manage_autoloads / manage_input_map / manage_export_presets` /
 * `info-scene-settings-handler` / `script-resource-handler` /
 * `manage_scene_signals / manage_theme_resource / manage_scene_structure`
 * gates already enforce is also enforced for `args.scriptPaths` in
 * `handleValidateScripts`, by replacing the inner-loop lexical check with
 * `pathPolicy.resolveProjectMember(projectRoot, rel)` and surfacing the
 * gate failure as a typed `isError: true` envelope.
 *
 * The fixture is a temporary Godot project under the OS temp directory,
 * removed in `afterEach`. The test invokes the private handler method via
 * `(server as any).handleXxx(args)` and stubs nothing relevant to the gate.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
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
