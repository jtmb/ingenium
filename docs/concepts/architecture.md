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

### Resolution & Switching
- The **dashboard** resolves the default project dynamically by fetching the `is_global=1` project from the API (`GET /api/v1/projects` with `is_global` filter)
- Users can switch projects via:
  - The **ProjectDropdown** (folder icon + chevron) in the nav bar, positioned before the settings gear — available on all pages except `/mail` and `/opencode`, where it is disabled (`opacity-50 cursor-not-allowed`)
  - The `/projects` page, which shows an ACTIVE badge on the current project and a "Set Active" button on others
  - MCP tools like `ingenium_project_init` and `ingenium_project_set_global`
- When writing shared resources (skills, plugins, configs, settings), use `global-default`. When working from an external session, the `INGENIUM_PROJECT` env var determines the target

### Key Rule
> **Never assume a worktree-derived project name is the shared namespace.** The `global-default` project (with `is_global=1`) is the sole server/public namespace for shared resources. External sessions (like this repo's worktree-derived project) have their own isolated workspace — shared resources (skills, plugins, configs, settings) must be written to `global-default` explicitly, never to the worktree-derived project.

---

## Data Flow

```
Dashboard → HTTP → API → Core → SQLite
MCP Server → HTTP → API → Core → SQLite
Email Client → OAuth2 + Gmail REST API / SMTP → Gmail Provider
```

- `ingenium-api` is the **sole database authority**. No other service imports `ingenium-core` or any SQL library.
- `ingenium-server` runs as an MCP stdio transport with **243 registered tools** across **28 categories**. Two extension-registered tools bring the complete catalog to **245**. The server talks to the API over HTTP. Zero DB access.
- `ingenium-dashboard` is a Next.js 16 App Router frontend with **20 primary routes plus the Settings overlay**. It talks to the API over HTTP.

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

## Jobs API

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/v1/jobs/suggest` | Derive job config (prompt_template, schedule_cron, trigger_event) from a natural-language description using the Synthesis LLM. Returns `{ prompt_template, schedule_cron, trigger_event, configured }`. Requires a configured Synthesis LLM in Settings. |

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

The synthesis pipeline uses a two-tier LLM provider architecture for fault tolerance:

1. **Primary provider**: Configured via Settings (provider, model, API key, endpoint)
2. **Backup provider**: Optional failover (same configuration shape)

If the primary LLM call fails during Phase 2 skill synthesis:
1. The pipeline catches the error and logs it to `result.errors`
2. It attempts the backup provider with the same observation batch
3. If both fail, Phase 1 trait results are still saved
4. Provider saves validate configured base URLs before persisting changes

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
| 1st | Managed primary provider | Whichever managed block has `roles` containing `"primary"` |
| 2nd | OpenCode Zen default | The runtime `default.opencode` model (e.g., `"big-pickle"`) if it is a free model |
| 3rd | First selectable provider | `providers[0]` combined with its `defaultModel` |

If no managed providers exist and the OpenCode Zen runtime is unreachable, `defaultSelection` is `null` and the Chat page shows the "No LLM" banner.

### Key Properties

- **Atomic save**: `PUT /api/v1/settings/provider-configs` saves any number of provider blocks in one transaction. Omitting `apiKey` preserves the credential; an empty value clears it. Responses expose only `apiKeySet: boolean`.
- **OpenCode projection**: Enabled blocks are written to the global `provider` object using OpenCode's `npm`, `options.baseURL`, and `models` schema. Removed managed IDs are removed without changing unrelated config entries. API keys are synchronized through OpenCode auth and never written to config files.
- **Ingenium roles**: One block can be primary and one can be backup. Those selections are mirrored into the existing synthesis settings consumed by Chat and the synthesis engine; additional blocks remain available in OpenCode.
- **Sanitized response**: `GET /api/v1/opencode/chat-config` strips `apiKey` from every provider — the Chat page never sees API keys. Only provider ID, model ID, and a display label are returned. The `providers[]` array includes both managed entries (`source: "managed"`) and the discovered builtin entry (`source: "builtin"`).
- **Runtime builtin discovery**: `GET /api/v1/opencode/builtin-providers` queries OpenCode's runtime provider list and filters to only free models (`cost.input === 0 && cost.output === 0`) from the `opencode` provider ID. The response shape is `{ providerId, providerName, models: [{id, name, providerID}], defaultModel, source: "runtime" }`. When OpenCode is unreachable, returns `{ models: [], defaultModel: null, source: "unavailable" }`.
- **Builtin providers are read-only**: The OpenCode Zen entry in the `providers[]` array has `source: "builtin"` to distinguish it from managed providers. It is never persisted to the DB, never written to OpenCode config, and is recomputed on every `chat-config` request. The Chat page treats it as a non-editable runtime option.
- **"No LLM" state**: When no provider is configured and no builtin is available, the response returns `{ configured: false }` with `defaultSelection: null`. The Chat page shows a banner linking to Settings → Providers.
- **Live reload**: Saving provider blocks triggers an OpenCode config reload in-process — no restart required. Provider changes take effect for new sessions immediately.

### Agent Model Inheritance

The `ingenium-chat` agent uses **no hardcoded `model` field** — it inherits the model from the Chat request's `modelID` parameter at send time. The agent also sets `hidden: true` to prevent it from appearing in OpenCode's non-Chat agent lists (e.g., the OpenCode Web/CLI agent selector).

| Property | Value | Reason |
|----------|-------|--------|
| `model` | (not set) | Inherits from Chat request at runtime |
| `hidden` | `true` | Only visible in Chat context, not OpenCode agent lists |

## Native Provider OAuth Integration

Native OpenCode provider integrations use two OAuth modes, both handled by a public `GET /auth/callback` endpoint registered **before** the auth middleware:

- **Auto mode (default)**: OpenCode opens a local HTTP listener on `localhost:1455` inside the container. The Docker Compose file maps `127.0.0.1:1455` on the host to port `4097` (the API). When the OAuth provider redirects the browser to `http://localhost:1455/auth/callback`, it reaches the API, which validates the state from the `pendingOAuthAttempts` Map (10-min TTL), consumes the state (preventing replay), and forwards the callback to OpenCode's internal listener. The user sees an "Authorization received" page.
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
                            (no agent, empty tools list)
                                     │
                            Sends prompt via /prompt endpoint
                                     │
                            Returns { ok, content, error }
```

### Architecture

- **Multi-provider routing**: `brokerExecute()` uses the OpenCode session API to dispatch prompts against any configured provider/model combination — not just the synthesis LLM.
- **Ephemeral sessions**: Each call creates a temporary OpenCode session without a named agent and with an empty `tools: {}` block (tool execution is denied). The session is not persisted or listed in the session catalog.
- **Synchronous response**: The function waits for the prompt response and returns `{ ok: true, content }` on success, or `{ ok: false, error }` on failure.
- **Timeout**: Configurable via `timeoutMs` parameter (default 30s).

### Consumers

| Feature | Consumer | Provider Used |
|---------|----------|---------------|
| **RAG Ask** | `POST /api/v1/rag/ask` | OpenCode's configured provider |
| **AI features** | Future | Configurable via `providerID` param |

The broker is used wherever a feature needs to make an LLM call without going through the synthesis pipeline's provider resolution. It treats OpenCode's provider config as the universal LLM gateway.

## Dataset Reference

| Package | Description | DB Access |
|---------|-------------|-----------|
| `packages/ingenium-core/` | Shared library: SQLite WAL + FTS5, Zod schemas (DB access allowed) | Yes |
| `services/ingenium-api/` | Express REST API on :4097. Sole database authority. | Yes |
| `services/ingenium-server/` | MCP stdio server with 243 tools. Calls API via HTTP. Zero DB access. | No |
| `services/ingenium-dashboard/` | Next.js 16 App Router frontend with 20 primary routes plus the Settings overlay. Calls API via HTTP. Zero DB access. | No |
| `packages/ingenium-email/` | Gmail REST API + SMTP email engine (fetch-based, nodemailer). DB Access: No. | No |

## Status Page Architecture

The `/status` page renders two distinct card types from separate data sources:

- **Service cards** — supervisord-managed processes (ingenium-api, ingenium-dashboard, opencode-web, ttyd-opencode). Data sourced from `GET /api/v1/services/:name` which proxies `supervisor.getProcessInfo` XML-RPC calls. Cards show PID, port, uptime, exit code, and process logs.
- **Application cards** — in-process scheduled tasks and stateful modules (email-client, synthesis-engine, docs-workspace, tasks-board) running inside the `ingenium-api` Express process. Data sourced from `GET /api/v1/services/applications/:name` which queries the respective module directly. Cards show application-specific fields (interval, last run, pipeline stats, email account folders, doc/task counts).

> **Service cards in local dev**: When running without supervisord, the supervisord XML-RPC endpoint is unreachable, so **service cards will not appear**. Application cards (in-process modules) remain fully available since they query the API process directly. Both card types render the same `ServiceOverlay` detail modal when clicked; the overlay correctly handles the absence of supervisord data.

The detail overlay (`ServiceOverlay.tsx`) switches its data fetching and diagnostics grid based on the `type` prop (`"service"` vs. `"application"`). The `handleServiceClick()` function on the page determines the card type by checking which array the name appears in. See `services/ingenium-api/lib/routes/services.ts` for the API implementation and `services/ingenium-dashboard/src/app/status/page.tsx` for the frontend split.

## Dashboard Pages

The Ingenium Dashboard (http://localhost:3000) provides 20 primary route-based pages plus the Settings overlay (21 user-facing views):

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
| Settings (overlay) | Full-screen settings overlay opened with `?settings=<tab>`; `/settings` is a redirect entrypoint |

Additional `page.tsx` entrypoints support `/settings` redirect, `/standalone` embedding, `/mail/[id]`, `/mail/oauth/callback`, and `/observations/[id]`. Together with the 20 primary routes, the App Router contains 25 page entrypoints. The dashboard talks to the API layer only — zero direct DB access.

### MCP Tool Count

The system exposes **245 catalog tools** across **28 categories**. Canonical catalog at `packages/ingenium-core/lib/tools/mcp-tool-catalog.ts`.

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
| Tasks | 24 | create, list, move, complete, next, update, delete, search, comment, activity, link, board_config_get, board_config_set, subtask_create, notifications, get, comments_list, comment_edit, comment_react, links_list, link_delete, tree, notification_read, bulk_update |
| Plans (Context) | 3 | save, search, list |
| Projects | 9 | list, init, delete, restore, list_archived, purge, set_global, rename, detail |
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

---

## API Configuration

The Express API uses `express.json({ limit: "2mb" })` for request body parsing. This allows large skill payloads (when uploading skills with file_tree data) without hitting the default 100KB limit. Other middleware includes helmet for security headers, CORS (configurable via `CORS_ORIGIN`), and optional bearer token auth.

## Dashboard Features

### OpenCode Web/CLI Embedded in Dashboard
The dashboard includes an embedded OpenCode experience at `/opencode` with a **Web/CLI dual-mode interface**. The conversational chat interface has been separated to its own page at `/chat`.

- **Web mode** — Embeds the OpenCode Web UI (`http://localhost:4098/`) in a full-viewport iframe. The session persists across tab navigation with a hidden iframe technique.
- **CLI mode** — Embeds a ttyd terminal (`http://localhost:4099/`) in a full-viewport iframe. The xterm.js terminal connects via `opencode attach http://localhost:4098 --dir /workspace`, sharing the same session state as the Web UI.
- **Mode switch** — A right-edge glass tab toggles between Web and CLI modes. Inactive iframes are hidden via `opacity`/`visibility`/`pointer-events` instead of `display:none` to prevent xterm dimension zeroing. Both iframes remain in the DOM at full viewport size once mounted.
- **Keyboard shortcut**: `Ctrl+Shift+\`` toggles modes from anywhere on the page.
- **Persistence**: The chosen mode is saved in `localStorage` and restored on page load.
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
All Markdown rendering across the dashboard uses a single `MarkdownDocument` component (`components/MarkdownDocument.tsx`). It wraps `marked` (with GFM) and `DOMPurify` for safety, with `prose dark:prose-invert` for typography. Shared consumers include `DocsEditor` (View/Split modes) and `MarkdownViewer` (Preview mode). The proposal comparison view intentionally bypasses Markdown rendering — both Current and Proposed panels show raw source text in matching `<pre>` blocks.

## Docker Deployment

The project ships as a single Docker container via `Dockerfile` (multi-stage build, root) and `docker-compose.yml` (single service):

```yaml
services:
  ingenium:
    build: .
    ports:
      - "4097:4097"   # API
      - "3000:3000"   # Dashboard
      - "127.0.0.1:4098:4098"   # opencode-web (binds 0.0.0.0 inside container via `--hostname 0.0.0.0`; Compose publishes to host loopback only)
      - "127.0.0.1:1455:4097"   # OAuth callback proxy (host loopback → API)
    volumes:
      - ingenium-data:/app/.ingenium
```

Inside the container, **supervisord** manages four processes:
1. **API** (Express on :4097) — `express.json({ limit: "2mb" })` for large skill/plugin uploads, all CRUD operations
2. **Dashboard** (Next.js on :3000) — 20 primary routes plus the Settings overlay
3. **opencode-web** (on :4098) — OpenCode web server (`--hostname 0.0.0.0` inside container; Compose publishes to host `127.0.0.1:4098` only)
4. **ttyd-opencode** (on :4099) — OpenCode CLI terminal via ttyd (`ttyd --port 4099 opencode attach http://localhost:4098 --dir /workspace`). Serves an xterm.js terminal that the dashboard `/opencode` page embeds as a second iframe. The `appuser` has passwordless sudo access for package installation inside the container.

Build-time UID matching ensures write access to workspace (`~/repos` → `/workspace`). Docker volumes `opencode-config` and `opencode-data` persist OpenCode configuration across container rebuilds.

> 🔴 **Docker git**: The Dockerfile installs the `git` package to support OpenCode repository creation inside the container. Without git, OpenCode fails to initialize new repos for code editing.

Start with:
```bash
docker compose up --build
```

### Port Mappings

| Host Port | Service | Description |
|-----------|---------|-------------|
| `3000` | Dashboard | Next.js frontend (http://localhost:3000) |
| `4097` | API | Express REST gateway (sole DB authority) |
| `127.0.0.1:4098` | opencode-web | OpenCode Web UI (host loopback only; container binds **0.0.0.0** via `--hostname 0.0.0.0`) |
| `127.0.0.1:4099` | ttyd-opencode | OpenCode CLI terminal via ttyd (host loopback only) |
| `127.0.0.1:1455` | OAuth callback proxy | Host `127.0.0.1:1455` → container `:4097` (API). OpenCode redirects OAuth provider callbacks here; the API validates state, consumes it (preventing replay), and either forwards to OpenCode's internal listener (auto mode) or completes the exchange (code mode). |

> Note: Dockerfile `EXPOSE` covers ports 3000, 4097, 4098, 4099, 1455.

### Volume Configurations

| Volume Name | Mount Path | Purpose |
|-------------|------------|---------|
| `ingenium-data` | `/app/.ingenium` | SQLite databases, learnings, tasks, projects, commands |
| `opencode-config` | `/home/appuser/.config` | OpenCode configuration (persists across rebuilds) |
| `opencode-data` | `/home/appuser/.local` | OpenCode user data, session state |

**Workspace bind-mount:** Your local `~/repos` is mounted at `/workspace` for file editing.
