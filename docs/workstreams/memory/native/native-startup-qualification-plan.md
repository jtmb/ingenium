# Retained startup reconciliation follow-on

Owner: memory worker 01a18935-0219-7cc0-88be-368fa7fa330c. Depends on frozen
25-test/store/queue source checkpoint d1bcb3c7. That source/delta stays intact.
Reuse the same approved C-backed source/output roots; no new drive/root,
compiler, runtime, native process, fixture, model, GPU or desktop action here.

Actual service references exist at both task_submission/root_engine::inspect
calls, tasks/initial::preflight, the retained enrollment closure, and the final
publication closure. These now pass their state/authority to
preflight_retained_startup and publish_initial; no caller terminal DTO is added.

OriginalTaskSlots constructs a private-field, non-Clone/non-Deserialize borrowed
StartupQueueHistory tied to the actual service, held ledger, exact optional
startup allocation and original deadline. Every prior engine must still have
its actual completed IdleEngineRetirement. That original validates its native
resource completion, exact ledger/task membership, and its existing sealed
CompletedEngineActivity against fresh TaskActivity/TaskStore rows. No second
capture_completed_engine call relocks the already-borrowed task_originals map.
The complete rows must bijectively match the retained task allocations.

Provider startup consumes this evidence through the same d1 typed queue/
acquisition/native/journal cleanup check and exact registry engine census,
then freshly rechecks the borrowed history and fixed deadline. Unknown,
unjoined, orphaned or mismatched owners remain blockers. Retained ownership
has_retained/shutdown_blocked semantics and every row/proof stay unchanged.
The separate initial/pristine local-only compatibility path is preserved.

Six new actual-owner Source tests exercise empty available owners, missing
TaskStore, loss of the actual store after construction, closed original ledger,
the exact enrolled inert startup versus a foreign same-ID allocation, and
expired deadline. They use the existing inhibited in-memory service fixture and
actual enrollment APIs, not a fake positive engine/retirement. No disk fixtures
or new runtime output: conservative fixture disk budget 0 bytes. Existing
Root compiler/test binary envelope and original storage/source/lease guards
still apply. No tests are executed by this worker.

Use the existing qualified Native runner, underlying selector:

    cargo test --locked -p veyra-service --lib routes::tasks::retained::startup_queue::tests::

prepare-startup-delta.ps1 only reads current Root Native source and produces
startup-delta.json: ten exact operations across five existing source files,
two absent sources. prepare-proposal.ps1 still verifies the whole canonical
proposal against immutable Native4e. Keep only source, hashes and minimal
review/test receipts. No disposable bulk was generated or removed in this
worker stage. Actual positive post-retirement startup, model/cancel/retirement/
shutdown lifecycle and UI/platform acceptance remain Root runtime gates.
