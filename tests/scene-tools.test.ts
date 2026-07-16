import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GodotServer } from '../src/server.js';
import { PathPolicy } from '../src/security/path-policy.js';
import {
  modifySceneNode,
  validateModifySceneNodeInput,
  renderModifySceneNodeResult,
} from '../src/tools/scene/modify-scene-node.js';
import {
  removeSceneNode,
  validateRemoveSceneNodeInput,
  renderRemoveSceneNodeResult,
} from '../src/tools/scene/remove-scene-node.js';
import {
  readScene,
  validateReadSceneInput,
  renderReadSceneResult,
} from '../src/tools/scene/read-scene.js';
import {
  SceneOperationPostconditionError,
  type SceneOperationResult,
  type SceneOperationRunner,
  type SceneToolContext,
} from '../src/tools/scene/_shared.js';

const tempRoots: string[] = [];

function makeProject(): { root: string; projectFile: string } {
  const root = mkdtempSync(join(tmpdir(), 'godot-mcp-scene-tool-'));
  tempRoots.push(root);
  const projectFile = join(root, 'project.godot');
  writeFileSync(projectFile, '[application]\nconfig/name="SceneToolTest"\n', 'utf8');
  return { root, projectFile };
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function scriptedRunner(result: SceneOperationResult): {
  runner: SceneOperationRunner;
  invocations: Array<{ operation: string; params: Record<string, unknown>; projectPath: string }>;
} {
  const invocations: Array<{ operation: string; params: Record<string, unknown>; projectPath: string }> = [];
  const runner: SceneOperationRunner = {
    run: async (operation, params, projectPath) => {
      invocations.push({ operation, params, projectPath });
      return result;
    },
  };
  return { runner, invocations };
}

describe('scene tool input validation', () => {
  it('rejects non-object input for modify_scene_node', () => {
    expect(() => validateModifySceneNodeInput(null)).toThrow('modify_scene_node expects an object input.');
    expect(() => validateModifySceneNodeInput('not-an-object')).toThrow('modify_scene_node expects an object input.');
  });

  it('rejects missing required fields for modify_scene_node', () => {
    // Missing `properties` falls through to `requirePropertiesObject(undefined)`, which
    // raises the dedicated object-shape diagnostic. A missing `projectPath`,
    // `scenePath`, or `nodePath` raises the missing-field diagnostic instead.
    expect(() =>
      validateModifySceneNodeInput({ projectPath: 'a', scenePath: 'b', nodePath: 'c' }),
    ).toThrow("'properties' must be an object describing property name to value pairs.");
    expect(() =>
      validateModifySceneNodeInput({ scenePath: 'b', nodePath: 'c', properties: { x: 1 } }),
    ).toThrow("'projectPath' is required for modify_scene_node.");
  });

  it('rejects non-object properties for modify_scene_node', () => {
    expect(() =>
      validateModifySceneNodeInput({ projectPath: 'a', scenePath: 'b', nodePath: 'c', properties: 'oops' }),
    ).toThrow("'properties' must be an object describing property name to value pairs.");
    expect(() =>
      validateModifySceneNodeInput({ projectPath: 'a', scenePath: 'b', nodePath: 'c', properties: [1, 2, 3] }),
    ).toThrow("'properties' must be an object describing property name to value pairs.");
  });

  it('rejects missing required fields for remove_scene_node', () => {
    expect(() => validateRemoveSceneNodeInput({ projectPath: 'a', scenePath: 'b' })).toThrow(
      "'nodePath' is required for remove_scene_node.",
    );
  });

  it('rejects missing required fields for read_scene', () => {
    expect(() => validateReadSceneInput({ projectPath: 'a' })).toThrow("'scenePath' is required for read_scene.");
  });
});

describe('modify_scene_node module', () => {
  it('forwards canonical project/scene paths and the typed parameters to the runner', async () => {
    const { root } = makeProject();
    const { runner, invocations } = scriptedRunner({
      stdout: 'Node modified successfully in: res://scenes/Main.tscn',
      stderr: '',
      result: { operation: 'modify_node', status: 'ok' },
    });
    const context: SceneToolContext = {
      pathPolicy: new PathPolicy([root]),
      operationRunner: runner,
    };

    const result = await modifySceneNode(
      {
        projectPath: root,
        scenePath: 'scenes/Main.tscn',
        nodePath: 'root/Player',
        properties: { speed: 12.5, target: 'res://icon.svg' },
      },
      context,
    );

    expect(result.content[0].text).toContain('modify_node succeeded.');
    expect(result.content[0].text).toContain('Node modified successfully');
    expect(invocations).toHaveLength(1);
    expect(invocations[0].operation).toBe('modify_node');
    expect(invocations[0].projectPath).toBe(root);
    const params = invocations[0].params;
    expect(params.scene_path).toBe(join(root, 'scenes/Main.tscn'));
    expect(params.node_path).toBe('root/Player');
    expect(params.properties).toEqual({ speed: 12.5, target: 'res://icon.svg' });
  });

  it('throws a SceneOperationPostconditionError when the runner reports postcondition failures', async () => {
    const { root } = makeProject();
    const { runner } = scriptedRunner({
      stdout: '',
      stderr: 'rejected property',
      result: {
        operation: 'modify_node',
        status: 'error',
        errors: [
          "modify_scene_node: node 'root/Player' rejected property 'speed' = 12.5",
          "modify_scene_node: resource does not exist at path 'res://missing.tres' for property 'target'",
        ],
      },
    });
    const context: SceneToolContext = {
      pathPolicy: new PathPolicy([root]),
      operationRunner: runner,
    };

    await expect(
      modifySceneNode(
        {
          projectPath: root,
          scenePath: 'scenes/Main.tscn',
          nodePath: 'root/Player',
          properties: { speed: 12.5, target: 'res://missing.tres' },
        },
        context,
      ),
    ).rejects.toBeInstanceOf(SceneOperationPostconditionError);
  });

  it('rejects project paths outside the configured roots', async () => {
    const { root } = makeProject();
    const { runner } = scriptedRunner({
      stdout: '',
      stderr: '',
      result: { operation: 'modify_node', status: 'ok' },
    });
    const context: SceneToolContext = {
      pathPolicy: new PathPolicy([root]),
      operationRunner: runner,
    };

    await expect(
      modifySceneNode(
        {
          projectPath: 'C:/somewhere/else',
          scenePath: 'scenes/Main.tscn',
          nodePath: 'root/Player',
          properties: { speed: 1 },
        },
        context,
      ),
    ).rejects.toThrow(/outside the configured allowed roots/i);
  });

  it('rejects scene paths that escape the project root', async () => {
    const { root } = makeProject();
    const { runner } = scriptedRunner({
      stdout: '',
      stderr: '',
      result: { operation: 'modify_node', status: 'ok' },
    });
    const context: SceneToolContext = {
      pathPolicy: new PathPolicy([root]),
      operationRunner: runner,
    };

    await expect(
      modifySceneNode(
        {
          projectPath: root,
          scenePath: '../outside.tscn',
          nodePath: 'root/Player',
          properties: { speed: 1 },
        },
        context,
      ),
    ).rejects.toThrow(/Project member path cannot traverse outside the project root\./);
  });
});

describe('remove_scene_node module', () => {
  it('returns a success envelope when the runner reports a healthy ok status', async () => {
    const { root } = makeProject();
    const { runner, invocations } = scriptedRunner({
      stdout: "Node 'Player' removed successfully from: res://scenes/Main.tscn",
      stderr: '',
      result: { operation: 'remove_node', status: 'ok' },
    });

    const result = await removeSceneNode(
      { projectPath: root, scenePath: 'scenes/Main.tscn', nodePath: 'root/Player' },
      { pathPolicy: new PathPolicy([root]), operationRunner: runner },
    );

    expect(result.content[0].text).toContain('remove_node succeeded.');
    expect(invocations).toHaveLength(1);
    expect(invocations[0].operation).toBe('remove_node');
    expect(invocations[0].params).toEqual({
      scene_path: join(root, 'scenes/Main.tscn'),
      node_path: 'root/Player',
    });
  });

  it('surfaces runner postcondition failures as SceneOperationPostconditionError', async () => {
    const { root } = makeProject();
    const { runner } = scriptedRunner({
      stdout: '',
      stderr: '',
      result: {
        operation: 'remove_node',
        status: 'error',
        errors: ["remove_scene_node: parent still has the target node 'Player' after remove_child"],
      },
    });

    await expect(
      removeSceneNode(
        { projectPath: root, scenePath: 'scenes/Main.tscn', nodePath: 'root/Player' },
        { pathPolicy: new PathPolicy([root]), operationRunner: runner },
      ),
    ).rejects.toBeInstanceOf(SceneOperationPostconditionError);
  });
});

describe('read_scene module', () => {
  it('parses SCENE_JSON markers into structured JSON content', async () => {
    const { root } = makeProject();
    const tree = { name: 'Main', type: 'Node', children: [] };
    const { runner, invocations } = scriptedRunner({
      stdout: 'Reading scene: res://scenes/Main.tscn\nSCENE_JSON_START\n' + JSON.stringify(tree) + '\nSCENE_JSON_END\n',
      stderr: '',
      result: { operation: 'read_scene', status: 'ok' },
    });

    const result = await readScene(
      { projectPath: root, scenePath: 'scenes/Main.tscn' },
      { pathPolicy: new PathPolicy([root]), operationRunner: runner },
    );

    expect(invocations).toHaveLength(1);
    expect(result.content[0].text).toBe(JSON.stringify(tree, null, 2));
  });

  it('falls back to raw output when the markers are absent', async () => {
    const { root } = makeProject();
    const { runner } = scriptedRunner({
      stdout: 'No scene marker found\n',
      stderr: 'clean',
      result: { operation: 'read_scene', status: 'ok' },
    });

    const result = await readScene(
      { projectPath: root, scenePath: 'scenes/Main.tscn' },
      { pathPolicy: new PathPolicy([root]), operationRunner: runner },
    );

    expect(result.content[0].text).toContain('No scene marker found');
    expect(result.content[0].text).toContain('clean');
  });
});

describe('scene tool wiring through GodotServer registry', () => {
  function stubSceneRunner(
    server: GodotServer,
    result: import('../src/tools/scene/_shared.js').SceneOperationResult,
  ) {
    const invocations: Array<{ operation: string; params: Record<string, unknown>; projectPath: string }> = [];
    const original = (server as any).sceneToolContext.bind(server);
    (server as any).sceneToolContext = () => {
      const base = original();
      return {
        pathPolicy: base.pathPolicy,
        operationRunner: {
          run: async (operation: string, params: Record<string, unknown>, projectPath: string) => {
            invocations.push({ operation, params, projectPath });
            return result;
          },
        },
      };
    };
    return invocations;
  }

  function toolsCall(server: GodotServer, name: string, args: Record<string, unknown>) {
    const handlers = (server as any).server._requestHandlers as Map<string, Function>;
    const handler = handlers.get('tools/call');
    if (!handler) throw new Error('Missing MCP tools/call handler.');
    return handler(
      {
        method: 'tools/call',
        params: { name, arguments: args },
      },
      {},
    );
  }

  it('modify_scene_node surfaces a typed postcondition error envelope through the real MCP call boundary', async () => {
    const root = mkdtempSync(join(tmpdir(), 'godot-mcp-scene-wiring-'));
    tempRoots.push(root);
    writeFileSync(join(root, 'project.godot'), '[application]\nconfig/name="WiringTest"\n', 'utf8');
    const server = new GodotServer({
      pathPolicy: new PathPolicy([root]),
      registerSignalHandlers: false,
    });
    const invocations = stubSceneRunner(server, {
      stdout: '',
      stderr: '',
      result: {
        operation: 'modify_node',
        status: 'error',
        errors: [
          "modify_scene_node: node 'root/Player' rejected property 'speed' = 12.5",
        ],
      },
    });

    const response = await toolsCall(server, 'modify_scene_node', {
      projectPath: root,
      scenePath: 'scenes/Main.tscn',
      nodePath: 'root/Player',
      properties: { speed: 12.5 },
    });

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain('modify_scene_node failed');
    expect(response.content[0].text).toContain("rejected property 'speed' = 12.5");
    expect(invocations).toHaveLength(1);
    expect(invocations[0].operation).toBe('modify_node');
    expect(invocations[0].params).toMatchObject({
      scene_path: join(root, 'scenes/Main.tscn'),
      node_path: 'root/Player',
    });
  });

  it('read_scene returns structured JSON content through the real MCP call boundary', async () => {
    const root = mkdtempSync(join(tmpdir(), 'godot-mcp-scene-wiring-'));
    tempRoots.push(root);
    writeFileSync(join(root, 'project.godot'), '[application]\nconfig/name="WiringTest"\n', 'utf8');
    const server = new GodotServer({
      pathPolicy: new PathPolicy([root]),
      registerSignalHandlers: false,
    });
    const tree = { name: 'Main', type: 'Node', children: [] };
    stubSceneRunner(server, {
      stdout: `Reading scene: res://scenes/Main.tscn\nSCENE_JSON_START\n${JSON.stringify(tree)}\nSCENE_JSON_END\n`,
      stderr: '',
      result: { operation: 'read_scene', status: 'ok' },
    });

    const response = await toolsCall(server, 'read_scene', {
      projectPath: root,
      scenePath: 'scenes/Main.tscn',
    });

    expect(response.isError).not.toBe(true);
    expect(JSON.parse(response.content[0].text)).toEqual(tree);
  });

  it('remove_scene_node surfaces a typed postcondition error envelope through the real MCP call boundary', async () => {
    const root = mkdtempSync(join(tmpdir(), 'godot-mcp-scene-wiring-'));
    tempRoots.push(root);
    writeFileSync(join(root, 'project.godot'), '[application]\nconfig/name="WiringTest"\n', 'utf8');
    const server = new GodotServer({
      pathPolicy: new PathPolicy([root]),
      registerSignalHandlers: false,
    });
    stubSceneRunner(server, {
      stdout: '',
      stderr: '',
      result: {
        operation: 'remove_node',
        status: 'error',
        errors: [
          "remove_scene_node: target node 'root/Player' has no parent and cannot be removed",
        ],
      },
    });

    const response = await toolsCall(server, 'remove_scene_node', {
      projectPath: root,
      scenePath: 'scenes/Main.tscn',
      nodePath: 'root/Player',
    });

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain('remove_scene_node failed');
    expect(response.content[0].text).toContain('has no parent and cannot be removed');
  });
});

describe('renderer shape preservation', () => {
  it('modify_scene_node renderer reflects postcondition errors', () => {
    expect(() =>
      renderModifySceneNodeResult({
        stdout: '',
        stderr: '',
        result: {
          operation: 'modify_node',
          status: 'error',
          errors: ['rejected property `x`'],
        },
      }),
    ).toThrow(SceneOperationPostconditionError);
  });

  it('remove_scene_node renderer reflects postcondition errors', () => {
    expect(() =>
      renderRemoveSceneNodeResult({
        stdout: '',
        stderr: '',
        result: { operation: 'remove_node', status: 'error', errors: ['stuck'] },
      }),
    ).toThrow(SceneOperationPostconditionError);
  });

  it('read_scene renderer propagates postcondition errors', () => {
    expect(() =>
      renderReadSceneResult({
        stdout: '',
        stderr: '',
        result: { operation: 'read_scene', status: 'error', errors: ['failed'] },
      }),
    ).toThrow(SceneOperationPostconditionError);
  });

  it('the integration with the typed runner accepts only legitimate runner shapes', async () => {
    const { root } = makeProject();
    const spy = vi.fn(async () => ({
      stdout: '',
      stderr: '',
      result: { operation: 'modify_node', status: 'ok' as const },
    }));
    await modifySceneNode(
      {
        projectPath: root,
        scenePath: 'scenes/Main.tscn',
        nodePath: 'root/Player',
        properties: { speed: 1 },
      },
      { pathPolicy: new PathPolicy([root]), operationRunner: { run: spy } },
    );
    expect(spy).toHaveBeenCalledOnce();
  });
});
