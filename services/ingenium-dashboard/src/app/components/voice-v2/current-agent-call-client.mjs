import {BrowserAudio} from './browser-audio.mjs';
import {UtteranceSegmenter} from '../../../../../../packages/veyra-voice/audio.mjs';
const fail=code=>{throw Object.assign(Error(code),{code});};
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(v);
const unknownJoin=e=>typeof e?.code==='string'&&/CLEANUP_UNKNOWN|JOIN_UNKNOWN|JOIN_UNCONFIRMED/.test(e.code);
/** Volatile presentation/device owner over the REAL current-call HTTP protocol.
 * It creates no agent execution, transcript store, Core grant or backend proof.
 * Default media starts only after an explicit user start. Server owns admission. */
export class CurrentAgentCallClient {
 constructor({transport,selection,mode,onDictation,onAdmitted,onResync,onEnded,media=new BrowserAudio()}){
  if(!['dictation','agent-call','conversation'].includes(mode)||!transport||!selection||typeof onDictation!=='function'||typeof onAdmitted!=='function')fail('CALL_BROWSER_CONFIG');
  this.transport=transport;this.selection=Object.freeze({...selection});this.media=media;this.mode=mode;this.onDictation=onDictation;this.onAdmitted=onAdmitted;this.onResync=onResync;this.onEnded=onEnded;
  this.inputDeviceId='';this.outputDeviceId='';this.listeners=new Set();this.tasks=new Set();this.pendingMessages=new Set();this.lifetime=new AbortController();this.started=false;this.userMuted=false;this.suspended=false;this.beginOpened=false;this.opening=null;this.ending=null;this.busy=null;this.interrupting=null;this.messagePending=null;this.feedTask=null;this.captureTask=null;this.retainedCapture=null;this.uncertainMessage=null;this.generation=0;this.selectedBackend='';this.attentionText='';
  this.snapshot=Object.freeze({phase:'disconnected',muted:true,transcript:'',reply:'',tools:[],approval:null,error:null,generation:0});
  this.session={mode,subscribe:listener=>{this.listeners.add(listener);return()=>this.listeners.delete(listener)},getSnapshot:()=>this.snapshot,sendText:(text,delivery)=>this.sendText(text,delivery),interrupt:()=>this.interrupt(),decideApproval:async()=>fail('CALL_USE_WORK_PERMISSIONS')};
  this.segmenter=new UtteranceSegmenter(pcm=>{void this.receive(pcm).catch(()=>{});},{onOverflow:pcm=>{if(!this.retainedCapture)this.retainedCapture=pcm;this.report(Object.assign(Error('capture retained'),{code:'CALL_CAPTURE_RECOVERY_REQUIRED'}));}});
 }
 set(patch){this.snapshot=Object.freeze({...this.snapshot,...patch,generation:this.generation});for(const listener of this.listeners){try{listener()}catch{}}}
 rememberPartial(){if(!this.retainedCapture&&this.segmenter.voicedMs>0&&this.segmenter.bytes)this.retainedCapture=this.segmenter.retainedPcm();this.segmenter.reset();}
 report(error){
  const code=error?.code;this.turnController?.abort();this.media.stopPlayback();this.rememberPartial();this.media.stopCapture();
  this.attentionText=code==='CALL_BROWSER_DELIVERY_UNKNOWN'||this.uncertainMessage?'Message delivery is uncertain. Review this conversation in Work; it will not be resent.':this.retainedCapture?'Your unsubmitted recording is retained. Export or discard it before unmuting.':code==='CALL_BROWSER_FEED_DISCONNECTED'?'The voice feed disconnected. Reconnect for future activity.':'The voice action could not be confirmed. Your agent keeps its existing conversation and permissions.';
  this.set({muted:true,error:this.attentionText});
 }
 track(effect){const task=Promise.resolve().then(effect);this.tasks.add(task);task.then(()=>this.tasks.delete(task),()=>this.tasks.delete(task));return task;}
 start(){
  if(this.opening)return this.opening;if(this.started||this.ending)fail('CALL_BROWSER_START_ALREADY_RECORDED');this.started=true;this.startRequestId=crypto.randomUUID();this.set({phase:'connecting',muted:true,error:null});
  this.opening=Promise.resolve().then(async()=>{
   this.lifetime.signal.throwIfAborted();const result=await this.transport.selection(this.selection,this.lifetime.signal);this.lifetime.signal.throwIfAborted();
   if(!result?.selection||Object.keys(result.selection).sort().join()!=='agentId,contextConversationId,projectId,runtimeId,workspaceId'||Object.values(result.selection).some(v=>typeof v!=='string'||!v))fail('CALL_BROWSER_SELECTION_INVALID');
   // This alias is known BEFORE the potentially slow begin request. It grants
   // no authority; actual server actor/session/context checks remain mandatory.
   this.attachmentId=this.startRequestId;this.beginSent=true;
   const opened=await this.transport.begin({...result.selection,requestId:this.startRequestId},this.lifetime.signal);
   if(opened?.attachmentId!==this.attachmentId||opened.call?.agentExecutionOwnedByCall!==false)fail('CALL_BROWSER_OPEN_INVALID');this.lifetime.signal.throwIfAborted();
   this.beginOpened=true;this.selectedBackend=typeof opened.call.backend==='string'?opened.call.backend:'';this.set({phase:'ready',muted:this.userMuted||this.suspended,error:null});
   if(this.mode!=='dictation'&&!this.suspended)this.startFeed();await this.capture();
  });this.opening.catch(error=>{if(!this.ending){this.set({phase:this.attachmentId?'ready':'disconnected'});this.report(error)}});return this.opening;
 }
 async capture(){
  if(this.ending||this.lifetime.signal.aborted||this.snapshot.muted||this.suspended)return;if(this.retainedCapture)fail('CALL_CAPTURE_RECOVERY_REQUIRED');if(this.captureTask)return this.captureTask;
  const task=Promise.resolve().then(async()=>{this.lifetime.signal.throwIfAborted();if(this.ending||this.snapshot.muted||this.suspended||this.busy||this.interrupting)return;return this.media.startCapture({deviceId:this.inputDeviceId,onPcm:pcm=>{if(this.ending||this.snapshot.muted||this.suspended||this.busy||this.interrupting)return;try{this.segmenter.push(pcm);if(this.segmenter.voicedMs===0)this.pumpSpeech();}catch(error){this.report(error)}},onError:code=>this.report(Object.assign(Error(code),{code}))});});
  this.captureTask=task;try{const result=await task;if(result===false&&!this.ending)fail('CALL_BROWSER_CAPTURE_STOPPED');}finally{if(this.captureTask===task)this.captureTask=null;}
 }
 startFeed(){
  if(this.feedTask||this.ending||!this.attachmentId)return;this.feedController=new AbortController();const signal=AbortSignal.any([this.lifetime.signal,this.feedController.signal]);
  const original=this.transport.events(this.attachmentId,signal,event=>{
   if(this.ending)return;
   if(event.type==='gap'){this.onResync?.();return;}
   if(this.suspended)return;const id=event.data.assistantMessageId;if(typeof id==='string'&&/^msg_[A-Za-z0-9._:-]{1,124}$/.test(id)){if(this.pendingMessages.size>=16&&!this.pendingMessages.has(id)){this.report(Object.assign(Error('queue full'),{code:'CALL_BROWSER_EVENT_CAPACITY'}));return;}this.pendingMessages.add(id);this.pumpSpeech();}
  });this.feedTask=original;this.tasks.add(original);
  original.then(()=>{if(!signal.aborted&&!this.ending)this.report(Object.assign(Error('feed ended'),{code:'CALL_BROWSER_FEED_DISCONNECTED'}));},error=>{if(unknownJoin(error)){this.feedFailure=error;this.report(error)}else if(!signal.aborted&&!this.ending)this.report(Object.assign(Error('feed ended'),{code:'CALL_BROWSER_FEED_DISCONNECTED'}));}).then(()=>{this.tasks.delete(original);if(this.feedTask===original)this.feedTask=null;});
 }
 run(effect){
  if(this.ending||this.busy||this.interrupting||this.uncertainMessage||this.retainedCapture)fail('CALL_BROWSER_ACTION_PENDING');const controller=new AbortController(),signal=AbortSignal.any([controller.signal,this.lifetime.signal]);this.turnController=controller;
  const original=this.track(async()=>{signal.throwIfAborted();return effect(signal)});this.busy=original;
  original.then(()=>{},error=>{if(!this.ending)this.report(error)}).then(()=>{if(this.busy===original)this.busy=null;if(this.turnController===controller)this.turnController=null;if(!this.ending&&!this.interrupting&&!this.snapshot.error){this.set({phase:'ready'});this.pumpSpeech();if(!this.busy&&!this.snapshot.muted)void this.capture().catch(e=>this.report(e));}});return original;
 }
 receive(pcm){
  if(this.ending||this.snapshot.muted||this.busy){if(!this.retainedCapture)this.retainedCapture=Uint8Array.from(pcm);this.report(Object.assign(Error('capture retained'),{code:'CALL_CAPTURE_RECOVERY_REQUIRED'}));return Promise.resolve();}
  const owned=Uint8Array.from(pcm),requestId=crypto.randomUUID();return this.run(async signal=>{
   try{this.set({phase:'transcribing'});await this.media.stopCapture();const result=await this.transport.transcribe(this.attachmentId,requestId,owned,signal);signal.throwIfAborted();if(this.ending)return;
    this.set({transcript:result.text});if(!result.text)return;
    if(this.mode==='dictation'){await this.onDictation(result.text);this.finishDictation=true;}
    else await this.admit(result.text,'queue',signal);
   }catch(error){if(!this.retainedCapture)this.retainedCapture=Uint8Array.from(owned);throw error;}finally{owned.fill(0);if(this.finishDictation&&!this.ending)queueMicrotask(()=>{void this.end().catch(e=>this.report(e));});}
  });
 }
 async admit(text,delivery,signal){
  if(this.uncertainMessage||this.messagePending)fail('CALL_BROWSER_ACTION_PENDING');const input={requestId:crypto.randomUUID(),text,delivery};this.uncertainMessage=input;
  const original=this.track(()=>this.transport.operation(this.attachmentId,'message',input,signal));this.messagePending=original;
  try{const result=await original;if(result?.receipt?.state!=='delivered'||result.receipt.executionCompleted!==false||result.receipt.agentSettlementProof!==false)fail('CALL_BROWSER_DELIVERY_UNKNOWN');this.uncertainMessage=null;this.set({transcript:text});await this.onAdmitted();}
  finally{if(this.messagePending===original)this.messagePending=null;}
 }
 async sendText(text,delivery='prompt'){
  if(this.ending||!this.attachmentId||typeof text!=='string'||!text.trim()||[...text].length>2000||!['prompt','queue','steer'].includes(delivery))fail('CALL_BROWSER_MESSAGE_INVALID');
  if(this.uncertainMessage)fail('CALL_BROWSER_DELIVERY_UNKNOWN');
  if(this.mode==='dictation'){await this.onDictation(text);this.set({transcript:text});return;}
  try{await this.admit(text,delivery==='prompt'?'queue':delivery,this.lifetime.signal);}catch(error){this.report(error);throw error;}
 }
 pumpSpeech(){
  if(this.mode==='dictation'||this.suspended||this.ending||this.busy||this.interrupting||this.snapshot.error||this.retainedCapture||this.uncertainMessage||!this.attachmentId||this.segmenter.voicedMs>0||!this.pendingMessages.size)return;
  const messageId=this.pendingMessages.values().next().value;this.pendingMessages.delete(messageId);
  void this.run(async signal=>{
   this.set({phase:'thinking'});await this.media.stopCapture();this.segmenter.reset();const result=await this.transport.operation(this.attachmentId,'plan',{messageId},signal);
   if(!Array.isArray(result.plans)||result.plans.length>64)fail('CALL_BROWSER_PLAN_INVALID');
   for(const plan of result.plans){const count=plan?.metadata?.segments?.length;if(!uuid(plan.planId)||!Number.isSafeInteger(count)||count<1||count>256)fail('CALL_BROWSER_PLAN_INVALID');
    for(let index=0;index<count;index++){signal.throwIfAborted();this.set({phase:'synthesizing'});const prepared=await this.transport.operation(this.attachmentId,'prepare',{planId:plan.planId},signal);if(!uuid(prepared.preparedId))fail('CALL_BROWSER_PLAN_INVALID');const wav=await this.transport.execute(this.attachmentId,prepared.preparedId,signal);signal.throwIfAborted();this.set({phase:'speaking'});try{await this.media.play({wav,signal,outputDeviceId:this.outputDeviceId})}finally{wav.fill(0)}}
   }
  }).catch(()=>{});
 }
 async mute(muted){
  if(this.ending)return;if(!muted&&this.suspended)fail('CALL_BROWSER_PRESENTATION_PAUSED');if(!muted&&(this.interrupting||this.feedFailure))fail('CALL_BROWSER_RECONNECT_UNAVAILABLE');if(!muted&&(this.retainedCapture||this.uncertainMessage))fail(this.uncertainMessage?'CALL_BROWSER_DELIVERY_UNKNOWN':'CALL_CAPTURE_RECOVERY_REQUIRED');
  this.userMuted=Boolean(muted);this.set({muted});if(muted){this.rememberPartial();await this.media.stopCapture();}else{this.attentionText='';this.set({error:null});if(!this.busy)await this.capture();}
 }
 async setPresentationActive(active){this.suspended=!active;if(!active){this.pendingMessages.clear();this.turnController?.abort();this.media.stopPlayback();await this.mute(true);if(this.beginOpened&&!this.ending)await this.interrupt();}else if(this.beginOpened&&!this.ending&&!this.feedTask&&this.mode!=='dictation')this.startFeed();}
 async selectDevices(input,output){const muted=this.snapshot.muted;await this.mute(true);this.inputDeviceId=input;this.outputDeviceId=output;if(!muted&&!this.retainedCapture)await this.mute(false);}
 interrupt(){
  if(this.interrupting)return this.interrupting;if(this.ending||!this.attachmentId)fail('CALL_BROWSER_ORIGINAL_UNAVAILABLE');const muted=this.snapshot.muted;
  this.interrupting=Promise.resolve().then(async()=>{this.generation++;this.turnController?.abort();this.media.stopPlayback();this.rememberPartial();const capture=this.media.stopCapture(),barge=this.transport.operation(this.attachmentId,'barge',{},this.lifetime.signal),local=this.busy;barge.catch(()=>undefined);
   const joins=await Promise.allSettled([capture,...(local?[local]:[])]),result=await barge;
   for(let index=0;index<joins.length;index++){const j=joins[index];if(j.status==='rejected'&&(index===0||unknownJoin(j.reason)))throw j.reason;}
   if(result.agentExecutionOwnedByCall!==false)fail('CALL_BROWSER_BARGE_UNCONFIRMED');this.pendingMessages.clear();if(this.uncertainMessage||this.retainedCapture){this.report(Object.assign(Error('original retained'),{code:this.uncertainMessage?'CALL_BROWSER_DELIVERY_UNKNOWN':'CALL_CAPTURE_RECOVERY_REQUIRED'}));this.set({phase:'ready'});}else{this.attentionText='';this.set({phase:'ready',muted,error:null});}
  });const original=this.interrupting;original.then(()=>{if(this.interrupting===original)this.interrupting=null;if(!this.snapshot.muted)void this.capture().catch(e=>this.report(e));},error=>{this.report(error)});return original;
 }
 async reconnect(){
  if(this.ending||!this.attachmentId||this.uncertainMessage||this.feedFailure||this.interrupting)fail(this.uncertainMessage?'CALL_BROWSER_DELIVERY_UNKNOWN':'CALL_BROWSER_RECONNECT_UNAVAILABLE');
  this.feedController?.abort();if(this.feedTask){try{await this.feedTask}catch(e){if(unknownJoin(e))throw e;}}
  await this.transport.operation(this.attachmentId,'inspect',{},this.lifetime.signal);this.attentionText='';this.set({error:null,phase:'ready',muted:this.retainedCapture?true:this.snapshot.muted});if(this.mode!=='dictation')this.startFeed();if(!this.snapshot.muted)await this.capture();
 }
 hasRetainedCapture(){return Boolean(this.retainedCapture)&&!this.busy;}
 getRetainedCapture(){return this.hasRetainedCapture()?Uint8Array.from(this.retainedCapture):null;}
 discardRetainedCapture(){if(this.busy)fail('CALL_BROWSER_ACTION_PENDING');this.retainedCapture?.fill(0);this.retainedCapture=null;this.attentionText='';this.set({error:null});}
 end(){
  if(this.ending)return this.ending;
  this.ending=Promise.resolve().then(async()=>{
   this.set({phase:'ending',muted:true});this.lifetime.abort();this.turnController?.abort();this.feedController?.abort();this.media.stopPlayback();this.rememberPartial();const capture=this.media.stopCapture();
   // Ask the actual server to end immediately, even while browser permission
   // or cold-start response is pending. Then join every original locally.
   const server=this.beginSent?this.transport.operation(this.attachmentId,'end',{},new AbortController().signal):null;server?.catch(()=>undefined);let openingError;
   if(this.opening){try{await this.opening}catch(error){if(unknownJoin(error))openingError=error;}}
   const joins=await Promise.allSettled([capture,...this.tasks,...(this.captureTask?[this.captureTask]:[])]);
   let ended,serverError;try{ended=server?await server:null;}catch(error){serverError=error;}
   for(let index=0;index<joins.length;index++){const j=joins[index];if(j.status==='rejected'&&(index===0||unknownJoin(j.reason)))throw j.reason;}
   if(openingError&&serverError)throw Object.assign(new AggregateError([openingError,serverError],'CALL_BROWSER_END_UNCONFIRMED'),{code:'CALL_BROWSER_END_UNCONFIRMED'});if(openingError)throw openingError;if(serverError)throw serverError;
   if(server&&(ended?.state!=='ended'||ended.agentExecutionOwnedByCall!==false))fail('CALL_BROWSER_END_UNCONFIRMED');
   await this.media.dispose();this.pendingMessages.clear();this.set({phase:'ended',muted:true});this.onEnded?.();
  });this.ending.catch(error=>this.report(error));return this.ending;
 }
}