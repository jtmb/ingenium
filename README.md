<div align="center">

<img src="docs/assets/logo.svg" alt="Ingenium" width="120" />

# Ingenium

### Your complete AI agent development workspace. Agent orchestration, Kanban tasks, email with AI drafting, self-learning pipeline, MCP tool management, OpenCode browser integration — fully pluggable, local, and cost-effective.

<p>
  <img src="https://img.shields.io/badge/skills-25-green?style=flat-square" alt="25 skills" />
  <img src="https://img.shields.io/badge/MCP%20tools-73-blue?style=flat-square" alt="73 MCP tools" />
  <img src="https://img.shields.io/badge/agents-10-orange?style=flat-square" alt="10 agents" />
  <img src="https://img.shields.io/badge/dashboard%20pages-16-8A2BE2?style=flat-square" alt="16 dashboard pages" />
  <img src="https://img.shields.io/badge/self--learning-%F0%9F%8C%B1-a371f7?style=flat-square" alt="Self-learning" />
</p>

---

</div>

**Ingenium** is a complete AI agent development workspace. It combines agent orchestration (10 subagent profiles), a Kanban task board, a full email client with AI auto-drafting, a self-learning pipeline with LLM-powered extraction and synthesis, an MCP server manager with per-tool toggles, OpenCode browser embedding, and project management — all accessible through a single MCP stdio transport. Pluggable into any MCP-compatible client (OpenCode, Cline, Claude Desktop, any provider), fully local and cost-effective. Every tool is backed by SQLite with WAL mode and FTS5 full-text search.

### OpenCode Web UI Embedded in Dashboard
The dashboard includes an embedded OpenCode service at `/opencode` — a shared single OpenCode instance on `:4098` without auth (for iframe use) that connects to the Ingenium MCP server via a direct iframe mount. The session persists across tab navigation with a hidden iframe toggle. Workspace is mounted at `~/repos` → `/workspace` in the container.

Connect any MCP-compatible client (OpenCode, Cline, Claude Desktop) to `ingenium-server` and instantly gain access to **73 tools** spanning project management, skill management, observations, personality, synthesis pipeline, task boards, full-text knowledge search, plugin lifecycle, commands, config management, agent management, server configuration, email client integration with Gmail/Outlook OAuth2 + IMAP/SMTP support, and settings. Every tool is backed by SQLite with WAL mode and FTS5 full-text search.

**The system learns from you.** Patterns you teach, conventions you establish, and decisions you make are processed through a self-learning pipeline. The server-side extraction engine reads your OpenCode messages and uses the synthesis LLM to extract durable behavior rules. The synthesis pipeline (LLM consolidation + optional skill synthesis) transforms observations into personality traits and skills, and the `/pipeline` timeline provides full observability into every step. A 15-minute scheduler runs the complete chain — extraction → synthesis → skill-sync — autonomously in the background. The system supports cross-project synthesis, sharing learned patterns across all your projects.

16 dashboard pages provide visual management for every feature. Each page is a standalone feature with its own documentation.

## Quick Start

```bash
# Prerequisites: Node.js 22+, npm

# Clone and install dependencies
git clone https://github.com/jtmb/ingenium.git
cd ingenium
npm install

# Start all services (API on :4097, dashboard on :3000, MCP server on stdio)
./run.sh dev

# Or use Docker (API :4097, dashboard :3000, opencode-web :4098 managed by supervisord)
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
    "packages/ingenium-extension/skill-sync.ts",
    "packages/ingenium-extension/auto-observer.ts"
  ]
}
```

**Other MCP clients** — Point your client's `command` to `npx -y @ingenium/extension`. The server speaks stdio MCP with **73 tools**. No HTTP port, no network config.

**Docker Deployment** — Single-container deployment via `docker compose up --build` manages three processes: API (`:4097`), Dashboard (`:3000`), and opencode-web (`:4098`) via supervisord. Build-time UID matching ensures write access to workspace. Docker volumes `opencode-config` and `opencode-data` persist OpenCode configuration across container rebuilds.

**Open the dashboard** — Navigate to `http://localhost:3000` in your browser. The Next.js dashboard provides visual management for all feature areas.

## Features

