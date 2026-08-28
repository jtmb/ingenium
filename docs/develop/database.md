---
title: Database Migrations
description: Complete reference for SQLite database migrations, WAL safety, PRAGMA management, and manual repair procedures.
---

# Database Migrations Reference

This document is the canonical reference for all SQLite database migrations in the Ingenium project.

## Overview

Migrations live at `packages/ingenium-core/data/migrations/` as numbered `.sql` files. They are applied conditionally by `runMigrations()` in `db.ts` — each checks for an existing table/column/signature before running. Migrations are idempotent and run on every API startup.

**Dockerfile note:** The built image copies `packages/ingenium-core/data/migrations/`
into `/app/packages/ingenium-core/data/migrations/`, so incremental startup can
read packaged migrations; no manual bind or copy is required for the built image.

## Canonical deployed database path

Production Compose sets `INGENIUM_CORE_DB_PATH=/app/.ingenium/data`. This file
is on the `ingenium-data` named volume and uses WAL mode. The resolver normalizes
historical fallback spellings instead of creating a sibling `data.db`; operators
must not manually introduce a second database under `/app/.ingenium/data.db` or
another Compose project volume.

## Migration File List

### Foundation (001–014)

| # | File | Purpose |
|---|------|---------|
| 001 | `001_init.sql` | Core schema: `projects`, `sessions`, `skills`, `plugins`, `servers`, `learnings`, `tasks` tables |
| 002 | `002_archive.sql` | Adds soft-delete support (`archived_at` column) to `projects`; creates `settings` table |
| 003 | `003_agents.sql` | Creates `agents` table with project_id FK, permissions, model config |
| 004 | `004_learnings_status.sql` | Adds `status` column to `learnings` table; creates index on status |
| 005 | `005_skills_metadata.sql` | Adds `tags` and `always_apply` columns to `skills` |
| 006 | `006_skill_file_tree.sql` | Adds `file_tree` column to `skills` for round-trip split-skill persistence |
| 007 | `007_observations.sql` | Creates `observations` table (replaces old learnings system); 10 observation types with CHECK constraint |
| 008 | `008_personality_traits.sql` | Creates `personality_traits` table; 10 trait types with CHECK constraint; FK to observations |
| 009 | `009_pipeline_events.sql` | Creates `pipeline_events` table for observability timeline |
| 010 | `010_commands.sql` | Creates `commands` table for OpenCode slash-command management |
| 011 | `011_server_source.sql` | Adds `source` column to `servers` (default: `'opencode'`) |
| 012 | `012_project_is_global.sql` | Adds `is_global` column to `projects` |
| 013 | `013_fix_plugins_unique.sql` | Rebuilds `plugins` table with `UNIQUE(project_id, name)` instead of `UNIQUE(name)` |
| 014 | `014_configs.sql` | Creates `configs` table for opencode.json content round-trip editing |

### Governance Migrations (020–044)

| # | File | Purpose |
|---|------|---------|
| 020 | `020_kanban_board.sql` | Creates `kanban_boards` and `kanban_columns` tables for task board config |
| 021 | `021_jobs.sql` | Creates `jobs` table with cron scheduling, event triggers, and timeout support |
| 022 | `022_email_cache.sql` | Creates `email_cache` table for IMAP email headers + body caching |
| 023 | `023_fix_servers_unique.sql` | Rebuilds `servers` table with `UNIQUE(project_id, name)` |
| 024 | `024_skills_unique_per_project.sql` | ⚠️ Rebuilds `skills` table to add `UNIQUE(project_id, name)` — resolves 120-error sync storms | **High** |
| 025 | `025_email_string_ids.sql` | ⚠️ Rebuilds email tables with string IDs (Gmail REST API transition) | **High** |
| 026 | `026_email_suggestions.sql` | Creates `email_suggestions` cache table for smart replies |
| 027 | `027_email_summaries.sql` | Creates `email_summaries` cache table for LLM summaries |
| 028 | `028_email_suggestion_queue.sql` | Creates `email_suggestion_queue` for batched suggestion processing |
| 029 | `029_docs_spaces.sql` | Creates `docs_spaces` table for documentation workspace spaces |
| 030 | `030_docs_pages.sql` | Creates `docs_pages` with revision tracking, FTS, and tree hierarchy |
| 031 | `031_docs_pages_fts.sql` | Creates FTS5 virtual table for docs pages full-text search |
| 032 | `032_docs_drafts.sql` | Creates `docs_drafts` table for autosave support |
| 033 | `033_docs_versions.sql` | Creates `docs_versions` for page revision history |
| 034 | `034_docs_tags.sql` | Creates `docs_tags` and `page_tags` for tag management |
| 035 | `035_docs_links.sql` | Creates `docs_links` for inter-page backlinks |
| 036 | `036_docs_comments.sql` | Creates `docs_comments` for threaded page comments |
| 037 | `037_docs_project_links.sql` | Creates `page_projects` for linking pages to projects |
| 038 | `038_docs_attachments.sql` | Creates `docs_attachments` with path traversal prevention |
| 039 | `039_docs_templates.sql` | Creates `docs_templates` for page templates |
| 040 | `040_docs_integrity.sql` | Adds FK + CHECK constraints for docs referential integrity |
| 041 | `041_skill_maintenance_locks.sql` | Creates `skill_maintenance_locks` for concurrent skill maintenance |
| 042 | `042_skill_versions.sql` | Creates `skill_versions` for skill rollback history |
| 043 | `043_skill_lineage.sql` | Creates `skill_lineage` for provenance tracking across merges |
| 044 | `044_skill_proposals.sql` | Creates `skill_proposals` table — governance proposal lifecycle with review/rejection/rollback |

