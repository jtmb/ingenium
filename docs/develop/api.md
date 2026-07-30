---
title: API Reference
description: REST API design reference for the Ingenium system — endpoint catalog, data flow, and configuration.
---

# API Reference

## Overview

The published Ingenium API boundary is `127.0.0.1:4097`; it validates a
mandatory bearer token and forwards to the private Express listener on
container port `4096`, which is the sole database authority. Host port `1455`
reaches the Nginx callback listener, which forwards only the exact
`GET /auth/callback` path to private Express `4096`.

## Public Endpoint (Auth Allowlist)

The following endpoint is the sole exact unauthenticated exception. The auth
middleware explicitly allowlists this method/path so provider redirects can
arrive without a local bearer credential:

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/auth/callback` | OAuth callback receiver for native OpenCode provider integrations. Validates state/code from `pendingOAuthAttempts` Map (10-min TTL). Supports both **auto mode** (forwards to OpenCode's internal `localhost:1455/auth/callback` listener) and **code mode** (completes via OpenCodeClient). State is consumed on first use to prevent redirect replay. Malformed states (>1024 chars or containing control chars) rejected with 400. |

### Authenticated Extension Preflight

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/auth/preflight` | Authenticated capability probe for extension-managed onboarding. Returns `{ data: { authenticated: true } }`; it does not disclose token configuration, credentials, upstream diagnostics, or HTTP details on failure. |

## Startup Behavior

The API performs the following at startup (in order):

1. **Validate API token** — Startup fails closed if the mandatory token or protected token file is missing or invalid
2. **Listen on private port** — The Express server starts on container port `4096`; the public boundary is `4097`
3. **Ensure global project** — `ensureGlobalProject()` idempotently creates the `global-default` project if it does not exist. This is required by the scheduler (synthesis interval resolution) and the email engine (account storage). Local development benefits from the same auto-bootstrap as Docker deployments.
4. **Start scheduler** — The synthesis, mail sync, job cron, and lock cleanup schedulers begin their cycles after a staggered delay.
5. **WAL checkpoint + integrity check** — Runs `wal_checkpoint(TRUNCATE)` and `integrity_check` to ensure the DB is healthy before the scheduler writes data.
6. **Start email engine** — Deferred by 10 seconds to let the DB fully initialize. If `getGlobalProjectId()` fails (no global project), the engine start is skipped with a warning.

### Graceful Degradation

If the global project is unavailable:

- **Health endpoint** (`GET /api/v1/health`) — responds with `200 OK` with a valid bearer even with zero projects; it is not unauthenticated
- **Mail sync** — skips silently with a `debug`-level log: `"Skipping mail sync — no global project configured"`
- **Synthesis** — reads interval from the env var default (15 min) and logs that no global project is configured
- **All other routes** — operate normally on a per-project basis

See the [startup regression tests](../../services/ingenium-api/tests/startup.test.ts) for coverage of these scenarios.

## Configuration

- **Ports**: public bearer boundary `4097`; private Express listener `4096` in Docker (configurable via `INGENIUM_API_PORT`)
- **Body limit**: `express.json({ limit: "2mb" })` for large skill/plugin uploads
- **Security**: helmet for security headers (default configuration — no custom CSP), CORS and browser mutation CSRF share the exact `DASHBOARD_ALLOWED_ORIGINS` allowlist, mandatory bearer auth; browser mutations also require the dashboard marker contract
- **Rate limits**: Three independent in-memory sliding-window rate limiters:

  | Limiter | Default | Applies To | Location |
  |---------|---------|------------|----------|
  | General API | 100 req/min per IP | All authenticated routes (before auth middleware to throttle brute-force) | `lib/middleware/rate-limit.ts` |
  | Vault | 5 req/min per IP | All `/api/v1/vault/*` routes | `scripts/api-server.ts:134` |
  | OAuth callback | 20 req/min per IP | `GET /auth/callback` (public, before auth) | `lib/routes/opencode.ts:97-98` |

  > Rate limit state is in-memory only — resets on process restart. Suitable for single-instance deployments with supervisord restarts. For multi-replica deployments, replace with Redis or an external store.

- **CSP**: Helmet's default Content-Security-Policy is applied. No custom CSP directives are configured. Iframe sandboxing is handled via the `sandbox` attribute on embedded iframes (see [Iframe Sandbox](../security/iframe-sandbox.md)), not via CSP `frame-ancestors`. CSP expansion remains deferred (see [Deferred Items in iframe-sandbox.md](../security/iframe-sandbox.md#-deferred-requires-runtime-testing)).

## API Endpoints by Category

