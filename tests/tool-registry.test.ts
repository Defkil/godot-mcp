import { describe, expect, it, vi } from 'vitest';
import {
  ToolRegistry,
  type RegisteredToolDefinition,
} from '../src/server/tool-registry.js';

function tool(
  name: string,
  handler: RegisteredToolDefinition['handler'] = vi.fn(async () => ({
    content: [{ type: 'text', text: name }],
  })),
): RegisteredToolDefinition {
  return {
    name,
    description: `Handle ${name}`,
    capability: 'inspect',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
    handler,
  };
}

describe('ToolRegistry', () => {
  it('derives advertised schemas and dispatch from the same registration', async () => {
    const handler = vi.fn(async (args: Record<string, unknown>) => ({
      content: [{ type: 'text', text: JSON.stringify(args) }],
    }));
    const registry = new ToolRegistry([tool('inspect_project', handler)]);

    expect(registry.definitions()).toEqual([
      {
        name: 'inspect_project',
        description: 'Handle inspect_project',
        inputSchema: { type: 'object', properties: {}, required: [] },
      },
    ]);
    expect(registry.capabilityFor('inspect_project')).toBe('inspect');
    await expect(registry.dispatch('inspect_project', { projectPath: 'C:\\game' }))
      .resolves.toEqual({ content: [{ type: 'text', text: '{"projectPath":"C:\\\\game"}' }] });
    expect(handler).toHaveBeenCalledWith({ projectPath: 'C:\\game' });
  });

  it('rejects duplicate names before either schema or dispatch can drift', () => {
    expect(() => new ToolRegistry([tool('duplicate'), tool('duplicate')]))
      .toThrow('Duplicate tool registration: duplicate');
  });

  it('rejects registrations without an executable handler', () => {
    const broken = tool('broken');
    broken.handler = undefined as never;
    expect(() => new ToolRegistry([broken]))
      .toThrow('Tool broken must provide an executable handler');
  });

  it('rejects malformed schemas and unknown dispatches truthfully', async () => {
    const malformed = tool('malformed');
    malformed.inputSchema = { type: 'array' as 'object', properties: {} };
    expect(() => new ToolRegistry([malformed]))
      .toThrow('Tool malformed must declare an object input schema');

    const registry = new ToolRegistry();
    await expect(registry.dispatch('missing', {})).rejects.toThrow('Unknown registered tool: missing');
  });
});
