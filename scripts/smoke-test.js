import process from 'node:process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const timeoutMs = 15_000;
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), timeoutMs);
const sandbox = mkdtempSync(path.join(tmpdir(), 'gi-go-mcp-smoke-'));
const allowedRoot = path.join(sandbox, 'allowed');
const outsideRoot = path.join(sandbox, 'outside');
mkdirSync(allowedRoot);
mkdirSync(outsideRoot);

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['build/bin.js'],
  env: {
    ...process.env,
    GODOT_PATH: process.execPath,
    GODOT_MCP_ALLOWED_DIRS: JSON.stringify([allowedRoot]),
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

  const rejected = await client.callTool(
    { name: 'list_projects', arguments: { directory: outsideRoot, recursive: false } },
    undefined,
    { signal: controller.signal }
  );
  if (rejected.isError !== true) {
    throw new Error('Path policy did not reject project discovery outside the configured root.');
  }
  if (JSON.stringify(rejected).includes(outsideRoot)) {
    throw new Error('Path policy response leaked the rejected host path.');
  }

  const accepted = await client.callTool(
    { name: 'list_projects', arguments: { directory: allowedRoot, recursive: false } },
    undefined,
    { signal: controller.signal }
  );
  if (accepted.isError === true) {
    throw new Error('Path policy rejected the configured project discovery root.');
  }

  console.log(`MCP stdio smoke passed with ${response.tools.length} tools and path containment.`);
} finally {
  clearTimeout(timeout);
  await client.close().catch(() => undefined);
  await transport.close().catch(() => undefined);
  rmSync(sandbox, { recursive: true, force: true });
}