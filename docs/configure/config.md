---
title: Config
description: Managing OpenCode configuration via the dashboard and MCP tools — project-level and global config editing.
---

# HOW-TO: Config

## What It Does
OpenCode configuration editor with Project and Global tabs. Allows editing `opencode.json` (project-level) and `opencode.jsonc` (global) content with round-trip sync between disk and database.

## How to Use
1. Navigate to `/config` from the dashboard nav bar
2. **Project tab** — Edit `opencode.json` for the active project
3. **Global tab** — Edit `opencode.jsonc` for global configuration
4. **Sync from disk** — Click to reload the config from the filesystem into the editor (discards unsaved changes)
5. **Save** — Persists editor content to the database AND writes to disk
6. The editor provides basic JSON syntax highlighting

## MCP Tools

| Tool | Purpose |
|------|---------|
| `ingenium_config_get` | Retrieve opencode config (project or global) |
| `ingenium_config_set` | Update config content (writes to DB and disk) |
| `ingenium_config_sync` | Sync config from disk to DB |

## API Endpoints
- `GET /api/v1/config?project=<name>` — get project config
- `GET /api/v1/config/global?project=<name>` — get global config
- `PUT /api/v1/config?project=<name>` — update project config
- `PUT /api/v1/config/global?project=<name>` — update global config
- `POST /api/v1/config/sync?project=<name>` — sync project config from disk to DB
- `POST /api/v1/config/global/sync?project=<name>` — sync global config from disk to DB

## Code Location
- Page: `services/ingenium-dashboard/src/app/config/page.tsx`
- API client: `services/ingenium-dashboard/src/lib/api.ts` → `api.config`
- Route: `services/ingenium-api/lib/routes/config.ts`
- Core: `packages/ingenium-core/lib/tools/configs.ts`

## Related Docs
- [settings.md](settings.md) — Application settings and Synthesis LLM configuration
