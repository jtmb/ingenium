# Ingenium — AI Agent Skill System & MCP Server

Ingenium is a self-learning AI agent skill system and MCP server with integrated email client support for Gmail/Outlook OAuth2 + IMAP/SMTP. It provides skills, learnings, tasks, context, plugins, servers, and project management through a single MCP stdio transport, with a Next.js dashboard for visual management.

## Architecture

The monorepo has 5 packages:
- `packages/ingenium-core` — shared library (SQLite WAL + FTS5, 7 tool modules, Zod schemas). Consumed by API only.
- `packages/ingenium-email` — IMAP/SMTP email client with OAuth2 for Gmail and Outlook (imapflow, nodemailer, mailparser, google-auth-library, @azure/msal-node)
- `services/ingenium-api` — Express REST API gateway on port 4097. Sole database authority.
- `services/ingenium-server` — MCP stdio server with 64 tools. Calls API via HTTP. Zero DB access.
- `services/ingenium-dashboard` — Next.js 16 App Router frontend with 11 feature pages. Calls API via HTTP. Zero DB access.

## Documentation Index

| Doc | Purpose |
|-----|---------|
| `docs/GETTING-STARTED.md` | Step-by-step setup guide for OpenCode |
| `docs/ARCHITECTURE.md` | Project structure, key components, data flow |
| `docs/TECH-STACK.md` | Dependencies, versions, why each was chosen |
| `docs/CONVENTIONS.md` | Naming, file organization, error handling, git practices |
| `docs/VARIABLES.md` | All environment variables, defaults, and consuming files (includes email OAuth2 vars) |
| `docs/agents.md` | Agent profiles, pipeline lifecycle, and subagent invocation |
| `docs/HOW-TO/projects.md` | Manage project configurations |
| `docs/HOW-TO/skills.md` | Browse and search AI agent skills |
| `docs/HOW-TO/self-learning.md` | Self-learning pipeline with observations and personality traits |
| `docs/HOW-TO/tasks.md` | Kanban task board workflow |
| `docs/HOW-TO/plugins.md` | Plugin lifecycle management |
| `docs/HOW-TO/servers.md` | MCP server configuration and proxy engine |
| `docs/USAGE.md` | Dashboard user guide with API access reference (includes email client section) |

## Getting Started

```bash
./run.sh dev    # Start all services
./run.sh test   # Run test suite
./run.sh check  # Type-check and lint
./run.sh build  # Build all packages
```
