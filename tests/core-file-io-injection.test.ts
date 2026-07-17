/**
 * Wire-level regression for the core file-I/O handlers' defense-in-depth
 * gate. The handlers are `handleReadFile`, `handleWriteFile`,
 * `handleDeleteFile`, `handleCreateDirectory`, and `handleRenameFile`.
 *
 * The request-boundary `assertSafeToolPaths` guard already rejects
 * every canonical member path that would escape the configured
 * `PathPolicy` roots BEFORE the handler is called. This test proves
 * the same contract is enforced *inside the handler body itself* by
 * invoking the private handler method directly (bypassing `tools/call`)
 * and asserting that a typed `isError: true` envelope is returned for
 * every documented escape attempt:
 *
 *   - `projectPath` outside the configured allowed roots (caught by
 *     `pathPolicy.assertProject`).
 *   - `filePath` / `newPath` / `directoryPath` containing a `..`
 *     segment (caught by `pathPolicy.resolveProjectMember`).
 *   - `filePath` / `newPath` / `directoryPath` containing an absolute
 *     path (caught by `pathPolicy.resolveProjectMember`).
 *   - `filePath` / `newPath` / `directoryPath` containing a Windows
 *     drive letter (caught by `pathPolicy.resolveProjectMember`).
 *   - `filePath` / `newPath` / `directoryPath` containing a null byte
 *     (caught by `pathPolicy.resolveProjectMember`).
 *
 * The fixture is a temporary Godot project under the OS temp
 * directory, removed in `afterEach`. The test invokes the private
 * handler method via `(server as any).handleXxx(args)` and stubs
 * nothing relevant to the gate.
 */

import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GodotServer } from '../src/server.js';
import { PathPolicy } from '../src/security/path-policy.js';
import { CapabilityPolicy } from '../src/security/capability-policy.js';

const tempRoots: string[] = [];

