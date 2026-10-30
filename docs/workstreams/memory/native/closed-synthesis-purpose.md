# CLOSED internal MemorySynthesis purpose: source contract, not native acceptance

Root authorized this purpose in the original provider/model owners. This
proposal supplies genuine source admission, closed immutable payload and strict
result formats, original queue Book custody/interlocks, distinct transport
correlation, and additive content-free rows in the SAME ProviderAttemptStore.
It supplies a genuine producer in those existing owners without fabricated
Task grants. All changes remain unapplied and uncompiled in this worker.

## Actual implementation in owned source

- provider/memory_admission.rs::MemorySynthesisAdmission::capture constructs its
  opaque non-Deserialize/non-Clone owner from the ACTUAL held ProjectStore,
  NativeMemoryOwner/LocalWorkspaceBinding, registered engine and canonical
  completed-source snapshot. Model/profile/quant/context come from the actual
  selected engine; current Core residency must match. No caller model, Task,
  Project substitute, credential, URL or arbitrary prompt is accepted.
- Exact source refresh, current policy/chat contribution, suppression, processed
  inputs, owner, loaded model and budget are checked again before model work.
  The original operation UUID remains spent; result acceptance constructs
  stable entry identity/time/provenance from that original, never generated IDs.
- The pure domain builds one fixed extraction instruction plus JSON source
  data, tools=[], tool_choice=none, nonstreaming bounded JSON response. Output
  may contain ONLY bounded content, with exact bytes preserved. Format parsing
  is explicitly not a request/result grant. Defaults: input <=256KiB of encoded
  source, output <=4096 bytes/1024 tokens, elapsed budget <=60s. A timeout requests
  cancellation; it cannot prove native retirement or release anything.
- inference/provider_queue/memory.rs adds a distinct purpose in the ORIGINAL
  Book, byte/entry budget, original QueueWorker and CancellationHandle. It
  creates no SessionGrant, task_id, project_id, second queue mutex, scheduler or
  writer. Task claim/scheduling observes earlier memory reservations, and a
  memory unknown fences the same queue. Reservation is metadata only.
- inference/request_purpose.rs provides a tagged common transport identity:
  Task contains the existing unchanged RequestIdentity; MemorySynthesis has
  actual operation/scope/input/model/runtime correlation and NO Task fallback.
- provider_attempts/0003.sql adds memory_attempts to the ORIGINAL attempts.db.
  The old Task table/rows/record bytes are not rewritten. UUIDs cannot be reused
  across purposes; a scoped input stays spent after yielded metadata. The
  SAME ProviderAttemptStore validates schema and data, commits once and returns
  store-bound yielded metadata. No prompt/content/credential is stored there.
  Startup rejects either Task or memory pending rows. Yield still requires
  actual original transport/native retirement/resume by the service consumer.
  Older v2 writers refuse v3; no schema fallback or second database.

## Primary-code backend wire audit

All observations are from immutable Native4e8e2943; Windows inference engine
source and binary are unchanged.

1. inference/owned_transport.rs::build_request strips the original request
   metadata, actor/authentication and runtime headers, fixes POST
   /v1/chat/completions and retains the original body. It does NOT send
   RequestIdentity.task_id/turn_id to the backend.
2. model/request_authentication.rs::RuntimeRequestAuthentication is minted only
   from the actual sealed ModelWork-owned socket and original ManagedLaunch.
   new/apply binds canonical request UUID, runtime generation, ModelBinding
   and original launch custody. It has no TaskStore admission.
3. model/managed_strata.rs::ManagedLaunch::add_headers supplies only the retained
   bearer plus x-veyra-runtime-launch, x-veyra-runtime-binding and optional
   x-veyra-runtime-request. No Task/turn compatibility labels are required.
4. model/request_barrier.rs retains request UUID/epoch/sequence/original
   connection custody, with no TaskStore fields. No task_id/turn_id occurrences
   were found in the model adapter or the retained Strata patch sources.

Thus there is no basis for adding a fake Task or changing backend wire/API.
Service-only purpose/correlation extensions must reuse the SAME sealed socket,
RuntimeRequestAuthentication, fixed transport, native barrier/resume owner,
retained supervisor, cancellation and actual lease owners. EOF, parsed stop,
idle transcript, a cancelled waiter or metadata alone is never retirement.

