# Self-Learning Pipeline Reference

A comprehensive guide to the Ingenium self-learning pipeline that replaced the old agent self-reporting system.

---

## 1. Overview

The **self-learning pipeline** is a three-phase architecture that enables agents to learn from user interactions and adapt their behavior over time. It replaced the deprecated `ingenium_learning_log` system with a more sophisticated observation-based approach.

### Why It Exists

- **Problem**: The old agent self-reporting system was inconsistent, lacked confidence tracking, and didn't distinguish between different types of user feedback
- **Solution**: A structured pipeline that captures observations, synthesizes them into personality traits, and maintains confidence scores over time

```mermaid
flowchart TB
    subgraph Phase1["Phase 1: Observation"]
        A1[Agent calls ingenium_observe]
        A2[(SQLite observations table + FTS5)]
        A1 -->|POST /api/v1/observations| A2
    end

    subgraph Phase2["Phase 2: Synthesis"]
        direction TB
        B1{Observer Plugin}
        B2{Scheduled 15min Scheduler}
        B3[Heuristic Trait Synthesis]
        B4{LLM Configured?}
        B5[LLM Skill Synthesis]
        B6[(SQLite personality_traits)]
        B7[(SQLite skills)]
        
        B1 -->|session events| B3
        B2 -->|POST /synthesis/run| B3
        B3 -->|upsert traits| B6
        B3 --> B4
        B4 -->|yes| B5
        B4 -->|no| B8[Skip Phase 2]
        B5 -->|create/update skills| B7
        B5 -->|suggest traits| B6
    end

    subgraph Phase3["Phase 3: Personality & Skills"]
        C1[Personality Profile]
        C2[Active Skills]
        C3[Agent Behavior Adjustment]
        C1 --> C3
        C2 --> C3
    end

    subgraph Observability["Cross-Cutting Observability"]
        D1[(SQLite pipeline_events)]
        D2[/pipeline Dashboard/]
        D1 --> D2
    end

    subgraph Sync["Bidirectional Skill Sync"]
        E1{/sync-skills command}
        E2{Scheduled 15min Sync}
        E3[Disk to DB import]
        E4[DB to Disk write]
        E1 --> E3
        E1 --> E4
        E2 --> E3
        E2 --> E4
        E3 --> B7
        B7 --> E4
    end

    Phase1 --> Phase2
    Phase2 --> Phase3
    Phase1 -.->|pipeline events| Observability
    Phase2 -.->|pipeline events| Observability
    Sync -.->|keeps skills in sync| Phase2
```

### Three-Phase Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  PHASE 1: OBSERVATION                                       │
│  - Agents call ingenium_observe() during workflow          │
│  - Observations stored in DB with type, importance, source  │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│  PHASE 2: SYNTHESIS                                         │
│  - Observer plugin triggers pipeline on session events      │
│  - Reads pending observations (ordered by importance)       │
│  - Classifies each observation by type                      │
│  - Upserts personality traits with confidence tracking      │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│  PHASE 3: PERSONALITY                                       │
│  - Aggregated trait profile available via API/MCP tools     │
│  - Confidence scores decay over time                        │
│  - Traits inform agent behavior adjustments                 │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Architecture Diagram

```
User interacts with OpenCode (:4098)
  │
  ├─ Agent uses ingenium_observe() during workflow
  │   → POST /api/v1/observations → stored in DB (status: pending)
  │
  ├─ Observer Plugin (session.created / session.idle)
  │   → imports local file fallbacks if API was down
  │   → triggers POST /api/v1/synthesis/run
  │   → fires pipeline events for dashboard observability
  │
  ├─ Scheduled Scheduler (every 15 min in API server)
  │   → POST /api/v1/synthesis/run for ALL active projects
  │   → POST /api/v1/skills/sync-all (bidirectional disk↔DB)
  │
  └─ Synthesis Pipeline (POST /api/v1/synthesis/run)
      Phase 1 (always): Heuristic Trait Synthesis
      → reads pending observations (ordered by importance DESC)
      → classifies each observation by type
      → upserts personality_traits (with confidence tracking)
      → marks observations as processed
      
      Phase 2 (if LLM configured): LLM Skill Synthesis
      → groups processed observations from current batch
      → sends to LLM with existing skills + traits as context
      → creates/updates skills based on LLM analysis
      → logs errors but doesn't block Phase 1 results
```

### Key Components

| Component | Responsibility |
|-----------|----------------|
| **Agent** | Calls `ingenium_observe()` during workflow to record user interactions |
| **Observer Plugin** | Monitors session events, imports file fallbacks, triggers synthesis |
| **Synthesis Pipeline** | Processes observations, generates/upserts personality traits (Phase 1 heuristic), optionally runs LLM skill synthesis (Phase 2) |
| **API Layer** | REST endpoints for all operations (sole DB authority) |
| **MCP Server** | Tool handlers that forward to API layer |
| **Dashboard** | UI for viewing and managing observations/personality/pipeline events |
| **Database** | SQLite with three core tables (`observations` with FTS5, `personality_traits` with confidence tracking, `pipeline_events` with parent-child nesting) plus `personality_profile` aggregated view |
| **LLM Provider** | (Optional) OpenAI-compatible API for Phase 2 skill synthesis, configured via Settings → Synthesis LLM with model dropdown, API key, and endpoint URL |

---

## 3. Database Tables

### `observations` Table

Stores individual user interactions and feedback.

```sql
CREATE TABLE observations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    observation_type TEXT NOT NULL,  -- One of 10 types
    content TEXT NOT NULL,            -- Human-readable description
    importance INTEGER DEFAULT 5,     -- 1-10 scale
    source TEXT DEFAULT 'agent',      -- Where observation came from
    embedding BLOB,                   -- Placeholder for future vector search
    context JSON,                     -- Additional metadata as JSON
    status TEXT DEFAULT 'pending',    -- pending/processed/skipped/failed
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (project_id) REFERENCES projects(id),
    UNIQUE(project_id, id)
);

CREATE INDEX idx_observations_project_status ON observations(project_id, status);
CREATE INDEX idx_observations_type ON observations(observation_type);
CREATE INDEX idx_observations_importance ON observations(importance DESC);
```

