# Managed execution of an original Core JobRun

This is a source implementation proposal for Root review. No shared files have been edited, no new containers/processes/services/models have run, and no build/install has occurred. It preserves the complete Veyra/Dot acceptance scope. It does not establish live process or phase acceptance.

## Canonical files and exact preimages

`managed-job-manager.patch` proposes edits to the original runtime-manager, private client and runtime entrypoint, plus new canonical manager-owner/Core-client/child/async-adapter modules. `managed-job-async-dot.patch` proposes the async Dot service/runtime/router/request-session/singleton scheduler boundary. Both are zero-context unified patches; exact preimages and hashes are in `managed-job-proposal.json`. Verify the pinned preimage before using `git apply --unidiff-zero --check`. The `.proposal.mjs`/`.proposal.ts` files are readable canonical source excerpts matching the bundle, not a deployed alternate runtime.

`126_managed_job_execution.proposal.sql` is the Core-owned DDL proposal. **Root reserved NodeSQL 126 exclusively for this managed original-JobRun ledger; it is not installed and does not authorize production write cutover.** It is one execution binding for an EXISTING original JobRun, not a second run row, scheduler, transcript or database. Initial `managed-job-unavailable.patch` and its small gate source/test record the unavailable capability fallback only; that earlier additive gate is superseded by the full owner protocol proposal and should not be applied as the managed implementation.

The original manager currently supports runtime provision/inspect/placement/stop/remove; the original client only validates runtime-inspect DTOs. The original shared services supervise web/CLI/VSCode, with no per-JobRun descendant owner. The proposal extends that original private manager authority rather than calling the local control-plane `/workspace` runner or unconstrained Docker exec.

## Container and launch authority

One isolated container belongs to one original Core `runId` and immutable `attemptId`. It is **not** the selected parent runtime's process group and must never stop/remove that parent. It uses the same canonical registered project workspace mapping, original selected owner/org/project/workspace/hash/epoch, bounded independently admitted resource quota, original private network, immutable selected parent image ID, and protected profile. It introduces no clone of the user's source/workspace, host PID mode, privileged execution or automatic removal.

Core first validates the existing Dot operation/run linkage, current original Job/grant/schedule revisions, independently declared capability profile (including external-message grants), runtime/workspace ownership and resource admission. The already committed original JobRun remains the claim. `prepareManagedExecution` must never call `startJobRun` again or move a local/previously launched run into a managed container. Core records immutable execution binding and one original attempt. Profile/image/credential/resource facts that are missing remain unavailable.

The manager accepts only lookup IDs from its authenticated private route. Launch JSON is exactly `{runId,runtimeId}`. It obtains every other fact from authenticated Core journal endpoints. No public caller supplies container ID, command, owner grant, workspace path, prompt, token, image or model selector to Docker. The canonical `buildRuntimeContainerSpec` validates the same existing workspace map and limits. Final entrypoint is fixed to the existing runtime entrypoint with a fixed `job` role; that branch executes the fixed per-container child script instead of shared services. Protected broker configuration and project-owned agent projection are reused.

The immutable parent image must actually include the fixed job-role entrypoint and qualified profile. An image label, current healthy engine, or source-file presence does not qualify it. Root's image/profile owner must reject old or unqualified images before admitting a run; this worker does not rebuild, replace or launch the selected runtime.

## Core sole-writer protocol

The proposed manager Core client uses the existing private manager identity, with **new narrowly registered Core routes**, not an invented user session or a parent runtime token. Root must register this credential for these internal journal operations only and recheck the run's original delegated authorization. Internal manager authentication is not an owner grant.

The closed route family is `/api/v1/internal/managed-job-runs/:runId/`:

| Operation | Core-owned behavior |
| --- | --- |
| GET `admission?action=launch/inspect/cancel/cleanup` | Resolve exact original run/job/attempt and immutable execution facts. Launch checks current execute grant, profile, resource lease and selected binding. Inspection/cancel/cleanup require their original-run ownership permissions; they may retire an original child after parent replacement/revocation without authorizing another launch. |
| POST `launch-material` | Check exact attempt/revision/spec hash, prepare one original-run scoped credential and protected provision/profile material. Return only to the private manager. Repeated/lost material handoff must not mint a replacement attempt. |
| POST `effect-intent` | Atomically CAS `prepared -> create_intent` or `created -> start_intent`, committing BEFORE Docker. Reject cancellation, revocation, wrong revision or a second effect owner. |
| POST `created` | Persist exact original daemon/container identity before start; acknowledge the canonical updated record. |
| POST `started` / `unknown` | Record the original effect result; never reset unknown to prepared, replace container, or overwrite a newer cancellation intent. |
| POST `retired` | Validate exact original-owner wait/reinspection proof against immutable original run/daemon/container/attempt/spec. This is process settlement, not model success. |
| POST `removed` | Record exact post-consumption removal without clearing original identity or treating absence as settlement. |

Core alone opens/migrates/writes its existing database. Every endpoint uses bounded DTO validation, existing actor/grant/organization/project policies and synchronous transactions that finish before HTTP/Docker work. `revision` and immutable attempt/spec are CAS fences. The manager contains no local DB, scheduler, execution ledger or ownership cache.

The per-container credential must have a new explicit **job-run audience**, bound to original run/attempt/runtime/org/project/workspace/hash/epoch and the existing approved capability set. It must not inherit the parent's broad runtime credential, create a global owner session, bypass external-message permission, authorize another run, or reach arbitrary manager/Core endpoints. Use the existing credential issuer/revocation owner; keep only its credential reference/hash in the ledger. Plaintext is handed once through the original stdin capability handoff, held only by the current launch call and runtime-private capability file, and never copied into Docker labels/environment/logs/ledger or a proposal receipt. Missing audience/profile/broker support is unavailable, not a permissive fallback.

