---
name: self-learning
description: "Self-learning pipeline: server-side LLM extraction of user-behavior observations, LLM trait consolidation, and automatic skill synthesis."
alwaysApply: true
tags: ["self-learning", "observations", "synthesis", "personality", "extraction"]
---

> 📖 **Full reference**: See [`docs/self-learning-pipeline.md`](../../docs/self-learning-pipeline.md) for exhaustive detail (database schemas, pipeline events, LLM prompt structure, JSON parsing strategies, and dashboard integration).

# Self-Learning Pipeline

## Overview

The self-learning pipeline automatically discovers durable user behavior patterns from OpenCode message history and converts them into personality traits and skills. It replaced the old manual `ingenium_learning_log` system entirely.

The pipeline runs in **four stages**:

| Stage | Name | What Happens |
|-------|------|-------------|
| **Phase 0** | Extraction | Server-side engine reads OpenCode message DB, regex pre-filters candidates, LLM extracts behavior rules as observations |
| **Phase 1** | Trait Consolidation | LLM consolidates observations into normalized personality traits (CONFIRM / CREATE / IGNORE) |
| **Phase 2** | Skill Synthesis | LLM groups 3+ related observations and creates/updates skills on disk |
| — | Personality Display | Traits shown in dashboard with confidence bars, "N hidden" toggle for low-confidence |

## Architecture

```
OpenCode Message DB (/var/opencode/opencode.db)
  │
  ├─ Extraction Engine (extraction.ts)           ← SERVER-SIDE
  │   → watermark-gated read + content-hash dedup
  │   → regex pre-filter selects candidate messages (cheap, not final)
  │   → LLM batch extraction (batches of 15) creates observations
  │   → no-LLM = zero observations (no regex fallback garbage)
  │
  ├─ Auto-Observer Plugin (auto-observer.ts)     ← THIN TRIGGER (62 lines)
  │   → on session.idle → POSTs /api/v1/extraction/run
  │   → carries ZERO detection logic; all extraction is server-side
  │   → scheduler covers extraction if plugin fails to load
  │
  ▼
Observations (SQLite + FTS5, status: pending)
  │
  ├─ Phase 1: consolidateTraits() (synthesis-llm.ts)
  │   → LLM receives observations + existing traits
  │   → decides CONFIRM (boost existing, +0.15) / CREATE (new "User ..." trait) / IGNORE (noise)
  │   → semantic merge prevents near-duplicates
  │   → no-LLM = observations stay PENDING (no heuristic garbage fallback)
  │
  ├─ Phase 2: LLM Skill Synthesis (synthesis.ts)
  │   → groups 3+ related observations from the batch
  │   → sends to LLM with existing skills + traits as context
  │   → creates/updates skills with writeSkillToDisk() + llm-synthesized prefix
  │   → LLM-suggested personality traits actually created
  │   → backup LLM provider fallback if primary fails
  │
  ▼
Personality Traits (SQLite personality_traits, confidence 0.10→0.95)
  → display gate ≥0.30 (dashboard "N hidden" toggle)
  → 7-day inactivity decay: -0.05
```

**All driven by:**
- **Scheduler** (`services/ingenium-api/lib/scheduler.ts`) — runs extraction → synthesis → skill-sync every 15 min for ALL active projects
- **Manual triggers** — `ingenium_extraction_run`, `ingenium_synthesis_run`, `/synthesize` command

## Extraction Engine (Phase 0)

The extraction engine is the **primary** source of observations. It runs **server-side** in the API process and reads OpenCode messages directly from the OpenCode SQLite database.

### How It Works

1. **Watermark gate** — reads `extraction_watermark` setting to skip already-processed messages
2. **Content-hash dedup** — reads `extraction_seen_hashes` setting to skip exact duplicates
3. **Regex pre-filter** — cheap regex scans for messages that MAY contain user behavior (candidate selection only, no observations created here)
4. **LLM batch extraction** — candidate messages batched into groups of up to 15, sent to the synthesis LLM
5. **Observation creation** — ONLY the LLM's structured JSON output becomes observations; raw message snippets never enter the DB

### 🔴 No-LLM = No Observations

If no synthesis LLM is configured, the extraction engine creates **zero** observations. There is no regex-only fallback that copies raw snippets into observations. The pipeline event will be `extraction_completed` with 0 observations or `extraction_failed`.

## Observation Lifecycle

### Observation Birth

Observations enter the system through exactly two paths:
- **Automatic (primary)**: The server-side extraction engine reads OpenCode messages and sends batches to the LLM
- **Manual (exceptional)**: An agent calls `ingenium_observe()` during its workflow for edge cases the extraction engine can't catch

