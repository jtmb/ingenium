# Rust/API compatibility foundation

Status: implemented source candidate, 2026-10-29. The coordinator accepted the allowlisted read-only credential-delegating approach for source implementation and denial tests through the frozen parallel integration contract v1. Writable migration architecture and production traffic binding remain unapproved. This worker does not claim Phase 3 or release acceptance.

## Owned delivery

- `services/veyra-api`: isolated Axum read compatibility service and response-parity consumer adapter.
- `crates/veyra-auth`: exact route capabilities and credential/header admission.
- `crates/veyra-runtime`: progressive domain ownership ledger.
- `services/ingenium-api/tests/veyra-compatibility-response-parity.test.mjs`: dependency-free comparator tests.
- This directory: ADR, contract, verification and coordinator requests.

No root manifests/locks, migrations, existing routes/auth helpers, dashboard, engine, deployment or runtime files changed. There is no database, transcript store, scheduler, session store or inference engine in the new service.

## Compatibility ADR-0001

**Status:** accepted for source implementation and denial tests by the coordinator's parallel integration contract v1; runtime configuration, traffic exposure and writable cutover remain separately gated.
**Date:** 2026-10-29.

The existing API owns authentication, token audiences, session revocation/security epochs, organization/project membership, capability decisions, audit writes, SQLite transactions and migrations. Reimplementing only token syntax or trusting forwarded user headers would remove these protections. Browser session resolution also touches session expiry/last-seen; “read-only HTTP” does not mean the existing API performs zero writes.

Keep the existing Node API as the sole identity, authorization, crypto and database authority. The Rust edge forwards original allowed caller headers for each request, including cookie and bearer together. It never retries with an installation token after denial. An invalid cookie must continue to win over a bearer token according to existing middleware. It does not resolve credentials, invent roles, mint sessions, cache grants or broaden project scope.

Admit exactly `GET /api/v1/projects` and `GET /api/v1/projects/archive`. Forward query bytes, including `organization_id`, to the existing collection policy. The response bytes/status are opaque: no DTO renaming, pagination/envelope conversion, boolean conversion, projectless/global migration, or transcript duplication. The legacy unpaginated collection remains a compatibility contract. Responses beyond 4 MiB fail closed; pagination changes require a separately versioned contract.

Reject other methods/routes and internal installation/bootstrap/report/private-network markers before upstream I/O. Preserve normal MCP/runtime/repository-sync audience/workspace/worktree headers for upstream validation; header claims alone confer no identity. Duplicate credential/context fields and hop-by-hop connection nominations are rejected. Forwarded user/role/IP/host claims are discarded. This slice deliberately does not provide internal installation or report-credential access.

Both listeners and upstreams are explicit loopback addresses. The upstream client disables redirects and environment proxies, bounds connect/total time and response size, and does not log credentials/bodies. This is a same-host qualification boundary, not an externally exposed production identity service. Gateway/CORS/original-IP attribution and edge admission limits must be designed before production traffic. Existing Node limiters still apply but see the edge's loopback source.

Consequences: a compatible first Rust HTTP slice can be exercised while preserving one writer. The Node process remains required and latency/RSS benefits are unproven. There is no standalone Rust login, password, MFA, refresh, step-up, CSRF or vault implementation. Writable routes remain absent until the recorded architecture gate is approved and full auth/crypto/storage parity is proved.

## Preserved contracts and source references

| Concern | Existing authority | Treatment |
| --- | --- | --- |
| Cookie precedence, scoped tokens and service audiences | `services/ingenium-api/lib/middleware/auth.ts` | Original cookie/bearer/context forwarded together; no identity assertions trusted |
| Membership, scope intersection, hidden-resource denials | `lib/authorization-policy.ts`, `packages/ingenium-core/lib/tools/authorization.ts` | Existing middleware executes every request |
| CSRF/origin and recent step-up | `lib/middleware/csrf.ts`, auth-preflight routes | No new writable route; forward Origin/UI marker for reads; future writes require full equivalent checks |
| Sessions | `packages/ingenium-core/lib/tools/authentication.ts` | Existing cookie `__Host-ingenium_session`; existing Node owns touch/revocation/epochs |
| Passwords | Same authentication source | Existing scrypt N=65536, r=8, p=1, 32-byte key, 16-byte hex salt unchanged |
| Vault crypto | `packages/ingenium-core/lib/tools/vault-crypto.ts` | Existing AES-256-GCM IV(12) + ciphertext + tag(16), scrypt and key wrapping unchanged; no decryption in Rust |
| Storage | `packages/ingenium-core/lib/db.ts` and migrations | Node remains sole writer/migrator; Rust never opens SQLite, including read-only handles |
| Error/status semantics | `lib/middleware/errors.ts` | Upstream status/body/challenge retained; edge failures use safe error envelope |
| Existing collection data | `lib/routes/projects.ts` | Preserve `{data:[...]}`, IDs/org ownership/global and archive fields byte-for-byte |
| Installation Chat defaults | Coordinator-owned current work | No edits; independent from per-chat selection and project/global migration |
| Windows inference | Existing native lineage | Unchanged; no dependency or engine capability in this Linux service |

