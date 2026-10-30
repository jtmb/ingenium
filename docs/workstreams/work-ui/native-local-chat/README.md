# Native projectless Work proposal

Status: source proposal ready for central integration; full Work goal and all native/runtime/visual gates remain open. No Shared Native file or index was written by this worker.

Immutable inputs:

- Native staged tree `c295428576246dfa2b97f3a30f2045fc5ff1950f`, read with Windows Git blobs rather than mutable source.
- Projects conversation source `8b18318e248c7e1cba953c1e68b47529aac1a276`, `docs/workstreams/projects/native-local-v6/local-route-contract.json`, SHA256 `cdacba40b95131ea9d4a5e7229cb31874d13d12bc2d6f723710df85d670dfe5f`.

## Concrete integration

Copy only `sources/apps/web/src/features/work-ui/local/` into the matching Native directory. This is new modular source, not a source snapshot. Generate the actual Projects LocalEnvironment/LocalWorkspaceOwner/LocalOperationRequest/LocalOperationReceipt exports first; declarations import those types without invented Project/account DTOs.

Root owns the narrow existing-file integration:

1. Reconcile `app-composition.patch` using `composition-inputs.json` and its immutable c295 preimages. The compact zero-context delta requires `--unidiff-zero` only if both exact preimage hashes match; otherwise Root must reconcile these changes against its current integration tree. It replaces only the `workDefault && view === "projects" && codingWorkspace && !catalog.selected` welcome branch with LocalChatEntry and adds the explicit no-project sidebar callback. It owns its NativeWorkPresentation wrapper, so do not nest another wrapper. Keep the genuine Project Workbench branch intact. Supply gateway/current availability plus connectionEpoch as an invalidation token only. Snapshot instance never supplies local identity. LocalChatEntry reads real server environment choices and identity itself; no selected OS prop, browser OS guess, default WSL distro/user, or Project ownership substitution.
2. `NativeWorkNoProjectActions.tsx` must expose a distinct local-chat action only when this entry is wired and its real ownership port is available. The existing explicit scratch-project action stays explicitly named; never route local New chat to scratch Project creation. Retained local flow selection is in LocalChatEntry. Moving from a Project to local view is Root navigation state, not Project creation or clearing an operation original.
3. Context/runtime/conversation initialization performs only automatic bounded GET reads. New local chat durably records an ID only. Start local chat reserves its exact UUID/environment and durable unknown fence before allocation; it retains the draft and creates no session. The automatic runtime read then supplies actual primary agents. First Send reserves the captured session/prompt UUIDs and exact text before session creation/prompt dispatch. No guessed initial agent or automatic engine startup exists. Connection/runtime technical checks stay inside closed details controls; stopped-engine guidance retains the draft and directs the user to Models without loading anything.
4. Root reconciles the App/Workbench owner with actual Memory/Voice ports. LocalChatPanel's optional BoundLocalContent slots require the complete current LocalWorkspaceOwner and exact session_id. Keep each actual Memory/Voice controller original; never adapt Project credentials or fabricate exact-turn Stop. LocalConversation renders real normalized messages and full structured details as escaped text, in server order, with explicit read-only pagination. No raw HTML is executed.
5. Work is the default. Existing NativeWorkPresentation retains its mounted Work subtree/draft on explicit Web toggle and reports Web unavailable until Root has an independently qualified exact-session upstream host. No iframe, external URL, or fake Web transcript is introduced.

## Finite gateway/desktop proposal

Use the Projects finite port implementation and current protection middleware; this worker does not widen it. The transport emits only:

- GET `/v1/local-workspaces/context`.
- GET `/v1/local-workspaces/{UUID}` and `/{UUID}/runtime`.
- GET `/{UUID}/sessions?limit=50[&after={encoded opaque cursor}]`.
- GET `/{UUID}/sessions/{ses_32hex}` and its `/status`.
- GET `/{UUID}/sessions/{ses_32hex}/messages?limit=50[&cursor={encoded opaque cursor}]`.
- GET `/{UUID}/sessions/{ses_32hex}/prompts/{requestUUID}` reads the genuine retained LocalPromptOriginal only, per Memory's db85f38d `local-prompt-lookup-contract.json`. Root owns its protected route/finite gateway mounting.
- GET `/v1/local-workspaces/operations/{UUID}`.
- POST `/v1/local-workspaces/` with only typed request_id/environment.
- POST `/v1/local-workspaces/operations` with only typed request_id/complete owner/operation. This UI uses session_create, agent_turn, session_interrupt, session_select_model, session_select_agent only.

