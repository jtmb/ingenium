# Hosted OpenCode original retirement boundary

The pinned OpenCode 2.0.11 public HTTP surface cannot produce the required
original-targeted physical retirement receipt. No positive `observeTurn` or
`observeControl` proof producer was fabricated. Source inspection is not runtime
qualification. Voice call acceptance remains open; CPU dictation does not gain
working-agent execution authority from its separate speech supervisor.

All primary references below are fixed at commit
`9eb6902aaf3c35ce985b67c605a775992249066b`:

| Primary source | Exact finding |
| --- | --- |
| [SessionExecution](https://github.com/anomalyco/opencode/blob/9eb6902aaf3c35ce985b67c605a775992249066b/packages/core/src/session/execution.ts#L18) | Internal interrupt options include `awaitSettlement`; its contract distinguishes original interrupted execution cleanup from `awaitIdle`, which follows successors. |
| [Run coordinator](https://github.com/anomalyco/opencode/blob/9eb6902aaf3c35ce985b67c605a775992249066b/packages/core/src/session/run-coordinator.ts#L87) | One process-local busy period owns an actual fiber and private Deferred.done. It can coalesce multiple inputs. The settled hook finishes before map replacement/removal and Deferred.done resolution at lines116–119. |
| [Terminal publication](https://github.com/anomalyco/opencode/blob/9eb6902aaf3c35ce985b67c605a775992249066b/packages/core/src/session/execution.ts#L121) | The settled hook publishes execution success/failure/interruption with sessionID. Receiving that event is earlier than the original coordinator's final done barrier. |
| [Session operations](https://github.com/anomalyco/opencode/blob/9eb6902aaf3c35ce985b67c605a775992249066b/packages/core/src/session/session.ts#L259) | Session.wait awaits session-wide idle; Session.interrupt exposes only resume at lines309–311. Neither returns the original execution handle or accepts an original execution ID. |
| [HTTP handler](https://github.com/anomalyco/opencode/blob/9eb6902aaf3c35ce985b67c605a775992249066b/packages/server/src/handlers/session.ts#L597) | Public interrupt forwards only resume. It does not expose the internal awaitSettlement option. The session log is an event stream, not a join handle. |
| [Protocol](https://github.com/anomalyco/opencode/blob/9eb6902aaf3c35ce985b67c605a775992249066b/packages/protocol/src/groups/session.ts) | Prompt ACK is durable inbox admission. Inbox cancel is a no-op when the item is unavailable. Active is session-keyed process-local activity; experimental wait has no original/inbox selector or terminal receipt. |
| [Event schema](https://github.com/anomalyco/opencode/blob/9eb6902aaf3c35ce985b67c605a775992249066b/packages/schema/src/session-event.ts) | Inbox delivered/cancelled carries inboxID. Execution started/succeeded/failed/interrupted carries sessionID, without original operation/execution/inbox identity. Those labels do not establish a one-to-one execution owner. |
| [Runner step](https://github.com/anomalyco/opencode/blob/9eb6902aaf3c35ce985b67c605a775992249066b/packages/core/src/session/runner/step.ts#L128) | Local tool fibers have scoped joins. This internal step discipline does not export a join capability through the session API. Background jobs have separate service scopes. |

The actual installed protocol/schema packages report 2.0.11. Root's r3 and r4
read-only schema receipts record the same full upstream schema digest
`2fa254eff9933cf357e61fe918a2b4f8ccfda5e750fcb4299134f9685beab28a`
and 249,841 bytes. They retain different selected operation/component projections;
neither projection alone is treated as an exhaustive raw-schema copy. Their
prompt, interrupt, active, inbox and experimental wait shapes corroborate the
pinned protocol. The private evidence receipt records exact installed source hashes.

The existing API client's `streamRequest` has no AbortSignal input and its fetch
omits signal; `opencodeClient.streamEvents` exposes no cancellation during header
acquisition. Cancelling an eventual reader does not prove that a pending original
fetch has returned. The original response reader, fetch, callback delivery and
control promises would all need retained cancellation and positive joins before
local observation cleanup could be reported. Even completing those local joins
would not prove remote original execution retirement.

The source hardening makes this boundary enforceable:

- `hosted-lifecycle.mjs` records the pinned public transport as unavailable for
  original retirement/interrupt, and exports a refusal guard for Root's hosted
  factory before scope/resource/model admission. No event-shaped object enables it.
- `CurrentAgentVoiceAdapter.availability` reports that concrete missing primitive,
  even when an event observer function has been injected. Historical fixture
  transport tests remain fixtures, not production readiness.
- A Core-backed interrupt must target the exact retained watch/original object
  and call its actual original constructor's interrupt/join capability. Missing
  capability refuses before generic inbox cancellation, active reads or session
  interruption. There is no public-session fallback.
- VoiceService submits that opaque proof through `CoreVoiceOperations.retire` to
  actual Core.retireOriginal before reopening a session. A success boolean, copied
  proof fields or absent proof cannot pass the original Core verifier. Private
  proof never enters the public response. Failure retires local admission and
  keeps the durable original unknown.
- Core-backed turn/control observers stay retained when submit returns or fails.
  Only `finalizeOriginal` after the actual Core acceptance releases their local
  handles. Generic session close refuses to discard retained uncertain originals.
  An already-retired completed original may be recognized by Core's retained
  retirement ID; it needs no new session interruption merely to stop playback.

The missing primitive is an actual owner-retained original execution handle,
captured at admission and tied to the exact original operation/inbox, with a
post-finalizer settlement join and original-specific interruption. It must account
for coalesced work, successor admissions and independently scoped child resources.
The existing private coordinator handle cannot be recovered from HTTP IDs later.
Adding `awaitSettlement=true` to the public interrupt request would currently be
unmapped and would still not supply the missing original capture/identity.

Safe constructor choices require Root review of actual existing authority. An
already-existing in-process original owner may expose its retained constructor
handle and positive join through a Veyra-owned adapter, if one is actually present;
none was evidenced on this hosted HTTP path. A genuine original runtime manager
can eventually finalize its own retained scope when that scope is independently
retired for its existing lifecycle; it cannot manufacture per-turn proof from
labels or recreate an owner after failure. No new session/model/engine, copied
transcript, upstream edit, per-turn engine shutdown or container disappearance
heuristic is an authorized replacement. If no such actual constructor is available,
Root must retain the missing feature gate and resolve the primitive/architecture
boundary before enabling working-agent voice. The full requested acceptance scope
is preserved.

Validation adds refusal of the pinned hosted capability and missing original
interrupt target before HTTP, plus failure of generic positive interrupt ACK to
reopen a Core-backed session. Existing source fixtures pass. No model, helper,
server, live session, SSE subscription, upstream edit or device was started.
