---
title: Getting Started
description: Step-by-step setup guide for Ingenium — prerequisites, installation, configuration, and first run.
---

# Getting Started with Ingenium

This guide walks you through setting up Ingenium — a self-learning AI agent skill system and MCP server — on OpenCode.

---

## Prerequisites

Before you begin, make sure you have these installed:

| Tool | Minimum Version | Check Command |
|------|----------------|---------------|
| **Docker** | 24+ | `docker --version` |
| **Docker Compose** | v2 | `docker compose version` |
| **git** | any modern version | `git --version` |

---

## Step 1 — Clone

```bash
git clone https://github.com/jtmb/ingenium.git
cd ingenium
```

---


## Step 2 — Start the Services

```bash
docker compose up --build
```

This starts all services in a single container:
- **API** on http://localhost:4097
- **Dashboard** on http://localhost:3000
- **opencode-web** on 0.0.0.0:4098 inside container (Compose publishes to host `127.0.0.1:4098`)
- **ttyd-opencode** on 0.0.0.0:4099 inside container (Compose publishes to host `127.0.0.1:4099`)

The API server idempotently creates the `global-default` project at startup if none exists — no manual setup needed.

### Troubleshooting Startup Issues

| Symptom | Cause | Resolution |
|---------|-------|------------|
| Email engine not running | No global project — mail sync skips gracefully when `global-default` is absent | The API creates it automatically on startup. If you see `Skipping mail sync — no global project configured` in the logs, create one via `ingenium_project_init` or the dashboard `/projects` page |
| Health endpoint works but routes return errors | DB not fully initialized (WAL recovery in progress) | Wait a few seconds and retry. The API runs a WAL checkpoint + integrity check at startup |
| Synthesis never runs | No enabled provider block has the Primary for Ingenium role | Configure a primary block in Settings → Providers. The scheduler logs `Synthesis LLM not configured` when idle |
| Synthesis LLM settings appear blank after restart | Docker volume (`ingenium-data`) is new or empty — no saved settings exist | Re-enter the provider, model, and API key in Settings → Providers. API keys are never stored in responses; the UI shows "Saved key" or "API key" placeholder to indicate whether a credential is stored |
| OpenCode reports `-32000 Connection closed` when invoking MCP tools | **Two possible root causes**: (1) **stdout logger contamination** — the pino logger writes to stdout (fd 1), which conflicts with the MCP stdio transport that expects JSON-RPC messages exclusively on stdout. Any stray log output corrupts the message stream, causing the host to close the connection. (2) **Missing dist/config dependency** — the packaged server (`dist/scripts/mcp-server.js`) imports from `../config/index.js`; if `tsc` output is stale or `config/` was omitted from the build, the server fails at module load before any tool can respond. | (1) Ensure `lib/logger.ts` uses `pino.destination(2)` to route all logs to stderr. Verify the compiled `dist/lib/logger.js` has `pino.destination(2)` — if out of date, rebuild with `npm run build`. (2) Verify `tsconfig.json` includes `"config/**/*.ts"` in the `include` array and `dist/config/index.js` exists. Rebuild with `npm run build` and restart the server. The MCP server identity (`mcpName`, `mcpVersion` in `config/index.ts`) is passed to `McpServer()` for runtime handshake verification — if these are missing or empty, the host may reject the connection during the `initialize` handshake.

## Step 3 — Verify

Navigate to [http://localhost:3000](http://localhost:3000) to see the dashboard. Check API health:

```bash
curl http://localhost:4097/api/v1/projects
```

## Step 4 — Configure Synthesis LLM (Optional)

1. Navigate to **Settings → Providers** in the dashboard
2. Add a provider block and configure its provider ID, npm package, and models
3. Mark the block **Primary for Ingenium** and enter its API key
4. Click **Save providers**, then restart OpenCode

---

## Next Steps

Once everything is running:

- **Explore the dashboard** — click through all 20 primary routes plus the Settings overlay
- **Read feature guides** — see `usage/` for per-feature instructions
- **Initialize a project** — use `/init-project` command or `ingenium_project_init` MCP tool
- **Learn the self-learning pipeline** — read `concepts/self-learning.md`
