# Native integration entrypoints

Source-only consumer implementation: `NativeWorkspaceTransport` and `createNativeExecutionHandlers` in `services/ingenium-api/lib/projects-v2/`. Migration **122** is coordinator-owned; the owned draft is a standalone reference fixture.

## Mounting and authority

Mount the returned handlers after existing API authentication, CSRF/origin and capability middleware. Supply `resolveScope(req)` from the authenticated principal and `resolveContext(req, scope)` from the authorized runtime/workspace owner, returning `{projectId, binding}`. Body scope/host/owner/binding objects confer no authority.

The constructor transport is a **server-only authenticated, instance-pinned native gateway port**. It receives scope, expected service instance, fixed method/path/query/body, response byte bound and redirect:error; it returns `{instanceId,status,data}`. The instance must come from the verified native connection, never an echo. No client-provided URL or raw proxy is exposed. Do not point a cluster API at its own localhost and call it the user's Windows host. Missing pairing/offline selected hosts remain unavailable.

| Handler | Consumer method | Actual native HTTP route |
| --- | --- | --- |
| terminalDispatch | terminalDispatch | POST /v1/interactive-terminals/ ; POST /v1/interactive-terminals/{id}/input, /resize, /close |
| terminalReceipt | terminalReceipt | GET /v1/interactive-terminals/operations/{request_id} |
| terminalRead | terminalRead | GET /v1/interactive-terminals/ ; GET /v1/interactive-terminals/{id}?after=... |
| gitRead | reviewRead | GET /v1/git-review/ |
| gitPreview | previewReviewed | POST /v1/git-review/worktrees/preview or /worktree-archives/preview |
| gitSubmit | submitReviewed | Domain routes below |
| gitReceipt | reviewedReceipt | GET the exact domain receipt; never repeat a mutation |

Authorization port names are projects:list/read/create/write, terminal:open/input/resize/close/read, git:read/branch, git:change:<native_operation_kind>, git:findings:write/triage/assessment and worktrees:preview/create/archive/restore. The coordinator maps these to existing actor/org/project capability and approval owners. A native bearer or read permission never implies permission to revert, commit, push or create a PR.

## Native catalog

Instantiate NativeProjectCatalogAdapter with `owner: nativeTransport.projectOwner()`, a verified instance and the host-native root-proof resolver. The adapter uses GET/POST /v1/projects and GET/POST /v1/projects/{id}. Empty cursors are omitted; only provided metadata fields are sent on update. Native IDs/revisions stay native-owned. Do not populate a second API catalog for native projects or merge by label/path spelling.

## F32–F34 and worktrees

Complete reviewed native originals pass unchanged. No action label becomes a command, and current drafts/remotes never rebuild a saved original.

| Domain | Submit below /v1/git-review | Actual owner boundary |
| --- | --- | --- |
| branch | /branches/operations | GitBranchRequest: owner, HEAD/index/base/target and native branch ledger |
| change | /operations | confirmed GitChangeRequest: stage/unstage/revert file or hunk, commit, push, create_pull_request |
| worktree | /worktrees/operations | Exact WorktreeCreateRequest from native preview; setup remains separate |
| archive | /worktree-archives/operations | Exact native archive/restore original, recovery fingerprint and destinations |
| finding | /findings | Exact source, line and comment body |
| triage | /finding-triage | Exact finding receipt, revision and predecessor |
| assessment | /finding-assessments | Exact finding receipt and assessment provenance |

GET receipt originals must equal the requested original. Native pending/uncertain/not_admitted map to pending/unknown/failed. The native service owns Git process containment, effect serialization, credentials, remote publication and recovery. The adapter runs no Git or publication itself. Work owns display/action UI; this boundary owns native calls.

The existing Git review path supports Windows projects whose saved root equals the repository worktree root. WSL/cluster Git is explicitly unsupported here; select another qualified owner rather than moving execution. Original patches, remote URLs and PR text retain exact bytes.

## ConPTY and persistence correction

The legacy workbench router lacks resize, but the separate **interactive_terminal** router already exposes ConPTY create/input/resize/close/receipt reads and explicitly pinned WSL distro/user shells through Windows. Source existence does not prove real-machine or WSL ownership qualification.

Native catalog truth is client_reconnect:true, service_restart:false, a 262144-byte output ring and a 16-session limit. Do not advertise survival across service restart. Native sequence/after/output_base64 retain byte-cursor semantics; do not feed them to the generic chunk-sequence adapter or invent contiguous chunk IDs.

ExecutionOperations can wire `dispatch: request => nativeTransport.terminalDispatch(request)` and `readOperation: request => nativeTransport.terminalReceipt(request)`. Reconciliation now carries the original args. Creation always sends save_default:false; selecting a shell does not update saved defaults.

### Exact terminal receipt proof

Current public receipts omit a fingerprint of the retained original input. A colliding ID with different text must not settle an unknown original. Without proof, recovery stays unknown with NATIVE_TERMINAL_ORIGINAL_UNVERIFIED; no replay occurs.

`native-terminal-original.patch` is an **unapplied coordinator change request** for two files outside worker writer prefixes. Its JSON companion records baseline and patch hashes. Windows Git apply --check passed at the assigned native baseline; no native edit/build/runtime occurred.

The patch adds optional original_sha256 and computes it before effect admission from the retained typed body plus nullable terminal ID. It returns no input text. Node and proposed Rust hash compact UTF-8 JSON with recursively sorted keys, exact strings, typed integer/boolean fields and explicit nullable options. Matching proof can settle a receipt; missing proof remains unknown and mismatched proof conflicts.

After review/application on native integration source: regenerate contract declarations; run the pure terminal_original_fingerprint_matches_json_golden test plus focused terminal receipt checks under a resource lease; run required scoped Rust checks. Patch compilation and real ConPTY behavior remain unverified.

## Projectless support

Native task/terminal/Git contracts require a project. **/v1/scratch creates a real persisted project and directory**; it is not a null-project binding and is never a fallback here.

This adapter returns 501 NATIVE_PROJECTLESS_UNSUPPORTED for null project and 501 for a cluster binding sent to the native owner. The shared domain supports private null-project organization/conversation identity, but execution requires an actual qualified private workspace owner. No native owner proved in this stream supplies it. The acceptance gate remains open.

## Tests and allocation

44 dependency-free tests pass, including protocol-shaped owner fixtures for the new handlers/transports. These are source/transport fixtures, not native process/publication tests. Five React tests still await coordinator tooling.

The schema-copy test locks the original 001–121 baseline, records its 220 tables and 118 reference columns, then applies later allocated migrations. It uses migration 122's catalog when present and does not apply the draft twice. Original table digests and FK checks remain mandatory.

Set test-only VEYRA_PROJECTS_MIGRATIONS_DIR to the authorized coordinator source migrations directory. A read-only-source/in-memory run against 122/123/124 passes with all original 220 table digests unchanged and zero FK violations. Actual getDb/better-sqlite, production-copy and runtime/visual acceptance remain coordinator evidence.
