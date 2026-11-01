// Root-only DATA policy/protocol fixtures. No positive call/model/CPU/audio/
// retirement fixture; private call ownership requires actual canonical resources.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {deriveAttachedVerbatimPlan,ATTACHED_SPEECH_POLICY_ID,ATTACHED_SPEECH_POLICY_SHA256,ATTACHED_SPEECH_SEGMENTER_SHA256} from '../lib/voice-v2/attached-verbatim-policy.mjs';
import {assertAttachedPromptInboxAck as ack,parseSelectedCallEvent as event} from '../lib/voice-v2/attached-call-protocol.mjs';
const sha=text=>createHash('sha256').update(Buffer.from(text)).digest('hex');
const expected={sessionId:'ses_fixture',messageId:'msg_fixture',text:'actual fixture input',delivery:'queue'};
const response=()=>({data:{id:expected.messageId,sessionID:expected.sessionId,type:'user',delivery:'queue',time:{created:1},payload:{text:expected.text}}});
const frame=(data,extra={})=>'data: '+JSON.stringify({id:'evt_fixture',type:'session.text.ended',data,location:{directory:'/workspace'},...extra});
const textEvent=()=>({sessionID:'ses_fixture',assistantMessageID:'msg_reply',ordinal:1,text:'fixture assistant bytes'});
test('fixed verbatim policy preserves original text and separately hashes exact CR projection',async()=>{
 const raw='password=USER_AUTHORED_TEXT🙂\r\nEnd',value=await deriveAttachedVerbatimPlan(raw);
 assert.equal(value.policyId,'verbatim-assistant-text-v1');assert.equal(value.policyId,ATTACHED_SPEECH_POLICY_ID);
 assert.equal(value.rawTextSha256,sha(raw));assert.equal(value.projectedSha256,sha(raw.replaceAll('\r','\n')));
 assert.equal(value.segments.map(s=>s.text).join(''),raw.replaceAll('\r','\n'));
 assert.match(ATTACHED_SPEECH_POLICY_SHA256,/^[a-f0-9]{64}$/);assert.match(ATTACHED_SPEECH_SEGMENTER_SHA256,/^[a-f0-9]{64}$/);
 assert.equal(Object.isFrozen(value),true);assert.equal(Object.isFrozen(value.segments),true);
});
test('fixed speech segments retain separate projection offsets and exact hashes without truncation',async()=>{
 const text='🙂'.repeat(1000)+' e\u0301\n',value=await deriveAttachedVerbatimPlan(text);let at=0;
 for(const segment of value.segments){assert.equal(segment.sourceStart,at);assert.equal(segment.digest,sha(segment.text));assert.equal(Buffer.byteLength(segment.text),segment.sourceEnd-segment.sourceStart);assert.ok([...segment.text].length<=160);at=segment.sourceEnd;}
 assert.equal(at,Buffer.byteLength(text));assert.equal(value.segments.map(s=>s.text).join(''),text);
});
test('policy rejects invalid/beyond-limit source, never substitutes an injected redactor',async()=>{
 for(const text of ['', 'x'.repeat(32001),'\ud800','bad\u0000text'])await assert.rejects(()=>deriveAttachedVerbatimPlan(text));
 const value=await deriveAttachedVerbatimPlan('verbatim fixture',()=>{throw Error('caller callback forbidden');});assert.equal(value.rawTextSha256,sha('verbatim fixture'));
});
test('pinned prompt ACK is inbox admission only, preserving exact IDs/type/input/delivery',()=>{
 assert.equal(ack(response(),expected),undefined);const good=response();good.data.payload.files=[];good.data.payload.agents=[];good.data.payload.skills=[];good.data.payload.metadata={};ack(good,expected);
 for(const mutate of [r=>r.data.id='msg_other',r=>r.data.sessionID='ses_other',r=>r.data.type='assistant',r=>r.data.delivery='steer',r=>r.data.payload.text='changed',r=>r.data.payload.tools={},r=>r.data.payload.agents=['extra'],r=>r.data.time.created=-1,r=>r.data.completed=true]){const value=response();mutate(value);assert.throws(()=>ack(value,expected),/DELIVERY_UNKNOWN/);}
});
test('text-ended feed is a raw-read selector and never returns event text as speech input',()=>{
 const value=event(frame(textEvent()),'ses_fixture','/workspace');assert.equal(value.assistantMessageId,'msg_reply');assert.equal(value.agentSettlementProof,false);assert.equal(Object.hasOwn(value,'text'),false);assert.equal(Object.hasOwn(value,'plan'),false);
});
test('global feed unrelated sessions/locations/server heartbeats are ignored',()=>{
 assert.equal(event(': heartbeat','ses_fixture','/workspace'),null);
 assert.equal(event('data: '+JSON.stringify({id:'evt_connected',type:'server.connected',data:{}}),'ses_fixture','/workspace'),null);
 assert.equal(event(frame({...textEvent(),sessionID:'ses_other'}),'ses_fixture','/workspace'),null);
 assert.equal(event(frame(textEvent(),{location:{directory:'/other'}}),'ses_fixture','/workspace'),null);
});
test('pinned live feed refuses guessed wrappers/replay IDs/duplicates/malformed text-ended fields',()=>{
 for(const block of ['id: evt_not-a-pinned-frame\n'+frame(textEvent()),'data: "double encoded event"','data: {"type":"session.text.ended","type":"server.connected"}',frame({...textEvent(),ordinal:-1}),frame({...textEvent(),assistantMessageID:'invented'}),frame({...textEvent(),proof:true}),frame(textEvent(),{id:'synthetic-id'})])assert.throws(()=>event(block,'ses_fixture','/workspace'));
});
