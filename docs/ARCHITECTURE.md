> **Note:** This document is being reorganized. The canonical location will be `docs/concepts/ARCHITECTURE.md`. Please update your bookmarks.

# Architecture

## Project Identity Model

Ingenium uses a **two-project identity model** distinguishing between server/public and external sessions:

### Server/Public Project (`global-default`)
- **Project name**: `global-default` (with `is_global=1`)
- **Used by**: The container's own OpenCode session (opencode-webui), email service, and dashboard default
- **Global config location**: `/home/appuser/.config/opencode/opencode.jsonc` (set by the Docker entrypoint at `scripts/docker-entrypoint.sh`)
- **Plugin target**: Extension plugins inside the container use `INGENIUM_PROJECT=global-default` (set in `opencode.jsonc` at line 32 of the entrypoint)
- **Created automatically** by `scripts/docker-entrypoint.sh` during container startup via `POST /api/v1/projects`

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
- `ingenium-server` runs as an MCP stdio transport with **150 tools** across **23 categories**. It talks to the API over HTTP. Zero DB access.
- `ingenium-dashboard` is a Next.js 16 App Router frontend with **17 pages** (16 routes + Settings overlay). It talks to the API over HTTP.

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

25 skills live at `.opencode/skills/` and are synced via `/sync-skills`.

The MCP server provides tools for listing, loading, searching, creating, updating, deleting, enabling, disabling, and syncing skills. The `update-skill-index` workflow regenerates `SKILL-INDEX.md` from all skill files.

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

- **Phase 2 — LLM Skill Synthesis**: Groups 3+ related observations and sends them to the LLM with existing skills/traits as context. Creates/updates skills via `writeSkillToDisk()` with the `llm-synthesized` prefix. A backup provider provides fallback if the primary LLM fails.

- **Auto-Observer Plugin**: Thin trigger (~62 lines) that POSTs `/api/v1/extraction/run` on `session.idle`. The 15-minute scheduler covers extraction if the plugin fails to load.

See [docs/self-learning-pipeline.md](self-learning-pipeline.md) for full detail.

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
                                          │
                                   writes to DB (configs table)
                                          │
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
| API Server (scheduled) | Auto-triggers synthesis + skill sync every 15 minutes |

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
4. The Test Connection button tests both independently

## Dataset Reference

| Package | Description | DB Access |
|---------|-------------|-----------|
| `packages/ingenium-core/` | Shared library: SQLite WAL + FTS5, Zod schemas (DB access allowed) | Yes |
| `services/ingenium-api/` | Express REST API on :4097. Sole database authority. | Yes |
| `services/ingenium-server/` | MCP stdio server with 150 tools. Calls API via HTTP. Zero DB access. | No |
| `services/ingenium-dashboard/` | Next.js 16 App Router frontend with 17 pages (16 routes + Settings overlay). Calls API via HTTP. Zero DB access. | No |
| `packages/ingenium-email/` | Gmail REST API + SMTP email engine (fetch-based, nodemailer). DB Access: No. | No |

## Status Page Architecture

The `/status` page renders two distinct card types from separate data sources:

- **Service cards** — supervisord-managed processes (ingenium-api, ingenium-dashboard, opencode-web, ttyd-opencode). Data sourced from `GET /api/v1/services/:name` which proxies `supervisor.getProcessInfo` XML-RPC calls. Cards show PID, port, uptime, exit code, and process logs.
- **Application cards** — in-process scheduled tasks (synthesis-engine, email-client) running inside the `ingenium-api` Express process. Data sourced from `GET /api/v1/services/applications/:name` which queries `synthesis.getSynthesisStatus()` and `ingenium-email`'s `getEngineStatus()` directly. Cards show application-specific fields (interval, last run, pipeline stats, email account folders).

The detail overlay (`ServiceOverlay.tsx`) switches its data fetching and diagnostics grid based on the `type` prop (`"service"` vs. `"application"`). The `handleServiceClick()` function on the page determines the card type by checking which array the name appears in. See [`services/ingenium-api/lib/routes/services.ts`](./services/ingenium-api/lib/routes/services.ts) for the API implementation and [`services/ingenium-dashboard/src/app/status/page.tsx`](./services/ingenium-dashboard/src/app/status/page.tsx) for the frontend split.

## Dashboard Pages

