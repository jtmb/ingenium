# ingenium-core

Shared library for the Ingenium MCP Server. Contains:

- **SQLite database** — WAL mode + FTS5 full-text search
- **Zod schemas** — Shared validation schemas used across all services
- **Database migrations** — Numbered `.sql` files in `data/migrations/`
- **Tool implementations** — All MCP tool logic (skills, agents, plugins, tasks, etc.)
- **Path resolution** — Shared module for config and data paths

**Isolation:** Only `ingenium-core` and `ingenium-api` may import SQL libraries. CI enforces this with automated checks.
