---
title: Tech Stack
description: Languages, frameworks, packages, and tools used in the Ingenium monorepo.
---

# Tech Stack

- **Runtime**: Node.js 22+
- **Language**: TypeScript (strict mode, strictNullChecks)
- **Package Manager**: npm workspaces (monorepo)
- **API**: Express.js on private container port 4096 behind the authenticated host-loopback boundary on 4097, JSON body limit 2MB (`express.json({ limit: "2mb" })`), helmet + CORS middleware
- **Database**: SQLite via better-sqlite3 with WAL mode + FTS5 full-text search; see [Database Migrations Reference](../develop/database.md) for the migration inventory and maintenance procedures
- **MCP**: @modelcontextprotocol/sdk for stdio transport (286 active built-in tools across 32 baseline categories: 284 active `ingenium_` server registrations and 2 extension tools; project-scoped child tools are added dynamically)
- **Frontend**: Next.js 16 App Router, React 19, Tailwind CSS 4
- **Syntax Highlighting**: highlight.js (`github.css` + custom `hljs-dark.css`) — Preview and Source modes in skill detail overlay
- **State / Persistence**: Docs RAG system for cross-session context
- **Container**: Docker multi-stage build (glibc-based `node:22-slim`), supervisord (10 process definitions, 9 active compatibility processes: API, API boundary, Dashboard, gateway, restore handoff, OpenCode internal auth proxy, OpenCode Web, ttyd-opencode, and private code-server; restore maintenance is on-demand)
- **Packages**: `ingenium-core` (API-internal DB library), `ingenium-extension` (client-side OpenCode — MCP stdio transport, observer/resource-sync/auto-observer/lifecycle plugins, Ponytail adapter), `ingenium-email` (IMAP/SMTP client)

External worktree resources follow the Git-authoritative path
`Git → @ingenium/extension resource-sync → MCP stdio → authenticated API → DB`.
Runtime consumers cannot import `ingenium-core` or call mutation REST directly.
- **Testing**: Vitest, Playwright
- **Linting**: ESLint, TypeScript compiler
- **CI**: GitHub Actions (push to `ingenium-core`, `ingenium-api`, `ingenium-server`, `ingenium-dashboard`, `ingenium-extension`)

## Frontend

- **Dashboard**: Next.js 16 App Router, React 19, Tailwind CSS 4
- **Email Client**: imapflow (IMAP async client), nodemailer (SMTP), mailparser (MIME parsing), google-auth-library (Google OAuth2), @azure/msal-node (Microsoft OAuth2)

## OpenCode runtime and package contract

The embedded/container OpenCode executable is **2.0.11**. The Docker image
downloads the `2.0.11` Linux x64 archive, verifies SHA-256
`59e917d7c0704e84f050619973e28374269b1c814548f8c9ae7942f69d69ee13`, and
requires `opencode --version` to report exactly `opencode v2.0.11`.

Separately, the root package, extension package, and `.opencode/package.json`
pin the `@opencode-ai/plugin` compatibility package to **1.18.31**; both root
lockfiles pin that package and its transitive `@opencode-ai/sdk` to **1.18.31**
with locked integrity values. These npm compatibility-package pins are not the
embedded/container executable version. The extension compatibility test
verifies every manifest and lock entry.

OpenCode **1.18.3+** introduced the root-relative asset/WebSocket behavior
that requires dedicated root origins rather than a shared dashboard subpath.
This is the historical basis for that origin boundary, not the version of the
current embedded/container executable.

The installed CLI used for the 2026-09-09 session-context capture reported
**1.18.30**. That is historical retrieval-tool evidence only, distinct from
the current embedded/container executable and the 1.18.31 compatibility-package
pins; see the [CLI session-context audit](../reference/session-context-audit-2026-09-09.md).

Generated `dist/` directories and TypeScript `*.tsbuildinfo` files are build
products and remain untracked. The core and server packages expose only their
runtime distribution and README, and `prepack` regenerates `dist/` before a
package is packed.

## Ponytail OpenCode integration

The extension includes the official Ponytail checkout closure under
`packages/ingenium-extension/ponytail/`, pinned to upstream commit
`16f29800fd2681bdf24f3eb4ccffe38be3baec6b` with MIT provenance and recorded
SHA-256 file hashes. It is deliberately not an npm dependency: published
`@dietrichgebert/ponytail@4.8.4` had a named export incompatible with the
OpenCode 1.18.31 integration contract; this is historical compatibility
evidence. The single adapter registers six commands, the Ponytail skills path,
and a system-prompt transform; it does not register MCP tools or capabilities.
