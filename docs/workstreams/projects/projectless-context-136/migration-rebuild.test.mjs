// AUTHORED, NOT RUN by Projects2. Synthetic in-memory SQLite only.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {installEvolution,fingerprint,replaceExactly,addColumnsAndConstraints} from './migration-rebuild.mjs';
const require=createRequire(process.env.VEYRA_CORE_PACKAGE??'/home/brajam/.local/state/ingenium-release/skill-zen-fix-1792810845/real-gmail-ui/prd-ui-fixes/packages/ingenium-core/package.json');
const Database=require('better-sqlite3');
function fixture() {
 const db=new Database(':memory:');db.pragma('foreign_keys=ON');
 db.exec(`CREATE TABLE projects(id TEXT PRIMARY KEY);
 CREATE TABLE context_conversations(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,payload BLOB,UNIQUE(project_id,id),FOREIGN KEY(project_id) REFERENCES projects(id));
 CREATE TABLE context_messages(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,conversation_id TEXT NOT NULL,content TEXT,i INTEGER,r REAL,b BLOB,FOREIGN KEY(project_id,conversation_id) REFERENCES context_conversations(project_id,id));
 CREATE TABLE incoming(project_id TEXT,conversation_id TEXT,FOREIGN KEY(project_id,conversation_id) REFERENCES context_conversations(project_id,id));
 CREATE VIRTUAL TABLE context_messages_fts USING fts5(content,content='context_messages',content_rowid='rowid');
 CREATE TRIGGER fts_insert AFTER INSERT ON context_messages BEGIN INSERT INTO context_messages_fts(rowid,content) VALUES(new.rowid,new.content); END;
 CREATE TRIGGER immutable_message BEFORE DELETE ON context_messages BEGIN SELECT RAISE(ABORT,'keep'); END;
 CREATE INDEX custom_owner_index ON context_conversations(payload) WHERE payload IS NOT NULL;
 CREATE VIEW custom_history AS SELECT m.id,m.content,c.project_id FROM context_messages m JOIN context_conversations c ON c.id=m.conversation_id;
 INSERT INTO projects VALUES('p');INSERT INTO context_conversations(rowid,id,project_id,payload) VALUES(47,'c','p',x'00ff');
 INSERT INTO incoming VALUES('p','c');`);
 db.prepare('INSERT INTO context_messages(rowid,id,project_id,conversation_id,content,i,r,b) VALUES(?,?,?,?,?,?,?,?)').run(109,'m','p','c','cafe\u0301\0 needle',9007199254740993n,1.2345678901234567,Buffer.from([0,255,128]));return db;
}
function spec(tailSql='') {return {version:136,recipeSha256:'f'.repeat(64),tables:[
 {name:'context_conversations',evolve:s=>addColumnsAndConstraints(replaceExactly(s,'project_id TEXT NOT NULL','project_id TEXT'),"scope_kind TEXT NOT NULL DEFAULT 'project',CHECK(project_id IS NOT NULL OR scope_kind='workspace')")},
 {name:'context_messages',evolve:s=>addColumnsAndConstraints(replaceExactly(s,'project_id TEXT NOT NULL','project_id TEXT'),'FOREIGN KEY(conversation_id) REFERENCES context_conversations(id)')},
 ],tailSql};}
const objects=db=>db.prepare("SELECT type,name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
const state=db=>({objects:objects(db),conversations:fingerprint(db,'context_conversations'),messages:fingerprint(db,'context_messages'),child:fingerprint(db,'incoming')});
test('lossless typed cells, rowids, external FTS shadow data, incoming child and exact user objects',()=>{
 const db=fixture();try {
  const before=state(db),shadow=fingerprint(db,'context_messages_fts_data');
  assert.equal(installEvolution(db,spec()).installed,true);
  assert.deepEqual(fingerprint(db,'context_messages'),before.messages);
  assert.deepEqual(fingerprint(db,'context_conversations',['id','project_id','payload']),before.conversations);
  assert.deepEqual(fingerprint(db,'incoming'),before.child);
  assert.deepEqual(fingerprint(db,'context_messages_fts_data'),shadow);
  for(const name of ['custom_owner_index','custom_history','fts_insert','immutable_message'])assert.deepEqual(objects(db).find(x=>x.name===name),before.objects.find(x=>x.name===name));
  assert.deepEqual(db.prepare("SELECT rowid FROM context_messages_fts WHERE context_messages_fts MATCH 'needle'").all(),[{rowid:109}]);
  assert.deepEqual(db.pragma('foreign_key_check'),[]);assert.equal(db.pragma('foreign_keys',{simple:true}),1);
  assert.equal(installEvolution(db,spec()).installed,false);
  assert.throws(()=>db.exec("DELETE FROM context_messages WHERE id='m'"),/keep/);
 }finally{db.close();}
});
for(const [label,mutate] of [
 ['tail SQL failure',s=>({...s,tailSql:'SELECT no_such_function();'})],
 ['constraint failure during exact copy',s=>({...s,tables:s.tables.map(t=>t.name==='context_messages'?{...t,evolve:sql=>addColumnsAndConstraints(t.evolve(sql),'CHECK(length(content)<1)')}:t)})],
 ['full FK failure after nullable child insert',s=>({...s,tailSql:"INSERT INTO context_messages(id,project_id,conversation_id,content) VALUES('bad',NULL,'missing','bad');"})],
])test(label+' restores original data/schema/FK and leaves no staging objects',()=>{
 const db=fixture();try{const before=state(db);assert.throws(()=>installEvolution(db,mutate(spec())));assert.deepEqual(state(db),before);assert.equal(db.pragma('foreign_keys',{simple:true}),1);assert.equal(db.inTransaction,false);}finally{db.close();}
});
test('original OFF FK state and legacy pragma restored',()=>{const db=fixture();try{db.pragma('foreign_keys=OFF');db.pragma('legacy_alter_table=OFF');installEvolution(db,spec());assert.equal(db.pragma('foreign_keys',{simple:true}),0);assert.equal(db.pragma('legacy_alter_table',{simple:true}),0);}finally{db.close();}});
test('nested transaction rejected before mutation',()=>{const db=fixture();try{const before=state(db);db.exec('BEGIN');assert.throws(()=>installEvolution(db,spec()),/QUIESCED/);db.exec('ROLLBACK');assert.deepEqual(state(db),before);}finally{db.close();}});
test('installed marker cannot mask drift or a changed recipe',()=>{const db=fixture();try{installEvolution(db,spec());assert.throws(()=>installEvolution(db,{...spec(),recipeSha256:'e'.repeat(64)}),/RECEIPT/);db.exec('DROP TRIGGER immutable_message');assert.throws(()=>installEvolution(db,spec()),/SCHEMA_DRIFT/);}finally{db.close();}});
test('preexisting FK fault and staging collision are preserved and refused',()=>{
 for(const mode of ['fault','stage']){const db=fixture();try{
  if(mode==='fault'){db.pragma('foreign_keys=OFF');db.exec("INSERT INTO incoming VALUES('missing','missing')");db.pragma('foreign_keys=ON');}
  else db.exec('CREATE TABLE __veyra_136_context_conversations(evidence TEXT)');
  const before=state(db);assert.throws(()=>installEvolution(db,spec()),mode==='fault'?/PREEXISTING/:/STAGING_OBJECT/);assert.deepEqual(state(db),before);
 }finally{db.close();}}
});
