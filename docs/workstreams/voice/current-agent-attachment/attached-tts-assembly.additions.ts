declare const attachedTtsBrand:unique symbol;
export interface HostedAttachedTts {readonly [attachedTtsBrand]:true}
type AttachedTts={call:CallRecord;generation:number;context:HostedVoiceRequestContext;started:boolean;failure?:unknown;dispatch:ReturnType<CallCpu['producer']['reserveAttachedAssistantCpu']>};
const attachedTts=new WeakMap<HostedAttachedTts,AttachedTts>();
const pendingTts=new WeakMap<CallRecord,Set<HostedAttachedTts>>();
function cancelAttachedTts(token:HostedAttachedTts):void {
 const held=attachedTts.get(token);if(!held)return;if(held.failure)throw held.failure;
 try{held.call.resource.producer.cancelPrepared(held.dispatch);}
 catch(error){if(!error||typeof error!=='object'||!('code'in error)||error.code!=='CPU_ORIGINAL_DISPATCH_SPENT'){held.failure=error;throw error;}}
 pendingTts.get(held.call)?.delete(token);attachedTts.delete(token);
}
function fenceAttachedTts(call:CallRecord,reason:'BARGE_IN'|'END'):void {
 // Fence OLD generation before the caller increments it. Negative owner needs
 // no new auth grant. Keep cancellation originals on any cleanup failure.
 try{call.resource.producer.fenceOriginalAssistantSources(call.handle,reason);}catch(error){call.failure??=error;}
 for(const token of pendingTts.get(call)??[]){try{cancelAttachedTts(token);}catch(error){call.failure??=error;}}
}
export function prepareHostedCurrentAgentTts(callHandle:HostedCurrentAgentCall,planHandle:HostedAssistantObservation,grant:HostedCurrentCallRequest):HostedAttachedTts {
 const incoming=checkCurrentCallRequest(grant),call=currentCall(callHandle);
 if(incoming.call!==call)return fail('CALL_REQUEST_IDENTITY_CHANGED',403);
 inspectHostedCurrentAgentPlan(callHandle,planHandle);
 const plan=currentAgentPlans.get(planHandle)!;
 const producer=call.resource.producer,context=incoming.context;
 const claim=producer.reserveOriginalAssistantSource(context,planHandle);
 const text=plan.texts[claim.segmentIndex];
 const turnId=plan.metadata.speechTurnId;
 if(typeof turnId!=='number'||!Number.isSafeInteger(turnId)||turnId<1||typeof text!=='string')return fail('CALL_PLAN_ORIGINAL_REQUIRED',403);
 const dispatch=producer.reserveAttachedAssistantCpu({context,scope:call.scope,kind:'synthesize',text,voice:call.profile!.defaultVoice,
  requestId:claim.requestId,deadlineAt:call.deadlineAt,turn:{sessionId:call.callId,turnId,generation:call.generation,requestId:`voice:${call.callId}:${turnId}`}},claim);
 const token=Object.freeze({}) as HostedAttachedTts;
 attachedTts.set(token,{call,generation:call.generation,context,dispatch,started:false});
 let pending=pendingTts.get(call);if(!pending){pending=new Set();pendingTts.set(call,pending);}pending.add(token);
 try{producer.spendOriginalAssistantSource(context,claim,dispatch);return token;}
 catch(error){try{cancelAttachedTts(token);}catch(cleanup){call.failure??=cleanup;}throw error;}
}
export function executeHostedCurrentAgentTts(grant:HostedCurrentCallRequest,token:HostedAttachedTts,signal:AbortSignal):Promise<unknown> {
 const incoming=checkCurrentCallRequest(grant),held=attachedTts.get(token);
 if(!held||held.started||held.call!==incoming.call||held.generation!==incoming.call.generation)return fail('CALL_TTS_ORIGINAL_REQUIRED',403);
 held.started=true;
 const call=held.call,combined=AbortSignal.any([signal,call.controller.signal,call.lifetime.signal]);
 const work=retainCallWork(call,async()=>{
   checkCurrentCallRequest(grant);callCurrent(call);combined.throwIfAborted();
   const result=await call.resource.producer.executeCpu(held.dispatch,{signal:combined});
   await refreshHostedCurrentAgentCall(call.handle);
   checkCurrentCallRequest(grant);callCurrent(call);combined.throwIfAborted();return result;
 },combined);
 // Also join cleanup when enrollment rejects BEFORE entering its effect.
 const joined=work.finally(()=>{try{cancelAttachedTts(token);}catch(cleanup){call.failure??=cleanup;throw cleanup;}});
 call.work.add(joined);joined.catch(()=>undefined).finally(()=>call.work.delete(joined));return joined;
}
