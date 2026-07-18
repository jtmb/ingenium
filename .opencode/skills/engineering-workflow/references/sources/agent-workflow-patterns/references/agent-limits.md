# Agent Concurrency Limits

## 🔴 Canonical Policy: 12 Active / 6 Writers

| Limit | Value | Scope |
|-------|-------|-------|
| **Max active subagents per phase** | 12 | Total subagents spawned simultaneously in a single orchestration phase |
| **Max concurrent writers** | 6 | Subagents holding `edit: allow` or `write: allow` permission |
| **Remaining capacity** | 6 | Reserved for read-only/research/QA/docs/security/browser agents |
| **Write territories** | Exclusive | No two writers may touch the same file path concurrently |

## Writer Classification

A **writer** is any subagent with `edit: allow` or `write: allow` in its permission block:
- `@ingenium-software-engineer-fast` — writer
- `@ingenium-software-engineer-premium` — writer
- `@ingenium-software-engineer-terra` — writer

**Non-writers** (read-only agents — always count toward active limit, never toward writer limit):
- `@ingenium-explore`, `@ingenium-scout`, `@ingenium-qa`, `@ingenium-docs`, `@ingenium-security-auditor`, `@ingenium-prompt-engineer`, `@browser-agent`, `@vision-bridge`

## Mandatory Phase Declarations

Every orchestration phase MUST declare before execution:

1. **Active count** — total subagents to spawn in this phase (max 12)
2. **Writer count** — total writers among them (max 6)
3. **Ownership paths** — each writer's exclusive file/directory territory
4. **Dependencies** — which writers must complete before others start
5. **Verification owners** — which QA/Docs agent reviews which writer's output

## Safe Parallelism Examples

### ✅ Safe — Full parallel (6 writers, non-overlapping territories)

```
Phase: "Implement auth + email + dashboard widgets"
  @ingenium-software-engineer-terra  → packages/ingenium-core/auth/     (writer)
  @ingenium-software-engineer-premium → services/ingenium-api/email/    (writer)
  @ingenium-software-engineer-fast    → services/ingenium-dashboard/components/ (writer)
  @ingenium-software-engineer-fast    → tests/auth/                      (writer)
  @ingenium-software-engineer-fast    → tests/email/                     (writer)
  @ingenium-software-engineer-fast    → tests/dashboard/                 (writer)
  @ingenium-qa                        → review all                       (read-only)
  @ingenium-explore                   → search patterns                  (read-only)
  @ingenium-scout                     → retrieve context                 (read-only)
  @ingenium-docs                      → document                         (read-only)
  @ingenium-security-auditor          → audit                            (read-only)
  @browser-agent                      → visual check                     (read-only)
```

Active: 12, Writers: 6. Non-overlapping territories. ✅

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

### ✅ Safe — 8 writers split across 2 waves

```
Phase: "Multi-package refactor"
  Wave 1:
    @ingenium-software-engineer-terra   → packages/ingenium-core/      (writer)
    @ingenium-software-engineer-premium → services/ingenium-api/       (writer)
    @ingenium-software-engineer-fast    → tests/core/                  (writer)
    @ingenium-software-engineer-fast    → tests/api/                   (writer)
  → QA, verify, docs
  Wave 2:
    @ingenium-software-engineer-fast    → services/ingenium-dashboard/ (writer)
    @ingenium-software-engineer-fast    → packages/ingenium-email/     (writer)
    @ingenium-software-engineer-fast    → tests/dashboard/             (writer)
    @ingenium-software-engineer-fast    → tests/email/                 (writer)
  → QA, verify, docs
```

Wave 1: 4 writers, Wave 2: 4 writers. Never exceeds 6 per wave. ✅

## Territory Reservation Protocol

Before spawning any writer, the orchestrator MUST:

1. **List territories** — enumerate all files/directories each writer will touch
2. **Check conflicts** — cross-reference against already-reserved territories for the current phase
3. **Resolve overlaps** — if overlap detected, serialize writes across waves; document the serialization order
4. **Document assignments** — record territory assignments in the phase declaration

## Collision Resolution

When an emergency requires two writers to touch overlapping areas:

1. **Highest-capability writer resolves** — Terra resolves ahead of Premium; Premium ahead of Fast
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

- **Never exceed 12 active subagents in any single phase**
- **Never exceed 6 concurrent writers per wave**
- **Never overlap write territories** — if two writers touch the same file, serialize them
- **Always declare the phase before executing** — active count, writers, territories, dependencies, verification owners
- **Remaining active slots may be used for read-only agents only** — research, QA, docs, security, browser
- **Duplicate writer instances (same agent type) are valid only for separate territories** — never spawn two Fast instances targeting the same directory
