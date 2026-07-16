---
title: Dashboard User Guide
description: Complete user guide for the Ingenium dashboard — all features, pages, and API access.
---

# Ingenium Dashboard User Guide

Ingenium's dashboard provides visual management for all your AI agent development tools, including email client integration with Gmail and Outlook OAuth2 + IMAP/SMTP support. Access it at **http://localhost:3000** after starting the app.

## Getting Started

```bash
# Start all services (single container via supervisord)
docker compose up --build
```

Docker starts a single container running 4 processes under supervisord: API (:4097), Dashboard (:3000), opencode-web (binds **0.0.0.0**:4098 inside container, Compose publishes to host `127.0.0.1:4098`), and ttyd-opencode (binds **0.0.0.0**:4099 inside container by default, Compose publishes to host `127.0.0.1:4099`). Both bind 0.0.0.0 inside the container so Docker port forwarding and supervisord health checks work — host access is restricted to 127.0.0.1 by Docker Compose. The MCP server registers **210 tools**; the complete catalog has **212** when the two extension tools are included. Build-time UID matching ensures write access to workspace.

### Connecting an MCP Client

Point your MCP client to the `@ingenium/extension` package:

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

The extension package ships three OpenCode plugins — `observer.ts` (session event handling + synthesis triggering), `skill-sync.ts` (bidirectional skill sync), and `auto-observer.ts` (automatic behavior pattern detection from OpenCode message history). Reference them in your OpenCode config:

```jsonc
{
  "plugin": [
    "packages/ingenium-extension/observer.ts",
    "packages/ingenium-extension/skill-sync.ts",
    "packages/ingenium-extension/auto-observer.ts"
  ]
}
```

## Skills

**What it does**: Browse and search the current skill inventory. Skills cover debugging, security, testing, conventions, and framework-specific patterns. Stored in split-skill format (SKILL.md + metadata.json + references/) with `file_tree` support for auxiliary files.

**How to use**:
- View all skills in the Skills tab (card grid, 3 columns on desktop)
- Search by name, tag, or keyword
- Click a skill card to open a split-pane overlay with file tree navigation and content viewer
- Upload a skill from a `.md` file (frontmatter-parsed) using the Upload button
- Skills auto-load on session start via /skill-load

**API**: GET /api/v1/skills, GET /api/v1/skills/:id, GET /api/v1/skills/search?q=..., POST /api/v1/skills, PATCH /api/v1/skills/:id

## Commands

**What it does**: Manage `.opencode/commands/` lifecycle through 5 MCP tools. Commands are captured in the DB layer (mirroring plugins) with migration `010_commands.sql` and core tools in `packages/ingenium-core/lib/tools/commands.ts`.

**How to use**:
- List all commands via `ingenium_command_list(project, limit)`
- Get a specific command by name via `ingenium_command_get(project, name)`
- Create a new command via `ingenium_command_create(project, name, filePath, sourceContent)`
- Update an existing command via `ingenium_command_update(project, name, file_path, source_content)`
- Delete a command via `ingenium_command_delete(project, name)`

## Plugins

**What it does**: Manage OpenCode plugin lifecycle — enable, disable, and configure plugins. When creating a plugin, the API auto-populates source from disk if `sourceContent` is omitted.

**How to use**:
- View all plugins with their current status
- Toggle plugins on/off
- Create a plugin by path reference: `ingenium_plugin_create(project, name, filePath)`

## Synthesis & Cross-Project Features

**What it does**: The synthesis pipeline processes observations into personality traits and skills. When configured with an LLM (Phase 2), the pipeline creates skills in standard split-skill format.

**How to use**:
- Observations are automatically processed via the scheduled synthesis pipeline (every 15 minutes)
- Trigger manual synthesis via `ingenium_synthesis_run` for the current project
- Use `ingenium_synthesis_cross_project` to evaluate observations and skills across all active projects
- Global skills are created in the `global-default` project and shared across all projects

## Personality

**What it does**: View and manage the system's learned understanding of the user. The personality system tracks 6 developer-specific trait dimensions with confidence scores.

**How to use**:
- Navigate to `/personality` in the dashboard
- View active traits grouped by type with confidence bars (0.0–1.0)
- Click the **×** button on any trait card to dismiss it (marks `is_active = 0`)
- Hidden traits (confidence below 0.30) can be toggled via the "N hidden" link

## Observations

**What it does**: Full-text searchable observation log with 10 types. Observations track user behavior, preferences, corrections, patterns, errors, and goals.

**How to use**:
- Navigate to `/observations` in the dashboard
- View observations in a paginated list with type badges and importance scores
- Use the FTS5 search box for full-text search (supports prefix*, phrase "search", -negation)
- Filter by status and type

## Pipeline

**What it does**: A real-time Git-workflow-style timeline of all self-learning pipeline events. Every observation, synthesis run, trait creation, and plugin event is displayed in a connected vertical timeline with color-coded nodes.

**How to use**:
- Navigate to `/pipeline` in the dashboard
- Events auto-poll every 3 seconds (pause/resume button available)
- Filter events using pill buttons: All, Agent, Plugin, Synthesis, Trait

## Settings

**What it does**: Global application settings management. Configure archive retention period, synthesis LLM provider, backup provider, and synthesis interval.

**How to use**:
- Navigate to `/settings` in the dashboard
- **Archive retention**: Set the number of days projects stay in the archive (1-365)
- **Synthesis LLM**: Select an LLM provider for Phase 2 skill synthesis
- **Backup Provider**: Optionally configure a fallback LLM provider
- **Synthesis Interval**: Set how often the synthesis pipeline runs

## Agents

**What it does**: Manage AI agent profiles — create, enable, disable, and configure agent profiles. Each agent has a model assignment, access permissions, category, and skill bindings.

**How to use**:
- Navigate to `/agents` in the dashboard
- View all 10 agent profiles with their model, mode, and enabled status
- Enable/disable agents to control which are active

## Config

**What it does**: Manage OpenCode configuration via a dedicated `/config` dashboard page with tabbed editing. The `configs` table stores `opencode.json` (project-level) and `opencode.jsonc` (global) content in the DB.

**How to use**:
- Navigate to `/config` in the dashboard
- Use the **Project** tab to edit `opencode.json` for the active project
- Use the **Global** tab to edit `opencode.jsonc` for global configuration
- Click **Sync from disk** to reload config from the filesystem
- Click **Save** to persist editor content to the DB and write to disk

---

## API Access

All dashboard features are backed by a REST API on port 4097. You can use the API directly:

```bash
# List all projects
curl http://localhost:4097/api/v1/projects

# Get all skills
curl http://localhost:4097/api/v1/skills

# Search observations
curl "http://localhost:4097/api/v1/observations/search?q=indentation"

# Get personality profile
curl http://localhost:4097/api/v1/personality/profile

# Get pipeline timeline
curl "http://localhost:4097/api/v1/pipeline/timeline?limit=20"

# Trigger synthesis
curl -X POST http://localhost:4097/api/v1/synthesis/run
```

See each HOW-TO doc for the full API reference for each feature.
