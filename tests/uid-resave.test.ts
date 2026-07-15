import { describe, expect, it } from 'vitest';
import { createUidResaveParams, parseUidResaveSummary } from '../src/godot/uid-resave.js';

describe('UID resave protocol', () => {
  it('never forwards a host project path as a res:// resource root', () => {
    expect(createUidResaveParams('C:\\Games\\Wargrid')).toEqual({ projectPath: 'res://' });
    expect(createUidResaveParams('/workspace/wargrid')).toEqual({ projectPath: 'res://' });
  });

  it('parses the typed Godot-side summary marker', () => {
    const stdout = [
      'Resaving resources...',
      'GODOT_MCP_RESULT={"eligible":4,"scenesSaved":2,"uidsGenerated":1,"errors":0}',
    ].join('\n');

    expect(parseUidResaveSummary(stdout)).toEqual({
      eligible: 4,
      scenesSaved: 2,
      uidsGenerated: 1,
      errors: 0,
    });
  });

  it('rejects missing, malformed, or invalid summaries instead of claiming success', () => {
    expect(() => parseUidResaveSummary('Resave operation complete')).toThrow('result marker');
    expect(() => parseUidResaveSummary('GODOT_MCP_RESULT={bad json}')).toThrow('malformed');
    expect(() => parseUidResaveSummary('GODOT_MCP_RESULT={"eligible":-1,"scenesSaved":0,"uidsGenerated":0,"errors":0}')).toThrow('invalid');
  });
});
