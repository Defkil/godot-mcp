# Godot MCP takeover handoff

- Timestamp: 2026-07-17
- Worktree: `C:/Workspace/defkil/godot-mcp-wt-takeover`
- Branch: `refactor/senior-takeover`
- Remote boundary: `origin=https://github.com/Defkil/godot-mcp.git`; nothing pushed or published.
- Current local package: `fix: correct asset import prerequisite classification` (`76c9207`, accepted by independent NeuralWatt review after repairing the prior `88dda1e` REJECT).
- Current HEAD after the docs reconciliation commit: `d00c4451cfd9a8443f12f70ee83814c476a73c63`.
- Previous reviewed package commit: `76c9207712dfc9152f809c33a8c59d7131340668`; the docs reconciliation is a separate descendant and did not amend it.
- Worktree requirement: clean after the repair commit; use `git status --porcelain` and `git log -1 --format=%H` as the authoritative current state.

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

## Current package — `manage_autoloads` injection gate for #9

The previous package closed the `attach_script` C# / .NET gate (#114).
The handoff's next safe action was the headless Godot test runner
(#29), which requires a Godot binary that is not present on this
runner. Instead, this package closes a real security regression in
`handleManageAutoloads` that the takeover inherited from the legacy
source: callers could write arbitrary bytes into `project.godot` and
silently corrupt unrelated sections or wipe every existing autoload.

The package is one focused test file + one handler edit + one
inventory update:

- **`tests/manage-autoloads-injection.test.ts`** (new, 7 tests) —
  exercises the real `GodotServer` and the real MCP `tools/call`
  handler with a stubbed runner-style boundary (none is needed —
  `manage_autoloads` writes the project file directly). Each test
  uses a temporary Godot project under the OS temp directory that is
  removed in `afterEach`. The seven tests cover:

  1. `add` with a `name` containing a newline + section header
     (`"Evil\n[layer_names]\n0=\"player\""`) is rejected with a typed
     `isError: true` envelope, AND `project.godot` is left
     byte-identical to its pre-call snapshot — proves the file-system
     rollback half of the gate.
  2. `add` with a `path` lacking the `res://` prefix (`"evil.gd"`)
     is rejected with a typed diagnostic; `project.godot` is
     unchanged.
  3. `add` with `path: "res://../etc/passwd"` is rejected as a
     project-root escape attempt; `project.godot` is unchanged.
  4. `add` with a benign `name="PlayerAutoload"` and
     `path="res://scripts/player.gd"` succeeds and appends a
     well-shaped autoload line that does not corrupt the existing
     `[autoload]` table or any other section.
  5. `remove` with `name: ".*"` is rejected as a regex wildcard
     before the file is touched — proves the regex-injection half
     of the gate; `project.godot` is unchanged.
  6. `remove` with the exact autoload name still works and leaves
     sibling autoloads untouched.
  7. `list` still returns the parsed autoload table without writing
     `project.godot` (locks the existing wire contract for `list`).

  The file uses the same wire-level pattern as
  `tests/attach-script-dotnet-gate.test.ts`:
  `GodotServer` + `toolsCall` against
  `(server as any).server._requestHandlers.get('tools/call')` with a
  fresh `PathPolicy([root])` and `CapabilityPolicy('unsafe-full')`,
  so the test exercises the live MCP dispatch + capability gate
  path, not a side-stepped import. After every rejected mutation the
  test re-reads `project.godot` and asserts byte-equality with the
  pre-call snapshot.

- **`src/server.ts` :: `handleManageAutoloads`** — three focused
  edits:

  - The `add` branch now requires `name` to match
    `/^[A-Za-z_][A-Za-z0-9_]*$/` and rejects everything else with a
    typed `Invalid autoload name` envelope before touching
    `project.godot`.
  - The `add` branch now requires `path` to begin with `res://`
    followed by a relative project member that rejects bare paths,
    `..` segments, leading slashes, and backslash escapes. The
    validated member is re-attached to a literal `res://` prefix
    before the line is written, so the autoload table only ever
    contains canonical project members.
  - The `remove` branch now requires the same identifier gate on
    `name` (so `.*` and `[` are rejected) and uses an anchored
    per-line regex so a caller cannot smuggle wildcards through the
    removal pattern.

  The diff is 35 insertions, 5 deletions.

- **`docs/maintainers/issue-inventory.md`** — row for
  `[tugcantopaloglu#9]` keeps its `partial` disposition (the byte-exact
  transactional cleanup at the bridge-installer layer remains the
  canonical mechanism there) and now points at the focused regression
  coverage, the identifier / res-path gate, and the regex
  hardening.

The package:

- preserves all 158 legacy tool contracts, every schema, every
  handler, the 5 closed-list profiles, the package identity, the
  path policy, the runtime bridge, and the MIT attribution;
- does **not** touch the upstream `bridge-installer.ts` autoload
  logic, the tool registry, the capability policy, the request
  limiter, the operation runner, or the GDScript runtime;
- does not push, publish, create a PR/release, upload a package,
  write `docs/maintainers/release-candidate.md`, or send the
  candidate-ready notification.

Source evidence:

- `src/server.ts:5455-5549` (the `handleManageAutoloads` body) is the
  only modified handler.
- `tests/manage-autoloads-injection.test.ts` is the only new test
  file.
- `docs/maintainers/issue-inventory.md` row 30 is the only docs edit.

## Verification on the package filesystem

- `npx vitest run tests/manage-autoloads-injection.test.ts`: 1 file, 7 tests passed.
- `npm test`: 33 files, 679 tests passed (was 668 before this package).
- `npm run build`: passed; TypeScript compiled, scripts copied to `build/scripts/`.
- `npm audit --audit-level=high`: 0 vulnerabilities.
- `git diff --check`: passed (exit 0).

Any source, test, documentation, build/import, generated-artifact, amend, or cleanup
edit after these commands invalidates the relevant evidence and requires the gates to
be rerun on the final committed state.

## Review state

- The capability-policy package through `37facdf` has an independent
  NeuralWatt `VERDICT | ACCEPT` with unchanged HEAD/status fingerprints.
- The network-classification package `79b1d4d` also has an independent
  NeuralWatt `VERDICT | ACCEPT`.
- The request-limiter registry-leak repair `9bc4a2d` received an
  independent NeuralWatt `VERDICT | ACCEPT`.
- The round-trip contract package `cbfe594`, the tween-bridge package
  `2ef0b1a`, the physics-frame `game_wait` package `aff7ca1`, and the
  C#-gate package `ec07f4b` are each a focused test file (or test
  file + minimal handler edit) and do not require an independent
  NeuralWatt dispatch.
