# Ingenium Dashboard User Guide

Ingenium's dashboard provides visual management for all your AI agent development tools, including email client integration with Gmail and Outlook OAuth2 + IMAP/SMTP support. Access it at **http://localhost:3000** after starting the app.

## Getting Started

```bash
# Start all services (single container via supervisord)
docker compose up --build
```

Docker starts a single container running 4 processes under supervisord: API (:4097), Dashboard (:3000), opencode-server (:4096), and opencode-iframe (:4098). The MCP server exposes **73 tools** accessible via OpenCode-compatible clients. Build-time UID matching ensures write access to workspace.

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

## Projects

**What it does**: Browse and manage project configurations. Each project has its own context, skills, and observations isolated in per-project SQLite databases. Dashboard provides rich cards with statistics, expandable detail panels, and Active/Archived tab views.

**How to use**:
- View active projects as rich cards showing skills count, observations count, pipeline event count, and last synthesis timestamp
- Toggle to the "Archived" tab for archived projects
- Create a new project with a name (auto-resolved to UUID)
- Rename a project inline (PATCH /projects/:name)
- Archive a project (soft-deletes with timestamp; appears in Archived tab)
- Restore an archived project from the Archived tab
- Purge expired projects (configurable retention period in Settings)
- Click a project card to expand a detail panel showing recent skills, recent observations, and recent pipeline activity
- Delete a project with confirmation dialog (cannot be undone)
- Card hover shadow effect matches the skills page design

**API**: GET /api/v1/projects, POST /api/v1/projects, PATCH /api/v1/projects/:name, DELETE /api/v1/projects/:name, GET /api/v1/projects/archive, POST /api/v1/projects/:name/restore, POST /api/v1/projects/purge

**MCP Tools**: `ingenium_project_set_global` — marks a project as the global-default, enabling shared skill resolution and cross-project observation evaluation.

**Code**: services/ingenium-dashboard/src/app/projects/page.tsx → services/ingenium-api/routes/projects.ts → packages/ingenium-core/lib/tools/projects.ts

**Docs**: docs/HOW-TO/projects.md

## Skills

**What it does**: Browse and search all 25 AI agent skills stored in the database. Skills cover debugging, security, testing, conventions, and framework-specific patterns. Stored in split-skill format (SKILL.md + metadata.json + references/) with `file_tree` support for auxiliary files. Dashboard provides a split-pane skill viewer with collapsible file tree sidebar (FileTree component), inline editing per file, and highlight.js syntax highlighting in Preview/Source modes.

**How to use**:
- View all skills in the Skills tab (card grid, 3 columns on desktop)
- Search by name, tag, or keyword
- Click a skill card to open a split-pane overlay with:
  - **File tree** — left sidebar (FileTree component) navigates the skill's files as a collapsible tree (SKILL.md, metadata.json, references/)
  - **Content viewer** — right pane shows file content with syntax highlighting (highlight.js)
  - **Preview/Source toggle** — switch between rendered markdown and raw source
  - **Inline editing** — click Edit to modify any file directly in the overlay, Save persists to the DB via PATCH
- Upload a skill from a `.md` file (frontmatter-parsed) using the Upload button
- Skills auto-load on session start via /skill-load

**API**: GET /api/v1/skills, GET /api/v1/skills/:id, GET /api/v1/skills/search?q=..., POST /api/v1/skills, PATCH /api/v1/skills/:id

**Code**: services/ingenium-dashboard/src/app/skills/page.tsx → services/ingenium-api/routes/skills.ts → packages/ingenium-core/lib/tools/skills.ts

**Docs**: docs/HOW-TO/skills.md

## Learnings (Deprecated)

