// APPEND to actual request-context.ts. Imports specified in exact recipe.
// Requires CPU already opened by original production owner; starts no worker.
declare const currentAgentCallBrand:unique symbol;
export interface HostedCurrentAgentCall {readonly [currentAgentCallBrand]:true}
type CallCpu=NonNullable<RecordContext['resource']>;
type CallLease=ReturnType<CallCpu['producer']['captureAttachmentLease']>;
type CallResourceFacts=ReturnType<CallCpu['producer']['inspectAttachmentLease']>;
type SourcePlan={call:CallRecord;generation:number;metadata:Readonly<Record<string,unknown>>;texts:readonly string[];bytes:number};
type CallSub={controller:AbortController;open:Promise<ReadableStream<Uint8Array>>;reader:ReadableStreamDefaultReader<Uint8Array>|null;pending:Promise<unknown>|null;stop:Promise<void>|null;buffer:string;decoder:TextDecoder;total:number;stopped:boolean;failure:unknown};
type CallRecord={handle:HostedCurrentAgentCall;context:HostedVoiceRequestContext;resource:CallCpu;lease:CallLease;callId:string;instanceId:string;scope:Readonly<VoiceScope>;deadlineAt:number;generation:number;controller:AbortController;lifetime:AbortController;state:'opening'|'open'|'fencing'|'ending'|'ended';selection:RawSessionSelection|null;sessionSha256:string|null;physicalExpiresAt:number;profile:CallResourceFacts|null;work:Set<Promise<unknown>>;plans:Set<HostedAssistantObservation>;retainedBytes:number;plannedCount:number;seen:Map<string,{end:number;prefixSha256:string}>;planning:boolean;sub:CallSub|null;barge:Promise<unknown>|null;end:Promise<unknown>|null;failure:unknown;timer:ReturnType<typeof setTimeout>|null};
const currentAgentCalls=new WeakMap<HostedCurrentAgentCall,CallRecord>();
const activeCurrentAgentCalls=new Set<HostedCurrentAgentCall>();
const currentAgentPlans=new WeakMap<HostedAssistantObservation,SourcePlan>();
const callHash=(value:unknown)=>createHash('sha256').update(callCanonical(value)).digest('hex');
function callCanonical(value:unknown):string {
 if(value===null||typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isSafeInteger(value))return JSON.stringify(value);
 if(!value||typeof value!=='object')return fail('CALL_CANONICAL_INVALID',422);
 if(Array.isArray(value))return '['+value.map(callCanonical).join(',')+']';
 const record=value as Record<string,unknown>;return '{'+Object.keys(record).sort().map(k=>JSON.stringify(k)+':'+callCanonical(record[k])).join(',')+'}';
}
function currentCall(handle:HostedCurrentAgentCall):CallRecord {const value=currentAgentCalls.get(handle);if(!value)return fail('CALL_ORIGINAL_REQUIRED',403);return value;}
function callCurrent(call:CallRecord,allowOpening=false,allowFencing=false):CallResourceFacts {
 if(!['open',...(allowOpening?['opening']:[]),...(allowFencing?['fencing']:[])].includes(call.state)||call.deadlineAt<=Date.now())return fail('CALL_GENERATION_FENCED',409);
 const record=original(call.context),facts=liveFacts(record);
 assertHostedVoiceAttachment(call.context,call.scope,'speech');
 if(record.resource!==call.resource||!sameScope(record.scope,call.scope)||!['READY','IDLE'].includes(facts.runtime.state)
  ||!facts.runtime.leaseExpiresAt||!facts.runtime.absoluteExpiresAt||!Number.isFinite(Date.parse(facts.runtime.leaseExpiresAt))||!Number.isFinite(Date.parse(facts.runtime.absoluteExpiresAt))
  ||Date.parse(facts.runtime.leaseExpiresAt)<=Date.now()||Date.parse(facts.runtime.absoluteExpiresAt)<=Date.now())return fail('CALL_SOURCE_CHANGED',409);
 const resource=call.resource.producer.inspectAttachmentLease(call.lease),profile=call.profile;if(!profile)return fail('CALL_ORIGINAL_REQUIRED',403);
 if(resource.controlOperationId!==profile.controlOperationId||resource.profileDigest!==profile.profileDigest||resource.defaultVoice!==profile.defaultVoice
  ||callHash(resource.owner)!==callHash(profile.owner)||!sameScope(resource.scope,call.scope))return fail('CALL_CPU_ORIGINAL_CHANGED',409);
 return resource;
}
async function refreshCallPhysicalSource(call:CallRecord,allowOpening=false,signal:AbortSignal=call.lifetime.signal):Promise<void> {
 callCurrent(call,allowOpening,true);const record=original(call.context);
 const raw=await inspectOriginalCallRuntimeJobRole(call.scope.runtimeId,AbortSignal.any([call.lifetime.signal,signal]));
 callCurrent(call,allowOpening,true);
 if(!raw||typeof raw!=='object'||!('schemaVersion'in raw)||raw.schemaVersion!==1||!('kind'in raw)||raw.kind!=='original-manager-core126-parent-v1'
  ||!('observedAt'in raw)||typeof raw.observedAt!=='number'||!Number.isSafeInteger(raw.observedAt)||raw.observedAt>Date.now()
  ||!('expiresAt'in raw)||typeof raw.expiresAt!=='number'||!Number.isSafeInteger(raw.expiresAt)||raw.expiresAt!==raw.observedAt+5000||raw.expiresAt<=Date.now()
  ||!('daemonId'in raw)||typeof raw.daemonId!=='string'||!text(raw.daemonId)||!('hostId'in raw)||raw.hostId!==record.execution.hostId
  ||raw.hostId!=='docker-daemon:'+createHash('sha256').update('veyra-docker-host-v1\0'+raw.daemonId).digest('hex')
  ||!('parent'in raw)||!raw.parent||typeof raw.parent!=='object')return fail('CALL_SOURCE_ATTESTATION_CHANGED',409);
 const parent=raw.parent;
 if(!('id'in parent)||parent.id!==record.backendId||!('startIdentity'in parent)||parent.startIdentity!==record.startIdentity
  ||!('runtimeId'in parent)||parent.runtimeId!==call.scope.runtimeId||!('workspaceId'in parent)||parent.workspaceId!==record.selection.workspaceId
  ||!('organizationId'in parent)||parent.organizationId!==call.scope.organizationId||!('projectId'in parent)||parent.projectId!==call.scope.projectId
  ||!('ownerUserId'in parent)||parent.ownerUserId!==call.scope.actorId||!('bindingHash'in parent)||parent.bindingHash!==record.execution.bindingHash
  ||!('bindingEpoch'in parent)||parent.bindingEpoch!==record.execution.bindingEpoch)return fail('CALL_SOURCE_ATTESTATION_CHANGED',409);
 call.physicalExpiresAt=raw.expiresAt;
}
export function refreshHostedCurrentAgentCall(handle:HostedCurrentAgentCall):Promise<void> {
 const call=currentCall(handle);callCurrent(call);return retainCallWork(call,refreshCallPhysicalSource(call));
}
function selectedCallTarget<T>(call:CallRecord,effect:()=>T):T {
 const facts=liveFacts(original(call.context));
 return withOpenCodeRuntimeTarget({baseUrl:`http://${facts.runtime.backendName}:4098`,directory:'/workspace'},effect);
}
function retainCallWork<T>(call:CallRecord,promise:Promise<T>):Promise<T> {
 call.work.add(promise);promise.catch(error=>{if(error&&typeof error==='object'&&'code'in error&&String(error.code).includes('CLEANUP_UNKNOWN'))call.failure=error;}).finally(()=>call.work.delete(promise));return promise;
}
function disposeCallPlans(call:CallRecord):void {
 for(const handle of call.plans){const plan=currentAgentPlans.get(handle);if(plan){plan.texts=[];plan.bytes=0;}currentAgentPlans.delete(handle);}
 call.plans.clear();call.retainedBytes=0;
}
/** Context is the actual bound record from producer.bindAttachmentContext;
 * never a supplied callId/profile/owner/callback. Root production composition
 * opens the original CPU resource first. This only leases that SAME resource.
 */
