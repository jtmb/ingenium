# Current engine conversation adapter and Work mount

Coordinator follow-up, 2026-10-29. The original voice commits through `32fae958` were accepted for integration and passed coordinator API/dashboard noEmit checks. This follow-up adds the engine consumer port and Work mount without shared router/context/schema edits, device access or runtime/model work. The new files require their own coordinator noEmit/integration check.

## Contracts actually inspected

- `services/ingenium-api/lib/opencode-client.ts`: `request` carries authenticated runtime context and caller signal; `sendPrompt` uses the existing native session and durable native message ID, but its retained prompt-parts projection drops `delivery` and `resume`. Passing model/agent options invokes session-switch endpoints. The voice adapter therefore uses the same authenticated `request` dispatcher directly for the allowlisted native paths and never supplies model, variant, agent, system, tools or permissions.
- `services/ingenium-dashboard/src/lib/use-opencode-chat.ts`: subscribes before awaiting prompt admission and reconciles the admitted native message ID. Its `stop()` finalizes local presentation and treats `sessions.abort()` as best-effort, so it cannot be used as a confirmed voice interrupt acknowledgement. `resume()` is transcript/SSE presentation recovery, not a new native prompt.
- Installed `@opencode/client`/`@opencode/protocol`/`@opencode/schema` version 2.0.11: `session.prompt` is durable inbox admission with caller `msg_` ID, optional `delivery: steer|queue` and `resume`. `session.inbox.cancel` deletes a known undelivered item; `session.interrupt` reports `{interrupted:boolean}` and supports `resume=false`; `/api/session/active` lists running process-owned drains and absence means inactive. Permission decisions are `once|always|reject`; voice permits only `once|reject`.

The stale `/tmp/opencode/oc-v2-openapi.json` path mentioned in the wrapper source was absent. Installed package source, rather than that missing reference or a running service probe, supplied the native contract. Read-only source hashes: protocol `groups/session.js` SHA256 `4aaf76e9a0777063e1679ce3e060fb57c7a475a008fb18f4f6498730e6960bdf`; protocol `groups/permission.js` SHA256 `a6bb748feeafbbc6d75e10a21afbb21a14c4a26e1d9b28b9653593af460cebb9`.

## API port

`lib/voice-v2/current-agent.mjs` exports `CurrentAgentVoiceAdapter` and `nativeVoiceMessageId`; adjacent declarations describe every binding/observation field. Pass the adapter as `VoiceService.agent`; keep `VoiceService.operations` connected to the existing API ledger. The adapter creates no ledger, database, model session or transcript store.

Supply these existing-authority ports:

| Port | Required binding |
| --- | --- |
| `request(path, options)` | Existing `opencode-client.request`, including its auth/runtime target and signal handling. No browser URL/token/target injection |
| `resolveBinding({context,scope,action,signal})` | Existing authorization/execution resolver; recheck actor, account/org/project, native session, immutable execution revision and exact canonical directory. Return verified scope/session/directory and `protocol: opencode-v2.0.11`; otherwise unavailable. Owned stop/close after capability revocation remains a narrow server decision |
| `withBinding(binding, work)` | Existing `withOpenCodeRuntimeTarget` using a server-resolved target, never a client-supplied upstream or compatibility fallback |
| `observeTurn(input)` | Existing native conversation event/operation owner. Subscribe before admission and return `ready`, `result`, `ownsPermission`, `ownsExecution`, `stop`. Result must be anchored to the exact supplied native `promptId` and execution, with the same scope/session and a real succeeded/failed/interrupted outcome |

The native observation port is an explicit remaining coordinator integration dependency. It must correlate durable inbox delivery, assistant messages and execution termination in the existing engine event owner. An unqualified session-idle event, old transcript tail, matching timestamp or unrelated assistant message is insufficient. `ownsExecution()` must reflect the current native drain ownership, not the fact that a local voice request once existed. `ownsPermission(id)` must identify the native permission from that observed execution. No new event or transcript authority is introduced here.

`submit` derives a deterministic `msg_veyra_voice_<sha256>` from the full scope and existing voice request ID. `steer`/`queue` use the same derivation from the existing durable intervention operation ID, preserving native delivery. Admission acknowledgement confirms the inbox mutation, not completion of a tool or queued job. Voice metadata on those ordinary native prompts identifies only correlation/ownership; it does not instruct the model or alter retention/defaults.

Interruption cancels only native inbox entries whose voice metadata and derived ID match this scope/request. It refuses to interrupt a busy execution unless the existing observer proves ownership. It calls native interrupt with `resume=false`, then requires native inactivity and absence of matching queued work. An idle `interrupted:false` is acknowledged only after these checks. Uncertain deletion/interrupt results stay unknown; no alternate session or replay is attempted. `closeVoice` cancels this voice session's owned inbox/subscriptions and never deletes the engine conversation. The caller's existing interruption fence handles active work first.

`availability(context, scope)` performs read-only bound session checks and reports unavailable for missing binding, observer, selected native model/agent or unsupported contract. Available describes this adapter's readiness; it is not microphone, GPU, VAD, audible latency or full call acceptance. It never chooses a replacement model.

## Work mount props

`components/voice-v2/VoiceWorkMount.tsx` exports `VoiceWorkMountProps`:

```ts
{
  scope: VoiceScope | null;
  readiness: { gateway: boolean; speech: boolean; draft: boolean; agent: boolean };
  ports?: Omit<VoicePorts, 'play' | 'stopPlayback' | 'stopCapture'>;
  mascot: ReactNode;
}
```

Use it in the existing Work voice slot. Supply stable ports from `createHttpVoicePorts`, with dictation inserting only into the exact current draft. `readiness.gateway` comes from the mounted authenticated API, `speech` from qualified worker readiness, `draft` from the exact composer binding and `agent` from the bound adapter's availability. Missing/unknown readiness must be false. Do not hardcode true from source tests.

The mount renders disabled controls and a concrete unavailable reason when bindings/services are absent. Dictation can remain available while the working agent is unavailable. It creates a `VoiceClient` only on a user click, preserves all scope fields in its lifecycle key and disposes on scope/readiness removal. The StrictMode setup/cleanup/setup probe does not terminate a live user-started connection; a real unmount disposes it in the next microtask. No capture occurs while rendering or evaluating capability state.

The mount intentionally supplies no `speechGate`: default duplex remains half. VAD/echo qualification, partial STT and attended microphone/speaker acceptance remain open. No source edit enables an automatically successful call.

## Verification and storage

Run the existing dependency-free `veyra-voice-*.test.mjs` suite from README. New cases verify native ID/delivery, subscription-before-admission, no model/agent mutation, foreign-result rejection, owned permission/cancellation/inbox handling, unavailable states and StrictMode lifetime behavior. All native requests in worker tests are injected in-process fixtures; no real native server, microphone, speech worker or inference was contacted.

Coordinator request: exact merged API/dashboard noEmit plus changed Work mount lint/render checks with existing centrally owned dependencies. No worker npm/install/full build/cache/output tree was created. New source/tests/docs stay inside the same owned checkout and approved storage root; removed paths none, removed bytes 0. These source files remain required by coordinator integration and final acceptance.