The child uses `/api/v1/runtime/job-runs/:runId/assignment` and `/result` through that exact run-scoped credential. Assignment is canonical original identity, prompt/hash, protected agent/profile and current grant facts. The fixed child independently matches run/attempt and runtime workspace/owner facts, then invokes the original protected agent binary with fixed argv/cwd and a narrow environment. It reuses `JobResponseVerification`, redacts raw output, and reports a bounded original-run result through Core. Core must apply the existing verified-response/result authority; a caller boolean, zero exit or Docker wait code must not become success by itself. No Context conversation, canonical message, second transcript or raw output archive is created.

## Uncertain effects and retirement

Core `create_intent` precedes Docker create. The original container receipt is persisted before Docker start. Current authorization and exact parent/daemon/image/workspace/epoch are checked again before start and credential handoff. Credentials are distinct per original run. A create timeout, Docker error, lost creation persistence acknowledgement, ambiguous start or handoff failure retains original intent/identity and returns unknown. There is **no** automatic recreation, adoption, replacement, replay, guessed PID or control-plane fallback. Missing original container or daemon replacement is unknown. A named orphan after an ambiguous create requires explicit exact-owner reconciliation; it must not be auto-started.

Cancellation intent is durable before the private manager stop request. Stop targets only the recorded original job-container ID with a bounded grace period. It does not signal the parent's shared process group. Settlement requires an awaited positive `wait?condition=not-running` on the original daemon plus fresh exact original-container identity and nonrunning exit-code reinspection. A missing container, leader close, engine idle, exec PID, diagnostic or optimistic DB cancelled/terminal status cannot prove descendant retirement. A running original container remains active; failed joins remain unknown/cancel_requested.

Controller restart without an exact persisted receipt stays unknown. Restart with an exact immutable receipt still performs a fresh original-daemon owner join and current ownership checks. No cached terminal receipt authorizes current execution or process settlement. This design relies on qualified whole-container retirement from the original Docker owner; Root must test the actual platform, including surviving descendants and daemon/restart/error behavior, before accepting it.

Once Core has consumed the bounded result and retirement into the original operation/history, `cleanup(runId)` requires `outcomeConsumed`, fresh original retirement proof, current ownership and exact nonrunning container. It deletes **only** that original container with `v=false`, then asks Core to record removal. It never removes/prunes volumes, the bind-mounted source workspace, image, parent runtime, models or logs from another owner. Missing/foreign/unconfirmed targets remain exact retained exceptions. Inspection after intentional removal remains unknown; completed historical operations do not need a new current-settlement inference.

## Async Core/Dot boundary

The proposed `AsyncCoreDotExecution` carries real awaited manager cancellation/inspection. `cancelAsync` commits intent first; every await is outside SQLite. After a remote observation, it rechecks authorization and re-reads operation/run identity and CAS revision, preserving a concurrent cancellation or completed operation. Synchronous recovery rejects when async execution is configured.

The existing singleton scheduler awaits `recoverOperationsAsync`, keeps its original generation/trackTask/next-tick path, and adds no timer. The request-session exposes an awaited cancellation callback; the existing router awaits it. Launch still runs after the existing original claim/Dot operation commit. The managed async adapter never calls `startJobRun`, and container settlement alone cannot finish a still-running/unverified Core run. Root must inject the durable original automation identity into scheduler composition and fresh authenticated request authority into HTTP composition; an expiring HTTP closure must not become a background principal.

## Source qualification and remaining integration

Regenerate source tests with the existing Node binary. `managed-job-async.cpu.mjs` reads exact preimages without changing them; set `VEYRA_DOT_PROPOSAL_SOURCE_ROOT` to Root's original checkout if the worker snapshot differs. Run before applying patches. The other fixtures import only the proposal modules and fake every Core/Docker/spawn/verifier effect.

```sh
VEYRA_DOT_PROPOSAL_SOURCE_ROOT=/home/brajam/.local/state/ingenium-release/skill-zen-fix-1792810845/real-gmail-ui/prd-ui-fixes \
/home/brajam/.local/bin/node --test docs/workstreams/dot/managed-job-owner.cpu.mjs docs/workstreams/dot/managed-job-async.cpu.mjs docs/workstreams/dot/managed-job-child.cpu.mjs docs/workstreams/dot/managed-dot-execution.cpu.mjs
```

Root reserved migration 126 and still owns its installation, journal endpoints and current grant/profile/resource/credential/result implementation; exact new module declaration/types and package inclusion; private route composition; immutable job-capable image qualification/build; integrated compiler/router/scheduler tests; and actual selected-container/process/descendant/restart/workflow/permission acceptance. Source tests and parse/applicability checks cannot close those gates. No actual Docker/model/platform launch is authorized or performed by this worker.

## Storage and cleanup receipt

Owner: `01a18935-103f-7432-98b0-cd2c51f8c8ab`. Source/tests/patches/manifests stay in the existing C-backed WSL task root `/home/brajam/.local/state/ingenium-release/skill-zen-fix-1792810845`, in this worker's `docs/workstreams/dot`. No new output root, dependency/build/cache/temp/log tree, Docker object, process fixture or credential file was created. These minimal durable sources remain for Root review/integration; completion of that consumer or superseding version-control source is their end condition. No disposable outputs, removed paths or recovered bytes exist. Protected source/locks, original central fixtures, user runtime/vault data, models, services and tuning are untouched.

Final worker source evidence: 36/36 fixtures passed (17 container owner, 8 async Dot, 3 fixed child, 3 Core execution adapter, 5 unavailable-fallback policy), zero skips. Both full patch applicability checks and eight manager-bundle parse/shell-syntax checks passed; strict typing and live acceptance remain open.