export async function openHostedCurrentAgentCall(context:HostedVoiceRequestContext,signal:AbortSignal):Promise<HostedCurrentAgentCall> {
 const record=original(context);assertHostedVoiceAttachment(context,record.scope,'speech');
 if(!(signal instanceof AbortSignal))return fail('CALL_SIGNAL_REQUIRED',422);signal.throwIfAborted();
 const resource=record.resource;if(!resource||!resource.producer.isOwnedScope(resource.scope))return fail('CALL_CPU_ORIGINAL_REQUIRED');
 if(activeCurrentAgentCalls.size>=16)return fail('CALL_CAPACITY',429);
 const callId=randomUUID(),instanceId=randomUUID(),deadlineAt=Math.min(record.deadlineAt,resource.scope.deadlineAt,Date.now()+1800000);
 const lease=resource.producer.captureAttachmentLease(context,resource.scope,callId,deadlineAt);
 const handle=Object.freeze({}) as HostedCurrentAgentCall;
 const call:CallRecord={handle,context,resource,lease,callId,instanceId,scope:record.scope,deadlineAt,generation:0,controller:new AbortController(),lifetime:new AbortController(),state:'opening',selection:null,sessionSha256:null,physicalExpiresAt:0,profile:null,work:new Set(),plans:new Set(),retainedBytes:0,plannedCount:0,seen:new Map(),planning:false,sub:null,barge:null,end:null,failure:null,timer:null};
 currentAgentCalls.set(handle,call);activeCurrentAgentCalls.add(handle);
 call.timer=setTimeout(()=>{void endHostedCurrentAgentCall(handle).catch(error=>{call.failure=error;});},Math.max(1,deadlineAt-Date.now()));call.timer.unref();
 const openingAbort=()=>call.lifetime.abort();signal.addEventListener('abort',openingAbort,{once:true});
 try{
  call.profile=resource.producer.inspectAttachmentLease(lease);call.deadlineAt=Math.min(call.deadlineAt,call.profile.deadlineAt);if(call.timer)clearTimeout(call.timer);call.timer=setTimeout(()=>{void endHostedCurrentAgentCall(handle).catch(error=>{call.failure=error;});},Math.max(1,call.deadlineAt-Date.now()));call.timer.unref();callCurrent(call,true);await retainCallWork(call,refreshCallPhysicalSource(call,true));const combined=AbortSignal.any([signal,call.controller.signal]);
  const read=await retainCallWork(call,selectedCallTarget(call,()=>readOriginalCallSessionSelection({sessionId:record.sessionId,agentId:record.scope.agentId,deadlineAt:Math.min(call.deadlineAt,Date.now()+10000),signal:combined})));
  try{await retainCallWork(call,refreshCallPhysicalSource(call,true));callCurrent(call,true);combined.throwIfAborted();call.selection=read.selection;call.sessionSha256=read.sha256;call.state='open';return handle;}finally{read.raw.fill(0);}
 }catch(error){try{await endHostedCurrentAgentCall(handle);}catch(cleanup){call.failure=cleanup;const failure=Object.assign(Error('CALL_OPEN_CLEANUP_UNKNOWN'),{code:'CALL_OPEN_CLEANUP_UNKNOWN'});Object.defineProperty(failure,'originalCall',{value:handle});throw failure;}throw error;}finally{signal.removeEventListener('abort',openingAbort);}
}
export function inspectHostedCurrentAgentCall(handle:HostedCurrentAgentCall):Readonly<Record<string,unknown>> {
 const call=currentCall(handle),profile=callCurrent(call);
 return Object.freeze({callId:call.callId,instanceId:call.instanceId,scope:call.scope,generation:call.generation,deadlineAt:call.deadlineAt,
  profileDigest:profile.profileDigest,voice:profile.defaultVoice,selection:call.selection,agentExecutionOwnedByCall:false,speechDispatchAvailable:false});
}
/** Genuine raw reader is invoked INSIDE this fixed private owner. No returned
 * DTO, event text, hash, range, model/profile/voice or policy may be supplied.
 */
