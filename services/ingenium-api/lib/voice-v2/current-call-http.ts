import {Router,type Request,type Response} from 'express';
import {randomUUID} from 'node:crypto';
import {authentication,logger} from 'ingenium-core';
import {config} from '../../config/index.js';
import {revalidateRequestIdentity} from '../request-identity.js';
import {getHostedVoiceProductionProducer} from './production-system.js';
import {captureHostedVoiceRequest,hostedVoiceRequestScope,assertHostedVoiceAttachment,openHostedCurrentAgentCall,
 captureHostedCurrentCallRequest,dispatchHostedCurrentCallRequest,releaseHostedCurrentCallRequest,
 captureHostedCurrentCallCleanupRequest,endHostedCurrentCallForRequest,releaseHostedCurrentCallCleanupRequest,assertHostedCurrentAgentOriginAuthorized,
 resolveHostedCurrentCallSelection,transcribeHostedCurrentCall,deliverHostedCurrentCallMessage,planHostedCurrentAgentSpeech,inspectHostedCurrentAgentPlan,prepareHostedCurrentAgentTts,
 executeHostedCurrentAgentTts,endHostedCurrentAgentCall,openHostedCurrentAgentEvents,nextHostedCurrentAgentEvent,
 type HostedVoiceSelection,type HostedCurrentAgentCall,type HostedCurrentCallRequest,
 type HostedAssistantObservation,type HostedAttachedTts,type HostedAttachedTtsResult} from './request-context.js';
import {CURRENT_CALL_BODY_LIMIT,currentCallIdentifier,isCurrentCallHttpPath,
 parseCurrentCallEnvelope,boundedAttachedWav} from './current-call-http-protocol.mjs';
import {CurrentCallConsumer} from './current-call-consumer.mjs';

const fail=(code:string,status=503):never=>{throw Object.assign(Error(code),{code,status});};
const bodies=new WeakMap<object,Uint8Array>();
const pcmBodies=new WeakMap<object,Uint8Array>();
export function captureOriginalCurrentCallPcmBody(request:object,bytes:Uint8Array):void{if(pcmBodies.has(request)||bytes.length>480000)return fail('CALL_HTTP_PCM_BODY_INVALID',413);pcmBodies.set(request,bytes);}
export function releaseOriginalCurrentCallPcmBody(request:object):void{pcmBodies.get(request)?.fill(0);pcmBodies.delete(request);}
/** Root attaches this to its ORIGINAL defaultJsonParser verify callback. The
 * callback observes bytes, not req.body. This hook grants no identity or effect.
 * Without it every operation fails closed. Do not mount a second JSON parser.
 */
export function captureOriginalCurrentCallBody(request:{method?:string;url?:string;originalUrl?:string},bytes:Uint8Array):void {
 if(!isCurrentCallHttpPath(request.originalUrl??request.url))return;
 if(request.method!=='POST'||bytes.length>CURRENT_CALL_BODY_LIMIT)return fail('CALL_HTTP_BODY_LIMIT',413);
 if(bodies.has(request))return fail('CALL_HTTP_BODY_ALREADY_CAPTURED',409);
 bodies.set(request,Uint8Array.from(bytes));
}
function browser(request:Request){
 const identity=revalidateRequestIdentity(request),p=identity?.principal;
 // Deliberately cookie-only. Existing bearer/legacy handlers remain separate.
 if(request.headers.authorization!==undefined||p?.type!=='user'||!p.session||p.id!==p.session.user_id
  ||!request.headers.cookie?.split(';').some(s=>s.trim().startsWith(authentication.SESSION_COOKIE_NAME+'=')))return fail('CALL_HTTP_SESSION_REQUIRED',401);
 const origin=request.get('origin');
 if(!origin||!config.dashboardOrigins.includes(origin)||request.get('x-ingenium-ui')!=='dashboard'
  ||!authentication.verifySessionCsrf(p.session,request.get('x-csrf-token')??''))return fail('CSRF_REJECTED',403);
 return p;
}
type Producer=ReturnType<typeof getHostedVoiceProductionProducer>;
type Bootstrap=ReturnType<Producer['beginOriginalAttachmentScope']>;
type Prepared={token:HostedAttachedTts;attempted:boolean;failure?:unknown};
type Entry={id:string;actor:string;session:string;selection:HostedVoiceSelection;controller:AbortController;
 producer?:Producer;bootstrap?:Bootstrap;call?:HostedCurrentAgentCall;opening?:Promise<void>;close?:Promise<void>;
 failure?:unknown;timer?:ReturnType<typeof setTimeout>;authorityWatch?:ReturnType<typeof setInterval>;plans:Map<string,HostedAssistantObservation>;prepared:Map<string,Prepared>;requests:number;
 pump?:{work:Promise<void>;read?:Promise<Awaited<ReturnType<typeof nextHostedCurrentAgentEvent>>>;failure?:unknown};barge?:Promise<unknown>;consumers:Set<CurrentCallConsumer>;consumerTasks:Set<Promise<void>>};

