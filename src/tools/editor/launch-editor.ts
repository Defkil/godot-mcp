import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import {
  BoundedLineBuffer,
  LaunchError,
  observeStartup,
  terminateProcessTree,
} from '../../godot/process-lifecycle.js';
import type { PathPolicy } from '../../security/path-policy.js';

export type LaunchEditorSpawn = (
  command: string,
  args: readonly string[],
  options: { stdio: 'pipe'; env?: NodeJS.ProcessEnv },
) => ChildProcessWithoutNullStreams;

export interface LaunchEditorOptions {
  projectPath: string;
  godotPath: string;
  pathPolicy: PathPolicy;
  graceMs?: number;
  outputBufferLines?: number;
  errorBufferLines?: number;
  spawn?: LaunchEditorSpawn;
}

export interface LaunchEditorSuccess {
  content: Array<{ type: 'text'; text: string }>;
}

export const DEFAULT_LAUNCH_EDITOR_GRACE_MS = 750;
export const DEFAULT_LAUNCH_EDITOR_BUFFER_LINES = 200;

/**
 * Launch the Godot editor for `projectPath` and observe its startup.
 *
 * Returns the bounded editor-launch success envelope once `observeStartup`
 * resolves. If the editor process exits early, emits a known parse/launch
 * error pattern, or fails to start, the promise rejects with a
 * {@link LaunchError} (or a plain {@link Error} for malformed inputs).
 *
 * Side effects:
 *
 * - resolves the project path through {@link PathPolicy.assertProject};
 * - spawns the configured `godotPath` with `-e --path <project>` and `stdio: 'pipe'`;
 * - observes startup for at most `graceMs` (default 750 ms);
 * - drains stdout into a bounded buffer (`outputBufferLines`, default 200);
 * - drains stderr into a bounded buffer (`errorBufferLines`, default 200);
 * - terminates the spawned process tree best-effort when observation fails.
 */
export async function launchEditor(
  options: LaunchEditorOptions,
): Promise<LaunchEditorSuccess> {
  const projectPath = options.pathPolicy.assertProject(options.projectPath);
  const projectFile = join(projectPath, 'project.godot');
  if (!existsSync(projectFile)) {
    throw new Error(`Not a valid Godot project: ${projectPath}`);
  }

  if (!options.godotPath) {
    throw new Error('A Godot executable path is required.');
  }

  const spawnFn = options.spawn ?? defaultSpawn;
  const graceMs = options.graceMs ?? DEFAULT_LAUNCH_EDITOR_GRACE_MS;
  const output = new BoundedLineBuffer(
    options.outputBufferLines ?? DEFAULT_LAUNCH_EDITOR_BUFFER_LINES,
  );
  const errors = new BoundedLineBuffer(
    options.errorBufferLines ?? DEFAULT_LAUNCH_EDITOR_BUFFER_LINES,
  );

  const child = spawnFn(options.godotPath, ['-e', '--path', projectPath], { stdio: 'pipe' });
  child.stdout.on('data', (data: Buffer) => output.append(data));
  child.stderr.on('data', (data: Buffer) => errors.append(data));

  try {
    await observeStartup(child, errors, { graceMs });
  } catch (error: unknown) {
    await terminate(child);
    if (error instanceof LaunchError) {
      const diagnostics = error.diagnostics.length > 0
        ? `\n\nGodot diagnostics:\n${error.diagnostics.join('\n')}`
        : '';
      throw new LaunchError(`${error.message}${diagnostics}`, error.diagnostics);
    }
    throw error;
  }

  return {
    content: [
      {
        type: 'text',
        text: `Godot editor launched successfully for project at ${projectPath}.`,
      },
    ],
  };
}

async function terminate(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    await terminateProcessTree(child, { gracefulTimeoutMs: 250, forceTimeoutMs: 250 });
  } catch {
    // best-effort cleanup; the launch already failed and we surface that error
  }
}

function defaultSpawn(
  command: string,
  args: readonly string[],
  options: { stdio: 'pipe'; env?: NodeJS.ProcessEnv },
): ChildProcessWithoutNullStreams {
  return spawn(command, args as string[], options) as ChildProcessWithoutNullStreams;
}
