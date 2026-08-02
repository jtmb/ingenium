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
- **MCP**: @modelcontextprotocol/sdk for stdio transport (275 built-in catalog tools across 29 baseline categories; 273 registered by stdio and 2 by the extension, with project-scoped child tools added dynamically)
- **Frontend**: Next.js 16 App Router, React 19, Tailwind CSS 4
- **Syntax Highlighting**: highlight.js (`github.css` + custom `hljs-dark.css`) — Preview and Source modes in skill detail overlay
- **State / Persistence**: Docs RAG system for cross-session context
- **Container**: Docker multi-stage build (glibc-based `node:22-slim`), supervisord (7 processes: API, API boundary, Dashboard, gateway, opencode-web, ttyd-opencode, and private code-server)
- **Packages**: `ingenium-core` (shared lib), `ingenium-extension` (client-side OpenCode — MCP server, observer plugin, skill-sync plugin, auto-observer thin trigger), `ingenium-email` (IMAP/SMTP client)
- **Testing**: Vitest, Playwright
- **Linting**: ESLint, TypeScript compiler
- **CI**: GitHub Actions (push to `ingenium-core`, `ingenium-api`, `ingenium-server`, `ingenium-dashboard`, `ingenium-extension`)

## Frontend

- **Dashboard**: Next.js 16 App Router, React 19, Tailwind CSS 4
- **Email Client**: imapflow (IMAP async client), nodemailer (SMTP), mailparser (MIME parsing), google-auth-library (Google OAuth2), @azure/msal-node (Microsoft OAuth2)

## OpenCode runtime and package contract

The supported OpenCode runtime is **1.18.9**. The Docker image downloads the
`v1.18.9` Linux archive, verifies SHA-256
`a0fa4b7b8bdacbd013e79a5f69d4220d36b545cd3ea296ba765f3016fa501b5b`, and then
requires `opencode --version` to report exactly `1.18.9`. The root package,
the extension package, and `.opencode/package.json` all pin
`@opencode-ai/plugin` to `1.18.9`; both root lockfiles pin the plugin and its
transitive `@opencode-ai/sdk` to `1.18.9` with locked integrity values. The
extension compatibility test verifies every manifest and lock entry.

OpenCode **1.18.3+** introduced the root-relative asset/WebSocket behavior
that requires dedicated root origins rather than a shared dashboard subpath;
the current implementation is verified against 1.18.9.

Generated `dist/` directories and TypeScript `*.tsbuildinfo` files are build
products and remain untracked. The core and server packages expose only their
runtime distribution and README, and `prepack` regenerates `dist/` before a
package is packed.

## Ponytail OpenCode integration

The extension includes the official Ponytail checkout closure under
`packages/ingenium-extension/ponytail/`, pinned to upstream commit
`16f29800fd2681bdf24f3eb4ccffe38be3baec6b` with MIT provenance and recorded
SHA-256 file hashes. It is deliberately not an npm dependency: published
`@dietrichgebert/ponytail@4.8.4` has a named export incompatible with OpenCode
1.18.9. The single adapter registers six commands, the Ponytail skills path,
and a system-prompt transform; it does not register MCP tools or capabilities.
