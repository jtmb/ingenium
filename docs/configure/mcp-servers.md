---
title: MCP Servers
description: MCP server configuration and Tool Manager — add, start, stop, and remove MCP servers, and enable/disable individual tools.
---

# Configure: MCP Servers

## What It Does
Manages MCP server configurations and tools. The page has two tabs: **Servers** (manage server definitions) and **Tools** (enable/disable individual tools across 24 categories).

## Server Management

### Adding a Server
1. Navigate to `/mcp-servers` from the dashboard nav bar
2. Type a server name in the first input field
3. Type the launch command in the second input field (e.g. `kaban mcp`)
4. Optionally add arguments (JSON array) and environment variables (JSON object)
5. Click **Add Server** to register it

### Server Source Badges
Each server shows a `source` badge indicating its origin:
- **External** (blue) — Standard user-added server
- **Enabled** (green) — Server on a global project, inherited across all projects
- **Running** (green) — Server currently running via the proxy engine
- **Stopped/Disabled** (gray) — Inactive server

### Start/Stop/Remove
- Each server row shows its name, command, and status badge
- Use the **Play/Stop** buttons to control the server via the proxy engine
- Use the **Delete** button to remove the server configuration entirely

## Tool Manager

The Tools tab shows all 212 catalog tools organized into 24 categories:
- Settings, Skills, Observe, Observations, Personality, Synthesis, Extraction, Tasks, Plans, Projects, Plugins, Servers, Agents, Commands, Config, Email, Logs, Jobs, Pipeline, Status, Health, OpenCode, Dashboard, Documentation

### Per-Tool Enable/Disable
- Each tool has a toggle switch to enable or disable it
- Disabled tools return a `TOOL_DISABLED` error when called
- This allows fine-grained access control per project

### Search and Filter
- Use the **Search** field to find tools by name
- Use the **Category filter** dropdown to narrow by category
- Results update in real-time as you type or filter

## MCP Tools

| Tool | Purpose |
|------|---------|
| `ingenium_server_list` | List all registered child MCP servers for a project |
| `ingenium_server_add` | Add a new child MCP server definition (name, command, args?, env?) |
| `ingenium_server_remove` | Remove a child MCP server definition |

## API Endpoints
- `GET /api/v1/servers?project=<name>` — list servers
- `POST /api/v1/servers?project=<name>` — add server (body: `{ name, command, args?, env? }`)
- `POST /api/v1/servers/:name/start?project=<name>` — start server
- `POST /api/v1/servers/:name/stop?project=<name>` — stop server
- `DELETE /api/v1/servers/:name?project=<name>` — remove server configuration
- `GET /api/v1/tools?project=<name>` — list all tools with enable/disable status
- `PUT /api/v1/tools/:name?project=<name>` — enable or disable a specific tool

## Code Location
- Page: `services/ingenium-dashboard/src/app/mcp-servers/page.tsx`
- API client: `services/ingenium-dashboard/src/lib/api.ts` → `api.servers`
- Route: `services/ingenium-api/lib/routes/servers.ts`
- Core: `packages/ingenium-core/lib/tools/servers.ts`

## Related Docs
- [MCP Tools Reference](../reference/mcp-tools.md) — Full MCP tools reference (212 tools in 24 categories)
