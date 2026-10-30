# Native hosted governance v1 — frozen source proposal

Status: canonical source proposal only. Root owns actual endpoint installation, SQL125 application, Native connection/session mapping and security review. No public host, pairing URL, service token or writable Rust migration is introduced.

## Relative typed paths

All paths are below `/api/v1/native-customize`, authenticated by the existing actual browser-user session. Existing login/MFA/CSRF/cookie/origin routes stay unchanged. Native keeps session/CSRF/maintenance tokens in the existing private account owner; renderer/public originals contain none of them.

| Method/path | Closed input | Response |
| --- | --- | --- |
| GET /identity | none | `{data:{actorId,session_actor_id,installationId,hostedServiceInstanceId,authorityId}}` from actual session and existing persisted installation instance |
| POST /enrollments | `{enrollmentRequestId,hostedProjectId,visibility:"project"|"system"}` | `{data:{binding,capabilities,capabilityRevision,session_actor_id}}` |
| GET /enrollments/:grantId | grant selector only | same current server-owned binding/capability envelope |
| POST /read | `{grantId,command:ReadCommand}` | `{data:{binding,value,session_actor_id}}` |
| POST /effects | `{original:{id,binding,command:WriteCommand}}` | `{data:{operationId,payloadHash,outcome,valueRef?,error?}}` |
| GET /operations/:operationId?grantId=... | original operation/grant selector | same receipt; missing/executing is `outcome:"unknown"`, never replay authorization |
| GET /operations?grantId=...&after=...&limit=... | 1–100 (default25), cursor last original ID | `{data:{data:[receipt],pagination:{nextCursor,hasMore}}}`; executing/unknown only |

The binding matches the current portable Binding field set exactly. Node mints connectionId/grantId/grantRevision and a mapping epoch. Installation/hosted-service identity comes from existing `veyra_installation_identity.instance_id`; authorityId is its versioned server-owned governance namespace. No hostname/PID/URL creates identity. Actual capability revision is a hash of current permissions and actor security epoch plus mapping revision; binding.epoch incorporates it as reader invalidation metadata. It confers no grant.

Enrollment nativeLibraryId/nativeServiceInstanceId/nativeProjectId/nativeProjectRevision are derived ONLY from Root's verified private Native enrollment context for that enrollmentRequestId, tied to the actual signed-in actor. Renderer fields cannot supply them. If that Root verifier is unavailable or cannot attest the connection/catalog, enrollment fails closed503; no self-asserted mapping, default project, library-only auto-pairing or generic proxy fallback. Explicit hosted project selection is reauthorized in Core. System scope additionally requires existing installation-admin permission and the actual selected project's global designation; no guessed global name.

Grant rows are owned by exact actor, existing installation, Native service/library/project and actual hosted project. Current reads/effects revalidate session and current project permissions. Mapping epoch, grant revision and all reviewed identity/revision fields are checked atomically for effects. Recovery uses the stable original owner (including original grant/connection/native IDs/hosted project), never mutates or adopts a foreign original, and may inspect an old reader epoch only while current owner/project-read authorization still holds. Mapping changes require explicit re-enrollment; no silent selection rewrite. Root retains originals under their old owner where re-enrollment changes connection identity.

## Closed writes and reviewed CAS

Supported commands: create-absent (`op:"create",reviewedAbsent:true`), save, archive, restore, enable, disable; proposal submit/approve/reject/rollback. Portable submit needs the additive contract/descriptor change in this proposal; it uses the same reviewed metadata as other proposal actions. No generic method/URL/body dispatch.

