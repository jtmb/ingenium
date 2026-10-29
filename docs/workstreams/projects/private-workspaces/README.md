# True private projectless execution proposal

This is the bounded source proposal requested by the coordinator after inspection found no existing non-project native owner. It is **unapplied and uncompiled**. The route is intentionally unmounted. It does not turn current native projectless controls on.

## Current evidence and boundary

Native TaskWorkspace/TaskWorkspaceBinding and ConPTY TerminalOwner require a Project. Scratch persists a real Project through the catalog. Reusing either as a hidden/null/global project would misrepresent ownership; this proposal does not do that.

The proposed changes add private working-area records to the **existing workspace.db ProjectStore connection and single writer**. They do not create an account/project catalog, engine session, transcript store or terminal manager. Existing project execution DTOs/routes and project rows remain unchanged.

The tracked goal tool still reports blocked from the preceding review wait. The coordinator explicitly acknowledged that bookkeeping limitation and reauthorized this source work. No claim of runtime acceptance or completed full goal is made.

## Exact artifact

- native-private-workspaces.patch: seven-file shared-native patch against native baseline 61c99f8e649da85b600fccec93236b5d6b07f78b.
- proposal.json: exact base/proposed file hashes, patch hash and application/build status.
- 0006.sql: the same additive SQL included in the patch, used as the source fixture.
- services/ingenium-api/lib/projects-v2/private-workspace-policy.mjs: executable, dependency-free policy model of the proposed ports. It owns no database connection, filesystem root, process or transcript.
- services/ingenium-api/tests/veyra-projects-private-workspace.test.mjs: SQLite-backed source/model and migration fixtures.

The native patch adds contract declarations; a private metadata module on ProjectStore; its v5-to-v6 migration/validation hooks; and a private-workspace router factory. Only a module declaration is added to routes.rs. **No production mount or default authority/executor is installed.** Native schema version 6 is a proposal against the recorded v5 baseline; the coordinator must confirm that version remains unallocated before applying, never silently overwrite/reallocate another migration.

Windows Git apply --check passed without editing the native checkout. This does not prove Rust compilation, live database migration, native capture, ConPTY, engine execution or projectless UI acceptance.

## Required existing-owner ports

The coordinator approved the direction: existing authenticated native service/session boundary, opaque actor/authority-derived ownership, existing workspace.db writer and a nonserializable custody lease. The following ports are explicit prerequisites, not fake working implementations:

1. **ActorAuthority.resolve(headers, action, workspaceId)** must use the actual authenticated native/local/paired session and current grant/revocation epoch. It returns a non-Deserialize VerifiedActor. It must not trust body fields, unsigned actor headers, a default global project or the requested directory.
2. Derive owner_key from stable native library/installation identity plus existing principal issuer/subject and organization scope. Do not use the ephemeral service instance or grant ID as persistent ownership; rotation/restart must not orphan the user's data. Grant/current epoch stays an admission check, not an account store or ownership rewrite. If the existing boundary cannot prove an actor, keep the route unavailable.
3. **ExecutionOwner.prepare_once** must allocate only the private service-owned working-area location chosen by the real native root owner. No arbitrary path is accepted in the create request. Canonical identity, ancestor/reparse/ownership checks and partial-failure custody belong to that existing owner. A durable intent precedes filesystem effects; an unknown allocation is retained and not replayed.
4. **ExecutionOwner.acquire_existing** must open/hold the exact recorded root identity without creating/recreating a missing directory or falling back to another environment. CapturedPrivateWorkspace is not Serialize/Deserialize or Clone, and no path string/database row can construct it.
5. **ExecutionOwner.execute_once** must use the existing supervisor/admitted-request/process or engine owner. It consumes that same custody and calls the supplied final check immediately at actual effect admission under the existing policy/retirement/revocation serialization. Preserve approvals, sandbox/access profiles, process descendants, drain/cancellation, uncertain ownership and exact originals. Do not launch a new parallel process manager or construct a Project to satisfy old signatures.
6. **AgentTurn** carries existing conversation/original-turn references, not another transcript or prompt store. The actual agent/session owner must prove the same private execution scope before use. Do not claim agent-turn support if that bridge is unavailable; supports_operation must return false. The inference engine and model/default lifecycle remain unchanged.

The coordinator must implement/qualify these ports using the actual existing owners before mounting the factory. In particular, the current project-only TaskWorkspace and TerminalOwner APIs are **not** already a valid implementation. WSL/private and cluster/private execution require their own qualified owners; the native schema does not imply those environments work.

## Contracts and route composition

