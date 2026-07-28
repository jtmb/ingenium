---
title: Dashboard User Guide
description: Complete user guide for the Ingenium dashboard — all features, pages, and API access.
---

# Ingenium Dashboard User Guide

Ingenium's dashboard provides visual management for all your AI agent development tools, including email client integration with Gmail and Outlook OAuth2 + IMAP/SMTP support. Access it at **http://localhost:3000** after starting the app. Port `3000` is the local gateway and is reachable from Windows through WSL localhost forwarding without an HTTP Basic Auth prompt. The dashboard proxy authenticates to the private bearer-protected API server-side; the browser does not receive an API token. Do not use this plain-HTTP profile for LAN or remote access.

## Getting Started

```bash
# Production — single container via supervisord
docker compose up --build
```

Docker starts a single container running 4 processes under supervisord: API (:4097), Dashboard (:3000), opencode-web (internal :4098), and ttyd-opencode (internal :4099). Browser access uses the local `localhost:3000` dashboard root and `opencode.localhost:3000` / `cli.localhost:3000` OpenCode roots without browser credentials. Direct 4098/4099 access is not supported. The built-in MCP catalog contains **269 tools** across **28 baseline categories** (266 server registrations plus 3 extension tools); project-scoped child discovery can add tools and categories at runtime. Build-time UID matching ensures write access to workspace.

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

The extension package ships three OpenCode plugins — `observer.ts` (session event handling + synthesis triggering), `resource-sync.ts` (manifest-based bidirectional sync for skills, agents, plugins, commands, and config), and `auto-observer.ts` (automatic behavior pattern detection from OpenCode message history). Reference them in your OpenCode config:

```jsonc
{
  "plugin": [
    "packages/ingenium-extension/observer.ts",
    "packages/ingenium-extension/resource-sync.ts",
    "packages/ingenium-extension/auto-observer.ts"
  ]
}
```

### Routes

The Ingenium Dashboard provides **21 primary routes** plus the Settings overlay:

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
| `/context` | Immutable context conversation memory |
| `/pipeline` | Pipeline event timeline |
| `/usage` | Provider-neutral project usage totals, daily UTC series, breakdowns, freshness, filters, and CSV export |
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

**What it does**: View and manage the system's learned understanding of the user. The personality system tracks 10 developer-specific trait dimensions with confidence scores.

**How to use**:
- Navigate to `/personality` in the dashboard
- View active traits grouped by type with confidence bars (0.0–1.0), split into established (≥ 0.30) and emerging (< 0.30) traits
- Click the **×** button on any trait card to dismiss it (marks `is_active = 0`)
- Emerging traits remain visible by default in the "Emerging traits — awaiting confirmation" section, including their current confidence

## Observations

**What it does**: Full-text searchable observation log with 10 types. Observations track user behavior, preferences, corrections, patterns, errors, and goals.

**How to use**:
- Navigate to `/observations` in the dashboard
- View observations in a paginated list with type badges and importance scores
- Use the FTS5 search box for full-text search (supports prefix*, phrase "search", -negation)
- Filter by status and type

## Context

**What it does**: Browse immutable, project-scoped context conversations. The
conversation index deliberately exposes metadata only; message content is loaded
only after selecting a conversation or running a bounded in-conversation search.

**How to use**:
- Navigate to `/context`. The page uses the active project from the project dropdown; project selection is preserved in the route query when present.
- Choose a conversation from the responsive index to inspect its ordered message timeline and checkpoint history.
- Use **Search** to find messages within the selected conversation. Search results are explicit content retrievals, not content returned by the index.
- Select **Restore as new conversation** on a checkpoint to branch a new immutable conversation at that checkpoint. The source conversation and checkpoint remain unchanged.
- Loading, unavailable, and empty states describe whether a project has no conversations or the dashboard could not reach the API.