Skill writes require exact reviewed UUID+revision and name. Save preserves exact content/extra/filePath; no newline normalization. Create absence is checked under the same immediate SQLite write transaction as actual insert; the legacy UPSERT cannot overwrite a concurrent creator. Proposal actions bind ID, status, updatedAt, targetSkillId, sourceProjectId/sourceName, expected target/source revisions, opaque server proposalHash, and actual currentTarget/currentSource UUID/revision snapshots. The server-issued proposalHash also binds the actual proposed state/evidence/observation/quality/flag payload even if updatedAt repeats within one timestamp tick. Approval and rollback of a merge require current source read+admin and BOTH private target/source maintenance tokens; a distinct source project must use the distinct source token. Submit/reject require source read; all actions retain target permission as existing route policy dictates. Actual reviewer identity is the authenticated actor, not the command's display label.

Public original = existing `{id,binding,command}` only. Its complete canonical JSON is hashed with SHA256 after strict closed-shape validation. Keys use code-unit lexicographic order; integers are safe integers; strings are preserved; unsupported values/unpaired surrogates are refused. No auth/CSRF/lock material enters that hash or table. The full original remains in Native's existing private intent owner. Core stores the exact payload hash, owner, grant, command kind and durable outcome, not another transcript/draft authority. Native verifies a Core receipt's hash against its retained original before joining it into OperationReceipt. Core receipt reads do not return stored credentials or manufacture an original body.

## Atomic effect and recovery protocol

1. Existing real-session auth/CSRF and server mapping ownership admit a well-formed original. An immediate Core transaction inserts an executing receipt binding operation ID+actor/project+grant+payload hash. The original ID is globally unique within this installation owner. Changed reuse409; cross-actor/project lookups404.
2. Only the caller that inserted that row can execute. The executing admission commits before any effect. An existing executing row returns unknown without invoking effects, including after crash/restart.
3. In another immediate, nonretrying Core transaction, revalidate the actual session, current grants, target/source permissions, mapping epoch/revision, both maintenance locks and all reviewed CAS before calling existing Core domain helpers. Effect rows and terminal succeeded/refused receipt commit together. Nested helper transactions remain savepoints; outer checkpoint is outside the transaction.
4. Expected policy/lock/CAS refusals are durable terminal refused receipts and apply zero domain writes. An unexpected helper/projection/storage/checkpoint failure preserves executing/unknown and the original hash. It is never relabelled refusal or automatically replayed. A committed terminal receipt remains authoritative if a later checkpoint/transport step fails.
5. Read-only recovery only inspects actual original owner/hash and reauthorizes current access. Missing is unknown, not permission to resend. There is no retry-effect/reconcile-by-mutation endpoint. Native's private intent record and Core's actual effect receipt have distinct roles.

Existing filesystem projection helpers can have nontransactional filesystem side effects. This proposal does NOT claim filesystem/SQLite atomicity. A helper/projection exception rolls back DB effects but leaves the admitted original unknown, blocks replay and retains first failure for Root's operator reconciliation. No success is fabricated from an enqueue, readback alone or model acknowledgement.

## Actual synthesis boundary

`synthesis-run` is explicitly unavailable in this bounded effect adapter. Do not map it to a background/service executor. Root must separately wire the current real signed-in user's session and same-owned ready runtime through the existing actual bounded execution adapter, preserving model/default settings, original outcome and cancellation. No new synthesis or inference execution occurs in these proposals/tests.

## Root integration and open gates

Reserved SQL125 contains additive server-owned grant and effect-receipt metadata; it never alters encryption/legacy rows and is not applied by the worker. SQL126 remains reserved for Dot. Exact preimages and minimal transaction-mode/auth-policy/router/export wiring are supplied separately. No existing global API/route/crypto owner is edited here. Root must connect the verified Native enrollment context, integrate/typecheck the proposals, test actual current user/CSRF/source revocation/dual locks and projection failures, then qualify Native workflows. Source fixture tests prove the engine's real SQLite admission/CAS/receipt protocol, not full deployed authentication or filesystem atomicity.

The frozen wire includes session_actor_id outside Binding on identity/context/read responses, always the actual signed-in user ID. Public receipt valueRef is metadata only; Native joins a matching payload hash with its already retained original, then performs authorized readback. Core pending never clears unsent/unknown Native intents that are absent from Core.
