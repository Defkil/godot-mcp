import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GodotServer } from '../src/server.js';
import { PathPolicy } from '../src/security/path-policy.js';
import {
  classdbInspect,
  validateClassdbInspectInput,
  renderClassdbInspectResult,
  type ClassdbInspectResult,
  type ClassdbInspectRunner,
  type ClassdbInspectContext,
} from '../src/tools/script/classdb-inspect.js';

const tempRoots: string[] = [];

function makeProject(): { root: string; projectFile: string } {
  const root = mkdtempSync(join(tmpdir(), 'godot-mcp-classdb-'));
  tempRoots.push(root);
  const projectFile = join(root, 'project.godot');
  writeFileSync(projectFile, '[application]\nconfig/name="ClassdbInspectTest"\n', 'utf8');
  return { root, projectFile };
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function scriptedRunner(result: ClassdbInspectResult): {
  runner: ClassdbInspectRunner;
  invocations: Array<{ operation: string; params: Record<string, unknown>; projectPath: string }>;
} {
  const invocations: Array<{ operation: string; params: Record<string, unknown>; projectPath: string }> = [];
  const runner: ClassdbInspectRunner = {
    run: async (operation, params, projectPath) => {
      invocations.push({ operation, params, projectPath });
      return result;
    },
  };
  return { runner, invocations };
}

describe('classdb_inspect input validation', () => {
  it('rejects non-object input', () => {
    expect(() => validateClassdbInspectInput(null)).toThrow('classdb_inspect expects an object input.');
    expect(() => validateClassdbInspectInput('nope')).toThrow('classdb_inspect expects an object input.');
  });

  it('rejects missing required fields', () => {
    expect(() => validateClassdbInspectInput({})).toThrow("'projectPath' is required for classdb_inspect.");
    expect(() =>
      validateClassdbInspectInput({ projectPath: 'a' }),
    ).toThrow("'className' is required for classdb_inspect.");
  });

  it('rejects className containing path separators or extension', () => {
    expect(() =>
      validateClassdbInspectInput({ projectPath: 'a', className: 'res://Sprite2D.gd' }),
    ).toThrow("'className' must be a Godot class identifier");
    expect(() =>
      validateClassdbInspectInput({ projectPath: 'a', className: '../Node2D' }),
    ).toThrow("'className' must be a Godot class identifier");
    expect(() =>
      validateClassdbInspectInput({ projectPath: 'a', className: 'a.b' }),
    ).toThrow("'className' must be a Godot class identifier");
  });

  it('accepts a built-in class identifier', () => {
    expect(validateClassdbInspectInput({ projectPath: 'a', className: 'Sprite2D' })).toEqual({
      projectPath: 'a',
      className: 'Sprite2D',
    });
    expect(validateClassdbInspectInput({ projectPath: 'a', className: 'CharacterBody3D' })).toEqual({
      projectPath: 'a',
      className: 'CharacterBody3D',
    });
  });
});

describe('classdb_inspect runner', () => {
  it('forwards the resolved project path and className', async () => {
    const { root } = makeProject();
    const pathPolicy = new PathPolicy([root]);
    const { runner, invocations } = scriptedRunner({
      stdout: JSON.stringify({
        class: 'Node',
        methods: [{ name: '_ready' }, { name: '_process' }],
        properties: [],
        signals: [],
      }),
      stderr: '',
      result: { operation: 'classdb_inspect', status: 'ok' },
    });
    const ctx: ClassdbInspectContext = { pathPolicy, operationRunner: runner };
    const result = await classdbInspect(
      { projectPath: root, className: 'Node' },
      ctx,
    );
    expect(invocations).toEqual([
      { operation: 'classdb_inspect', params: { class_name: 'Node' }, projectPath: root },
    ]);
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('_ready');
  });

  it('surfaces typed postcondition errors as a structured error envelope', () => {
    const rendered = renderClassdbInspectResult({
      stdout: '',
      stderr: '',
      result: {
        operation: 'classdb_inspect',
        status: 'error',
        errors: ['Unknown class: Phantom'],
      },
    });
    expect(rendered.isError).toBe(true);
    expect(rendered.content[0].text).toContain('Unknown class: Phantom');
  });
});

function requestHandler(server: GodotServer, method: 'tools/list' | 'tools/call') {
  const handlers = (server as any).server._requestHandlers as Map<string, Function>;
  const handler = handlers.get(method);
  if (!handler) throw new Error(`Missing MCP request handler: ${method}`);
  return handler;
}

async function toolsCall(server: GodotServer, name: string, args: Record<string, unknown> | null) {
  const handler = requestHandler(server, 'tools/call');
  return handler(
    {
      method: 'tools/call',
      params: { name, arguments: args },
    },
    {},
  );
}

describe('classdb_inspect MCP wiring', () => {
  it('returns a real MCP list entry with the inspect capability and a snake_case name', async () => {
    const server = new GodotServer({ registerSignalHandlers: false });
    const response = await requestHandler(server, 'tools/list')(
      { method: 'tools/list', params: {} },
      {},
    );
    const tools = response.tools as Array<{ name: string; inputSchema: { required?: string[]; properties?: Record<string, unknown> } }>;
    const tool = tools.find(entry => entry.name === 'classdb_inspect');
    expect(tool).toBeDefined();
    expect(tool?.inputSchema.required).toEqual(expect.arrayContaining(['projectPath', 'className']));
    expect(tool?.inputSchema.properties).toHaveProperty('className');
  });

  it('is also registered in the in-memory tool registry with the inspect capability', () => {
    const server = new GodotServer({ registerSignalHandlers: false });
    const registry = (server as any).toolRegistry;
    expect(registry.has('classdb_inspect')).toBe(true);
    expect(registry.capabilityFor('classdb_inspect')).toBe('inspect');
  });

  it('rejects malformed className through the server wrapper', async () => {
    const root = mkdtempSync(join(tmpdir(), 'godot-mcp-classdb-wrap-'));
    tempRoots.push(root);
    const server = new GodotServer({
      pathPolicy: new PathPolicy([root]),
      registerSignalHandlers: false,
    });
    const response = await toolsCall(server, 'classdb_inspect', {
      projectPath: root,
      className: 'res://Sprite2D.gd',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain("'className' must be a Godot class identifier");
  });

  it('routes through the registry dispatch and forwards canonical paths/params', async () => {
    const { root } = makeProject();
    const server = new GodotServer({
      pathPolicy: new PathPolicy([root]),
      registerSignalHandlers: false,
    });
    const runnerSpy = vi.fn(async (operation: string, params: Record<string, unknown>, projectPath: string) => ({
      stdout: JSON.stringify({ class: 'Node', methods: [], properties: [], signals: [] }),
      stderr: '',
      result: { operation, status: 'ok' as const },
    }));
    const original = (server as any).classdbInspectContext.bind(server);
    (server as any).classdbInspectContext = () => ({
      pathPolicy: new PathPolicy([root]),
      operationRunner: { run: runnerSpy },
    });
    const response = await toolsCall(server, 'classdb_inspect', {
      projectPath: root,
      className: 'Node',
    });
    expect(response.isError).toBeFalsy();
    expect(runnerSpy).toHaveBeenCalledWith('classdb_inspect', { class_name: 'Node' }, root);
    // Sanity: the original method should still be reachable.
    expect(typeof original).toBe('function');
  });
});