import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cleanupInteractionInjection,
  prepareInteractionInjection,
} from '../src/runtime/interaction-injection.js';

const roots: string[] = [];
function fixture(): { project: string; source: string; projectFile: string; scriptFile: string } {
  const root = mkdtempSync(path.join(tmpdir(), 'gi-go-injection-'));
  roots.push(root);
  const project = path.join(root, 'project');
  mkdirSync(project);
  const source = path.join(root, 'source.gd');
  const projectFile = path.join(project, 'project.godot');
  const scriptFile = path.join(project, 'mcp_interaction_server.gd');
  writeFileSync(source, 'extends Node\n', 'utf8');
  writeFileSync(projectFile, '[application]\nconfig/name="fixture"\n', 'utf8');
  return { project, source, projectFile, scriptFile };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('interaction injection transaction', () => {
  it('restores the original project and removes files created by the server', () => {
    const item = fixture();
    const original = readFileSync(item.projectFile, 'utf8');
    const injection = prepareInteractionInjection(item.project, item.source, 'McpInteractionServer');

    expect(readFileSync(item.projectFile, 'utf8')).toContain('McpInteractionServer=');
    expect(readFileSync(item.scriptFile, 'utf8')).toBe('extends Node\n');

    cleanupInteractionInjection(injection);
    expect(readFileSync(item.projectFile, 'utf8')).toBe(original);
    expect(() => readFileSync(item.scriptFile, 'utf8')).toThrow();
  });

  it('does not overwrite an unmanaged script', () => {
    const item = fixture();
    writeFileSync(item.scriptFile, 'user owned\n', 'utf8');
    const original = readFileSync(item.projectFile, 'utf8');

    expect(() =>
      prepareInteractionInjection(item.project, item.source, 'McpInteractionServer')
    ).toThrow('Refusing to overwrite');
    expect(readFileSync(item.scriptFile, 'utf8')).toBe('user owned\n');
    expect(readFileSync(item.projectFile, 'utf8')).toBe(original);
  });

  it('tracks and removes a script restored for a pre-existing autoload', () => {
    const item = fixture();
    writeFileSync(
      item.projectFile,
      '[autoload]\nMcpInteractionServer="*res://mcp_interaction_server.gd"\n',
      'utf8'
    );
    const original = readFileSync(item.projectFile, 'utf8');
    const injection = prepareInteractionInjection(item.project, item.source, 'McpInteractionServer');

    cleanupInteractionInjection(injection);
    expect(readFileSync(item.projectFile, 'utf8')).toBe(original);
    expect(() => readFileSync(item.scriptFile, 'utf8')).toThrow();
  });

  it('fails closed instead of deleting the script after ownership markers change', () => {
    const item = fixture();
    const injection = prepareInteractionInjection(item.project, item.source, 'McpInteractionServer');
    const changed = readFileSync(item.projectFile, 'utf8').replace(
      'McpInteractionServer="*res://mcp_interaction_server.gd"',
      'McpInteractionServer="*res://user_changed.gd"'
    );
    writeFileSync(item.projectFile, changed, 'utf8');

    expect(() => cleanupInteractionInjection(injection)).toThrow('ownership marker changed');
    expect(existsSync(item.scriptFile)).toBe(true);
  });
});
