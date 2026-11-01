import { createHash } from 'node:crypto';

const TABLE = 'veyra_voice_attachment_deliveries';
export const VOICE_ATTACHMENT_RESTORE_LIMITS = Object.freeze({ rows:16384, perScope:4096, bytes:8*1024*1024 });
const axes = ['actorId','accountId','organizationId','projectId','conversationId','runtimeId','executionBindingId','executionRevision','agentId'];
const columns = ['scope_hash','request_id','kind','scope_json','input_hash','original_message_id','state','ack_kind','ack_hash','revision','created_at','updated_at'];
// Exact original Core132 contract. Only CRLF/LF and final SQL semicolon normalize.
// This is a refusal guard, not a replacement migrator or permission authority.
const schema = Object.freeze({
 veyra_voice_attachment_deliveries:'c1f05b27ea64096a8d0075981803c21f1fefe04c18def32e05f5ba58e833694c',
 veyra_voice_attachment_insert_collision:'c1497c7fc5438719edf3eb651cdd99db871fd8a9986c36ef148232bf40ff7b9a',
 veyra_voice_attachment_no_delete:'0d026bc38c1d88c4820938d1c0e5add452c07792342681d094c4c9a9f8005ca3',
 veyra_voice_attachment_monotonic_time:'61141e21d4ee5ada678dc63d649d559b918a9d045772ae7ecd647a6d2d43e865',
 veyra_voice_attachment_identity_immutable:'c20517d614bd8dd5b548cabb25ca4cd33e534d7fc8e643f1c88860387c5dc776',
 veyra_voice_attachment_transition:'a39f2ccddedf8394440b6bbd2b68864c3392d76ebd1a04cb327e3f9b3c6d1c70',
});
const fail = (code='VOICE_ATTACHMENT_RESTORE_INVALID') => { throw Object.assign(new Error(code),{code}); };
const hash = value => createHash('sha256').update(value).digest('hex');
const exact = (value,keys) => value!==null && typeof value==='object' && !Array.isArray(value)
 && [Object.prototype,null].includes(Object.getPrototypeOf(value))
 && Object.keys(value).sort().join('|')===[...keys].sort().join('|');
