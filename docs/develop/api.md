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
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/observations` | List observations |
| POST | `/api/v1/observations` | Store observation |
| GET | `/api/v1/observations/search?q=...` | FTS5 search |
| GET | `/api/v1/observations/stats` | Pipeline statistics |
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
| POST | `/initialize` | Initialize a new vault with passphrase + confirmation. Body: `{ password, confirmation }`. Passphrase must be at least 12 characters. Passphrases must match. Returns `201` on success, `409` if already initialized, `422` on validation error. |
| POST | `/unseal` | Unseal vault with passphrase. When called from the dashboard (`x-ingenium-ui: dashboard` header present) on an uninitialized vault, returns `503 VAULT_NOT_INITIALIZED` — the Dashboard must redirect to `/initialize`. For MCP/programmatic clients, auto-initializes on first use. Returns `403` on invalid passphrase. |
| POST | `/seal` | Seal (lock) vault |
| GET | `/status` | Vault sealed/unsealed status |
| GET | `/items` | List vault items (optionally `?folder_id=`) |
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
| GET | `/audit` | List vault audit log entries |

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
| GET | `/chat-config` | Sanitized merged provider catalog for the Chat page (managed + builtin). |

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
| POST | `/api/v1/opencode/sessions/:id/prompt` | Accept a prompt for asynchronous processing. The body uses the `parts` array per the v1.18.3 contract; success returns HTTP `202` with `{ data: { accepted: true } }`. This response is only an acknowledgement and does not contain the assistant response. |
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
| GET | `/api/v1/opencode/chat-config` | **Sanitized Chat config** — returns `{ configured, primary, backup, providers: [...], agents, defaultSelection }`. The `providers[]` array merges managed entries (`source: "managed"`) with the runtime-discovered OpenCode Zen builtin entry (`source: "builtin"`). `defaultSelection` picks the managed primary provider first, falls back to the OpenCode Zen runtime default, then the first provider. No API keys are exposed. OpenCode live-reloads provider config changes — no restart required. The `primary` and `backup` fields reflect the explicit synthesis provider+model selection from `llm_provider_configs`, which may differ from the role-derived defaults. Returns `{ configured: false, defaultSelection: null }` when no LLM is set up and no builtin is available. |
| GET | `/api/v1/opencode/builtin-providers` | **Runtime OpenCode Zen free model discovery** — queries the OpenCode runtime provider catalog, filters to only free models (`cost.input === 0 && cost.output === 0`) from the `opencode` provider ID. Response: `{ data: { providerId, providerName, models: [{id, name, providerID}], defaultModel, source: "runtime" } }`. When OpenCode is unreachable, returns `{ models: [], defaultModel: null, source: "unavailable" }`. Sanitized — no `apiKey`, `options`, or `env` fields leak through. |
| GET | `/api/v1/opencode/providers` | List providers + models |
| GET | `/api/v1/opencode/agents` | List agents |
| GET | `/api/v1/opencode/mcp` | MCP server status |
| POST | `/api/v1/opencode/mcp/:name/connect` | Connect MCP server |
| POST | `/api/v1/opencode/mcp/:name/disconnect` | Disconnect MCP server |
| GET | `/api/v1/opencode/permissions` | Pending permissions (global) |
| POST | `/api/v1/opencode/sessions/:id/permissions/:permId` | Reply to a permission request (session-scoped) |
| POST | `/api/v1/opencode/upload` | File upload for chat attachments (multipart, validated MIME allowlist) |
| GET | `/api/v1/opencode/questions` | Pending questions (read-only; no reply endpoint in v1.18.3) |

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

> **Security**: The Chat and provider-config endpoints return only provider metadata and key-presence flags. **API keys are never exposed or written to OpenCode config files.** Credentials are stored in the encrypted vault (`vault_items` table with AES-256-GCM), separated from provider metadata, synchronized to OpenCode through its auth API, and mirrored into the selected synthesis settings for runtime resolution. Legacy plaintext settings (`synthesis_api_key`, `synthesis_backup_api_key`, `llm_provider_api_keys`) are auto-migrated into the vault on first read and then deleted from the settings table.

> **Known gap**: Questions cannot be replied to via the REST API in v1.18.3. They are TUI-only — delivered through the control channel. There is no `POST /questions/:id/reply` endpoint.

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
