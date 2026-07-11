<div align="center">

<img src="docs/assets/logo.svg" alt="Ingenium" width="120" />

# Ingenium

### All your AI agent development tools in one place. One MCP server, hundreds of tools.

<p>
  <img src="https://img.shields.io/badge/skills-22%20total-green?style=flat-square" alt="22 skills" />
  <img src="https://img.shields.io/badge/MCP%20tools-73-blue?style=flat-square" alt="73 MCP tools" />
  <img src="https://img.shields.io/badge/self--learning-%F0%9F%8C%B1-a371f7?style=flat-square" alt="Self-learning" />
</p>

---

</div>

**Ingenium** is a self-learning AI agent skill system and MCP server. It provides skills, observations, personality traits, synthesis pipeline, tasks, context, plugins, commands, servers, email client, agents, config management, and project management through a single MCP stdio transport, with a Next.js 16 dashboard for visual management.

### OpenCode Web UI Embedded in Dashboard
The dashboard includes an embedded OpenCode service at `/opencode` — a second OpenCode instance on `:4098` without auth (for iframe use) that connects to the Ingenium MCP server via a direct iframe mount. The session persists across tab navigation with a hidden iframe toggle. Workspace is mounted at `~/repos` → `/workspace` in the container.

Connect any MCP-compatible client (OpenCode, Cline, Claude Desktop) to `ingenium-server` and instantly gain access to **73 tools** spanning project management, skill management, observations, personality, synthesis pipeline, task boards, full-text knowledge search, plugin lifecycle, commands, config management, agent management, server configuration, email client integration with Gmail/Outlook OAuth2 + IMAP/SMTP support, and settings. Every tool is backed by SQLite with WAL mode and FTS5 full-text search.

**The system learns from you.** Patterns you teach, conventions you establish, and decisions you make are processed through a self-learning pipeline. The Observer plugin captures observations during your workflow, the synthesis pipeline (Phase 1 heuristic + optional Phase 2 LLM) transforms them into personality traits and skills, and the `/pipeline` timeline provides full observability into every step. The system supports cross-project synthesis, sharing learned patterns across all your projects.

15 dashboard pages provide visual management for every feature. Each page is a standalone feature with its own documentation.

## Quick Start

```bash
# Prerequisites: Node.js 22+, npm

# Clone and install dependencies
git clone https://github.com/jtmb/ingenium.git
cd ingenium
npm install

# Start all services (API on :4097, dashboard on :3000, MCP server on stdio)
./run.sh dev

# Or use Docker (API :4097, dashboard :3000, opencode-server :4096 managed by supervisord)
docker compose up --build
```

**OpenCode global MCP config** — Add this entry to `~/.config/opencode/opencode.jsonc` to make Ingenium available across all your projects:

```jsonc
{
  "mcp": {
    "servers": {
      "ingenium": {
        "type": "local",
        "command": ["npx", "-y", "@ingenium/extension"],
        "disabled": false,
        "env": {
          "INGENIUM_API_URL": "http://localhost:4097/api/v1",
          "INGENIUM_API_TIMEOUT": "10000",
          "LOG_LEVEL": "info"
        }
      }
    }
  }
}
```

Plugins ship inside the `@ingenium/extension` package. Reference them from your OpenCode config:
```jsonc
{
  "plugin": [
    "packages/ingenium-extension/observer.ts",
    "packages/ingenium-extension/skill-sync.ts"
  ]
}
```

**Other MCP clients** — Point your client's `command` to `npx -y @ingenium/extension`. The server speaks stdio MCP with **73 tools**. No HTTP port, no network config.

**Docker Deployment** — Single-container deployment via `docker compose up --build` manages three processes: API (`:4097`), Dashboard (`:3000`), and opencode-server (`:4096`) via supervisord. Build-time UID matching ensures write access to workspace. Docker volumes `opencode-config` and `opencode-data` persist OpenCode configuration across container rebuilds.

**Open the dashboard** — Navigate to `http://localhost:3000` in your browser. The Next.js dashboard provides visual management for all feature areas.

## Features

