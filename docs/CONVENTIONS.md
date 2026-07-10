# Conventions

## OpenCode Web UI Embedded in Dashboard
The dashboard includes an embedded OpenCode service at `/opencode` — a second OpenCode instance on `:4098` without auth (for iframe use) that connects to the Ingenium MCP server. The session persists across tab navigation with a hidden iframe toggle. Workspace (`~/repos`) is mounted to `/workspace` in the container via Docker volume.

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

## Self-Learning Pipeline — Observations (Preferred)

The self-learning pipeline uses **observations** instead of the deprecated `ingenium_learning_log` tool. Every change that modifies skills, agents, hooks, plugins, config, or architecture should be logged via `ingenium_observe`.

Observations are **DB-primary** with a **file fallback**: if the API is down, observations append to `.opencode/skills/learnings.md`. On the next session start, `importLearningsFromFile()` in the observer plugin syncs file entries into the DB. The MCP tool is the primary source of truth; the file is a resilience layer.

**Observation types** (Zod schema, `packages/ingenium-core/lib/schema.ts`):

| Type | When used |
|------|-----------|
| `correction` | User corrects agent behavior |
| `preference` | User preference or configuration choice (most common) |
| `pattern` | Repeated convention, workflow, or discovered pattern |
| `insight` | Novel discovery |
| `feedback` | Implicit accept/reject |
| `behavior` | User behavior signal |
| `terminology` | Preferred language |
| `workflow` | Workflow sequence |
| `error` | User encountered error |
| `goal` | Stated or implied goal |

The `orchestrator-primer` skill requires the orchestrator to call `ingenium_observe(observation_type="preference", ...)` after every subagent task that modifies files (🔴 HARD RULE). The `generic-conventions` skill extends this to all agents for any code change. The `update-skills` skill adds auto-trigger instructions for logging when detection signals fire.

> 🔴 **Note:** The old `ingenium_learning_log` tool is deprecated but still functional for backward compatibility. New code should use `ingenium_observe`.

### Related Self-Learning Skill

See `.opencode/skills/self-learning/SKILL.md` for complete documentation of the self-learning pipeline, including:
- Observation types and when to use them
- Personality trait generation rules
- Synthesis pipeline architecture
- MCP tools reference

## Docker Configuration
- Build-time UID matching host user for write access to workspace
- Appuser home dirs pre-created for OpenCode config persistence (`opencode-config`, `opencode-data` volumes)
- Supervisorctl section for restart management

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

## Skill file_tree Convention

Every skill in the DB has a `file_tree` column (TEXT, JSON map of relative paths → file content). This ensures complete data round-trips between DB and disk:
- **Writing to disk**: `writeSkillToDisk()` always writes SKILL.md (with YAML frontmatter) + metadata.json, then writes every file in the `file_tree` JSON to the skill directory.

## Email Security — Credentials (OAuth tokens and app passwords) are encrypted with AES-256-GCM before storage in SQLite settings. No plaintext credentials in the DB or logs. Encryption key from INGENIUM_EMAIL_ENCRYPTION_KEY env var.

---

- **Reading from disk**: `syncSkillFromDisk()` reads SKILL.md + metadata.json, walks the directory tree for all auxiliary files (excluding SKILL.md and metadata.json), and stores them as `file_tree` JSON.
- **Split-skill format on disk**: Each skill is a directory with `SKILL.md` (main content + YAML frontmatter), `metadata.json` (tags, alwaysApply), and optional `references/` directory for auxiliary docs.
- **Skills live at `.opencode/skills/`** — edit SKILL.md here, then use the dashboard or `ingenium_skill_sync` to persist changes to the DB.
- **Runtime copy at `.opencode/skills/`** is automatically written from the DB. Do not edit — changes will be overwritten unless synced back.