Reject unexpected method/path/query/body shapes and caller-provided principal/URL/header/Project fields. Read cursors are opaque, bounded and encoded; no order query is emitted by the UI. Root should use its already integrated finite gateway/desktop checks rather than a second generic proxy. New route or credential shortcuts are not part of this proposal.

## Retention and recovery

Client storage is a bounded original/draft journal, not transcript authority. Real Web Locks, compare-and-swap, write/readback and SHA256 exact typed originals are required before effects. Storage/coordination failure never falls back to another store. Every dispatched original becomes unknown durably before invocation. Lost acknowledgements, denied/current-custody conflicts, and missing/mismatched receipts retain originals. Check original receipts performs only reads; explicit continuation is a separate user action and never resubmits an unknown original. Restarted service instances keep the original journal read-only rather than rebinding old effects.

Operation committed is not prompt admitted. An immutable committed result with admission uncertain stays locked until the actual LocalPromptOriginal record proves admitted or rejected. The UI verifies the complete canonical original request/owner/hash/session/root and effective text SHA256; it retains that projection separately and never rewrites the immutable operation receipt. Null/absent/mixed/uncertain records preserve the locked draft; no transcript/status/idle inference or replay is used. Current custody may authorize reading an old original, but a changed service instance never receives new execution rights. Generic Stop returns current_conversation, exact_turn_guarantee=false, terminal_observed=false; it does not claim OS or Voice exact-turn retirement. Model selection offers only the actually observed current engine model; loading stays with its original owner. Runtime ready means engine_protocol_only.

The exact additive context projection is Root-authorized: `environments:[{environment:LocalEnvironment,label:string,selection_source:'native_windows_custody'|'recorded_project'}]`, `default_environment:LocalEnvironment|null`. Root emits Windows/default only under cfg(windows), actual windows_sid custody and verify; explicit WSL distro/user candidates derive from active saved ProjectStore environments. A recorded_project candidate is a selector only, never Project adoption or readiness. With no candidates, local chat stays unavailable; with no default, selection is explicit. Existing actual library_id/service_instance_id/custodian.key remain the identity source. No new backend constructor or generated contract is invented by this worker.

## Validation and cleanup receipt

`tests/local-chat.test.mjs`: 21/21 dependency-free Node behavior cases passed. This establishes fixture-level durable admission/recovery, one initial client draft without allocation, safe draft hydration, actual-original uncertainty resolution, environment/context/binding validation and finite routing only. Eleven central React cases are supplied across LocalChatPanel.test.tsx (draft/Web return, unavailable Enter, unknown original lock), LocalChatEntry.test.tsx (real selector, absent candidates, stale connection, explicit-click stopped-engine draft, fresh hero/composer without effects, mounted Web return and remount restoration), and NativeLocalActions.test.tsx (distinct local/scratch start). They were not executed by this worker. Root must apply the composition delta before running the action tests, then run focused web tests/types, App/navigation/Workbench regressions, real unknown-original/custody recovery, actual native/device/browser and screenshot-contract acceptance. Linux remains Docker/Kubernetes; no Linux native PTY gate is invented.

Fresh-view follow-on: `fresh-view-a6.patch` targets only nine new local modules/tests against a6b16475, never Root's current App/shared files. `fresh-view-inputs.json` records exact LF preimages and output hashes; use `--unidiff-zero` only on matching originals, otherwise reconcile. It mirrors Root's Boolean(message.error) fix. Actual context now retains one initial client-only flow under the existing Web Lock, opens the centered Veyra hero and bottom composer, and keeps settings/diagnostics in Composer options. Explicit Start chat allocates; reads never allocate or select an invented agent/model. No visual/browser/runtime acceptance is implied by structural fixtures.

Regenerate the fixture result with the existing task-root Node and process-scoped TEMP/TMP/TMPDIR in coordination/work-ui:

`node --test docs/workstreams/work-ui/native-local-chat/tests/local-chat.test.mjs`

Owner: Work UI chat `01a18934-d937-7813-8c48-5ae85aad4f18`. One existing approved C-backed WSL output root: `/home/brajam/.local/state/ingenium-release/skill-zen-fix-1792810845`. Source growth budget below64MiB; no builds/dependencies/cache/downloads or bulk scratch were produced. Durable retained paths are this proposal's canonical source/tests/README and checksum recipe/manifest, consumed by Root integration; retain until integration review and merge. Existing original research file and all earlier patches/receipts/native indexes/models/data remain protected. Removed paths: none; measured removed bytes:0. No Linux or Windows disk recovery is claimed.
