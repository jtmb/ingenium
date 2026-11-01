// Root-only model-free SQLite harness. No production database is opened.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createAttachmentDeliveryOwner } from '../lib/voice-v2/attachment-delivery-owner.mjs';
const scope={actorId:'user',accountId:'user',organizationId:'org',projectId:'project',conversationId:'ses_original',runtimeId:'runtime',executionBindingId:'workspace',executionRevision:'epoch-one',agentId:'agent'};
const input={scope,requestId:'request-one',kind:'message',inputHash:'a'.repeat(64),originalMessageId:'msg_original'};
function fixture(){
 const raw=new DatabaseSync(':memory:');raw.exec(readFileSync(new URL('../../../packages/ingenium-core/data/migrations/132_voice_attachment_deliveries.sql',import.meta.url),'utf8'));
 const database={prepare:sql=>raw.prepare(sql),transaction:fn=>()=>{raw.exec('BEGIN IMMEDIATE');try{const value=fn();raw.exec('COMMIT');return value;}catch(error){raw.exec('ROLLBACK');throw error;}}};
 let allowed=true;const context={};const ports={db:()=>database,assertContext:(value,s,action)=>{assert.equal(value,context);if(!allowed&&action!=='read')throw new Error('write denied');},now:()=>1234};
 return {raw,context,ports,owner:createAttachmentDeliveryOwner(ports),deny:()=>{allowed=false;}};
}
test('one Core intent and ACK are metadata only; copied handle cannot claim or retire agent',()=>{
 const f=fixture();try{const r=f.owner.reserve(f.context,input);assert.equal(r.fresh,true);assert.throws(()=>f.owner.claim({}),/ORIGINAL_REQUIRED/);f.owner.claim(r.handle);
  const ack=f.owner.acknowledge(r.handle,{originalMessageId:input.originalMessageId,sessionId:scope.conversationId,state:'delivered'});
  assert.equal(ack.executionCompleted,false);assert.equal(ack.agentSettlementProof,false);assert.equal(f.owner.reserve(f.context,input).fresh,false);
  const columns=f.raw.prepare('PRAGMA table_info(veyra_voice_attachment_deliveries)').all().map(x=>x.name);assert.ok(!columns.some(x=>/text|audio|transcript|run_id|quota/.test(x)));
 }finally{f.raw.close();}
});
test('restart cannot replay abandoned intent or unknown original',()=>{
 const f=fixture();try{const first=f.owner.reserve(f.context,input);f.owner.claim(first.handle);
  const restarted=createAttachmentDeliveryOwner(f.ports),old=restarted.reserve(f.context,input);assert.equal(old.fresh,false);assert.equal(old.receipt.state,'unknown');assert.equal(old.handle,undefined);
  f.owner.unknown(first.handle);assert.equal(restarted.reserve(f.context,input).fresh,false);assert.throws(()=>f.owner.claim(first.handle),/SPENT/);
 }finally{f.raw.close();}
});
test('changed hash/original message cannot reuse caller ID and immutable identities cannot be updated',()=>{
 const f=fixture();try{f.owner.reserve(f.context,input);assert.throws(()=>f.owner.reserve(f.context,{...input,inputHash:'b'.repeat(64)}),/CONFLICT/);
  assert.throws(()=>f.owner.reserve(f.context,{...input,originalMessageId:'msg_replacement'}),/CONFLICT/);
  assert.throws(()=>f.raw.prepare('UPDATE veyra_voice_attachment_deliveries SET request_id=?').run('other'),/immutable/);
 }finally{f.raw.close();}
});
test('revocation before claim blocks effect; original negative outcome can still be retained',()=>{
 const f=fixture();try{const r=f.owner.reserve(f.context,input);f.deny();assert.throws(()=>f.owner.claim(r.handle),/write denied/);assert.equal(f.owner.unknown(r.handle).state,'unknown');
 }finally{f.raw.close();}
});
test('control ACK is pending only; migration cannot reopen unknown or treat message ACK as completed execution',()=>{
 const f=fixture();try{const r=f.owner.reserve(f.context,{...input,kind:'cancel-agent'});f.owner.claim(r.handle);
  assert.throws(()=>f.owner.acknowledge(r.handle,{originalMessageId:input.originalMessageId,sessionId:scope.conversationId,state:'completed'}),/ACK_INVALID/);
  f.owner.unknown(r.handle);assert.throws(()=>f.raw.prepare("UPDATE veyra_voice_attachment_deliveries SET state='ack',ack_kind='pending',ack_hash=?,revision=2").run('c'.repeat(64)),/replay or reopen/);
 }finally{f.raw.close();}
});
for(const recursive of [0,1]){
 test(`recursive_triggers=${recursive}: INSERT OR REPLACE cannot erase intent/ack/unknown originals`,()=>{
  for(const state of ['intent','ack','unknown']){
   const f=fixture();try{
    f.raw.exec(`PRAGMA recursive_triggers=${recursive}`);const r=f.owner.reserve(f.context,input);
    if(state==='ack'){f.owner.claim(r.handle);f.owner.acknowledge(r.handle,{originalMessageId:input.originalMessageId,sessionId:scope.conversationId,state:'delivered'});}
    if(state==='unknown')f.owner.unknown(r.handle);
    const before=f.raw.prepare('SELECT * FROM veyra_voice_attachment_deliveries').get();
    const sql='INSERT OR REPLACE INTO veyra_voice_attachment_deliveries(scope_hash,request_id,kind,scope_json,input_hash,original_message_id,state,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,\'intent\',1,?,?)';
    assert.throws(()=>f.raw.prepare(sql).run(before.scope_hash,before.request_id,before.kind,before.scope_json,'b'.repeat(64),'msg_replacement',1234,1234),/already exists/);
    assert.deepEqual(f.raw.prepare('SELECT * FROM veyra_voice_attachment_deliveries').get(),before);
    assert.throws(()=>f.raw.prepare(sql.replace('OR REPLACE','OR IGNORE')).run(before.scope_hash,before.request_id,before.kind,before.scope_json,before.input_hash,before.original_message_id,1234,1234),/already exists/);
   }finally{f.raw.close();}
  }
 });
 test(`recursive_triggers=${recursive}: DELETE and timestamp rollback preserve spent rows`,()=>{
  const f=fixture();try{
   f.raw.exec(`PRAGMA recursive_triggers=${recursive}`);const r=f.owner.reserve(f.context,input);f.owner.unknown(r.handle);
   const before=f.raw.prepare('SELECT * FROM veyra_voice_attachment_deliveries').get();
   assert.throws(()=>f.raw.exec('DELETE FROM veyra_voice_attachment_deliveries'),/cannot be deleted/);
   assert.throws(()=>f.raw.exec('UPDATE OR REPLACE veyra_voice_attachment_deliveries SET rowid=2'),/no such column/);
   assert.throws(()=>f.raw.exec('UPDATE veyra_voice_attachment_deliveries SET updated_at=1233'),/backwards|CHECK constraint/);
   f.raw.exec('UPDATE veyra_voice_attachment_deliveries SET updated_at=1235');
   assert.throws(()=>f.raw.exec('UPDATE veyra_voice_attachment_deliveries SET updated_at=1234'),/backwards/);
   const after=f.raw.prepare('SELECT * FROM veyra_voice_attachment_deliveries').get();assert.equal(after.state,before.state);assert.equal(after.updated_at,1235);
  }finally{f.raw.close();}
 });
}
