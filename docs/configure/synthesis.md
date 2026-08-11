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

### Server-global provider ownership and recovery

Managed provider configuration used by server-owned features resolves against the
canonical `global-default` project. The selected dashboard or external worktree
project does not redirect provider metadata or credentials to another namespace.
When recovery finds stranded compatible mail/provider records in other project
namespaces, it moves only unambiguous, non-conflicting records. Existing
destination values are never overwritten; conflicts remain for operator review
and are reported only as content-free status/counts. Credential values and
ciphertext are never returned or included in recovery diagnostics.

Native OpenCode provider API keys use the same protected vault-backed persistence
before being synchronized through OpenCode's auth API. The key is not written to
OpenCode configuration files or exposed in API responses. When the protected
store is available during startup/unseal recovery, durable API-key records can
rehydrate OpenCode auth state. Native OAuth-only auth has no durable API-key copy;
if OpenCode auth storage is lost and no durable credential exists, that connection
remains unrecoverable by Ingenium and must be authorized again.

Native API-key connect and disconnect operations are compensating sagas. Connect
stores the desired encrypted vault credential before applying it to OpenCode; if
the OpenCode operation fails, Ingenium restores the previous vault/OpenCode state
or reports the failure as recoverable. Disconnect removes the OpenCode auth state
before deleting the vault credential; if deletion fails, the saved credential and
OpenCode auth are restored or the operation is reported as recoverable. The API
returns only fixed status/error data, never the key or compensation details that
could disclose it.

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

### Broker Fallback and Bounded Timeout Policies

Interactive AI features (Docs AI, RAG Ask, Job Suggestions) use the **synthesis broker** (`executeSynthesisBroker` in `opencode-client.ts`). The broker:

1. Resolves valid enabled managed synthesis primary and backup pairs from the server-owned Chat catalog, then deduplicates identical `(providerID, modelID)` pairs.
2. When those managed pairs are absent or stale, falls through to the server-resolved Chat default. That default includes the active zero-cost OpenCode Zen runtime model when Zen is the available safe choice.
3. Tries resolved choices in order. An explicit server-validated Docs AI selection is attempted exactly once; RAG Ask, Job Suggestions, and background learning do not accept a browser provider/model override.
4. Keeps default interactive callers hard-capped at **30 seconds**. Docs AI and background learning use server-owned bounded 60-second policies, preserving the direct pipeline's 60-second work limit. Every policy remains bounded by the broker-wide **60-second** maximum.
5. Creates an ephemeral OpenCode session using the named `ingenium-llm-broker` agent. Its wildcard-deny profile has no tool allowances, and the API-owned request uses an empty `tools: {}` selection; callers cannot override either boundary. The broker then sends the prompt via OpenCode's model routing and polls for the response with exponential backoff (500ms → 30s max)
6. If all resolved providers fail, returns a sanitized failure without exposing provider endpoints, credentials, or upstream error text.

The core self-learning pipeline still prefers an explicit direct synthesis endpoint. When no direct endpoint is configured, extraction, trait consolidation, skill synthesis, and skill consolidation receive a narrow text-only bridge to the bounded, tool-denied broker. Core never selects a provider/model or enables tools; the API retains both responsibilities and preserves the executing project scope.

**Docs AI selection rule:** Chat persists a provider/model pair only through an
authenticated server endpoint that validates it against the sole active global
Chat catalog. Docs AI resolves that server-owned global selection; browser
provider/model fields are not in the Docs AI DTO and cannot affect the broker.
When a saved pair is absent or stale, Docs uses the safe server-derived global
Chat default only; it does not choose an arbitrary managed provider. The default
precedence is a valid stored Chat selection, then a managed primary, then a
valid legacy primary, then the runtime OpenCode Zen free-model default.

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
API_CURL_CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}/ingenium/api-curl.conf"

# Trigger synthesis
curl --config "$API_CURL_CONFIG" -X POST http://localhost:4097/api/v1/synthesis/run

# Check status
curl --config "$API_CURL_CONFIG" http://localhost:4097/api/v1/synthesis/status

# Get observation pipeline stats
curl --config "$API_CURL_CONFIG" http://localhost:4097/api/v1/observations/stats
```

Use an owner-only (`0600`) curl config provisioned by your secret store; do
not place the bearer token in shell arguments or history.

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

**Dispatch modes:**

| Mode | Used By | Mechanism | Timeout |
|------|---------|-----------|---------|
| **Broker** (via `executeSynthesisBroker`) | Docs AI, RAG Ask, Job Suggestions; self-learning only when no direct endpoint exists | Creates an ephemeral, tool-denied OpenCode broker session, resolves managed synthesis pairs then the safe Chat/Zen default, and polls for response | 30s hard cap for interactive work; Docs AI/background learning: 60s server-owned policy |
| **Direct** (via `synthesisLlm.resolveLLMConfig()` + `safeLlmFetch`) | Email suggestions, Email summaries, self-learning when a direct endpoint is configured | Calls the LLM endpoint directly via HTTP | 60s |

The broker mode uses OpenCode's model routing. Docs AI supplies a validated
exact `(providerID, modelID)` pair with no fallback; other broker consumers use
the server-resolved managed/Chat fallback chain. Browser request bodies cannot
supply provider or model fields for RAG Ask, Job Suggestions, or learning work.
The direct mode uses the resolved provider, model, endpoint, and API key from
settings or environment variables.

## Related Docs
- [Self-Learning Pipeline](../concepts/self-learning.md) — Full pipeline reference (Phase 1, Phase 2, architecture, DB schema)
- [API Reference](../develop/api.md#settings--llm-config) — LLM config endpoint documentation
- [Personality Traits](../concepts/self-learning.md#personality_traits-table) — Personality traits
- [Jobs](../operations/jobs.md) — Job scheduling (magic-wand feature)
