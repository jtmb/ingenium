---
title: Phase 0 Roadmap Baseline
description: Execution-ready contracts for the approved bug, MCP, context, and documentation roadmap.
---

# Phase 0 Roadmap Baseline

This is the repository-authoritative execution baseline. It defines stable task
IDs and contracts; it does not implement any task. This uppercase file is the
only canonical roadmap path. The former lowercase path is intentionally absent;
do not recreate it or maintain a second copy. A terminal `PASS` or final
completion claim is prohibited while any `(work-started)` marker remains active;
the active marker must first receive its matching completion marker, evidence,
and TodoWrite/roadmap reconciliation. Active markers block terminal completion only; they do not block autonomous resumption of unfinished work. Execution may
resume from the recorded marker state and continue until the task is completed
or a permitted `ESCALATE_USER` condition is proven.

## Operating rules

- Execute independent tasks concurrently when approved. The roadmap defines
  identity, not live task state.
- TodoWrite is the live execution checklist. Work markers below are an
  append-only audit trail and must never be used as a replacement for TodoWrite,
  comments, commits, or implementation status.
- Keep marker writes serialized and append-only, and keep them separate from
  TodoWrite. Independent tasks may each have an active `(work-started)` marker;
  a completion must close its own active task.
- For this Phase 0C execution plan, use a stricter cap of four active agents;
  this is below the repository policy of six active agents and three concurrent
  writers.
- Respect the orchestration ceiling of six active agents and three concurrent
  writers; conflicting writers are serialized by exclusive territory.
- No task may expand into product cleanup, unrelated documentation, or a Docs
  Workspace mutation.

## Marker protocol

Only exact markers appended under an approved marker-log heading are valid.
`Historical work marker log` retains immutable legacy markers; `Work marker
log` and `Work marker log (continued)` are the live append-only sections:

```text
<!-- (work-started) BUG-000 2026-01-01T00:00:00Z agent-name -->
<!-- (work-complete) BUG-000 2026-01-01T01:00:00Z agent-name -->
```

Rules:

1. Append; never edit, reorder, or delete an existing marker. Historical
   markers remain retained and are not reopened as live work.
2. IDs must be defined in this document, timestamps must be UTC ISO-8601
   seconds, and the actor must contain no whitespace.
3. Starts and completions need not alternate globally. A task may not start
   twice while active or restart after completion, and a completion must close
   its own active ID exactly once. A completion for an unstarted/already-
   completed task, a marker outside an approved heading, malformed text, or an
   unknown ID fails validation.
4. Every completed task must have non-empty implementation evidence in the
   log (`Evidence TASK-ID: ...`).
5. TodoWrite remains separate and authoritative for execution checklists.

### Historical work marker log

These retained markers are historical audit data and are not reopened as live
work.
<!-- (work-started) BUG-000 2026-07-27T18:36:47Z ingenium-docs -->
<!-- (work-complete) BUG-000 2026-07-27T18:36:48Z ingenium-docs -->
<!-- (work-started) BUG-001 2026-07-27T18:36:49Z ingenium-docs -->
<!-- (work-complete) BUG-001 2026-07-27T18:36:50Z ingenium-docs -->
<!-- (work-started) BUG-002 2026-07-27T18:36:51Z ingenium-docs -->
<!-- (work-complete) BUG-002 2026-07-27T18:36:52Z ingenium-docs -->
### Work marker log
The marker log below is the current append-only execution state; active markers
are unfinished work, not a baseline declaration. No final completion may be
reported until every active marker is closed and reconciled.
<!-- (work-started) BUG-000 2026-07-27T19:22:30Z ingenium-docs -->
<!-- (work-complete) BUG-000 2026-07-27T19:22:31Z ingenium-docs -->
Evidence BUG-000: Phase 1 writer verification — `services/ingenium-api/tests/docs-ai-security.test.ts`, `services/ingenium-dashboard/tests/docs-ai-actions.test.ts`, `tests/ingenium-dashboard/docs-ai.spec.ts`.
<!-- (work-started) BUG-001 2026-07-27T19:22:32Z ingenium-docs -->
<!-- (work-complete) BUG-001 2026-07-27T19:22:33Z ingenium-docs -->
Evidence BUG-001: Phase 1 writer verification — `services/ingenium-api/tests/mcp-status-contract.test.ts`, `services/ingenium-api/tests/mcp-launcher.test.ts`, `packages/ingenium-extension/mcp-launcher.test.ts`.
<!-- (work-started) BUG-002 2026-07-27T19:22:34Z ingenium-docs -->
<!-- (work-complete) BUG-002 2026-07-27T19:22:35Z ingenium-docs -->
Evidence BUG-002: QA PASS and Phase 1 writer verification — `services/ingenium-api/tests/learning-ownership.test.ts`, `packages/ingenium-core/tests/extraction.test.ts`, `packages/ingenium-core/tests/synthesis.test.ts`.
<!-- (work-started) BUG-003 2026-07-27T19:39:05Z ingenium-docs -->
<!-- (work-started) BUG-004 2026-07-27T19:39:07Z ingenium-docs -->
<!-- (work-started) BUG-005 2026-07-27T19:39:09Z ingenium-docs -->
<!-- (work-started) BUG-006 2026-07-27T20:00:00Z ingenium-dashboard -->
<!-- (work-started) MCP-001 2026-07-27T20:00:01Z ingenium-mcp -->
<!-- (work-started) CTX-001 2026-07-27T20:00:02Z ingenium-core-immutable-conversation-checkpoint -->

## Gates and definitions

### Required gates

- **Test:** add focused automated coverage, run it, and run the relevant
  repository checks. Mocks do not prove an integration path; use the real
  configured service when available.
- **Documentation:** update affected canonical repository Markdown, verify links
  and commands, and do not mutate Docs Workspace unless explicitly requested.
- **Visual:** for UI work, reproduce the exact user path at 1440x900 and
  390x844, with accessibility, console/network, and run-scoped screenshot
  evidence under `tests/artifacts/visual-qa/<run-id>/`.

### Contract fields

Every task below explicitly declares **IN_SCOPE**, **OUT_OF_SCOPE**, **Owner**,
**Acceptance**, **STOP_CONDITION**, **Escalation**, **Verification owner**,
**Deployment owner**, **Rollback/safety**, **Tests**, and **Docs**. `PASS` means all listed acceptance
criteria and applicable gates pass. `ESCALATE_USER` is reserved for unavailable
required access/credentials, unauthorized destructive action, an unresolved
product choice or genuine ambiguity, or bounded diagnosis without a reproducible
root cause.
For any runtime-impacting task, terminal completion additionally requires a
named authorized writer deployment owner with Docker/Compose permission and
evidence of rebuilding/restarting the current merged source plus health-checking
actual routes.

## Task contracts

### Bugs first

#### BUG-000 — Docs AI request path

