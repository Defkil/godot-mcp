import { join } from 'node:path';
import {
  SceneOperationPostconditionError,
  requirePropertiesObject,
  type SceneOperationResult,
  type SceneToolContext,
} from './_shared.js';

export interface ModifySceneNodeInput {
  projectPath: string;
  scenePath: string;
  nodePath: string;
  properties: Record<string, unknown>;
}

export interface ModifySceneNodeOptions {
  pathPolicy: SceneToolContext['pathPolicy'];
  operationRunner: SceneToolContext['operationRunner'];
}

export interface ModifySceneNodeSuccess {
  content: Array<{ type: 'text'; text: string }>;
}

const REQUIRED_KEYS: ReadonlyArray<keyof ModifySceneNodeInput> = [
  'projectPath',
  'scenePath',
  'nodePath',
  'properties',
];

export function validateModifySceneNodeInput(raw: unknown): ModifySceneNodeInput {
  if (!raw || typeof raw !== 'object') {
    throw new Error('modify_scene_node expects an object input.');
  }
  const value = raw as Record<string, unknown>;
  for (const key of REQUIRED_KEYS) {
    if (value[key] === undefined || value[key] === null || value[key] === '') {
      if (key === 'properties') {
        // Surface the dedicated message that matches the GDScript-side guard.
        throw new Error("'properties' must be an object describing property name to value pairs.");
      }
      throw new Error(`'${key}' is required for modify_scene_node.`);
    }
  }
  return {
    projectPath: String(value.projectPath),
    scenePath: String(value.scenePath),
    nodePath: String(value.nodePath),
    properties: requirePropertiesObject(value.properties),
  };
}

export async function modifySceneNode(
  input: ModifySceneNodeInput,
  context: ModifySceneNodeOptions,
): Promise<ModifySceneNodeSuccess> {
  const projectPath = context.pathPolicy.assertProject(input.projectPath);
  // Resolve the scene file through the policy so configured-root escapes are
  // rejected with the same canonical diagnostic used by every other migrated
  // tool.
  context.pathPolicy.resolveProjectMember(projectPath, input.scenePath);

  const execution = await context.operationRunner.run(
    'modify_node',
    {
      scene_path: join(projectPath, input.scenePath),
      node_path: input.nodePath,
      properties: input.properties,
    },
    projectPath,
  );

  return renderModifySceneNodeResult(execution);
}

export function renderModifySceneNodeResult(result: SceneOperationResult): ModifySceneNodeSuccess {
  if (result.result.status === 'error') {
    throw new SceneOperationPostconditionError('modify_node', result.result.errors ?? []);
  }
  const trimmedOutput = result.stdout.trim();
  const lines: string[] = ['modify_node succeeded.'];
  if (trimmedOutput.length > 0) lines.push('', trimmedOutput);
  if (result.stderr.trim().length > 0) {
    lines.push('', 'Diagnostic output:', result.stderr.trim());
  }
  return { content: [{ type: 'text', text: lines.join('\n') }] };
}
