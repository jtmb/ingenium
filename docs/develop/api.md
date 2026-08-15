---
title: API Reference
description: REST API design reference for the Ingenium system — endpoint catalog, data flow, and configuration.
---

# API Reference

## Overview

The published Ingenium API boundary is `127.0.0.1:4097`; it validates a
mandatory bearer token and forwards to the private Express listener on
container port `4096`, which is the sole database authority. Host port `1455`
reaches the Nginx callback listener, which forwards only the exact
`GET /auth/callback` path to private Express `4096`.

## Repository synchronization boundary

Git is authoritative for external worktree resources. The supported path is:

```text
Git worktree files → @ingenium/extension resource-sync plugin → configured
Ingenium MCP stdio transport → authenticated Ingenium API → database
```

Plugins, CLIs, and agents never read/write the database or call mutation REST
endpoints directly. `ingenium-core` is API-internal and unavailable to runtime
consumers. `ingenium_skill_sync*` and skill CRUD remain API-host/admin
repair/import interfaces, not automatic worktree sync.

## Public Endpoint (Auth Allowlist)

The following endpoint is the sole exact unauthenticated exception. The auth
middleware explicitly allowlists this method/path so provider redirects can
arrive without a local bearer credential:

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/auth/callback` | OAuth callback receiver for native OpenCode provider integrations. Validates state/code from `pendingOAuthAttempts` Map (10-min TTL). Supports both **auto mode** (forwards to OpenCode's internal `localhost:1455/auth/callback` listener) and **code mode** (completes via OpenCodeClient). State is consumed on first use to prevent redirect replay. Malformed states (>1024 chars or containing control chars) rejected with 400. |

### Authenticated Extension Preflight

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/auth/preflight` | Authenticated capability probe. Scoped credentials receive server-derived scopes, audience, organization/project grants, workspace/worktree binding, and restart guidance. Invalid credentials return `401`, missing scope `403`, and inaccessible bindings `404`; failures never disclose credential or upstream details. |
| GET/POST | `/api/v1/auth/mcp-credentials` | List redacted metadata or issue a scoped service/runtime/repository-sync credential. Human issuance requires recent step-up; plaintext is returned once. `servicePrincipalId` is optional and omission creates the credential's service principal atomically. |
| POST | `/api/v1/auth/mcp-credentials/:id/rotate` | Issue a replacement and immediately revoke the prior credential. Requires recent step-up; plaintext is returned once. |
| DELETE | `/api/v1/auth/mcp-credentials/:id` | Immediately revoke a credential. Requires recent step-up. |

