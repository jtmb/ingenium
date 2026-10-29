# Veyra parallel integration contracts v1

Coordinator-owned integration semantics, approved parallel execution 2026-10-29. Workers implement within their own writer territories and submit adapters/contract changes for review. Existing API/native contracts remain authoritative until the coordinator integrates a reviewed version; no domain introduces a second database, transcript, scheduler or credential authority.

## Identity, projects and execution

- ProjectRef preserves the existing stable project identity, owner/org and archive state. Projectless is an explicit null project with private actor ownership; it is never a synthetic global project, default repo or widened tool permission.
- Project organization and execution location are distinct. ExecutionBinding references the existing authorized runtime/workspace mapping, immutable workspace identity/hash/epoch and actual host/environment/canonical directory. Preserve the native instance/revision and exact-request admission/recovery contracts. Labels, sidebar placement and a selected folder grant no execution authority.
- Reuse the existing native project catalog through an adapter; do not seed another independently writable project catalog in the dashboard. A missing/offline/revoked requested binding remains unavailable; no fallback from Windows to WSL/cluster or another root.
- InstallationPreferences remain API-owned installation configuration, independent from project content. Preserve current global resources through explicit identity mapping/compatibility adapters before retiring the legacy global-project UI/row.
- The new installation-owned chat_defaults and legacy Docs chat_selection are distinct. Existing synthesis/provider/model credentials and defaults are preserved. New Chat sessions use the saved provider/model/supported optional variant; an existing conversation uses its own native session model/effort.

## Conversations and Work views

- ConversationRef identifies one existing engine session plus its authorized execution binding and optional project organization. Keep one transcript owner. Work and unchanged upstream Web are alternate presentations of that same session, never separate conversation creation or replay.
- Preserve drafts/attachments, pending/unknown prompt admission, tool approvals, cancellation, history and navigation identity during view switching. Do not call a mode switch successful by loading a second empty upstream page.
- Shared shell wiring, URL/runtime contexts, root CSS/tokens and coordinator Chat-default files remain coordinator-owned. Work provides reusable layout slots; Customize, Dot and Voice provide their scoped feature components/controllers.
- Suggested frontend/public DTO shapes are submitted by each owner under its docs/workstreams directory; shared-field renaming or root wiring is coordinated rather than silently changed.

## Memory, Skills and resources

- MemoryPolicy expresses read/use and contribute/generate separately, scoped to the actual actor/org/host/environment/project/workspace and conversation policy. Preserve existing explicit save/edit/CAS/forget receipts and tombstones, immutable checkpoints and restore-as-new.
- API-owned records are authoritative. Derived Markdown/index files are projections, never independently writable memory stores. Recall is provenance-bearing untrusted context, not instruction authority or skill activation.
- Background extraction uses the existing Jobs/event queue and rechecks eligibility/ownership/revocation before persistence. No worker enables global extraction, cross-host sharing or arbitrary external-context ingestion as an inferred default. Preserve existing configured behavior; unresolved new defaults/retention remain explicit integration decisions before activation.
- Skills/Plugins/Agents/MCP adapters preserve real source, scope, permissions, version/history and proposal/activation lifecycle. Installed UI state follows actual runtime/catalog evidence. No hardcoded screenshot catalog or fabricated connection success.
- New global phased-checkout-orchestration is a deliberate human-requested installation resource. Preserve it through namespace/catalog migration; its approval gate does not invalidate approval already given to these eight streams.

## Dot, automation and voice

- DotSuggestion is distinct from an approved/executing follow-up/job. Bind it to actor/project/runtime and source/provenance. Use existing task/job/event persistence and operation identity; no second scheduler or inference of permission from a suggestion.
- Existing scheduler owns execution, timezone/DST/missed-run semantics and notifications. Cancellation/revocation and unknown outcomes retain their original operation identity across restarts.
- VoiceSession binds one explicit user-started capture/playback connection to an existing conversation/agent and execution binding. VoiceTurn has stable turn identity plus generation/cancellation correlation. Reuse qualified Stratus turn-control semantics; do not modify or start Stratus.
- Dictation edits a draft; a call drives the current working agent; live conversation is a voice presentation. These share authorized agent/turn/tool events, not independent transcript or tool authorities.
- Stop/mute/barge-in invalidate stale recognition/model/tool/speech callbacks and queued playback by correlation identity. Preserve real tool permission/approval surfaces and user steering. No background microphone capture, secret transcript logging, model download/load or hardware tests by workers.
- Final attended microphone, audio, desktop and visual verification belongs only to coordinator.

## Rust, persistence and release boundaries

- The initial Rust compatibility slice may delegate the original caller credentials to the existing authenticated Node API on each allowlisted read request. This approves source implementation and denial tests for a read-only compatibility edge only.
- No reissued tokens, trusted identity headers, local RBAC/session cache, copied crypto/DB access, arbitrary upstream URL/redirect forwarding or writable proxy route. Preserve auth/CSRF/origin/capability semantics and sanitize failures. Coordinator reviews concrete upstream configuration and traffic binding before runtime exposure.
- Domain owners supply persistence ports and migration-copy proposals. Coordinator alone allocates SQL migrations, installs shared manifests/locks, wires API routers and switches domain writers. No live data migration or writable Rust cutover is authorized by this source contract.
- Packaging/qualification workers prepare exact-source recipes and testable adapters. The coordinator grants measured build/download leases and owns chart/publisher/Flux deployment. Actions stay off and the existing singleton publisher is not duplicated.
- Worker source/unit/fixture success is ready-for-integration evidence. Integrated native/WSL/cluster persistence, visual/device, migration/rollback and full production acceptance remain separate gates.

## Completion and evidence

Every worker's actual active scoped goal and ownership receipt is verified. Status files identify current contract/build requests and remaining acceptance. Source/model/effort/checkouts remain linked in the coordination manifest. Retain all74 feature dispositions,47 baselines,20 Settings categories and11 Windows rows; only actual verified acceptance changes their status.

The coordinator goal remains active through full release. No worker may claim whole-phase/release acceptance or archive the coordinator at its source milestone.
