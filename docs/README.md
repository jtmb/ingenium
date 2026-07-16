---
title: Ingenium Documentation
description: Welcome to the Ingenium self-learning AI agent skill system and MCP server documentation.
---

# Ingenium — AI Agent Skill System & MCP Server

Ingenium is a self-learning AI agent skill system and MCP server with integrated email client support for Gmail/Outlook OAuth2 + IMAP/SMTP. It provides skills, observations, tasks, context, plugins, servers, and project management through a single MCP stdio transport, with a Next.js dashboard for visual management.

## Architecture

The monorepo has 6 packages:
- `packages/ingenium-core` — shared library (SQLite WAL + FTS5, tool modules, Zod schemas). Consumed by API only.
- `packages/ingenium-email` — IMAP/SMTP email client with OAuth2 for Gmail and Outlook (imapflow, nodemailer, mailparser, google-auth-library, @azure/msal-node)
- `packages/ingenium-extension` — client-side OpenCode package: MCP server, observer plugin, skill-sync plugin, auto-observer. Installable via `npx -y @ingenium/extension`.
- `services/ingenium-api` — Express REST API gateway on port 4097. Sole database authority.
- `services/ingenium-server` — MCP stdio server with 210 tools. Calls API via HTTP. Zero DB access.
- `services/ingenium-dashboard` — Next.js 16 App Router frontend with 17 primary routes plus the Settings overlay. Calls API via HTTP. Zero DB access.

## Documentation Sections

| Section | Description |
|---------|-------------|
| [Usage](usage/index.md) | User guides for the dashboard, email client, tasks, and docs workspace |
| [Configure](configure/index.md) | Configuration guides for projects, agents, plugins, MCP servers, and settings |
| [Concepts](concepts/index.md) | Architecture, tech stack, conventions, skill system, and self-learning pipeline |
| [Develop](develop/index.md) | Development reference for the API, database, and environment variables |
| [Operations](operations/index.md) | Deployment, backup/restore, jobs, logs, and service status |
| [Security](security/index.md) | Security documentation and credential management |
| [Reference](reference/index.md) | Comprehensive reference for env vars, MCP tools, skill taxonomy, and docs workspace |

## Getting Started

```bash
docker compose up --build    # Start all services (recommended)
./run.sh dev                 # Local development without Docker
./run.sh test                # Run test suite
./run.sh check               # Type-check and lint
./run.sh build               # Build all packages
```