### 📦 Extension Package (`@ingenium/extension`)
Installable npm package that bundles everything needed to connect OpenCode to an Ingenium API. Ships the MCP stdio server, `observer.ts` plugin (session event handling + synthesis triggering), `skill-sync.ts` plugin (bidirectional disk↔DB sync), and `auto-observer.ts` plugin (automatic behavior pattern detection from OpenCode message history). Install with `npx -y @ingenium/extension`.
→ [packages/ingenium-extension/ARCHITECTURE.md](packages/ingenium-extension/ARCHITECTURE.md)

### 📁 Projects
Multi-project configuration with name→UUID resolution and per-project SQLite databases. Rich card view with skills count, observations, pipeline events, and last synthesis timestamp. Expandable detail panel showing recent skills, recent observations, and pipeline activity. Active/Archived tab views with inline rename, archive/unarchive, delete with confirmation dialog, and purge expired projects. Card hover shadow effect matching the skills page design. Keep knowledge isolated per project.
→ [docs/HOW-TO/projects.md](docs/HOW-TO/projects.md)

### 📚 Skills
AI agent conventions engine — 17 skills covering debugging, testing, security, API design, containers, Kubernetes, SQL, TypeScript, Go, Rust, Python, Next.js, and more. Each skill is a self-contained split-skill format (SKILL.md + metadata.json + references/) stored at `.opencode/skills/`. Skills are loaded from the SQLite database via the MCP server and auto-invoked based on file type, framework detection, and slash commands. The `file_tree` column stores a JSON map of relative paths → content for complete data round-trips. The dashboard provides a split-pane skill viewer with collapsible file tree sidebar (FileTree component), inline editing per file, and syntax highlighting (highlight.js) in both Preview and Source views.
→ [docs/HOW-TO/skills.md](docs/HOW-TO/skills.md)

### 🧠 Self-Learning Pipeline
Self-improving knowledge base with observation collection, synthesis processing, and personality trait aggregation. Three plugins in the `@ingenium/extension` package handle the pipeline: **observer.ts** (session events, observation import, synthesis trigger), **skill-sync.ts** (bidirectional disk↔DB skill sync), and **auto-observer.ts** (automatic behavior pattern detection from OpenCode message history — no manual `ingenium_observe` calls needed). The system uses 10 observation types, 6 developer-specific personality trait dimensions with a confidence model (display threshold ≥0.30, time decay, dismiss support), and optional LLM-driven Phase 2 skill synthesis with backup provider fallback.
→ [docs/HOW-TO/self-learning.md](docs/HOW-TO/self-learning.md)

> 🔴 **Note:** The old `ingenium_learning_log` is deprecated. Use `ingenium_observe` instead.

### 📋 Tasks
Kanban-style task board with `todo` → `in_progress` → `review` → `done` workflow, dependency tracking, priority scoring, and full audit history. Tasks can be created, assigned, moved, linked, and archived via the ingenium-server MCP tools or the dashboard.
→ [docs/HOW-TO/tasks.md](docs/HOW-TO/tasks.md)

### 🔌 Plugins
OpenCode plugin lifecycle management — enable, disable, configure plugins that extend the MCP server's capabilities. Plugin state is persisted across restarts with auto-config sync between DB and `opencode.json`.
→ [docs/HOW-TO/plugins.md](docs/HOW-TO/plugins.md)

### 📧 Mail
Full email client with inbox, compose, search, and AI auto-responses. Gmail/Outlook OAuth2 + IMAP/SMTP. 13 MCP tools for agents. Self-learning auto-draft from user patterns.

### 🖥️ MCP (Servers + Tools)
MCP server configuration and tool management — dual-tab page with **Servers** (add, start, stop MCP servers with source badges) and **Tools** (73 tools in 15 categories, per-tool and per-category enable/disable toggles, search, category filter). Disabled tools return a `TOOL_DISABLED` error at the MCP server level before execution.
→ [docs/HOW-TO/servers.md](docs/HOW-TO/servers.md)

### 👤 Agents
Agent profile management — create, enable, disable, and configure AI agent profiles (9 agents). Each agent has a model assignment, access permissions, category, and skill bindings. Manage agent profiles via the dashboard or `ingenium_agent_*` MCP tools. Agents support sync from disk to DB for round-trip editing.
→ [docs/agents.md](docs/agents.md)

