# Agent Concurrency Limits

## 🔴 Canonical Policy: 6 Active / 3 Writers

| Limit | Value | Scope |
|-------|-------|-------|
| **Max active subagents per phase** | 6 | Total subagents spawned simultaneously in a single orchestration phase |
| **Max concurrent writers** | 3 | Subagents holding `edit: allow` or `write: allow` permission |
| **Remaining capacity** | 3 | Available to non-writer/research/QA agents |
| **Write territories** | Exclusive | No two writers may touch the same file path concurrently |

## Writer Classification

A **writer** is any subagent with `edit: allow` or `write: allow` in its permission block:
- `@ingenium-software-engineer-fast` — writer
- `@ingenium-software-engineer-premium` — writer
- `@ingenium-docs` — writer
- `@browser-agent` — writer

**Non-writers** (read-only agents — always count toward active limit, never toward writer limit):
- `@ingenium-explore`, `@ingenium-scout`, `@ingenium-qa`, `@ingenium-qa-vision`, `@ingenium-security-auditor`

## Mandatory Phase Declarations

Every orchestration phase MUST declare before execution:

1. **Active count** — total subagents to spawn in this phase (max 6)
2. **Writer count** — total writers among them (max 3)
3. **Ownership paths** — each writer's exclusive file/directory territory
4. **Dependencies** — which writers must complete before others start
5. **Verification owners** — which QA/Docs agent reviews which writer's output

## Safe Parallelism Examples

### ✅ Safe — Full parallel (3 writers, non-overlapping territories)

```
Phase: "Implement auth + email + dashboard widgets"
  @ingenium-software-engineer-premium → packages/ingenium-core/auth/     (writer)
  @ingenium-software-engineer-premium → services/ingenium-api/email/    (writer)
  @ingenium-software-engineer-fast    → services/ingenium-dashboard/components/ (writer)
  @ingenium-qa                        → review all                       (non-writer)
  @ingenium-explore                   → search patterns                  (non-writer)
```

Active: 5, Writers: 3. Non-overlapping territories. ✅

### ✅ Safe — Docs and Browser are permission-derived writers

```
Phase: "Implementation + documentation + browser automation"
  @ingenium-software-engineer-fast → dashboard/       (writer)
  @ingenium-docs                   → docs/            (writer)
  @browser-agent                   → browser-recipes/ (writer)
  @ingenium-qa                     → review all       (non-writer)
  @ingenium-explore                → search patterns  (non-writer)
  @ingenium-qa-vision              → visual review    (non-writer)
```

Active: 6, Writers: 3. Docs and Browser count because their permission blocks allow `edit`/`write`; Browser is dispatchable. ✅

### ❌ Conflicting — Overlapping write territories

```
  @ingenium-software-engineer-fast → src/auth.ts (writer)
  @ingenium-software-engineer-fast → src/auth.ts (writer)  ← CONFLICT
```

This must be serialized: one writer completes + verified, then the next begins.

### ✅ Safe — Serialized overlapping writers

```
Phase: "Refactor auth.ts (two sub-changes)"
  Wave 1:
    @ingenium-software-engineer-premium → src/auth.ts (writer, part A)
  → Wait for completion + QA verification
  Wave 2:
    @ingenium-software-engineer-fast    → src/auth.ts (writer, part B)
```

Same file, serialized writes. ✅

### ✅ Safe — 4 writers split across 2 waves

```
Phase: "Multi-package refactor"
  Wave 1:
    @ingenium-software-engineer-premium → packages/ingenium-core/      (writer)
    @ingenium-software-engineer-premium → services/ingenium-api/       (writer)
    @ingenium-software-engineer-fast    → tests/core/                  (writer)
  → QA, verify, docs
  Wave 2:
    @ingenium-software-engineer-fast    → services/ingenium-dashboard/ (writer)
    @ingenium-software-engineer-fast    → packages/ingenium-email/     (writer)
  → QA, verify, docs
```

Wave 1: 3 writers, Wave 2: 2 writers. Never exceeds 3 per wave. ✅

## Territory Reservation Protocol

Before spawning any writer, the orchestrator MUST:

1. **List territories** — enumerate all files/directories each writer will touch
2. **Check conflicts** — cross-reference against already-reserved territories for the current phase
3. **Resolve overlaps** — if overlap detected, serialize writes across waves; document the serialization order
4. **Document assignments** — record territory assignments in the phase declaration

## Collision Resolution

When an emergency requires two writers to touch overlapping areas:

1. **Highest-capability writer resolves** — Premium resolves ahead of Fast
2. **QA verifies the merge** — spawn `@ingenium-qa` to review the combined output
3. **Document the exception** — log the collision, reason, resolution, and verification to pipeline events

## Phase Gates

| Gate | Requirement |
|------|-------------|
| **Pre-execution** | Phase declaration complete (active count, writer count, territories, dependencies, verification owners) |
| **Post-writer** | Each writer's output verified by its assigned QA owner before next wave |
| **Post-wave** | All writers in wave verified; documentation agent spawned |
| **Phase complete** | All waves done; QA + Docs + Security audit complete; summary table produced |

## 🔴 HARD RULEs

- **Never exceed 6 active subagents in any single phase**
- **Never exceed 3 concurrent writers per wave**
- **Never overlap write territories** — if two writers touch the same file, serialize them
- **Always declare the phase before executing** — active count, writers, territories, dependencies, verification owners
- **Remaining active slots may be used for non-writer agents only** — research, QA, or security
- **Duplicate writer instances (same agent type) are valid only for separate territories** — never spawn two Fast instances targeting the same directory