const text = (value,max=256) => typeof value==='string' && value.length>0 && value.length<=max && !/[\u0000-\u001f\u007f]/u.test(value);
const hex = value => typeof value==='string' && /^[a-f0-9]{64}$/u.test(value);
const key = row => JSON.stringify([row.scope_hash,row.request_id,row.kind]);
const order = (a,b) => key(a)<key(b)?-1:key(a)>key(b)?1:0;
function encoded(value) { try { return JSON.stringify(value); } catch { return fail(); } }
function schemaRequired(db) {
 const actual=db.prepare("SELECT type,name,sql FROM sqlite_master WHERE tbl_name=? ORDER BY type,name").all(TABLE);
 if(actual.length!==Object.keys(schema).length)fail('VOICE_ATTACHMENT_RESTORE_SCHEMA_REQUIRED');
 const found=new Set();
 for(const row of actual){
  if(found.has(row.name)||!(row.name in schema)||row.type!==(row.name===TABLE?'table':'trigger')||typeof row.sql!=='string'
    ||hash(row.sql.replace(/\r\n/g,'\n').trim().replace(/;$/u,''))!==schema[row.name])fail('VOICE_ATTACHMENT_RESTORE_SCHEMA_REQUIRED');
  found.add(row.name);
 }
}
function canonicalRow(row) {
 if(!exact(row,columns)||!hex(row.scope_hash)||!text(row.request_id)||!['message','cancel-agent'].includes(row.kind)
  ||!text(row.original_message_id,128)||!hex(row.input_hash)||typeof row.scope_json!=='string'||Buffer.byteLength(row.scope_json)>16384)fail();
 let scope;try{scope=JSON.parse(row.scope_json);}catch{return fail();}
 if(!exact(scope,axes)||axes.some(axis=>!text(scope[axis])&&!(['organizationId','projectId'].includes(axis)&&scope[axis]===null)))fail();
 const canonicalScope=JSON.stringify(Object.fromEntries(axes.map(axis=>[axis,scope[axis]])));
 if(row.scope_json!==canonicalScope||row.scope_hash!==hash(canonicalScope)
  ||!Number.isSafeInteger(row.created_at)||row.created_at<0||!Number.isSafeInteger(row.updated_at)||row.updated_at<row.created_at)fail();
 if(row.state==='intent'){
  if(row.revision!==1||row.ack_kind!==null||row.ack_hash!==null)fail();
 }else if(row.state==='unknown'){
  if(row.revision!==2||row.ack_kind!==null||row.ack_hash!==null)fail();
 }else if(row.state==='ack'){
  if(row.revision!==2||!(row.kind==='message'?['delivered','rejected']:['pending','rejected']).includes(row.ack_kind)
    ||!hex(row.ack_hash)||row.ack_hash!==hash(JSON.stringify([row.scope_hash,row.request_id,row.kind,row.original_message_id,scope.conversationId,row.ack_kind])))fail();
 }else fail();
 return Object.fromEntries(columns.map(column=>[column,row[column]]));
}
function body(entries) {
 if(!Array.isArray(entries)||entries.length>VOICE_ATTACHMENT_RESTORE_LIMITS.rows)fail('VOICE_ATTACHMENT_RESTORE_CAPACITY');
 // Bound serialized input before canonical copies/hash construction.
 if(Buffer.byteLength(encoded(entries))>VOICE_ATTACHMENT_RESTORE_LIMITS.bytes)fail('VOICE_ATTACHMENT_RESTORE_CAPACITY');
 const result=[],counts=new Map();let previous;
 for(const entry of entries){
  const row=canonicalRow(entry);
  if(previous&&order(previous,row)>=0)fail();
  const count=(counts.get(row.scope_hash)??0)+1;if(count>VOICE_ATTACHMENT_RESTORE_LIMITS.perScope)fail('VOICE_ATTACHMENT_RESTORE_CAPACITY');
  counts.set(row.scope_hash,count);result.push(row);previous=row;
 }
 const value={version:1,count:result.length,entries:result};
 if(Buffer.byteLength(JSON.stringify({...value,sha256:'0'.repeat(64)}))>VOICE_ATTACHMENT_RESTORE_LIMITS.bytes)fail('VOICE_ATTACHMENT_RESTORE_CAPACITY');
 return value;
}
function ledgerBody(ledger) {
 // Older maintenance capsule absence is NOT evidence of an empty live ledger.
 if(!exact(ledger,['version','count','entries','sha256'])||ledger.version!==1||!hex(ledger.sha256)
  ||!Number.isSafeInteger(ledger.count)||ledger.count<0||!Array.isArray(ledger.entries)||ledger.count!==ledger.entries.length)fail();
 const value=body(ledger.entries);if(ledger.sha256!==hash(JSON.stringify(value)))fail();return value;
}
/** Pure metadata preflight for original maintenance owner BEFORE any destructive
 * swap/recovery step. Validity grants no restore permission or source authority.
 */
export function validateVoiceAttachmentRestoreLedger(ledger) { ledgerBody(ledger); }
/** Existing Core maintenance writer only, captured while its original owner has
 * quiesced dispatch. No DB connection, queue, execution or authorization minted.
 * Absent/older/partial Core132 schema refuses; migrate before capture/merge.
 */