### OIDC authentication

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/auth/oidc/providers` | Return enabled provider IDs and labels only. |
| POST | `/api/v1/auth/oidc/start` | Begin Authorization Code + PKCE after pre-auth CSRF and the per-IP/provider start limit. Sets the HttpOnly transaction cookie. |
| GET | `/api/v1/auth/oidc/callback` | Complete the cookie-bound transaction under the independent callback limit. Invalid authorization returns `401 OIDC_AUTHENTICATION_FAILED`; bounded provider failures return `502 OIDC_PROVIDER_UNAVAILABLE`; budget expiry returns `504 OIDC_PROVIDER_TIMEOUT`. Error bodies never include endpoint, address, claim, token, or upstream details. |

OIDC discovery, token, and JWKS requests use a DNS-pinned, proxy-independent,
zero-redirect HTTPS transport. Discovery/token responses are capped at 64 KiB,
JWKS at 256 KiB, token requests at 16 KiB, each request at five seconds, and a
callback at 15 seconds. JSON-compatible object responses and identity encoding
are mandatory.

## Startup Behavior

The API performs the following at startup (in order):

1. **Validate API token and auth key** — Startup fails closed if the mandatory token/protected token file or owner-only 256-bit authentication encryption key file is missing or invalid.
2. **Listen on private port** — The Express server starts on container port `4096`; the public boundary is `4097`.
3. **Ensure global project** — `ensureGlobalProject()` idempotently creates the `global-default` project if it does not exist. This is required by the scheduler (synthesis interval resolution) and the email engine (account storage). Local development benefits from the same auto-bootstrap as Docker deployments.
4. **Start scheduler** — The synthesis, mail sync, job cron, and lock cleanup schedulers begin their cycles after a staggered delay.
5. **WAL checkpoint + integrity check** — Runs `wal_checkpoint(TRUNCATE)` and `integrity_check` to ensure the DB is healthy before the scheduler writes data.
6. **Start email engine** — Deferred by 10 seconds to let the DB fully initialize. If `getGlobalProjectId()` fails (no global project), the engine start is skipped with a warning.

### Graceful Degradation

If the global project is unavailable:

- **Health endpoint** (`GET /api/v1/health`) — responds with `200 OK` with a valid bearer even with zero projects; it is not unauthenticated
- **Mail sync** — skips silently with a `debug`-level log: `"Skipping mail sync — no global project configured"`
- **Synthesis** — reads interval from the env var default (15 min) and logs that no global project is configured
- **All other routes** — operate normally on a per-project basis

See the [startup regression tests](../../services/ingenium-api/tests/startup.test.ts) for coverage of these scenarios.

## Configuration

- **Ports**: public bearer boundary `4097`; private Express listener `4096` in Docker (configurable via `INGENIUM_API_PORT`)
- **Body limit**: `express.json({ limit: "2mb" })` for large skill/plugin uploads
- **Security**: helmet for security headers (default configuration — no custom CSP), CORS and browser mutation CSRF share the exact `DASHBOARD_ALLOWED_ORIGINS` allowlist, mandatory bearer auth; browser mutations also require the dashboard marker contract
- **Rate limits**: Three independent in-memory sliding-window rate limiters:

  | Limiter | Default | Applies To | Location |
  |---------|---------|------------|----------|
  | General API | 100 req/min per IP | All authenticated routes (before auth middleware to throttle brute-force) | `lib/middleware/rate-limit.ts` |
  | Vault | 5 req/min per IP | All `/api/v1/vault/*` routes | `scripts/api-server.ts:134` |
  | OAuth callback | 20 req/min per IP | `GET /auth/callback` (public, before auth) | `lib/routes/opencode.ts` |
  | OIDC start/callback | 5 req/min per IP/provider and phase | `/api/v1/auth/oidc/start` and `/api/v1/auth/oidc/callback` | `lib/middleware/auth-rate-limit.ts` |

  > Rate limit state is in-memory only — resets on process restart. Suitable for single-instance deployments with supervisord restarts. For multi-replica deployments, replace with Redis or an external store.

- **CSP**: Helmet's default Content-Security-Policy is applied to the dashboard.
  OpenCode and VS Code are trusted separate-origin iframes without a `sandbox`
  attribute. The gateway owns the `frame-ancestors` policy and applies the
  validated dashboard/runtime frame and connection allowlists; private
  4098/4099/4100 listeners remain unpublished. See [Iframe Sandbox](../security/iframe-sandbox.md)
  for the security boundary and current verification status.

## API Endpoints by Category

### Dashboard Summary
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/dashboard/summary` | Aggregated home dashboard endpoint |

### Usage telemetry

All routes below require `?project=<name>`. Usage collection is metadata-only:
it never returns or persists prompt/message text, reasoning content, tool
payloads, or credentials. It can persist numeric reasoning-token metadata and
nullable assistant-agent attribution. `from` is inclusive and `to` is exclusive
UTC ISO timestamps; ranges are limited to 366 days. Provider/model/agent/status
filters may be repeated. Event pagination is cursor-based (maximum 200 rows), and CSV
exports are capped at 10,000 rows with a continuation cursor header when
truncated.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/usage/summary` | Totals, complete UTC daily series, and freshness metadata. Cost and metric availability distinguish `known`, `partial`, and `unavailable`; cache and reasoning-token counts are nullable and no hit rate is invented. |
| GET | `/api/v1/usage/breakdown` | Provider/model/assistant-agent breakdown for the filtered UTC range. Raw provider and model IDs are preserved; assistant-agent attribution is nullable. |
| GET | `/api/v1/usage/events` | Bounded metadata-only event page with `pagination.nextCursor`, `hasMore`, and `total`. |
| GET | `/api/v1/usage/export` | Bounded deterministic CSV export. Returns `X-Export-Truncated` and, when applicable, `X-Export-Next-Cursor`. |
| GET | `/api/v1/usage/mappings` | List this Ingenium project's explicit OpenCode project mappings. |
| PUT | `/api/v1/usage/mappings` | Create or confirm an explicit mapping with `{ "opencodeProjectId": "…" }`. A source mapping owned by another project returns `409`; there is no global fallback. |
| POST | `/api/v1/usage/sync` | Run a bounded manual metadata-only usage sync for this project's explicit mappings. |
| GET | `/api/v1/usage/thresholds` | Read this project's nullable advisory thresholds. |
| PUT | `/api/v1/usage/thresholds` | CAS-replace all five threshold fields; requires `expected_revision`. |
| GET | `/api/v1/usage/thresholds/evaluate` | Read-only evaluation over caller-selected UTC `from`/`to`, or all history when both are omitted. |
| GET | `/api/v1/usage/attention` | Cursor-page active attention items by default (maximum 100); `include_resolved=true` includes resolved items. |
| POST | `/api/v1/usage/attention/evaluate` | Reconcile the five fixed all-history attention conditions. The request has no payload or range options. |
| POST | `/api/v1/usage/attention/:id/acknowledge` | CAS-acknowledge an item with `{ "expected_revision": number }`. A stale revision returns `409 USAGE_ATTENTION_REVISION_CONFLICT`; an exact retry is safe. |

The scheduler runs the same bounded collector every five minutes by default.
Unmapped OpenCode projects are quarantined without usage-event insertion until a
project owner creates an explicit mapping.

#### Advisory thresholds (USAGE-100)

Thresholds are one project-scoped, nullable configuration row over the existing
usage aggregates. `PUT` replaces request count, total tokens,
provider-reported cost amount, cache-read tokens, and cache-write tokens as a
single CAS-protected update; clients must send `expected_revision`. A stale
revision returns `409 USAGE_THRESHOLD_REVISION_CONFLICT`. The all-null default
is revision 1, and there is no delete route.

`GET /thresholds/evaluate` is read-only. With both `from` and `to`, it evaluates
an inclusive-start/exclusive-end UTC ISO range; with neither, it evaluates all
history. Partial input, inverted ranges, non-UTC timestamps, and ranges over
366 days are rejected. Each metric returns `observed`, `threshold`,
`availability`, and one of `disabled`, `unknown`, `below`, `equal`, or `above`.

#### Usage attention (USAGE-101)

Attention is advisory and project-scoped. Reconciliation always evaluates the
five stable all-history conditions, not a caller-selected range. `unknown`,
`equal`, and `above` create or retain active items with `info`, `warning`, and
`critical` severity respectively; `disabled` and `below` resolve an existing
item. Each condition has at most one item per project. Transition events are
immutable and occur only for opening, resolution, reopening, acknowledgement,
or material active changes to evaluation state, severity, freshness, or
threshold revision.

Attention reconciliation is also run by the API scheduler for each mapped
project after the bounded usage-sync cycle, using `USAGE_SYNC_INTERVAL_MS`
(five minutes by default). A failed or no-new-data cycle still reconciles
freshness; setting the interval to `0` disables both scheduled usage sync and
attention evaluation. Attention freshness is based only on mapped-source successful-sync evidence:
missing evidence is `unknown`, any source older than twice the configured sync
interval is `stale`, and an interval of zero is `disabled`. Attention responses
omit provider IDs, source identifiers, raw telemetry payloads, and credentials.
Known zero remains known; partial or unavailable subtotals remain unknown for
comparison. Cost is the provider-reported numeric amount only—no currency,
pricing, or billing inference is performed. Evaluation does not mutate
thresholds, usage events, mappings, sync cursors, or request execution.

These routes use the normal bearer authentication and `?project=<name>`
ownership check. Missing projects return `404`; foreign project data is not
returned. The result is advisory only and never blocks, throttles, or routes a
request. No MCP endpoint is defined for this contract.

Collection is provider-agnostic: every supported OpenCode provider contributes
through the same assistant `step-finish` metadata path, while raw provider and
model IDs remain available for breakdowns. Agent attribution comes only from the
assistant message that owns the step-finish and remains `null` when unavailable.
If a message contains one step-finish, message-level token metadata (including
numeric reasoning tokens) may fill omitted part-level counters; values are not
redistributed across multiple step-finish parts. Cost, cache, and reasoning-token
data that is absent remains explicitly unknown.

### Projects
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/projects` | List all active projects |
| POST | `/api/v1/projects` | Create a new project |
| PATCH | `/api/v1/projects/:name` | Rename a project |
| DELETE | `/api/v1/projects/:name` | Archive a project |
| POST | `/api/v1/projects/:name/restore` | Restore an archived project |
| GET | `/api/v1/projects/archive` | List archived projects |
| POST | `/api/v1/projects/purge` | Purge expired projects |
| POST | `/api/v1/projects/migrate-workspace` | DB-only migration of historical invalid `/workspace` project into `global-default`. Optional `dry_run: true` for pre-flight validation. Returns `WorkspaceMigrationResult`. Never touches filesystem. |

### Skills
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/skills` | List all skills |
| GET | `/api/v1/skills/:name` | Get a skill by name |
| POST | `/api/v1/skills` | Create a new skill |
| PATCH | `/api/v1/skills/:name` | Update a skill |
| DELETE | `/api/v1/skills/:name` | Archive a skill (soft-delete) |
| GET | `/api/v1/skills/search?q=...` | FTS5 search across skills |
| GET | `/api/v1/skills/proposals` | Retired unbounded proposal list; returns `410 SKILL_PROPOSAL_LIST_RETIRED` and points callers to the bounded routes |
| GET | `/api/v1/skills/proposals/counts` | Return project-scoped counts for open and retained proposal history |
| GET | `/api/v1/skills/proposals/page?view=<open-or-history>&limit=&cursor=` | Return one keyset page of proposal summaries; `limit` defaults to 25 and is capped at 100 |

Proposal rows are retained indefinitely. The `open` view contains `draft` and
`pending` rows; `history` contains `stale`, `rejected`, `applied`, and
`rolled_back` rows. The cursor is project-scoped and ordered by
`created_at DESC, id DESC`.

Update proposals may use `proposedState.fileTreePatch` for additive auxiliary
files. It is merged with the target's current `fileTree` on approval and is
mutually exclusive with a full `proposedState.fileTree` snapshot.

### Observations
Observation and personality endpoints require a valid `?project=<name>` query
parameter. Detail and mutation routes return `404 Not Found` when the requested
observation or trait is not visible to the authenticated owner and project scope.
New behavior observations and traits are user-private by default; callers may
request explicit `visibility: "organization"` for organization automation.
List, search, stats, profile, and mutation queries apply owner/organization scope
in SQL before returning rows.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/observations` | List observations |
| POST | `/api/v1/observations` | Store observation |
| GET | `/api/v1/observations/search?q=...` | FTS5 search |
| GET | `/api/v1/observations/stats` | Pipeline statistics |
| GET | `/api/v1/observations/:id` | Get a project-owned observation |
| PATCH | `/api/v1/observations/:id` | Update a project-owned observation |
| POST | `/api/v1/extraction/run` | Trigger server-side extraction |

### Personality
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/personality` | List traits |
| GET | `/api/v1/personality/profile` | Get aggregated profile |
| POST | `/api/v1/personality/:id/disable` | Disable trait |

### Synthesis
| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/v1/synthesis/run` | Trigger synthesis pipeline |
| GET | `/api/v1/synthesis/status` | Check pipeline status |

### Config
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/config` | Get project config |
| PUT | `/api/v1/config` | Update project config |
| POST | `/api/v1/config/sync` | Sync config from disk to DB |

### Email

All email routes are prefixed with `/api/v1/emails`. The mail engine is hosted by
the canonical global runtime, while account access is organization-qualified and
owner-authorized. Organization-owned accounts use organization/project roles;
private accounts require the owner or an explicit grant. Unauthorized account
IDs return `404`.

Browser users create private-owned accounts and OAuth attempts by default.
`owner_kind=organization` requires organization write/admin permission for both
manual account creation and OAuth initiation. Sync-status engine details are
projected only for the authorized account and never include other engine workers.

> 🔴 `GET /accounts` by default returns only non-hidden accounts. Pass `?include_hidden=true` to include hidden accounts.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| **OAuth** | | |
| GET | `/accounts/oauth/url?provider=&owner_kind=&account_id=` | Create a ten-minute organization-qualified, consume-once OAuth attempt and return its authorization URL plus bound account ID |
| POST | `/accounts/oauth` | Exchange OAuth code for tokens |
| **Account Management** | | |
| GET | `/accounts` | List email accounts (`?include_hidden=true` for all) |
| POST | `/accounts` | Create a new email account |
| PATCH | `/accounts/:id` | Update account metadata (e.g., `{"hidden": true}`) |
| DELETE | `/accounts/:id` | Delete an email account (stops sync worker and IMAP watcher, clears durable migration-092 watcher markers for the account, then clears cache) |
| POST | `/accounts/:id/test` | Test IMAP connection |
| **Email Reading** | | |
| GET | `/?account=&folder=&page=&limit=&refresh=` | List cached emails in a folder |
| GET | `/:uid?account=&folder=` | Get a single email by UID (body fetch with 12s timeout) |
| **Search & Triage** | | |
| GET | `/search?account=&folder=&q=` | Search cached emails by keyword/sender/subject/date |
| GET | `/triage?account=&limit=` | Triage unread emails (cache-only) |
| **Folders** | | |
| GET | `/folders?account=` | List IMAP folders (engine-first, cache fallback) |
| **Smart Replies** | | |
| GET | `/suggest/:uid?account=&folder=` | Smart-reply suggestions (cache-first, LLM-generated) |
| GET | `/summarize/:uid?account=&folder=` | LLM-generated email summary (cache-first) |
| POST | `/review-draft` | LLM-powered draft review and improvement |
| **Send & Draft** | | |
| POST | `/draft` | Save a draft email |
| POST | `/` | Send an email |
| **Move & Flags** | | |
| PATCH | `/:uid/move` | Move an email to another folder |
| PATCH | `/:uid/flags` | Set flags on an email |
| DELETE | `/:uid` | Delete an email (moves to Trash via IMAP) |
| **Attachments** | | |
| GET | `/:id/attachments/:attachmentId` | Download an attachment by part ID |
| **Sync Engine** | | |
| POST | `/sync` | Hint the sync engine to prioritize a folder |
| GET | `/sync-status` | Per-folder sync status from the engine |
| **IMAP Watcher** | | |
| POST | `/watch/start` | Start IMAP IDLE watcher for real-time monitoring |
| POST | `/watch/stop` | Stop IMAP IDLE watcher |
| GET | `/watch/status` | Get watcher status for an account |

### Jobs (JOB-100/JOB-101)

JOB-100 defines the v1 trusted-event boundary and JOB-101 provides exact-match dispatch.
The exact catalog is:

- `context.conversation.archived`
- `context.conversation.unarchived`
- `context.checkpoint.restored_as_new`

Trusted events are project-scoped, content-free, schema version `1`, and produced
only by `context.maintenance`. Archive/unarchive payloads contain exactly
`conversationId`, `expectedRevision`, and `archiveSequence`; restore payloads
contain exactly `sourceConversationId`, `sourceCheckpointId`,
`targetConversationId`, and `expectedRevision`. Each event is tied to its
immutable Context audit row by `source_audit_event_id`; the dedupe key is the
same source audit ID within the project. Rows are append-only and retained
indefinitely unless an explicit authorized project lifecycle action applies.
Payloads are bounded and contain no message, content, title, secret, token, or
credential data.

SQL constraints and API validation reject unknown catalog values, including
direct SQL attempts. Existing historical `jobs.trigger_event` values are
preserved; new job rows and trigger changes accept only a catalog value or
`NULL`. The v1 event store has no user-facing append endpoint: events are
created only from the trusted Context maintenance provenance path. JOB-101
snapshots each event once, including zero-match snapshots, and creates one
durable delivery for each enabled same-project job whose `trigger_event`
exactly matches the event type. Enqueue is exactly-once; execution is bounded
at-least-once with five attempts and 30/60/120/300/600-second backoffs. Leases
persist only a SHA-256 owner hash and use CAS revisions. An ambiguous process
identity is dead-lettered rather than duplicated. Job deletion returns `409`
while a delivery is active, then disables/hides the job while retaining its
delivery and attempt evidence. Payloads and prompts are never exposed or
interpolated, and no manual replay endpoint exists.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/jobs` | List all jobs |
| POST | `/api/v1/jobs/suggest` | Derive job config from description |
| GET | `/api/v1/jobs/events?project=<name>&limit=&cursor=` | Bounded project-scoped trusted-event metadata |
| GET | `/api/v1/jobs/event-deliveries?project=<name>&limit=&cursor=` | Bounded project-scoped delivery metadata |
| GET | `/api/v1/jobs/event-deliveries/:deliveryId?project=<name>` | Get one project-scoped delivery |
| POST | `/api/v1/jobs/runs/:runId/cancel?project=<name>` | Cancel a project-owned run |
| GET | `/api/v1/jobs/runs/:runId/logs?project=<name>&after=` | Read project-owned run logs with redaction |

#### Job vault references (VAULT-100)

`POST /api/v1/jobs` and `PATCH /api/v1/jobs/:id` accept optional
`vault_item_ids`, an array of at most 16 unique UUIDs. On create, omission means
no references. On update, omission preserves the current set; a supplied list
replaces it and `[]` revokes all references. Every ID must identify an active
vault item in the requested project. Missing, foreign-project, deleted, or
otherwise unavailable items return the same generic `422 VAULT_ITEM_NOT_FOUND`;
malformed, duplicate, or over-limit arrays return `422 VALIDATION_ERROR`.

Job responses expose `vault_references` as metadata only: `item_id`,
`status`, `authorized_item_version`, and `authorized_at`. `status` is one of
`authorized`, `version_stale`, or `unavailable`. This projection is the
same while the vault is sealed or unsealed and never decrypts or unseals the
vault. Item versions are captured at authorization, so stable item IDs and
revision provenance remain visible without exposing names, values, ciphertext,
or user-controlled vault metadata. Authorization/revocation rows are immutable
and record actor `authenticated_api`; no runner, log, or MCP response contains
a secret value.

Job updates require `expected_revision`. Migration 082 initializes revisions at
`0`, advances them exactly once per direct SQL update, and returns
`409 JOB_REVISION_CONFLICT` with the current revision when the caller is stale.
The dashboard keeps the unsaved draft on this conflict until the user explicitly
reloads the current job.

### Task coordination (COORD-100)

Task coordination is a cooperative boundary for managed agents operating in the
same project and canonical worktree. It does not prevent or promise protection
against manual editor or external-process writes; those are explicitly outside
this guarantee. Task reads and mutations are project-scoped, and mutation
requests support an expected revision (CAS) plus an idempotency key whose
request hash makes matching retries replay the original result and changed
replays fail.

Managed reservation routes require `owner`, `worktree`, `reservation_token`,
`expected_revision`, and `idempotency_key`. The caller holds a 32–512 character
URL-safe opaque token (`[A-Za-z0-9_-]`); the server stores only its SHA-256 hash
and never returns the token or hash.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/v1/tasks/:id/reserve?project=<name>` | Atomically reserve an available task for the supplied owner/worktree and caller-held token. |
| POST | `/api/v1/tasks/:id/release?project=<name>` | Atomically release the reservation when owner, worktree, token, and expected revision match. |

Both routes return the task in `data` and use `422 INVALID_TASK_MUTATION_INPUT`,
`404 TASK_NOT_FOUND`, or `409` for `REVISION_CONFLICT`,
`IDEMPOTENCY_KEY_REUSED`, `RESERVATION_CONFLICT`, `RESERVATION_NOT_HELD`,
`RESERVATION_OWNER_MISMATCH`, and `RESERVATION_QUARANTINED` as applicable.

### Task source references

### Coordination registry (COORD-102)

The project-scoped coordination transport exposes nine routes. Every route uses
`?project=<name>`; mutation bodies use snake_case fields and an
`Idempotency-Key` header or matching `idempotency_key` body field. The raw
ownership token is caller-held and is never returned.

| Method | Endpoint | Required body/query fields | Purpose |
|--------|----------|-----------------------------|---------|
| POST | `/api/v1/coordination/register?project=<name>` | `worktree_id`, `session_id`, `incarnation`, `ownership_token`, `ttl_ms`, `idempotency_key` | Register an active session and allocate its fence. |
| POST | `/api/v1/coordination/recover?project=<name>` | Lease fields plus `next_ownership_token`, `ttl_ms` | Prove the prior lease, rotate ownership, and advance the fence. |
| PATCH | `/api/v1/coordination/update?project=<name>` | Lease fields plus `snapshot`, `snapshot_revision`, task/context pointer pairs | Update the bounded snapshot and exact project-owned pointers. |
| POST | `/api/v1/coordination/heartbeat?project=<name>` | Lease fields plus `ttl_ms` | Extend an unexpired active lease. |
| GET | `/api/v1/coordination/snapshot?project=<name>&worktree_id=…&session_id=…&incarnation=…` | Query identity | Read redacted session and claim status. |
| POST | `/api/v1/coordination/claims/batch?project=<name>` | Lease fields plus `claims[]` with optional `baseline_sha256` | Atomically claim a non-overlapping batch. |
| POST | `/api/v1/coordination/claims/release?project=<name>` | Lease fields plus `claim_ids` | Atomically release owned claims. |
| POST | `/api/v1/coordination/close?project=<name>` | Lease fields | Close the session and release active claims while retaining evidence. |
| POST | `/api/v1/coordination/takeover?project=<name>` | `worktree_id`, `session_id`, `incarnation`, `expected_revision`, `fence`, `next_ownership_token`, `ttl_ms`, `idempotency_key` | Perform an API-authorized takeover without accepting the old token; returns a non-secret `takeoverEvidenceId`. |

Lease fields are `worktree_id`, `session_id`, `incarnation`,
`expected_revision`, `fence`, and `ownership_token`. Snapshot pointers are
`current_task_id`/`current_task_revision` and
`context_conversation_id`/`context_revision`. Successful mutations return
`data.session`; claim mutations also return `claimIds`. Status returns
`data.session`, redacted claim records (`id`, `kind`, `state`, timestamps),
`claimCount`, and `claimsTruncated`; claim values, baselines, and token
material are not returned.

Validation errors return `422 INVALID_COORDINATION_INPUT`; missing projects,
sessions, claims, or pointers return `404`; conflicts return `409` with typed
codes including `SESSION_IDENTITY_CONFLICT`, `SESSION_CLOSED`,
`SESSION_NOT_ACTIVE`, `SESSION_EXPIRED`, `REVISION_CONFLICT`, `FENCE_CONFLICT`,
`OWNERSHIP_TOKEN_MISMATCH`, `IDEMPOTENCY_KEY_REUSED`, `CLAIM_CONFLICT`,
`CLAIM_NOT_OWNED`, and `POINTER_REVISION_CONFLICT`. Integrity failures return
`500 COORDINATION_INTEGRITY_ERROR`. A revision conflict may include
`currentRevision`; error messages do not disclose token material.

The four MCP tools map to these operations: `ingenium_coordination_status`
reads `GET /snapshot`; `ingenium_coordination_update` dispatches `register`,
`recover`, `update`, `heartbeat`, `close`, or `takeover`; and
`ingenium_coordination_claim` and `ingenium_coordination_release` dispatch
`POST /claims/batch` and `POST /claims/release`. The MCP adapter projects only
allowlisted redacted fields, converts malformed API data to
`COORDINATION_INVALID_RESPONSE`, and converts transport failures to
`COORDINATION_UNAVAILABLE`; it does not expose raw upstream errors or tokens.

Task references attach a task to one trusted source using a server-derived,
metadata-only snapshot. The five supported `source_type` values are `email`,
`chat`, `context`, `job`, and `docs`. The create body is strictly
`{ "source_type": "…", "source_id": "…" }`; clients must treat `source_id`
as a canonical opaque identifier and should rely on future capture adapters
instead of constructing or decoding IDs themselves. No source body, attachment,
secret, or other source content is accepted or returned.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/v1/tasks/:taskId/references?project=<name>` | Create a trusted task reference. Returns `201` for a new reference and `200` for the same task/source duplicate. |
| GET | `/api/v1/tasks/:taskId/references?project=<name>` | List references and their immutable display snapshot plus current `availability`. |
| DELETE | `/api/v1/tasks/:taskId/references?project=<name>&reference_id=<referenceId>` | Delete a reference; the member form `/references/:referenceId` is also supported. |

Canonical source IDs are opaque to clients: email and chat use canonical
base64url identities; context and job use UUIDs; docs uses a canonical positive
page ID. The server resolves and validates ownership before creating a
reference. Email and chat are global-project sources; context and jobs are
project-scoped; docs are global unless explicitly linked to a project.

The saved `display_title`, `display_detail`, and `source_timestamp` are an
immutable display snapshot. They do not expose source content. Reads report one
of `available`, `missing`, or `unavailable`: a deleted, archived, unlinked, or
otherwise unresolvable source is reported as missing without disclosing source
details; a temporary upstream failure is unavailable. Unknown or foreign task
references use the neutral `404 TASK_REFERENCE_NOT_FOUND`; malformed input uses
neutral `422 VALIDATION_ERROR`; a temporarily unavailable chat source uses
neutral `503 TASK_REFERENCE_UNAVAILABLE`.

Task reference routes are REST-only in this contract. No MCP task-reference
tools are defined here.

### Settings — LLM Config

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/settings/provider-configs` | Read the ordered managed provider collection. Each provider block returns: `id`, `name`, `npm`, `baseURL`, `models`, `defaultModel`, `roles: ("available"\|"primary"\|"backup")[]`, `enabled`, `allowPrivateNetwork: boolean`, and `apiKeySet: boolean` — **the actual API key is never returned**. Falls back to legacy primary/backup settings until the collection is first saved. At most one provider may have `primary` in its roles array and at most one may have `backup`. Also returns `synthesis` object with `{ primary: { providerId, modelId }, secondary: { providerId, modelId } }` — the explicit synthesis provider+model selection, which may differ from the role-derived defaults. |
| PUT | `/api/v1/settings/provider-configs` | Atomically save any number of provider blocks. Accepts `roles` array and/or legacy `role` scalar (`available`\|`primary`\|`backup`) for backwards compatibility. `roles` supports multi-role: `["available", "primary"]` or `["available", "backup"]`. Also accepts an optional `synthesis` body field with `{ primary?: SynthesisSelection, secondary?: SynthesisSelection }` to override the role-derived synthesis provider selections — enabling same-provider different-model configurations. Validates exclusivity (at most one primary, at most one backup), synthesis selection constraints (cannot select the same provider+model for both primary and secondary), endpoint SSRF policy via `validateEndpointUrl`, and `allowPrivateNetwork` flag. Projects into OpenCode global config and mirrors synthesis selections into synthesis settings. API keys are stored in the encrypted vault (`vault_items` table, AES-256-GCM). |
| GET | `/api/v1/settings/llm-config` | Read atomic primary+backup LLM config. Returns provider, model, endpoint, `allowPrivateNetwork`, and `apiKeySet: boolean` — **the actual API key is never exposed**. API keys are stored in the vault, never in plaintext settings. Legacy `synthesis_api_key`/`synthesis_backup_api_key`/`llm_provider_api_keys` settings are auto-migrated into the vault on first read and then deleted from the settings table. |
| GET | `/api/v1/settings?key=oauth_gmail_client_secret` (or Outlook) | Return only `{ key, isSet, masked }` for a protected OAuth client secret. The value is never returned. The key is resolved against the sole active global project, regardless of the selected `project` query parameter. Sealed/unavailable vaults fail closed; unresolved legacy conflicts return `409 SECRET_MIGRATION_CONFLICT`. Duplicate active globals return `503 GLOBAL_PROJECT_UNAVAILABLE`. |
| POST | `/api/v1/settings` with `key` plus `action: preserve\|replace\|clear` | Manage a protected OAuth client secret in the active global project. `replace` requires a non-empty `value`; `clear` is explicit; `preserve` leaves the saved value unchanged. A blank implicit value is preserve. The vault must be initialized and unsealed for writes. |
| POST | `/api/v1/settings/llm-config` | Legacy primary+backup save contract retained for existing clients. New clients should use `PUT /provider-configs`. Accepts `allowPrivateNetwork` on primary and backup blocks. API keys are stored in the vault. |
| POST | `/api/v1/settings/test-llm` | Test an LLM connection. Accepts `allowPrivateNetwork` boolean body field. Rejects unsafe/internal endpoint addresses (same `validateEndpointUrl` guard as provider-configs save). On transport failure, returns `{ ok: false, status: 0, message: "Unable to reach LLM endpoint" }` — the endpoint URL is never reflected in error messages. |

#### Managed provider credential desired state

`llm_provider_configs` stores provider metadata and optional vault item
references, never API-key values. A referenced item must be a unique active
restricted `api_key` named `Managed LLM API Key: <providerId>` in the canonical
global project. Invalid, missing, duplicate, deleted, or non-restricted references
return `409 PROVIDER_CREDENTIAL_REFERENCE_INVALID` before mutation. Omitted
`apiKey` preserves the reference; a non-empty value is written and decrypt-verified
before settings/config persistence; an explicit empty value or removed provider
removes the reference.

For a clear/removal, the API soft-deletes and verifies the referenced vault item
before committing the provider settings and OpenCode global configuration. This
specific removal-only path works while the vault is sealed because soft deletion
does not need the master key; attempting to save a new key while sealed returns
`409 VAULT_REQUIRED`. A deletion is attempted once per reference. Failure restores
earlier deletions and staged writes and returns `409 VAULT_CREDENTIAL_DELETE_FAILED`
with the prior configuration unchanged. A later settings/config failure restores
the prior desired state and credential policies and returns `409 CONFIG_SAVE_FAILED`.
There is no automatic retry loop. Post-commit OpenCode synchronization reports
warnings without rolling back the durable desired state; native auth calls use the
5-second deadline described in the integration section.

### Pipeline
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/pipeline/events` | List pipeline events |
| GET | `/api/v1/pipeline/timeline` | Get grouped timeline |

### Documentation (Docs Workspace)

Docs routes derive organization authority from the authenticated principal.
Spaces, pages, child records, templates, slugs, search, counts, trash, imports,
exports, comments, and attachments are organization-scoped. Foreign IDs return
`404`; no route accepts body-supplied organization/project/provider authority for
Docs AI.
All routes prefixed with `/api/v1/docs`. See [Docs Workspace Reference](../reference/docs-workspace.md) for the full 52-endpoint catalog.

### Vault (Secrets Manager)
All routes prefixed with `/api/v1/vault`.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/initialize` | Initialize a new vault with passphrase + confirmation. Body: `{ password, confirmation }`. A new passphrase must be non-blank and at least 12 Unicode characters; confirmation must match. Returns `201` on success, `409` if already initialized, `422` on validation error, or `429` with `Retry-After` after five passphrase attempts per IP per minute. |
| POST | `/unseal` | Unseal vault with passphrase. When called from the dashboard (`x-ingenium-ui: dashboard` header present) on an uninitialized vault, returns `409 VAULT_NOT_INITIALIZED` — the Dashboard must use `/initialize`. For MCP/programmatic clients, auto-initializes on first use using the same new-vault passphrase policy. Returns `403` on invalid passphrase and `429` with `Retry-After` after five shared initialize/unseal attempts per IP per minute. |
| POST | `/seal` | Seal (lock) vault |
| GET | `/status` | Vault sealed/unsealed status plus `nextAction` (`initialize`, `unseal`, or `null`). Not subject to the vault brute-force limiter. |
| GET | `/items` | List vault item metadata (optionally `?folder_id=`); never returns secret values and is not subject to the vault brute-force limiter. |
| POST | `/items` | Create a vault item |
| GET | `/items/:id` | Get vault item metadata (no secret value) |
| POST | `/items/:id/reveal` | Reveal a vault item's secret value (audit-logged) |
| PUT | `/items/:id` | Update vault item value (re-encrypts) |
| PATCH | `/items/:id` | Update vault item metadata |
| POST | `/items/:id/rotate` | Generate and store a replacement value |
| DELETE | `/items/:id` | Delete vault item (soft-delete with audit) |
| GET | `/folders` | List folders with active item counts |
| POST | `/folders` | Create a folder |
| DELETE | `/folders/:id` | Delete a folder |
| POST | `/generate-password` | Generate a secure random password |
| POST | `/password/generate` | Dashboard-compatible password generation alias |
| GET | `/audit` | List redacted audit event metadata; no audit details or secret material are returned |

`GET /api/v1/vault/status` is safe while sealed and returns only sealed and
initialized state plus `nextAction`; it never unseals the vault. Job-scoped
vault evidence is available at `GET /api/v1/jobs/:id/vault-audit?project=<name>&limit=&cursor=`.
That bounded endpoint returns only job/item/run identifiers, `authorized`,
`revoked`, `secret_read`, or `access_denied` actions, actor category, version,
and timestamp. It returns no names, values, ciphertext, free text, or parsed
actor strings.

### Backups
All routes prefixed with `/api/v1/backups`.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/` | List all backup records |
| POST | `/` | Create a new backup (body: `{ type: "manual" }`) |
| GET | `/:id` | Get a single backup record |
| GET | `/:id/download` | Download backup snapshot files |
| DELETE | `/:id` | Delete a backup and its snapshot files |
| POST | `/restore/preview` | Create or replay a dry-run-only plan (`{ backupId, dryRun: true, idempotencyKey }`) |
| POST | `/restore/:planId/authorize` | Issue a one-time confirmation token for a previewed plan (`{ expectedRevision }`) |
| POST | `/restore/:planId/confirm` | Consume the token (`{ confirmationToken, expectedRevision, idempotencyKey }`) and advance only to `ready_for_executor` |
| GET | `/restore/:planId` | Get content-free restore-plan state |
| GET | `/restore/:planId/audit` | List bounded immutable, content-free plan transition evidence (`?limit=1..100`) |
| POST | `/restore` | Legacy confirmation route; always returns `410 RESTORE_MIGRATION_REQUIRED` |
| GET | `/schedule` | Get backup schedule configuration |
| PUT | `/schedule` | Set backup schedule configuration |

Restore-plan endpoints require the active global project and never apply a source
backup; confirmation stores descriptor-verified read-only staged copies before a
plan can become `ready_for_executor`. Execution remains unavailable through the API.
The v2 bundle contract is fixed-name and signed; preview validates the manifest,
component hashes, SQLite integrity, and both schema fingerprints. Legacy records
are preview-only. The legacy boolean-confirm `POST /restore` path returns `410
RESTORE_MIGRATION_REQUIRED`; it cannot bypass authorization. Authorization is a
short-lived one-time capability, and plan revisions, audit events, stages, and
idempotency receipts are immutable under migration 083. Confirmed stages are
revalidated and handed off only as bounded in-process buffers; source files and
active databases are never replaced by these routes.

### Context — Canonical Agent Memory
All routes prefixed with `/api/v1/context`. Project-scoped entries persist working context across sessions. FTS5-backed search. Backward-compatible with `plan_*` tools.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/` | List recent entries (paginated, `?limit=` & `?offset=`), newest-first |
| GET | `/search?q=` | FTS5 full-text search across context entries (`?limit=`, max 100) |
| POST | `/` | Create a context entry (`{ content, tags?, priority?, sessionId?, source?, metadata? }`) |
| POST | `/batch` | Batch retrieve entries by ID (`{ ids: number[] }`, max 100) |
| GET | `/:id` | Get a single context entry by ID |
| PATCH | `/:id` | Update fields on a context entry (`{ content?, tags?, priority?, sessionId?, source?, metadata? }`) |
| DELETE | `/:id` | Delete a context entry (204 no content) |

Input validation: `content` required, `priority` must be integer 0–10 (default 5), `tags` must be non-empty strings ≤64 characters. See `packages/ingenium-core/lib/tools/context.ts` and `services/ingenium-api/lib/routes/context.ts`.

#### Context RAG uploads and retrieval

These source routes are project-scoped under `/api/v1/context`; foreign-project
sources are not returned. CTX-100's source list/get/search contract is
metadata-only: it never returns document bodies, chunk excerpts, or source
paths.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/sources` | Create one project-owned direct source. Accepts `{ title, content, mimeType?, priority?, tags?, metadata?, sourceReference? }`; maximum UTF-8 size is 1 MiB. `/uploads` is an equivalent compatibility alias. Returns `200` for a project-local SHA-256 duplicate and `201` for a new source. |
| POST | `/uploads/chunked` | Start a bounded upload with `{ title, expectedHash, expectedBytes, chunkCount, mimeType?, priority?, tags?, metadata? }`. The total limit is 2 MiB, with at most 32 chunks. Supports `Idempotency-Key`. |
| POST | `/uploads/:uploadId/chunks` | Add one immutable `{ ordinal, content }` chunk (≤64 KiB). An identical retry is `200`; a conflicting ordinal is `409`. |
| POST | `/uploads/:uploadId/complete` | Verify contiguous chunk order, byte count, and SHA-256, then atomically index and publish the source. Incomplete uploads remain unsearchable. |
| GET | `/sources` | List project-owned source metadata, paginated by `limit`/`offset` (maximum 100). |
| GET | `/sources/:sourceId` | Get one project-owned source metadata record; foreign or unknown sources return `404 CONTEXT_SOURCE_NOT_FOUND`. |
| GET | `/sources/search?q=` | Search project-owned sources and return unique metadata records only; no body excerpts, chunk fields, or source paths. |

| POST | `/rag/ask` | Ask against only the current project's context-upload corpus. Returns an answer plus source-hash/provenance citations. |
| GET | `/learning/current` | Retrieve bounded project-local observations/traits with latest input and trait timestamps. |
| POST | `/learning/ingest` | Explicitly snapshot current learning into a RAG source, or return `{ noOp: true, reason: "NO_CURRENT_LEARNING" }`. |
| GET | `/conversations/:conversationId/checkpoints/:checkpointId/rag/search?q=` | Search only the immutable RAG source set cited by that checkpoint and return historical citations. |

Context RAG search citations are metadata-only evidence for immutable chunks.
`citationId` equals the persisted `rag_chunks.id` UUID; `sourceId`, `sourceHash`,
and `chunkIndex` identify the source, its SHA-256 content hash, and the chunk
position. `availability` is currently always `"available"`. Results use a
deterministic total order: priority descending, BM25 rank ascending, source
`updated_at` descending, source ID ascending, chunk index ascending, then chunk
ID ascending. Repeating a search returns the same citation IDs and order while
the immutable source remains available. Foreign-project or missing sources are
treated as neutral absence: they are not returned and their existence is not
disclosed.

Published Context sources and chunks cannot be changed through generic RAG
routes. Re-ingest and delete attempts return `409 RAG_SOURCE_IMMUTABLE`.

Direct and chunked uploads allow only `text/plain`, `text/markdown`,
`application/json`, and `application/x-ndjson` (`text/plain` default). Priority
is an integer 0–10 (default 5). Tags are deduplicated and sorted, limited to 64
tags of 1–64 characters and 4 KiB serialized. Metadata must be a bounded JSON
object (≤16 KiB; bounded depth, nodes, keys, and string values) and must not
contain path, credential, secret, token, password, authorization, or API-key
keys/values. `sourceReference` is optional, opaque, path-free, free of control
characters and secret-like values, and ≤256 characters. Upload input rejects
`file`, `filePath`, `sourceFile`, and path-bearing fields.

Published context sources and chunks are immutable: database guards reject
source/chunk update or delete and chunk reassignment. CTX-100 does not turn on
default chat grounding; grounding/default behavior belongs to CHAT-100. The
existing `/rag/search` and `/rag/ask` content/citation behavior is outside this
metadata-only source contract.

#### Context-native OpenCode snapshot transport

`ingenium_context_upload_file` uses the authenticated internal
`POST /api/v1/context/conversations/import` transport. This octet-stream route
is not a browser-facing or public bulk-message API: dashboard-originated
requests are rejected, and the route accepts one complete protected snapshot.
The MCP tool schema is exactly `{ project, session, file_path,
conversation_id?, tags?, priority? }`; `priority` is an integer from 0 through
10, `conversation_id` is a UUID, and `file_path` must be absolute. The launcher
binds `project` to its project identity and permits only a private regular file
under `.ingenium/context-uploads`, read once through one `O_NOFOLLOW`
descriptor. Supported formats are OpenCode export JSON, simple JSON,
JSONL/NDJSON, Markdown, and text. Only visible user and completed assistant
messages are retained.

The importer fails closed on visibility markers. The `hidden`, `synthetic`,
`ignored`, and `ignore` markers are accepted as visible only when absent or
exactly `false`, `0`, `"false"`, or `"0"`; any other present value, including
`null`, objects, or unexpected strings, excludes the record. The rule is
applied to the envelope and nested message/author/part records.

The protected read is descriptor-bound and checks file identity before and
after each read phase. Identity includes device, inode, link count, owner,
mode, size, and nanosecond `mtime`/`ctime`; the descriptor bytes are hashed
and re-hashed in a second stream. A same-inode, same-size in-place mutation
therefore fails with `CONTEXT_UPLOAD_FILE_REJECTED` rather than being
imported.

The MCP side makes one protected snapshot handoff and the API invokes one
transactional import. A new snapshot creates a conversation; an explicit
conversation target is adopted only after project ownership and imported-prefix
verification. Matching replays are idempotent, matching longer snapshots append
only their suffix and refresh the mapping, and shorter or divergent snapshots
return a conflict without partial writes. The response is metadata only.

This is the only Context-native OpenCode file import surface. There is no
external Thread service or bridge and no current-session/OpenCode-session import
tool. Imported conversations appear in the dashboard `/context` workspace,
which uses the existing conversation and message list/get/search/retrieve/batch
surfaces rather than this internal transport for browsing.

Context checkpoint links freeze their referenced RAG source/chunks and persist a
citation snapshot. Attempts to re-ingest or delete such a source are rejected;
normal checkpoint and source ownership checks remain project-scoped.

#### Immutable conversation checkpoint maintenance (CTX-004)

Conversation maintenance is deliberately opt-in and append-only. It never
deletes or updates a conversation, message, checkpoint, or checkpoint source.
All maintenance routes require the normal project scope and do not expose
message content through preview or audit responses.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/conversations/maintenance/preview` | Return at most 100 content-free candidate summaries. Callers may provide an explicit `staleBefore` cutoff; there is no automatic retention policy. The preview can also report checkpoint divergence, integrity failures, and multiple active restore branches. |
| POST | `/conversations/:conversationId/maintenance/authorize` | Issue a 15-minute, one-time confirmation token bound to one project-owned archive, unarchive, or restore-as-new action and its `expectedRevision`. The raw token is never persisted in audit output. |
| POST | `/conversations/:conversationId/archive` | Append an archive event after `{ expectedRevision, confirmationToken }`. Archived conversations are hidden from ordinary conversation lists and reject new messages/checkpoints; their immutable history remains readable by explicit project-scoped APIs. |
| POST | `/conversations/:conversationId/unarchive` | Append a reversible unarchive event after a separately authorized `{ expectedRevision, confirmationToken }` request. |
| GET | `/conversations/:conversationId/maintenance/audit` | Return bounded, content-free archive/unarchive/restore-as-new evidence (IDs, revisions, state hashes, and timestamps only). |
| POST | `/conversations/:conversationId/checkpoints/:checkpointId/restore` | Branch the checkpoint into a new immutable conversation. Requires `{ expectedRevision, confirmationToken }`; it never modifies the source conversation or checkpoint. |

There is intentionally no checkpoint delete endpoint. The database rejects
direct checkpoint updates/deletes and rejects changes to append-only audit rows.
Expired, consumed, wrong-project, or mismatched confirmation tokens all return
the same `409 MAINTENANCE_AUTHORIZATION_INVALID` response without reflecting
the token or conversation content.

### RAG (Retrieval-Augmented Generation)

RAG sources carry `organization_id`, visibility (`organization`, `project`, or
`restricted`), and an owner for restricted sources. Search, ask, stats, export,
and checkpoint admission use authorization-derived scopes/source IDs. There is
no implicit global-project inclusion, and cross-organization source IDs fail at
the SQL/API boundary.
Context direct and chunked uploads created by an authenticated user are
restricted to that user; list, metadata lookup, search, and ask omit foreign
restricted sources, chunk mutation rejects foreign upload sessions, and direct
lookup returns a safe not-found response. Current-learning retrieval and explicit
snapshot ingestion apply the same owner-derived scope.
All routes prefixed with `/api/v1/rag`.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/ingest` | Index canonical repo docs from `INGENIUM_DOCS_ROOT/docs/` — symlink-protected, hash-idempotent, removes stale files |
| POST | `/sources` | Create a new RAG source and ingest content |
| GET | `/sources` | List RAG sources for a project (`?limit=` & `?offset=`, max 100) |
| GET | `/sources/:id` | Get a RAG source by ID (includes `source_hash`, `byte_size`) |
| DELETE | `/sources/:id` | Delete a RAG source and cascade its chunks |
| POST | `/sources/:id/ingest` | Ingest/re-ingest content into an existing source |
| GET | `/search?q=` | BM25 FTS5 full-text search across RAG chunks with snippet generation |
| POST | `/ask` | Natural-language Q&A with LLM-grounded answers and citations. Returns `{ answer, citations: [{ id, title, path, heading, snippet, kind, score }] }`. Broker-executed via `executeSynthesisBroker()`. |
| GET | `/stats` | RAG index statistics (`total_sources`, `total_chunks`) |
| POST | `/export` | Export all RAG sources as JSON |

### Repository Documentation Sync

All routes prefixed with `/api/v1/docs`.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/repository/sync?project=<project>` | Preview or atomically apply a complete repository Markdown manifest to managed Docs Workspace pages and their RAG sources. Use `{ manifest, dryRun? }`; invalid manifests return `422 INVALID_REPOSITORY_DOCS_MANIFEST`. |

The manifest is caller-supplied data: the API does not walk or open repository
paths. Entries are limited to normalized regular `docs/**/*.md` files with
matching SHA-256 hashes and size/secret-content validation. A dry run returns
the planned operations without mutation; apply archives only previously
managed documents missing from the complete manifest.

### Repository Resource Sync

All routes prefixed with `/api/v1/repository`.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/resources/sync?project=<project>` | Preview or atomically apply the repository-authoritative v2 manifest for skills, agents, and plugins. Use `{ manifest, dryRun? }`; invalid manifests return `422 INVALID_REPOSITORY_RESOURCES_MANIFEST`. |

