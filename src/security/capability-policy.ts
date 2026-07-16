import type { ToolCapability } from '../server/tool-registry.js';

/**
 * Closed list of capability profiles that the Godot MCP server recognises.
 *
 * Each profile maps to a fixed, audited set of capabilities. Adding a new
 * profile requires editing this file and supplying regression tests that
 * document its scope; there is no runtime way to invent capabilities.
 */
export type CapabilityProfileName =
  | 'inspect-only'
  | 'safe-mutations'
  | 'runtime-control'
  | 'unsafe-full'
  | 'legacy-full';

export const KNOWN_CAPABILITY_PROFILES: readonly CapabilityProfileName[] = [
  'inspect-only',
  'safe-mutations',
  'runtime-control',
  'unsafe-full',
  'legacy-full',
] as const;

const PROFILE_CAPABILITIES: Readonly<Record<CapabilityProfileName, readonly ToolCapability[]>> = {
  'inspect-only': ['inspect'],
  'safe-mutations': ['inspect', 'edit'],
  'runtime-control': ['inspect', 'edit', 'runtime'],
  'unsafe-full': ['inspect', 'edit', 'runtime', 'export', 'network', 'unsafe'],
  'legacy-full': ['inspect', 'edit', 'runtime', 'export', 'network'],
};

export class CapabilityDeniedError extends Error {
  public readonly tool: string;
  public readonly required: ToolCapability;
  public readonly profile: CapabilityProfileName;
  public readonly remediation: string;

  constructor(tool: string, required: ToolCapability, profile: CapabilityProfileName) {
    const remediation =
      `Capability denied: tool '${tool}' requires capability '${required}' but the active profile '${profile}' does not grant it. ` +
      `Remediation: set GODOT_MCP_CAPABILITY_PROFILE to a profile that includes '${required}', ` +
      `or run with 'unsafe-full' if the tool is intentionally unsafe.`;
    super(remediation);
    this.name = 'CapabilityDeniedError';
    this.tool = tool;
    this.required = required;
    this.profile = profile;
    this.remediation = remediation;
  }
}

export function parseCapabilityProfile(raw: string): CapabilityProfileName {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('capability profile is required: pass GODOT_MCP_CAPABILITY_PROFILE explicitly.');
  }
  const lowered = trimmed.toLowerCase();
  const match = KNOWN_CAPABILITY_PROFILES.find((name) => name === lowered);
  if (!match) {
    throw new Error(
      `unknown capability profile '${raw}'. Allowed profiles: ${KNOWN_CAPABILITY_PROFILES.join(', ')}.`,
    );
  }
  return match;
}

export class CapabilityPolicy {
  public readonly profile: CapabilityProfileName;
  private readonly capabilities: ReadonlySet<ToolCapability>;

  constructor(profile: CapabilityProfileName) {
    if (!KNOWN_CAPABILITY_PROFILES.includes(profile)) {
      throw new Error(
        `unknown capability profile '${profile}'. Allowed profiles: ${KNOWN_CAPABILITY_PROFILES.join(', ')}.`,
      );
    }
    this.profile = profile;
    this.capabilities = new Set(PROFILE_CAPABILITIES[profile]);
  }

  allows(capability: ToolCapability): boolean {
    return this.capabilities.has(capability);
  }

  assertAllowed(tool: string, required: ToolCapability): void {
    if (!this.capabilities.has(required)) {
      throw new CapabilityDeniedError(tool, required, this.profile);
    }
  }

  grantedCapabilities(): ToolCapability[] {
    return [...PROFILE_CAPABILITIES[this.profile]];
  }
}

export function resolveCapabilityPolicyFromEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): CapabilityPolicy {
  const raw = env.GODOT_MCP_CAPABILITY_PROFILE;
  if (raw === undefined || raw === '') {
    return new CapabilityPolicy('legacy-full');
  }
  return new CapabilityPolicy(parseCapabilityProfile(raw));
}

export function describeCapabilityPolicy(policy: CapabilityPolicy): {
  profile: CapabilityProfileName;
  capabilities: ToolCapability[];
  unsafe: boolean;
} {
  return {
    profile: policy.profile,
    capabilities: policy.grantedCapabilities(),
    unsafe: policy.allows('unsafe'),
  };
}