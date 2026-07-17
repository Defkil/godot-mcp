/**
 * Wire-level regression for [tugcantopaloglu#9] — `manage_autoloads`
 * unrestricted persistent autoload injection.
 *
 * `handleManageAutoloads` historically constructed the autoload line as
 * a raw string interpolation `${args.name}="*${args.path}"` and wrote
 * it into `project.godot` without validating `args.name` against a
 * strict identifier regex or `args.path` against a `res://` member
 * shape. A caller could:
 *
 *   1. inject a newline + a new section header (e.g. `\n[input]\nfwd=…`)
 *      to silently corrupt the project's input map / layer table,
 *   2. write any content into the `name` field, including `]` or `=`,
 *      causing the autoload line itself to be malformed,
 *   3. write any non-`res://` path (`player.gd`, `addons/x/y.gd`,
 *      absolute paths, escape sequences) that Godot would silently
 *      refuse to load later.
 *
 * The package closes the wire contract that the typed gate must hold:
 *
 *   - `add` requires `name` to match a strict autoload-name regex
 *     (`[A-Za-z_][A-Za-z0-9_]*`) and `path` to start with `res://`
 *     followed by a canonical relative member that rejects `..` and
 *     `\` escapes. A caller that violates either rule gets a typed
 *     `isError: true` envelope BEFORE any file is written.
 *   - `add`/`remove` are atomic: a failure or rule violation must
 *     leave `project.godot` byte-identical to its pre-call snapshot.
 *   - `remove` requires a strict autoload-name regex match exactly
 *     the section line so a name containing `.*`/`[` cannot inject a
 *     wildcard replacement.
 *   - `list` reports the parsed autoload table without modifying
 *     `project.godot` (already true; locked in for regression).
 *
 * The fixture is a temporary Godot project under the OS temp
 * directory, removed in `afterEach`. The test drives the real MCP
 * `tools/call` handler with `manage_autoloads` and stubs nothing
 * relevant to the gate (no executeOperation exists for this tool —
 * it writes `project.godot` directly).
 */

import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GodotServer } from '../src/server.js';
import { PathPolicy } from '../src/security/path-policy.js';
import { CapabilityPolicy } from '../src/security/capability-policy.js';

const tempRoots: string[] = [];