**FTS5 Virtual Table:**
```sql
CREATE VIRTUAL TABLE observations_fts USING fts5(
    content,
    observation_type,
    source,
    context_json,
    content='observations',
    rowid
);

CREATE TRIGGER observations_ai AFTER INSERT ON observations BEGIN
    INSERT INTO observations_fts(rowid, content, observation_type, source, context_json)
    VALUES (new.rowid, new.content, new.observation_type, new.source, json_extract(new.context, '$.json'));
END;

CREATE TRIGGER observations_ad AFTER DELETE ON observations BEGIN
    INSERT INTO observations_fts(observations_fts, rowid) VALUES('delete', old.rowid);
END;

CREATE TRIGGER updates_ai AFTER UPDATE ON observations BEGIN
    INSERT INTO observations_fts(rowid, content, observation_type, source, context_json)
    VALUES (new.rowid, new.content, new.observation_type, new.source, json_extract(new.context, '$.json'));
END;
```

### `personality_traits` Table

Stores synthesized personality traits with confidence scores.

```sql
CREATE TABLE personality_traits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    trait_type TEXT NOT NULL,         -- One of 10 types
    trait_value TEXT NOT NULL,        -- The actual trait value
    display_label TEXT,               -- Human-readable label
    confidence REAL DEFAULT 0.0,      -- 0.0-1.0 confidence score
    exemplar_observation_id INTEGER,  -- ID of observation that created this trait
    exemplar_text TEXT,               -- Text from exemplar observation
    is_active INTEGER DEFAULT 1,       -- 1 = active, 0 = disabled
    metadata JSON,                    -- Additional metadata as JSON
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (project_id) REFERENCES projects(id),
    FOREIGN KEY (exemplar_observation_id) REFERENCES observations(id),
    UNIQUE(project_id, trait_type, is_active)
);

CREATE INDEX idx_personality_traits_project ON personality_traits(project_id);
CREATE INDEX idx_personality_traits_trait ON personality_traits(trait_type);
CREATE INDEX idx_personality_traits_confidence ON personality_traits(confidence DESC);
```

### `personality_profile` View

Aggregated view showing one trait per type with highest confidence.

```sql
CREATE VIEW personality_profile AS
SELECT 
    project_id,
    trait_type,
    trait_value,
    display_label,
    MAX(confidence) as max_confidence,
    AVG(confidence) as avg_confidence,
    COUNT(*) as observation_count,
    MIN(created_at) as first_seen,
    MAX(updated_at) as last_updated,
    GROUP_CONCAT(exemplar_text, '; ') as exemplars
FROM personality_traits
WHERE is_active = 1
GROUP BY project_id, trait_type;
```

---

## 4. Observation Types (Full Reference)

| Type | When to Use | Example Content | Importance Range |
|------|-------------|-----------------|------------------|
| `correction` | User corrects agent behavior or output | "User prefers snake_case over camelCase for variable names" | 7-10 |
| `preference` | User expresses a preference about code style, format, or approach | "User wants 2-space indentation instead of 4" | 5-8 |
| `pattern` | Recurring behavior observed in user workflow | "User always adds JSDoc comments before running tests" | 6-9 |
| `insight` | Novel discovery about the system or environment | "Container PTY works with glibc, enabling better terminal emulation" | 8-10 |
| `feedback` | Implicit accept/reject of agent output | "User accepted the refactored code without changes" | 4-7 |
| `behavior` | User behavior signal that indicates intent or habit | "User runs tests before committing to git" | 5-8 |
| `terminology` | Preferred language or naming convention | "User calls it 'deploy' not 'release'" | 6-9 |
| `workflow` | Workflow sequence or multi-step process | "User runs lint before commit, then tests, then commit" | 7-10 |
| `error` | User encountered an error and how they responded | "User hit TypeScript strict mode error, added type annotations" | 8-10 |
| `goal` | Stated or implied goal the user is working toward | "User wants to improve test coverage from 40% to 80%" | 7-10 |

### Usage Guidelines

**High Importance (8-10):** Critical corrections, errors, goals, insights
- Use when the observation significantly impacts agent behavior
- Examples: User corrects a fundamental misunderstanding, user encounters a blocking error

**Medium Importance (5-7):** Preferences, patterns, feedback
- Use for recurring behaviors and style preferences
- Examples: Code formatting preferences, workflow habits

**Lower Importance (1-4):** Minor observations, implicit signals
- Use sparingly, only when necessary
- Examples: Single instances of user acceptance/rejection

---

## 4.5 Personality Trait System

### Six Trait Dimensions

The personality system tracks 6 developer-specific dimensions:

| Dimension | Source Observations | What It Captures |
|-----------|-------------------|------------------|
| `communication_style` | correction, preference | Whether the user prefers direct, detailed, or concise communication |
| `code_preference` | preference, correction | Code style, formatting, language, and tooling preferences |
| `workflow_pattern` | pattern, workflow | Recurring multi-step processes and sequencing habits |
| `feedback_style` | correction, feedback | Whether corrections are detailed or terse, confirmatory or directive |
| `interaction_pattern` | behavior | How the user interacts with agents (frequent pings, batch commands, etc.) |
| `priority_signal` | error, goal | What the user prioritizes: correctness, performance, speed, completeness |

### Confidence Model

| Parameter | Value | Description |
|-----------|-------|-------------|
| **Starting confidence** | 0.05–0.15 | First observation starts very low |
| **Requirement** | 2+ confirming observations | Must see multiple signals to build confidence |
| **Display threshold** | 0.30 | Traits ≥ 0.30 appear on the dashboard by default |
| **Confidence cap** | 0.95 | Maximum achievable confidence |
| **Decay rate** | -0.05 after 7+ days | Traits unused for a week lose confidence |
| **Dismiss** | Button (×) | User can dismiss any trait from the dashboard |

Traits start at very low confidence and need multiple confirming observations to become display-worthy. Once a trait reaches ≥ 0.30 confidence, it appears on the `/personality` page. Confidence is capped at 0.95 to prevent overcommitment to any single pattern.

### Display & Dismiss Flow

- Traits with confidence ≥ 0.30 appear by default on the personality profile
- Traits below 0.30 are hidden behind a **"N hidden"** toggle link
- Click the **×** button on any trait card to dismiss it (marks `is_active = 0`)
- Dismissed traits can be re-enabled via the API (`/api/v1/personality/:id/enable`)
- Dismissal does not delete the trait — it hides it from the default view

### Observation Quality Rules

