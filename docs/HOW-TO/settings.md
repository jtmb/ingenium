# HOW-TO: Settings

## What It Does

Manage application-wide settings for the Ingenium system. Settings are key-value pairs stored in the DB. Synthesis-related settings are stored under the `global-default` project and affect all projects.

## Dashboard Access

Navigate to **Settings** (`/settings`) in the Ingenium Dashboard.

### Archive Retention

Controls how many days projects stay in the archive before being permanently deleted.

- **Default**: 7 days
- **Range**: 1–365 days
- Changes apply immediately to the next purge cycle

### Synthesis LLM Provider

Configure an LLM for Phase 2 skill synthesis in the self-learning pipeline.

**Provider Selection:**
- Choose from available OpenCode providers (detected from OpenCode config)
- Select "**— Custom Provider —**" for providers not in the list
- Select "**— No LLM (heuristics only) —**" to run Phase 1 only

**Model Selection:**
- For standard providers: select from the model dropdown
- For custom providers: enter the model ID manually

**API Key:**
- Enter the provider's API key
- Some providers (e.g., OpenCode free tier) make it optional

**Test Connection:**
- Verifies the provider is reachable with the given credentials
- Tests both primary and backup providers independently
- Shows success/failure status for each

**Save:**
- Persists provider, model, API key, and endpoint to the DB
- Settings stored under keys: `synthesis_model`, `synthesis_provider`, `synthesis_api_key`, `synthesis_endpoint`

### Backup LLM Provider

Optional fallback provider for fault tolerance:

1. Click **▸ Backup Provider (fallback)** to expand
2. Configure backup provider, model, endpoint, and API key
3. Same configuration options as the primary provider
4. If primary LLM fails during synthesis, the pipeline automatically falls back

**Backup settings stored under keys:**
- `synthesis_backup_provider`
- `synthesis_backup_model`
- `synthesis_backup_endpoint`
- `synthesis_backup_api_key`

### Synthesis Interval

Control how often the synthesis pipeline runs:

| UI Option | Interval | DB Value |
|-----------|----------|----------|
| 5 minutes | 5 min | 300000 |
| 15 minutes | 15 min (default) | 900000 |
| 30 minutes | 30 min | 1800000 |
| 1 hour | 1 hour | 3600000 |
| 4 hours | 4 hours | 14400000 |
| Disabled | never | 0 |

Changes take effect immediately — the API server reads the setting live.

## MCP Tools

| Tool | Description |
|------|-------------|
| `ingenium_setting_get(project, key)` | Get a setting value by key |
| `ingenium_setting_set(project, key, value)` | Set a setting value |

### Usage

```typescript
// Get a setting
const value = await ingenium_setting_get({
  project: "global-default",
  key: "archive_retention_days"
});

// Set a setting
await ingenium_setting_set({
  project: "global-default",
  key: "synthesis_interval_ms",
  value: "1800000"
});
```

## API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/settings/:key` | Get a setting by key |
| PUT | `/api/v1/settings/:key` | Set a setting value |
| GET | `/api/v1/settings` | List all settings for a project |

## Code Location
- Page: `services/ingenium-dashboard/src/app/settings/page.tsx`
- Core: `packages/ingenium-core/lib/tools/settings.ts`

## Related Docs
- [docs/HOW-TO/synthesis.md](synthesis.md) — Synthesis pipeline configuration guide
- [docs/HOW-TO/personality.md](personality.md) — Personality traits
- [docs/self-learning-pipeline.md](../self-learning-pipeline.md) — Full pipeline reference