- **IN_SCOPE:** Trace dashboard Docs AI action through API auth, prompt/tool handling, RAG response, citations, and rendering; repair the reproducible defect.
- **OUT_OF_SCOPE:** New AI features, auth weakening, secret exposure, unrelated editor work, and Docs Workspace writes.
- **Owner:** Docs/API writer; verification owner: `@ingenium-qa`.
- **Deployment owner:** `@ingenium-software-engineer-premium` (authorized Docker/Compose writer).
- **Acceptance:** A real authenticated request returns a grounded rendered answer; unauthorized, malformed, oversized, and dependency-failure paths are bounded and actionable; no prompt, token, or stack trace leaks.
- **STOP_CONDITION:** `PASS` after exact user-path API and dashboard checks; `STOP`/`CANCELLED` only on an explicit user request; otherwise continue in scope or use `ESCALATE_USER` only under the rule above.
- **Escalation:** Escalate only if configured provider access is unavailable after the documented path, or the root cause cannot be reproduced after bounded diagnosis.
- **Verification owner:** `@ingenium-qa`; exact Docs AI action, fresh source, API response, rendered citation, console/network review.
- **Rollback/safety:** Preserve auth and content-size guards; revert only the task-owned diff if integration fails; never log secrets.
- **Tests:** API security/broker tests, dashboard Docs AI tests, real configured-provider smoke test, Playwright desktop/mobile exact path.
- **Docs:** `docs/reference/docs-workspace.md`, `docs/develop/api.md` if behavior changes; link-check affected references.

#### BUG-001 — MCP transport and discovery

- **IN_SCOPE:** Diagnose real MCP transport/config, project identity, bearer boundary, discovery, safe invocation, and failure messaging.
- **OUT_OF_SCOPE:** New product tools, provider implementation, unrelated auth redesign, and client-only workarounds.
- **Owner:** MCP/API writer; verification owner: `@ingenium-qa`.
- **Deployment owner:** `@ingenium-software-engineer-premium` (authorized Docker/Compose writer).
- **Acceptance:** A clean client connects, lists tools, and invokes one safe read tool; invalid auth, unavailable server, and malformed requests fail clearly without infinite retries or leaks.
- **STOP_CONDITION:** `PASS` only after a real client smoke test; `STOP`/`CANCELLED` only on an explicit user request; otherwise continue in scope or use permitted `ESCALATE_USER` only for unavailable configured access or unresolved root cause.
- **Escalation:** Do not blame a dependency until the exact payload is tested in isolation; escalate only after bounded producer-side diagnosis.
- **Verification owner:** `@ingenium-qa`; MCP client → API boundary → server discovery → safe tool invocation.
- **Rollback/safety:** Fail closed on identity/auth errors; retain bearer boundaries; revert transport changes without deleting registered tools.
- **Tests:** Real MCP/API smoke test, invalid-auth and unknown-tool tests, config/project-isolation checks, logs review.
- **Docs:** `docs/reference/mcp-tools.md`, `docs/develop/api.md`, and relevant configuration guidance.

#### BUG-002 — External learning namespace and freshness

- **IN_SCOPE:** Verify external project resolution, observation ingestion, extraction, synthesis, current-input freshness, and cross-project isolation.
- **OUT_OF_SCOPE:** New learning algorithms, unrelated skill redesign, historical data cleanup, or changing the global project model.
- **Owner:** Learning/API writer; verification owner: `@ingenium-qa`.
- **Deployment owner:** `@ingenium-software-engineer-premium` (authorized Docker/Compose writer).
- **Acceptance:** A fresh external event lands in the intended project, yields a quality-checked observation/trait or explainable no-op, and never appears in another project; latest timestamps are newer than the test window.
- **STOP_CONDITION:** `PASS` on fresh end-to-end evidence; `STOP`/`CANCELLED` only on an explicit user request; otherwise continue in scope or escalate only for unavailable required LLM access or unreproducible root cause.
- **Escalation:** Counts alone are not evidence; inspect a current sample and trace its namespace before classifying a failure.
- **Verification owner:** `@ingenium-qa`; real API/database pipeline run plus freshness, provenance, deduplication, and quality spot-check.
- **Rollback/safety:** Preserve project isolation and provenance; use isolated test data; roll back only extraction/synthesis changes that fail the evidence.
- **Tests:** Real ingestion/extraction/synthesis test, multi-project isolation, timestamp and output-quality assertions.
- **Docs:** `docs/concepts/self-learning.md` and project identity references.

#### BUG-003 — Backups and restore safety

- **IN_SCOPE:** Exercise create, list, metadata, validated download, preview, restore job status, and failure paths. Backups are owned by the canonical active global project; migration 061 and the startup backfill move legacy per-project ownership into that namespace, while restore remains limited to resources the supported restore implementation actually includes.
- **OUT_OF_SCOPE:** Inventing restore semantics beyond the current per-project behavior and the explicitly planned global-ownership migration, unsupported data restoration, destructive purge, or backup format redesign.
- **Owner:** Core/API writer; verification owner: `@ingenium-qa`.
- **Deployment owner:** `@ingenium-software-engineer-premium` (authorized Docker/Compose writer).
- **Acceptance:** Canonical global backup ownership is documented and tested, including external URL context and legacy-record migration; a backup is created, listed, downloaded only to a validated destination, and previewed; restore requires explicit confirmation, reports terminal status, and does not claim or apply unsupported destructive scope.
- **STOP_CONDITION:** `PASS` only with an isolated real restore; `STOP`/`CANCELLED` only on an explicit user request; unsupported scope uses the stated escalation/acceptance path, including destructive authorization or missing storage access.
- **Escalation:** Never imply global ownership or restore coverage beyond source-verified implementation; stop before destructive execution when scope is ambiguous.
- **Verification owner:** `@ingenium-qa`; isolated real data create/download/preview/restore and failure-path run.
- **Rollback/safety:** Keep source data and backup immutable; restore to an isolated fixture first; retain failed job evidence and use the supported rollback procedure.
- **Tests:** Backup integration tests, path-traversal/confirmation tests, archive integrity, preview-vs-execution assertions, dashboard exact workflow.
- **Docs:** `docs/operations/backups.md` if present, otherwise `docs/operations/index.md`, `docs/reference/mcp-tools.md`, and `docs/reference/index.md` links.

#### BUG-004 — Settings persistence and deep links

- **IN_SCOPE:** Trace settings load/edit/save/sync, project scope, validation, and `?settings=<tab>` navigation.
- **OUT_OF_SCOPE:** New settings categories, provider redesign, unrelated dashboard styling, and source configuration policy changes.
- **Owner:** Dashboard/API writer; verification owner: `@ingenium-qa-vision` for visual and `@ingenium-qa` for behavior.
- **Deployment owner:** `@ingenium-software-engineer-premium` (authorized Docker/Compose writer).
- **Acceptance:** Every tab loads canonical values; valid changes survive reload and sync; invalid input is clear; deep links open the requested tab without wrong-project data.
- **STOP_CONDITION:** `PASS` after desktop/mobile exact paths; `STOP`/`CANCELLED` only on an explicit user request; otherwise continue in scope and escalate only for required unavailable access or unresolved ambiguity.
- **Escalation:** Trace trigger, state setter, and rendered consumer through every early-return branch before escalation.
- **Verification owner:** `@ingenium-qa`; API/dashboard tests and exact deep-link/save/reload path; visual owner supplies screenshots and console/network evidence.
- **Rollback/safety:** Preserve existing settings on invalid writes; use project-scoped fixtures; revert only settings route/client changes.
- **Tests:** API persistence, validation, sync, dashboard tab/deep-link tests, Playwright desktop/mobile.
- **Docs:** `docs/HOW-TO/settings.md`, `docs/configure/index.md`, and `docs/reference/index.md` as needed.

#### BUG-005 — Vault first-run, lock state, and rate limiting

