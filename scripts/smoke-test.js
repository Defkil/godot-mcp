import process from 'node:process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const timeoutMs = 15_000;
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), timeoutMs);

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['build/bin.js'],
  env: {
    ...process.env,
    GODOT_PATH: process.execPath,
  },
  stderr: 'pipe',
});
const client = new Client({ name: 'gi-go-mcp-smoke', version: '1.0.0' });

try {
  await client.connect(transport, { signal: controller.signal });
  const response = await client.listTools(undefined, { signal: controller.signal });
  const names = new Set(response.tools.map((tool) => tool.name));

  if (response.tools.length !== 157) {
    throw new Error(`Expected 157 tools, received ${response.tools.length}`);
  }
  for (const required of ['run_project', 'game_eval', 'validate_scripts']) {
    if (!names.has(required)) throw new Error(`Missing representative tool: ${required}`);
  }

  console.log(`MCP stdio smoke passed with ${response.tools.length} tools.`);
} finally {
  clearTimeout(timeout);
  await client.close().catch(() => undefined);
  await transport.close().catch(() => undefined);
}