/** Zero injected ports. Constructing this router starts no producer or resource.
 * Root mounts once at CURRENT_CALL_PREFIX AFTER real auth/CSRF/authorization.
 */
export function createCurrentAgentCallRouter():Router {
 const router=Router(),entries=new Map<string,Entry>(),closedEntries=new Map<string,{actor:string;session:string;receipt:Readonly<Record<string,unknown>>}>();
 function own(request:Request,id:string):Entry {
  const p=browser(request);if(!currentCallIdentifier(id))return fail('CALL_HTTP_NOT_FOUND',404);
  const entry=entries.get(id);if(!entry||entry.actor!==p.id||entry.session!==p.session!.id)return fail('CALL_HTTP_NOT_FOUND',404);
  return entry;
 }
 function close(entry:Entry):Promise<void> {
  if(entry.close)return entry.close;
  // Publish the exact original BEFORE abort listeners or owner effects can run.
  // A rejected local delivery is SETTLED, not proof that a physical owner failed.
  entry.close=Promise.resolve().then(async()=>{
   entry.controller.abort();const opening=entry.opening?await Promise.allSettled([entry.opening]):[];if(entry.authorityWatch)clearInterval(entry.authorityWatch);entry.authorityWatch=undefined;
   const owners=[...(entry.call?[Promise.resolve().then(()=>endHostedCurrentAgentCall(entry.call!))]:[]),
    ...(entry.bootstrap&&entry.producer?[Promise.resolve().then(()=>entry.producer!.releaseOriginalAttachmentScope(entry.bootstrap!))]:[])];
   const local=[...(entry.pump?[entry.pump.work]:[]),...entry.consumerTasks];
   const [joined,delivery]=await Promise.all([Promise.allSettled(owners),Promise.allSettled(local)]);
   const rejected=joined.find((value):value is PromiseRejectedResult=>value.status==='rejected');
   if(rejected){entry.failure=rejected.reason;throw rejected.reason;}
   for(const value of opening)if(value.status==='rejected'){const code=value.reason&&typeof value.reason==='object'&&'code'in value.reason?String(value.reason.code):'';if(code.includes('CLEANUP_UNKNOWN')||code.includes('JOIN_UNCONFIRMED')){entry.failure=value.reason;throw value.reason;}}
   for(const value of delivery)if(value.status==='rejected'){
    const raw=value.reason&&typeof value.reason==='object'&&'code'in value.reason?value.reason.code:null;
    const code=typeof raw==='string'&&/^[A-Z0-9_]{1,100}$/.test(raw)?raw:'CALL_LOCAL_DELIVERY_FAILED';
    if(code.includes('CLEANUP_UNKNOWN')||code.includes('JOIN_UNCONFIRMED')){entry.failure=value.reason;throw value.reason;}
    logger.warn('voice','Call delivery failed before positive original cleanup',{attachmentId:entry.id,code});
   }
   if(entry.timer)clearTimeout(entry.timer);entry.plans.clear();entry.prepared.clear();
   // Metadata only, after all actual originals joined. No resource handles or
   // permission/capacity proof can be minted from this bounded receipt cache.
   if(closedEntries.size>=256){const oldest=closedEntries.keys().next().value;if(oldest!==undefined)closedEntries.delete(oldest);}
   closedEntries.set(entry.id,{actor:entry.actor,session:entry.session,receipt:Object.freeze({attachmentId:entry.id,state:'ended',ownedReadsJoined:true,agentExecutionOwnedByCall:false})});entries.delete(entry.id);
  });entry.close.catch(error=>{entry.failure=error;});return entry.close;
 }
 async function fresh(request:Request,entry:Entry):Promise<HostedCurrentCallRequest> {
  own(request,entry.id);if(entry.failure||entry.close||!entry.call)return fail('CALL_HTTP_ORIGINAL_UNAVAILABLE');
  return captureHostedCurrentCallRequest(request,entry.call);
 }
 async function begin(request:Request,response:Response,selection:HostedVoiceSelection,signal:AbortSignal,requestId?:string){
  const p=browser(request);
  if(entries.size>=16||[...entries.values()].filter(e=>e.actor===p.id).length>=4)return fail('CALL_HTTP_CAPACITY',429);
  const id=requestId??randomUUID();if(!currentCallIdentifier(id)||entries.has(id)||closedEntries.has(id))return fail('CALL_HTTP_REQUEST_ALREADY_RECORDED',409);
  const entry:Entry={id,actor:p.id,session:p.session!.id,selection:Object.freeze({...selection}),controller:new AbortController(),plans:new Map(),prepared:new Map(),requests:0,consumers:new Set(),consumerTasks:new Set()};
  entries.set(entry.id,entry);
  const combined=AbortSignal.any([signal,entry.controller.signal]);
  let grant:HostedCurrentCallRequest|undefined,startupContext:Parameters<typeof hostedVoiceRequestScope>[0]|undefined;
  // Covers both slow startup and the live call. No device or network effect in
  // this NEGATIVE watch; only fresh original identity/context checks.
  entry.authorityWatch=setInterval(()=>{if(entry.close)return;try{if(entry.call)assertHostedCurrentAgentOriginAuthorized(entry.call);else if(startupContext)assertHostedVoiceAttachment(startupContext,hostedVoiceRequestScope(startupContext),'read');else browser(request);}catch{void close(entry).catch(()=>undefined);}},5000);entry.authorityWatch.unref();
  try{
   // Publish startup custody BEFORE its first read/CPU effect. close() aborts
   // and joins this original; this closure NEVER awaits close() itself.
   entry.opening=Promise.resolve().then(async()=>{try{
   combined.throwIfAborted();const context=await captureHostedVoiceRequest(request,entry.selection);startupContext=context;combined.throwIfAborted();browser(request);
   entry.producer=getHostedVoiceProductionProducer();
   entry.bootstrap=entry.producer.beginOriginalAttachmentScope({context,scope:hostedVoiceRequestScope(context),deadlineAt:Date.now()+1800000,signal:combined});
   await entry.producer.waitOriginalAttachmentScope(entry.bootstrap,combined);
   const current=await captureHostedVoiceRequest(request,entry.selection);combined.throwIfAborted();browser(request);
   const bound=entry.producer.bindOriginalAttachmentScope(entry.bootstrap,current);
   entry.call=await openHostedCurrentAgentCall(bound,combined);
   combined.throwIfAborted();browser(request);
   await entry.producer.releaseOriginalAttachmentScope(entry.bootstrap);
   }catch(error){
    if(!entry.call&&error&&typeof error==='object'&&'code'in error&&error.code==='CALL_OPEN_CLEANUP_UNKNOWN'&&'originalCall'in error)entry.call=error.originalCall as HostedCurrentAgentCall;
    throw error;
   }});entry.opening.catch(()=>undefined);
   await entry.opening;
   grant=await fresh(request,entry);
   const status=await dispatchHostedCurrentCallRequest(grant,'status');combined.throwIfAborted();browser(request);
   const deadline=(status as Record<string,unknown>).deadlineAt;
   if(typeof deadline!=='number'||!Number.isSafeInteger(deadline)||deadline<=Date.now())return fail('CALL_HTTP_DEADLINE_UNAVAILABLE');
   entry.timer=setTimeout(()=>{void close(entry).catch(()=>undefined);},Math.max(1,deadline-Date.now()));entry.timer.unref();
   response.status(201).json({attachmentId:entry.id,call:status});
  }catch(error){
   if(!entry.call&&error&&typeof error==='object'&&'code'in error&&error.code==='CALL_OPEN_CLEANUP_UNKNOWN'&&'originalCall'in error)entry.call=error.originalCall as HostedCurrentAgentCall;
   try{await close(entry);}catch(cleanup){entry.failure=cleanup;return fail('CALL_HTTP_CLEANUP_UNKNOWN',409);}throw error;
  }finally{if(grant)releaseHostedCurrentCallRequest(grant);}
 }
 function startPump(entry:Entry):void {
  if(entry.pump){if(entry.pump.failure)throw entry.pump.failure;return;}
  const pump:NonNullable<Entry['pump']>={work:Promise.resolve()};
  pump.work=Promise.resolve().then(async()=>{
   await openHostedCurrentAgentEvents(entry.call!);
   while(!entry.controller.signal.aborted){
    if(entry.barge)await entry.barge;
    if(entry.controller.signal.aborted)return;
    const read=Promise.resolve().then(()=>nextHostedCurrentAgentEvent(entry.call!));pump.read=read;
    const event=await read;if(pump.read===read)pump.read=undefined;
    if(entry.controller.signal.aborted)return;
    if(event===null)return fail('CALL_HTTP_EVENT_PUMP_ENDED');
    const frame='event: selected\ndata: '+JSON.stringify(event)+'\n\n';
    if(Buffer.byteLength(frame)>16384)return fail('CALL_HTTP_EVENT_BOUND');
    for(const consumer of entry.consumers)consumer.offer(frame);
   }
  }).catch(error=>{if(!entry.controller.signal.aborted){pump.failure=error;throw error;}}).finally(()=>{for(const consumer of entry.consumers)consumer.detach();});
  entry.pump=pump;pump.work.catch(()=>{void close(entry).catch(()=>undefined);}); // privately clean up failed original feed; no self-await cycle
 }
 async function drain(response:Response,signal:AbortSignal):Promise<void> {
  signal.throwIfAborted();
  await new Promise<void>((resolve,reject)=>{
   const clear=()=>{response.removeListener('drain',ready);response.removeListener('close',closed);signal.removeEventListener('abort',closed);};
   const ready=()=>{clear();resolve();},closed=()=>{clear();reject(Object.assign(Error('CALL_HTTP_CONSUMER_CLOSED'),{code:'CALL_HTTP_CONSUMER_CLOSED'}));};
   response.once('drain',ready);response.once('close',closed);signal.addEventListener('abort',closed,{once:true});
   if(signal.aborted||response.destroyed)closed();
  });
 }
 function stream(request:Request,response:Response,entry:Entry,signal:AbortSignal):Promise<void> {
  if(entry.close||entry.controller.signal.aborted)return fail('CALL_HTTP_CLOSING',409);
  if(entry.consumers.size>=4)return Promise.reject(Object.assign(Error('CALL_HTTP_CONSUMER_CAPACITY'),{code:'CALL_HTTP_CONSUMER_CAPACITY',status:429}));
  startPump(entry);
  const consumer=new CurrentCallConsumer(),combined=AbortSignal.any([signal,entry.controller.signal]);
  const detached=()=>consumer.detach();combined.addEventListener('abort',detached,{once:true});if(combined.aborted)detached();
  entry.consumers.add(consumer);
  async function write(frame:string,deliverySignal:AbortSignal=combined){
   const grant=await fresh(request,entry);
   try{await dispatchHostedCurrentCallRequest(grant,'status');browser(request);combined.throwIfAborted();
    if(!response.headersSent)response.set({'Content-Type':'text/event-stream','X-Accel-Buffering':'no'});
    deliverySignal.throwIfAborted();
    if(!response.write(frame)){await drain(response,deliverySignal);await dispatchHostedCurrentCallRequest(grant,'status');browser(request);combined.throwIfAborted();}
   }finally{releaseHostedCurrentCallRequest(grant);}
  }
  const work=Promise.resolve().then(async()=>{
   try{
    await write('event: gap\ndata: {"futureOnly":true,"resyncRequired":true}\n\n');
    for(;;){if(entry.pump?.failure)throw entry.pump.failure;const frame=await consumer.next(combined);if(frame===null)break;await write(frame,AbortSignal.any([combined,consumer.signal]));}
    if(entry.pump?.failure)throw entry.pump.failure;
   }catch(error){
    if(!combined.aborted&&!response.destroyed){
     // If auth still permits delivery, state the gap, never an invented replay.
     const grant=await fresh(request,entry);
     try{await dispatchHostedCurrentCallRequest(grant,'status');browser(request);combined.throwIfAborted();
      if(!response.headersSent)response.set('Content-Type','text/event-stream');
      // One bounded terminal frame; never wait indefinitely for an overflowing
      // consumer to drain, and never label its disconnect call retirement.
      response.end('event: gap\ndata: {"futureOnly":true,"resyncRequired":true,"closed":true}\n\n');
     }finally{releaseHostedCurrentCallRequest(grant);}
    }
    if(!combined.aborted)throw error;
   }finally{
    consumer.detach();await consumer.join().catch(()=>undefined);entry.consumers.delete(consumer);combined.removeEventListener('abort',detached);
    if(!response.destroyed&&!response.writableEnded)response.end();
   }
  });
  entry.consumerTasks.add(work);work.catch(error=>{const status=error?.status??error?.statusCode;if(status===401||status===403)void close(entry).catch(()=>undefined);}).finally(()=>entry.consumerTasks.delete(work));return work;
 }
 async function operation(request:Request,response:Response,entry:Entry,action:string,body:Readonly<Record<string,string>>,signal:AbortSignal,pcm?:Uint8Array){
  let grant:HostedCurrentCallRequest|undefined;
  if(entry.requests>=4&&!['barge','end','events'].includes(action))return fail('CALL_HTTP_CAPACITY',429);
  if(action!=='events')entry.requests++;
  try{
   if(action==='end'){
    let cleanup:ReturnType<typeof captureHostedCurrentCallCleanupRequest>|undefined,result:unknown;
    try{if(!entry.call){await close(entry);result={attachmentId:entry.id,state:'ended',openingOriginalJoined:true,agentExecutionOwnedByCall:false};}else{cleanup=captureHostedCurrentCallCleanupRequest(request,entry.call);result=await endHostedCurrentCallForRequest(cleanup);}}
    finally{if(cleanup)releaseHostedCurrentCallCleanupRequest(cleanup);await close(entry);}
    browser(request);signal.throwIfAborted();response.json(result);return;
   }
   grant=await fresh(request,entry);signal.throwIfAborted();
   if(action==='inspect'){const result=await dispatchHostedCurrentCallRequest(grant,'status');browser(request);signal.throwIfAborted();response.json(result);return;}
   if(action==='events'){
    await dispatchHostedCurrentCallRequest(grant,'status');
    releaseHostedCurrentCallRequest(grant);grant=undefined;
    await stream(request,response,entry,signal);return;
   }
   if(action==='transcribe'){if(!pcm)return fail('CALL_HTTP_ORIGINAL_PCM_UNAVAILABLE');const result=await transcribeHostedCurrentCall(grant,body.requestId!,pcm,signal);browser(request);signal.throwIfAborted();response.json(result);return;}
   if(action==='message'){const receipt=await deliverHostedCurrentCallMessage(grant,body as unknown as {requestId:string;text:string;delivery:'queue'|'steer'},signal);browser(request);signal.throwIfAborted();response.json({receipt});return;}
   if(action==='plan'){
    if(entry.plans.size>=64)return fail('CALL_HTTP_PLAN_CAPACITY',429);
    await dispatchHostedCurrentCallRequest(grant,'status');
    const plans=await planHostedCurrentAgentSpeech(entry.call!,body.messageId!,signal);
    await dispatchHostedCurrentCallRequest(grant,'status');browser(request);signal.throwIfAborted();
    if(entry.plans.size+plans.length>64)return fail('CALL_HTTP_PLAN_CAPACITY',429);
    const result=plans.map(plan=>{const metadata=inspectHostedCurrentAgentPlan(entry.call!,plan),planId=randomUUID();entry.plans.set(planId,plan);return {planId,metadata};});
    response.json({plans:result});return;
   }
   if(action==='prepare'){
    if(entry.prepared.size>=256)return fail('CALL_HTTP_PREPARED_CAPACITY',429);
    const plan=entry.plans.get(body.planId!);if(!plan)return fail('CALL_HTTP_PLAN_NOT_FOUND',404);
    const token=prepareHostedCurrentAgentTts(entry.call!,plan,grant),preparedId=randomUUID();
    entry.prepared.set(preparedId,{token,attempted:false});
    // No await after prepare before original custody is recorded.
    browser(request);signal.throwIfAborted();response.json({preparedId});return;
   }
   if(action==='execute'){
    const held=entry.prepared.get(body.preparedId!);if(!held)return fail('CALL_HTTP_PREPARED_NOT_FOUND',404);
    if(held.attempted)return fail('CALL_HTTP_PREPARED_SPENT',409);held.attempted=true;
    try{
     const result:HostedAttachedTtsResult=await executeHostedCurrentAgentTts(grant,held.token,signal);
     await dispatchHostedCurrentCallRequest(grant,'status');browser(request);signal.throwIfAborted();
     const bytes=boundedAttachedWav(result);response.set('Content-Type','audio/wav');response.send(Buffer.from(bytes));
    }catch(error){held.failure=error;throw error;}return;
   }
   if(action==='barge'){
    const held=grant;
    const original=entry.barge??Promise.resolve().then(()=>dispatchHostedCurrentCallRequest(held,'barge-in'));
    entry.barge=original;
    let result:unknown;try{result=await original;}finally{if(entry.barge===original)entry.barge=undefined;}
    browser(request);
    entry.plans.clear();entry.prepared.clear();signal.throwIfAborted();response.json(result);return;
   }
   if(action==='end')return fail('CALL_HTTP_INVALID_END_PATH',409);
   return fail('CALL_HTTP_NOT_FOUND',404);
  }finally{if(grant)releaseHostedCurrentCallRequest(grant);if(action!=='events')entry.requests--;}
 }
 router.use((request,response,next)=>{
  if(request.method!=='POST'){response.set('Allow','POST');response.status(405).end();return;}
  next();
 });
 router.post(['/begin','/selection','/:attachmentId/:action','/:attachmentId/transcribe/:requestId'],(request,response)=>{
  const controller=new AbortController(),abort=()=>controller.abort();
  request.once('aborted',abort);response.once('close',abort);if(request.aborted||response.destroyed)controller.abort();
  const work=Promise.resolve().then(async()=>{
   response.set({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
   browser(request);
   const action=request.path==='/begin'?'begin':request.path==='/selection'?'selection':request.params.requestId?'transcribe':request.params.action;
   if(request.get('content-type')?.split(';')[0]?.trim()!==(action==='transcribe'?'application/octet-stream':'application/json')||!['identity',undefined].includes(request.get('content-encoding')))return fail('CALL_HTTP_CONTENT_TYPE',415);
   if(typeof action!=='string'||!['begin','inspect','events','plan','prepare','execute','barge','end','message','transcribe','selection'].includes(action))return fail('CALL_HTTP_NOT_FOUND',404);
   if(action==='transcribe'){const id=request.params.attachmentId,requestId=request.params.requestId,pcm=pcmBodies.get(request);if(typeof id!=='string'||typeof requestId!=='string'||!currentCallIdentifier(requestId))return fail('CALL_HTTP_NOT_FOUND',404);if(!pcm||pcm.length<8000||pcm.length%2)return fail('CALL_HTTP_PCM_BODY_INVALID',422);await operation(request,response,own(request,id),action,{requestId},controller.signal,pcm);return;}
   const raw=bodies.get(request);if(!raw)return fail('CALL_HTTP_ORIGINAL_BODY_UNAVAILABLE');
   bodies.delete(request);let body:Readonly<Record<string,string>>;
   try{body=parseCurrentCallEnvelope(raw,action);}finally{raw.fill(0);}
   controller.signal.throwIfAborted();
   if(action==='selection'){const selection=await resolveHostedCurrentCallSelection(request,body as unknown as {workspaceId:string;runtimeId:string;engineSessionId:string});browser(request);controller.signal.throwIfAborted();response.json({selection});return;}
   if(action==='begin'){const {requestId,...selection}=body;await begin(request,response,selection as unknown as HostedVoiceSelection,controller.signal,requestId);}
   else{const id=request.params.attachmentId;if(typeof id!=='string')return fail('CALL_HTTP_NOT_FOUND',404);if(action==='end'&&closedEntries.has(id)){const p=browser(request),closed=closedEntries.get(id)!;if(closed.actor!==p.id||closed.session!==p.session!.id)return fail('CALL_HTTP_NOT_FOUND',404);response.json(closed.receipt);return;}await operation(request,response,own(request,id),action,body,controller.signal);}
  });
  work.catch(error=>{
   if(response.destroyed||response.writableEnded)return;
   if(response.headersSent){response.destroy();return;}
   const e=error as {code?:unknown;status?:unknown;statusCode?:unknown},code=typeof e?.code==='string'&&/^[A-Z0-9_]{1,100}$/.test(e.code)?e.code:'CALL_HTTP_UNCONFIRMED';
   const proposed=e?.status??e?.statusCode,status=typeof proposed==='number'&&Number.isInteger(proposed)&&proposed>=400&&proposed<=599?proposed:503;
   response.status(status).json({error:{code,message:'The call operation could not be confirmed.'}});
  }).finally(()=>{const raw=bodies.get(request);raw?.fill(0);bodies.delete(request);releaseOriginalCurrentCallPcmBody(request);request.removeListener('aborted',abort);response.removeListener('close',abort);});
 });
 return router;
}
