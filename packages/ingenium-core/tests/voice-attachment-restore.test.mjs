// Root-only model-free metadata SQLite tests. No auth/model/execution stand-ins.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { captureVoiceAttachmentRestoreLedger as capture,mergeVoiceAttachmentRestoreLedger as merge,validateVoiceAttachmentRestoreLedger as validate,VOICE_ATTACHMENT_RESTORE_LIMITS as limits } from '../lib/tools/voice-attachment-restore.mjs';
const sql=readFileSync(new URL('../data/migrations/132_voice_attachment_deliveries.sql',import.meta.url),'utf8');
const sha=value=>createHash('sha256').update(value).digest('hex');
const axes=['actorId','accountId','organizationId','projectId','conversationId','runtimeId','executionBindingId','executionRevision','agentId'];
const scope={actorId:'user',accountId:'user',organizationId:'org',projectId:'project',conversationId:'ses_original',runtimeId:'runtime',executionBindingId:'workspace',executionRevision:'epoch-one',agentId:'agent'};
const sort=(a,b)=>{const key=r=>JSON.stringify([r.scope_hash,r.request_id,r.kind]);return key(a)<key(b)?-1:key(a)>key(b)?1:0;};
function entry(id='request-a',state='intent',selectedScope=scope,kind='message'){
 const scope_json=JSON.stringify(Object.fromEntries(axes.map(k=>[k,selectedScope[k]]))),scope_hash=sha(scope_json),ack_kind=state==='ack'?(kind==='message'?'delivered':'pending'):null;
 return {scope_hash,request_id:id,kind,scope_json,input_hash:sha('input-'+id),original_message_id:'msg_'+id,state,ack_kind,
  ack_hash:state==='ack'?sha(JSON.stringify([scope_hash,id,kind,'msg_'+id,selectedScope.conversationId,ack_kind])):null,
  revision:state==='intent'?1:2,created_at:100,updated_at:state==='intent'?100:101};
}
function capsule(entries){const body={version:1,count:entries.length,entries:[...entries].sort(sort)};return {...body,sha256:sha(JSON.stringify(body))};}
function fixture(recursive=0,schema=true){
 const raw=new DatabaseSync(':memory:');raw.exec(`PRAGMA recursive_triggers=${recursive}`);if(schema)raw.exec(sql);let active=false;
 const db={prepare:query=>raw.prepare(query),exec:query=>raw.exec(query),get inTransaction(){return active;}};
 return {raw,db,begin(){raw.exec('BEGIN IMMEDIATE');active=true;},end(){raw.exec('COMMIT');active=false;},
  close(){if(active){raw.exec('ROLLBACK');active=false;}raw.close();},
  insert(row){const names=Object.keys(row);raw.prepare(`INSERT INTO veyra_voice_attachment_deliveries(${names.join(',')}) VALUES(${names.map(()=>'?').join(',')})`).run(...Object.values(row));},
  rows(){return raw.prepare('SELECT * FROM veyra_voice_attachment_deliveries').all().map(row=>({...row})).sort(sort);}};
}
for(const recursive of [0,1]){
 test(`restore ledger recursive=${recursive}: old snapshot missing live intent cannot replay`,()=>{
  const live=fixture(recursive),restored=fixture(recursive);try{
   const original=entry();live.insert(original);const saved=capture(live.db);
   assert.equal(saved.count,1);assert.equal(saved.entries[0].state,'intent');assert.equal(restored.rows().length,0);
   restored.begin();assert.deepEqual(merge(restored.db,saved),{preserved:1,inserted:1,sealed:0});restored.end();
   assert.equal(restored.rows()[0].state,'unknown');assert.equal(restored.rows()[0].revision,2);
   assert.throws(()=>restored.insert(original),/already exists/);
   restored.begin();merge(restored.db,saved);restored.end();assert.equal(restored.rows()[0].state,'unknown');
   const names=Object.keys(restored.rows()[0]);assert.ok(names.every(k=>!['audio','transcript','run_id','authorization','agent_settlement'].includes(k)));
  }finally{live.close();restored.close();}
 });
 test(`restore ledger recursive=${recursive}: union preserves ACK, unknown and restored-only abandoned intent`,()=>{
  const f=fixture(recursive);try{
   f.insert(entry('restored-only'));f.insert(entry('shared','intent'));
   const delivered=entry('shared','ack'),unknown=entry('live-only','unknown'),control=entry('control','ack',scope,'cancel-agent');
   f.begin();merge(f.db,capsule([delivered,unknown,control]));f.end();
   assert.equal(f.rows().length,4);assert.equal(f.rows().find(r=>r.request_id==='shared').ack_kind,'delivered');
   assert.equal(f.rows().find(r=>r.request_id==='restored-only').state,'unknown');
   assert.equal(f.rows().find(r=>r.request_id==='control').ack_kind,'pending');
   for(const row of f.rows())assert.throws(()=>f.insert({...row,state:'intent',ack_kind:null,ack_hash:null,revision:1}),/already exists/);
  }finally{f.close();}
 });
 test(`restore ledger recursive=${recursive}: immutable identity conflicts refuse entire union before writes`,()=>{
  for(const column of ['input_hash','original_message_id','created_at']){
   const f=fixture(recursive);try{
    const original=entry('z-conflict');f.insert(original);const changed={...original,[column]:column==='created_at'?99:column==='input_hash'?'b'.repeat(64):'other-original'};
    const before=f.rows();f.begin();assert.throws(()=>merge(f.db,capsule([entry('a-would-insert'),changed])),/CONFLICT/);f.end();assert.deepEqual(f.rows(),before);
   }finally{f.close();}
  }
 });
 test(`restore ledger recursive=${recursive}: conflicting valid ACK and unknown/ACK refuse atomically`,()=>{
  for(const states of [['ack','ack'],['unknown','ack'],['ack','unknown']]){
   const f=fixture(recursive);try{
    const a=entry('z-conflict',states[0]),b=entry('z-conflict',states[1]);
    if(states[0]===states[1]){b.ack_kind='rejected';b.ack_hash=sha(JSON.stringify([b.scope_hash,b.request_id,b.kind,b.original_message_id,scope.conversationId,b.ack_kind]));}
    f.insert(a);const before=f.rows();f.begin();assert.throws(()=>merge(f.db,capsule([entry('a-new'),b])),/CONFLICT/);f.end();assert.deepEqual(f.rows(),before);
   }finally{f.close();}
  }
 });
 test(`restore ledger recursive=${recursive}: sealed ACK dominates old intent, repeat merge stays terminal`,()=>{
  const f=fixture(recursive);try{
   const ack=entry('shared','ack');f.insert(ack);const older=capsule([entry('shared')]);
   f.begin();merge(f.db,older);merge(f.db,older);f.end();assert.deepEqual(f.rows(),[ack]);
   assert.throws(()=>f.raw.prepare("UPDATE veyra_voice_attachment_deliveries SET state='intent',revision=1,ack_kind=NULL,ack_hash=NULL").run(),/replay or reopen/);
  }finally{f.close();}
 });
 test(`restore ledger recursive=${recursive}: missing legacy capsule, transaction and old/partial schema fail closed`,()=>{
  const f=fixture(recursive),old=fixture(recursive,false);try{
   assert.throws(()=>merge(f.db,capsule([])),/TRANSACTION_REQUIRED/);f.begin();
   for(const missing of [undefined,null,{}, {version:0,entries:[],sha256:'a'.repeat(64)}]){assert.throws(()=>validate(missing),/RESTORE_INVALID/);assert.throws(()=>merge(f.db,missing),/RESTORE_INVALID/);}
   assert.equal(validate(capsule([])),undefined);
   f.end();assert.throws(()=>capture(old.db),/SCHEMA_REQUIRED/);old.begin();assert.throws(()=>merge(old.db,capsule([])),/SCHEMA_REQUIRED/);old.end();
   f.raw.exec('DROP TRIGGER veyra_voice_attachment_transition');assert.throws(()=>capture(f.db),/SCHEMA_REQUIRED/);
  }finally{f.close();old.close();}
 });
 test(`restore ledger recursive=${recursive}: strict hashes, canonical nine axes, metadata and bounds`,()=>{
  const f=fixture(recursive);try{f.begin();
   const original=entry();
   const wrongScope={...original,scope_json:JSON.stringify({...scope,extra:'not allowed'})};wrongScope.scope_hash=sha(wrongScope.scope_json);
   const reversed={...original,scope_json:JSON.stringify(Object.fromEntries([...axes].reverse().map(k=>[k,scope[k]])))};reversed.scope_hash=sha(reversed.scope_json);
   const invalids=[{...original,scope_hash:'f'.repeat(64)},wrongScope,reversed,{...original,input_hash:'A'.repeat(64)},
    {...original,updated_at:99},{...original,created_at:1.5},{...original,state:'ack',revision:2,ack_kind:'delivered',ack_hash:'0'.repeat(64)},
    {...original,transcript:'forbidden'}, {...original,revision:2}, {...original,request_id:'x'.repeat(257)}];
   for(const invalid of invalids)assert.throws(()=>merge(f.db,capsule([invalid])),/RESTORE_INVALID/);
   const badHash=capsule([original]);badHash.sha256='0'.repeat(64);assert.throws(()=>merge(f.db,badHash),/RESTORE_INVALID/);
   const duplicate=capsule([original,original]);assert.throws(()=>merge(f.db,duplicate),/RESTORE_INVALID/);
   const unsorted=capsule([entry('a'),entry('z')]);unsorted.entries.reverse();unsorted.sha256=sha(JSON.stringify({version:1,count:2,entries:unsorted.entries}));assert.throws(()=>merge(f.db,unsorted),/RESTORE_INVALID/);
   const wrongCount={...capsule([original]),count:0};assert.throws(()=>merge(f.db,wrongCount),/RESTORE_INVALID/);
   const extra={...capsule([]),authorization:true};assert.throws(()=>merge(f.db,extra),/RESTORE_INVALID/);
   f.end();assert.equal(f.rows().length,0);
  }finally{f.close();}
 });
 test(`restore ledger recursive=${recursive}: row/scope/byte caps refuse without writes`,()=>{
  const f=fixture(recursive);try{f.begin();
   assert.throws(()=>merge(f.db,capsule(Array(limits.rows+1).fill(entry()))),/CAPACITY/);
   assert.throws(()=>merge(f.db,capsule(Array.from({length:limits.perScope+1},(_,i)=>entry('r'+i)))),/CAPACITY/);
   const wide=Object.fromEntries(axes.map(axis=>[axis,'界'.repeat(256)]));
   assert.throws(()=>merge(f.db,capsule(Array.from({length:1200},(_,i)=>entry('wide'+i,'unknown',wide)))),/CAPACITY/);
   assert.equal(f.rows().length,0);f.end();
  }finally{f.close();}
 });
 test(`restore ledger recursive=${recursive}: combined union capacity is bounded, not just each side`,()=>{
  const f=fixture(recursive);try{
   for(let i=0;i<2050;i++)f.insert(entry('restored'+i,'unknown'));
   const before=capture(f.db);f.begin();assert.throws(()=>merge(f.db,capsule(Array.from({length:2050},(_,i)=>entry('live'+i,'unknown')))),/CAPACITY/);f.end();
   assert.deepEqual(capture(f.db),before);
  }finally{f.close();}
 });
 test(`restore ledger recursive=${recursive}: malformed restored rows and schema drift also refuse`,()=>{
  const f=fixture(recursive),changed=fixture(recursive);try{
   f.insert({...entry(),input_hash:'z'.repeat(64)});assert.throws(()=>capture(f.db),/RESTORE_INVALID/);
   changed.raw.exec('DROP TRIGGER veyra_voice_attachment_transition');changed.raw.exec("CREATE TRIGGER veyra_voice_attachment_transition BEFORE UPDATE ON veyra_voice_attachment_deliveries BEGIN SELECT RAISE(ABORT,'changed'); END");
   assert.throws(()=>capture(changed.db),/SCHEMA_REQUIRED/);
  }finally{f.close();changed.close();}
 });
}
