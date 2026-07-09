# Architecture

## Data Flow

```
Dashboard → HTTP → API → Core → SQLite
MCP Server → HTTP → API → Core → SQLite
```

- `ingenium-api` is the **sole database authority**. No other service imports `ingenium-core` or any SQL library.
- `ingenium-server` runs as an MCP stdio transport for OpenCode. It talks to the API over HTTP.
- `ingenium-dashboard` is a Next.js 16 frontend. It talks to the API over HTTP.

## Skill System

Skills are loaded from the Ingenium SQLite database via the MCP server. The canonical source files for editing live at `.agents/skills/<name>/SKILL.md`. The MCP server provides tools for listing, loading, searching, creating, and updating skills. The `update-skill-index` workflow regenerates `SKILL-INDEX.md` from all skill files.

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
- **Logging requirement**: Every change must be logged via the `ingenium_learning_log` MCP tool (searchable database). Enforced by 🔴 HARD RULEs in `generic-conventions` and `orchestrator-primer`. Learnings are DB-only — the old `.agents/skills/learnings.md` file has been removed.
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

### MCP Tool Count

The MCP server (`services/ingenium-server/scripts/mcp-server.ts`) exposes **36 tools** (was 35 after Plan 12, now +1 for `ingenium_skill_from_learnings`). Tool categories:
- Settings: 2
- Skills: 6 (list, load, search, create, update, skill_from_learnings)
- Learnings: 4 (log, search, list, skill_from_learnings)
- Tasks: 5 (create, list, move, complete, next)
- Plans: 3 (save, search, list)
- Projects: 6 (list, init, delete, restore, list_archived, purge)
- Plugins: 7 (list, get, enable, disable, create, delete, update)
- Servers: 3 (list, add, remove)

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
