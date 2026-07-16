# Godot MCP takeover handoff

- Timestamp: 2026-07-16
- Worktree: `C:/Workspace/defkil/godot-mcp-wt-takeover`
- Branch: `refactor/senior-takeover`
- Remote: `origin=https://github.com/Defkil/godot-mcp.git`; nothing pushed or published.
- Last commit: `db6450b` (`docs: record capability-policy package as shipped in handoff`).
- Worktree: dirty — in-flight `classdb_inspect` package staged for this tick.

## Package shipped (this tick)

Bounded read-only ClassDB introspection (`classdb_inspect`) closes
[Coding-Solo#98](https://github.com/Coding-Solo/godot-mcp/issues/98):

- `src/tools/script/classdb-inspect.ts` (new) — focused tool module: `validateClassdbInspectInput` rejects path-shaped and extension-bearing `className` values; `classdbInspect` resolves the project through `PathPolicy.assertProject`, forwards one headless `classdb_inspect` operation, and surfaces typed `status: error` postcondition failures as a structured MCP error envelope.
- `src/server.ts` — registers `classdb_inspect` with capability `inspect`, `inputSchema` requiring `projectPath` + `className`; thin wrapper delegates to the focused module through `classdbInspectContext()`, which forwards a `ClassdbInspectRunner` wrapping the shared `executeOperation` (so the typed `status: error` envelope is interpreted through the same machinery as every other headless tool).
- `src/scripts/godot_operations.gd` — new `classdb_inspect` operation: walks the parent chain (bounded at 16) and reports methods, properties, signals, enums and integer constants for the target class. Missing or unknown class names record a typed `_postcondition_failure` so the typed `status: error` envelope propagates.
- `tests/classdb-inspect.test.ts` (new) — 10 tests: input validation (non-object, missing fields, path/extension rejection, identifier acceptance), focused runner (forwards canonical params + project path), renderer (typed postcondition error → `isError`), and four wire-level MCP `tools/list` / `tools/call` tests covering the registry entry, the capability assignment, malformed-className rejection through the server wrapper, and stubbed-runner dispatch.
- `tests/schema-parity.test.ts` — `157` → `158` to reflect the new tool, plus explicit checks that `classdb_inspect` is advertised exactly once and registered with capability `inspect`.
- `README.md` — three explicit `157` count claims updated to `158`; the `Runtime Inspection` table bumped from `(3 tools)` to `(4 tools)` with the new row.
- `docs/maintainers/issue-inventory.md` — `[Coding-Solo#98] ClassDB access` row promoted from `open` to `verified` with a disposition describing the focused module, identifier guard, registry capability and test coverage.

## Verification

- `npx tsc --noEmit`: clean.
- `npm run build`: passed; TypeScript compiled and Godot scripts copied to `build/scripts` (`build/tools/script/classdb-inspect.js` is 3.4 kB).
- `npx vitest run`: 27 files, 606 tests passed (was 596 at the capability-policy commit; +10 from this package). The new file accounts for every test delta; no other file was modified by the worker.
- `npx vitest run tests/classdb-inspect.test.ts tests/schema-parity.test.ts`: 2 files, 13 tests passed.
- `npm audit --audit-level=high`: 0 vulnerabilities.
- `git diff --check`: clean (only LF→CRLF warnings on the edited `.gd` and `.ts` files, as expected for this Windows-rescued checkout under `core.autocrlf=true`).
- `npm pack --dry-run`: 30 files, 133.5 kB packed; `build/tools/script/classdb-inspect.js` is included.
- `comm -23 <(grep -oP "case '\\K[a-z_]+(?=')" src/server.ts | sort -u) <(awk '/^export const LEGACY_TOOL_CAPABILITIES/,/^};/' src/security/legacy-capabilities.ts | grep -oP "^  \K[a-z_]+(?=:)" | sort -u)` returns 0 lines — every legacy `case` literal remains mapped after the registry expansion.

## Next safe action

Commit the in-flight package as one focused commit
(`feat: expose bounded classdb_inspect tool`). Then return to the remaining
open / partial rows in `docs/maintainers/issue-inventory.md`. Candidate follow-ups:

- Real `.tscn` round-trip on a real Godot fixture (closes the remaining `tugcantopaloglu#8` and `#13` evidence).
- Tween `Vector2` / `Vector3` / `Color` regression on a running bridge (`tugcantopaloglu#11`).
- `game_wait` physics-frame verification (`tugcantopaloglu#14`).
- Rate / size / concurrency limits at the gate (the second half of `#97`).