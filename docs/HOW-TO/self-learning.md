# HOW-TO: Self-Learning Pipeline

## Overview

The self-learning pipeline teaches your AI agent about your preferences, workflows, and patterns. The **extraction engine** (Phase 0) is the primary observation source — it reads your OpenCode messages server-side and uses the synthesis LLM to extract durable behavior rules automatically. Manual `ingenium_observe()` calls exist only for edge cases.

## Architecture

```
OpenCode Messages → Extraction Engine (server-side, Phase 0)
  → regex pre-filter → LLM batch extraction → Observations (pending)
  → consolidateTraits() (Phase 1) → CONFIRM/CREATE/IGNORE → Traits
  → LLM Skill Synthesis (Phase 2) → Skills (writeSkillToDisk)
  → Scheduler runs extraction → synthesis → skill-sync every 15 min
```

## Observation Types

The 10 observation types classify user behavior signals:

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

## How Observations Are Created

### Primary: Extraction Engine (automatic)

The **server-side extraction engine** (`packages/ingenium-core/lib/tools/extraction.ts`) reads your OpenCode message history every 15 minutes (via the scheduler) or on demand (`POST /api/v1/extraction/run`). It uses:

1. **Watermark + dedup** — Per-project watermark and content-hash dedup prevent re-processing the same messages.
2. **Regex pre-filter** — Cheap candidate selection identifies messages that MAY contain user behavior (NOT final extraction).
3. **LLM batch extraction** — Candidate messages are batched (up to 15) and sent to the synthesis LLM, which extracts durable user behavior rules as JSON. Only LLM output becomes observations — raw message snippets never enter the DB.
4. **No-LLM = no observations** — If no synthesis LLM is configured, extraction creates zero observations.

### Secondary: Manual `ingenium_observe()` (exceptional cases only)

For edge cases the extraction engine cannot catch, use the MCP tool directly:

```
ingenium_observe(observation_type: "preference", content: "...", importance: 7)
```

The observation is stored with status "pending" and processed by the next synthesis cycle.

## How Synthesis Works

### Automation

The **scheduler** (`services/ingenium-api/lib/scheduler.ts`) runs every 15 minutes for all active projects. It executes three phases in sequence:

1. **Extraction** — Reads new OpenCode messages, creates observations via LLM.
2. **Synthesis** — Processes pending observations into traits (Phase 1), then optionally creates skills (Phase 2).
3. **Skill sync** — Bidirectional disk↔DB sync for all skills.

You can also trigger synthesis manually with `/synthesize` (or `ingenium_synthesis_run`).

### Phase 1: Trait Consolidation

`consolidateTraits()` (`packages/ingenium-core/lib/tools/synthesis-llm.ts`) sends each observation to the LLM. The LLM returns one of three decisions:

- **CONFIRM** — Link to an existing trait (increases confidence by +0.15).
- **CREATE** — Generate a new normalized trait statement (e.g., "User prefers to rebuild and test after every change.").
- **IGNORE** — Noise, skip.

Semantic merge prevents near-duplicate traits. If the LLM is unavailable, observations stay PENDING — no garbage heuristic fallback.

### Confidence Model

- Traits start at **0.10–0.15** confidence.
- Each confirmation adds **+0.15**, capped at **0.95**.
- Display threshold is **≥0.30** — freshly extracted traits are hidden until confirmed via 2+ observations.
- 7-day inactivity **decay** drops confidence by -0.05.

### Phase 2: Skill Synthesis

If an LLM is configured, groups of 3+ related observations are sent with existing skills and traits as context. The LLM returns skills to create or update. Created skills use the `llm-synthesized` prefix and the split-skill format (SKILL.md + metadata.json + references/).

### Personality Trait Types (illustrative)

The LLM decides trait types during consolidation. This table shows the 10 trait types and the observation types that typically generate them — it is **illustrative, not deterministic**:

| Trait Type | Typically generated from | Description |
|------------|--------------------------|-------------|
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

## MCP Tools

### Observation & Personality Tools

