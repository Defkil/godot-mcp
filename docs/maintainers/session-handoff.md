# Godot MCP takeover handoff

- Timestamp: 2026-07-16
- Worktree: `C:/Workspace/defkil/godot-mcp-wt-takeover`
- Branch: `refactor/senior-takeover`
- Commit subject: `refactor: wire BridgeClient into GodotServer transport`
- Remote: `origin=https://github.com/Defkil/godot-mcp.git`; nothing pushed or published.
- Worktree: clean after commit.

## Package completed

`BridgeClient` (extracted in the previous package, commit `71e8a8c`) is now the
authoritative runtime bridge transport for `GodotServer`. The inline socket,
frame-buffer, request-correlation and versioned handshake logic has been
removed from `src/server.ts`. `connectToGame` constructs a per-session
`BridgeClient` with the per-process ephemeral port and token and delegates the
handshake; `sendGameCommand` delegates correlated request/response; and
`disconnectFromGame` performs idempotent teardown and nulls the cached client
reference.

The server configures `retryOnAuthenticationFailure: false` so a wrong token
fails on the first attempt instead of waiting through the historical 5 s retry
window against a bridge that already proved it would not accept the
credentials. `BridgeConnectionError` (and its `BridgeAuthenticationError` /
`BridgeFrameError` subclasses) propagate from `sendGameCommand` while
command-level errors from the bridge continue to surface in `response.error`.

## Verification

- `npm test`: 22 files, 546 tests passed (was 541; +5 new tests).
- `npm run build`: passed; TypeScript compiled and Godot scripts copied to `build/scripts`.
- `npm audit --audit-level=high`: 0 vulnerabilities.
- `git diff --check`: clean for the published range.
- `tests/server-bridge-wiring.test.ts`: 4 contract tests cover the wired path
  against a scripted real TCP server (handshake success, typed authentication
  rejection, command correlation, idempotent disconnect).
- `tests/bridge-client.test.ts`: 11 contract tests pass, including the new
  focused pin for `retryOnAuthenticationFailure: false`.
- `tests/runtime-authentication.test.ts`: existing legacy-surface coverage
  continues to exercise the wired path against a real scripted TCP server.

## Independent evidence

- AGY guarded read-only selection: recommended the BridgeClient wiring as the
  next bounded package (slice 3 follow-up). No file mutations; HEAD/status
  unchanged before implementation.
- NeuralWatt guarded review of committed `bfa1817`: `VERDICT | ACCEPT`.
  Non-blocking observations addressed in the follow-up docs commit: README
  source-layout table updated to list `src/server.ts` as the implementation
  entry point, README "All 157 Tools" tables now cover
  `manage_docker_export` / `manage_ci_pipeline` / `game_terrain` / `game_video`,
  and this handoff was rewritten to describe the wiring completion.

## Next safe action

Return to the remaining open issue-inventory rows after the bridge wiring is
accepted:

- Capability policy enforcement with profiles, rate/size limits and explicit
  unsafe-tool opt-in (#97).
- Real Godot runtime reconnect verification for the wired `BridgeClient`
  (#84 follow-up).
- Generic headless Godot test runner with GUT adapter (#29).
- C# attachment in .NET projects (#114).
- Bounded read-only ClassDB inspection (#98).
- Texture import diagnostics (#103).
- Editor-launch truth (#23, #106).
- Release automation (#61).

## Known limits

The complete release candidate is not yet ready: real Wargrid integration
acceptance has not been run, and the open inventory rows above remain. The
GDScript token compare is non-constant-time; the bridge binds only to
`127.0.0.1` with a 120 s `_busy` safety reset, so this is negligible. The
package identity remains `@tugcantopaloglu/godot-mcp@3.1.0` by deliberate
release decision (per `docs/maintainers/takeover-baseline.md`). No candidate
notification was sent.
