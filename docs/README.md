# Ingenium — AI Agent Skill System

Ingenium is an AI agent skill system and MCP server. It provides skills, learnings, tasks, context, and server management through a REST API and MCP stdio transport.

## Architecture

The monorepo has 4 packages:
- `packages/ingenium-core` — shared library (SQLite, tools, schemas). Consumed by API only.
- `services/ingenium-api` — REST API gateway. Sole database authority.
- `services/ingenium-server` — MCP stdio server. Calls API via HTTP. Zero DB access.
- `services/ingenium-dashboard` — Next.js 16 frontend. Calls API via HTTP. Zero DB access.