### 📦 Extension Package (`@ingenium/extension`)
Installable npm package that bundles everything needed to connect OpenCode to an Ingenium API. Ships the MCP stdio server, `observer.ts` plugin (session event handling + synthesis triggering), `skill-sync.ts` plugin (bidirectional disk↔DB sync), and `auto-observer.ts` plugin (thin trigger that POSTs to the server-side extraction engine on `session.idle` — extraction and detection run server-side). Install with `npx -y @ingenium/extension`.
→ [packages/ingenium-extension/ARCHITECTURE.md](packages/ingenium-extension/ARCHITECTURE.md)

### 📁 Projects
Multi-project configuration with name→UUID resolution and per-project SQLite databases. Rich card view with skills count, observations, pipeline events, and last synthesis timestamp. Expandable detail panel showing recent skills, recent observations, and pipeline activity. Active/Archived tab views with inline rename, archive/unarchive, delete with confirmation dialog, and purge expired projects. Card hover shadow effect matching the skills page design. Keep knowledge isolated per project.
→ [docs/HOW-TO/projects.md](docs/HOW-TO/projects.md)

<p align="center"><img src="docs/assets/screenshot-projects.png" alt="Projects" width="600" /></p>

### 📚 Skills
AI agent conventions engine — 25+ skills covering debugging, testing, security, API design, containers, Kubernetes, SQL, TypeScript, Go, Rust, Python, Next.js, and more. Each skill is a self-contained split-skill format (SKILL.md + metadata.json + references/) stored at `.opencode/skills/`. Skills are loaded from the SQLite database via the MCP server and auto-invoked based on file type, framework detection, and slash commands. The `file_tree` column stores a JSON map of relative paths → content for complete data round-trips. The dashboard provides a split-pane skill viewer with collapsible file tree sidebar (FileTree component), inline editing per file, and syntax highlighting (highlight.js) in both Preview and Source views.
→ [docs/HOW-TO/skills.md](docs/HOW-TO/skills.md)

<p align="center">
  <img src="docs/assets/screenshot-skills.png" alt="Skills" width="600" />
  <br/><br/>
  <img src="docs/assets/screenshot-skills-overlay.png" alt="Skill Detail Overlay" width="400" />
</p>

### 🧠 Self-Learning Pipeline
Self-improving knowledge base with observation collection, synthesis processing, and personality trait aggregation. Three plugins in the `@ingenium/extension` package handle the pipeline: **observer.ts** (session events, observation import, synthesis trigger), **skill-sync.ts** (bidirectional disk↔DB skill sync), and **auto-observer.ts** (thin trigger that POSTs to the server-side extraction engine on `session.idle` — extraction and detection run server-side in the API). The extraction engine reads OpenCode messages, uses a regex pre-filter for candidate selection, batches candidates to the synthesis LLM, and creates observations from extracted behavior rules. The synthesis pipeline runs LLM consolidation (Phase 1) and optional skill synthesis (Phase 2) with backup provider fallback. The 15-minute scheduler runs the full chain — extraction → synthesis → skill-sync — autonomously. 10 observation types, 6 developer-specific personality trait dimensions with a confidence model (display threshold ≥0.30, time decay, dismiss support).
→ [docs/HOW-TO/self-learning.md](docs/HOW-TO/self-learning.md)

> 🔴 **Note:** The old `ingenium_learning_log` is deprecated. The auto-observer plugin now POSTs to the server-side extraction engine — no manual `ingenium_observe` calls needed.

### 📋 Tasks
Kanban-style task board with `todo` → `in_progress` → `review` → `done` workflow, dependency tracking, priority scoring, and full audit history. Tasks can be created, assigned, moved, linked, and archived via the ingenium-server MCP tools or the dashboard.
→ [docs/HOW-TO/tasks.md](docs/HOW-TO/tasks.md)

<p align="center"><img src="docs/assets/screenshot-tasks.png" alt="Tasks" width="600" /></p>

### 🔌 Plugins
OpenCode plugin lifecycle management — enable, disable, configure plugins that extend the MCP server's capabilities. Plugin state is persisted across restarts with auto-config sync between DB and `opencode.json`.
→ [docs/HOW-TO/plugins.md](docs/HOW-TO/plugins.md)

<p align="center"><img src="docs/assets/screenshot-plugins.png" alt="Plugins" width="600" /></p>

