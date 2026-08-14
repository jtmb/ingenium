---
title: MCP Tools Reference
description: Reference for the 282-tool built-in Ingenium MCP catalog across 30 baseline categories, plus project-scoped discovered child tools.
---

# MCP Tools Reference

The built-in catalog contains **282 tools** across **30 baseline categories**:
280 `ingenium_` catalog entries and 2 extension-registered tools. A project-scoped
catalog may contain additional dynamically discovered child tools, so dashboard
totals and category counts are runtime values rather than a fixed global count.
Every tool needs a **project** display locator (except where noted). The locator
must resolve to a project UUID granted by the authenticated credential.

The canonical catalog (source of truth) lives at `packages/ingenium-core/lib/tools/mcp-tool-catalog.ts`.

## Repository-authoritative synchronization

The dedicated repository-sync MCP operation projects Git worktree files through
`@ingenium/extension` resource-sync, configured MCP stdio, and the authenticated
API to the database. Git remains authoritative; runtime consumers do not access
SQLite or call mutation REST directly. Skill CRUD and `ingenium_skill_sync*`
tools are API-host/admin repair/import operations only.

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
projection periodically, after state refresh/reconnect, and emits a
tool-list-changed notification when the visible set changes.

Visibility is also authorization-derived. The server exposes only tools allowed
by the parent credential's audience/scopes/project grants, while the API remains
final authority for every invocation. `TOOL_DISABLED` and catalog policy parity
are unchanged.

Tools with no persisted state use their catalog `defaultEnabled` value; an
unknown tool or state never inherits an enabled default and fails closed. For
project-scoped state requests, the API requires and echoes both the requested
`project` name and its resolved `project_id`; a response without that matching
identity pair is not authoritative. Category enable/disable operations are
atomic and idempotent. The Tool Manager disables its controls when the API's
authoritative project does not match the selected project.

Built-in server tools disappear from dynamic discovery when disabled, and
direct invocation returns a fixed actionable error: `TOOL_DISABLED` with
`This tool is disabled for the project.` State or identity failures return
`TOOL_STATE_UNAVAILABLE` or `PROJECT_IDENTITY_REQUIRED` with fixed messages;
Chat links these errors to **MCP Servers** when the project is known. The
extension plugin tools `auto_observe_now` and `synthesize_observations` remain
statically visible because OpenCode registers them as plugin tools; this is the
visibility exception, not an execution bypass—they remain project-state-gated
and fail closed when disabled or when state is unknown.

The guarantee is tested with an in-memory fixture in
`services/ingenium-server/tests/tool-visibility.test.ts` and the dashboard
toggle path in `tests/ingenium-dashboard/mcp-tool-controls.spec.ts`.

### Connection preflight

The built-in Ingenium transport is the packaged
`@ingenium/extension` launcher. Before exposing its stdio tool catalog, it
requires a protected scoped credential and explicit project, workspace, and exact
launcher-worktree bindings. External sessions do not inherit the installation
bearer or derive authority from a basename. Run
`npm run build --workspace=packages/ingenium-extension` after changing the
launcher or transport. A safe read smoke test is `ingenium_health_check`; it
does not require a project argument. Authentication, unavailable transport, and
unrecognized status failures are reported with fixed diagnostics that do not
include bearer tokens or upstream error text.

### MCP API error boundary

The typed HTTP client resolves only 2xx responses through its standard methods.
Adapters that intentionally inspect non-2xx responses use the explicit
`api.settled` namespace instead; this preserves status and bounded payload data
for state, report, and child-runtime adapters without weakening the normal error
boundary.

Every non-2xx error body is read from the response stream with a raw **8,192-byte
(`8192`) cap**. Each chunk is checked against the remaining raw-byte budget before
UTF-8 decoding, and JSON is parsed only after the bounded stream completes. A
declared `Content-Length` at or above 8192 bytes is canceled without acquiring a
reader. For chunked responses, a chunk that would reach or exceed the cap cancels
the reader immediately; later data is not read. Fatal UTF-8, malformed JSON,
interrupted, missing, or oversized bodies are discarded and become the fixed
sanitized `API_REQUEST_FAILED` fallback rather than entering an MCP response. Valid
error codes are limited to 64 safe uppercase characters and messages to 256 UTF-8
bytes; control characters, paths, and credential-shaped text are rejected.

At the MCP tool boundary, state-gated API failures are returned as
`isError: true` results. Their serialized error text is capped at 512 bytes and
oversized or unsafe data falls back to the fixed `API_REQUEST_FAILED` message.

### MCP usefulness report (public/developer schema)

The MCP-103 report is bounded, evidence-only JSON. It is not a score or a
usefulness claim: it contains no prompts, results, arguments, errors, URLs,
headers, environment values, project identity, credentials, or secrets. The
fixed top-level shape is:

```json
{
  "schemaVersion": 1,
  "provenance": "fixture",
  "generatedAt": "2026-07-31T12:00:10.000Z",
  "freshness": {
    "status": "fresh",
    "observedAt": "2026-07-31T12:00:00.000Z",
    "durationMs": 60000
  },
  "catalog": {
    "status": "conformant",
    "issues": []
  },
  "tools": []
}
```

- `schemaVersion` is currently `1`; `provenance` is `fixture` or `live`.
- `generatedAt` is the UTC report-generation timestamp. Freshness is global,
  not repeated per tool: `freshness.status` is `fresh`, `stale`, or `unknown`,
  with the source `observedAt` (or `null`) and the configured `durationMs`.
- `catalog.status` is `conformant`, `nonconformant`, or `unknown`.
  `catalog.issues` is a bounded list of `{ code, toolName }`; it contains
  fixed conformance issue codes, never diagnostic messages. An unknown catalog
  has no issues attached to it.
- Each `tools[]` entry has `{ name, boundary, visibility, invocation }`.
  `boundary` is `mcp-stdio` or `opencode-extension`; `visibility.status` is
  `reachable`, `unreachable`, `unknown`, or `not-applicable`; and
  `invocation.status` is `success`, `failed`, `not-run`, or `unknown`.
  Catalog and freshness are global fields, not per-tool copies.

Reason values are fixed and constrained by status. Successful or reachable
evidence uses `reason: null`. Visibility reasons are `not-listed`,
`transport-unavailable`, `list-unavailable`, `TOOL_STATE_UNAVAILABLE`, or
`not-requested` (the last is used for `not-applicable` and may describe
unknown/not-requested evidence). Invocation reasons are `invocation-failed`,
`PROJECT_IDENTITY_REQUIRED`, `TOOL_DISABLED`, `TOOL_STATE_UNAVAILABLE`,
`unsafe-invocation`, `transport-unavailable`, `list-unavailable`,
`invalid-response`, or `not-requested`. `not-run` means an invocation was
intentionally not attempted; `unknown` means the collector could not establish
the state. Extension-boundary tools are not applicable to the stdio visibility
probe and are not invoked (`not-applicable` / `not-requested`, then `not-run` /
`not-requested`).

The configured collector reads the local `mcp.ingenium` entry, lists tools, and
invokes only the provider-free `health_check` safely; all other tool
invocations are `not-run` with `unsafe-invocation` when invocation is possible
(transport/list failures remain `unknown`, and extension tools remain
`not-run` / `not-requested`). Fixture and live runs use the same report schema;
`provenance` identifies which evidence source was used.
The catalog is limited to 1,000 tools and serialized output to 64 KiB. Catalog
issues and tool entries are deterministically sorted (tool name, with issues
sorted by code then tool name).

The authenticated API endpoint is `GET /api/v1/mcp-tools/report?project=<name>`.
Its response envelope is `{ project, project_id, data, total }`; `data` is the
bounded report above, and each tool is enriched with its current catalog
`category` and effective project `enabled` state before filters are applied.
The endpoint accepts `q`, `category`, `enabled`, `boundary`, `visibility`, and
`invocation` filters. It is capped at 64 KiB, uses a per-project 30-second
cache for collection, and sends `Cache-Control: private, no-store` with
`Vary: Authorization`.

The live collector uses a fixed server-owned packaged launcher and an
ephemeral probe. Probe mode lists tools and invokes only the provider-free
`health_check`, then closes the child. It sets
`INGENIUM_MCP_REPORT_MODE=1`; that mode does not start the child MCP gateway.
Fixed query errors are `413 MCP_REPORT_QUERY_TOO_LARGE` and `422
INVALID_MCP_REPORT_QUERY`; unavailable or oversized report generation returns
`503 MCP_REPORT_UNAVAILABLE`, and concurrent collection may return `503
MCP_REPORT_BUSY`. When a runtime probe cannot certify source registration or
catalog parity, `catalog.status` is `unknown` rather than a conformance claim.

The report is also exposed as the project-scoped tool
`ingenium_mcp_report_get`, with the same filters and bounded response.

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

## SKILLS — Guides the AI uses to work (28 tools = 12 core + 16 governance)

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
| `ingenium_skill_sync` | Administrative repair/import of one skill; not automatic worktree sync. |
| `ingenium_skill_consolidate` | Triggers LLM-driven skill audit — merges redundant skills. |
| `ingenium_skill_sync_all` | Administrative repair/import of project skills; not automatic worktree sync. |
| `ingenium_skill_sync_all_preview` | Previews project skill sync changes without modifying state. |

