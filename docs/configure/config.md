---
title: Config
description: Managing OpenCode configuration via the dashboard and MCP tools — project-level and global config editing.
---

# HOW-TO: Config

## Authority and Boundaries

- The repository root [`opencode.json`](../../opencode.json) is authoritative for the checked-in agent roster, runtime model/variant mappings, MCP entry, and plugin list. `.opencode/agents/**` profiles own prompt content, permissions/tool grants, lifecycle metadata, and skills; a root mapping does not grant custom-agent tools. [`.opencode/models.md`](../../.opencode/models.md) is a reference, not a second authority.
- `opencode.jsonc` is the separate OpenCode global configuration. Bootstrap projection may normalize managed agents, MCP, and plugins; projected global/workspace profile copies are not additional repository profiles or mappings.
- Changing a root mapping, profile, plugin, MCP entry, or OpenCode configuration requires a full parent OpenCode restart. Restarting only the child MCP process is insufficient, and a restart acknowledgement alone is not proof that the new surface loaded; verify the effective mapping and grants from the new parent.

## What It Does

The OpenCode configuration page has Project Config, Global Config, and Providers tabs. The first two edit `opencode.json` and `opencode.jsonc` content with round-trip sync between disk and the API-owned database. Providers connects native OpenCode providers and manages installation-scoped custom providers plus synthesis selections and schedule.

The disk/DB controls here are explicit API-host/admin repair or import
operations. They do not replace the Git-authoritative external-worktree path:
Git → `@ingenium/extension` resource-sync → configured MCP stdio → authenticated
API → database.

## How to Use

1. Navigate to `/config` from the dashboard nav bar. `?tab=global` and `?tab=providers` select the corresponding tab.
2. **Project Config** — Edit `opencode.json` for the selected project.
3. **Global Config** — Edit `opencode.jsonc` for the selected configuration scope.
4. **Providers** — Connect native providers, add custom OpenAI-compatible providers, choose primary/secondary synthesis provider-model pairs, and set the synthesis schedule. Provider settings use the canonical global provider project.
5. **Sync from disk** — Reload a project or global config from the filesystem into the editor; unsaved editor content is discarded. A missing or unreadable file returns an empty result.
6. **Save** — The API validates the editor content as JSON, commits it to the database, and attempts the disk write. A disk-write failure is logged without rolling back the database commit.
7. **Save providers** — Persists provider metadata and encrypted credentials through the API and asks OpenCode to reload provider configuration; warnings are shown in the panel.

## MCP Tools

| Tool | Purpose |
|------|---------|
| `ingenium_config_get` | Retrieve `opencode.json` or `opencode.jsonc` content; accepts `project` and `type` (`project` or `global`) |
| `ingenium_config_set` | Set config content for `project` and `type`; writes the committed DB value and attempts the disk write |
| `ingenium_config_sync` | Pull the selected config from disk to the database; accepts `project` and `type` |

## API Endpoints

- `GET /api/v1/config?project=<name>&type=project|global` — read the selected config.
- `PUT /api/v1/config?project=<name>&type=project|global` — validate and save the selected config.
- `POST /api/v1/config/sync?project=<name>&type=project|global` — sync the selected config from disk.
- `GET /api/v1/settings/provider-configs?project=<name>` — read managed provider metadata and synthesis selections; the server resolves the canonical global project.
- `PUT /api/v1/settings/provider-configs?project=<name>` — save managed providers, encrypted credentials, and synthesis selections; the server resolves the canonical global project.
- `GET|POST /api/v1/settings?project=<name>&key=synthesis_interval_ms` — read or save the synthesis schedule used by the Providers tab.
- `GET|POST /api/v1/settings/llm-config?project=<name>` — legacy primary/backup LLM configuration retained for existing clients; the Providers tab uses `provider-configs`.

## Code Location

- Page: `services/ingenium-dashboard/src/app/config/page.tsx`
- Providers panel: `services/ingenium-dashboard/src/app/config/components/ProviderPanel.tsx` → `services/ingenium-dashboard/src/app/components/settings/panels/PipelinePanel.tsx`
- API client: `services/ingenium-dashboard/src/lib/api.ts` → `api.configs` and `api.settings`
- Config route: `services/ingenium-api/lib/routes/configs.ts`
- Provider/settings route: `services/ingenium-api/lib/routes/settings.ts`
- MCP handlers: `services/ingenium-server/lib/tools/configs.ts`
- Core: `packages/ingenium-core/lib/tools/configs.ts`
- Global config projection: `scripts/project-opencode-global-config.mjs`
- Global profile projection/normalization: `scripts/project-agent-profiles.mjs`

## Related Docs

- [Agent authority](agents.md) — agent roster, models, profiles, permissions, and restart verification
- [Synthesis Pipeline](synthesis.md) — Synthesis LLM configuration
- [API Reference](../develop/api.md#settings--llm-config) — LLM config endpoint documentation