The Ingenium Dashboard (http://localhost:3000) provides 16 route-based pages plus the Settings overlay (17 total):

| Page | Purpose |
|------|---------|
| `/` | Home — operational home dashboard with live metrics (learning stats, task counts, job counts, mail status) via `/api/v1/dashboard/summary` in a 2×2 card grid |
| `/opencode` | Embedded OpenCode web UI iframe |
| `/projects` | Project management (create, rename, archive, restore) |
| `/archive` | Archived projects with restore/purge |
| `/skills` | Skills grid with detail overlay, syntax highlighting |
| `/learnings` | Deprecated — redirects to `/observations` |
| `/tasks` | Kanban board (todo → in_progress → review → done) |
| `/plugins` | Plugin lifecycle (enable, disable, configure) |
| `/agents` | Agent profiles (model, mode, enable/disable) |
| `/mcp-servers` | MCP servers + Tool Manager (Servers/Tools tabs, per-tool enable/disable toggles) |
| `/jobs` | Job queue and background task monitoring — create/edit modal with 2-column responsive layout (metadata left, prompt_template right) and magic-wand button for AI job config generation from description |
| `/mail` | Mail (inbox, compose, reader, auto-responses) — email client interface |
| `/observations` | Self-learning observations with FTS5 search + type/status filters |
| `/personality` | Personality traits with confidence bars, enable/disable |
| `/pipeline` | Git-workflow-style timeline of pipeline events (3s poll, filters, +N collapse) |
| `/settings` | Settings + Synthesis LLM provider configuration |

> The dashboard talks to the API layer only — zero direct DB access.

### MCP Tool Count

The MCP server exposes **150 tools** across **23 categories**. Canonical catalog at `packages/ingenium-core/lib/tools/mcp-tool-catalog.ts`:

| Category | Count | Tools |
|----------|-------|-------|
| Settings | 3 | get, set, test_llm |
| Skills | 11 | list, load, search, create, update, delete, enable, disable, sync, consolidate, sync_all |
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

---

## API Configuration

The Express API uses `express.json({ limit: "2mb" })` for request body parsing. This allows large skill payloads (when uploading skills with file_tree data) without hitting the default 100KB limit. Other middleware includes helmet for security headers, CORS (configurable via `CORS_ORIGIN`), and optional bearer token auth.

## Dashboard Features

### OpenCode Web UI Embedded in Dashboard
The dashboard includes an embedded OpenCode service at `/opencode` with a **Web/CLI dual-mode toggle**:

- **Web mode** — Embeds the OpenCode Web UI (`http://localhost:4098/`) in a full-viewport iframe. The session persists across tab navigation with a hidden iframe technique.
- **CLI mode** — Embeds a ttyd terminal (`http://localhost:4099/`) in a full-viewport iframe. The xterm.js terminal connects via `opencode attach http://localhost:4098 --dir /workspace`, sharing the same session state as the Web UI.
- **Mode switch** — A right-edge glass tab (`OpenCodeSwitch` component) toggles between modes. The inactive iframe is hidden via `opacity`/`visibility`/`pointer-events` instead of `display:none` to prevent xterm dimension zeroing. Both iframes remain in the DOM at full viewport size once mounted.
- **Keyboard shortcut**: `Ctrl+Shift+\`` toggles between modes from anywhere on the page.
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

## Docker Deployment

The project ships as a single Docker container via `Dockerfile` (multi-stage build, root) and `docker-compose.yml` (single service):

```yaml
services:
  ingenium:
    build: .
    ports:
      - "4097:4097"   # API
      - "3000:3000"   # Dashboard
      - "127.0.0.1:4098:4098"   # opencode-web (binds 0.0.0.0 inside container, published to host loopback only)
    volumes:
      - ingenium-data:/app/.ingenium
```

Inside the container, **supervisord** manages four processes:
1. **API** (Express on :4097) — `express.json({ limit: "2mb" })` for large skill/plugin uploads, all CRUD operations
2. **Dashboard** (Next.js on :3000) — 17 route-based pages with highlight.js syntax highlighting in Preview/Source modes
3. **opencode-web** (on :4098) — OpenCode web server (binds 0.0.0.0 inside container, published to host loopback only)
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
| `127.0.0.1:4098` | opencode-web | OpenCode Web UI (host loopback only, published from `0.0.0.0` inside container) |
| `127.0.0.1:4099` | ttyd-opencode | OpenCode CLI terminal via ttyd (host loopback only) |

> Note: Dockerfile `EXPOSE` covers ports 3000, 4097, 4098, 4099.

### Volume Configurations

| Volume Name | Mount Path | Purpose |
|-------------|------------|---------|
| `ingenium-data` | `/app/.ingenium` | SQLite databases, learnings, tasks, projects, commands |
| `opencode-config` | `/home/appuser/.config` | OpenCode configuration (persists across rebuilds) |
| `opencode-data` | `/home/appuser/.local` | OpenCode user data, session state |

**Workspace bind-mount:** Your local `~/repos` is mounted at `/workspace` for file editing.
