---
title: Plugins
description: Plugin lifecycle management — create, enable, disable, configure, and delete OpenCode plugins.
---

# HOW-TO: Plugins

## What It Does
Manages OpenCode plugins. Each plugin is a TypeScript file in `.opencode/plugins/`.
Plugins can be created (uploaded), edited, enabled/disabled, or deleted from the dashboard.

## How to Use
1. Navigate to `/plugins` from the dashboard nav bar
2. Click **Add Plugin** to open the create form
3. Fill in a name, file path (e.g. `my-plugin.ts`), and upload a `.ts` or `.js` file
4. Click **Upload & Create** to register the plugin and write it to disk
5. Each plugin card shows:
   - **Plugin name** and **file path**
   - **Source content preview** (first 120 characters in monospace)
   - **Edit** button — modify file path or source content
   - **Enabled/Disabled** toggle — writes or removes the `.ts` file from `.opencode/plugins/`
   - **Delete** button — permanently removes the plugin (requires confirmation)

## API Endpoints
All endpoints require `?project=<name>` query parameter.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/plugins` | List all plugins |
| `POST` | `/api/v1/plugins` | Create plugin (`{ name, file_path, source_content }`) |
| `GET` | `/api/v1/plugins/:name` | Get a single plugin |
| `PUT` | `/api/v1/plugins/:name` | Update plugin (`{ file_path?, source_content? }`) |
| `DELETE` | `/api/v1/plugins/:name` | Delete plugin |
| `POST` | `/api/v1/plugins/:name/enable` | Enable plugin (writes `.ts` to disk) |
| `POST` | `/api/v1/plugins/:name/disable` | Disable plugin (removes `.ts` from disk) |

## MCP Tools

| Tool | Parameters | Description |
|------|-----------|-------------|
| `ingenium_plugin_list` | `project` | List all plugins |
| `ingenium_plugin_create` | `project, name, filePath, sourceContent?` | Create a new plugin |
| `ingenium_plugin_get` | `project, name` | Get a single plugin |
| `ingenium_plugin_update` | `project, name, { file_path?, source_content? }` | Update plugin |
| `ingenium_plugin_delete` | `project, name` | Delete plugin |
| `ingenium_plugin_enable` | `project, name` | Enable plugin |
| `ingenium_plugin_disable` | `project, name` | Disable plugin |

## Code Location

| Layer | File |
|-------|------|
| Dashboard page | `services/ingenium-dashboard/src/app/plugins/page.tsx` |
| API client | `services/ingenium-dashboard/src/lib/api.ts` |
| Express routes | `services/ingenium-api/lib/routes/plugins.ts` |
| Core database | `packages/ingenium-core/lib/tools/plugins.ts` |
| MCP server | `services/ingenium-server/lib/tools/plugins.ts` |
| MCP registration | `services/ingenium-server/scripts/mcp-server.ts` |