### ⚡ Jobs
Scheduled and triggered agent job runner — create, edit, and monitor background agent tasks. The create/edit modal features a 2-column responsive layout (metadata fields left, prompt_template right) with a magic-wand button that derives job configuration (prompt_template, schedule_cron, trigger_event) from a natural-language description using the Synthesis LLM. Supports manual run, cancel, and real-time log streaming per job run.

### 📧 Mail
Full email client with inbox, compose, search, and AI auto-responses. Smart replies are integrated directly into the reply composer (not a standalone panel) for a seamless workflow. Resizable email panel with adjustable column widths. Gmail/Outlook OAuth2 + IMAP/SMTP. 13 MCP tools for agents. Self-learning auto-draft from user patterns.

<p align="center"><img src="docs/assets/screenshot-mail.png" alt="Mail" width="600" /></p>

### 🖥️ MCP (Servers + Tools)
MCP server configuration and tool management — dual-tab page with **Servers** (add, start, stop MCP servers with source badges) and **Tools** (73 tools in 15 categories, per-tool and per-category enable/disable toggles, search, category filter). Disabled tools return a `TOOL_DISABLED` error at the MCP server level before execution.
→ [docs/HOW-TO/servers.md](docs/HOW-TO/servers.md)

<p align="center">
  <img src="docs/assets/screenshot-mcp-servers.png" alt="MCP Servers" width="600" />
  <br/><br/>
  <img src="docs/assets/screenshot-mcp-tools.png" alt="MCP Tools" width="600" />
</p>

### 👤 Agents
Agent profile management — create, enable, disable, and configure AI agent profiles (10 agents). Each agent has a model assignment, access permissions, category, and skill bindings. Manage agent profiles via the dashboard or `ingenium_agent_*` MCP tools. Agents support sync from disk to DB for round-trip editing.
→ [docs/agents.md](docs/agents.md)

<p align="center"><img src="docs/assets/screenshot-agents.png" alt="Agents" width="600" /></p>

### 👁️ Observations
Full-text searchable observation log with 10 types (correction, preference, pattern, insight, feedback, behavior, terminology, workflow, error, goal). FTS5-powered search, type/status filters, and pipeline integration. Powered by the self-learning pipeline — every user interaction is logged automatically.
→ [docs/HOW-TO/self-learning.md](docs/HOW-TO/self-learning.md)

<p align="center">
  <img src="docs/assets/screenshot-observations.png" alt="Observations" width="600" />
  <br/><br/>
  <img src="docs/assets/screenshot-observation-detail.png" alt="Observation Detail" width="400" />
</p>

### 🧬 Personality
Learned personality profile with 6 trait dimensions (communication_style, code_preference, workflow_pattern, feedback_style, interaction_pattern, priority_signal). Confidence model with display threshold (≥0.30), time decay, and dismiss support. Traits inform agent behavior adjustments.
→ [docs/self-learning-pipeline.md](docs/self-learning-pipeline.md)

<p align="center">
  <img src="docs/assets/screenshot-personality.png" alt="Personality" width="600" />
  <br/><br/>
  <img src="docs/assets/screenshot-personality-all.png" alt="Personality All Traits" width="600" />
</p>

### 🕐 Pipeline
Git-workflow-style real-time timeline of all pipeline events. Auto-polls every 3 seconds, filter pills (All/Agent/Plugin/Synthesis/Trait/Extraction), +N collapse for rapid events, detail overlays with raw JSON. 14 event types spanning observations, synthesis, traits, extraction, and plugins.
→ [docs/self-learning-pipeline.md](docs/self-learning-pipeline.md)

<p align="center">
  <img src="docs/assets/screenshot-pipeline.png" alt="Pipeline" width="600" />
  <br/><br/>
  <img src="docs/assets/screenshot-pipeline-detail.png" alt="Pipeline Detail" width="600" />
</p>

### ⚙️ Settings
Application settings management — configure key-value settings at the project level. Settings control archive retention (days), synthesis interval (minutes), synthesis LLM provider (with backup provider fallback), API key, endpoint URL, and Test Connection verification.
→ [docs/HOW-TO/settings.md](docs/HOW-TO/settings.md)

<p align="center"><img src="docs/assets/screenshot-settings.png" alt="Settings" width="600" /></p>

