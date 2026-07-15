import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { installRuntimeBridge } from '../src/godot/bridge-installer.js';

function fixture(projectText = 'config_version=5\n') {
  const projectPath = mkdtempSync(join(tmpdir(), 'godot-mcp-bridge-'));
  const sourceScriptPath = join(projectPath, 'source_bridge.gd');
  writeFileSync(join(projectPath, 'project.godot'), projectText, 'utf8');
  writeFileSync(sourceScriptPath, 'extends Node\n', 'utf8');
  return { projectPath, sourceScriptPath, projectText };
}

describe('installRuntimeBridge', () => {
  it('restores project.godot byte-for-byte and removes only generated files', () => {
    const value = fixture('; comment\r\n\r\nconfig_version=5\r\n');
    const installation = installRuntimeBridge(value);

    expect(readFileSync(join(value.projectPath, 'project.godot'), 'utf8')).toContain('McpInteractionServer');
    expect(existsSync(installation.scriptPath)).toBe(true);

    installation.restore();
    installation.restore();
    expect(readFileSync(join(value.projectPath, 'project.godot'))).toEqual(Buffer.from(value.projectText));
    expect(existsSync(installation.scriptPath)).toBe(false);
  });

  it('leaves a valid user-managed autoload and script untouched', () => {
    const projectText = '[autoload]\n\nMcpInteractionServer="*res://custom_bridge.gd"\n';
    const value = fixture(projectText);
    const customPath = join(value.projectPath, 'custom_bridge.gd');
    writeFileSync(customPath, 'extends Node\n# user managed\n', 'utf8');
    const beforeScript = readFileSync(customPath);

    const installation = installRuntimeBridge(value);
    expect(installation.userManaged).toBe(true);
    expect(installation.resourcePath).toBe('res://custom_bridge.gd');
    installation.restore();

    expect(readFileSync(join(value.projectPath, 'project.godot'), 'utf8')).toBe(projectText);
    expect(readFileSync(customPath)).toEqual(beforeScript);
  });

  it('fails closed when a user-managed autoload points to a missing script', () => {
    const projectText = '[autoload]\n\nMcpInteractionServer="*res://missing.gd"\n';
    const value = fixture(projectText);

    expect(() => installRuntimeBridge(value)).toThrow('missing user-managed script');
    expect(readFileSync(join(value.projectPath, 'project.godot'), 'utf8')).toBe(projectText);
  });

  it('does not overwrite a colliding project file', () => {
    const value = fixture();
    const collidingPath = join(value.projectPath, 'mcp_interaction_server.gd');
    writeFileSync(collidingPath, 'extends Node\n# unrelated user file\n', 'utf8');
    const before = readFileSync(collidingPath);

    const installation = installRuntimeBridge(value);
    expect(installation.scriptPath).toBe(join(value.projectPath, 'mcp_interaction_server.generated.gd'));
    expect(readFileSync(collidingPath)).toEqual(before);

    installation.restore();
    expect(readFileSync(collidingPath)).toEqual(before);
    expect(existsSync(installation.scriptPath)).toBe(false);
  });
});