### 👁️ Observations
Full-text searchable observation log with 10 types (correction, preference, pattern, insight, feedback, behavior, terminology, workflow, error, goal). FTS5-powered search, type/status filters, and pipeline integration. Powered by the self-learning pipeline — every user interaction is logged automatically.
→ [docs/HOW-TO/self-learning.md](docs/HOW-TO/self-learning.md)

### 🧬 Personality
Learned personality profile with 6 trait dimensions (communication_style, code_preference, workflow_pattern, feedback_style, interaction_pattern, priority_signal). Confidence model with display threshold (≥0.30), time decay, and dismiss support. Traits inform agent behavior adjustments.
→ [docs/self-learning-pipeline.md](docs/self-learning-pipeline.md)

### 🕐 Pipeline
Git-workflow-style real-time timeline of all pipeline events. Auto-polls every 3 seconds, filter pills (All/Agent/Plugin/Synthesis/Trait), +N collapse for rapid events, detail overlays with raw JSON. 12 event types spanning observations, synthesis, traits, and plugins.
→ [docs/self-learning-pipeline.md](docs/self-learning-pipeline.md)

### ⚙️ Settings
Application settings management — configure key-value settings at the project level. Settings control archive retention (days), synthesis interval (minutes), synthesis LLM provider (with backup provider fallback), API key, endpoint URL, and Test Connection verification.
→ [docs/HOW-TO/settings.md](docs/HOW-TO/settings.md)

### 🔧 Config
OpenCode configuration editor with Project/Global tabs. Edit `opencode.json` (project-level) and `opencode.jsonc` (global) directly from the dashboard. Sync from disk to reload filesystem changes, save to persist to DB and write to disk.
→ [docs/USAGE.md](docs/USAGE.md)

### 🗄️ Archive
Project archiving and lifecycle management — view archived projects, restore them to active status, or purge expired projects. Archive tab in the Projects page provides Active/Archived toggle with rename, archive, and restore actions.

## Architecture

```
ingenium/
├── packages/
│   ├── ingenium-core/        # Shared library: SQLite WAL + FTS5, 16 tool modules, Zod schemas, pipeline events
│   ├── ingenium-email/       # IMAP/SMTP email client (imapflow, nodemailer, mailparser) with OAuth2 for Gmail/Outlook
│   └── ingenium-extension/   # Client-side OpenCode package (MCP server, observer + skill-sync + auto-observer plugins, ARCHITECTURE.md). Installable via `npx -y @ingenium/extension`
├── services/
│   ├── ingenium-api/          # Express REST gateway on port 4097. Sole database authority.
│   ├── ingenium-server/       # MCP stdio server with 73 tools. Calls API via HTTP. Zero DB access.
│   └── ingenium-dashboard/    # Next.js 16 App Router frontend with 15 feature pages. Calls API via HTTP. Zero DB access.
├── seed/
│   ├── skills/                # Canonical skill sources in split-skill format (SKILL.md + metadata.json + references/)
│   └── plugins/               # Seed plugins (.ts files)
├── .opencode/
│   ├── skills/                # Skills written to disk from DB (split-skill format)
│   ├── plugins/               # Plugin .ts files synced from DB
│   ├── agents/                # Agent categories (primary, research, execution, security)
│   └── commands/              # OpenCode custom commands
├── docs/                      # Project documentation database
├── run.sh                     # Unified dev/test/build/check/seed runner
├── docker-compose.yml         # Single-container deployment (supervisord: API + dashboard + opencode-server)
└── Dockerfile                 # Multi-stage build for containerised deployment
```

**Data flow:** The MCP server (`ingenium-server`) accepts stdio MCP protocol and forwards requests as HTTP to the API (`ingenium-api`), which is the sole database authority. The dashboard (`ingenium-dashboard`) also calls the API via HTTP. This ensures consistent data access — the database is never accessed directly by the MCP server or frontend.

```mermaid
graph LR
    A[MCP Client<br/>OpenCode, Cline, Claude] -->|stdio MCP| B[ingenium-server<br/>73 tools]
    B -->|HTTP| C[ingenium-api<br/>port 4097]
    D[Browser<br/>Dashboard] -->|HTTP| C
    C -->|SQLite WAL| E[(SQLite<br/>FTS5)]
    
    F[Agent Session] -->|skill-load| G[.opencode/skills/<br/>22 skills]
    G -->|self-learning| H[Synthesis<br/>Pipeline]
    H -->|observations| E
    H -->|traits| E
    
    I[Orchestrator] -->|QA verify| J[@ingenium-qa<br/>review + test]
    I -->|docs update| K[@ingenium-docs<br/>documentation]
```

