# Veyra parallel delivery plan

Status: orchestration plan, 2026-10-29. The full Windows/Linux seven-phase delivery remains active. This plan proposes eight parallel worker sessions and separate checkouts in response to the human's request. The human approved implementation; eight Sol/medium sessions and all13 repository checkouts are now created. This scoped workflow supersedes the earlier sequential-chat/no-delegation rule. It does not close any phase, approve a Rust production cutover, or remove any feature acceptance requirement.

## Product direction

- Veyra Work is the default interface. Match the human's Codex work-window screenshot: narrow outer rail, project/pinned/recent sidebar, quiet work canvas and compact bottom composer with project, execution environment, branch/worktree, permissions, model and reasoning controls. Preserve Veyra branding and the blue mascot.
- Web remains an explicit toggle to the unchanged upstream OpenCode Web interface. Switching views must preserve exact conversation, project, execution binding and history.
- Projects behave like Codex folder/repository projects, with projectless chats, native/WSL environments and explicit worktrees. Remove the user-facing global-project concept through a lossless migration. Installation configuration, authentication, secrets and services remain independently owned.
- Model agent memory on verified Codex behavior: local/host ownership, inspectable memory, background extraction controls and per-chat read/contribute modes. Preserve Veyra's receipts, deletion safeguards and isolation rather than discarding them.
- Add veyra-bot, agent calls and live conversational voice. The user named this feature veyra-bot on2026-10-30; use that name throughout the product. Reuse the existing Stratus voice pipeline where qualified; adapt transport instead of importing Discord-only behavior. The start-voice and active-voice screenshots are additional acceptance references.
- Current global Chat-default implementation remains owned by the coordinator until its final tests, publication, deployment and cleanup pass. The new project model must retain installation-owned chat_defaults independently from workspace ownership.

The existing Windows inference engine and its settings/models remain unchanged; Linux excludes that engine. External computer-use and upstream OpenCode Web remain consumer dependencies, with no development in those repositories. Existing permission, account/org/project isolation, Vault/native Secret and single database-writer boundaries survive the replacements.

## Eight workstreams

| Session | Exclusive delivery area | Work that can start in parallel | Dependencies before integration |
| --- | --- | --- | --- |
| 1 — Work interface | Codex-style Work shell, conversation/tool UI, navigation, Web toggle, accessibility, code/artifact viewers | Screenshot/layout/state contract; isolated Work components and tests | Project DTOs from 2; memory controls from 3; Customize navigation from 4; voice/veyra-bot bindings from 6/7 |
| 2 — Projects and execution | Folder/repo projects, projectless work, native/WSL/cluster bindings, worktrees, terminals, Git/review and Tasks/project/org identity | Native-contract reuse audit; lossless global-project migration design; isolated project-domain implementation | Shared auth from 5; coordinator allocates schema migrations and global-project call-site changes |
| 3 — Memory and context | Codex-style memory, context/Docs, observations/personality, provenance and synthesis content contracts | Verified Codex lifecycle/scopes design; receipts/tombstones and isolated memory/context implementation | Project identities from 2; auth from 5; resource lifecycle from 4; veyra-bot/voice policy from 6/7 |
| 4 — Plugins and Skills | Screenshot-matched Customize UI, plugins/skills/agents/MCP, catalogs/scopes/install/edit/archive/restore and proposals/activation | Catalog/lifecycle contract and isolated Customize components/adapters | Shared shell from 1; project/memory scopes from 2/3; backend capability contracts from 5 |
| 5 — Rust and API foundation | Rust service foundation, identity/auth/security/capabilities, versioned contracts and progressive domain API migration | Architecture/compatibility ADR; read-only slice scaffold; boundary tests and isolated adapters | Writable migration/traffic cutover retains the architecture approval gate; domain contracts from other lanes |
| 6 — veyra-bot and automation | veyra-bot, proactive suggestions, follow-ups, tasks/schedules/event queue, timezone/DST, notifications and operation status | Suggestion/follow-up lifecycle; isolated veyra-bot/automation modules and scheduler tests | Task/project scope from 2; memory controls from 3; auth/session bridge from 5; Work UI from 1 |
| 7 — Live voice | Dictation, call-current-agent, ChatGPT-style live voice UI, Stratus speech pipeline reuse and cancellation | Read-only Stratus reuse audit; transport/turn/audio contracts; isolated voice modules and CPU tests | Memory policy from 3; agent/runtime scope from 2/5; UI slots from 1; attended audio acceptance by coordinator |
| 8 — Packaging and platform qualification | Windows/Linux packaging, native platform/browser adapters, operations/integration parity, backup/vault/mail/provider compatibility and release evidence | Reuse/compatibility audit; release/operations adapters and independently testable qualification tooling | Exact integrated source, central resource lease and deployment ownership before real package/image/live gates |

