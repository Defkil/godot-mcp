/**
 * Wire-level regression for the sibling-of-[tugcantopaloglu#9] injection
 * bug present in `handleManageCiPipeline`.
 *
 * The handler historically wrote the workflow file via:
 *
 *   const projectFile = join(args.projectPath, 'project.godot');
 *   if (!existsSync(projectFile)) return error;
 *   const workflowDir = join(args.projectPath, '.github', 'workflows');
 *   const workflowPath = join(workflowDir, 'godot-export.yml');
 *   writeFileSync(workflowPath, workflow, 'utf8');   // 'create'
 *   readFileSync(workflowPath, 'utf8');             // 'read'
 *
 * behind only a lexical `validatePath` boundary on `projectPath`, with
 * no canonical-root enforcement and no validation of the user-controlled
 * `godotVersion` / `platforms` strings that get embedded directly into
 * the workflow YAML and shell content.
 *
 * `godotVersion` is interpolated into shell commands inside the generated
 * YAML (`mkdir -p ~/.local/share/godot/export_templates/${godotVersion}`
 * and `mv /root/.local/share/godot/export_templates/${godotVersion}/* ...`),
 * and `platforms` is interpolated into `godot --export-release "${p}"`
 * shell steps. A newline / quote / backtick / `;` in either string
 * lets the caller break out of the workflow file content and inject
 * arbitrary GitHub Actions steps or shell commands.
 *
 * The package closes the wire contract that the typed gate must hold:
 *
 *   - `manage_ci_pipeline` requires `projectPath` to pass the canonical
 *     `pathPolicy.assertProject` boundary, replacing the lexical
 *     `validatePath` (which only rejects empty / `..`-bearing strings
 *     but lets newlines, quotes, brackets, etc. through).
 *   - `manage_ci_pipeline` requires `action` to be exactly `read` or
 *     `create` BEFORE any filesystem call.
 *   - `manage_ci_pipeline` requires `godotVersion` to match a strict
 *     Godot release-tag allowlist (`^[0-9]+\.[0-9]+(\.[0-9]+)?(-[a-z0-9]+)?$`)
 *     so a caller cannot smuggle newlines, quotes, brackets, semicolons,
 *     or backticks into the generated YAML.
 *   - Each `platforms[]` entry must match the canonical Godot export
 *     preset allowlist (`linux`, `windows`, `macos`, `web`, `android`,
 *     `ios`) so a caller cannot inject arbitrary shell into the
 *     generated YAML.
 *   - Unknown `action` values are rejected with a typed error envelope
 *     before any filesystem call.
 *
 * The fixture is a temporary Godot project under the OS temp directory,
 * removed in `afterEach`. The test drives the real MCP `tools/call`
 * handler for `manage_ci_pipeline` and stubs nothing relevant to the
 * gate (the tool writes / reads `.github/workflows/godot-export.yml`
 * directly, no `executeOperation` exists).
 */

import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { GodotServer } from '../src/server.js';
import { PathPolicy } from '../src/security/path-policy.js';
import { CapabilityPolicy } from '../src/security/capability-policy.js';

const tempRoots: string[] = [];

function makeProject(
  initialProjectGodot =
    '[application]\nconfig/name="ManageCiPipelineGate"\nfeatures=PackedStringArray("4.4")\n',
): { root: string; projectFile: string } {
  const root = mkdtempSync(join(tmpdir(), 'godot-mcp-manage-ci-pipeline-injection-'));
  tempRoots.push(root);
  const projectFile = join(root, 'project.godot');
  writeFileSync(projectFile, initialProjectGodot, 'utf8');
  return { root, projectFile };
}

function requestHandler(server: GodotServer, method: 'tools/list' | 'tools/call') {
  const handlers = (server as any).server._requestHandlers as Map<string, Function>;
  const handler = handlers.get(method);
  if (!handler) throw new Error(`Missing MCP request handler: ${method}`);
  return handler;
}

