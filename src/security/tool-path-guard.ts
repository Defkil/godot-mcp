import type { PathPolicy } from './path-policy.js';

const MEMBER_KEYS = [
  'scene',
  'scenePath', 'scene_path',
  'filePath', 'file_path',
  'newPath', 'new_path',
  'directoryPath', 'directory_path',
  'scriptPath', 'script_path',
  'texturePath', 'texture_path',
  'outputPath', 'output_path',
  'resourcePath', 'resource_path',
  'shaderPath', 'shader_path',
  'translationPath', 'translation_path',
  'themePath', 'theme_path',
  'destinationPath', 'destination_path',
  'pluginPath', 'plugin_path',
] as const;

const MEMBER_ARRAY_KEYS = ['scriptPaths', 'script_paths'] as const;

export function assertSafeToolPaths(
  policy: PathPolicy,
  args: Record<string, unknown> | null | undefined,
): void {
  if (!args) return;
  const projectValue = args.projectPath ?? args.project_path ?? args.directory;
  if (projectValue === undefined) return;
  if (typeof projectValue !== 'string') {
    throw new Error('projectPath or directory must be a string.');
  }

  const projectPath = policy.assertProject(projectValue);
  for (const key of MEMBER_KEYS) {
    const value = args[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== 'string') {
      throw new Error(`${key} must be a string.`);
    }
    resolveMember(policy, projectPath, key, value);
  }

  for (const key of MEMBER_ARRAY_KEYS) {
    const value = args[key];
    if (value === undefined || value === null) continue;
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
      throw new Error(`${key} must be an array of strings.`);
    }
    for (const item of value as string[]) {
      resolveMember(policy, projectPath, key, item);
    }
  }
}

function resolveMember(
  policy: PathPolicy,
  projectPath: string,
  key: string,
  value: string,
): void {
  try {
    policy.resolveProjectMember(projectPath, value);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'invalid project member path';
    throw new Error(`${key}: ${message}`);
  }
}