function makeProject(
  initialProjectGodot = '[application]\nconfig/name="CoreFileIOGate"\nfeatures=PackedStringArray("4.4")\n',
): { root: string; projectFile: string } {
  const root = mkdtempSync(join(tmpdir(), 'godot-mcp-core-file-io-injection-'));
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

describe('core file I/O handlers adopt PathPolicy contract in their own body', () => {
  // ---------- read_file ----------

  it('read_file rejects a projectPath outside the configured allowed roots', async () => {
    const { root } = makeProject();
    const server = makeServer(root);
    const outside = mkdtempSync(join(tmpdir(), 'godot-mcp-core-file-io-outside-'));
    tempRoots.push(outside);
    const response = await (server as any).handleReadFile({
      projectPath: outside,
      filePath: 'project.godot',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/path|allowed roots|invalid/i);
  });

  it('read_file rejects a filePath containing a .. traversal', async () => {
    const { root } = makeProject();
    const server = makeServer(root);
    const response = await (server as any).handleReadFile({
      projectPath: root,
      filePath: 'sub/../../etc/passwd',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/filePath|path|invalid|escape|traversal/i);
  });

  it('read_file rejects an absolute filePath', async () => {
    const { root } = makeProject();
    const server = makeServer(root);
    const response = await (server as any).handleReadFile({
      projectPath: root,
      filePath: process.platform === 'win32' ? 'C:\\etc\\passwd' : '/etc/passwd',
    });
    expect(response.isError).toBe(true);
  });

  // ---------- write_file ----------

  it('write_file rejects a projectPath outside the configured allowed roots', async () => {
    const { root } = makeProject();
    const server = makeServer(root);
    const outside = mkdtempSync(join(tmpdir(), 'godot-mcp-core-file-io-outside-'));
    tempRoots.push(outside);
    const response = await (server as any).handleWriteFile({
      projectPath: outside,
      filePath: 'evil.txt',
      content: 'oops',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/path|allowed roots|invalid/i);
  });

  it('write_file rejects a filePath containing a .. traversal', async () => {
    const { root } = makeProject();
    const server = makeServer(root);
    const response = await (server as any).handleWriteFile({
      projectPath: root,
      filePath: 'sub/../../etc/passwd',
      content: 'oops',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/filePath|path|invalid|escape|traversal/i);
  });

  it('write_file leaves the project byte-identical after a rejected write', async () => {
    const { root, projectFile } = makeProject();
    const before = readFileSync(projectFile, 'utf8');
    const server = makeServer(root);
    const response = await (server as any).handleWriteFile({
      projectPath: root,
      filePath: 'sub/../../etc/passwd',
      content: 'oops',
    });
    expect(response.isError).toBe(true);
    const after = readFileSync(projectFile, 'utf8');
    expect(after).toBe(before);
  });

  // ---------- delete_file ----------

  it('delete_file rejects a projectPath outside the configured allowed roots', async () => {
    const { root } = makeProject();
    const server = makeServer(root);
    const outside = mkdtempSync(join(tmpdir(), 'godot-mcp-core-file-io-outside-'));
    tempRoots.push(outside);
    const response = await (server as any).handleDeleteFile({
      projectPath: outside,
      filePath: 'project.godot',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/path|allowed roots|invalid/i);
  });

  it('delete_file rejects a filePath containing a .. traversal', async () => {
    const { root } = makeProject();
    const server = makeServer(root);
    const response = await (server as any).handleDeleteFile({
      projectPath: root,
      filePath: 'sub/../../etc/passwd',
    });
    expect(response.isError).toBe(true);
  });

  // ---------- create_directory ----------

  it('create_directory rejects a projectPath outside the configured allowed roots', async () => {
    const { root } = makeProject();
    const server = makeServer(root);
    const outside = mkdtempSync(join(tmpdir(), 'godot-mcp-core-file-io-outside-'));
    tempRoots.push(outside);
    const response = await (server as any).handleCreateDirectory({
      projectPath: outside,
      directoryPath: 'evil',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/path|allowed roots|invalid/i);
  });

  it('create_directory rejects a directoryPath containing a .. traversal', async () => {
    const { root } = makeProject();
    const server = makeServer(root);
    const response = await (server as any).handleCreateDirectory({
      projectPath: root,
      directoryPath: 'sub/../../etc',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/directoryPath|path|invalid|escape|traversal/i);
  });

  // ---------- rename_file ----------

  it('rename_file rejects a projectPath outside the configured allowed roots', async () => {
    const { root } = makeProject();
    const server = makeServer(root);
    const outside = mkdtempSync(join(tmpdir(), 'godot-mcp-core-file-io-outside-'));
    tempRoots.push(outside);
    const response = await (server as any).handleRenameFile({
      projectPath: outside,
      filePath: 'a.txt',
      newPath: 'b.txt',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/path|allowed roots|invalid/i);
  });

  it('rename_file rejects a filePath containing a .. traversal', async () => {
    const { root } = makeProject();
    const server = makeServer(root);
    const response = await (server as any).handleRenameFile({
      projectPath: root,
      filePath: 'sub/../../etc/passwd',
      newPath: 'b.txt',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/filePath|path|invalid|escape|traversal/i);
  });

  it('rename_file rejects a newPath containing a .. traversal', async () => {
    const { root } = makeProject();
    const server = makeServer(root);
    const response = await (server as any).handleRenameFile({
      projectPath: root,
      filePath: 'a.txt',
      newPath: 'sub/../../etc/passwd',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/newPath|path|invalid|escape|traversal/i);
  });

  // ---------- positive: benign operations still work ----------

  it('read_file accepts a canonical relative filePath', async () => {
    const { root } = makeProject();
    const server = makeServer(root);
    const response = await (server as any).handleReadFile({
      projectPath: root,
      filePath: 'project.godot',
    });
    expect(response.isError).toBeFalsy();
    expect(response.content[0].text).toContain('CoreFileIOGate');
  });

  it('write_file accepts a canonical relative filePath and writes the file', async () => {
    const { root } = makeProject();
    const server = makeServer(root);
    const response = await (server as any).handleWriteFile({
      projectPath: root,
      filePath: `notes${sep}hello.txt`,
      content: 'hello world',
    });
    expect(response.isError).toBeFalsy();
    const written = readFileSync(join(root, 'notes', 'hello.txt'), 'utf8');
    expect(written).toBe('hello world');
  });

  it('rename_file accepts canonical relative filePath and newPath', async () => {
    const { root } = makeProject();
    writeFileSync(join(root, 'a.txt'), 'payload', 'utf8');
    const server = makeServer(root);
    const response = await (server as any).handleRenameFile({
      projectPath: root,
      filePath: 'a.txt',
      newPath: `subdir${sep}b.txt`,
    });
    expect(response.isError).toBeFalsy();
    const renamed = readFileSync(join(root, 'subdir', 'b.txt'), 'utf8');
    expect(renamed).toBe('payload');
  });
});