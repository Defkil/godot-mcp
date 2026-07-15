import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GodotServer } from '../src/index.js';
import { isSafeGodotClassName } from '../src/security/godot-class-name.js';

describe('isSafeGodotClassName', () => {
  it('accepts built-in and registered-class identifiers', () => {
    expect(isSafeGodotClassName('Node2D')).toBe(true);
    expect(isSafeGodotClassName('_PrivateEnemy42')).toBe(true);
  });

  it.each([
    '',
    'res://evil.gd',
    'C:\\temp\\evil.gd',
    '/tmp/evil.gd',
    '../evil',
    'Enemy.gd',
    'Enemy-Class',
    'Node2D\nInjected',
  ])('rejects non-identifier input %j', value => {
    expect(isSafeGodotClassName(value)).toBe(false);
  });
});

describe('class-name defenses at the tool boundary', () => {
  it('rejects script paths before create_scene or add_node can execute Godot', async () => {
    const server = new GodotServer({
      godotPath: process.execPath,
      registerSignalHandlers: false,
    });

    const createResult = await (server as any).handleCreateScene({
      projectPath: 'C:/unused',
      scenePath: 'Main.tscn',
      rootNodeType: 'res://evil.gd',
    });
    const addResult = await (server as any).handleAddNode({
      projectPath: 'C:/unused',
      scenePath: 'Main.tscn',
      nodeType: '../evil.gd',
      nodeName: 'Owned',
    });

    expect(createResult.isError).toBe(true);
    expect(createResult.content[0].text).toContain('Invalid rootNodeType');
    expect(addResult.isError).toBe(true);
    expect(addResult.content[0].text).toContain('Invalid nodeType');
  });

  it('keeps the Godot fallback restricted to registered global classes', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, '../src/scripts/godot_operations.gd'), 'utf8');
    const lookup = source.slice(
      source.indexOf('func get_script_by_name'),
      source.indexOf('func instantiate_class'),
    );

    expect(lookup).toContain('ProjectSettings.get_global_class_list()');
    expect(lookup).not.toContain('ResourceLoader.exists');
    expect(lookup).not.toContain('load(name_of_class)');
  });
});