Observations must describe **user behavior**, not implementation activity:

**✅ Behavior observations (correct):**
- "User prefers 2-space indentation over 4-space"
- "User corrected the agent's error handling approach"
- "User always runs lint before committing"

**❌ Implementation observations (wrong):**
- "Added sort filters to the dashboard"
- "Implemented global config path resolution"
- "Fixed plugins table UNIQUE constraint"

Implementation activity belongs in pipeline events, git commits, and the `/pipeline` timeline — not in observations. The synthesis pipeline only processes behavior-focused observations into personality traits.

---

## 5. Personality Trait Types (Full Reference)

| Trait Type | Generated From | Confidence Behavior | Display Label Example |
|------------|----------------|---------------------|----------------------|
| `communication_style` | correction, preference | Boosted by repeated observations, decays over time | "Direct and concise" |
| `code_preference` | preference, correction | +0.1 on re-observation, max 1.0 | "Prefers TypeScript strict mode" |
| `workflow_pattern` | pattern, workflow | Starts at 0.4, +0.1 per repeat | "Tests before commit" |
| `terminology` | terminology observations | Starts at 0.5, +0.1 per confirmation | "Uses 'deploy' not 'release'" |
| `priority_signal` | behavior, goal, error | Lower base (0.3), contextual | "High priority: improve test coverage" |
| `feedback_style` | correction, feedback | Starts at 0.5, adjusts with delta | "Provides detailed corrections" |
| `interaction_pattern` | behavior observations | Starts at 0.4 | "Runs tests frequently" |
| `domain_knowledge` | insight observations | Starts at 0.5 | "Understands container networking" |
| `learned_skill` | pattern, workflow | Starts at 0.4, +0.1 per success | "Knows how to debug Docker issues" |
| `personality_trait` | All types | General trait, adjusts slowly | "Patient and thorough" |

### Confidence Calculation Rules

**Base Confidence by Trait Type:**
- `code_preference`: 0.5 (starts higher due to explicit preferences)
- `workflow_pattern`: 0.4 (needs multiple observations)
- `terminology`: 0.5 (clear signal from terminology)
- `priority_signal`: 0.3 (contextual, lower confidence)
- `feedback_style`: 0.5 (moderate confidence)
- `interaction_pattern`: 0.4 (behavioral inference)
- `domain_knowledge`: 0.5 (insight-based)
- `learned_skill`: 0.4 (skill acquisition)
- `communication_style`: 0.3 (subtle, hard to measure)
- `personality_trait`: 0.2 (general, broad inference)

**Confidence Boosting:**
- Repeated observation of same trait: +0.1 per occurrence
- High importance observations: +0.2 bonus
- Multiple sources agreeing: +0.15 bonus
- Time decay: -0.01 per day since last update

**Confidence Decay:**
- Daily decay: -0.01 per day (configurable)
- Inactivity decay: -0.05 after 7 days without new observations
- Manual override: User can disable traits via dashboard

---

## 6. MCP Tools Reference

### Core Observation Tools

| Tool | Action | Input Parameters | Returns |
|------|--------|------------------|---------|
| `ingenium_observe` | Store observation | `observation_type`, `content`, `importance?`, `source?`, `context?` | `{ id, project_id, status }` |
| `ingenium_observation_search` | FTS5 search | `query` (string) | Array of matching observations |
| `ingenium_observation_list` | List with filters | `status?`, `type?`, `project_id?` | Array of observations |
| `ingenium_observation_stats` | Pipeline stats | — | `{ total, pending, processed, by_type }` |
| `ingenium_observation_delete` | Delete observation | `id` | `{ success: boolean }` |

### Email Tools (13 tools)

| Tool | Action | Input Parameters | Returns |
|------|--------|------------------|---------|
| \`ingenium_email_*\` | List, search, read, send, draft, triage, suggest response, auto-draft, IMAP watcher | See individual tool docs | Email-related results and actions |

### Personality Tools

| Tool | Action | Input Parameters | Returns |
|------|--------|------------------|---------|
| `ingenium_personality` | Get profile | — | Aggregated personality profile |
| `ingenium_personality_traits` | List traits | `trait_type?`, `project_id?` | Array of traits |
| `ingenium_personality_trait_disable` | Disable trait | `id` | `{ success: boolean }` |
| `ingenium_personality_trait_enable` | Enable trait | `id` | `{ success: boolean }` |

### Synthesis Pipeline Tools

| Tool | Action | Input Parameters | Returns |
|------|--------|------------------|---------|
| `ingenium_synthesis_run` | Trigger pipeline | — | `{ status, estimated_time }` |
| `ingenium_synthesis_status` | Check status | — | `{ running, completed, failed, progress }` |
| `ingenium_synthesis_cancel` | Cancel running pipeline | — | `{ success: boolean }` |

### Deprecated Tools

All deprecated learning log tools (`ingenium_learning_log`, etc.) have been **removed**. Use `ingenium_observe` instead.

---

## 7. API Endpoints Reference

### Observations Endpoints

| Endpoint | Method | Purpose | Query Parameters |
|----------|--------|---------|------------------|
| `/api/v1/observations` | GET | List observations | `status`, `type`, `project_id`, `limit`, `offset` |
| `/api/v1/observations` | POST | Store observation | Body: `{ observation_type, content, importance?, source?, context? }` |
| `/api/v1/observations/search` | GET | FTS5 search | `q` (query string) |
| `/api/v1/observations/stats` | GET | Pipeline statistics | — |
| `/api/v1/observations/:id` | PATCH | Update observation status | Body: `{ status }` |
| `/api/v1/observations/:id` | DELETE | Delete observation | — |

### Personality Endpoints

| Endpoint | Method | Purpose | Query Parameters |
|----------|--------|---------|------------------|
| `/api/v1/personality` | GET | List traits | `trait_type`, `project_id` |
| `/api/v1/personality` | POST | Upsert trait | Body: `{ trait_type, trait_value, confidence?, display_label? }` |
| `/api/v1/personality/profile` | GET | Get aggregated profile | — |
| `/api/v1/personality/:id/disable` | POST | Disable trait | — |
| `/api/v1/personality/:id/enable` | POST | Enable trait | — |

### Synthesis Endpoints

| Endpoint | Method | Purpose | Query Parameters |
|----------|--------|---------|------------------|
| `/api/v1/synthesis/run` | POST | Trigger pipeline | — |
| `/api/v1/synthesis/status` | GET | Check pipeline status | — |
| `/api/v1/synthesis/cancel` | POST | Cancel running pipeline | — |

### Example Requests

**Create Observation:**
```bash
curl -X POST http://localhost:4097/api/v1/observations \
  -H "Content-Type: application/json" \
  -d '{
    "observation_type": "preference",
    "content": "User prefers 2-space indentation",
    "importance": 6,
    "source": "agent"
  }'
