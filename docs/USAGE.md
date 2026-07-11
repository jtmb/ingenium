# Ingenium Dashboard User Guide

Ingenium's dashboard provides visual management for all your AI agent development tools, including email client integration with Gmail and Outlook OAuth2 + IMAP/SMTP support. Access it at **http://localhost:3000** after starting the app.

## Getting Started

```bash
# Start all services (single container via supervisord)
docker compose up --build
```

Docker starts a single container running 4 processes under supervisord: API (:4097), Dashboard (:3000), opencode-server (:4096), and opencode-iframe (:4098). The MCP server exposes 76 tools accessible via OpenCode-compatible clients. Build-time UID matching ensures write access to workspace.

## Projects

**What it does**: Browse and manage project configurations. Each project has its own context, skills, and learnings isolated in per-project SQLite databases. Dashboard provides Active/Archived tab views with inline rename, archive/unarchive, and purge actions.

**How to use**:
- View active projects or toggle to the "Archived" tab for archived projects
- Create a new project with a name (auto-resolved to UUID)
- Rename a project inline (PATCH /projects/:name)
- Archive a project (soft-deletes with timestamp; appears in Archived tab)
- Restore an archived project from the Archived tab
- Purge expired projects (configurable retention period in Settings)

**API**: GET /api/v1/projects, POST /api/v1/projects, PATCH /api/v1/projects/:name, DELETE /api/v1/projects/:name, GET /api/v1/projects/archive, POST /api/v1/projects/:name/restore, POST /api/v1/projects/purge

**Code**: services/ingenium-dashboard/src/app/projects/page.tsx → services/ingenium-api/routes/projects.ts → packages/ingenium-core/lib/tools/projects.ts

**Docs**: docs/HOW-TO/projects.md

## Skills

**What it does**: Browse and search all 22 AI agent skills stored in the database. Skills cover debugging, security, testing, conventions, and framework-specific patterns. Stored in split-skill format (SKILL.md + metadata.json + references/) with `file_tree` support for auxiliary files. Dashboard provides a split-pane skill viewer with collapsible file tree sidebar (FileTree component), inline editing per file, and highlight.js syntax highlighting in Preview/Source modes.

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

## Learnings

**What it does**: Log, search, and discover patterns in your learnings. Uses FTS5 full-text search with type/tag categorization. The self-improving knowledge base.

**How to use**:
- View recent learnings in the Learnings tab
- Search with FTS5 queries (prefix*, phrase "search", -negation)
- Filter by type (skill, agent, hook, plugin, config, architecture, bug, pattern)

**API**: GET /api/v1/learnings, POST /api/v1/learnings, SEARCH /api/v1/learnings/search?q=...

**Code**: services/ingenium-dashboard/src/app/learnings/page.tsx → services/ingenium-api/routes/learnings.ts → packages/ingenium-core/lib/tools/learnings.ts

**Docs**: docs/HOW-TO/learnings.md

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

**MCP Tools**: `email_account_list`, `email_compose_message`, `email_search_inbox`, `email_fetch_messages` — see packages/ingenium-email/lib/tools/*.ts for full reference. The email client tools are registered with the Ingenium MCP server and accessible via any OpenCode-compatible client connected to ingenium-server.

**Command Tools**: `ingenium_command_list`, `ingenium_command_get`, `ingenium_command_create`, `ingenium_command_update`, `ingenium_command_delete` — manage `.opencode/commands/` lifecycle through the DB layer. No dedicated dashboard page — use MCP tools directly (see Commands section above).

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

**Self-Learning**: Email interactions (account setup, OAuth2 flows, message composition patterns) trigger observations logged by the Observer plugin during session events. Use `ingenium_observe(observation_type="preference", content="<email workflow observation>", importance=5)` after configuring email accounts or discovering useful workflows. See docs/HOW-TO/email.md for complete HOW-TO guide covering account setup, inbox management, compose flow, search patterns, MCP tools reference, and self-learning integration with the Ingenium pipeline.

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

**What it does**: Manage OpenCode plugin lifecycle — enable, disable, and configure plugins. Track which plugins are active and their lifecycle hooks.

**How to use**:
- View all plugins with their current status
- Toggle plugins on/off
- See lifecycle hooks each plugin registers for

**API**: GET /api/v1/plugins, POST /api/v1/plugins/:id/activate, POST /api/v1/plugins/:id/deactivate

**Code**: services/ingenium-dashboard/src/app/plugins/page.tsx → services/ingenium-api/routes/plugins.ts → packages/ingenium-core/lib/tools/plugins.ts

**Docs**: docs/HOW-TO/plugins.md

## Required Skills

The Ingenium system uses skills to define agent behavior. Skills are organized in `.opencode/skills/` and loaded automatically based on `alwaysApply` flags, agent preflight directives, or AGENTS.md preflight check rules. The system includes 22 skills total.

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

These 14 skills provide guidance for specific contexts but are not required for core system function:

| Skill | When to Use |
|-------|-------------|
| `database-conventions` | When working with SQLite, schema migrations, or database queries |
| `documentation-audit-workflow` | When auditing documentation quality across the project |
| `git-history-hygiene` | When rewriting git history, managing large files, or cleaning repos |
| `ingenium-ops` | When operating the Ingenium deployment (Docker, health checks, logs) |
| `language-conventions` | When writing polyglot code (Python, TypeScript, Go, Rust) |
| `local-persistence` | When working with local storage patterns beyond the SQLite backend |
| `onboard-existing-repo` | When integrating the Ingenium system into an existing codebase |
| `orchestrator-primer` | For new developers learning the orchestrator agent pipeline |
| `parallel-session-hygiene` | When running multiple OpenCode sessions concurrently |
| `per-project-scoping` | When isolating configuration by project context |
| `self-learning` | Reference for the observation/synthesis pipeline (see `/pipeline`) |
| `sqlite-wal-safety` | When handling WAL mode, concurrent access, or database file operations |
| `test-debug` | When debugging test failures or writing test infrastructure |
| `uncensored-direct-response` | When bypassing safety filters for trusted development tasks |

## Servers

**What it does**: Configure and manage MCP servers through a proxy engine. Start, stop, restart, and monitor MCP server configurations.

**How to use**:
- View all configured MCP servers
- Start/stop servers through the proxy engine
- View server status and logs
- Add new MCP server configurations

**API**: GET /api/v1/servers, POST /api/v1/servers, POST /api/v1/servers/:id/start, POST /api/v1/servers/:id/stop

**Code**: services/ingenium-dashboard/src/app/servers/page.tsx → services/ingenium-api/routes/servers.ts → packages/ingenium-core/lib/tools/servers.ts

**Docs**: docs/HOW-TO/servers.md

## API Access

All dashboard features are backed by a REST API on port 4097. You can use the API directly:

```bash
# List all projects
curl http://localhost:4097/api/v1/projects

# Search learnings
curl "http://localhost:4097/api/v1/learnings/search?q=debugging"

# Get all skills
curl http://localhost:4097/api/v1/skills

# List email accounts (if configured)
curl http://localhost:4097/api/v1/email/accounts
```

See each HOW-TO doc for the full API reference for each feature.
