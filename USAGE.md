# Ingenium Dashboard User Guide

Ingenium's dashboard provides visual management for all your AI agent development tools, including email client integration with Gmail and Outlook OAuth2 + IMAP/SMTP support. Access it at **http://localhost:3000** after starting the app.

## Getting Started

```bash
# Local development
./run.sh dev

# Or Docker
docker compose up --build
```

This starts 4 services: API (port 4097), Dashboard (port 3000), MCP Server (stdio-ready, 61 tools), and email client OAuth2 endpoints. For Docker, a single container runs all via supervisord: API (:4097), Dashboard (:3000), opencode-server (:4096). Build-time UID matching ensures write access to workspace.

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

**What it does**: Browse and search all 17 AI agent skills stored in the database. Skills cover debugging, security, testing, conventions, and framework-specific patterns. Stored in split-skill format (SKILL.md + metadata.json + references/) with `file_tree` support for auxiliary files. Dashboard provides a split-pane skill viewer with collapsible file tree sidebar (FileTree component), inline editing per file, and highlight.js syntax highlighting in Preview/Source modes.

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