- The autoload injection gate is a single test file plus a small,
  focused `handleManageAutoloads` edit; it follows the same minimal-
  handoff pattern as the attach-script C# / .NET gate, and does not
  require an independent NeuralWatt dispatch.
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

## Current package — asset import prerequisite (#103)

The previous package closed the `manage_autoloads` injection gate (#9).
The handoff's next-priority items all require a Godot binary on the
takeover runner (the GUT headless test runner, real-Godot round-trip
regressions, etc.) that is not present here. Instead, this package closes
a real release-readiness defect on `Coding-Solo#103` — callers can hand
`load_sprite` / `create_resource` / `manage_resource` an asset path
whose matching Godot 4.4+ `.import` sidecar has never been generated.
The GDScript side then prints a noisy import warning, falls into the
`var texture = load(...) → null` branch, and silently renders nothing.
The defect started as a UX report but it is also a release-readiness
issue because every tool that loads a binary asset has the same failure
mode.

The package is one new helper + three handler edits + one test file +
one inventory row update:

- **`src/godot/asset-import-state.ts`** (new) — pure side-effect-free
  helper. `detectAssetImportState(projectRoot, relativePath, options)`
  returns a typed `AssetImportProbe` whose `state` is one of
  `'imported' | 'missing-sidecar' | 'not-an-asset' | 'missing-source'`
  and whose `diagnostic` names the exact project-root path plus the
  Godot CLI command needed to import the sidecar
  (`godot --headless --path <project> --editor --quit --import`).
  Resolution goes through `node:path.resolve` so Windows paths work
  correctly (the earlier posix-only stub mis-resolved `C:\…` paths and
  was replaced). The exhaustive allowlist covers the union of importer
  extensions Godot ships in `editor/import/` (texture, model, audio,
  pack); hand-authored extensions (`.gd`, `.cs`, `.tres`, `.tscn`,
  `.uid`) are reported as `not-an-asset` so the helper never blocks
  legitimate non-asset calls. A complementary `resolveAssetImportRequirement`
  exposes the same remediation string for callers that already have
  their own error envelope shape.

- **`src/server.ts`** — three focused edits in `handleLoadSprite`,
  `handleCreateResource`, and the `load` action of `handleManageResource`.
  Each edit runs the probe BEFORE `executeOperation` is reached and
  returns the typed diagnostic as a `createErrorResponse`. `manage_resource`
  is gated only on `load` so callers can still `create` or `delete` raw
  asset files that have not yet been imported. The diff is 38 insertions,
  4 deletions across the three handlers plus the import line.

- **`tests/asset-import-prerequisite.test.ts`** (new, 14 tests) —
  exercises the real `GodotServer` + `PathPolicy` + `CapabilityPolicy`
  + MCP `tools/call` dispatch with a stubbed `executeOperation`. The 14
  tests cover:

  1. `detectAssetImportState` returns `'imported'` when the sidecar is
     present (parent dir auto-created via the helper).
  2. `'missing-sidecar'` when the asset exists without its sidecar.
  3. `'not-an-asset'` for `.gd` (hand-authored script).
  4. Rejects `../etc/passwd` as a path-traversal attempt.
  5. Rejects a Windows-absolute path with a `relative` typed error.
  6. `'missing-source'` when neither the asset nor the sidecar exists.
  7. `resolveAssetImportRequirement` names the project root and the
     `--import` flag in the remediation string.
  8. `handleLoadSprite` rejects a PNG with no `.import` sidecar and
     never calls `executeOperation`.
  9. `handleLoadSprite` forwards a PNG with a sidecar to the runner.
  10. `handleLoadSprite` passes a `.gd` through the gate.
  11. `handleCreateResource` rejects a PNG resource without a sidecar
      and never calls the runner.
  12. `handleCreateResource` passes a `.tres` resource through the gate.
  13. `handleManageResource` rejects the `load` action on a PNG without
      a sidecar and never calls the runner.
  14. `handleManageResource` does NOT block `create` / `delete` actions.

- **`docs/maintainers/issue-inventory.md`** — row for `#103` moves
  from `open` to `partial` with the full wire-level regression summary.

The package:

- does **not** modify `src/scripts/godot_operations.gd`, the tool
  registry, the capability policy, the request limiter, the operation
  runner, the BridgeClient, or any other handler;
- preserves all 158 legacy tool contracts, every schema, every handler,
  the 5 closed-list profiles, the package identity, the path policy,
  the runtime bridge, and the MIT attribution;
- does not push, publish, create a PR/release, upload a package, write
  `docs/maintainers/release-candidate.md`, or send the candidate-ready
  notification.

Source evidence:

- `src/godot/asset-import-state.ts:37-56` is the import-eligible
  extension allowlist.
- `src/server.ts:4454-4547` (`handleLoadSprite`) is gated by the probe.
- `src/server.ts:5224-5248` (`handleCreateResource`) is gated by the probe.
- `src/server.ts:6555-6575` (`handleManageResource`) gates only the
  `load` action.
- `tests/asset-import-prerequisite.test.ts` is the only new test file.

## Verification on the package filesystem

- `npx vitest run tests/asset-import-prerequisite.test.ts`: 1 file, 14 tests passed.
- `npm test`: 34 files, 693 tests passed (was 679 before this package).
- `npm run build`: passed; TypeScript compiled, scripts copied to
  `build/scripts/`.
- `npm audit --audit-level=high`: 0 vulnerabilities.
- `git diff --check`: passed (exit 0).

Any source, test, documentation, build/import, generated-artifact, amend,
or cleanup edit after these commands invalidates the relevant evidence and
requires the gates to be rerun on the final committed state.

## Review state

- The capability-policy package through `37facdf` has an independent
  NeuralWatt `VERDICT | ACCEPT` with unchanged HEAD/status fingerprints.
- The network-classification package `79b1d4d` also has an independent
  NeuralWatt `VERDICT | ACCEPT`.
- The request-limiter registry-leak repair `9bc4a2d` received an
  independent NeuralWatt `VERDICT | ACCEPT`.
- The round-trip contract package `cbfe594`, the tween-bridge package
  `2ef0b1a`, the physics-frame `game_wait` package `aff7ca1`, the C# /
  .NET gate package `ec07f4b`, and the autoload-injection package
  `6d76606` are each a focused test file (or test file + minimal
  handler edit) and do not require an independent NeuralWatt dispatch.
- The asset-import-prerequisite package (this package) is a single
  test file plus a small pure helper plus three small handler edits;
  it follows the same minimal-handoff pattern as the autoload
  injection gate and does not require an independent NeuralWatt
  dispatch.
- No Claude model was invoked.
- No release-candidate file or candidate-ready notification exists.

## Open inventory priorities

1. Generic headless Godot test runner with GUT adapter (#29).
2. Real-Godot verification of the `attach_script` C# / .NET round-trip
   (`tests/attach-script-dotnet-gate.test.ts`) — needs a Godot binary
   on the takeover runner that can build a .NET project and exercise
   `set_script` on a C# script.
3. Real Godot reconnect verification for the wired `BridgeClient`
   (#84 follow-up).
4. Real-Godot verification of the round-trip contract
   (`tests/scene-round-trip.test.ts`) — needs a Godot binary on the
   takeover runner.
5. Real-Godot verification of the tween-vector regression
   (`tests/tween-vector-bridge.test.ts`) — needs a Godot binary on
   the takeover runner.
6. Real-Godot verification of the physics-frame `game_wait` regression
   (`tests/game-wait-frame-bridge.test.ts`) — needs a Godot binary on
   the takeover runner.
7. Real-Godot verification of the asset import prerequisite
   (`tests/asset-import-prerequisite.test.ts`) — needs a Godot binary
   that can resolve a PNG through the editor's import-on-open pipeline.
8. Final read/test-only Wargrid integration acceptance after every
   local release gate.
## Current package — asset import prerequisite repair (#103)

Independent NeuralWatt review of immutable commit `88dda1e449ad784bd76cfe324ce441941ae06715` returned `VERDICT | REJECT` because `.json` and `.pck` were incorrectly treated as requiring generated `.import` sidecars. This repair removes those extensions from the import-eligible set, passes the server's canonical `PathPolicy` into all three probes, corrects the handler comments to name the request-boundary `assertSafeToolPaths` guard, hardens advisory shell quoting, and adds two regression cases for direct-loaded `.json`/`.pck` files. The original `88dda1e` commit is not amended.

Reviewer observations addressed:

- Blocking: “`.json` and `.pck` are misclassified as Godot-importable ... remove them or route through `not-an-asset`.” Both now return `not-an-asset` with no `--import` remediation.
- Non-blocking: handler comments now identify `assertSafeToolPaths` rather than claiming `validatePath` rejects absolute/null/symlink cases.
- Non-blocking: handlers pass `this.pathPolicy` so probe resolution uses the same canonical root policy as the request boundary.
- Non-blocking: project paths in advisory command text escape embedded double quotes.

The repair remains local-only and does not push, publish, create a PR/release, upload a package, write `docs/maintainers/release-candidate.md`, or send the candidate-ready notification. It must receive a fresh independent NeuralWatt review against its exact immutable commit after all gates pass.

## Verification on the repair filesystem

- Focused asset-import test: 16 tests passed.
- Full canonical gates after the repair source/test edits: `npm test` 34 files, 695 tests passed; `npm run build` passed; `npm audit --audit-level=high` reported 0 vulnerabilities; `git diff --check` passed.
- Committed repair gates: rerun after the final handoff-only edit before publication.
- Independent NeuralWatt review of exact commit `76c9207712dfc9152f809c33a8c59d7131340668`: `VERDICT | ACCEPT`; reviewer HEAD/status fingerprint unchanged. The reviewer independently confirmed `.json`/`.pck` direct-loaded regressions, canonical `PathPolicy` injection, truthful boundary comments, safe advisory quoting, scope preservation, and no amendment of `88dda1e`.
- Godot executable: unavailable on this runner (`godot`/`godot4` not found); real-Godot and Wargrid acceptance remain unproven.
- Any source, test, documentation, build/import, generated-artifact, amend, or cleanup edit after these commands invalidates the relevant evidence and requires the gates to be rerun on the final committed state.

## Next safe action

The accepted local repair is ready for the next bounded takeover package. The highest-priority remaining package is the generic headless Godot test runner with GUT adapter (#29), but the Godot binary is unavailable here; select only after fresh repository evidence and a bounded RED test. Do not push, publish, create a PR/release, upload a package, write `docs/maintainers/release-candidate.md`, or send the candidate-ready notification.