### Critical Migration Sequence (015–019)

| # | File | Purpose | Risk |
|---|------|---------|------|
| 015 | `015_auto_observer_source.sql` | ⚠️ Rebuilds `observations` table to add `'auto-observer'` to the source CHECK constraint | **High** |
| 016 | `016_mcp_tool_states.sql` | Creates `mcp_tool_states` table for per-project tool enable/disable |
| 017 | `017_fix_trait_fk.sql` | ⚠️ Rebuilds `personality_traits` to refresh FK reference to current `observations` table | **Medium** |
| 018 | `018_extraction_pipeline_events.sql` | Adds extraction event types to `pipeline_events` CHECK constraint | **Low** |
| 019 | `019_trait_exemplar_fk_setnull.sql` | Changes FK to `ON DELETE SET NULL` | **Low** |

---

### Feature Migrations (045–101)

| # | File | Purpose |
|---|------|---------|
| 045 | `045_pipeline_event_types.sql` | Adds `skill_created`, `skill_updated`, and proposal event types to `pipeline_events` CHECK constraint |
| 046 | `046_vault.sql` | Creates `vault_config`, `vault_folders`, `vault_items`, and `vault_audit_log` — encrypted secrets vault with scrypt key derivation, AES-256-GCM envelope encryption, and full audit trail |
| 047 | `047_backups.sql` | Creates the legacy `backup_records` and `backup_restore_jobs` storage. RESTORE-100's signed v2 compatibility and immutable approval flow are defined by migration 083, not this legacy inventory. |
| 048 | `048_docs_rag.sql` | Creates the original RAG tables, FTS5 index, embeddings, ingestion state, and a legacy import checkpoint table |
| 049 | `049_workspace_project_migration.sql` | Creates `project_migration_manifests` audit table — transactional DB-only migration of historical `/workspace` project into `global-default` with hash verification, child row protection, and rollback safety |
| 050 | `050_context_rag_phase3.sql` | Adds `source`, `metadata`, `updated_at` to `context_entries` with source CHECK constraint and index; adds unique index `idx_rag_sources_project_path` for canonical path-based idempotency in `rag_sources` — Phase 3 context/RAG ingestion and validation |
| 051 | `051_thread_retirement.sql` | Removes the verified-empty legacy checkpoint table and rebuilds `rag_sources` without the retired source type; the runner refuses non-zero legacy data before schema changes |
| 052 | `052_agent_category_integrity.sql` | Normalizes historical agent categories and adds a `CHECK(category IN ('primary','execution','research','security','chat'))` constraint via the `RENAME → CREATE → COPY → DROP` safe pattern; adds `chat` to the Zod schema enum; updates `enabled`-aware agents tooling with safe-name validation and `opencode.json`-based runtime model assignment — disabled agents are excluded from disk writes |
| 053 | `053_global_project_integrity_and_protected_settings.sql` | Enforces at most one active global project and creates protected settings metadata for vault-backed OAuth application secrets |
| 054 | `054_agent_frontmatter_metadata.sql` | Adds persisted agent metadata; backfills `ingenium-llm-broker` to exact `hidden: true` and `{"*":"deny"}` state, then installs `AFTER INSERT`/`AFTER UPDATE` triggers that retain those reserved fields across direct persistence writes. Agent lifecycle code separately refuses broker deletion. |
| 055 | `055_reserved_broker_delete_protection.sql` | Adds a `BEFORE DELETE` trigger that rejects direct deletion of the reserved broker while its project row exists. Normal project deletion remains child-safe: Ingenium refuses projects with child rows before the parent delete, so the trigger does not replace or bypass project lifecycle checks. |
| 056 | `056_reserved_broker_rename_protection.sql` | Adds a `BEFORE UPDATE OF name` trigger that rejects direct renames of `ingenium-llm-broker`, preventing a low-level SQL write from bypassing the canonical broker invariant and escaping under a permissive new name. |
| 057 | `057_reserved_broker_immutable.sql` | Historical broker immutability migration. It remains in the upgrade sequence for prior installations; migration 058 supersedes its recursive-trigger-dependent protections. |
| 058 | `058_reserved_broker_connection_independent.sql` | Backfills every broker to the exact canonical bootstrap template and installs non-recursive `BEFORE INSERT`/`BEFORE UPDATE` collision and immutable guards. `INSERT OR REPLACE` and `UPDATE OR REPLACE` are rejected even when a raw SQLite connection has `recursive_triggers=0`. Only the dedicated internal core bootstrap emits the admitted template; public API and resource sync cannot provision a broker. |
| 059 | `059_repository_docs_onboarding.sql` | Creates repository-authoritative Docs page identity metadata that survives archive and later reappearance. |
| 060 | `060_repository_resource_sync.sql` | Creates repository-authoritative synchronization state for skills, agents, and plugins, including semantic payload and source hashes. |
| 061 | `061_global_backup_ownership.sql` | Creates an idempotent migration marker and backfills legacy backup records and restore jobs to the sole active global project. Startup retries the backfill after global-project initialization. |
| 063 | `063_immutable_context_conversations.sql` | Creates immutable project-scoped conversations, messages, checkpoints, checkpoint RAG links, the message FTS5 index, scoped foreign keys, indexes, and immutability triggers. |
| 064 | `064_child_mcp_tool_categories.sql` | Rebuilds child MCP discovery metadata so category values are server-specific. |
| 065 | `065_context_rag_ingestion.sql` | Creates project-scoped direct/chunked context-upload state and durable provenance rows, freezes checkpoint-linked RAG sources/chunks, and stores immutable checkpoint citation snapshots. |
| 066 | `066_context_checkpoint_governance.sql` | Creates short-lived, one-time project-scoped maintenance authorizations plus append-only archive/unarchive/restore-as-new audit records. Archive state is derived from events; checkpoints are never deleted. |
| 067 | `067_context_migration_repair.sql` | Repairs recoverable legacy or partial 063 shapes before 065/066 are evaluated. The runner projects rows into canonical staging tables in one transaction, restores indexes/FTS/triggers/foreign keys, validates integrity, and records only a content-free schema hash plus row counts in `context_migration_repairs`. |
| 068 | `068_usage_telemetry.sql` | Creates metadata-only provider-neutral usage events, explicit OpenCode-to-Ingenium project mappings (including unmapped quarantine), and per-project composite usage sync state. Events preserve raw provider/model IDs, nullable assistant-agent attribution, and numeric reasoning-token metadata. They have a replay-safe `(source_instance, source_part_id)` key and contain no message text, reasoning content, tool payload, credential, or raw payload columns. |
| 078 | `078_usage_advisory_thresholds.sql` | Creates one restrictive-FK, project-scoped advisory threshold row with nullable request, total-token, provider-reported-cost, and cache-token thresholds plus CAS revision and UTC audit timestamps. SQL checks reject negative, non-numeric, non-finite, and unsafe values. Thresholds contain no provider, currency, price, or time-window data and do not enforce usage routing or execution. There is no public delete operation: setting every threshold to `null` retains the row and its audit/revision history. |
| 079 | `079_usage_attention_items.sql` | Creates project-scoped, all-history usage attention lifecycle items and immutable transition events. The five fixed condition keys cover request count, total tokens, provider-reported cost, cache-read tokens, and cache-write tokens. Rows retain only bounded advisory metadata, fixed message codes, CAS revisions, UTC lifecycle timestamps, and a fixed `NULL` all-history range; they contain no provider, source, payload, free-text, or JSON fields. |
| 080 | `080_job_vault_references.sql` | Creates metadata-only job-to-vault authorization references and immutable authorization/revocation audit rows. References are project-scoped composite keys, target only active same-project vault items, are capped at 16 authorized items per job, and remain available as provenance when a job or vault item is soft-deleted. |
| 081 | `081_vault_job_runs.sql` | Creates metadata-only durable vault-job run provenance and immutable item snapshots. It persists only project/job/run identifiers, a deadline, nonce hash, verified process identity, state/CAS revision, and authorization versions—never secret values, paths, config, or plaintext nonces. |
| 082 | `082_job_vault_revision_audit.sql` | Adds default-zero, strictly monotonic job revisions for CAS updates and immutable, exact project/job/run-linked vault runtime audit rows. The runtime audit records only fixed action/category/ID/version/timestamp metadata; it has no names, detail, plaintext, configuration, or actor-string linkage. |
| 083 | `083_restore_plans.sql` | Creates RESTORE-100's immutable server-global plan identities, append-only transition revisions, one-time hash-only confirmation authorizations, append-only stage records/events, and bounded idempotency receipts. SQL triggers enforce preview → authorize → confirm → ready plus the stage-integrity failure path; ready requires a consumed authorization and a component-hash-bound verified stage. Restrictive composite foreign keys prevent deleting a planned source bundle. No trigger or table authorizes active-database replacement; execution is RESTORE-101 scope. |
| 084 | `084_restore_executor.sql` | Adds RESTORE-101's separately authorized 15-minute execution token, queued run/item ledger, hash-only owner/fence evidence, phase-CAS state graph, bounded idempotency receipts, immutable execution audit, and the RESTORE-100 authorization-ID immutability correction. It is all-or-nothing at startup; partial execution inventory fails closed. |
| 096 | `096_resource_ownership.sql` | Adds resource grants/audit, explicit organization/user ownership for vault folders/items, provider connections/model policies, immutable ownership guards, and an immutable bounded-count/exact-ID manifest. Existing encrypted vault material is not decrypted or re-encrypted. |
| 097 | `097_mail_tenancy.sql` | Adds owned mail accounts, separately encrypted credential rows, organization-qualified consume-once OAuth attempts and mail cache state, scope/FK triggers, and an immutable bounded-count/exact-account-ID manifest. Existing account IDs, ciphertext, folder names, and cache identity are preserved. |
| 098 | `098_content_tenancy.sql` | Adds organization-rooted Docs, authorization-scoped RAG visibility, immutable context ownership, private-by-default observations/personality, bounded pipeline scope, normalized content shares, content-free audit, child-scope triggers, and an immutable ID/hash/count manifest. Partial state is refused by startup probes. |
| 099 | `099_automation_tenancy.sql` | Adds immutable organization/project automation ownership, service principals, execution grants, event provenance, scheduler fairness, and migration evidence. |
| 100 | `100_mcp_credentials.sql` | Adds AUTH-107 hash-only MCP/service/runtime/repository-sync credentials with mandatory audience, scope, organization/project grants, workspace/worktree, expiry, service-principal security epoch, rotation/revocation, last-used metadata, and immutable SQL guards. |
| 101 | `101_runtime_isolation.sql` | Adds AUTH-108 authorized-workspace mappings, one runtime per workspace, revisioned runtime lifecycle/leases/limits, runtime capability bindings, hash-only one-time audience launch tickets, append-only activity, exact-schema probes, and verified backfill evidence. |
| 102 | `102_runtime_browser_sessions.sql` | Adds AUTH-109 runtime browser generations, exact auth-session/workspace/runtime/audience/origin/host hash-only launch tickets, and hash-only revocable browser sessions with one-time consumption and generation invalidation. |
| 103 | `103_runtime_browser_launcher_origin.sql` | Persists the authenticated dashboard launcher origin on new runtime browser sessions, backfills matching live sessions from consumed launch tickets, and revokes unmatched legacy sessions so gateway CSP and health responses can allow only the originating dashboard. |