- **IN_SCOPE:** Validate first-run sealed/uninitialized behavior, unseal/seal, item CRUD, password generation, metadata-only reads, audit records, and HTTP 429/rate-limit handling.
- **OUT_OF_SCOPE:** Replacing encryption, weakening lock state, exposing secret values, or unrelated provider throttling.
- **Owner:** Security/API writer; verification owner: `@ingenium-security-auditor` and `@ingenium-qa`.
- **Deployment owner:** `@ingenium-software-engineer-premium` (authorized Docker/Compose writer).
- **Acceptance:** First run gives actionable initialization guidance; sealed vault denies secret access; authorized unseal enables CRUD; list/get omit values; audit has no secret material; 429 responses are bounded, explicit, and do not spin.
- **STOP_CONDITION:** `PASS` after isolated real vault and rate-limit paths; `STOP`/`CANCELLED` only on an explicit user request; unsafe/destructive ambiguity uses authorization escalation, and unavailable passphrase/access uses the permitted escalation path.
- **Escalation:** Treat any secret exposure or unexplained 429 loop as blocking; inspect the real response path rather than relying on mocks.
- **Verification owner:** `@ingenium-qa`; security owner reviews current diff and audit output.
- **Rollback/safety:** Use disposable vault data and test passphrases; never print secrets; seal before cleanup; preserve audit evidence.
- **Tests:** Real isolated vault integration/security tests, first-run/429 tests, metadata and audit assertions, dashboard exact path.
- **Docs:** `docs/security/index.md`, vault operations guidance, and `docs/reference/mcp-tools.md`.

#### BUG-006 — Chat initial paint flash

- **IN_SCOPE:** Reproduce the reported OS-preference and storage-state cold load, then fix the earliest responsible theme/render boundary for Chat and OpenCode surfaces.
- **OUT_OF_SCOPE:** Redesigning Chat/OpenCode, hiding content, or unrelated global styling.
- **Owner:** Dashboard writer; verification owner: `@ingenium-qa-vision`.
- **Deployment owner:** `@ingenium-software-engineer-premium` (authorized Docker/Compose writer).
- **Acceptance:** Under the exact cold-load condition there is no visible flash; Chat preserves messages, hydrates correctly, and shows no console errors at both viewports.
- **STOP_CONDITION:** `PASS` after paint/DOM evidence; `STOP`/`CANCELLED` only on an explicit user request; unrelated visual findings remain follow-up, and escalate only if the exact environment cannot be reproduced after bounded diagnosis.
- **Escalation:** Recreate OS preference, localStorage, cookie, resolution, and browser conditions; instrument paint/DOM channels, not screenshots alone.
- **Verification owner:** `@ingenium-qa-vision`; Playwright exact-condition desktop/mobile check with screenshots and cleanup confirmation.
- **Rollback/safety:** Preserve first-party content and accessibility; revert only theme/bootstrap changes if hydration regresses.
- **Tests:** Paint/DOM regression, Chat/OpenCode smoke, console/network checks, visual artifacts.
- **Docs:** `docs/usage/chat.md` and `docs/usage/dashboard.md` only if user-visible behavior changes.

### MCP improvements

#### MCP-001 — Canonical names, catalog, categories, and toggles

- **IN_SCOPE:** Preserve the built-in catalog's existing extension-tool exceptions. Dynamically imported child tools must use exactly one lowercase `ingenium_<server>_<tool>` name, with the child-server namespace exactly once, across registration, API exposure, dashboard catalog/category display, per-tool toggles, and docs.
- **OUT_OF_SCOPE:** Renaming unrelated public APIs, adding tools, or preserving duplicate-prefix aliases as authority.
- **Owner:** MCP/core writer; verification owner: `@ingenium-qa`.
- **Deployment owner:** `@ingenium-software-engineer-premium` (authorized Docker/Compose writer).
- **Acceptance:** Built-in catalog entries retain their existing approved extension-tool exceptions; every dynamically imported child tool has exactly one lowercase `ingenium_<server>_<tool>` name; category and enabled/disabled state agree across discovery, dashboard, and docs; duplicate-prefix, unknown-category, and missing-registration checks fail deterministically.
- **STOP_CONDITION:** `PASS` after real discovery and catalog UI checks; `STOP`/`CANCELLED` only on an explicit user request; unrelated tools remain follow-up, and escalate only for an incompatible product naming choice.
- **Escalation:** Verify source registration, API projection, dashboard rendering, and docs independently before assigning blame.
- **Verification owner:** `@ingenium-qa`; catalog tests plus real MCP discovery and dashboard category/toggle path.
- **Rollback/safety:** Preserve backward compatibility only as explicitly non-canonical aliases; never expose secrets or silently disable tools.
- **Tests:** Catalog/unit tests, unknown/duplicate ID cases, real discovery smoke, dashboard toggle/category tests.
- **Docs:** `docs/reference/mcp-tools.md`, `docs/reference/index.md`, and MCP configuration guidance.

#### MCP-002 — Observable MCP lifecycle

- **IN_SCOPE:** Bounded startup, health, reconnect, actionable error state, and logs at the transport boundary.
- **OUT_OF_SCOPE:** New transport protocols, infinite retry policies, or unrelated service supervision.
- **Owner:** MCP/API writer; verification owner: `@ingenium-qa`.
- **Deployment owner:** `@ingenium-software-engineer-premium` (authorized Docker/Compose writer).
- **Acceptance:** Real healthy, disconnect, and recovery states are visible; retries are bounded; logs name the failing boundary and the service remains stable.
- **STOP_CONDITION:** `PASS` after disconnect/reconnect evidence; `STOP`/`CANCELLED` only on an explicit user request; external failures outside the contract remain follow-up, and escalate only after a reproducible root cause is unavailable.
- **Escalation:** Check own payload/config and the real service before blaming the dependency; monitor sustained stability when timers/watchers change.
- **Verification owner:** `@ingenium-qa`; real disconnect/reconnect test and bounded health/log observation.
- **Rollback/safety:** Do not bypass auth or turn failures into false healthy states; revert lifecycle changes without killing healthy connections.
- **Tests:** Lifecycle integration test, bounded retry assertions, health/log checks.
- **Docs:** MCP operations and troubleshooting references.

#### MCP-003 — Project identity propagation

- **IN_SCOPE:** Named external sessions, explicit `global-default` ownership for shared resources, and fail-closed unresolved/invalid identity for every MCP call.
- **OUT_OF_SCOPE:** Renaming projects, migrating historical data, or changing the two-project architecture.
- **Owner:** Extension/API writer; verification owner: `@ingenium-qa`.
- **Deployment owner:** `@ingenium-software-engineer-premium` (authorized Docker/Compose writer).
- **Acceptance:** Multi-project calls remain isolated; shared resources target the explicit global project; invalid identity never silently falls back.
- **STOP_CONDITION:** `PASS` after real multi-project isolation; `STOP`/`CANCELLED` only on an explicit user request; historical data outside the task remains follow-up, and escalate only for an unavoidable architecture choice.
- **Escalation:** Read resolver, entrypoint, environment, and architecture sources before deciding ownership.
- **Verification owner:** `@ingenium-qa`; real extension/API/MCP isolation run.
- **Rollback/safety:** Preserve existing project data; use disposable projects; reject unsafe names before writes.
- **Tests:** Resolver, API isolation, MCP project propagation, invalid-name tests.
- **Docs:** `docs/concepts/architecture.md`, project identity sections in `AGENTS.md`, and `docs/VARIABLES.md` where applicable.

