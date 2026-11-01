// Pure envelope/consumer and extracted browser NEGATIVE controls only.
// No actual call, auth grant, Core operation, CPU, server, network or device.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseCurrentCallEnvelope,currentCallIdentifier,isCurrentCallHttpPath,boundedAttachedWav,CURRENT_CALL_BODY_LIMIT} from '../lib/voice-v2/current-call-http-protocol.mjs';
import {CurrentCallConsumer} from '../lib/voice-v2/current-call-consumer.mjs';
const bytes=text=>new TextEncoder().encode(text),encode=value=>bytes(JSON.stringify(value));
const uuid='11111111-1111-4111-8111-111111111111';
const selection={projectId:'project',workspaceId:'workspace',runtimeId:'runtime',contextConversationId:'chat',agentId:'agent'};
test('bounded selectors parsed from raw bytes, not scope/authority DTOs',()=>{
 assert.deepEqual({...parseCurrentCallEnvelope(encode(selection),'begin')},selection);
 assert.equal(parseCurrentCallEnvelope(encode({planId:uuid}),'prepare').planId,uuid);
 for(const action of ['inspect','events','barge','end'])assert.deepEqual({...parseCurrentCallEnvelope(bytes('{}'),action)},{});
 assert.equal(currentCallIdentifier(uuid),true);assert.equal(currentCallIdentifier('../other'),false);
});
for(const [name,raw,action] of [
 ['duplicate key','{"messageId":"one","messageId":"two"}','plan'],
 ['scope proof DTO','{"scope":{"actorId":"other"}}','inspect'],
 ['profile path',JSON.stringify({...selection,profilePath:'/private/profile'}),'begin'],
 ['approval path',JSON.stringify({...selection,resourceApprovalPath:'/private/approval'}),'begin'],
 ['callback label','{"preparedId":"'+uuid+'","authorized":true}','execute'],
 ['empty selector','{"messageId":""}','plan'],
 ['control character','{"messageId":"a\\nb"}','plan'],
 ['trimmed selector','{"messageId":" secret "}','plan'],
 ['missing key','{}','plan'],['array','[]','inspect'],['null','null','inspect'],
 ['wrong alias','{"planId":"someones-original-handle"}','prepare'],
])test('reject '+name,()=>assert.throws(()=>parseCurrentCallEnvelope(bytes(raw),action)));
test('actual byte bound, malformed UTF8 and unknown operations reject',()=>{
 assert.throws(()=>parseCurrentCallEnvelope(new Uint8Array(CURRENT_CALL_BODY_LIMIT+1),'inspect'));
 assert.throws(()=>parseCurrentCallEnvelope(Uint8Array.of(123,255,125),'inspect'));
 assert.throws(()=>parseCurrentCallEnvelope(bytes('{}'),'submit-agent'));
 assert.equal(isCurrentCallHttpPath('/api/v1/voice/current-calls/x/events?x=1'),true);
 assert.equal(isCurrentCallHttpPath('/api/v1/voice/current-calls-legacy'),false);
});
test('result consistency validation is not made from arbitrary JSON flags',()=>{
 for(const result of [null,{}, {retired:true,resultAvailable:true,status:200,bytes:[]},
  {retired:true,resultAvailable:true,status:200,bytes:new Uint8Array(44)}])assert.throws(()=>boundedAttachedWav(result));
});

