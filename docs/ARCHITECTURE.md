# Architecture

## Data Flow

```
Dashboard → HTTP → API → Core → SQLite
MCP Server → HTTP → API → Core → SQLite
Email Client → OAuth2 + IMAP/SMTP → Mail Providers (Gmail, Outlook)
```

- `ingenium-api` is the **sole database authority**. No other service imports `ingenium-core` or any SQL library.
- `ingenium-server` runs as an MCP stdio transport with **61 tools**. It talks to the API over HTTP. Zero DB access.
- `ingenium-dashboard` is a Next.js 16 App Router frontend with **11 pages**. It talks to the API over HTTP.

## Skill System

Skills are loaded from the Ingenium SQLite database via the MCP server. The canonical source files for editing live at `seed/skills/<name>/` with a split-skill format (SKILL.md + metadata.json + references/). When created or updated via API, skills are written to disk at `.opencode/skills/<name>/` for agent access.

### file_tree Column

The `skills` table has a `file_tree` column (TEXT, stores JSON map of relative paths → content). This enables complete data round-trips:

- **`writeSkillToDisk()`** — After DB create/update, reads `file_tree` JSON and writes every file under the skill directory. Always writes SKILL.md (with YAML frontmatter) and metadata.json.
- **`syncSkillFromDisk()`** — Reads SKILL.md, parses frontmatter, reads metadata.json, and walks the directory tree to rebuild `file_tree`. If skill doesn't exist in DB, creates it; otherwise updates.

This means a skill can contain any number of auxiliary files (reference docs, examples, configs) that are fully preserved in the DB's `file_tree` and round-tripped to disk.

### Skill Seeds

17 skills live at `seed/skills/` and are loaded into the DB via `./run.sh seed` (uses `INSERT OR IGNORE` for idempotency). Each seed skill directory contains `SKILL.md` (with frontmatter), `metadata.json`, and any `references/` subdirectory.

The MCP server provides tools for listing, loading, searching, creating, updating, deleting, enabling, disabling, and syncing skills. The `update-skill-index` workflow regenerates `SKILL-INDEX.md` from all skill files.

## Plugin System

Plugins are stored in the `plugins` SQLite table and synced to disk as `.ts` files under `.opencode/plugins/`. The `opencode.json` plugin array is auto-populated.

- **Path resolution**: `getProjectRoot()` helper in `packages/ingenium-core/lib/tools/plugins.ts` resolves from `INGENIUM_CORE_DB_PATH` (`../../`), replacing all `process.cwd()` calls so paths work consistently across services (API, MCP server, dashboard).
- **Config sync**: `addPluginToConfig()` / `removePluginFromConfig()` auto-update `opencode.json` whenever plugins are enabled, disabled, created, deleted, or seeded — preventing the "disconnected config" bug where DB and opencode.json fell out of sync.
- **Seeding**: `seedPlugins()` writes `.ts` files to `.opencode/plugins/`, inserts into the `plugins` table with `enabled = 1`, and syncs `opencode.json`. Uses `INSERT OR IGNORE` for idempotency.
- **MCP tools**: `ingenium_plugin_list`, `ingenium_plugin_get`, `ingenium_plugin_enable`, `ingenium_plugin_disable`, `ingenium_plugin_create`, `ingenium_plugin_delete`, `ingenium_plugin_update`.

## Learning System

Learning entries provide cross-session persistent memory. Each entry records a pattern, decision, bug, preference, or other discovery for future retrieval by AI agents.

- **Storage**: SQLite with FTS5 full-text search for BM25-ranked queries
- **Zod schema**: `LearningSchema` with `entry_type: z.enum(["decision", "bug", "pattern", "preference", "research", "skill", "agent", "config", "hook", "plugin", "architecture"])` — expanded from 5 to 11 types to cover all skill system evolution categories
- **MCP tools**: `ingenium_learning_log` (create), `ingenium_learning_search` (FTS5 query), `ingenium_learning_list` (list recent), `ingenium_skill_from_learnings` (manual batch scan)
- **Logging requirement**: Every change must be logged via the `ingenium_learning_log` MCP tool (searchable database). Enforced by 🔴 HARD RULEs in `generic-conventions` and `orchestrator-primer`.
- **File fallback**: If the API is down, agents append to `.opencode/skills/learnings.md`. On the next session start, `importLearningsFromFile()` syncs file entries into the DB, marking them as processed.
- **Auto-detection pipeline**: After every `POST /learnings`, the system fire-and-forgets `detectSkillGap()` which:
  1. Extracts top 10 keywords (stopword filter + frequency)
  2. FTS5 OR-searches existing skills
  3. Checks exact word overlap in skill name+description (≥2 keywords = covered, using word-split to prevent substring false matches)
  4. If uncovered and priority ≥ 5 and not `entry_type="skill"` (loop guard), creates a task for `@ingenium-software-engineer-fast`