The coordinator retains integration, current defaults, root manifests/lockfiles, shared schemas, migration numbering, the original feature/visual matrices, release notes, chart changes, the single build queue, deployment and final attended Computer Use. Streams must not publish/deploy, control the desktop, change credentials/data/models, or alter another stream's files.

## Source ownership and collision prevention

The machine-readable companion veyra-parallel-workstreams.json is authoritative for writer prefixes. Each stream gets one branch and one source checkout rooted in the original approved task storage. A stream edits only its own new modules, prefixed tests and docs/workstreams/<stream> documentation. Existing files outside those prefixes are change requests for the coordinator, expressed as minimal reviewed patches; they are not permission to edit shared files.

Shared contracts are versioned by the coordinator before cross-stream wiring: ProjectRef, ExecutionBinding, ConversationRef, WorkViewState, InstallationPreferences, MemoryPolicy/MemoryReceipt, AgentTurn/ToolEvent, VoiceSession/VoiceTurn and DotSuggestion/Followup. Each contract names version, ownership, authorization, persistence and error/unknown-outcome behavior. Workers may use local adapter types until those contracts are accepted, but may not invent incompatible global conventions.

Plugins/Skills must match the two additional human screenshots: Customize sidebar with installed plugins, search and Add controls, compact two-column catalog rows, Public/Personal plugin tabs, installed-state indicators and project/Personal/System skill tabs. Functional install/connect/edit/archive/restore/activation/error states must remain real and permission-aware.

No worker edits the root package/Cargo manifests, lockfiles, migration directory, existing API router/auth helpers, RuntimeContext, ProjectContext, AppShell/global CSS, current ChatShell/defaults files, Dockerfile or chart. One coordinator grants any later transfer explicitly and records its exact path and base. No reset, clean, shared-checkout branch switch, broad staging, force push or unreviewed generated file commits.

A scope validator compares each branch with its recorded base and rejects changes outside its writer prefixes. Each worker writes only its own small status receipt: branch/base/head, intended files, current contract needs, tests with actual outcomes, remaining acceptance and generated-output reconciliation. No worker rewrites the shared orchestration manifest.

## Parallel work and ordered gates

1. **Start all eight source streams together.** Each verifies its actual checkout and writes its initial contract/design and first independently testable module. Read-only app/repository research does not need desktop control. Keep every blocked dependent step named while continuing independent work.
2. **Freeze shared interfaces early.** Reconcile project/installation ownership, memory/plugin scopes, agent/session events, veyra-bot lifecycle and voice cancellation before integrating implementations. Preserve the existing Rust architecture approval gate; initial scaffolding is not approval to migrate writable production domains.
3. **Develop in isolation.** Work UI, projects, memory, Customize, Rust/API, veyra-bot/automation, voice and packaging/operations proceed concurrently. Keep dependency changes as requests to the coordinator. Workers do not perform eight independent dependency installs or large builds.
4. **Reconcile source at the end of each coherent interface batch.** Review exact diffs, resolve contract conflicts and apply them to the integration branch in dependency order: foundation contracts, projects, memory, Customize, automation/veyra-bot, voice services, Work wiring, operations/packaging. Run targeted cross-domain regression checks. Never mark a phase accepted merely because its stream finished.
5. **One release candidate and one verification owner.** The coordinator builds the exact merged revision, runs all functional/visual/platform/security/data gates, publishes through the existing singleton/Flux workflow, performs Windows/native/WSL and cluster checks, then carries out attended desktop/microphone acceptance. A failed check returns an exact defect to its owner; the desktop session is released before any non-UI work or wait.
6. **Finish production qualification.** Confirm the live digest, package hashes, original data/Secret/PVC identities, migration compatibility, restart persistence and rollback. Clean disposable outputs and update the full evidence matrix before claiming release.