test('future-only consumer receives no earlier consumer queue replay',async()=>{
 const old=new CurrentCallConsumer(),fresh=new CurrentCallConsumer(),signal=new AbortController().signal;
 old.offer('old');old.offer('future');fresh.offer('future');
 assert.equal(await old.next(signal),'old');assert.equal(await fresh.next(signal),'future');
 old.detach();fresh.detach();await Promise.all([old.join(),fresh.join()]);
});
test('detach cancels and joins exact waiter only',async()=>{
 const one=new CurrentCallConsumer(),two=new CurrentCallConsumer(),controller=new AbortController();
 const pending=one.next(controller.signal),other=two.next(new AbortController().signal);
 controller.abort();assert.equal(await pending,null);await one.join();
 two.offer('still-live');assert.equal(await other,'still-live');two.detach();
});
test('one pending read per consumer; duplicate does not steal original',async()=>{
 const c=new CurrentCallConsumer(),signal=new AbortController().signal,original=c.next(signal);
 await assert.rejects(c.next(signal),/CONFLICT/);c.offer('exact');assert.equal(await original,'exact');c.detach();
});
test('queue overflow detaches with explicit gap, other consumers survive',async()=>{
 const one=new CurrentCallConsumer(),two=new CurrentCallConsumer(),signal=new AbortController().signal;
 for(let i=0;i<33;i++)one.offer('event');
 assert.equal(one.signal.aborted,true);await assert.rejects(one.next(signal),/EVENT_GAP/);
 two.offer('live');assert.equal(await two.next(signal),'live');two.detach();
});
test('UTF8 byte bound and single-frame bound fail closed',async()=>{
 const one=new CurrentCallConsumer(),two=new CurrentCallConsumer(),signal=new AbortController().signal;
 for(let i=0;i<5;i++)one.offer('x'.repeat(14000));two.offer('x'.repeat(16385));
 await assert.rejects(one.next(signal),/EVENT_GAP/);await assert.rejects(two.next(signal),/EVENT_GAP/);
});
test('pre-aborted consumer never returns queued data; join is same pending original',async()=>{
 const c=new CurrentCallConsumer(),controller=new AbortController();c.offer('secret');controller.abort();
 const original=c.next(controller.signal);assert.equal(c.join(),original);assert.equal(await original,null);
});

const source=readFileSync(new URL('../lib/voice-v2/current-call-http.ts',import.meta.url),'utf8');
const start=source.indexOf('function browser(request:Request){'),end=source.indexOf('\ntype Producer=',start);
assert.ok(start>=0&&end>start);
// Only one explicit TS annotation is erased; all injected fixtures below are
// negative. No fake session/producer is allowed to PASS this original boundary.
const body=source.slice(start,end).replace('request:Request','request');
const rejected=code=>{throw Object.assign(Error(code),{code});};
function deny(identity,headers={},csrf=false){
 const browser=new Function('revalidateRequestIdentity','authentication','config','fail',body+';return browser;')(
  ()=>identity,{SESSION_COOKIE_NAME:'actual-cookie-name-fixture',verifySessionCsrf:()=>csrf},
  {dashboardOrigins:['https://dashboard.example']},rejected);
 return ()=>browser({headers,get:name=>headers[name]});
}
const user={principal:{type:'user',id:'u',session:{id:'session',user_id:'u'}}};
for(const [name,identity,headers,csrf] of [
 ['missing admitted identity',null,{},false],
 ['service bearer',{principal:{type:'service',id:'u'}},{authorization:'Bearer ing_fixture'},false],
 ['sessionless scoped user',{principal:{type:'user',id:'u',tokenId:'token'}},{},false],
 ['session owner mismatch',{principal:{type:'user',id:'u',session:{id:'s',user_id:'other'}}},{},false],
 ['cookie absent',user,{},false],
 ['authorization with cookie',user,{cookie:'actual-cookie-name-fixture=x',authorization:'Bearer anything'},true],
 ['origin absent',user,{cookie:'actual-cookie-name-fixture=x','x-ingenium-ui':'dashboard'},true],
 ['untrusted origin',user,{cookie:'actual-cookie-name-fixture=x',origin:'https://attacker.example','x-ingenium-ui':'dashboard'},true],
 ['missing dashboard marker',user,{cookie:'actual-cookie-name-fixture=x',origin:'https://dashboard.example'},true],
 ['invalid original CSRF',user,{cookie:'actual-cookie-name-fixture=x',origin:'https://dashboard.example','x-ingenium-ui':'dashboard','x-csrf-token':'wrong'},false],
])test('browser negative: '+name,()=>assert.throws(deny(identity,headers,csrf)));
