---
title: Tech Stack
description: Languages, frameworks, packages, and tools used in the Ingenium monorepo.
---

# Tech Stack

- **Runtime**: Node.js 22+
- **Language**: TypeScript (strict mode, strictNullChecks)
- **Package Manager**: npm workspaces (monorepo)
- **API**: Express.js on port 4097, JSON body limit 2MB (`express.json({ limit: "2mb" })`), helmet + CORS middleware
- **Database**: SQLite via better-sqlite3 with WAL mode + FTS5 full-text search
- **MCP**: @modelcontextprotocol/sdk for stdio transport (210 server tools; 212 total catalog entries including 2 extension tools)
- **Frontend**: Next.js 16 App Router, React 19, Tailwind CSS 4
- **Syntax Highlighting**: highlight.js (`github.css` + custom `hljs-dark.css`) — Preview and Source modes in skill detail overlay
- **State / Persistence**: Thread MCP server for cross-session context
- **Container**: Docker multi-stage build (node:22-alpine), supervisord (4 processes: API + Dashboard + opencode-web + ttyd-opencode)
- **Packages**: `ingenium-core` (shared lib), `ingenium-extension` (client-side OpenCode — MCP server, observer plugin, skill-sync plugin, auto-observer thin trigger), `ingenium-email` (IMAP/SMTP client)
- **Testing**: Vitest, Playwright
- **Linting**: ESLint, TypeScript compiler
- **CI**: GitHub Actions (push to `ingenium-core`, `ingenium-api`, `ingenium-server`, `ingenium-dashboard`, `ingenium-extension`)

## Frontend

- **Dashboard**: Next.js 16 App Router, React 19, Tailwind CSS 4
- **Email Client**: imapflow (IMAP async client), nodemailer (SMTP), mailparser (MIME parsing), google-auth-library (Google OAuth2), @azure/msal-node (Microsoft OAuth2)

## Database Migrations

Ingenium currently has 44 numbered migrations (`001`–`044`):

- `001`–`028`: platform, self-learning, tasks/jobs, skill project isolation, and email persistence
- `029`–`040`: documentation workspace schema and integrity repair
- `041`–`044`: skill maintenance locks, immutable versions, lineage, and governance proposals

The definitive per-migration table, ordering constraints, repair procedures, and risk notes live in [Database Migrations Reference](../develop/database.md). Keep that file as the sole exhaustive migration inventory rather than duplicating a partial list here.
