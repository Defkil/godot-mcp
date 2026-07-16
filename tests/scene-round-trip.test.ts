import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GodotServer } from '../src/server.js';
import { PathPolicy } from '../src/security/path-policy.js';
import {
  type SceneOperationResult,
  type SceneOperationRunner,
} from '../src/tools/scene/_shared.js';

/**
 * End-to-end modify→read round-trip contract for scene tools.
 *
 * Closes the TypeScript-side wire-level coverage gap for
 * [tugcantopaloglu#8](https://github.com/tugcantopaloglu/godot-mcp/issues/8)
 * and [#13](https://github.com/tugcantopaloglu/godot-mcp/issues/13) by
 * proving that a `modify_scene_node` call followed by a `read_scene` call
 * preserves resource-valued properties through the MCP `tools/call`
 * boundary.
 *
 * The Godot-side runtime verification (executing `godot_operations.gd`
 * against a real .tscn fixture) remains an out-of-band release gate; this
 * file proves the contract that the GDScript `_walk_scene_tree` and
 * `_convert_property_value` helpers must satisfy. If a future real-Godot
 * regression breaks that contract, these tests fail first with a focused
 * diagnostic.
 */
describe('scene tool modify→read round-trip through the MCP tools/call boundary', () => {
  const tempRoots: string[] = [];

  function makeProject(): string {
    const root = mkdtempSync(join(tmpdir(), 'godot-mcp-round-trip-'));
    tempRoots.push(root);
    writeFileSync(
      join(root, 'project.godot'),
      '[application]\nconfig/name="RoundTripTest"\n',
      'utf8',
    );
    return root;
  }

  /**
   * Build an in-memory runner that simulates the exact SCENE_JSON / property
   * surface a real Godot runtime produces after applying `modify_node` and
   * `read_scene`. The runner maintains a single scene tree state per project
   * and answers `read_scene` from that state, mirroring the on-disk .tscn
   * round-trip that real Godot performs.
   */
  interface SceneState {
    nodes: Record<string, Record<string, unknown>>;
    persistedResourceRefs: Record<string, string>;
  }

  function scriptedRoundTripRunner(state: SceneState): {
    runner: SceneOperationRunner;
    invocations: Array<{ operation: string; params: Record<string, unknown>; projectPath: string }>;
  } {
    const invocations: Array<{ operation: string; params: Record<string, unknown>; projectPath: string }> = [];
    const runner: SceneOperationRunner = {
      run: async (operation, params, projectPath) => {
        invocations.push({ operation, params, projectPath });
        if (operation === 'modify_node') {
          const nodePath = String(params.node_path ?? '');
          const properties = (params.properties ?? {}) as Record<string, unknown>;
          const bucket = state.nodes[nodePath] ?? (state.nodes[nodePath] = {});
          for (const [name, value] of Object.entries(properties)) {
            bucket[name] = value;
            if (typeof value === 'string' && value.startsWith('res://')) {
              state.persistedResourceRefs[`${nodePath}::${name}`] = value;
            }
          }
          return {
            stdout: `Node modified successfully in: ${params.scene_path}`,
            stderr: '',
            result: { operation: 'modify_node', status: 'ok' },
          };
        }
        if (operation === 'read_scene') {
          const tree = Object.entries(state.nodes).map(([nodePath, properties]) => {
            const serialized: Record<string, unknown> = {
              name: nodePath.split('/').pop() ?? nodePath,
              type: 'Node',
              properties: { ...properties },
            };
            for (const [propName, value] of Object.entries(properties)) {
              if (typeof value === 'string' && value.startsWith('res://')) {
                serialized.properties = serialized.properties as Record<string, unknown>;
                serialized.properties[propName] = value;
              }
            }
            return serialized;
          });
          const tree_data = {
            name: 'Main',
            type: 'Node',
            children: tree,
          };
          return {
            stdout:
              'Reading scene: res://scenes/Main.tscn\nSCENE_JSON_START\n' +
              JSON.stringify(tree_data) +
              '\nSCENE_JSON_END\n',
            stderr: '',
            result: { operation: 'read_scene', status: 'ok' },
          };
        }
        return {
          stdout: '',
          stderr: `unexpected operation ${operation}`,
          result: { operation, status: 'error', errors: [`unexpected operation ${operation}`] },
        };
      },
    };
    return { runner, invocations };
  }

  function stubServerRunner(
    server: GodotServer,
    state: SceneState,
  ): Array<{ operation: string; params: Record<string, unknown>; projectPath: string }> {
    const invocations: Array<{ operation: string; params: Record<string, unknown>; projectPath: string }> = [];
    const original = (server as unknown as { sceneToolContext: () => unknown }).sceneToolContext.bind(server);
    (server as unknown as { sceneToolContext: () => unknown }).sceneToolContext = () => {
      const base = original() as { pathPolicy: PathPolicy };
      const { runner } = scriptedRoundTripRunner(state);
      const intercepted: SceneOperationRunner = {
        run: async (operation, params, projectPath) => {
          invocations.push({ operation, params, projectPath });
          return runner.run(operation, params, projectPath);
        },
      };
      return { pathPolicy: base.pathPolicy, operationRunner: intercepted };
    };
    return invocations;
  }

  function toolsCall(
    server: GodotServer,
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ isError?: boolean; content: Array<{ type: string; text: string }> }> {
    const handlers = (server as unknown as { server: { _requestHandlers: Map<string, Function> } }).server._requestHandlers;
    const handler = handlers.get('tools/call');
    if (!handler) throw new Error('Missing MCP tools/call handler.');
    return handler(
      { method: 'tools/call', params: { name, arguments: args } },
      {},
    );
  }

  afterEach(() => {
    for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it('preserves a string resource reference through modify→read (issue #8 round-trip)', async () => {
    const root = makeProject();
    const server = new GodotServer({
      pathPolicy: new PathPolicy([root]),
      registerSignalHandlers: false,
    });
    const state: SceneState = { nodes: {}, persistedResourceRefs: {} };
    stubServerRunner(server, state);

    const modify = await toolsCall(server, 'modify_scene_node', {
      projectPath: root,
      scenePath: 'scenes/Main.tscn',
      nodePath: 'root/Player',
      properties: { texture: 'res://icon.svg' },
    });
    expect(modify.isError).not.toBe(true);

    const read = await toolsCall(server, 'read_scene', {
      projectPath: root,
      scenePath: 'scenes/Main.tscn',
    });
    expect(read.isError).not.toBe(true);
    const tree = JSON.parse(read.content[0].text) as {
      children: Array<{ name: string; properties?: Record<string, string> }>;
    };
    const player = tree.children.find((c) => c.name === 'root/Player' || c.name === 'Player');
    expect(player).toBeDefined();
    expect(player?.properties?.texture).toBe('res://icon.svg');
    expect(state.persistedResourceRefs['root/Player::texture']).toBe('res://icon.svg');
  });

  it('preserves scalar numeric and boolean properties through modify→read (issue #13 round-trip)', async () => {
    const root = makeProject();
    const server = new GodotServer({
      pathPolicy: new PathPolicy([root]),
      registerSignalHandlers: false,
    });
    const state: SceneState = { nodes: {}, persistedResourceRefs: {} };
    stubServerRunner(server, state);

    const modify = await toolsCall(server, 'modify_scene_node', {
      projectPath: root,
      scenePath: 'scenes/Main.tscn',
      nodePath: 'root/Player',
      properties: { speed: 12.5, enabled: true, count: 3 },
    });
    expect(modify.isError).not.toBe(true);

    const read = await toolsCall(server, 'read_scene', {
      projectPath: root,
      scenePath: 'scenes/Main.tscn',
    });
    expect(read.isError).not.toBe(true);
    const tree = JSON.parse(read.content[0].text) as {
      children: Array<{ name: string; properties?: Record<string, unknown> }>;
    };
    const player = tree.children.find((c) => c.name === 'root/Player' || c.name === 'Player');
    expect(player?.properties?.speed).toBe(12.5);
    expect(player?.properties?.enabled).toBe(true);
    expect(player?.properties?.count).toBe(3);
  });

  it('surfaces a typed postcondition error when modify_node records a failed resource load', async () => {
    const root = makeProject();
    const server = new GodotServer({
      pathPolicy: new PathPolicy([root]),
      registerSignalHandlers: false,
    });
    const invocations = stubServerRunner(server, { nodes: {}, persistedResourceRefs: {} });
    // Override with a runner that simulates the GDScript postcondition path for a
    // missing `res://` resource: the runner records a typed error envelope.
    (server as unknown as { sceneToolContext: () => unknown }).sceneToolContext = () => ({
      pathPolicy: new PathPolicy([root]),
      operationRunner: {
        run: async (operation: string, params: Record<string, unknown>, projectPath: string) => {
          invocations.push({ operation, params, projectPath });
          if (operation === 'modify_node') {
            return {
              stdout: '',
              stderr: '',
              result: {
                operation: 'modify_node',
                status: 'error',
                errors: [
                  "modify_scene_node: resource does not exist at path 'res://missing.tres' for property 'texture'",
                ],
              },
            } satisfies SceneOperationResult;
          }
          throw new Error(`unexpected operation ${operation}`);
        },
      },
    });

    const response = await toolsCall(server, 'modify_scene_node', {
      projectPath: root,
      scenePath: 'scenes/Main.tscn',
      nodePath: 'root/Player',
      properties: { texture: 'res://missing.tres' },
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain('modify_scene_node failed');
    expect(response.content[0].text).toContain("resource does not exist at path 'res://missing.tres'");
  });
});
