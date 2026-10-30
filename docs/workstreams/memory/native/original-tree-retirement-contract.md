# Original LiveRuntime tree retirement: source audit and integration contract

Owner: existing Memory worker 01a18935-0219-7cc0-88be-368fa7fa330c. Root is the
consumer and sole Native integrator. This is an interface proposal, not applied
Rust, a new cleanup authority, or qualification. No Native source was changed.

Storage: reuse the existing approved C-backed Ubuntu VHDX source checkout
`veyra-phase-1/parallel/memory` and output root `veyra-phase-1/coordination/memory`
under `/home/brajam/.local/state/ingenium-release/skill-zen-fix-1792810845/real-gmail-ui`.
The existing 20 GiB ceiling and 15 GiB reserve remain. This stage creates only
this durable source contract and its small source-hash manifest; no builds,
fixtures, dependencies, caches or scratch. Preserve source, lockfiles, immutable
Work1 commits, actual Native, prior rejected cleanup targets and unique evidence.
Regenerate by repeating the named source reads and SHA256 inventory. Retain these
two inputs until Root integrates or explicitly supersedes the contract.

## Observed owners, kept distinct

Read-only actual `windows-source` has private `OwnedEngine` at
`crates/adapters/src/opencode/desktop_runtime.rs:137`; `LiveRuntime` owns it in
`Mutex<Option<OwnedEngine>>` at 424. Direct Windows launch uses the actual
`OwnedProcessJob::spawn` at 1104, assigning a suspended child to a retained Job
before resuming it. `OwnedProcessJob::is_empty` queries that handle's
`ActiveProcesses`; leader exit alone is explicitly insufficient.

`OwnedEngine::stop_windows_tree_until` (186) queries/terminates/waits on that
same Job. Its isolated branch delegates ownership rather than proving emptiness
itself. `stop_linux` (310) uses retained Linux launch/owner originals.
`settle_workers` (250) stops the credential transport, signals the monitor and
joins retained monitor/event/bootstrap handles. These are genuine existing
operations, but return only unit results. `LiveRuntime::stop_until` (1230) calls
these, relay stop and isolation-original close, then clears the slot. The
automatic exited-child path in `lock_engine` (2788) also clears it. `Drop` (2825)
ignores cleanup results; it cannot issue positive retirement authority.

**Confirmed source gap:** `settle_workers` takes handles before testing join
results (290–307). After an error the taken handle is gone.
`prevent_isolation_close` in `isolated_wsl.rs:191` latches failure only for
`EngineProcess::Isolated`. A Direct engine retry can therefore observe `None`
instead of the previous failed join. Any new positive witness must persist the
actual original's joined/failed result across retries; absence is insufficient.
This is source reasoning, not an executed fault reproduction.

Work1 immutable `fbf7b19218337d4b2a08a233ca752d4326db6e8b` composes frozen
094c34e39b7ba62e7e3d3e45cd1e77d4432d48ed and
492f77695e812be14889978eb80dce821d0ef815. Its
`original-proxy/followon-094c/.../web_completion.rs` retains actual request,
outcome, dispatch, private completion identity and writer publication in a slot
enrolled before HTTP. `local_web_transport.rs::OriginalWebPromptRequest` owns a
separate blocking reqwest Client and retained Response, including partial/error
paths. `execute_retained` is synchronous under the slot state mutex; observing
Unknown/Complete means that invocation returned, not that the Client/Response
physically closed. There is no sender JoinHandle in this type, and no checked
socket/client shutdown operation. The event/monitor joins are different owners.
Its no-proxy/no-redirect/no-retry/30s timeout settings are bounds, not joins.

The fbf7 `windows-join-492f/windows-read-join.patch` carries the actual
`NativeWindowsWebRead` through `NativeWebFileInput` and the dispatch slot.
`NativeWebReadJoined` binds the actual held read Arc, completion identity,
operation/input and response hash. Same-writer `NativeWebPublished` plus this
genuine materialization witness permits Sending→Joined→Closing→checked close.
Unknown, partial, oversized, absent ACK and failed close retain ownership.
Publication is stored BEFORE fallible close, and repeat publication is refused.
This deliberate one-shot gate needs a separate retirement arm; resubmitting the
publication cannot implement it. Close failures remain spent, not retryable.

