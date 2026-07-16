# Godot MCP takeover handoff

- Timestamp: 2026-07-16
- Worktree: `C:/Workspace/defkil/godot-mcp-wt-takeover`
- Branch: `refactor/senior-takeover`
- Remote boundary: `origin=https://github.com/Defkil/godot-mcp.git`; nothing pushed or published.
- Previous independently accepted snapshot: `70c10b6`
  (`docs: record request-limiter package in handoff and issue inventory`).
- Current local package: `fix: release request-limiter concurrency slot on the registry dispatch path`
  (NeuralWatt ACCEPT on `9bc4a2d`).
- Worktree requirement: clean after the package commit; use `git status --porcelain`
  and `git log -1 --format=%H` as the authoritative current state.
- Vitest: 28 files, 645 tests passed after this package.

## Current package — request-limiter at the MCP boundary (closed)

The accepted capability-policy review observed that rate, request-size, and
concurrency limits at the request boundary remained as a follow-up. This
package closes that gap by adding a bounded `RequestLimiter`
(`src/security/request-limiter.ts`) that gates every `CallToolRequest`
*before* the capability check, so a flood of oversized or burst requests
cannot bypass the more expensive profile lookup.

The limiter enforces three independent knobs:

- `GODOT_MCP_MAX_REQUEST_BYTES` (default 1 MiB): the serialised size of the
  argument object. Surfaces a typed `RequestTooLargeError` as `isError: true`.
- `GODOT_MCP_MAX_CONCURRENT_REQUESTS` (default 8): the maximum number of
  in-flight tool calls. Surfaces a typed `RateLimitExceededError` (`kind: 'concurrency'`)
  as `isError: true`. The slot is acquired before dispatch and released in a
  wrapping `try/finally` so every return path (registry dispatch,
  capability denial, legacy handler, unknown-tool `McpError`) closes it
  exactly once.
- `GODOT_MCP_RATE_PER_MINUTE` (default 120): a per-tool token-bucket capacity,
  refilled every 60 seconds. Surfaces `RateLimitExceededError` (`kind: 'rate'`).

Both error types carry structured `tool`, `size`/`limit`/`kind`, and a
`remediation` string that names the env var to raise; the dispatch handler
surfaces them via `createErrorResponse` and emits a `[SERVER] Request too
large` / `[SERVER] Rate limit exceeded` diagnostic on stderr.

Two coherent commits ship the package:

1. `d1d2296` — `fix: enforce request size, concurrency, and rate limits at tools/call`.
   Adds the limiter, the env parsing, the guard block, the legacy-switch
   try/finally, and 15 unit/wire-level tests.

2. `9bc4a2d` — `fix: release request-limiter concurrency slot on the registry dispatch path`.
   Re-architects the dispatch to wrap the registry/capability try block AND
   the legacy switch in a single outer `try/finally` so the slot closes on
   the registry-dispatch, capability-denial, and rethrown-error paths as
   well. Adds one focused regression test that exercises `list_project_files`
   (a registered tool, not a legacy switch tool) five times under
   `maxConcurrentRequests: 1`; the test would fail against `d1d2296` because
   the second call would trip the concurrency gate.

The package:

- leaves the five closed-list capability profiles, the 158-tool contract,
  every schema, every handler, the package identity, the path policy, and
  the runtime bridge unchanged;
- adds one new file (`src/security/request-limiter.ts`, 282 LOC) and one
  new test file (`tests/request-limiter.test.ts`, 16 tests);
- resolves environment overrides through
  `parseRequestLimiterFromEnvironment` and falls back to documented
  safe defaults when no env var is set;
- keeps `[Coding-Solo#97]` at `partial` in
  `docs/maintainers/issue-inventory.md`, because the boundedness claim is
  wire-level only — a real long-running flood test remains out of scope.

Source evidence:

- `src/security/capability-policy.ts` is unchanged.
- `src/server.ts:3460-3491` runs the three limiter calls in order:
  `assertRequestSize` first (cheapest), then `acquireConcurrency`, then
  `consumeToken`. Both typed errors are caught and returned as MCP
  `isError: true` envelopes with the remediation string. Limiter-error
  returns release the slot immediately (`if (releaseConcurrency) releaseConcurrency()`).
