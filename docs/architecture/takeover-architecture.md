# Takeover architecture

Status: implementation baseline, 2026-07-15

## Objective

Turn the inherited proof-of-work into a maintainable, generic, local-first Godot MCP
server without coupling it to Wargrid, one IDE, one operating system, or one hosted
service. Compatibility is preserved deliberately; unsafe legacy behavior is not
preserved accidentally.

## Quality attributes

Ordered by priority:

1. **Integrity:** never mutate a project outside explicit policy, and never report a mutation as successful without verification.
2. **Recoverability:** process crashes, MCP disconnects and interrupted launches restore temporary project changes.
3. **Truthful diagnostics:** startup, Godot parse/import/runtime errors and partial operations reach the caller as structured failures.
4. **Determinism:** tool schemas, dispatch and implementation stay in parity; repeated calls have documented idempotency.
5. **Portability:** native Windows, Linux and macOS paths and Godot 4.4–4.7 are first-class.
6. **Agent efficiency:** bounded output and an optional compact tool facade avoid sending 157 schemas when a client does not need them.
7. **Extensibility:** adding a tool does not require editing a multi-thousand-line switch in several languages.
8. **Open-source operability:** reproducible package/release artifacts, preserved MIT attribution and no private infrastructure dependency.

## Target modules

```text
src/
  bin.ts                    CLI only; owns exit status
  index.ts                  side-effect-free public library API + legacy entry shim
  server/
    create-server.ts        MCP transport composition
    tool-registry.ts        one source of schema, capability, handler and docs metadata
    response.ts             typed success/error/result envelopes
  config/
    load-config.ts          environment/config parsing and validation
  security/
    path-policy.ts          canonical roots and project-member resolution
    capability-policy.ts    inspect/edit/runtime/unsafe/export/network decisions
    limits.ts               output, file, timeout and request bounds
  godot/
    executable.ts           versioned executable detection
    process-manager.ts      lifecycle state machine and retained diagnostics
    project-transaction.ts  byte-exact temporary mutation/restore
    operation-runner.ts     typed headless operation protocol
    bridge/
      client.ts             authenticated, versioned NDJSON client
      installer.ts          reversible bridge installation
  tools/
    project/
    scene/
    resource/
    script/
    runtime/
    editor/
    build/
  scripts/
    operations/             small Godot-side operation modules
    runtime/                small runtime bridge command modules
```

The decomposition is incremental. Each extraction must keep the full gate green and
must add behavior-level tests before the old implementation is removed.

## Core decisions

### One registry, not three drifting surfaces

Each tool registration contains its MCP schema, aliases, capability requirement,
handler and stability metadata. The flat MCP list, compact facade, dispatcher parity
test and generated reference documentation derive from that registry. A tool cannot
be advertised without a handler.

Migration is incremental: `modify_project_settings` and `list_project_files` are the
first registered tools and are merged into the legacy flat list at their existing
positions. Their advertised schemas, capabilities and executable handlers now share
registrations, while the other 155 contracts remain on the legacy switch until each
has equivalent behavioral coverage.

The existing flat tool names remain available. A compact mode groups discovery and
low-frequency operations without deleting the stable flat API. Compact mode is
opt-in until real client and Wargrid compatibility is proven.

### Canonical path policy

All project and file operations use one injected `PathPolicy`:

- project roots must be absolute;
- configured roots are canonicalized through the filesystem;
- Windows drive letters are parsed without treating `:` as a list separator;
- member paths are project-relative or `res://` paths only;
- absolute members, unsupported URI schemes, null bytes and traversal are rejected;
- nearest existing parents are canonicalized so symlink escapes in future paths are rejected;
- lexical `validatePath` checks are removed once every handler is migrated.

Migration mode permits an empty allowed-root list for current clients, but emits a
clear diagnostic. The next major profile requires explicit roots for mutation and
execution. `legacy-full` remains an explicit, documented compatibility choice rather
than a silent default.

### Capability policy

Tools are tagged with capabilities:

- `inspect`: read-only project/editor/runtime introspection;
- `edit`: project file/resource/scene mutations;
- `runtime`: launch, stop and bounded input/playtest control;
- `export`: build and artifact generation;
- `network`: any non-loopback or download operation;
- `unsafe`: arbitrary GDScript evaluation, arbitrary script attachment/execution, or repository automation generation.

Profiles compose capabilities. Unsafe capabilities require explicit opt-in. Policy
denials are normal MCP errors with the required capability and remediation; they are
not process crashes.

### Explicit lifecycle state machine

The process manager owns these states:

```text
idle -> preparing -> starting -> ready -> stopping -> idle
                       |          |
                       v          v
                     failed <-----+
```

It provides:

- one serialized transition lock per session;
- process-tree termination with an awaited deadline and escalation;
- startup observation instead of optimistic success;
- bounded stdout/stderr ring buffers retained after exit;
- structured exit reason, code, signal, timestamps and readiness diagnostics;
- cleanup in `finally` and during server shutdown;
- optional session IDs later, while preserving one default session now.

### Reversible bridge transaction

Runtime control currently requires a project autoload. Until a mutation-free Godot
bootstrap is proven, installation is a transaction:

1. validate the canonical project root;
2. snapshot exact bytes and existence metadata for every touched path;
3. write bridge content atomically;
4. add the autoload deterministically;
5. launch with a random loopback port, protocol version and random session token;
6. require a token-authenticated readiness handshake;
7. restore the exact snapshot as soon as Godot has loaded it, and again idempotently during every cleanup path.

Pre-existing user-managed bridge/autoload files are never overwritten or removed.
A crash-recovery journal contains hashes and paths but no credentials.

### Versioned bridge protocol

The loopback protocol remains newline-delimited JSON for simplicity, with:

- protocol version and per-launch random token handshake;
- dynamic port instead of fixed `9090`;
- request IDs required on every response;
- maximum frame size and bounded pending requests;
- one explicit command queue instead of a global `_busy` flag;
- typed success/error envelopes;
- readiness, heartbeat and graceful shutdown messages;
- unknown command/action failures generated from the same registry used for parity tests.

### Typed headless operation protocol

Godot-side headless operations emit exactly one machine result envelope. Human logs
are separate diagnostics. TypeScript does not infer failure from whether stderr
contains the English phrase `Failed to`. Mutations return affected paths/counts and
verify expected postconditions.

The runner emits a typed success marker after each successful operation. Its compatibility return value preserves human-readable stdout while filtering that marker; callers receive a truthful success response only after process exit, result parsing, and operation identity/status validation.

## Compatibility strategy

1. Keep all existing stable tool names during the refactor.
2. Preserve direct execution of `build/index.js`; new installations use `build/bin.js`.
3. Export a side-effect-free library entrypoint for tests and embedded hosts.
4. Add deprecation metadata before changing arguments or defaults.
5. Treat the immediate upstream and original source as read-only evidence remotes;
   port small fixes deliberately instead of merging unrelated histories.
6. Maintain an issue matrix with a regression test or documented disposition for
   every inherited report.

## Implementation slices

### Slice 1 — foundation

- split library, CLI and server implementation;
- add canonical `PathPolicy` with injected dependencies and unit tests;
- preserve legacy `build/index.js` execution;
- update dependency floor to satisfy the active Vite peer range.

### Slice 2 — truthful lifecycle

- extract process manager and bounded diagnostics;
- await stop/restart;
- observe startup and return parse/import failures;
- preserve terminal diagnostics after exit.

Closes the substance of original issues #23, #37, #70 and #106.

### Slice 3 — transactional authenticated bridge

- byte-exact installer/restorer;
- dynamic port and token handshake;
- readiness/health state;
- command framing limits and deterministic cleanup.

Closes the substance of original issue #84 and immediate issues #9/#16.

### Slice 4 — schema and mutation truth

- registry-derived schema/dispatch parity;
- typed operation results and postcondition checks;
- resource-value conversion regressions;
- repair UID root behavior.

Closes original #102 and immediate #8/#12/#13.

### Slice 5 — requested capabilities

- generic headless test runner plus GUT adapter (#29);
- C# attachment (#114);
- bounded ClassDB inspection (#98);
- texture import diagnostics (#103);
- visual/input/frame regressions (#68/#88 and immediate #11/#14);
- deterministic, filtered and bounded project file listing (#120; implemented with
  behavior-level scanner coverage).

### Slice 6 — delivery

- CI matrix for supported Node versions and all host-operable tests;
- real Godot headless fixture matrix where runners support it;
- dependency review, CodeQL, secret scan and scheduled audit;
- provenance-enabled package build and GitHub release workflow;
- release workflow uses a protected environment/manual approval;
- no Docker claim or image until a useful headless-only contract is demonstrated.

No workflow is triggered and no artifact is published before explicit approval.

## Verification pyramid

1. Pure unit tests for policies, parsers, registries and state transitions.
2. Contract tests using fake process/socket/filesystem adapters.
3. Temporary-project integration tests using a real Godot executable.
4. Package install and MCP stdio protocol smoke from the packed tarball.
5. Wargrid read-only inspection and validation.
6. Wargrid transactional mutation in a disposable worktree, followed by byte/hash and Git cleanliness verification.
7. Real Wargrid runtime launch, bridge readiness, screenshot/input/log/error checks and clean stop.
8. Independent review of the exact commit candidate.

The real-game gate asks both verification questions: did the MCP perform the requested
operation, and did it preserve the integrity and behavior of the game around that
operation?