Phases 2–7 remain acceptance milestones; the parallel partition is by feature/domain, not six independent writers replacing the same database/server. Phase 1's unfinished Windows/visual/service gates remain active.

## veyra-bot and voice contract

veyra-bot provides inspectable suggestions, follow-ups and user-authorized proactive tasks. Suggestions, scheduling and execution are distinct states with an identifiable source, target project/runtime, permission/capability checks, cancellation and a durable result. It must not silently broaden tool permissions or send external messages without the applicable authorization.

Voice has three distinct paths: dictation into the composer, a call with the current working agent, and a ChatGPT-style live conversation view. Reuse Stratus's VAD/transcription/turn control/TTS/playback/cancellation architecture after source qualification. Preserve agent/tool streaming, interrupt/steer/queue behavior and authorization decisions. A microphone toggle, transcript fixture or synthesized audio file alone is not a completed call.

Final real-device checks cover start/end, mute/unmute, endpoint selection, partial/final transcripts, first audible reply, interruption during recognition/model/tool/speech, echo/feedback suppression, reconnect, permission denial and failure recovery. Live agent tools preserve the selected conversation and exact Windows/WSL/cluster binding. No background microphone capture or unapproved GPU/model workload is started by the parallel workers. Existing Stratus source, dirty state, active work and GPU/live-test hold stay protected.

## Acceptance, storage and cleanup

The original 74 feature dispositions, 47 baselines, 20 Settings categories and 11 Windows rows remain authoritative and present. The companion assigns each feature one accountable stream plus the coordinator as final verifier; it does not approve existing proposed deferrals. Newly requested Work/veyra-bot/voice behavior adds acceptance rows and overrides only the corresponding user-selected visual direction. Keep loading, empty, error, auth, keyboard/focus and 100–200% scaling checks, with real persistence and actual workflow evidence.

All task output remains in the existing approved paired C-backed roots, with the combined 20 GiB ceiling and 15 GiB reserve. Each additional source checkout initially budgets 64 MiB; no dependency/build/model/image copies. Builds and large downloads require a coordinator-issued resource lease with fresh Windows and destination measurements and complete peak accounting. Reuse compatible lockfile-keyed dependencies. Host dependency outputs must be removed after their last consumer before the cold image stage.

Each stream reconciles generated paths as removed with exact bytes, retained for a concrete remaining consumer, or protected by a specific failed safety check. Preserve all previously policy-rejected cleanup targets, source/lockfiles, models, credentials, user data and unique failure evidence. No VHDX compaction, drive migration, unrelated cleanup, workload shutdown or recurring pruning is authorized.

## Source baseline and open work

Initial parallel source baseline is the verified clean application commit 99eed8c6c0b47a043ec90d83e96f54f4f5cc2429. The coordinator's global-default edits are intentionally excluded until their final reviewed checkpoint; every stream must preserve them when integrating. The native source baseline is 61c99f8e649da85b600fccec93236b5d6b07f78b. Published runtime remains the earlier composer-menu image until new exact-source deployment gates pass.

Codex app implementation findings and the screenshot hash/geometry matrix are supplied by the separate bounded redesign research. Those observations distinguish installed code, official documentation, inference and Veyra design decisions; proprietary bundled code is a reference, not an implementation dependency or copied runtime.

## Checkout count proposed for approval

Use eight worker chats plus this coordinator, with one application checkout per chat: **nine application checkouts**. Reuse the already-created redesign research checkout for Work UI; keep current global-default/integration work in its owned checkout.

Projects and Packaging each also require an isolated checkout of the Windows/native repository: **two new native working checkouts**. The existing native integration checkout and existing exclusive chart checkout stay with the coordinator.