### 🔧 Config
OpenCode configuration editor with Project/Global tabs. Edit `opencode.json` (project-level) and `opencode.jsonc` (global) directly from the dashboard. Sync from disk to reload filesystem changes, save to persist to DB and write to disk.
→ [docs/USAGE.md](docs/USAGE.md)

<p align="center"><img src="docs/assets/screenshot-config.png" alt="Config" width="600" /></p>

### 📜 Logs
Real-time log dashboard for monitoring API, dashboard, and MCP server activity. Stream logs with level filtering (error, warning, info, debug), timestamp navigation, and search. Tracks pipeline events, API requests, and plugin lifecycle — essential for debugging the self-learning pipeline.

<p align="center"><img src="docs/assets/screenshot-logs.png" alt="Logs" width="600" /></p>

### 🌐 OpenCode
Embedded OpenCode web UI at `/opencode` — a shared single OpenCode instance running on `:4098` without auth (for iframe use) that connects to the Ingenium MCP server via a direct iframe mount. The session persists across dashboard tab navigation with a hidden iframe toggle. Workspace is mounted at `~/repos` → `/workspace` in the container.

<p align="center"><img src="docs/assets/screenshot-opencode.png" alt="OpenCode" width="600" /></p>

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
│   └── ingenium-dashboard/    # Next.js 16 App Router frontend with 16 route-based pages. Calls API via HTTP. Zero DB access.
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
├── docker-compose.yml         # Single-container deployment (supervisord: API + dashboard + opencode-web)
└── Dockerfile                 # Multi-stage build for containerised deployment
```

**Data flow:** The MCP server (`ingenium-server`) accepts stdio MCP protocol and forwards requests as HTTP to the API (`ingenium-api`), which is the sole database authority. The dashboard (`ingenium-dashboard`) also calls the API via HTTP. This ensures consistent data access — the database is never accessed directly by the MCP server or frontend.

```mermaid
graph LR
    A[MCP Client<br/>OpenCode, Cline, Claude] -->|stdio MCP| B[ingenium-server<br/>73 tools]
    B -->|HTTP| C[ingenium-api<br/>port 4097]
    D[Browser<br/>Dashboard] -->|HTTP| C
    C -->|SQLite WAL| E[(SQLite<br/>FTS5)]
    
    F[Agent Session] -->|skill-load| G[.opencode/skills/<br/>25 skills]
    G -->|self-learning| H[Synthesis<br/>Pipeline]
    H -->|observations| E
    H -->|traits| E
    
    C -->|reads OpenCode messages| X[Extraction<br/>Engine]
    X -->|LLM extraction| H
    Y[15-min Scheduler] -->|triggers| X
    Y -->|triggers| H
    
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
| [docs/USAGE.md](docs/USAGE.md) | Comprehensive dashboard user guide for all 16 pages |
| [docs/self-learning-pipeline.md](docs/self-learning-pipeline.md) | Full self-learning pipeline reference (observations, personality, synthesis) |
| [AGENTS.md](AGENTS.md) | Skill system protocol — agent entry point with all conventions |
| [docs/HOW-TO/projects.md](docs/HOW-TO/projects.md) | Project management (create, archive, global vs regular, cross-project) |
| [docs/HOW-TO/skills.md](docs/HOW-TO/skills.md) | Skill system usage, file_tree format, split-skill editing |
| [docs/HOW-TO/synthesis.md](docs/HOW-TO/synthesis.md) | Synthesis pipeline configuration (LLM, backup provider, interval) |
| [docs/HOW-TO/personality.md](docs/HOW-TO/personality.md) | Personality trait confidence model, dismiss, sort, hidden traits |
| [docs/HOW-TO/self-learning.md](docs/HOW-TO/self-learning.md) | Self-learning pipeline with observations and personality traits |
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
      - "127.0.0.1:4098:4098"   # opencode-web (host loopback only)
    volumes:
      - ingenium_data:/app/.ingenium/data
```

Inside the container, **supervisord** manages three processes:
1. **API** (Express on :4097) — `express.json({ limit: "2mb" })` for large skill uploads
2. **Dashboard** (Next.js on :3000) — 16 route-based pages with highlight.js syntax highlighting
3. **opencode-web** (on :4098) — OpenCode web server (loopback only)

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
