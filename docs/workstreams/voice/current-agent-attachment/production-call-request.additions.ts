// APPEND inside actual request-context.ts. No public DTO authorizes a call.
declare const currentCallRequestBrand:unique symbol;
export interface HostedCurrentCallRequest {readonly [currentCallRequestBrand]:true}
type CallRequestRecord={request:Request;call:CallRecord;context:HostedVoiceRequestContext;generation:number};
const callRequests=new WeakMap<HostedCurrentCallRequest,CallRequestRecord>();

function checkCurrentCallRequest(value:HostedCurrentCallRequest,allowGenerationChange=false):CallRequestRecord {
 const grant=callRequests.get(value);if(!grant)return fail('CALL_REQUEST_ORIGINAL_REQUIRED',403);
 const {call,request,context}=grant,old=original(call.context),fresh=original(context);
 const principal=user(request);
 if(principal.id!==call.scope.actorId||principal.session!.id!==old.authSessionId
  ||fresh.request!==request||fresh.authSessionId!==old.authSessionId
  ||fresh.backendId!==old.backendId||fresh.startIdentity!==old.startIdentity||fresh.sessionId!==old.sessionId
  ||callHash(fresh.selection)!==callHash(old.selection)||!sameScope(fresh.scope,call.scope)
  ||axes.some(axis=>fresh.execution[axis]!==old.execution[axis])
  ||fresh.resource?.scope!==call.resource.scope||fresh.resource.producer!==call.resource.producer)
  return fail('CALL_REQUEST_IDENTITY_CHANGED',403);
 assertHostedVoiceAttachment(context,call.scope,'read');
 if(!allowGenerationChange&&grant.generation!==call.generation)return fail('CALL_REQUEST_GENERATION_CHANGED',409);
 return grant;
}

/** Called with THIS incoming admitted Express Request, never the opening Request.
 * Selection comes only from the private original call. Capturing it repeats the
 * actual cookie/session, placement, private chat->engine and manager checks.
 * Unsupported sessionless bearers fail through the existing user() owner.
 */
export async function captureHostedCurrentCallRequest(request:Request,handle:HostedCurrentAgentCall):Promise<HostedCurrentCallRequest> {
 const call=currentCall(handle),old=original(call.context);callCurrent(call);
 const principal=user(request);
 if(principal.id!==call.scope.actorId||principal.session!.id!==old.authSessionId)return fail('CALL_REQUEST_IDENTITY_CHANGED',403);
 const generation=call.generation;
 // Enroll before actual network capture; End joins this original as well.
 const context=await retainCallWork(call,()=>captureHostedVoiceRequest(request,{...old.selection}));
 const bound=bindHostedVoiceCpuContext(context,call.resource.scope,call.resource.producer);
 const grant=Object.freeze({}) as HostedCurrentCallRequest;
 callRequests.set(grant,{request,call,context:bound,generation});
 try{checkCurrentCallRequest(grant);await refreshHostedCurrentAgentCall(handle);checkCurrentCallRequest(grant);return grant;}
 catch(error){callRequests.delete(grant);throw error;}
}

/** Fixed operation set; no caller callbacks, owner facts, source DTOs or plans.
 * Router holds opaque grants and call handles privately; serialize only results.
 * Each NEW HTTP request captures a NEW grant. Drop it in the route's finally.
 */
export async function dispatchHostedCurrentCallRequest(grant:HostedCurrentCallRequest,operation:'status'|'barge-in'|'end'|'open-events'|'next-event'):Promise<unknown> {
 const {call}=checkCurrentCallRequest(grant),handle=call.handle;
 if(operation==='status'){callCurrent(call);return inspectHostedCurrentAgentCall(handle);}
 if(operation==='barge-in'){
  const result=await bargeInHostedCurrentAgentCall(handle);
  checkCurrentCallRequest(grant,true);return result;
 }
 if(operation==='end'){
  const result=await endHostedCurrentAgentCall(handle);
  // Authenticate THIS request after join without pretending the ended CPU
  // resource remains live. No speech/subscription effect follows this check.
  checkCurrentCallRequest(grant,true);return result;
 }
 if(operation==='open-events'){
  await openHostedCurrentAgentEvents(handle);checkCurrentCallRequest(grant);callCurrent(call);return null;
 }
 if(operation==='next-event'){
  const event=await nextHostedCurrentAgentEvent(handle);
  checkCurrentCallRequest(grant);callCurrent(call);return event;
 }
 return fail('CALL_REQUEST_OPERATION_INVALID',422);
}
export function releaseHostedCurrentCallRequest(grant:HostedCurrentCallRequest):void {callRequests.delete(grant);}