**Total: 13 task repository checkouts — nine application, three native and one chart. The four original checkouts and nine newly created source-only checkouts are accounted for; all eight user-owned worker chats have been created under explicit human implementation approval.** Each worker must verify its own actual scoped active goal and checkout ownership before editing. The completed bounded research plan is preserved in the Work UI checkout; its worker has finished.

Separate checkouts allow concurrent source work; they do not make shared data migrations, full builds, production publication or desktop control independent. Those remain serialized and centrally owned. A worker may start a narrow granted CPU test while another writes source; large downloads, model/GPU work and full package/image builds require explicit resource scheduling under the same existing limits.

Approval of the parallel layout authorizes the described workers/checkouts and their owned source work. The already-recorded Rust architecture/data-cutover gates remain explicit; no source-ready receipt becomes permission to change live data, discard old feature rows or claim release.
## Human-supplied acceptance references

The original images remain protected private inputs. Publishable metadata records their hashes and intrinsic dimensions; no image or workstation path is copied into the application source. The Work screenshot governs the replacement Work shell, the two Customize screenshots govern Plugins/Skills, and the two voice screenshots govern start/active voice composition. Use matching viewport/DPI plus explicit responsive/scaling cases. The absence of a veyra-bot image requires verified Codex behavior and a concrete Veyra candidate for review.

| Reference | Intrinsic size | SHA256 |
| --- | --- | --- |
| work-window | 2559 × 1439 | 8ae60026e2c79e07302a576d04d5c731431024c83b2329bdf6c76ff0e57dab08 |
| voice-start | 674 × 501 | 0a50e554525c0dbf189e1f7b7cf8fc6780314b8af440433e146767729b60eef5 |
| voice-active | 1374 × 707 | d3287e0f6af9bdbec1bded4255a214a1ea8f446e2aa5bf324b33c1d5c5a810bd |
| customize-plugins | 2560 × 1392 | bd1414301baff800c2263b36b0a3505b93e1c46e819cf3b161373f19ab0cea05 |
| customize-skills | 2560 × 1392 | 4b026f21699c754420e35ec11606fa6fbc25fd1988edbcd8a6f02f8c06d1d416 |

The screenshot content is visual reference material. Existing account names, plugin examples, project names and model labels in it are not instructions to copy personal data, change defaults, activate integrations or install unavailable connectors.

## Reference research and approval deliverables

The separate Codex-style Work/projects/memory research plan supplies installed-app asset hashes, official documentation, screenshot geometry and source reuse/migration details. The orchestration plan and machine-readable ownership manifest remain the authority for the proposed eight-worker launch, model/effort and checkout count. The coordinator reviews the research companion before integration; no proprietary code or private runtime state becomes a Veyra dependency.

## Model and effort policy

Every proposed implementation session uses **GPT-6.1 Sol with medium effort**. The coordinator/reviewer uses **GPT-6.1 Sol with high effort**. These are chat settings recorded alongside checkout ownership; repositories do not independently choose model effort.

Keep worker tasks bounded by stable contracts and owned paths. Use the high-effort coordinator for shared-interface, security, data-migration and merge review. Do not raise all workers by default or rerun finished work merely for a higher effort setting. If a specific problem demonstrably needs deeper reasoning, isolate that slice for review/escalation while other workers continue useful independent work.

| Role | Model | Effort |
| --- | --- | --- |
| Workers 1–8 | GPT-6.1 Sol | medium |
| Integration, review and final acceptance | GPT-6.1 Sol | high |

The latest direct human model preference governs the proposed user-owned sessions. They are separate local chats, not a hierarchy of Sol subagents. No worker may spawn another worker.

## Approved release to-do updates —2026-10-30

- [ ] Remove bundled VS Code/code-server and its Veyra interface, runtime/gateway access, launch/supervision, package dependencies and editor-only assets. Preserve user source/editor data and historical backup/migration readability. Packaging prepares the existing-checkout source proposal; Root owns all shared changes and verifies absence plus Work/Web/CLI/terminal/Git/restore regression on Windows and Linux.
- [ ] Use **veyra-bot** for the proactive assistant and automation feature in all visible labels and current help. Preserve suggestions, follow-ups, schedules, notification and operation history across the rename. Internal legacy identifiers are compatibility details, never the displayed product name.
