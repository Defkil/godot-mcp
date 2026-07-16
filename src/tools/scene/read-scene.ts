import { join } from 'node:path';
import {
  SceneOperationPostconditionError,
  type SceneOperationResult,
  type SceneToolContext,
} from './_shared.js';

export interface ReadSceneInput {
  projectPath: string;
  scenePath: string;
}

export interface ReadSceneOptions {
  pathPolicy: SceneToolContext['pathPolicy'];
  operationRunner: SceneToolContext['operationRunner'];
}

export interface ReadSceneSuccess {
  content: Array<{ type: 'text'; text: string }>;
}

const REQUIRED_KEYS: ReadonlyArray<keyof ReadSceneInput> = [
  'projectPath',
  'scenePath',
];

const SCENE_JSON_START = 'SCENE_JSON_START';
const SCENE_JSON_END = 'SCENE_JSON_END';

export function validateReadSceneInput(raw: unknown): ReadSceneInput {
  if (!raw || typeof raw !== 'object') {
    throw new Error('read_scene expects an object input.');
  }
  const value = raw as Record<string, unknown>;
  for (const key of REQUIRED_KEYS) {
    if (value[key] === undefined || value[key] === null || value[key] === '') {
      throw new Error(`'${key}' is required for read_scene.`);
    }
  }
  return {
    projectPath: String(value.projectPath),
    scenePath: String(value.scenePath),
  };
}

export async function readScene(
  input: ReadSceneInput,
  context: ReadSceneOptions,
): Promise<ReadSceneSuccess> {
  const projectPath = context.pathPolicy.assertProject(input.projectPath);
  context.pathPolicy.resolveProjectMember(projectPath, input.scenePath);

  const execution = await context.operationRunner.run(
    'read_scene',
    {
      scene_path: join(projectPath, input.scenePath),
    },
    projectPath,
  );

  return renderReadSceneResult(execution);
}

export function renderReadSceneResult(result: SceneOperationResult): ReadSceneSuccess {
  if (result.result.status === 'error') {
    throw new SceneOperationPostconditionError('read_scene', result.result.errors ?? []);
  }
  const startIdx = result.stdout.indexOf(SCENE_JSON_START);
  const endIdx = result.stdout.indexOf(SCENE_JSON_END);
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const jsonBlock = result.stdout
      .substring(startIdx + SCENE_JSON_START.length, endIdx)
      .trim();
    try {
      const parsed = JSON.parse(jsonBlock);
      return {
        content: [{ type: 'text', text: JSON.stringify(parsed, null, 2) }],
      };
    } catch {
      return {
        content: [{ type: 'text', text: `Raw scene data:\n${jsonBlock}` }],
      };
    }
  }
  const stderr = result.stderr.trim();
  const fallback = stderr.length > 0
    ? `Scene read output:\n${result.stdout}\nErrors:\n${stderr}`
    : `Scene read output:\n${result.stdout}`;
  return { content: [{ type: 'text', text: fallback }] };
}
