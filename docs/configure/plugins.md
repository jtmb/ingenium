---
title: Plugins
description: Plugin lifecycle management — create, enable, disable, configure, and delete OpenCode plugins.
---

# HOW-TO: Plugins

## What It Does
Manages project OpenCode plugins. Plugin source files live under
`.opencode/plugins/`; the dashboard accepts TypeScript or JavaScript uploads.
Plugins can be created (uploaded), edited, enabled/disabled, or deleted from the dashboard.
The extension bootstrap entries below are configuration-owned and are not the
same as project plugin CRUD.

## Ponytail OpenCode Integration

Ponytail is integrated as an official, checkout-based OpenCode plugin. The
runtime closure is vendored at
`packages/ingenium-extension/ponytail/` from upstream commit
`16f29800fd2681bdf24f3eb4ccffe38be3baec6b`, with MIT provenance recorded in
`packages/ingenium-extension/ponytail/PROVENANCE.md`. It is not installed from
npm, and it does not configure or invoke Ponytail MCP. The published
`@dietrichgebert/ponytail@4.8.4` package is deliberately not used: its named
export is incompatible with OpenCode 1.18.31's plugin loader.

Register exactly one Ponytail entry alongside the other extension plugins for the environment.
The canonical five-entry list is exported by
`packages/ingenium-extension/plugin-specs.mjs` and is asserted against the root
`opencode.json`:

```json
"plugin": [
  "file://{env:PWD}/packages/ingenium-extension/plugins/auto-observer.ts",
  "file://{env:PWD}/packages/ingenium-extension/plugins/observer.ts",
  "file://{env:PWD}/packages/ingenium-extension/plugins/resource-sync.ts",
  "file://{env:PWD}/packages/ingenium-extension/plugins/lifecycle.ts",
  "file://{env:PWD}/packages/ingenium-extension/ponytail/.opencode/plugins/ponytail.mjs"
]
```

For the container's global config, use the equivalent absolute entry
`/app/packages/ingenium-extension/ponytail/.opencode/plugins/ponytail.mjs`.
Do not register both entries in one config, recursively discover the checkout,
or add the old npm package. The adapter is intentionally outside the worktree
`.opencode/plugins/` discovery root.

The `lifecycle.ts` entry is a root-hook adapter for the lifecycle events that the
OpenCode v2 promise plugin API does not expose. It reads sessions through the
v2 SDK for automatic context upload and metadata-only usage telemetry; it does
not coordinate sessions or inject saved memory into TUI turns. Profile
permissions remain authoritative.

The separate `plugins/session-id-tui.ts` source is not in the canonical plugin
specs, root config, or package exports. Runtime activation is explicitly deferred;
its mocked slot test is not evidence of a live session-ID sidebar.

The adapter exposes six commands: `/ponytail`, `/ponytail-audit`,
`/ponytail-debt`, `/ponytail-gain`, `/ponytail-help`, and `/ponytail-review`.
It also adds the checkout's skills path and appends the active Ponytail rules
to each chat system prompt. This is a prompt-only permission boundary: it does
not add MCP tools, execute commands, or grant filesystem access.

Modes are `off`, `lite`, `full` (default), and `ultra`; `/ponytail <mode>`
persists the mode for subsequent turns, while `stop ponytail` and `normal mode`
disable it. The default resolves in this order: `PONYTAIL_DEFAULT_MODE`, then
`$XDG_CONFIG_HOME/ponytail/config.json` (or `~/.config/ponytail/config.json`,
or `%APPDATA%/ponytail/config.json` on Windows), then `full`. OpenCode's active
mode is stored in `.ponytail-active` beside its config, normally
`$XDG_CONFIG_HOME/opencode/.ponytail-active`.

OpenCode loads plugins at startup. Restart the OpenCode session after adding,
removing, or changing this registration. Verify with the extension's focused
checkout test and by confirming the six commands, the prompt marker
`PONYTAIL MODE ACTIVE`, and the pinned hashes in `PROVENANCE.md`.

To update, replace the checkout only from a reviewed upstream commit, refresh
the provenance and hash assertions, and rerun the focused test. To uninstall,
remove the single registration, delete the checkout, remove any legacy
`@dietrichgebert/ponytail*` or `mcp.ponytail` entries, and restart OpenCode.

## How to Use
1. Navigate to `/plugins` from the dashboard nav bar
2. Click **Add Plugin** to open the create form
3. Fill in a name, file path (e.g. `my-plugin.ts`), and upload a `.ts` or `.js` file
4. Click **Upload & Create** to register the plugin and write it to disk
5. Each plugin card shows:
   - **Plugin name** and **file path**
   - **Description** — project-local editable metadata (maximum 2,000 characters; NUL is rejected)
   - **Source content preview** (first 120 characters in monospace)
   - **Edit** button — modify the description or executable file path/source content; these updates are mutually exclusive
   - **Enabled/Disabled** toggle — writes or removes the configured source file from `.opencode/plugins/`
   - **Delete** button — permanently removes the plugin (requires confirmation)

## API Endpoints
All endpoints require `?project=<name>` query parameter.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/plugins` | List all plugins |
| `POST` | `/api/v1/plugins` | Create plugin (`{ name, file_path, source_content }`) |
| `GET` | `/api/v1/plugins/:name` | Get a single plugin |
| `GET` | `/api/v1/plugins/:name/source` | Read the current plugin source |
| `PUT` | `/api/v1/plugins/:name` | Update either `{ description }` (up to 2,000 characters, no NUL) or `{ file_path?, source_content? }`; the forms are mutually exclusive |
| `DELETE` | `/api/v1/plugins/:name` | Delete plugin |
| `POST` | `/api/v1/plugins/:name/enable` | Enable plugin (writes the configured source file to disk) |
| `POST` | `/api/v1/plugins/:name/disable` | Disable plugin (removes the configured source file from disk) |

## MCP Tools

| Tool | Parameters | Description |
|------|-----------|-------------|
| `ingenium_plugin_list` | `project` | List all plugins |
| `ingenium_plugin_create` | `project, name, filePath, sourceContent?` | Create a new plugin |
| `ingenium_plugin_get` | `project, name` | Get a single plugin |
| `ingenium_plugin_update` | `project, name, { description }` or `{ file_path?, source_content? }` | Update plugin metadata or executable content |
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
