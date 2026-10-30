import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {MemoryLifecycle,scopeKey} from '../../../services/ingenium-api/lib/memory-v2/lifecycle.mjs';
import {captureLearnedMemorySuppressions,mergeLearnedMemorySuppressions} from '../lib/tools/learned-memory-restore.mjs';
const schema=readFileSync(new URL('../data/migrations/123_veyra_memory_lifecycle.sql',import.meta.url),'utf8');
const scope={organizationId:'org',ownerUserId:'owner',projectId:'project',workspaceId:'workspace',hostId:'host',environmentId:'env',bindingHash:'a'.repeat(64),bindingEpoch:1,visibility:'private'};
const content='Private learned fixture text must not enter a restore capsule';
function fixture(){
 const db=new DatabaseSync(':memory:');
 // Minimal FK parent fixtures; actual memory migration/constraints stay intact.
 db.exec("CREATE TABLE organizations(id TEXT PRIMARY KEY); CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO organizations VALUES ('org'); INSERT INTO users VALUES ('owner');");
 db.exec(schema);
 const memory=new MemoryLifecycle({db,authorize:()=>true,sources:()=>({contentHash:'b'.repeat(64),active:false,excluded:false,uncertain:false,idleEligible:true,kind:'transcript'}),checkpoint:()=>{}});
 memory.setPolicy(scope,{operationId:'policy',expectedRevision:0,enabled:true,generate:true,useMemory:true,externalContext:false});
 memory.setChatPolicy(scope,'chat',{operationId:'chat',expectedRevision:0,useMemory:true,contribute:true});
 const saved=memory.commitRecall(scope,{operationId:'save',admission:memory.admit(scope,'chat',[{id:'source',contentHash:'b'.repeat(64)}]),content,model:'fixture'});
 return {db,memory,id:saved.receipt.memoryId};
}
function tx(db,work){
 db.exec('BEGIN IMMEDIATE');const owner={inTransaction:true,prepare:sql=>db.prepare(sql)};
 try{const value=work(owner);db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}
}
const rows=db=>db.prepare('SELECT * FROM veyra_memory_recall ORDER BY scope_key,id').all();
function forget(f){return f.memory.forget(scope,{operationId:'forget',memoryId:f.id,expectedVersion:1});}
test('actual lifecycle forget survives an older restored row and wipes every same-source derivative, without crossing scopes',()=>{
 const current=fixture(), restored=fixture();
 try{
  const old=rows(current.db)[0];
  restored.db.prepare('DELETE FROM veyra_memory_recall').run();
  const insert=restored.db.prepare('INSERT INTO veyra_memory_recall VALUES (?,?,?,?,?,?,?,?,?)');
  const add=row=>insert.run(...['scope_key','id','content','content_hash','provenance_json','version','state','created_at','updated_at'].map(key=>row[key]));
  add(old);add({...old,id:'derived',content:'Another source derivative',content_hash:'c'.repeat(64)});add({...old,scope_key:scopeKey({...scope,hostId:'other-host'}),id:'foreign'});
  const foreign=rows(restored.db).find(row=>row.id==='foreign');
  const forgotten=forget(current), ledger=captureLearnedMemorySuppressions(current.db);
  assert.equal(JSON.stringify(ledger).includes(content),false);
  const result=tx(restored.db,owner=>mergeLearnedMemorySuppressions(owner,ledger));assert.equal(result.erased,2);
  const after=rows(restored.db);assert.deepEqual(after.find(row=>row.id==='foreign'),foreign);
  for(const row of after.filter(row=>row.id!=='foreign'))assert.deepEqual([row.state,row.content,row.provenance_json,row.version],['forgotten','','[]',2]);
  assert.deepEqual(JSON.parse(restored.db.prepare('SELECT receipt_json FROM veyra_memory_receipt WHERE operation_id=?').get('forget').receipt_json),forgotten.receipt);
  assert.equal(tx(restored.db,owner=>mergeLearnedMemorySuppressions(owner,ledger)).erased,0);
 }finally{current.db.close();restored.db.close();}
});
test('tampered or content-bearing capsules fail before writes, and original receipt conflicts roll back',()=>{
 const current=fixture(),restored=fixture();
 try{
  forget(current);const ledger=captureLearnedMemorySuppressions(current.db),before=rows(restored.db);
  assert.throws(()=>tx(restored.db,owner=>mergeLearnedMemorySuppressions(owner,{...ledger,sha256:'0'.repeat(64)})));
  const injected={...ledger,entries:[{...ledger.entries[0],content:'private'}]};const body={version:injected.version,entries:injected.entries,receipts:injected.receipts};injected.sha256=createHash('sha256').update(JSON.stringify(body)).digest('hex');
  assert.throws(()=>tx(restored.db,owner=>mergeLearnedMemorySuppressions(owner,injected)));
  const row=ledger.receipts[0];restored.db.prepare('INSERT INTO veyra_memory_receipt VALUES (?,?,?,?)').run(row.scope_key,row.operation_id,'d'.repeat(64),row.receipt_json);
  assert.throws(()=>tx(restored.db,owner=>mergeLearnedMemorySuppressions(owner,ledger)));
  assert.deepEqual(rows(restored.db),before);assert.equal(restored.db.prepare('SELECT count(*) AS n FROM veyra_memory_suppression').get().n,0);
 }finally{current.db.close();restored.db.close();}
});
test('restored suppressions are unioned with current forget and reset originals',()=>{
 const current=fixture(),restored=fixture();
 try{
  forget(current);const ledger=captureLearnedMemorySuppressions(current.db);
  const preview=restored.memory.previewReset(scope);restored.memory.reset(scope,{operationId:'reset',confirmation:preview.confirmation});
  tx(restored.db,owner=>mergeLearnedMemorySuppressions(owner,ledger));
  const union=captureLearnedMemorySuppressions(restored.db);assert.deepEqual(union.receipts.map(row=>row.operation_id),['forget','reset']);
  assert.ok(union.entries.length>ledger.entries.length);
 }finally{current.db.close();restored.db.close();}
});
test('legacy absence is explicit, partial schema and writes without original transaction refuse',()=>{
 const legacy=new DatabaseSync(':memory:'),current=fixture();
 try{
  const empty=captureLearnedMemorySuppressions(legacy);assert.deepEqual(empty.entries,[]);
  assert.throws(()=>mergeLearnedMemorySuppressions(current.db,empty));
  assert.equal(tx(legacy,owner=>mergeLearnedMemorySuppressions(owner,empty)).erased,0);
  legacy.exec('CREATE TABLE veyra_memory_suppression(scope_key TEXT)');assert.throws(()=>captureLearnedMemorySuppressions(legacy));
 }finally{legacy.close();current.db.close();}
});
