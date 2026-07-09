# Conventions

## DB Isolation
- Only `packages/ingenium-core` and `services/ingenium-api` may import SQL libraries
- CI enforces: `grep -r "better-sqlite3\|\.db\|sqlite" services/ingenium-server/` must return empty

## API-First Frontend
- Dashboard imports ZERO core/server code. All data via HTTP to API.

## Dashboard Styling Guide

Every service with a frontend (Next.js dashboard) must have a `STYLING-GUIDE.md` in its service directory. This documents:
- Color palette with exact values
- Typography scale
- Layout grid and spacing
- Component-level styles (nav, cards, forms)
- Rules that must not be broken

The guide is generated from a live screenshot using the vision API and updated whenever visual changes are made.

## Learning Logging — MCP Tool Only

Every change that modifies skills, agents, hooks, plugins, config, or architecture MUST be logged via the `ingenium_learning_log` MCP tool. This writes to the Ingenium SQLite database with FTS5 indexing for cross-session searchability.

Learnings are **DB-only** — the old `.agents/skills/learnings.md` file has been removed. The MCP tool is the single source of truth.

**entry_type enum** (Zod schema, `packages/ingenium-core/lib/schema.ts`):

| Type | When used |
|------|-----------|
| `pattern` | Repeated convention, workflow, or discovered pattern |
| `decision` | Architecture or design decision with rationale |
| `bug` | Bug fix with root cause and prevention |
| `preference` | User preference or configuration choice |
| `research` | Investigation findings |
| `skill` | Skill created, updated, or retired |
| `agent` | Agent definition changed |
| `config` | Configuration change |
| `hook` | Hook lifecycle trigger changed |
| `plugin` | Plugin lifecycle event |
| `architecture` | Architecture decision |

The `orchestrator-primer` skill requires the orchestrator to call `ingenium_learning_log` after every subagent task that modifies files (🔴 HARD RULE). The `generic-conventions` skill extends this to all agents for any code change. The `update-skills` skill adds auto-trigger instructions for logging when detection signals fire.

## Plugin Auto-Config Sync

Every plugin lifecycle operation (create, enable, disable, delete, seed, update) MUST also sync `.opencode/plugins/<file>.ts` on disk AND update `opencode.json`'s `plugin` array.

- `addPluginToConfig()` appends `.opencode/plugins/<file>` to `opencode.json`'s `plugin` array.
- `removePluginFromConfig()` removes it.
- All path resolution uses `getProjectRoot()` which resolves from `INGENIUM_CORE_DB_PATH` (`../../`) — never `process.cwd()`.
- This prevents the "disconnected config" bug where the DB shows a plugin as enabled but OpenCode can't load it because the file or config entry is missing.

## Learning→Skill Auto-Detection

Every `POST /learnings` with `entry_type ≠ "skill"` and `priority ≥ 5` triggers fire-and-forget detection. The pipeline:

1. **`extractKeywords()`** — Split content on `/[^a-z0-9]+/`, filter stopwords (80+ common words), compute frequency, return top 10.
2. **`detectSkillGap()`** — FTS5 OR-search on skills (top 5 keywords), then check exact word overlap: skill name+description must contain ≥2 of the top 5 keywords (word-split, not substring). If no coverage, proceed.
3. **`createSkillGapTask()`** — Dedup check against existing open tasks, then create a context-rich task assigned to `@ingenium-software-engineer-fast`.

Key rules:
- `entry_type="skill"` is never detected (loop guard, prevents infinite feedback).
- Priority < 5 is never detected (low-signal filter).
- Word-split matching prevents false substring matches: "conventions" ≠ "convention", "gitignore" ≠ "git".
- Hyphenated names like "idempotent-seeding" correctly split to ["idempotent", "seeding"].
- Dedup checks that no similar-title task already exists in `todo` or `in_progress` columns.
- Manual batch scanning via `ingenium_skill_from_learnings` MCP tool processes the last 20 learnings.
- The orchestrator's step 4a 🔴 HARD RULE runs both automated detection and manual LLM eye review after every batch of task completions.
