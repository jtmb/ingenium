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
- **MCP**: @modelcontextprotocol/sdk for stdio transport (245 catalog tools across 28 categories; 243 registered by the server and 2 by the extension)
- **Frontend**: Next.js 16 App Router, React 19, Tailwind CSS 4
- **Syntax Highlighting**: highlight.js (`github.css` + custom `hljs-dark.css`) — Preview and Source modes in skill detail overlay
- **State / Persistence**: Docs RAG system for cross-session context
- **Container**: Docker multi-stage build (node:22-alpine), supervisord (4 processes: API + Dashboard + opencode-web + ttyd-opencode)
- **Packages**: `ingenium-core` (shared lib), `ingenium-extension` (client-side OpenCode — MCP server, observer plugin, skill-sync plugin, auto-observer thin trigger), `ingenium-email` (IMAP/SMTP client)
- **Testing**: Vitest, Playwright
- **Linting**: ESLint, TypeScript compiler
- **CI**: GitHub Actions (push to `ingenium-core`, `ingenium-api`, `ingenium-server`, `ingenium-dashboard`, `ingenium-extension`)

## Frontend

- **Dashboard**: Next.js 16 App Router, React 19, Tailwind CSS 4
- **Email Client**: imapflow (IMAP async client), nodemailer (SMTP), mailparser (MIME parsing), google-auth-library (Google OAuth2), @azure/msal-node (Microsoft OAuth2)

## Database Migrations

Ingenium currently has 51 numbered migrations (`001`–`051`):

- `001`–`028`: platform, self-learning, tasks/jobs, skill project isolation, and email persistence
- `029`–`040`: documentation workspace schema and integrity repair
- `041`–`045`: skill maintenance locks, immutable versions, lineage, governance proposals, and pipeline event types
- `046`–`048`: encrypted vault, database backups, and initial Docs RAG schema
- `049`: workspace project migration — `project_migration_manifests` table for the DB-only `/workspace` → `global-default` migration audit trail
- `050`–`051`: Phase 3 context/RAG metadata and post-gate retirement of the verified-empty legacy RAG import schema

The definitive per-migration table, ordering constraints, repair procedures, and risk notes live in [Database Migrations Reference](../develop/database.md). Keep that file as the sole exhaustive migration inventory rather than duplicating a partial list here.