```

**Search Observations:**
```bash
curl "http://localhost:4097/api/v1/observations/search?q=indentation"
```

**Get Personality Profile:**
```bash
curl http://localhost:4097/api/v1/personality/profile
```

---

## 8. Pipeline Observability

Every step of the self-learning pipeline is tracked as `pipeline_events` and displayed in a **visual Git-workflow-style timeline** at **`/pipeline`** in the dashboard. This replaces `console.log()` debugging with a structured, filterable, live-updating view.

### Event Types (12)

| Event | Source | Meaning |
|-------|--------|---------|
| `session_created` | plugin | OpenCode session started |
| `session_idle` | plugin | Session went idle |
| `observation_created` | agent | Agent called `ingenium_observe` |
| `observation_imported` | plugin | File fallback imported into DB |
| `synthesis_triggered` | plugin | Observer triggered synthesis |
| `synthesis_started` | synthesis | Pipeline began processing |
| `synthesis_completed` | synthesis | Pipeline finished successfully |
| `synthesis_failed` | synthesis | Pipeline errored out |
| `trait_created` | synthesis | New personality trait generated |
| `trait_updated` | synthesis | Existing trait confidence adjusted |
| `plugin_initialized` | plugin | Observer plugin loaded |
| `plugin_error` | plugin | Plugin encountered an error |

### Timeline Visual

The `/pipeline` dashboard page displays events as a connected vertical timeline:

- 🟠 **Orange dots** = agent events (`observation_created`)
- 🔵 **Blue dots** = plugin events (`session_created`, `observation_imported`, `synthesis_triggered`)
- 🟢 **Green diamonds** = synthesis events (`synthesis_started`, `synthesis_completed`, `synthesis_failed`)
- 🟣 **Purple chevrons** = trait events (`trait_created`, `trait_updated`)
- Connected with vertical lines showing event flow
- Observations in the same 60-second window are collapsed into **+N groups**
- Polls every **3 seconds** for live updates (pause/resume button)
- Filter pills: All, Agent, Plugin, Synthesis, Trait
- Click any event card for a **detail overlay** with raw JSON data

### DB Table: `pipeline_events`

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER | Primary key |
| `project_id` | TEXT | FK to projects |
| `event_type` | TEXT | 12 event types (see above) |
| `event_source` | TEXT | agent/plugin/synthesis/system |
| `title` | TEXT | Short human-readable title |
| `description` | TEXT | Optional longer description |
| `data` | TEXT | JSON payload with event-specific data |
| `parent_event_id` | INTEGER | Link to parent event (e.g., trait → synthesis run) |
| `session_id` | TEXT | OpenCode session where event happened |
| `importance` | INTEGER | 1–10 |
| `created_at` | TEXT | ISO 8601 timestamp |

### API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/v1/pipeline/events` | GET | List events (filters: `source`, `type`, `since`, `limit`) |
| `/api/v1/pipeline/events` | POST | Log a new event (used by plugin + core) |
| `/api/v1/pipeline/timeline` | GET | Get timeline with children nested under parents |

### Who Fires What

| Where | Event(s) emitted |
|-------|-----------------|
| `observations.ts` — `storeObservation()` | `observation_created` |
| `synthesis.ts` — `runSynthesis()` | `synthesis_started`, `trait_created`, `trait_updated`, `synthesis_completed`, `synthesis_failed` |
| `observer.ts` — `session.created` handler | `session_created` |
| `observer-core.ts` — `importObservationsFromFile()` | `observation_imported` |
| `observer-core.ts` — `triggerSynthesis()` | `synthesis_triggered` |
| **API Server** (scheduled) | Auto-triggers synthesis + skill sync every 15 minutes for ALL active projects |

### Scheduled Synthesis

The API server automatically triggers the synthesis pipeline every **15 minutes** (configurable via `SYNTHESIS_INTERVAL_MS` environment variable, default: 900000ms). This ensures observations are processed without requiring manual intervention.

**Configuration:**
```typescript
// services/ingenium-api/scripts/api-server.ts
const SYNTHESIS_INTERVAL_MS = parseInt(process.env.SYNTHESIS_INTERVAL_MS ?? "900000", 10);
```

**Manual override:** Set `SYNTHESIS_INTERVAL_MS=0` to disable auto-synthesis.

### Skill Sync (`/sync-skills`)

The `/sync-skills` command triggers bidirectional skill synchronization between disk and DB:

**Disk → DB**: Any skill files created or edited manually in `.opencode/skills/` are imported into the DB. This is useful when agents create skill files directly on disk.

**DB → Disk**: All DB skills are written to `.opencode/skills/` so OpenCode can load them. This is how LLM-synthesized skills become available to agents.

**Scheduled sync**: The API server automatically runs `/api/v1/skills/sync-all` every 15 minutes (as part of the scheduled synthesis cycle) for ALL active projects.

**Manual trigger**: Use `/sync-skills` in OpenCode to sync immediately.

**Related files:**
| File | Purpose |
|------|---------|
| `.opencode/commands/sync-skills.md` | Command definition |
| `services/ingenium-api/lib/routes/skills.ts` | `POST /sync-all` endpoint with two-phase sync |

### Dashboard Page

- **URL**: `/pipeline` in the Ingenium Dashboard
- **Nav link**: "Pipeline" in the top navigation bar
- **Live updates**: Auto-polls every 3 seconds with pause/resume
- **Filtering**: Source pills (All/Agent/Plugin/Synthesis/Trait)
- **Collapsing**: Rapid observations grouped into +N cards (same 60s window)
- **Detail**: Click any event to see full metadata + raw JSON

### Files Reference

