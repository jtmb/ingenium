---
title: Architecture
description: System architecture, project identity model, data flow, and component overview of the Ingenium system.
---

# Architecture

## Project Identity Model

Ingenium uses a **two-project identity model** distinguishing between server/public and external sessions:

### Server/Public Project (`global-default`)
- **Project name**: `global-default` (with `is_global=1`)
- **Used by**: The container's own OpenCode session (opencode-webui), email service, and dashboard default
- **Global config location**: `/home/appuser/.config/opencode/opencode.jsonc` (set by the Docker entrypoint at `scripts/docker-entrypoint.sh`)
- **Plugin target**: Extension plugins inside the container use `INGENIUM_PROJECT=global-default` (set in `opencode.jsonc` at line 32 of the entrypoint)
- **Created automatically** in two contexts:
  1. **Docker deployment** — `scripts/docker-entrypoint.sh` creates it during container startup via `POST /api/v1/projects`
  2. **Local development** — The API server (`api-server.ts`) calls `ensureGlobalProject()` before the scheduler or email engine starts. This is idempotent: if the project already exists, it is a no-op.
- If the global project cannot be created (DB error, permissions), the API logs a warning and degrades gracefully — the health endpoint and non-global routes still work, but the mail sync scheduler skips with the log message `Skipping mail sync — no global project configured`

### External Sessions
- **Project name**: Derived from the worktree directory name (e.g., `gh-llm-bootstrap` for a repo cloned to `/home/user/repos/gh-llm-bootstrap`)
- **Used by**: External OpenCode sessions (CLI, VS Code) that connect via the `@ingenium/extension` plugins
- **Plugin target**: The `INGENIUM_PROJECT` environment variable in the MCP server's `opencode.json` entry controls which project extension plugins write to
- **Connection method**: These sessions install `@ingenium/extension` via `npx` and register the observer, skill-sync, and auto-observer plugins

### External Worktree Project Initialization

When an external OpenCode session (CLI, VS Code) loads the `@ingenium/extension` plugins, the extension's **resource-sync** module (`packages/ingenium-extension/resource-sync.ts`) calls `ensureExtensionProject()` which:

1. **Resolves the project name** via `resolveExtensionProject()` with this priority:
   - `process.env.INGENIUM_PROJECT` (explicit override — Docker containers use this for `global-default`)
   - Worktree directory basename (e.g., `gh-llm-bootstrap` for `/home/user/repos/gh-llm-bootstrap`)
   - **Throws** if the worktree basename is `"workspace"` (the container mount path) — the user must set `INGENIUM_PROJECT` explicitly
2. **Provisions the project** via `POST /api/v1/projects` — if the project already exists, the `409 Conflict` response is accepted as idempotent success
3. **Returns the project name** for use in all subsequent API calls

> 🔴 **Never defaults to `global-default`.** The resolver explicitly throws if it cannot determine a valid project name, preventing cross-project data pollution when multiple worktrees share the same server.

### Global-Default Semantics

The `global-default` project carries `is_global=1` and serves as the sole server/public namespace. The database permits at most one active global project (an archived global does not count). Runtime resolution does not silently choose among duplicate active globals; ambiguity is an integrity failure that must be repaired before shared resources or mail operations continue:

- **Docker deployment**: Created at startup by `scripts/docker-entrypoint.sh` via `POST /api/v1/projects`
- **Local development**: Created by `ensureGlobalProject()` in the API server before the scheduler or email engine start — idempotent no-op if already present
- **Shared resources**: Skills, plugins, configs, and settings written to `global-default` are accessible from every project via `resolveProjectBase()` path resolution
- **Global config path**: `/home/appuser/.config/opencode/opencode.jsonc` (set by the Docker entrypoint)
- **Auto-loading**: When a new project is created, global skills from `global-default` are automatically copied into it via `copySkills()`
- **Graceful degradation**: If `global-default` cannot be created, the API logs a warning and skips mail sync with `"Skipping mail sync — no global project configured"`

Do not run a live global-project or mail-settings migration before deploying
the release that contains its schema and runtime guards. Deploy the application,
run the migration preflight against the target database, and only then permit
runtime reconciliation.

### Project-Name Safety Validation

All project names pass through `isValidProjectName()` which enforces:

| Check | Rejected Examples |
|-------|-------------------|
| Empty or whitespace-only | `""`, `" "` |
| Exceeds 64 characters | `"a".repeat(65)` |
| Leading/trailing whitespace | `" name"`, `"name "` |
| Dot segments | `"."`, `".."` |
| Path separators | `"a/b"`, `"a\\b"` |
| Control characters | `"a\u0000b"` |

This check is applied in the API route handler (`services/ingenium-api/lib/routes/projects.ts`) and the extension project resolver (`packages/ingenium-extension/project-resolver.ts`). Project creation returns `422 Unprocessable Entity` with a `VALIDATION_ERROR` code when the name is invalid.

### Resolution & Switching
- The **dashboard** resolves the default project dynamically by fetching the `is_global=1` project from the API (`GET /api/v1/projects` with `is_global` filter)
- Users can switch projects via:
  - The **ProjectDropdown** (folder icon + chevron) in the nav bar, positioned before the settings gear — available on all pages except `/mail` and `/opencode`, where it is disabled (`opacity-50 cursor-not-allowed`)
  - The `/projects` page, which shows an ACTIVE badge on the current project and a "Set Active" button on others
  - MCP tools like `ingenium_project_init` and `ingenium_project_set_global`
- When writing shared resources (skills, plugins, configs, settings), use `global-default`. When working from an external session, the `INGENIUM_PROJECT` env var determines the target

