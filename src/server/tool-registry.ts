export type ToolCapability =
  | 'inspect'
  | 'edit'
  | 'runtime'
  | 'export'
  | 'network'
  | 'unsafe';

export interface ToolInputSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
}

export interface RegisteredToolDefinition extends ToolDefinition {
  capability: ToolCapability;
  handler: (args: Record<string, unknown> | undefined) => Promise<any> | any;
}

export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredToolDefinition>();

  constructor(definitions: readonly RegisteredToolDefinition[] = []) {
    for (const definition of definitions) this.register(definition);
  }

  register(definition: RegisteredToolDefinition): void {
    if (!/^[a-z][a-z0-9_]*$/.test(definition.name)) {
      throw new Error(`Tool name must use snake_case: ${definition.name}`);
    }
    if (!definition.description.trim()) {
      throw new Error(`Tool ${definition.name} must provide a description`);
    }
    if (definition.inputSchema?.type !== 'object') {
      throw new Error(`Tool ${definition.name} must declare an object input schema`);
    }
    if (typeof definition.handler !== 'function') {
      throw new Error(`Tool ${definition.name} must provide an executable handler`);
    }
    if (this.tools.has(definition.name)) {
      throw new Error(`Duplicate tool registration: ${definition.name}`);
    }
    this.tools.set(definition.name, definition);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  definitions(): ToolDefinition[] {
    return [...this.tools.values()].map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema,
    }));
  }

  capabilityFor(name: string): ToolCapability | undefined {
    return this.tools.get(name)?.capability;
  }

  async dispatch(name: string, args: Record<string, unknown> | undefined): Promise<any> {
    const definition = this.tools.get(name);
    if (!definition) throw new Error(`Unknown registered tool: ${name}`);
    return await definition.handler(args);
  }
}
