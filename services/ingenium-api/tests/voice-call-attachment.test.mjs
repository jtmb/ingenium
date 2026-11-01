// MODEL-FREE SOURCE HARNESS. Fixture owners are not runtime qualification.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CurrentAgentCallAttachment } from '../lib/voice-v2/attachment.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const scope={actorId:'user',accountId:'user',organizationId:'org',projectId:'project',conversationId:'ses_original',runtimeId:'runtime',executionBindingId:'workspace',executionRevision:'original-revision',agentId:'working-agent'};
function fixture(){
 const events=[],counts={messages:0,controls:0,speech:0,cancel:0,opens:0},streams=[];
 let model='selected-model',blocked=false,deliveryFailure=false,readGate,bodyCancelGate,opening;
 const selection=()=>({scope,sessionId:scope.conversationId,agentId:scope.agentId,modelId:model,providerId:'selected-provider',variant:'selected-variant',configurationRevision:'config',directory:'/workspace'});
 const owner={
  async inspect(_context,_scope,action){if(blocked)throw new Error('revoked');if(action==='speech'&&readGate)await readGate.promise;return selection();},
  async openEvents(_context,_scope,{signal,cursor}){
   counts.opens++;if(opening){signal.addEventListener('abort',()=>opening.reject(new Error('original fetch aborted')),{once:true});await opening.promise;}
   let controller;const stream=new ReadableStream({start(c){controller=c;},cancel(){return bodyCancelGate?.promise;}});
   streams.push({stream,cursor,emit(event){controller.enqueue(new TextEncoder().encode(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`));}});return stream;
  },
  async deliverMessage(_context,_scope,message){counts.messages++;if(deliveryFailure)throw new Error('original ACK unknown');return {sessionId:scope.conversationId,nativeMessageId:message.nativeMessageId,state:'delivered'};},
  async cancelAgent(){counts.controls++;return {state:'pending'};},
 };
 const speech={async transcribe(){counts.speech++;return {text:'human words'};},async speak(){counts.speech++;},async cancelOwned(){counts.cancel++;}};
 const attachment=new CurrentAgentCallAttachment({owner,speech,context:{},scope,callId:'call-one',onEvent:event=>events.push(event)});
 return {attachment,events,counts,streams,setModel:v=>{model=v;},revoke:()=>{blocked=true;},failDelivery:()=>{deliveryFailure=true;},failCancel:()=>{speech.cancelOwned=async()=>{throw new Error('cleanup unknown');};},gateSpeech:()=>readGate=deferred(),gateBodyCancel:()=>bodyCancelGate=deferred(),gateOpening:()=>opening=deferred()};
}
const textEvent=(id,sessionID=scope.conversationId,directory='/workspace')=>({id,type:'session.text.ended',location:{directory},data:{sessionID,assistantMessageID:'assistant-original',text:'actual observed words'}});
test('attachment delivers in same session, filters other sessions/locations, end leaves agent running',async()=>{
 const f=fixture();await f.attachment.connect();f.streams[0].emit(textEvent('wrong','ses_other'));f.streams[0].emit(textEvent('wrong-location',scope.conversationId,'/other'));f.streams[0].emit(textEvent('actual'));await tick();
 assert.equal(f.events.length,1);assert.equal(f.events[0].data.text,'actual observed words');assert.equal(f.events[0].agentSettlementProof,false);
 const receipt=await f.attachment.deliver({requestId:'spoken-one',text:'continue original goal',delivery:'steer'});assert.equal(receipt.state,'delivered');assert.equal(receipt.executionCompleted,false);
 const end=await f.attachment.end();assert.equal(end.agentContinues,true);assert.equal(end.agentSettlementProof,false);assert.equal(f.counts.controls,0);
});
test('barge-in fences pending speech authorization before CPU dispatch, without cancelling agent',async()=>{
 const f=fixture();await f.attachment.connect();const gate=f.gateSpeech();
 const original=f.attachment.transcribeAndDeliver({pcm:new Uint8Array(8000),requestId:'stt-one'});original.catch(()=>{});await tick();
 const barge=f.attachment.bargeIn();await tick();assert.equal(f.counts.speech,0);gate.resolve();await assert.rejects(original,/CALL_SPEECH_FENCED/);
 const result=await barge;assert.equal(result.agentContinues,true);assert.equal(f.counts.messages,0);assert.equal(f.counts.controls,0);await f.attachment.end();
 const g=fixture();await g.attachment.connect();g.failCancel();await assert.rejects(g.attachment.bargeIn(),/cleanup unknown/);
 await assert.rejects(g.attachment.transcribeAndDeliver({pcm:new Uint8Array(8000),requestId:'fenced'}),/FENCED/);
 await assert.rejects(g.attachment.end(),/CLEANUP_UNKNOWN/);assert.equal(g.counts.speech,0);
});
test('end retains actual subscription body cancel join instead of a timer-to-closed path',async()=>{
 const f=fixture();await f.attachment.connect();const gate=f.gateBodyCancel(),ending=f.attachment.end();await tick();
 assert.equal(f.attachment.snapshot().state,'closing');gate.resolve();assert.equal((await ending).state,'closed');assert.equal(f.counts.controls,0);
});
test('end aborts and positively joins original pending stream acquisition',async()=>{
 const f=fixture();f.gateOpening();const connecting=f.attachment.connect();connecting.catch(()=>{});await tick();
 const ending=f.attachment.end();await assert.rejects(connecting,/aborted/);assert.equal((await ending).state,'closed');assert.equal(f.counts.controls,0);
});
test('delivery error stays unknown and repeated caller ID cannot resend',async()=>{
 const f=fixture();await f.attachment.connect();f.failDelivery();const input={requestId:'spent-one',text:'same words',delivery:'queue'};
 await assert.rejects(f.attachment.deliver(input),/ACK unknown/);await assert.rejects(f.attachment.deliver(input),/ACK unknown/);
 assert.equal(f.counts.messages,1);assert.equal(f.attachment.snapshot().deliveries[0].state,'unknown');await f.attachment.end();
});
test('reconnect joins old subscription, uses exact selected cursor, and never replays messages',async()=>{
 const f=fixture();await f.attachment.connect();await f.attachment.deliver({requestId:'once',text:'original message'});f.streams[0].emit(textEvent('cursor-one'));await tick();
 await f.attachment.reconnect();assert.equal(f.streams[1].cursor,'cursor-one');assert.equal(f.counts.messages,1);
 f.streams[1].emit(textEvent('cursor-one'));await tick();assert.equal(f.events.length,1);await f.attachment.end();
});
test('selected model changes refuse reconnect, auth revocation stops selected event delivery',async()=>{
 const f=fixture();await f.attachment.connect();f.revoke();f.streams[0].emit(textEvent('revoked'));await tick();assert.equal(f.events.length,0);await f.attachment.end();
 const g=fixture();await g.attachment.connect();g.setModel('replacement');await assert.rejects(g.attachment.reconnect(),/CALL_SELECTION_CHANGED/);assert.equal(g.counts.messages,0);await g.attachment.end();
});
test('speech requires actual observed selected text; explicit agent cancel remains pending',async()=>{
 const f=fixture();await f.attachment.connect();await assert.rejects(f.attachment.speakObserved('invented'),/SOURCE_REQUIRED/);
 f.streams[0].emit(textEvent('speak-one'));await tick();await f.attachment.speakObserved('speak-one');assert.equal(f.counts.speech,1);
 await assert.rejects(f.attachment.cancelAgent({requestId:'no-intent'}),/EXPLICIT/);
 const receipt=await f.attachment.cancelAgent({requestId:'cancel-one',intent:'explicit-user-cancel-agent'});assert.equal(receipt.state,'pending');assert.equal(receipt.agentSettlementProof,false);
 await f.attachment.end();assert.equal(f.counts.controls,1);
});
