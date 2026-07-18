---
title: Dashboard User Guide
description: Complete user guide for the Ingenium dashboard — all features, pages, and API access.
---

# Ingenium Dashboard User Guide

Ingenium's dashboard provides visual management for all your AI agent development tools, including email client integration with Gmail and Outlook OAuth2 + IMAP/SMTP support. Access it at **http://localhost:3000** after starting the app.

## Getting Started

```bash
# Production — single container via supervisord
docker compose up --build
```

Docker starts a single container running 4 processes under supervisord: API (:4097), Dashboard (:3000), opencode-web (binds **0.0.0.0**:4098 inside container, Compose publishes to host `127.0.0.1:4098`), and ttyd-opencode (binds **0.0.0.0**:4099 inside container by default, Compose publishes to host `127.0.0.1:4099`). Both bind 0.0.0.0 inside the container so Docker port forwarding and supervisord health checks work — host access is restricted to 127.0.0.1 by Docker Compose. The MCP server registers **243 tools** across **28 categories**; 2 extension tools bring the catalog to 245. Build-time UID matching ensures write access to workspace.

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

### Routes

The Ingenium Dashboard provides **20 primary routes** plus the Settings overlay:

| Page | Purpose |
|------|---------|
| `/` | Home — operational dashboard with live metrics |
| `/chat` | Ingenium Chat — standalone conversational agent interface |
| `/opencode` | Embedded OpenCode Web/CLI iframes |
| `/projects` | Project management |
| `/skills` | Skills grid with detail overlay |
| `/docs` | Documentation workspace |
| `/secrets` | Encrypted secrets vault — password manager with scrypt key derivation and AES-256-GCM. First-run creates a vault; subsequent visits unseal the existing vault. |
| `/backups` | Backup and restore management — create snapshots, view history, schedule automated backups |
| `/jobs` | Job queue and background task monitoring |
| `/logs` | Structured logging and event viewer |
| `/mail` | 3-pane email client |
| `/status` | Service status — supervisord process states |
| `/tasks` | Kanban board |
| `/plugins` | Plugin lifecycle management |
| `/agents` | Agent profiles |
| `/mcp-servers` | MCP servers + Tool Manager |
| `/config` | OpenCode config editor |
| `/observations` | Self-learning observations |
| `/personality` | Personality traits |
| `/pipeline` | Pipeline event timeline |
| Settings (overlay) | Full-screen settings overlay

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

## Chat

**What it does**: Standalone conversational AI interface using OpenCode's native chat API. Separated from the `/opencode` OpenCode Web/CLI iframe page.

**How to use**:
- Navigate to `/chat` in the dashboard
- Select a **Provider**, **Model**, and **Agent** from the header selectors. Selectors are disabled (`opacity-40 cursor-not-allowed`) when loading, when the chat config API failed, or when no providers are available. Providers with `source === "builtin"` show a **"(Free)"** badge — these are auto-discovered from the OpenCode Zen built-in provider (free tier, no API key required).
- **No LLM configured state**: When no providers exist (`isConfigured === false`), a blue info banner links to Settings → Providers. The send button is blocked, all selectors are disabled, and the composer has `hasSelectableModel={false}` preventing sends. Once a provider is configured and saved, selectors populate dynamically from `GET /api/v1/settings/chat-config`. OpenCode live-reloads provider config changes — no restart required.
- Attach files via the paperclip button (max 5, 10MB each) or drag-and-drop. Images show inline previews; text files show code-block previews; binary files show download links.
- Use the **Instructions** toggle (gear icon) to set a system prompt for the conversation.
- Session management via collapsible sidebar: create, rename (double-click title), and delete sessions. On mobile (<768px) the sidebar becomes a drawer overlay.
- Fork, share (copy link to clipboard), and compact conversations via header action buttons.
- Footer reads "OpenCode Chat".

**API**: Uses `GET /api/v1/settings/chat-config` to fetch sanitized provider/agent/model data. Messages are sent through OpenCode's native session `send()` API with provider/model selection.

## Settings

**What it does**: Global application settings management. Configure archive retention, an arbitrary OpenCode-compatible provider catalog, Ingenium provider roles, and synthesis interval.

**How to use**:
- Navigate to `/settings` in the dashboard
- **Archive retention**: Set the number of days projects stay in the archive (1-365)
- **Providers**: Add, reorder, collapse, enable, and remove provider blocks. Each block owns its OpenCode ID, npm package, base URL, API key, and model list
- **Provider drafts**: Changes made in the PipelinePanel (Providers tab) are local state — they survive tab switches within the Settings overlay (e.g., switching from Providers → General → back to Providers) because inactive tab panels are hidden (via `hidden` + `inert`), not unmounted. However, closing the overlay discards all unsaved provider edits. Click "Save providers" to persist to the API.
- **Provider roles**: Mark one block as Ingenium primary and one as backup; all remaining blocks stay available in OpenCode
- **Credentials**: API keys are never returned by the API or written to OpenCode config; saved keys are represented by an `apiKeySet` placeholder
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

## Secrets

**What it does**: Encrypted secrets vault — password manager with scrypt key derivation and AES-256-GCM. Stores sensitive credentials (API keys, passwords, tokens) in folders, secured by a user-chosen passphrase that is never stored server-side.

**How to use**:
- Navigate to `/secrets` in the dashboard
- **First-run (vault not initialized)**: The page shows a "Create Your Vault" button. Clicking opens the **CreateVaultModal** — a passphrase creation dialog with two password fields (passphrase + confirmation), a warning banner about non-recoverability, an acknowledgement checkbox, and a "Create & Unseal Vault" submit button. The submit is gated on: passphrase ≥12 characters, both fields match, and the acknowledgement checkbox checked.
- **Routine access (vault initialized but sealed)**: The page shows an "Unseal Vault" button. The **UnsealModal** is a simpler dialog with a single passphrase input and "Unseal Vault" button. On failure, shows a red error message.
- **Unsealed state**: A 3-pane layout appears — FolderTree (left), ItemList (center), ItemDetail (right). Use the "Lock Vault" button in the header to re-seal. Items can be created, read, updated, and deleted.
- **CreateVaultModal validation states**:
  - **Empty**: No input yet; fields show placeholder text "At least 12 characters"
  - **Too short**: When passphrase length > 0 but < 12, shows red "(n/12)" counter
  - **Mismatch**: When both fields have values and they differ, shows "Passphrases do not match" in red
  - **Match + valid**: When both match and length ≥ 12, shows a green checkmark and "Passphrases match"
  - **Checkbox gated**: Submit button remains disabled until the acknowledgement is checked AND passphrases are valid

**API**: `GET /api/v1/vault/status`, `POST /api/v1/vault/initialize`, `POST /api/v1/vault/unseal`, `POST /api/v1/vault/seal`, `GET /api/v1/vault/folders`, `GET /api/v1/vault/items`, `POST /api/v1/vault/items`, `PATCH /api/v1/vault/items/:id`, `DELETE /api/v1/vault/items/:id`, `POST /api/v1/vault/folders`, `DELETE /api/v1/vault/folders/:id`

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
