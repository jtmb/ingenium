# CLOSED internal MemorySynthesis purpose: source contract, not native acceptance

Root authorized this purpose in the original provider/model owners. This
proposal supplies genuine source admission, closed immutable payload and strict
result formats, original queue Book custody/interlocks, distinct transport
correlation, and additive content-free rows in the SAME ProviderAttemptStore.
It supplies NO positive native producer or fabricated Task grant.

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

## Exact unsupported producers: do not install a working-claiming ingress

The source contract deliberately returns
MemorySynthesisUnavailable::OriginalRegistrySlotProducer before ANY native
effect. This is not a completed connected generation implementation.

Pinned service constructors still require the Task path:

- RequestIdentity::new(&SessionGrant, &RuntimeTarget);
- registry/request_admission.rs::CandidateRequest { grant: SessionGrant };
- provider/acquisition.rs::NativeOriginals requires SessionGrant,
  DurableTaskAdmission and TaskActivity::RequestProgress;
- acquisition/retirement.rs::enroll and slot_yield.rs require that Task
  RequestProgress/grant and original epoch chain.

Root must reconcile these SAME owners with distinct MemorySynthesis variants,
including one shared active registry slot, genuine internal source/model grant,
Core operation-UUID lease, original native acquisition and sealed known-result
producer. Do not feed a memory purpose into the old Task constructors. The
tagged transport identity is the proposed compatibility surface, not proof
that the existing Task-specialized supervisor already accepts it.
The original model owner must also enforce its actual context/token budget
without truncating source, and qualify the existing backend's closed JSON
request/response options. Byte/elapsed/output caps alone do not prove model fit.

After that source API is frozen and reviewed, the ORIGINAL productivity worker
must capture under Serial/current owners, RELEASE all Serial/hook/ProjectStore/
GoalStore guards, await that retained provider request, then reacquire actual
owners and consume KnownMemorySynthesisResult::accept -> Goals.accept_learning.
The existing helper is never wired to a fake/always-successful model callback.
No second scheduler or public synthesis/utility HTTP route is proposed.

Future Plugins/Skills utility synthesis must use the same original private
model-purpose owner through separate Root-approved CLOSED variants. This
MemorySynthesis contract exposes no general prompt, method, headers or URL API.

## Effect-free evidence and remaining gates

Five actual in-memory SQLite tests consume the proposed migration: Task schema/
record-byte preservation, cross-purpose spent UUIDs, scoped input dedup after
yielded metadata, strict content-free-column shape, and failed-migration
rollback. Existing five JS adapter/source-manifest tests remain included.
Rust budget/UUID/payload/result tests are authored, not executed.

No Native apply, Cargo/rustc/npm/build, engine/model process, GPU/inference,
service, external write or desktop control occurred. Native purpose
registration/slot/acquisition/result production, completed-worker invocation,
actual restore/cleanup workflow, original Task regression and full private/
Project runtime qualification remain OPEN. This contract is not a substitute
for those gates.