export function planHostedCurrentAgentSpeech(handle:HostedCurrentAgentCall,messageId:string,signal:AbortSignal):Promise<readonly HostedAssistantObservation[]> {
 const call=currentCall(handle);callCurrent(call);
 if(!(signal instanceof AbortSignal)||typeof messageId!=='string'||!/^msg_[A-Za-z0-9._:-]{1,123}$/u.test(messageId))return Promise.reject(Object.assign(Error('CALL_PLAN_INPUT'),{code:'CALL_PLAN_INPUT'}));
 if(call.planning)return Promise.reject(Object.assign(Error('CALL_PLAN_BUSY'),{code:'CALL_PLAN_BUSY'}));
 const generation=call.generation,combined=AbortSignal.any([signal,call.controller.signal]);combined.throwIfAborted();call.planning=true;
 const check=()=>{callCurrent(call);combined.throwIfAborted();if(call.generation!==generation)return fail('CALL_GENERATION_FENCED',409);};
 const task=(async()=>{
  let read:OriginalRawAssistantReadData|undefined,rawHandle:OriginalRawAssistantRead|undefined;
  try{
   check();await refreshCallPhysicalSource(call,false,combined);check();rawHandle=await selectedCallTarget(call,()=>readOriginalRawAssistantMessage({sessionId:call.scope.conversationId,messageId,agentId:call.scope.agentId,deadlineAt:Math.min(call.deadlineAt,Date.now()+10000),signal:combined}));
   // Consume genuine retained identity BEFORE revalidation; always dispose exact
   // raw arrays below, including failure/cancellation between read and plan.
   read=takeOriginalRawAssistantRead(rawHandle);rawHandle=undefined;check();await refreshCallPhysicalSource(call,false,combined);check();
   if(!call.selection||callHash(read.selection)!==callHash(call.selection))return fail('CALL_ENGINE_SELECTION_CHANGED',409);
   const staged:Array<{token:HostedAssistantObservation;plan:SourcePlan;seenKey:string;end:number;prefixSha256:string}>=[];
   let added=0;
   for(const part of read.assistant.parts){
    const seenKey=JSON.stringify([messageId,part.contentIndex]),previous=call.seen.get(seenKey),start=previous?.end??0;
    const originalBytes=Buffer.from(part.text);
    if(previous&&(originalBytes.length<start||createHash('sha256').update(originalBytes.subarray(0,start)).digest('hex')!==previous.prefixSha256))return fail('CALL_ASSISTANT_PREFIX_CHANGED',409);
    if(originalBytes.length===start)continue;
    const range=rawAssistantRange(part,start,originalBytes.length),derived=await deriveAttachedVerbatimPlan(range.text);check();
    const texts=Object.freeze(derived.segments.map(segment=>segment.text));added+=derived.projectedBytes;
    const facts=callCurrent(call),live=liveFacts(original(call.context)),sourceId=randomUUID();
    const metadata={version:1,sourceId,scope:call.scope,callId:call.callId,callInstanceId:call.instanceId,callGeneration:generation,turnGeneration:generation,speechTurnId:call.plannedCount+staged.length+1,
     engineSessionId:read.assistant.sessionId,engineMessageId:messageId,contentIndex:part.contentIndex,nativePartId:part.nativePartId,
     sessionBeforeSha256:read.sessionBeforeSha256,responseSha256:read.responseSha256,sessionAfterSha256:read.sessionAfterSha256,
     snapshotSha256:part.textSha256,snapshotBytes:originalBytes.length,utf8Start:start,utf8End:originalBytes.length,rangeSha256:range.rangeSha256,prefixSha256:range.prefixSha256,
     observedAt:read.observedAt,deadlineAt:call.deadlineAt,userEpoch:live.p.session!.security_epoch,workspaceEpoch:live.workspace.securityEpoch,runtimeEpoch:live.runtime.securityEpoch,controlOperationId:facts.controlOperationId,controlOwnerHash:callHash(facts.owner),profileDigest:facts.profileDigest,voice:facts.defaultVoice,
     policyId:derived.policyId,policyImplementationSha256:derived.policyImplementationSha256,segmenterImplementationSha256:derived.segmenterImplementationSha256,
     rawTextSha256:derived.rawTextSha256,rawBytes:derived.rawBytes,projectedSha256:derived.projectedSha256,projectedBytes:derived.projectedBytes,
     segments:derived.segments.map(({text:_text,...segment})=>Object.freeze(segment)),agentSettlementProof:false};
    const sourceHash=callHash(metadata),planHash=callHash({sourceHash,profileDigest:facts.profileDigest,voice:facts.defaultVoice,policyId:derived.policyId,policyImplementationSha256:derived.policyImplementationSha256,segmenterImplementationSha256:derived.segmenterImplementationSha256,projectedSha256:derived.projectedSha256,segments:metadata.segments}),token=Object.freeze({}) as HostedAssistantObservation;
    staged.push({token,plan:{call,generation,metadata:Object.freeze({...metadata,segments:Object.freeze(metadata.segments),sourceHash,planHash}),texts,bytes:derived.projectedBytes},seenKey,end:originalBytes.length,prefixSha256:range.prefixSha256});
   }
   await refreshCallPhysicalSource(call,false,combined);check();if(call.plans.size+staged.length>64||call.plannedCount+staged.length>256||call.retainedBytes+added>262144)return fail('CALL_PLAN_CAPACITY',429);
   for(const item of staged){currentAgentPlans.set(item.token,item.plan);call.plans.add(item.token);call.seen.set(item.seenKey,{end:item.end,prefixSha256:item.prefixSha256});call.retainedBytes+=item.plan.bytes;call.plannedCount++;}
   return Object.freeze(staged.map(item=>item.token));
  }finally{if(rawHandle)discardOriginalRawAssistantRead(rawHandle);read?.rawResponseBytes.fill(0);read?.sessionBeforeBytes.fill(0);read?.sessionAfterBytes.fill(0);call.planning=false;}
 })();return retainCallWork(call,task);
}
export function inspectHostedCurrentAgentPlan(callHandle:HostedCurrentAgentCall,planHandle:HostedAssistantObservation):Readonly<Record<string,unknown>> {
 const call=currentCall(callHandle),plan=currentAgentPlans.get(planHandle);callCurrent(call);
 if(call.physicalExpiresAt<=Date.now())return fail('CALL_SOURCE_ATTESTATION_EXPIRED',409);
 if(!plan||plan.call!==call||plan.generation!==call.generation||!call.plans.has(planHandle))return fail('CALL_PLAN_ORIGINAL_REQUIRED',403);
 return plan.metadata;
}
/** Actual Core134 dispatch/claim/physical CPU operation branch is not installed.
 * Positive plan ownership must never be converted to a fake completed-agent row.
 */
