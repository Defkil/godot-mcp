#!/usr/bin/env node
import { GodotServer } from './index.js';

async function main(): Promise<void> {
  const server = new GodotServer();
  await server.run();
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[SERVER] Fatal startup error:', message);
  process.exitCode = 1;
});