### Observation Status

```
pending → (LLM extraction/agent creates) → pending
         → (consolidateTraits evaluates)   → processed | failed
         → (no-LLM configured)             → stays pending (retried next cycle)
```

### Types (10)

| Type | Use |
|------|-----|
| `correction` | User corrects agent behavior |
| `preference` | User expresses a code/style/workflow preference |
| `pattern` | Recurring behavior pattern (context for skill synthesis, not personality) |
| `insight` | Novel discovery (context for skill synthesis, not personality) |
| `feedback` | Implicit accept/reject of agent output |
| `behavior` | User behavior signal indicating intent/habit |
| `terminology` | Preferred language or naming convention |
| `workflow` | Multi-step workflow sequence |
| `error` | User encountered an error and how they responded |
| `goal` | Stated or implied goal |

## Trait Consolidation (Phase 1)

`consolidateTraits()` in `synthesis-llm.ts` sends each pending observation to the synthesis LLM alongside all existing active traits. The LLM returns:

| Decision | Effect |
|----------|--------|
| **CONFIRM** | Links observation to an existing trait, boosts confidence by +0.15 |
| **CREATE** | Creates a new **normalized** trait statement (e.g., "User prefers to rebuild and test after every change.") — NOT raw observation text copied verbatim |
| **IGNORE** | Observation is noise/unactionable; marked processed but creates no trait |

**No-LLM safety**: If the LLM is unavailable or unconfigured, observations stay `pending` for a future cycle. There is NO heuristic classification fallback that copies raw observation text into traits.

### Confidence Model

| Parameter | Value |
|-----------|-------|
| Starting confidence | 0.10–0.15 (clamped to [0.10, 0.15] by CREATE handler) |
| Confirmation boost | +0.15 per LLM CONFIRM |
| Cap | 0.95 |
| Display threshold | ≥ 0.30 (`getProfile()` filters below this) |
| Dashboard hidden toggle | "N hidden" link reveals traits < 0.30 |
| Decay | -0.05 after 7+ days of inactivity |

Freshly-extracted traits start at 0.10–0.15 and require 2+ confirming observations to reach the display threshold.

## Phase 2: Skill Synthesis

After trait consolidation, if a synthesis LLM is configured, the pipeline groups 3+ related observations and sends them to the LLM along with existing skills and traits as context.

The LLM returns structured JSON specifying skills to create/update, and optional personality traits. The pipeline:
- Creates skills with category "learning", tag "llm-synthesized", `always_apply: true`
- Writes skills to disk via `writeSkillToDisk()` in split-skill format
- Uses `llm-synthesized` prefix for LLM-created skill names
- Creates LLM-suggested personality traits (previously this was dropped — now actually created)
- Falls back to a backup LLM provider if the primary fails
- Does NOT block Phase 1 results if Phase 2 fails

## 🔴 HARD RULEs

1. **Observations capture USER behavior, NOT implementation.** Implementation activity belongs in pipeline events and git commits, not observations.
   - ✅ "User prefers 2-space indentation" — user behavior
   - ✅ "User corrected the agent's error handling approach" — user behavior
   - ❌ "Added sort filters to the dashboard" — implementation
   - ❌ "Fixed plugins table UNIQUE constraint" — implementation
2. **No-LLM leaves observations PENDING.** If the synthesis LLM is unavailable, observations stay pending for a future cycle. There is NO heuristic or regex fallback that copies raw text into traits.
3. **Docs must match code.** This SKILL.md must describe the CURRENT architecture. If the pipeline changes, update this file.
4. **Extraction is server-side.** Do NOT add detection logic to client-side plugins. The `auto-observer.ts` plugin is a thin trigger only (POST `/api/v1/extraction/run` on `session.idle`). All extraction logic lives in `extraction.ts`.

> **Backup LLM provider**: If a `synthesis_backup_provider` + `synthesis_backup_model` + `synthesis_backup_endpoint` are configured in Settings, Phase 2 skill synthesis falls back to them when the primary provider fails.

## MCP Tools

### Observation Tools

| Tool | Purpose |
|------|---------|
| `ingenium_observe` | Manual observation creation (exceptional cases; extraction engine handles most) |
| `ingenium_extraction_run` | Trigger server-side extraction engine from OpenCode messages |
| `ingenium_observation_search` | FTS5 search across observations |
| `ingenium_observation_list` | List observations with type/status filters |
| `ingenium_observation_stats` | Pipeline statistics (total, pending, processed) |

### Synthesis Tools

