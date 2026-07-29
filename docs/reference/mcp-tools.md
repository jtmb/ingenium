---
title: MCP Tools Reference
description: Reference for the 269-tool built-in Ingenium MCP catalog across 28 baseline categories, plus project-scoped discovered child tools.
---

# MCP Tools Reference

The built-in catalog contains **269 tools** across **28 baseline categories**:
266 tools registered by the server and 3 extension tools. A project-scoped
catalog may contain additional dynamically discovered child tools, so dashboard
totals and category counts are runtime values rather than a fixed global count.
Every tool needs a **project** name (except where noted).

The canonical catalog (source of truth) lives at `packages/ingenium-core/lib/tools/mcp-tool-catalog.ts`.

### Naming Convention

Ingenium MCP tools use a three-layer naming system:

| Layer | Format | Example |
|-------|--------|---------|
| Transport (internal registration) | `noun_verb` (unprefixed) | `skill_create` |
| Catalog (application state) | `ingenium_noun_verb` | `ingenium_skill_create` |
| Exposed (OpenCode) | `ingenium_noun_verb` | `ingenium_skill_create` |

OpenCode applies the server key (`ingenium`) as a prefix. Transport names are unprefixed to avoid double-prefixing (`ingenium_ingenium_*`).

## Tool control and visibility

The `/mcp-servers` Tools tab controls the project-scoped enabled state for
built-in and discovered tools. Disabling a tool removes it from the MCP
`tools/list` projection and direct invocation fails closed with a deterministic
disabled error. Re-enabling restores both visibility and execution. If the
project identity or authoritative API state is unavailable, the MCP server
fails closed and treats the tool as disabled. The server refreshes this
projection periodically and emits a tool-list-changed notification when the
visible set changes.

The guarantee is tested with an in-memory fixture in
`services/ingenium-server/tests/tool-visibility.test.ts` and the dashboard
toggle path in `tests/ingenium-dashboard/mcp-tool-controls.spec.ts`.

### Connection preflight

The built-in Ingenium transport is the packaged
`@ingenium/extension` launcher. Before exposing its stdio tool catalog, it
requires a protected API token and one safe project identity. Local worktrees
derive the project unless `INGENIUM_PROJECT` is set; the Docker `/workspace`
session explicitly uses `global-default`. Run
`npm run build --workspace=packages/ingenium-extension` after changing the
launcher or transport. A safe read smoke test is `ingenium_health_check`; it
does not require a project argument. Authentication, unavailable transport, and
unrecognized status failures are reported with fixed diagnostics that do not
include bearer tokens or upstream error text.

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

## CONTEXT — Canonical agent memory and immutable conversations

| Tool | What it does |
|------|-------------|
| `ingenium_context_get` | Get a single canonical agent memory entry by ID |
| `ingenium_context_update` | Update an existing context entry (content, tags, priority, source, metadata) |
| `ingenium_context_delete` | Delete a context entry |
| `ingenium_context_batch_get` | Batch retrieve multiple context entries by ID (max 100) |

Context entries are project-isolated, taggable, priority-ranked (0–10), and FTS5-searchable. They persist working context across sessions — the task management and plan surface reads from the same `context_entries` table. The `plan_*` tools remain supported for backward compatibility; `context_*` tools provide the canonical CRUD surface. See `services/ingenium-api/lib/routes/context.ts` and `packages/ingenium-core/lib/tools/context.ts`.

Immutable conversation tools are project-scoped and use optimistic `expectedRevision` values for message appends, checkpoint creation, and maintenance. Optional idempotency keys make creation retries safe; reusing a key with a different request returns a conflict. List and search tools return only metadata and content hashes. Content is returned only by the explicit retrieve tools.

| Tool | What it does |
|------|-------------|
| `ingenium_context_conversation_create` | Create immutable conversation metadata |
| `ingenium_context_conversation_get` / `ingenium_context_conversation_list` | Retrieve or keyset-paginate conversations |
| `ingenium_context_message_append` | Append a message when `expectedRevision` matches |
| `ingenium_context_message_list` / `ingenium_context_message_search` | Browse or relevance-search bounded message summaries without content |
| `ingenium_context_message_retrieve` / `ingenium_context_message_batch_retrieve` | Explicitly retrieve content; batch retrieval preserves requested-ID order and reports missing IDs |
| `ingenium_context_checkpoint_create` | Create a hash-addressed checkpoint with optional source provenance IDs |
| `ingenium_context_checkpoint_get` / `ingenium_context_checkpoint_list` | Retrieve or keyset-paginate checkpoint history |
| `ingenium_context_checkpoint_maintenance_preview` | Preview up to 100 content-free stale, divergent, invalid, or restore-branch candidates; this does not modify context or apply an implicit retention policy |
| `ingenium_context_checkpoint_maintenance_authorize` | Issue a short-lived, one-time confirmation token bound to a project-owned archive, unarchive, or restore-as-new action and revision |
| `ingenium_context_conversation_archive` / `ingenium_context_conversation_unarchive` | Append reversible archive-state events after explicit confirmation; immutable conversations/checkpoints are never deleted |
| `ingenium_context_checkpoint_audit_list` | Read bounded, content-free archive and restore-as-new audit evidence |
| `ingenium_context_checkpoint_restore` | Restore a checkpoint by branching to a new immutable conversation after a matching one-time confirmation; the source is unchanged |
| `ingenium_context_opencode_session_import` | Server MCP proxy for the API-owned OpenCode session import. The caller explicitly supplies a project-bound session ID and absolute directory; validated user/assistant text is ingested into Context RAG with the existing upload/content-hash deduplication semantics. |