#### MCP-004 — Input validation and safe error envelopes

- **IN_SCOPE:** Consistent validation, documented error envelopes, dependency-unavailable handling, and secret/stack-trace redaction without changing successful semantics.
- **OUT_OF_SCOPE:** New business operations, schema redesign unrelated to MCP boundaries, or client-side-only validation.
- **Owner:** API/MCP writer; verification owner: `@ingenium-qa`.
- **Deployment owner:** `@ingenium-software-engineer-premium` (authorized Docker/Compose writer).
- **Acceptance:** Invalid input is rejected at the live boundary with the documented shape; dependency failures are bounded/actionable; raw secrets and internal stacks never cross it.
- **STOP_CONDITION:** `PASS` after real safe-tool and failure calls; `STOP`/`CANCELLED` only on an explicit user request; unrelated schema debt remains follow-up, and escalate only for incompatible external contract decisions.
- **Escalation:** Confirm the schema is actually invoked in the live request path and test the exact malformed payload.
- **Verification owner:** `@ingenium-qa`; route/tool tests plus real safe-tool call.
- **Rollback/safety:** Preserve successful responses and fail closed; do not swallow diagnostic logs needed for support.
- **Tests:** Boundary validation/error tests, redaction tests, real dependency failure smoke.
- **Docs:** `docs/develop/api.md` and `docs/reference/mcp-tools.md`.

#### MCP-005 — Operator reference and dynamic child gateway

- **IN_SCOPE:** Document and verify discovery/auth/project troubleshooting plus dynamic child MCP server registration, gateway routing, Playwright/browser reachability, catalog categories, and enable/disable toggles.
- **OUT_OF_SCOPE:** Implementing child servers or Playwright features not supported by source, and Docs Workspace mutation.
- **Owner:** MCP/docs writer; verification owner: `@ingenium-qa`.
- **Deployment owner:** `@ingenium-software-engineer-premium` (authorized Docker/Compose writer).
- **Acceptance:** An operator can register/list a supported child server, observe its running state, discover dynamically imported tools named with lowercase `ingenium_<server>_<tool>`, filter categories, toggle supported tools, and diagnose three common failures using real configured services; built-in extension-tool exceptions remain intact; Playwright reaches the supported gateway path.
- **STOP_CONDITION:** `PASS` only for source-supported gateway behavior; `STOP`/`CANCELLED` only on an explicit user request; unsupported child capability follows the stated scope boundary, and missing external child access is escalated.
- **Escalation:** Do not document an endpoint or tool as supported without source and real-path evidence; use a bounded diagnosis for gateway failures.
- **Verification owner:** `@ingenium-qa`; real child gateway/discovery and Playwright smoke, plus dashboard catalog/category/toggle path.
- **Rollback/safety:** Register only disposable/test child definitions; avoid real credentials; remove only task-owned registrations after verification.
- **Tests:** Server sync/list/update tests, real child discovery, Playwright browser smoke, catalog UI checks.
- **Docs:** `docs/reference/mcp-tools.md`, `docs/reference/docs-workspace.md` only for relevant gateway references, and `docs/usage/index.md`.

### Context and learning

#### CTX-001 — Canonical context entries

- **IN_SCOPE:** Ownership, schema, tags, priority, project isolation, and CRUD for `/context` entries.
- **OUT_OF_SCOPE:** Replacing TodoWrite, transcript export, or cross-project sharing.
- **Owner:** Core/API writer; verification owner: `@ingenium-qa`.
- **Deployment owner:** `@ingenium-software-engineer-premium` (authorized Docker/Compose writer).
- **Acceptance:** Create/list/search/update/delete are documented and real-tested; entries remain project-isolated; `/context` supports upload of a bounded text/Markdown document with safe metadata and clear failure handling.
- **STOP_CONDITION:** `PASS` after real API upload/CRUD; `STOP`/`CANCELLED` only on an explicit user request; unsupported formats follow the stated scope boundary, and escalate only for required storage access or ambiguous ownership.
- **Escalation:** Verify the actual context owner and upload route before changing schema or namespace.
- **Verification owner:** `@ingenium-qa`; real API CRUD, upload, size/type rejection, and isolation.
- **Rollback/safety:** Preserve provenance and source metadata; reject unsafe paths and oversized uploads; delete only disposable fixtures.
- **Tests:** Context API integration, upload validation, isolation, and metadata tests.
- **Docs:** `docs/reference/mcp-tools.md`, `docs/concepts/architecture.md`, and `docs/reference/docs-workspace.md` only where context/RAG is described.

#### CTX-002 — Retrieval, checkpoints, and version browsing

- **IN_SCOPE:** Bounded relevance/search, batch loading, requested-ID ordering, missing-entry handling, explicit checkpoints, and browsing prior context versions.
- **OUT_OF_SCOPE:** Automatic destructive compaction, unbounded retrieval, or replacing document version history.
- **Owner:** Core/API writer; verification owner: `@ingenium-qa`.
- **Deployment owner:** `@ingenium-software-engineer-premium` (authorized Docker/Compose writer).
- **Acceptance:** Representative queries return relevant bounded results; batch retrieval preserves requested order; checkpoints record recoverable state; version browsing shows history and safe restore/rollback semantics.
- **STOP_CONDITION:** `PASS` after real retrieval/checkpoint/version paths; `STOP`/`CANCELLED` only on an explicit user request; unsupported version operations follow the stated scope boundary, and escalate only for an explicit irreversible product choice.
- **Escalation:** Quality-check returned entries and provenance, not just row counts; trace missing IDs and ordering from producer to response.
- **Verification owner:** `@ingenium-qa`; real retrieval quality spot-check, checkpoint create/read, and version browse/restore fixture.
- **Rollback/safety:** Checkpoints and versions are append-only; restore requires explicit authorization and preserves the current version.
- **Tests:** Search relevance, batch ordering, missing IDs, checkpoint, version browse/restore tests.
- **Docs:** `docs/concepts/architecture.md`, `docs/reference/mcp-tools.md`, and `docs/reference/docs-workspace.md` for RAG/version boundaries.

#### CTX-003 — RAG ingestion and current learning

- **IN_SCOPE:** Connect uploaded/context documents and external observations to durable RAG sources/traits; verify current timestamps, deduplication, provenance, and useful output.
- **OUT_OF_SCOPE:** New embedding providers, wholesale reindexing, or treating counts as quality.
- **Owner:** Core/API writer; verification owner: `@ingenium-qa`.
- **Deployment owner:** `@ingenium-software-engineer-premium` (authorized Docker/Compose writer).
- **Acceptance:** A fresh upload is ingested into RAG, searchable, and answerable with source attribution; current learning input is timestamp-verified and sample output is correct/useful or an explainable no-op.
- **STOP_CONDITION:** `PASS` after real upload→RAG→ask and pipeline evidence; `STOP`/`CANCELLED` only on an explicit user request; unsupported format/provider follows the stated scope boundary, and escalate only for unavailable configured provider access.
- **Escalation:** Log and inspect zero-output reasons, latest timestamps, and a representative result before declaring success.
- **Verification owner:** `@ingenium-qa`; real RAG ingestion/search/ask and learning pipeline quality check.
- **Rollback/safety:** Use isolated sources; retain source IDs and provenance; remove only fixture data through supported deletion.
- **Tests:** RAG ingest/search/ask, upload format/size, freshness/deduplication/quality tests.
- **Docs:** `docs/reference/docs-workspace.md`, `docs/concepts/architecture.md`, and `docs/concepts/self-learning.md`.