## Documentation

| Doc | Purpose |
|-----|---------|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Project structure, data flow, key components, skill file_tree format |
| [docs/TECH-STACK.md](docs/TECH-STACK.md) | Dependencies, versions, why each was chosen |
| [docs/CONVENTIONS.md](docs/CONVENTIONS.md) | Naming, file organization, error handling, observation logging, plugin auto-config sync |
| [docs/VARIABLES.md](docs/VARIABLES.md) | All environment variables with defaults |
| [docs/agents.md](docs/agents.md) | Agent profiles and pipeline lifecycle |
| [docs/GETTING-STARTED.md](docs/GETTING-STARTED.md) | Quick start guide with Docker, local dev, and MCP config |
| [docs/USAGE.md](docs/USAGE.md) | Comprehensive dashboard user guide for all 15 pages |
| [docs/self-learning-pipeline.md](docs/self-learning-pipeline.md) | Full self-learning pipeline reference (observations, personality, synthesis) |
| [AGENTS.md](AGENTS.md) | Skill system protocol — agent entry point with all conventions |
| [docs/HOW-TO/projects.md](docs/HOW-TO/projects.md) | Project management (create, archive, global vs regular, cross-project) |
| [docs/HOW-TO/skills.md](docs/HOW-TO/skills.md) | Skill system usage, file_tree format, split-skill editing |
| [docs/HOW-TO/synthesis.md](docs/HOW-TO/synthesis.md) | Synthesis pipeline configuration (LLM, backup provider, interval) |
| [docs/HOW-TO/personality.md](docs/HOW-TO/personality.md) | Personality trait confidence model, dismiss, sort, hidden traits |
| [docs/HOW-TO/self-learning.md](docs/HOW-TO/self-learning.md) | Self-learning pipeline with observations and personality traits |
| [docs/HOW-TO/learnings.md](docs/HOW-TO/learnings.md) | Old learnings documentation (deprecated, kept for reference) |
| [docs/HOW-TO/tasks.md](docs/HOW-TO/tasks.md) | Kanban task board feature guide |
| [docs/HOW-TO/plugins.md](docs/HOW-TO/plugins.md) | Plugin lifecycle management guide |
| [docs/HOW-TO/servers.md](docs/HOW-TO/servers.md) | MCP server configuration guide |
| [docs/HOW-TO/settings.md](docs/HOW-TO/settings.md) | Settings management (archive retention, synthesis LLM, interval) |
| [services/ingenium-dashboard/STYLING-GUIDE.md](./services/ingenium-dashboard/STYLING-GUIDE.md) | Dashboard styling conventions and component design |

## Docker Deployment

The project ships as a single Docker container via `Dockerfile` (multi-stage build, root) and `docker-compose.yml` (single service):

```yaml
services:
  ingenium:
    build: .
    ports:
      - "4097:4097"   # API
      - "3000:3000"   # Dashboard
      - "4096:4096"   # opencode-server (managed by supervisord)
      - "4098:4098"   # opencode-iframe (no-auth for embedded use)
    volumes:
      - ingenium_data:/app/.ingenium/data
```

Inside the container, **supervisord** manages four processes:
1. **API** (Express on :4097) — `express.json({ limit: "2mb" })` for large skill uploads
2. **Dashboard** (Next.js on :3000) — 15 route-based pages with highlight.js syntax highlighting
3. **opencode-server** (on :4096) — Auth-enabled OpenCode web server
4. **opencode-iframe** (on :4098) — No-auth OpenCode iframe for embedded dashboard use

Build-time UID matching ensures write access to workspace (`~/repos` → `/workspace`). Docker volumes `opencode-config` and `opencode-data` persist OpenCode configuration across container rebuilds.

Start with:
```bash
docker compose up --build
```

## Development

```bash
./run.sh dev         # Start all services in dev mode
./run.sh dev api     # Start only the API service
./run.sh dev server  # Start only the MCP server
./run.sh dev dashboard  # Start only the dashboard

./run.sh test        # Run all tests
./run.sh check       # Type-check and lint all packages
./run.sh build       # Build all packages for production
```
