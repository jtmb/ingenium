# Before-start enrollment follow-on to b5c99b01

Root imported b5 as aa37964a and requested this correction before canonical apply.
Only owned proposal source/recipes/tests change; no shared source or runtime.

retainCallWork now accepts an INTERNAL execution closure. It creates the actual
Promise.resolve().then(effect boundary), inserts that pending Promise in the call
work Set and installs failure tracking BEFORE the microtask can invoke anything.
At microtask entry it checks original generation/state/lifetime/speech controllers
and the actual optional cancellation signal. Every physical refresh/session read
and complete raw-read/plan task now uses this enrollment; no already-started
Promise is handed to the helper. These closures are private implementation
details, never caller-supplied authority, fetch, proof or scope callbacks.

Immediate End/barge-in/abort fences the queued effect without network start.
Already-started effects remain enrolled until their actual original settlement;
cleanup-unknown stays on the actual call. No timer substitutes for join, no
automatic retry/replay appears. Plan busy cleanup is attached to the enrolled
Promise as well, because the effect's own finally never runs when entry is fenced.

Subscription acquisition is created by private enrollCallSubscription. The actual
call.sub record holds the pending Promise before its microtask checks cancellation,
slot identity and call state, then enters the existing real source/target/HTTP
owner. No Response/body placeholder is accepted. End sees this exact slot even
if called in the same stack immediately after opening, aborts it and joins the
same original pending acquisition. Pump/reader/EOF/body cancellation/cleanup-unknown
logic and resource/agent boundaries remain unchanged.

Six authored SOURCE-ONLY scheduling fixtures extract exactly these unexported
helpers from the proposal source and erase only their known type annotations.
They test immediate End/abort/generation fencing before start, planning cleanup
when effect entry is skipped, retained actual pending settlement/unknown failure,
subscription slot enrollment and no silent replay. Fixture subscription execution
paths are forbidden and never entered; no positive auth, actual call/plan Map,
fetch/Response, CPU/model/device or retirement owner is fabricated. Worker only
compiled their JS bodies without execution. Root may run the source test here,
then repeat against canonical helper bytes after applying the exact follow-on.

MANDATORY ROOT MOUNT GATE: EVERY new HTTP request must pass the real authentication
middleware and be matched to the original call's actual user, auth-session and
nine-axis scope before call lookup/use or stream/control delivery. A callId lookup,
copied metadata, caller DTO, captured old Express request or current user name
alone is NOT authority for a new request. The private captured context remains
necessary source/lifetime evidence; it does not authenticate a new caller. Root
owns that original request bridge and must preserve this gate for all routes.
No fake caller-matching helper or positive predicate is added here. Internal
negative cleanup of already-owned work remains separate from public admission.

Core134 dispatch, production API composition/mount, restore invalidation and
actual call/audio/Windows/Linux qualification remain open. Existing approved fixed
policy/profile/physical source/legacy owned-agent restrictions are unchanged.

Same original output root/physical volume/393216B source cap. No compiler/runtime/
tests/model/CU/shared writes or disposable dependency/cache/temp outputs created.
Removed0paths/0B; retain these minimal sources/receipts for Root's canonical review.
