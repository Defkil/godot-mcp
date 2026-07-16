import { join } from 'node:path';
import {
  SceneOperationPostconditionError,
  type SceneOperationResult,
  type SceneToolContext,
} from './_shared.js';

export interface RemoveSceneNodeInput {
  projectPath: string;
  scenePath: string;
  nodePath: string;
}

export interface RemoveSceneNodeOptions {
  pathPolicy: SceneToolContext['pathPolicy'];
  operationRunner: SceneToolContext['operationRunner'];
}

export interface RemoveSceneNodeSuccess {
  content: Array<{ type: 'text'; text: string }>;
}

const REQUIRED_KEYS: ReadonlyArray<keyof RemoveSceneNodeInput> = [
  'projectPath',
  'scenePath',
  'nodePath',
];

export function validateRemoveSceneNodeInput(raw: unknown): RemoveSceneNodeInput {
  if (!raw || typeof raw !== 'object') {
    throw new Error('remove_scene_node expects an object input.');
  }
  const value = raw as Record<string, unknown>;
  for (const key of REQUIRED_KEYS) {
    if (value[key] === undefined || value[key] === null || value[key] === '') {
      throw new Error(`'${key}' is required for remove_scene_node.`);
    }
  }
  return {
    projectPath: String(value.projectPath),
    scenePath: String(value.scenePath),
    nodePath: String(value.nodePath),
  };
}

export async function removeSceneNode(
  input: RemoveSceneNodeInput,
  context: RemoveSceneNodeOptions,
): Promise<RemoveSceneNodeSuccess> {
  const projectPath = context.pathPolicy.assertProject(input.projectPath);
  context.pathPolicy.resolveProjectMember(projectPath, input.scenePath);

  const execution = await context.operationRunner.run(
    'remove_node',
    {
      scene_path: join(projectPath, input.scenePath),
      node_path: input.nodePath,
    },
    projectPath,
  );

  return renderRemoveSceneNodeResult(execution);
}

export function renderRemoveSceneNodeResult(result: SceneOperationResult): RemoveSceneNodeSuccess {
  if (result.result.status === 'error') {
    throw new SceneOperationPostconditionError('remove_node', result.result.errors ?? []);
  }
  const trimmedOutput = result.stdout.trim();
  const lines: string[] = ['remove_node succeeded.'];
  if (trimmedOutput.length > 0) lines.push('', trimmedOutput);
  if (result.stderr.trim().length > 0) {
    lines.push('', 'Diagnostic output:', result.stderr.trim());
  }
  return { content: [{ type: 'text', text: lines.join('\n') }] };
}
