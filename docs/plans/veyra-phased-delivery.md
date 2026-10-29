# Veyra phased delivery plan

Status: Phase 1 implementation in progress, 2026-10-27. Both MVP runtime and visual exit gates remain open. The screenshots are the visual acceptance contract. This plan does not report a finished product, a working computer-use connection, or an approved Rust production cutover.

## Goal and boundaries

Deliver Veyra as a Windows desktop build and a Linux Docker build, retaining Ingenium's application features and selecting the genuinely better parts of the original Veyra. Test Windows on the user's machine and Linux on the existing Ingenium Kubernetes cluster. Keep computer-use a separate external dependency. All development is in Veyra repositories, through Codex; never develop in computer-use or through OpenCode.

The existing Windows Veyra chat remains stopped. The new phase owner may reuse its source/checkpoint without resuming that chat. Keep the current Windows inference implementation, settings and models intact but do not develop that engine. Exclude the custom inference engine, its local model manager and weights from Linux.

Keep upstream OpenCode Web's frontend unchanged. Keep its Goal plugin outside ordinary Chat. Do not resurrect the discarded custom multi-chat orchestration feature. No subagents in this delivery workflow.

Chat and synthesis target ChatGPT / openai/gpt-6-luna, as separately requested. Do not copy computer-use's DeepSeek model defaults, workstation paths, permissions or credentials. Preserve all other model/profile settings.

## Repository and architecture direction

- The current jtmb/ingenium application is the Veyra service/Linux lineage. Do not rename a GitHub repository just to rename the visible product.
- jtmb/veyra-dock is the existing Windows lineage. Reuse its Tauri shell, Rust service/contracts and qualified platform adapters. Preserve both histories and dirty user changes. Share UI/contracts through an explicit versioned package or reviewed extraction, not uncontrolled duplicate forks.
- jtmb/computer-use is the independent OpenCode brain: source skill bundles, Goal plugin provenance and supporting capability launchers. Veyra owns integration configuration, dependency pinning, platform adapters and verification; never patch the dependency to make the consumer pass.
- Recommend a shared React UI and progressively shared Rust services. Keep the existing Linux API during the first MVP where needed. The Windows build can reuse Rust already written; the Linux MVP must not wait for an all-at-once backend rewrite.
- Keep API-owned SQLite transactions/migrations, authenticated proxies, project/org boundaries and credential encryption. One migration authority per database. Keep OpenCode/VS Code as upstream dependencies.

## Thread execution

One phase per local Codex chat, using gpt-6.1-sol with high reasoning. Work directly; no subagents. Create only the next chat when its predecessor is finished. Current planning is an explicitly requested planning handoff, not completion of Phase 1.

At phase end: finish the actual phase gates; update docs and the acceptance matrix; review/stage only intended changes; commit/push to existing intended remotes and verify the exact remote branch SHA; clean owned disposable outputs; prepare one concise handoff/private companion. The successor verifies its owned checkout and establishes its own full-scope active goal, then writes one matching ownership receipt. Only then archive the predecessor. No recursive ancestor audit, unrelated checkout equality, extra startup-ack loop or silent acceptance waiver. Follow [phase workflow](../operations/veyra-phase-workflow.md).

## Phase 1 — Windows + Linux UI MVP and brain integration

**Outputs:** a runnable Windows desktop package on this machine and a runnable Linux Docker image tested on the existing cluster; not merely image mockups, a browser wrapper, a source build or a health badge.

1. Inspect the old Windows checkpoint and published preview before replacing anything. Catalogue reuse with source/runtime evidence, especially Tauri lifecycle/tray, native Windows OpenCode/terminal, WSL distro/user/workdir selection, reconnect and command journal. Do not discard working adapters because the original engine work stalled.
2. Implement the shared visual shell using the screenshot contract: quiet Chat, compact/expanded navigation, blue computer-use mascot, consistent typography/tokens and keyboard focus. All 38 routes, 20 settings sections and 47 contracted views remain discoverable. Reuse feature pages and their API contracts rather than flattening them into placeholder cards.
3. Deliver actual Chat streaming/new conversation/history/cancel/recovery and serve actual upstream OpenCode Web unchanged. Hook existing feature screens to real backends. Loading/empty/auth/error states must be clear. A fixture preview is allowed for visual review but must be labelled and cannot satisfy an end-to-end feature gate.
4. Make the Windows build an actual desktop application: launch/relaunch/single instance/tray/exit; local project access; native Windows execution; selected WSL environment and terminal operation; authenticated connection to the chosen service. Never silently execute a Windows task in WSL or the cluster. Expose the actual backend/environment used.
5. Connect the pinned external computer-use brain in both builds, with complete skill bundles/references, portable dependency paths and one existing Goal integration. Keep existing Veyra-owned skills, protected broker and models. Demonstrate fresh runtime skill discovery and actual skill loading after restart, including a safe representative skill in native/WSL and cluster OpenCode. Verify Goal stays absent from ordinary Chat.
6. Produce both distributables. Test the Linux image through existing Helm/Flux/operator workflow on the current cluster, preserving production data/Secrets/PVCs and a verified recovery path. Use controlled test data and a reversible deployment; preserve the prior usable installation. No deploy-to-production controls inside Veyra. Test Windows on the machine without stopping unrelated services or loading models for packaging tests.
7. Produce an MVP evidence report: exact source revisions/image digest/package hashes; fresh screenshots against each relevant baseline; working navigation and new Chat; OpenCode skill discovery; Windows/native/WSL checks; cluster ingress/auth/persistence/restart checks; gaps identified separately.
8. Update README, platform quickstarts, screenshots/tour, brain integration/rollback, WSL guidance and known limitations. Follow the computer-use README's concise navigation/setup/verification/rollback style, using Veyra's actual commands.

