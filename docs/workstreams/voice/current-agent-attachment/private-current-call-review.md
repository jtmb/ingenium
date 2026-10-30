# Genuine private current-agent call and speech-plan proposal

Source-only follow-on to c117. No canonical writes, builds, runtime/model/CU or
tests executed. Root alone registers134, composes production API and qualifies
actual CPU/audio. This implements new positive private ownership in source;
Core134 TTS dispatch remains explicitly unavailable, not a legacy-agent shortcut.

## Original resource and call construction

New methods live INSIDE actual ManagedCpuSupervisor and resolve its private
#scopes/#current, real child/worker boot, original Core running control, actual
resource admission and protected frozen ManagedCpuProfile. Constructor retains
its original profile reference; public-property replacement is rejected. A DTO,
health/status object, supplied profile or callback cannot become a call lease.
The ordinary constructor and legacy tests/paths are unchanged until these new
methods are called. No resource starts or model loads on their own.

Root's actual factory must first open its approved existing CPU resource, then:
`const bound = supervisor.bindAttachmentContext(capturedRequestContext)`;
`const call = await openHostedCurrentAgentCall(bound, signal)`.
The binding calls the real scope.contextFor -> bindHostedVoiceCpuContext, whose
private record validates the actual captured Context and identical nine axes.
open accepts ONLY this private context and cancellation. It generates callId
and instanceId itself, leases a session on the SAME actual CPU scope and captures
its real profile/default voice. It does not accept identifiers, role/proof DTOs,
resource ports, model, policy, profile, default voice or read implementations.

Each call has its own deadline bounded by request, actual CPU admission and
30minutes, speech generation/controller, read/plan ownership, one subscription,
and opaque handle. Revalidation checks current authenticated user/session,
private canonical chat/source, project/content permission, runtime/workspace/
binding/epochs/state/lease, original CPU scope/control/owner/boot/profile/voice.
Actual inspectManagedRuntimeJobRole reattests original container/startIdentity,
daemon/host, workspace/project/user and binding before/after source reads and
before immutable-plan admission. Its original5second proof expires; metadata
inspection refuses expired proof until refreshHostedCurrentAgentCall succeeds.
No arbitrary inspector or positive callback is accepted.

Initial actual bounded session GET pins agent/model/provider/variant. Subsequent
raw assistant observations must match. Nothing selects a model/agent, creates
an engine session/Run, replaces memory/tools or touches the agent queue.

## Fixed approved policy and immutable plan

Root explicitly approved verbatim-assistant-text-v1 for this NEW path. It consumes
only text parts freshly read by the fixed actual HTTP owner. It intentionally
preserves assistant text; it is NOT credential redaction. Reasoning/tools and
metadata/configuration/credential stores are not text inputs. Legacy injected
ManagedCpuSpeech policy is untouched.

attached-verbatim-policy binds the fixed identifier, actual function source and
its exact module bytes; segmenter identity binds actual exported functions and
the complete existing segments.mjs bytes. These are static CODE reads, not
caller-selected content/policy paths. Actual MJS packaging must retain them.
CR->LF projection and existing planTextSpeech are distinct from original source:
raw response/bookend/text/range/prefix hashes, raw UTF8 offsets/part index,
projected hash/bytes and ordered projected segment hashes/offsets are all kept.
No normalization mutates the original engine text or mistakes projected offsets
for raw offsets. Pinned text parts have nativePartId:null, never synthetic IDs.

planHostedCurrentAgentSpeech(call,messageId,signal) itself invokes the newly
integrated original raw reader under the actual private selected target, consumes
its one-use original handle and revalidates before/after awaits. It accepts no
observation DTO, event text/hash, offsets, redactor/segmenter callback or policy.
It verifies prior prefix hashes and takes only new nonoverlapping appended bytes;
changed/truncated prefixes refuse. Same bytes produce no new plan. Prefix history
survives barge-in so incrementing generation cannot automatically replay text.

Opaque plan originals are stored by exact private WeakMap identity and pinned
to call instance/generation, actual nine axes/epochs, raw observation, control/
owner/profile/default voice, fixed policy, separate projection and segments.
Maximum64 retained plans,262144 projected bytes and256 admitted source ranges
over call lifetime; no capacity eviction resets originals. Metadata/segments are
frozen, text retained privately only, raw HTTP array copies zeroed on all paths.
Source hash = canonical complete metadata excluding sourceHash and planHash;
plan hash additionally binds sourceHash/profile/voice/policy/segment projection.
speechTurnId is a private monotonic SOURCE ordinal, never an agent execution;
turnGeneration equals the owned speech generation for eventual Core134 binding.

inspectHostedCurrentAgentPlan requires BOTH exact call and plan originals,
current private authority/generation and fresh physical source proof. Returned
metadata is data, not a capability to recreate either original. The old
observeHostedAssistantSpeech(context,...) remains unavailable; a captured context
alone must not silently become an active call/plan.

