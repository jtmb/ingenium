---
title: Synthesis Pipeline
description: Configuration of the synthesis pipeline — OpenCode provider blocks, synthesis roles, interval, and manual triggers.
---

# HOW-TO: Synthesis Pipeline

## What It Does

The synthesis pipeline processes observations into personality traits (Phase 1) and optionally creates/updates skills via an LLM (Phase 2). It runs automatically every 15 minutes (configurable) and can be triggered manually.

## Managing LLM Providers

To enable Phase 2 (LLM-driven skill synthesis):

1. Open **Settings → Providers**.
2. Click **Add provider** to create as many provider blocks as needed.
3. Set the OpenCode provider ID, display name, approved provider package, and optional base URL. Use **OpenAI compatible** for services without a dedicated package.
4. Add one or more model IDs and select the default model with its radio button.
5. Enter the API key and choose whether the block is available only, primary for Ingenium, or the Ingenium backup.
6. Click **Save providers**. OpenCode live-reloads the config in-process — no restart required.

> **Credential security**: API keys are **never returned** by the API or written into OpenCode configuration files. The settings endpoint returns only `apiKeySet: boolean`; an empty field preserves the saved credential.

> **Fresh store / new Docker volume**: If the Docker volume (`ingenium-data`) is new or empty, no saved settings exist. The field placeholder will show "API key" — you must re-enter the API key. Without a saved API key, the synthesis pipeline logs `Synthesis LLM not configured` and skips LLM-dependent phases.

> **Vault-backed credential storage**: API keys are stored in the encrypted vault (`vault_items` table with AES-256-GCM), never in the plaintext settings table. On `GET` responses, only `apiKeySet: boolean` is returned — the actual key is never exposed. Empty or omitted `apiKey` fields preserve the saved credential. Legacy `synthesis_api_key` / `synthesis_backup_api_key` settings are migrated into the vault on first read and then deleted from settings.

## Provider Roles

Each managed provider block has a **roles array** (`"available" | "primary" | "backup"`) that controls how the provider is used:

- `["available"]` — Adds the provider and models to the OpenCode catalog. Sets up a fallback synthesis provider when no explicit primary/backup is configured.
- `["available", "primary"]` — Sets the block as the **default model** for Chat, synthesis, email LLM features (suggestions, summaries), Docs AI, and job suggestions. Also added to the OpenCode catalog.
- `["available", "backup"]` — Sets the block as the **synthesis fallback** when the primary is unreachable. Also added to the OpenCode catalog.

### Exclusivity Rules

- At most **one** block may have `primary` in its roles array
- At most **one** block may have `backup` in its roles array
- Any number of blocks may have `["available"]`
- A block can hold both primary and backup roles, though this defeats the purpose of redundancy

### Same-Provider Different-Model Policy

The system permits primary and backup to use the **same provider** with **different models**. For example, `["custom", "model-a"]` as primary and `["custom", "model-b"]` as backup is valid — the broker deduplicates by `(providerID, modelID)` pair, so identical pairs are suppressed (only one call is made). Only when both `providerID` AND `modelID` are identical does the system reject the configuration as redundant.

This allows users to configure primary/backup failover from the same local inference server (e.g., Ollama, LM Studio) using different model sizes (e.g., a fast small model as primary, a slower thorough model as backup).

### Backwards Compatibility

Legacy clients using a single `role` field (`"available"`, `"primary"`, or `"backup"`) are supported. The API normalizes scalar roles into the corresponding array:

- `role: "primary"` → `roles: ["available", "primary"]`
- `role: "backup"` → `roles: ["available", "backup"]`
- `role: "available"` or omitted → `roles: ["available"]`

When both `roles` and `role` are present, `roles` takes precedence.

### Primary/Backup Fallback

If the primary LLM fails during synthesis, the pipeline automatically falls back to the backup provider. If no backup is configured, the pipeline degrades by skipping the LLM-dependent phases.

### Broker Fallback and 30-Second Timeout Cap

Interactive AI features (Docs AI, RAG Ask, Job Suggestions) that consume the synthesis LLM use the **synthesis broker** (`executeSynthesisBroker` in `opencode-client.ts`). The broker:

1. Reads `synthesis_provider` + `synthesis_model` (primary) and `synthesis_backup_provider` + `synthesis_backup_model` (secondary) from the global project's settings
2. Deduplicates identical `(providerID, modelID)` pairs — if primary and secondary are the same provider+model, only one call is made
3. Tries the primary first; if it fails (non-ok response), immediately falls back to the secondary
4. Caps **every** call at **30 seconds** (`Math.min(Math.max(timeoutMs, 0), 30_000)` — the passed timeout is clamped between 0 and 30s)
5. Creates an ephemeral OpenCode session (no agent, empty tools list), sends the prompt via OpenCode's model routing, and polls for the response with exponential backoff (500ms → 30s max)
6. If all configured providers fail, returns `{ ok: false, error: "all configured synthesis providers failed" }`

This is separate from the core synthesis pipeline (`callSynthesisLLM` in `synthesis-llm.ts`), which makes direct HTTP calls to the LLM endpoint with a 60-second timeout. The broker exists for interactive features that need OpenCode's provider routing infrastructure.

### Local / Private Endpoint Opt-In

By default, all LLM endpoints are validated against **SSRF protection** — private network addresses (localhost, 10.x, 172.16-31.x, 192.168.x, etc.) are rejected. To use a local inference server (Ollama, LM Studio, vLLM), you must explicitly enable the `allowPrivateNetwork` flag on the provider block.

> **Security Warning**: Enabling `allowPrivateNetwork` allows the system to send LLM requests to any address on your local network. Only enable this when you trust all services on your network, as a compromised local service could receive and inspect LLM prompts. This flag should be disabled in production deployments with internet-facing infrastructure.

The `allowPrivateNetwork` flag can also be set via environment variable `SYNTHESIS_ALLOW_PRIVATE_NETWORK=true` as a fallback for env-var-based synthesis configuration.

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

Or via the dashboard: **Settings → Providers → Synthesis schedule** dropdown.

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
- **Docs AI** — `POST /api/v1/docs/ai` provides AI-powered documentation actions (outline, continue, rewrite, summarize, fix grammar, tone adjustments)
- **RAG Ask** — `POST /api/v1/rag/ask` provides natural-language Q&A with LLM-grounded answers

**Two dispatch modes:**

| Mode | Used By | Mechanism | Timeout |
|------|---------|-----------|---------|
| **Broker** (via `executeSynthesisBroker`) | Docs AI, RAG Ask, Job Suggestions | Creates ephemeral OpenCode session, routes through OpenCode's provider infrastructure, polls for response | 30s cap (hard-clamped) |
| **Direct** (via `synthesisLlm.resolveLLMConfig()` + `safeLlmFetch`) | Email suggestions, Email summaries, self-learning pipeline | Calls the LLM endpoint directly via HTTP | 60s (configurable) |

The broker mode uses OpenCode's model routing (supports `(providerID, modelID)` pairs plus the fallback chain). The direct mode uses the resolved provider, model, endpoint, and API key from settings or env vars.

## Related Docs
- [Self-Learning Pipeline](../concepts/self-learning.md) — Full pipeline reference (Phase 1, Phase 2, architecture, DB schema)
- [API Reference](../develop/api.md#settings--llm-config) — LLM config endpoint documentation
- [Personality Traits](personality.md) — Personality traits
- [Jobs](../operations/jobs.md) — Job scheduling (magic-wand feature)