Paths beginning `lib/` above are relative to `services/ingenium-api/`.

## Transport contract v1

The coordinator's frozen parallel integration contract v1 governs logical ownership; concrete shared DTO fields are still coordinator-owned. No shared ProjectRef/ExecutionBinding/ConversationRef DTO is defined here. The coordinator freezes shared DTOs and future domain migration allocation.

Allowed caller headers: Authorization, Cookie, Origin, X-Ingenium-UI, X-Ingenium-Audience, X-Ingenium-Workspace and X-Ingenium-Launcher-Worktree. A combined header budget of 16 KiB applies. Unknown identity assertions are dropped; the internal/bootstrap/report/private network/storage hash markers return hidden 404. GET bodies are never forwarded.

Forward upstream Content-Type, Content-Encoding, Vary, WWW-Authenticate, Retry-After and X-RateLimit-Limit/Remaining/Reset; force Cache-Control: no-store. Do not reflect Set-Cookie, redirect Location, hop-by-hop headers or arbitrary upstream diagnostics. No new login/session endpoint is present.

| Condition | Result |
| --- | --- |
| Allowed read | Existing API status/body and selected headers, with no-store |
| Outside slice, private marker | 404 NOT_FOUND; no upstream contact |
| Duplicate/budget/hop-by-hop header refusal | 400 INVALID_REQUEST_HEADERS |
| Upstream redirect | 502 UPSTREAM_REDIRECT_REJECTED; never follow |
| Upstream unavailable or failed response stream | 502 UPSTREAM_UNAVAILABLE |
| Response exceeds 4 MiB | 502 UPSTREAM_RESPONSE_TOO_LARGE |
| Connect/total timeout | 504 UPSTREAM_TIMEOUT |

Edge errors are `{error:{code,message,details:null,requestId}}`. Request IDs are process-local monotonic labels, not global trace IDs. No path, submitted value, secret or upstream error text is included. Unknown upstream mutation outcomes cannot arise in this slice because no mutation request is sent. Future writes must retain original operation IDs, first failures and explicit unknown-outcome reconciliation; no retry-based success.

## Configuration and operations

| Variable | Default | Consumer | Meaning |
| --- | --- | --- | --- |
| VEYRA_API_LISTEN | 127.0.0.1:4107 | `services/veyra-api/src/main.rs` | Loopback socket only |
| VEYRA_LEGACY_API_ORIGIN | http://127.0.0.1:4097 | Same main and service constructor | Explicit loopback HTTP origin only; no userinfo/path/query/fragment |
| CARGO_TARGET_DIR | Must be set by coordinator lease | Cargo | Disposable build output inside approved root |
| CARGO_HOME | Must be separate from target, coordinator assigned | Cargo | Lockfile-compatible tool/dependency cache, never runtime state |
| TEMP / TMP / TMPDIR | Worker-owned coordination subdirectory for pure tests | Test process | No fallback temp/cache output |

The Cargo manifest is intentionally isolated under the service. Root workspace integration, pinned lockfile generation and dependency/build scheduling belong to the coordinator. Path crates remain separate packages and require their own test/clippy/fmt commands. No service has been launched by this worker.

After a resource lease and approved test upstream, the coordinator can exercise the source via `cargo run --manifest-path services/veyra-api/Cargo.toml`. Never point a test at a production database copy or start another writer. Disable the edge routing to roll back a read-only trial; existing API/storage remain authoritative.

## Writable migration gate

