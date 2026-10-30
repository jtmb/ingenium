# Current Native voice endpoint integration review

Proposal only, read against CURRENT windows-source after Root's36path Work chain.
Root owns canonical writes, runtime and final semantic review. No build/runtime,
microphone/audio/model/CU or shared source changes occurred. Full scope stays open.

## Existing real dispatch and minimal pinned proposal

VoiceWorkspace receives Workbench.call. Workbench.call retains collaboration,
project/generation and original view checks, delegates to gateway.workbench, then
checks again. gateway.request uses original Tauri service_request, carrying native
service instance and pre-dispatch fence. This is a real Native Rust transport,
not a generic Node fetch. The same current gateway carries Root's other36paths.

native-voice-transport.mjs/.d.mts add explicit Native route/wire channels only.
Four exact VoiceWorkspace spans import it, bind existing guarded request and
pass the dictation/speech channel to SpeechControls and owned-voice channel to
VoiceChat. No Workbench/gateway/App/Web toggle/chat/model/agent/queue edit, new
state/store, or owner-key reset. Method/path/body/current callback and original
Promise/result/error are preserved; no credential, retries, redirects, fallback,
HTTP layer or positive owner proof is supplied. Existing Rust remains authority.

Pure classification pins observed methods, path shapes and JSON keys; decoded
slash/percent/traversal/query/namespace aliases refuse. VoiceChat's existing GET
speech status is explicitly permitted in its channel. Dictation and explicit
speech never issue voice controls. These are defensive contract bindings, not
new routes or proof that audio/current-agent attachment works. Native protocol
descriptor explicitly says owned-agent-turn, attachedCall:false.

## Exact endpoint/wire mismatch

| Surface | Actual Native UI + Rust contract | Node helper contract / unresolved gap |
| --- | --- | --- |
| Status/selection | GET /v1/speech/status; GET /v1/voice/status; GET /v1/voice/owner?session_id=...; owner is full Native VoiceSessionOwner | createVoiceHttp exposes none of these GETs. Its context must be captured from real authenticated private scope. Native owner JSON is not Node's nine-axis proof. |
| Dictation | POST /v1/speech/transcribe JSON request_id + wav_base64; returns operation receipt; poll GET /v1/speech/operations/:id | POST /api/voice/v2/transcribe expects raw PCM body and percent-encoded X-Veyra-Voice scope/turn header, returns direct JSON transcript. WAV/base64/job polling is not interchangeable. |
| Explicit speech | POST /v1/speech/synthesize JSON request_id/text/voice; poll operation and obtain wav_base64; cancel operation | POST /api/voice/v2/synthesize expects scope/turn/text and returns binary audio/wav, with completed-agent parent restriction. Do not forward arbitrary UI reply text as Core134 observation. |
| Voice start | POST /v1/voice/sessions JSON request_id/project_id/session_id/send_transcripts/read_replies/owner/optional voice | Node open expects scope/mode/sessionId. No canonical call-incarnation/selection/plan route currently implements the accepted attachment protocol. |
| Spoken turn | POST /v1/voice/sessions/:id/utterances WAV/base64; GET utterance/session/controls JSON receipts | Node submit expects text/delivery/scope/turn and returns NDJSON. Native JSON receipt/polling cannot decode this as its own original. Old VoiceService also owns agent-turn completion. |
| Playback | POST native utterance playback claim/played ACK with child_request_id/claim_id/generation | Node generic helper has no equivalent route/claim endpoint. Never infer played/drained from HTTP result. |
| Barge-in/End | POST native barge-in/stop, retained control receipts, native original worker joins | Native backend can interrupt its exact voice-owned agent prompt. Accepted attachment ends only speech/subscription while goal continues. Node observation/attached-call owner remains unavailable. |

Current Node api-server.ts has no createVoiceHttp/VoiceService/CurrentAgentCallAttachment
import or mount. The helper prefix /api/voice/v2/ is a standalone Fetch-Request
adapter; no Express authentication/CSRF/placement bridge registers it. A URL
string substitution cannot supply that missing production owner or compatible
response format. New raw HTTP reader does not create a voice endpoint or TTS grant.

## Concrete semantic blockers retained

Native VoiceSessionOwner correctly captures service/project/revision/directory/
environment/session/profile/quant/context/provider/variant/agent/configuration.
Do not coerce that DTO into Node scope or substitute a frontend true callback.
The Rust original rechecks its actual binding. Existing receipts/storage contain
Native operation IDs and playback claims, not Node operation/source originals.
Keep those originals and recovery paths; never migrate/replay them by renaming IDs.

Native crates/adapters/src/voice.rs:1009-1022 controls can call engine.interrupt;
apps/service/src/routes/live_agent/voice.rs implements interrupt_prompt_if_current.
Native /status advertises exact voice-owned-request barge-in, not an attachment.
VoiceChat currently says Call current working agent but uses that owned-turn
start/stop protocol. Do not relabel it as speech-only attachment or weaken actual
retirement to make the label appear to work. Existing stop/recovery must remain
available for retained owned-turn originals; the new protocol needs separate
typed semantics and actual original speech/subscription/control ownership.

Workbench currently disables the whole VoiceWorkspace during agent busy and
asks users to clear/pause follow-up queues/draft selections before continuous
voice. Those checks protect legacy owned-turn flow. They cannot be removed as
an attachment shortcut, and accepted attachment must not clear or replace the
working agent queue. Its separate genuine owner must allow attach while work
continues, preserving canonical chat/agent/model/memory/permissions. Dictation
append still uses original composer checks; do not turn transcription into send.

Root's unavailable observeHostedAssistantSpeech constructor remains unavailable.
Core134/private call/immutable plan/restore-source gates, full real Node endpoint
registration, typed binary/NDJSON/event/subscription ownership and actual CPU/audio
qualification remain required. A future transport should be a separately typed
actual attachment interface; do not add speculative route aliases or a caller
selectable backend switch that bypasses these owners. No positive call, CPU or
retirement proof is minted here. Global selection fence remains inactive.

## Validation and retention

Five authored finite DATA tests cover all observed routes, wrong namespace/method/
query/encoding paths, channels, strict JSON wire keys, unchanged original Promise/
body/view callback/error and explicit lack of attachment semantics. Fixture return
objects are marked fixture data; they are not HTTP, auth, device, model, CPU or
retirement evidence. No tests/builds were executed by worker. Root should run
these tests, current Native UI voice tests and actual frontend types after source
review; full integration/audio requires actual original endpoint owners above.

Source preimages/hashes and exact4span recipe are included. New source sits only
in existing task-owned proposal root; same C-backed volume and262144B source cap.
No generated runtime/dependency/cache/temp outputs; removed paths0/bytes0.
Retain minimal reviewed contract sources and receipts for Root's remaining actual
integration consumer;13older Native drafts remain protected and unapplied.