**Windows visual coverage:** the existing 47-view set covers Ingenium routes. Inventory/reuse the old Windows concepts for WSL selection, terminals, tray and desktop lifecycle; add targeted missing Windows states to the contract for review. Do not claim those flows already have acceptance images.

**Exit:** both Windows and Linux MVPs run and have been exercised; all screenshot views map to implemented UI or explicitly tracked unfinished functional gates; no claim of full feature acceptance based on UI rendering. Present visual deviations for approval instead of rewriting baselines. This MVP is a phase milestone; all remaining feature gates stay in the full goal.

## Phase 2 — Complete existing feature workflows and reliability

Independently verify every current UI feature on both supported client paths, using real operations and reload/restart persistence. Cover Chat, upstream OpenCode/CLI, VS Code, Mail, Tasks, Docs, Skills, Agents, Observations, Personality, Context, Pipeline, Jobs, Backups, Logs, Usage, Status, Projects, Organizations, Plugins, MCP, Config, Secrets, account/settings and every public auth/callback/detail route.

Require fresh Luna chat, upload/edit/archive/restore skills, full synthesis batch -> proposal -> approval -> activation -> fresh-chat use, real Gmail sending/receiving, vault-authorized consumption, project/org isolation and invitation/account controls. Use only previously authorized mailbox testing or obtain specific authorization for any new recipient. Repair the generic upload error that masks auth/network failures and any remaining cold-start/step-up or folder-sync defects. Recheck advisory counts; do not assume historical security reports still describe the current image.

Docs: per-feature help, troubleshooting, permissions, provider connection, real mail/secret setup, feature evidence and honest platform limitations. **Exit:** independent workflow matrix has real evidence, not page-load/200-only checks; unresolved external prerequisites stay explicit.

## Phase 3 — Rust foundation and first compatible service slice

Use the MVP and Phase 2 data as a baseline. Confirm the chosen Rust backend direction before a production rewrite. Reuse qualified Windows contracts/core; add a Linux-compatible Axum service boundary and a small read-only domain behind the same API contract. Port identity/session/org/project authorization, step-up, CSRF/cookie/origin rules and capability enforcement before expanding writable domains. Preserve crypto formats and migration ownership; test compatibility against copies, never uncoordinated dual writes to the live database.

Docs: architecture decision, API/DTO contracts, compatibility/migration and rollback procedures. **Exit:** a real compatible slice, denial-path tests and comparable startup/RSS/API/stream measurements; no unsupported Rust speed claim.

## Phase 4 — Rust workspace and intelligence domains

Incrementally migrate projects, Tasks, Docs/RAG, conversations/context/checkpoints/saved memory, observations/personality, skills/proposals and synthesis. Keep transactional skill storage, history, permission scope and restore-as-new behavior. Reuse selected Windows navigation/attachments/recovery/Git-workspace components where they improve the experience without replacing upstream OpenCode UI. Each migrated domain needs parity, persistence and failure recovery before switching traffic.

Docs: domain/API changes, import/export, migration status, operator rollback and revised user guides. **Exit:** functional and visual parity for each migrated domain with a single data owner; no data-loss or lost-control shortcut.

## Phase 5 — Rust operations and external integrations

Migrate jobs/event queue/trusted events, schedules/timezone/DST/missed-run policies, usage/logging/status, backup orchestration, vault access and connector boundaries. Preserve real Gmail OAuth/sync/send and current provider integrations; retain a narrow Node mail/provider/plugin adapter until a Rust replacement proves equivalent rather than rushing a library rewrite. Keep MCP tool visibility, credentials and protected-broker denials. Preserve the dedicated public-information Cloudflare route; never expose private mail/API/workspaces.

Docs: jobs, mail, credentials, backup/restore, health/diagnostics, integration capability table and dependency pins. **Exit:** independent real account workflows, scheduler restart recovery, isolated restore verification and accurate diagnostics.

## Phase 6 — Shared Windows/Linux packaging and selected parity improvements