| Tool | Purpose |
|------|---------|
| `ingenium_observe` | Manually store an observation (exceptional cases only) |
| `ingenium_observation_search` | FTS5 search across observations with ranking |
| `ingenium_observation_list` | List observations with filters (type, status, importance) |
| `ingenium_observation_stats` | Get pipeline statistics (pending/processed counts) |
| `ingenium_personality` | Get full personality profile from all traits |
| `ingenium_personality_traits` | List personality traits with filtering |
| `ingenium_extraction_run` | Trigger server-side extraction from OpenCode messages |
| `ingenium_synthesis_run` | Trigger synthesis pipeline manually |
| `ingenium_synthesis_status` | Check pipeline status and stats |
| `ingenium_synthesis_cross_project` | Trigger cross-project synthesis across all projects |

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/extraction/run` | POST | Trigger server-side extraction from OpenCode messages |
| `/api/v1/observations` | GET | List observations with filters |
| `/api/v1/observations` | DELETE | Delete all observations for a source (`?source=X` required) |
| `/api/v1/observations/:id` | DELETE | Delete a single observation by ID |
| `/api/v1/observations/search` | GET | FTS5 search across observations |
| `/api/v1/observations/stats` | GET | Pipeline statistics |
| `/api/v1/personality` | GET | Full personality profile |
| `/api/v1/personality` | DELETE | Delete all personality traits for the project |
| `/api/v1/personality/:id` | DELETE | Delete a single trait by ID |
| `/api/v1/personality/traits` | GET | List personality traits |
| `/api/v1/synthesis/run` | POST | Trigger synthesis pipeline |
| `/api/v1/synthesis/cross-project` | POST | Trigger cross-project synthesis |
| `/api/v1/synthesis/status` | GET | Check pipeline status |

## Dashboard Pages

The Ingenium Dashboard provides visual management for the self-learning system:

- **Observations** (`/observations`) — View, search, and filter observations with FTS5 search + type/status filters.
- **Personality** (`/personality`) — View your agent's learned personality profile with confidence bars. Traits below the 0.30 display threshold can be toggled via the "N hidden" link.
- **Pipeline** (`/pipeline`) — Git-workflow-style timeline of pipeline events (3s poll, filter pills, +N collapse).
- **Learnings** (`/learnings`) — Deprecated; redirects to `/observations`.

## Code Location

| Component | Path |
|-----------|------|
| Extraction engine | `packages/ingenium-core/lib/tools/extraction.ts` |
| Synthesis LLM + trait consolidation | `packages/ingenium-core/lib/tools/synthesis-llm.ts` |
| Core tools (observations, personality, synthesis) | `packages/ingenium-core/lib/tools/observations.ts`, `personality.ts`, `synthesis.ts` |
| Scheduler (extraction → synthesis → skill-sync) | `services/ingenium-api/lib/scheduler.ts` |
| API routes | `services/ingenium-api/lib/routes/extraction.ts`, `observations.ts`, `personality.ts`, `synthesis.ts` |
| MCP server tools | `services/ingenium-server/lib/tools/extraction.ts` (extraction tool) |
| Observer plugin | `packages/ingenium-extension/observer.ts` |
| Auto-observer plugin (thin trigger) | `packages/ingenium-extension/auto-observer.ts` |
| Skill-sync plugin | `packages/ingenium-extension/skill-sync.ts` |
| DB migrations (pipeline events, FK) | `packages/ingenium-core/data/migrations/018_extraction_pipeline_events.sql`, `019_trait_exemplar_fk_setnull.sql` |
| Dashboard pages | `services/ingenium-dashboard/src/app/observations/page.tsx`, `personality/page.tsx`, `pipeline/page.tsx` |

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

## Related Documentation

- [docs/self-learning-pipeline.md](../self-learning-pipeline.md) — Complete pipeline reference (extraction engine, trait consolidation, skill synthesis)
- `.opencode/skills/self-learning/SKILL.md` — Complete skill documentation
- `.opencode/skills/skill-maintenance/SKILL.md` — Skill lifecycle management
