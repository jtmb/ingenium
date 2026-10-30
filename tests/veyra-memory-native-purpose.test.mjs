import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
// Effect-free schema fixture from pinned Native4e provider_attempts/0002.sql.
// Ordinary rows are DATA ONLY, never native grant/retirement evidence.
const v2=[
 'CREATE TABLE attempts (',
 ' request_id TEXT NOT NULL PRIMARY KEY, task_id TEXT NOT NULL, turn_id TEXT NOT NULL,',
 " record TEXT NOT NULL CHECK(length(record) BETWEEN 1 AND 8192), disposition TEXT NOT NULL CHECK(disposition IN ('pending','yielded'))",
 ') STRICT;',
 "CREATE UNIQUE INDEX attempts_one_pending_turn ON attempts(task_id,turn_id) WHERE disposition='pending';",
 'PRAGMA user_version=2;',
].join('\n');
const migration=await readFile(new URL('../docs/workstreams/memory/native/sources/crates/adapters/src/provider_attempts/0003.sql',import.meta.url),'utf8');
const hash='a'.repeat(64),input='b'.repeat(64);
function fixture(){const db=new DatabaseSync(':memory:');db.exec(v2);return db;}
function task(db,id,record='{"fixture":"DATA ONLY"}'){db.prepare('INSERT INTO attempts VALUES(?,?,?,?,?)').run(id,'task-original','turn-'+id,record,'pending');}
function memory(db,id,scope=hash,source=input,disposition='pending'){
 db.prepare('INSERT INTO memory_attempts VALUES(?,?,?,?,?)').run(id,scope,source,'{"fixture":"DATA ONLY"}',disposition);
}
test('additive same-journal migration preserves Task schema and exact stored bytes',()=>{
 const db=fixture();try{
  const raw='{"fixture":"DATA ONLY","exact":"  λ\\r\\n"}';task(db,'original',raw);
  const schema=db.prepare("SELECT sql FROM sqlite_schema WHERE name='attempts'").get().sql;
  const before=db.prepare('SELECT hex(CAST(record AS BLOB)) AS bytes FROM attempts').get().bytes;
  db.exec(migration);
  assert.equal(db.prepare("SELECT sql FROM sqlite_schema WHERE name='attempts'").get().sql,schema);
  assert.equal(db.prepare('SELECT hex(CAST(record AS BLOB)) AS bytes FROM attempts').get().bytes,before);
  assert.equal(db.prepare('SELECT count(*) AS n FROM memory_attempts').get().n,0);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version,3);
 }finally{db.close()}
});
test('original request UUID cannot cross Task and Memory purposes in either direction',()=>{
 const db=fixture();try{
  db.exec(migration);task(db,'task-spent');assert.throws(()=>memory(db,'task-spent'));
  memory(db,'memory-spent');assert.throws(()=>task(db,'memory-spent'));
  assert.equal(db.prepare('SELECT count(*) AS n FROM attempts').get().n,1);
  assert.equal(db.prepare('SELECT count(*) AS n FROM memory_attempts').get().n,1);
 }finally{db.close()}
});
test('same scoped input stays spent after yielded metadata while a separate scope stays separate',()=>{
 const db=fixture();try{
  db.exec(migration);memory(db,'old',hash,input,'yielded');
  assert.throws(()=>memory(db,'new'));
  memory(db,'private-other','c'.repeat(64),input);
  assert.equal(db.prepare('SELECT count(*) AS n FROM memory_attempts').get().n,2);
 }finally{db.close()}
});
test('memory ledger refuses malformed hashes and contains no fake Task/Project columns',()=>{
 const db=fixture();try{
  db.exec(migration);
  assert.throws(()=>memory(db,'bad','not-a-scope'));
  assert.throws(()=>memory(db,'upper','A'.repeat(64)));
  const columns=db.prepare('PRAGMA table_info(memory_attempts)').all().map(row=>row.name);
  assert.deepEqual(columns,['request_id','scope_hash','input_hash','record','disposition']);
 }finally{db.close()}
});
test('failed additive migration rolls back without altering Task rows or version',()=>{
 const db=fixture();try{
  task(db,'protected');db.exec('CREATE TABLE memory_attempts(sentinel TEXT); BEGIN');
  assert.throws(()=>db.exec(migration));db.exec('ROLLBACK');
  assert.equal(db.prepare('SELECT count(*) AS n FROM attempts').get().n,1);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version,2);
  assert.deepEqual(db.prepare('PRAGMA table_info(memory_attempts)').all().map(r=>r.name),['sentinel']);
 }finally{db.close()}
});