Before writable cutover: record architecture approval; freeze DTO/scope/operation contracts; inventory every route/tool/FK/crypto consumer on an authorized copy; prove source-to-target counts/hashes and existing credential decrypt/verify vectors without publishing secrets; exercise browser/user-token/service/compatibility/gateway and cross-org/project denial matrices; demonstrate revocation/epoch/CSRF/origin/step-up/audit behavior; allocate one writer/migrator per domain; reconcile in-flight operations; verify rollback across newer writes and schema versions. No dual writes. Restore over newer user writes is not rollback.

New domains may consume existing API clients while this gate is open. They cannot use the source ledger, shared DTO proposal or a passing fixture as cutover authorization.

## Verification and remaining gates

Executed: seven dependency-free Node tests of the parity adapter, all passed. They prove comparison behavior for opaque UTF-8 bytes, envelopes, 401/403/404/422/429/500/503 statuses, challenge/rate-limit/cache/encoding headers, safe mismatch evidence and invalid-input refusal. They do not execute Rust or prove real identity/RBAC parity.

Rust tests cover exact route/method denials, spoofed privileged markers, duplicate credentials/connection nomination, preservation of cookie plus bearer, status/body/challenge parity via a synthetic upstream, redirects, upstream URL admission, connection failure, oversized response refusal, per-request credential isolation and suppression of upstream Set-Cookie/private diagnostics.

The coordinator granted a bounded offline Windows CPU lease using existing Rust/Cargo 1.99.0 and the approved source cache. After preserving and repairing one OS-dependent test setup failure, all eleven Rust tests passed: service 7/7, auth 3/3, runtime 1/1. Clippy with warnings denied passed for all targets in all three packages. Formatting passed for all three. The seven Node comparator tests also passed; their source remained unchanged during Rust qualification. These checks use synthetic credentials/upstreams and do not prove real-account RBAC or Linux runtime acceptance.

No online download, source/dependency copy, production service start or model operation occurred. The generated package-local lockfiles are retained as reproducible source inputs. Subsequent checks should use --locked --offline.

Executed qualification commands (with target/home/temp scoped by lease; use --locked --offline for subsequent test/clippy runs):

```sh
cargo test --locked --offline --manifest-path services/veyra-api/Cargo.toml
cargo test --locked --offline --manifest-path crates/veyra-auth/Cargo.toml
cargo test --locked --offline --manifest-path crates/veyra-runtime/Cargo.toml
cargo clippy --locked --offline --manifest-path services/veyra-api/Cargo.toml --all-targets -- -D warnings
cargo clippy --locked --offline --manifest-path crates/veyra-auth/Cargo.toml --all-targets -- -D warnings
cargo clippy --locked --offline --manifest-path crates/veyra-runtime/Cargo.toml --all-targets -- -D warnings
cargo fmt --manifest-path services/veyra-api/Cargo.toml --all -- --check
cargo fmt --manifest-path crates/veyra-auth/Cargo.toml -- --check
cargo fmt --manifest-path crates/veyra-runtime/Cargo.toml -- --check
node --test services/ingenium-api/tests/veyra-compatibility-response-parity.test.mjs
```

Then run real existing API credential/denial/revocation matrices on controlled data, compare exact same-authority response fixtures, test timeout/oversize/disconnect/duplicate raw-header behavior, review CORS/limiting/trusted ingress, and measure startup/RSS/latency. Windows/native contract reuse, integrated packages, Linux persistence/rollback and all visual/release gates remain coordinator work. No performance claim is made.

## Storage reconciliation

Initial source work generated no bulk outputs. The later coordinator-granted offline Windows qualification reused the existing Cargo home and generated package-local lockfiles, logs and one qualification target. Source, lockfiles, test fixtures and minimal ownership/status/patch/hash receipts are durable deliverables for coordinator integration.

Final qualification inventory: target 758,692,132 bytes; logs 13,726 bytes; empty temp directory 0 bytes; total files 758,705,858 bytes. The original failed test log is 5,291 bytes and remains the unique first-failure witness. All compiler/test handles had exited at reconciliation. No removed paths; removed bytes: 0.

Automatic approval review rejected deletion of the new target, and separately rejected removal of the empty temp directory, both with the generic reason "blocked by policy". These exact targets are retained exceptions and were not retried through another path/tool. Coordinator reconciliation explicitly authorized reuse of the retained target for the successful final test/clippy run. Remaining target consumer: coordinator source acceptance and any specifically granted defect reproduction; end condition: coordinator resolves the cleanup refusal without bypass, then reconciles the exact target. Logs remain for review against source/lock hashes. The empty temp directory remains solely under the failed safety/approval check.