### Dashboard Summary
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/dashboard/summary` | Aggregated home dashboard endpoint |

### Usage telemetry

All routes below require `?project=<name>`. Usage collection is metadata-only:
it never returns or persists prompt/message text, reasoning content, tool
payloads, or credentials. It can persist numeric reasoning-token metadata and
nullable assistant-agent attribution. `from` is inclusive and `to` is exclusive
UTC ISO timestamps; ranges are limited to 366 days. Provider/model/agent/status
filters may be repeated. Event pagination is cursor-based (maximum 200 rows), and CSV
exports are capped at 10,000 rows with a continuation cursor header when
truncated.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/usage/summary` | Totals, complete UTC daily series, and freshness metadata. Cost and metric availability distinguish `known`, `partial`, and `unavailable`; cache and reasoning-token counts are nullable and no hit rate is invented. |
| GET | `/api/v1/usage/breakdown` | Provider/model/assistant-agent breakdown for the filtered UTC range. Raw provider and model IDs are preserved; assistant-agent attribution is nullable. |
| GET | `/api/v1/usage/events` | Bounded metadata-only event page with `pagination.nextCursor`, `hasMore`, and `total`. |
| GET | `/api/v1/usage/export` | Bounded deterministic CSV export. Returns `X-Export-Truncated` and, when applicable, `X-Export-Next-Cursor`. |
| GET | `/api/v1/usage/mappings` | List this Ingenium project's explicit OpenCode project mappings. |
| PUT | `/api/v1/usage/mappings` | Create or confirm an explicit mapping with `{ "opencodeProjectId": "…" }`. A source mapping owned by another project returns `409`; there is no global fallback. |
| POST | `/api/v1/usage/sync` | Run a bounded manual metadata-only usage sync for this project's explicit mappings. |

The scheduler runs the same bounded collector every five minutes by default.
Unmapped OpenCode projects are quarantined without usage-event insertion until a
project owner creates an explicit mapping.

Collection is provider-agnostic: every supported OpenCode provider contributes
through the same assistant `step-finish` metadata path, while raw provider and
model IDs remain available for breakdowns. Agent attribution comes only from the
assistant message that owns the step-finish and remains `null` when unavailable.
If a message contains one step-finish, message-level token metadata (including
numeric reasoning tokens) may fill omitted part-level counters; values are not
redistributed across multiple step-finish parts. Cost, cache, and reasoning-token
data that is absent remains explicitly unknown.

### Projects
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/projects` | List all active projects |
| POST | `/api/v1/projects` | Create a new project |
| PATCH | `/api/v1/projects/:name` | Rename a project |
| DELETE | `/api/v1/projects/:name` | Archive a project |
| POST | `/api/v1/projects/:name/restore` | Restore an archived project |
| GET | `/api/v1/projects/archive` | List archived projects |
| POST | `/api/v1/projects/purge` | Purge expired projects |
| POST | `/api/v1/projects/migrate-workspace` | DB-only migration of historical invalid `/workspace` project into `global-default`. Optional `dry_run: true` for pre-flight validation. Returns `WorkspaceMigrationResult`. Never touches filesystem. |

### Skills
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/skills` | List all skills |
| GET | `/api/v1/skills/:name` | Get a skill by name |
| POST | `/api/v1/skills` | Create a new skill |
| PATCH | `/api/v1/skills/:name` | Update a skill |
| DELETE | `/api/v1/skills/:name` | Archive a skill (soft-delete) |
| GET | `/api/v1/skills/search?q=...` | FTS5 search across skills |

### Observations
Observation and personality endpoints require a valid `?project=<name>` query
parameter. Detail and mutation routes return `404 Not Found` when the requested
observation or trait is not owned by that project.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/observations` | List observations |
| POST | `/api/v1/observations` | Store observation |
| GET | `/api/v1/observations/search?q=...` | FTS5 search |
| GET | `/api/v1/observations/stats` | Pipeline statistics |
| GET | `/api/v1/observations/:id` | Get a project-owned observation |
| PATCH | `/api/v1/observations/:id` | Update a project-owned observation |
| POST | `/api/v1/extraction/run` | Trigger server-side extraction |

### Personality
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/personality` | List traits |
| GET | `/api/v1/personality/profile` | Get aggregated profile |
| POST | `/api/v1/personality/:id/disable` | Disable trait |

### Synthesis
| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/v1/synthesis/run` | Trigger synthesis pipeline |
| GET | `/api/v1/synthesis/status` | Check pipeline status |

### Config
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/config` | Get project config |
| PUT | `/api/v1/config` | Update project config |
| POST | `/api/v1/config/sync` | Sync config from disk to DB |

### Email

All email routes are prefixed with `/api/v1/emails`. All email data is global (project-level scoping is ignored — email is always global).

> 🔴 `GET /accounts` by default returns only non-hidden accounts. Pass `?include_hidden=true` to include hidden accounts.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| **OAuth** | | |
| GET | `/accounts/oauth/url?provider=` | Get OAuth authorization URL |
| POST | `/accounts/oauth` | Exchange OAuth code for tokens |
| **Account Management** | | |
| GET | `/accounts` | List email accounts (`?include_hidden=true` for all) |
| POST | `/accounts` | Create a new email account |
| PATCH | `/accounts/:id` | Update account metadata (e.g., `{"hidden": true}`) |
| DELETE | `/accounts/:id` | Delete an email account (stops sync worker, clears cache) |
| POST | `/accounts/:id/test` | Test IMAP connection |
| **Email Reading** | | |
| GET | `/?account=&folder=&page=&limit=&refresh=` | List cached emails in a folder |
| GET | `/:uid?account=&folder=` | Get a single email by UID (body fetch with 12s timeout) |
| **Search & Triage** | | |
| GET | `/search?account=&folder=&q=` | Search cached emails by keyword/sender/subject/date |
| GET | `/triage?account=&limit=` | Triage unread emails (cache-only) |
| **Folders** | | |
| GET | `/folders?account=` | List IMAP folders (engine-first, cache fallback) |
| **Smart Replies** | | |
| GET | `/suggest/:uid?account=&folder=` | Smart-reply suggestions (cache-first, LLM-generated) |
| GET | `/summarize/:uid?account=&folder=` | LLM-generated email summary (cache-first) |
| POST | `/review-draft` | LLM-powered draft review and improvement |
| **Send & Draft** | | |
| POST | `/draft` | Save a draft email |
| POST | `/` | Send an email |
| **Move & Flags** | | |
| PATCH | `/:uid/move` | Move an email to another folder |
| PATCH | `/:uid/flags` | Set flags on an email |
| DELETE | `/:uid` | Delete an email (moves to Trash via IMAP) |
| **Attachments** | | |
| GET | `/:id/attachments/:attachmentId` | Download an attachment by part ID |
| **Sync Engine** | | |
| POST | `/sync` | Hint the sync engine to prioritize a folder |
| GET | `/sync-status` | Per-folder sync status from the engine |
| **IMAP Watcher** | | |
| POST | `/watch/start` | Start IMAP IDLE watcher for real-time monitoring |
| POST | `/watch/stop` | Stop IMAP IDLE watcher |
| GET | `/watch/status` | Get watcher status for an account |