#### CTX-004 — Safe maintenance and auditability

- **IN_SCOPE:** Identify stale/conflicting/invalid context, preserve provenance, require explicit authorization for destructive action, and report auditable outcomes.
- **OUT_OF_SCOPE:** Silent purge, automatic policy invention, and unrelated database cleanup.
- **Owner:** Core/API writer; verification owner: `@ingenium-security-auditor`.
- **Deployment owner:** `@ingenium-software-engineer-premium` (authorized Docker/Compose writer).
- **Acceptance:** Candidates are previewable; non-destructive remediation is safe; destructive action requires explicit authorization; audit records identify what changed without secrets.
- **STOP_CONDITION:** `PASS` after isolated maintenance run; `STOP`/`CANCELLED` only on an explicit user request; unsupported destructive behavior requires the stated authorization escalation.
- **Escalation:** Preserve evidence and stop on any ambiguity about scope or irreversible effect.
- **Verification owner:** Security auditor with QA regression of the safe path.
- **Rollback/safety:** Snapshot/fixture first; preserve versions and provenance; use supported rollback or restore, never direct deletion.
- **Tests:** Candidate preview, authorization, audit, no-secret, and rollback tests.
- **Docs:** Operations/context maintenance guidance and `docs/security/index.md` if security behavior changes.

#### CTX-005 — End-to-end context use

- **IN_SCOPE:** Capture a user preference, consolidate it, retrieve it in a relevant later request, omit it when irrelevant, and expose each transition.
- **OUT_OF_SCOPE:** Unrelated personality redesign, transcript export, or automatic Docs Workspace writes.
- **Owner:** Learning/API writer; verification owner: `@ingenium-qa`.
- **Deployment owner:** `@ingenium-software-engineer-premium` (authorized Docker/Compose writer).
- **Acceptance:** A fresh preference survives capture→consolidation→retrieval with provenance and is not injected into an irrelevant request; transitions are observable and current.
- **STOP_CONDITION:** `PASS` after real end-to-end workflow; `STOP`/`CANCELLED` only on an explicit user request; unrelated historical traits remain follow-up, and escalate only for unavailable configured LLM access.
- **Escalation:** Test the exact user sequence and inspect output quality, freshness, and relevance rather than counts.
- **Verification owner:** `@ingenium-qa`; real workflow test with quality spot-check and logs.
- **Rollback/safety:** Use disposable preference data; do not mutate real personality traits without authorization; retain provenance.
- **Tests:** End-to-end capture/retrieve/relevance tests, current timestamp and quality assertions.
- **Docs:** `docs/concepts/self-learning.md`, `docs/concepts/architecture.md`, and context reference links.

### Documentation

#### DOC-001 — Canonical roadmap and documentation operating model

- **IN_SCOPE:** Maintain this single `ROADMAP.md`, stable IDs, complete contracts, dependencies, serialized append-only markers, repository authority, and link/index checks.
- **OUT_OF_SCOPE:** Implementing BUG/MCP/CTX behavior, product source changes, Docs Workspace mutation, or unrelated whitespace.
- **Owner:** `@ingenium-docs`; verification owner: `@ingenium-qa`.
- **Deployment owner:** N/A — documentation-only task; no runtime deployment acceptance.
- **Acceptance:** `docs/reference/index.md` links only to `./ROADMAP.md`; lowercase duplicate is absent; every task has all contract fields; marker parser accepts valid pairs and independent concurrent starts, requires per-task implementation evidence, and rejects malformed, out-of-order, duplicate, and unknown-ID fixtures; markers remain separate from TodoWrite.
- **STOP_CONDITION:** `PASS` after focused validation, Markdown link checks, and `git diff --check`; `STOP`/`CANCELLED` only on an explicit user request; unrelated findings remain follow-up, and escalate only for a required product decision or unavailable check dependency.
- **Escalation:** Do not regenerate unrelated docs; report any link target that cannot be verified from the repository.
- **Verification owner:** `@ingenium-qa`; run append-only marker cases, link validation, and diff checks.
- **Rollback/safety:** Case-only migration must leave exactly one tracked canonical path; preserve historical content only when authoritative; use explicit file paths and never mutate Docs Workspace.
- **Tests:** `tests/test-append-only-files.sh` plus valid-pair, parallel-start, malformed, ordering, duplicate-completion, unknown-ID, duplicate-path, and index-link checks.
- **Docs:** This file, `docs/reference/index.md`, and the focused append-only test only.

## Work boundaries

Phase 0 establishes contracts only. Future execution must declare exact files,
route/agent ownership, acceptance evidence, and rollback before writing. Any
marker pair is appended only after the corresponding TodoWrite task and tests
are complete.
### Work marker log (continued)
<!-- (work-started) MCP-002 2026-07-27T22:41:35Z ingenium-docs -->
<!-- (work-started) MCP-003 2026-07-27T22:41:36Z ingenium-docs -->
<!-- (work-started) MCP-004 2026-07-27T22:41:37Z ingenium-docs -->
<!-- (work-started) MCP-005 2026-07-27T22:41:38Z ingenium-docs -->
<!-- (work-started) CTX-002 2026-07-27T22:41:39Z ingenium-docs -->
<!-- (work-started) CTX-003 2026-07-27T22:41:40Z ingenium-docs -->
<!-- (work-started) CTX-004 2026-07-27T22:41:41Z ingenium-docs -->
<!-- (work-started) CTX-005 2026-07-27T22:41:42Z ingenium-docs -->
<!-- (work-started) DOC-001 2026-07-27T22:41:43Z ingenium-docs -->
<!-- (work-complete) CTX-004 2026-07-28T01:59:11Z ingenium-software-engineer-premium -->
Evidence CTX-004: Core/API/MCP checkpoint governance with migration 066, focused core/API/server tests, typechecks, and DB-isolation enforcement.

## Appended roadmap contracts

The contracts below are appended additions. Existing contracts and marker
records are immutable. Usage work is provider-agnostic: no task requires a
provider-specific credential, account, or live billing access.

### MCP improvements (continued)

#### MCP-006 — Tool control visibility and fail-closed execution