Migration 095's AUTH-103 upgrade replaces the invitation consume-once trigger so
a pending invitation may transition exactly once to either accepted or revoked.
Existing AUTH-101 databases receive the guarded trigger-only upgrade; fresh and
AUTH-100 upgrade paths install the same canonical definition directly.

### Mail watcher durability migration (092)

| # | File | Purpose |
|---|------|---------|
| 092 | `092_email_watcher_markers.sql` | Creates durable IMAP watcher duplicate-suppression markers keyed by `project_id`, `account_id`, `folder`, and `uid`; enforces bounded text fields, a project foreign key with cascade cleanup, uniqueness for each scoped UID, and the newest-marker index used for retention. |

Migration 092 is applied after migration 091 on both fresh and existing databases.
The marker table retains the newest 4,096 rows per `(project_id, account_id,
folder)` scope; the core `remember()` operation claims or refreshes a marker and
prunes older rows in one transaction, then checkpoints after commit. The unique
scope makes concurrent claims deterministic: one caller records a new marker and
later callers observe it as already processed. `clearAccount()` removes all
markers for one project/account when an email account is deleted. The startup
probe requires the complete table, constraints, project foreign key, and
`idx_email_watcher_markers_scope_newest` index; a partial 092 shape fails closed
rather than being repaired piecemeal. This schema/runtime hardening adds no MCP
tool; the built-in catalog count is unchanged.