### Jobs
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/jobs` | List all jobs |
| POST | `/api/v1/jobs/suggest` | Derive job config from description |

### Settings — LLM Config

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/settings/provider-configs` | Read the ordered managed provider collection. Each provider block returns: `id`, `name`, `npm`, `baseURL`, `models`, `defaultModel`, `roles: ("available"\|"primary"\|"backup")[]`, `enabled`, `allowPrivateNetwork: boolean`, and `apiKeySet: boolean` — **the actual API key is never returned**. Falls back to legacy primary/backup settings until the collection is first saved. At most one provider may have `primary` in its roles array and at most one may have `backup`. Also returns `synthesis` object with `{ primary: { providerId, modelId }, secondary: { providerId, modelId } }` — the explicit synthesis provider+model selection, which may differ from the role-derived defaults. |
| PUT | `/api/v1/settings/provider-configs` | Atomically save any number of provider blocks. Accepts `roles` array and/or legacy `role` scalar (`available`\|`primary`\|`backup`) for backwards compatibility. `roles` supports multi-role: `["available", "primary"]` or `["available", "backup"]`. Also accepts an optional `synthesis` body field with `{ primary?: SynthesisSelection, secondary?: SynthesisSelection }` to override the role-derived synthesis provider selections — enabling same-provider different-model configurations. Validates exclusivity (at most one primary, at most one backup), synthesis selection constraints (cannot select the same provider+model for both primary and secondary), endpoint SSRF policy via `validateEndpointUrl`, and `allowPrivateNetwork` flag. Projects into OpenCode global config and mirrors synthesis selections into synthesis settings. API keys are stored in the encrypted vault (`vault_items` table, AES-256-GCM). |
| GET | `/api/v1/settings/llm-config` | Read atomic primary+backup LLM config. Returns provider, model, endpoint, `allowPrivateNetwork`, and `apiKeySet: boolean` — **the actual API key is never exposed**. API keys are stored in the vault, never in plaintext settings. Legacy `synthesis_api_key`/`synthesis_backup_api_key`/`llm_provider_api_keys` settings are auto-migrated into the vault on first read and then deleted from the settings table. |
| GET | `/api/v1/settings?key=oauth_gmail_client_secret` (or Outlook) | Return only `{ key, isSet, masked }` for a protected OAuth client secret. The value is never returned. The key is resolved against the sole active global project, regardless of the selected `project` query parameter. Sealed/unavailable vaults fail closed; unresolved legacy conflicts return `409 SECRET_MIGRATION_CONFLICT`. Duplicate active globals return `503 GLOBAL_PROJECT_UNAVAILABLE`. |
| POST | `/api/v1/settings` with `key` plus `action: preserve\|replace\|clear` | Manage a protected OAuth client secret in the active global project. `replace` requires a non-empty `value`; `clear` is explicit; `preserve` leaves the saved value unchanged. A blank implicit value is preserve. The vault must be initialized and unsealed for writes. |
| POST | `/api/v1/settings/llm-config` | Legacy primary+backup save contract retained for existing clients. New clients should use `PUT /provider-configs`. Accepts `allowPrivateNetwork` on primary and backup blocks. API keys are stored in the vault. |
| POST | `/api/v1/settings/test-llm` | Test an LLM connection. Accepts `allowPrivateNetwork` boolean body field. Rejects unsafe/internal endpoint addresses (same `validateEndpointUrl` guard as provider-configs save). On transport failure, returns `{ ok: false, status: 0, message: "Unable to reach LLM endpoint" }` — the endpoint URL is never reflected in error messages. |