The v2 resource manifest accepts exactly `skills`, `agents`, and `plugins`.
Each item carries stable identity, normalized path, and SHA-256 of its full
semantic projection. It preserves skill frontmatter/metadata/file trees, agent
permissions/hidden/skills plus compatibility-mirror paths, and plugin source,
order, enabled state, and options. The immutable `ingenium-llm-broker` cannot
be imported. Missing entries archive/remove only resources previously recorded
as repository-managed; manual, unmanaged, and system resources are untouched.
Commands and project/global configuration are deliberately excluded.

### `ingenium-init-project` CLI contract

The extension CLI is the repository-facing caller for these two sync endpoints.
It accepts exactly one mode, an optional documentation scope, and an optional
validated project override:

```text
ingenium-init-project --dry-run [--docs-only] [--project <name>]
ingenium-init-project --apply [--docs-only] [--project <name>]
```

`--dry-run` resolves the validated project identity and submits preview requests;
it does not provision a project, mutate remote state, or write the local sync
manifest. `--apply` provisions the validated project when necessary, applies the
projection, and advances the local repository baseline only after API
confirmation. The `all` scope covers repository Markdown plus `.opencode/skills`,
`.opencode/agents` (including compatibility mirrors), and configured/local
`.opencode/plugins` sources. `--docs-only` submits only the Markdown manifest.
`--project` is validated and takes precedence over `INGENIUM_PROJECT`, which
takes precedence over the validated worktree basename; the CLI never defaults
to `global-default`. In the production image, the command is on `PATH` at the
stable `/usr/local/bin/ingenium-init-project` path, independent of
`/app/node_modules/.bin`. Before either mode contacts a project or repository
route, the CLI calls the authenticated `GET /api/v1/auth/preflight` capability
probe. Authentication failure is fail-closed and intentionally reports only a
generic message; callers never receive a token, API URL, status, or upstream
response body.