### Key Rule
> **Never assume a worktree-derived project name is the shared namespace.** The `global-default` project (with `is_global=1`) is the sole server/public namespace for shared resources. External sessions (like this repo's worktree-derived project) have their own isolated workspace — shared resources (skills, plugins, configs, settings) must be written to `global-default` explicitly, never to the worktree-derived project.

### DB-Only Workspace Project Migration

A historical artifact created an invalid `/workspace` project in the database (from the container mount point). The migration is **DB-only** — it never reads, renames, or deletes the `/workspace` filesystem path.

#### Migration Flow

1. **Dry run** (`POST /api/v1/projects/migrate-workspace` with `dry_run: true`):
   - Counts source skills (expects exactly 10)
   - Computes SHA-256 content hashes for each skill
   - Counts child rows in every table with a `project_id` column (skills, tasks, observations, etc.)
   - Detects name collisions with existing `global-default` skills
   - Returns a `WorkspaceMigrationResult` without mutating any data

2. **Execute** (`POST /api/v1/projects/migrate-workspace` with `dry_run: false` or omitted):
   - Creates a `project_migration_manifests` record (status `prepared`) containing source skill hashes and child row counts
   - Renames any colliding skills in the source project with a `migrated-<sha256[:16]>` suffix
   - Reassigns all child rows from `/workspace` → `global-default`
   - Verifies SHA-256 content hash integrity for every migrated skill
   - Checks no child rows remain in the source project
   - Runs `PRAGMA foreign_key_check` — rejects if any violations
   - Deletes the `/workspace` project row
   - Updates the manifest status to `completed`

#### Validation Guards

| Guard | Action on Failure |
|-------|-------------------|
| Source skills ≠ exactly 10 | Throws `MIGRATION_REFUSED` |
| Skill content hash mismatch after move | Throws `MIGRATION_REFUSED` — refuse project deletion |
| Child rows remain in `/workspace` | Throws `MIGRATION_REFUSED` |
| Foreign key violations | Throws `MIGRATION_REFUSED` |

#### Rollback Expectations

The entire migration is **transactional** (wrapped in `execTransaction()`). If any validation guard fails, the transaction aborts, all changes are rolled back, and the source `/workspace` project remains untouched. Once committed, rollback is a manual operation: create a new project, move child rows back, and restore the `/workspace` project row from the `project_migration_manifests` audit record.

#### Audit Table: `project_migration_manifests`

Created by migration `049_workspace_project_migration.sql`. Stores:

| Column | Content |
|--------|---------|
| `id` | UUID primary key |
| `source_project_id` | The `/workspace` project UUID |
| `destination_project_id` | The `global-default` project UUID |
| `source_skill_count` | Number of skills in source (expects 10) |
| `source_hashes` | JSON array of `{name, sha256}` for every source skill |
| `child_counts` | JSON object of logical repaired-component names → copied row counts |
| `status` | One of `prepared`, `completed`, `failed` |

The manifest is created **before** data movement and updated **after** successful completion, providing a durable audit trail.

#### API Endpoint & MCP Tool

| Interface | Endpoint | Purpose |
|-----------|----------|---------|
| REST API | `POST /api/v1/projects/migrate-workspace` | Trigger migration with optional `dry_run` |
| MCP Tool | `ingenium_project_migrate_workspace` | Same, accessible from OpenCode |

Both return a `WorkspaceMigrationResult` containing `{ migrated, dryRun, manifestId, sourceSkillCount, sourceHashes, movedChildRows, collisions }`. Name `collisions` are reported with their `sha256`, not skill content.

#### MCP Tool Registration

| Field | Value |
|-------|-------|
| Tool name | `ingenium_project_migrate_workspace` |
| Category | Projects |
| Project scope | `global` |
| Default enabled | Yes |
| Input schema | `{ dryRun?: boolean }` |

---

## Data Flow

```
Dashboard → HTTP → API → Core → SQLite
MCP Server → HTTP → API → Core → SQLite
Email Client → OAuth2 + Gmail REST API / SMTP → Gmail Provider
```

- `ingenium-api` is the **sole database authority**. No other service imports `ingenium-core` or any SQL library.
- `ingenium-server` runs as an MCP stdio transport with **277 built-in registered tools** across **29 baseline categories**. Two extension-registered tools bring the built-in catalog to **279**. Project-scoped child discovery adds dynamic tools/categories to the effective catalog. The server talks to the API over HTTP. Zero DB access.
- `ingenium-dashboard` is a Next.js 16 App Router frontend with **21 primary routes plus the Settings overlay**. It talks to the API over HTTP.

## Restore Plan and Executor Boundary (RESTORE-100/101)

Backups are server-global and use signed v2 fixed-name bundles for the Ingenium
and OpenCode databases. The manifest binds component hashes, sizes, required
tables, schema fingerprints, and SQLite versions; a persistent owner-only HMAC
key file is kept outside the bundle directory. Migration 083 provides immutable
plan/revision identity, one-time authorization, append-only audit, stage
integrity, and idempotency receipts. RESTORE-101 adds a distinct one-time
15-minute execution authorization, an append-only fenced run ledger, and a
fixed one-shot Supervisor program. API and MCP can only authorize and queue
that static executor; they never apply database bytes. The executor stops DB
users, verifies holders and both databases, creates a `pre_restore` snapshot,
performs the journaled two-file swap, rehydrates the approval ledger, and
restarts healthy users. Its root-only maintenance root and separate root-only
HMAC journal key drive crash recovery and fail-closed rollback; API/MCP never
read either. UI, off-host, and other-resource restores remain out of scope.

## Task and Session Coordination Boundary (COORD-100/101)

Task coordination is cooperative and managed-agent-only: the guarantee applies
when agents use the same project and canonical worktree. It explicitly excludes
manual editors and external processes, so it is not a filesystem write-enforcement
mechanism. Task access remains project-scoped; foreign-project task IDs are
treated as absent, and mutations use expected-revision CAS plus request-hash
idempotency.

Reservations use atomic reserve/release operations for an owner/worktree pair.
The caller supplies a 32–512-character URL-safe opaque token; the database
stores only its SHA-256 hash and public task results never return the token or
hash. Legacy non-available reservations are quarantined transactionally by
migration 074 because they cannot prove token possession. Exact supported claim
forms are relative `path`, relative `tree`, and reserved `@build`/`@repository`
claims; globs, absolute paths, traversal, `.git` paths, and secret-like paths
are rejected.

COORD-101 adds a project/worktree/session/incarnation registry. Each worktree
has a durable, monotonic fence allocator; recovery advances the fence and
rotates the caller-held ownership token, whose SHA-256 hash is the only stored
form. Session mutations require the expected revision, fence, token, and an
immutable request-hash receipt. Heartbeats extend only an unexpired active
lease, so an expired session cannot be resurrected by heartbeat.

Claims are exact `path`, `tree`, or reserved `@build`/`@repository` values with
optional SHA-256 baselines. Claim batches and releases are atomic, and claims
may be `active`, `released`, `dirty`, `quarantined`, or `collision`. Bounded
credential-free operational snapshots are retained with optional project-owned
task/revision and context-conversation/revision pointers. Closing releases
active claims while retaining the session, claim, receipt, and fence evidence.
All coordination writes checkpoint only after their transaction commits.

## Usage Telemetry

Usage telemetry is provider-neutral and project-scoped. The API reads OpenCode
assistant `step-finish` parts and joins only their usage metadata with assistant
message and session metadata. Persisted records contain request identifiers,
raw provider/model IDs, nullable assistant-agent attribution, timestamps, status,
token counters (including nullable numeric reasoning tokens), nullable cache
counters, and reported cost state. They never contain prompts, message text,
reasoning content, tool payloads, or credentials.

OpenCode project IDs require an explicit mapping to an Ingenium project. An
unmapped source project is quarantined and is never assigned to
`global-default` by fallback. Replay safety is provided by a unique
`source_instance + source_part_id` upsert key. Per-project sync state uses a
composite cursor plus a five-minute session-update lookback so revised or
late-arriving step data is replayed safely.

The collector runs on the API scheduler (default five minutes; configurable with
`USAGE_SYNC_INTERVAL_MS`) and can be triggered with the project-scoped usage
sync API. Cost is reported as `known`, `partial`, or `unavailable`; cache
read/write and reasoning-token counts remain nullable when OpenCode does not
report them. The system does not calculate a cache-hit rate or infer provider
billing.

The dashboard `/usage` view consumes the same project-scoped summary,
breakdown, freshness, and export contracts. It treats omitted cost/cache data
as unknown rather than zero and preserves provider/model IDs for all supported
providers.

USAGE-100 adds a project-scoped advisory threshold layer over those existing
aggregates. Migration 078 stores nullable request, total-token,
provider-reported-cost, cache-read, and cache-write thresholds with revisioned
CAS updates. Evaluation is read-only and uses either caller-supplied UTC
`from`/`to` bounds or explicit all-history aggregation when both are omitted;
there is no implicit reporting period. Results distinguish `disabled`,
`unknown`, `below`, `equal`, and `above`, preserving known zero versus partial
or unavailable subtotal. Reported cost is an amount only, with no currency or
pricing inference. The layer is advisory: it does not block, throttle, route,
or otherwise alter request execution, ledger production, mappings, or scheduler
sync cursors. The API remains bearer-authenticated and project-scoped, with no
MCP surface for this contract.

USAGE-101 adds migration 079's durable attention lifecycle over the explicit
all-history evaluation. It maintains one stable condition key per metric:
request count, total tokens, provider-reported cost, cache-read tokens, and
cache-write tokens. `unknown`, `equal`, and `above` remain active with
`info`, `warning`, and `critical` severity; `below` and `disabled` resolve.
Repeated unchanged evaluations emit no transition, while material evaluation,
severity, freshness, or threshold-revision changes emit an immutable event and
clear acknowledgement. A resolved condition reopens the same row;
acknowledgement is revision-CAS and never resolves an item. Freshness uses
successful mapped-source sync evidence (`disabled`, `unknown`, `fresh`, or
`stale`), not event recency. The API scheduler reconciles mapped projects on
`USAGE_SYNC_INTERVAL_MS` (five minutes by default), including failed or no-new
data cycles for freshness; zero disables scheduled sync and attention
evaluation. REST list/evaluate/ack routes are bearer-authenticated and
project-scoped, with no MCP surface or request-execution enforcement.

## Provider Adapter Layer

The email client uses a **provider adapter** pattern to decouple sync logic from backend specifics:

```
Engine → MailProvider interface → GmailProvider (REST API)
                                   ImapProvider (future — IMAP fallback)
```

### Architecture

- **`MailProvider` interface** (`packages/ingenium-email/lib/providers/mail-provider.ts`) — defines the contract: `listFolders()`, `listMessages()`, `changesSince()`, `getBody()`, `getAttachment()`, `send()`, `modifyFolders()`.
- **`GmailProvider`** (`packages/ingenium-email/lib/providers/gmail.ts`) — implements the interface via the Gmail REST API using a thin `fetch()` client (`gmail-api.ts`). No heavy `googleapis` dependency.
- **`ImapProvider`** (future) — planned IMAP fallback for non-Gmail accounts.

### Key Properties

- **Stateless** — The provider is stateless HTTPS. No persistent connections, no connection pools, no IDLE watchers. The sync engine calls provider methods as needed.
- **Delta sync via cursor** — `changesSince(cursor)` returns only what changed since the last poll. For Gmail this uses `history.list(startHistoryId)`. Empty response when nothing new.
- **Pluggable** — Adding a new provider (e.g., Microsoft Graph API) requires only implementing the `MailProvider` interface. The sync engine, cache layer, and routes remain unchanged.
- **Token refresh** — `getFreshGmailToken()` auto-refreshes OAuth tokens 60s before expiry via `google-auth-library`. Called at the top of every provider method.

## Skill System

Skills are loaded from the Ingenium SQLite database via the MCP server. The canonical source files live at `.opencode/skills/<name>/` with a split-skill format (SKILL.md + metadata.json + references/). When created or updated via API, skills are written to disk for agent access.

### file_tree Column

The `skills` table has a `file_tree` column (TEXT, stores JSON map of relative paths → content). This enables complete data round-trips:

- **`writeSkillToDisk()`** — After DB create/update, reads `file_tree` JSON and writes every file under the skill directory. Always writes SKILL.md (with YAML frontmatter) and metadata.json.
- **`syncSkillFromDisk()`** — Reads SKILL.md, parses frontmatter, reads metadata.json, and walks the directory tree to rebuild `file_tree`. If skill doesn't exist in DB, creates it; otherwise updates.

This means a skill can contain any number of auxiliary files (reference docs, examples, configs) that are fully preserved in the DB's `file_tree` and round-tripped to disk.

### Resource Sync Engine

The resource sync engine (`packages/ingenium-extension/resource-sync.ts`) provides **unified bidirectional synchronization** of skills, agents, plugins, commands, and config between the Ingenium API and the local filesystem. It supersedes the former `skill-sync.ts` and `onboarding-sync.ts`.

#### Architecture

- **Change detection**: SHA-256 content hashes enable three-way comparison (API vs disk vs manifest baseline)
- **Sync manifest**: Stored at `.opencode/.ingenium-sync-state.json` — maps resource names to their last-known SHA-256 hash
- **Conflict resolution**: Three-way merge using manifest baseline as the common ancestor:
  - API changed, disk unchanged → pull API → disk
  - Disk changed, API unchanged → push disk → API
  - Both changed, manifest matches API → disk wins
  - Both changed, manifest matches disk → API wins  
  - Both changed, manifest matches neither → conflict (logged, skipped)

#### Sync Hooks

The `ResourceSyncPlugin` hooks into OpenCode session events:

| Event | Action | Throttle |
|-------|--------|----------|
| `session.created` | Full sync of all resources | None |
| `session.idle` | Incremental sync (hash mismatch only) | 60s max 1 after a successful reconciliation; failed passes remain eligible for the next idle event |

Before its first project-provisioning request, the extension performs a bounded
authenticated API preflight. Transient API unavailability is retried a finite
number of times; authentication failures fail closed without exposing the
token, API URL, response body, or HTTP detail. A later successful lifecycle
attempt emits a safe recovery diagnostic. The container additionally waits for
an authenticated API readiness probe before OpenCode starts, reducing the
cold-start race without introducing a background retry loop.

#### Registration

The plugin is self-registering — the `@ingenium/extension` package exports `ResourceSyncPlugin` which is loaded by OpenCode's plugin system. Registration requires the plugin to be in the `opencode.json` `plugin` array and the corresponding `.ts` file at `.opencode/plugins/`.

#### Restart Requirement

When the sync engine detects changes to **plugins** or **config** (opencode.json), the response includes `restartRequired: true`. A human-readable message is logged: `"⚡ OpenCode restart required (plugin/config changes)"`. This is because OpenCode loads plugins and config at startup — runtime changes to the plugin array or config content do not take effect until the next session restart.

#### Repository-authoritative initialization

`ingenium-init-project` provides a deterministic repository-to-API projection
for onboarding and reconciliation. It resolves validated `--project` first,
then `INGENIUM_PROJECT`, then the validated worktree basename; it never invents
a `global-default` fallback. The production image exposes the command on
`PATH` at `/usr/local/bin/ingenium-init-project`, independent of the prunable
workspace `.bin` directory.

- `--dry-run` previews the docs/resource operations without provisioning a
  project, mutating remote state, or writing the local repository baseline.
- `--apply` provisions the validated project when needed and advances the
  `.opencode/.ingenium-sync-state.json` repository baseline only after the API
  confirms the corresponding apply.
- The default scope covers `docs/**/*.md`, `.opencode/skills/**`,
  `.opencode/agents/**` (including linked compatibility mirrors), and configured
  local plugin sources under `.opencode/plugins/**`.
- `--docs-only` limits the projection to repository Markdown.

Commands, MCP server definitions, project/global configuration, and manual or
unmanaged remote resources are excluded from this initialization contract.
The presence of this procedure is not a claim that live onboarding has been
performed.

The dashboard sync log captures this condition and prompts the user to restart OpenCode. Skills, agents, and commands do not require a restart — they are read from disk at session startup from the `.opencode/` directory.

### Skill Seeds

10 canonical skill directories (plus absorbed legacy source archives under `references/sources/`) live at `.opencode/skills/` and are synced via `/sync-skills`. The Phase 3 migration (2026-07-16) consolidated 36 legacy skills into 10 canonical skills with full provenance tracking. Legacy content is preserved under `references/sources/<legacy-name>/` in each canonical skill.

The MCP server provides 25 skill tools (11 core CRUD + 14 governance). The `update-skill-index` workflow regenerates `SKILL-INDEX.md` from all skill files.

### Skill Governance & Lifecycle Architecture

Skills use an **archive-only deletion** model — no hard-delete is possible. The `deleteSkill()` function delegates to `archiveSkill()`, which sets `archived_at`, removes only SKILL.md from disk, and preserves metadata.json + all file_tree auxiliary files for restoration.

**Three-layer lifecycle system implemented in Phase 2B:**

1. **Versions (migration 042):** A new skill starts at non-negative revision 0 and an `AFTER INSERT` trigger snapshots that initial state. Subsequent update, enable, disable, archive, restore, rollback, and existing-row upsert operations increment revision; an `AFTER UPDATE` trigger snapshots each changed revision in `skill_versions`. `rollbackSkill()` loads a snapshot and applies it as a new revision — append-only, byte-equivalent. Changes are revertible without data loss.

2. **Lineage (migration 043):** Provenance records in `skill_lineage` link source skills to targets via `(sourceProjectId, sourceName) → targetSkillId` (UUID). Tracks merges, copies, and derivations with optional `sourceHash`, `mergedFilePaths`, `tombstonePath`, and `reason`. Cycle detection via depth-limited BFS (max 100 depth).

3. **Proposals (migration 044):** A review workflow of `draft → pending → applied | rejected | stale`, followed by `applied → rolledBack` in governance DTOs (`rolled_back` in storage/status filters). Proposal IDs are UUIDs. Approval stale-checks revision conflicts and missing or archived targets before applying; merge approvals create lineage where applicable. Automatic and cross-project synthesis still write skills directly; converting those paths to proposal-only generation is Phase 5 work.

**Wire compatibility boundary**: The API routes layer (`services/ingenium-api/lib/routes/skills.ts`) separates legacy Skill rows from governance DTOs:
- Legacy CRUD routes (list, get, create, update, delete, enable, disable) return raw `snake_case` DB rows with `file_tree` as a JSON string, `enabled` as numeric 0/1.
- Governance routes (versions, lineage, proposals) return `camelCase` DTOs with parsed JSON `fileTree`, `enabled` mapped to boolean.
- Lock DTOs explicitly strip `owner_token` from the response.

For complete reference, see [../configure/agents.md](../configure/agents.md).

## Plugin System

Plugins are stored in the `plugins` SQLite table and synced to disk as `.ts` files under `.opencode/plugins/`. The `opencode.json` plugin array is auto-populated.

- **Path resolution**: `getProjectRoot()` helper in `packages/ingenium-core/lib/tools/plugins.ts` resolves from `INGENIUM_CORE_DB_PATH` (`../../`), replacing all `process.cwd()` calls so paths work consistently across services (API, MCP server, dashboard).
- **Config sync**: `addPluginToConfig()` / `removePluginFromConfig()` auto-update `opencode.json` whenever plugins are enabled, disabled, created, deleted, or seeded — preventing the "disconnected config" bug where DB and opencode.json fell out of sync.
- **Seeding**: `seedPlugins()` writes `.ts` files to `.opencode/plugins/`, inserts into the `plugins` table with `enabled = 1`, and syncs `opencode.json`. Uses `INSERT OR IGNORE` for idempotency.
- **MCP tools**: `ingenium_plugin_list`, `ingenium_plugin_get`, `ingenium_plugin_enable`, `ingenium_plugin_disable`, `ingenium_plugin_create`, `ingenium_plugin_delete`, `ingenium_plugin_update`.

### Ponytail checkout integration

The extension ships an official Ponytail OpenCode adapter as an immutable,
MIT-provenance checkout at `packages/ingenium-extension/ponytail/`, pinned to
upstream SHA `16f29800fd2681bdf24f3eb4ccffe38be3baec6b`. Local projects register
the project-relative plugin path once; the container registers the equivalent
`/app/.../ponytail.mjs` path once in its global config. The published npm
package `@dietrichgebert/ponytail@4.8.4` is excluded because its named export
does not match the OpenCode 1.18.9 loader contract.

The adapter's boundary is prompt-only: it appends the Ponytail ruleset to chat
system prompts and registers six commands, but adds no MCP tools or execution
permissions. Its mode state is stored beside the OpenCode config in
`.ponytail-active`; plugin or config changes require an OpenCode restart. The
checkout's `PROVENANCE.md` records upstream file hashes for update review.

## Self-Learning Pipeline

The self-learning pipeline enables agents to learn from user interactions through three phases:

- **Phase 0 — Extraction Engine**: Server-side extraction reads OpenCode messages via the mounted DB (`/var/opencode/opencode.db`), with watermark-gated deduplication. A regex pre-filter selects candidate messages, and the synthesis LLM extracts durable user behavior rules as observations. Runs in the 15-minute scheduler BEFORE synthesis.

- **Phase 1 — Trait Consolidation**: `consolidateTraits()` sends observations + existing traits to the LLM, which returns CONFIRM/CREATE/IGNORE decisions. Traits are normalized statements (not verbatim copies). Confidence model: start 0.10–0.15, +0.15 per confirmation, cap 0.95, display threshold ≥0.30.

- **Phase 2 — LLM Skill Synthesis**: Groups 3+ related observations and sends them to the LLM with existing skills/traits as context. Creates/updates skills via `writeSkillToDisk()` with the `llm-synthesized` prefix. A backup provider provides fallback if the primary LLM fails. Scheduled and manual per-project runs hold a project `skills` lease; cross-project synthesis holds the global `skills` lease.

- **Auto-Observer Plugin**: Thin trigger (~62 lines) that POSTs `/api/v1/extraction/run` on `session.idle`. The 15-minute scheduler covers extraction if the plugin fails to load.

See [self-learning.md](self-learning.md) for full detail.

## Config Management Architecture

The `configs` table stores `opencode.json` (project-level) and `opencode.jsonc` (global) content in the DB, enabling round-trip editing through the dashboard and MCP tools.

### Global Config Path Resolution

Global projects write skills, plugins, and commands to `/home/appuser/.config/opencode/` instead of the project root. This is handled by `packages/ingenium-core/lib/tools/paths.ts`:

- **`resolveProjectBase(projectId?)`** — Checks if a project has `is_global=1`. If so, returns `INGENIUM_GLOBAL_CONFIG_PATH` (default: `/home/appuser/.config/opencode/`). Otherwise returns the project root derived from `INGENIUM_CORE_DB_PATH`.
- **`getSkillsBase()`**, **`getPluginsBase()`**, **`getCommandsBase()`** — Resolve the appropriate `.opencode/` subdirectory based on project type.
- **`getConfigPath()`** — Resolves to `opencode.jsonc` for global projects (JSONC supports comments) and `opencode.json` for regular projects.

### Data Flow

```
Dashboard /config page  ──HTTP──▶  API (PUT /api/v1/config)
                                          |
                                   writes to DB (configs table)
                                          |
                                   writes to disk (opencode.json/jsonc)
```

### API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/config` | Get project config |
| GET | `/api/v1/config/global` | Get global config |
| PUT | `/api/v1/config` | Update project config (writes DB + disk) |
| PUT | `/api/v1/config/global` | Update global config |
| POST | `/api/v1/config/sync` | Sync project config from disk to DB |
| POST | `/api/v1/config/global/sync` | Sync global config from disk to DB |

## Dashboard Summary API

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/dashboard/summary` | Aggregated home dashboard endpoint — returns learning stats, task counts, job counts, and mail status in a single response. Each module is independently resolved; failed modules appear in `unavailable[]`. Returns 200 with partial data unless ALL modules fail (500). |

### Vault-backed job execution (VAULT-101)

Vault references are reauthorized immediately before each individual child
attempt. Sealed, missing, deleted, foreign-project, revoked, expired, or
version-stale authorization fails closed before spawn; retries resolve fresh
authorization and never auto-unseal. Secret values cross the runner boundary
only as run-owned UUID files in protected tmpfs (`0700` directory, `0600`
files), accompanied by the non-secret `INGENIUM_VAULT_SECRET_FILES` ID-to-path
map. Values are absent from environment variables, argv, prompts, logs,
database, API, MCP, and output surfaces.

OpenCode-backed execution uses ephemeral state: a run-owned HOME/XDG tree and
pure state are discarded with the run rather than shared with the service or
persisted in the database. Cleanup verifies ownership and emptiness before
removing files; process-group recovery covers descendants. Partial cleanup,
unsafe directories, stale/expired/revoked authorization, and nonce races fail
closed and retain bounded recovery metadata. Same-UID external processes are
outside the isolation guarantee.

## Jobs API

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/v1/jobs/suggest` | Derive job config (prompt_template, schedule_cron, trigger_event) from a natural-language description using the Synthesis LLM. Returns `{ prompt_template, schedule_cron, trigger_event, configured }`. Requires a configured Synthesis LLM in Settings. |

### Trusted Job Events and Delivery (JOB-100/JOB-101)

The v1 trusted-event catalog is deliberately exact and limited to
`context.conversation.archived`, `context.conversation.unarchived`, and
`context.checkpoint.restored_as_new`. Events are project-scoped, schema version
1, produced by `context.maintenance`, and contain only bounded identifiers and
revision values. Their provenance is the immutable Context maintenance audit
row; `source_audit_event_id` is also the dedupe identity within a project.

The event rows are immutable, append-only, and retained indefinitely until an
explicit authorized project lifecycle action. API validation and SQL triggers
reject unknown values, while preserving historical `jobs.trigger_event` rows.
There is no user append endpoint. JOB-101 snapshots each event once, including
zero-match snapshots, and creates one delivery per exact event/job match for an
enabled job in the same project. Enqueue is exactly-once; execution is bounded
at-least-once for at most five attempts with 30/60/120/300/600-second backoffs.
Leases persist only a SHA-256 owner hash and CAS revision. Process proof is
hash-only and records PID/PGID, start time, executable, and nonce hash; an
ambiguous identity is dead-lettered rather than duplicated. There is no payload
or prompt interpolation and no manual replay. Event and delivery reads, plus
run/log/cancel operations, are project-scoped and bounded; durable text is
redacted. Deleting a job returns `409` while its delivery is active, then
disables/hides the job while preserving delivery history.

## Pipeline Observability Architecture

Every pipeline event is logged to the `pipeline_events` table and displayed at `/pipeline` in the dashboard:

### Event Sources

| Source | Events Emitted |
|--------|---------------|
| `observations.ts` — `storeObservation()` | `observation_created` |
| `synthesis.ts` — `runSynthesis()` | `synthesis_started`, `trait_created`, `trait_updated`, `synthesis_completed`, `synthesis_failed` |
| `observer.ts` plugin | `session_created`, `session_idle`, `plugin_initialized`, `plugin_error` |
| `observer-core.ts` | `observation_imported`, `synthesis_triggered` |
| API Server (scheduled) | Runs extraction → synthesis every 15 minutes; skill mutations persist their own disk representation |

### Timeline Architecture

The `/pipeline` dashboard page uses a Git-workflow-style vertical timeline:

1. **Client polls** every 3 seconds via `GET /api/v1/pipeline/timeline`
2. **Parent-child nesting**: Synthesis run is parent, individual trait operations are children linked via `parent_event_id`
3. **Collapsing**: Events within the same 60-second window are grouped into +N collapsible cards
4. **Filtering**: Source filter pills (All/Agent/Plugin/Synthesis/Trait) filter client-side
5. **Detail overlays**: Click any event to show raw JSON payload in a modal overlay

Event colors map to sources: orange (agent), blue (plugin), green (synthesis), purple (trait), gray (system).

## Cross-Project Synthesis Flow

Cross-project synthesis evaluates observations and skills across multiple projects:

1. **`ingenium_synthesis_cross_project`** iterates all active projects
2. **Pattern detection**: Compares observations across projects, looking for shared patterns
3. **Promotion**: Shared patterns are synthesized into skills in the `global-default` project
4. **Resolution**: Global skills are accessible from every project via `resolveProjectBase()` path resolution
5. **`ingenium_project_set_global(project, name, isGlobal)`** marks/unmarks a project as the global-default

This runs as part of the scheduled 15-minute maintenance cycle or can be triggered manually.

## Plugin Source Auto-Populate Architecture

When creating a plugin via `ingenium_plugin_create(project, name, filePath)` without `sourceContent`, the API:

1. Reads the file at `filePath` from disk
2. Sets `sourceContent` to the file contents automatically
3. Stores it in the DB alongside the reference

This allows plugins to be created by path reference alone. The dashboard Edit button similarly fetches source from `GET /plugins/:name/source` when DB content is empty.

### Auto-Config Sync

Every plugin lifecycle operation (create, enable, disable, delete, update) triggers:
1. Write/remove `.opencode/plugins/<file>.ts` on disk
2. Sync `opencode.json`'s `plugin` array
3. This prevents "disconnected config" bugs

## Backup LLM Provider Architecture

The system uses two parallel LLM dispatch modes for fault tolerance:

### Direct Mode (Synthesis Pipeline)

The core self-learning pipeline (`callSynthesisLLM` in `synthesis-llm.ts`) makes direct HTTP calls to the LLM endpoint:

1. **Primary provider**: Configured via Settings (provider, model, API key, endpoint) with 60s timeout
2. **Backup provider**: Optional failover (same configuration shape) with 60s timeout

If the primary LLM call fails during Phase 2 skill synthesis:
1. The pipeline retries once with a slightly reworded prompt (same model)
2. If the retry also fails, the error is logged and trait results from Phase 1 are still saved
3. Provider saves validate configured base URLs via `validateEndpointUrl()` before persisting changes

### Broker Mode (Interactive Features)

Docs AI, RAG Ask, and Job Suggestions use `executeSynthesisBroker()` which routes through OpenCode's provider infrastructure:

1. For callers without a validated explicit selection, reads primary (`synthesis_provider` + `synthesis_model`) and secondary (`synthesis_backup_provider` + `synthesis_backup_model`) from settings
2. Deduplicates identical `(providerID, modelID)` pairs
3. For callers without an explicit selection, tries primary first and falls back to secondary on failure; an explicit selection is attempted exactly once
4. **Bounded timeout policy**: interactive broker consumers remain hard-capped
    at 30 seconds by default; the server-owned `docs-ai` policy alone permits
    60 seconds. Background extraction and synthesis use a separate policy that
    preserves the pipeline's 60-second request budget and may explicitly extend
    only to a finite 180-second maximum. Every broker policy deletes its
    ephemeral OpenCode session in `finally`, including timeout and retry paths.
5. Creates ephemeral OpenCode sessions using only `ingenium-llm-broker`, whose
   wildcard-deny profile has no tool allowances; the request also carries an
   empty `tools: {}` selection as defense in depth

The broker profile's `hidden` frontmatter is persisted in the agent record and
restored by agent disk sync and enable/disable lifecycle writes. This prevents
the broker from becoming selectable after restart or agent lifecycle changes;
the broker is permanently enabled and immutable, and the wildcard deny remains
the authoritative capability boundary. Direct SQL writes cannot disable,
rewrite, rename, claim, replace, or delete the reserved row while its project
exists; broker repair is performed from trusted persisted state.

Docs AI first resolves the unique active global project on the server. Chat
persists a non-secret provider/model selection only through an authenticated
server endpoint that validates the exact pair against that global catalog. Docs
uses the persisted server-owned pair when it remains valid, otherwise its safe
server-derived global Chat default. Provider/model fields from Docs browser
requests are not used to select the broker.

### Same-Provider Different-Model Support

The broker allows primary and backup to share the same provider with different models (e.g., primary `deepseek:fast-model`, backup `deepseek:thorough-model`). Only identical `(providerID, modelID)` pairs are suppressed.

## Chat Provider Architecture

The Chat page (`/chat`) uses a **dual-source** provider model that merges user-managed providers with runtime-discovered OpenCode Zen free models. The architecture follows a three-layer projection with an additional runtime discovery loop:

### Data Flow

```
                                      ┌─────────────────────────────────────┐
                                      │  OpenCode Zen (runtime)            │
                                      │  GET /api/v1/opencode/builtin-     │
                                      │  providers                         │
                                      └──────────┬──────────────────────────┘
                                                 │ Filters to free (input=0,
                                                 │ output=0) models only
                                                 ▼
Settings (Providers tab) ──PUT───▶  API (/api/v1/settings/provider-configs)
                                          │
                                     Saves to settings table
                                      (ordered provider metadata + separate keys;
                                       mirrors selected primary/backup roles into
                                       legacy synthesis settings)
                                          │
                                     Projects into OpenCode global config.jsonc
                                      as OpenCode ProviderConfig entries keyed by
                                      each user-managed provider ID
                                          │
Chat page (/chat)  ◀──GET──  API (/api/v1/opencode/chat-config)
                                      Returns sanitized config:
                                      { primary, backup, agents,
                                        providers: [...], defaultSelection }
                                      OpenCode live-reloads provider config
                                      changes — no restart required
```

The Chat page fetches `chat-config`, which internally:
1. Reads **managed providers** from the settings DB (`llm_provider_configs`)
2. Calls **`GET /builtin-providers`** against OpenCode's runtime provider catalog with a free-model filter
3. **Merges** the two into a single `providers[]` array (managed entries first, builtin entry last)
4. Computes a `defaultSelection` based on the priority hierarchy

### Default Selection Logic

The `defaultSelection` field tells the Chat page which provider+model to pre-select in the dropdown:

| Priority | Candidate | Condition |
|----------|-----------|-----------|
| 1st | Persisted Chat selection | The server-owned `chat_selection` pair, only when it exactly matches the active catalog |
| 2nd | Managed primary provider | Whichever managed block has `roles` containing `"primary"` |
| 3rd | Valid legacy primary | The legacy `synthesis_provider` + `synthesis_model` pair, only when it exactly matches the active catalog |
| 4th | OpenCode Zen default | The runtime `default.opencode` model (e.g., `"big-pickle"`) if it is a free model |

No arbitrary managed provider is selected. If no valid selection/default exists,
`defaultSelection` is `null` and the Chat page shows the "No LLM" banner. A
non-network catalog failure returns the fixed `503 LLM_CATALOG_UNAVAILABLE`
contract without upstream diagnostics. A recognized OpenCode network-startup
failure retains the fixed `503 OPENCODE_UNAVAILABLE` startup message; neither
case returns an empty catalog as though no providers were configured.

### Key Properties

- **Atomic save**: `PUT /api/v1/settings/provider-configs` saves any number of provider blocks in one transaction. Omitting `apiKey` preserves the credential; an empty value clears it. Responses expose only `apiKeySet: boolean`.
- **OpenCode projection**: Enabled blocks are written to the global `provider` object using OpenCode's `npm`, `options.baseURL`, and `models` schema. Removed managed IDs are removed without changing unrelated config entries. API keys are synchronized through OpenCode auth and never written to config files.
- **Ingenium roles**: One block can be primary and one can be backup. Those selections are mirrored into the existing synthesis settings consumed by Chat and the synthesis engine; additional blocks remain available in OpenCode.
- **Sanitized response**: `GET /api/v1/opencode/chat-config` uses an allowlisted DTO. Chat receives provider/model IDs, display labels, source, and default selection only; it never receives API keys, provider endpoints, base URLs, headers, packages, or internal topology. The `providers[]` array includes both managed entries (`source: "managed"`) and the discovered builtin entry (`source: "builtin"`).
- **Runtime builtin discovery**: `GET /api/v1/opencode/builtin-providers` queries OpenCode's runtime provider list and filters to only free models (`cost.input === 0 && cost.output === 0`) from the `opencode` provider ID. The response shape is `{ providerId, providerName, models: [{id, name, providerID}], defaultModel, source: "runtime" }`. When OpenCode is unreachable, returns `{ models: [], defaultModel: null, source: "unavailable" }`.
- **Builtin providers are read-only**: The OpenCode Zen entry in the `providers[]` array has `source: "builtin"` to distinguish it from managed providers. It is never persisted to the DB, never written to OpenCode config, and is recomputed on every `chat-config` request. The Chat page treats it as a non-editable runtime option.
- **Catalog errors are sanitized**: Catalog failures are normalized to fixed `503` contracts (`OPENCODE_UNAVAILABLE` for recognized network startup failures, otherwise `LLM_CATALOG_UNAVAILABLE`). Upstream error codes, messages, endpoints, and credentials are not returned to Chat or Docs AI.
- **"No LLM" state**: When no provider is configured and no builtin is available, the response returns `{ configured: false }` with `defaultSelection: null`. The Chat page shows a banner linking to Settings → Providers.
- **Live reload**: Saving provider blocks triggers an OpenCode config reload in-process — no restart required. Provider changes take effect for new sessions immediately.

### Agent Model Inheritance

The `ingenium-chat` agent uses **no hardcoded `model` field** — it inherits the model from the Chat request's `modelID` parameter at send time. The agent also sets `hidden: true` to prevent it from appearing in OpenCode's non-Chat agent lists (e.g., the OpenCode Web/CLI agent selector).

| Property | Value | Reason |
|----------|-------|--------|
| `model` | (not set) | Inherits from Chat request at runtime |
| `hidden` | `true` | Only visible in Chat context, not OpenCode agent lists |

## Chat Project Context (CHAT-100)

Chat's optional project-context grounding is an explicit per-send choice. The
control starts off and resets after an accepted send. ProjectProvider validates
the selected dashboard project before Chat mounts; that selected project is the
Context search authority. This does not change Chat's global authority for
Chat-owned tools or provider/model selection.

Each requested search is bounded to at most 5 sources and a 512-character
query. Excerpts are deduplicated and placed only in a provider system-context
block capped at 5,000 characters. The block is delimited and explicitly marked
as untrusted reference data, so excerpts are never rendered in the Chat UI.
The UI retains only source metadata for live citations.

No matches produce an ungrounded send rather than blocking the prompt. A
retrieval error prevents that send while preserving the prompt and context
choice for retry. Live citation metadata is not durable across reload; stable
citation identity and reproducibility are owned by CTX-101.

## Native Provider OAuth Integration

Native OpenCode provider integrations use two OAuth modes, both handled by the
exact unauthenticated `GET /auth/callback` allowlist inside the auth middleware:

- **Auto mode (default)**: OpenCode opens a local HTTP listener on `localhost:1455` inside the container. The host's `127.0.0.1:1455` reaches the Nginx callback listener, which forwards only `GET /auth/callback` to private Express `4096`. Express validates the state from the `pendingOAuthAttempts` Map (10-min TTL), consumes the state (preventing replay), and forwards the callback to OpenCode's internal listener. The user sees an "Authorization received" page.
- **Code mode**: The API receives the OAuth code and state, validates and consumes the state, then calls `opencodeClient.completeIntegrationAttempt()` with the code. The user sees an "Authorization complete" page.

> 🔴 Both modes consume the state parameter before forwarding or exchanging, preventing redirect replay. Malformed states (>1024 chars or containing control characters) are rejected with 400.

### Integration States

| State | Storage | Lifecycle |
|-------|---------|-----------|
| Pending OAuth attempt | `pendingOAuthAttempts` Map (in-memory) | Created on `POST /integrations/:id/connect/oauth`. 10-min TTL. Pruned on every callback. |
| Integration credentials | OpenCode internal DB | Managed by OpenCode auth API, not exposed to Ingenium DB. |
| Connected provider models | OpenCode runtime catalog | Auto-discovered after successful connection. |

## Settings Provider Panel (PipelinePanel)

The Settings overlay's Providers tab (`PipelinePanel.tsx`) manages both native OpenCode provider connections and custom OpenAI-compatible endpoints:

### Native Provider Cards

Connected native providers render as a **Connected providers** list (cards with name, model count, and Disconnect button). Available native providers render in a **Native providers** grid with Connect buttons. Each card shows provider name, model count, and connection state. Clicking Connect opens a modal dialog (`Connect {providerName}`) with:

- **Login method selector** — drops down available auth methods (API key vs OAuth) when multiple exist
- **Prompt inputs** — dynamic form fields per the integration's method prompts (region selector, etc.)
- **API key field** — for key-based connections
- **OAuth flow** — "Continue in browser" button opens the OAuth URL in a new tab. Auto-mode polls for completion; code-mode shows an Authorization code input field with "Complete connection" button

### Custom Provider Cards

Custom (managed) providers render as collapsible sections with fields for: display name, provider ID, package selector (OpenAI-compatible, Anthropic, etc.), base URL, API key (show/hide toggle, clear, keep-saved-key), and a models list with radio-button default model selection. Providers can be reordered (↑/↓), collapsed, removed, and toggled on/off.

### Synthesis Provider Selectors

Two separate dropdown selectors below the custom provider list let users designate **Primary** and **Secondary** (backup) synthesis providers from the enabled custom providers. Primary selection automatically excludes it from the Secondary options (mutual exclusion enforced client-side). A synthesis interval selector (5 min to Disabled) controls the scheduled extraction → synthesis cycle.

## Broker Execution

The **broker execution** system (`brokerExecute()` in `services/ingenium-api/lib/opencode-client.ts`) provides a generic LLM-call mechanism that routes requests through OpenCode's provider infrastructure:

```
RAG Ask / other features  ──▶  brokerExecute()
                                     │
                             Creates ephemeral OpenCode session
                             (ingenium-llm-broker, wildcard deny,
                              no tool allowances)
                                     │
                            Sends prompt via /prompt endpoint
                                     │
                            Returns { ok, content, error }
```

### Architecture

- **Multi-provider routing**: `brokerExecute()` uses the OpenCode session API to dispatch prompts against any configured provider/model combination — not just the synthesis LLM.
- **Ephemeral sessions**: Each call creates a temporary OpenCode session with the named `ingenium-llm-broker` agent. That profile has a wildcard-deny permission rule and no allow exceptions, so no default, caller-selected, or future tool can execute. The API constructs the empty `tools: {}` selection itself; callers cannot supply a tool override. The session is not persisted or listed in the session catalog.
- **Synchronous response**: The function waits for the prompt response and returns `{ ok: true, content }` on success, or `{ ok: false, error }` on failure.
- **Timeout**: Configurable via `timeoutMs` parameter (default 30s).

### Consumers

| Feature | Consumer | Provider Resolution |
|---------|----------|---------------------|
| **Docs AI** | `POST /api/v1/docs/ai` | Server-owned validated global Chat selection, or the server-derived global Chat default; no browser override or broker fallback |
| **RAG Ask** | `POST /api/v1/rag/ask` | Synthesis primary/backup |
| **Job Suggestions** | `POST /api/v1/jobs/suggest` | Synthesis primary/backup |

The broker is used wherever a feature needs to make an LLM call without going through the synthesis pipeline's provider resolution. It treats OpenCode's provider config as the universal LLM gateway.

### 30-Second Hard Cap

Every broker call is capped at **30 seconds maximum** regardless of the `timeoutMs` argument passed:

```typescript
const timeoutMs = Math.min(Math.max(params.timeoutMs ?? 30_000, 0), 30_000);
```

The function creates an ephemeral OpenCode session, sends the prompt, and polls for completion with exponential backoff (500ms base, 30s max delay). If the deadline is exceeded, it returns `{ ok: false, error: "timeout" }` and immediately deletes the broker session. This prevents LLM calls from hanging indefinitely in interactive contexts.

### Fallback Chain

`executeSynthesisBroker()` iterates through deduplicated `(providerID, modelID)` choices in order: primary first, then secondary. If a provider returns `{ ok: false }`, the next choice is tried. If all configured choices fail, it returns `{ ok: false, error: "all configured synthesis providers failed" }` with no further retry.

## Context Memory Architecture (Phase 3)

The context memory system provides canonical agent memory that persists working context across sessions. It supersedes the legacy `plan_*` tools with a full CRUD surface while maintaining backward compatibility.

### Data Flow

```
Agent (MCP tool) ──▶ ingenium_context_get / ingenium_context_update
                             │
                    HTTP to /api/v1/context/*
                             │
                    context.createContext() / context.searchContext()
                             │
                    context_entries table (FTS5-indexed)
```

### Core Model

- **Table**: `context_entries` — project-scoped, FTS5 virtual table (`context_fts`) for full-text search
- **Entry fields**: `id`, `project_id`, `content`, `tags` (JSON string array), `priority` (integer 0–10, default 5), `session_id`, `source` (manual/agent/import/system), `metadata` (JSON object), `created_at`, `updated_at`
- **Validation**: content required and trimmed; priority validated as integer 0–10 (default 5); tags deduplicated, sorted, max 64 chars per tag; `source` must be one of `manual`, `agent`, `import`, `system`; `sessionId` optional, max 128 chars

### API Endpoints

| Method | `/api/v1/context/...` | Purpose |
|--------|----------------------|---------|
| GET | `/` | List recent entries (paginated, default 20) |
| GET | `/search?q=` | FTS5 search, BM25-ranked, limit-clamped (max 100) |
| POST | `/` | Create entry (201) |
| POST | `/batch` | Retrieve multiple by ID (max 100) |
| GET | `/:id` | Get single entry (404 if not found) |
| PATCH | `/:id` | Partial update |
| DELETE | `/:id` | Delete (204) |

### MCP Tools

| Tool | Transport Name | Description |
|------|---------------|-------------|
| `ingenium_plan_save` | `plan_save` | Legacy — saves context (delegates to `createContext`) |
| `ingenium_plan_search` | `plan_search` | Legacy — FTS5 search |
| `ingenium_plan_list` | `plan_list` | Legacy — list recent entries |
| `ingenium_context_get` | `context_get` | Canonical — get single entry by ID |
| `ingenium_context_update` | `context_update` | Canonical — partial update |
| `ingenium_context_delete` | `context_delete` | Canonical — delete entry |
| `ingenium_context_batch_get` | `context_batch_get` | Canonical — batch retrieve |

The `plan_*` tools remain supported for backward compatibility. The `context_*` tools provide the canonical CRUD surface. Both read/write the same `context_entries` table.

### WAL Safety

All context operations follow the HARD RULE `checkpointAfterWrite()` must be called OUTSIDE `execTransaction()`. Calling checkpoint inside a transaction causes `SQLITE_LOCKED`.

### Context RAG Sources (CTX-100)

Context sources are a separate, project-scoped corpus. They never inherit the
generic RAG route's optional global-project fallback, and a source owned by
another project is absent from list, get, and search results.

| Input | Route | Bound and lifecycle |
|-------|-------|---------------------|
| Direct source | `POST /api/v1/context/sources` (alias: `/uploads`) | UTF-8 content ≤1 MiB; SHA-256 deduplicated per project; allowed MIME types are `text/plain`, `text/markdown`, `application/json`, and `application/x-ndjson`. |
| Chunked source | `POST /api/v1/context/uploads/chunked`, then `.../:id/chunks` and `.../:id/complete` | Total ≤2 MiB, ≤32 chunks, each ≤64 KiB; staged chunks are not searchable until contiguous order, byte size, and SHA-256 verification succeed atomically. |

Source metadata accepts priority (integer 0–10, default 5), up to 64
deduplicated/sorted tags (each 1–64 characters; serialized tags ≤4 KiB), and a
bounded JSON-object metadata value (≤16 KiB, with bounded depth/nodes and no
path, credential, or secret-bearing keys/values). `sourceReference` is optional,
opaque, path-free, control-character-free, and at most 256 characters. Upload
requests reject path-bearing fields such as `file`, `filePath`, and
`sourcePath`.

The durable `context_rag_uploads` rows retain a source hash, provenance
(`direct_upload` or `chunked_upload` for CTX-100), and optional source reference.
`GET /api/v1/context/sources` lists metadata, `GET
/api/v1/context/sources/:sourceId` gets one source, and `GET
/api/v1/context/sources/search?q=` searches source metadata. These responses
contain no document bodies, chunk excerpts, or source paths; they expose only
metadata such as title, hash, MIME type, byte size, chunk count, provenance,
source reference, priority, tags, metadata, and timestamps.

Source and chunk rows are immutable after publication. Incomplete chunk sessions
remain outside the index; completed source/chunk/index/provenance writes commit
together, and database guards reject source or chunk updates/deletes and chunk
reassignment. Content retrieval and LLM grounding are not enabled by this
metadata contract; chat grounding/default behavior belongs to CHAT-100.

When a source is attached to an immutable checkpoint, migration 065 freezes its
source and chunks at the database layer. A companion
`context_checkpoint_rag_source_snapshots` row preserves the title, hash, path,
MIME type, provenance, and source reference seen at checkpoint creation.
`GET /context/conversations/:conversationId/checkpoints/:checkpointId/rag/search`
therefore searches only that frozen source set and returns historical citations.

### Context RAG Citations (CTX-101)

Each Context RAG citation is evidence for one immutable persisted chunk:
`citationId` is exactly the chunk's UUID (`rag_chunks.id`), while `sourceId`,
`sourceHash`, and `chunkIndex` identify the owning immutable source, its SHA-256
content hash, and the chunk's position. Retrieval currently reports
`availability: "available"`. Search uses a total deterministic order:
priority descending, BM25 rank ascending, source `updated_at` descending, source
ID ascending, chunk index ascending, then chunk ID ascending. Because published
sources and chunks are immutable, repeating the same retrieval returns the same
citation identity and ordering while the source remains available. Foreign or
missing sources produce neutral absence (no cross-project disclosure or
substitute citation), rather than an error that reveals their existence.

Generic RAG re-ingest or delete cannot mutate a published Context source; those
attempts return `409 RAG_SOURCE_IMMUTABLE`.

### Context checkpoint governance (CTX-004)

Maintenance is a project-scoped, two-step workflow: a bounded, content-free
candidate preview is reviewed first, then an authorization operation issues a
single-use 15-minute confirmation token bound to a concrete target and observed
conversation revision. Archive and unarchive append audit events rather than
changing conversation rows. A derived archive state hides archived
conversations from ordinary lists and rejects new messages/checkpoints; an
unarchive event reverses that visibility state without changing history.

Checkpoint restoration stays restore-as-new. It validates the source revision,
checkpoint state hash, and confirmation token, copies the checkpoint stream to
a new immutable conversation, and appends an audit event connecting source
conversation/checkpoint, source state hash, authorization, and target
conversation. Audit APIs return IDs, event types, revisions, hashes, and
timestamps only—never message bodies, free-form metadata, or raw tokens.
There is no checkpoint deletion path; database immutability triggers protect
checkpoints and maintenance audit rows even from direct SQL mutation.

### Context-native OpenCode file snapshots (CTX-005)

The canonical OpenCode import path is the `ingenium_context_upload_file` MCP
tool. It accepts `project`, `session`, and `file_path`, plus optional
`conversation_id`, `tags`, and `priority`. The launcher accepts only a private
regular file under the verified project-bound `.ingenium/context-uploads` root,
performs one descriptor-safe `O_NOFOLLOW` read with pre/post identity checks,
and supports OpenCode export JSON, simple JSON, JSONL/NDJSON, Markdown, and
text. Only visible `user` and completed `assistant` content is retained;
synthetic, ignored, hidden, non-text, and other-role entries are filtered.

The MCP side builds one bounded snapshot and performs one protected internal
handoff to the API. The API validates that snapshot and invokes one protected
transactional import; this route is an internal transport boundary, not a
public bulk API. New snapshots create a conversation. A requested existing
conversation is adopted only after project ownership and prefix verification.
Matching replays are idempotent, matching extensions append only the suffix and
refresh its mapping, while shorter or divergent snapshots fail without partial
writes.

Imported conversations are visible in the dashboard Context workspace. The UI
uses the existing project-scoped conversation list/get and message
list/search/retrieve/batch surfaces for metadata, search, and explicit content
loading. No external Thread service or bridge exists, and the retired
current-session/OpenCode-session import surfaces are not part of the system.

## RAG Indexing Architecture (Phase 3)

The RAG (Retrieval-Augmented Generation) system provides two indexing paths feeding a unified search index.

### Two Indexing Paths

**Path 1 — Canonical Repo Files:**
```
POST /api/v1/rag/ingest
       │
  indexConfiguredDocs(globalProjectId, INGENIUM_DOCS_ROOT)
       │
  Walks {root}/docs/**/*.md (skips symlinks, realpath containment check)
       │
  ingestCanonicalSource() — SHA-256 hash-idempotent (unchanged files skipped)
       │
  replaceSourceContent() — atomically replaces chunks (ingestion_state tracking)
       │
  Sources with source_type='file', source_path='docs/relative/path.md'
```

| Guard | Behavior |
|-------|----------|
| Symlink skip | `lstatSync().isSymbolicLink()` — symlinks never followed |
| Root escape prevention | Realpath containment: `docsRoot` must start with `{rootReal}/` |
| Hash idempotency | Same hash → `unchanged++`, no DB write |
| Stale removal | Sources with `source_type='file'` and path `docs/%` not in current file set are deleted |

**Path 2 — Docs Workspace Pages (lifecycle-bound):**
```
publishPage() ──▶ indexPublishedDoc(page) ──▶ source_path = "docs-page:{id}"
updatePage()  ──▶ indexPublishedDoc(page)    (only if status === "published")
archivePage() ──▶ indexPublishedDoc({status:"archived"})  ──▶ source deletion
restorePage() ──▶ indexPublishedDoc(page)    ──▶ source creation
```

- Pages are indexed as `source_type='text'` with metadata `{ kind: "docs_page", pageId, slug, provenance: "docs-workspace" }`
- Archive triggers source deletion from RAG (cascade cleanup)
- No duplicated editable docs pages — canonical `docs/**/*.md` files are indexed directly

**Path 3 — Manual:**
- `POST /rag/sources` + `POST /rag/sources/:id/ingest` for arbitrary text

**Path 4 — Context documents (project-local):**
- `POST /context/uploads` and the chunked-upload lifecycle create durable RAG
  sources only after all validation and indexing work commits.
- `POST /context/learning/ingest` is an explicit snapshot of durable learning
  records rather than an automatic raw-observation export.

### Atomic Canonical Ingestion

Every canonical ingestion (`ingestCanonicalSource()`) is fully atomic within a single `execTransaction()`:

1. **Idempotency gate** — SHA-256 hash of the incoming content is compared against the stored `source_hash`. If unchanged, the function returns the existing source without any DB writes.
2. **Path uniqueness** — A `UNIQUE INDEX` on `rag_sources(project_id, source_path) WHERE source_path IS NOT NULL` (migration 050) guarantees at most one source per canonical path per project. Re-ingesting the same path replaces the existing source.
3. **Lifecycle state tracking** — The `rag_ingestion_state` table records the transition `in_progress → completed` within the same transaction. Partial state is never visible to readers: if the transaction fails during source or chunk indexing, all changes roll back and the state remains at its previous value.
4. **Content replacement** — Existing chunks are deleted before new ones are inserted, all in the same transaction. SQLite FTS5 triggers keep `rag_chunks_fts` synchronized with `rag_chunks`; the source's `chunk_count`, `source_hash`, and `byte_size` are updated atomically.

This guarantees that querying the index during an ingest operation sees either the complete previous version or the complete new version — never a partially-indexed source.

### Environment Variable

`INGENIUM_DOCS_ROOT` — Required for canonical repo indexing. Must point to the repository root (the parent of the `docs/` directory). `indexConfiguredDocs()` throws if unset. Verified by `context-rag-phase3.test.ts`.

### FTS5 Indexing Strategy

| Property | Value |
|----------|-------|
| Index | `rag_chunks_fts` |
| Algorithm | SQLite FTS5 with Porter/unicode61 tokenization and prefix indexes |
| Ranking | BM25 |
| Storage | FTS5 index backed by `rag_chunks`; source metadata remains in `rag_sources` |

Canonical RAG, Context, and Docs retrieval is FTS5-only. No vector embeddings are generated or stored; migration 070 removes the legacy `rag_embeddings` table.

### Chunker

`rag-chunker.ts` auto-detects format and applies the appropriate chunking strategy:

| Format | Strategy | Max Tokens |
|--------|----------|------------|
| Markdown (`##`) | Split by `##` headings, heading-context preserved | 2000 |
| Plain text | Double-newline paragraphs, short para merging | 2000 |
| JSON (`{entries:[]}`) | One chunk per entry | content-length |
| JSONL | One chunk per line (Copilot transcript format) | content-length |

### Search

Two functions in `rag.ts`:

| Function | Algorithm | Use Case |
|----------|-----------|----------|
| `searchChunks()` | BM25 FTS5 only, snippet-generation, cross-project (include global) | `/search` route, `/ask` route, MCP search |
| `searchContextUploadChunks()` | BM25 FTS5 only, constrained by `context_rag_uploads` | Context current retrieval; never includes global sources |
| `searchChunksBySourceIds()` | BM25 FTS5 only, constrained to checkpoint-linked source IDs | Context historical checkpoint retrieval |

Both cap at 20 results by default. `searchChunks()` accepts `limit` (max configurable via API query param up to 100).

### Citations

The `POST /api/v1/rag/ask` endpoint returns:

```typescript
{
  answer: string;              // LLM-grounded answer with [1], [2] markers
  citations: Array<{
    id: string;                // Source UUID
    title: string;             // Source name
    path: string | null;       // Source file path or docs-page slug
    heading: string | null;    // Section heading from chunk
    snippet: string;           // BM25 snippet with <mark> highlights
    kind: string;              // Source type: "file" | "text" | "url"
    score: number;             // Negative BM25 rank
  }>;
}
```

Citations are deduplicated by source ID. The LLM prompt includes `"Answer with citations like [1], [2]."` The Dashboard AskDocsPanel renders `[N]` as superscript links with title tooltip and a source list.

## Dataset Reference

| Package | Description | DB Access |
|---------|-------------|-----------|
| `packages/ingenium-core/` | Shared library: SQLite WAL + FTS5, Zod schemas (DB access allowed) | Yes |
| `services/ingenium-api/` | Express REST API on :4097. Sole database authority. | Yes |
| `services/ingenium-server/` | MCP stdio server with 273 built-in tools. Project-scoped child discovery can add dynamic tools. Calls API via HTTP. Zero DB access. | No |
| `services/ingenium-dashboard/` | Next.js 16 App Router frontend with 21 primary routes plus the Settings overlay. Calls API via HTTP. Zero DB access. | No |
| `packages/ingenium-email/` | Gmail REST API + SMTP email engine (fetch-based, nodemailer). DB Access: No. | No |

## Status Page Architecture

The `/status` page renders two distinct card types from separate data sources:

- **Service cards** — supervisord-managed processes (ingenium-api, ingenium-dashboard, opencode-web, ttyd-opencode). Data sourced from `GET /api/v1/services/:name` which proxies `supervisor.getProcessInfo` XML-RPC calls. Cards show PID, port, uptime, exit code, and process logs.
- **Application cards** — in-process scheduled tasks and stateful modules (email-client, synthesis-engine, docs-workspace, tasks-board) running inside the `ingenium-api` Express process. Data sourced from `GET /api/v1/services/applications/:name` which queries the respective module directly. Cards show application-specific fields (interval, last run, pipeline stats, email account folders, doc/task counts).

> **Service cards in local dev**: When running without supervisord, the supervisord XML-RPC endpoint is unreachable, so **service cards will not appear**. Application cards (in-process modules) remain fully available since they query the API process directly. Both card types render the same `ServiceOverlay` detail modal when clicked; the overlay correctly handles the absence of supervisord data.

The detail overlay (`ServiceOverlay.tsx`) switches its data fetching and diagnostics grid based on the `type` prop (`"service"` vs. `"application"`). The `handleServiceClick()` function on the page determines the card type by checking which array the name appears in. See `services/ingenium-api/lib/routes/services.ts` for the API implementation and `services/ingenium-dashboard/src/app/status/page.tsx` for the frontend split.

## Dashboard Pages

The Ingenium Dashboard (http://localhost:3000) provides 21 primary route-based pages plus the Settings overlay (22 user-facing views):

| Page | Purpose |
|------|---------|
| `/` | Home — operational home dashboard with live metrics (learning stats, task counts, job counts, mail status) via `/api/v1/dashboard/summary` in a 2×2 card grid |
| `/chat` | Ingenium Chat — standalone conversational agent interface |
| `/opencode` | Embedded OpenCode Web/CLI iframes (no native chat) |
| `/projects` | Project management (create, rename, archive, restore) |
| `/skills` | Skills grid with detail overlay, syntax highlighting |
| `/docs` | Documentation workspace with spaces, page tree, editor (autoFocus on rename inline bar for immediate typing), search, templates, metadata, history, and trash |
| `/jobs` | Job queue and background task monitoring — create/edit modal with 2-column responsive layout (metadata left, prompt_template right) and magic-wand button for AI job config generation from description |
| `/logs` | Structured logging and event viewer |
| `/mail` | Mail (inbox, compose, reader, auto-responses) — email client interface |
| `/status` | Supervisord process and in-process application status |
| `/tasks` | Kanban board (todo → in_progress → review → done) |
| `/plugins` | Plugin lifecycle (enable, disable, configure) |
| `/agents` | Agent profiles (model, mode, enable/disable) |
| `/mcp-servers` | MCP servers + Tool Manager (Servers/Tools tabs, per-tool enable/disable toggles) |
| `/config` | OpenCode project/global configuration editor and disk sync |
| `/observations` | Self-learning observations with FTS5 search + type/status filters |
| `/personality` | Personality traits with confidence bars, enable/disable |
| `/pipeline` | Git-workflow-style timeline of pipeline events (3s poll, filters, +N collapse) |
| Settings (overlay) | Full-screen, URL-driven overlay with 14 panels opened with `?settings=<tab>`; four panels are functional forms/launchers and ten link to their dedicated workspaces; `/settings` redirects to `/?settings=general` |

Additional `page.tsx` entrypoints support `/settings` redirect, `/standalone` embedding, `/mail/[id]`, `/mail/oauth/callback`, and `/observations/[id]`. Together with the 21 primary routes, the App Router contains 26 page entrypoints. The dashboard talks to the API layer only — zero direct DB access.

### MCP Tool Count

The built-in system catalog exposes **275 tools** across **29 baseline
categories** (**273 stdio + 2 extension**). Project-scoped child discovery can increase the effective total
and category count. Canonical catalog at `packages/ingenium-core/lib/tools/mcp-tool-catalog.ts`.

| Category | Count | Tools |
|----------|-------|-------|
| Settings | 3 | get, set, test_llm |
| Skills | 25 (11 core + 14 governance) | **Core:** list, load, search, create, update, delete, enable, disable, sync, consolidate, sync_all. **Governance:** archive, restore, list_archived, versions, rollback, lineage_create, lineage_list, proposal_create, proposal_list, proposal_get, proposal_submit, proposal_approve, proposal_reject, proposal_rollback |
| Observe | 1 | observe |
| Observations | 8 | search, list, stats, get, update, enrich, delete, delete_by_source |
| Personality | 7 | personality, personality_traits, set_trait, trait_dismiss, trait_disable, trait_delete, traits_delete_all |
| Synthesis | 4 | run, status, cross_project, synthesize_observations |
| Extraction | 2 | extraction_run, auto_observe_now |
| Pipeline | 3 | events, timeline, event_log |
| Status | 4 | service_status, service_application_detail, service_process_detail, service_process_logs |
| Health | 1 | health_check |
| OpenCode | 1 | opencode_messages |
| Tasks | 30 | create, list, move, reserve, release, complete, next, update, delete, search, comment, activity, link, board_config_get, board_config_set, subtask_create, notifications, get, comments_list, comment_edit, comment_react, links_list, link_delete, tree, notification_read, bulk_update, coordination_status, coordination_update, coordination_claim, coordination_release |
| Plans (Context) | 3 | save, search, list |
| Projects | 10 | list, init, delete, restore, list_archived, purge, set_global, rename, detail, migrate_workspace |
| Plugins | 8 | list, get, enable, disable, create, delete, update, source |
| Commands | 5 | list, get, create, update, delete |
| Config | 3 | get, set, sync |
| Servers | 5 | list, add, remove, update, sync_all |
| Agents | 8 | list, get, create, update, delete, enable, disable, sync |
| Email | 27 | list, search, read, send, draft, folders, accounts, triage, suggest, draft_response, patterns, watch_start, watch_status, account_create, account_delete, account_test, oauth_url, oauth_exchange, summarize, review_draft, move, set_flags, delete, sync, sync_status, watch_stop, attachment_get |
| Logs | 2 | list, sources |
| Jobs | 10 | list, create, update, delete, run, runs, run_logs, run_cancel, get, suggest |
| Dashboard | 1 | dashboard_summary |
| Documentation | 48 | list_spaces, get_space, create_space, update_space, delete_space, list_pages, get_page_tree, get_page, create_page, update_page, delete_page, restore_page, move_page, search, get_draft, save_draft, delete_draft, list_versions, get_version, restore_version, list_comments, create_comment, resolve_comment, delete_comment, list_tags, get_page_tags, add_tag, remove_tag, get_backlinks, list_attachments, delete_attachment, list_templates, get_template, create_template, update_template, delete_template, link_project, unlink_project, get_projects, toggle_favorite, get_favorites, import_pages, export_space, get_stats, publish_page, trash_list, trash_purge, attachment_download |

The category table counts server registrations; the two extension tools are
`synthesize_observations` and `auto_observe_now`.

---

## API Configuration

The Express API uses `express.json({ limit: "2mb" })` for request body parsing. This allows large skill payloads (when uploading skills with file_tree data) without hitting the default 100KB limit. Other middleware includes helmet for security headers, CORS and browser CSRF using the same exact `DASHBOARD_ALLOWED_ORIGINS` allowlist, and mandatory bearer token auth behind the loopback `4097` boundary.

## Dashboard Features

### OpenCode Web/CLI Embedded in Dashboard
The dashboard includes an embedded OpenCode experience at `/opencode` with a **Web/CLI dual-mode interface**. The conversational chat interface has been separated to its own page at `/chat`.

- **Web mode** — Embeds the OpenCode Web UI in a full-viewport iframe. The iframe `src` is dynamically resolved by `runtime-urls.ts` using a **two-tier embedding model**:
  - **Local host gateway**: `http://opencode.localhost:3000/` (Web), without HTTP Basic Auth or browser bearer tokens.
  - **Remote HTTPS**: requires explicit `NEXT_PUBLIC_OPENCODE_WEB_URL` pointing to a dedicated root HTTPS origin (e.g., `https://opencode.example.com/`)
   - **LAN/remote access**: requires an operator-managed authenticated TLS profile and explicit root HTTPS origins for both Web and CLI. The default Compose binding supports Windows-to-WSL localhost forwarding, but plain HTTP is not a supported LAN/remote profile.
  - The old same-origin proxy rewrites (`/opencode-web/`, `/opencode-cli/`) have been **removed** — OpenCode v1.18.3+ serves root-relative assets and cannot be proxied under a sub-path.
- **CLI mode** — Embeds a ttyd terminal through local `http://cli.localhost:3000/`, or an explicit root HTTPS origin via `NEXT_PUBLIC_OPENCODE_CLI_URL`, sharing session state with Web mode.
- **Mode switch** — A right-edge glass tab toggles between Web and CLI modes. Inactive iframes are hidden via `opacity`/`visibility`/`pointer-events` instead of `display:none` to prevent xterm dimension zeroing. Both iframes remain in the DOM at full viewport size once mounted.
- **Keyboard shortcut**: `Ctrl+Shift+\`` toggles modes from anywhere on the page.
- **Persistence**: The chosen mode is saved in `localStorage` and restored on page load.
- **Sandbox**: The `sandbox` attribute has been **removed** from all OpenCode iframes (trusted first-party content; separate origin provides isolation). Only `allow="clipboard-write"` (Permissions Policy) is retained.
- The workspace (`~/repos`) is mounted to `/workspace` in the container via Docker volume.
- The `appuser` has passwordless `sudo` access inside the container for package installation.

### Project Management
The Projects page at `/projects` features Active/Archived tab views. Users can:
- View active projects or toggle to see archived projects
- Rename projects inline (PATCH /projects/:name)
- Archive projects (soft-delete with timestamp)
- Restore archived projects
- Purge expired projects (configurable retention via Settings)

### Skill File Tree Navigation
When viewing a skill detail overlay, a split-pane layout is used:
- **Left sidebar** (`FileTree` component) — renders the skill's `file_tree` JSON as a navigable tree with SKILL.md, metadata.json, and any reference files/folders. Supports collapsible tree navigation.
- **Right pane** (`MarkdownViewer` component) — displays file content with Preview/Source toggle and highlight.js syntax highlighting
- **Inline editing** — click Edit to modify any file (SKILL.md or reference files) directly in the overlay, with Save persisting to the DB via PATCH

### Syntax Highlighting
highlight.js is used in two modes:
- **Preview mode** — auto-highlights `<code>` blocks inside rendered markdown
- **Source mode** — highlights the entire code block content based on file extension
Styles: `github.css` for light theme, `hljs-dark.css` for dark variant.

### Shared Markdown Renderer
Dashboard document and skill previews use the shared `MarkdownDocument` component (`components/MarkdownDocument.tsx`), which wraps `marked` (with GFM) and `DOMPurify` for safety, with `prose dark:prose-invert` for typography. `ChatMarkdown` uses the same module's `renderMarkdown` helper while adding chat-specific classes. The proposal comparison view intentionally bypasses Markdown rendering — both Current and Proposed panels show raw source text in matching `<pre>` blocks.

## Docker Deployment

The project ships as a single Docker container via `Dockerfile` (multi-stage build, root) and `docker-compose.yml` (single service):

```yaml
services:
  ingenium:
    build: .
    ports:
       - "3000:3000"             # Local dashboard and gateway roots; WSL-forwardable
      - "127.0.0.1:4097:4097"   # Bearer-authenticated host-loopback API boundary
      - "127.0.0.1:1455:1455"   # Exact OAuth callback listener (host loopback only)
    volumes:
      - ingenium-data:/app/.ingenium
```

Inside the container, **supervisord** manages seven processes:
1. **API boundary** (:4097 → private Express :4096) — authenticated bearer boundary and `express.json({ limit: "2mb" })` for large skill/plugin uploads
2. **Dashboard** (Next.js on :3000) — 21 primary routes plus the Settings overlay
3. **API** (private Express on :4096) — sole database authority
4. **Nginx gateway** (:3000 and :1455) — local root gateways and the exact OAuth callback route
5. **opencode-web** (on :4098) — private OpenCode web upstream behind the local `opencode.localhost:3000` gateway
6. **ttyd-opencode** (on :4099) — private OpenCode CLI upstream behind the local `cli.localhost:3000` gateway. It serves an xterm.js terminal that the dashboard `/opencode` page embeds as a second iframe.
7. **code-server** (private on :4100) — VS Code workspace upstream behind the exact local `vscode.localhost:3000` gateway; it is not publicly published.

Build-time UID matching ensures write access to workspace (`~/repos` → `/workspace`). Docker volumes `opencode-config` and `opencode-data` persist OpenCode configuration across container rebuilds.

The builder and runtime stages both use glibc-based `node:22-slim`, keeping native
Node module artifacts compatible with the runtime libc. The image verifies that
`better-sqlite3` loads in the runtime stage. Nginx runs as `appuser`; its PID,
lock, and temporary paths are recreated as owner-writable directories
under ephemeral `/run/ingenium-gateway` on each start.

> 🔴 **Docker git**: The Dockerfile installs the `git` package to support OpenCode repository creation inside the container. Without git, OpenCode fails to initialize new repos for code editing.

Start with:
```bash
docker compose up --build
```

### Port Mappings

| Host Port | Service | Description |
|-----------|---------|-------------|
| `3000` | Dashboard and gateways | Next.js frontend plus local root gateways without HTTP Basic Auth; supports default Windows-to-WSL localhost forwarding |
| `127.0.0.1:4097` | API boundary | Authenticated bearer boundary for host MCP and in-container dashboard/OpenCode traffic |
| internal `4096` | Express API | Private REST gateway and sole DB authority |
| internal `4098` | opencode-web | OpenCode Web upstream behind local `opencode.localhost:3000` |
| internal `4099` | ttyd-opencode | OpenCode CLI upstream behind local `cli.localhost:3000` |
| `127.0.0.1:1455` | OAuth callback proxy | Host `127.0.0.1:1455` → Nginx listener → private Express `:4096`; only exact `GET /auth/callback` is forwarded, and the auth middleware allowlists it without a bearer token. |

> Note: 4098 and 4099 are internal container listeners and are not browser-facing host ports. The loopback-only 4097 boundary requires a bearer credential; the local 3000 gateway has no HTTP Basic Auth and never receives a browser bearer token.

### Volume Configurations

| Volume Name | Mount Path | Purpose |
|-------------|------------|---------|
| `ingenium-data` | `/app/.ingenium` | SQLite databases, learnings, tasks, projects, commands |
| `opencode-config` | `/home/appuser/.config` | OpenCode configuration (persists across rebuilds) |
| `opencode-data` | `/home/appuser/.local` | OpenCode user data, session state |

**Workspace bind-mount:** Your local `~/repos` is mounted at `/workspace` for file editing.