New private create requests contain requestId, workspaceId, explicit environment, serviceInstanceId and authorityEpoch. They contain no owner, directory, setup script or project. Execution requests require projectId:null, the private workspace/revision, current service instance/epoch, a retained request UUID and a typed operation. Unknown fields and non-null project IDs are rejected.

Supported operation shapes are terminal_open, terminal_input, terminal_resize, terminal_close and agent_turn. These are intent DTOs; supports_operation remains false until the selected existing owner qualifies the real operation. Metadata readiness alone never means permission or execution availability.

After the real ports are supplied, the coordinator may construct:

```rust
let boundary = Arc::new(private_workspaces::Boundary {
    state: state.clone(),
    authority: existing_verified_private_actor_adapter,
    execution: existing_private_custody_and_execution_owner,
});
router = router.nest(
    "/v1/private-workspaces",
    private_workspaces::router(boundary),
);
```

The two adapter names above are required implementation ports, not claims that such exports already exist. Use existing outer native authentication and admission middleware. Do not mount a permissive implementation for testing a production route.

| Route under /v1/private-workspaces | Behavior |
| --- | --- |
| POST / | Reserve exact creation, obtain real custody, recheck actor/epoch and persist observed root metadata |
| GET /{id} | Authorized reconnect metadata only; no filesystem allocation or process work |
| POST /{id}/operations | Validate null project and binding, persist exact hash before effects, reacquire custody and recheck state/actor at effect admission |
| GET /{id}/operations/{request_id} | Observe the retained original; never reacquire a root, execute or resend input |

Creation/operation repeats with the same original return their retained state. Changed body/hash conflicts. A stale service/epoch/revision, different actor, changed physical root or unsupported owner fails closed. Reconnect returns the same workspace identity with the current service instance/epoch; it does not turn an old original into a new request. Existing unknown outcomes remain unknown if the effect owner cannot prove them.

Cancellation/close of already-owned work must remain reachable through the existing effect owner even when new admission is disabled. No cleanup/purge or automatic directory deletion is added.

## Lossless native migration and rollback

The proposed v6 migration creates only private_workspaces, private_workspace_operations and their owner index. Existing projects, creation originals, sidebar/read markers, task display names and configuration-transfer rows are neither rewritten nor converted. No old projects or chats become private areas by inference. Account credentials, installation settings and engine session/message data are not copied.

Open/migration hooks reject a partial preexisting private schema rather than adopting it. Both tables have owner-bound operation FKs; root activation follows actual capture; operation bodies and prompts are not stored, only hashes/kinds and existing-owner result references. Schema validation checks the exact declared DDL and dangling ownership references. The existing transaction owns v5-to-v6 commit.

Qualify on a copy before any native binary starts against live data. Record original v5 file/table hashes, row identities, backup/restore and policy-rejected/unique evidence. An older v5 binary must refuse v6 rather than changing its version. Rollback uses the preserved pre-upgrade copy under the coordinator's single-writer/disruption rules; do not drop private tables or overwrite a running database. New private user files/intents must remain retained during rollback/reconciliation.

## Actual source proof

Thirteen private-workspace tests pass using in-memory SQLite and the real v1–v5 SQL source plus the proposed v6 SQL:

- Every original table/row hash is unchanged, no hidden Project is inserted and foreign-key violations are zero.
- Other actors and forged owner/path/project fields are denied.
- Unknown creation/execution is not repeated; changed bodies conflict.
- Reconnect/restart observations preserve identity and original outcomes without allocation or input replay.
- Stale service/epoch/revision, serialized-path custody, changed identity and revocation deny dispatch.
- Unsupported/missing execution authority fails closed.
- Failed migration rolls back atomically to unchanged v5.
- Concurrent create reserves one original/one allocation.
- Final admission guard rejects retirement before an effect.
- Ownership does not imply permission to send terminal input.
- Patch/SQL hashes match, no new-file implementation constructs a Project and no production mount is added.

These tests exercise the executable policy model and real SQLite schema constraints. They do **not** execute the Rust patch or real native ports. The patch includes two pure in-memory Rust store tests and one strict DTO test for coordinator execution under an existing resource lease. No native build/runtime was started by this worker.

Run the source fixture with the already available Node runtime and process-scoped TEMP/TMP/TMPDIR in coordination/projects:

```sh
node --experimental-sqlite --test services/ingenium-api/tests/veyra-projects-private-workspace.test.mjs
```

Required follow-through: coordinator reviews/applies the shared patch, regenerates DTOs, runs focused Rust compilation/tests and database-copy rollback checks, implements the actual authenticated/custody/execution ports, and performs attended real private projectless workflows. Preserve the original full goal and all existing project/WSL/cluster gates.
