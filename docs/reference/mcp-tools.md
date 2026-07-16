---
title: MCP Tools Reference
description: Complete reference for all 212 Ingenium MCP tools across 24 categories.
---

# MCP Tools Reference

All **212 tools** across **24 categories** (210 server tools + 2 extension tools: `synthesize_observations`, `auto_observe_now`), grouped by what they do. Every tool needs a **project** name (except where noted).

The canonical catalog (source of truth) lives at `packages/ingenium-core/lib/tools/mcp-tool-catalog.ts`.

### Naming Convention

Ingenium MCP tools use a three-layer naming system:

| Layer | Format | Example |
|-------|--------|---------|
| Transport (internal registration) | `noun_verb` (unprefixed) | `skill_create` |
| Catalog (application state) | `ingenium_noun_verb` | `ingenium_skill_create` |
| Exposed (OpenCode) | `ingenium_noun_verb` | `ingenium_skill_create` |

OpenCode applies the server key (`ingenium`) as a prefix. Transport names are unprefixed to avoid double-prefixing (`ingenium_ingenium_*`).

## PROJECTS — Managing workspaces

| Tool | What it does |
|------|-------------|
| `ingenium_project_list` | Shows all your projects. **No project needed.** |
| `ingenium_project_init` | Creates a brand new project. **No project needed.** |
| `ingenium_project_delete` | Deletes a project forever. **No project needed.** |
| `ingenium_project_restore` | Brings back an archived project. |
| `ingenium_project_list_archived` | Shows deleted/archived projects. |
| `ingenium_project_purge` | Permanently wipes old projects. |
| `ingenium_project_set_global` | Makes a project shared across everything. |

## SKILLS — Guides the AI uses to work (25 tools = 11 core + 14 governance)

| Tool | What it does |
|------|-------------|
| `ingenium_skill_list` | Lists every skill. |
| `ingenium_skill_load` | Opens one specific skill. |
| `ingenium_skill_search` | Searches through all skills. |
| `ingenium_skill_create` | Makes a brand new skill. |
| `ingenium_skill_update` | Changes an existing skill. |
| `ingenium_skill_delete` | Archive-only (delegates to `archiveSkill`). Not hard-delete. |
| `ingenium_skill_enable` | Turns a skill ON (writes it to disk). |
| `ingenium_skill_disable` | Turns a skill OFF (removes SKILL.md from disk only). |
| `ingenium_skill_sync` | Saves disk file changes back to the database. |
| `ingenium_skill_consolidate` | Triggers LLM-driven skill audit — merges redundant skills. |
| `ingenium_skill_sync_all` | Sync ALL skills disk↔DB for a project. |

**14 Governance tools:** archive, restore, list_archived, versions, rollback, lineage_create, lineage_list, proposal_create, proposal_list, proposal_get, proposal_submit, proposal_approve, proposal_reject, proposal_rollback.

## OBSERVE — Log notes about user behavior

`ingenium_observe` — Saves a note about how you like things done.

## OBSERVATIONS — Things the AI notices about you

`ingenium_observation_search`, `ingenium_observation_list`, `ingenium_observation_stats`, `ingenium_observation_get`, `ingenium_observation_update`, `ingenium_observation_enrich`, `ingenium_observation_delete`, `ingenium_observation_delete_by_source`.

## PERSONALITY — Your preferences & habits

`ingenium_personality`, `ingenium_personality_traits`, `ingenium_personality_set_trait`, `ingenium_personality_trait_dismiss`, `ingenium_personality_trait_disable`, `ingenium_personality_trait_delete`, `ingenium_personality_traits_delete_all`.

## SYNTHESIS — Turns observations into skills & traits

`ingenium_synthesis_run`, `ingenium_synthesis_status`, `ingenium_synthesis_cross_project`, `synthesize_observations`.

## EXTRACTION — Scans chat history

`ingenium_extraction_run`, `auto_observe_now`.

## PIPELINE — Observability timeline

`ingenium_pipeline_events`, `ingenium_pipeline_timeline`, `ingenium_pipeline_event_log`.

## STATUS — Service health & process monitoring

`ingenium_service_status`, `ingenium_service_application_detail`, `ingenium_service_process_detail`, `ingenium_service_process_logs`.

## HEALTH — API health check

`ingenium_health_check` — Quick health check. **No project param needed.**

## OPENCODE — Message access

`ingenium_opencode_messages` — Read recent user messages from the OpenCode DB.

## TASKS — Full task management (Kanban)

24 tools: create, list, move, complete, next, update, delete, search, comment, activity, link, board_config_get, board_config_set, subtask_create, notifications, get, comments_list, comment_edit, comment_react, links_list, link_delete, tree, notification_read, bulk_update.

## PLANS — Saved notes & context

`ingenium_plan_save`, `ingenium_plan_search`, `ingenium_plan_list`.

## PLUGINS — Add-ons

`ingenium_plugin_list`, `ingenium_plugin_get`, `ingenium_plugin_create`, `ingenium_plugin_update`, `ingenium_plugin_delete`, `ingenium_plugin_enable`, `ingenium_plugin_disable`, `ingenium_plugin_source`.

## COMMANDS — Shortcuts like /synthesize

`ingenium_command_list`, `ingenium_command_get`, `ingenium_command_create`, `ingenium_command_update`, `ingenium_command_delete`.

## SETTINGS — Configuration values

`ingenium_setting_get`, `ingenium_setting_set`, `ingenium_setting_test_llm`.

## CONFIG — Project & global config files

`ingenium_config_get`, `ingenium_config_set`, `ingenium_config_sync`.

## SERVERS — Child MCP servers

`ingenium_server_list`, `ingenium_server_add`, `ingenium_server_remove`, `ingenium_server_update`, `ingenium_server_sync_all`.

## AGENTS — AI sub-personalities

`ingenium_agent_list`, `ingenium_agent_get`, `ingenium_agent_create`, `ingenium_agent_update`, `ingenium_agent_delete`, `ingenium_agent_enable`, `ingenium_agent_disable`, `ingenium_agent_sync`.

## EMAIL — Full email management via MCP

27 tools: list, search, read, send, draft, folders, accounts, triage, suggest, draft_response, patterns, watch_start, watch_status, account_create, account_delete, account_test, oauth_url, oauth_exchange, summarize, review_draft, move, set_flags, delete, sync, sync_status, watch_stop, attachment_get.

## LOGS — System logging

`ingenium_logs_list`, `ingenium_logs_sources`.

## JOBS — Background scheduled tasks

10 tools: list, create, update, delete, run, runs, run_logs, run_cancel, get, suggest.

## DOCUMENTATION — Full docs workspace (48 tools)

All tools use the `ingenium_docs_` prefix. Categories: Spaces (5), Pages & Tree (6), Page Actions (6), Versions (3), Search (1), Tags (4), Backlinks (1), Comments (4), Attachments (3), Templates (5), Project Links (3), Favorites (2), Trash (2), Import/Export (2), Stats (1).

Full route reference: [docs-workspace.md](docs-workspace.md).

---

**Grand total: 212 tools across 24 categories (210 server + 2 extension).**