| File | Purpose |
|------|---------|
| `packages/ingenium-core/data/migrations/009_pipeline_events.sql` | DB migration |
| `packages/ingenium-core/lib/tools/pipeline-events.ts` | Core tools (`logEvent`, `getEvents`, `getTimeline`) |
| `packages/ingenium-core/lib/schema.ts` | `PipelineEventSchema` Zod type |
| `services/ingenium-api/lib/routes/pipeline.ts` | API routes |
| `.opencode/plugins/observer-core.ts` | Plugin fires session/import/trigger events |
| `.opencode/plugins/observer.ts` | Plugin fires `session_created` on start + registers `synthesize_observations` tool |
| `services/ingenium-dashboard/src/app/pipeline/page.tsx` | Timeline dashboard page (3s poll, filters, +N collapse) |
| `services/ingenium-dashboard/src/lib/api.ts` | `api.pipeline.events()` and `.timeline()` |

---

## 9. How to Use

### For Agents (Automatic, During Workflow)

Agents should call `ingenium_observe()` whenever they detect meaningful user interactions:

```typescript
// Example: Agent detects user preference during workflow
await ingenium_observe({
  observation_type: "preference",
  content: "User prefers concise error messages with action items",
  importance: 7,
  source: "agent"
});

// Example: User corrects agent behavior
await ingenium_observe({
  observation_type: "correction",
  content: "User corrected the file path format from absolute to relative",
  importance: 9,
  source: "user_feedback"
});

// Example: User encounters error
await ingenium_observe({
  observation_type: "error",
  content: "User hit TypeScript strict mode error on undefined variable",
  importance: 8,
  source: "agent"
});
```

### For Orchestrators (Manual Triggers)

**Trigger Synthesis Pipeline:**
1. Run `/synthesize` command in OpenCode
2. Check status: `ingenium_synthesis_status`
3. View results: `ingenium_personality`

**Example Workflow:**
```bash
# After a long session of user interactions
/observe  # Trigger immediate synthesis
/synthesis-status  # Check if pipeline is running
/personality  # View updated traits
```

### For Dashboard Users

**View Observations:**
- Go to `/observations` page
- Filter by type, status, importance
- Search using FTS5 query box
- Edit observation status (pending → processed)

**View Personality:**
- Go to `/personality` page
- See all active traits with confidence bars
- Disable/enable individual traits
- View exemplar observations for each trait

**Legacy Pages:**
- Old `/learnings` page has been removed — use `/observations` instead

---

## LLM-Driven Skill Synthesis

The synthesis pipeline can optionally use an LLM to analyze observations and auto-create or update skill files. This transforms the pipeline from trait-only to full skill generation.

### How to Configure