## Genuine producer in existing owners; actual Native gates remain open

The original registry active slot stores a tagged Task/Memory identity. Task
CandidateRequest, SessionGrant, DurableTaskAdmission and RequestIdentity retain
their original semantics. MemoryCandidate/MemoryClaim require the genuine
current source/model admission and Core utility lease, with no Task fallback.
TransportPurpose is sealed to Task/Memory; both use the same generic private
handshake, framing, native authentication, start, supervisor and retirement.

Originals::Memory in the original ProviderAcquisition chain retains actual
socket/tree/observer/authenticated transport, journal attempt and cleanup
capabilities. Its worker is retained in the same ProviderQueue Book before
the first native effect. Native return capabilities stay in the acquisition
and TransportSupervisor; the waiting caller receives response control only.
KnownMemorySynthesisResult can be minted only after matching actual native
retirement, resumed observation, retired controls, same-journal yielded receipt,
shared slot release and terminal release of the exact operation-UUID lease.
EOF, cancellation and output parsing cannot mint that result or release leases.
Invalid output can leave a known retired request without a learned entry;
uncertain native cleanup retains the original and fences the shared queue.

Full-chain history includes both purposes; Task-only history skips Memory
without fabricating a Task row. Complete transport census uses tagged identities.
Original shutdown preparation now captures the retained Memory phase owner
against the actual ShutdownOriginal before model stop, retains the exact parent
and phase capture, then signals original cancellation. In-flight cleanup uses
that parent's existing compare_resume_progress against the reserved real model
original, rather than bypassing the busy ModelWork owner. The original shutdown
admission flow joins the same queue workers outside Serial before final cleanup
eligibility. Waiting no-native entries are joined too; a model/shutdown fence is
rechecked before any queued entry can acquire a new utility lease or original.
Resume waits under one retained metadata deadline for ordinary or actual
captured-parent admission before starting its Native phase. Observation and
control retirement recheck that admission. Metadata retry starts no Native work.

Original ProviderHistory retains those same Memory phase captures (or captures
already-retired historical books), checking complete mixed-chain membership and
capture identity/deadline. Capture permanently closes further setup in the
original book. Repeated inspection reuses its old cap and cannot renew it.
Capture contention, unpublished setup, an incompatible deadline or uncertain
native cleanup fails closed and retains the original; no cleanup receipt is
fabricated. Root must qualify the actual combined global shutdown/closure
workflow; that runtime gate remains open.
The original model owner must also enforce its actual context/token budget
without truncating source, and qualify the existing backend's closed JSON
request/response options. Byte/elapsed/output caps alone do not prove model fit.

The ORIGINAL productivity worker now captures under Serial/current owners,
releases all Serial/hook/ProjectStore/GoalStore guards, awaits the retained
provider request, then reacquires Serial and consumes the known result through
Goals.accept_learning. Bounded discovery reads completed hook records or
admitted original local prompt records, never a new transcript database.
Each hinted user message must be selected by the actual fresh completed source
snapshot. Cursors are ephemeral discovery metadata, not execution authority.
No second scheduler or public synthesis/utility HTTP route is added.

Future Plugins/Skills utility synthesis must use the same original private
model-purpose owner through separate Root-approved CLOSED variants. This
MemorySynthesis contract exposes no general prompt, method, headers or URL API.

## Effect-free evidence and remaining gates

Five actual in-memory SQLite tests consume the proposed migration: Task schema/
record-byte preservation, cross-purpose spent UUIDs, scoped input dedup after
yielded metadata, strict content-free-column shape, and failed-migration
rollback. Existing five JS adapter/source-manifest tests remain included.
Rust budget/UUID/payload/result tests are authored, not executed.
The same attempt journal now refuses spent UUID/scoped inputs or full capacity
at enrollment and again before utility lease acquisition, before socket/native
setup. Final commit repeats the exact check transactionally.

No Native apply, Cargo/rustc/npm/build, engine/model process, GPU/inference,
service, external write or desktop control occurred. Actual Native compile and
purpose/slot/acquisition/result qualification, completed-worker execution,
shutdown phase capture, restore/cleanup workflow, original Task regression and
full private/Project runtime qualification remain OPEN. This contract is not a substitute
for those gates.
