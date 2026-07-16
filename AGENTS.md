# AGENTS.md — Ingenium MCP Server Agent Protocol

This is the **Agent Protocol** for the Ingenium MCP Server. Skills live at `.opencode/skills/<name>/` with a split-skill format (SKILL.md + metadata.json + references/).

> 🔴 **Security**: Never commit `THREAD_API_TOKEN` to source. Use `<YOUR_THREAD_API_TOKEN>` placeholder in `opencode.json`.

> 🔴 **Never state a fact without verifying against source files.** If you claim "X uses Y", you must have READ the file containing X. If you claim "Z imports W", you must have GREP'd for the import. If you cannot verify in one read or grep, say "I'm not sure — let me check" instead of guessing confidently. Confidently wrong claims waste implementation time.

> **Dashboard**: Skills, plugins, agents, projects, and commands can be managed through the Ingenium Dashboard at [http://localhost:3000](http://localhost:3000). Commands are captured in the DB layer (no dedicated dashboard page — use MCP tools directly).

---

## 🔴 MANDATORY — Load Skills Before Acting

**Before writing code, running a command, or responding to any request, you MUST load matching skills.** Skills contain 🔴 HARD RULEs that override everything else.

### Session Startup
1. **Match skills** — Check the catalog against the request and files you might edit
2. **Load matching skills** — Read `.opencode/skills/<name>/SKILL.md` for each match
3. **Note 🔴 HARD RULEs** — These take priority over everything else
4. **Run `/repo-context`** for project identity

### Pre-Flight Check

| You're about to... | Check this skill |
|-------------------|-----------------|
| Edit a source file | Framework skill (`nextjs`, `python`, `go`, `rust`, `typescript-standalone`) |
| Run a terminal command | `local-models` — **no `&`, no infinite-wait** |
| Create a new file/service | `project-structure` |
| Write/run tests | `useful-tests` |
| Edit Docker/K8s | `containers` / `kubernetes` |
| Edit shell scripts | `shell-scripts` — `set -euo pipefail` |

### 🔴 MANDATORY Skills (load before ANY action)

`configuring-opencode` `debugging-patterns` `development-conventions` `devops-conventions` `github-cli` `local-models` `mcp-tooling` `skill-maintenance`

> 💡 Skills are synced between the DB and `.opencode/skills/` via the `/sync-skills` command or scheduled sync.

### 🔴 MANDATORY — Self-Improvement

After ANY code change, you MUST run the applicable self-improvement commands:

| Command | Action |
|---------|--------|
| `/synthesize` | Triggers synthesis pipeline to process pending observations into traits + skills |
| `/sync-skills` | Bidirectional disk↔DB skill sync |
| `ingenium_observe` | Log observations about changes via MCP tool with observation_type, tags, and content |

These are not optional. Skip none of them.

> 🔴 **Observation is now automatic** via the server-side extraction engine (core `extraction.ts`), which reads OpenCode messages through the API and uses the synthesis LLM to extract durable user behavior rules. The client-side auto-observer plugin is now only a thin trigger (`POST /api/v1/extraction/run`). Manual `ingenium_observe` calls should only be used for exceptional cases. See the Extraction Engine section below.

---

## Repository Structure

**Monorepo with 6 packages:**

```
packages/
├── ingenium-core/        # Shared library: SQLite WAL + FTS5, Zod schemas (DB access allowed)
├── ingenium-email/       # IMAP/SMTP email client (imapflow, nodemailer, mailparser) + sync-engine.ts background mail sync with priority queue. OAuth2 for Gmail/Outlook. No DB access.
└── ingenium-extension/   # Client-side OpenCode package — MCP server, observer plugin, skill-sync plugin, auto-observer. Installable via `npx -y @ingenium/extension`.

services/
├── ingenium-api/         # Express REST API on :4097. Sole DB authority.
├── ingenium-server/      # MCP stdio server with 150 tools. Calls API via HTTP. Zero DB access. Tools are wrapped with `wrapHandler()` — if a tool is disabled for the project, it returns a `TOOL_DISABLED` error.
└── ingenium-dashboard/   # Next.js 16 App Router frontend (16 pages). Calls API via HTTP. Zero DB access.
```

**API-First Architecture:** Dashboard and server import ZERO core/server code. All data flows through the API layer. Commands are captured in the DB alongside skills, agents, and plugins.

### Dashboard Pages

The Ingenium Dashboard (http://localhost:3000) provides 17 pages (16 routes + 1 overlay):

| Page | Purpose |
|------|---------|
| `/` | Home — operational home dashboard with live metrics via `/api/v1/dashboard/summary` |
| `/opencode` | Embedded OpenCode with Web/CLI dual-mode (glass tab toggle, Ctrl+Shift+`) |
| `/projects` | Project management (create, rename, archive, restore) |
| `/skills` | Skills grid with detail overlay, syntax highlighting |
| `/jobs` | Job queue and background task monitoring |
| `/logs` | Structured logging and event viewer |
| `/mail` | 3-pane email client (FolderSidebar, EmailList, EmailReader), AccountSetup when no accounts configured |
| `/status` | Service status — real-time supervisord process states (running/starting/stopped), uptime, restart counts |
| `/tasks` | Kanban board (todo → in_progress → review → done) |
| `/plugins` | Plugin lifecycle (enable, disable, configure) |
| `/agents` | Agent profiles (model, mode, enable/disable) |
| `/mcp-servers` | MCP servers + Tool Manager (Servers/Tools tabs, 150 tools in 23 categories, per-tool enable/disable toggle, search, category filter) |
| `/config` | OpenCode config editor (Project/Global tabs, sync from disk, save) |
| `/observations` | Self-learning observations with FTS5 search + type/status filters |
| `/personality` | Personality traits with confidence bars, enable/disable |
| `/pipeline` | Git-workflow-style timeline of pipeline events (3s poll, filters, +N collapse) |
| Settings (overlay) | Full-screen overlay triggered by gear icon in top nav. 14 tabs (General + 13 endpoints), 4 with real settings (General, Mail, Pipeline, Config); others show clean placeholder states. Deep-link via `?settings=<tab>` query param. Auto-selects tab matching current page. The old `/settings` route now redirects to the overlay via `?settings=` — the overlay is the sole entry point for settings. |

> **Nav bar layout**: The settings gear icon is positioned far-right in the top bar. A **ProjectDropdown** (folder icon + chevron) sits to the right before the settings gear, enabling project switching from any page. It is disabled (`opacity-50 cursor-not-allowed`) on `/mail` and `/opencode` pages. Project switching: the `/projects` page shows an ACTIVE badge on the current project and a 'Set Active' button on others. The old ThemeToggle has been removed from the nav bar.
>
> The dashboard talks to the API layer only — zero direct DB access. Commands are managed via MCP tools without a dedicated page.

### Project Identity Model

Ingenium uses a **two-project identity model** distinguishing between server/public and external sessions:

- **Server/public project** (`global-default`, `is_global=1`) — The container's own OpenCode session. Its global config lives at `~/.config/opencode/opencode.jsonc` (set by the Docker entrypoint). This project is used by the container's opencode-web service, email service, and dashboard default. Created automatically by `scripts/docker-entrypoint.sh`.

- **External sessions** — Projects named after their repo worktree (e.g., `gh-llm-bootstrap`). These connect via the `@ingenium/extension` plugins. The `INGENIUM_PROJECT` environment variable controls which project the extension plugins write to. For external sessions, the project name derives from the worktree directory.

  The container entrypoint script sets `INGENIUM_PROJECT=global-default` in `opencode.jsonc`, ensuring container processes always target the server project.

The dashboard resolves the default project dynamically by fetching the `is_global=1` project from the API. Users switch projects via the `/projects` page — each project card shows an ACTIVE badge for the current project and a 'Set Active' button on others — or through MCP tools.

**Key rule**: When writing shared resources (skills, plugins, configs, settings) from within the container's OpenCode web UI or from dashboard operations, use the `global-default` project. When working from an external OpenCode session (like this repo's worktree-derived project), the `INGENIUM_PROJECT` env var in the MCP server config determines the target. See the `INGENIUM_PROJECT` entry in the Environment Variables table below.

---

## 🔴 MANDATORY — Database Isolation

**Only `packages/ingenium-core` and `services/ingenium-api` may import SQL libraries.** CI enforces this:

```bash
grep -r "better-sqlite3\|\.db\|sqlite" services/ingenium-server/  # must return empty
grep -r "better-sqlite3\|\.db\|sqlite" services/ingenium-dashboard/  # must return empty
```

Move any DB logic to the API layer immediately.

### Database Migrations

Migrations live at `packages/ingenium-core/data/migrations/` as numbered `.sql` files. They are applied conditionally by `runMigrations()` in `db.ts` — each checks for an existing table/column/signature before running.

**Critical migration sequence (015 → 017 → 019):**

| Migration | Purpose | Risk |
|-----------|---------|------|
| `015_auto_observer_source.sql` | Rebuilds `observations` table to add `'auto-observer'` to the source CHECK constraint. Uses RENAME → DROP FTS → RECREATE → RESTORE pattern. | Partially failing leaves `observations_old` with dangling FTS triggers, causing "FOREIGN KEY constraint failed" during synthesis |
| `017_fix_trait_fk.sql` | Rebuilds `personality_traits` to refresh the FK reference to the current `observations` table after 015's rename cycle. Comment marker `-- 017_rebuilt` in the CREATE TABLE prevents re-application. | Runs inside `PRAGMA foreign_keys = OFF/ON` to prevent cascading FTS trigger errors |
| `018_extraction_events.sql` | Adds `extraction_completed` and `extraction_failed` to the `pipeline_events` event_type CHECK constraint. | Minimal — just expands CHECK constraint |
| `019_trait_fk_set_null.sql` | Changes `personality_traits.exemplar_observation_id` FK to `ON DELETE SET NULL` so observation deletes never fail on FK constraints. | Runs inside `PRAGMA foreign_keys = OFF/ON`; safe |
| `024_skills_unique_per_project.sql` | Rebuilds `skills` table to change `UNIQUE(name)` → `UNIQUE(project_id, name)`. Uses same safe pattern as 015/017 (PRAGMA foreign_keys OFF/ON, rename→recreate→restore, FTS rebuild). Comment marker `-- 024_rebuilt`. | Medium — FTS trigger recreation must be verified; same corruption risk as 015/017 if interrupted |
| `025_email_string_ids.sql` | Rebuilds `email_cache` + `email_bodies` with `uid TEXT` (was INTEGER). Adds `labels_json` to email_cache, `history_id` + `provider` to email_sync_state. Same safe FK off/on rename→recreate pattern. | Medium — FK recreation must be verified; all cached emails keyed by string ID from Gmail API |
| `026_email_suggestions.sql` | Creates `email_suggestions` table for LLM-generated email reply suggestions, cached per `(account_id, folder, uid)` with FK to `email_cache ON DELETE CASCADE`. Uses same defensive parent-existence check pattern as `email_bodies`. | Low — defensive pattern prevents FK failures during concurrent account deletion |
| `027_email_summaries.sql` | Creates `email_summaries` table for cached AI-generated email summaries. Same PK shape `(account_id, folder, uid)` and FK cascade as `email_suggestions`. Mirrors the defensive parent-existence check pattern. Used by `GET /emails/summarize/:uid`. | Low — same defensive pattern as 026 |

> 🔴 **Dockerfile note**: The Dockerfile runtime stage does not copy `data/migrations/`. New migration `.sql` files must be manually placed (bind-mounted or copied) into the container for incremental DBs.

**Anti-corruption guard (db.ts lines 183–213):**
1. After migration 015 runs, `observationsCreateSql` is **re-read** so migration 017's condition (`observationsCreateSql.sql.includes("auto-observer")`) triggers correctly
2. Migration 017 is wrapped in `PRAGMA foreign_keys = OFF/ON` to prevent cascading FTS errors
3. Manual DB repair: drop `observations_old`, recreate `observations_fts` + triggers, rebuild `personality_traits` FK

### 🔴 WAL Safety — checkpointAfterWrite Outside Transaction

`checkpointAfterWrite()` (triggers a passive WAL checkpoint every 50 writes) must never be called **inside** `execTransaction()`. Calling checkpoint inside a transaction causes `SQLITE_LOCKED` because WAL checkpoint acquires a read lock on all pages while the transaction holds a write lock.

**Pattern** (used in `personality.ts`, `observations.ts`, and all tool modules):

```typescript
const result = execTransaction(() => {
  // All DB writes inside the transaction
  db.prepare("UPDATE ...").run(...);
  return value;
});
checkpointAfterWrite();  // ← ALWAYS outside, after the transaction commits
return result;
```

> 🔴 **Violation detection**: If you see `SQLITE_LOCKED` errors, the first thing to check is whether `checkpointAfterWrite()` is being called inside an `execTransaction()` callback. It must always follow the transaction, never be inside it.

### 🔴 Email FK Defensive Pattern — Parent-Existence Check

Any upsert function that writes to a FK-constrained child table must check for the parent row **before** inserting. This avoids `FOREIGN KEY constraint failed` errors when the parent is deleted concurrently (e.g., account removal mid-backfill).

**Pattern** (from `email-cache.ts`):

```typescript
// Defensive: check parent row exists before inserting into FK-constrained child table.
const parent = db.prepare(
  "SELECT 1 FROM email_cache WHERE account_id = ? AND folder = ? AND uid = ?",
).get(accountId, folder, uid);
if (!parent) {
  return; // parent removed — skip silently
}
// Safe to upsert into FK-constrained child table
```

This pattern is used in `upsertEmailBody()` and the email suggestions cache. It must be followed for any new FK-constrained child table writes to prevent silent DB corruption from concurrent deletions.

> 🔴 **`folder` value must be threaded through unchanged from `email.folder`.** The `getCachedSuggestions()` and `upsertEmailSuggestions()` functions (defined in `packages/ingenium-core/lib/tools/email-cache.ts` lines 249–284) use the exact `folder` string in the `WHERE` clause of the `email_suggestions` lookup. Defaulting the folder anywhere in the call chain (e.g., `?? "INBOX"`) causes a 100% cache miss because the stored value uses the IMAP-provided folder name, not the defaulted one. Always pass through the `folder` value received from `email.folder` without defaulting or transforming it.

> 🔴 **Noreply-sender gate — smart replies are never cached for automated senders.** Before any cache lookup or generation, the `/api/v1/emails/:id/suggest` route (at `services/ingenium-api/lib/routes/emails.ts` lines 482–490) checks both `from_addr` and `from_name` against the regex `/no[-_.]?reply|do[-_.]?not[-_.]?reply/i`. If either matches, the route returns `{ suggestions: [], source: "noreply", configured: true }` immediately — no cache read, no LLM invocation. This gate runs BEFORE the cache check so that stale suggestions from before a sender was classified as noreply are never returned. Any code path that generates suggestions must implement this gate.

> 🔴 **Reasoning model compatibility — never fall back to `reasoning_content`.** The `content || reasoning_content` fallback pattern surfaces the model's internal scratchpad to end users and has been REMOVED from all suggest-llm.ts functions. The correct fix: set `max_tokens` high enough (8192) for the model to complete its thinking and output clean `content`; if `content` is still empty, return `[]` or `""` (empty/error) — never expose the thinking trace. See `packages/ingenium-email/lib/suggest-llm.ts` lines 103, 225, 288 and `packages/ingenium-core/lib/tools/extraction.ts` for the correct pattern (`max_tokens: 8192`, no `reasoning_content` fallback).

> 🔴 **Smart-reply cache persistence — use `ON CONFLICT DO UPDATE`, not `INSERT OR REPLACE`.** When upserting into `email_cache`, `INSERT OR REPLACE` deletes the old row before inserting, which cascades to delete child rows in FK-constrained tables (`email_bodies`, `email_suggestions`, `email_summaries`). Always use `ON CONFLICT(account_id, folder, uid) DO UPDATE SET ...` to preserve child data. This pattern is used in the email cache layer to prevent cascade deletion of cached suggestions, bodies, and summaries.

> 🔴 **Never hand-write RFC 2822 address-parsing regexes — always use a tested library (`mailparser`, `addressparser`, `simpleParser`).** The Gmail provider previously had a hand-rolled regex `^(?:"?([^"]*)"?\s*)?<?([^>]+)>?$` that appeared to work for quoted display names but catastrophically backtracked for unquoted names, corrupting `from_addr` in the cache to a single character ('m') for most emails.

> 🔴 **Zod schemas are NOT runtime enforcement gates.** The Zod schemas in `packages/ingenium-core/lib/schema.ts` are used for validation at API boundaries, but SQL CHECK constraints are the actual gate for fields like `tasks.issue_type`. Any UI or API path accepting input for a CHECK-constrained column must either validate client-side against the same allowed values or wrap the write in a `try/catch` that translates constraint violations into clean error messages. Do NOT rely on the Zod schema alone — if the schema allows a value that the CHECK constraint rejects, the DB will throw `SQLITE_CONSTRAINT_CHECK` and the user will see a raw error. Example: if `tasks.issue_type` has a CHECK constraint `IN ('bug', 'feature', 'improvement')`, the client-side form or API route must enforce the same list, or handle `SQLITE_CONSTRAINT` gracefully.

---

## Docker Deployment

**Single-container deployment via `docker compose up --build`**. The container runs **supervisord** managing four processes:

1. **API** (Express on :4097) — `express.json({ limit: "2mb" })` for large skill/plugin uploads, all CRUD operations
2. **Dashboard** (Next.js on :3000) — 16 route-based pages with highlight.js syntax highlighting in Preview/Source modes
3. **opencode-web** (on :4098) — OpenCode web server (binds `0.0.0.0` inside container, published to host loopback only)
4. **ttyd-opencode** (on :4099) — OpenCode CLI terminal via ttyd (`ttyd --port 4099 opencode attach http://localhost:4098 --dir /workspace`). Provides the xterm.js terminal for the dashboard's CLI mode. appuser has passwordless sudo.

> The API layer is the sole authority for all 5 `.opencode/` resources: skills, agents, plugins, commands, and configs.

### Start/Stop Commands

```bash
# Start all services (with build)
docker compose up --build

# Start without rebuild
docker compose up

# Stop all services
docker compose down

# View logs
docker compose logs -f

# Execute commands inside container
docker compose exec ingenium npm run test
docker compose exec ingenium npm run check
```

### Port Mappings

| Host Port | Service | Description |
|-----------|---------|-------------|
| `3000` | Dashboard | Next.js frontend (http://localhost:3000) |
| `4097` | API | Express REST gateway (sole DB authority) |
| `127.0.0.1:4098` | OpenCode Web | OpenCode web server — container binds `0.0.0.0`, published to `127.0.0.1:4098:4098` (host loopback only) |
| `127.0.0.1:4099` | ttyd-opencode | OpenCode CLI terminal via ttyd (host loopback only) |

> 🔴 **Note**: Dockerfile `EXPOSE` covers ports 3000, 4097, 4098, 4099.

### OpenCode Web/CLI Mode Switch

The dashboard `/opencode` page features a **dual-mode** interface with a Web/CLI toggle:

- **Web mode** — Embeds `http://localhost:4098/` in a full-viewport iframe (OpenCode Web UI)
- **CLI mode** — Embeds `http://localhost:4099/` in a full-viewport iframe (ttyd terminal running `opencode attach http://localhost:4098 --dir /workspace`)
- **Glass tab**: A right-edge `OpenCodeSwitch` component (`bg-[var(--color-surface)]/35 backdrop-blur-sm`, `fixed right-0 top-1/2`) toggles between modes. On hover it expands leftward. Keyboard shortcut `Ctrl+Shift+\`` toggles from anywhere on the page.
- **Dual-iframe architecture**: Both iframes remain in the DOM at full viewport size once mounted. The inactive iframe is hidden via `opacity: 0` / `visibility: hidden` / `pointer-events: none` instead of `display:none` to prevent xterm dimension zeroing.
- **Mode persistence** saved in `localStorage` under `opencode-mode`.
- The CLI (ttyd) process is managed by supervisord as `[program:ttyd-opencode]`.

### Terminal Attachment (Direct)

You can also attach a terminal session directly to the opencode-web process (without the dashboard iframe):

```bash
# Attach a terminal session to the running opencode-web process
opencode attach http://localhost:4098 --dir /workspace
```

All sessions, tool providers, and MCP connections share the same process state — the dashboard embedded iframe, CLI ttyd iframe, and direct terminal attachments all use the same backend. No separate instance needed.

> 🔴 **Docker sudo**: The Dockerfile installs `sudo` and grants `appuser` passwordless sudo access via `/etc/sudoers.d/appuser`. This enables package installation from within OpenCode CLI sessions (e.g., `sudo apt-get install <pkg>`).

> 🔴 **Docker git**: The Dockerfile now installs the `git` package to support OpenCode repository creation inside the container. Without git, OpenCode fails to initialize new repos for code editing.

### Volume Configurations

| Volume Name | Mount Path | Purpose |
|-------------|------------|---------|
| `ingenium-data` | `/app/.ingenium` | SQLite databases, learnings, tasks, projects, commands |
| `opencode-config` | `/home/appuser/.config` | OpenCode configuration (persists across rebuilds) |
| `opencode-data` | `/home/appuser/.local` | OpenCode user data, session state |

**Workspace bind-mount:** Your local `~/repos` is mounted at `/workspace` for file editing.

### Health Check

API health check ensures services are ready:
```yaml
healthcheck:
  test: ["CMD", "wget", "-qO-", "http://localhost:4097/api/v1/health"]
  interval: 30s
  timeout: 5s
  retries: 3
  start_period: 15s
```

> 🔴 **`synthesis-engine` and `email-client` are NOT supervisord processes.** They are in-process scheduled tasks running inside the `ingenium-api` Express process. The Status page reports them via `GET /api/v1/services/applications/:name` (not `/services/:name`), which queries `synthesis.getSynthesisStatus()` and `ingenium-email`'s `getEngineStatus()` directly. Do NOT add supervisord `[program:synthesis-engine]` or `[program:email-client]` blocks — they would create duplicate, conflicting processes. The four real supervisord programs are listed above (API, Dashboard, opencode-web, ttyd-opencode). See [`services/ingenium-api/lib/routes/services.ts`](./services/ingenium-api/lib/routes/services.ts) lines 216–289 for the application health-check implementations.

---

## Testing

```bash
bash tests/test-self-improving.sh        # All 4 detection pipeline tests
bash tests/test-self-improving.sh -v     # Verbose output
bash tests/enforce-no-db-leaks.sh        # CI gate: verify no DB access leaks
bash tests/test-agent-validation.sh      # Agent validation checks (10 agents)
bash tests/test-append-only-files.sh     # Verify append-only file constraints

# Run unit tests
npm run test --workspace=packages/ingenium-core

# Run E2E dashboard tests
npx playwright test --config=tests/playwright.config.ts tests/ingenium-dashboard/

# Run all tests
npm test
```

---

## Conventions

### Self-Learning Pipeline — Observations (Preferred)

The self-learning pipeline uses **observations** instead of the deprecated `ingenium_learning_log` tool. Every change that modifies skills, agents, hooks, plugins, config, or architecture should be logged via `ingenium_observe`.

## 🔴 HARD RULE — Observe user behavior, NOT implementation

Never log implementation notes as observations. Observations track the USER's behavior, preferences, and feedback — not what code was written or what features were implemented. Implementation activity belongs in pipeline events and git commits. **The Auto-Observer plugin handles this automatically** by scanning OpenCode message history — no manual `ingenium_observe` calls needed in agent code.

✅ LOG THESE (user behavior):
- "User prefers 2-space indentation over 4-space"
- "User corrected the agent's error handling approach"
- "User always runs lint before committing"
- "User asks for alternatives before accepting suggestions"

❌ DO NOT LOG THESE (implementation):
- "Added sort filters to the dashboard"
- "Implemented global config path resolution"
- "Fixed plugins table UNIQUE constraint"
- Any description of code changes or architecture decisions

> 🔴 **Agent files updated**: All 10 agent `.md` files had their "🔴 Observation — Log User Interactions" sections removed. Observation is now automatic via the server-side extraction engine reading OpenCode message history. Do not re-add manual observation sections to agent files.

**Observation types:**
- `correction` — User corrects agent behavior
- `preference` — User preference or configuration choice (most common for logging)
- `pattern` — Repeated convention or workflow
- `insight` — Novel discovery
- `feedback` — Implicit accept/reject
- `behavior` — User behavior signal
- `terminology` — Preferred language
- `workflow` — Workflow sequence
- `error` — User encountered error
- `goal` — Stated or implied goal

**How it works:**
1. Call `ingenium_observe(observation_type="preference", content="...", importance=7)` during your workflow
2. Observations are stored in the DB with status "pending"
3. The synthesis pipeline (triggered by `/synthesize` or auto on session events) processes them
4. Personality traits are created from observations
5. Skills are updated automatically

**File fallback:** If the API is down, observations are saved to `.opencode/skills/observations.md`. On next session start, the Observer Plugin's `importObservationsFromFile()` syncs file entries into the DB and marks them `[IMPORTED]`.

> 🔴 **Note:** The old `ingenium_learning_log` tool is deprecated but still functional for backward compatibility. New code should use `ingenium_observe`.

### Observer Plugin

The **Observer Plugin** (`packages/ingenium-extension/observer.ts` + `observer-core.ts`) is the bridge between OpenCode sessions and the self-learning pipeline:

- **`session.created`** — On session start, imports file-fallback observations from `observations.md`, triggers initial synthesis
- **`session.idle`** — On idle events, optionally triggers synthesis at a configurable interval (`OBSERVER_CHECK_INTERVAL`)
- **Pipeline events** — Logs events to the `/pipeline` dashboard timeline (`session_created`, `observation_imported`, `synthesis_triggered`)
- **MCP tool** — Registers `synthesize_observations` tool for manual pipeline triggers

### @ingenium/extension Package

The `@ingenium/extension` package (`packages/ingenium-extension/`) is a client-side npm package that bundles everything needed to connect OpenCode to an Ingenium API:

- **Install**: `npx -y @ingenium/extension`
- **Package name**: `@ingenium/extension`
- **`bin` field**: `dist/scripts/mcp-server.js` — the MCP stdio server
- **Plugins shipped**:
  - `observer.ts` — session event handling, observation import, synthesis trigger
  - `skill-sync.ts` — bidirectional skill sync from API to local `.opencode/skills/`
  - `auto-observer.ts` — automatic behavior pattern detection from OpenCode DB

**MCP client config** (in `opencode.json`):
```jsonc
{
  "mcp": {
    "servers": {
      "ingenium": {
        "type": "local",
        "command": ["npx", "-y", "@ingenium/extension"],
        "disabled": false,
        "env": {
          "INGENIUM_API_URL": "http://localhost:4097/api/v1",
          "INGENIUM_API_TIMEOUT": "10000",
          "LOG_LEVEL": "info"
        }
      }
    }
  }
}
```

**Plugin references** (in `opencode.json`):
```jsonc
"plugin": [
  "packages/ingenium-extension/observer.ts",
  "packages/ingenium-extension/auto-observer.ts",
  "packages/ingenium-extension/skill-sync.ts"
]
```

> 🔴 **Auto-observer auto-registration**: The auto-observer plugin must be registered in both the DB plugins table and both opencode configs (project `opencode.json` + global `opencode.jsonc`). When adding it to one, always sync to all three to prevent "disconnected config" bugs.

> 📖 **Architecture reference**: See [`packages/ingenium-extension/ARCHITECTURE.md`](./packages/ingenium-extension/ARCHITECTURE.md) for the definitive client/server split, data flow, and process ownership.

### Extraction Engine (Server-Side)

Observation detection runs **server-side in the API** — the client-side auto-observer plugin is now only a thin trigger. The extraction engine (`packages/ingenium-core/lib/tools/extraction.ts`, `runExtraction(projectId, projectName)`) reads OpenCode messages via the existing `GET /api/v1/opencode/messages` endpoint (OpenCode DB mounted in Docker at `/var/opencode/opencode.db`).

**How it works:**
1. **Watermark + dedup** — Per-project watermark (`extraction_watermark` setting) and content-hash dedup (`extraction_seen_hashes` setting) prevent re-processing the same messages.
2. **Regex pre-filter** — Cheap regex candidate selection identifies messages that MAY contain user behavior (NOT final extraction).
3. **LLM batch extraction** — Candidate messages are batched (up to 15 per batch) and sent to the synthesis LLM, which extracts **durable user behavior rules** as JSON. Only LLM output becomes observations — raw message snippets NEVER enter the DB.
4. **No-LLM = no observations** — If no synthesis LLM is configured, extraction creates 0 observations (no regex fallback to garbage).

**API route**: `POST /api/v1/extraction/run` — triggers extraction for the current project.
**MCP tool**: `ingenium_extraction_run` — manual trigger from OpenCode.
**Scheduler**: The 15-minute scheduler runs extraction BEFORE synthesis, so fresh observations are processed in the same cycle.

### Auto-Observer Plugin (Thin Trigger)

The **Auto-Observer** (`packages/ingenium-extension/auto-observer.ts`) is now a ~62-line thin trigger. On `session.idle`, it POSTs to `POST /api/v1/extraction/run`. The plugin carries zero detection logic — all extraction runs server-side. If the plugin fails to load in OpenCode, the scheduler covers extraction anyway (plugin loading is no longer a dependency).

**MCP tool**: Registers `auto_observe_now` — manually triggers server-side extraction and returns detected + created counts.

**Configuration**: Uses `INGENIUM_API_URL` env var (default: `http://localhost:4097/api/v1`).

> 🔴 **Note**: The Auto-Observer replaces manual `ingenium_observe` calls in agent code. All 10 agent files had their "🔴 Observation — Log User Interactions" sections removed since observation is now automatic.

### Observation → Trait → Skill Flow

The complete flow from raw messages to skills:

1. **Extraction** — Server-side extraction engine reads OpenCode messages, pre-filters with regex, and sends candidate batches to the synthesis LLM. The LLM extracts durable user behavior rules as JSON. Only LLM output creates observations — raw snippets never enter the DB. Pipeline event: `extraction_completed`.
2. **Consolidation (Phase 1)** — Synthesis pipeline calls `consolidateTraits()` which sends each observation to the LLM. For each observation, the LLM decides: **CONFIRM** (link to an existing trait), **CREATE** (generate a new normalized trait statement, e.g. "User prefers to rebuild and test after every change."), or **IGNORE** (noise). Semantic merge prevents near-duplicate traits. If the LLM is unavailable, observations stay PENDING — no garbage heuristic fallback.
3. **Skill Synthesis (Phase 2)** — If LLM configured, groups 3+ related observations and sends them with existing skills + traits as context. The LLM returns skills to create/update. Created skills are written to disk via `writeSkillToDisk()` in split-skill format with the `llm-synthesized` prefix. LLM-suggested personality traits are now actually created (previously dropped). Pipeline events: `skill_created`, `skill_updated`.
4. **Confidence model** — Traits start at 0.10–0.15, gain +0.15 per confirmation, cap at **0.95**. Display threshold is **≥0.30** in `getProfile()` — freshly-extracted traits are hidden until confirmed via 2+ observations. Dashboard provides an "N hidden" toggle for below-threshold traits. 7-day inactivity decay (-0.05) unchanged.

### LLM Skill Synthesis (Phase 2)

When configured in **Settings → Synthesis LLM**, the pipeline runs a second phase after LLM trait consolidation:

1. Groups 3+ related observations from the current batch (minimum bar — prevents skills from isolated single observations)
2. Sends them to the configured LLM along with existing skills + traits as context
3. LLM returns structured JSON with skills to create/update and new personality traits
4. Pipeline executes create/update operations, writes skills to disk via `writeSkillToDisk()`, and logs results to `/pipeline` timeline
5. LLM-suggested personality traits are now actually created (previously dropped before)
6. Non-fatal: Phase 1 trait results are saved even if Phase 2 fails

**Split-skill output:** Skills created by the LLM use the standard split-skill format:
- `SKILL.md` — main content with YAML frontmatter
- `metadata.json` — tags, alwaysApply, description
- `references/` — auxiliary reference files for related concepts grouped into a single skill

**Naming convention:** All LLM-synthesized skill names must include the `llm-synthesized` prefix (e.g., `llm-synthesized-email-workflows`). The LLM groups related concepts discovered across observations into one skill with multiple reference files rather than creating many small single-concept skills.

**Configuration:** Set `synthesis_model`, `synthesis_api_key`, and `synthesis_endpoint` via the dashboard Settings page or directly in the DB.

### Pipeline Observability

Every pipeline event is logged to the `pipeline_events` table and displayed at **`/pipeline`** in the dashboard:

| Event | Source | Meaning |
|-------|--------|---------|
| `session_created` | plugin | OpenCode session started; includes `Scheduled` label for timer triggers or session ID for manual triggers |
| `synthesis_triggered` | plugin | Observer triggered synthesis |
| `synthesis_started` | synthesis | Pipeline began processing; includes batch size, observation IDs, model info |
| `synthesis_completed` | synthesis | Pipeline finished successfully; enriched with `model`, `endpoint`, `provider`, `insights`, observation counts, and trait statistics |
| `synthesis_failed` | synthesis | Pipeline errored out |
| `extraction_completed` | synthesis | Extraction engine finished scanning OpenCode messages; includes candidate count, observation count, model info |
| `extraction_failed` | synthesis | Extraction engine errored out |
| `trait_created` | synthesis | New personality trait generated; includes `trait_type`, `trait_value`, `confidence`, `observation_ids`, `skill_links`, and `model` info |
| `trait_updated` | synthesis | Existing trait confidence adjusted |
| `skill_created` | synthesis | New skill synthesized by LLM Phase 2 |
| `skill_updated` | synthesis | Existing skill updated by LLM Phase 2 |
| `observation_created` | agent | Agent called `ingenium_observe` |
| `observation_imported` | plugin | File fallback imported into DB |
| `plugin_initialized` | plugin | Observer/skill-sync/auto-observer plugin loaded |
| `plugin_error` | plugin | Plugin encountered an error |

**Enriched event data**: `synthesis_completed` events carry full pipeline metadata (model name, endpoint URL, provider ID, LLM-generated insights). `trait_created` events link back to parent observations (`observation_ids`) and include model attribution and skill references. The `session_created` event shows "Scheduled" when triggered by the timer-based scheduler versus the session ID for manual triggers.

The timeline auto-polls every 3 seconds, supports filter pills (All/Agent/Plugin/Synthesis/Trait), collapses rapid events into +N groups, and shows detail overlays on click. Pipeline stats now include a skills count alongside observation and trait counts.

### Personality Trait Confidence Model

Traits start at low confidence (0.05–0.15) and require 2+ confirming observations to reach display threshold (0.30). Confidence is capped at 0.95. Traits unused for 7+ days lose 0.05 confidence (decay). Traits can be dismissed from the dashboard via the × button.

Only display-worthy traits (confidence ≥ 0.30) appear on the personality profile page by default. Hidden traits can be toggled via the "N hidden" link.

> **Note**: The display gate (≥0.30) means freshly-extracted traits from the extraction engine are hidden until confirmed via 2+ observations. Raw extraction yields traits at 0.10–0.15 confidence, which stay below the dashboard threshold until LLM consolidation confirms them against existing patterns.

### Related Self-Learning Skill

See `.opencode/skills/self-learning/SKILL.md` for complete documentation of the self-learning pipeline, including:
- Observation types and when to use them
- Personality trait generation rules
- Synthesis pipeline architecture
- MCP tools reference

> 📖 **Full reference**: See [`self-learning-pipeline.md`](./docs/self-learning-pipeline.md) for complete documentation of the 10 observation types, 10 personality trait types, MCP tools, API endpoints, synthesis pipeline (Phase 1 + Phase 2), pipeline observability timeline, bidirectional skill sync, and deprecation notes.

### Commands

Commands are captured in the DB alongside skills, agents, and plugins. The following MCP tools manage commands:

| Command | File | Purpose |
|---------|------|---------|
| `/synthesize` | `.opencode/commands/synthesize.md` | Trigger synthesis pipeline to process pending observations |
| `/sync-skills` | `.opencode/commands/sync-skills.md` | Bidirectional disk↔DB skill sync |
| `/init-project` | `.opencode/commands/init-project.md` | Initialize a new project with skills, agents, plugins |

**Commands MCP Tools:** `ingenium_command_list`, `ingenium_command_get`, `ingenium_command_create`, `ingenium_command_update`, `ingenium_command_delete`

### Scheduled Maintenance

The API server (`services/ingenium-api/lib/scheduler.ts`) automatically runs maintenance tasks every **15 minutes** for ALL active projects:

1. **Extraction**: Runs server-side extraction on OpenCode messages — pre-filters with regex, batches to LLM, creates observations for durable user behavior rules
2. **Synthesis**: Processes pending observations via LLM consolidation (CONFIRM/CREATE/IGNORE) into personality traits (Phase 1), then optionally runs LLM skill synthesis (Phase 2) if configured
3. **Skill sync**: Triggers `/api/v1/skills/sync-all` — bidirectional disk↔DB sync (imports new skills from disk, writes DB skills to disk)

Extraction runs BEFORE synthesis so freshly extracted observations are consolidated in the same cycle. Each step awaits the previous one in sequence.

Configure via `SYNTHESIS_INTERVAL_MS` env var (default: 900000ms). Set to `0` to disable.

### Cross-Project Synthesis

The synthesis pipeline can evaluate observations and skills across multiple projects to create global skills available to all projects:

1. **`ingenium_synthesis_cross_project`** — MCP tool that triggers cross-project synthesis across all active projects. Patterns discovered in one project can benefit all others.
2. **Global skills** — Skills synthesized from cross-project patterns are created in the `global-default` project and made available to every project via shared skill resolution.
3. **`ingenium_project_set_global`** — MCP tool that marks/unmarks a project as the global-default (`isGlobal: boolean`), enabling shared skill resolution and cross-project observation evaluation.

Cross-project synthesis runs as part of the scheduled maintenance cycle (every 15 minutes) or can be triggered manually via the `ingenium_synthesis_cross_project` tool.

### MCP Page — `source` Column

The MCP dashboard page (`/mcp-servers`) has two tabs — **Servers** and **Tools**. The Servers tab displays a `source` badge for each server with three states:
- **External** (blue badge) — Standard user-added server
- **Enabled** (green badge) — Server on a global project, inherited across all projects
- **Running** (green badge) — Server sourced from `ingenium` (proxied via the MCP proxy engine)
- **Stopped/Disabled** (gray badge) — Inactive server

The `source` column (stored in the `servers` table) tracks where each server definition originates: `"ingenium"` for built-in proxy servers, or user-defined for external servers. The `is_global` project flag determines whether a server is shared project-wide.

### Backup Synthesis LLM Provider

The synthesis pipeline supports a **backup LLM provider** for fault tolerance. Configured via the Settings page:

| Setting Key | Description |
|------------|-------------|
| `synthesis_backup_provider` | Backup provider ID (e.g., `deepseek`, or `__custom__`) |
| `synthesis_backup_model` | Backup model ID |
| `synthesis_backup_endpoint` | Backup OpenAI-compatible API URL |
| `synthesis_backup_api_key` | Backup API key |

If the primary LLM fails during Phase 2 skill synthesis, the pipeline automatically falls back to the backup provider. Both primary and backup can be tested independently via the **Test Connection** button in Settings.

### Synthesis Interval Configuration

The synthesis interval can be configured via the Settings page or directly via MCP tools:

```typescript
// Set synthesis interval to 30 minutes
await ingenium_setting_set({
  project: "global-default",
  key: "synthesis_interval_ms",
  value: "1800000"
});
```

Options: 5 min, 15 min (default), 30 min, 1 hour, 4 hours, or Disabled (0). The setting is stored globally and affects all projects.

### Config Management

The `configs` table stores `opencode.json` (project-level) and `opencode.jsonc` (global) content in the DB, enabling round-trip editing through the dashboard and MCP tools.

#### Global Config Path Resolution

Global projects write skills, plugins, and commands to `/home/appuser/.config/opencode/` instead of the project root. This ensures global resources are shared across all projects at a well-known OS-level path.

- **Default path**: `/home/appuser/.config/opencode/`
- **Override**: Set `INGENIUM_GLOBAL_CONFIG_PATH` env var to a custom directory
- **Shared module**: `packages/ingenium-core/lib/tools/paths.ts` centralizes all path resolution for disk operations

#### Config MCP Tools

| Tool | Purpose |
|------|---------|
| `ingenium_config_get` | Retrieve opencode config (project or global) |
| `ingenium_config_set` | Update opencode config content |
| `ingenium_config_sync` | Sync config between disk and DB (bidirectional) |

#### Dashboard — `/config` Page

The `/config` page provides a tabbed editor:
- **Project tab** — Edit `opencode.json` for the active project
- **Global tab** — Edit `opencode.jsonc` for global configuration
- **Sync from disk** — Reload config from the filesystem into the editor
- **Save** — Persist editor content to the DB and write to disk

#### API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/config` | Get project config |
| GET | `/api/v1/config/global` | Get global config |
| PUT | `/api/v1/config` | Update project config |
| PUT | `/api/v1/config/global` | Update global config |
| POST | `/api/v1/config/sync` | Sync project config from disk to DB |
| POST | `/api/v1/config/global/sync` | Sync global config from disk to DB |
| GET | `/api/v1/dashboard/summary` | Aggregated home dashboard endpoint — returns learning stats, task counts, job counts, and mail status. Each module resolved independently; failed modules listed in `unavailable[]`. Returns 200 with partial data unless ALL modules fail (500). |
| POST | `/api/v1/extraction/run` | Trigger server-side extraction of observations from OpenCode messages |
| DELETE | `/api/v1/observations/:id` | Delete a single observation by ID |
| DELETE | `/api/v1/observations?source=X` | Delete all observations from a source (source param required) |
| DELETE | `/api/v1/personality/:id` | Delete a single trait by ID |
| DELETE | `/api/v1/personality` | Delete all traits for the project |
| GET | `/api/v1/emails/summarize/:uid` | Cache-first LLM-generated email summary (`packages/ingenium-core/lib/tools/email-cache.ts` lines 297–332). Checks cached summary in `email_summaries` table first; if miss + body cached + LLM configured, generates via LLM, persists to cache, and returns. No noreply gate — works for ALL emails. Returns 202 with `pending: true` if body not yet cached. |
| POST | `/api/v1/emails/review-draft` | Uncached LLM-powered draft review (`services/ingenium-api/lib/routes/emails.ts` lines 678–712). Accepts `{text, subject?}`, returns improved text. Every call is a fresh LLM invocation — no caching. |

### Plugin Auto-Config Sync

Every plugin lifecycle operation (create, enable, disable, delete, update) MUST also sync:
1. `.opencode/plugins/<file>.ts` on disk
2. `opencode.json`'s `plugin` array

This prevents "disconnected config" bugs where the DB shows a plugin as enabled but OpenCode can't load it.

### Plugin Source Auto-Populate

When creating a plugin via `ingenium_plugin_create`, if `sourceContent` is empty the API auto-populates the source by reading the file at the given `filePath` from disk. This allows plugins to be created by path reference alone:

- **MCP tool:** `ingenium_plugin_create(project, name, filePath)` — omit `sourceContent` to trigger auto-read
- **API endpoint:** `GET /api/v1/plugins/:name/source` — returns the raw source content from disk for a given plugin
- **Dashboard:** The Plugins page Edit button fetches source from the `GET /plugins/:name/source` endpoint when the DB content is empty, enabling inline editing of file-backed plugins

### Skill file_tree Format

Every skill in the DB has a `file_tree` column (JSON map of relative paths → content) for complete data round-trips:

- **Writing to disk:** `writeSkillToDisk()` writes SKILL.md + metadata.json, then every file in `file_tree`
- **Reading from disk:** `syncSkillFromDisk()` reads SKILL.md + metadata.json, walks directory tree, stores as `file_tree` JSON
- **Split-skill format on disk:** Each skill is a directory with `SKILL.md` (main content + YAML frontmatter), `metadata.json` (tags, alwaysApply), and optional `references/` directory
- **Canonical source:** Edit at `.opencode/skills/<name>/`, then use dashboard or `ingenium_skill_sync` to persist to DB
- **Runtime copy:** `.opencode/skills/<name>/` is auto-written from DB. Do not edit — changes will be overwritten unless synced back

### 🔴 Skill Sync Pattern (Client-Side)

Skills are synced via the **Resource Sync Engine** (`packages/ingenium-extension/resource-sync.ts`), which supersedes the old `skill-sync.ts`. The hash-manifest model ensures conflict-aware bidirectional sync:

1. **Sync manifest** — A `.opencode/.ingenium-sync-state.json` file tracks SHA-256 hashes of every synced resource (skills, agents, plugins, commands, config) as a baseline.
2. **On session.created** — `fullSync()` compares API vs disk vs manifest hashes. If API changed and disk matches baseline → pull API→disk. If disk changed and API matches baseline → push disk→API. If both changed → conflict (logged, preserved).
3. **On session.idle** — `incrementalSync()` runs (throttled to 1/60s), checking for out-of-sync resources.
4. **Sync directions per resource**: Skills, agents, plugins, commands, and config all use the same conflict-resolution algorithm but with resource-specific disk read/write helpers.
5. **Project resolution**: Uses `INGENIUM_PROJECT` env var first, then worktree basename. Never falls back to `"global-default"`.

The old manual pattern (skill_load → write files) still works for individual skill edits, but the resource-sync plugin handles bulk sync automatically on session start/idle hooks.

### Dashboard Styling Guide

Every service with a frontend must have a `STYLING-GUIDE.md` in its service directory documenting:
- Color palette with exact values
- Typography scale
- Layout grid and spacing
- Component-level styles (nav, cards, forms, selects)
- Immutable rules that must not be broken

> 🔴 **Select elements**: All `<select>` elements across the dashboard use `hover:bg-gray-50 cursor-pointer` for consistent hover feedback. See the "Select / Dropdown Styling" section in `STYLING-GUIDE.md` for the full spec and the list of pages with selects.

### 🔴 QA-First Workflow

After every subagent task that modifies files:
1. **Spawn `@ingenium-qa`** — Review changes, run tests, verify quality
2. **Spawn `@ingenium-docs`** — Update affected documentation (AGENTS.md, SKILL-INDEX.md)
3. **Task not done until QA passes and docs are updated**

See [`ingenium-orchestrator.md`](./.opencode/agents/primary/ingenium-orchestrator.md) for the full Definition of Done process.

### Environment Variables

| Variable | Default | Consumed By | Description |
|----------|---------|-------------|-------------|
| `OPENCODE_SERVER_PASSWORD` | `test` | OpenCode server | Auth password for OpenCode web server |
| `INGENIUM_API_URL` | `http://localhost:4097/api/v1` | ingenium-server | Base URL for API calls from MCP server |
| `INGENIUM_API_TIMEOUT` | `10000` | ingenium-server | API request timeout in ms |
| `INGENIUM_API_PORT` | `4097` | ingenium-api | Express server listen port |
| `INGENIUM_API_TOKEN` | _(none)_ | ingenium-api | Bearer token for API auth |
| `INGENIUM_CORE_DB_PATH` | `./.ingenium/data.db` | core + API | SQLite database file path |
| `INGENIUM_HOME` | `~/.ingenium` | core, supervisord | Ingenium data home directory |
| `INGENIUM_GLOBAL_CONFIG_PATH` | `/home/appuser/.config/opencode/` | ingenium-core | Global config path for skills/plugins/commands; overridable to custom directory |
| `INGENIUM_PROJECT` | `global-default` | @ingenium/extension plugins | Project name for extension plugins to write to (container = `global-default`, external = derived from worktree directory name) |
| `LOG_LEVEL` | `info` | ingenium-server | Pino log level |
| `NEXT_PUBLIC_API_URL` | `http://localhost:4097/api/v1` | ingenium-dashboard | API base URL for dashboard (browser-side) |
| `CORS_ORIGIN` | `*` | ingenium-api | Allowed CORS origin |
| `INGENIUM_API_RATE_LIMIT` | `100` | ingenium-api | Max requests per window |
| `SYNTHESIS_INTERVAL_MS` | `900000` | ingenium-api | Scheduled synthesis interval (15 min), 0 = disabled |
| `OBSERVER_CHECK_INTERVAL` | `0` | observer plugin | Session idle check interval, 0 = disabled |
| `NODE_ENV` | _(none)_ | services | Node environment (production/development) |
| `GOOGLE_OAUTH_CLIENT_ID` | _(required for OAuth)_ | ingenium-email | Google OAuth2 app client ID |
| `GOOGLE_OAUTH_CLIENT_SECRET` | _(required for OAuth)_ | ingenium-email | Google OAuth2 app client secret |
| `MS_OAUTH_CLIENT_ID` | _(required for OAuth)_ | ingenium-email | Microsoft OAuth2 app client ID |
| `MS_OAUTH_CLIENT_SECRET` | _(required for OAuth)_ | ingenium-email | Microsoft OAuth2 app client secret |
| `INGENIUM_EMAIL_ENCRYPTION_KEY` | _(required)_ | ingenium-email | 32-byte hex key for AES-256-GCM credential encryption |
| `OAUTH_REDIRECT_URI` | `http://localhost:3000/mail/oauth/callback` | ingenium-email | OAuth2 callback URL |
| `INGENIUM_OPENCODE_DB_PATH` | `/var/opencode/opencode.db` | ingenium-api | OpenCode SQLite DB path for extraction engine. The DB is mounted read-write in Docker. |

> **Per-project mail settings** (configurable via `ingenium_setting_set` or Settings page):
> - `mail_offline_window` (default: 500) — max email headers to sync per folder
> - `mail_body_window` (default: 200) — max email bodies to cache per folder
> - `mail_sync_interval_ms` (default: 300000) — round-robin cadence between folder syncs
> - `synthesis_interval_ms` (default: 900000) — synthesis pipeline interval (0 = disabled)