**16 Governance tools:** archive, restore, list_archived, versions, rollback, lineage_create, lineage_list, proposal_create, proposal_list, proposal_page, proposal_counts, proposal_get, proposal_submit, proposal_approve, proposal_reject, proposal_rollback.

`ingenium_skill_proposal_list` is a deprecated compatibility tool. Its REST
route returns `410 SKILL_PROPOSAL_LIST_RETIRED`; use
`ingenium_skill_proposal_page` for one bounded `open` or `history` page
(default 25, maximum 100, optional keyset cursor) and
`ingenium_skill_proposal_counts` for scoped totals. Proposal rows are retained;
the page and counts tools are the bounded read surface.

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

30 tools: create, list, move, reserve, release, complete, next, update, delete, search, comment, activity, link, board_config_get, board_config_set, subtask_create, notifications, get, comments_list, comment_edit, comment_react, links_list, link_delete, tree, notification_read, bulk_update, coordination_status, coordination_update, coordination_claim, coordination_release.

`ingenium_task_reserve` and `ingenium_task_release` are cooperative managed-agent
operations. They require the same project and canonical worktree boundary,
expected revision, idempotency key, owner, worktree, and a caller-held
32–512-character URL-safe opaque reservation token. Only the token's SHA-256
hash is stored; neither the token nor hash is returned. Manual editors and
external processes are outside the guarantee.

The coordination tools are project-scoped and use snake_case inputs. They map
to status (`GET /coordination/snapshot`), session operations (`register`,
`recover`, `update`, `heartbeat`, `close`, `takeover`), atomic claim batches
(`POST /coordination/claims/batch`), and atomic releases
(`POST /coordination/claims/release`). Status claims are redacted to IDs,
kind/state, and timestamps; token material, claim values, and baselines are
never returned. Transport failures return the fixed
`COORDINATION_UNAVAILABLE`; malformed API data returns
`COORDINATION_INVALID_RESPONSE`; upstream errors are reduced to an allowlisted
typed code with a fixed message.

## PLANS — Saved notes & context (legacy)

`ingenium_plan_save`, `ingenium_plan_search`, `ingenium_plan_list`.

## CONTEXT — Canonical agent memory and immutable conversations

| Tool | What it does |
|------|-------------|
| `ingenium_context_get` | Get a single canonical agent memory entry by ID |
| `ingenium_context_update` | Update an existing context entry (content, tags, priority, source, metadata) |
| `ingenium_context_delete` | Delete a context entry |
| `ingenium_context_batch_get` | Batch retrieve multiple context entries by ID (max 100) |

### Context-native file upload

`ingenium_context_upload_file` imports one protected local file as a bounded,
immutable Context conversation snapshot. Its exact input schema is:

```typescript
{
  project: string;
  session: string;
  file_path: string; // absolute safe path
  conversation_id?: string; // UUID
  tags?: string[];
  priority?: number; // integer 0–10
}
```

`project`, `session`, and `file_path` are required; `conversation_id`, `tags`,
and `priority` are optional. The launcher requires the project to match its
bound project. The file must be a private regular file below the verified
project root `.ingenium/context-uploads`; symlinked roots, parents, and files
are rejected. The upload is bounded to 8 MiB and is read once via a single
`O_NOFOLLOW` descriptor with identity checks before and after the read.

Supported input is OpenCode export JSON, simple JSON, JSONL/NDJSON, Markdown,
and plain text. Parsing keeps visible `user` and completed `assistant`
messages, excludes synthetic/ignored/hidden entries, and never imports other
roles or invisible parts. The MCP transport creates one complete
descriptor-safe snapshot and makes one protected internal handoff; the API
performs one transactional snapshot import rather than exposing a public
bulk-message API.

Without `conversation_id`, the snapshot creates a conversation. With it, the
target conversation is adopted only when it belongs to the project and the
incoming entries match the existing prefix. Replays are idempotent; a longer
matching snapshot appends only its suffix and refreshes the imported suffix
mapping. Shorter snapshots, source-key reuse, or divergent prefixes are
rejected without partial writes.

The dashboard Context workspace makes imported conversations visible at
`/context`. Its index remains metadata-only; selecting a conversation uses
`ingenium_context_conversation_list`,
`ingenium_context_conversation_get`,
`ingenium_context_message_search`,
`ingenium_context_message_retrieve`, and
`ingenium_context_message_batch_retrieve` to load ordered content. There is no
external Thread service or bridge, and no old current-session or OpenCode-session
import tool surface.

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

## BACKUPS — Database snapshots and restore (12 tools)