Migration 078 adds `usage_advisory_thresholds`, keyed one-to-one by
`project_id` with `ON DELETE RESTRICT`. Its five nullable fields are
`request_count`, `total_tokens`, `reported_cost_amount`, `cache_read_tokens`,
and `cache_write_tokens`; `revision`, `created_at`, and `updated_at` provide
optimistic CAS and UTC audit evidence. A replacement must match the current
revision and increments it; setting all fields to `NULL` disables comparison
without deleting history. The table contains no currency, provider, pricing,
period, credential, or enforcement fields.

Core evaluation reads existing usage aggregates without writing threshold,
event, mapping, or `usage_sync_state` rows. It accepts either both UTC `from`
and `to` bounds (inclusive/exclusive, at most 366 days) or neither for explicit
all-history evaluation. Known zero, partial subtotal, and unavailable subtotal
remain distinct; only known values can compare as below/equal/above.

Migration 079 reconciles the existing explicit all-history evaluation into one
stable condition per metric. `unknown` is active/info, `equal` is
active/warning, and `above` is active/critical; `disabled` and `below` resolve
an existing item and do not create a new one. Reconciliation never changes the
usage ledger, thresholds, project mappings, or sync state. Numeric drift within
the same active evaluation state does not create a transition event, while an
evaluation/severity/freshness-class or threshold-revision change does. Acknowledge
uses item revision CAS; replays are idempotent, active changes clear an
acknowledgement, resolving preserves it, and reopening clears it and increments
the reopen count.

The API scheduler invokes this reconciliation for every mapped project on the
`USAGE_SYNC_INTERVAL_MS` cadence (five minutes by default), after the bounded
metadata-only usage collector. Failed or no-new-data cycles still evaluate
freshness; `USAGE_SYNC_INTERVAL_MS=0` disables both scheduled usage sync and
attention evaluation. The public surface is the bearer-authenticated,
project-scoped REST list/evaluate/ack contract; migration 079 adds no MCP
surface and no request-execution enforcement.

Attention freshness is source-backed rather than event-backed: an interval of
zero disables scheduled usage sync and attention evaluation; otherwise every
mapped source for the project must have `usage_sync_state.last_successful_sync_at`.
Missing successful evidence makes freshness `unknown`; any source older than
twice the configured interval makes it `stale`; only when every mapped source
is within that bound is it `fresh`. A no-new or failed usage-sync cycle still
runs this reconciliation for active mapped projects, so stale state advances
without inferring successful sync from usage-event recency.

### Coordination Migrations (073–075)

| # | File | Purpose |
|---|------|---------|
| 073 | `073_task_coordination.sql` | Adds project-scoped task revision/CAS state, available/reserved/quarantined reservation state with owner/worktree consistency triggers, and immutable request-hash idempotency receipts. Existing tasks remain compatible at revision 0 and `available`. |
| 074 | `074_task_reservation_tokens.sql` | Adds the reservation-token hash column and transactionally quarantines legacy non-available reservations because they cannot prove possession of a caller-held token; replaces the reservation consistency triggers accordingly. |
| 075 | `075_coordination_registry.sql` | Adds durable project/worktree/session/incarnation coordination registries, monotonic worktree fences, hash-only ownership tokens, revision/CAS receipts, exact atomic claims with optional baselines and retained states, bounded snapshots, project-composite task/context pointers, and immutable receipt-update protection. |

### Trusted Job Event Migration (076)

| # | File | Purpose |
|---|------|---------|
| 076 | `076_trusted_job_events.sql` | Creates durable, project-scoped, append-only trusted job events for the three Context maintenance audit producers. Payloads are content-free, bounded JSON tied by FK and trigger to their immutable source audit row. Existing arbitrary `jobs.trigger_event` values are preserved; SQL triggers constrain only new job rows and actual trigger changes to the trusted catalog or `NULL`. |