This contract documents the available workflow; it does not assert that a live
onboarding or apply run has occurred.

**Indexing pipeline**: Two auto-indexing paths: (1) Canonical repo Markdown files via `POST /rag/ingest` walks `INGENIUM_DOCS_ROOT/docs/**/*.md` with symlink escape protection and SHA-256 hash idempotency. (2) Docs Workspace pages are indexed at lifecycle boundaries — publish, update (if published), archive, restore — as `docs-page:{id}` sources. Manual ingestion via `POST /rag/sources` and `POST /rag/sources/:id/ingest` is also available.

**Search**: The `/search` and `/ask` routes use `searchChunks()` for BM25 FTS5 full-text search across retained RAG source chunks. Migration 070 removed the legacy embedding table; no vector or hybrid retrieval feature is exposed.

**Citations**: The `POST /ask` endpoint builds unique citations per source (deduplicated by source ID). Each citation includes `id`, `title`, `path` (source_path or docs-page slug), `heading`, `snippet` (BM25 snippet with `<mark>` highlights), `kind` (source_type: `file`, `text`, `url`), and `score` (negative BM25 rank). The broker prompt includes `"Answer with citations like [1], [2]."` to encourage citation-grounded responses. The Docs workspace Dashboard renders `[N]` markers as superscript links with title tooltips and a Sources list below.