- **IN_SCOPE:** Make disabling a built-in or dynamically registered tool in `/mcp-servers` remove it from the agent/OpenCode visible-tools list and make direct execution fail closed; re-enabling restores visibility and execution. Cover the real UI, API, MCP, deployment, visual, and Windows browser paths.
- **OUT_OF_SCOPE:** Renaming tools, changing catalog semantics, adding new tool providers, weakening authorization, or unrelated dashboard redesign.
- **Owner:** MCP/API/dashboard writer; verification owner: `@ingenium-qa` and `@ingenium-qa-vision` for the visual gate.
- **Deployment owner:** `@ingenium-software-engineer-premium` (authorized Docker/Compose writer).
- **Acceptance:** A real built-in and a real dynamic tool can each be disabled from `/mcp-servers`; neither appears in the agent/OpenCode visible-tools list and direct MCP/API execution fails closed with a safe, deterministic error. Re-enabling restores both visibility and successful execution. The same behavior is proven after deployment and from a Windows browser against the supported localhost/WSL gateway, with no provider-specific credential requirement.
- **STOP_CONDITION:** `PASS` only after deployed API/MCP/UI and Windows browser evidence, exact desktop/mobile visual evidence, and reconciliation of the active marker; `STOP`/`CANCELLED` only on an explicit user request; otherwise continue in scope.
- **Escalation:** Escalate only for an authorization decision, unavailable required Windows/browser or deployment access after the configured path, genuine product ambiguity, or a bounded diagnosis that cannot reproduce a root cause; do not escalate for missing provider credentials because none are required.
- **Verification owner:** `@ingenium-qa`; real dashboard toggle → API state → MCP/OpenCode discovery → direct invocation, deployed health/route checks, and Windows browser acceptance. `@ingenium-qa-vision` owns 1440x900 and 390x844 screenshots, accessibility, console/network, and cleanup evidence.
- **Rollback/safety:** Fail closed on stale or unknown tool state; preserve built-in exceptions and project isolation; use disposable child-server/tool fixtures; revert only task-owned state/filtering changes and never delete registered production tools.
- **Tests:** Focused API state/authorization tests; real MCP discovery and direct-execution tests for built-in and dynamic tools; dashboard interaction tests; deployed Docker/Compose rebuild/restart plus health and route checks; Playwright desktop/mobile visual gate; Windows browser localhost/WSL acceptance with console/network review. No provider-specific credentials or live provider billing account.
- **Docs:** `docs/reference/mcp-tools.md`, `docs/configure/mcp-servers.md`, `docs/usage/dashboard.md`, and affected `docs/reference/index.md` links only if the supported user path changes; verify commands and links.
- **Changed files:** MCP tool-state/API/server/dashboard implementation and focused test files identified by the source trace; the canonical docs listed above only when directly affected.

### Usage and provider-agnostic telemetry

#### USAGE-001 — Provider-agnostic usage event model and collection

- **IN_SCOPE:** Define and collect a provider-neutral usage event model for requests, model/provider identity, tokens, cost, cache read/write, timestamps, status, and unknown values; capture usage from all supported provider response shapes without requiring provider-specific credentials.
- **OUT_OF_SCOPE:** Provider billing integrations, credential management, changing provider routing, invoice reconciliation, or retroactive invention of unavailable token/cost/cache values.
- **Owner:** Core/API writer; verification owner: `@ingenium-qa`.
- **Deployment owner:** `@ingenium-software-engineer-premium` (authorized Docker/Compose writer).
- **Acceptance:** Real configured request paths persist normalized events without leaking prompts, API tokens, credentials, or secrets. Numeric usage-token counters are required for reported request, input, output, and reasoning-token usage; absent counters remain explicitly unknown. Total cost, cache use/read/write state, provider, model, status, and UTC freshness are represented when reported. Cache state distinguishes reported use, read, write, known-zero, and unknown; it does not infer provider hit-rate or miss. No provider-specific credential or account is required.
- **STOP_CONDITION:** `PASS` after focused model/collection tests, real provider-neutral fixture ingestion, deployed health checks, and active-marker reconciliation; `STOP`/`CANCELLED` only on an explicit user request; otherwise continue in scope.
- **Escalation:** Escalate only for an unresolved data-contract choice, unavailable required deployment access, or an unreproducible root cause after bounded diagnosis; missing provider credentials are not an escalation condition.
- **Verification owner:** `@ingenium-qa`; inspect current persisted samples, UTC timestamps, redaction, deduplication, and unknown-value semantics across success, error, streaming, and cache-omitted responses.
- **Rollback/safety:** Append-only or safely upsert usage records with project isolation; never infer billable cost; preserve raw-provider boundaries without storing secrets; roll back only task-owned schema/collector changes using isolated fixtures.
- **Tests:** Unit and integration tests for each normalized field, provider-neutral response fixtures, malformed/partial/streaming responses, reported cache use/read/write, known-zero, and unknown cases, redaction, UTC freshness, and project isolation; deployed Docker/Compose health check. No provider-specific credentials.
- **Docs:** `docs/concepts/architecture.md`, `docs/develop/api.md`, and `docs/reference/index.md` only for directly affected usage-data behavior; verify links and commands.
- **Changed files:** Usage schema/collector and focused core/API tests, plus the canonical docs listed above only when directly affected.

#### USAGE-002 — Usage API aggregation and export

- **IN_SCOPE:** Provide project-scoped API aggregation for totals, daily UTC series, provider/model breakdowns, filters, freshness, and export of the normalized usage data, preserving unknown cost/cache values.
- **OUT_OF_SCOPE:** Billing calculations, provider-specific dashboards, invoice export formats, credential flows, or unrelated analytics and reporting.
- **Owner:** API/core writer; verification owner: `@ingenium-qa`.
- **Deployment owner:** `@ingenium-software-engineer-premium` (authorized Docker/Compose writer).
- **Acceptance:** Real API calls return total cost, request count, required numeric token totals, input/output tokens, cache use/read/write state when reported, daily charts data, provider/model breakdown, UTC filter boundaries, freshness metadata, and export output. Cache state distinguishes reported use, read, write, known-zero, and unknown; it does not infer provider hit-rate or miss. Unknown cost/cache remains distinguishable from zero; invalid filters and unauthorized projects fail safely. No provider-specific credential is required, and no credential or API token leaks.
- **STOP_CONDITION:** `PASS` after real API aggregation/export tests, deployed route/health checks, and source-verified examples; `STOP`/`CANCELLED` only on an explicit user request; otherwise continue in scope.
- **Escalation:** Escalate only for a genuine aggregation/export contract decision, unavailable deployment access, or an unreproduced root cause after bounded diagnosis; provider credentials are explicitly out of the required path.
- **Verification owner:** `@ingenium-qa`; verify real project isolation, inclusive/exclusive UTC ranges, empty periods, unknown fields, pagination/size bounds, deterministic export, and safe error envelopes.
- **Rollback/safety:** Bound query/export size, authorize project scope, redact secrets, and avoid destructive migration; roll back only task-owned routes/query code if deployed checks fail.
- **Tests:** API integration and contract tests for totals, daily series, filters, provider/model grouping, freshness, unknown cost/cache, export, authorization, range limits, empty results, and deployed Docker/Compose route checks. No provider-specific credentials.
- **Docs:** `docs/develop/api.md`, `docs/reference/mcp-tools.md` only if an MCP export tool is exposed, and `docs/reference/index.md` only if a new canonical link is required.
- **Changed files:** Usage API/aggregation/export implementation and focused API tests, plus directly affected canonical docs listed above.

#### USAGE-003 — `/usage` dashboard

