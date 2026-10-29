# Dot integration contract and remaining gates

This consumer proposal follows the coordinator-owned `docs/contracts/veyra-parallel-v1.md` read from the coordinator checkout on 2026-10-29. It does not replace ProjectRef, ExecutionBinding, MemoryPolicy, task/job/event or authorization authorities.

## Required ports

`DotScope` stores organizationId, ownerUserId, nullable projectId, executionBindingId, executionBindingFingerprint and nullable conversationId. The fingerprint must be computed by the trusted API resolver from the authoritative host/environment/workspace identity/hash/epoch and native revision. It is not a browser label or client grant. Every database key includes all these values. A changed/offline/revoked binding is an error, never a native/WSL/cluster fallback.

`Authorization.require(actor,scope,action,capabilities)` must recheck the existing actor/org/project/capability rules for read/suggest/approve/cancel/notify/dispatch. It must throw on denial. Scheduling does not widen per-tool grants. `requireSource` must verify the exact source receipt/event/message belongs to this scope and remains eligible; known visibility denials use DotError codes DOT_FORBIDDEN, DOT_SOURCE_REVOKED or DOT_NOT_FOUND so collection reads suppress revoked source content while unexpected failures remain errors; arbitrary browser source IDs are untrusted. `canReadMemory` applies the real read/use policy separately from contribution/extraction. Dot never enables extraction or treats retrieved content as instructions.

The outer HTTP router must already run existing authentication, authorization, rate limiting and mutation CSRF middleware. `resolveContext` must derive identity and scope from trusted request/session/project/runtime bindings. Do not use body identity headers, compatibility principals or a synthetic global project. Scheduler identity uses the already authorized automation service principal and retained user ownership; the actor ID in Dot denotes the approving owner, not permission to impersonate them. `DotQueueReader` must apply the existing queue visibility and exact scope filters, returning metadata only; no payload, replay or queue mutation endpoint is added.

`ExistingJobPorts.resolveAuthorizedBinding` must verify job ownership/visibility, execution binding/fingerprint, conversation, exact prompt, complete tool capabilities, enabled state and current job/schedule revisions. Existing grants must remain active at claim and runtime tool execution. `cancelOwnedRun` must use the existing process-ownership/cancellation pipeline. `inspectOwnedRun` must verify visibility and return cancelled only on actual terminal evidence; absence of a local process alone is unknown.

`ProactiveSources.isEnabled` must use an explicitly configured per-scope policy; absence is disabled. `readEligible` reads at most 20 authorized existing task/job/event/memory-derived proposal inputs and provides stable provenance references including source revision. Invoke `collectProactiveSuggestions` from the existing lifecycle/event hook. It authorizes before source discovery and uses a deterministic scoped source key so restart, repeated events, dismissal and unknown admission responses cannot create duplicates. Changing source content requires a new source revision/reference; it does not overwrite earlier provenance. This consumer does not create new trusted-event types or write another event queue.

## Single writer and scheduler

1. Coordinator allocates the schema SQL through the existing API-owned migration mechanism. No worker connects to live data or changes the writer.
2. Inject the same API SQLite connection and a synchronous transaction wrapper. `jobs.startJobRun` and the Dot operation/cursor write must commit or roll back together. The core currently uses nested `better-sqlite3` transactions; coordinator must verify savepoint behavior and avoid WAL checkpoint side effects inside the outer transaction. Do not supply a network/async claim adapter or a second connection. A real core integration test must inject an operation-write failure after claim and prove no orphan run remains.
Scheduler cursor progress uses its own expected-cursor plus user-revision CAS. It does not increment the user edit revision, so background ticks do not invalidate open Pause/Cancel actions. Idle cursor writes are coalesced to one minute; due operations still persist atomically immediately. User mutations load the fresh cursor and advance their own revision. Keep these updates on the same single-writer transaction/connection.

3. Dot-bound jobs must have `schedule_cron=NULL`; the existing singleton scheduler selects their due times through `DotService.reconcile` and the existing core claim. Do not add a timer or run the same job through legacy cron selection as well. Keep the existing fairness, organization/principal quotas, lifecycle generation/cancellation and event queue.
4. After the transaction commits, existing scheduler/runner code launches returned `claimed` run IDs through `executeJobRun`. Never launch a process inside `claim`. Existing startup recovery handles a crash between commit and launch; Dot retains that operation/run identity. No automatic replay of an uncertain launch.
5. Known core reasons `Job already has a running or queued run` and `Automation concurrency quota is full` may retain the cursor for a later admission attempt. All other blocked outcomes are inspectable and consumed; unknown execution does not re-admit. `all` catch-up drains one due occurrence each tick, allowing existing nonoverlap/concurrency limits to remain authoritative.
6. Scheduler calls recover/notify using existing lifecycle hooks and current scope permissions. Notification generation is internal and meaningful-only; sending email/chat/desktop messages would require a separately authorized existing transport.

## API and UI

`createDotRouter(service,resolveContext,queue)` supplies paginated GET collections/items and POST commands. There is intentionally no HTTP dispatch/replay endpoint. The OpenAPI proposal is in `openapi.json`. Public errors use `{error:{code,message}}`; the coordinator should append its existing request correlation ID and retain first diagnostic failures without exposing SQL/paths/prompts/secrets.

Mount `DotWorkspace` in the Work UI slot/route with initial authenticated pages, exact scope, matching authorized task-template choices, typed Server Actions and next cursors. `commandAction` returns a fresh scoped snapshot or a known/unknown outcome; `refreshAction` verifies state before enabling further actions. `loadMoreAction` returns the accumulated authorized snapshot for that section, scoped to the current request, with bounded underlying API pages. Never cache one user's snapshot across scope/session changes. Refresh must resolve uncertain command outcomes by reading durable records, not by resubmitting them. Existing jobs create/edit/template controls supply the approved task before Dot approval; no browser-supplied shell command or arbitrary execution target is accepted.

## Open acceptance

- Exact integrated TypeScript/React check and HTTP 2xx/4xx/5xx, CSRF/auth expiry/rate-limit tests with real middleware.
- Shared migration and existing core same-connection/savepoint/rollback tests; public/private/org isolation; memory policy and exact binding revocation in real request/scheduler execution.
- Singleton start/stop/restart/cancellation and process termination evidence; event queue continuity; one run per occurrence across API restart and capacity backpressure.
- Integrate the implemented “Skip missed runs” recovery command/control for long-offline (>eight-day or >100 occurrence) windows. It records a durable skipped range after CAS and authorization checks; active runs and pause state survive. Verify it with the actual singleton scheduler and user scope. Automatic admission still refuses oversized windows without changing its cursor.
- Projectless task execution contract through projects/foundation; current adapter rejects it rather than creating a global project.
- Live Work navigation, schedule/template selection, pagination, stale revisions, keyboard/focus, loading/empty/failure/auth-expired states, mobile/desktop and 100–200% scale; blue mascot remains shared-shell owned.
- Windows/native/WSL, Linux Kubernetes persistence/restart/rollback and final screenshot acceptance by coordinator.

None of these gates is closed by CPU unit tests or fixture rendering.