Migration 076's exact v1 catalog is `context.conversation.archived`,
`context.conversation.unarchived`, and `context.checkpoint.restored_as_new`.
Archive/unarchive payloads contain only `conversationId`, `expectedRevision`,
and `archiveSequence`; restore payloads contain only source conversation,
source checkpoint, target conversation, and expected revision identifiers.
`source_audit_event_id` is an immutable Context audit FK and the project-local
dedupe identity. Payload and provenance triggers reject unknown, oversized, or
forged direct-SQL inserts. Trusted event rows cannot be updated or deleted and
have indefinite retention until an explicit authorized project lifecycle
action. No user append endpoint exists. JOB-101 snapshots each event once,
including zero-match snapshots, and fans out only to enabled same-project jobs
with an exact `trigger_event` match. Delivery state is bounded to five attempts
with 30/60/120/300/600-second backoffs; leases store only an owner hash and CAS
revision. Attempt provenance stores only process identity needed for proof
(PID/PGID, start time, executable, and a nonce hash). An incomplete or
ambiguous identity is dead-lettered rather than duplicated.

### Job Event Delivery Migration (077)

| # | File | Purpose |
|---|------|---------|
| 077 | `077_job_event_deliveries.sql` | Adds the durable, project-scoped trusted-event snapshot marker, exact-match delivery queue, hash-only leases, and per-attempt process provenance. Existing jobs, runs, and logs are preserved; legacy runs are backfilled with their owning project. Deleting a job disables and hides it while preserving FK-backed delivery history, with unfinished deliveries terminally dead-lettered. |

Migration 077 snapshots each trusted event once, including zero-match snapshots,
then fans it out only to enabled jobs in the same project whose `trigger_event`
exactly matches the event type. It uses a unique project/event/job delivery key,
five-attempt bounded retry states, and a hash-only lease owner. Event attempt
provenance stores only PID/PGID, start time, executable, and a SHA-256 process
nonce hash; it never stores a payload, prompt, environment, or plaintext token.
Incomplete 077 schemas fail closed at startup rather than resuming an ambiguous
lease or duplicating execution.

### Security Audit Project History Migration (104)

| # | File | Purpose |
|---|------|---------|
| 104 | `104_security_audit_project_history.sql` | Retains immutable security-audit project UUIDs as historical references after an otherwise-empty project is purged. New audit rows still require an existing project in the same organization; ordinary project child rows continue to block purge. |

Migration 104 is the forward-compatible continuation of the migration 095
security-audit schema. It changes only the lifetime of the project reference:
existing audit rows keep their `project_id` after the project row is deleted,
while a newly written row carrying both `organization_id` and `project_id` must
still refer to a live project in that organization.

#### Pre- and post-104 schema

Both versions retain the following common columns and checks:

- `id TEXT PRIMARY KEY CHECK(length(id) = 36)`
- `actor_type TEXT NOT NULL CHECK(actor_type IN ('compatibility', 'user', 'service', 'system'))`
- nullable `actor_id` bounded to 1–128 characters
- non-empty, 1–128-character `action`
- `organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT`
- `outcome TEXT NOT NULL CHECK(outcome IN ('success', 'denied', 'failure'))`
- `metadata_json TEXT NOT NULL DEFAULT '{}' CHECK(metadata_json = '{}')`
- non-empty, 1–64-character `created_at`

The schema delta is intentionally limited to `project_id` and the objects
recreated around the table:

| Element | Pre-104 (migration 095) | Post-104 |
|---|---|---|
| `project_id` | `TEXT REFERENCES projects(id) ON DELETE RESTRICT` | `TEXT` with no foreign key to `projects` |
| `organization_id` | Foreign key to `organizations` with `ON DELETE RESTRICT` | Unchanged |
| Scope index | `idx_security_audit_scope` on `(organization_id, project_id, created_at DESC, id DESC)` | Same index definition, recreated |
| Audit triggers | Immutable update, immutable delete, and project/organization insert guard | Same three triggers plus the primary-key collision guard, recreated |

The project/organization insert trigger remains the write-time guard. When both
values are non-null, it requires a row satisfying
`projects.id = NEW.project_id AND projects.organization_id = NEW.organization_id`
and aborts with `security audit project must belong to organization` otherwise.
Projectless rows remain allowed because this trigger is conditional on both
values being present.
The immutable update and delete triggers continue to abort with
`security audit events are immutable`.
The `security_audit_events_primary_key_collision` trigger rejects a duplicate
event ID before SQLite can apply `INSERT OR REPLACE`, preserving the original
immutable row whether `recursive_triggers` is enabled or disabled.

#### Row, foreign-key, and trigger preservation

SQLite cannot remove this foreign key with a column-level `ALTER TABLE`, so the
migration uses `BEGIN IMMEDIATE` and `COMMIT` around a table rebuild:

1. Drop the three pre-104 audit triggers and `idx_security_audit_scope`
   temporarily.
2. Rename the old table to `security_audit_events__project_fk`.
3. Create the post-104 table and copy all nine columns from the old table with
   no filtering or value transformation.
4. Drop the temporary table, then recreate the scope index, the three pre-104
   audit triggers, and the primary-key collision trigger.

Thus existing rows—including null or historical `project_id` values—are
preserved as the same column values, without filtering or transformation. The
organization foreign key remains restrictive; only the project foreign key is
removed. The startup runner checks `PRAGMA foreign_key_check` after the rebuild
and refuses the result if any violation remains.

#### Project-purge retention

`projectChildTables()` intentionally excludes `security_audit_events` from its
scan of tables that contain `project_id`. Consequently:

- `purgeExpiredProjects(retentionDays)` considers only archived projects whose
  `archived_at` is older than the retention cutoff, skips a project when any
  other project-scoped child table still has rows, and then deletes the project;
  retained security-audit rows do not block that purge.
- The API retention endpoint defaults omitted `retention_days` to 7 days and
  accepts an integer from 0 through 3,650. The explicit
  `DELETE /api/v1/projects/:name/purge` path uses the same child-row exclusion
  without the scheduled age filter.
