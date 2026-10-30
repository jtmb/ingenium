# Native to hosted governance — source proposals

This is concrete source for Root review and integration, not an installed transport or completed Phase4. It extends the existing Native saved-connection, paired grant, access-profile, account-vault and utility-original owners. All shared Native/API sources and indexes remain untouched.

## Delivery and exact prerequisites

The manifest maps canonical files to Native or APP targets, with hashes and absence preconditions. Native-owner-proposal adds the Rust/web source and makes eight small existing-owner edits. Node-proof-proposal adds the private paired TLS reader, proof validator and synchronous Core context verifier. Portable-compat updates the accepted063 adapter for frozen current-row CAS and submit. No root manifest, dependency or lockfile changes.

Apply the previously accepted063 portable-source delivery before portable-compat. Its five Native targets are currently absent, so a standalone compatibility git apply --check fails that precondition. Preserve this failure; it is an application-order gate, not permission to create or overwrite a different source. Native-owner-proposal and Node-proof-proposal passed their own read-only patch checks. Recheck all manifest preimages on the coordinator's current source before applying.

Canonical proposals are under files/. Regeneration: run prepare-delivery.mjs from this directory using the existing Node runtime. It reads actual current Native preimages and the accepted portable sources, writes only this delivery directory and refuses existing add-only targets. It never applies, stages or alters integration sources. Existing-root source is the sole storage owner; no new output root or dependency tree.

## Concrete implementation

- Web connectHostedGovernance uses only the existing authenticated Gateway.workbench and six closed local POST routes beneath /v1/remote-control/connections/:id/hosted-governance. It supplies the complete actual saved Project for context, captures the current selection, validates the server-created binding, fences before/after every await and supports unchanged original inspection across a reader refresh. No URL, token, cookie or fetch API is accepted.
- Local service routes validate current utility library ID, service instance, saved connection, complete Project/environment and fresh Node enrollment before reads or reservations. Existing RemoteControl worker custody retains work when its HTTP waiter closes. It acquires shared serial BEFORE remote commands, matching existing account/profile lock order. The actual remote-control prefix has no agent_admission layer: do not add that layer around this router and cause a second serial acquisition.
- The existing utility originals database keeps the whole public original plus private credential-free connection/enrollment provenance. A companion hosted_dispatch row adds atomic pending-owner reservation and persisted once-only claim; it is not another domain store. The original is committed before effects. Unknown stays pending after timeouts, malformed replies, lost waiters and restarts. Duplicate sends inspect only.
- Inspect can atomically close an unstarted original with proven Native non-dispatch. It races the same database CAS as send, so both cannot win. This proof must be composed with the Node per-original verifier: Node effects must require actual Native UUID/hash/dispatch-claim proof. Remote receipt absence alone never proves non-effect.
- Source wire uses exactly frozen /api/v1/native-customize identity/enrollment/read/effects/operations routes. It sends typed commands, never legacy API paths or PATCH. Core operationId and SHA256 of the canonical WHOLE original must match before a terminal receipt is joined. Core valueRef stays metadata; actual skill/proposal body readback remains separately authorized. Six general Core canonical/hash vectors plus two byte-identical official34351 whole-original vectors are supplied for Native Rust tests, including a typed serde roundtrip. The comparator explicitly sorts encode_utf16 code units and never normalizes strings.
- Private AccountVault code uses actual existing /auth/csrf, /auth/login, /auth/mfa/challenge and /auth/session. Cookie/pre-auth CSRF handling matches the existing server; Origin is the explicitly trusted private dashboard origin. Email/password/MFA come through the existing credential-file owner, never renderer fields. Session/CSRF/challenge state is retained in the existing service-user DPAPI vault; login/MFA attempts are consumed before network requests. The existing credential-file handle/reparse/zeroing checks are extracted for reuse by MFA. A lost response does not replay login.
- NodeHosted account credentials are explicitly excluded from MCP account selection, protected overlay creation and resolution, so browser session material cannot become connector environment/header data.
- Local managed AccessProfiles policy is required for hosted reads/writes; there is no legacy unmanaged-policy fallback. Node grant metadata is adapted only after actual authenticated enrollment to the local policy API. This creates no Native bearer grant and is never accepted by the Native generic proxy.
- Manual synthesis remains unavailable in this frozen Core effect adapter. A real signed-in session is necessary but does not itself qualify an owned ready runtime. Preserve actual synthesis/batch, grounded proposal, approval, enabled persistence and fresh-session use in the full goal. Do not use service credentials or an ad hoc background executor.

## Actual enrollment boundary and explicit ceremony

Existing Native /remote/v1/pair and /identity authenticate a real paired token and current grant/profile/full saved Projects. Original Native grants have no hosted-user custodian. Existing Node auth proves a browser user but has no current outbound paired-Native credential custody. Matching service/host/library metadata cannot bridge those authorities.

This proposal extends the EXISTING private Pairing -> Grant record with a NodeHosted custodian: the actual Node session actor and installation obtained by Native's pinned private /native-customize/identity read, the full current Native owner, and the retained enrollment request ID. The existing one-use pair redemption and AccessProfiles activation carry this custodian into the real Native token grant. Projectless enrollment uses an explicit hosted_enrollment-only library attestation scope; it gains no Native project/file/task access.

