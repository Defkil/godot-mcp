# Godot MCP takeover handoff

- Timestamp: 2026-07-16
- Worktree: `C:/Workspace/defkil/godot-mcp-wt-takeover`
- Branch: `refactor/senior-takeover`
- Remote boundary: `origin=https://github.com/Defkil/godot-mcp.git`; nothing pushed or published.
- Previous independently accepted snapshot: `a5bd1fc`
  (`docs: record NeuralWatt ACCEPT on capability-policy package`).
- Current local package: `fix: gate network tools behind network capability`.
- Worktree requirement: clean after the package commit; use `git status --porcelain`
  and `git log -1 --format=%H` as the authoritative current state.
- Vitest: 27 files, 629 tests passed after this package.

## Current package — network capability classification

The accepted capability-policy review recorded one non-blocking security observation:
`game_http_request`, `game_websocket`, `game_multiplayer`, and `game_rpc` were mapped
to `runtime` even though the policy has a separate `network` capability and the
`runtime-control` profile deliberately does not grant it. That classification let a
runtime-control client reach outbound HTTP, WebSocket, ENet, and RPC handlers.

The bounded repair:

- reclassifies exactly those four tools from `runtime` to `network` in
  `src/security/legacy-capabilities.ts`;
- leaves the five profile definitions, 158 tool names, schemas, handlers, package
  identity, path policy, and runtime bridge unchanged;
- adds ten tests in `tests/capability-gate.test.ts`:
  - one direct map assertion covering all four tools;
  - four wire-level `runtime-control` denials whose structured MCP error names the
    tool, `network` capability, profile, and remediation;
  - four wire-level `legacy-full` admissions past the capability gate;
  - one `safe-mutations` denial test covering all four tools;
- uses invalid/minimal arguments so admitted handlers fail locally because no Godot
  process is active; the tests perform no real network I/O;
- keeps `[Coding-Solo#97]` at `partial` in
  `docs/maintainers/issue-inventory.md`, because rate, size, and concurrency limits
  remain separate follow-up work.

Source evidence:

- `src/security/capability-policy.ts` defines `network`; `runtime-control` omits it,
  while `legacy-full` and `unsafe-full` grant it.
- `src/server.ts` advertises and dispatches all four networking tools.
- `src/scripts/mcp_interaction_server.gd` implements their HTTP/WebSocket/ENet/RPC
  operations in the running game.
- The original independent observation is preserved in
  `C:/Users/mail/AppData/Local/agent-runtime/state/godot-mcp-reviews/48b921f-REJECT.txt`.

## Verification on the package filesystem

- `npx vitest run tests/capability-gate.test.ts tests/capability-policy.test.ts`:
  2 files, 45 tests passed.
- `npm test`: 27 files, 629 tests passed.
- `npm run build`: passed; TypeScript compiled and scripts copied.
- `npm audit --audit-level=high`: 0 vulnerabilities.
- `git diff --check`: passed.
- Closed-list coverage with the full identifier alphabet (`[A-Za-z0-9_]+`):
  151 legacy `case` literals, 157 map keys, 0 unmapped cases. The digit-bearing
  `game_3d_effects` identifier is included correctly.

Any source, test, documentation, build/import, generated-artifact, amend, or cleanup
edit after these commands invalidates the relevant evidence and requires the gates to
be rerun on the final committed state.

## Review state

- The capability-policy package through `a5bd1fc` has an independent NeuralWatt
  `VERDICT | ACCEPT` with unchanged HEAD/status fingerprints.
- NeuralWatt independently reviewed the exact immutable network-classification
  commit `79b1d4d855f38491258ab18c7a54c6aa2a86926b` and returned
  `VERDICT | ACCEPT`. The guarded runner verified unchanged pre/post HEAD, branch,
  index tree, and empty status. The full transcript is preserved at
  `C:/Users/mail/AppData/Local/agent-runtime/state/neuralwatt-reports/godot-mcp-79b1d4d-review.txt`.
- The reviewer confirmed the four-tool `network` map, wire-level denials/admissions,
  digit-safe closed-list coverage, the 158-tool contract, unchanged profile/schema/
  handler surfaces, issue-inventory truthfulness, and no path/auth/protocol/lifecycle/
  identity/attribution regression.
- An AGY package-selection attempt on this tick produced no deliverable because its
  read-only command permission was auto-denied. That is infrastructure/no-verdict,
  not product evidence and not a content rejection.
- No Claude model was invoked.
- No release-candidate file or candidate-ready notification exists.

## Open inventory priorities

1. Rate, request-size, and concurrency limits at the request boundary
   (`[Coding-Solo#97]` second half).
2. Real `.tscn` resource-property round-trip for immediate-upstream #8/#13.
3. Running-bridge `Vector2`/`Vector3`/`Color` tween regression (#11).
4. Physics-frame `game_wait` verification (#14).
5. Generic headless Godot test runner with GUT adapter (#29).
6. C# attachment in .NET projects (#114).
7. Texture import diagnostics (#103).
8. Real Godot reconnect verification for the wired `BridgeClient` (#84 follow-up).
9. Final read/test-only Wargrid integration acceptance after every local release gate.

## Next safe action

The network-classification package is accepted and closed. Select one bounded package
from the open inventory; the current highest-priority candidate is the rate/request-
size/concurrency half of `[Coding-Solo#97]`. Begin with repository evidence and a
focused failing behavioral test; preserve the five closed-list profiles and all 158
tool contracts. Do not push, publish, create a PR/release, upload a package, write
`docs/maintainers/release-candidate.md`, or send the candidate-ready notification.
