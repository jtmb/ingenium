# Portable hosted governance for Native Customize

This delivery implements the hosted governance UI and closed typed client. Root must supply an **existing authenticated original transport**. It does not add a URL selector, token input, new authentication authority, independent resource store, broad HTTP proxy or default project mapping.

## Integration

Canonical sources are packages/veyra-customize/hosted-governance/. The manifest maps each file to apps/web/src/features/customize/hosted-governance/ with canonical bytes and SHA-256. portable-source.patch adds those files. native-composition.patch changes only NativeCustomize imports, optional props and slot composition: 8 added lines, 1 removed line against tree a04ab38bd0e0c7b96f40689733cad3f2332b9a0b. Apply neither patch when its preconditions differ; preserve current source and reconcile explicitly.

Root passes hostedGovernanceTransport={actualOriginalTransport} and optionally onOpenHostedSkillInSession={existingComposerOwner} to NativeCustomize. The preexisting hostedGovernance content override remains supported. The adapter derives slot metadata from the supplied binding and passes content through the existing owner gate. Native file skills and hosted database skills retain their actual identities and semantics.

Peers are existing React, react-markdown 10 and remark-gfm 4. No dependency tree, manifest, lockfile or build is included. Markdown skips HTML and renders outbound links/media as text. Styles use Native tokens and are contained under .hg. Root owns authenticated composition, current Native types and renderer qualification.

## Original transport contract

contracts.ts defines BoundGovernanceTransport. Root creates it from an actual paired/authenticated original. Its explicit public binding contains library, authority, connection, grant/revision, native and hosted service instances, epoch, actor, installation, native project ID/revision (both null for explicit projectless native), actual hosted project ID/API namespace and project/system visibility. A real hosted project owner remains mandatory; that API cannot accept a null project.

- current() fences the reader epoch; it does not replace current server authorization.
- read(command,binding) revalidates principal, pairing/grant, installation, project membership and requested operation, returning the same validated binding and original API value.
- reserve(command,binding) durably retains the exact immutable public original before any effect. Atomically reject a second unresolved operation for this owner. Keep credentials, full saved Project/environment, CSRF/session context and original lock tokens private.
- send(original) dispatches this original once through its actual owner. Validate reviewed IDs/revisions/proposal state and required locks in the existing mutation transaction. Renderer metadata or a pre-read is not server CAS.
- inspect(original) is read-only original-ledger recovery. Never resend an old HTTP mutation. Succeeded/refused require proof from the original owner; otherwise retain unknown.
- pending(binding) returns unresolved same-resource originals across refreshes. Do not discard originals due to a missing row, timeout, remount or absent HTTP status.

Reader refresh may inspect an unchanged original under current validated permission for the same library/services/authority/connection/actor/installation/logical native and hosted project/visibility. The original retains its old epoch, grant revision, project revision, namespace and payload. Foreign resources cannot be looked up or deleted. Root's durable atomic pending guard remains required across remounts/windows/crashes; the client's extra barrier is transient.

client.ts descriptor supplies only a closed legacy HTTP mapping, without origin or headers. reviewedAbsent, target IDs/revisions, original file path and reviewed proposal revisions remain original metadata, never invented legacy body keys. Public originals have exactly id/binding/command fields and reject accidental credential/header fields.

## Concrete existing pairing recipe and boundary

The manifest lists exact read-only Native baseline blobs.

1. Existing local owner GET /v1/remote-control/connections/:id/identity supplies actual connection/service identity, authority/grant and scope. Root retains the full saved Project/environment and existing grant-validation/integrity flow in RemoteConnectionWorkspace, remoteWorkspaceRead and remoteWorkspaceDiscovery.
2. Existing paired POST /v1/remote-control/connections/:id/request uses service_instance, operation_id, method, path, body and expected_project where required. Existing service-owned endpoint, TLS policy and credentials stay there.
3. Desktop gateway and remote proxy currently permit bounded /v1/ GET/POST. They **do not** relay hosted /api/v1/ or PATCH. Root must register one closed governance operation domain through the existing authority with narrowly scoped gateway routes and response integrity. Do not widen the generic proxy or accept renderer URL/token/headers.
4. Root establishes actual actor/installation/native-to-hosted project mapping and current hosted auth capability. Service-token rights cannot impersonate a signed-in user or model-runtime owner.

These sources provide no executable hosted origin. The slot remains unavailable until Root supplies the concrete authenticated original. No discovery/guessed-origin request is made.

