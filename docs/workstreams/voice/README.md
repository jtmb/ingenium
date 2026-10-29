# Veyra voice integration

Status: owned source implementation for coordinator integration; no real audio, neural model, visual or release acceptance is claimed. The worker goal stays active until coordinator acceptance. This change adds no database writer, model runtime, credential setting, automatic device acquisition or background microphone service.

## Delivered components

- `packages/veyra-voice/session.mjs`: scope-bound dictation, working-agent calls and conversational voice lifecycle. Generation fencing suppresses stale results before submission, synthesis and playback. Stop aborts local work immediately, then requires acknowledgement from the exact native agent turn before reuse. Unknown interruption retires the voice session. Steering and queueing use existing agent semantics without silently interrupting work. Permission requests require an explicit Allow once or Deny action.
- `packages/veyra-voice/audio.mjs`: streaming FIR normalization to 16 kHz mono s16le, bounded segmentation with pre-roll and WAV format validation. Energy segmentation is a compatibility endpoint detector, not qualified neural VAD or acoustic echo cancellation.
- API `lib/voice-v2/{service,speech-worker,http,current-agent}.mjs`: authenticated/capability-authorized adapters, durable operation-ledger injection, current native conversation binding, GPU-qualified Stratus speech protocol consumer and bounded HTTP/NDJSON handler. No worker process or model is loaded here.
- Dashboard `components/voice-v2/`: browser device lifetime and cancellable playback, HTTP consumer, integrated client lifecycle and start/active voice UI. The compact blue Start voice button and dark active canvas follow the protected start/active reference pixels. The existing blue Veyra mascot is supplied as a React slot. Visual comparison remains pending.

The concrete current-agent port, installed native contract findings, truthful availability state and ready-to-mount `VoiceWorkMountProps` are documented in [current-agent-integration.md](current-agent-integration.md). Native turn observation remains bound to the existing conversation event owner; unavailable dependencies are not replaced with a synthetic successful call.

## Coordinator wiring recipe

1. Freeze `VoiceScope` against the shared versioned ProjectRef/ExecutionBinding/ConversationRef/AgentTurn contracts. Bind every field explicitly: account, nullable org/project, conversation, runtime, execution binding and working agent. Do not derive scope from a display name, selected default model, last-used project or browser query alone. Changing any binding ends the current voice client; create a fresh client for the new scope.
2. Instantiate `SpeechWorker` server-side with an operator-approved private `baseUrl`, dedicated Veyra speech token, explicit backend/instance, selected voice and a required secret/code/markup speech-redaction function. Nothing accepts a browser-supplied worker URL, token, model path or subprocess command. The owned [speech backend](speech-backend-integration.md) supports separately selected CPU and WSL DirectML profiles. Health must identify Veyra and the selected backend; missing resources never cause automatic fallback or use of Stratus's active service.
3. Instantiate `VoiceService` with the existing API authorization function, working-agent adapter and durable operation ledger. `operations.reserve` must atomically reject existing request IDs across process restarts; `settle` records completed usage or unknown outcome without charging/replaying another turn. These interfaces deliberately require existing API authority rather than constructing a new database or ledger.
4. Mount `createVoiceHttp({service, authenticate})` at `/api/voice/v2/*` inside the existing authenticated API gateway. `authenticate` must preserve session, CSRF/origin, rate-limit and account/org/capability boundaries. The adapter is unmounted in this worker branch because routers/auth helpers belong to the coordinator. Schedule `service.expire()` with the existing lifecycle owner; failed native cleanup remains retained and must be reconciled.
5. Bind `agent.submit`, `steer`, `approve`, `interrupt` and `closeVoice` to the current working session. Submit preserves its model, effort, tools and approval policy. Tool/approval events must carry the exact scope and request ID. Steer/queue acknowledgements must report `{accepted:true,requestId,scope}` only after the native operation is confirmed. Approvals reference native pending IDs; the native API validates their ownership and single consumption. Interrupt must acknowledge the native turn, not merely HTTP abort. `closeVoice` releases only voice work/streams, never deletes the working conversation. Narrow stop/close ownership checks must remain available after normal execution capability revocation.
6. In the Work owner, render `VoiceControls` and create one `VoiceClient` per user-chosen mode using `createHttpVoicePorts({dictation})`. Dictation inserts into the exact currently bound composer draft with its cancellation signal; it never auto-sends. Call `client.start()` directly from the user gesture, then render `VoicePanel` with the existing blue mascot. Dispose on unmount, navigation, account/project/runtime changes and auth loss. Do not mount an unbound page that silently creates a conversation.
7. Bind a qualified `speechGate.inspect(pcm)` only after verifying the VAD/echo processor on the actual device path. It must return both `speechConfirmed` and `echoCancelled`. This enables bounded pre-roll and automatic barge-in using the same acknowledgement fence. Without that adapter, default half duplex suppresses capture during agent/speech work; Stop, type-to-steer and queue still work. Browser `echoCancellation:true` settings alone never enable barge-in.