- **IN_SCOPE:** Add a dashboard `/usage` view consuming the usage API with total cost, requests, tokens, input/output/cache read/write when reported, daily charts, provider/model breakdown, filters, UTC/freshness display, export, loading/empty/error states, and graceful unknown cost/cache presentation.
- **OUT_OF_SCOPE:** Provider-specific branding or billing controls, credential setup, invoice management, unrelated dashboard navigation redesign, or fake values for omitted telemetry.
- **Owner:** Dashboard writer; verification owner: `@ingenium-qa` and `@ingenium-qa-vision` for visual acceptance.
- **Deployment owner:** `@ingenium-software-engineer-premium` (authorized Docker/Compose writer).
- **Acceptance:** A real `/usage` route renders current API data and clearly labels total cost, requests, required numeric tokens, input/output, cache use/read/write state when available, daily charts, provider/model breakdown, filters, UTC range, freshness, and export. Cache state distinguishes reported use, read, write, known-zero, and unknown rather than inferring provider hit-rate or miss. Missing cost/cache is shown as unknown/not reported rather than zero; loading, empty, API failure, and export states are actionable. No provider-specific credential is required, and no credential or API token leaks.
- **STOP_CONDITION:** `PASS` after deployed route acceptance, exact desktop/mobile visual gate, accessibility/console/network review, and run-scoped screenshots; `STOP`/`CANCELLED` only on an explicit user request; otherwise continue in scope.
- **Escalation:** Escalate only for an unresolved product choice about unknown-data wording, unavailable deployment/browser access, or an unreproduced root cause after bounded diagnosis; do not require provider credentials.
- **Verification owner:** `@ingenium-qa` owns API-to-UI behavior and export; `@ingenium-qa-vision` owns 1440x900 and 390x844 layout, chart readability, accessibility, console/network, and browser cleanup.
- **Rollback/safety:** Do not fabricate telemetry or expose secrets; preserve existing navigation and project scope; revert only task-owned route/components/API client changes.
- **Tests:** Dashboard unit/component and real API integration tests; Playwright `/usage` filters/export/empty/error/unknown-data paths; Docker/Compose rebuild/restart and actual route health check; visual screenshots under `tests/artifacts/visual-qa/<run-id>/`. No provider-specific credentials.
- **Docs:** `docs/usage/index.md`, `docs/usage/dashboard.md`, and `docs/reference/index.md` only when the new route is directly documented; verify links and commands.
- **Changed files:** Dashboard `/usage` route/components/API client and focused tests, plus directly affected usage docs and index links.

#### USAGE-004 — Cross-provider and cache-state accuracy

- **IN_SCOPE:** Validate normalization and aggregation across provider-neutral fixtures representing different provider response shapes, model names, token counters, cache read/write reports, omitted fields, retries, errors, and streaming completion.
- **OUT_OF_SCOPE:** Acquiring provider credentials, testing live provider billing, redefining provider contracts, or estimating cost/cache data that the provider did not report.
- **Owner:** Core/API writer; verification owner: `@ingenium-qa`.
- **Deployment owner:** `@ingenium-software-engineer-premium` (authorized Docker/Compose writer).
- **Acceptance:** Cross-provider fixture runs produce identical canonical semantics for equivalent usage, count requests exactly once across retries/stream completion, preserve required numeric token counters, and distinguish reported cache use/read/write, known-zero, and unknown without inferring provider hit-rate or miss. Provider/model breakdown and UTC daily totals remain correct without double counting. No provider-specific credential is required, and no credential or API token leaks.
- **STOP_CONDITION:** `PASS` after focused cross-provider accuracy tests, deployed smoke/health checks, and evidence review; `STOP`/`CANCELLED` only on an explicit user request; otherwise continue in scope.
- **Escalation:** Escalate only for a mutually exclusive canonical interpretation, unavailable deployment access, or an unreproduced defect after bounded diagnosis; never escalate solely because a provider omits a field.
- **Verification owner:** `@ingenium-qa`; compare fixture inputs with persisted events, aggregate totals, export rows, and `/usage` API responses, including unknown and retry cases.
- **Rollback/safety:** Keep unknown values unknown, avoid billing inference, isolate fixtures, and roll back only task-owned normalization/deduplication changes.
- **Tests:** Table-driven provider-neutral unit/integration tests, streaming/retry/error/cache-state accuracy tests, UTC boundary tests, export/API regression, deployed Docker/Compose checks, and dashboard contract smoke. No provider-specific credentials or live billing access.
- **Docs:** `docs/concepts/architecture.md`, `docs/develop/api.md`, and `docs/usage/dashboard.md` only for directly affected semantics; verify links and commands.
- **Changed files:** Usage normalization, deduplication, aggregation, and focused cross-provider tests, plus directly affected canonical docs.

#### USAGE-005 — Usage end-to-end, documentation, and visual acceptance

- **IN_SCOPE:** Close the provider-agnostic usage path from request collection through API aggregation/export and `/usage` dashboard acceptance, including docs, deployment, visual QA, and browser acceptance.
- **OUT_OF_SCOPE:** New provider integrations, credentials, billing reconciliation, unrelated dashboard pages, and changes to previously accepted roadmap contracts.
- **Owner:** Usage integration writer; verification owner: `@ingenium-qa` and `@ingenium-qa-vision`.
- **Deployment owner:** `@ingenium-software-engineer-premium` (authorized Docker/Compose writer).
- **Acceptance:** A fresh provider-neutral fixture produces a UTC-fresh usage record visible through totals, requests, required numeric tokens, input/output, reported cache use/read/write, known-zero, and unknown states, daily charts, provider/model breakdown, filters, export, and graceful unknown cost/cache states. Documentation matches the supported path. Rebuilt/restarted deployment passes actual route/health checks; desktop/mobile visual evidence and Windows browser acceptance cover the route without provider-specific credentials.
- **STOP_CONDITION:** `PASS` only after E2E, docs/link, deployment, visual, accessibility, console/network, cleanup, and Windows browser evidence are complete; `STOP`/`CANCELLED` only on an explicit user request; otherwise continue in scope.
- **Escalation:** Escalate only for unavailable required deployment/Windows browser access, an unresolved product decision, or a bounded diagnosis without a reproducible root cause; provider-specific credentials are not required and cannot be used as a prerequisite.
- **Verification owner:** `@ingenium-qa` owns the real fixture→API→dashboard/export path and deployed acceptance; `@ingenium-qa-vision` owns 1440x900/390x844 screenshots, accessibility, console/network, and cleanup.
- **Rollback/safety:** Use disposable usage fixtures, preserve project isolation and redaction, never claim unsupported cost/cache precision, and revert only task-owned usage integration changes.
- **Tests:** Full targeted E2E with provider-neutral fixtures, API/export assertions, `/usage` browser tests, docs/link and command checks, Docker/Compose rebuild/restart and health checks, visual QA artifacts under `tests/artifacts/visual-qa/<run-id>/`, and Windows localhost/WSL browser acceptance. No provider-specific credentials.
- **Docs:** `docs/usage/index.md`, `docs/usage/dashboard.md`, `docs/develop/api.md`, `docs/concepts/architecture.md`, and `docs/reference/index.md` only where directly affected; no Docs Workspace mutation.
- **Changed files:** Usage integration, E2E/visual test files, and directly affected canonical docs listed above; do not regenerate unrelated indexes.

### Work marker log (continued)