Documentation on the chunker (`rag-chunker.ts`) and RAG core (`rag.ts`) is in the source.

### Services (Status Page)
All routes prefixed with `/api/v1/services`. Two distinct card types rendered on the `/status` page:

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/status` | List all process and application statuses |
| GET | `/:name` | Single process detail via supervisord `getProcessInfo` (ingenium-api, ingenium-dashboard, opencode-web, ttyd-opencode) |
| GET | `/:name/logs` | Read process logs (offset/limit, max 10000 bytes) |
| GET | `/applications/:name` | Detailed status for an in-process application |

#### Application Detail Endpoints (`GET /api/v1/services/applications/:name`)

| Application | Response Fields | Source |
|-------------|----------------|--------|
| `email-client` | `name`, `state`, `description`, `detail`, `engine` (accounts, folders, sync state) | `ingenium-email` engine status |
| `synthesis-engine` | `name`, `state`, `description`, `detail`, `intervalMs`, `lastRunAt`, `nextEstimate`, `stats` (observations, traits) | `synthesis.getSynthesisStatus()` |
| `docs-workspace` | `name`, `state`, `description`, `detail`, `stats` | `docs.getDocStats()` |
| `tasks-board` | `name`, `state`, `description`, `detail`, `stats` (total tasks, byColumn breakdown) | `tasks.listTasks()` |

### OpenCode Integration Routes

Provider integration routes are prefixed with `/api/v1/opencode`. The exact
`GET /auth/callback` endpoint is the sole unauthenticated auth-middleware
allowlist — see [Public Endpoint (Auth Allowlist)](#public-endpoint-auth-allowlist).

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/integrations` | List all native OpenCode integrations (provider auth metadata, connection methods) |
| GET | `/integrations/:id` | Get a single native integration by ID |
| POST | `/integrations/:id/connect/oauth` | Begin an OAuth integration attempt. Returns `{ attemptID, url, mode: "auto"\|"code", instructions }`. State stored in `pendingOAuthAttempts` with 10-min TTL. The returned URL is validated for SSRF safety before being returned. |
| POST | `/integrations/:id/connect/key` | Connect via API key. Accepts `{ key }` in body. |
| POST | `/auth/:providerID` | Apply native provider auth. API-key calls use the durable credential saga; non-key calls still use the bounded OpenCode proxy. |
| DELETE | `/auth/:providerID` | Disconnect native provider auth through the durable credential saga. |
| GET | `/auth/status` | Read native provider auth status through OpenCode. |
| POST | `/integrations/complete` | Complete an OAuth code-mode attempt. Accepts `{ attemptID, code }`. |
| POST | `/integrations/attempts/:id/cancel` | Cancel a pending OAuth attempt. |
| GET | `/integrations/attempts/:id` | Poll OAuth attempt status. Returns `{ status: "pending"\|"complete"\|"failed"\|"expired", message? }`. |
| GET | `/builtin-providers` | Runtime OpenCode Zen free model discovery — queries OpenCode runtime provider catalog, filters to only free models. |
| GET | `/chat-config` | Sanitized merged provider catalog for the Chat page (managed + builtin); selection defaults are server-owned and catalog-gated. |
| PUT | `/chat-selection` | Authenticated global Chat selection; validates an exact provider/model pair against the active server catalog before persistence. |

