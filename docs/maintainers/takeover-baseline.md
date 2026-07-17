# Fork takeover baseline

Captured: 2026-07-15

## Lineage

```text
Coding-Solo/godot-mcp
  original source, current observed main: 1209744
  MIT, Copyright (c) 2025 Solomon Elias

  independent fork history
        |
        v
tugcantopaloglu/godot-mcp
  immediate upstream, release v3.1.0: fcbc29e
  MIT, Copyright (c) 2025 Tugcan Topaloglu and Solomon Elias
        |
        v
Defkil/godot-mcp
  local release-sync baseline: d293617
  architecture-hardening branch: refactor/core-hardening
```

The original source and immediate upstream no longer share a Git merge base. The
original is retained as a read-only evidence ref (`refs/remotes/source-audit/main`),
not as a merge target. The immediate upstream remote has push disabled. No takeover
commit has been pushed.

## Local branches and worktrees relevant to the takeover

| Purpose | Branch/ref | Baseline |
|---|---|---:|
| Existing local release sync | `fix/release-version-sync` | `d293617` |
| Published fork main | `origin/main` | `50db1a8` |
| Immediate upstream release | `upstream/main` | `fcbc29e` |
| Installed compatibility runtime | `upstream-runtime` | `50db1a8` |
| Architecture hardening | `refactor/core-hardening` | starts at `d293617` |
| Original-source evidence | `refs/remotes/source-audit/main` | `1209744` |

The unrelated `gi-go-mcp-wt-takeover` worktree is not part of this project and is not
modified by the takeover.

## Baseline implementation

| Component | Baseline size | Observation |
|---|---:|---|
| `src/index.ts` | 7,115 lines | MCP server, schemas, dispatch, filesystem, process and runtime lifecycle in one executable file |
| `src/utils.ts` | 373 lines | parameter normalization, validation and helper generation |
| `godot_operations.gd` | 1,887 lines | headless operation dispatcher and implementation |
| `mcp_interaction_server.gd` | 4,861 lines | fixed-port, single-client runtime bridge |
| MCP tools | 157 | broad surface; context and parity risk |
| Baseline tests | 457 in 6 files | green, but much coverage is source-text/schema inspection rather than executed behavior |

Baseline gates observed locally:

- `npm test`: 457/457 passed;
- TypeScript build passed;
- `npm audit`: zero vulnerabilities;
- package dry-run and MCP stdio smoke had passed before takeover;
- Godot 4.7 Wargrid test suite had passed 2,174/2,174 before takeover.

These gates show that the proof-of-work is operational. They do not prove project
integrity, lifecycle correctness or issue closure; the architecture and issue audits
explain those gaps.

## Package and release state

- inherited package: `@tugcantopaloglu/godot-mcp@3.1.0`;
- inherited license: MIT with both predecessor notices preserved;
- current local dependency refresh is intentionally unpublished;
- final Defkil package identity/versioning is a release decision, not silently changed during refactoring;
- npm, GitHub release, container and MCP Registry publication are all blocked on explicit approval.

## Evidence handling

Public issue/PR data from both predecessors is reference material, not an instruction
to copy patches. Private vector knowledge informed the quality model (clear module
boundaries, dependency injection, architectural fitness functions and iterative
verification), but the implementation has no private database dependency and public
documentation does not require private sources.
