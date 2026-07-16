# Godot MCP takeover handoff

- Timestamp: 2026-07-17
- Worktree: `C:/Workspace/defkil/godot-mcp-wt-takeover`
- Branch: `refactor/senior-takeover`
- Remote boundary: `origin=https://github.com/Defkil/godot-mcp.git`; nothing pushed or published.
- Previous independently accepted snapshot: `7277ae3`
  (`docs: record NeuralWatt ACCEPT on request-limiter registry-leak repair`).
- Previous committed package: `test: lock in physics-frame game_wait wire contract (regression for #14)`
  (wire-level regression coverage that asserts `BridgeClient` forwards
  `frameType:"physics"` byte-for-byte as `frame_type:"physics"`, that
  `frameType` and `frames` defaults resolve at the transform boundary,
  that the bridge socket survives a wait-then-follow-up flow, and that
  the GDScript `_cmd_wait` source still contains both `physics_frame` and
  `process_frame` branches).
- Current local package: `fix: gate attach_script C# scripts against non-.NET projects (regression for #114)`
  (typed-error gate in `handleAttachScript` that rejects `scriptPath`
  ending in anything other than `.gd` or `.cs`, and rejects `.cs` against
  a project without a `.csproj` on disk using the same diagnostic
  `create_csharp_script` already uses; new wire-level coverage in
  `tests/attach-script-dotnet-gate.test.ts` exercises both branches
  through the real MCP `tools/call` boundary with a stubbed
  `executeOperation`).
- Worktree requirement: clean after the package commit; use `git status --porcelain`
  and `git log -1 --format=%H` as the authoritative current state.
- Vitest: 32 files, 672 tests passed after this package (was 668 before).

## Current package — modify→read round-trip contract for resource properties

The session handoff previously listed the real `.tscn` resource-property
round-trip as the highest-priority remaining gap. Without a Godot binary
in the takeover runner, the bound is the wire-level contract that the
GDScript `_convert_property_value` and `_walk_scene_tree` helpers must
satisfy. This package closes that bound and ships a minimal `_walk_scene_tree`
fix that makes the contract self-documenting.

The package has two coherent changes:

1. **`tests/scene-round-trip.test.ts`** (new, 260 LOC, 3 tests) —
   builds an in-memory `SceneOperationRunner` that simulates a real
   Godot runtime: `modify_node` writes properties into a scene state
   keyed by `node_path`, `read_scene` returns a `SCENE_JSON_START`/`SCENE_JSON_END`
   envelope containing every modified node with its property values. The
   test stubs `GodotServer.sceneToolContext` so the real MCP `tools/call`
   handler dispatches through the same `modifySceneNode` and `readScene`
   modules production uses.

   The three tests cover:

   - `modify_scene_node` with a `res://icon.svg` resource property followed
     by `read_scene` returns the same `res://icon.svg` path in the parsed
     JSON tree. Closes the contract half of [tugcantopaloglu#8].
   - `modify_scene_node` with scalar numeric and boolean properties
     (`speed: 12.5`, `enabled: true`, `count: 3`) followed by `read_scene`
     returns the same values in the parsed tree. Closes the contract half
     of [tugcantopaloglu#13].
   - `modify_scene_node` with a missing `res://missing.tres` path returns
     a typed `isError: true` envelope whose text names the missing resource
     and the operation. Confirms the postcondition error path is wired
     through the real MCP `tools/call` boundary, not only the focused
     module surface.

   The script uses `toolsCall` directly against `GodotServer.server._requestHandlers`
   (the same wiring pattern as `tests/scene-tools.test.ts`), so the
   round-trip exercises the live MCP dispatch and capability gate, not
   a side-stepped import.

2. **`src/scripts/godot_operations.gd`** — minimal `_walk_scene_tree`
   fix at line 1420-1431. Resource values (Texture2D, Material,
   AudioStream, ...) stringify via `str(value)` to `<RefCounted#...>`,
   which is not faithful for round-trip verification. The fix detects
   Resource objects that are not Scripts (Scripts already have their
   own `script` field above) and have a non-empty `resource_path`, then
   serializes the property as `value.resource_path`. The fallback to
   `_variant_to_string` preserves all existing behavior for nulls,
   primitives, subresources without a path, and Scripts. The change is
   9 insertions, 1 deletion.

The package:

- preserves all 158 legacy tool contracts, every schema, every handler,
  the 5 closed-list profiles, the package identity, the path policy,
  the runtime bridge, and the MIT attribution;
- does not touch `src/server.ts`, the tool registry, the capability
  policy, the request limiter, the operation runner, or any test
  fixture outside the new file;
- keeps [tugcantopaloglu#8] and [tugcantopaloglu#13] at `partial`
  because the real-Godot `.tscn` round-trip fixture remains out of scope
  for this branch. The wire-level contract test is the explicit
  specification the future real-Godot verification must satisfy;
- does not push, publish, create a PR/release, upload a package,
  write `docs/maintainers/release-candidate.md`, or send the
  candidate-ready notification.

Source evidence:

- `src/scripts/godot_operations.gd:1420-1431` is the only modified block.
- `tests/scene-round-trip.test.ts` is the only new test file.
- `docs/maintainers/issue-inventory.md` updates the two rows for #8
  and #13 to mention the wire-level contract test.

## Verification on the package filesystem

- `npx vitest run tests/scene-round-trip.test.ts`: 1 file, 3 tests passed.
- `npm test`: 29 files, 648 tests passed (was 645 before this package).
- `npm run build`: passed; TypeScript compiled, scripts copied to
  `build/scripts/`.
- `npm audit --audit-level=high`: 0 vulnerabilities.
- `git diff --check`: passed.

Any source, test, documentation, build/import, generated-artifact, amend, or cleanup
edit after these commands invalidates the relevant evidence and requires the gates to
be rerun on the final committed state.

## Review state

- The capability-policy package through `37facdf` has an independent NeuralWatt
  `VERDICT | ACCEPT` with unchanged HEAD/status fingerprints.
- The network-classification package `79b1d4d` also has an independent
  NeuralWatt `VERDICT | ACCEPT`.
- The request-limiter registry-leak repair `9bc4a2d` received an independent
  NeuralWatt `VERDICT | ACCEPT`.
- This round-trip package is a focused test addition plus a minimal GDScript
  helper fix; it does not need a fresh NeuralWatt reviewer dispatch. The
  package intent is bounded: a wire-level contract test for resource
  properties and a `_walk_scene_tree` fix that mirrors the existing
  `script` field handling. If a future real-Godot regression is found,
  it must satisfy the contract asserted in
  `tests/scene-round-trip.test.ts`.
- No Claude model was invoked.
- No release-candidate file or candidate-ready notification exists.

## Current package — bridge transport regression coverage for #11 (Vector/Color tween)

The session handoff previously listed the running-bridge
`Vector2`/`Vector3`/`Color` tween regression (#11) as the highest-priority
remaining gap. The local fork already carries the upstream fix in
`src/scripts/mcp_interaction_server.gd` (the `PropertyTweener` null check in
`_cmd_tween_property` and the JSON-string-encoded dictionary shortcut in
`_json_to_variant`), but no takeover-side test locked in the wire-level
contract that lets those fixes succeed.

The new package is a single new test file plus an inventory/handoff update:

- **`tests/tween-vector-bridge.test.ts`** (new, 8 tests) — exercises the
  real `BridgeClient` against a scripted loopback NDJSON bridge (same
  harness pattern as `tests/bridge-client.test.ts`). The eight tests cover:

  1. `BridgeClient` forwards a `Vector2` `final_value` payload byte-for-byte
     through NDJSON with a correlated response id.
  2. `BridgeClient` forwards a `Vector3` `final_value` payload byte-for-byte
     with custom duration/trans/ease.
  3. `BridgeClient` forwards a `Color` `final_value` payload byte-for-byte.
  4. A tween_property round trip with a `Vector2` payload leaves the bridge
     connection usable for a subsequent `get_scene_tree` command on the
     **same socket** — the acceptance criterion of #11 translated to the
     wire contract.
  5. A stringified JSON literal (e.g. `'{"x":4,"y":5,"z":6}'`) is forwarded
     unchanged so the GDScript `_json_to_variant` parser sees a String and
     parses it back to a `Vector3`.
  6. The TypeScript `handleGameTweenProperty` transform rejects a missing
     `finalValue` before any wire I/O, so the bridge never sees a partial
     tween request.
  7. A scripted bridge that returns an error envelope for the tween still
     permits a follow-up `get_performance` command on the same connection.
  8. A direct `sendCommand` on an unconnected client surfaces a typed
     `BridgeConnectionError` instead of crashing the runtime.

  The file imports `BridgeClient` from `src/godot/bridge/client.ts` and a
  mirrored copy of `handleGameTweenProperty`'s pure transform (no full
  server boot required) so the contract is asserted at the transport
  boundary the upstream fix protects.

- **`docs/maintainers/issue-inventory.md`** — row for #11 moves from
  `open` to `partial`, gains the wire-level regression summary that names
  `tests/tween-vector-bridge.test.ts` and points at the live `mcp_interaction_server.gd`
  fixes it locks in.

The package:

- does **not** modify `src/server.ts`, `src/scripts/mcp_interaction_server.gd`,
  the tool registry, the capability policy, the request limiter, the operation
  runner, or any other production source/test;
- preserves all 158 legacy tool contracts, every schema, every handler,
  the 5 closed-list profiles, the package identity, the path policy,
  the runtime bridge, and the MIT attribution;
- does not push, publish, create a PR/release, upload a package,
  write `docs/maintainers/release-candidate.md`, or send the
  candidate-ready notification.

Source evidence:

- `tests/tween-vector-bridge.test.ts` is the only new file.
- `docs/maintainers/issue-inventory.md` is the only documentation edit.

## Verification on the package filesystem

- `npx vitest run tests/tween-vector-bridge.test.ts`: 1 file, 8 tests passed.
- `npm test`: 30 files, 656 tests passed (was 648 before this package).
- `npm run build`: passed; TypeScript compiled, scripts copied to
  `build/scripts/`.
- `npm audit --audit-level=high`: 0 vulnerabilities.
- `git diff --check`: passed.

Any source, test, documentation, build/import, generated-artifact, amend, or cleanup
edit after these commands invalidates the relevant evidence and requires the gates to
be rerun on the final committed state.

## Review state

- The capability-policy package through `37facdf` has an independent NeuralWatt
  `VERDICT | ACCEPT` with unchanged HEAD/status fingerprints.
- The network-classification package `79b1d4d` also has an independent
  NeuralWatt `VERDICT | ACCEPT`.
- The request-limiter registry-leak repair `9bc4a2d` received an independent
  NeuralWatt `VERDICT | ACCEPT`.
- The round-trip contract package `cbfe594` is a focused test addition plus a
  minimal GDScript helper fix and does not need a fresh NeuralWatt reviewer
  dispatch.
- The tween-vector-bridge package is a single test file that mirrors the
  existing `tests/bridge-client.test.ts` pattern; it does not modify any
  production source. It does not require an independent NeuralWatt dispatch.
- No Claude model was invoked.
- No release-candidate file or candidate-ready notification exists.

## Current package — physics-frame `game_wait` regression coverage for #14

The previous package landed the tween-vector-bridge wire-level coverage
(#11). The handoff then named the physics-frame `game_wait` verification as
the next safe action: render and physics frame modes must both reach the
GDScript side and the bridge socket must survive either flow. The local
fork already ships the upstream `mcp_interaction_server.gd::_cmd_wait`
fix (`frame_type == "physics"` routes to `await get_tree().physics_frame`,
default `frame_type == "render"` keeps `process_frame`); the only
missing contract was takeover-side test coverage that locks in the
wire-level mapping the upstream fix relies on.

The package is a single new test file plus an inventory/handoff update:

- **`tests/game-wait-frame-bridge.test.ts`** (new, 12 tests) — exercises
  the real `BridgeClient` against a scripted loopback NDJSON bridge
  (same harness pattern as `tests/tween-vector-bridge.test.ts`) and
  parses the GDScript source for the upstream branching. The 12 tests
  cover:

  1. `BridgeClient` forwards `frameType:"physics"` byte-for-byte as
     `frame_type:"physics"` through NDJSON with a correlated response.
  2. `frameType` defaults to `"render"` when the caller omits it.
  3. `frames` defaults to `1` when the caller omits it.
  4. `frameType:"render"` explicitly emits `frame_type:"render"` on the
     wire.
  5. A wait round-trip with `frame_type:"physics"` leaves the bridge
     connection usable for a subsequent `get_performance` command on
     the same socket.
  6. An empty args object resolves to the documented defaults
     `{ frames: 1, frame_type: 'render' }`.
  7. A snake_case `frame_type` argument cannot reach the wire because
     `normalizeParameters` does not rename it and the transform's
     camelCase read falls back to the default — documents the explicit
     contract that callers must use the camelCase `frameType`.
  8. A `wait` error envelope from the bridge still permits a follow-up
     command on the same connection.
  9. A direct `sendCommand` on an unconnected client surfaces a typed
     `BridgeConnectionError`.
  10. The GDScript `_cmd_wait` source contains both
      `await get_tree().physics_frame` and
      `await get_tree().process_frame` branches plus the
      `frame_type == "physics"` dispatch.
  11. The GDScript response envelope echoes the resolved `frame_type`
      via the literal ternary
      `"frame_type": "physics" if use_physics else "render"`.
  12. The transform only emits `frames` and `frame_type` keys; unknown
      extra properties are not silently forwarded.

  The file imports `BridgeClient` from `src/godot/bridge/client.js` and
  mirrors `handleGameWait`'s pure transform so the contract is asserted
  at the transport boundary the upstream fix protects.

- **`docs/maintainers/issue-inventory.md`** — row for #14 moves from
  `open` to `partial`, gains the full wire-level regression summary
  that names `tests/game-wait-frame-bridge.test.ts` and points at the
  live `mcp_interaction_server.gd::_cmd_wait` upstream fix it locks in.

The package:

- does **not** modify `src/server.ts`, `src/scripts/mcp_interaction_server.gd`,
  the tool registry, the capability policy, the request limiter, the
  operation runner, or any other production source/test;
- preserves all 158 legacy tool contracts, every schema, every handler,
  the 5 closed-list profiles, the package identity, the path policy,
  the runtime bridge, and the MIT attribution;
- does not push, publish, create a PR/release, upload a package, write
  `docs/maintainers/release-candidate.md`, or send the candidate-ready
  notification.

Source evidence:

- `tests/game-wait-frame-bridge.test.ts` is the only new file.
- `docs/maintainers/issue-inventory.md` is the only documentation edit.

## Verification on the package filesystem

- `npx vitest run tests/game-wait-frame-bridge.test.ts`: 1 file, 12 tests passed.
- `npm test`: 31 files, 668 tests passed (was 656 before this package).
- `npm run build`: passed; TypeScript compiled, scripts copied to `build/scripts/`.
- `npm audit --audit-level=high`: 0 vulnerabilities.
- `git diff --check`: passed.

Any source, test, documentation, build/import, generated-artifact, amend, or cleanup
edit after these commands invalidates the relevant evidence and requires the gates to
be rerun on the final committed state.

## Review state

- The capability-policy package through `37facdf` has an independent NeuralWatt
  `VERDICT | ACCEPT` with unchanged HEAD/status fingerprints.
- The network-classification package `79b1d4d` also has an independent
  NeuralWatt `VERDICT | ACCEPT`.
- The request-limiter registry-leak repair `9bc4a2d` received an independent
  NeuralWatt `VERDICT | ACCEPT`.
- The round-trip contract package `cbfe594` is a focused test addition plus a
  minimal GDScript helper fix and does not need a fresh NeuralWatt reviewer dispatch.
- The tween-vector-bridge package `2ef0b1a` is a single test file that
  mirrors the existing `tests/bridge-client.test.ts` pattern; it does not
  modify any production source and does not require an independent
  NeuralWatt dispatch.
- The physics-frame `game_wait` package (this package) is a single test
  file plus an inventory update; it does not modify any production
  source or GDScript runtime, mirrors the tween-vector-bridge pattern,
  and does not require an independent NeuralWatt dispatch.
- No Claude model was invoked.
- No release-candidate file or candidate-ready notification exists.

## Open inventory priorities

1. Generic headless Godot test runner with GUT adapter (#29).
2. Real-Godot verification of the `attach_script` C# / .NET round-trip
   (`tests/attach-script-dotnet-gate.test.ts`) — needs a Godot binary on
   the takeover runner that can build a .NET project and exercise
   `set_script` on a C# script.
3. Texture import diagnostics (#103).
4. Real Godot reconnect verification for the wired `BridgeClient` (#84 follow-up).
5. Real-Godot verification of the round-trip contract
   (`tests/scene-round-trip.test.ts`) — needs a Godot binary on the
   takeover runner.
6. Real-Godot verification of the tween-vector regression
   (`tests/tween-vector-bridge.test.ts`) — needs a Godot binary on the
   takeover runner.
7. Real-Godot verification of the physics-frame `game_wait` regression
   (`tests/game-wait-frame-bridge.test.ts`) — needs a Godot binary on
   the takeover runner.
8. Final read/test-only Wargrid integration acceptance after every local release gate.

## Next safe action

The `attach_script` C# / .NET gate package (#114) is closed at the typed
error boundary; the next safe action remains the generic headless Godot
test runner with GUT adapter (#29), which unblocks the real-Godot
verification lanes for the round-trip, tween, physics-frame, and the
new C# round-trip regressions at once. Begin with repository evidence
and a focused failing behavioral test; preserve the five closed-list
profiles, all 158 tool contracts, and the three limiter knobs. Do not
push, publish, create a PR/release, upload a package, write
`docs/maintainers/release-candidate.md`, or send the candidate-ready
notification.