- After the project delete, its audit rows remain with the historical UUID.
  The `organization_id` foreign key is still `ON DELETE RESTRICT`, so the
  retained history continues to protect its organization row.

#### Exact startup guard and idempotent reopen

Before deciding whether to run the file, `runMigrations()` executes this exact
probe:

```sql
SELECT count(*) AS count
FROM pragma_foreign_key_list('security_audit_events')
WHERE "from" = 'project_id' AND "table" = 'projects';
```

- If the count is greater than zero, the project foreign key is still present
  and `104_security_audit_project_history.sql` is executed. The runner then
  re-probes the complete authorization/audit schema and runs
  `PRAGMA foreign_key_check`; an incomplete schema or any violation raises the
  migration-104 partial-state error. If the SQL rebuild itself fails while its
  `BEGIN IMMEDIATE` transaction is still open, the runner rolls it back; a
  post-`COMMIT` validation failure fails closed and requires schema recovery.
- If the count is zero, the table-rebuild SQL is not rerun. The
  authorization/audit probe must still find the five required tables
  (`installation_admins`, `service_principals`, `scoped_api_tokens`,
  `organization_invitations`, and `security_audit_events`), their required
  columns, the four required indexes, the eight required authorization/audit
  triggers, and definitions matching the expected migration chain
  (`095_authorization_audit.sql` followed by
  `104_security_audit_project_history.sql`).
- One compatibility exception upgrades an exact legacy post-104 schema whose
  only gap is the absent `security_audit_events_primary_key_collision` trigger.
  The audit table, index, foreign keys, checks, and three prior audit triggers
  must match exactly, with no alternate audit trigger. The runner applies
  `104_security_audit_project_history_collision_upgrade.sql` in a transaction,
  re-probes the complete schema and foreign keys before commit, and invokes the
  WAL checkpoint helper after the transaction. Rows are not rebuilt or copied.
  Any near match fails closed without mutation.

Other missing or mismatched components fail closed with:

  ```text
  Migration 104 is in a PARTIAL state. Missing required components: ... Restore the migration's complete schema before retrying.
  ```

The earlier migration-095 probe runs before this branch, so an incomplete
authorization schema that does not match the narrow compatibility exception is
rejected as migration 095 rather than repaired by 104.

This zero-project-FK branch is what makes a successful 104 upgrade idempotent
on reopen: it verifies the post-104 shape instead of rebuilding the table again.
The SQL file has no `IF EXISTS` recovery path, so operators must not hand-edit a
partial table or rerun the file against an incomplete schema.

#### Backup and rollback guidance

Create and retain a consistent backup before applying 104. In WAL mode, use the
SQLite Backup API or the documented [Backup and Restore Procedures](../operations/backup-restore.md);
do not copy only the main database file while `data-wal` may contain committed
writes. If a file-level backup is unavoidable, preserve `data`, `data-wal`, and
`data-shm` together.

A failure during the 104 SQL rebuild is rolled back by its transaction; preserve
the startup error and restore the migration's complete schema before retrying
rather than dropping audit objects or deleting history manually. Migration 104
has no in-place down step. To reverse a committed database state, use the supported
verified backup restore flow—preview, authorize, confirm, then execute—rather
than copying snapshot files over a live WAL database. Run `PRAGMA integrity_check`
and `PRAGMA foreign_key_check` after recovery and keep the pre-migration backup
until those checks and API health verification pass.

> **Release boundary:** This section documents migration 104 schema behavior
> only. It does not claim AUTH-102 or AUTH-103 release completion.

### Job Vault Reference Migration (080)

Migration 080 stores `job_vault_references` as a normalized `(project_id,
job_id, item_id)` authorization record. Runtime and SQL triggers limit each job
to 16 authorized vault items and reject missing, foreign-project, or soft-deleted
items. The reference DTO is metadata-only: item ID, authorization timestamp,
 authorized item version, and a sealed-independent `authorized`,
 `version_stale`, or `unavailable` status. It never joins encrypted vault
material or user-controlled vault metadata.

`job_vault_reference_audit` is append-only UUID provenance for only
`authorized` and `revoked` transitions. It stores the fixed
`authenticated_api` actor plus project/job/item/version/timestamp fields; it
has no free-text, JSON, item-name, or ciphertext columns. Vault deletion remains
a source-aligned soft delete, so references and audit evidence are retained and
the reference is reported unavailable rather than cascaded away.

The runtime contract accepts optional `vault_item_ids` on job create/update:
omission means no references on create and preserves the set on update, a list
replaces the set, and an empty list revokes all. SQL and core validation cap the
set at 16 unique IDs and require active same-project vault items. Resolution is
metadata-only and remains available while sealed; the reference projection is
 limited to item ID, `status`, authorization timestamp, and
 `authorized_item_version`
captured at authorization. No encrypted value, vault metadata, decrypt/unseal
operation, runner input, or log secret is involved.

### Vault Job Run Migration (081)

Migration 081 records a vault-backed run before tmpfs files or a child process
are created. `job_vault_runs` is a constrained state machine
(`prepared → spawned → teardown_pending → cleaned|failed`) with a monotonically
advancing revision; a retained failed run may return to `teardown_pending` for a
later cleanup attempt. Process identity is write-once after capture, while
`job_vault_run_items` snapshots the exact authorized item IDs and versions
immutably. Recovery uses these snapshots rather than current mutable job
references.

The schema intentionally contains no plaintext secret, filesystem-path,
OpenCode-configuration, or plaintext-nonce column. A SHA-256 nonce hash is the
only nonce evidence. The API runner verifies tmpfs teardown before marking a run
cleaned; an unsafe or ambiguous directory/process state remains retained for a
subsequent startup or scheduler retry.