### Pipeline
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/pipeline/events` | List pipeline events |
| GET | `/api/v1/pipeline/timeline` | Get grouped timeline |

### Documentation (Docs Workspace)
All routes prefixed with `/api/v1/docs`. See [Docs Workspace Reference](../reference/docs-workspace.md) for the full 52-endpoint catalog.

### Vault (Secrets Manager)
All routes prefixed with `/api/v1/vault`.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/initialize` | Initialize a new vault with passphrase + confirmation. Body: `{ password, confirmation }`. A new passphrase must be non-blank and at least 12 Unicode characters; confirmation must match. Returns `201` on success, `409` if already initialized, `422` on validation error, or `429` with `Retry-After` after five passphrase attempts per IP per minute. |
| POST | `/unseal` | Unseal vault with passphrase. When called from the dashboard (`x-ingenium-ui: dashboard` header present) on an uninitialized vault, returns `409 VAULT_NOT_INITIALIZED` — the Dashboard must use `/initialize`. For MCP/programmatic clients, auto-initializes on first use using the same new-vault passphrase policy. Returns `403` on invalid passphrase and `429` with `Retry-After` after five shared initialize/unseal attempts per IP per minute. |
| POST | `/seal` | Seal (lock) vault |
| GET | `/status` | Vault sealed/unsealed status plus `nextAction` (`initialize`, `unseal`, or `null`). Not subject to the vault brute-force limiter. |
| GET | `/items` | List vault item metadata (optionally `?folder_id=`); never returns secret values and is not subject to the vault brute-force limiter. |
| POST | `/items` | Create a vault item |
| GET | `/items/:id` | Get vault item metadata (no secret value) |
| POST | `/items/:id/reveal` | Reveal a vault item's secret value (audit-logged) |
| PUT | `/items/:id` | Update vault item value (re-encrypts) |
| PATCH | `/items/:id` | Update vault item metadata |
| POST | `/items/:id/rotate` | Generate and store a replacement value |
| DELETE | `/items/:id` | Delete vault item (soft-delete with audit) |
| GET | `/folders` | List folders with active item counts |
| POST | `/folders` | Create a folder |
| DELETE | `/folders/:id` | Delete a folder |
| POST | `/generate-password` | Generate a secure random password |
| POST | `/password/generate` | Dashboard-compatible password generation alias |
| GET | `/audit` | List redacted audit event metadata; no audit details or secret material are returned |

### Backups
All routes prefixed with `/api/v1/backups`.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/` | List all backup records |
| POST | `/` | Create a new backup (body: `{ type: "manual" }`) |
| GET | `/:id` | Get a single backup record |
| GET | `/:id/download` | Download backup snapshot files |
| DELETE | `/:id` | Delete a backup and its snapshot files |
| POST | `/restore/preview` | Validate and preview a restore (`backupId` in body) |
| POST | `/restore` | Confirm a validated restore job (`backupId`, `confirm: true`) |
| GET | `/restore/:jobId` | Get restore job status |
| GET | `/schedule` | Get backup schedule configuration |
| PUT | `/schedule` | Set backup schedule configuration |

### Context — Canonical Agent Memory
All routes prefixed with `/api/v1/context`. Project-scoped entries persist working context across sessions. FTS5-backed search. Backward-compatible with `plan_*` tools.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/` | List recent entries (paginated, `?limit=` & `?offset=`), newest-first |
| GET | `/search?q=` | FTS5 full-text search across context entries (`?limit=`, max 100) |
| POST | `/` | Create a context entry (`{ content, tags?, priority?, sessionId?, source?, metadata? }`) |
| POST | `/batch` | Batch retrieve entries by ID (`{ ids: number[] }`, max 100) |
| GET | `/:id` | Get a single context entry by ID |
| PATCH | `/:id` | Update fields on a context entry (`{ content?, tags?, priority?, sessionId?, source?, metadata? }`) |
| DELETE | `/:id` | Delete a context entry (204 no content) |

Input validation: `content` required, `priority` must be integer 0–10 (default 5), `tags` must be non-empty strings ≤64 characters. See `packages/ingenium-core/lib/tools/context.ts` and `services/ingenium-api/lib/routes/context.ts`.

#### Context RAG uploads and retrieval