- `src/server.ts:3502-3851` is a single outer `try { ... } finally { releaseConcurrency?.(); }`
  that wraps the registry/capability block (3503-3522), the legacy
  `switch` (3523-3847), and the default-case `McpError` throw (3843-3847).
  Every return path closes the slot exactly once; the release closure is
  idempotent so a hypothetical double-call is safe.

## Verification on the package filesystem

- `npx vitest run tests/request-limiter.test.ts`: 1 file, 16 tests passed.
- `npm test`: 28 files, 645 tests passed (was 629 before this package).
- `npm run build`: passed; TypeScript compiled and scripts copied.
- `npm audit --audit-level=high`: 0 vulnerabilities.
- `git diff --check`: passed.
- Closed-list coverage with the full identifier alphabet (`[A-Za-z0-9_]+`):
  151 legacy `case` literals, 157 map keys, 0 unmapped cases. The
  digit-bearing `game_3d_effects` identifier remains in the closed list.

Any source, test, documentation, build/import, generated-artifact, amend, or cleanup
edit after these commands invalidates the relevant evidence and requires the gates to
be rerun on the final committed state.

## Review state

- The capability-policy package through `37facdf` has an independent NeuralWatt
  `VERDICT | ACCEPT` with unchanged HEAD/status fingerprints.
- The network-classification package `79b1d4d` also has an independent
  NeuralWatt `VERDICT | ACCEPT`; the transcript is preserved at
  `C:/Users/mail/AppData/Local/agent-runtime/state/neuralwatt-reports/godot-mcp-79b1d4d-review.txt`.
- The original request-limiter commit `d1d2296` received NeuralWatt REJECT
  on criterion #3: the try/finally wrapped only the legacy switch, leaking
  the concurrency slot on the registry-dispatch path. The full REJECT
  transcript is preserved at
  `C:/Users/mail/AppData/Local/agent-runtime/state/neuralwatt-godot-mcp-d1d2296.log`.
- The repair commit `9bc4a2d` re-architected the dispatch into a single
  outer try/finally covering both the registry/capability block and the
  legacy switch, and added a focused regression test (`list_project_files`
  five times under `maxConcurrentRequests: 1`). NeuralWatt independently
  reviewed `9bc4a2d` and returned `VERDICT | ACCEPT` with unchanged
  HEAD/status fingerprints; the transcript is preserved at
  `C:/Users/mail/AppData/Local/agent-runtime/state/neuralwatt-godot-mcp-9bc4a2d.log`.
- The reviewer confirmed every return path closes the slot exactly once,
  the registry-leak regression test would fail against the original commit,
  the package intent (typed errors, env vars, defaults, 60s refill) is
  intact, and the 158-tool / 5-profile / package-identity / path-policy /
  bridge-auth / MIT-attribution contract is unchanged.
- No Claude model was invoked.
- No release-candidate file or candidate-ready notification exists.

## Open inventory priorities

1. Real `.tscn` resource-property round-trip for immediate-upstream #8/#13.
2. Running-bridge `Vector2`/`Vector3`/`Color` tween regression (#11).
3. Physics-frame `game_wait` verification (#14).
4. Generic headless Godot test runner with GUT adapter (#29).
5. C# attachment in .NET projects (#114).
6. Texture import diagnostics (#103).
7. Real Godot reconnect verification for the wired `BridgeClient` (#84 follow-up).
8. Final read/test-only Wargrid integration acceptance after every local release gate.

## Next safe action

The request-limiter package is closed. Select one bounded package from
the open inventory; the current highest-priority candidate is the real
`.tscn` resource-property round-trip for immediate-upstream #8/#13. Begin
with repository evidence and a focused failing behavioral test; preserve
the five closed-list profiles, all 158 tool contracts, and the three
limiter knobs. Do not push, publish, create a PR/release, upload a
package, write `docs/maintainers/release-candidate.md`, or send the
candidate-ready notification.