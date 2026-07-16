# Godot MCP takeover handoff

- Timestamp: 2026-07-16
- Worktree: `C:/Workspace/defkil/godot-mcp-wt-takeover`
- Branch: `refactor/senior-takeover`
- Remote: `origin=https://github.com/Defkil/godot-mcp.git`; nothing pushed or published.
- Last commit: `973b627` (`feat: expose bounded classdb_inspect tool`).
- Worktree: clean.
- Vitest: 27 files, 606 tests passing.

## Packages landed since the last NeuralWatt review (commit 5565d6e)

Three unreviewed commits are currently ahead of the last independent read-only review
(`godot-mcp-5565d6e-review.txt`, ACCEPT):

1. `24651c8 feat: enforce capability profiles at the tools/call boundary`
   - `src/security/capability-policy.ts` (new, 117 lines) — closed-list
     `CapabilityProfileName` (`inspect-only`, `safe-mutations`,
     `runtime-control`, `unsafe-full`, `legacy-full`), `CapabilityDeniedError`,
     and a `CapabilityPolicy` class that wraps `LEGACY_TOOL_CAPABILITIES`.
   - `src/security/legacy-capabilities.ts` (new, 198 lines) — exhaustive
     `case`-literal → capability map so every legacy dispatch path is
     classified under the same closed list as the registered tools.
   - `src/server.ts` — installs the policy at the `CallToolRequest` boundary
     (both the registry dispatch path and the legacy `case` dispatch path);
     preserves the `legacy-full` default so existing clients keep working
     without a config change.
   - `src/server/tool-registry.ts` — registers `classdb_inspect` capability
     alongside the existing migrated tools.
   - `tests/capability-gate.test.ts` (new, 194 lines) — wire-level tests
     covering registry dispatch, legacy dispatch, and the `unsafe-full`
     opt-in.
   - `tests/capability-policy.test.ts` (new, 176 lines) — focused unit
     coverage for the policy class.
   - `tests/schema-parity.test.ts` — extended for the `classdb_inspect`
     addition (see below).
   - `README.md`, `docs/maintainers/issue-inventory.md` — issue-inventory row
     `[Coding-Solo#97] policy enforcement` promoted from `open` to `partial`
     (rate/size/concurrency limits remain).

2. `db6450b docs: record capability-policy package as shipped in handoff`
   - Documentation-only commit that rewrote `session-handoff.md` to record
     the capability-policy package as shipped. **The handoff at this commit
     was already one step stale** — it claimed the next tick was a
     follow-up commit, but the classdb_inspect package was already in
     flight. This has been corrected in `973b627` (see next item).

3. `973b627 feat: expose bounded classdb_inspect tool`
   - `src/tools/script/classdb-inspect.ts` (new, 153 lines) — focused tool
     module: `validateClassdbInspectInput` rejects path-shaped and
     extension-bearing `className` values; `classdbInspect` resolves the
     project through `PathPolicy.assertProject`, forwards one headless
     `classdb_inspect` operation, and surfaces typed `status: error`
     postcondition failures as a structured MCP error envelope.
   - `src/server.ts` — registers `classdb_inspect` with capability
     `inspect`, `inputSchema` requiring `projectPath` + `className`; thin
     wrapper delegates to the focused module through
     `classdbInspectContext()`, which forwards a `ClassdbInspectRunner`
     wrapping the shared `executeOperation`.
   - `src/scripts/godot_operations.gd` — new `classdb_inspect` operation:
     walks the parent chain (bounded at 16) and reports methods,
     properties, signals, enums and integer constants. Missing/unknown
     classes record a typed `_postcondition_failure`.
   - `tests/classdb-inspect.test.ts` (new, 201 lines, 10 tests) — input
     validation, focused runner, renderer, and four wire-level MCP
     `tools/list` / `tools/call` tests.
   - `tests/schema-parity.test.ts` — `157` → `158` plus explicit checks
     that `classdb_inspect` is advertised exactly once and registered
     with capability `inspect`.
   - `README.md`, `docs/maintainers/issue-inventory.md` — `[Coding-Solo#98]`
     promoted from `open` to `verified`.

