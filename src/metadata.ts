import { readFileSync } from 'node:fs';

export interface RuntimeMetadata {
  mcpName: string;
  version: string;
}

export function parseMetadata(content: string): RuntimeMetadata {
  const value: unknown = JSON.parse(content);
  const candidate = value as Partial<RuntimeMetadata> | null;

  if (
    candidate === null ||
    typeof candidate !== 'object' ||
    typeof candidate.mcpName !== 'string' ||
    candidate.mcpName.length === 0 ||
    typeof candidate.version !== 'string' ||
    candidate.version.length === 0
  ) {
    throw new Error('package.json must contain valid non-empty mcpName and version fields');
  }

  return {
    mcpName: candidate.mcpName,
    version: candidate.version,
  };
}

export function getMetadata(
  packageJsonUrl: URL = new URL('../package.json', import.meta.url)
): RuntimeMetadata {
  return parseMetadata(readFileSync(packageJsonUrl, 'utf8'));
}
