# Production call assembly: bounded proposal, not mounted

Owner: Voice worker7, 01a18935-1617-7d31-8e56-f77df7b6c756.
Same declared C-backed WSL task root and 393216-byte source budget; no generated
dependencies, compiler outputs, temporary files, model or runtime effects.
Root canonical reads were taken after its b5+2af integration. This proposal has
not been compiled, tested, imported, mounted or activated by this worker.

## Concrete owner chain

API server already admits authMiddleware -> csrfMiddleware ->
authorizationMiddleware before its /api/v1 routers. Mount a new current-call
router there, separate from legacy VoiceService and Native voice-owned turns.
No current call router, production CPU singleton or profile setting was found.
The Fetch adapter /api/voice/v2 is not an Express assembly or Native protocol.

Construct the actual Core owner with createVoiceOperationOwner imported from
ingenium-core and these existing request-context authorities:
currentScope=currentHostedVoiceScope,
requireOriginalResource=requireHostedVoiceResource,
verifyRetirement=verifyHostedVoiceRetirement.
Construct createLinuxCpuSupervisor with that exact ledger,
bindContext=bindHostedVoiceCpuContext and currentScope=currentHostedVoiceScope.
Its protected ManagedCpuProfile.load/readResourceApproval, kernel probes,
model/code hashes and original control checks remain the production owners.
No injected positive test factory belongs on this path. Construction must not
start models. Root must supply protected server-only profilePath and
resourceApprovalPath through its installation configuration; a request, URL,
callId, role string or presence of environment settings is not availability.

On explicit open: captureHostedVoiceRequest(actualRequest, selected identifiers)
resolves canonical private chat to engine session, actual user/auth session,
nine axes, manager backend/start identity and current selected model. Then open
the approved genuine CPU scope, bind via supervisor.bindAttachmentContext, and
openHostedCurrentAgentCall. The call captures its exact scope lease and pinned
profile. Initial selected identifiers are selectors only, never proof.

## Implemented request bridge proposal

Append production-call-request.additions.ts inside request-context.ts so it can
use its private WeakMaps, actual original call and context records. Every route
must captureHostedCurrentCallRequest with the NEW Express Request and the
server-private call handle, dispatch the fixed operation, then release the
request grant in finally. Keep the callId->opaque handle map private, bounded by
the existing 16 active-call cap; a lookup alone never authenticates a caller.
Do not return request/call/plan handles or place grants in client JSON.

The bridge repeats actual auth, same original actor AND auth session, canonical
private chat/engine mapping, all nine execution axes, backend/start identity,
same actual CPU scope/producer and fresh manager verification. Existing
callCurrent checks the genuine lease/control/profile/owner. Async capture is
enrolled in call.work before network effects, so End joins it. Recheck the
incoming request and call generation after awaits before returning any event.
For SSE keep that actual streaming Request's grant only until close, recheck for
each next-event; never reuse a grant for a reconnect/new request. The route must
also check immediately before socket write after any awaited backpressure.
No event text or returned metadata becomes a speech authorization.

auth.ts scoped ing_ bearer users carry tokenId but NO AuthSession. user() already
rejects them, service bearers and compatibility bearer identities. Therefore
this bridge supports the existing actual session-bearing authentication only.
Root must either keep bearer unavailable here or add a genuine authentication
owner binding a bearer to the original auth session. Never synthesize a session
or silently treat the bearer token ID as one.

## Missing hooks which block a complete production mount

1. Protected installation configuration for the two approved Linux CPU files.
   This is server configuration, not client selection and not a model-run grant.
2. An exact-original bootstrap reference from openScope. It currently accepts a
   sessionId and returns status; releaseSession chooses #current. Router open
   must retain the ORIGINAL bootstrap scope/reference before asynchronous open,
   and release that exact reference after call lease capture, including failure
   and opening cancellation. Reusing releaseSession after rotation can affect a
   different current scope. Add a private supervisor open-for-call owner that
   performs the whole bootstrap->call lease transfer with exact scope retention;
   never fix this using a caller-supplied scope DTO or by stopping shared work.
   There is no circular cold-start dependency: #open binds through contextFor
   before ledger admission, and fresh() binds before currentScope checks.
3. Core134's private source/plan consume API. prepareHostedCurrentAgentTts stays
   unavailable. Its input must be the original call+plan owned here, not the
   output of inspectHostedCurrentAgentPlan or a request-supplied hash. Root
   supplies a private single-use handle tied to genuine RUNNING CPU parent,
   immutable source, call incarnation/generation/nine axes/auth and security
   epochs, protected profile/provenance, fixed policy and exact segment. The
   owner must spend before dispatch, preserve unknown/spent on failure/restart,
   and restore tombstones without manufacturing a control FK. Need exact Core
   method/type names and consumption/dispatch/unknown ordering before wiring.
4. Root-owned message dispatch composition with createActualAttachmentDeliveryOwner
   (same Core writer, SQL132). Reserve/claim/ACK/unknown stays separate from134;
   write permission must be checked against THIS fresh request. No message route
   or explicit cancel-agent owner is manufactured by this proposal.
5. Actual call speech/STT/audio owner, stream close/backpressure cancellation,
   raw-body bounds, CSRF route policy, bootstrap failure custody and reconnect
   map lifecycle need integration and Root tests before any availability claim.

Barge-in keeps subscription, joins owned speech/reads and fences generation.
End joins subscription and releases only the exact call CPU reference. Neither
retires/cancels the existing agent/goal/queue. Preserve legacy unavailable
observer, selected-state guard inactivity and original retirement guards.
CPU wire/platform, microphone/audio/UI and the parent 74-feature acceptance
remain open; source assembly is not runtime qualification.

## Reconciliation

Only unique proposal source and this review are retained for Root integration.
Removed paths: none; removed bytes: 0. No Linux or Windows recovery claimed.
No source, lockfile, protected Native draft, active process or shared tree changed.