Native API-key operations are serialized per provider with one active operation
and at most four queued waiters. A full queue is rejected before any credential or
OpenCode work with `503 PROVIDER_OPERATION_RETRY`, `Retry-After: 2`, and
`retryable: true`; a queued waiter is rejected at the 2-second deadline. Each OpenCode
operation, status probe, and compensation call used by this native API-key saga
receives an abort-backed 5-second deadline. Different providers do not share this
queue.

API-key connect persists the encrypted desired credential in the canonical global
vault before applying it to OpenCode. Failed OpenCode application is compensated by
restoring the previous vault/auth state or returning a fixed recoverable failure.
The corresponding `DELETE /auth/:providerID` operation removes OpenCode auth before
deleting the vault credential and restores both if credential deletion fails. Keys
and compensation details are never returned.

### MCP Tool Report

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/mcp-tools/report?project=<name>` | Return a bounded, project-scoped MCP usefulness report. Optional filters are `q`, `category`, `enabled`, `boundary`, `visibility`, and `invocation`. |

The report response is an envelope with `project`, `project_id`, `data`, and
`total`. `data` is the evidence-only report: it includes global provenance,
freshness, catalog status, and per-tool `boundary`, `visibility`, and
`invocation` evidence. The API enriches each tool with its current catalog
`category` and effective project `enabled` state before applying filters.

The live collector uses a fixed, server-owned packaged MCP launcher in an
ephemeral probe. It lists the tools and invokes only the provider-free
`health_check`; the probe closes the child before returning. Probe mode uses
`INGENIUM_MCP_REPORT_MODE=1`, so the child starts without the child MCP
gateway. Runtime probing cannot certify source registration or catalog parity;
when that evidence is unavailable, `data.catalog.status` is `unknown`.

Reports are capped at 64 KiB, cached per project for 30 seconds, and returned
with `Cache-Control: private, no-store` plus `Vary: Authorization`. Invalid or
oversized queries use fixed errors: `422 INVALID_MCP_REPORT_QUERY` and `413
MCP_REPORT_QUERY_TOO_LARGE`. Collection or size failures use `503
MCP_REPORT_UNAVAILABLE`; concurrent collection may use `503 MCP_REPORT_BUSY`.

## OpenCode Proxy Routes

The API proxies requests to the OpenCode server at :4098. The API-to-OpenCode
upstream request uses HTTP Basic Auth credentials injected server-side (never
exposed to the browser); this is separate from the local port-3000 gateway,
which does not show a browser password prompt. All proxy routes require
`OPENCODE_SERVER_PASSWORD` to be set (returns 503 otherwise). The API boundary
itself remains private and bearer-protected. SSE routes stream
`text/event-stream` with proper caching and buffering headers.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/opencode/health` | OpenCode server health |
| GET | `/api/v1/opencode/sessions` | List sessions |
| POST | `/api/v1/opencode/sessions` | Create session |
| GET | `/api/v1/opencode/sessions/status` | Session status (literal path — before `:id`) |
| GET | `/api/v1/opencode/sessions/:id` | Get session detail |
| PATCH | `/api/v1/opencode/sessions/:id` | Update session |
| DELETE | `/api/v1/opencode/sessions/:id` | Delete session |
| GET | `/api/v1/opencode/sessions/:id/messages` | Get messages (with optional `limit` and `before` pagination) |
| GET | `/api/v1/opencode/sessions/:id/messages/:msgId` | Get a single message |
| DELETE | `/api/v1/opencode/sessions/:id/messages/:msgId` | Delete a message |
| POST | `/api/v1/opencode/sessions/:id/prompt` | Accept a prompt for asynchronous processing. The body uses the `parts` array per the current OpenCode 1.18.9 contract; success returns HTTP `202` with `{ data: { accepted: true } }`. This response is only an acknowledgement and does not contain the assistant response. |
| POST | `/api/v1/opencode/sessions/:id/abort` | Abort session |
| POST | `/api/v1/opencode/sessions/:id/fork` | Fork session |
| POST | `/api/v1/opencode/sessions/:id/share` | Share session |
| DELETE | `/api/v1/opencode/sessions/:id/share` | Unshare session |
| POST | `/api/v1/opencode/sessions/:id/compact` | Compact session |
| POST | `/api/v1/opencode/sessions/:id/revert` | Revert session to a message/part checkpoint |
| POST | `/api/v1/opencode/sessions/:id/unrevert` | Unrevert session |
| GET | `/api/v1/opencode/sessions/:id/children` | Get session children (forked sessions) |
| GET | `/api/v1/opencode/sessions/:id/diff` | Get session diff (optional `messageID` query param) |
| POST | `/api/v1/opencode/sessions/:id/command` | Send a command (slash commands) |
| POST | `/api/v1/opencode/sessions/:id/init` | Initialize a session |
| GET | `/api/v1/opencode/sessions/:id/events` | SSE event stream (per-session). The dashboard-owned route is a dedicated unbuffered Node handler that forwards the persistent upstream readable stream directly; it sets `Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no`. Do not send this path through the generic compressed Next rewrite, which can buffer or transform an open SSE response and prevent live frames from reaching Chat. |
| GET | `/api/v1/opencode/events` | Global SSE event stream (no session filter) |
| GET | `/api/v1/opencode/chat-config` | **Sanitized Chat config** — returns `{ configured, primary, backup, providers: [...], agents, defaultSelection }`. The allowlisted DTO merges managed entries (`source: "managed"`) with the runtime-discovered OpenCode Zen builtin entry (`source: "builtin"`). It excludes API keys, `synthesis_endpoint`, base URLs, headers, packages, and provider/internal topology. `defaultSelection` prefers a valid server-owned Chat selection, then a managed primary, a valid legacy primary, or the OpenCode Zen runtime default. OpenCode live-reloads provider config changes — no restart required. Legacy `primary` and `backup` DTO fields are emitted only when their exact stored provider/model pair exists in this current allowlisted catalog; raw legacy setting values are otherwise omitted. Returns `{ configured: false, defaultSelection: null }` when no LLM is set up and no builtin is available. Recognized OpenCode network-startup failures return fixed `503 OPENCODE_UNAVAILABLE`; other catalog lookup failures return fixed `503 LLM_CATALOG_UNAVAILABLE`, without upstream diagnostics. |
| PUT | `/api/v1/opencode/chat-selection` | **Authenticated global Chat selection** — accepts `{ providerId, modelId }`, rejects project overrides, validates the exact pair against the active global server catalog, then saves the non-secret selection under the active global project. Docs AI never accepts this pair in its request DTO. |
| GET | `/api/v1/opencode/builtin-providers` | **Runtime OpenCode Zen free model discovery** — queries the OpenCode runtime provider catalog, filters to only free models (`cost.input === 0 && cost.output === 0`) from the `opencode` provider ID. Response: `{ data: { providerId, providerName, models: [{id, name, providerID}], defaultModel, source: "runtime" } }`. When OpenCode is unreachable, returns `{ models: [], defaultModel: null, source: "unavailable" }`. Sanitized — no `apiKey`, `options`, or `env` fields leak through. |
| GET | `/api/v1/opencode/providers` | List providers + models |
| GET | `/api/v1/opencode/agents` | List agents |
| GET | `/api/v1/opencode/mcp` | **Sanitized MCP status DTO** — returns normalized `status`, compatibility `connected`, optional non-negative `toolCount`, and fixed browser-safe error text only; malformed root responses return `502 MCP_STATUS_INVALID` instead of an empty list |
| POST | `/api/v1/opencode/mcp/:name/connect` | Connect MCP server; success is fixed `{ data: { accepted: true } }`, failure is fixed `502 MCP_CONNECT_FAILED` |
| POST | `/api/v1/opencode/mcp/:name/disconnect` | Disconnect MCP server; success is fixed `{ data: { accepted: true } }`, failure is fixed `502 MCP_DISCONNECT_FAILED` |
| GET | `/api/v1/opencode/permissions` | Pending permissions (global) |
| POST | `/api/v1/opencode/sessions/:id/permissions/:permId` | Reply to a permission request (session-scoped) |
| POST | `/api/v1/opencode/upload` | File upload for chat attachments (multipart, validated MIME allowlist) |
| GET | `/api/v1/opencode/questions` | Pending questions (read-only; no reply endpoint in OpenCode 1.18.9) |

