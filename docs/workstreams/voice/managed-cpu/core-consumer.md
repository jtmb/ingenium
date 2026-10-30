# SQL128 VoiceService consumer

`CoreVoiceOperations`, `ManagedCpuSpeech`, the existing `VoiceService` and
`CurrentAgentVoiceAdapter` now compose concrete Core reserve/CAS/quarantine/
settle calls with the Node CPU producer. The adapter owns no SQLite connection,
second journal, conversation creation or model selection. Root still owns the
actual API route registration and authenticated selected-conversation/runtime
binding. Dependency-free tests use fixture authority and do not qualify those
bindings or the actual operating-system lifecycle.

Root supplies `CoreVoiceOperations.bindOriginal({context, original})` from the
actual retained original execution resource. Return its actual Core `owner`,
bound server `context` and authoritative absolute `deadlineAt`. No permissive
default exists. The consumer clamps its session deadline to this actual deadline
and synchronously reserves the exact nine-key scope, UUID, integer turnGeneration,
full semantic input hash, parent UUID and owner before effects. A changed input
under the same friendly request cannot mint a new UUID. Claim moves the reserved
row to running before the current-agent adapter can post the prompt. This resource
binding must match Core's currentScope/requireOriginalResource/verifyRetirement
callbacks; inventing an owner from a session, usage row or message ID is invalid.

The current-agent adapter rechecks the full semantic hash before effects. Its
Core path passes the accepted original to the actual `observeTurn`, uses its
UUID to derive the stable native admission ID and subscribes before posting.
The observer must expose separate `ready`, `result` and `retirement` promises.
`retirement` yields an opaque positive original-owner proof accepted by Core's
actual verification callback. It is not a successful result, usage event, idle
observation, interrupt ACK or watch unsubscribe. Missing retirement producer
refuses before posting; missing/failed proof after dispatch leaves Core unknown.
The same rule applies to an actual `observeControl` for steer/queue. Inbox
admission alone cannot complete a Core control original. Root must independently
verify that original prompt/control execution and observation resources are
physically retired before issuing proof. Unsupported generic engine interrupt
semantics remain unavailable, not upgraded by this consumer.

Use exported `agentInputFingerprint`, `agentResultFingerprint` and
`controlResultFingerprint` for exact producer/verifier agreement. Agent result
fingerprints include the full scope, friendly request and unchanged full reply;
usage is not retirement evidence. VoiceService strips the opaque proof before
returning public output. Errors quarantine the original without replay. It stores
the actual accepted agent UUID as the speech parent and exposes it to steering
while the parent is still running, as required by Core's parent predicate.

Wire `ManagedCpuSpeech({supervisor, redactSpeech})` as VoiceService.speech for
the Linux CPU path. Opening an authorized session calls the producer's original
scope admission once; readiness/status starts no model. Transcription reserves a
distinct `voice-stt:` namespace from agent prompts. Each speech child is reserved
by the actual CPU producer, with the accepted agent UUID and exact wire digest;
there is no duplicate generic TTS Core reservation. The full reply is redacted
once, hashed and partitioned with the existing lossless segmenter. Children are
serial and advance only when the caller resumes after playback. No slice/clipping,
whole-reply WAV cache, v1 endpoint or backend fallback is introduced. The private
Core fingerprint and positive CPU terminal proof precede result delivery.

Session close/expiry retains a single cleanup promise, attempts both actual agent
cleanup and CPU session release even if one fails, and retains a failed session
without retrying its original. Last-session CPU release awaits actual physical
scope retirement and Core's control/leaf cascade before resource release. The CPU
producer consumes unpublished payload gates at shutdown and drops completed
request promises/context handles after their final consumer; uncertain originals
remain retained until actual scope retirement. Core unknown/results stay immutable.

Focused consumer cases cover semantic identity and changed-input refusal, Core
claim before effects, exact parent UUID, whole-reply serial speech, proof omission,
private-proof stripping, cleanup despite agent failure, and observer retirement
independent of completion. Existing session/transport/current-agent/continuous
cases also pass. Actual installed-Core/API types, authenticated selected scope,
original runtime observer proof, Linux inert helper, Python 3.12/model ABI, Windows
Native integration, speech/audio/device and full phase/release gates remain Root's
mandatory acceptance work. This checkpoint does not authorize runtime activation.
