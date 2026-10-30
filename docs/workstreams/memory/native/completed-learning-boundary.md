# Original completed-turn / model-admission integration boundary

This follow-on closes two source defects and proposes an additive genuine
projectless original. It does **not** claim that generation has been connected.
The missing model-purpose admission contract is a concrete remaining blocker.

## Observed original owners

Native4e8e2943:

- live_agent/lifecycle.rs::start owns the existing two-second productivity
  worker, Serial, hook_serial and progress loop. progress confirms an exact
  original prompt message before persisting HookIntent.turn_outcome/completed.
  HookStore.all_pending deliberately excludes completed records.
- project_actions/lifecycle.rs::HookStore owns retained Project HookIntents,
  including complete original Project PromptOriginal. No separate completion
  journal is needed or proposed.
- desktop_runtime.rs::PromptRecord and prompt_scoped_checked are the actual
  write-before-submit owner for prompt request/message identity and unknown
  admission. Frozen Projects8b composes prompt_scoped_checked_local with a
  genuine LocalWorkspaceBinding/current-registry callback.
- Frozen LocalOperation::AgentTurn has only session_id/text. The existing
  private caller supplies original=None, so old PromptRecords have no genuine
  retained local owner. Existing Project PromptOriginal requires a real Project.

The proposed LocalPromptOriginal is separate from Project PromptOriginal and
does not change the frozen AgentTurn input. The actual original prompt writer
captures its complete LocalOperationRequest, request hash, real engine identity,
session/model snapshot, effective-text hash and actual context before the sole
upstream effect. PromptRecord.local_original is optional for old records; old
ownerless originals remain ineligible and are never rebound. The source adapter
now understands genuine Project OR local originals, never both. Requires Root
review of every constructor, receipt/lookup publication and rollback writer
preservation before Native runtime acceptance.

## Source corrections in this proposal

The authorized bounded32 page is scanned for adjacent canonical completed
user/final-assistant pairs. Unmatched offset records, tool/multiple-assistant
turns that do not form a qualifying pair, and an unrelated unfinished later
tail are excluded; they do not reject earlier verified pairs. Foreign session
members and duplicate IDs refuse the page. There is no cursor walk, chat-wide
quiescence or replay of a user prompt. Refresh still reads exact selected IDs
and rejects any changed/deleted/nonterminal selected pair.

External provenance deserializes the actual retained memory witness and
HookConfig. Null memory or an empty admission is known empty; only actual
saved/learned entries, injected files/skills, hook actions or tool-bearing
canonical content count as external. Malformed/unrecognized context remains
unknown and cannot qualify a source. New empty previews retain memory=null,
preserving the existing no-memory prompt/steering boundary. Retained originals
with an empty wrapper remain byte-stable and classify correctly.

Seven authored Native source cases exercise these real helper functions:
offset/unfinished tail, unrelated multi-assistant records, foreign/duplicate
members, exact selected refresh, null/empty/unknown memory, actual pinned entry,
and metadata-only versus actual hook action. They have not been executed here.

## Required concrete lifecycle composition

Use the existing productivity worker, not a second scheduler:

1. Its blocking phase reads bounded completed Project HookIntents from the
   original HookStore and genuine local PromptRecords from the original prompt
   owner. Candidate IDs are hints, never source proof. Do not make a GET read
   dispatch generation.
2. Under original current ProjectStore/OS/engine authority and GoalStore mutex,
   call actual Goals.capture_learning. The canonical bounded snapshot enforces
   idle interval and independent policy/chat opt-ins. Retain snapshot only in
   the original operation's in-memory work item; do not create another durable
   transcript or a pending-memory journal.
3. Release Serial, HookStore, ProjectStore and GoalStore guards before awaiting
   model work. The current lifecycle worker holds Serial/hook_serial inside
   its blocking progress closure: awaiting provider queue admission there
   would deadlock on the same Serial.
4. The original model/provider owner admits a CLOSED memory-synthesis purpose
   with actual Native Project or local custody, source/input hash, model
   identity, deterministic operation identity and no tools/skills/external
   transport. Its existing request owner must durably capture the exact prompt,
   own cancellation/unknown outcome and retain the response. Existing originals
   are receipt-only reads; no automatic model replay on response loss/restart.
5. On its matching known successful result, reacquire original current owners,
   refresh exact selected sources and call actual Goals.accept_learning.
   Source/policy/owner changes, suppression, duplicates or unknown model outcome
   refuse acceptance. Populate provenance from the captured verified input,
   never source IDs or model names invented by generated JSON.

No new worker or speculative effect invocation is shipped in this proposal:
the required original model admission method has not been identified.

## Exact blocking contract

Pinned Native provider.rs::prepare_and_start delegates to provider/queue.rs.
That actual owner obtains GatewayRegistry.provider_residency_grant and
DurableTaskAdmission from authenticated correlated native request metadata,
the original engine epoch, current residency and real TaskStore. It is not a
general service-bearer text-completion API. ModelWorkOwner owns model operations;
it does not expose a standalone scoped text-extraction request.

Creating fake Tasks/Projects, borrowing a later user request, calling the model
port directly, or posting an extraction prompt into the user's chat would
bypass or change these owners. None is proposed.

Minimum next contract: Root supplies or extends the original provider/model
owner with the closed Project/local memory-synthesis admission and retained
result API, including actual authority construction and no-tool request policy.
Then the worker can implement the existing productivity worker's two-phase
capture -> original model request/result -> accept calls against its real
signature. A trait or invented method name alone does not close this boundary.
