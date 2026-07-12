---
name: self-learning
description: "Self-learning pipeline with observation, synthesis, and personality systems. Replaces old learnings system with automated observation collection and trait-based learning."
alwaysApply: true
tags: ["self-learning", "observations", "synthesis", "personality", "ai-agent"]
---

> 📖 **Full reference**: See [`self-learning-pipeline.md`](../../docs/self-learning-pipeline.md).

# Self-Learning Pipeline

## Overview

The self-learning pipeline is a background system that automatically learns from user interactions without requiring explicit agent self-reporting. It consists of three phases: **Observation**, **Synthesis**, and **Personality**.

Instead of the old `ingenium_learning_log` → keyword-based classification → direct skill file edits flow, this new system uses:
- **Observations** (10 types, FTS5 searchable) stored in a dedicated table
- **Personality Traits** (10 trait types) aggregated from observations into a profile view
- **Synthesis Pipeline** that classifies observations and updates skills automatically

## Architecture

```
User OpenCode Session (:4098)
  │
  ├─ Agent uses ingenium_observe() during workflow
  │   → observation stored in DB (pending)
  │
  ├─ Observer Plugin (session.idle / session.created)
  │   → imports local file fallbacks
  │   → triggers synthesis
  │
  └─ Synthesis Pipeline (triggered by /synthesize or plugin)
      → classifies observations
      → updates personality_traits
      → marks observations as processed
      → updates skills
```

## Database Tables

### `observations` Table
Stores individual learning observations with FTS5 search capability.

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER | Primary key |
| `observation_type` | TEXT | One of 10 types (see below) |
| `content` | TEXT | The observation content |
| `importance` | INTEGER | Priority score (1-10) |
| `status` | TEXT | `pending`, `processing`, or `processed` |
| `session_id` | TEXT | OpenCode session identifier |
| `created_at` | DATETIME | Timestamp |
| `processed_at` | DATETIME | When synthesis completed it |

### `personality_traits` Table
Aggregates observations into personality trait profiles.

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER | Primary key |
| `trait_type` | TEXT | One of 10 types (see below) |
| `value` | TEXT | The trait value |
| `confidence` | REAL | Confidence score (0-1) |
| `created_at` | DATETIME | When trait was created |
| `updated_at` | DATETIME | Last update timestamp |

## 🔴 HARD RULE — Only observe USER behavior

Never observe what the agent did (implementation notes). Only observe what the USER did or said — their preferences, corrections, feedback, behavior patterns. Example:

✅ "User prefers camelCase over snake_case" (preference)
✅ "User corrected indentation from 4 to 2 spaces" (correction)
✅ "User ran tests before committing" (workflow)
❌ "Added sort filters to dashboard" (implementation — use pipeline events)
❌ "Implemented global config path resolution" (implementation — use pipeline events)
❌ "Fixed plugins table UNIQUE constraint" (implementation — use pipeline events)

## Observation Types

Use these 10 observation types when calling `ingenium_observe`:

| Type | When to use | Example |
|------|-------------|---------|
| `correction` | User corrects agent behavior | "User prefers snake_case over camelCase" |
| `preference` | User expresses a preference | "User wants 2-space indentation" |
| `pattern` | Recurring behavior observed | "User always adds JSDoc comments" |
| `insight` | Novel discovery | "Container PTY works with glibc" |
| `feedback` | Implicit accept/reject | "User accepted the refactored code" |
| `behavior` | User behavior signal | "User runs tests before committing" |
| `terminology` | Preferred language | "User calls it 'deploy' not 'release'" |
| `workflow` | Workflow sequence | "User runs lint before commit" |
| `error` | User encountered error | "User hit TypeScript strict mode error" |
| `goal` | Stated or implied goal | "User wants to improve test coverage" |

## Personality Traits

The synthesis pipeline creates personality traits from observations. Each observation type maps to specific trait types:

| Trait Type | Generated from | Description |
|------------|---------------|-------------|
| `communication_style` | correction, preference | How the agent should communicate |
| `code_preference` | preference, correction | Code style and formatting preferences |
| `workflow_pattern` | pattern, workflow | User's development workflow patterns |
| `terminology` | terminology | Preferred terms and language |
| `priority_signal` | behavior, goal, error | What the user prioritizes |
| `feedback_style` | correction, feedback | How user gives feedback |
| `interaction_pattern` | behavior | Interaction style with agent |
| `domain_knowledge` | insight | User's domain expertise areas |
| `learned_skill` | pattern, workflow | Skills learned from observations |
| `personality_trait` | All types | General personality characteristics |

## How to Use

### For Agents (during workflow)

Use `ingenium_observe` naturally during your workflow — just like you use `read`, `grep`, or `edit`:

```typescript
// Store an observation during your work
ingenium_observe(
  observation_type: "preference",
  content: "User prefers concise error messages with action items",
  importance: 7
)
```

The observation is stored in the DB with status "pending". The synthesis pipeline will process it later.

### For the Orchestrator

Run `/synthesize` to trigger the synthesis pipeline, or wait for the background observer plugin to auto-trigger on session events.

**Auto-synthesis:** The API server automatically triggers synthesis every 15 minutes (configurable via `SYNTHESIS_INTERVAL_MS` env var). Set to `0` to disable.

## MCP Tools

### Core Observation Tools (8 tools)

- \`ingenium_observe\` — Store an observation (10 types available)
- \`ingenium_observation_search\` — FTS5 search across observations with ranking
- \`ingenium_observation_list\` — List observations with filters (type, status, importance)
- \`ingenium_observation_stats\` — Get pipeline statistics (pending/processed counts)

### Email Tools (13 tools)

| Tool | Purpose |
|------|---------|
| `ingenium_email_*` | List, search, read, send, draft, triage, suggest response, auto-draft, IMAP watcher |

### Personality & Synthesis Tools (4 tools)

- \`ingenium_personality\` — Get full personality profile from all traits
- \`ingenium_personality_traits\` — List personality traits with filtering
- \`ingenium_synthesis_run\` — Trigger synthesis pipeline manually
- \`ingenium_synthesis_status\` — Check pipeline status and stats

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/observations` | GET | List observations with filters |
| `/api/v1/observations/search` | GET | FTS5 search across observations |
| `/api/v1/observations/stats` | GET | Pipeline statistics |
| `/api/v1/personality` | GET | Full personality profile |
| `/api/v1/personality/traits` | GET | List personality traits |
| `/api/v1/synthesis/run` | POST | Trigger synthesis pipeline |
| `/api/v1/synthesis/status` | GET | Check pipeline status |

## Deprecation Notice

The old `ingenium_learning_log` MCP tool has been **removed**. Use `ingenium_observe` instead.

**Migration path:**
- New code should use `ingenium_observe` instead of `ingenium_learning_log`
- Existing learnings entries will be processed by the synthesis pipeline
- The `/process-learnings` command is deprecated; use `/synthesize` instead

## Related Documentation

- [docs/HOW-TO/learnings.md](../HOW-TO/learnings.md) — Old learnings documentation (deprecated, kept for reference)
- `.opencode/commands/synthesize.md` — Synthesis command reference
- .opencode/skills/skill-maintenance/SKILL.md — Skill lifecycle management

## Code Location

| Component | Path |
|-----------|------|
| Core tools | `packages/ingenium-core/lib/tools/observations.ts`, `personality.ts`, `synthesis.ts` |
| API routes | `services/ingenium-api/lib/routes/observations.ts`, `personality.ts`, `synthesis.ts` |
| MCP server | `services/ingenium-server/scripts/mcp-server.ts` (tools registered) |
| Plugin | `.opencode/plugins/observer.ts`, `observer-core.ts` |
| Dashboard pages | `services/ingenium-dashboard/src/app/observations/page.tsx`, `personality/page.tsx` |

## Self-Improvement Commands

After making changes to the self-learning system:

```bash
# Run synthesis to process observations
/synthesize

# Check pipeline status
ingenium_synthesis_status

# View personality profile
ingenium_personality

# Search observations
ingenium_observation_search("keyword")
```
