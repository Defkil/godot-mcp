# Godot MCP takeover handoff

- Timestamp: 2026-07-16
- Worktree: `C:/Workspace/defkil/godot-mcp-wt-takeover`
- Branch: `refactor/senior-takeover`
- Remote: `origin=https://github.com/Defkil/godot-mcp.git`; nothing pushed or published.
- Last commit: `5565d6e` (`refactor: migrate headless scene tools to the typed registry`).
- Worktree: dirty with the capability-policy enforcement package; pending fix to `manage_autoloads` capability classification, wire-level gate test, README + issue-inventory update, and commit.

## Package in progress (this tick)

Closed-list capability profiles gate every `CallToolRequest`:

- `src/security/capability-policy.ts` — `CapabilityPolicy`, `CapabilityDeniedError`, `parseCapabilityProfile`, `resolveCapabilityPolicyFromEnvironment` (default `legacy-full`, opt-in `unsafe-full`).
- `src/security/legacy-capabilities.ts` — `LEGACY_TOOL_CAPABILITIES` map covering every legacy `case` name plus `capabilityForLegacyTool(name)`. Repairs the `manage_autoloads` gap that previously let it bypass strict profiles.
- `src/server/tool-registry.ts` — registry now keeps a `setCapabilityCheck` gate; `dispatch()` consults it before invoking the registered handler.
- `src/server.ts` — constructor installs a gate that calls `CapabilityPolicy.assertAllowed`; `CallToolRequestSchema` consults the registry dispatch first, then `capabilityForLegacyTool(name)` for the legacy case path. `CapabilityDeniedError` is caught locally and surfaced as a structured MCP `isError: true` envelope with remediation.
- `tests/capability-policy.test.ts` — 13 unit tests covering profiles, env resolution, structured error and message hygiene.
- `tests/capability-gate.test.ts` — 6 wire-level MCP `tools/call` tests: `inspect-only` reaches `get_godot_version`, `inspect-only` blocks `manage_autoloads`, every non-`unsafe-full` profile blocks `game_eval`, `unsafe-full` reaches `attach_script`, and `inspect-only` blocks `modify_project_settings` through the registry path.
- `README.md` — `GODOT_MCP_CAPABILITY_PROFILE` documented in the environment table plus a dedicated *Capability profiles* table.
- `docs/maintainers/issue-inventory.md` — `#97 policy enforcement` row updated to reflect capability-profile coverage (rate/size limits remain as follow-up).

## Verification

- `npx tsc --noEmit`: clean.
- `npm run build`: passed; TypeScript compiled and Godot scripts copied to `build/scripts`.
- `npx vitest run`: 26 files, 596 tests passed (was 574 at scene-tool commit; +22 from this package: 13 policy unit + 6 gate wire-level + 3 in the registry tests that consume the gate).
- `npm audit --audit-level=high`: 0 vulnerabilities.
- `git diff --check`: clean.
- `npm pack --dry-run`: 29 files, ~131 KB; `build/security/capability-policy.js` and `build/security/legacy-capabilities.js` are present.
- Godot 4.7 (`Godot_v4.7-stable_win64.exe`) `--headless --editor --quit`: clean (no new `.gd` files, but the editor re-imports the project).

## Next safe action

Commit the capability-policy enforcement as one focused package
(`feat: enforce capability profiles at the tools/call boundary`) and update the
dirty-state line above to `Worktree: clean`. Then return to the remaining open
rows in `docs/maintainers/issue-inventory.md`. Candidate follow-ups:

- Rate / size / concurrency limits at the gate (the second half of `#97`).
- Real `.tscn` round-trip on a real Godot fixture (closes the remaining
  `tugcantopaloglu#8` and `#13` evidence).
- Tween `Vector2` / `Vector3` / `Color` regression on a running bridge
  (`tugcantopaloglu#11`).
- `game_wait` physics-frame verification (`tugcantopaloglu#14`).