## Verification (cumulative on 973b627)

- `npx tsc --noEmit`: clean.
- `npm run build`: passed.
- `npx vitest run`: 27 files, 606 tests passed.
- `npx vitest run tests/classdb-inspect.test.ts tests/schema-parity.test.ts`: 13 tests passed.
- `npx vitest run tests/capability-gate.test.ts tests/capability-policy.test.ts`: focused gate tests pass.
- `npm audit --audit-level=high`: 0 vulnerabilities.
- `git diff --check HEAD~3..HEAD`: clean (only LF→CRLF warnings on Windows-rescued edits, as expected).
- `npm pack --dry-run`: 30 files, 133.5 kB packed; `build/tools/script/classdb-inspect.js` is included.
- `comm -23 <(grep -oP "case '\\K[a-z_]+(?=')" src/server.ts | sort -u) <(awk '/^export const LEGACY_TOOL_CAPABILITIES/,/^};/' src/security/legacy-capabilities.ts | grep -oP "^  \\K[a-z_]+(?=:)" | sort -u)` returns 0 lines — every legacy `case` literal remains mapped after the registry expansion.

## Open inventory rows still requiring work

The full inventory is in `docs/maintainers/issue-inventory.md`. Highest-priority open / partial rows:

1. **Rate / size / concurrency limits** at the capability gate (`#97` second half).
2. **Real `.tscn` round-trip on a real Godot fixture** (closes remaining evidence for `tugcantopaloglu#8` and `#13`).
3. **Tween `Vector2` / `Vector3` / `Color` regression on a running bridge** (`tugcantopaloglu#11`).
4. **`game_wait` physics-frame verification** (`tugcantopaloglu#14`).
5. **Generic headless Godot test runner with GUT adapter** (`Coding-Solo#29`).
6. **C# attachment in .NET projects** (`Coding-Solo#114`).
7. **Texture import diagnostics** (`Coding-Solo#103`).
8. **Real Godot reconnect verification for wired `BridgeClient`** (`Coding-Solo#84` follow-up).
9. **Real Wargrid integration acceptance** (read/test-only at final acceptance).

## Next safe action

**NeuralWatt review of `5565d6e..48b921f` returned VERDICT | REJECT.**
The full transcript is saved at
`C:/Users/mail/AppData/Local/agent-runtime/state/godot-mcp-reviews/48b921f-REJECT.txt`.
The blocking finding is a security regression in
`src/security/legacy-capabilities.ts`: six state-mutating tools
(`manage_plugins`, `manage_translations`, `manage_scene_signals`,
`manage_layers`, `manage_scene_structure`, `manage_input_map`) are
classified `inspect` despite writing to `project.godot` or scene files,
breaking the read-only contract of the `inspect-only` profile.
`manage_plugins` enables arbitrary plugin code on the next editor load —
the same risk class as `[Coding-Solo#95]`.

The reviewer's HEAD and worktree fingerprint verification shows
HEAD_UNCHANGED=yes, STATUS_UNCHANGED=yes, so the review did not mutate
the repository.

A focused repair prompt has been queued at
`C:/Users/mail/AppData/Local/agent-runtime/state/godot-mcp-reviews/48b921f-REPAIR.md`
and dispatched to AGY (`godot-mcp-repair-48b921f.md`). The repair must:

1. Reclassify `manage_plugins` and `manage_translations` to `unsafe`.
2. Reclassify `manage_scene_signals`, `manage_layers`, `manage_scene_structure`,
   `manage_input_map` to `edit`.
3. Add wire-level tests proving `inspect-only` denies all six.
4. Update stale `157` references in `issue-inventory.md:32` and
   `takeover-architecture.md:21` to `158`.
5. Pass all canonical gates; commit on top of `48b921f` as one focused
   `fix:` commit; re-trigger NeuralWatt review of the corrected range.

Do not advance to any other package until the REJECT is repaired and
re-reviewed.