These routes are project-scoped under `/api/v1/context`.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/uploads` | Ingest one bounded direct document. Accepts `{ title, content, mimeType?, priority?, tags?, metadata? }`; allowed MIME types are `text/plain`, `text/markdown`, `application/json`, and `application/x-ndjson`; maximum UTF-8 size is 1 MiB. Returns `200` for a project-local SHA-256 duplicate and `201` for a new source. |
| POST | `/uploads/chunked` | Start a bounded upload with `{ title, expectedHash, expectedBytes, chunkCount, mimeType?, priority?, tags?, metadata? }`. The total limit is 2 MiB, with at most 32 chunks. Supports `Idempotency-Key`. |
| POST | `/uploads/:uploadId/chunks` | Add one immutable `{ ordinal, content }` chunk (≤64 KiB). An identical retry is `200`; a conflicting ordinal is `409`. |
| POST | `/uploads/:uploadId/complete` | Verify contiguous chunk order, byte count, and SHA-256, then atomically index and publish the source. Incomplete uploads remain unsearchable. |
| GET | `/uploads` | List context-upload source metadata and provenance without returning document bodies. |
| GET | `/rag/search?q=` | Search only the current project's context-upload corpus and return provenance citations/snippets; no global fallback. |
| POST | `/rag/ask` | Ask against only the current project's context-upload corpus. Returns an answer plus source-hash/provenance citations. |
| GET | `/learning/current` | Retrieve bounded project-local observations/traits with latest input and trait timestamps. |
| POST | `/learning/ingest` | Explicitly snapshot current learning into a RAG source, or return `{ noOp: true, reason: "NO_CURRENT_LEARNING" }`. |
| GET | `/conversations/:conversationId/checkpoints/:checkpointId/rag/search?q=` | Search only the immutable RAG source set cited by that checkpoint and return historical citations. |

#### Context-native OpenCode snapshot transport

`ingenium_context_upload_file` uses the authenticated internal
`POST /api/v1/context/conversations/import` transport. This octet-stream route
is not a browser-facing or public bulk-message API: dashboard-originated
requests are rejected, and the route accepts one complete protected snapshot.
The MCP tool schema is exactly `{ project, session, file_path,
conversation_id?, tags?, priority? }`; `priority` is an integer from 0 through
10, `conversation_id` is a UUID, and `file_path` must be absolute. The launcher
binds `project` to its project identity and permits only a private regular file
under `.ingenium/context-uploads`, read once through one `O_NOFOLLOW`
descriptor. Supported formats are OpenCode export JSON, simple JSON,
JSONL/NDJSON, Markdown, and text. Only visible user and completed assistant
messages are retained.

The importer fails closed on visibility markers. The `hidden`, `synthetic`,
`ignored`, and `ignore` markers are accepted as visible only when absent or
exactly `false`, `0`, `"false"`, or `"0"`; any other present value, including
`null`, objects, or unexpected strings, excludes the record. The rule is
applied to the envelope and nested message/author/part records.

The protected read is descriptor-bound and checks file identity before and
after each read phase. Identity includes device, inode, link count, owner,
mode, size, and nanosecond `mtime`/`ctime`; the descriptor bytes are hashed
and re-hashed in a second stream. A same-inode, same-size in-place mutation
therefore fails with `CONTEXT_UPLOAD_FILE_REJECTED` rather than being
imported.

The MCP side makes one protected snapshot handoff and the API invokes one
transactional import. A new snapshot creates a conversation; an explicit
conversation target is adopted only after project ownership and imported-prefix
verification. Matching replays are idempotent, matching longer snapshots append
only their suffix and refresh the mapping, and shorter or divergent snapshots
return a conflict without partial writes. The response is metadata only.

This is the only Context-native OpenCode file import surface. There is no
external Thread service or bridge and no current-session/OpenCode-session import
tool. Imported conversations appear in the dashboard `/context` workspace,
which uses the existing conversation and message list/get/search/retrieve/batch
surfaces rather than this internal transport for browsing.

Context checkpoint links freeze their referenced RAG source/chunks and persist a
citation snapshot. Attempts to re-ingest or delete such a source are rejected;
normal checkpoint and source ownership checks remain project-scoped.

#### Immutable conversation checkpoint maintenance (CTX-004)

Conversation maintenance is deliberately opt-in and append-only. It never
deletes or updates a conversation, message, checkpoint, or checkpoint source.
All maintenance routes require the normal project scope and do not expose
message content through preview or audit responses.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/conversations/maintenance/preview` | Return at most 100 content-free candidate summaries. Callers may provide an explicit `staleBefore` cutoff; there is no automatic retention policy. The preview can also report checkpoint divergence, integrity failures, and multiple active restore branches. |
| POST | `/conversations/:conversationId/maintenance/authorize` | Issue a 15-minute, one-time confirmation token bound to one project-owned archive, unarchive, or restore-as-new action and its `expectedRevision`. The raw token is never persisted in audit output. |
| POST | `/conversations/:conversationId/archive` | Append an archive event after `{ expectedRevision, confirmationToken }`. Archived conversations are hidden from ordinary conversation lists and reject new messages/checkpoints; their immutable history remains readable by explicit project-scoped APIs. |
| POST | `/conversations/:conversationId/unarchive` | Append a reversible unarchive event after a separately authorized `{ expectedRevision, confirmationToken }` request. |
| GET | `/conversations/:conversationId/maintenance/audit` | Return bounded, content-free archive/unarchive/restore-as-new evidence (IDs, revisions, state hashes, and timestamps only). |
| POST | `/conversations/:conversationId/checkpoints/:checkpointId/restore` | Branch the checkpoint into a new immutable conversation. Requires `{ expectedRevision, confirmationToken }`; it never modifies the source conversation or checkpoint. |

There is intentionally no checkpoint delete endpoint. The database rejects
direct checkpoint updates/deletes and rejects changes to append-only audit rows.
Expired, consumed, wrong-project, or mismatched confirmation tokens all return
the same `409 MAINTENANCE_AUTHORIZATION_INVALID` response without reflecting
the token or conversation content.

### RAG (Retrieval-Augmented Generation)
All routes prefixed with `/api/v1/rag`.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/ingest` | Index canonical repo docs from `INGENIUM_DOCS_ROOT/docs/` — symlink-protected, hash-idempotent, removes stale files |
| POST | `/sources` | Create a new RAG source and ingest content |
| GET | `/sources` | List RAG sources for a project (`?limit=` & `?offset=`, max 100) |
| GET | `/sources/:id` | Get a RAG source by ID (includes `source_hash`, `byte_size`) |
| DELETE | `/sources/:id` | Delete a RAG source and cascade its chunks |
| POST | `/sources/:id/ingest` | Ingest/re-ingest content into an existing source |
| GET | `/search?q=` | BM25 FTS5 full-text search across RAG chunks with snippet generation |
| POST | `/ask` | Natural-language Q&A with LLM-grounded answers and citations. Returns `{ answer, citations: [{ id, title, path, heading, snippet, kind, score }] }`. Broker-executed via `executeSynthesisBroker()`. |
| GET | `/stats` | RAG index statistics (sources, chunks, embeddings, `vector_capability`) |
| POST | `/export` | Export all RAG sources as JSON |

### Repository Documentation Sync

All routes prefixed with `/api/v1/docs`.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/repository/sync?project=<project>` | Preview or atomically apply a complete repository Markdown manifest to managed Docs Workspace pages and their RAG sources. Use `{ manifest, dryRun? }`; invalid manifests return `422 INVALID_REPOSITORY_DOCS_MANIFEST`. |

