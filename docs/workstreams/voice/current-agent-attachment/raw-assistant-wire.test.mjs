// FINITE DATA FIXTURES ONLY: no original engine, authenticated call, fetch stub,
// observation capability, execution/settlement authority or runtime qualification.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {RAW_ASSISTANT_LIMITS as limits,parseUniqueRawJson as parse,consumeBoundedRawJson as consume,validateRawSessionPayload as session,validateRawAssistantPayload as assistant,rawAssistantRange as range} from './raw-assistant-wire.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const bytes=value=>Buffer.from(typeof value==='string'?value:JSON.stringify(value));
const url='http://fixture.invalid:4098/api/session/ses_fixture/message/msg_fixture';
const selected={sessionId:'ses_fixture',directory:'/workspace',agentId:'agent'};
const model={id:'model',providerID:'provider'};
const rawSession=()=>({data:{id:selected.sessionId,agent:selected.agentId,model:{...model},location:{directory:'/workspace'},time:{created:1,updated:2}}});
const rawAssistant=()=>({data:{id:'msg_fixture',type:'assistant',agent:'agent',model:{...model},time:{created:1},content:[{type:'reasoning',text:'never speak this'},{type:'text',text:'A🙂e\u0301\r\nB'},{type:'tool',id:'real-tool-id',name:'tool',state:{status:'running'}}]}});
function wire(chunks,options={}){
 let cancelled=0,pulls=0;
 const response={url,redirected:false,status:200,headers:new Headers({'content-type':'application/json',...options.headers}),
  body:new ReadableStream({pull(controller){pulls++;if(chunks.length)controller.enqueue(chunks.shift());else controller.close();},cancel(){cancelled++;if(options.cancelFails)throw Error('fixture cancellation failure');}}),...options.response};
 return {response,cancelled:()=>cancelled,pulls:()=>pulls};
}
test('fixture wire retains exact split identity bytes/hash and body EOF; completion absent is valid observation DATA',async()=>{
 const raw=bytes(rawAssistant()),f=wire([raw.subarray(0,13),raw.subarray(13)]);
 const read=await consume(f.response,url,limits.messageBytes);assert.deepEqual(read.raw,raw);assert.equal(read.sha256,sha(raw));assert.equal(read.http.bodyEnded,true);
 const value=assistant(read.json,session(parse(bytes(rawSession())),selected),'msg_fixture');
 assert.equal(value.agentSettlementProof,false);assert.equal(value.parts.length,1);assert.equal(value.parts[0].contentIndex,1);assert.equal(value.parts[0].nativePartId,null);
 assert.equal(value.parts[0].text,'A🙂e\u0301\r\nB');assert.equal(value.parts[0].textSha256,sha(bytes(value.parts[0].text)));assert.equal(f.cancelled(),0);
});
test('fixture parser rejects duplicate keys at every depth, malformed UTF8/BOM/JSON, non-scalar escapes',()=>{
 for(const raw of ['{"data":{},"data":{}}','{"data":{"type":"user","type":"assistant"}}','{"a":[{"x":1,"x":2}]}','{"a":1,}','[1,]','{"a":01}','{"a":1e999}','true false','{"a":"\\ud800"}','{"a":"bad\nstring"}'])assert.throws(()=>parse(bytes(raw)),/RAW_JSON_/);
 assert.throws(()=>parse(Uint8Array.of(0xc3,0x28)),/UTF8/);assert.throws(()=>parse(Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),bytes('{}')])),/BOM/);
 assert.equal(parse(bytes('{"__proto__":{"x":1}}')).__proto__.x,1);assert.equal(Object.prototype.x,undefined);
});
test('fixture parser bounds bytes/depth/tokens and never truncates',()=>{
 assert.throws(()=>parse(Buffer.alloc(limits.messageBytes+1,0x20)),/BOUND/);
 assert.throws(()=>parse(bytes('['.repeat(34)+'0'+']'.repeat(34))),/COMPLEXITY/);
 assert.throws(()=>parse(bytes('['+Array(limits.tokens+1).fill('0').join(',')+']')),/COMPLEXITY/);
});
test('fixture response status/path/redirect/content-type/encoding failures cancel exact original body',async()=>{
 for(const options of [
  {response:{status:206}},{response:{status:301}},{response:{status:429}},{response:{status:500}},
  {response:{url:url+'?different=1'}},{response:{redirected:true}},
  {headers:{'content-type':'text/html'}},{headers:{'content-type':'application/json; charset=latin1'}},
  {headers:{'content-type':'application/json; charset=utf-8; charset=utf-8'}},{headers:{'content-encoding':'gzip'}},
 ]){const f=wire([bytes('{}')],options);await assert.rejects(()=>consume(f.response,url,limits.messageBytes),/RAW_WIRE_/);assert.equal(f.cancelled(),1);}
});
test('fixture declared/actual length mismatch, invalid lengths, empty and excessive bodies refuse',async()=>{
 for(const length of ['-1','1.5','+2','02','0',String(limits.messageBytes+1),'3']){
  const f=wire([bytes('{}')],{headers:{'content-length':length}});await assert.rejects(()=>consume(f.response,url,limits.messageBytes),/RAW_WIRE_/);
 }
 for(const chunks of [[],[new Uint8Array(0)],[Buffer.alloc(limits.messageBytes+1)],[Buffer.alloc(limits.messageBytes),Uint8Array.of(32)]]){
  const f=wire(chunks);await assert.rejects(()=>consume(f.response,url,limits.messageBytes),/RAW_WIRE_/);
 }
 const f=wire([bytes('{}')],{headers:{'content-length':'2','content-type':'application/json; charset=UTF-8'}});assert.equal((await consume(f.response,url,limits.messageBytes)).http.bytes,2);
});
test('fixture body read error and cancellation failure cannot produce data success',async()=>{
 let cancel=0;const body=new ReadableStream({pull(controller){controller.error(Error('fixture read fault'));},cancel(){cancel++;}});
 await assert.rejects(()=>consume({url,status:200,redirected:false,headers:new Headers({'content-type':'application/json'}),body},url,limits.messageBytes),/fixture read fault|CLEANUP_UNKNOWN/);
 const f=wire([bytes('{}')],{response:{status:503},cancelFails:true});await assert.rejects(()=>consume(f.response,url,limits.messageBytes),/CLEANUP_UNKNOWN/);assert.equal(f.cancelled(),1);void cancel;
});
test('fixture abort while original reader is pending cancels/joins it and releases reader lock',async()=>{
 const controller=new AbortController();let cancel=0,started;
 const ready=new Promise(resolve=>{started=resolve;});
 const body=new ReadableStream({pull(){started();},cancel(){cancel++;}});
 const read=consume({url,status:200,redirected:false,headers:new Headers({'content-type':'application/json'}),body},url,limits.messageBytes,controller.signal);
 await ready;controller.abort();await assert.rejects(read);assert.equal(cancel,1);assert.equal(body.locked,false);
});
test('fixture aborted-before-read has no data success; cleanup still joins original body',async()=>{
 const controller=new AbortController();controller.abort();const f=wire([bytes('{}')]);await assert.rejects(()=>consume(f.response,url,limits.messageBytes,controller.signal));assert.equal(f.cancelled(),1);
});
test('fixture exact session selection refuses wrong identity/directory/agent/model, revert/archive and envelope drift',()=>{
 for(const mutate of [r=>r.data.id='ses_other',r=>r.data.agent='other',r=>r.data.location.directory='/other',r=>delete r.data.model,r=>r.data.location.workspaceID='private-unexpected',r=>r.data.revert={},r=>r.data.time.archived=3,r=>r.location={}]){
  const raw=rawSession();mutate(raw);assert.throws(()=>session(parse(bytes(raw)),selected),/RAW_SESSION_/);
 }
 assert.deepEqual(session(parse(bytes(rawSession())),selected).model,model);
});
test('fixture raw assistant refuses user/system/reasoning/tool-only, wrong id/agent/model/variant and fabricated native text ids',()=>{
 for(const mutate of [r=>r.data.type='user',r=>r.data.type='system',r=>r.data.id='msg_other',r=>r.data.agent='other',r=>r.data.model.id='other',r=>r.data.model.variant='changed',r=>r.data.error={},r=>r.data.retry={},r=>r.data.sessionID='ses_other',r=>r.data.content[1].id='synthetic-id',r=>r.data.content[1].text=123,r=>r.data.content[1].type='file',r=>r.data.content.splice(1,1)]){
  const raw=rawAssistant();mutate(raw);assert.throws(()=>assistant(parse(bytes(raw)),session(parse(bytes(rawSession())),selected),'msg_fixture'),/RAW_ASSISTANT_/);
 }
});
test('fixture part/text bounds apply to full message and preserve content indices without synthetic markers',()=>{
 const s=session(parse(bytes(rawSession())),selected);
 for(const content of [Array(limits.parts+1).fill({type:'text',text:'a'}),[{type:'text',text:'a'.repeat(limits.textScalars+1)}],Array(2).fill({type:'text',text:'b'.repeat(17000)})]){
  const raw=rawAssistant();raw.data.content=content;assert.throws(()=>assistant(parse(bytes(raw)),s,'msg_fixture'),/RAW_ASSISTANT_/);
 }
 const raw=rawAssistant();raw.data.finish='tool-calls';raw.data.time.streamed=2;const value=assistant(parse(bytes(raw)),s,'msg_fixture');assert.equal(value.parts.length,1);assert.equal(value.parts[0].contentIndex,1);assert.equal(value.agentSettlementProof,false);
});
test('fixture UTF8 ranges preserve exact bytes, CRLF and combining characters; split scalar/hash drift refuses',()=>{
 const part=assistant(parse(bytes(rawAssistant())),session(parse(bytes(rawSession())),selected),'msg_fixture').parts[0];
 const emoji=range(part,1,5);assert.equal(emoji.text,'🙂');assert.equal(emoji.rangeSha256,sha(bytes('🙂')));
 for(const [start,end]of [[2,5],[1,4],[0,0],[-1,1],[0,9999]])assert.throws(()=>range(part,start,end),/RANGE/);
 assert.throws(()=>range({...part,text:'changed'},0,1),/RANGE/);
 const bomText='\ufeffB';const bomPart={text:bomText,textSha256:sha(bytes(bomText))};assert.equal(range(bomPart,0,3).text,'\ufeff');
 assert.equal(range(part,5,bytes(part.text).length).text,'e\u0301\r\nB');
});
test('fixture parser outputs/copied JSON are plain data with NO observation/call/settlement authority',()=>{
 const value=assistant(parse(bytes(rawAssistant())),session(parse(bytes(rawSession())),selected),'msg_fixture'),copy=JSON.parse(JSON.stringify(value));
 assert.equal(copy.agentSettlementProof,false);assert.equal(Object.hasOwn(copy,'retirementProof'),false);assert.equal(Object.hasOwn(copy,'originalRead'),false);assert.equal(Object.hasOwn(copy,'sourceId'),false);
 // Only actual-client Map identity can mint/take an original. These pure fixture
 // utilities contain no factory/lookup/positive callback for that private Map.
});
