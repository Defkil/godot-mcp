import { describe, expect, it } from 'vitest';
import { getMetadata, parseMetadata } from '../src/metadata.js';

describe('metadata', () => {
  it('returns the runtime identity from package.json', () => {
    const metadata = getMetadata();
    expect(metadata).toEqual({
      mcpName: 'io.github.defkil/gi-go-mcp',
      version: '3.1.0',
    });
  });

  it.each([
    '{}',
    '{"mcpName":"","version":"3.1.0"}',
    '{"mcpName":"io.github.defkil/gi-go-mcp","version":""}',
    '{"mcpName":42,"version":"3.1.0"}',
  ])('rejects invalid package metadata instead of masking drift: %s', (content) => {
    expect(() => parseMetadata(content)).toThrow(/valid non-empty mcpName and version/);
  });
});
