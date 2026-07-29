---
title: MCP Servers
description: Child MCP server definitions and Tool Manager — register, connect, refresh, and remove child servers, and enable/disable individual tools.
---

# Configure: MCP Servers

## What It Does
Manages child MCP server definitions and the project-scoped tool catalog. The page has two tabs: **Servers** (manage definitions and connection state) and **Tools** (enable/disable catalog and discovered child tools).

## Server Management

### Adding a Server
1. Navigate to `/mcp-servers` from the dashboard nav bar.
2. Enter a lowercase server namespace and shell-free executable.
3. Add one argument per line, if needed.
4. Add vault item IDs for environment references; plaintext environment values are not accepted.
5. Choose `This project` or `Global project`, then click **Register server**.

### Scope and status
Each server shows its project/global scope, discovery status, connection status,
discovered-tool count, last discovery time, and vault-reference count. Global
definitions are visible to eligible projects; environment values remain in the
vault and are never returned by the browser/API projection.

### Connect, refresh, and remove
- **Connect** and **Disconnect** update the enabled state through the supported MCP boundary; they do not require an OpenCode restart.
- **Refresh** requests bounded child discovery. Discovery metadata is persisted by the API; the MCP runtime reconciles it through its post-start loop.
- **Remove** deletes the child definition and its owned discovery metadata.

## Tool Manager

The Tools tab shows the current project-scoped total. The built-in catalog
contains 268 tools in 28 baseline categories (266 server registrations plus 2
extension tools); discovered child tools are added dynamically and may increase
both the total and the category list for that project.

### Per-Tool Enable/Disable
- Each tool has a toggle switch to enable or disable it
- Disabled tools return a `TOOL_DISABLED` error when called
- This allows fine-grained access control per project
- Disabled tools are also removed from the agent/OpenCode MCP `tools/list`
  projection. Unknown or unavailable project state fails closed. Re-enabling
  restores visibility and execution; the MCP server publishes a list-changed
  notification when the visible set changes.

### Search and Filter
- Use the **Search** field to find tools by name
- Use the **Category filter** dropdown to narrow by category
- Results update in real-time as you type or filter

## MCP Tools

| Tool | Purpose |
|------|---------|
| `ingenium_server_list` | List legacy registered server definitions for a project |
| `ingenium_server_add` | Add a legacy server definition (`name`, `command`, `args?`, `env?`) |
| `ingenium_server_remove` | Remove a legacy server definition |
| `ingenium_server_update` | Update legacy running state |
| `ingenium_server_sync_all` | Bulk-upsert legacy definitions during config sync |

The dashboard uses the canonical child-server API for definitions and
lifecycle operations; the legacy `server_*` tools remain documented for
compatibility. Discovered child tools use the canonical lowercase form
`ingenium_<server>_<tool>`.

## API Endpoints
- `GET /api/v1/mcp-servers?project=<name>` — list effective child definitions
- `GET /api/v1/mcp-servers/tools?project=<name>` — list discovered child tools
- `GET /api/v1/mcp-servers/status?project=<name>` — list discovery status
- `GET /api/v1/mcp-servers/runtime?project=<name>` — list sanitized runtime projections
- `POST /api/v1/mcp-servers?project=<name>` — register a definition (`name`, `executable`, `args`, `environment` vault references, `scope`)
- `POST /api/v1/mcp-servers/:name/connect|disconnect|refresh?project=<name>` — change lifecycle state or request discovery
- `DELETE /api/v1/mcp-servers/:name?project=<name>` — remove a child definition
- `GET /api/v1/mcp-tools?project=<name>&include_categories=true` — list the dynamic project-scoped catalog
- `PUT /api/v1/mcp-tools/:name?project=<name>` — enable or disable a tool
- `PUT /api/v1/mcp-tools/category/:category?project=<name>` — enable or disable a category

## Code Location
- Page: `services/ingenium-dashboard/src/app/mcp-servers/page.tsx`
- API client: `services/ingenium-dashboard/src/lib/api.ts` → `api.servers`
- Route: `services/ingenium-api/lib/routes/servers.ts`
- Core: `packages/ingenium-core/lib/tools/servers.ts`

## Related Docs
- [MCP Tools Reference](../reference/mcp-tools.md) — Built-in MCP catalog and dynamic child-tool naming
