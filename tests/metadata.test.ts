import { describe, it, expect } from 'vitest';
import { getMetadata } from '../src/metadata';

describe('metadata', () => {
  it('should return name and version from package.json', () => {
    const metadata = getMetadata();
    expect(metadata.mcpName).toBe('io.github.defkil/gi-go-mcp');
    expect(metadata.version).toBe('3.1.0');
  });
});
