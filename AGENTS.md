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

---

## Repository Structure

**Monorepo with 5 packages:**

```
packages/
├── ingenium-core/        # Shared library: SQLite WAL + FTS5, Zod schemas (DB access allowed)
└── ingenium-email/       # IMAP/SMTP email client (imapflow, nodemailer, mailparser). OAuth2 for Gmail/Outlook. No DB access.

services/
├── ingenium-api/         # Express REST API on :4097. Sole DB authority.
├── ingenium-server/      # MCP stdio server with ~73 tools. Calls API via HTTP. Zero DB access.
└── ingenium-dashboard/   # Next.js 16 App Router frontend. Calls API via HTTP. Zero DB access.
```

**API-First Architecture:** Dashboard and server import ZERO core/server code. All data flows through the API layer. Commands are captured in the DB alongside skills, agents, and plugins.

### Dashboard Pages

The Ingenium Dashboard (http://localhost:3000) provides 16 route-based pages:

| Page | Purpose |
|------|---------|
| `/` | Home — feature cards overview |
| `/opencode` | Embedded OpenCode web UI iframe |
| `/projects` | Project management (create, rename, archive, restore) |
| `/archive` | Archived projects with restore/purge |
| `/skills` | Skills grid with detail overlay, syntax highlighting |
| `/learnings` | Deprecated — redirects to `/observations` |
| `/tasks` | Kanban board (todo → in_progress → review → done) |
| `/plugins` | Plugin lifecycle (enable, disable, configure) |
| `/agents` | Agent profiles (model, mode, enable/disable) |
| `/servers` | MCP servers list with add/edit/delete |
| `/config` | OpenCode config editor (Project/Global tabs, sync from disk, save) |
| `/observations` | Self-learning observations with FTS5 search + type/status filters |
| `/personality` | Personality traits with confidence bars, enable/disable |
| `/pipeline` | Git-workflow-style timeline of pipeline events (3s poll, filters, +N collapse) |
| `/settings` | Settings + Synthesis LLM provider configuration |

> The dashboard talks to the API layer only — zero direct DB access. Commands are managed via MCP tools without a dedicated page.

---

## 🔴 MANDATORY — Database Isolation

**Only `packages/ingenium-core` and `services/ingenium-api` may import SQL libraries.** CI enforces this:

```bash
grep -r "better-sqlite3\|\.db\|sqlite" services/ingenium-server/  # must return empty
grep -r "better-sqlite3\|\.db\|sqlite" services/ingenium-dashboard/  # must return empty
```

Move any DB logic to the API layer immediately.

---

## Docker Deployment

**Single-container deployment via `docker compose up --build`**. The container runs **supervisord** managing four processes:

1. **API** (Express on :4097) — `express.json({ limit: "2mb" })` for large skill uploads, commands CRUD operations
2. **Dashboard** (Next.js on :3000) — highlight.js syntax highlighting in Preview/Source modes
3. **opencode-server** (on :4096) — Auth-enabled OpenCode web server
4. **opencode-iframe** (on :4098) — No-auth OpenCode iframe for embedded use

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
| `4096` | OpenCode Server | Auth-enabled MCP server |
| `4097` | API | Express REST gateway (sole DB authority) |
| `4098` | OpenCode Iframe | No-auth iframe for embedded use |

> 🔴 **Note**: Dockerfile `EXPOSE` only covers ports 3000, 4096, 4097. Port 4098 (opencode-iframe) is mapped in docker-compose.yml but not in Dockerfile `EXPOSE`.

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

---

## Testing

```bash
bash tests/test-self-improving.sh        # All 4 detection pipeline tests
bash tests/test-self-improving.sh -v     # Verbose output
bash tests/enforce-no-db-leaks.sh        # CI gate: verify no DB access leaks
bash tests/test-agent-validation.sh      # Agent validation checks (9 agents)
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

The **Observer Plugin** (`.opencode/plugins/observer.ts` + `observer-core.ts`) is the bridge between OpenCode sessions and the self-learning pipeline:

- **`session.created`** — On session start, imports file-fallback observations from `observations.md`, triggers initial synthesis
- **`session.idle`** — On idle events, optionally triggers synthesis at a configurable interval (`OBSERVER_CHECK_INTERVAL`)
- **Pipeline events** — Logs events to the `/pipeline` dashboard timeline (`session_created`, `observation_imported`, `synthesis_triggered`)
- **MCP tool** — Registers `synthesize_observations` tool for manual pipeline triggers

### LLM Skill Synthesis (Phase 2)

When configured in **Settings → Synthesis LLM**, the pipeline runs a second phase after heuristic trait generation:

1. Groups processed observations from the current batch
2. Sends them to the configured LLM along with existing skills + traits as context
3. LLM returns structured JSON with skills to create/update and new personality traits
4. Pipeline executes create/update operations and logs results to `/pipeline` timeline
5. Non-fatal: Phase 1 trait results are saved even if Phase 2 fails

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
| `session_created` | plugin | OpenCode session started |
| `synthesis_triggered` | plugin | Observer triggered synthesis |
| `synthesis_started` | synthesis | Pipeline began processing |
| `synthesis_completed` | synthesis | Pipeline finished successfully |
| `synthesis_failed` | synthesis | Pipeline errored out |
| `trait_created` | synthesis | New personality trait generated |
| `trait_updated` | synthesis | Existing trait confidence adjusted |
| `observation_created` | agent | Agent called `ingenium_observe` |
| `observation_imported` | plugin | File fallback imported into DB |

The timeline auto-polls every 3 seconds, supports filter pills (All/Agent/Plugin/Synthesis/Trait), collapses rapid events into +N groups, and shows detail overlays on click.

### Related Self-Learning Skill

See `.opencode/skills/self-learning/SKILL.md` for complete documentation of the self-learning pipeline, including:
- Observation types and when to use them
- Personality trait generation rules
- Synthesis pipeline architecture
- MCP tools reference

The self-learning skill now includes a `metadata.json` file for proper split-skill format compliance, enabling consistent skill sync and dashboard editing.

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

The API server (`services/ingenium-api/scripts/api-server.ts`) automatically runs two maintenance tasks every **15 minutes** for ALL active projects:

1. **Synthesis**: Triggers `/api/v1/synthesis/run` — processes pending observations into personality traits (Phase 1) and optionally runs LLM skill synthesis (Phase 2)
2. **Skill sync**: Triggers `/api/v1/skills/sync-all` — bidirectional disk↔DB sync (imports new skills from disk, writes DB skills to disk)

Configure via `SYNTHESIS_INTERVAL_MS` env var (default: 900000ms). Set to `0` to disable.

### Cross-Project Synthesis

The synthesis pipeline can now evaluate observations and skills across multiple projects to create global skills available to all projects:

1. **`ingenium_synthesis_cross_project`** — MCP tool that triggers cross-project synthesis across all active projects. Patterns discovered in one project can benefit all others.
2. **Global skills** — Skills synthesized from cross-project patterns are created in the `global-default` project and made available to every project via shared skill resolution.
3. **`ingenium_project_set_global`** — MCP tool that marks a project as the global-default, enabling shared skill resolution and cross-project observation evaluation.

Cross-project synthesis runs as part of the scheduled maintenance cycle (every 15 minutes) or can be triggered manually via the `ingenium_synthesis_cross_project` tool.

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

After any skill mutation (`ingenium_skill_create`, `update`, or `enable`), use this pattern to persist locally:

1. **Call `ingenium_skill_load(project, name)`** — Pull the full skill object from DB
2. **Use `write` tool** — Write files at `.opencode/skills/<name>/`:
   - `SKILL.md` with YAML frontmatter + content body
   - `metadata.json` with `{name, description, tags, alwaysApply}`
3. **Verify persistence** — Optionally read back to confirm

This is the client-side equivalent of server-side `writeSkillToDisk()`. The local-persistence skill (always_apply: true) enforces this pattern automatically when loaded before mutations.

### Dashboard Styling Guide

Every service with a frontend must have a `STYLING-GUIDE.md` in its service directory documenting:
- Color palette with exact values
- Typography scale
- Layout grid and spacing
- Component-level styles (nav, cards, forms)
- Immutable rules that must not be broken

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
