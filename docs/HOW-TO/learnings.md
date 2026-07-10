# HOW-TO: Learnings

> 🔴 **DEPRECATED** — This documentation is for the old learnings system. The new self-learning pipeline uses observations (see [docs/HOW-TO/self-learning.md](./self-learning.md)). The `ingenium_learning_log` tool still works but forwards to both old and new pipelines.

## What It Does
Logs and searches learning entries across AI agent sessions. Learnings are FTS5-indexed for full-text search. Each entry has a type (pattern, decision, bug, preference, research) and optional tags. An automated pipeline processes learnings into skill file updates.

**Migration:** Use `ingenium_observe` instead of `ingenium_learning_log`. See [docs/HOW-TO/self-learning.md](./self-learning.md) for the new system.

## entry_type Reference

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

## Learnings Pipeline

The system includes an automated learnings pipeline:

1. **OpenCode Plugin** (`.opencode/plugins/learnings.ts` + `learnings-core.ts`) — reads pending learnings from the Ingenium API
2. **Classification** — Each entry is classified: `add-pattern` (new convention to extract), `update-rule` (existing skill needs refinement), or `noop` (no action needed)
3. **Action** — Edits skill files to reflect the learning, then marks the entry as processed in the DB
4. **MCP tool**: `process_learnings` — processes all unprocessed entries, returns a JSON summary

### File Fallback

If the API is down, agents append learning entries to `.opencode/skills/learnings.md`. On the next session start, `importLearningsFromFile()` syncs file entries into the DB, marking them as processed. This ensures no learning is lost even during API outages.

### Skill Gap Detection

Every `POST /learnings` with `entry_type ≠ "skill"` and `priority ≥ 5` triggers fire-and-forget detection:
1. Keywords are extracted from the learning content
2. FTS5 searches existing skills for keyword overlap
3. If uncovered (fewer than 2 keyword matches), a task is created for an AI engineer to write a new skill
4. Manual batch scan: `ingenium_skill_from_learnings` MCP tool processes the last 20 learnings

## How to Use
1. Navigate to `/learnings` from the dashboard nav bar
2. Select a learning type from the dropdown (Pattern, Decision, Bug, Preference, Research)
3. Type the learning content in the textarea
4. Click **Log Learning** to save it
5. Entries appear below with color-coded type badges and timestamps

### MCP Tools

| Tool | Purpose | Status |
|------|---------|--------|
| `ingenium_learning_log` | Log a new learning entry (deprecated, forwards to both old and new pipelines) | Deprecated |
| `ingenium_learning_search` | Full-text search across learning entries | Deprecated |
| `ingenium_learning_list` | List learning entries | Deprecated |
| `ingenium_skill_from_learnings` | Scan recent learnings for skill gaps, create tasks for missing skills | Deprecated |
| `process_learnings` | Process unprocessed learning entries into skill file updates | Deprecated |

**Use these instead:**
- `ingenium_observe` — Log observations (new system)
- `ingenium_observation_search` — Search observations
- `ingenium_synthesis_run` — Trigger synthesis pipeline

## API Endpoints (Deprecated)
- `GET /api/v1/learnings?project=<name>` — recent learnings (deprecated)
- `POST /api/v1/learnings?project=<name>` — log new entry (deprecated)
- `GET /api/v1/learnings/search?project=<name>&q=<query>` — FTS5 search (deprecated)

**Use these instead:**
- `GET /api/v1/observations` — List observations
- `POST /api/v1/observations` — Log new observation
- `GET /api/v1/observations/search` — FTS5 search observations

## Code Location (Deprecated)
- Plugin: `.opencode/plugins/learnings.ts` and `learnings-core.ts` (deprecated, use observer.ts)
- Page: `services/ingenium-dashboard/src/app/learnings/page.tsx` (deprecated, use observations/page.tsx)
- API client: `services/ingenium-dashboard/src/lib/api.ts` → `api.learnings` (deprecated)
- Route: `services/ingenium-api/lib/routes/learnings.ts` (deprecated)
- Core: `packages/ingenium-core/lib/tools/learnings.ts` and `detectSkillGap.ts` (deprecated)

## Related Docs
- STYLING-GUIDE.md — form and badge styling (deprecated)
- docs/CONVENTIONS.md — learning→skill auto-detection rules (deprecated, use observation rules)
- docs/ARCHITECTURE.md — learning system architecture (deprecated, use self-learning pipeline)
- [docs/HOW-TO/self-learning.md](./self-learning.md) — New self-learning documentation
