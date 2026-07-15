# HOW-TO: Synthesis Pipeline

## What It Does

The synthesis pipeline processes observations into personality traits (Phase 1) and optionally creates/updates skills via an LLM (Phase 2). It runs automatically every 15 minutes (configurable) and can be triggered manually.

## Configuring an LLM Provider

To enable Phase 2 (LLM-driven skill synthesis):

1. **Navigate to Settings → Synthesis LLM** in the dashboard (`/settings`)
2. Select an LLM provider from the dropdown — providers are populated from OpenCode's configured providers
3. Select a model from the provider's available models
4. Enter the API key for the provider
5. Click **Test Connection** to verify the provider works
6. Click **Save** to persist

### Custom Provider

If your provider isn't listed:
1. Select "**— Custom Provider —**" from the provider dropdown
2. Enter the **Base URL** (OpenAI-compatible API endpoint, e.g., `https://api.myprovider.com/v1`)
3. Enter the **Model ID** (e.g., `my-model-name`)
4. Enter the **API Key**
5. Test and save

## Configuring a Backup Provider

For fault tolerance, configure a backup LLM provider:

1. In Settings → Synthesis LLM, click **▸ Backup Provider (fallback)**
2. Select a backup provider (or Custom Provider)
3. Configure model, endpoint, and API key
4. Test Connection verifies both primary and backup independently

If the primary LLM fails during synthesis, the pipeline automatically falls back to the backup provider.

## Configuring Synthesis Interval

Set how often the synthesis pipeline runs:

| Option | Value in DB |
|--------|------------|
| 5 minutes | 300000 |
| 15 minutes (default) | 900000 |
| 30 minutes | 1800000 |
| 1 hour | 3600000 |
| 4 hours | 14400000 |
| Disabled | 0 |

Using MCP tools:
```typescript
// Set to 30 minutes
await ingenium_setting_set({
  project: "global-default",
  key: "synthesis_interval_ms",
  value: "1800000"
});
```

Or via the dashboard: **Settings → Synthesis LLM → Run every** dropdown.

## Manual Triggers

### Via MCP Tools
```typescript
// Trigger synthesis for current project
await ingenium_synthesis_run();

// Trigger cross-project synthesis
await ingenium_synthesis_cross_project();

// Check pipeline status
const status = await ingenium_synthesis_status();
```

### Via API
```bash
# Trigger synthesis
curl -X POST http://localhost:4097/api/v1/synthesis/run

# Check status
curl http://localhost:4097/api/v1/synthesis/status

# Get observation pipeline stats
curl http://localhost:4097/api/v1/observations/stats
```

### Via OpenCode Command
```
/synthesize
```

## Monitoring the Pipeline

1. Navigate to **Pipeline** (`/pipeline`) in the dashboard
2. Watch the real-time timeline of all synthesis events
3. Filter by source (All/Agent/Plugin/Synthesis/Trait)
4. Click any event for detailed metadata

## Cross-Project Synthesis

To share learned patterns across all projects:

1. Mark a project as global: `ingenium_project_set_global(project, "global-default", true)`
2. Trigger cross-project synthesis: `ingenium_synthesis_cross_project()`
3. Global skills are created in the `global-default` project
4. All projects can access global skills via shared skill resolution

Cross-project synthesis also runs automatically every 15 minutes as part of the scheduled maintenance cycle.

## MCP Tools Reference

| Tool | Purpose |
|------|---------|
| `ingenium_synthesis_run` | Trigger synthesis for the current project |
| `ingenium_synthesis_status` | Check pipeline status (pending count, last run) |
| `ingenium_synthesis_cross_project` | Trigger cross-project synthesis across all active projects |
| `ingenium_observe` | Store an observation for pipeline processing |
| `ingenium_observation_stats` | Get observation pipeline statistics |
| `ingenium_setting_get` | Get synthesis configuration (model, endpoint, interval) |
| `ingenium_setting_set` | Set synthesis configuration |

## Reused By Other Features

The same Synthesis LLM configuration powers several features beyond the pipeline:

- **Email suggestions** — `POST /api/v1/emails/:id/suggest` generates reply suggestions
- **Email summaries** — `GET /api/v1/emails/summarize/:uid` generates email summaries
- **Job config generation** — `POST /api/v1/jobs/suggest` derives prompt templates, cron schedules, and trigger events from a free-text job description (magic-wand feature on the Jobs page)

All three call `synthesisLlm.resolveLLMConfig()` to load the same model, endpoint, and API key configured in **Settings → Pipeline**.

## Related Docs
- [docs/self-learning-pipeline.md](../self-learning-pipeline.md) — Full pipeline reference (Phase 1, Phase 2, architecture, DB schema)
- [docs/HOW-TO/settings.md](settings.md) — Settings management
- [docs/HOW-TO/personality.md](personality.md) — Personality traits
- [docs/HOW-TO/jobs.md](jobs.md) — Job scheduling (magic-wand feature)
