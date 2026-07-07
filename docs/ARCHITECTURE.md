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

## Learning System

Learning entries provide cross-session persistent memory. Each entry records a pattern, decision, bug, preference, or other discovery for future retrieval by AI agents.

- **Storage**: SQLite with FTS5 full-text search for BM25-ranked queries
- **Zod schema**: `LearningSchema` with `entry_type: z.enum(["decision", "bug", "pattern", "preference", "research", "skill", "agent", "config", "hook", "plugin", "architecture"])` — expanded from 5 to 11 types to cover all skill system evolution categories
- **MCP tools**: `ingenium_learning_log` (create), `ingenium_learning_search` (FTS5 query)
- **Dual-Write requirement**: Every change must be logged both to the file `.agents/skills/learnings.md` (audit trail) and via the `ingenium_learning_log` MCP tool (searchable database). Both are enforced by 🔴 HARD RULEs in `generic-conventions` and `orchestrator-primer`.
- **entry_type reference**:

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