The `/learnings` page has been deprecated and redirects to `/observations`. See the [Observations](#observations) section for the current self-learning system.

**Docs**: docs/self-learning-pipeline.md

## Mail (Email Client)

**What it does**: IMAP/SMTP email client with OAuth2 authentication for Gmail and Outlook. Supports inbox viewing, compose new messages, search across emails, and account management via the Ingenium Dashboard at `/mail`. The email client uses imapflow for async IMAP operations, nodemailer for SMTP sending, mailparser for MIME parsing, google-auth-library for Google OAuth2 flow, and @azure/msal-node for Microsoft OAuth2. Credentials are encrypted with AES-256-GCM before storage (INGENIUM_EMAIL_ENCRYPTION_KEY).

**How to use**:
1. Navigate to `/mail` in the dashboard or OpenCode web UI at `http://localhost:4098/mail`
2. Click "Add Account" and select Gmail or Outlook provider
3. Complete OAuth2 flow (redirects to Google/Outlook auth, then back to callback)
4. Select email account from list after successful authentication
5. View inbox with folder navigation on left sidebar
6. Compose new messages using the compose button
7. Search emails by subject, sender, or body content

**OAuth2 Setup**: Before first use, configure OAuth2 credentials:
- **Gmail**: Create OAuth2 app at https://console.cloud.google.com/apis/credentials with redirect URI `http://localhost:3000/mail/oauth/callback`
- **Outlook**: Register Azure AD application with same callback URI

**API Endpoints**: `/api/v1/email/accounts`, `/api/v1/email/inbox/:accountId`, `/api/v1/email/messages/:accountId/search?q=...` (see services/ingenium-api/routes/email.ts)

**MCP Tools (13)**: `ingenium_email_list`, `ingenium_email_search`, `ingenium_email_read`, `ingenium_email_send`, `ingenium_email_draft`, `ingenium_email_folders`, `ingenium_email_accounts`, `ingenium_email_triage`, `ingenium_email_suggest`, `ingenium_email_draft_response`, `ingenium_email_patterns`, `ingenium_email_watch_start`, `ingenium_email_watch_status` — see packages/ingenium-email/lib/tools/*.ts for full reference. The email client tools are registered with the Ingenium MCP server and accessible via any OpenCode-compatible client connected to ingenium-server.

## Commands

**What it does**: Manage `.opencode/commands/` lifecycle through 5 MCP tools. Commands are captured in the DB layer (mirroring plugins) with migration `010_commands.sql` and core tools in `packages/ingenium-core/lib/tools/commands.ts`. No dedicated dashboard page — use MCP tools directly.

**How to use**:
- List all commands via `ingenium_command_list(project, limit)`
- Get a specific command by name via `ingenium_command_get(project, name)`
- Create a new command via `ingenium_command_create(project, name, filePath, sourceContent)`
- Update an existing command via `ingenium_command_update(project, name, file_path, source_content)`
- Delete a command via `ingenium_command_delete(project, name)`

**API**: GET /api/v1/commands, GET /api/v1/commands/:name, POST /api/v1/commands, PUT /api/v1/commands/:name, DELETE /api/v1/commands/:name

**Code**: services/ingenium-api/routes/commands.ts → packages/ingenium-core/lib/tools/commands.ts

**Migration**: `010_commands.sql` creates the commands table with project_id and name (unique) columns.

**Self-Learning**: Email interactions (account setup, OAuth2 flows, message composition patterns) are detected by the server-side extraction engine (Phase 0) which reads OpenCode messages. Manual `ingenium_observe()` calls are for exceptional cases only. See docs/HOW-TO/email.md for complete HOW-TO guide covering account setup, inbox management, compose flow, search patterns, MCP tools reference, and self-learning integration with the Ingenium pipeline.

**Code**: packages/ingenium-email/src (IMAP client: imapflow, SMTP server: nodemailer, MIME parser: mailparser), services/ingenium-api/routes/email.ts → services/ingenium-dashboard/src/app/mail/page.tsx

## Tasks

**What it does**: A full Kanban-style task board with todo → in_progress → review → done workflow. Tasks can have descriptions, files, labels, dependencies, and agent assignments.

**How to use**:
- View tasks by column (todo, in_progress, review, done)
- Create tasks with descriptions, labels, and file references
- Set dependencies to enforce execution order
- Move tasks through the workflow as work progresses

**API**: GET /api/v1/tasks, POST /api/v1/tasks, PUT /api/v1/tasks/:id, DELETE /api/v1/tasks/:id

**Code**: services/ingenium-dashboard/src/app/tasks/page.tsx → services/ingenium-api/routes/tasks.ts → packages/ingenium-core/lib/tools/tasks.ts

**Docs**: docs/HOW-TO/tasks.md

## Plugins

**What it does**: Manage OpenCode plugin lifecycle — enable, disable, and configure plugins. Track which plugins are active and their lifecycle hooks. When creating a plugin, the API auto-populates source from disk if `sourceContent` is omitted.

**How to use**:
- View all plugins with their current status
- Toggle plugins on/off
- See lifecycle hooks each plugin registers for
- Create a plugin by path reference: `ingenium_plugin_create(project, name, filePath)` — omitting `sourceContent` triggers auto-read from disk
- Edit a file-backed plugin: the Edit button fetches raw source from `GET /plugins/:name/source` when DB content is empty

**API**: GET /api/v1/plugins, GET /api/v1/plugins/:name/source, POST /api/v1/plugins/:id/activate, POST /api/v1/plugins/:id/deactivate

**Code**: services/ingenium-dashboard/src/app/plugins/page.tsx → services/ingenium-api/routes/plugins.ts → packages/ingenium-core/lib/tools/plugins.ts

**Docs**: docs/HOW-TO/plugins.md

## Required Skills

The Ingenium system uses skills to define agent behavior. Skills are organized in `.opencode/skills/` and loaded automatically based on `alwaysApply` flags, agent preflight directives, or AGENTS.md preflight check rules. The system includes 25 skills total.

### Mandatory Skills (All Agents)

These 8 skills are declared mandatory by `AGENTS.md` — all agents MUST load them before any action:

| Skill | Purpose | Why Required |
|-------|---------|-------------|
| `configuring-opencode` | OpenCode agent configuration, permission lockdown, skill reference conventions | Required for proper agent setup and YAML-frontmatter parsing |
| `debugging-patterns` | Debugging methods, error interpretation, self-correction patterns | Required for failure analysis and self-correction in all agents |
| `development-conventions` | Code conventions, API design, framework patterns, testing, refactoring | Required for consistent code quality across all implementation agents |
| `devops-conventions` | Docker, Kubernetes, shell scripts, CLI toolkit conventions | Required for infrastructure changes and deployment safety |
| `github-cli` | GitHub CLI usage for PRs, issues, releases, and git operations | Required for orchestrator commits and PR management |
| `local-models` | Command safety rules (no `&`, timeout wrappers), local model profiles | Required for safe terminal command execution and model behavior awareness |
| `mcp-tooling` | MCP tool integration, browser automation, Playwright patterns | Required for tool usage in dashboard verification and email workflows |
| `skill-maintenance` | Skill creation, detection, indexing, and audit workflows | Required for pattern detection and skill lifecycle management |

### Agent-Specific Skills

While all agents load from the mandatory set, each agent's `permission.skill` block selects a subset:

| Agent | Skills Loaded | Role |
|-------|--------------|------|
| `ingenium-orchestrator` | configuring-opencode, debugging-patterns, development-conventions, devops-conventions, github-cli, local-models, mcp-tooling, skill-maintenance | Primary coordinator — loads all 8 mandatory skills |
| `ingenium-software-engineer-premium` | configuring-opencode, debugging-patterns, development-conventions, devops-conventions, mcp-tooling | Complex implementation work |
| `ingenium-software-engineer-fast` | configuring-opencode, debugging-patterns, development-conventions, devops-conventions, mcp-tooling | Standard implementation work |
| `ingenium-qa` | debugging-patterns, development-conventions, devops-conventions, local-models, mcp-tooling | Code review and test verification |
| `ingenium-docs` | debugging-patterns, development-conventions, local-models, mcp-tooling, skill-maintenance | Documentation and skill management |
| `ingenium-security-auditor` | debugging-patterns, development-conventions, devops-conventions, github-cli, mcp-tooling | Security audit and leak detection |
| `ingenium-explore` | local-models | Read-only codebase exploration |
| `ingenium-scout` | local-models | RAG-aware research and memory |
| `ingenium-prompt-engineer` | *(none)* | Prompt analysis and improvement |

> **Note**: `ingenium-explore` and `ingenium-scout` only load `local-models` for local model safety constraints — they are read-only agents that don't modify files. The `ingenium-prompt-engineer` loads no skills; it operates as a pure prompt-rewriting tool.

### Optional Skills

These 16 skills provide guidance for specific contexts but are not required for core system function:

| Skill | When to Use |
|-------|-------------|
| `dashboard-screenshots` | When taking Playwright screenshots of dashboard pages for documentation |
| `database-conventions` | When working with SQLite, schema migrations, or database queries |
| `database-migration-management` | When managing SQL migration sequencing and application |
| `documentation-audit-workflow` | When auditing documentation quality across the project |
| `git-history-hygiene` | When rewriting git history, managing large files, or cleaning repos |
| `ingenium-ops` | When operating the Ingenium deployment (Docker, health checks, logs) |
| `language-conventions` | When writing polyglot code (Python, TypeScript, Go, Rust) |
| `local-persistence` | When working with local storage patterns beyond the SQLite backend |
| `onboard-existing-repo` | When integrating the Ingenium system into an existing codebase |
| `orchestrator-primer` | For new developers learning the orchestrator agent pipeline |
| `parallel-session-hygiene` | When running multiple OpenCode sessions concurrently |
| `per-project-scoping` | When isolating configuration by project context |
| `security-audit` | When auditing code for security vulnerabilities and leaked secrets |
| `self-learning` | Reference for the observation/synthesis pipeline (see `/pipeline`) |
| `sqlite-wal-safety` | When handling WAL mode, concurrent access, or database file operations |
| `uncensored-direct-response` | When bypassing safety filters for trusted development tasks |

## MCP (Servers + Tool Manager)

**What it does**: Configure and manage MCP servers and tools through a dual-tab page at `/mcp-servers`. The **Servers** tab manages MCP server lifecycle (add, start, stop). The **Tools** tab provides a categorized view of all 73 MCP tools across 15 categories with search, category filter, and per-tool or per-category enable/disable toggles. Tool state is checked at the MCP server level before each tool execution — a disabled tool returns a `TOOL_DISABLED` error instead of executing.

**Servers tab — How to use**:
- View all configured MCP servers with `source` badges: **External** (blue), **Enabled** (green, inherited from global project), **Running** (green, built-in proxy), **Stopped/Disabled** (gray)
- Add new server configurations with name and command
- See inherited servers from the global-default project marked as "Enabled"

**Tools tab — How to use**:
- View all 73 tools grouped into 15 categories (e.g., Settings, Skills, Projects, Email, Tasks, etc.)
- Search tools by name using the search box
- Filter by category using the dropdown (defaults to "All categories")
- Toggle individual tools on/off using the green/gray toggle switches
- Toggle entire categories on/off using the "Enable All" / "Disable All" buttons
- Stats bar shows enabled/disabled/total counts (`{enabled} enabled, {disabled} disabled, {total} total`)

**API** (Servers): GET /api/v1/servers, POST /api/v1/servers, POST /api/v1/servers/:id/start, POST /api/v1/servers/:id/stop
**API** (Tools): GET /api/v1/mcp-tools?project=...&include_categories=true, PUT /api/v1/mcp-tools/:name, PUT /api/v1/mcp-tools/category/:category

**Code**: services/ingenium-dashboard/src/app/mcp-servers/page.tsx → services/ingenium-api/routes/servers.ts (servers) + routes/mcp-tools.ts (tools) → packages/ingenium-core/lib/tools/servers.ts

**Docs**: docs/HOW-TO/servers.md

## Config

**What it does**: Manage OpenCode configuration via a dedicated `/config` dashboard page with tabbed editing. The `configs` table stores `opencode.json` (project-level) and `opencode.jsonc` (global) content in the DB, enabling round-trip editing through the dashboard and MCP tools. Global projects write skills, plugins, and commands to `/home/appuser/.config/opencode/` (configurable via `INGENIUM_GLOBAL_CONFIG_PATH`) instead of the project root.

**How to use**:
- Navigate to `/config` in the dashboard
- Use the **Project** tab to edit `opencode.json` for the active project
- Use the **Global** tab to edit `opencode.jsonc` for global configuration
- Click **Sync from disk** to reload config from the filesystem into the editor
- Click **Save** to persist editor content to the DB and write to disk
- Use MCP tools for direct programmatic access

**MCP Tools**:
| Tool | Purpose |
|------|---------|
| `ingenium_config_get` | Retrieve opencode config (project or global) |
| `ingenium_config_set` | Update opencode config content |
| `ingenium_config_sync` | Sync config between disk and DB (bidirectional) |

**API**: GET /api/v1/config, GET /api/v1/config/global, PUT /api/v1/config, PUT /api/v1/config/global, POST /api/v1/config/sync, POST /api/v1/config/global/sync

**Code**: services/ingenium-dashboard/src/app/config/page.tsx → services/ingenium-api/routes/config.ts → packages/ingenium-core/lib/tools/paths.ts

## Synthesis & Cross-Project Features

**What it does**: The synthesis pipeline processes observations into personality traits and skills. When configured with an LLM (Phase 2), the pipeline creates skills in standard split-skill format (SKILL.md + metadata.json + references/). Cross-project synthesis (Phase 3) evaluates patterns across multiple projects, promoting skills used in 2+ projects to global skills available to every project via the `global-default` project.

**How to use**:
- Observations are automatically processed via the scheduled synthesis pipeline (every 15 minutes)
- Trigger manual synthesis via `ingenium_synthesis_run` for the current project
- Use `ingenium_synthesis_cross_project` to evaluate observations and skills across all active projects
- Global skills are created in the `global-default` project and shared across all projects
- New projects automatically load global skills from the `global-default` project
- Configure a **backup LLM provider** (Settings → Synthesis LLM) — if the primary provider fails, the pipeline automatically falls back to the backup. Both providers can be tested independently via Test Connection.

**Split-skill output (LLM Phase 2):** When the LLM creates skills, it groups related concepts into one skill with multiple reference files rather than creating many small single-concept skills. All synthesized skill names use the `llm-synthesized` prefix (e.g., `llm-synthesized-email-workflows`).

**Backup Provider Settings**:
| Setting Key | Description |
|------------|-------------|
| `synthesis_backup_provider` | Backup provider ID (e.g., `deepseek`, or `__custom__`) |
| `synthesis_backup_model` | Backup model ID |
| `synthesis_backup_endpoint` | Backup OpenAI-compatible API URL |
| `synthesis_backup_api_key` | Backup API key |

**MCP Tools**:
| Tool | Purpose |
|------|---------|
| `ingenium_synthesis_run` | Trigger synthesis for the current project |
| `ingenium_synthesis_cross_project` | Trigger cross-project synthesis across all active projects |
| `ingenium_project_set_global` | Mark a project as global-default for shared skill resolution |

**API**: POST /api/v1/synthesis/run, GET /api/v1/synthesis/status

**Code**: services/ingenium-api/routes/synthesis.ts → packages/ingenium-core/lib/tools/synthesis.ts

## Personality

**What it does**: View and manage the system's learned understanding of the user. The personality system tracks 6 developer-specific trait dimensions with confidence scores, surfacing only display-worthy traits (confidence ≥ 0.30) by default.

**How to use**:
- Navigate to `/personality` in the dashboard
- View active traits grouped by type with confidence bars (0.0–1.0)
- Toggle sort between "Grouped by type" and "Newest first"
- Traits start at low confidence (0.05–0.15) and require 2+ confirming observations to reach display threshold (0.30)
- Confidence is capped at 0.95; unused traits lose 0.05 after 7+ days (decay)
- Click the **×** button on any trait card to dismiss it (marks `is_active = 0`)
- Hidden traits (confidence below 0.30) can be toggled via the "N hidden" link at the bottom of the profile
- Click any trait for a detail overlay showing exemplar observations, metadata, and confidence breakdown
- The 6 trait dimensions tracked:
  - **communication_style** — How the user prefers to communicate (direct, detailed, concise)
  - **code_preference** — Code style, formatting, and language preferences
  - **workflow_pattern** — Recurring workflows and multi-step processes
  - **feedback_style** — How the user gives feedback (corrective, confirmatory)
  - **interaction_pattern** — How the user interacts with agents (frequent checks, batch operations)
  - **priority_signal** — What the user prioritizes (performance, correctness, speed)

**API**: GET /api/v1/personality, GET /api/v1/personality/profile, POST /api/v1/personality, POST /api/v1/personality/:id/disable, POST /api/v1/personality/:id/enable

**Code**: services/ingenium-dashboard/src/app/personality/page.tsx → services/ingenium-api/routes/personality.ts → packages/ingenium-core/lib/tools/personality.ts

**Docs**: docs/self-learning-pipeline.md

## Observations

**What it does**: Full-text searchable observation log with 10 types. Observations track user behavior, preferences, corrections, patterns, errors, and goals. The self-learning pipeline processes them into personality traits and skills.

**How to use**:
- Navigate to `/observations` in the dashboard
- View observations in a paginated list with type badges and importance scores
- Use the FTS5 search box for full-text search (supports prefix*, phrase "search", -negation)
- Filter by status (`pending`, `processed`, `skipped`, `failed`) and type (`correction`, `preference`, etc.)
- Click any observation to view full details

**Observation types**: correction, preference, pattern, insight, feedback, behavior, terminology, workflow, error, goal

**API**: GET /api/v1/observations, POST /api/v1/observations, GET /api/v1/observations/search?q=..., GET /api/v1/observations/stats

**MCP Tools**: `ingenium_observe`, `ingenium_observation_search`, `ingenium_observation_list`, `ingenium_observation_stats`

**Code**: services/ingenium-dashboard/src/app/observations/page.tsx → services/ingenium-api/routes/observations.ts → packages/ingenium-core/lib/tools/observations.ts

**Docs**: docs/self-learning-pipeline.md

---

## Pipeline

**What it does**: A real-time Git-workflow-style timeline of all self-learning pipeline events. Every observation, synthesis run, trait creation, and plugin event is displayed in a connected vertical timeline with color-coded nodes.

**How to use**:
- Navigate to `/pipeline` in the dashboard
- Events auto-poll every 3 seconds (pause/resume button available)
- Filter events using pill buttons: All, Agent, Plugin, Synthesis, Trait
- Events within the same 60-second window are collapsed into **+N groups**
- Click any event card for a **detail overlay** with raw JSON data
- Each event is color-coded by source: orange (agent), blue (plugin), green (synthesis), purple (trait)

**16 event types**: `session_created`, `session_idle`, `extraction_completed`, `extraction_failed`, `observation_created`, `observation_imported`, `synthesis_triggered`, `synthesis_started`, `synthesis_completed`, `synthesis_failed`, `trait_created`, `trait_updated`, `skill_created`, `skill_updated`, `plugin_initialized`, `plugin_error`

**Enriched event data**: `synthesis_completed` events carry full pipeline metadata (model name, endpoint URL, provider ID, LLM-generated insights). `trait_created` events link back to parent observations (`observation_ids`) and include model attribution and skill references. Pipeline stats include a skills count alongside observation and trait counts.

**API**: GET /api/v1/pipeline/events, GET /api/v1/pipeline/timeline, POST /api/v1/pipeline/events

**Code**: services/ingenium-dashboard/src/app/pipeline/page.tsx → services/ingenium-api/routes/pipeline.ts → packages/ingenium-core/lib/tools/pipeline-events.ts

**Docs**: docs/self-learning-pipeline.md

---

## Settings

**What it does**: Global application settings management. Configure archive retention period, synthesis LLM provider, backup provider, and synthesis interval.

**How to use**:
- Navigate to `/settings` in the dashboard
- **Archive retention**: Set the number of days projects stay in the archive before permanent deletion (1-365)
- **Synthesis LLM**: Select an LLM provider for Phase 2 skill synthesis:
  - Choose from detected OpenCode providers or use Custom Provider
  - Enter API key and endpoint URL
  - Click "Test Connection" to verify the provider works
  - Save to persist the configuration
- **Backup Provider**: Optionally configure a fallback LLM provider (same configuration shape)
  - If the primary LLM fails, the pipeline automatically falls back to the backup
- **Synthesis Interval**: Set how often the synthesis pipeline runs (5 min, 15 min, 30 min, 1 hour, 4 hours, or Disabled)

**Settings stored globally**: All synthesis settings are stored under the `global-default` project, affecting all projects.

**API**: GET /api/v1/settings/:key, PUT /api/v1/settings/:key

**MCP Tools**: `ingenium_setting_get`, `ingenium_setting_set`

**Code**: services/ingenium-dashboard/src/app/settings/page.tsx → packages/ingenium-core/lib/tools/settings.ts

**Docs**: docs/HOW-TO/settings.md, docs/HOW-TO/synthesis.md

---

## Agents

**What it does**: Manage AI agent profiles — create, enable, disable, and configure agent profiles. Each agent has a model assignment, access permissions, category, and skill bindings.

**How to use**:
- Navigate to `/agents` in the dashboard
- View all 10 agent profiles with their model, mode, and enabled status
- Enable/disable agents to control which are active
- Filter agents by category (primary, research, execution, security)
- Agents sync their `.md` files to disk for OpenCode loading

**API**: GET /api/v1/agents, GET /api/v1/agents/:name, POST /api/v1/agents, PATCH /api/v1/agents/:name, DELETE /api/v1/agents/:name, POST /api/v1/agents/:name/enable, POST /api/v1/agents/:name/disable

**MCP Tools**: `ingenium_agent_list`, `ingenium_agent_get`, `ingenium_agent_create`, `ingenium_agent_update`, `ingenium_agent_delete`, `ingenium_agent_enable`, `ingenium_agent_disable`, `ingenium_agent_sync`

**Code**: services/ingenium-dashboard/src/app/agents/page.tsx → services/ingenium-api/routes/agents.ts → packages/ingenium-core/lib/tools/agents.ts

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

# Get project config
curl http://localhost:4097/api/v1/config

# Get global config
curl http://localhost:4097/api/v1/config/global

# List email accounts (if configured)
curl http://localhost:4097/api/v1/email/accounts

# List all commands
curl http://localhost:4097/api/v1/commands

# Trigger synthesis
curl -X POST http://localhost:4097/api/v1/synthesis/run

# Check synthesis status
curl http://localhost:4097/api/v1/synthesis/status
```

See each HOW-TO doc for the full API reference for each feature.