New closed paired TLS reads authenticate through the existing remote authentication/profile owner and compare the private custodian before returning current context. The original proof additionally requires the exact retained Native operation UUID, whole-original payload hash and durable dispatch claim. They expose no credentials or draft bodies. Node's private HTTPS reader validates the original certificate chain, hostname and exact certificate pin before sending the actual paired Native bearer; no proxy, redirect or retry exists.

Root MUST complete the missing private custody ceremony: actually redeem that original Native pairing under the same signed-in Node actor, retain its real private credential through the existing encrypted-auth/account connection owner, and supply that original to the private reader. PreparedPairing cannot be serialized to the renderer. There is intentionally no guessed executable pairing endpoint, default service token, metadata-to-VerifiedNative factory or invented encrypted credential record. The concrete missing API is this actor-bound private Node paired-client enrollment/custody owner; it is not supplied by Worker5's grant/effect tables. Root owns its exact endpoint/schema/auth integration.

The Node verifier preflights an actual paired TLS context/original read, then supplies a request-bound fresh frame to Worker5's synchronous enrollment/current callbacks. Install preflight per MATCHED route (after params are populated), after actual session authentication and before Core context construction. Identity itself must remain available for the private sign-in/enrollment preparation. Frame freshness is invalidation metadata, not an authentication grant. Actual auth/CSRF/current project policy is still rechecked by the frozen Core owner.

## Required lifecycle and writer hooks

The Native serial guard is held across its outbound Node operation. A lost HTTP response or process exit can outlive that guard while Core's original remains unknown. Persistent custody queries therefore MUST be wired into the actual Native mutation owners before writable integration:

1. hosted_project_has_custody(Some(projectID)) blocks update/archive/relocation/revision changes of that actual Project while an unresolved original owns it. None specifically checks projectless ownership.
2. hosted_resource_has_custody checks actual hosted grant/connection/enrollment request IDs. Use the stored Native custodian enrollment ID when guarding its paired grant/profile changes or forgetting a connection.
3. hosted_library_has_custody guards library replacement/full-restore/writer transfer. Preserve the original journal during restore; do not silently retire or adopt old-service originals.

A failed custody check refuses the proposed mutation; it does not stop a workload or discard an original. Root owns the actual shared Project/profile/recovery hooks, cancellation/shutdown ordering and cross-host race review. This source does not claim distributed atomicity from a short-lived proof or pre-read. Mapping changes and old-instance recovery remain explicit supervised owner operations.

## Frozen current-row review

Portable compatibility preserves expectedRevision/expectedSourceRevision as proposal baselines and requires the actual reviewed.proposalHash and reviewed.currentTarget/currentSource from the permission-checked enriched DTO, including real source UUID. Decoder checks current snapshots against those actual returned rows; Basic details remains readable but cannot enable review actions. Missing required source/target comparison disables mutations. Submit is additive and draft-only; approve/reject are pending-only; rollback is applied-only. Node owns persisted reviewer identity and current permission, CAS and dual maintenance-lock checks.

Private target/source tokens remain only in AccountVault-owned session transport. The frozen Node endpoint verifies the actual target/source locks transactionally. They are not original fields, body metadata or payload-hash input.

## Validation and open gates

Actual source checks: 20/20 transport/proof/exact-SQL tests; 10/10 frozen-review/Core canonical tests; nine portable React/web modules with five in-memory compatibility overrides pass strict/noUnused noEmit, zero files emitted. SQL tests execute the actual Rust SQL constants in memory, not the Rust wrappers. Proof fixtures are synthetic and perform no network requests.

Three private Node modules pass strict/noUnused noEmit against final frozen Worker5 commit34351ff2d3c7795709925b48fec81246432908ea and its exact context interface, zero diagnostics/emissions. The initial three external engine narrowing diagnostics are resolved in that final commit. This is a source/interface check; full API integration types remain a Root gate.

Rust compilation/tests, actual TLS/auth/CSRF/custody enrollment, full API/Native type checks, composed UI11, shutdown/restore/source revocation/dual locks/projection failure and real persistence/visual acceptance are pending Root integration. No live credential, account login, host/network, service, build, model, desktop session or deployment was executed. Passing source tests do not close those gates.

Commands (existing Node only, no installs):

    node --test docs/workstreams/customize/native-hosted-transport/transport.node.mjs
    node --test docs/workstreams/customize/native-hosted-transport/compatibility.node.mjs
    node docs/workstreams/customize/native-hosted-transport/check-source.mjs
    node docs/workstreams/customize/native-hosted-transport/check-api-source.mjs

The checks use existing tooling and in-memory contracts only; do not substitute a fake runtime authentication owner.

## Reconciliation

Owner: existing Customize chat 01a18935-0723-7cc0-9ea1-5e70f5627cc5. Exact inherited root /home/brajam/.local/state/ingenium-release/skill-zen-fix-1792810845 on the C-backed Ubuntu VHDX. Initial new-source allowance750,000 bytes; inventory is in status/manifest. Source/patch/recipe/tests and unique verification receipts are durable integration inputs, retained until Root review and focused integration acceptance. No disposable dependencies, compiler output, cache, database file, scratch tree or outside-root output was created. Removed paths none, bytes0; no Linux/Windows disk recovery claimed. Shared test caches, Native indexes, credentials, models/runtime and prior protected source/evidence remain under their existing owners.
