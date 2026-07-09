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
- `services/ingenium-api` — Express REST API gateway
- `services/ingenium-server` — MCP stdio server
- `services/ingenium-dashboard` — Next.js 16 frontend

---

## Step 2 — Build the MCP Server

The MCP server is the core integration point for OpenCode. Build it with:

```bash
cd services/ingenium-server
npx tsc
cd ../..
```

This produces `services/ingenium-server/dist/scripts/mcp-server.js` — the MCP server entry point.

> **Note:** If you later run `./run.sh dev`, the build step is handled automatically. This manual build is only needed if you're configuring the MCP server separately.

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

Replace `/absolute/path/to/ingenium` with the full path to your cloned repo (e.g., `/home/user/repos/ingenium`).

The server type is `"local"` with a `command` array — this tells OpenCode to spawn the Node.js process as an MCP stdio subprocess.

---

## Step 4 — Add the MCP Server Globally (Optional)

To make Ingenium available in **all** your OpenCode projects, add the same entry to your global OpenCode config:

```bash
# Open your global config
~/.config/opencode/opencode.jsonc
```

Add the `ingenium` entry under the `mcp.servers` section, using the same JSON structure from Step 3. The global config uses JSONC format (supports comments), so you can add explanatory notes.

Once added, every OpenCode project on your machine will have access to Ingenium's 23 MCP tools.

---

## Step 5 — Start the Services

```bash
./run.sh dev
```

This starts three services in parallel:

| Service | URL / Protocol | Role |
|---------|----------------|------|
| **API** | http://localhost:4097 | REST API gateway — sole database authority |
| **Dashboard** | http://localhost:3000 | Next.js 16 App Router frontend |
| **MCP Server** | stdio | 23 tools via MCP protocol |

The script will:
1. Verify Node.js 22+ and npm are installed
2. Install dependencies if needed
3. Build `packages/ingenium-core` (migrations and shared types)
4. Run `./run.sh seed` to initialize the first project, create its database, and seed 3 OpenCode plugins (`planner-handoff`, `post-tool-use`, `session-start`)
5. Start each service with health-check polling
6. Print confirmation when all services are ready

Press `Ctrl+C` to stop all services gracefully.

> **Note:** You can re-run `./run.sh seed` manually at any time — it is idempotent and will only seed plugins that don't already exist.

## Step 6 — Verify

Run these checks to confirm everything is working:

### 1. Open the Dashboard

Navigate to [http://localhost:3000](http://localhost:3000). You should see 6 tabs:
- **Projects** — manage project configurations
- **Skills** — browse and search AI agent skills
- **Learnings** — log and search learning entries
- **Tasks** — Kanban task board
- **Plugins** — plugin lifecycle management
- **Servers** — MCP server configuration

### 2. Check the API Health

```bash
curl http://localhost:4097/api/v1/projects
```

A healthy response returns `[]` (empty array, since no projects have been created yet).

### 3. Verify MCP Tools in OpenCode

In OpenCode, run the `/skill-load` command. You should see Ingenium's MCP tools available (e.g., `ingenium_skill_list`, `ingenium_task_create`, etc.).

If the tools don't appear, restart your OpenCode session (the MCP server list is loaded at session startup).

---

## Troubleshooting

| Problem | Likely Cause | Fix |
|---------|--------------|-----|
| MCP server not showing up in OpenCode | Config not loaded | Restart OpenCode session, verify `enabled: true` in `opencode.json` |
| `node: not found` | Node.js not installed or not in PATH | Install Node.js 22+ from [nodejs.org](https://nodejs.org) |
| `ERR_MODULE_NOT_FOUND` | MCP server not built | Run `npx tsc` in `services/ingenium-server/` to rebuild |
| Dashboard shows "connection refused" | API not running on port 4097 | Check `./run.sh dev` output; ensure API started without errors |
| `EADDRINUSE` / port conflict | Another process on port 4097 or 3000 | Kill the existing process, or change `INGENIUM_API_PORT` in environment |
| MCP tools return errors | API URL mismatch | Verify `INGENIUM_API_URL` in `opencode.json` matches `http://localhost:4097/api/v1` |
| SQLite errors on startup | Missing data directory | Ensure `.ingenium/data/` exists in the repo root (created automatically by `run.sh`) |

---

## Next Steps

Once everything is running:

- **Explore the dashboard** — open [http://localhost:3000](http://localhost:3000) and click through all 6 tabs
- **Read feature guides** — see `docs/HOW-TO/` for per-feature instructions (projects, skills, learnings, tasks, plugins, servers)
- **Understand the architecture** — read `docs/ARCHITECTURE.md` for the full system design, data flow, and component responsibilities
- **Configure environment** — read `docs/VARIABLES.md` for all environment variable options and defaults
- **Learn conventions** — read `docs/CONVENTIONS.md` for naming, file organization, and git practices
