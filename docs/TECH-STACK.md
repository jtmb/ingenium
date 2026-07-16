# Tech Stack

- **Runtime**: Node.js 22+
- **Language**: TypeScript (strict mode, strictNullChecks)
- **Package Manager**: npm workspaces (monorepo)
- **API**: Express.js on port 4097, JSON body limit 2MB (`express.json({ limit: "2mb" })`), helmet + CORS middleware
- **Database**: SQLite via better-sqlite3 with WAL mode + FTS5 full-text search
- **MCP**: @modelcontextprotocol/sdk for stdio transport (73 tools)
- **Frontend**: Next.js 16 App Router, React 19, Tailwind CSS 4
- **Syntax Highlighting**: highlight.js (`github.css` + custom `hljs-dark.css`) — Preview and Source modes in skill detail overlay
- **State / Persistence**: Thread MCP server for cross-session context
- **Container**: Docker multi-stage build (node:22-alpine), supervisord (3 processes: API + Dashboard + opencode-web)
- **Packages**: `ingenium-core` (shared lib), `ingenium-extension` (client-side OpenCode — MCP server, observer plugin, skill-sync plugin, auto-observer thin trigger), `ingenium-email` (IMAP/SMTP client)
- **Testing**: Vitest, Playwright
- **Linting**: ESLint, TypeScript compiler
- **CI**: GitHub Actions (push to `ingenium-core`, `ingenium-api`, `ingenium-server`, `ingenium-dashboard`, `ingenium-extension`)

## Frontend

- **Dashboard**: Next.js 16 App Router, React 19, Tailwind CSS 4
- **Email Client**: imapflow (IMAP async client), nodemailer (SMTP), mailparser (MIME parsing), google-auth-library (Google OAuth2), @azure/msal-node (Microsoft OAuth2)

## Database Migrations

| # | Purpose |
|---|---------|
| 001 | Core tables: projects, skills, learnings, tasks, context, plugins, servers, settings |
| 002 | Soft-delete: `archived_at` column for projects + settings table |
| 003 | Agents table with permissions, model, skills columns |
| 004 | Learnings status: `status` column for processed/unprocessed tracking |
| 005 | Skills metadata: `tags`, `always_apply` columns |
| 006 | Skill file_tree: TEXT/JSON column for complete skill data round-trips |
| 007 | Observations table: background self-learning pipeline replacing learnings |
| 008 | Personality traits table for learned user preferences and behavior |
| 009 | Pipeline events table for observability timeline |
| 010 | Commands table for OpenCode slash-command management |
| 011 | Server source column: tracks whether MCP servers are `ingenium` or user-defined |
| 012 | Project `is_global` flag for cross-project shared resources |
| 013 | Fix plugins UNIQUE constraint: (project_id, name) instead of (name) |
| 014 | Configs table: store opencode.json/opencode.jsonc content for round-trip editing |
| 015 | Auto-observer source: add `auto-observer` to observations CHECK constraint |
| 016 | MCP tool states: per-project tool enable/disable persistence |
| 017 | Fix trait FK: rebuild personality_traits FK to current observations table after 015 |
| 018 | Extraction pipeline events: `extraction_completed`/`extraction_failed` event types |
| 019 | Trait exemplar FK ON DELETE SET NULL for safe observation deletion |
| 020 | Kanban board data layer — tasks hierarchy, time tracking, comments, activity, links, notifications, board_config |
| 021 | Agent job scheduler/runner — jobs, job_runs, and job_run_logs tables |
| 022 | Email cache for instant inbox loads — caches IMAP listings and bodies |
| 023 | Fix servers UNIQUE constraint: (project_id, name) instead of (name) |
| 024 | Fix skills UNIQUE constraint: (project_id, name) instead of (name) |
