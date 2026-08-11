---
title: Security Documentation
description: Security documentation including credential management, iframe sandboxing, and threat models.
---

# Security

Security documentation and procedures for the Ingenium system.

## Pages

| Document | Description |
|----------|-------------|
| [Credential Rotation](credential-rotation.md) | Git history secret remediation and credential rotation |
| [API Authentication](api-authentication.md) | Phase 2G bearer auth, local token handling, dashboard proxy, OAuth callback, and gateway boundaries |
| [Iframe Sandbox](iframe-sandbox.md) | Iframe sandbox baseline configuration and risk assessment |
| [LLM Endpoint SSRF Protection](#llm-endpoint-ssrf-protection) | DNS-level validation of LLM provider endpoints, private-network blocking, and opt-in bypass |
| [Vault Security Model](#vault-security-model) | scrypt key derivation, AES-256-GCM envelope encryption, passphrase-is-key design, no recovery |

## LLM Endpoint SSRF Protection

**Source**: `packages/ingenium-core/lib/tools/endpoint-policy.ts`

All LLM provider endpoints are validated by `validateEndpointUrl()` before any HTTP request is made. The system uses a two-layer defense:

### Layer 1 — URL Parse
- Rejects non-HTTP(S) protocols
- Rejects URLs with embedded credentials (`username:password@host`)
- Rejects hostnames matching `localhost`, `*.localhost`, or private IPv4/IPv6 ranges (10.x, 172.16-31.x, 192.168.x, 127.x, ::1, fc00::/7, etc.)

### Layer 2 — DNS Resolution
- Resolves the hostname via `dns.lookup` with `{ all: true, verbatim: true }`
- Rejects if ANY resolved address falls in a private range
- Prevents DNS rebinding: the hostname is re-resolved on every call

### Safe Fetch
`safeLlmFetch()` wraps every LLM HTTP request with:

1. **Pre-request validation** — calls `validateEndpointUrl()` before the fetch
2. **Pinned transport** — uses the complete validated address set for that hop rather than performing an unpinned second DNS lookup
3. **Redirect following** — follows HTTP redirects (up to 10), re-resolves and validates every target, and applies the redirect method/body rules
4. **Credential stripping** — removes authorization, cookies, proxy-authentication, and credential-bearing content headers on cross-origin redirects
5. **Response bound** — rejects declared or streamed response bodies at 1 MiB or larger
6. **Timeout** — configurable via `EndpointPolicyOptions.timeoutMs` (default 60s) using `AbortSignal.timeout`

### Opt-in for Local Endpoints
Set `allowPrivateNetwork: true` on the provider block to bypass private-address rejection. This is required when using local inference servers (Ollama, LM Studio, vLLM on localhost). See the [synthesis configuration](../configure/synthesis.md) docs for the security warning.

### Usage Across the System

`validateEndpointUrl` and `safeLlmFetch` are used by:
- **Provider config save** — `PUT /api/v1/settings/provider-configs` validates `baseURL` on every provider
- **Legacy LLM config save** — `POST /api/v1/settings/llm-config` validates primary and backup endpoints
- **LLM test connection** — `POST /api/v1/settings/test-llm` validates the ad-hoc endpoint
- **Synthesis pipeline** — `synthesis-llm.ts` uses `safeLlmFetch` for all LLM calls
- **Email suggestions/summaries** — `suggest-llm.ts` and `emails.ts` route
- **Docs AI** — `docs-ai.ts` LLM calls
- **Job suggestions** — `job-suggest-llm.ts`
- **Observation extraction** — `extraction.ts` LLM calls

## Command Filesystem Boundary

**Source**: `packages/ingenium-core/lib/tools/commands.ts`

Command persistence uses the same fail-closed filesystem policy as other
protected local-file operations. Command paths are relative to the resolved
`.opencode/commands` root; absolute paths, separators, dot segments, unsafe
components, symlinks, and replacement identities are rejected. Runtime
operations require Linux descriptor anchors (`O_DIRECTORY`, `O_NOFOLLOW`, and
`/proc/self/fd`); unsupported or incomplete descriptor support fails closed
instead of falling back to path-only access. Reads and mutations re-check file
identity around the operation, and temporary/quarantine files are published or
removed only after verification.

## Vault Security Model

**Source**: `packages/ingenium-core/lib/tools/vault-crypto.ts` and `vault.ts`

The vault uses a **passphrase-is-key** design with no recovery mechanism. If the passphrase is lost, all secrets are irrecoverably lost.

### Key Derivation (scrypt)

- Passphrase is combined with a random 32-byte salt
- Derivation uses scrypt with parameters: `N=16384, r=8, p=1`
- Output is a 256-bit master key
- A SHA-256 HMAC tag is stored at initialization to verify passphrase correctness on unseal (constant-time comparison via `timingSafeEqual`)

### Envelope Encryption (AES-256-GCM)

Each vault item is encrypted with its own **data encryption key (DEK)**:

1. A random 256-bit DEK is generated via `crypto.randomBytes(32)`
2. The plaintext secret is encrypted with the DEK using AES-256-GCM (12-byte IV, 16-byte auth tag)
3. The DEK is **wrapped** (encrypted) with the master key using a second AES-256-GCM operation
4. Both the ciphertext and wrapped DEK are stored in the `vault_items` table
5. The DEK is zeroed in memory immediately after use

This means:
- The master key alone cannot decrypt items without unwrapping each DEK
- Each item has a unique DEK — a compromised DEK compromises only one item
- Re-keying (passphrase change) re-wraps all DEKs without re-encrypting item data

### In-Memory Key Management

- The master key is stored **only in process memory** (a `Buffer` in the Node.js heap)
- `sealVault()` zeroes the key buffer with `key.fill(0)` and sets it to `null`
- The key is never written to disk in any form
- A new `vault_config` row with fresh salt and HMAC tag is the only initialization artifact

### Initialization Policy and Scope

- New vaults require a non-blank passphrase of at least 12 Unicode characters.
  The same core policy is enforced for Dashboard initialization and MCP's
  first-use auto-initialization path. Existing vaults are not revalidated while
  unsealing, so a policy upgrade cannot lock out an already-created vault.
- `vault_config` and the in-memory master key are service-wide singletons. Vault
  items, folders, and audit records are still scoped to the requested project.
  Protected OAuth settings are separately resolved only against the unique
  active global project.
- Initialization and unseal attempts are limited to five per client IP per
  minute. The API returns `429` with `Retry-After`; status and metadata reads
  are not subject to this brute-force limiter.

### Audit Trail

All vault operations are logged to `vault_audit_log`:
- `vault_unsealed` / `vault_sealed` / `vault_unseal_failed`
- `secret_created` / `secret_read` / `secret_updated` / `secret_deleted` / `secret_rotated`

Audit details are empty for vault operations, and the audit API returns only
event metadata (`id`, event type, item ID, actor, and timestamp). It never
returns passphrases, decrypted values, ciphertext, wrapped keys, or free-form
audit details.

### Important Security Properties

| Property | Detail |
|----------|--------|
| **No recovery** | There is no backdoor, password reset, or recovery key. Loss of passphrase = loss of all secrets. |
| **No plaintext on disk** | Secrets are encrypted before reaching the DB. `vault_items.encrypted` is always ciphertext. |
| **Soft-delete** | Deleting an item sets `access_policy` to `{"mode":"deleted"}`; the ciphertext remains in the DB until a future purge. |
| **Audit immutability** | Audit log is append-only; entries are never modified or deleted. |

### Provider credential state boundary

Managed provider metadata is a desired-state record, not a credential store.
`llm_provider_configs` contains only provider fields and optional vault item IDs;
the corresponding API key is held by an active restricted `api_key` vault item.
The settings route rejects invalid, duplicate, missing, deleted, or non-restricted
references before mutation and never exposes the key or its ciphertext.

When a managed provider is removed or its `apiKey` is explicitly cleared, the API
soft-deletes and verifies the referenced vault item **before** committing the new
provider metadata, synthesis settings, and OpenCode global projection. Vault
soft-delete changes only `access_policy`, so this removal-only operation succeeds
while the vault is sealed; new key writes still fail closed with `VAULT_REQUIRED`.
Deletion is attempted once per reference. A failure restores earlier deletions and
staged writes and returns `VAULT_CREDENTIAL_DELETE_FAILED` without changing the
desired state. If settings/config persistence fails after deletion, the previous
desired state and credential policies are restored and `CONFIG_SAVE_FAILED` is
returned. OpenCode synchronization occurs after the durable commit and reports
warnings rather than rolling back committed state; native auth synchronization uses
the bounded abort-backed calls described below.

Native provider API-key operations are serialized per provider with at most four
queued waiters and a 2-second queue deadline. Overflow and expiry return a
retryable provider-operation response; all OpenCode and compensation calls have a
5-second abort-backed deadline. Different providers remain independent, and
credentials never appear in status, error, or compensation responses.

## Usage threshold security boundary (USAGE-100)

Usage thresholds are project-scoped metadata over provider-reported aggregates,
not billing or enforcement controls. The authenticated API requires an explicit
project and rejects missing or foreign projects; no MCP surface bypasses that
boundary. Threshold updates use expected-revision CAS, while evaluation is
read-only and does not alter telemetry, mappings, scheduler cursors, or request
execution. Stored fields contain no credentials, provider secrets, currency, or
pricing rules. Reported cost is preserved only as the provider-reported numeric
amount, and partial or unavailable values remain unknown rather than being
treated as zero.

## Trusted Job Event Boundary (JOB-100)

Trusted job events accept only the exact v1 catalog: `context.conversation.archived`,
`context.conversation.unarchived`, and `context.checkpoint.restored_as_new`.
Payloads are bounded, strict, and content-free; they contain identifiers and
revision/sequence values only. Each row is project-scoped and must match an
immutable Context maintenance audit row, with the source audit ID serving as
the dedupe key. The SQL schema/triggers are the final trust boundary, so direct
SQL callers cannot insert unknown events, alter/delete stored events, or forge
provenance; the API applies the same rejection.

There is no user-facing event append endpoint. Historical job trigger values
remain preserved, while new or changed values are restricted to the catalog or
`NULL`. Events are retained indefinitely as append-only evidence. JOB-101
dispatches only exact same-project matches for enabled jobs and snapshots each
event once, including zero-match events. Delivery execution is bounded to five
attempts with fixed backoffs; lease ownership is stored only as a SHA-256 hash
and guarded by CAS. Process proof stores only PID/PGID, start time, executable,
and a nonce hash. Missing or ambiguous identity dead-letters the delivery to
avoid duplicate execution. Payloads and prompts are not exposed or interpolated;
durable errors/log-like text is bounded and redacted, and no manual replay is
available. Project-scoped routes prevent cross-project event, delivery, run,
log, and cancel access. Job deletion is blocked with `409` during an active
delivery and otherwise preserves historical delivery evidence. Child job
processes receive only an allowlisted environment and never inherit API or
provider credentials.

## Restore Plan and Executor Security Boundary (RESTORE-100/101)

Restore plans are restricted to the active server-global project. Supported
bundles are signed v2 fixed-name directories; HMAC verification, exact component
hash/size checks, SQLite integrity, required-table metadata, schema fingerprints,
and `user_version` compatibility are checked before staging. The signing key is
a persistent owner-only file outside the backup directory and is never exposed.

Migration 083 makes plan identities, revisions, stages, events, and receipts
append-only. Authorization stores only a token hash, is short-lived and
one-time, and is bound to the plan revision and manifest. Same-UID stage
tampering is detected by reopening fixed paths without symlink following;
failure records `stage_integrity_failed` and fails the plan closed. Confirmed
content is passed only as bounded, independently verified in-process buffers,
which must be released/zeroed. REST/MCP never serializes those buffers, replaces
active databases, or deletes the source backup. Legacy confirmation is rejected
with `410 RESTORE_MIGRATION_REQUIRED`; executor processes, rollback, UI, and
off-host restore are outside RESTORE-100.

Migration 084 adds a second short-lived, one-time execution token bound to the
ready stage plus an immutable, phase-CAS execution ledger. API and MCP only
queue the fixed `restore-maintenance` Supervisor program; no request can choose
a command, argument, path, or environment. That process uses a separate
root-owned HMAC journal key and root:root `0700` journal/buffer root, stops
every database user, rejects open holders by device/inode, locks target parents
during the swap, verifies each target, and zeroes transient buffers. The API
does not read journal key material or journal contents. Interrupted runs either
rehydrate and record rollback or keep startup blocked with a bounded
`rollback_failed` outcome; terminal signed journals are archived before their
active journal and lock are removed. Tokens and owner/fence values are stored
only as hashes.

## Job vault-reference boundary (VAULT-100)

Vault references are opt-in authorization metadata, not secret access. A job may
name at most 16 unique active vault item IDs from its own project. Omitted
`vault_item_ids` means no references on create and preserves existing references
on update; a supplied list replaces the set, while `[]` revokes all. Missing,
foreign-project, deleted, and otherwise unavailable items share a generic
fail-closed error.

The API and MCP job projections return only stable item IDs, `status`,
authorization timestamps, and `authorized_item_version` captured at
authorization. `status` is limited to `authorized`, `version_stale`, and
`unavailable`. This
metadata is safe while the vault is sealed and does not decrypt or unseal it.
Authorize/revoke transitions are immutable and record the fixed actor
`authenticated_api`. VAULT-100 does not inject values into runners or expose
them through MCP, job prompts, or logs; runner injection belongs to VAULT-101.

### VAULT-101 runner injection boundary

VAULT-101 explicitly reauthorizes every referenced item for one attempt only. A
sealed vault, missing/deleted/foreign/revoked item, expired authorization, or
version-stale authorization fails closed before the child is spawned; the runner
never auto-unseals. Each retry performs a fresh authorization resolution.

Secret material is written only to run-owned UUID files under a protected tmpfs
directory (`0700` directory, `0600` files). The child receives only the
non-secret `INGENIUM_VAULT_SECRET_FILES` ID-to-path map. Values are never placed
in environment variables, argv, prompts, logs, the database, API responses, or
MCP responses. Vault-enabled output is wholly redacted. Cleanup and zeroization
cover normal completion, partial cleanup, unsafe-directory retention, nonce
races, crashes, and shutdown; retained unsafe state fails closed for later
recovery. The implementation does not promise isolation from a same-UID process.
