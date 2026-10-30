// Model-free source harness, not auth/database/engine runtime acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHostedAttachmentOwner } from './hosted-owner.mjs';
const scope={actorId:'u',accountId:'u',organizationId:'o',projectId:'p',conversationId:'ses_original',runtimeId:'r',executionBindingId:'w',executionRevision:'e',agentId:'a'};
function fixture(){
 const rows=new Map(),calls=[],context={};let model='chosen-model',badAck=false;
 const ledger={reserve(_ctx,input){const old=rows.get(input.requestId);if(old)return {fresh:false,receipt:{state:old.state}};
  const handle={input,state:'intent'};rows.set(input.requestId,handle);return {fresh:true,handle};},
  claim(handle){assert.equal(handle.state,'intent');handle.claimed=true;},
  acknowledge(handle,ack){assert.equal(handle.claimed,true);handle.state=ack.state;return {state:ack.state};},unknown(handle){handle.state='unknown';},};
 const owner=createHostedAttachmentOwner({ledger,withSelected:async(ctx,_scope,action,fn)=>{assert.equal(ctx,context);calls.push({action});return fn({scope,sessionId:scope.conversationId,directory:'/workspace',agentId:'a',modelId:model,providerId:'chosen-provider',variant:'original-variant',configurationRevision:'configuration'});},
  assertCurrent(ctx,_scope,action){assert.equal(ctx,context);calls.push({assert:action});},
  async request(path,options){calls.push({path,options});return {data:{id:options.body.id,sessionID:badAck?'ses_other':scope.conversationId,delivery:options.body.delivery}};},
  async streamEvents(session,directory,cursor,signal){calls.push({session,directory,cursor,signal});return 'original-stream-fixture';},});
 return {owner,context,calls,rows,setModel:x=>{model=x;},badAck:()=>{badAck=true;}};
}
const message={requestId:'r-one',nativeMessageId:'msg_original',text:'continue the existing work',delivery:'queue'};
test('same canonical prompt/inbox with fixed original ID; no model/agent/tool switch',async()=>{
 const f=fixture(),receipt=await f.owner.deliverMessage(f.context,scope,message);assert.equal(receipt.state,'delivered');
 const sent=f.calls.find(c=>c.path);assert.equal(sent.path,'/api/session/ses_original/prompt');assert.deepEqual(sent.options,{method:'POST',body:{id:'msg_original',text:message.text,delivery:'queue'}});
 assert.equal(f.rows.get(message.requestId).state,'delivered');assert.ok(!Object.hasOwn(receipt,'retirementProof'));
});
test('wrong original ACK is unknown and duplicate cannot resend after reconnect/reconstruction',async()=>{
 const f=fixture();f.badAck();await assert.rejects(f.owner.deliverMessage(f.context,scope,message),/UNKNOWN/);
 assert.equal(f.rows.get(message.requestId).state,'unknown');assert.equal((await f.owner.deliverMessage(f.context,scope,message)).state,'unknown');assert.equal(f.calls.filter(c=>c.path).length,1);
});
test('ordinary attachment subscription works without agent-cancellation producer',async()=>{
 const f=fixture(),signal=new AbortController().signal;const stream=await f.owner.openEvents(f.context,scope,{cursor:'event-one',signal});assert.equal(stream,'original-stream-fixture');
 await assert.rejects(f.owner.cancelAgent(f.context,scope,{requestId:'cancel-one',intent:'explicit-user-cancel-agent'}),/CANCEL_OWNER_UNKNOWN/);
 assert.equal(f.rows.size,0);assert.equal(f.calls.filter(c=>c.path).length,0);
});
test('selected model change fences before original reservation or message effect',async()=>{
 const f=fixture();await f.owner.inspect(f.context,scope,'read');f.setModel('other-model');await assert.rejects(f.owner.deliverMessage(f.context,scope,message),/SELECTION_CHANGED/);
 assert.equal(f.rows.size,0);assert.equal(f.calls.filter(c=>c.path).length,0);
});