Actual Native currently has only the earlier `local_workspaces/web_original.rs`
lease/capture/inspection path, not these Work1 completion/transport files. The
manifest distinguishes actual files from immutable proposal inputs; no composed
Work1 behavior is reported as applied Native behavior.

Memory's applied but uncompiled d1+99b code concerns another owner chain:
`IdleEngineRetirement` retains exact `StartingEngineRecord`, `ReadyOriginal`,
`EngineOriginalCensus`, `CompletedEngineActivity` and `EngineCleanupOriginal`.
Its `check_resources` calls the actual sealed cleanup original; activity
`check_current` re-reads actual task rows and compares original Arc allocations
and terminal proofs. This is the saved-task `NativeEngineOwner` chain. Neither
matching PID, model, registration string nor an empty task census makes it the
private LiveRuntime `OwnedEngine`. Do not convert these proofs into the proposed
LiveRuntime witness without an original allocation link established at launch.
The 31 newly authored d1+99b Rust cases remain uncompiled/unrun here.

## Required typed contract

Names below describe new private types and constructor obligations, not existing
APIs or compilable stubs. No DTO/Deserialize/public constructor, arbitrary
callback, PID lookup, boolean argument or copied JSON may create these types.

1. **LiveEngineOriginal**: allocate one private Arc seal before launch, retain it
   in the actual OwnedEngine and its per-engine completion registry generation.
   Lease, dispatch, request slot and held-file carrier capture that same Arc
   while the actual engine guard is held, before I/O. Compare original Arc
   identity plus the exact registry allocation/generation. Keep existing
   binding/session/operation/input checks; strings are supplementary evidence.
   The credential revision counter alone is not an engine-generation identity.
   No post-stop reconstruction from registration, engine_key or journal JSON.

2. **RetiringLiveEngine**: an actual lifecycle owner freezes new leases,
   reservations and sends for that generation under the engine admission gate,
   then captures the exact retained slot allocations and their file carriers.
   Include pre-send, interrupted and published-but-unclosed entries. Preserve
   the same original gate and owner on every error; do not replace Option with
   None or permit new startup while retirement is pending. Generation identity
   must survive moving OwnedEngine; do not use its stack address.

3. **LiveEngineTreeExited**: the private lifecycle method alone constructs this
   for the same seal after positive same-child exit AND zero active processes
   in its same Windows Job, plus the applicable retained namespace/Linux tree
   and relay obligations. The isolated branch's early unit return is not a
   witness. Bind retained monitor/event/bootstrap/credential transport joins
   and original isolation close through typed sub-results. Distinguish tree
   exit from OS handle release: Job Drop currently ignores CloseHandle's result.
   If full handle retirement is claimed, add checked close of actual handles;
   do not claim that from a tree-empty query.

4. **OriginalWebTransportClosed**: the actual request owner must settle the
   active sender and close its actual client/response transport, for the same
   frozen slot allocation. Current Work1 has no checked physical-close primitive
   for reqwest; a successful mutex acquisition proves only absence of a current
   synchronous executor. Neither dropping a Client/Response nor HTTP error,
   timeout, EOF, response status, monitor_stop or engine death certifies checked
   transport closure. Root must select/implement an owned transport with a
   genuine bounded worker shutdown/join and explicit close proof, or keep this
   arm unavailable and retain the originals. A no-op wrapper around Drop is not
   an implementation. Pending/Joined/Failed results must persist across retry;
   panic/poison/uncertainty cannot become an empty Option and then success.

5. **OriginalWebTreeRetirement**: constructor is restricted to the actual frozen
   registry after it matches (2), (3), (4) and the exact request/file census to
   the same original engine/generation. Recheck all original memberships before
   consumption. No live worker/borrower may remain; use actual ownership/admission
   state, not a detached count snapshot. A registry-wide tree witness does not
   automatically authorize an unrelated slot or carrier. Per-slot consumption
   must bind completion identity, operation/input, writer identity, actual held
   read Arc and current close state. Never manufacture NativeWebReadJoined: tree
   retirement does not mean the original message was admitted/materialized.