The manifest is caller-supplied data: the API does not walk or open repository
paths. Entries are limited to normalized regular `docs/**/*.md` files with
matching SHA-256 hashes and size/secret-content validation. A dry run returns
the planned operations without mutation; apply archives only previously
managed documents missing from the complete manifest.

### Repository Resource Sync

All routes prefixed with `/api/v1/repository`.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/resources/sync?project=<project>` | Preview or atomically apply the repository-authoritative v2 manifest for skills, agents, and plugins. Use `{ manifest, dryRun? }`; invalid manifests return `422 INVALID_REPOSITORY_RESOURCES_MANIFEST`. |

The v2 resource manifest accepts exactly `skills`, `agents`, and `plugins`.
Each item carries stable identity, normalized path, and SHA-256 of its full
semantic projection. It preserves skill frontmatter/metadata/file trees, agent
permissions/hidden/skills plus compatibility-mirror paths, and plugin source,
order, enabled state, and options. The immutable `ingenium-llm-broker` cannot
be imported. Missing entries archive/remove only resources previously recorded
as repository-managed; manual, unmanaged, and system resources are untouched.
Commands and project/global configuration are deliberately excluded.

### `ingenium-init-project` CLI contract

The extension CLI is the repository-facing caller for these two sync endpoints.
It accepts exactly one mode, an optional documentation scope, and an optional
validated project override:

```text
ingenium-init-project --dry-run [--docs-only] [--project <name>]
ingenium-init-project --apply [--docs-only] [--project <name>]
```

`--dry-run` resolves the validated project identity and submits preview requests;
it does not provision a project, mutate remote state, or write the local sync
manifest. `--apply` provisions the validated project when necessary, applies the
projection, and advances the local repository baseline only after API
confirmation. The `all` scope covers repository Markdown plus `.opencode/skills`,
`.opencode/agents` (including compatibility mirrors), and configured/local
`.opencode/plugins` sources. `--docs-only` submits only the Markdown manifest.
`--project` is validated and takes precedence over `INGENIUM_PROJECT`, which
takes precedence over the validated worktree basename; the CLI never defaults
to `global-default`. In the production image, the command is on `PATH` at the
stable `/usr/local/bin/ingenium-init-project` path, independent of
`/app/node_modules/.bin`. Before either mode contacts a project or repository
route, the CLI calls the authenticated `GET /api/v1/auth/preflight` capability
probe. Authentication failure is fail-closed and intentionally reports only a
generic message; callers never receive a token, API URL, status, or upstream
response body.

This contract documents the available workflow; it does not assert that a live
onboarding or apply run has occurred.

**Indexing pipeline**: Two auto-indexing paths: (1) Canonical repo Markdown files via `POST /rag/ingest` walks `INGENIUM_DOCS_ROOT/docs/**/*.md` with symlink escape protection and SHA-256 hash idempotency. (2) Docs Workspace pages are indexed at lifecycle boundaries — publish, update (if published), archive, restore — as `docs-page:{id}` sources. Manual ingestion via `POST /rag/sources` and `POST /rag/sources/:id/ingest` is also available.

**Search**: The `/search` and `/ask` routes use `searchChunks()` (BM25 FTS5 full-text search). The `hybridSearch()` function (70% BM25 + 30% n-gram cosine similarity) also exists in `rag.ts` but is not currently wired to API routes. The embedding is a deterministic FNV-1a character-trigram hash (`ingenium-ngram-v1`, 384-dim) — NOT a true semantic embedding. The stats endpoint reports `{ vector_capability: { available: true, provider: "deterministic-n-gram", semantic: false } }`.

**Citations**: The `POST /ask` endpoint builds unique citations per source (deduplicated by source ID). Each citation includes `id`, `title`, `path` (source_path or docs-page slug), `heading`, `snippet` (BM25 snippet with `<mark>` highlights), `kind` (source_type: `file`, `text`, `url`), and `score` (negative BM25 rank). The broker prompt includes `"Answer with citations like [1], [2]."` to encourage citation-grounded responses. The Docs workspace Dashboard renders `[N]` markers as superscript links with title tooltips and a Sources list below.

Documentation on the chunker (`rag-chunker.ts`) and RAG core (`rag.ts`) is in the source.

### Services (Status Page)
All routes prefixed with `/api/v1/services`. Two distinct card types rendered on the `/status` page:

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/status` | List all process and application statuses |
| GET | `/:name` | Single process detail via supervisord `getProcessInfo` (ingenium-api, ingenium-dashboard, opencode-web, ttyd-opencode) |
| GET | `/:name/logs` | Read process logs (offset/limit, max 10000 bytes) |
| GET | `/applications/:name` | Detailed status for an in-process application |

#### Application Detail Endpoints (`GET /api/v1/services/applications/:name`)

| Application | Response Fields | Source |
|-------------|----------------|--------|
| `email-client` | `name`, `state`, `description`, `detail`, `engine` (accounts, folders, sync state) | `ingenium-email` engine status |
| `synthesis-engine` | `name`, `state`, `description`, `detail`, `intervalMs`, `lastRunAt`, `nextEstimate`, `stats` (observations, traits) | `synthesis.getSynthesisStatus()` |
| `docs-workspace` | `name`, `state`, `description`, `detail`, `stats` | `docs.getDocStats()` |
| `tasks-board` | `name`, `state`, `description`, `detail`, `stats` (total tasks, byColumn breakdown) | `tasks.listTasks()` |