Existing rejected targets and Cargo home remain untouched. No dependency/runtime/model copy, drive migration, workload interruption, VHDX compaction, or Linux/Windows recovery claim occurred.

## Requirement audit against frozen integration contract v1

| Requirement | Current source/evidence | Acceptance |
| --- | --- | --- |
| Rust service foundation | Isolated Axum service manifest, listener and bounded legacy transport | Windows compilation, fmt and clippy with warnings denied passed |
| Original-credential authentication and capability boundary | Exact GET allowlist; original cookie/bearer/context forwarded together; forbidden internal markers rejected; no identity/cache/token issuer | Windows Rust boundary tests passed; real identity denial/revocation parity remains unverified |
| Progressive domain migration interfaces | Typed domain stage/database-authority ledger and opaque read adapter; all unlisted domains legacy-owned | Source candidate; no writable interface or writer switch |
| Existing API contract | Byte/status/header preservation; seven comparator tests passed | Comparator and synthetic Windows transport tests passed; real authority/ingress parity remains open |
| Existing crypto/storage contracts | No crypto/SQL dependencies or local DB handles; Node owns credential/session/audit/migration side effects | Source manifest boundary checked; no replacement crypto implementation claimed |
| One database writer | Existing API remains sole writer, including read-request session/audit side effects | Source invariant; integrated runtime qualification pending |
| Windows engine unchanged/excluded from Linux | No native edits or inference dependencies; explicit Linux exclusion in ledger | Source invariant; packaging qualification remains coordinator-owned |
| Compatibility ADR and safe read-only slice | ADR-0001 plus OpenAPI and source implementation | Coordinator accepted source approach; no runtime exposure authorization |
| Tested adapters | Seven Node comparator tests and eleven Rust tests passed; all clippy/fmt checks passed | Windows source qualification passed; integrated/runtime release gates remain separate |
| Writable production approval gate | No write route, copied DB, migration or traffic switch | Retained; approval not implied by source acceptance |
| Docs, evidence and cleanup | Owned README/OpenAPI plus exact patch/manifest/status receipts; no disposable build outputs | Source deliverables retained for coordinator review; no cleanup bulk created |

The coordinator separately granted and reconciled the offline compiler lease; source acceptance alone did not authorize build/download/exposure. The successful test and clippy processes exited normally. Goal-tool state remains blocked until the coordinator accepts this worker scope; no active status is fabricated.

## Windows qualification follow-through

Existing Rust/Cargo 1.99.0 compiled the service offline using 99 lockfile-resolved cached packages. Source now retains generated service/auth/runtime package-local Cargo.lock files, so the coordinator should use --locked --offline for subsequent checks. The first failing log remains in the private qualification record, not the publishable repository.

The first-failure signature is test-only: closed_upstream_is_a_safe_gateway_failure asserted status 502, actual Windows status 504 after a 2-second connect timeout. Production transport correctly distinguishes timeout from other gateway failures. The replacement test disconnected_upstream_is_a_safe_gateway_failure accepts a local connection then drops it, avoiding dependence on OS/firewall handling of a closed port. The replacement passed in the final granted run after reading request bytes before disconnect.

The first debug build produced more output than the lease estimate. Cleanup was attempted only against the newly owned qualification target after checking source/lock/failure preservation, reparse points and process/file references. The automatic approval review rejected that action with the generic reason "blocked by policy"; no deletion was executed, no failed target was retried through another mechanism, and no workload was stopped. Further compilation was initially withheld. The coordinator then explicitly reconciled the retained target and authorized reuse under refreshed storage guards. The final successful run reused the same target and cache, with incremental compilation disabled; no second target or dependency tree was created.

Windows CPU compile/test evidence is not Linux runtime, real-account authorization, deployed persistence or writable Rust acceptance.

## Follow-on operator qualification

The [exact-source qualification harness](qualification-harness.md) supplies reproducible original-credential parity, bounded startup/RSS/CPU/API measurements and model-free fixture tests. Its actual Windows/Linux authenticated measurements remain coordinator leased; fixture success is not platform or performance acceptance.