6. **OriginalWebRetirementDisposition**: issued only by the original ProjectStore
   writer for this slot and operation. It either seals existing uncertain
   original retirement metadata without changing admission, or seals the
   store's actual tombstone/suppression disposition. This is a new distinct
   type, not an invented ACK or synthetic NativeWebPublished. Existing unknown
   original/source bytes remain nonreplayable. Missing writer or uncertain
   durable write retains the original. A prior genuine publication may be
   referenced without publishing it twice; it cannot substitute for tree and
   transport proofs.

7. **ClosedOriginalWebRead**: actual held carrier consumes the matching (5)+(6)
   once, enters Closing before physical work, uses its real checked-close
   machinery and seals success only after every retained original handle is
   positively closed. Allow Held/Sending only with proved original disposition;
   never reinterpret a previous Closing/CloseFault as retry permission. A prior
   checked-close fault remains retained even after tree/transport retirement.
   Remove the slot only after this carrier's close seal and sender/transport
   seals are retained. On partial progress retain the exact original and its
   spent states; do not reconstruct it for a second attempt.

These are separate facts. Joining the sender, exiting the engine, publishing a
durable disposition and closing file handles cannot stand in for one another.
The normal materialization path stays intact; this alternative addresses only
genuine retirement of the same original tree and transport.

Retain the actual private partial response bytes and original failure phase
after tree/read close: retirement does not turn an uncertain outcome into an
empty success or erase its original failure evidence. Do not drop the sole
private observation with slot removal. Transfer it to the same authorized
original writer's retention owner before consuming the slot, respecting actual
privacy/tombstone disposition; do not copy suppressed content back into a new
record. Keep diagnostic custody separate from a transport resource lifetime.

## Integration and lock boundaries

Route explicit stop, automatic child-exit cleanup, failed startup cleanup and
service shutdown through one retained retirement owner. Drop can retain/refuse
or perform best-effort cleanup but never mint a witness. Startup/activity/store
retirement must consult pending generations; None is allowed only after complete
original reconciliation. Retire only the selected generation, not all retained
process/transport owners globally.

Use bounded acquisition of lifecycle/registry state. Current `stop_until` uses
blocking `engine.lock()` despite its deadline; wrapping it does not create a
bounded retirement API. Freeze/capture under the actual admission gate, release
metadata locks, perform original physical stop/join/close outside ProjectStore,
provider, task_originals and serial locks, then reacquire and revalidate exact
generation/census before publishing consumption. No HTTP/await/join while a
ProjectStore lock or borrowed saved-task startup history token is held. Current
submit holds the engine guard and slot mutex through HTTP; account for that
ordering rather than acquiring registry→engine in a concurrent retirement path.

Cleanup of known-owned originals remains possible after opt-out/revocation, but
cannot authorize new generation, publication content, inference, dispatch or
memory acceptance. The writer checks actual suppression/tombstone state and
current placement/ownership; a tombstoned original gets a typed suppression
disposition without recreating its prompt/source/learned entry. Preserve existing
stable source/content/entry suppressions and restore union. Retirement neither
accepts stale synthesized output nor reopens a forgotten source. Foreign, active
or uncertain owners stay fenced. No new public cleanup/replay route.

## Root qualification gates (not run by this worker)

Compile the exact integrated Rust tree first. Then exercise original owner
substitution (same PID/string, different Arc), registry replacement, stale
generation, concurrent send during freeze, every retained slot disposition,
worker panic/error followed by retry, poison, partial/oversized/error transport,
unknown durable publication, same-writer mismatch, close fault before/after
publication, and source forget/opt-out/restore during cleanup. Verify active
owners remain fenced, originals never resend and failed close is never retried.
Actual Windows Job descendants, owned transport close/join and real checked
handle-close fault cases remain necessary; metadata/source tests cannot qualify
them. Full Native/UI/Linux/model and phases 1–7 acceptance remains Root-owned.

Cleanup receipt: new disposable paths none; removed paths none; measured bytes
removed 0. Retain this contract and companion hash manifest for Root review.
Previously protected cleanup-rejected fixtures remain untouched. No Linux or
Windows recovery claim. No runtime/compile acceptance and no full-goal completion.
