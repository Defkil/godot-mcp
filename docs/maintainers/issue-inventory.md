# Cross-fork issue inventory

Status date: 2026-07-15

This inventory is the local source of truth for the takeover of `Defkil/godot-mcp`.
It covers every issue currently open in the original repository and every issue
reported against the immediate upstream. An upstream issue being closed is not
accepted as proof by itself: inherited fixes receive regression coverage here.
No issue state in a public repository is changed by this work.

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
| [tugcantopaloglu#8](https://github.com/tugcantopaloglu/godot-mcp/issues/8) Resource properties silently fail in `modify_scene_node` | closed | open | Resource-valued property round-trip using a real `.tscn` fixture |
| [tugcantopaloglu#9](https://github.com/tugcantopaloglu/godot-mcp/issues/9) unrestricted persistent autoload injection | closed | partial | Canonical path policy for every project/file tool plus byte-exact transactional cleanup |
| [tugcantopaloglu#11](https://github.com/tugcantopaloglu/godot-mcp/issues/11) tween vectors/colors crash the bridge | closed | open | Runtime regression for `Vector2`, `Vector3` and `Color`; subsequent command must still work |
| [tugcantopaloglu#12](https://github.com/tugcantopaloglu/godot-mcp/issues/12) schemas advertise phantom commands/actions | closed | open | Machine-derived schema/dispatcher parity test; no source-text-only assertion |
| [tugcantopaloglu#13](https://github.com/tugcantopaloglu/godot-mcp/issues/13) success envelopes for no-op writes | closed | open | Mutation plus independent read-back for every affected command |
| [tugcantopaloglu#14](https://github.com/tugcantopaloglu/godot-mcp/issues/14) `game_wait` cannot wait for physics ticks | closed | open | Render and physics frame modes verified in a running project |
| [tugcantopaloglu#16](https://github.com/tugcantopaloglu/godot-mcp/issues/16) bridge script copied over user-managed setup | closed | partial | Preserve pre-existing script/autoload byte-for-byte and remove only files created by the server |

## Original-source open issues

The original repository currently has 23 open issues. Several were implemented in
the immediate fork but never closed in the original tracker.

| Issue | Local disposition | Takeover decision |
|---|---|---|
| [Coding-Solo#120](https://github.com/Coding-Solo/godot-mcp/issues/120) list project files | partial | Existing `list_project_files` must gain deterministic filtering, bounded output and path-policy coverage. |
| [Coding-Solo#118](https://github.com/Coding-Solo/godot-mcp/issues/118) vulnerable axios/MCP SDK | verified | Current lockfile reports `npm audit` zero; keep Dependabot and scheduled audit gates. |
| [Coding-Solo#114](https://github.com/Coding-Solo/godot-mcp/issues/114) attach C# script | open | Add typed C# attachment in .NET projects and reject incompatible targets. |
| [Coding-Solo#111](https://github.com/Coding-Solo/godot-mcp/issues/111) Godot 4.7 support | partial | Wargrid already runs on Godot 4.7; add 4.4–4.7 compatibility fixtures and CI matrix documentation. |
| [Coding-Solo#106](https://github.com/Coding-Solo/godot-mcp/issues/106) return launch errors to the agent | open | Introduce startup observation, structured diagnostics and retained terminal state. |
| [Coding-Solo#103](https://github.com/Coding-Solo/godot-mcp/issues/103) document texture import prerequisite | open | Detect import state where possible and document/actionably report the prerequisite. |
| [Coding-Solo#102](https://github.com/Coding-Solo/godot-mcp/issues/102) malformed UID resave root and false success | open | Pass `res://`, fail when zero eligible resources are unexpectedly processed, and add a Godot fixture regression. |
| [Coding-Solo#98](https://github.com/Coding-Solo/godot-mcp/issues/98) ClassDB access | open | Add bounded read-only class/method/property documentation tools. |
| [Coding-Solo#97](https://github.com/Coding-Solo/godot-mcp/issues/97) policy enforcement | partial | Canonical roots started in `PathPolicy`; add capability profiles, rate/size limits and explicit unsafe-tool opt-in. |
| [Coding-Solo#88](https://github.com/Coding-Solo/godot-mcp/issues/88) visual debugging/playtest capture | partial | Screenshot exists; add deterministic capture readiness and optional bounded frame sequence, not unrestricted recording. |
| [Coding-Solo#84](https://github.com/Coding-Solo/godot-mcp/issues/84) bridge stuck connecting | open | Replace fixed-port/fire-and-forget startup with configurable authenticated readiness and actionable status. |
| [Coding-Solo#70](https://github.com/Coding-Solo/godot-mcp/issues/70) `run_project` restart race | open | Await process-tree termination and bridge release before the next launch. |
| [Coding-Solo#68](https://github.com/Coding-Solo/godot-mcp/issues/68) keyboard/mouse input | partial | Input tools exist; verify sandboxed delivery and held-input cleanup on stop/disconnect. |
| [Coding-Solo#61](https://github.com/Coding-Solo/godot-mcp/issues/61) publish npm package | delivery | Prepare provenance-backed npm/GitHub release workflows; publication remains blocked on Oliver's approval. |
| [Coding-Solo#57](https://github.com/Coding-Solo/godot-mcp/issues/57) attach scripts/runtime tree/main scene | partial | Existing tools cover these operations; add typed round-trip and runtime tests. |
| [Coding-Solo#49](https://github.com/Coding-Solo/godot-mcp/issues/49) Windows JSON quoting | partial | `execFile` argument passing exists; add native Windows regression with spaces and Unicode paths. |
| [Coding-Solo#39](https://github.com/Coding-Solo/godot-mcp/issues/39) connect exported nodes | partial | Scene signals are supported; document and test exported-resource/node assignment workflows. |
| [Coding-Solo#37](https://github.com/Coding-Solo/godot-mcp/issues/37) false `No active Godot process` | open | Replace child-handle-only state with an explicit lifecycle state machine and retained exit diagnostics. |
| [Coding-Solo#30](https://github.com/Coding-Solo/godot-mcp/issues/30) old MCP SDK/dependencies | verified | MCP SDK and dependencies are current enough for audit zero; compatibility smoke remains a release gate. |
| [Coding-Solo#29](https://github.com/Coding-Solo/godot-mcp/issues/29) GUT integration | open | Add a generic headless Godot test runner with a GUT adapter and structured results. |
| [Coding-Solo#23](https://github.com/Coding-Solo/godot-mcp/issues/23) editor launch reports false success | open | Validate executable files, observe startup and return launch diagnostics instead of optimistic success. |
| [Coding-Solo#22](https://github.com/Coding-Solo/godot-mcp/issues/22) Dockerfile/Glama listing | delivery | Do not claim an inherited listing. Evaluate a documented container image only for headless operations; GUI/runtime control remains local. |
| [Coding-Solo#20](https://github.com/Coding-Solo/godot-mcp/issues/20) scene creation JSON parsing | partial | Structured argv avoids shell quoting; verify Windows path/JSON fixtures and real scene creation. |

## Additional defects found during takeover

1. `src/index.ts` was a 7,115-line executable monolith and could not be imported as a library without starting the server.
2. `mcp_interaction_server.gd` is a 4,861-line single-client server on fixed port `9090` with no authentication token.
3. `godot_operations.gd` is a 1,887-line dispatcher and reports success based on stderr text heuristics rather than a typed protocol.
4. Most handler tests inspect source strings and regular expressions; they do not execute handlers or Godot.
5. Many filesystem handlers use a lexical `validatePath` check and `join`, bypassing the allowed-root policy and symlink boundaries.
6. Runtime output arrays are unbounded, launch returns before readiness, and exit clears access to diagnostics.
7. Process termination is not awaited and may leave a process tree or occupied bridge port.
8. Bridge installation rewrites `project.godot` and later heuristically removes text rather than restoring an exact transaction snapshot.
9. `update_project_uids` passes a host path into a Godot resource-root parameter and can report a false positive.
10. The package had one executable/library entrypoint; the takeover branch now separates them while preserving legacy `build/index.js` execution.

## Publication boundary

Everything in this inventory is local preparation. No branch, commit, package,
container, release, issue comment, issue closure or pull request is published until
Oliver explicitly approves the exact reviewed candidate.
