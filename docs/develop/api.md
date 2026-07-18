---
title: API Reference
description: REST API design reference for the Ingenium system — endpoint catalog, data flow, and configuration.
---

# API Reference

## Overview

The Ingenium REST API runs on port 4097 and is the sole database authority. All data flows through HTTP to this API.

## Startup Behavior

The API performs the following at startup (in order):

1. **Listen on port** — The Express server starts accepting connections immediately
2. **Ensure global project** — `ensureGlobalProject()` idempotently creates the `global-default` project if it does not exist. This is required by the scheduler (synthesis interval resolution) and the email engine (account storage). Local development benefits from the same auto-bootstrap as Docker deployments.
3. **Start scheduler** — The synthesis, mail sync, job cron, and lock cleanup schedulers begin their cycles after a staggered delay.
4. **WAL checkpoint + integrity check** — Runs `wal_checkpoint(TRUNCATE)` and `integrity_check` to ensure the DB is healthy before the scheduler writes data.
5. **Start email engine** — Deferred by 10 seconds to let the DB fully initialize. If `getGlobalProjectId()` fails (no global project), the engine start is skipped with a warning.

### Graceful Degradation

If the global project is unavailable:

- **Health endpoint** (`GET /api/v1/health`) — responds with `200 OK` even with zero projects
- **Mail sync** — skips silently with a `debug`-level log: `"Skipping mail sync — no global project configured"`
- **Synthesis** — reads interval from the env var default (15 min) and logs that no global project is configured
- **All other routes** — operate normally on a per-project basis

See the [startup regression tests](../../services/ingenium-api/tests/startup.test.ts) for coverage of these scenarios.

## Configuration

- **Port**: 4097 (configurable via `INGENIUM_API_PORT`)
- **Body limit**: `express.json({ limit: "2mb" })` for large skill/plugin uploads
- **Security**: helmet for security headers, CORS (configurable via `CORS_ORIGIN`), optional bearer token auth
- **Rate limit**: 100 req/min per IP (configurable via `INGENIUM_API_RATE_LIMIT`)

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
| GET | `/api/v1/settings/provider-configs` | Read the ordered managed provider collection. Each provider block returns: `id`, `name`, `npm`, `baseURL`, `models`, `defaultModel`, `roles: ("available"\|"primary"\|"backup")[]`, `enabled`, `allowPrivateNetwork: boolean`, and `apiKeySet: boolean` — **the actual API key is never returned**. Falls back to legacy primary/backup settings until the collection is first saved. At most one provider may have `primary` in its roles array and at most one may have `backup`. |
| PUT | `/api/v1/settings/provider-configs` | Atomically save any number of provider blocks. Accepts `roles` array and/or legacy `role` scalar (`available`\|`primary`\|`backup`) for backwards compatibility. `roles` supports multi-role: `["available", "primary"]` or `["available", "backup"]`. Validates exclusivity (at most one primary, at most one backup), endpoint SSRF policy via `validateEndpointUrl`, and `allowPrivateNetwork` flag. Projects into OpenCode global config and mirrors primary/backup roles into synthesis settings. |
| GET | `/api/v1/settings/llm-config` | Read atomic primary+backup LLM config. Returns provider, model, endpoint, `allowPrivateNetwork`, and `apiKeySet: boolean` — **the actual API key is never exposed**. |
| POST | `/api/v1/settings/llm-config` | Legacy primary+backup save contract retained for existing clients. New clients should use `PUT /provider-configs`. Accepts `allowPrivateNetwork` on primary and backup blocks. |
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

### RAG (Retrieval-Augmented Generation)
All routes prefixed with `/api/v1/rag`.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/sources` | Create a new RAG source and ingest content |
| GET | `/sources` | List RAG sources for a project |
| GET | `/sources/:id` | Get a RAG source by ID |
| DELETE | `/sources/:id` | Delete a RAG source and its chunks |
| POST | `/sources/:id/ingest` | Ingest/re-ingest content into an existing source |
| GET | `/search?q=` | Hybrid FTS5 and local embedding search across RAG chunks |
| POST | `/ask` | Natural-language Q&A with LLM-grounded answers and citations |
| GET | `/stats` | RAG index statistics (sources, chunks, embeddings counts) |
| POST | `/import/thread` | Import Thread MCP server session entries into RAG |
| GET | `/import/thread/status` | Get Thread import job status |
| POST | `/export` | Export all RAG sources as JSON (backup/migration) |

Documentation on the chunker (`rag-chunker.ts`), RAG core (`rag.ts`), and the Thread import/resumable ingestion pipeline is in the source.

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

## OpenCode Proxy Routes

The API proxies requests to the OpenCode server at :4098. HTTP Basic Auth credentials are injected server-side (never exposed to the browser). All proxy routes require `OPENCODE_SERVER_PASSWORD` to be set (returns 503 otherwise). SSE routes stream `text/event-stream` with proper caching and buffering headers.

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
| POST | `/api/v1/opencode/sessions/:id/prompt` | Send prompt (body uses `parts` array per v1.18.3 contract) |
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
| GET | `/api/v1/opencode/sessions/:id/events` | SSE event stream (per-session) |
| GET | `/api/v1/opencode/events` | Global SSE event stream (no session filter) |
| GET | `/api/v1/opencode/chat-config` | **Sanitized Chat config** — returns `{ configured, primary, backup, providers: [...], agents, restartRequired, defaultSelection }`. The `providers[]` array merges managed entries (`source: "managed"`) with the runtime-discovered OpenCode Zen builtin entry (`source: "builtin"`). `defaultSelection` picks the managed primary provider first, falls back to the OpenCode Zen runtime default, then the first provider. No API keys are exposed. Returns `{ configured: false, defaultSelection: null }` when no LLM is set up and no builtin is available. |
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

> **Security**: The Chat and provider-config endpoints return only provider metadata and key-presence flags. **API keys are never exposed or written to OpenCode config files.** Credentials are stored separately from provider metadata, synchronized to OpenCode through its auth API, and mirrored into the selected synthesis role settings for runtime resolution.

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
