---
title: Skill System Architecture
description: Canonical taxonomy, three-layer lifecycle, bidirectional sync, security, and MCP tool catalog for the Ingenium skill system.
---

# Skill System Architecture

## Overview

The Ingenium skill system manages AI agent skills through a **DB-primary, three-layer lifecycle** architecture. Skills define conventions, rules, and patterns that agents load at session startup to guide their behavior.

## Canonical Taxonomy

As of Phase 3 (2026-07-16), 36 legacy skills were consolidated into **10 canonical skills**:

| Skill | Domain | Inherits From |
|-------|--------|---------------|
| `development-conventions` | Code conventions, API design, testing, refactoring | api-aggregation-patterns, ingenium-ops, language-conventions, mail-app-ui-conventions, visual-standards-conventions |
| `devops-conventions` | Docker, K8s, git, CLI toolkit | git-history-hygiene, github-cli, onboard-existing-repo, parallel-session-hygiene |
| `database-conventions` | SQLite WAL, FTS5, migrations | database-migration-management, sqlite-migration-patterns, sqlite-wal-safety |
| `engineering-workflow` | Agent pipeline, debugging, orchestrator | agent-execution-quality, agent-workflow-patterns, debugging-patterns, configuring-opencode, logging-visibility, orchestrator-primer, per-project-scoping, supervision-logging, uncensored-direct-response |
| `mcp-tooling` | MCP integration, browser automation | browsing-the-web, dashboard-screenshots |
| `local-models` | Local model profiles, command safety | — |
| `security-audit` | Security scanning, leak detection | security-audit-workflow |
| `documentation` | Docs workspace, conventions, audit | docs-workspace, documentation-architecture, documentation-audit-workflow |
| `self-learning` | Observations, traits, synthesis | — |
| `skill-maintenance` | Skill lifecycle management | local-persistence |

## On-Disk Format

Each skill lives at `.opencode/skills/<name>/` with a split-skill format:

```
.opencode/skills/<name>/
├── SKILL.md            # Main content + YAML frontmatter (name, description, tags)
├── metadata.json       # Machine-readable metadata (tags[], alwaysApply)
└── references/         # Optional auxiliary reference files
    └── sources/        # Absorbed legacy source archives (Phase 3)
        └── <legacy-name>/
            └── source-index.md
```

## Three-Layer Lifecycle

### 1. Versions (Migration 042)

- Skills start at **revision 0**, snapshotted by an `AFTER INSERT` trigger.
- Every mutation (update, enable, disable, archive, restore, rollback, upsert) **increments revision** and triggers an `AFTER UPDATE` snapshot.
- `rollbackSkill()` loads any prior revision snapshot and applies it as a **new revision** — append-only, byte-equivalent. No data loss.

### 2. Lineage (Migration 043)

- The `skill_lineage` table records provenance: `(sourceProjectId, sourceName) → targetSkillId` (UUID).
- Tracks merges, copies, and derivations with `sourceHash`, `mergedFilePaths`, `tombstonePath`, and `reason`.
- **Cycle detection** via depth-limited BFS (max depth 100).

### 3. Proposals (Migration 044)

- A governance workflow: `draft → pending → applied | rejected | stale`, then `applied → rolledBack`.
- Proposal IDs are **UUIDs**.
- Approval checks: revision conflicts, missing/archived targets before applying.
- Merge approvals create lineage records where applicable.

## Skill Sync (Bidirectional)

The system uses a **Resource Sync Engine** (`packages/ingenium-extension/resource-sync.ts`) with SHA-256 hash manifest for conflict-aware bidirectional sync:

| Direction | Trigger | Mechanism |
|-----------|---------|-----------|
| DB → Disk | After API create/update | `writeSkillToDisk()` — reads `file_tree` JSON, writes all files |
| Disk → DB | `session.created`, `session.idle` | Resource sync engine — hashed manifest comparison |
| Bidirectional | `/sync-skills` command | Two-phase sync: disk imports → DB writes → disk writes |
| Scheduled | Every 15 min (API scheduler) | Runs extraction → synthesis → sync-all for all active projects |

