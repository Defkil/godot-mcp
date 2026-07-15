import {
  chmodSync,
  existsSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

interface FileSnapshot {
  bytes: Buffer;
  mode: number;
}

export interface BridgeInstallation {
  readonly scriptPath: string;
  readonly resourcePath: string;
  readonly userManaged: boolean;
  restore(): void;
}

interface InstallBridgeOptions {
  projectPath: string;
  sourceScriptPath: string;
  autoloadName?: string;
  preferredFileName?: string;
}

export function installRuntimeBridge(options: InstallBridgeOptions): BridgeInstallation {
  const autoloadName = options.autoloadName ?? 'McpInteractionServer';
  const preferredFileName = options.preferredFileName ?? 'mcp_interaction_server.gd';
  const projectFile = join(options.projectPath, 'project.godot');
  if (!existsSync(projectFile)) {
    throw new Error(`Not a valid Godot project: ${options.projectPath}`);
  }
  if (!existsSync(options.sourceScriptPath)) {
    throw new Error(`Runtime bridge source does not exist: ${options.sourceScriptPath}`);
  }

  const projectSnapshot = snapshot(projectFile);
  const projectText = projectSnapshot.bytes.toString('utf8');
  const existingAutoload = findAutoload(projectText, autoloadName);
  if (existingAutoload) {
    const relativeScript = normalizeResourceMember(existingAutoload);
    const scriptPath = join(options.projectPath, ...relativeScript.split('/'));
    if (!existsSync(scriptPath)) {
      throw new Error(
        `Autoload ${autoloadName} points to a missing user-managed script: ${existingAutoload}`,
      );
    }
    return {
      scriptPath,
      resourcePath: `res://${relativeScript}`,
      userManaged: true,
      restore() {},
    };
  }

  const selectedFileName = existsSync(join(options.projectPath, preferredFileName))
    ? generatedFileName(preferredFileName)
    : preferredFileName;
  const scriptPath = join(options.projectPath, selectedFileName);
  const resourcePath = `res://${selectedFileName.replace(/\\/g, '/')}`;
  const scriptBytes = readFileSync(options.sourceScriptPath);
  const autoloadLine = `${autoloadName}="*${resourcePath}"`;
  const updatedProject = addAutoload(projectText, autoloadLine);

  let restored = false;
  try {
    writeAtomic(scriptPath, scriptBytes);
    writeAtomic(projectFile, Buffer.from(updatedProject, 'utf8'), projectSnapshot.mode);
  } catch (error) {
    if (existsSync(scriptPath)) unlinkSync(scriptPath);
    writeAtomic(projectFile, projectSnapshot.bytes, projectSnapshot.mode);
    throw error;
  }

  return {
    scriptPath,
    resourcePath,
    userManaged: false,
    restore() {
      if (restored) return;
      restored = true;
      writeAtomic(projectFile, projectSnapshot.bytes, projectSnapshot.mode);
      if (existsSync(scriptPath)) unlinkSync(scriptPath);
      const uidPath = `${scriptPath}.uid`;
      if (existsSync(uidPath)) unlinkSync(uidPath);
    },
  };
}

function snapshot(path: string): FileSnapshot {
  return {
    bytes: readFileSync(path),
    mode: statSync(path).mode,
  };
}

function writeAtomic(path: string, bytes: Buffer, mode?: number): void {
  const tempPath = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    writeFileSync(tempPath, bytes);
    if (mode !== undefined) chmodSync(tempPath, mode);
    renameSync(tempPath, path);
  } finally {
    if (existsSync(tempPath)) unlinkSync(tempPath);
  }
}

function findAutoload(projectText: string, autoloadName: string): string | null {
  const escaped = autoloadName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = projectText.match(new RegExp(`^${escaped}\\s*=\\s*"\\*?(res://[^"]+)"\\s*$`, 'm'));
  return match?.[1] ?? null;
}

function normalizeResourceMember(resourcePath: string): string {
  const relative = resourcePath.replace(/^res:\/\//, '').replace(/\\/g, '/');
  if (!relative || relative.startsWith('/') || relative.split('/').includes('..')) {
    throw new Error(`Unsafe autoload resource path: ${resourcePath}`);
  }
  return relative;
}

function generatedFileName(preferredFileName: string): string {
  const extensionIndex = preferredFileName.lastIndexOf('.');
  if (extensionIndex <= 0) return `${preferredFileName}.generated`;
  return `${preferredFileName.slice(0, extensionIndex)}.generated${preferredFileName.slice(extensionIndex)}`;
}

function addAutoload(projectText: string, autoloadLine: string): string {
  if (/^\[autoload\]\s*$/m.test(projectText)) {
    return projectText.replace(/^\[autoload\]\s*$/m, match => `${match}\n\n${autoloadLine}`);
  }
  const separator = projectText.endsWith('\n') ? '\n' : '\n\n';
  return `${projectText}${separator}[autoload]\n\n${autoloadLine}\n`;
}