### Chat Context project authority

Chat's top **Context project** selector supplies the validated project query to
the project-scoped context search route:

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/context/rag/search?project=<name>&q=<query>&limit=<n>` | Search only the selected project's context-upload chunks and return citation metadata. |

The dashboard encodes query parameters with `URLSearchParams`. The API's
`requireProject` check resolves the project on every request and rejects missing,
unknown, archived, or otherwise invalid projects; an archive race therefore
fails closed at request time rather than falling back to a different namespace.
The Chat composer does not call this route unless **Use project context** is
enabled, and the request carries the selected project for that turn. Context
retrieval and Chat tools are separate authorities: `/chat-config`, Chat model
selection, MCP/tool state, and Chat mutations resolve the sole active global
project and ignore a caller's Context project. Context search logs neither the
query's source contents nor returned excerpts.

### Chat prompt response lifecycle

`POST /api/v1/opencode/sessions/:id/prompt` acknowledges acceptance before the
provider turn completes. Consumers must open
`GET /api/v1/opencode/sessions/:id/events` **before** posting the prompt and
use that per-session SSE stream as the authoritative response channel. Consume
`message.part.updated`/`message.part.delta` events for incremental message and
reasoning content; treat `session.idle` as the successful terminal event and
`session.error` as the terminal failure event. A subsequent messages request
may be used to reconcile history, but it is not the completion signal.

In the dashboard, the same URL is claimed by a dedicated App Router route
handler rather than the generic `/api/v1/*` rewrite. That handler forwards the
stream without buffering or transformation so the connection can remain open
after `session.idle` for future events.

> **Security**: The Chat config endpoint is an allowlisted provider/model DTO: it excludes API keys, endpoints, base URLs, headers, packages, and internal topology. **API keys are never exposed or written to OpenCode config files.** Credentials are stored in the encrypted vault (`vault_items` table with AES-256-GCM), separated from provider metadata, synchronized to OpenCode through its auth API, and mirrored into the selected synthesis settings for runtime resolution. Legacy plaintext settings (`synthesis_api_key`, `synthesis_backup_api_key`, `llm_provider_api_keys`) are auto-migrated into the vault on first read and then deleted from the settings table.

Provider-catalog failures are also sanitized at the OpenCode client boundary:
server logs retain only request status and route context, while browser-facing
responses use the fixed catalog error contract and omit upstream codes,
messages, endpoints, and credential-related diagnostics.

Browser-facing scalar fields are validated before they enter these DTOs. Provider
and model IDs, display labels, and MCP server names must match their dedicated
compact allowlists and must not resemble API keys, tokens, passwords, bearer
values, endpoints, headers, cookies, sessions, or other credentials. Unsafe
scalars are rejected or replaced with a safe fallback; they are never partially
redacted and returned as opaque identifiers.

> **Known gap**: Questions cannot be replied to via the REST API in OpenCode 1.18.9. They are TUI-only — delivered through the control channel. There is no `POST /questions/:id/reply` endpoint.

## Data Flow

```
Dashboard → HTTP → API → Core → SQLite
MCP Server → HTTP → API → Core → SQLite
Email Client → OAuth2 + Gmail REST API / SMTP → Gmail Provider
```

### API-First Frontend
- Dashboard imports ZERO core/server code. All data via HTTP to API.
- MCP server talks to the API over HTTP. Zero DB access.

### Response Format

**Success:**
```typescript
{ "data": T, "total"?: number }
```

**Error:**
```typescript
{ "error": { "code": string, "message": string } }
```

## Related Docs
- [Architecture](../concepts/architecture.md) — System architecture and data flow
- [Database](database.md) — Database migrations and WAL safety
- [Variables](variables.md) — Environment variables