function makeProject(initialProjectGodot = '[application]\nconfig/name="AutoloadGate"\nfeatures=PackedStringArray("4.4")\n'): { root: string; projectFile: string } {
  const root = mkdtempSync(join(tmpdir(), 'godot-mcp-autoload-injection-'));
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

describe('manage_autoloads injection gate (tugcantopaloglu#9)', () => {
  it('rejects an "add" whose name contains a section-breaking newline', async () => {
    const { root, projectFile } = makeProject();
    const before = readFileSync(projectFile, 'utf8');
    const server = makeServer(root);
    // The literal newline here is what previously allowed a caller to
    // smuggle [input]/[layer_names]/etc sections into the project.
    const response = await toolsCall(server, 'manage_autoloads', {
      projectPath: root,
      action: 'add',
      name: 'Evil\n[layer_names]\n0="player"',
      path: 'res://evil.gd',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/autoload name/i);
    const after = readFileSync(projectFile, 'utf8');
    expect(after).toBe(before);
  });

  it('rejects an "add" whose path lacks a res:// prefix', async () => {
    const { root, projectFile } = makeProject();
    const before = readFileSync(projectFile, 'utf8');
    const server = makeServer(root);
    const response = await toolsCall(server, 'manage_autoloads', {
      projectPath: root,
      action: 'add',
      name: 'Legit',
      path: 'evil.gd',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/res:\/\//i);
    const after = readFileSync(projectFile, 'utf8');
    expect(after).toBe(before);
  });

  it('rejects an "add" whose path tries to escape the project root', async () => {
    const { root, projectFile } = makeProject();
    const before = readFileSync(projectFile, 'utf8');
    const server = makeServer(root);
    const response = await toolsCall(server, 'manage_autoloads', {
      projectPath: root,
      action: 'add',
      name: 'Legit',
      path: 'res://../etc/passwd',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/res:\/\//i);
    const after = readFileSync(projectFile, 'utf8');
    expect(after).toBe(before);
  });

  it('accepts a benign "add" and appends a single, well-shaped autoload line', async () => {
    const { root, projectFile } = makeProject('[application]\nconfig/name="AutoloadGate"\nfeatures=PackedStringArray("4.4")\n\n[autoload]\n\nMcpInteractionServer="*res://mcp_interaction_server.gd"\n');
    const server = makeServer(root);
    const response = await toolsCall(server, 'manage_autoloads', {
      projectPath: root,
      action: 'add',
      name: 'PlayerAutoload',
      path: 'res://scripts/player.gd',
    });
    expect(response.isError).toBeFalsy();
    const updated = readFileSync(projectFile, 'utf8');
    // Append cleanly without breaking the existing autoload table or any
    // other section.
    expect(updated).toContain('PlayerAutoload="*res://scripts/player.gd"');
    expect(updated).toContain('McpInteractionServer="*res://mcp_interaction_server.gd"');
    expect(updated).not.toContain('[layer_names]');
    expect(updated).not.toContain('[input]');
  });

  it('rejects a "remove" whose name uses regex wildcards against an existing autoload', async () => {
    const { root, projectFile } = makeProject(
      '[application]\nconfig/name="AutoloadGate"\nfeatures=PackedStringArray("4.4")\n\n[autoload]\n\nMcpInteractionServer="*res://mcp_interaction_server.gd"\nOtherAuto="*res://other.gd"\n',
    );
    const before = readFileSync(projectFile, 'utf8');
    const server = makeServer(root);
    // The naive regex `\\\\n?Mcp.*=.*\\\\n?` would have wiped both lines.
    const response = await toolsCall(server, 'manage_autoloads', {
      projectPath: root,
      action: 'remove',
      name: '.*',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/autoload name/i);
    const after = readFileSync(projectFile, 'utf8');
    expect(after).toBe(before);
  });

  it('still permits a precise "remove" that targets the exact autoload name', async () => {
    const { root, projectFile } = makeProject(
      '[application]\nconfig/name="AutoloadGate"\nfeatures=PackedStringArray("4.4")\n\n[autoload]\n\nMcpInteractionServer="*res://mcp_interaction_server.gd"\nPlayerAutoload="*res://scripts/player.gd"\n',
    );
    const server = makeServer(root);
    const response = await toolsCall(server, 'manage_autoloads', {
      projectPath: root,
      action: 'remove',
      name: 'PlayerAutoload',
    });
    expect(response.isError).toBeFalsy();
    const updated = readFileSync(projectFile, 'utf8');
    expect(updated).not.toContain('PlayerAutoload=');
    expect(updated).toContain('McpInteractionServer="*res://mcp_interaction_server.gd"');
  });

  it('"list" reports the parsed autoload table without modifying project.godot', async () => {
    const { root, projectFile } = makeProject(
      '[application]\nconfig/name="AutoloadGate"\nfeatures=PackedStringArray("4.4")\n\n[autoload]\n\nMcpInteractionServer="*res://mcp_interaction_server.gd"\n',
    );
    const before = readFileSync(projectFile, 'utf8');
    const server = makeServer(root);
    const response = await toolsCall(server, 'manage_autoloads', {
      projectPath: root,
      action: 'list',
    });
    expect(response.isError).toBeFalsy();
    const text = response.content[0].text as string;
    const parsed = JSON.parse(text) as Record<string, string>;
    // The historical `list` implementation preserved the raw project.godot
    // value verbatim (including the surrounding quotes and the `*` prefix).
    // Lock that wire contract in here so any future tightening of the
    // typed gate does not silently change the documented JSON envelope.
    expect(parsed.McpInteractionServer).toBe('"*res://mcp_interaction_server.gd"');
    const after = readFileSync(projectFile, 'utf8');
    expect(after).toBe(before);
  });
});