export function captureVoiceAttachmentRestoreLedger(db) {
 schemaRequired(db);
 // Aggregate bytes before reading rows: avoid materializing an unbounded table.
 const stat=db.prepare(`SELECT count(*) AS n,coalesce(sum(length(CAST(scope_hash AS BLOB))+length(CAST(request_id AS BLOB))
  +length(CAST(kind AS BLOB))+length(CAST(scope_json AS BLOB))+length(CAST(input_hash AS BLOB))
  +length(CAST(original_message_id AS BLOB))+length(CAST(state AS BLOB))
  +coalesce(length(CAST(ack_kind AS BLOB)),0)+coalesce(length(CAST(ack_hash AS BLOB)),0)+256),0) AS bytes FROM ${TABLE}`).get();
 if(!Number.isSafeInteger(stat.n)||stat.n<0||stat.n>VOICE_ATTACHMENT_RESTORE_LIMITS.rows
  ||!Number.isSafeInteger(stat.bytes)||stat.bytes<0||stat.bytes>VOICE_ATTACHMENT_RESTORE_LIMITS.bytes)fail('VOICE_ATTACHMENT_RESTORE_CAPACITY');
 const rows=db.prepare(`SELECT ${columns.join(',')} FROM ${TABLE} LIMIT ?`).all(VOICE_ATTACHMENT_RESTORE_LIMITS.rows+1);
 const value=body(rows.sort(order));return {...value,sha256:hash(JSON.stringify(value))};
}
function unionRow(a,b) {
 if(['scope_hash','request_id','kind','scope_json','input_hash','original_message_id','created_at'].some(column=>a[column]!==b[column]))fail('VOICE_ATTACHMENT_RESTORE_CONFLICT');
 if(a.state!=='intent'&&b.state!=='intent'&&(a.state!==b.state||a.ack_kind!==b.ack_kind||a.ack_hash!==b.ack_hash))fail('VOICE_ATTACHMENT_RESTORE_CONFLICT');
 const chosen=a.state==='intent'?b:a;
 return {...chosen,updated_at:Math.max(a.updated_at,b.updated_at)};
}
/** SAME restored-Core transaction, before serving/resuming. Union restored and
 * captured originals, seal abandoned intents, never reopen terminal outcomes.
 * The savepoint also prevents partial writes if an enclosing caller catches.
 * Missing legacy capsule or schema fails closed; no fallback empty ledger.
 */
export function mergeVoiceAttachmentRestoreLedger(db,ledger) {
 if(!db.inTransaction)fail('VOICE_ATTACHMENT_RESTORE_TRANSACTION_REQUIRED');
 const incoming=ledgerBody(ledger),restored=captureVoiceAttachmentRestoreLedger(db);
 const old=new Map(restored.entries.map(row=>[key(row),row])),all=new Map(old);
 for(const row of incoming.entries){const previous=all.get(key(row));all.set(key(row),previous?unionRow(previous,row):row);}
 const normalized=[...all.values()].map(row=>row.state==='intent'?{...row,state:'unknown',revision:2}:row).sort(order);
 body(normalized); // Complete union/count/bytes/conflict validation before writes.
 let inserted=0,sealed=0;
 db.exec('SAVEPOINT voice_attachment_restore_merge');
 try{
  const insert=db.prepare(`INSERT INTO ${TABLE}(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`);
  const settle=db.prepare(`UPDATE ${TABLE} SET state=?,ack_kind=?,ack_hash=?,revision=2,updated_at=? WHERE scope_hash=? AND request_id=? AND kind=? AND state='intent' AND revision=1`);
  const timestamp=db.prepare(`UPDATE ${TABLE} SET updated_at=? WHERE scope_hash=? AND request_id=? AND kind=?`);
  for(const row of normalized){
   const previous=old.get(key(row));
   if(!previous){insert.run(...columns.map(column=>row[column]));inserted++;}
   else if(previous.state==='intent'){
    if(settle.run(row.state,row.ack_kind,row.ack_hash,row.updated_at,row.scope_hash,row.request_id,row.kind).changes!==1)fail('VOICE_ATTACHMENT_RESTORE_CONFLICT');
    sealed++;
   }else if(previous.updated_at!==row.updated_at){
    if(timestamp.run(row.updated_at,row.scope_hash,row.request_id,row.kind).changes!==1)fail('VOICE_ATTACHMENT_RESTORE_CONFLICT');
   }
  }
  db.exec('RELEASE voice_attachment_restore_merge');return {preserved:normalized.length,inserted,sealed};
 }catch(error){db.exec('ROLLBACK TO voice_attachment_restore_merge');db.exec('RELEASE voice_attachment_restore_merge');throw error;}
}
