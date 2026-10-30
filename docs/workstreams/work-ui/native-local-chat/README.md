# Native projectless Work proposal

Status: source proposal ready for central integration; full Work goal and all native/runtime/visual gates remain open. No Shared Native file or index was written by this worker.

Immutable inputs:

- Native staged tree `c295428576246dfa2b97f3a30f2045fc5ff1950f`, read with Windows Git blobs rather than mutable source.
- Projects conversation source `8b18318e248c7e1cba953c1e68b47529aac1a276`, `docs/workstreams/projects/native-local-v6/local-route-contract.json`, SHA256 `cdacba40b95131ea9d4a5e7229cb31874d13d12bc2d6f723710df85d670dfe5f`.

## Concrete integration

Copy only `sources/apps/web/src/features/work-ui/local/` into the matching Native directory. This is new modular source, not a source snapshot. Generate the actual Projects LocalEnvironment/LocalWorkspaceOwner/LocalOperationRequest/LocalOperationReceipt exports first; declarations import those types without invented Project/account DTOs.

Root owns the narrow existing-file integration:

1. In `apps/web/src/app/App.tsx`, import LocalChatEntry. Replace only the `workDefault && view === "projects" && codingWorkspace && !catalog.selected` welcome branch with LocalChatEntry. It owns its NativeWorkPresentation wrapper, so do not nest another wrapper. Keep the genuine Project Workbench branch intact. Supply `gateway`, the genuinely selected OS LocalEnvironment, and current local-custody availability. Do not derive library/custodian identity from Snapshot, invent a default WSL distro/user, or pass a Project as local ownership. Selectors are read from GET context.
2. `NativeWorkNoProjectActions.tsx` must expose a distinct local-chat action only when this entry is wired and its real ownership port is available. The existing explicit scratch-project action stays explicitly named; never route local New chat to scratch Project creation. Retained local flow selection is in LocalChatEntry. Moving from a Project to local view is Root navigation state, not Project creation or clearing an operation original.
3. The first explicit Read local ownership is GET only. New local chat durably records an ID only. Prepare private workspace reserves its exact UUID/environment and durable unknown fence before allocation; it retains the draft and creates no session. Read private runtime then supplies actual primary agents. First Send reserves the captured session/prompt UUIDs and exact text before session creation/prompt dispatch. No guessed initial agent or automatic engine startup exists.
4. Root reconciles the App/Workbench owner with actual Memory/Voice ports. LocalChatPanel's optional BoundLocalContent slots require the complete current LocalWorkspaceOwner and exact session_id. Keep each actual Memory/Voice controller original; never adapt Project credentials or fabricate exact-turn Stop. LocalConversation renders real normalized messages and full structured details as escaped text, in server order, with explicit read-only pagination. No raw HTML is executed.
5. Work is the default. Existing NativeWorkPresentation retains its mounted Work subtree/draft on explicit Web toggle and reports Web unavailable until Root has an independently qualified exact-session upstream host. No iframe, external URL, or fake Web transcript is introduced.

## Finite gateway/desktop proposal

Use the Projects finite port implementation and current protection middleware; this worker does not widen it. The transport emits only:

- GET `/v1/local-workspaces/context`.
- GET `/v1/local-workspaces/{UUID}` and `/{UUID}/runtime`.
- GET `/{UUID}/sessions?limit=50[&after={encoded opaque cursor}]`.
- GET `/{UUID}/sessions/{ses_32hex}` and its `/status`.
- GET `/{UUID}/sessions/{ses_32hex}/messages?limit=50[&cursor={encoded opaque cursor}]`.
- GET `/v1/local-workspaces/operations/{UUID}`.
- POST `/v1/local-workspaces/` with only typed request_id/environment.
- POST `/v1/local-workspaces/operations` with only typed request_id/complete owner/operation. This UI uses session_create, agent_turn, session_interrupt, session_select_model, session_select_agent only.

Reject unexpected method/path/query/body shapes and caller-provided principal/URL/header/Project fields. Read cursors are opaque, bounded and encoded; no order query is emitted by the UI. Root should use its already integrated finite gateway/desktop checks rather than a second generic proxy. New route or credential shortcuts are not part of this proposal.

## Retention and recovery

Client storage is a bounded original/draft journal, not transcript authority. Real Web Locks, compare-and-swap, write/readback and SHA256 exact typed originals are required before effects. Storage/coordination failure never falls back to another store. Every dispatched original becomes unknown durably before invocation. Lost acknowledgements, denied/current-custody conflicts, and missing/mismatched receipts retain originals. Check original receipts performs only reads; explicit continuation is a separate user action and never resubmits an unknown original. Restarted service instances keep the original journal read-only rather than rebinding old effects.

Operation committed is not prompt admitted. An immutable committed result with admission uncertain stays locked. The forthcoming actual LocalPromptOriginal read must be integrated by Root before this can be settled; activity/messages/outcome never prove original prompt admission. Generic Stop returns current_conversation, exact_turn_guarantee=false, terminal_observed=false; it does not claim OS or Voice exact-turn retirement. Model selection offers only the actually observed current engine model; loading stays with its original owner. Runtime ready means engine_protocol_only.

## Validation and cleanup receipt

`tests/local-chat.test.mjs`: 16/16 dependency-free Node behavior cases passed. This establishes fixture-level durable admission/recovery, context/binding validation and finite routing only. Proposed LocalChatPanel.test.tsx has two central React cases for retained draft/Web return and premature Enter refusal; not executed by this worker. Root must run focused web tests/types, App/navigation/Workbench regressions, real unknown-original/custody recovery, actual native/device/browser and screenshot-contract acceptance. Linux remains Docker/Kubernetes; no Linux native PTY gate is invented.

Regenerate the fixture result with the existing task-root Node and process-scoped TEMP/TMP/TMPDIR in coordination/work-ui:

`node --test docs/workstreams/work-ui/native-local-chat/tests/local-chat.test.mjs`

Owner: Work UI chat `01a18934-d937-7813-8c48-5ae85aad4f18`. One existing approved C-backed WSL output root: `/home/brajam/.local/state/ingenium-release/skill-zen-fix-1792810845`. Source growth budget below64MiB; no builds/dependencies/cache/downloads or bulk scratch were produced. Durable retained paths are this proposal's canonical source/tests/README and checksum recipe/manifest, consumed by Root integration; retain until integration review and merge. Existing original research file and all earlier patches/receipts/native indexes/models/data remain protected. Removed paths: none; measured removed bytes:0. No Linux or Windows disk recovery is claimed.
