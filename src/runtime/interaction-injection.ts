import {
  copyFileSync,
  existsSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

export interface InteractionInjection {
  readonly projectPath: string;
  readonly projectFile: string;
  readonly scriptFile: string;
  readonly autoloadName: string;
  readonly autoloadAdded: boolean;
  readonly appendedAutoloadSection: string | null;
  readonly scriptCreated: boolean;
}

function removeIfPresent(filePath: string): void {
  if (existsSync(filePath)) unlinkSync(filePath);
}

function replaceFileAtomically(filePath: string, content: string): void {
  const temporary = `${filePath}.gi-go-mcp-${process.pid}-${Date.now()}.tmp`;
  try {
    writeFileSync(temporary, content, 'utf8');
    renameSync(temporary, filePath);
  } catch (error) {
    removeIfPresent(temporary);
    throw error;
  }
}

export function prepareInteractionInjection(
  projectPath: string,
  sourceScript: string,
  autoloadName: string
): InteractionInjection {
  const projectFile = join(projectPath, 'project.godot');
  const scriptFile = join(projectPath, 'mcp_interaction_server.gd');
  const originalProject = readFileSync(projectFile, 'utf8');
  const autoloadLine = `${autoloadName}="*res://mcp_interaction_server.gd"`;
  const autoloadPresent = originalProject.includes(autoloadLine);

  if (autoloadPresent) {
    if (existsSync(scriptFile)) {
      return {
        projectPath,
        projectFile,
        scriptFile,
        autoloadName,
        autoloadAdded: false,
        appendedAutoloadSection: null,
        scriptCreated: false,
      };
    }
    copyFileSync(sourceScript, scriptFile);
    return {
      projectPath,
      projectFile,
      scriptFile,
      autoloadName,
      autoloadAdded: false,
      appendedAutoloadSection: null,
      scriptCreated: true,
    };
  }

  if (existsSync(scriptFile)) {
    throw new Error('Refusing to overwrite an unmanaged mcp_interaction_server.gd file.');
  }

  let scriptCreated = false;
  try {
    copyFileSync(sourceScript, scriptFile);
    scriptCreated = true;
    const hasAutoloadSection = originalProject.includes('[autoload]');
    const appendedAutoloadSection = hasAutoloadSection
      ? null
      : `${originalProject.endsWith('\n') ? '' : '\n'}[autoload]\n\n${autoloadLine}\n`;
    const updatedProject = hasAutoloadSection
      ? originalProject.replace('[autoload]', `[autoload]\n\n${autoloadLine}`)
      : originalProject + appendedAutoloadSection;
    replaceFileAtomically(projectFile, updatedProject);
    return {
      projectPath,
      projectFile,
      scriptFile,
      autoloadName,
      autoloadAdded: true,
      appendedAutoloadSection,
      scriptCreated: true,
    };
  } catch (error) {
    if (scriptCreated) removeIfPresent(scriptFile);
    throw error;
  }
}

export function cleanupInteractionInjection(injection: InteractionInjection): void {
  if (injection.autoloadAdded && existsSync(injection.projectFile)) {
    const autoloadLine = `${injection.autoloadName}="*res://mcp_interaction_server.gd"`;
    const escaped = autoloadLine.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const content = readFileSync(injection.projectFile, 'utf8');
    if (injection.appendedAutoloadSection && !content.includes(injection.appendedAutoloadSection)) {
      throw new Error('Interaction injection ownership marker changed; refusing destructive cleanup.');
    }
    const updated = injection.appendedAutoloadSection
      ? content.replace(injection.appendedAutoloadSection, '')
      : content.replace(new RegExp(`\\n?${escaped}\\n?`), '\n');
    replaceFileAtomically(injection.projectFile, updated);
  }

  if (injection.scriptCreated) {
    removeIfPresent(injection.scriptFile);
    removeIfPresent(`${injection.scriptFile}.uid`);
  }
}
