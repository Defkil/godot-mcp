import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GodotServer } from '../src/server.js';
import { PathPolicy } from '../src/security/path-policy.js';
import { CapabilityPolicy, CapabilityDeniedError } from '../src/security/capability-policy.js';
import {
  LEGACY_TOOL_CAPABILITIES,
  capabilityForLegacyTool,
} from '../src/security/legacy-capabilities.js';

function requestHandler(server: GodotServer, method: 'tools/list' | 'tools/call') {
  const handlers = (server as unknown as { server: { _requestHandlers: Map<string, Function> } })
    .server._requestHandlers;
  const handler = handlers.get(method);
  if (!handler) throw new Error(`Missing MCP request handler: ${method}`);
  return handler;
}

const tempRoots: string[] = [];

function makeProject(): { root: string; projectFile: string } {
  const root = mkdtempSync(join(tmpdir(), 'godot-mcp-cap-gate-'));
  tempRoots.push(root);
  const projectFile = join(root, 'project.godot');
  writeFileSync(projectFile, '[application]\nconfig/name="CapabilityGateTest"\n', 'utf8');
  return { root, projectFile };
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('CapabilityPolicy at the MCP tools/call boundary', () => {
  it('lets inspect-only callers reach inspect-class tools through the legacy case path', async () => {
    const { root } = makeProject();
    const server = new GodotServer({
      registerSignalHandlers: false,
      godotPath: '/usr/bin/godot',
      runtimeConnector: () => new Promise(() => undefined),
      runtimeConnectInitialDelayMs: 5,
      pathPolicy: new PathPolicy([root]),
      capabilityPolicy: new CapabilityPolicy('inspect-only'),
    });

    const call = requestHandler(server, 'tools/call')(
      {
        method: 'tools/call',
        params: {
          name: 'get_godot_version',
          arguments: {},
        },
      },
      {},
    );

    const response = await call;
    // get_godot_version returns an isError envelope for a missing executable,
    // but it MUST NOT be a CapabilityDeniedError; the gate is silent when the
    // requested capability is granted.
    expect(response.isError).toBe(true);
    const text = JSON.stringify(response);
    expect(text).not.toMatch(/Capability denied/i);
    expect(text).not.toContain('unsafe-full');
  });

  it('denies a strict profile before the legacy case handler ever runs', async () => {
    const { root } = makeProject();
    const server = new GodotServer({
      registerSignalHandlers: false,
      godotPath: '/usr/bin/godot',
      runtimeConnector: () => new Promise(() => undefined),
      runtimeConnectInitialDelayMs: 5,
      pathPolicy: new PathPolicy([root]),
      capabilityPolicy: new CapabilityPolicy('inspect-only'),
    });

    const response = await requestHandler(server, 'tools/call')(
      {
        method: 'tools/call',
        params: {
          name: 'manage_autoloads',
          arguments: { projectPath: root, action: 'list' },
        },
      },
      {},
    );

    expect(response.isError).toBe(true);
    const text = response.content[0].text as string;
    expect(text).toContain('Capability denied');
    expect(text).toContain('manage_autoloads');
    expect(text).toContain('edit');
    expect(text).toContain('inspect-only');
    expect(text).toMatch(/remediation/i);
    expect(text).toContain('unsafe-full');
  });

  it('denies unsafe tools (game_eval) to every profile except unsafe-full', async () => {
    const { root } = makeProject();
    for (const profile of ['inspect-only', 'safe-mutations', 'runtime-control', 'legacy-full'] as const) {
      const server = new GodotServer({
        registerSignalHandlers: false,
        godotPath: '/usr/bin/godot',
        runtimeConnector: () => new Promise(() => undefined),
        runtimeConnectInitialDelayMs: 5,
        pathPolicy: new PathPolicy([root]),
        capabilityPolicy: new CapabilityPolicy(profile),
      });

      const response = await requestHandler(server, 'tools/call')(
        {
          method: 'tools/call',
          params: {
            name: 'game_eval',
            arguments: { code: 'return 1' },
          },
        },
        {},
      );

      expect(response.isError).toBe(true);
      const text = response.content[0].text as string;
      expect(text).toContain('Capability denied');
      expect(text).toContain('game_eval');
      expect(text).toContain('unsafe');
      expect(text).toContain(profile);
    }
  });

  it('lets unsafe-full call arbitrary tools after explicit operator opt-in', async () => {
    const { root } = makeProject();
    const server = new GodotServer({
      registerSignalHandlers: false,
      godotPath: '/usr/bin/godot',
      runtimeConnector: () => new Promise(() => undefined),
      runtimeConnectInitialDelayMs: 5,
      pathPolicy: new PathPolicy([root]),
      capabilityPolicy: new CapabilityPolicy('unsafe-full'),
    });

    // attach_script is classified `unsafe` so it must reach the handler
    // (which still rejects because no real script exists) instead of being
    // blocked at the capability gate.
    const response = await requestHandler(server, 'tools/call')(
      {
        method: 'tools/call',
        params: {
          name: 'attach_script',
          arguments: { projectPath: root, scenePath: 'scenes/Main.tscn', nodePath: 'root', scriptPath: 'scripts/missing.gd' },
        },
      },
      {},
    );
    const text = JSON.stringify(response);
    // Capability gate must not produce a CapabilityDeniedError; downstream
    // errors come from the path policy/project-file check.
    expect(text).not.toMatch(/Capability denied/i);
  });

  it('also gates registered tools through the registry dispatch path', async () => {
    const { root } = makeProject();
    // modify_project_settings is classified `edit` in the registry; `inspect-only`
    // must reject it without invoking the handler.
    const server = new GodotServer({
      registerSignalHandlers: false,
      godotPath: '/usr/bin/godot',
      runtimeConnector: () => new Promise(() => undefined),
      runtimeConnectInitialDelayMs: 5,
      pathPolicy: new PathPolicy([root]),
      capabilityPolicy: new CapabilityPolicy('inspect-only'),
    });

    const response = await requestHandler(server, 'tools/call')(
      {
        method: 'tools/call',
        params: {
          name: 'modify_project_settings',
          arguments: { projectPath: root, section: 'application', key: 'config/name', value: '"X"' },
        },
      },
      {},
    );

    expect(response.isError).toBe(true);
    const text = response.content[0].text as string;
    expect(text).toContain('Capability denied');
    expect(text).toContain('modify_project_settings');
    expect(text).toContain('edit');
    expect(text).toContain('inspect-only');
  });

  it('throws a structured CapabilityDeniedError, not a generic Error', () => {
    const policy = new CapabilityPolicy('inspect-only');
    expect(() => policy.assertAllowed('any_tool', 'edit')).toThrow(CapabilityDeniedError);
  });
});

describe('CapabilityPolicy: legacy tool classification matches actual side effects', () => {
  // The following tools were previously misclassified as 'inspect' despite
  // mutating project.godot or scene files, breaking the read-only contract
  // of the 'inspect-only' profile. These tests pin the corrected
  // classification at the wire level.

  const unsafeLegacyTools = ['manage_plugins', 'manage_translations'] as const;
  for (const toolName of unsafeLegacyTools) {
    it(`denies ${toolName} (unsafe) to inspect-only, safe-mutations, runtime-control, and legacy-full`, async () => {
      const { root } = makeProject();
      for (const profile of ['inspect-only', 'safe-mutations', 'runtime-control', 'legacy-full'] as const) {
        const server = new GodotServer({
          registerSignalHandlers: false,
          godotPath: '/usr/bin/godot',
          runtimeConnector: () => new Promise(() => undefined),
          runtimeConnectInitialDelayMs: 5,
          pathPolicy: new PathPolicy([root]),
          capabilityPolicy: new CapabilityPolicy(profile),
        });

        const response = await requestHandler(server, 'tools/call')(
          {
            method: 'tools/call',
            params: {
              name: toolName,
              arguments: { projectPath: root, action: 'list' },
            },
          },
          {},
        );

        expect(response.isError).toBe(true);
        const text = response.content[0].text as string;
        expect(text).toContain('Capability denied');
        expect(text).toContain(toolName);
        expect(text).toContain('unsafe');
        expect(text).toContain(profile);
      }
    });

    it(`admits ${toolName} (unsafe) under unsafe-full operator opt-in`, async () => {
      const { root } = makeProject();
      const server = new GodotServer({
        registerSignalHandlers: false,
        godotPath: '/usr/bin/godot',
        runtimeConnector: () => new Promise(() => undefined),
        runtimeConnectInitialDelayMs: 5,
        pathPolicy: new PathPolicy([root]),
        capabilityPolicy: new CapabilityPolicy('unsafe-full'),
      });

      const response = await requestHandler(server, 'tools/call')(
        {
          method: 'tools/call',
          params: {
            name: toolName,
            arguments: { projectPath: root, action: 'list' },
          },
        },
        {},
      );

      const text = JSON.stringify(response);
      // Capability gate must not produce a CapabilityDeniedError; downstream
      // errors come from the path policy or handler (e.g. missing addons dir).
      expect(text).not.toMatch(/Capability denied/i);
    });
  }

  const editLegacyTools = [
    'manage_scene_signals',
    'manage_layers',
    'manage_scene_structure',
    'manage_input_map',
  ] as const;
  for (const toolName of editLegacyTools) {
    it(`denies ${toolName} (edit) under inspect-only`, async () => {
      const { root } = makeProject();
      const server = new GodotServer({
        registerSignalHandlers: false,
        godotPath: '/usr/bin/godot',
        runtimeConnector: () => new Promise(() => undefined),
        runtimeConnectInitialDelayMs: 5,
        pathPolicy: new PathPolicy([root]),
        capabilityPolicy: new CapabilityPolicy('inspect-only'),
      });

      const response = await requestHandler(server, 'tools/call')(
        {
          method: 'tools/call',
          params: {
            name: toolName,
            arguments: { projectPath: root, action: 'list' },
          },
        },
        {},
      );

      expect(response.isError).toBe(true);
      const text = response.content[0].text as string;
      expect(text).toContain('Capability denied');
      expect(text).toContain(toolName);
      expect(text).toContain('edit');
      expect(text).toContain('inspect-only');
    });

    it(`admits ${toolName} (edit) under safe-mutations`, async () => {
      const { root } = makeProject();
      const server = new GodotServer({
        registerSignalHandlers: false,
        godotPath: '/usr/bin/godot',
        runtimeConnector: () => new Promise(() => undefined),
        runtimeConnectInitialDelayMs: 5,
        pathPolicy: new PathPolicy([root]),
        capabilityPolicy: new CapabilityPolicy('safe-mutations'),
      });

      const response = await requestHandler(server, 'tools/call')(
        {
          method: 'tools/call',
          params: {
            name: toolName,
            arguments: { projectPath: root, action: 'list' },
          },
        },
        {},
      );

      const text = JSON.stringify(response);
      // Capability gate must not block edit-class tools under safe-mutations.
      expect(text).not.toMatch(/Capability denied/i);
    });
  }

  it('legacy-full admits all six reclassified tools (none are unsafe-blocked)', async () => {
    const { root } = makeProject();
    const allSix = [
      'manage_plugins',
      'manage_translations',
      'manage_scene_signals',
      'manage_layers',
      'manage_scene_structure',
      'manage_input_map',
    ];
    for (const toolName of allSix) {
      const server = new GodotServer({
        registerSignalHandlers: false,
        godotPath: '/usr/bin/godot',
        runtimeConnector: () => new Promise(() => undefined),
        runtimeConnectInitialDelayMs: 5,
        pathPolicy: new PathPolicy([root]),
        capabilityPolicy: new CapabilityPolicy('legacy-full'),
      });

      const response = await requestHandler(server, 'tools/call')(
        {
          method: 'tools/call',
          params: {
            name: toolName,
            arguments: { projectPath: root, action: 'list' },
          },
        },
        {},
      );

      const text = JSON.stringify(response);
      // legacy-full omits 'unsafe', so manage_plugins and manage_translations
      // MUST still be denied here — they are the ones the docstring calls out
      // as arbitrary-GDScript execution paths.
      if (toolName === 'manage_plugins' || toolName === 'manage_translations') {
        expect(text).toMatch(/Capability denied/i);
      } else {
        // The four edit-class tools must reach the handler.
        expect(text).not.toMatch(/Capability denied/i);
      }
    }
  });
});

describe('CapabilityPolicy: network-capability classification for outbound transport tools', () => {
  // game_http_request, game_websocket, game_multiplayer, and game_rpc all
  // perform outbound transport (HTTP request, WebSocket client, ENet
  // server/client, RPC). src/server.ts advertises and dispatches them
  // alongside each other under "Batch 1: Networking + Input + System +
  // Signals + Script", and src/scripts/mcp_interaction_server.gd performs
  // the matching networking operations against a live Godot. The
  // `runtime` capability is supposed to mean "launch, stop, bounded
  // input/playtest control"; a profile that grants only `runtime` MUST
  // therefore refuse to perform outbound networking on the user's
  // machine, because that crosses the capability boundary the rest of
  // the gate relies on. The capability the gate already defines for
  // this class is `network`, granted by `legacy-full` and `unsafe-full`
  // but NOT by `runtime-control`.

  const networkTools = [
    'game_http_request',
    'game_websocket',
    'game_multiplayer',
    'game_rpc',
  ] as const;

  // Minimal/invalid arguments: a real (allowed) project root so the
  // path policy admits the call, but each handler is invoked in a way
  // that makes it fail locally/downstream — gameCommand with no live
  // Godot process attached — instead of performing any real network
  // I/O. We then assert absence of "Capability denied" for legacy-full
  // (the gate must stay silent) and the structured envelope for
  // runtime-control / safe-mutations (the gate must trip first).
  const networkArgs: Readonly<Record<(typeof networkTools)[number], (root: string) => Record<string, unknown>>> = {
    game_http_request: (root) => ({ projectPath: root, method: 'GET', url: 'http://127.0.0.1:1' }),
    game_websocket: (root) => ({ projectPath: root, action: 'connect', url: 'ws://127.0.0.1:1' }),
    game_multiplayer: (root) => ({ projectPath: root, action: 'create_server', port: 1, max_clients: 1 }),
    game_rpc: (root) => ({ projectPath: root, action: 'config', nodePath: '/root', method: 'no_such' }),
  };

  it('the legacy capability map classifies every network tool as `network`', () => {
    for (const toolName of networkTools) {
      const cap = capabilityForLegacyTool(toolName);
      expect(cap, `expected ${toolName} to be classified in the legacy map`).toBeDefined();
      expect(
        cap,
        `expected ${toolName} to be classified 'network' (was '${cap}') so runtime-control denies it`,
      ).toBe('network');
      expect(LEGACY_TOOL_CAPABILITIES[toolName]).toBe('network');
    }
  });

  for (const toolName of networkTools) {
    it(`denies ${toolName} to runtime-control with a structured network CapabilityDeniedError`, async () => {
      const { root } = makeProject();
      const server = new GodotServer({
        registerSignalHandlers: false,
        godotPath: '/usr/bin/godot',
        runtimeConnector: () => new Promise(() => undefined),
        runtimeConnectInitialDelayMs: 5,
        pathPolicy: new PathPolicy([root]),
        capabilityPolicy: new CapabilityPolicy('runtime-control'),
      });

      const response = await requestHandler(server, 'tools/call')(
        {
          method: 'tools/call',
          params: {
            name: toolName,
            arguments: networkArgs[toolName](root),
          },
        },
        {},
      );

      expect(response.isError).toBe(true);
      const text = response.content[0].text as string;
      // The wire-level envelope must carry the structured capability
      // denial naming the `network` capability. The gate is the
      // authoritative signal; an admitted-but-failing handler must
      // not produce a different category of error first.
      expect(text).toContain('Capability denied');
      expect(text).toContain(toolName);
      expect(text).toContain('network');
      expect(text).toContain('runtime-control');
      expect(text).toMatch(/remediation/i);
    });
  }

  for (const toolName of networkTools) {
    it(`admits ${toolName} past the capability gate under legacy-full (no "Capability denied" envelope)`, async () => {
      const { root } = makeProject();
      const server = new GodotServer({
        registerSignalHandlers: false,
        godotPath: '/usr/bin/godot',
        runtimeConnector: () => new Promise(() => undefined),
        runtimeConnectInitialDelayMs: 5,
        pathPolicy: new PathPolicy([root]),
        capabilityPolicy: new CapabilityPolicy('legacy-full'),
      });

      const response = await requestHandler(server, 'tools/call')(
        {
          method: 'tools/call',
          params: {
            name: toolName,
            arguments: networkArgs[toolName](root),
          },
        },
        {},
      );

      const text = JSON.stringify(response);
      // The capability gate is silent for granted capabilities.
      // Downstream errors (no live Godot process, etc.) are not what
      // we are testing here — only that legacy-full is allowed to
      // call the handler.
      expect(text).not.toMatch(/Capability denied/i);
    });
  }

  it('still denies network tools to safe-mutations (read+edit, no runtime, no network)', async () => {
    // Sanity: a strict profile must keep refusing network egress.
    const { root } = makeProject();
    for (const toolName of networkTools) {
      const server = new GodotServer({
        registerSignalHandlers: false,
        godotPath: '/usr/bin/godot',
        runtimeConnector: () => new Promise(() => undefined),
        runtimeConnectInitialDelayMs: 5,
        pathPolicy: new PathPolicy([root]),
        capabilityPolicy: new CapabilityPolicy('safe-mutations'),
      });

      const response = await requestHandler(server, 'tools/call')(
        {
          method: 'tools/call',
          params: {
            name: toolName,
            arguments: networkArgs[toolName](root),
          },
        },
        {},
      );

      expect(response.isError).toBe(true);
      const text = response.content[0].text as string;
      expect(text).toContain('Capability denied');
      expect(text).toContain(toolName);
      expect(text).toContain('network');
      expect(text).toContain('safe-mutations');
    }
  });
});
