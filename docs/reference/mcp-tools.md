---
title: MCP Tools Reference
description: Complete reference for all 245 Ingenium MCP tools across 28 categories.
---

# MCP Tools Reference

All **245 tools** across **28 categories**, grouped by what they do. Every tool needs a **project** name (except where noted).

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
| `ingenium_project_detail` | Gets detailed info about one project. **No project param needed.** |
| `ingenium_project_rename` | Renames an existing project. |
| `ingenium_project_migrate_workspace` | DB-only migration — moves the historical `/workspace` project into `global-default`. Never touches filesystem. Use `dryRun: true` first. |

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

## PLANS — Saved notes & context (legacy)

`ingenium_plan_save`, `ingenium_plan_search`, `ingenium_plan_list`.

## CONTEXT — Canonical agent memory (4 tools, Phase 3)

| Tool | What it does |
|------|-------------|
| `ingenium_context_get` | Get a single canonical agent memory entry by ID |
| `ingenium_context_update` | Update an existing context entry (content, tags, priority, source, metadata) |
| `ingenium_context_delete` | Delete a context entry |
| `ingenium_context_batch_get` | Batch retrieve multiple context entries by ID (max 100) |

Context entries are project-isolated, taggable, priority-ranked (0–10), and FTS5-searchable. They persist working context across sessions — the task management and plan surface reads from the same `context_entries` table. The `plan_*` tools remain supported for backward compatibility; `context_*` tools provide the canonical CRUD surface. See `services/ingenium-api/lib/routes/context.ts` and `packages/ingenium-core/lib/tools/context.ts`.

## PLUGINS — Add-ons

`ingenium_plugin_list`, `ingenium_plugin_get`, `ingenium_plugin_create`, `ingenium_plugin_update`, `ingenium_plugin_delete`, `ingenium_plugin_enable`, `ingenium_plugin_disable`, `ingenium_plugin_source`.

## COMMANDS — Shortcuts like /synthesize

`ingenium_command_list`, `ingenium_command_get`, `ingenium_command_create`, `ingenium_command_update`, `ingenium_command_delete`.

## SETTINGS — Configuration values

`ingenium_setting_get`, `ingenium_setting_set`, `ingenium_setting_test_llm`.

## CONFIG — Project & global config files

`ingenium_config_get`, `ingenium_config_set`, `ingenium_config_sync`.

## PROVIDERS — LLM provider management (4 tools)

| Tool | What it does |
|------|-------------|
| `ingenium_provider_list` | Lists all available LLM providers from OpenCode |
| `ingenium_provider_connect` | Connect a provider with an API key |
| `ingenium_provider_disconnect` | Disconnect a provider |
| `ingenium_provider_status` | Get provider connection status (keys always redacted) |

## VAULT — Encrypted secrets store (10 tools)

| Tool | What it does |
|------|-------------|
| `ingenium_vault_status` | Get vault status (sealed/unsealed) |
| `ingenium_vault_unseal` | Unseal the vault with a passphrase |
| `ingenium_vault_seal` | Seal (lock) the vault |
| `ingenium_vault_item_list` | List vault items, optionally by folder |
| `ingenium_vault_item_create` | Create a new vault item (password, note, API key, etc.) |
| `ingenium_vault_item_get` | Get a vault item's metadata (not the secret value) |
| `ingenium_vault_item_update` | Update a vault item's value (re-encrypts) |
| `ingenium_vault_item_delete` | Delete a vault item (soft-delete with audit) |
| `ingenium_vault_password_gen` | Generate a secure random password |
| `ingenium_vault_audit_list` | List vault audit log entries |

## BACKUPS — Database snapshots and restore (10 tools)

| Tool | What it does |
|------|-------------|
| `ingenium_backup_create` | Create a new backup snapshot (Ingenium + OpenCode DB) |
| `ingenium_backup_list` | List all backups for a project |
| `ingenium_backup_get` | Get a single backup record by ID |
| `ingenium_backup_download` | Download a backup archive to a validated path |
| `ingenium_backup_delete` | Delete a backup by ID |
| `ingenium_backup_restore_preview` | Preview what a restore would do without executing |
| `ingenium_backup_restore_start` | Start a restore operation (requires `confirm=true`) |
| `ingenium_backup_restore_status` | Get the current status of a restore job |
| `ingenium_backup_schedule_get` | Get the current backup schedule configuration |
| `ingenium_backup_schedule_set` | Set/update the backup schedule configuration |

## RAG — Retrieval-Augmented Generation index (8 tools)

| Tool | What it does |
|------|-------------|
| `ingenium_docs_search_semantic` | BM25 FTS5 full-text search across the RAG document index with snippet generation (uses `searchChunks()`). |
| `ingenium_docs_ask` | Ask a question against the RAG index. Returns LLM-grounded `answer` with `citations[]` (source title, path, heading, snippet, source kind, relevance score). Citations rendered as `[N]` superscript links in the Dashboard AskDocs panel. |
| `ingenium_docs_ingest` | Create a new source and ingest a document into the RAG index |
| `ingenium_docs_rag_sources_list` | List all RAG document sources |
| `ingenium_docs_rag_source_get` | Get a single RAG source by ID |
| `ingenium_docs_rag_source_delete` | Delete a RAG source by ID and cascade its chunks |
| `ingenium_docs_rag_reingest` | Re-ingest an existing RAG source with new text |
| `ingenium_docs_rag_stats` | Get RAG index statistics (document count, chunk count, etc.) and vector capability `{ available, provider: "deterministic-n-gram", semantic: false }` |

**Indexing sources**: (1) Canonical repo Markdown files via `POST /rag/ingest` using `INGENIUM_DOCS_ROOT` — walked from `{root}/docs/`, symlink-protected, hash-idempotent. (2) Docs Workspace pages at lifecycle boundaries (publish, update, archive, restore) — auto-indexed as `docs-page:{id}`. (3) Manual ingestion via `ingenium_docs_ingest`.

**Embedding strategy**: Deterministic 384-dim FNV-1a character-trigram hash (`ingenium-ngram-v1`) — NOT semantic. The `hybridSearch()` function exists (70% BM25 + 30% n-gram cosine similarity) but is not currently wired to API routes — the `/search` and `/ask` routes use BM25 FTS5 via `searchChunks()`. See `packages/ingenium-core/lib/tools/rag.ts`.

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

**Grand total: 245 tools across 28 categories — Projects, Skills, Observe, Observations, Personality, Synthesis, Extraction, Pipeline, Status, Health, OpenCode, Tasks, Plans, Plugins, Commands, Settings, Config, Providers, Vault, Backups, RAG, Servers, Agents, Email, Logs, Jobs, Documentation, Dashboard.**