| Tool | Purpose |
|------|---------|
| `ingenium_synthesis_run` | Trigger synthesis pipeline (Phase 1 + Phase 2) |
| `ingenium_synthesis_status` | Check pipeline status and stats |
| `ingenium_synthesis_cross_project` | Cross-project synthesis (promotes patterns to global-default) |

### Personality Tools

| Tool | Purpose |
|------|---------|
| `ingenium_personality` | Full aggregated personality profile |
| `ingenium_personality_traits` | List traits with optional type filter |

> **DELETE support**: Observations and personality traits have individual and batch DELETE endpoints. See API Endpoints table below.

## API Endpoints

### Extraction

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/v1/extraction/run` | Trigger server-side extraction |

### Observations

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/observations` | List observations (filters: status, type) |
| POST | `/api/v1/observations` | Create observation (manual) |
| GET | `/api/v1/observations/search` | FTS5 search |
| GET | `/api/v1/observations/stats` | Pipeline statistics |
| DELETE | `/api/v1/observations/:id` | Delete single observation |
| DELETE | `/api/v1/observations` | Delete all observations from a source (source param required) |

### Personality

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/personality` | List personality traits |
| GET | `/api/v1/personality/profile` | Aggregated personality profile |
| DELETE | `/api/v1/personality/:id` | Delete single trait |
| DELETE | `/api/v1/personality` | Delete all traits (project-scoped) |

### Synthesis

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/v1/synthesis/run` | Trigger synthesis pipeline |
| GET | `/api/v1/synthesis/status` | Check pipeline status |

## Scheduler

The API server (`services/ingenium-api/lib/scheduler.ts`) runs every **15 minutes** for ALL active (non-archived) projects, in sequence:

1. **Extraction** — runs server-side extraction (Phase 0), so fresh observations are available
2. **Synthesis** — processes pending observations into traits (Phase 1) and skills (Phase 2)
3. **Skill sync** — triggers bidirectional disk↔DB sync via `POST /api/v1/skills/sync-all`

Extraction runs BEFORE synthesis so freshly extracted observations are consolidated in the same cycle. Each step awaits the previous one.

Configure via `SYNTHESIS_INTERVAL_MS` env var (default: 900000ms). Set to `0` to disable. Can also be overridden via the `synthesis_interval_ms` setting in the global-default project (Settings page).

## Code Location

| Component | Path |
|-----------|------|
| Extraction engine (Phase 0) | `packages/ingenium-core/lib/tools/extraction.ts` |
| Observation CRUD + FTS5 | `packages/ingenium-core/lib/tools/observations.ts` |
| Personality trait CRUD + confidence | `packages/ingenium-core/lib/tools/personality.ts` |
| Synthesis orchestrator (Phase 1+2) | `packages/ingenium-core/lib/tools/synthesis.ts` |
| LLM client (consolidateTraits, callSynthesisLLM) | `packages/ingenium-core/lib/tools/synthesis-llm.ts` |
| Pipeline event logging | `packages/ingenium-core/lib/tools/pipeline-events.ts` |
| Zod schemas | `packages/ingenium-core/lib/schema.ts` |
| DB migrations (018 extraction events, 019 trait FK) | `packages/ingenium-core/data/migrations/018_*.sql`, `019_*.sql` |
| Scheduler (15-min cycle) | `services/ingenium-api/lib/scheduler.ts` |
| API routes (observations, personality, synthesis) | `services/ingenium-api/lib/routes/observations.ts`, `personality.ts`, `synthesis.ts` |
| Auto-observer plugin (thin trigger, 62 lines) | `packages/ingenium-extension/auto-observer.ts` |
| Observer plugin (session events, file import) | `packages/ingenium-extension/observer.ts` |
| Observer core (importObservationsFromFile, triggerSynthesis) | `packages/ingenium-extension/observer-core.ts` |
| Skill sync plugin | `packages/ingenium-extension/skill-sync.ts` |
| Dashboard pages | `services/ingenium-dashboard/src/app/observations/`, `personality/`, `pipeline/` |

## Cross-References

- [`docs/self-learning-pipeline.md`](../../docs/self-learning-pipeline.md) — Complete reference: DB schemas, pipeline events, LLM prompt structure, JSON parsing strategies, dashboard integration
- [`.opencode/commands/synthesize.md`](../commands/synthesize.md) — `/synthesize` command reference
- [`.opencode/commands/sync-skills.md`](../commands/sync-skills.md) — `/sync-skills` command reference
- [`.opencode/skills/skill-maintenance/SKILL.md`](../skill-maintenance/SKILL.md) — Skill lifecycle management
