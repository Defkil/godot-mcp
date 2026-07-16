# Godot MCP takeover handoff

- Timestamp: 2026-07-16
- Worktree: `C:/Workspace/defkil/godot-mcp-wt-takeover`
- Branch: `refactor/senior-takeover`
- Remote: `origin=https://github.com/Defkil/godot-mcp.git`; nothing pushed or published.
- Worktree: dirty with the scene-tool registry migration; commit pending after independent review.

## Package in progress

`read_scene`, `modify_scene_node`, and `remove_scene_node` are now registered
through the focused `src/tools/scene/*.ts` modules instead of the inline
`case` statements that previously dispatched them. The legacy
`handleReadScene` / `handleModifySceneNode` / `handleRemoveSceneNode` bodies
are now thin wrappers that delegate to the typed modules; the registry owns
the schema, capability and dispatch.

The migration closes the silent-failure modes of `tugcantopaloglu#8`
(`modify_scene_node` resource properties) and `#13` (success envelopes for
no-op writes). `godot_operations.gd` now records a typed
`_postcondition_errors` array for unresolvable `res://` resources, silent
`target.set()` rejections, missing parents and `remove_child` calls that did
not actually detach the node; the operation runner emits a typed
`status: error` envelope that `executeOperation` parses and the scene tool
modules propagate as a `SceneOperationPostconditionError` instead of a
false-positive success envelope.

`executeOperation` was widened to accept the typed `status: error` envelope
alongside the historical `status: ok` contract; non-scene handlers that only
read `stdout` continue to work unchanged.

## Verification

- `npx tsc --noEmit`: clean.
- `npm run build`: passed; TypeScript compiled and Godot scripts copied to `build/scripts`.
- `npx vitest run`: 24 files, 574 tests passed (was 506 at job creation; +68 from this package).
- `npm audit --audit-level=high`: 0 vulnerabilities.
- `git diff --check`: clean.
- `tests/scene-tools.test.ts`: 20 tests, including three real MCP `tools/call`
  wiring tests that inject a stubbed runner through `sceneToolContext()` and
  exercise the `isError: true` envelope for typed postcondition failures on
  `modify_scene_node` and `remove_scene_node`, plus a structured-JSON success
  path for `read_scene`.
- `tests/schema-parity.test.ts`: 3 tests, including the extended assertions
  that the new tools appear exactly once in `tools/list`, are present in
  `toolRegistry.definitions()`, and advertise the documented capabilities.
- `tests/handlers.test.ts`: source-text assertions updated to reflect the
  migrated module location (`SCENE_JSON_START`/`END` now live in
  `src/tools/scene/read-scene.ts`) and the legacy `case`-statement count
  changed from 154 to 151.
- `tests/tool-definitions.test.ts`: `ALL_TOOL_NAMES` updated to include the
  three migrated names.

## Issue inventory updates

- `tugcantopaloglu#8` disposition moved from `open` to `partial`.
- `tugcantopaloglu#13` disposition moved from `open` to `partial`.

Real `.tscn` round-trip and real-Godot modification remain as the
`partial → verified` follow-up.

## Next safe action

Commit the scene-tool registry migration (one focused commit
`refactor: migrate headless scene tools to the typed registry`) and return to
the remaining open rows in `docs/maintainers/issue-inventory.md`. Candidate
follow-ups:

- Capability policy enforcement with profiles, rate/size limits and explicit
  unsafe-tool opt-in (#97).
- Resource-valued property round-trip on a real `.tscn` fixture (closes
  the remaining `tugcantopaloglu#8` and `#13` evidence).
- Tween `Vector2` / `Vector3` / `Color` regression on a running bridge
  (`tugcantopaloglu#11`).