**API**: Uses the project-scoped immutable conversation endpoints under `/api/v1/context/conversations`. See [API Reference](../develop/api.md#context--canonical-agent-memory) for the endpoint contract.

## Pipeline

**What it does**: A real-time Git-workflow-style timeline of all self-learning pipeline events. Every observation, synthesis run, trait creation, and plugin event is displayed in a connected vertical timeline with color-coded nodes.

**How to use**:
- Navigate to `/pipeline` in the dashboard
- Events auto-poll every 3 seconds (pause/resume button available)
- Filter events using pill buttons: All, Agent, Plugin, Synthesis, Trait

## Usage

Navigate to `/usage` to view the active project's provider-neutral telemetry.
The page shows requests, required numeric token totals and input/output,
reported cache use/read/write state, cost availability, daily UTC charts,
provider/model breakdowns, filters, freshness, and CSV export. Cache state is
never turned into an inferred provider hit-rate or miss. Cost and cache values
that the source did not report are shown as unknown/not reported rather than
zero. Credentials and API tokens are never exposed.

Usage collection reads assistant `step-finish` metadata only. An OpenCode
project must have an explicit mapping to the active Ingenium project; unmapped
sessions are quarantined and never fall back to `global-default`. See
[Usage Telemetry](usage.md) for mapping, partial-cost, UTC, and export details.

## Chat

**What it does**: Standalone conversational AI interface using OpenCode's native chat API. Separated from the `/opencode` OpenCode Web/CLI iframe page.

**How to use**:
- Navigate to `/chat` in the dashboard
- Select a **Provider**, **Model**, and **Agent** from the header selectors. The provider/model pair is persisted only through the authenticated Chat-selection endpoint after exact validation against the current server catalog; browser localStorage is not authoritative. Selectors are disabled (`opacity-40 cursor-not-allowed`) when loading, when the chat config API failed, or when no providers are available. Providers with `source === "builtin"` show a **"(Free)"** badge — these are auto-discovered from the OpenCode Zen built-in provider (free tier, no API key required).
- **No LLM configured state**: When no providers exist (`isConfigured === false`), a blue info banner links to Settings → Providers. The send button is blocked, all selectors are disabled, and the composer has `hasSelectableModel={false}` preventing sends. Once a provider is configured and saved, selectors populate dynamically from `GET /api/v1/opencode/chat-config`. OpenCode live-reloads provider config changes — no restart required.
- Attach files via the paperclip button (max 5, 10MB each) or drag-and-drop. Images show inline previews; text files show code-block previews; binary files show download links.
- Use the **Instructions** toggle (gear icon) to set a system prompt for the conversation.
- Session management via collapsible sidebar: create, rename (double-click title), and delete sessions. On mobile (<768px) the sidebar becomes a drawer overlay.
- Fork, share (copy link to clipboard), and compact conversations via header action buttons.
- Provider-emitted reasoning appears live in a separate escaped plain-text disclosure above the assistant answer. OpenCode v1.18.3 identifies the reasoning part in `message.part.updated` before sending its `field: "text"` deltas, and Chat uses that authoritative part mapping to keep reasoning out of the rendered Markdown answer and copy. The disclosure remains open while streaming, then becomes user-toggleable after the terminal event.
- Tool calls appear as compact trace rows with a friendly tool label and short argument summary. **Web Search is the sole exception**: its row provides an accessible inline disclosure of the actual query (keyboard support and `aria-expanded` state). When the provider returns concrete sites, only validated `http`/`https` URLs are disclosed, grouped as **Visited**, **Results**, or **Sites**; query text cannot fabricate a site, and result titles/arbitrary payload fields are omitted. External links open with `target="_blank"` and `rel="noopener noreferrer"`. All other tools remain non-interactive compact traces; detailed payload, status, timing, output, and error metadata are not shown in the trace.
- Open the **Activity** drawer from a selected assistant tool activity to inspect a chronological timeline of reasoning, response text, and tool events. The modal traps focus, restores focus on close, supports `Escape` and backdrop dismissal, and is full-width on small screens.
- Assistant prose, reasoning, stream activity/errors, generated attachments, Chat-only Markdown callouts, and agent permission/question prompts use borderless, background-free plain flow. User-message bubbles retain their selected-surface styling; Docs Markdown callouts are unaffected.
- Footer reads "OpenCode Chat".

**API**: Uses `GET /api/v1/opencode/chat-config` to fetch allowlisted provider/model and agent data, then `PUT /api/v1/opencode/chat-selection` for the authenticated, catalog-gated global selection. Chat opens the per-session SSE stream before posting a prompt; the prompt endpoint returns HTTP `202` as an acceptance acknowledgement, while SSE is the authoritative channel for response content and terminal status. Docs AI resolves this server-owned global selection and does not accept a browser provider/model override.

## Settings

**What it does**: Opens the full-screen Settings overlay on the current dashboard route. The overlay is URL-driven, so a panel can be bookmarked or shared with `/?settings=<panel>` (or the same query on another dashboard route).

**How to use**:
- Open the gear from a supported dashboard route. The launcher selects the tab associated with that route; explicit `settings` values take precedence.
- Select a tab in the desktop sidebar or the category dropdown on smaller screens. Changing tabs replaces only the query parameter and preserves the current pathname and other query parameters.
- Close the overlay with the close button, the backdrop, or `Escape`. Closing removes `settings` and returns focus to the previous element. `/settings` is a compatibility entrypoint that redirects to `/?settings=general`.
- Without a `settings` parameter the overlay is closed. An unknown panel ID keeps the overlay open and falls back to the tab associated with the current pathname.

### Settings deep links

All 14 supported panel IDs are:

| Deep link | Panel behavior | Full workspace |
|---|---|---|
| `general` | Edit theme and archive-retention days (1–365). | — |
| `projects` | Route-linked summary for project management. | `/projects` |
| `skills` | Route-linked summary for skills, governance, versions, and sync. | `/skills` |
| `tasks` | Route-linked summary for task creation, prioritization, and tracking. | [`/tasks`](./tasks.md) |
| `jobs` | Route-linked summary for scheduled jobs, runs, and execution logs. | [`/jobs`](../operations/jobs.md) |
| `plugins` | Route-linked summary for plugin creation and lifecycle management. | [`/plugins`](../configure/plugins.md) |
| `mail` | Configure global mail OAuth credentials, sync/cache windows, and smart replies. | — |
| `agents` | Route-linked summary for agent profiles, categories, content, and availability. | [`/agents`](../configure/agents.md) |
| `mcp-servers` | Route-linked summary for MCP servers and the enabled tool catalog. | [`/mcp-servers`](../configure/mcp-servers.md) |
| `config` | Open the project/global OpenCode configuration editor. | [`/config`](../configure/config.md) |
| `observations` | Route-linked read-only view of self-learning observations with filters. | `/observations` |
| `personality` | Route-linked view for learned personality traits. | `/personality` |
| `providers` | Manage native OpenCode connections, custom provider blocks, Ingenium primary/backup roles, and synthesis interval. | — |
| `logs` | Route-linked live system-log and diagnostics view. | `/logs` |

Use a deep link such as `/?settings=providers`. Route-linked panels intentionally do not duplicate their management UI: **Open workspace** navigates to the dedicated route, which retains that route's data loading, authorization, mutation flows, and responsive behavior. The `config` panel is also a compact launcher for `/config`.

**Provider drafts**: Changes made in the Providers panel are local state and survive tab switches because inactive panels remain mounted but hidden/inert. Closing the overlay discards unsaved provider edits; click **Save providers** to persist them.
**Provider credentials**: API keys are never returned by the API or written to OpenCode config; saved keys are represented by an `apiKeySet` placeholder.

## Agents

**What it does**: Manage AI agent profiles — create, enable, disable, and configure agent profiles. Each agent has a model assignment, access permissions, category, and skill bindings.

**How to use**:
- Navigate to `/agents` in the dashboard
- View all agent profiles with their model, mode, and enabled status
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

All dashboard features are backed by the authenticated bearer boundary on
`127.0.0.1:4097` (Nginx forwards to private Express port `4096` in Docker).
Direct calls require a token. Keep the bearer header in an owner-only curl
config file (mode `0600`) or an equivalent secret-store helper; never put
token bytes in shell arguments or history:

```bash
API_CURL_CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}/ingenium/api-curl.conf"

# List all projects
curl --config "$API_CURL_CONFIG" http://localhost:4097/api/v1/projects

# Get all skills
curl --config "$API_CURL_CONFIG" http://localhost:4097/api/v1/skills

# Search observations
curl --config "$API_CURL_CONFIG" "http://localhost:4097/api/v1/observations/search?q=indentation"

# Get personality profile
curl --config "$API_CURL_CONFIG" http://localhost:4097/api/v1/personality/profile

# Get pipeline timeline
curl --config "$API_CURL_CONFIG" "http://localhost:4097/api/v1/pipeline/timeline?limit=20"

# Trigger synthesis
curl --config "$API_CURL_CONFIG" -X POST http://localhost:4097/api/v1/synthesis/run
```

Provision the curl config from the secret store rather than interpolating the
token into a command. Keep it local, ignored, and mode `0600`.

See each HOW-TO doc for the full API reference for each feature.
