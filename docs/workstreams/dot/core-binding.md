# Existing core/scheduler adapter

`services/ingenium-api/lib/dot-v2/core-binding.ts` implements the requested injectable binding around the existing API `getDb`, `execTransaction`, `checkpointAfterWrite`, `jobs.getJob/getJobRun/startJobRun/cancelJobRun/isJobRunAuthorizationCurrent` and existing job runner. It introduces no database opener, timer, event writer, transcript, credential, queue, project catalog or runtime fallback.

## Integration prerequisite discovered in actual core

The baseline core `jobs.startJobRun` calls `checkpointAfterWrite` after its own transaction. Inside Dot's outer atomic transaction this is still inside a savepoint/outer write transaction. Core `lib/db.ts` explicitly warns that a WAL checkpoint in this state causes SQLITE_LOCKED. The included `core-scheduler-insertion.patch` therefore proposes one core condition: checkpoint only when `!db?.inTransaction`. Keep the accumulated write count and flush after the outer commit. Coordinator alone may apply/review this shared change and reconcile the adjacent core comment. Test the actual core at the 50-write checkpoint threshold, including rollback and nested-savepoint paths, before activation. The adapter requires the explicit `nestedCheckpointPolicy: "deferred-by-core-v1"` admission; this is a coordinator prerequisite, never browser/request input.

The adapter passes `retries=1` to the outer `execTransaction` so it does not replay an unknown callback. Existing core performs its own nested database claim. The adapter requires its own transaction to be top-level, validates the same singleton connection before every repository statement, and refuses database replacement after restore rather than continuing on an old writer. It calls the checkpoint helper only after the outer transaction returns. A post-commit checkpoint error is reported separately and does not erase the known committed claim.

## Composition root (coordinator-owned)

```ts
const dot = createCoreDotRuntime(
  { getDb, execTransaction, checkpointAfterWrite, jobs },
  dotAuthorization,
  dotBindingPolicy,
  {
    executeJobRun, // only for a qualified binding supported by this exact existing runner
    requestCancellation: cancelQualifiedOwnedRun,
    inspectOwnedRun: inspectQualifiedOwnedRun,
  },
  {
    nestedCheckpointPolicy: "deferred-by-core-v1", // after the core patch and threshold tests pass
    now: () => new Date().toISOString(),
    id: randomUUID,
    onDiagnostic: recordSanitizedDotDiagnostic,
  },
);
startScheduler(port, dot);
```

`DotAuthorization` retains the explicit approving owner as logical scope identity and rechecks current authorization/capabilities/source/memory eligibility. It does not mint an owner session or bypass the automation service principal. Core still checks its current active service-principal/project grant at claim, and `isJobRunAuthorizationCurrent` is checked again after commit before launch. `CoreDotBindingPolicy.authorizeJob` must check actual user/org membership/visibility, capability grants, runtime readiness and exact immutable workspace fingerprint. Organization-owned jobs retain organization grants; user-owned jobs must match the owner. `authorizeRun` must verify history/cancellation scope and current caller permission without granting new execution privileges.

The existing compatibility job runner is not an arbitrary native/WSL dispatcher. `authorizeJob(...,"dispatch")` must reject any requested execution binding that this exact injected runner cannot honor. A label, selected directory or runtime ID is insufficient; there is no fallback to the API working directory or another host. Projectless remains rejected until an actual authorized projectless execution contract exists. Do not inject the legacy runner for a new native binding simply to make tests pass.

`requestCancellation` must use the existing process-ownership-safe cancellation/termination pipeline. `inspectOwnedRun` may report cancelled only after genuine terminal/settled-process evidence; an optimistic DB status or missing local handle is not enough. Unknown process ownership remains unknown. The adapter verifies every inspected/cancelled run against its original scoped Dot operation/follow-up and core project/org/job identity.

`executeJobRun` is invoked only for a run freshly returned by the just-committed claim. Generation stop or grant/binding revocation before this first invocation cancels that exact unlaunched core run and records the admission failure. Any rejection after invoking the launcher is uncertain: the operation/run identity is retained as unknown and is never launched again by a replay. Cancellation intent stays pending if that was already requested. Diagnostics must be nonthrowing, sanitized and preserve the first failure.

## Minimal scheduler insertion

The patch leaves the existing singleton timer/generation/active-task/fairness and event-queue code in charge. On each existing cron cycle it reconciles up to 100 open operation projections, selects bound jobs into the existing fair-dispatch list, and routes each owned job through `dispatchJob`. The legacy cron branch skips those bound jobs, including paused bindings. `dispatchJob` does not create a timer or enqueue another delivery. Existing lifecycle tracking waits for the returned promise; shutdown generation prevents admission/launch and the existing runner lifecycle owns actual process teardown.

API composition must pass this adapter explicitly to `startScheduler(port,dot)`. Omitting it retains the existing scheduler and leaves Dot scheduling inactive. Do not add a polling route, second interval, new background process or global runtime registry. `recoverOperations` also handles persisted cancellation intent after restart, through the existing lifecycle hook. Internal notifications forward known actionable failures/unknown outcomes while unchanged or capacity-wait states stay quiet. Meaningful-success signals still come from the qualified existing task/result hook; the adapter does not infer a content change from process success.

## Evidence and remaining acceptance

The dependency-free CPU adapter suite uses real in-memory SQLite for both the fixture core claim and Dot records and simulates the existing nested savepoint/checkpoint contract. It proves same-connection rollback, after-commit launch, generation/grant revocation, uncertain-launch identity/no replay, source/binding rechecks, database replacement denial and cancellation-intent reconstruction. It does not claim that mocked core functions are the real production core. Coordinator must run the exact adapter with actual core grants/50-write threshold, real process inspection, native binding qualification and singleton restart/shutdown after applying the shared patch. No shared core or scheduler source was edited by this worker.