The two session-import tools deliberately have different trust boundaries:

- `ingenium_context_import_current_session` is an extension-native tool. Its
  trusted `ToolContext` and plugin client identify the current OpenCode session;
  callers cannot select a session, directory, worktree, or Ingenium project.
  Its optional native arguments are `title` and `maxSourceEnvelopes` (1–12,800);
  it does not accept the server proxy's `limit` argument. Without
  `maxSourceEnvelopes`, it follows cursor pagination to import the complete
  source snapshot, subject to finite caps of 128 pages × 100 source envelopes,
  16,384 output entries, and 64 MiB of UTF-8 text. It sorts source envelopes
  chronologically, keeps only ordinary user text and completed-assistant text,
  and filters non-text, synthetic, and ignored parts. The v2 importer uses
  stable content-based idempotency keys, so deterministic replays skip entries
  already imported while changed or newly completed assistant text can append.
- `ingenium_context_opencode_session_import` is the server MCP proxy. MCP
  cannot infer the external caller's OpenCode session, so `project`,
  `sessionId`, `directory`, `title`, and `limit` are explicit inputs; this
  separate API-owned RAG import accepts `limit` from 1–100. The
  launcher project must match; the session ID and absolute directory are
  validated, the directory basename must match the project, and the API must
  report the same session and directory before message bodies are read. The
  API accepts at most 100 messages and only validated text parts, enforcing
  chronological/session ownership and the 1 MiB content, 256-part, and 64 KiB
  per-part limits. No-text imports are a no-op. Successful retries use the
  existing project-local SHA-256 content-hash semantics and return a
  deduplicated result rather than creating another source.

The extension-native tool is loaded by the extension plugin, not discovered by
an already-running OpenCode process. Rebuild `@ingenium/extension` after
changing the launcher/plugin and restart OpenCode to load the tool; restart the
MCP transport after changing the server proxy.

There is no checkpoint-delete MCP tool. Confirmation tokens are capabilities:
keep them out of transcripts and logs, use each once before it expires, and do
not expect them in audit responses.

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
| `ingenium_vault_unseal` | Unseal the vault with a passphrase; on first use it initializes the shared vault only when the passphrase meets the new-vault policy. It may return `429` with a retry delay after repeated attempts. |
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
| `ingenium_backup_list` | List all server-owned backups (the server resolves the active global project) |
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

Legacy server-definition compatibility tools: `ingenium_server_list`,
`ingenium_server_add`, `ingenium_server_remove`, `ingenium_server_update`, and
`ingenium_server_sync_all`. Canonical child-server definitions are exposed by
the `/api/v1/mcp-servers` API and use shell-free executables plus vault
environment references. Discovered child tools use exactly one lowercase
`ingenium_<server>_<tool>` namespace.

### Thread bridge (dynamic, external FTS)

The Docker deployment's Thread integration is discovered from the
project-registered `threadbridge` child server. These tools are dynamic; do
not add them to the **269 built-in tools / 28 baseline categories** count:

| Dynamic tool | Purpose |
|---|---|
| `ingenium_threadbridge_thread_upload_file` | Upload one receipt-verified export to Thread's fixed `ingenium` session |
| `ingenium_threadbridge_thread_search` | Search Thread's external FTS index (`query`, optional `limit` 1–100 and `use_cache`) |
| `ingenium_threadbridge_thread_read_entries` | Read entries (`limit` 1–200, optional `after` and `sort`) |
| `ingenium_threadbridge_thread_read_entries_batch` | Read selected entries (`ids`, 1–100 positive integers) |
| `ingenium_threadbridge_thread_get_tags` | List Thread tags |
| `ingenium_threadbridge_thread_get_stats` | Get bounded Thread statistics |

The upload call accepts only the private export artifact and matching receipt,
plus optional tags and priority:

```json
{
  "name": "ingenium_threadbridge_thread_upload_file",
  "arguments": {
    "project": "global-default",
    "arguments": {
      "file_path": "/workspace/ingenium/.ingenium/thread-exports/thread-export-<uuid>.jsonl",
      "receipt_path": "/workspace/ingenium/.ingenium/thread-exports/thread-export-<uuid>.jsonl.receipt.json",
      "tags": "optional,comma-separated,tags",
      "priority": 5
    }
  }
}
```

The guard verifies mode `0600`, ownership, canonical paths, receipt keys,
byte length, SHA-256, and one source-session fingerprint. It ignores any
caller-supplied session and forces `session: "ingenium"` for upload, search,
read, batch, tags, and stats. It accepts no write/delete/admin Thread tools.
The child request and guard request each have a bounded 30-second budget.
Private temporary upload files are deleted after the upstream call, whether it
succeeds or fails.

Thread is external FTS, not immutable `/context` conversation storage and not
Context RAG. Thread uploads are not Context conversations, are not
automatically ingested into Context RAG, and do not appear in the Context UI.
Use `ingenium_context_conversation_*` and `ingenium_context_message_*` for
append-only history, or the Context RAG tools for project-scoped RAG sources.

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

**Built-in baseline: 269 tools across 28 categories (266 server + 3 extension).** Project-scoped child
discovery can add tools and categories at runtime; use the project-scoped
catalog endpoint for the current total.
