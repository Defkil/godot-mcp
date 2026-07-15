import type { OperationParams } from '../utils.js';

export interface UidResaveSummary {
  eligible: number;
  scenesSaved: number;
  uidsGenerated: number;
  errors: number;
}

const RESULT_PREFIX = 'GODOT_MCP_RESULT=';

export function createUidResaveParams(_hostProjectPath: string): OperationParams {
  // Godot operations already run with --path <hostProjectPath>. Passing that host
  // path into the script would turn it into malformed res:///... resource paths.
  return { projectPath: 'res://' };
}

export function parseUidResaveSummary(stdout: string): UidResaveSummary {
  const marker = stdout
    .split(/\r?\n/)
    .reverse()
    .find(line => line.startsWith(RESULT_PREFIX));
  if (!marker) {
    throw new Error('UID resave output did not contain a result marker.');
  }

  let value: unknown;
  try {
    value = JSON.parse(marker.slice(RESULT_PREFIX.length));
  } catch {
    throw new Error('UID resave result marker contained malformed JSON.');
  }

  if (!isSummary(value)) {
    throw new Error('UID resave result marker contained invalid counters.');
  }
  return value;
}

function isSummary(value: unknown): value is UidResaveSummary {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return ['eligible', 'scenesSaved', 'uidsGenerated', 'errors'].every(key =>
    Number.isInteger(record[key]) && (record[key] as number) >= 0,
  );
}