## Live subscription and exact prompt contract

Pinned2.0.11 prompt success is {data:Session.Inbox.User}: id/sessionID, type:user,
time.created, payload and queue|steer delivery. New strict ACK validator compares
actual original IDs/delivery/exact input text and refuses added files/agents/
skills/metadata. It means durable admission only, never agent result/retirement.
The existing hosted owner gets this stricter check; its DATA fixture gets the
actual pinned ACK fields, not a fake runtime authorization claim.

Pinned GET /api/event is global LIVE feed, data:JSON frames with event.id; no
server session/directory query or cursor/replay guarantee. text.ended has actual
sessionID/assistantMessageID/ordinal/text and optional state. New parser uses it
only as a fresh raw-read selector; it returns NO event text or completion proof.
Unknown wrappers, synthetic SSE id lines, duplicate JSON and malformed text
boundaries refuse. Wrong session/location and heartbeats are ignored.

New client feed method uses actual captured Node fetch/scoped target/auth,
manual redirects, identity encoding, fixed GET path, status/type/URL checks and
original call AbortSignal. No injectable fetch/body/proof or retry/fallback.
Private call owns acquisition, body reader, pending read, cancellation and joins.
One subscription per call; buffers/chunks262144B, total feed16MiB; never a hidden
unbounded queue. Event delivery revalidates user/source/CPU and refreshes expired
physical source attestation. No replays or completeness claim on reconnect/EOF.

Barge-in synchronously increments generation, aborts/joins own raw/plan work,
discards plan plaintext and revalidates before reopening speech admission. Its
live selected subscription continues. End additionally aborts/cancels/joins that
exact subscription and releases only this call's actual CPU lease reference.
Last reference uses ORIGINAL retained scope.stopScope, not whichever scope is
now #current. Actual CPU retirement remains with original supervisor/Core proof.
Neither operation calls agent interrupt/cancel/settle or mutates a goal/queue.
Negative End remains possible after auth revocation. Cleanup-unknown retains
the failed call/resource; no timeout fabricates join or releases an unknown body.
Failed opening cleanup carries the original call non-enumerably for Root recovery.

## Exact remaining interface and acceptance

prepareHostedCurrentAgentTts(call,plan) validates originals then ALWAYS refuses
CALL_CORE134_DISPATCH_UNAVAILABLE. Root must replace that boundary ONLY after
actual134 immutable sources/claims/tombstones, tagged control-parent reservation,
same-writer transaction, private plan->exact CPU payload/digest assertion and
real CPU cancellation/result/retirement are installed. No completed-agent seed,
null-parent bypass, resultFingerprint or generic positive callback is permitted.
Current owner has no STT/audio playback dispatch; those actual producers must
be bound privately to this call generation and joined before release is claimed.

Do not yet wire generic createHostedAttachmentOwner into production from caller
ports: its actual selection/configuration owner, Core132 writer, exact authenticated
request/stream bridge and explicit agent-control owner still need Root composition.
Protocol is now grounded; that alone is not a mounted authenticated endpoint.
Root's production mount must keep actual private handles, never reconstruct them
from external callId/sourceId/JSON. Restore must invalidate surviving call handles
and union source/claim tombstones before serving; originals never resume from DTOs.

Seven finite DATA policy/protocol tests and three actual-canonical authority
negatives are authored. They claim no positive call/CPU/model/retirement proof.
Worker only parsed MJS bodies without execution and verified source hashes/splice
preimages, JSON/manifest/diff. TypeScript not compiled; Root must run strict source
checks, existing managed/voice/raw/hosted tests and these cases. Actual captured
context+running protected resource must qualify positive call/plan, cancellation,
expiry, auth/source change, stale profile, appended/changed prefix, role-feed
deadline/join, old-scope/new-current negative cleanup and genuine audio.

Source review found legacy requestManager swallows failed error-body cancellation.
The new call path therefore adds its OWN fixed manager role reader: same protected
manager URL/token, actual captured fetch, status/type/URL/identity checks,128KiB
strict body/EOF, caller lifetime cancellation plus15second deadline. Legacy manager
paths are unchanged. End aborts/joins this actual owned Promise and the exact body;
cleanup-unknown is never hidden by legacy normalization. Actual manager qualification and
Core134/restore/API/Windows/Linux/audio/full phase acceptance stay open.

Same declared root/C-backed physical volume; source cap amended before generation
to393216B within original64MiB source allowance/combined20GiB task ceiling. No
runtime/dependencies/compiler/cache/temp artifacts were created; removed0paths/0B.
Retain minimal reviewed source/recipes/tests/evidence for Root's actual integration.
Preserve13earlier Native drafts and c117 evidence; no unrelated cleanup or migration.