- **Manual batch scan**: `ingenium_skill_from_learnings` MCP tool scans the last 20 learnings and returns `{ scanned, tasks_created, task_ids }`.
- **entry_type reference**:

## Orchestrator Protocol — Step 4a

The orchestrator agent (`.opencode/agents/primary/ingenium-orchestrator.md`) includes a 🔴 HARD RULE step 4a: Skill-from-Learning Check. After every batch of task completions (at minimum every 3), it runs:
1. **Automated**: Call `ingenium_skill_from_learnings(project="ingenium")` — the FTS5-based detection engine scans for keyword-level gaps.
2. **Manual (LLM eye)**: Review recent learnings for `pattern`, `architecture`, or `decision` entries describing reusable conventions, then `ingenium_skill_search` to check coverage.

Both paths ensure skill coverage stays in sync with learnings. See `.opencode/agents/primary/ingenium-orchestrator.md` lines 137-148 for the full protocol.

## Dataset Reference

| Package | Description | DB Access |
|---------|-------------|-----------|
| `packages/ingenium-core/` | Shared library: SQLite WAL + FTS5, Zod schemas (DB access allowed) | Yes |
| `services/ingenium-api/` | Express REST API on :4097. Sole database authority. | Yes |
| `services/ingenium-server/` | MCP stdio server with 64 tools. Calls API via HTTP. Zero DB access. | No |
| `services/ingenium-dashboard/` | Next.js 16 App Router frontend with 11 pages. Calls API via HTTP. Zero DB access. | No |
| `packages/ingenium-email/` | IMAP/SMTP + OAuth2 email engine (imapflow, nodemailer, mailparser). DB Access: No. | No |

## Dashboard Pages

The Ingenium Dashboard (http://localhost:3000) provides 15 route-based pages:

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
| `/mail` | Mail (inbox, compose, reader, auto-responses) — email client interface |
| `/observations` | Self-learning observations with FTS5 search + type/status filters |
| `/personality` | Personality traits with confidence bars, enable/disable |
| `/pipeline` | Git-workflow-style timeline of pipeline events (3s poll, filters, +N collapse) |
| `/settings` | Settings + Synthesis LLM provider configuration |

> The dashboard talks to the API layer only — zero direct DB access.

### MCP Tool Count

The MCP server (`services/ingenium-server/scripts/mcp-server.ts`) exposes **61 tools**. Tool categories:
- Settings: 2 (get, set)
- Skills: 9 (list, load, search, create, update, delete, enable, disable, sync)
- Learnings: 4 (log, search, list, skill_from_learnings)
- Tasks: 5 (create, list, move, complete, next)
- Plans (Context): 3 (save, search, list)
- Projects: 6 (list, init, delete, restore, list_archived, purge)
- Plugins: 7 (list, get, enable, disable, create, delete, update)
- Servers: 3 (list, add, remove)
- Agents: 8 (list, get, create, update, delete, enable, disable, sync)
- Plus: `process_learnings` (from learnings plugin)

| Type | When used |
|------|-----------|
| `pattern` | Repeated convention, workflow, or discovered pattern |
| `decision` | Architecture or design decision with rationale |
| `bug` | Bug fix with root cause and prevention |
| `preference` | User preference or configuration choice |
| `research` | Investigation findings (doc ingestion, model comparison) |
| `skill` | Skill created, updated, or retired |
| `agent` | Agent definition changed or added |
| `config` | Configuration change (`opencode.json`, `models.yaml`) |
| `hook` | Hook lifecycle trigger created or modified |
| `plugin` | Plugin created, enabled, or disabled |
| `architecture` | Architecture decision or structural change |

---

## API Configuration

The Express API uses `express.json({ limit: "2mb" })` for request body parsing. This allows large skill payloads (when uploading skills with file_tree data) without hitting the default 100KB limit. Other middleware includes helmet for security headers, CORS (configurable via `CORS_ORIGIN`), and optional bearer token auth.

## Dashboard Features

### OpenCode Web UI Embedded in Dashboard
The dashboard includes an embedded OpenCode service at `/opencode` — a second OpenCode instance on `:4098` without auth (for iframe use) that connects to the Ingenium MCP server. The session persists across tab navigation with a hidden iframe toggle. Workspace (`~/repos`) is mounted to `/workspace` in the container via Docker volume.

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
      - "4096:4096"   # opencode-server (managed by supervisord)
    volumes:
      - ingenium_data:/app/.ingenium/data
```

Inside the container, **supervisord** manages three processes:
1. **API** (Express on :4097) — `express.json({ limit: "2mb" })` for large skill uploads
2. **Dashboard** (Next.js on :3000) — highlight.js syntax highlighting in Preview/Source modes
3. **opencode-server** (on :4096) — appuser home dirs pre-created for config persistence

Build-time UID matching ensures write access to workspace (`~/repos` → `/workspace`). Docker volumes `opencode-config` and `opencode-data` persist OpenCode configuration across container rebuilds.

Start with:
```bash
docker compose up --build
```