### OpenCode Integration Routes

Provider integration routes are prefixed with `/api/v1/opencode`. The exact
`GET /auth/callback` endpoint is the sole unauthenticated auth-middleware
allowlist — see [Public Endpoint (Auth Allowlist)](#public-endpoint-auth-allowlist).

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/integrations` | List all native OpenCode integrations (provider auth metadata, connection methods) |
| GET | `/integrations/:id` | Get a single native integration by ID |
| POST | `/integrations/:id/connect/oauth` | Begin an OAuth integration attempt. Returns `{ attemptID, url, mode: "auto"\|"code", instructions }`. State stored in `pendingOAuthAttempts` with 10-min TTL. The returned URL is validated for SSRF safety before being returned. |
| POST | `/integrations/:id/connect/key` | Connect via API key. Accepts `{ key }` in body. |
| POST | `/integrations/complete` | Complete an OAuth code-mode attempt. Accepts `{ attemptID, code }`. |
| POST | `/integrations/attempts/:id/cancel` | Cancel a pending OAuth attempt. |
| GET | `/integrations/attempts/:id` | Poll OAuth attempt status. Returns `{ status: "pending"\|"complete"\|"failed"\|"expired", message? }`. |
| GET | `/builtin-providers` | Runtime OpenCode Zen free model discovery — queries OpenCode runtime provider catalog, filters to only free models. |
| GET | `/chat-config` | Sanitized merged provider catalog for the Chat page (managed + builtin); selection defaults are server-owned and catalog-gated. |
| PUT | `/chat-selection` | Authenticated global Chat selection; validates an exact provider/model pair against the active server catalog before persistence. |

## OpenCode Proxy Routes

The API proxies requests to the OpenCode server at :4098. The API-to-OpenCode
upstream request uses HTTP Basic Auth credentials injected server-side (never
exposed to the browser); this is separate from the local port-3000 gateway,
which does not show a browser password prompt. All proxy routes require
`OPENCODE_SERVER_PASSWORD` to be set (returns 503 otherwise). The API boundary
itself remains private and bearer-protected. SSE routes stream
`text/event-stream` with proper caching and buffering headers.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/opencode/health` | OpenCode server health |
| GET | `/api/v1/opencode/sessions` | List sessions |
| POST | `/api/v1/opencode/sessions` | Create session |
| GET | `/api/v1/opencode/sessions/status` | Session status (literal path — before `:id`) |
| GET | `/api/v1/opencode/sessions/:id` | Get session detail |
| PATCH | `/api/v1/opencode/sessions/:id` | Update session |
| DELETE | `/api/v1/opencode/sessions/:id` | Delete session |
| GET | `/api/v1/opencode/sessions/:id/messages` | Get messages (with optional `limit` and `before` pagination) |
| GET | `/api/v1/opencode/sessions/:id/messages/:msgId` | Get a single message |
| DELETE | `/api/v1/opencode/sessions/:id/messages/:msgId` | Delete a message |
| POST | `/api/v1/opencode/sessions/:id/prompt` | Accept a prompt for asynchronous processing. The body uses the `parts` array per the current OpenCode 1.18.9 contract; success returns HTTP `202` with `{ data: { accepted: true } }`. This response is only an acknowledgement and does not contain the assistant response. |
| POST | `/api/v1/opencode/sessions/:id/abort` | Abort session |
| POST | `/api/v1/opencode/sessions/:id/fork` | Fork session |
| POST | `/api/v1/opencode/sessions/:id/share` | Share session |
| DELETE | `/api/v1/opencode/sessions/:id/share` | Unshare session |
| POST | `/api/v1/opencode/sessions/:id/compact` | Compact session |
| POST | `/api/v1/opencode/sessions/:id/revert` | Revert session to a message/part checkpoint |
| POST | `/api/v1/opencode/sessions/:id/unrevert` | Unrevert session |
| GET | `/api/v1/opencode/sessions/:id/children` | Get session children (forked sessions) |
| GET | `/api/v1/opencode/sessions/:id/diff` | Get session diff (optional `messageID` query param) |
| POST | `/api/v1/opencode/sessions/:id/command` | Send a command (slash commands) |
| POST | `/api/v1/opencode/sessions/:id/init` | Initialize a session |
| GET | `/api/v1/opencode/sessions/:id/events` | SSE event stream (per-session). The dashboard-owned route is a dedicated unbuffered Node handler that forwards the persistent upstream readable stream directly; it sets `Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no`. Do not send this path through the generic compressed Next rewrite, which can buffer or transform an open SSE response and prevent live frames from reaching Chat. |
| GET | `/api/v1/opencode/events` | Global SSE event stream (no session filter) |
| GET | `/api/v1/opencode/chat-config` | **Sanitized Chat config** — returns `{ configured, primary, backup, providers: [...], agents, defaultSelection }`. The allowlisted DTO merges managed entries (`source: "managed"`) with the runtime-discovered OpenCode Zen builtin entry (`source: "builtin"`). It excludes API keys, `synthesis_endpoint`, base URLs, headers, packages, and provider/internal topology. `defaultSelection` prefers a valid server-owned Chat selection, then a managed primary, a valid legacy primary, or the OpenCode Zen runtime default. OpenCode live-reloads provider config changes — no restart required. Legacy `primary` and `backup` DTO fields are emitted only when their exact stored provider/model pair exists in this current allowlisted catalog; raw legacy setting values are otherwise omitted. Returns `{ configured: false, defaultSelection: null }` when no LLM is set up and no builtin is available. Recognized OpenCode network-startup failures return fixed `503 OPENCODE_UNAVAILABLE`; other catalog lookup failures return fixed `503 LLM_CATALOG_UNAVAILABLE`, without upstream diagnostics. |
| PUT | `/api/v1/opencode/chat-selection` | **Authenticated global Chat selection** — accepts `{ providerId, modelId }`, rejects project overrides, validates the exact pair against the active global server catalog, then saves the non-secret selection under the active global project. Docs AI never accepts this pair in its request DTO. |
| GET | `/api/v1/opencode/builtin-providers` | **Runtime OpenCode Zen free model discovery** — queries the OpenCode runtime provider catalog, filters to only free models (`cost.input === 0 && cost.output === 0`) from the `opencode` provider ID. Response: `{ data: { providerId, providerName, models: [{id, name, providerID}], defaultModel, source: "runtime" } }`. When OpenCode is unreachable, returns `{ models: [], defaultModel: null, source: "unavailable" }`. Sanitized — no `apiKey`, `options`, or `env` fields leak through. |
| GET | `/api/v1/opencode/providers` | List providers + models |
| GET | `/api/v1/opencode/agents` | List agents |
| GET | `/api/v1/opencode/mcp` | **Sanitized MCP status DTO** — returns normalized `status`, compatibility `connected`, optional non-negative `toolCount`, and fixed browser-safe error text only; malformed root responses return `502 MCP_STATUS_INVALID` instead of an empty list |
| POST | `/api/v1/opencode/mcp/:name/connect` | Connect MCP server; success is fixed `{ data: { accepted: true } }`, failure is fixed `502 MCP_CONNECT_FAILED` |
| POST | `/api/v1/opencode/mcp/:name/disconnect` | Disconnect MCP server; success is fixed `{ data: { accepted: true } }`, failure is fixed `502 MCP_DISCONNECT_FAILED` |
| GET | `/api/v1/opencode/permissions` | Pending permissions (global) |
| POST | `/api/v1/opencode/sessions/:id/permissions/:permId` | Reply to a permission request (session-scoped) |
| POST | `/api/v1/opencode/upload` | File upload for chat attachments (multipart, validated MIME allowlist) |
| GET | `/api/v1/opencode/questions` | Pending questions (read-only; no reply endpoint in OpenCode 1.18.9) |

### Chat prompt response lifecycle

`POST /api/v1/opencode/sessions/:id/prompt` acknowledges acceptance before the
provider turn completes. Consumers must open
`GET /api/v1/opencode/sessions/:id/events` **before** posting the prompt and
use that per-session SSE stream as the authoritative response channel. Consume
`message.part.updated`/`message.part.delta` events for incremental message and
reasoning content; treat `session.idle` as the successful terminal event and
`session.error` as the terminal failure event. A subsequent messages request
may be used to reconcile history, but it is not the completion signal.

In the dashboard, the same URL is claimed by a dedicated App Router route
handler rather than the generic `/api/v1/*` rewrite. That handler forwards the
stream without buffering or transformation so the connection can remain open
after `session.idle` for future events.

> **Security**: The Chat config endpoint is an allowlisted provider/model DTO: it excludes API keys, endpoints, base URLs, headers, packages, and internal topology. **API keys are never exposed or written to OpenCode config files.** Credentials are stored in the encrypted vault (`vault_items` table with AES-256-GCM), separated from provider metadata, synchronized to OpenCode through its auth API, and mirrored into the selected synthesis settings for runtime resolution. Legacy plaintext settings (`synthesis_api_key`, `synthesis_backup_api_key`, `llm_provider_api_keys`) are auto-migrated into the vault on first read and then deleted from the settings table.

Provider-catalog failures are also sanitized at the OpenCode client boundary:
server logs retain only request status and route context, while browser-facing
responses use the fixed catalog error contract and omit upstream codes,
messages, endpoints, and credential-related diagnostics.

Browser-facing scalar fields are validated before they enter these DTOs. Provider
and model IDs, display labels, and MCP server names must match their dedicated
compact allowlists and must not resemble API keys, tokens, passwords, bearer
values, endpoints, headers, cookies, sessions, or other credentials. Unsafe
scalars are rejected or replaced with a safe fallback; they are never partially
redacted and returned as opaque identifiers.

> **Known gap**: Questions cannot be replied to via the REST API in OpenCode 1.18.9. They are TUI-only — delivered through the control channel. There is no `POST /questions/:id/reply` endpoint.

## Data Flow

```
Dashboard → HTTP → API → Core → SQLite
MCP Server → HTTP → API → Core → SQLite
Email Client → OAuth2 + Gmail REST API / SMTP → Gmail Provider
```

### API-First Frontend
- Dashboard imports ZERO core/server code. All data via HTTP to API.
- MCP server talks to the API over HTTP. Zero DB access.

### Response Format

**Success:**
```typescript
{ "data": T, "total"?: number }
```

**Error:**
```typescript
{ "error": { "code": string, "message": string } }
```

## Related Docs
- [Architecture](../concepts/architecture.md) — System architecture and data flow
- [Database](database.md) — Database migrations and WAL safety
- [Variables](variables.md) — Environment variables