| Tool | What it does |
|------|-------------|
| `ingenium_backup_create` | Create a new backup snapshot (Ingenium + OpenCode DB) |
| `ingenium_backup_list` | List all server-owned backups (the server resolves the active global project) |
| `ingenium_backup_get` | Get a single backup record by ID |
| `ingenium_backup_download` | Download a backup archive to a validated path |
| `ingenium_backup_delete` | Delete a backup by ID |
| `ingenium_backup_restore_preview` | Create or replay a durable dry-run restore plan |
| `ingenium_backup_restore_authorize` | Issue the plan's one-time confirmation token |
| `ingenium_backup_restore_start` | Confirm a plan, atomically stage verified tamper-evident copies, and advance it to external-executor readiness without applying data |
| `ingenium_backup_restore_status` | Get the current content-free restore-plan state |
| `ingenium_backup_restore_audit_list` | List bounded immutable restore-plan audit evidence |
| `ingenium_backup_restore_execution_authorize` | Issue the distinct one-time RESTORE-101 execution token for a ready plan |
| `ingenium_backup_restore_execute` | Consume the execution token, queue the fixed maintenance executor, and return `202` without applying bytes |
| `ingenium_backup_schedule_get` | Get the current backup schedule configuration |
| `ingenium_backup_schedule_set` | Set/update the backup schedule configuration |

Restore is a RESTORE-100/101 contract: the server-global v2 bundle is
validated, legacy bundles are preview-only, and confirmation reaches
`ready_for_executor` without applying data. A separate 15-minute one-time
execution token can only queue the static Supervisor executor; it returns
`202` and never exposes paths, buffers, ownership values, or process controls.
The source is preserved, status and audit are content-free, and idempotency/CAS
conflicts fail closed. The old `confirm: true` path is unavailable (`410
RESTORE_MIGRATION_REQUIRED`).

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
| `ingenium_docs_rag_stats` | Get RAG index statistics (`total_sources`, `total_chunks`) |

**Indexing sources**: (1) Canonical repo Markdown files via `POST /rag/ingest` using `INGENIUM_DOCS_ROOT` — walked from `{root}/docs/`, symlink-protected, hash-idempotent. (2) Docs Workspace pages at lifecycle boundaries (publish, update, archive, restore) — auto-indexed as `docs-page:{id}`. (3) Manual ingestion via `ingenium_docs_ingest`.

**Search strategy**: The `/search` and `/ask` routes use BM25 FTS5 via `searchChunks()` across retained RAG source chunks. Migration 070 removed the legacy embedding table; no vector or hybrid retrieval feature is exposed. See `packages/ingenium-core/lib/tools/rag.ts`.

## SERVERS — Child MCP servers

Legacy server-definition compatibility tools: `ingenium_server_list`,
`ingenium_server_add`, `ingenium_server_remove`, `ingenium_server_update`, and
`ingenium_server_sync_all`. Canonical child-server definitions are exposed by
the `/api/v1/mcp-servers` API and use shell-free executables plus vault
environment references. Discovered child tools use exactly one lowercase
`ingenium_<server>_<tool>` namespace.

## AGENTS — AI sub-personalities

`ingenium_agent_list`, `ingenium_agent_get`, `ingenium_agent_create`, `ingenium_agent_update`, `ingenium_agent_delete`, `ingenium_agent_enable`, `ingenium_agent_disable`, `ingenium_agent_sync`.

## EMAIL — Full email management via MCP

27 tools: list, search, read, send, draft, folders, accounts, triage, suggest, draft_response, patterns, watch_start, watch_status, account_create, account_delete, account_test, oauth_url, oauth_exchange, summarize, review_draft, move, set_flags, delete, sync, sync_status, watch_stop, attachment_get.

## LOGS — System logging

`ingenium_logs_list`, `ingenium_logs_sources`.

## JOBS — Background scheduled tasks

10 tools: list, create, update, delete, run, runs, run_logs, run_cancel, get, suggest.

`job_create` accepts optional `vault_item_ids` (up to 16 unique UUIDs) for
metadata-only authorization of active same-project vault items. `job_update`
omits the field to preserve references, replaces with a supplied list, and
revokes all with `[]`. Job responses expose only item ID, availability,
authorization timestamp, and item version; no MCP job tool reveals, decrypts, or
unseals a vault value. This extends the existing job tools; no new MCP tool is
added.

## DOCUMENTATION — Full docs workspace (48 tools)

All tools use the `ingenium_docs_` prefix. Categories: Spaces (5), Pages & Tree (6), Page Actions (6), Versions (3), Search (1), Tags (4), Backlinks (1), Comments (4), Attachments (3), Templates (5), Project Links (3), Favorites (2), Trash (2), Import/Export (2), Stats (1).

Full route reference: [docs-workspace.md](docs-workspace.md).

---

**Built-in baseline: 282 tools across 30 categories (280 `ingenium_` catalog entries + 2 extension).** Project-scoped child
discovery can add tools and categories at runtime; use the project-scoped
catalog endpoint for the current total.
