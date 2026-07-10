# Tech Stack

- **Runtime**: Node.js 22+
- **Language**: TypeScript (strict mode, strictNullChecks)
- **Package Manager**: npm workspaces (monorepo)
- **API**: Express.js on port 4097, JSON body limit 2MB (`express.json({ limit: "2mb" })`), helmet + CORS middleware
- **Database**: SQLite via better-sqlite3 with WAL mode + FTS5 full-text search
- **MCP**: @modelcontextprotocol/sdk for stdio transport (48 tools)
- **Frontend**: Next.js 16 App Router, React 19, Tailwind CSS 4
- **Syntax Highlighting**: highlight.js (`github.css` + custom `hljs-dark.css`) — Preview and Source modes in skill detail overlay
- **State / Persistence**: Thread MCP server for cross-session context
- **Container**: Docker multi-stage build (node:22-alpine), supervisord (3 processes: API + Dashboard + opencode-server)
- **Testing**: Vitest, Playwright
- **Linting**: ESLint, TypeScript compiler
- **CI**: GitHub Actions (push to `ingenium-core`, `ingenium-api`, `ingenium-server`, `ingenium-dashboard`)

## Frontend

- **Dashboard**: Next.js 16 App Router, React 19, Tailwind CSS 4
- **Email Client**: imapflow (IMAP async client), nodemailer (SMTP), mailparser (MIME parsing), google-auth-library (Google OAuth2), @azure/msal-node (Microsoft OAuth2)

## Database Migrations

| # | File | Purpose |
|---|------|---------|
| 001 | `001_init.sql` | Core tables: projects, skills, learnings, tasks, context, plugins, servers, settings |
| 002 | `002_archive.sql` | Adds `archived_at` column to projects for soft-delete |
| 003 | `003_agents.sql` | Creates `agents` table with permissions, model, skills columns |
| 004 | `004_learnings_status.sql` | Adds `status` column to learnings for processed/unprocessed tracking |
| 005 | `005_skills_metadata.sql` | Adds `tags`, `always_apply`, `file_tree` columns to skills |
| 006 | `006_skill_file_tree.sql` | Adds `file_tree` column (TEXT/JSON) for complete skill data round-trips |