<!-- (work-started) MCP-006 2026-07-28T02:57:10Z ingenium-docs -->
<!-- (work-started) USAGE-001 2026-07-28T02:57:11Z ingenium-docs -->
<!-- (work-started) USAGE-002 2026-07-28T03:29:19Z ingenium-docs -->
<!-- (work-started) USAGE-003 2026-07-28T03:29:20Z ingenium-docs -->
<!-- (work-started) USAGE-004 2026-07-28T03:29:21Z ingenium-docs -->
<!-- (work-started) USAGE-005 2026-07-28T03:29:22Z ingenium-docs -->
<!-- (work-complete) BUG-003 2026-07-28T12:10:00Z ingenium-docs -->
Evidence BUG-003: Backup core/API tests (`packages/ingenium-core/tests/backups.test.ts`, `services/ingenium-api/tests/backups-api.test.ts`), backup directory hardening in commit `6743616`, preserved Docker volumes, and deployed image HEAD `730b9669`.
<!-- (work-complete) BUG-004 2026-07-28T12:10:01Z ingenium-docs -->
Evidence BUG-004: Settings/provider persistence and deep-link coverage in `tests/ingenium-dashboard/settings-providers.spec.ts` and commit `685ca9d`, with desktop/mobile visual artifacts in `tests/artifacts/visual-qa/run-20260728-roadmap-usage-final/`.
<!-- (work-complete) BUG-005 2026-07-28T12:10:02Z ingenium-docs -->
Evidence BUG-005: Vault CRUD/crypto/rate-limit coverage in `packages/ingenium-core/tests/vault*.test.ts`, `services/ingenium-api/tests/vault-api.test.ts`, and the repository security-boundary checks recorded in the session.
<!-- (work-complete) BUG-006 2026-07-28T12:10:03Z ingenium-docs -->
Evidence BUG-006: Chat theme/paint regression coverage in `tests/ingenium-dashboard/theme-flash.spec.ts` and `tests/ingenium-dashboard/chat-states.spec.ts`, commit `685ca9d`, and final desktop/mobile artifacts under `tests/artifacts/visual-qa/run-20260728-o1-685ca9d/`.
<!-- (work-complete) MCP-001 2026-07-28T12:10:04Z ingenium-docs -->
Evidence MCP-001: Catalog parity and child-tool naming/state coverage in `services/ingenium-server/tests/tool-visibility.test.ts`, `services/ingenium-core/tests/mcp-tools/catalog-parity.test.ts`, and the catalog implementation committed in `cdc5678`.
<!-- (work-complete) MCP-002 2026-07-28T12:10:05Z ingenium-docs -->
Evidence MCP-002: Child gateway lifecycle/runtime coverage in `services/ingenium-server/tests/child-mcp-runtime.test.ts`, `services/ingenium-server/tests/child-mcp-gateway.test.ts`, and gateway implementation commit `36deb4a`, with deployed health evidence at `tests/artifacts/visual-qa/run-20260728-o1-685ca9d/status-six-processes.png`.
<!-- (work-complete) MCP-003 2026-07-28T12:10:06Z ingenium-docs -->
Evidence MCP-003: Project resolver/identity implementation and isolation coverage in `packages/ingenium-extension/project-resolver.ts`, `docs/concepts/architecture.md`, and the global-agent/security-boundary acceptance recorded for commit `7a5eb2c`.
<!-- (work-complete) MCP-004 2026-07-28T12:10:07Z ingenium-docs -->
Evidence MCP-004: Safe MCP/API error and launcher coverage in `services/ingenium-api/tests/mcp-status-contract.test.ts`, `services/ingenium-api/tests/mcp-launcher.test.ts`, and `packages/ingenium-extension/mcp-launcher.test.ts`; QA/security PASS is recorded for commit `7a5eb2c`.
<!-- (work-complete) MCP-005 2026-07-28T12:10:08Z ingenium-docs -->
Evidence MCP-005: Dynamic child gateway implementation and tests in commit `36deb4a`, catalog/operator documentation in the repository, and deployed Windows/gateway visual evidence including `mcp-tool-catalog.png` under `tests/artifacts/visual-qa/run-20260728-o1-685ca9d/`.
<!-- (work-complete) MCP-006 2026-07-28T12:10:09Z ingenium-docs -->
Evidence MCP-006: Fail-closed tool visibility implementation and focused API/server/dashboard tests in commit `cdc5678`, deployed image HEAD `730b9669`, and final Windows desktop/mobile evidence with zero console errors and listed API responses 200 under `tests/artifacts/visual-qa/run-20260728-o1-685ca9d/`.
<!-- (work-complete) CTX-001 2026-07-28T12:10:10Z ingenium-docs -->
Evidence CTX-001: Canonical context CRUD/API/server coverage in `packages/ingenium-core/tests/context-conversations.test.ts`, `services/ingenium-api/tests/context-conversations-api.test.ts`, and the context route implementation; final context desktop/mobile artifacts are under `tests/artifacts/visual-qa/run-20260728-o1-685ca9d/`.
<!-- (work-complete) CTX-002 2026-07-28T12:10:11Z ingenium-docs -->
Evidence CTX-002: Checkpoint/version governance implementation and focused tests in commit `d725d49`, including migration 066 and core/API/server coverage; preserved volumes and deployed acceptance were recorded in the session.
<!-- (work-complete) CTX-003 2026-07-28T12:10:12Z ingenium-docs -->
Evidence CTX-003: RAG ingestion/search/ask coverage in `packages/ingenium-core/tests/context-rag*.test.ts` and `services/ingenium-api/tests/context-rag-api.test.ts`, commit `cedb7c7`, plus live Docs AI/RAG Ask and extraction-synthesis acceptance.
<!-- (work-complete) CTX-005 2026-07-28T12:10:13Z ingenium-docs -->
Evidence CTX-005: End-to-end capture/retrieval integration in `services/ingenium-api/tests/context-e2e.test.ts` and commit `7c4640e`, with current session evidence of 88 observations and 37 traits and final context/observations visual artifacts.
<!-- (work-complete) DOC-001 2026-07-28T12:10:14Z ingenium-docs -->
Evidence DOC-001: This canonical `docs/reference/ROADMAP.md`, repository-authoritative documentation model, marker protocol, and `docs/reference/index.md` link were inspected; `tests/test-append-only-files.sh` is the declared validation.
<!-- (work-complete) USAGE-001 2026-07-28T12:10:15Z ingenium-docs -->
Evidence USAGE-001: Provider-neutral schema/collector implementation and focused tests in commits `cedb7c7` and `85dbc85`, with `services/ingenium-api/tests/usage-sync.test.ts` and session evidence of fresh normalized telemetry without provider-specific credentials.
<!-- (work-complete) USAGE-002 2026-07-28T12:10:16Z ingenium-docs -->
Evidence USAGE-002: Usage aggregation/export API implementation and tests in commit `85dbc85`, `services/ingenium-api/tests/usage-api.test.ts`, and usage route/network evidence under `tests/artifacts/visual-qa/run-20260728-roadmap-usage-final/`.
<!-- (work-complete) USAGE-003 2026-07-28T12:10:17Z ingenium-docs -->
Evidence USAGE-003: `/usage` dashboard implementation and focused browser/component tests in commit `e942e91`, with desktop/mobile screenshots and route evidence under `tests/artifacts/visual-qa/run-20260728-o1-685ca9d/`.
<!-- (work-complete) USAGE-004 2026-07-28T12:10:18Z ingenium-docs -->
Evidence USAGE-004: Provider-neutral normalization and cache-state tests in `packages/ingenium-core/tests/usage.test.ts` and `services/ingenium-api/tests/usage-sync.test.ts`, with final usage acceptance and API-200 network evidence in both recorded visual runs.
<!-- (work-complete) USAGE-005 2026-07-28T12:10:19Z ingenium-docs -->
Evidence USAGE-005: End-to-end usage implementation commits `cedb7c7`, `85dbc85`, and `e942e91`; deployed image HEAD `730b9669`; prior usage visual evidence under `tests/artifacts/visual-qa/run-20260728-roadmap-usage-final/`; final Windows desktop/mobile evidence under `tests/artifacts/visual-qa/run-20260728-o1-685ca9d/`.
