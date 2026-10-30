# Original-owner integration anchors

This is a proposal inside the worker docs slice. Root owns canonical edits,
shared exports, migration registration and composition. The fixture validates
the source owner and SQL in isolation; these splices have not been mounted or
qualified. No Rust writer/cutover, fake completed-agent row or serialized handle.

Observed integration HEAD: `a27cba4093aae9274d458352abadc30d25a70fba`.
Current dirty-file SHA256 anchors (recheck before applying):

| Canonical relative path | SHA256 |
| --- | --- |
| packages/ingenium-core/lib/tools/voice-operation-ledger.ts | b4c2ace194e9b3e2912034897ae68824c435b6f78dd0b3664e6ab2264a8b405a |
| packages/ingenium-core/lib/tools/voice-operation-cpu.ts | af2ba23aa5f520c3870a80346d7af0fb41aab92fa380134c1b0de279389f1022 |
| services/ingenium-api/lib/voice-v2/request-context.ts | 7749d9b11e080b7403b7a3a538762404e9398dbb666f06cfcb193bf297bc0188 |
| services/ingenium-api/lib/voice-v2/managed-supervisor.mjs | 266bcede5fce10416ee3aab2f7bfd4afe396eac905f6c4905dbf5749a611ad9e |

## Core ledger and CPU gates

Install `voice-assistant-source.ts` beside actual `voice-operation-ledger.ts`.
Extend `VoiceLedgerPorts<C>` with the optional fixed `originalAssistantSources`
port; extend original owner authority picks and Core contract deliberately.
Absence throws named unavailable, never inject a default or test factory.

Refactor the EXISTING `publicLedger.reserve` transaction body to an unexported
`reserveWithinTransaction(context,input,ownerInput,assistantClaim=null)`.
Keep validation, authorization, original/dedup/deadline/CPU boot checks and SQL
INSERT byte-equivalent except the exact parent branch below. Public reserve
calls `write(()=>reserveWithinTransaction(...))` with NO claim. The source
owner's internal `reserveAttached` calls the body directly within its already
open source-link transaction. Do not nest `write()` or checkpoint an uncommitted
transaction. The fixture's nested-write helper is explicitly synthetic and does
not demonstrate the actual production transaction composition.

```ts
if (assistantClaim !== null) {
  sources.assertOriginalAssistantReservation(context,assistantClaim,original,originalOwner);
} else if (original.parentOperationId) {
  // EXACT current genuine voice-agent-turn parent checks stay here unchanged.
}
```

Create `sources=createOriginalAssistantSourceOwner(ports,{get,write,authorize,
canonical,digest,equal,uuid,hash,integer,validateOriginal:validateVoiceOriginal,
reserveAttached:reserveWithinTransaction})` once per actual ledger instance.
Expose only `reserveOriginalAssistantSource`, `reserveAttachedAssistantTts`,
`spendOriginalAssistantSource`, `fenceOriginalAssistantSources` and the internal
supervisor gate if required by Root's final composition. Do not expose the
`assertOriginalAssistantReservation` internal helper as an independent parent
bypass. Source owner checks actual WeakMap even if a caller reaches that helper.

Pass `requireOriginalAssistantCpuLive:sources.requireOriginalAssistantCpuLive`
to `createVoiceCpuExtension` internal ports. At `claimCpuDispatch`, INSIDE the
same Core write transaction, after `cpuOwned` and before setting dispatchClaimed:

```ts
i.requireOriginalAssistantCpuLive(context,row.operation_id,request.owner);
```

At `retainCpu`, after real owner/identity checks and BEFORE looking up/returning
`cpu.transactions[request.transactionId]`, run the same check when
`request.phase==='running'`. Keep the normal live checks on new running
transitions too. A running ACK replay must fail after barge/End/auth/source
change; checking only a fresh transaction would reopen the old ACK path.
Terminal/uncertain negative retention and physical retirement remain available
through their existing original-owner proofs; they never mint a source grant.

## Actual request-context WeakMaps

Inside `services/ingenium-api/lib/voice-v2/request-context.ts`, import the three
fixed policy constants from actual `attached-verbatim-policy.mjs` and source
types from the final Core export. Add these functions beside the ACTUAL
`currentAgentPlans/currentAgentCalls` declarations. This code must not live in a
separate module with a second WeakMap, nor accept metadata/proof callbacks.