## Actual hosted owner semantics

- Full /api/v1/customize metadata preserves disabled installed entries and actual IDs/revisions. Active-only listSkills stays unchanged. Scope/envelope/duplicate IDs/pagination mismatches fail visibly.
- Skill GET/PATCH/archive/restore/enable/disable owners remain authoritative. PATCH does not itself enforce expected-revision CAS or request_id. Root must enforce reviewed intent atomically before claiming conflict protection.
- POST /skills is an **UPSERT**, including archived records. The UI rejects known existing/archived names for new upload and retains reviewedAbsent:true. Root still needs atomic absence validation; concurrent names must not overwrite/unarchive another record.
- The C4 runtime is byte-identical to helper-provenance.json. Exact Markdown/reference neighbors, tags, always_apply, first failure and receipts survive uncertainty/readback. Confirmed owner writes with malformed response remain confirmed with failed refresh, never replayed as a fresh upload.
- Proposals retain actual IDs/status/target/source project/revisions/evidence/observations. Enriched detail is default; Basic details is an explicit bounded request, never an automatic permission-denial fallback. Merge apply/rollback requires source context and owner capability.
- Root reported source-auth/dual-lock fixes in commit 252bc93d: source permission before enrichment/read, source-read lineage checks, source-admin mutation authorization and source maintenance lock for merge approve/rollback. Root reported real auth/CSRF/HTTP 15/15 and API types passing; these are coordinator-reported, not worker-run. Different-project source lock uses original x-ingenium-source-lock-token privately in Root; same-project uses target lock. Refuse until required originals/locks are retained. Never add lock tokens to renderer commands.
- Explicit-model synthesis requires the actual signed-in user session and same-user ready runtime. Existing server-owned selection does not change defaults. Started is only a trigger: actual batch, grounded proposals, approval, persisted activation and fresh-conversation use remain acceptance gates.
- Open in session calls only the supplied composer owner with actual skill/binding. Without it the UI states unavailable; it never injects copied instruction bodies.

## Verification

Run with existing Node 22, no installs:

    node --test packages/veyra-customize/hosted-governance/governance.node.mjs
    node docs/workstreams/customize/native-governance/check-source.mjs --typescript /absolute/existing/typescript/lib/typescript.js

Actual: **30/30 protocol tests**, zero skipped; **9 top-level source/declaration syntax checks**; **5 pure modules strict/noUnused noEmit**, zero diagnostics/emitted files. An additional 8 portable React/source modules pass strict/noUnused noEmit using existing Native peers read-only, zero diagnostics/emissions (not the full Native App type check). Both patches passed read-only git apply --check against the unchanged Native working tree. Covers closed descriptors, projectless mapping, owner/revocation fences, reserve-before-send, stale reservation, forged receipts, unknown non-replay, cross-reader unchanged recovery, foreign refusal, disabled metadata, DTO scope/pagination, C4 payload retention, proposal/model metadata and trigger distinction.

HostedGovernance.test.tsx supplies **11 renderer cases, not run here**: unavailable transport, disabled metadata, refused exact draft, unknown upload/inspection, same-name upsert refusal, confirmed malformed create, explicit grounded approval, synthesis trigger, tab persistence/owner rebind, stale reserved dispatch and late actor rows. Root must run these with its existing Native runner. Full React types, authenticated original integration, real persistence/workflows, screenshots/themes/keyboard/scaling, Windows artifact and cluster execution remain Root gates. Pure tests do not establish runtime or visual acceptance.

## Storage and cleanup

Owner: Customize worker 01a18935-0723-7cc0-9ea1-5e70f5627cc5. One inherited authorized root /home/brajam/.local/state/ingenium-release/skill-zen-fix-1792810845 on C-backed Ubuntu VHDX; no new root/drive. Retain only canonical source, minimal patches, manifest, recipe and verification receipt for Root integration/review. No build, dependency install/copy, service, browser/desktop session, model call or disposable compiler/cache/temp tree was created.

Regenerate via prepare-delivery.mjs with explicit existing --native source directory, --git-root Windows Git UNC path and --git-executable. It reads immutable Native blobs and current prerequisites, normalizes only owned portable source and writes this delivery directory. It refuses existing targets. Root must run read-only git apply --check before application. Preserve source/lockfiles, unique evidence and Root-owned shared test caches. Disposable removed paths: none; bytes 0; no Linux/Windows recovery claimed.
