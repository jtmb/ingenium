# Core126 actual owner implementation proposal

Follow-on to `22ce57d4`, implementing the concrete Core journal/credential/endpoint work rather than leaving owner methods as contracts. All source remains under this worker's owned docs directory. Root alone installs NodeSQL126, mounts routes, reconciles Auth/Worker5 changes, qualifies images, builds or touches production. No migration, credential file, runtime, model, Docker object or service was created by this worker.

## Source and patch roles

- `core126-owner.patch`: actual API-owned singleton DB implementation, closed HTTP handlers/actual Core factory, the original credential-owner extension, and the factored original manager token-file owner. It does not change existing generic credential kinds/audiences or manufacture a browser/service/compatibility session.
- `managed-job-manager.patch`: **supersedes** the earlier `22ce57d4` manager bundle. Includes the same canonical manager/container/child sources, shared original token loader, and corrected material/effect admission revisions. Do not stack the old manager bundle and this version.
- `core126-legacy-guards.patch`: protects existing Core finish/cancel/restart recovery and rejects local control-plane execution of a managed original run.
- `managed-job-async-dot.patch`: existing async boundary proposal; apply only its matching preimage, retaining singleton scheduler/router ownership.
- `126_managed_job_execution.proposal.sql`: reserved126 DDL, now including immutable original identity/CAS enforcement, result/material metadata and the dedicated job-run credential sidecar. It is a proposal, not an installed migration.

Exact hashes/preimages and source test evidence are in `core126-proposal.json`. Use `git apply --unidiff-zero --check` against exact originals; tests reconstruct source in memory and must run before patches are applied. Root may need to reconcile overlapping files if it already integrated an earlier proposal.

## Implemented Core methods

`createCore126Owner` implements prepare, admission, create/start effect CAS, launch material/credential issuance, created/started/unknown acknowledgements, assignment, result verification, cancellation intent, original retirement, consumption/removal, original-run read and retirement-proof matching. It uses the existing `getDb` identity, `execTransaction(fn,1)`, post-commit checkpoint, Jobs/run/grant/quota, runtimes/workspace, actual authorization and agent factories. No async work crosses its SQL transaction. No second run is claimed, no principal/workspace/grant is auto-created, and no prompt/model transcript is copied into the ledger.

Preparation validates the actual private Job actor through the existing authorizer and a server-owned `context.revalidate()` callback. Scope IDs are lookups only. An existing prepared row does not bypass that check. Profile/provider work happens outside SQL; the callback, original run, real workspace/runtime, agent and grant are checked again afterwards. A missing image/provider/profile/capability remains unavailable.

Actual JobRun has `job_revision`, `schedule_revision` and `authorization_revision`, but no general RunRevision. The implementation binds a hash of its immutable original identity fields plus Core126's own CAS revision. It snapshots principal security epoch separately from workspace epoch and rechecks both before material/effects. Tests caught and fixed principal-epoch drift. An unknown existing operation cannot become a new managed launch.

`admit(cancel)` recognizes the existing durable Dot operation's cancel intent and records it in the same ledger. It does not optimistically mark the original run cancelled. Retirement is authenticated manager evidence for the exact original daemon/container/run/attempt/spec. Core changes an original running/queued run only after that positive proof: verified successful result may succeed, cancellation may cancel, deadline may time out, and missing/unverified result fails. Container exit zero alone never succeeds. Result consumption additionally requires the original Dot operation to have consumed a terminal outcome before cleanup eligibility.

## Corrected private protocol CAS

Material issuance commits `credential_id`/material state and returns the **updated canonical admission**. Accepted create/start intents likewise return `{accepted:true,admission}`. The manager replaces its revision before the next acknowledgement. It refreshes again after handoff, because a fast child may submit its result before the manager's started acknowledgement. A SQLite+manager integration case exercises this race through real journal writes; the previous boolean-only intent adapter would have failed.

No ambiguous create/start/material acknowledgement resets to prepared or mints/replays another attempt. The first container, attempt, credential and immutable original identity remain bound. Cancellation/unknown/retirement updates use the same original row and CAS fences.

## Existing credential owner, explicit job-run sidecar

The original `mcp_credentials` schema has immutable CHECKs for service/runtime/repository-sync. This proposal leaves every existing row, trigger, receipt, epoch and encryption key untouched. It adds literal `kind='job-run'`, `audience='job-run'` rows to `job_run_mcp_credentials`, issued/resolved/revoked only by added functions **inside the existing mcp-credentials owner**. They reuse its private random token factory and existing token hash/encrypt/checkpoint/transaction functions. No parent token, generic service kind or new workspace/principal is a fallback.

The sidecar joins the actual original run/grant, active principal, current workspace/runtime/member, exact original attempt/container parent/revision, deadline and cancel state. It captures principal and workspace epochs separately. There is one credential per original run, no rotation/replacement fallback, and no expiry extension. Generic MCP/runtime/browser authentication never recognizes it. Root's source preserves the original auth key lifecycle; production encryption is not replaced by a fixture helper.

