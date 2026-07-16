# Godot MCP takeover handoff

- Timestamp: 2026-07-16
- Worktree: `C:/Workspace/defkil/godot-mcp-wt-takeover`
- Branch: `refactor/senior-takeover`
- Remote boundary: `origin=https://github.com/Defkil/godot-mcp.git`; nothing pushed or published.
- Previous independently accepted snapshot: `37facdf`
  (`docs: record NeuralWatt ACCEPT on network capability package`).
- Current local package: `fix: enforce request size, concurrency, and rate limits at tools/call`.
- Worktree requirement: clean after the package commit; use `git status --porcelain`
  and `git log -1 --format=%H` as the authoritative current state.
- Vitest: 28 files, 644 tests passed after this package.

## Current package — request-limiter at the MCP boundary

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
  wrapping `try/finally` so handler throws still close it exactly once.
- `GODOT_MCP_RATE_PER_MINUTE` (default 120): a per-tool token-bucket capacity,
  refilled every 60 seconds. Surfaces `RateLimitExceededError` (`kind: 'rate'`).

Both error types carry structured `tool`, `size`/`limit`/`kind`, and a
`remediation` string that names the env var to raise; the dispatch handler
surfaces them via `createErrorResponse` and emits a `[SERVER] Request too
large` / `[SERVER] Rate limit exceeded` diagnostic on stderr.

The package:

- leaves the five closed-list capability profiles, the 158-tool contract,
  every schema, every handler, the package identity, the path policy, and
  the runtime bridge unchanged;
- adds one new file (`src/security/request-limiter.ts`, 282 LOC) and one
  new test file (`tests/request-limiter.test.ts`, 15 tests);
- inserts the limiter guard block in `setRequestHandler(CallToolRequestSchema)`
  at `src/server.ts:3460-3487` and wraps the legacy `switch` in a
  `try/finally` (`src/server.ts:3508-3536`) so the concurrency slot is
  released on every return path;
- resolves environment overrides through
  `parseRequestLimiterFromEnvironment` and falls back to documented
  safe defaults when no env var is set;
- keeps `[Coding-Solo#97]` at `partial` in
  `docs/maintainers/issue-inventory.md`, because the boundedness claim is
  wire-level only — a real long-running flood test remains out of scope.

Source evidence:

- `src/security/capability-policy.ts` is unchanged.
- `src/server.ts:3448-3507` runs the three limiter calls in order:
  `assertRequestSize` first (cheapest), then `acquireConcurrency`, then
  `consumeToken`. Both typed errors are caught and returned as MCP
  `isError: true` envelopes with the remediation string.
- `src/server.ts:3508-3536` wraps the legacy `switch` in a `try/finally`
  that calls `releaseConcurrency?.()` on every return path, including
  unknown-tool throws.

## Verification on the package filesystem

- `npx vitest run tests/request-limiter.test.ts`: 1 file, 15 tests passed.
- `npm test`: 28 files, 644 tests passed (was 629 before this package).
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
  NeuralWatt `VERDICT | ACCEPT` with unchanged HEAD/status fingerprints; the
  full transcript is preserved at
  `C:/Users/mail/AppData/Local/agent-runtime/state/neuralwatt-reports/godot-mcp-79b1d4d-review.txt`.
- The request-limiter package is committed locally and still requires
  independent NeuralWatt review of its exact immutable commit before it is
  accepted. No review verdict exists yet for this package.
- An AGY package-selection attempt on this tick produced no deliverable
  because its read-only command permission was auto-denied. That is
  infrastructure/no-verdict, not product evidence and not a content rejection.
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

The request-limiter package is committed locally. Run independent NeuralWatt
review of the exact immutable commit; if accepted, select one bounded package
from the open inventory. Begin with repository evidence and a focused failing
behavioral test; preserve the five closed-list profiles, all 158 tool
contracts, and the three limiter knobs. Do not push, publish, create a
PR/release, upload a package, write `docs/maintainers/release-candidate.md`,
or send the candidate-ready notification.
