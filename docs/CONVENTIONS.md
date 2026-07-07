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

## Learning Logging — Dual-Write

Every change that modifies skills, agents, hooks, plugins, config, or architecture MUST be logged in two places:

1. **File**: `.agents/skills/learnings.md` — append-only changelog with commit hashes, categories, and change descriptions. Uses the template with date, commit hashes, category tags, changes list, and why.
2. **MCP tool**: `ingenium_learning_log` — writes to the Ingenium SQLite database with FTS5 indexing for cross-session searchability.

**Both are mandatory.** The file provides a linear audit trail; the database provides searchable knowledge.

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