### Job Vault Revision and Audit Migration (082)

Migration 082 gives every existing and new job revision `0` and requires every
direct SQL update to advance that revision by exactly one. The core PATCH path
matches the caller's expected revision, changes ordinary job fields and any
reference replacement in one transaction, then returns either the updated job
or a typed current-revision conflict. Soft deletion remains an in-place,
revisioned history-preserving transition. The dashboard preserves its draft on
`JOB_REVISION_CONFLICT` and only replaces it after an explicit reload.

`job_vault_runtime_audit` separates runtime evidence from the general vault
audit log. It accepts only `secret_read` with an item/version or
`access_denied` without one, and its foreign keys plus exact-match trigger
require the same project, job, and run. The combined job audit projection is a
bounded keyset page with only ID, job ID, nullable item ID, action, actor
category, nullable run ID, nullable version, and timestamp. It stores and
returns no names, free text, ciphertext, plaintext, or parsed actor strings.
Authorization and revocation remain immutable metadata-only audit actions from
the normalized reference audit.

Migration 074 is a transactional legacy quarantine, not a token recovery path:
reservation tokens are caller-held opaque values, and only their SHA-256 hashes
are persisted. The coordination boundary does not promise protection from manual
editor or external-process writes.

### Restore executor migration (084)

Migration 084 does not alter migration 083's source file or make a legacy
confirmation token executable. It adds a separate `execute_restore`
authorization bound to the ready plan revision, manifest hash, plan hash, and
stage hash. The token is stored only as a hash, is consumed once, and expires in
15 minutes. Consumption creates a queued run; it does not replace either active
database.

Runs retain only IDs, hashes, bounded state/error codes, timestamps, and an
optional pre-restore safety-backup ID. Items record expected and write-once
pre/post hashes. SQL enforces phase revision CAS, one run per plan, immutable
identity/receipts/events, owner/fence hashes after claim, and the fixed graph
from queued through completion or rollback, including terminal
`executor_start_failed` for a rejected Supervisor handoff. Existing restore
authorization IDs are now immutable during their sole allowed `consumed_at`
update. Queue insertion requires an unexpired, consumed authorization bound to
the plan revision, manifest hash, plan hash, and verified stage hash; swapping
requires both pre-hashes and completion requires both post-hashes.

The compiled static `restore-maintenance` supervisor program is the only
executor. It runs as root and uses a separate root-only HMAC journal key and
mode-`0700` maintenance root, while the API only persists queue/start outcomes.
It verifies descriptor holders by device/inode after all users stop, locks both
target parent directories during the swap, snapshots the current pair before
replacement, and archives terminal signed journals. A partial 084 schema is
refused at startup rather than resumed or repaired by a live service.

### Restore-time capability invalidation (RESTORE-103)

The executor read-only validates the staged database before stopping users: only
a complete contiguous migration-093-through-102 lineage is accepted, and 093 is
the exact supported minimum. Migration 093's `users.updated_at` belongs to the
identity baseline and does not make authentication migration 094 partial. Any
partial group or later generation after an absent predecessor fails before swap.
After swap, a separate maintenance-only Core connection applies exactly the
missing guarded 094–102 SQL files, then requires `PRAGMA integrity_check = ok`
and an empty `PRAGMA foreign_key_check`. It does not call ordinary
`runMigrations`; the API remains stopped until upgrade and invalidation finish.
After capsule rehydrate, one `execTransaction` revokes/consumes restored token,
session, ticket, invitation, reservation, and coordination ownership state;
increments user, service-principal, workspace/runtime, and browser generations;
and inserts exactly one `restore.tokens_invalidated` security audit plus one
completed `capsule` phase event. Both records are content-free and immutable.
The checkpoint remains outside the transaction. Replay observes the paired audit
records and does not advance generations twice.

The transaction does not update `password_credentials`, `auth_identities`,
`auth_totp_factors`, `auth_recovery_codes`, mail account credentials, or content
tables. Audit failure rolls back the invalidation transaction and leaves the
signed external journal below `rehydrated`; pair rollback and a later recovery
pass terminalize the run before database users start.

Migration 075 is guarded as none/all/partial: when no coordination components
exist, the migration runs transactionally; when the complete schema exists, it
is skipped; any partial schema fails closed with no repair or partial startup.
Its transaction begins with `BEGIN IMMEDIATE` and commits only after all tables,
indexes, foreign keys, checks, and the immutable receipt trigger are created.

*See the companion file at `packages/ingenium-core/data/migrations/` for individual migration SQL.*

The reserved broker is normalized at database startup and remains enabled; it
does not support the ordinary lifecycle. Resource sync accepts an API broker
only after every material field matches the static canonical template, then
rewrites the static disk profile. Disk-only or arbitrary API broker content is
quarantined. Do not repair this profile by editing markdown or issuing direct
SQL.

## 🔴 WAL Safety — checkpointAfterWrite Outside Transaction

`checkpointAfterWrite()` must never be called **inside** `execTransaction()`. Calling checkpoint inside a transaction causes `SQLITE_LOCKED`.

```typescript
const result = execTransaction(() => {
  // All DB writes inside the transaction
  db.prepare("UPDATE ...").run(...);
  return value;
});
checkpointAfterWrite();  // ← ALWAYS outside, after the transaction commits
return result;
```

## Safe Migration Pattern (RENAME → CREATE → COPY → DROP)

SQLite does not support `ALTER TABLE DROP CONSTRAINT`. When a migration needs to change a constraint, the standard pattern is:

```sql
PRAGMA foreign_keys = OFF;
ALTER TABLE existing_table RENAME TO existing_table_old;
CREATE TABLE existing_table (...);
INSERT INTO existing_table (...) SELECT ... FROM existing_table_old;
DROP TABLE existing_table_old;
PRAGMA foreign_keys = ON;
```

The Phase 4 mail-account migration is all-or-nothing: it resolves the active
global project, verifies encryption continuity, copies each account's complete
setting group, byte-verifies the destination, and only then deletes source rows.
Collisions remain in the source project for review; failed writes retain source
settings. A key mismatch or unavailable key skips migration without modifying
encrypted mail data.

## 🔴 Email FK Defensive Pattern

Any upsert function that writes to a FK-constrained child table must check for the parent row **before** inserting:

```typescript
const parent = db.prepare(
  "SELECT 1 FROM email_cache WHERE account_id = ? AND folder = ? AND uid = ?",
).get(accountId, folder, uid);
if (!parent) return; // parent removed — skip silently
```

## Manual DB Repair

### G3 context migration repair (067)

Migration 067 is a **forward-only** startup repair for incomplete migration-063
schemas. It is not a data reset and does not delete conversation, message,
checkpoint, or checkpoint-RAG-link rows: rows are copied to canonical staging
tables, source tables are replaced only after every copied row satisfies the
target constraints, then the transaction verifies `PRAGMA integrity_check` and
`PRAGMA foreign_key_check` before it commits. It runs before the normal 065 and
066 probes so their dependent context tables can be applied afterward.

The repair can fill only data that was absent because of the partial schema:
missing hashes are deterministically generated, missing JSON metadata/tags use
the schema defaults, missing sequences/ordinals receive stable values, and a
missing link project is derived from its checkpoint. It refuses rather than
guessing when project ownership, message/checkpoint linkage, required content,
or a target uniqueness/constraint cannot be preserved. It also refuses a
pre-existing integrity or foreign-key failure that is unrelated to the temporary
partial-063 parent-key mismatch.

#### Operator preflight

Do not run the application against a production database until a maintenance
window has prevented competing writers. These commands are examples for an
operator with the `sqlite3` CLI; they are not executed by the migration itself.

```bash
# Point this at the single canonical database file, never at a new sibling .db.
DB_PATH="/app/.ingenium/data"

# Capture the current health and the context schema signature before startup.
sqlite3 "$DB_PATH" "PRAGMA integrity_check; PRAGMA foreign_key_check;"
sqlite3 "$DB_PATH" \
  "SELECT type, name FROM sqlite_master WHERE name LIKE 'context_%' ORDER BY type, name;"
```

`integrity_check` must return only `ok`; investigate any foreign-key rows before
continuing. A partial 063 schema may report a temporary `foreign key mismatch`
because a child table references a missing parent key; 067 validates the copied
context relationships and repeats the foreign-key check after rebuilding.

#### Backup and startup

Create a consistent SQLite backup with the SQLite backup API rather than copying
a live WAL database file. Keep the original backup immutable and verify it
before starting the release containing migration 067.

```bash
DB_PATH="/app/.ingenium/data"
BACKUP_PATH="/secure/backups/ingenium-pre-g3-$(date -u +%Y%m%dT%H%M%SZ).sqlite"

sqlite3 "$DB_PATH" ".backup '$BACKUP_PATH'"
sqlite3 "$BACKUP_PATH" "PRAGMA integrity_check; PRAGMA foreign_key_check;"
```

On startup, inspect the structured database log for
`Applied migration 067_context_migration_repair.sql`. A successful actual repair
adds one content-free `context_migration_repairs` row with the source schema
hash and copied row counts. Re-run `PRAGMA integrity_check` and
`PRAGMA foreign_key_check` after startup; both must be clean.

#### Failure and rollback

If preflight or the in-transaction post-check fails, SQLite rolls back the
entire 067 rebuild: source context tables and rows remain untouched. Preserve the
failed database and logs for diagnosis; do not hand-drop context tables or
re-run the migration against a changed copy.

After a committed repair there is no supported destructive down-migration.
To return to the prior database, stop all writers, preserve the committed file
for forensics, restore the verified pre-G3 backup through the operator's normal
database recovery procedure, and validate it with both pragmas before allowing
the prior application version to write. This repository change does not perform
that live restore, deploy services, or modify Docker configuration.

### Repair a failed 015 migration

```sql
DROP TABLE IF EXISTS observations_old;
CREATE VIRTUAL TABLE IF NOT EXISTS observations_fts USING fts5(...);
CREATE TRIGGER ... ;
INSERT INTO observations_fts(observations_fts) VALUES('rebuild');
```

### Verify repair

```sql
PRAGMA integrity_check;
PRAGMA foreign_key_check;
```

---

*See also: `packages/ingenium-core/lib/db.ts`, `packages/ingenium-core/data/migrations/`*

### VAULT-101 deployed schema and cleanup evidence

The deployed migration-081 schema evidence is **2 tables, 2 indexes, and 8
triggers**: five run-state/provenance triggers and three item-snapshot
triggers. `PRAGMA foreign_key_check` returned zero violations. The run metadata
cleanup path removes only proven run-owned state; partial cleanup is resumable,
while an unsafe directory or nonce race is retained for bounded recovery. A
process-group recovery path handles descendants during crash and shutdown
cleanup, but same-UID external processes remain outside the guarantee.

VAULT-101 authorization is one-attempt and fresh-on-retry. Sealed, missing,
deleted, foreign, revoked, expired, or version-stale references fail closed
before spawn. The schema stores no secret value, path, OpenCode config, or
plaintext nonce; secret files are ephemeral UUID files on protected tmpfs and
the ID-to-path map is non-secret.