1. Go to **Settings → Synthesis LLM** in the dashboard
2. Select a model from the dropdown (populated from OpenCode's configured providers)
3. Enter the API key for the provider
4. Click "Test Connection" to verify
5. Click "Save"

### How It Works

When configured, the 15-minute synthesis pipeline runs two phases:

**Phase 1: Trait Synthesis** (always runs, heuristic)
- Classifies observations into personality traits
- Creates/updates traits with confidence tracking
- (This is the original behavior)

**Phase 2: LLM Skill Synthesis** (only if model configured)
- Groups processed observations from the current batch
- Sends them along with existing skills and traits to the LLM
- LLM analyzes patterns and returns structured JSON
- Pipeline executes skill create/update operations
- Results appear on the `/pipeline` timeline

### Implementation Details

#### SynthesisLLMResult Interface

The LLM must return JSON matching this shape:

```typescript
interface SynthesisLLMResult {
  skills_to_create: Array<{
    name: string;        // kebab-case, max 64 chars
    description: string; // one-line, max 200 chars
    content: string;     // full SKILL.md markdown
  }>;
  skills_to_update: Array<{
    name: string;
    patch: string;       // markdown to append
    patch_type: "add-rule" | "update-section" | "add-pattern";
  }>;
  personality_traits?: Array<{
    trait_type: string;
    trait_value: string;
    confidence: number;  // 0.0–1.0
  }>;
  insights: string[];    // max 5 insights
  summary: string;       // max 200 chars
}
```

#### LLM Prompt Structure

The prompt sent to the LLM includes four sections:

1. **Existing Skills** — All current skills (name + description) to prevent duplicate creation
2. **Existing Personality Traits** — Current traits with confidence percentages for context
3. **Recent Pending Observations** — Each observation with type, importance, and content (truncated to 200 chars)
4. **Task Instructions** — Guidelines to:
   - Create new skills for uncovered patterns
   - Extend existing skills for reinforced patterns
   - Suggest personality traits for new observations
   - Output ONLY valid JSON (no markdown, no code blocks)

The LLM uses `temperature: 0.3` and `max_tokens: 4096` for consistent structured output.

#### API Call Strategy (Retry/Fallback)

The LLM client uses a two-attempt strategy:

1. **Primary attempt**: Calls with `response_format: { type: "json_object" }` (supported by OpenAI-compatible APIs)
2. **Fallback attempt**: If the primary returns an error (e.g., the provider doesn't support structured output), retries **without** `response_format`, sending the same prompt with an explicit "Respond ONLY with valid JSON" system message
3. If both attempts fail, returns an empty result with the error summary — Phase 1 trait results are still saved

#### Multi-Strategy JSON Parsing

The `tryParseJSON()` function uses three strategies in order:

1. **Direct parse**: Attempts `JSON.parse()` on raw response text
2. **Strip markdown**: Removes ```json and ``` fences, then parses
3. **Regex extraction**: Uses `/\{[\s\S]*\}/` to find the first JSON object in the text, then parses it

This ensures the LLM's output is parsed correctly even if it wraps JSON in markdown code blocks.

#### Response Validation (`validateResponse`)

The response is strictly validated before any operations are performed:

| Field | Cap | Sanitization |
|-------|-----|-------------|
| `skills_to_create` | Max 5 | Name: kebab-case, ≤64 chars. Description: ≤200 chars. Filter: requires both name AND content |
| `skills_to_update` | Max 5 | Name: required. Patch: required. patch_type defaults to "add-rule" |
| `personality_traits` | Max 3 | Confidence clamped to [0, 1], default 0.3 |
| `insights` | Max 5 | Strings only, no length limit |

#### Skill Execution

After validation, the synthesis orchestrator executes the LLM's recommendations:

- **Skill Creation**: Calls `skills.createSkill()` with category "learning", tags "llm-synthesized,auto-generated", always_apply=1
- **Skill Updates**: Appends the patch content to the existing skill's content and calls `skills.updateSkill()`
- **Logging**: Each create/update fires a pipeline event (`trait_created` / `trait_updated`) with `via_llm: true` metadata, linked to the parent synthesis event
- **Error handling**: Failed operations are collected in `result.errors` but don't block the rest

#### Configuration Check

Two utility functions control Phase 2 execution:

| Function | Purpose |
|----------|---------|
| `isLLMSynthesisConfigured(projectId)` | Returns `true` if `synthesis_model` setting exists |
| `getLLMSynthesisConfig(projectId)` | Returns `{ model, apiKey }` or `null` if not configured |

### Fallback Behavior

| Scenario | Behavior |
|----------|----------|
| LLM not configured (no model set) | Pipeline skips Phase 2 entirely |
| LLM API error (network, timeout, bad key) | Error logged in `result.errors`, Phase 1 trait results still saved |
| LLM returns invalid/empty JSON | Returns empty result, no skills created/updated |
| LLM synthesis cancelled (AbortSignal) | Returns cancelled summary, no side effects |

### Settings Reference

| Setting Key | Description | Values |
|------------|-------------|--------|
| `synthesis_model` | LLM model ID | e.g. `xai/grok-4`, `deepseek/deepseek-v4-flash` |
| `synthesis_api_key` | API key for the provider | sk-... |
| `synthesis_endpoint` | OpenAI-compatible API URL | https://api.deepseek.com/v1 |

### Files Reference

| File | Purpose |
|------|---------|
| `packages/ingenium-core/lib/tools/synthesis-llm.ts` | LLM client: `SynthesisLLMResult` interface, `buildPrompt()`, `callSynthesisLLM()`, `validateResponse()`, `tryParseJSON()`, `isLLMSynthesisConfigured()`, `getLLMSynthesisConfig()` |
| `packages/ingenium-core/lib/tools/synthesis.ts` | Synthesis orchestrator: `runSynthesis()` (Phase 1: heuristic traits, Phase 2: LLM skills), `getSynthesisStatus()` |
| `services/ingenium-dashboard/src/app/settings/page.tsx` | Settings UI: provider-based model dropdown, API key input, Test Connection, Save |

---

## 10. Synthesis Pipeline Details

### Processing Flow

```
1. Trigger: Observer plugin fires on session.created or session.idle
2. Import Fallbacks: Read .opencode/skills/learnings.md if API was down
3. Fetch Pending: SELECT * FROM observations WHERE status = 'pending' ORDER BY importance DESC
4. Process Each Observation:
    a. Classify by observation_type
    b. Determine target trait_type using mapping rules
    c. Calculate confidence score
    d. Upsert personality_trait record
5. Mark Processed: UPDATE observations SET status = 'processed' WHERE id IN (...)
6. Update Profile: Refresh personality_profile view
```

### Trait Mapping Rules

| Observation Type | Target Trait Type | Base Confidence | Notes |
|------------------|-------------------|-----------------|-------|
| `correction` | `feedback_style` | 0.5 | Adjusts with delta from previous value |
| `preference` | `code_preference` | 0.5 | +0.1 on re-observation, max 1.0 |
| `pattern` | `workflow_pattern` | 0.4 | +0.1 per repeat observation |
| `insight` | `domain_knowledge` | 0.5 | High confidence for novel discoveries |
| `feedback` | `feedback_style` | 0.5 | Boosts confidence on matching traits |
| `behavior` | `interaction_pattern` | 0.4 | Behavioral inference |
| `terminology` | `terminology` | 0.5 | +0.1 per confirmation |
| `workflow` | `workflow_pattern` | 0.4 | Multi-step process recognition |
| `error` | `priority_signal` | 0.3 | Lower base, contextual |
| `goal` | `priority_signal` | 0.3 | Stated goals have lower confidence |

### Confidence Calculation Formula

```typescript
function calculateConfidence(observation: Observation, existingTrait?: Trait): number {
  let confidence = BASE_CONFIDENCE[observation.type];
  
  // Boost for repeated observations
  if (existingTrait) {
    const repeatCount = getRepeatCount(existingTrait);
    confidence += Math.min(0.3, repeatCount * 0.1);
  }
  
  // Boost for high importance
  if (observation.importance >= 8) {
    confidence += 0.2;
  }
  
  // Boost for multiple sources
  const sources = getSourcesForTrait(observation.type);
  if (sources.length > 1) {
    confidence += 0.15;
  }
  
  // Cap at 1.0
  return Math.min(1.0, Math.max(0.0, confidence));
}
```

### Time Decay Implementation

```typescript
function applyTimeDecay(trait: Trait): number {
  const daysSinceUpdate = (new Date().getTime() - trait.updated_at) / (1000 * 60 * 60 * 24);
  
  // Daily decay
  let decayed = trait.confidence - (daysSinceUpdate * 0.01);
  
  // Inactivity decay (after 7 days)
  if (daysSinceUpdate > 7) {
    decayed -= (daysSinceUpdate - 7) * 0.05;
  }
  
  return Math.max(0.0, decayed);
}
```

---

## 11. Files Reference

### Core Library Files

| File | Purpose | Location |
|------|---------|----------|
| `lib/tools/observations.ts` | Core observation DB operations (CRUD, FTS5) | `packages/ingenium-core/lib/tools/` |
| `lib/tools/personality.ts` | Core personality trait operations (upsert, profile) | `packages/ingenium-core/lib/tools/` |
| `lib/tools/synthesis.ts` | Synthesis pipeline orchestrator (`runSynthesis`, `getSynthesisStatus`) | `packages/ingenium-core/lib/tools/` |
| `lib/tools/synthesis-llm.ts` | LLM synthesis client (`callSynthesisLLM`, prompt builder, validator, `tryParseJSON`, config checks) | `packages/ingenium-core/lib/tools/` |
| `lib/tools/pipeline-events.ts` | Pipeline event logging (`logEvent`, `getEvents`, `getTimeline`) | `packages/ingenium-core/lib/tools/` |
| `lib/schema.ts` | Zod schemas: `ObservationSchema`, `PersonalityTraitSchema`, `PipelineEventSchema` | `packages/ingenium-core/lib/` |

### API Layer Files

| File | Purpose | Location |
|------|---------|----------|
| `lib/routes/observations.ts` | REST endpoints for observations | `services/ingenium-api/lib/routes/` |
| `lib/routes/personality.ts` | REST endpoints for personality | `services/ingenium-api/lib/routes/` |
| `lib/routes/synthesis.ts` | REST endpoints for synthesis pipeline | `services/ingenium-api/lib/routes/` |
| `lib/routes/pipeline.ts` | REST endpoints for pipeline events (timeline, filtering) | `services/ingenium-api/lib/routes/` |
| `lib/middleware/auth.ts` | Authentication middleware for protected routes | `services/ingenium-api/lib/middleware/` |
| `scripts/api-server.ts` | API server with scheduled synthesis + skill sync every 15 min | `services/ingenium-api/scripts/` |

### MCP Server Files

| File | Purpose | Location |
|------|---------|----------|
| `lib/tools/observations.ts` | MCP tool handlers for observations | `services/ingenium-server/lib/tools/` |
| `lib/tools/personality.ts` | MCP tool handlers for personality | `services/ingenium-server/lib/tools/` |
| `lib/tools/synthesis.ts` | MCP tool handlers for synthesis pipeline | `services/ingenium-server/lib/tools/` |
| `lib/handlers/observationHandlers.ts` | Request handlers for observation endpoints | `services/ingenium-server/lib/handlers/` |
| `scripts/mcp-server.ts` | MCP tool registration (registers all 10+ tools) | `services/ingenium-server/scripts/` |

### Plugin Files

| File | Purpose | Location |
|------|---------|----------|
| `.opencode/plugins/observer.ts` | OpenCode observer plugin: session events, `synthesize_observations` tool registration | `.opencode/plugins/` |
| `.opencode/plugins/observer-core.ts` | Plugin core: `importObservationsFromFile()`, `triggerSynthesis()`, `logPipelineEvent()` | `.opencode/plugins/` |

### Command Files

| File | Purpose | Location |
|------|---------|----------|
| `.opencode/commands/synthesize.md` | `/synthesize` command — trigger synthesis pipeline manually | `.opencode/commands/` |
| `.opencode/commands/sync-skills.md` | `/sync-skills` command — bidirectional disk↔DB skill sync | `.opencode/commands/` |

### Skill Files

| File | Purpose | Location |
|------|---------|----------|
| `.opencode/skills/self-learning/SKILL.md` | Self-learning pipeline skill (alwaysApply) | `.opencode/skills/self-learning/` |

### Dashboard Files

| File | Purpose | Location |
|------|---------|----------|
| `src/app/observations/page.tsx` | Observations listing page with type/status filters | `services/ingenium-dashboard/src/app/` |
| `src/app/personality/page.tsx` | Personality traits display with confidence bars | `services/ingenium-dashboard/src/app/` |
| `src/app/pipeline/page.tsx` | Git-workflow-style timeline (3s poll, filters, +N collapse) | `services/ingenium-dashboard/src/app/` |
| `src/app/settings/page.tsx` | Settings page with Synthesis LLM provider dropdown | `services/ingenium-dashboard/src/app/` |
| `src/components/ObservationList.tsx` | Reusable observation list component | `services/ingenium-dashboard/src/components/` |
| `src/components/PersonalityProfile.tsx` | Personality profile visualization | `services/ingenium-dashboard/src/components/` |
| `src/lib/api.ts` | API client with `api.observations`, `api.personality`, `api.synthesis`, `api.pipeline` | `services/ingenium-dashboard/src/lib/` |

### Database Migrations

| File | Purpose | Location |
|------|---------|----------|
| `data/migrations/007_observations.sql` | Create observations table with FTS5 | `packages/ingenium-core/data/migrations/` |
| `data/migrations/008_personality_traits.sql` | Create personality traits table and profile view | `packages/ingenium-core/data/migrations/` |
| `data/migrations/009_pipeline_events.sql` | Create pipeline events table | `packages/ingenium-core/data/migrations/` |

### Test Files

| File | Purpose | Location |
|------|---------|----------|
| `tests/observations.test.ts` | Tests for observation CRUD and FTS5 search | `packages/ingenium-core/tests/` |
| `tests/personality.test.ts` | Tests for personality trait upsert and profile | `packages/ingenium-core/tests/` |
| `tests/synthesis.test.ts` | Tests for synthesis pipeline (heuristic classification) | `packages/ingenium-core/tests/` |
| `tests/synthesis-llm.test.ts` | Tests for LLM synthesis client (prompt, validation, retry) | `packages/ingenium-core/tests/` |
| `tests/pipeline-events.test.ts` | Tests for pipeline event logging and timeline | `packages/ingenium-core/tests/` |
| `tests/ingenium-dashboard/pipeline.spec.ts` | Playwright E2E test for pipeline timeline page | `tests/ingenium-dashboard/` |

### Documentation Files

| File | Purpose | Location |
|------|---------|----------|
| `self-learning-pipeline.md` | Comprehensive reference (this document) | `docs/` |
| `.opencode/skills/self-learning/SKILL.md` | Always-applied skill with quick-reference tables | `.opencode/skills/self-learning/` |
| `docs/HOW-TO/self-learning.md` | HOW-TO guide for using the pipeline | `docs/HOW-TO/` |

---

## 12. Deprecation Notes

### Removed Tools

**`ingenium_learning_log`**
- **Status**: Removed
- **Migration Path**: Use `ingenium_observe` instead

### Removed Pages

**`/learnings` Dashboard Page**
- **Status**: Removed — redirects to `/observations`
- **Migration**: Update bookmarks to use `/observations`

### Deprecated Commands

**`process-learnings`**
- **Status**: Removed
- **Migration Path**: Use `/synthesize` command instead

### Replaced Components

The old `learnings` plugin and `detectSkillGap.ts` have been fully replaced by the `observer` plugin.
The observer plugin provides better session event handling, fallback imports from both `learnings.md` and `observations.md`, and direct synthesis pipeline integration.

Both old components have been **removed** — no migration needed.

### File Migration

**`.opencode/skills/learnings.md` & `.opencode/skills/observations.md`**
- **Status**: Both files are read for fallback imports
- **Behavior**: The observer plugin reads both files if API was down: `observations.md` for direct observation data, `learnings.md` for legacy data
- **Future**: `learnings.md` will be deprecated when all agents migrate to `ingenium_observe`

---

## Quick Reference

### Common Observation Types

```typescript
// User corrects agent behavior
await ingenium_observe({
  observation_type: "correction",
  content: "User prefers snake_case over camelCase",
  importance: 8
});

// User expresses preference
await ingenium_observe({
  observation_type: "preference",
  content: "User wants 2-space indentation",
  importance: 6
});

// User encounters error
await ingenium_observe({
  observation_type: "error",
  content: "User hit TypeScript strict mode error",
  importance: 9
});

// User has a goal
await ingenium_observe({
  observation_type: "goal",
  content: "User wants to improve test coverage from 40% to 80%",
  importance: 7
});
```

### Common MCP Tool Calls

```typescript
// Store observation
await ingenium_observe({
  observation_type: "preference",
  content: "User prefers concise error messages",
  importance: 7
});

// Search observations
const results = await ingenium_observation_search("indentation");

// Get personality profile
const profile = await ingenium_personality();

// Check pipeline status
const status = await ingenium_synthesis_status();
const stats = await ingenium_observation_stats();
```

### Pipeline Dashboard

- **URL**: `/pipeline` in the Ingenium Dashboard
- **What it shows**: Live Git-workflow-style timeline of all pipeline events
- **Filters**: All / Agent / Plugin / Synthesis / Trait
- **Refresh**: Auto-polls every 3 seconds (pause/resume button)
- **Collapsing**: Rapid observations grouped into +N cards
- **Detail**: Click any event for full metadata + raw JSON

### Commands

| Command | Purpose |
|---------|---------|
| `/synthesize` | Trigger synthesis pipeline manually |
| `/sync-skills` | Bidirectional disk↔DB skill sync |

### Orchestrator Quick Reference

```typescript
// Trigger synthesis
await ingenium_synthesis_run();

// Check synthesis status
const status = await ingenium_synthesis_status();

// Get pipeline stats
const stats = await ingenium_observation_stats();
```

### API Quick Calls

```bash
# Create observation
curl -X POST http://localhost:4097/api/v1/observations \
  -H "Content-Type: application/json" \
  -d '{"observation_type":"preference","content":"User prefers 2-space indent"}'

# Search observations
curl "http://localhost:4097/api/v1/observations/search?q=indentation"

# Get personality profile
curl http://localhost:4097/api/v1/personality/profile

# Trigger synthesis
curl -X POST http://localhost:4097/api/v1/synthesis/run

# Get synthesis status
curl http://localhost:4097/api/v1/synthesis/status

# Get pipeline timeline
curl http://localhost:4097/api/v1/pipeline/timeline

# List pipeline events (filtered)
curl "http://localhost:4097/api/v1/pipeline/events?source=synthesis&limit=20"

# Bidirectional skill sync
curl -X POST http://localhost:4097/api/v1/skills/sync-all?project=gh-llm-bootstrap
```

---

## Troubleshooting

### Observations Not Being Processed

**Symptom**: Observations stuck in `pending` status indefinitely

**Causes:**
- Observer plugin not running
- API endpoint unreachable
- Session events not firing

**Solutions:**
1. Check observer plugin is enabled: `docker compose logs ingenium | grep observer`
2. Manually trigger synthesis: `/synthesize` command
3. Check API health: `curl http://localhost:4097/api/v1/health`
4. Verify session events in OpenCode logs

### Confidence Scores Too Low

**Symptom**: Personality traits have very low confidence (< 0.3)

**Causes:**
- Single observations without repetition
- Time decay has reduced scores
- Low importance observations

**Solutions:**
1. Provide more observations of the same type
2. Increase importance scores for critical observations
3. Manually boost confidence via dashboard (if available)
4. Wait for time decay to stabilize

### FTS5 Search Not Working

**Symptom**: `ingenium_observation_search` returns empty results

**Causes:**
- FTS5 virtual table not created
- Trigger functions not firing
- Content field too short

**Solutions:**
1. Run database migration: `npm run migrate`
2. Check FTS5 table exists: `.opencode/skills/learnings.md` should have content
3. Verify triggers are active in SQLite
4. Increase observation content length

### Synthesis Pipeline Hanging

**Symptom**: `/synthesize` command appears to hang indefinitely

**Causes:**
- Large number of pending observations
- API timeout
- Database lock contention

**Solutions:**
1. Check pending count: `ingenium_observation_stats`
2. Increase API timeout: `INGENIUM_API_TIMEOUT=30000`
3. Process in batches if > 1000 observations
4. Cancel and retry: `/synthesis-cancel` then `/synthesize`

### LLM Synthesis Not Running

**Symptom**: Phase 2 (LLM skill synthesis) never runs; no skills created

**Causes:**
- No LLM provider configured in Settings
- API key is invalid or expired
- Provider endpoint not set correctly
- LLM API returned errors

**Solutions:**
1. Go to **Settings → Synthesis LLM** and verify the model is selected
2. Click "Test Connection" to verify the provider works
3. Check `/pipeline` timeline for `synthesis_completed` events with error details
4. Check API server logs: `docker compose logs ingenium | grep "LLM"`
5. Verify the provider supports `response_format: json_object` (some providers need the fallback)
6. Manually trigger with `/synthesize` and watch the pipeline timeline

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-01-15 | Initial release, replaced learning system |
| 1.1.0 | 2026-02-20 | Added FTS5 search, time decay |
| 1.2.0 | 2026-03-10 | Added personality profile view |
| 1.3.0 | 2026-04-05 | Added observer plugin fallback imports |
| 2.0.0 | 2026-07-10 | Added pipeline observability: `pipeline_events` table, `/pipeline` timeline dashboard, event logging from all pipeline stages |
| 2.1.0 | 2026-07-10 | Added LLM-driven skill synthesis configurable in Settings |
| 2.2.0 | 2026-07-10 | Added `/sync-skills` command, `self-learning` skill, `docs/HOW-TO/self-learning.md`, expanded LLM synthesis docs (`SynthesisLLMResult`, retry logic, `tryParseJSON`, validation), scheduled skill sync in API server, comprehensive Files Reference |
| 2.3.0 | 2026-07-10 | Removed deprecated `/learnings` page and `ingenium_learning_log` tools. Added local-persistence skill for DB→disk sync. `docs/self-learning-pipeline.md` moved from root. |

---

*Last updated: July 10, 2026 (v2.3.0 — removed `/learnings` and deprecated tools, updated docs references)*
