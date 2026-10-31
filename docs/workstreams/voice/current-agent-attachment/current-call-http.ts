import {Router,type Request,type Response} from 'express';
import {randomUUID} from 'node:crypto';
import {authentication} from 'ingenium-core';
import {config} from '../../config/index.js';
import {revalidateRequestIdentity} from '../request-identity.js';
import {getHostedVoiceProductionProducer} from './production-system.js';
import {captureHostedVoiceRequest,hostedVoiceRequestScope,openHostedCurrentAgentCall,
 captureHostedCurrentCallRequest,dispatchHostedCurrentCallRequest,releaseHostedCurrentCallRequest,
 planHostedCurrentAgentSpeech,inspectHostedCurrentAgentPlan,prepareHostedCurrentAgentTts,
 executeHostedCurrentAgentTts,endHostedCurrentAgentCall,openHostedCurrentAgentEvents,nextHostedCurrentAgentEvent,
 type HostedVoiceSelection,type HostedCurrentAgentCall,type HostedCurrentCallRequest,
 type HostedAssistantObservation,type HostedAttachedTts,type HostedAttachedTtsResult} from './request-context.js';
import {CURRENT_CALL_BODY_LIMIT,currentCallIdentifier,isCurrentCallHttpPath,
 parseCurrentCallEnvelope,boundedAttachedWav} from './current-call-http-protocol.mjs';
import {CurrentCallConsumer} from './current-call-consumer.mjs';

const fail=(code:string,status=503):never=>{throw Object.assign(Error(code),{code,status});};
const bodies=new WeakMap<object,Uint8Array>();
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
 producer?:Producer;bootstrap?:Bootstrap;call?:HostedCurrentAgentCall;close?:Promise<void>;
 failure?:unknown;timer?:ReturnType<typeof setTimeout>;plans:Map<string,HostedAssistantObservation>;prepared:Map<string,Prepared>;requests:number;
 pump?:{work:Promise<void>;read?:Promise<Awaited<ReturnType<typeof nextHostedCurrentAgentEvent>>>;failure?:unknown};barge?:Promise<unknown>;consumers:Set<CurrentCallConsumer>;consumerTasks:Set<Promise<void>>};

/** Zero injected ports. Constructing this router starts no producer or resource.
 * Root mounts once at CURRENT_CALL_PREFIX AFTER real auth/CSRF/authorization.
 */