Consolidate the proven shared Rust core/React UI; remove the Linux Next server only if server routing, auth callbacks, streaming, editor proxy/CSP and deep-link behavior have replacements. Keep Windows-only tray, WSL/native execution, ConPTY and optional platform browser/capture adapters. Assess stronger legacy Veyra recovery, worktree, review, layout and accessibility work against current upstream overlap. Apply signing/update/rollback packaging rules; do not call unsigned artifacts signed or planned sandboxing real isolation.

Voice, browser/computer control, artifact editors, remote/mobile/cloud, maps/sites, family controls and overlays have explicit entries in the 74-row review. Recommended deferrals are proposals requiring disposition; they are neither silently deleted nor called complete. Existing visual controls still require truthful behavior and tracked acceptance.

Docs: distribution/package architecture, Windows installer/portable/update/rollback and Linux image lifecycle, capability/platform matrix, licences and migration guide. **Exit:** repeatable packages, proved platform boundaries and selected parity workflows; no custom inference engine on Linux.

## Phase 7 — Production qualification, migration and release

Run the full independent feature and visual matrix, Windows native + WSL acceptance, Linux cluster rollout, preserved-data/credential migration, fresh backups and an isolated restore, image/dependency provenance/advisories, provider/synthesis/mail regression and cold-start/reconnect tests. Measure comparable cold/warm startup, idle RSS/CPU, p50/p95 service latency, streaming first token excluding provider time, cancellation, SQLite contention and UI responsiveness. Report compressed transfer size and unpacked/runtime disk separately.

Publish reviewed image/chart/package artefacts via established remotes and Helm/Flux workflow. Confirm cluster DNS/ingress/TLS, actual digest, persistence/restart and rollback. Clean eligible old local artefacts only after the replacement is verified, preserving source, required recovery, live data and models. Final visual acceptance compares actual build screenshots to the contract; any changed baseline needs explicit approval.

Docs: current README/status, release notes, upgrade/recovery runbook, support/known limitations, accurate feature inventory and final evidence index. **Exit:** both editions satisfy their agreed feature/visual/platform gates; production is verified. A phase receipt or build pass cannot complete the full goal.

## Acceptance and scope controls

The [visual contract](../design/veyra-visual-contract.md) and [screen hashes](../design/veyra-screen-contract.json) map all 47 selected views to routes and feature groups. Retain all existing controls, including those outside the sidebar. Document added depicted controls and platform-specific differences. UI MVP work does not authorize declaring those controls functionally complete.

The [legacy review](veyra-legacy-reuse-review.md) and [74-row map](veyra-legacy-feature-map.json) distinguish useful reuse, existing Ingenium strengths, Windows-only preserved engine work and proposed deferrals. The original specification is evidence of intent, not evidence of implementation.

Documentation is a deliverable in every phase: [documentation plan](../operations/veyra-documentation-plan.md). Do not update marketing/status claims before their actual runtime gates pass.

## Resources and preservation

Reuse the existing task-owned output root and its ownership manifest across phases. Keep compiler outputs, caches, temporary state and dependency installs inside that root; keep Cargo home separate from targets. The private companion supplies exact locations. Preserve original Windows source/workloads and the stopped chat's legacy build/evidence roots; do not silently scatter or move outputs to another drive. Prove Windows compiler/toolchain access to the declared output storage before a large stage. If incompatible, inventory/clean eligible outputs and resolve that specific constraint before generating elsewhere.

Before builds/downloads, measure Windows C and destination free space; retain the 15 GiB guard and existing C/WSL task ceiling. Budget actual compressed/unpacked image, build cache and rollback consumers rather than repeating the unsupported 21 GB claim. Follow exact ownership, no-active-reference, Git/source preservation and regeneration checks before cleanup; prior rejected targets stay protected.

## Current evidence and open gates

Phase 1 is active. The pinned external brain at b47765e4a9f5c124c4716deb52962e17d7fb4a2a is materialized without editing its repository or applying its global configuration. The reviewed Veyra consumer registers all 23 external skills with computer-use: names and preserves all eight Veyra skills. Fresh WSL and native Windows processes passed discovery and exact-body activation without inference; the native proof used isolated persistent NTFS SQLite state. The Windows packaged launcher and same-profile restart also passed exact-body loading without inference; cluster runtime qualification remains open. All 47 fixture captures now return HTTP 200 without unhandled page errors; material layout differences, Home composition, live workflows and missing Windows-specific captures still require implementation/review. No model settings were changed in these checks.

Existing Ingenium app baseline: a1f5bfed98832bc09341c193f60ee02468fde8f5. A qualified candidate image exists but was not published/deployed in the design round. Tasks/Docs workflows passed earlier; the comprehensive audit is open. The old Windows latest stopped checkpoint is fb608696f0cc4578ba877aa262c61b79d6beaafe; its canonical checkout is older and has a user documentation edit. The README reports a published Windows coding preview while the current implementation ledger still has native/whole-service/WSL gates open. Reuse is promising, not an automatic readiness claim.
