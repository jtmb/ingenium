import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createNativeMemoryController} from '../services/ingenium-dashboard/src/app/components/memory-v2/native/adapter.mjs';
function fixture() {
 const records=new Map(),receipts=[],calls=[];
 let unknown=false, revision=0, sequence=0, committed;
 const binding={scopeKey:'a'.repeat(64),scopeHash:'a'.repeat(64),chatId:'chat',bindingHash:'native-owner',bindingEpoch:4};
 const response=()=>({binding,available:true,canChange:true,
  policy:{revision,enabled:true,generate:false,use_memories:true,external_context:false,min_idle_hours:17},
  chat:{revision:0,use_memories:true,contribute:false},entries:[]});
 const custody={
  async get(k){return records.get(k)},
  async set(k,r){if(records.has(k))throw Error('existing');records.set(k,structuredClone(r))},
  async retain(k,id,r){assert.equal(records.get(k)?.operationId,id);receipts.push(r)},
  async remove(k,id){assert.equal(records.get(k)?.operationId,id);assert.ok(receipts.some(r=>r.operationId===id));records.delete(k)},
 };
 const request=async(method,path,body)=>{
  assert.equal(method,'POST');assert.equal(path,'/v1/goals/learned');
  assert.deepEqual(body.subject,{kind:'project',project:{id:'real-project',revision:4}});
  calls.push(structuredClone(body));
  if(body.command.kind==='inspect')return response();
  if(body.query_receipt)return {...response(),receipt:committed??null};
  const c=body.command;
  committed={operation_id:c.operation_id,scope_hash:binding.scopeHash,kind:c.kind,revision:c.kind==='forget'?c.expected:c.expected+1,request_hash:'native-rust-hash'};
  if(c.kind!=='forget')revision++;
  if(unknown)throw Error('response lost');
  return {...response(),receipt:committed};
 };
 const controller=createNativeMemoryController({request,custody,subject:{kind:'project',project:{id:'real-project',revision:4}},chatId:'chat',newOperationId:()=>String(++sequence)});
 return {controller,calls,records,receipts,unknown:()=>{unknown=true},binding};
}
test('Native policy change retains exact command and idle interval through original custody',async()=>{
 const f=fixture();await f.controller.inspect();
 const state=f.controller.getSnapshot();
 assert.equal(await f.controller.change(state.scopeKey,'chat',{target:'host',expectedRevision:0,values:{...state.policy,generate:true}}),true);
 const write=f.calls.find(c=>c.command.kind==='policy');
 assert.equal(write.command.policy.min_idle_hours,17);assert.equal(write.command.policy.generate,true);
 assert.equal(write.command.policy.use_memories,true);
 assert.equal(f.receipts.length,1);assert.equal(f.records.size,0);
});
test('lost Native policy response preserves pending raw command; receipt check never replays write',async()=>{
 const f=fixture();await f.controller.inspect();f.unknown();
 const state=f.controller.getSnapshot();
 assert.equal(await f.controller.change(state.scopeKey,'chat',{target:'chat',expectedRevision:0,values:{...state.chat,contribute:true}}),false);
 assert.equal(f.controller.getSnapshot().unknownOperationId,'1');
 const original=structuredClone(f.records.get(f.binding.scopeHash).nativeCommand);
 assert.equal(await f.controller.reconcile('1'),true);
 assert.deepEqual(f.calls.find(c=>c.query_receipt).command,original);
 assert.equal(f.calls.filter(c=>c.command.kind==='chat'&&!c.query_receipt).length,1);
 assert.equal(f.records.size,0);
});
test('forget loss reconciles exact source suppression operation without another mutation',async()=>{
 const f=fixture();await f.controller.inspect();f.unknown();
 assert.equal(await f.controller.forget({id:'learned',revision:9}),false);
 assert.equal(f.controller.getSnapshot().unknownOperationId,'1');
 assert.equal(await f.controller.reconcile('1'),true);
 const write=f.calls.filter(c=>c.command.kind==='forget');
 assert.equal(write.length,2);assert.equal(write[0].query_receipt,false);assert.equal(write[1].query_receipt,true);
 assert.deepEqual(write[1].command,write[0].command);assert.equal(f.records.size,0);
});
test('failed durable custody prevents any policy write',async()=>{
 const f=fixture();await f.controller.inspect();
 f.records.set(f.binding.scopeHash,{operationId:'other',identity:f.binding,change:{target:'host'}});
 const s=f.controller.getSnapshot();
 assert.equal(await f.controller.change(s.scopeKey,'chat',{target:'host',expectedRevision:0,values:{...s.policy,generate:true}}),false);
 assert.equal(f.calls.filter(c=>c.command.kind!=='inspect').length,0);
});
test('Native source manifest has exact bytes and unique import transformations',async()=>{
 const root=new URL('../',import.meta.url);
 const rows=JSON.parse(await readFile(new URL('docs/workstreams/memory/native/sources.json',root),'utf8'));
 const targets=new Set();
 for(const row of rows){
  assert.ok(!targets.has(row.target));targets.add(row.target);
  assert.ok(!row.target.includes('..'));
  const source=await readFile(new URL(row.source,root));
  assert.equal(source.length,row.bytes);
  assert.equal(createHash('sha256').update(source).digest('hex'),row.sha256);
  if(row.transform)assert.equal(source.toString().split(row.transform.find).length,2);
 }
 assert.ok(rows.some(r=>r.target==='crates/adapters/src/goal_store/learned.rs'));
});