export function createCurrentAgentCallRouter():Router {
 const router=Router(),entries=new Map<string,Entry>();
 function own(request:Request,id:string):Entry {
  const p=browser(request);if(!currentCallIdentifier(id))return fail('CALL_HTTP_NOT_FOUND',404);
  const entry=entries.get(id);if(!entry||entry.actor!==p.id||entry.session!==p.session!.id)return fail('CALL_HTTP_NOT_FOUND',404);
  return entry;
 }
 function close(entry:Entry):Promise<void> {
  if(entry.close)return entry.close;
  entry.controller.abort();
  // Retain the original cleanup before either actual effect is invoked.
  entry.close=Promise.resolve().then(async()=>{
   const settled=await Promise.allSettled([
    ...(entry.call?[Promise.resolve().then(()=>endHostedCurrentAgentCall(entry.call!))]:[]),
    ...(entry.bootstrap&&entry.producer?[Promise.resolve().then(()=>entry.producer!.releaseOriginalAttachmentScope(entry.bootstrap!))]:[]),
    ...(entry.pump?[entry.pump.work]:[]),...entry.consumerTasks,
   ]);
   const rejected=settled.find((v):v is PromiseRejectedResult=>v.status==='rejected');
   if(rejected){entry.failure=rejected.reason;throw rejected.reason;}
   if(entry.timer)clearTimeout(entry.timer);entry.plans.clear();entry.prepared.clear();entries.delete(entry.id);
  });entry.close.catch(error=>{entry.failure=error;});return entry.close;
 }
 async function fresh(request:Request,entry:Entry):Promise<HostedCurrentCallRequest> {
  own(request,entry.id);if(entry.failure||entry.close||!entry.call)return fail('CALL_HTTP_ORIGINAL_UNAVAILABLE');
  return captureHostedCurrentCallRequest(request,entry.call);
 }
 async function begin(request:Request,response:Response,selection:HostedVoiceSelection,signal:AbortSignal){
  const p=browser(request);
  if(entries.size>=16||[...entries.values()].filter(e=>e.actor===p.id).length>=4)return fail('CALL_HTTP_CAPACITY',429);
  const entry:Entry={id:randomUUID(),actor:p.id,session:p.session!.id,selection:Object.freeze({...selection}),controller:new AbortController(),plans:new Map(),prepared:new Map(),requests:0,consumers:new Set(),consumerTasks:new Set()};
  entries.set(entry.id,entry);
  const combined=AbortSignal.any([signal,entry.controller.signal]);
  let grant:HostedCurrentCallRequest|undefined;
  try{
   const context=await captureHostedVoiceRequest(request,entry.selection);combined.throwIfAborted();browser(request);
   entry.producer=getHostedVoiceProductionProducer();
   entry.bootstrap=entry.producer.beginOriginalAttachmentScope({context,scope:hostedVoiceRequestScope(context),deadlineAt:Date.now()+1800000,signal:combined});
   await entry.producer.waitOriginalAttachmentScope(entry.bootstrap,combined);
   const current=await captureHostedVoiceRequest(request,entry.selection);combined.throwIfAborted();browser(request);
   const bound=entry.producer.bindOriginalAttachmentScope(entry.bootstrap,current);
   entry.call=await openHostedCurrentAgentCall(bound,combined);
   await entry.producer.releaseOriginalAttachmentScope(entry.bootstrap);
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
  entry.pump=pump;pump.work.catch(()=>undefined); // retained before first open/read effect
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
  entry.consumerTasks.add(work);work.catch(()=>undefined).finally(()=>entry.consumerTasks.delete(work));return work;
 }
 async function operation(request:Request,response:Response,entry:Entry,action:string,body:Readonly<Record<string,string>>,signal:AbortSignal){
  let grant:HostedCurrentCallRequest|undefined;
  if(entry.requests>=4&&!['barge','end','events'].includes(action))return fail('CALL_HTTP_CAPACITY',429);
  if(action!=='events')entry.requests++;
  try{
   grant=await fresh(request,entry);signal.throwIfAborted();
   if(action==='inspect'){const result=await dispatchHostedCurrentCallRequest(grant,'status');browser(request);signal.throwIfAborted();response.json(result);return;}
   if(action==='events'){
    await dispatchHostedCurrentCallRequest(grant,'status');
    releaseHostedCurrentCallRequest(grant);grant=undefined;
    await stream(request,response,entry,signal);return;
   }
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
   if(action==='end'){
    const result=await dispatchHostedCurrentCallRequest(grant,'end');
    await close(entry);browser(request);signal.throwIfAborted();response.json(result);return;
   }
   return fail('CALL_HTTP_NOT_FOUND',404);
  }finally{if(grant)releaseHostedCurrentCallRequest(grant);if(action!=='events')entry.requests--;}
 }
 router.use((request,response,next)=>{
  if(request.method!=='POST'){response.set('Allow','POST');response.status(405).end();return;}
  next();
 });
 router.post(['/begin','/:attachmentId/:action'],(request,response)=>{
  const controller=new AbortController(),abort=()=>controller.abort();
  request.once('aborted',abort);response.once('close',abort);
  const work=Promise.resolve().then(async()=>{
   response.set({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
   browser(request);
   if(request.get('content-type')?.split(';')[0]?.trim()!=='application/json'||!['identity',undefined].includes(request.get('content-encoding')))return fail('CALL_HTTP_CONTENT_TYPE',415);
   const action=request.path==='/begin'?'begin':request.params.action;
   if(typeof action!=='string'||!['begin','inspect','events','plan','prepare','execute','barge','end'].includes(action))return fail('CALL_HTTP_NOT_FOUND',404);
   const raw=bodies.get(request);if(!raw)return fail('CALL_HTTP_ORIGINAL_BODY_UNAVAILABLE');
   bodies.delete(request);let body:Readonly<Record<string,string>>;
   try{body=parseCurrentCallEnvelope(raw,action);}finally{raw.fill(0);}
   controller.signal.throwIfAborted();
   if(action==='begin')await begin(request,response,body as unknown as HostedVoiceSelection,controller.signal);
   else{const id=request.params.attachmentId;if(typeof id!=='string')return fail('CALL_HTTP_NOT_FOUND',404);await operation(request,response,own(request,id),action,body,controller.signal);}
  });
  work.catch(error=>{
   if(response.destroyed||response.writableEnded)return;
   if(response.headersSent){response.destroy();return;}
   const e=error as {code?:unknown;status?:unknown;statusCode?:unknown},code=typeof e?.code==='string'&&/^[A-Z0-9_]{1,100}$/.test(e.code)?e.code:'CALL_HTTP_UNCONFIRMED';
   const proposed=e?.status??e?.statusCode,status=typeof proposed==='number'&&Number.isInteger(proposed)&&proposed>=400&&proposed<=599?proposed:503;
   response.status(status).json({error:{code,message:'The call operation could not be confirmed.'}});
  }).finally(()=>{const raw=bodies.get(request);raw?.fill(0);bodies.delete(request);request.removeListener('aborted',abort);response.removeListener('close',abort);});
 });
 return router;
}
