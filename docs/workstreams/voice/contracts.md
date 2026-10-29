# Voice local adapter DTO and integration changes

This consumer proposal follows the coordinator's frozen `docs/contracts/veyra-parallel-v1.md` semantics. It does not replace shared schemas or grant execution authority. The coordinator must map and validate its public DTO names before exposure.

```ts
interface VoiceScope {
  actorId: string;
  accountId: string;
  organizationId: string | null;
  projectId: string | null;
  conversationId: string;
  runtimeId: string;
  executionBindingId: string;
  executionRevision: string;
  agentId: string;
}
interface VoiceTurn {
  sessionId: string;
  turnId: number;
  generation: number;
  requestId: string; // voice:<sessionId>:<turnId>
}
```

`executionRevision` is an opaque server-issued exact-request admission/recovery identity. The existing native authority must bind it to immutable workspace ID/hash/epoch, native instance/revision and canonical host/environment/directory; it is not a browser-generated hash or a new native authority. Validate it on every operation alongside the actual binding. Mismatches stay unavailable, with no runtime/root fallback. Projectless remains null with private actor ownership. The actor is the authenticated initiating human, not a request-supplied impersonation option.

VoiceTurn accepts exactly its four declared fields. Native active-turn actions require the same request ID, turn ID and generation as the admitted turn. Extra options and altered generations are rejected before synthesis, approval, steering, completion or interruption can reach the native adapter.

`VoicePorts` in `packages/veyra-voice/session.d.mts` is the complete consumer interface. Call/live modes preserve the existing working conversation and current native session model/effort. No default model is selected in this stream. Work/Web switches must retain or explicitly end this same voice scope rather than create another transcript. Memory use/contribution follows the existing conversation policy and exact host/environment scope through the agent adapter; no independent voice memory storage or extraction is introduced.

Steer/queue requests additionally require `operationId: voice-control:<sessionId>:<counter>`. The operation ledger reserves that ID with the native parent `turn.requestId` and records its own completed/unknown outcome. The native bridge receives the operation ID; the service returns it only after a confirmed scoped native acknowledgement. `VoicePorts.steer` acknowledgements contain `{accepted:true,requestId,operationId,scope}`. This prevents control mutations from sharing the main prompt's single admission record. It is a local consumer contract addition requiring coordinator mapping, not a root-schema edit.

## Shared edits requested from coordinator

| Owner surface | Minimal change |
| --- | --- |
| Existing API gateway/router | Mount `createVoiceHttp` under `/api/voice/v2/` after current authentication/CSRF/origin/rate-limit checks; preserve the trusted initiating actor |
| Existing authorization/binding resolver | Implement `authorize(context, scope, capability, signal)` with exact native admission revision and separate safe owned stop/close semantics after execution revocation |
| Existing agent/event bridge | Bind submit/steer/queue/approve/interrupt/closeVoice; normalize scoped events without auto-approving or broadening tools |
| Existing durable operations | Bind `reserve`/`settle`; existing request IDs remain durable and completed/unknown outcomes must not be replayed or double charged |
| Existing Jobs/lifecycle | Call `VoiceService.expire()` with trusted native cleanup authority; retain failed cleanup receipts |
| Work owner | Add `VoiceControls`; mount `VoicePanel` with current scope and mascot; create/dispose `VoiceClient` per explicit user action; bind dictation to composer draft |
| Native audio/platform owner | Supply qualified VAD/echo evidence to `speechGate`; batch Stratus STT currently supplies final transcripts only. Partial streaming STT requires an actual qualified upstream stream adapter, not fabricated partial text |
| Build/package owner | Include new `.mjs` source and `.d.mts` declarations in exact-source checks/package runtime, or bundle their relative dependencies; update root manifests/locks only if the integrated build needs it |

No edits to these shared surfaces were made by the voice worker. There are no SQL migrations or new credentials/settings in this change.

## HTTP wire

`open` and explicit `resume` return an exact-scope grant. `transcribe` accepts binary normalized PCM with a URI-encoded JSON `X-Veyra-Voice` envelope. `submit` emits bounded NDJSON records `{kind:'event',event}`, followed by one `{kind:'result',result}` or `{kind:'error',code}`. `synthesize` returns validated WAV. `steer`, `approve`, `interrupt`, `complete` and `close` are POST actions with strict top-level fields. See `openapi.json` for method/schema/status definitions.

The speech token never crosses this boundary. Unexpected fields, cross-scope events and malformed audio fail closed. Client and service adapters never automatically replay uncertain mutations. The native bridge must impose model/tool deadlines in addition to the local three-second interruption acknowledgement deadline; HTTP abort alone is insufficient evidence that native work stopped.
