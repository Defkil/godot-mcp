#!/usr/bin/env node

import { existsSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { GodotServer } from './server.js';

export function isDirectExecution(moduleUrl: string, argvEntry = process.argv[1]): boolean {
  if (!argvEntry) return false;
  const modulePath = fileURLToPath(moduleUrl);
  const entryPath = resolve(argvEntry);
  const canonicalEntry = existsSync(entryPath) ? realpathSync.native(entryPath) : entryPath;
  const normalizeForComparison = (value: string) =>
    process.platform === 'win32' ? value.toLowerCase() : value;
  return normalizeForComparison(modulePath) === normalizeForComparison(canonicalEntry);
}

export async function runGodotMcpCli(): Promise<void> {
  const server = new GodotServer();
  try {
    await server.run();
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Failed to run server:', errorMessage);
    process.exitCode = 1;
  }
}

if (isDirectExecution(import.meta.url)) {
  void runGodotMcpCli();
}