async function toolsCall(
  server: GodotServer,
  name: string,
  args: Record<string, unknown>,
) {
  const handler = requestHandler(server, 'tools/call');
  return handler(
    { method: 'tools/call', params: { name, arguments: args } },
    {},
  );
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

describe('manage_ci_pipeline injection gate (sibling of tugcantopaloglu#9)', () => {
  it('rejects a godotVersion containing a section-breaking newline', async () => {
    const { root, projectFile } = makeProject();
    const before = readFileSync(projectFile, 'utf8');
    const server = makeServer(root);
    const response = await toolsCall(server, 'manage_ci_pipeline', {
      projectPath: root,
      action: 'create',
      godotVersion: '4.3-stable\n    run: |\n      echo PWNED > /tmp/pwned\n',
      platforms: ['linux'],
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/godotVersion/i);
    const after = readFileSync(projectFile, 'utf8');
    expect(after).toBe(before);
    const workflowPath = join(root, '.github', 'workflows', 'godot-export.yml');
    expect(existsSync(workflowPath)).toBe(false);
  });

  it('rejects a godotVersion containing a shell backtick', async () => {
    const { root, projectFile } = makeProject();
    const before = readFileSync(projectFile, 'utf8');
    const server = makeServer(root);
    const response = await toolsCall(server, 'manage_ci_pipeline', {
      projectPath: root,
      action: 'create',
      godotVersion: '4.3-`whoami`',
      platforms: ['linux'],
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/godotVersion/i);
    const after = readFileSync(projectFile, 'utf8');
    expect(after).toBe(before);
    const workflowPath = join(root, '.github', 'workflows', 'godot-export.yml');
    expect(existsSync(workflowPath)).toBe(false);
  });

  it('rejects a godotVersion containing a double-quote break-out', async () => {
    const { root, projectFile } = makeProject();
    const before = readFileSync(projectFile, 'utf8');
    const server = makeServer(root);
    const response = await toolsCall(server, 'manage_ci_pipeline', {
      projectPath: root,
      action: 'create',
      godotVersion: '4.3-stable"\n    runs-on: [self-hosted, malicious]\n    steps:\n      - run: echo PWNED',
      platforms: ['linux'],
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/godotVersion/i);
    const after = readFileSync(projectFile, 'utf8');
    expect(after).toBe(before);
    const workflowPath = join(root, '.github', 'workflows', 'godot-export.yml');
    expect(existsSync(workflowPath)).toBe(false);
  });

  it('rejects a platforms entry containing a shell break-out', async () => {
    const { root, projectFile } = makeProject();
    const before = readFileSync(projectFile, 'utf8');
    const server = makeServer(root);
    const response = await toolsCall(server, 'manage_ci_pipeline', {
      projectPath: root,
      action: 'create',
      godotVersion: '4.3-stable',
      platforms: ['linux"\n      - run: echo PWNED'],
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/platforms/i);
    const after = readFileSync(projectFile, 'utf8');
    expect(after).toBe(before);
    const workflowPath = join(root, '.github', 'workflows', 'godot-export.yml');
    expect(existsSync(workflowPath)).toBe(false);
  });

  it('rejects an unknown action without touching the filesystem', async () => {
    const { root, projectFile } = makeProject();
    const before = readFileSync(projectFile, 'utf8');
    const server = makeServer(root);
    const response = await toolsCall(server, 'manage_ci_pipeline', {
      projectPath: root,
      action: 'delete',
      godotVersion: '4.3-stable',
      platforms: ['linux'],
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/action/i);
    const after = readFileSync(projectFile, 'utf8');
    expect(after).toBe(before);
    const workflowPath = join(root, '.github', 'workflows', 'godot-export.yml');
    expect(existsSync(workflowPath)).toBe(false);
  });

  it('accepts a benign create with a valid version and known platforms', async () => {
    const { root, projectFile } = makeProject();
    const before = readFileSync(projectFile, 'utf8');
    const server = makeServer(root);
    const response = await toolsCall(server, 'manage_ci_pipeline', {
      projectPath: root,
      action: 'create',
      godotVersion: '4.3-stable',
      platforms: ['linux', 'windows'],
    });
    expect(response.isError).toBeFalsy();
    const workflowPath = join(root, '.github', 'workflows', 'godot-export.yml');
    expect(existsSync(workflowPath)).toBe(true);
    const written = readFileSync(workflowPath, 'utf8');
    expect(written).toContain('godot --headless --export-release "linux" build/linux/game');
    expect(written).toContain('godot --headless --export-release "windows" build/windows/game');
    // The gate must not touch project.godot.
    const after = readFileSync(projectFile, 'utf8');
    expect(after).toBe(before);
  });

  it('accepts a benign read of an existing workflow', async () => {
    const { root } = makeProject();
    const workflowDir = join(root, '.github', 'workflows');
    mkdirSync(workflowDir, { recursive: true });
    const workflowPath = join(workflowDir, 'godot-export.yml');
    const expected = 'name: Existing\non: [push]\n';
    writeFileSync(workflowPath, expected, 'utf8');
    const server = makeServer(root);
    const response = await toolsCall(server, 'manage_ci_pipeline', {
      projectPath: root,
      action: 'read',
    });
    expect(response.isError).toBeFalsy();
    expect(response.content[0].text).toBe(expected);
  });

  it('accepts a benign read of a missing workflow with a not-found error envelope', async () => {
    const { root } = makeProject();
    const server = makeServer(root);
    const response = await toolsCall(server, 'manage_ci_pipeline', {
      projectPath: root,
      action: 'read',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/no workflow file found/i);
  });
});