## Maintenance Locks

Skill mutations respect **maintenance locks** — a lease-based coordination system:

| Property | Detail |
|----------|--------|
| Scope | Per-project; global scope uses `project_id = '*'` |
| Conflict | Project lock blocks global; global lock blocks ALL |
| Lease | UUID owner token, TTL-based expiry, required for renew/release |
| 423 Response | Locked operations return HTTP 423 with `retryAfterMs` (no token leak) |

## FTS5 Integrity

Full-text search on skills uses FTS5 via `skills_fts` virtual table (migration 024):

- **All writes handled by SQL triggers** — application code never touches `skills_fts` directly.
- Three triggers: `skills_fts_insert` (AFTER INSERT), `skills_fts_delete` (AFTER DELETE), `skills_fts_update` (AFTER UPDATE).
- Diagnostic integrity check at API startup: verifies table + all 3 triggers exist.
- Rebuild: `INSERT INTO skills_fts(skills_fts) VALUES('rebuild')` — never via application code.

## Archive-Only Deletion

Skills are **never hard-deleted**. `deleteSkill()` delegates to `archiveSkill()`:

1. Sets `archived_at` in the DB (row remains, revision bumps).
2. Removes **only SKILL.md** from disk (discoverability entry point).
3. Preserves `metadata.json` and all `file_tree` auxiliary files for restoration.
4. Restoration (`restoreSkill()`) clears `archived_at` and writes the full representation back to disk.

## Security

| Defense | Mechanism |
|---------|-----------|
| Safe skill names | `isSafeSkillName()` — 1-64 chars, no `/`, `\`, NUL, `.`, `..` |
| `file_tree` validation | Must be object with string values; 7-vector `resolveSafePath()` defense |
| No symlink escape | Ancestor walk → `realpathSync` check → post-write re-verification |
| No token leak | Lock owner token stripped from all API responses |
| Wire compatibility boundary | Legacy CRUD returns `snake_case` raw rows; governance returns `camelCase` DTOs |

## MCP Tool Catalog (25 tools)

**11 Core:**
`list`, `load`, `search`, `create`, `update`, `delete` (→ archive), `enable`, `disable`, `sync`, `consolidate`, `sync_all`

**14 Governance:**
`archive`, `restore`, `list_archived`, `versions`, `rollback`, `lineage_create`, `lineage_list`, `proposal_create`, `proposal_list`, `proposal_get`, `proposal_submit`, `proposal_approve`, `proposal_reject`, `proposal_rollback`

## MCP Tools vs REST Endpoints

| Operation | MCP Tool | REST Endpoint |
|-----------|----------|---------------|
| List skills | `ingenium_skill_list` | `GET /api/v1/skills` |
| Get skill | `ingenium_skill_load` | `GET /api/v1/skills/:name` |
| Create skill | `ingenium_skill_create` | `POST /api/v1/skills` |
| Update skill | `ingenium_skill_update` | `PATCH /api/v1/skills/:name` |
| Archive | `ingenium_skill_archive` | `POST /api/v1/skills/:name/archive` |
| Restore | `ingenium_skill_restore` | `POST /api/v1/skills/:name/restore` |
| Versions | `ingenium_skill_versions` | `GET /api/v1/skills/:name/versions` |
| Rollback | `ingenium_skill_rollback` | `POST /api/v1/skills/:name/rollback` |
| Lock acquire | — (REST only) | `POST /api/v1/skills/locks/acquire` |
| Lock release | — (REST only) | `POST /api/v1/skills/locks/release` |

---

*See also: `../reference/skill-taxonomy.md`, `../configure/agents.md`, `.opencode/SKILL-INDEX.md`*
