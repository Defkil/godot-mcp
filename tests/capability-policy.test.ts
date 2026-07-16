import { describe, expect, it } from 'vitest';
import {
  CapabilityDeniedError,
  CapabilityPolicy,
  KNOWN_CAPABILITY_PROFILES,
  parseCapabilityProfile,
  resolveCapabilityPolicyFromEnvironment,
  type CapabilityProfileName,
} from '../src/security/capability-policy.js';
import type { ToolCapability } from '../src/server/tool-registry.js';

describe('CapabilityPolicy', () => {
  it('exposes a closed list of known profiles including unsafe opt-in', () => {
    expect(new Set(KNOWN_CAPABILITY_PROFILES)).toEqual(
      new Set(['inspect-only', 'safe-mutations', 'runtime-control', 'unsafe-full', 'legacy-full']),
    );
  });

  it('denies tools whose capability is not granted by the active profile', () => {
    const policy = new CapabilityPolicy('inspect-only');
    expect(policy.allows('inspect')).toBe(true);
    expect(policy.allows('edit')).toBe(false);
    expect(policy.allows('runtime')).toBe(false);
    expect(policy.allows('export')).toBe(false);
    expect(policy.allows('network')).toBe(false);
    expect(policy.allows('unsafe')).toBe(false);
  });

  it('safe-mutations grants inspect+edit but still refuses runtime/export/network/unsafe', () => {
    const policy = new CapabilityPolicy('safe-mutations');
    expect(policy.allows('inspect')).toBe(true);
    expect(policy.allows('edit')).toBe(true);
    expect(policy.allows('runtime')).toBe(false);
    expect(policy.allows('export')).toBe(false);
    expect(policy.allows('network')).toBe(false);
    expect(policy.allows('unsafe')).toBe(false);
  });

  it('runtime-control adds runtime capability without granting edit/export/network/unsafe', () => {
    const policy = new CapabilityPolicy('runtime-control');
    expect(policy.allows('inspect')).toBe(true);
    expect(policy.allows('edit')).toBe(true);
    expect(policy.allows('runtime')).toBe(true);
    expect(policy.allows('export')).toBe(false);
    expect(policy.allows('network')).toBe(false);
    expect(policy.allows('unsafe')).toBe(false);
  });

  it('unsafe-full is the only profile that grants the unsafe capability', () => {
    const unsafePolicy = new CapabilityPolicy('unsafe-full');
    expect(unsafePolicy.allows('unsafe')).toBe(true);
    expect(unsafePolicy.allows('network')).toBe(true);
    expect(unsafePolicy.allows('export')).toBe(true);

    for (const name of ['inspect-only', 'safe-mutations', 'runtime-control', 'legacy-full'] as const) {
      const policy = new CapabilityPolicy(name);
      expect(policy.allows('unsafe')).toBe(false);
    }

    // Only the strict profiles refuse network; legacy-full preserves the
    // pre-takeover permissive default so existing Wargrid sessions keep
    // working without a config change.
    expect(new CapabilityPolicy('inspect-only').allows('network')).toBe(false);
    expect(new CapabilityPolicy('safe-mutations').allows('network')).toBe(false);
    expect(new CapabilityPolicy('runtime-control').allows('network')).toBe(false);
    expect(new CapabilityPolicy('legacy-full').allows('network')).toBe(true);
  });

  it('legacy-full grants every capability except unsafe so existing clients keep working', () => {
    const policy = new CapabilityPolicy('legacy-full');
    const all: ToolCapability[] = ['inspect', 'edit', 'runtime', 'export', 'network'];
    for (const capability of all) {
      expect(policy.allows(capability)).toBe(true);
    }
    expect(policy.allows('unsafe')).toBe(false);
  });

  it('rejects unknown profile names at construction time', () => {
    expect(() => new CapabilityPolicy('evil-profile' as CapabilityProfileName))
      .toThrow(/unknown capability profile/i);
  });

  it('throws a structured CapabilityDeniedError that names the tool, profile, and remediation', () => {
    const policy = new CapabilityPolicy('inspect-only');
    let captured: unknown;
    try {
      policy.assertAllowed('write_script', 'unsafe');
    } catch (error) {
      captured = error;
    }
    expect(captured).toBeInstanceOf(CapabilityDeniedError);
    const denied = captured as CapabilityDeniedError;
    expect(denied.tool).toBe('write_script');
    expect(denied.required).toBe('unsafe');
    expect(denied.profile).toBe('inspect-only');
    expect(denied.message).toContain('unsafe');
    expect(denied.message).toContain('inspect-only');
    expect(denied.message).toMatch(/remediation/i);
    expect(denied.message).toMatch(/unsafe-full/);
  });

  it('denial message never echoes the unsafe tool name as executable guidance', () => {
    const policy = new CapabilityPolicy('safe-mutations');
    let captured: unknown;
    try {
      policy.assertAllowed('run_arbitrary_script', 'unsafe');
    } catch (error) {
      captured = error;
    }
    expect(captured).toBeInstanceOf(CapabilityDeniedError);
    const message = (captured as Error).message;
    expect(message).not.toContain('--allow');
    expect(message).not.toContain('--force');
    expect(message).not.toContain('sudo');
    expect(message).toContain('unsafe-full');
  });

  it('lists the currently granted capabilities for diagnostic surfaces', () => {
    const policy = new CapabilityPolicy('runtime-control');
    expect(policy.grantedCapabilities()).toEqual(
      expect.arrayContaining(['inspect', 'edit', 'runtime']),
    );
    expect(policy.grantedCapabilities()).not.toContain('unsafe');
  });
});

describe('parseCapabilityProfile', () => {
  it('accepts every known profile name (lowercased and trimmed)', () => {
    for (const name of KNOWN_CAPABILITY_PROFILES) {
      expect(parseCapabilityProfile(name)).toBe(name);
      expect(parseCapabilityProfile(name.toUpperCase())).toBe(name);
      expect(parseCapabilityProfile(`  ${name}  `)).toBe(name);
    }
  });

  it('rejects unknown or empty profile strings', () => {
    expect(() => parseCapabilityProfile('')).toThrow(/capability profile is required/i);
    expect(() => parseCapabilityProfile('   ')).toThrow(/capability profile is required/i);
    expect(() => parseCapabilityProfile('admin')).toThrow(/unknown capability profile/i);
  });
});

describe('resolveCapabilityPolicyFromEnvironment', () => {
  it('defaults to legacy-full when no environment override is supplied', () => {
    const policy = resolveCapabilityPolicyFromEnvironment({});
    expect(policy.profile).toBe('legacy-full');
  });

  it('honours GODOT_MCP_CAPABILITY_PROFILE override', () => {
    const policy = resolveCapabilityPolicyFromEnvironment({
      GODOT_MCP_CAPABILITY_PROFILE: 'runtime-control',
    });
    expect(policy.profile).toBe('runtime-control');
  });

  it('rejects unknown overrides loudly instead of silently falling back', () => {
    expect(() =>
      resolveCapabilityPolicyFromEnvironment({
        GODOT_MCP_CAPABILITY_PROFILE: 'superuser',
      }),
    ).toThrow(/unknown capability profile/i);
  });

  it('requires explicit unsafe opt-in even when the override field is empty', () => {
    expect(() =>
      resolveCapabilityPolicyFromEnvironment({
        GODOT_MCP_CAPABILITY_PROFILE: 'unsafe-full',
      }),
    ).not.toThrow();
    expect(() =>
      resolveCapabilityPolicyFromEnvironment({
        GODOT_MCP_CAPABILITY_PROFILE: '',
      }),
    ).not.toThrow();
  });
});