The actual factory further narrows requested job capabilities against the current explicitly granted parent runtime capability scopes, without copying/reusing its credential. Missing or broader capability facts reject the profile. It uses existing `vault.resolveJobProviderRuntime`, `resolveJobProviderModel`, `agents.getJobAgentConfig` and protected deployment validator, and rechecks provider binding after catalog awaits. Current source admits only a qualified anonymous original provider role; paid-provider secret projection remains explicitly unavailable until its original secret/image owner qualifies a safe handoff. Root's immutable image/profile/resource owner must supply real qualification; a label or a boolean in an HTTP body cannot provide it.

## Narrow private enrollment and endpoints

`loadManagerToken` is factored from the actual original runtime-manager token-file owner and reused by manager and Core journal guard. The existing configured private token file must be safely mounted to the API with its original ownership/mode checks. Missing enrollment is 503, wrong token is 401. There is no API_TOKEN, caller-selected token path, cookie, user scope or generic service credential fallback. Authentication reloads current file ownership/token at the request/method boundary, including after material qualification awaits. No new manager credential is minted.

The internal handler covers admission/material/effect/created/started/unknown/retired/consumed/removed at the exact original run path. The runtime handler independently resolves only the exact job-run audience for assignment/result/scoped MCP; foreign run/project, parent/runtime audience, expired/revoked/epoch drift and forged metadata deny before material/effects. Handlers return data to Root's existing error/HTTP stack; Root retains actual mounting and JSON/body-log redaction.

The per-tool bridge uses the server-owned original tool descriptor/category, actual explicit MCP policy and current Core authorization. It never accepts a caller category or returns a generic Auth principal. Only exact project-scoped granted tools may dispatch through the existing protected tool factory; private/organization/installation tools are denied rather than impersonating the owner. Current parent/profile/credential facts are checked at each broker entry. Missing registered broker transport/catalog is unavailable and must prevent image qualification. Root must reconcile the actual extension/job-role audience transport with Worker5; the existing generic runtime/MCP path is not silently reused.

## Result and quota semantics

A `verifiedResponse` boolean alone is rejected. The fixed qualified child sends bounded redacted native event markers; the API runs the existing `JobResponseVerification` parser, stores only bounded outcome metadata, and requires the original container retirement before terminalizing the run. Raw model content/prompt/credentials are not stored or returned in result evidence. Authentication is the closed original-run credential and qualified image; this is the existing parser's response qualification, not a new cryptographic model attestation.

Legacy `finishJobRun` cannot terminalize managed work before retirement or mark unverified work successful. Managed cancellation persists intent and the original Dot operation's CAS state while leaving the original JobRun running, keeping its quota reserved. Existing restart recovery excludes managed original rows, so a controller restart cannot mark a still-live remote child failed and release quota. Unrelated legacy runs keep their original recovery behavior. The local runner rejects a managed original run before any model/provider/process effect.

## Fixture evidence and limits

`core126-sqlite.cpu.mjs` uses real **in-memory SQLite**, exact extracted existing Core grant/runtime/authorization/token/hash/verifier functions, the actual proposed Core journal/credential code, and the actual proposed legacy guard functions. It does not import/open the full configured Core singleton or use a user auth key. Encryption helpers are isolated fixture-only memory stubs; production proposals still call the original Core encryption factories. Profile/image/agent projection/Docker/spawn facts are explicit fixtures, not real qualification.

The suite includes complete manager-to-Core material/create/start/fast-result/retirement/consumption/removal through real SQL CAS; privacy/grant/member/epoch/runtime checks; encrypted sidecar/legacy-value preservation; wrong audience/foreign run/project; uncertain launch no replay; after-await principal revocation; actual parser result proof; private manager enrollment; immutable SQL rows; and legacy quota/restart/finish guards. The earlier dependency-free proposal suites remain relevant. No file-backed SQLite fixture or process was generated.

Root still owns strict declarations/types, route/server/auth reconciliation, migration126 installation, actual broker/extension audience and paid-secret/image qualification, integrated full-Core/package/HTTP tests, and live selected-container/model/process/descendant/restart acceptance. These source and SQLite receipts do not mark the feature, phase or full plan complete.

## Cleanup

All outputs are minimal durable source/tests/patches/manifests under the original authorized C-backed WSL root and `docs/workstreams/dot`. No dependency/build/cache/temp/log tree, credential file, Docker object, service/model/GPU/CU or disk DB was created. Source remains for Root review/integration and version-controlled supersession. Removed paths and bytes: none/0. No Linux or Windows disk recovery is claimed. Existing user source/locks/runtime/vault/model data, original failure and central fixtures remain untouched.

## Conservative open edge

Material/credential or creation acknowledgement loss may leave a prepared/intended original run with no trustworthy original container ID. The implementation retains quota and intent, rather than treating absence as retirement or resetting/replaying the launch. Safely releasing a provably pre-effect case would require an explicit monotonic no-create-effect admission proof, distinct from Docker retirement; that protocol is not silently added here. Root must preserve this unresolved failure/reconciliation acceptance edge. The current proposal never reports it complete or deletes ambiguous ownership evidence.

Final source checkpoint evidence: **57/57 passed, zero skips** (19 Core/SQLite, 2 original manager-file enrollment, 36 prior manager/async/child/adapter/fallback fixtures). Four exact patch applicability checks and thirteen complete module/shell parse checks passed. No compiler, configured production Core/key, live process or platform acceptance is implied.