export function prepareHostedCurrentAgentTts(call:HostedCurrentAgentCall,plan:HostedAssistantObservation):never {
 inspectHostedCurrentAgentPlan(call,plan);return fail('CALL_CORE134_DISPATCH_UNAVAILABLE');
}
async function stopCallSubscription(sub:CallSub):Promise<void> {
 if(sub.stop)return sub.stop;sub.stopped=true;sub.controller.abort();
 sub.stop=(async()=>{let stream:ReadableStream<Uint8Array>;try{stream=await sub.open;}catch(error){if(error&&typeof error==='object'&&'code'in error&&String(error.code).includes('CLEANUP_UNKNOWN'))throw error;return;}
  if(sub.reader){await sub.reader.cancel();if(sub.pending)await Promise.allSettled([sub.pending]);sub.reader.releaseLock();sub.reader=null;}else await stream.cancel();sub.buffer='';
 })();return sub.stop;
}
export async function openHostedCurrentAgentEvents(handle:HostedCurrentAgentCall):Promise<void> {
 const call=currentCall(handle);callCurrent(call);if(call.sub)return fail('CALL_SUBSCRIPTION_ORIGINAL_EXISTS',409);
 const controller=new AbortController();
 const sub:CallSub={controller,open:selectedCallTarget(call,()=>openOriginalCallEventBody(controller.signal)),reader:null,pending:null,stop:null,buffer:'',decoder:new TextDecoder('utf-8',{fatal:true}),total:0,stopped:false,failure:null};
 call.sub=sub;sub.open.catch(error=>{sub.failure=error;});
 try{const stream=await sub.open;if(sub.stopped||call.state!=='open'){await stopCallSubscription(sub);return fail('CALL_GENERATION_FENCED',409);}callCurrent(call);sub.reader=stream.getReader();}
 catch(error){await stopCallSubscription(sub);throw error;}
}
export function nextHostedCurrentAgentEvent(handle:HostedCurrentAgentCall):Promise<SelectedCallEvent|null> {
 const call=currentCall(handle);callCurrent(call);const sub=call.sub;
 if(!sub?.reader||sub.stopped||sub.pending)return Promise.reject(Object.assign(Error('CALL_SUBSCRIPTION_ORIGINAL_REQUIRED'),{code:'CALL_SUBSCRIPTION_ORIGINAL_REQUIRED'}));
 const task=Promise.resolve().then(async()=>{try{for(;;){
  callCurrent(call,false,true);const boundary=sub.buffer.indexOf('\n\n');
  if(boundary>=0){const block=sub.buffer.slice(0,boundary);sub.buffer=sub.buffer.slice(boundary+2);const event=parseSelectedCallEvent(block,call.scope.conversationId,'/workspace');if(event){if(call.physicalExpiresAt<=Date.now())await refreshCallPhysicalSource(call);callCurrent(call,false,true);return event;}continue;}
  const result=await sub.reader!.read();if(sub.stopped)return null;callCurrent(call,false,true);
  if(result.done){sub.decoder.decode();if(sub.buffer) return fail('CALL_EVENT_TRUNCATED');return fail('CALL_EVENT_STREAM_ENDED');}
  if(!(result.value instanceof Uint8Array)||result.value.length>262144||(sub.total+=result.value.length)>16777216)return fail('CALL_EVENT_BOUND');
  sub.buffer=(sub.buffer+sub.decoder.decode(result.value,{stream:true})).replace(/\r\n/g,'\n');if(Buffer.byteLength(sub.buffer)>262144)return fail('CALL_EVENT_BOUND');
 }}catch(error){sub.failure=error;throw error;}finally{sub.pending=null;}});sub.pending=task;task.catch(()=>{void stopCallSubscription(sub).catch(error=>{call.failure=error;});});return task;
}
export function bargeInHostedCurrentAgentCall(handle:HostedCurrentAgentCall):Promise<unknown> {
 const call=currentCall(handle);if(call.state==='ending'||call.state==='ended')return call.end??Promise.resolve({state:call.state});if(call.barge)return call.barge;
 if(call.state!=='open')return fail('CALL_GENERATION_FENCED',409);call.state='fencing';call.generation++;call.controller.abort();disposeCallPlans(call);
 call.barge=(async()=>{await Promise.allSettled([...call.work]);if(call.failure)throw call.failure;if(call.state==='fencing'){call.controller=new AbortController();call.state='open';try{callCurrent(call);}catch(error){call.state='fencing';throw error;}}
  return Object.freeze({callId:call.callId,generation:call.generation,state:call.state,agentExecutionOwnedByCall:false,speechDispatchAvailable:false});
 })();call.barge.finally(()=>{call.barge=null;}).catch(()=>undefined);return call.barge;
}
export function endHostedCurrentAgentCall(handle:HostedCurrentAgentCall):Promise<unknown> {
 const call=currentCall(handle);if(call.end)return call.end;call.state='ending';call.generation++;call.controller.abort();disposeCallPlans(call);if(call.timer)clearTimeout(call.timer);call.timer=null;
 call.lifetime.abort();call.end=(async()=>{const joins=await Promise.allSettled([...call.work,...(call.barge?[call.barge]:[]),...(call.sub?[stopCallSubscription(call.sub)]:[])]);
  const subscriptionJoin=call.sub?joins.at(-1):undefined;if(call.failure)throw call.failure;if(subscriptionJoin?.status==='rejected')throw subscriptionJoin.reason;
  await call.resource.producer.releaseAttachmentLease(call.lease);call.state='ended';call.seen.clear();activeCurrentAgentCalls.delete(handle);
  return Object.freeze({callId:call.callId,state:'ended',ownedReadsJoined:true,subscriptionJoined:!!call.sub,agentExecutionOwnedByCall:false,speechDispatchAvailable:false});
 })();call.end.catch(error=>{call.failure=error;});return call.end;
}