```ts
export function inspectHostedAssistantSourceOriginal(
 context:HostedVoiceRequestContext,privatePlanHandle:HostedAssistantObservation
) {
 const plan=currentAgentPlans.get(privatePlanHandle);
 if(!plan)return fail('CALL_PLAN_ORIGINAL_REQUIRED',403);
 const call=plan.call,profile=callCurrent(call),held=original(call.context);
 const fresh=original(context),facts=liveFacts(fresh),m=plan.metadata;
 assertHostedVoiceAttachment(context,call.scope,'speech');
 if(call.physicalExpiresAt<=Date.now()||plan.generation!==call.generation||
    !call.plans.has(privatePlanHandle)||!sameScope(fresh.scope,call.scope)||
    fresh.authSessionId!==held.authSessionId||fresh.sessionId!==held.sessionId||
    fresh.backendId!==held.backendId||fresh.startIdentity!==held.startIdentity||
    callHash(fresh.selection)!==callHash(held.selection)||
    axes.some(k=>fresh.execution[k]!==held.execution[k])||
    fresh.resource?.scope!==call.resource.scope||
    fresh.resource?.producer!==call.resource.producer||
    m.callId!==call.callId||m.callInstanceId!==call.instanceId||
    m.callGeneration!==call.generation||m.turnGeneration!==call.generation||
    m.engineSessionId!==held.sessionId||m.controlOperationId!==profile.controlOperationId||
    m.profileDigest!==profile.profileDigest||m.voice!==profile.defaultVoice||
    m.controlOwnerHash!==callHash(profile.owner)||
    m.userEpoch!==facts.p.session!.security_epoch||
    m.workspaceEpoch!==facts.workspace.securityEpoch||m.runtimeEpoch!==facts.runtime.securityEpoch||
    typeof m.observedAt!=='number'||m.observedAt>Date.now()||
    typeof m.deadlineAt!=='number'||m.deadlineAt>call.deadlineAt||m.deadlineAt<=Date.now()||
    m.policyId!==ATTACHED_SPEECH_POLICY_ID||
    m.policyImplementationSha256!==ATTACHED_SPEECH_POLICY_SHA256||
    m.segmenterImplementationSha256!==ATTACHED_SPEECH_SEGMENTER_SHA256||
    !Array.isArray(m.segments)||m.segments.length!==plan.texts.length)
   return fail('CALL_SOURCE_ORIGINAL_CHANGED',409);
 return {call:call.handle,plan:privatePlanHandle,metadata:m,
   authSessionId:fresh.authSessionId,backendId:fresh.backendId,
   startIdentity:fresh.startIdentity,owner:profile.owner,
   segments:plan.texts.map((s,index)=>({index,kind:m.segments[index].kind,
    textSha256:createHash('sha256').update(s).digest('hex'),
    bytes:Buffer.byteLength(s),characters:[...s].length}))};
}
export function inspectOriginalAssistantCallForFence(handle:HostedCurrentAgentCall) {
 const call=currentAgentCalls.get(handle);
 if(!call)return fail('CALL_ORIGINAL_REQUIRED',403);
 // Deliberately no positive auth/live check: exact original only reduces rights.
 return {call:handle,callId:call.callId,callInstanceId:call.instanceId,generation:call.generation};
}
export function inspectHostedAssistantCpuDispatch(
 context:HostedVoiceRequestContext,opaqueDispatch:object
) {
 const record=original(context);liveFacts(record);
 const resource=record.resource;
 if(!resource||!resource.producer.isOwnedScope(resource.scope))
   return fail('CALL_CPU_ORIGINAL_REQUIRED',403);
 assertHostedVoiceAttachment(context,record.scope,'speech');
 const value=resource.producer.inspectOriginalAssistantCpuDispatch(context,opaqueDispatch);
 if(!sameScope(value.scope,record.scope)||!sameScope(value.scope,resource.scope.scope)||
    callHash(value.owner)!==callHash(resource.scope.owner))
   return fail('CALL_CPU_ORIGINAL_CHANGED',409);
 return value;
}
```

Use proper narrowed local segment-array types in the final TypeScript splice;
the code above is an owner-location recipe, not a compiled canonical patch.
Keep all existing raw read-before/after provenance, session selection, immutable
policy recipe and no agentSettlementProof intact. Core independently rehashes
the retained source/plan and selected segment facts. No read DTO authorizes it.
The actual `plan.texts` array contains text-gap entries, so preserve array index
alignment. Only Core chooses the next unclaimed `kind==='tts'` index.

In actual barge/End, synchronously invoke Core negative fence with `call.handle`
BEFORE incrementing generation or disposing plans. Set local fencing/ending and
abort even if durable fencing fails, then retain/propagate failure; do not
release/end the lease as though successful. Never invoke positive inspectors to
fence. Barge/End do not cancel or settle the attached agent or goal queue.

## Actual supervisor private handle inspector

Refactor actual public `reserveCpu(input)` to a wrapper over private
`#reserveCpu(input,sourceClaim=null)`; generic wrapper always passes null.
Add `reserveAttachedAssistantCpu(input,sourceClaim)` which rejects non-synthesize
and invokes that private method. Parent=actual scope control is selected inside
the attached branch, never accepted from supplied input. Actual Core claim is
still required and independently verifies it. Before reservation form:

```js
const assistantSource=sourceClaim===null?null:Object.freeze({sourceClaim,
 segmentIndex:sourceClaim.segmentIndex,requestId,
 textSha256:hash(Buffer.from(text)),voice});
const reserved=sourceClaim===null
 ? this.ledger.reserve(scope.contextFor(context),original,scope.owner)
 : this.ledger.reserveAttachedAssistantTts(scope.contextFor(context),sourceClaim,original,scope.owner);
// ONLY after accepted/fresh and real registerReserved:
this.#prepared.set(handle,{scope,context,identity,payload,original,assistantSource});
this.#handles.set(handle,{scope,context,identity,assistantSource});
```

The private preparation contains exact text/payload already owned by the
supervisor; `#handles` retains immutable hashes/tuple only, no text copy. Add this
method INSIDE the same actual `ManagedCpuSupervisor` class:

```js
inspectOriginalAssistantCpuDispatch(context,handle) {
 const held=this.#handles.get(handle),prepared=this.#prepared.get(handle);
 if(!held?.assistantSource)fail('CPU_ASSISTANT_ORIGINAL_REQUIRED');
 const {scope,identity,assistantSource:s}=held;
 this.#assertAttachmentScope(context,scope);
 if(this.#current!==scope||!scope.operations.has(identity.operationId)||
    identity.kind!=='synthesize'||identity.bootId!==scope.workerBootId||
    identity.instanceId!==scope.owner.instanceId||identity.ownerId!==scope.owner.ownerId||
    identity.ownerGeneration!==scope.owner.ownerGeneration||
    handle.operationId!==identity.operationId||handle.requestId!==s.requestId)
   fail('CPU_ASSISTANT_ORIGINAL_CHANGED');
 if(prepared) {
  if(prepared.scope!==scope||prepared.assistantSource!==s||
     !equal(prepared.identity,identity)||scope.preparedHandle!==handle||
     prepared.original.parentOperationId!==scope.controlOperationId||
     prepared.original.controlOperationId!==scope.controlOperationId||
     prepared.original.requestId!==s.requestId||
     cpuPayloadDigest('synthesize',prepared.payload)!==identity.digest)
    fail('CPU_ASSISTANT_ORIGINAL_CHANGED');
  const payload=JSON.parse(prepared.payload.toString('utf8'));
  if(payload.requestId!==identity.operationId||payload.voice!==s.voice||
     typeof payload.text!=='string'||hash(Buffer.from(payload.text))!==s.textSha256)
    fail('CPU_ASSISTANT_ORIGINAL_CHANGED');
 }
 return {scope:scope.scope,owner:scope.owner,controlOperationId:scope.controlOperationId,
  operationId:identity.operationId,identity,textSha256:s.textSha256,voice:s.voice,
  requestId:s.requestId,segmentIndex:s.segmentIndex,sourceClaim:s.sourceClaim,
  prepared:!!prepared};
}
```

Real plan owner obtains claim, takes text at that claim's readonly index from
the ACTUAL `plan.texts`, reserves attached CPU, then calls Core spend with the
original handle. Spend MUST complete before `executeCpu`, CpuOwnershipClient,
wire/fetch/fork/effect. At execute start, before deleting `#prepared`, recheck
Core `requireOriginalAssistantCpuLive` for attached handles. Core rechecks at
claimDispatch AND retain-running (including cached ACK) against actual retained
plan/dispatch again. Do not add a supplied DTO/success callback. Retain private
immutable supervisor facts after prepared payload is consumed; that is why
later gates accept `prepared:false` only after an original committed spend.

## Startup and restore

Register SQL134 once through existing Core migrations (130-133 stay unchanged).
Apply the follow-on `veyra_voice_assistant_update_no_replace` BEFORE UPDATE
guard as well as the INSERT guard. It checks every unique identity against
other rows excluding OLD and raises ABORT under caller OR IGNORE/OR REPLACE.
Without it, a legal reserved-to-linked CPU identity update can cause REPLACE to
delete another original when recursive triggers are disabled. Root must mount
this guard in canonical SQL134 before treating source retention as validated.
At ORIGINAL Core startup/restore, before any new request/dispatch admission,
execute this reduction through the original Core transaction/checkpoint path:

```sql
UPDATE veyra_voice_assistant_sources
SET fenced=1,fence_reason=COALESCE(fence_reason,'CORE_STARTUP_OR_RESTORE'),
 phase=CASE WHEN phase IN ('reserved','linked') THEN 'unknown' ELSE phase END,
 revision=revision+1 WHERE fenced=0;
```

Do not run this each time a ledger factory is constructed in an already active
process. Preserve all originals, spent identities and unknown links; never
create FK placeholders, auth sessions, agent results, new CPU handles, replay,
adoption or reprepare from rows. A restored database missing original FK rows
fails restoration; manufacturing them is forbidden. A missing tombstone hook
still denies rehydration via absent WeakMaps, but does not satisfy the explicit
startup/restore durability gate. Root must add and validate that actual hook.
