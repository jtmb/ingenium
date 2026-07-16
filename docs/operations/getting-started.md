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
| **Node.js** | 22+ | `node --version` |
| **npm** | (ships with Node 22+) | `npm --version` |
| **OpenCode** | latest | `opencode --version` |
| **git** | any modern version | `git --version` |

---

## Step 1 — Clone and Install

```bash
git clone https://github.com/jtmb/ingenium.git
cd ingenium
npm install
```

This installs dependencies for all packages in the monorepo:
- `packages/ingenium-core` — shared library (SQLite WAL + FTS5, Zod schemas)
- `packages/ingenium-email` — IMAP/SMTP email client with OAuth2 support for Gmail and Outlook
- `services/ingenium-api` — Express REST API gateway
- `services/ingenium-server` — MCP stdio server
- `services/ingenium-dashboard` — Next.js 16 frontend

---

## Step 2 — Build the MCP Server

```bash
cd services/ingenium-server
npx tsc
cd ../..
```

This produces `services/ingenium-server/dist/scripts/mcp-server.js` — the MCP server entry point.

---

## Step 3 — Add the MCP Server to OpenCode (Project-Level)

Open the project's `opencode.json` at the repo root and verify that the `ingenium` entry is present and enabled:

```json
{
  "mcp": {
    "servers": {
      "ingenium": {
        "type": "local",
        "command": ["node", "/absolute/path/to/ingenium/services/ingenium-server/dist/scripts/mcp-server.js"],
        "enabled": true,
        "environment": {
          "INGENIUM_API_URL": "http://localhost:4097/api/v1",
          "INGENIUM_API_TIMEOUT": "10000",
          "LOG_LEVEL": "info"
        }
      }
    }
  }
}
```

---

## Step 4 — Add the MCP Server Globally (Optional)

To make Ingenium available in **all** your OpenCode projects, add the same entry to your global OpenCode config:

```bash
~/.config/opencode/opencode.jsonc
```

---

## Step 5 — Start the Services

### Docker Deployment (Recommended)

```bash
docker compose up --build
```

This starts all services in a single container:
- **API** on http://localhost:4097
- **Dashboard** on http://localhost:3000
- **opencode-web** on 0.0.0.0:4098 inside container (Compose publishes to host `127.0.0.1:4098`)
- **ttyd-opencode** on 0.0.0.0:4099 inside container (Compose publishes to host `127.0.0.1:4099`)

### Local Development Setup

```bash
./run.sh dev
```

## Step 6 — Verify

Navigate to [http://localhost:3000](http://localhost:3000) to see the dashboard. Check API health:

```bash
curl http://localhost:4097/api/v1/projects
```

## Step 7 — Configure Synthesis LLM (Optional)

1. Navigate to **Settings → Synthesis LLM** in the dashboard
2. Select a provider and model
3. Enter the API key
4. Click **Test Connection** → **Save**

---

## Next Steps

Once everything is running:

- **Explore the dashboard** — click through all 17 primary routes plus the Settings overlay
- **Read feature guides** — see `usage/` for per-feature instructions
- **Initialize a project** — use `/init-project` command or `ingenium_project_init` MCP tool
- **Learn the self-learning pipeline** — read `concepts/self-learning.md`