## Commands and resource scheduling

Dependency-free CPU suite, from the owned checkout:

```sh
TEMP="$COORDINATION_VOICE" TMP="$COORDINATION_VOICE" TMPDIR="$COORDINATION_VOICE" \
  node --test services/ingenium-api/tests/veyra-voice-*.test.mjs \
  services/ingenium-dashboard/tests/veyra-voice-*.test.mjs
```

`COORDINATION_VOICE` is an invocation-local variable pointing to this stream's existing assigned coordination directory, not a new application environment setting. The adapters add no environment variables. Worker tests use no dependencies, output directory, models, audio device or network service. Transport tests use real Request/Response/ReadableStream objects and an injected in-process HTTP handler, not a live gateway acceptance claim.

Coordinator build request: check the exact merged dashboard TypeScript, ESLint and production bundle with its existing lock-compatible dependencies; include the new external `.mjs` modules and adjacent `.d.mts` declarations. The API packager must retain `packages/veyra-voice` alongside the relative-import consumers or bundle those modules. Root workspace/lockfile and Docker/package staging changes remain coordinator-owned. No npm install, full build or cache mutation was performed by this worker.

## Runtime limits and recovery

PCM is limited to 15 seconds/480,000 bytes; pre-roll to 200 ms/6,400 bytes, voice minimum 250 ms and silence endpoint 700 ms. Worker STT/TTS requests use five-second deadlines, WAV duration is capped at 15 seconds and synthesis text at 600 Unicode code points after redaction. One recognition/model/speech operation per voice session is admitted at each stage. HTTP tool streams cap cumulative output at 512 KiB. Tool snapshots retain at most 32 current entries.

The UI transcript is volatile presentation of the existing conversation; it is cleared on end/reconnect. The API holds only the current reply until completion/interruption for synthesis identity checks. It does not write audio/transcripts to disk. Existing agent/provider transcript retention and memory policy remain governed by the coordinator's existing services; this source does not claim erasure or disable their retention.

An uncertain open is never automatically replayed. Explicit cleanup uses the same known session ID, or a fresh client/session is created after reconciliation. A lost submit stream is an unknown agent outcome and triggers exact native interruption; it is not a refunded/unused prompt. Reconnect reauthorizes the same scope and checks worker health. A cold API process cannot recover volatile voice state: require a fresh session after reconciling the previous native turn against the durable ledger. Playback failure is surfaced and never blindly replayed.

Every steer/queue intervention carries its own stable `voice-control:<sessionId>:<counter>` operation ID under the current turn. The existing durable ledger admits it once and records completion or unknown outcome; a repeated ID never replays the native operation. An uncertain control blocks more controls on the active local turn until it is stopped or finishes. The interruption fence enforces its own three-second acknowledgement deadline even if an adapter ignores abort; expired acknowledgements retire the local session and cannot reopen it. Synthesis receives the exact confirmed reply bytes, while display whitespace may be trimmed independently.

## Remaining acceptance

See [acceptance.md](acceptance.md) for the required device, workflow, visual, memory, platform and release checks. Coordinator ownership of shared wiring is a concrete integration dependency, not an implemented end-to-end call claim.
