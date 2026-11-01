import {createHash} from "node:crypto";
const q=s=>'"'+s.replaceAll('"','""')+'"';
const fail=code=>{throw new Error(code);};
const sha=s=>createHash('sha256').update(s).digest('hex');
export function replaceExactly(sql,from,to) {
 const n=sql.split(from).length-1;if(n!==1)fail(`DDL_PREIMAGE_MISMATCH:${from}:${n}`);
 return sql.replace(from,to);
}
// Split declarations at depth zero while preserving quoted/default/check expression bytes.
function declarations(body) {
 let depth=0,quote=null,line=false,block=false,start=0;const out=[];
 for(let i=0;i<body.length;i++) {
  const c=body[i],n=body[i+1];
  if(line){if(c==='\n')line=false;continue;}
  if(block){if(c==='*'&&n==='/'){block=false;i++;}continue;}
  if(quote){if(c===quote){if(n===quote){i++;continue;}quote=null;}continue;}
  if(c==='-'&&n==='-'){line=true;i++;continue;}
  if(c==='/'&&n==='*'){block=true;i++;continue;}
  if(c==='"'||c==="'"||c==='`'){quote=c;continue;}
  if(c==='['){quote=']';continue;}
  if(c==='(')depth++;else if(c===')'){depth--;if(depth<0)fail('DDL_UNBALANCED');}
  else if(c===','&&depth===0){out.push(body.slice(start,i));start=i+1;}
 }
 if(depth||quote||block)fail('DDL_UNBALANCED');out.push(body.slice(start));return out;
}
export function addColumnsAndConstraints(sql,tail) {
 const first=sql.indexOf('('),last=sql.lastIndexOf(')');if(first<0||last<first)fail('DDL_TABLE_END_MISSING');
 const existing=declarations(sql.slice(first+1,last)),added=declarations(tail);
 const constraint=x=>/^\s*(?:CONSTRAINT\b|PRIMARY\s+KEY\b|FOREIGN\s+KEY\b|UNIQUE\s*\(|CHECK\s*\()/i.test(x);
 const at=existing.findIndex(constraint),split=at<0?existing.length:at;
 if(existing.slice(split).some(x=>!constraint(x)))fail('UNSUPPORTED_TABLE_CONSTRAINT_ORDER');
 return sql.slice(0,first+1)+[...existing.slice(0,split),...added.filter(x=>!constraint(x)),...existing.slice(split),...added.filter(constraint)].join(',')+sql.slice(last);
}
function columns(db,table) {
 const cs=db.prepare(`PRAGMA table_xinfo(${q(table)})`).all();
 if(!cs.length || cs.some(c=>c.hidden!==0))fail(`UNSUPPORTED_GENERATED_OR_MISSING_TABLE:${table}`);
 return cs.map(c=>c.name);
}
/** Storage classes + lossless database text/BLOB payloads; integers never pass through Number. */
export function fingerprint(db,table,projection=columns(db,table)) {
 const ddl=db.prepare("SELECT sql FROM sqlite_schema WHERE type='table' AND name=?").get(table)?.sql??'';
 if(/CREATE\s+VIRTUAL/i.test(ddl))fail(`VIRTUAL_TABLE_FINGERPRINT_UNSUPPORTED:${table}`);
 const rowid=!/\bWITHOUT\s+ROWID\b/i.test(ddl);
 if(rowid && projection.some(c=>['rowid','_rowid_','oid'].includes(c.toLowerCase())))fail('SHADOWED_ROWID');
 const cols=rowid?['_rowid_',...projection]:projection;
 const expr=cols.flatMap(c=>[`typeof(${q(c)})`,`CASE WHEN typeof(${q(c)}) IN ('text','blob') THEN CAST(${q(c)} AS BLOB) ELSE ${q(c)} END`]);
 const ordering=rowid?'_rowid_':projection.map(q).join(',');
 const h=createHash('sha256');let count=0;
 for(const row of db.prepare(`SELECT ${expr.join(',')} FROM ${q(table)} ORDER BY ${ordering}`).raw(true).safeIntegers(true).iterate()) {
  h.update('R');
  for(let i=0;i<row.length;i+=2) {
   const type=row[i],value=row[i+1];let data;
   if(type==='null')data=Buffer.alloc(0);
   else if(type==='integer') {if(typeof value!=='bigint')fail('LOSSY_INTEGER_DRIVER');data=Buffer.from(value.toString());}
   else if(type==='real') {data=Buffer.alloc(8);data.writeDoubleBE(value);}
   else if((type==='text'||type==='blob')&&Buffer.isBuffer(value))data=value;
   else fail(`UNSUPPORTED_STORAGE_CLASS:${type}`);
   h.update(type+':'+data.length+':');h.update(data);
  }count++;
 }
 return {count,sha256:h.digest('hex')};
}
function objects(db) {return db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type,name").all();}
function schemaReceipt(db,names) {
 return Object.fromEntries(objects(db).filter(x=>names.includes(x.name)).map(x=>[x.name,sha(x.sql)]));
}
function verifyReceipt(db,receipt) {
 const actual=schemaReceipt(db,Object.keys(receipt));
 if(JSON.stringify(actual)!==JSON.stringify(receipt))fail('INSTALLED_EVOLUTION_SCHEMA_DRIFT');
}
/**
 * SOURCE ONLY. Root calls this on its original, quiesced connection outside any transaction.
 * No backup creation, connection replacement, writable_schema, data repair or normalization.
 * Capacity/admission and a verified external preservation copy belong to Root before invocation.
 */
export function installEvolution(db,spec) {
 if(db.inTransaction)fail('EVOLUTION_REQUIRES_ORIGINAL_QUIESCED_CONNECTION');
 const marker=`veyra_evolution_${spec.version}`;
 const installed=db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(marker);
 if(installed) {
  const rows=db.prepare(`SELECT version,recipe_sha256,schema_json FROM ${q(marker)}`).all();
  if(rows.length!==1 || rows[0].version!==spec.version || rows[0].recipe_sha256!==spec.recipeSha256)fail('EVOLUTION_RECEIPT_MISMATCH');
  verifyReceipt(db,JSON.parse(rows[0].schema_json));return {installed:false,version:spec.version};
 }
 const fk=db.pragma('foreign_keys',{simple:true}),legacy=db.pragma('legacy_alter_table',{simple:true});
 // Reject existing faults. They are evidence; migration does not repair or hide them.
 if(db.pragma('foreign_key_check').length)fail('PREEXISTING_FOREIGN_KEY_VIOLATIONS');
 const before=objects(db),names=spec.tables.map(t=>t.name);
 const stages=names.map(t=>`__veyra_${spec.version}_${t}`);
 if(stages.some(n=>db.prepare('SELECT 1 FROM sqlite_schema WHERE name=?').get(n)))fail('STAGING_OBJECT_ALREADY_EXISTS');
 const collateral=new Set();
 for(const obj of before.filter(o=>o.type==='table'&&!/^CREATE\s+VIRTUAL/i.test(o.sql))) {
  const links=db.prepare(`PRAGMA foreign_key_list(${q(obj.name)})`).all();
  if(links.some(x=>names.includes(x.table)) || obj.name.startsWith('context_messages_fts_'))collateral.add(obj.name);
 }
 const projections=Object.fromEntries(names.map(n=>[n,columns(db,n)]));
 const protectedNames=[...new Set([...names,...collateral])];
 const dataBefore=Object.fromEntries(protectedNames.map(n=>[n,fingerprint(db,n,projections[n])]));
 const tables=spec.tables.map((s,i)=>{
  const original=before.find(o=>o.type==='table'&&o.name===s.name);if(!original)fail(`TABLE_MISSING:${s.name}`);
  let ddl=original.sql;
  if(/\b(?:AUTOINCREMENT|WITHOUT\s+ROWID)\b|CREATE\s+VIRTUAL/i.test(ddl))fail(`UNSUPPORTED_EVOLUTION_TABLE_LAYOUT:${s.name}`);
  // Only the declaration's first table name changes; every old FK keeps its canonical parent.
  const match=/^(CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?)(?:"[^"]+"|`[^`]+`|\[[^\]]+\]|\w+)/i.exec(ddl);
  if(!match)fail(`UNSUPPORTED_TABLE_DECLARATION:${s.name}`);
  ddl=match[1]+q(stages[i])+ddl.slice(match[0].length);
  return {...s,ddl:s.evolve(ddl),stage:stages[i]};
 });
 let result,problem;
 try {
  db.pragma('foreign_keys = OFF');if(db.pragma('foreign_keys',{simple:true})!==0)fail('FOREIGN_KEYS_NOT_DISABLED_BEFORE_BEGIN');
  db.pragma('legacy_alter_table = ON');
  db.exec('BEGIN IMMEDIATE');
  // Lock now owns the preimage. Recompute to reject a writer between initial observation and BEGIN.
  if(JSON.stringify(objects(db))!==JSON.stringify(before))fail('SCHEMA_CHANGED_BEFORE_LOCK');
  for(const n of protectedNames)if(JSON.stringify(fingerprint(db,n,projections[n]))!==JSON.stringify(dataBefore[n]))fail(`DATA_CHANGED_BEFORE_LOCK:${n}`);
  for(const t of tables) {
   db.exec(t.ddl);
   const cols=projections[t.name].map(q).join(',');
   db.exec(`INSERT INTO ${q(t.stage)}(_rowid_,${cols}) SELECT _rowid_,${cols} FROM ${q(t.name)}`);
  }
  // Views and triggers can refer to other rebuilt tables. Drop inside this rollback boundary,
  // then recreate their exact SQL, applying only individually pinned reviewed replacements.
  for(const o of before.filter(o=>o.type==='view'||o.type==='trigger'))db.exec(`DROP ${o.type.toUpperCase()} ${q(o.name)}`);
  for(const t of tables)db.exec(`DROP TABLE ${q(t.name)}`);
  for(const t of tables)db.exec(`ALTER TABLE ${q(t.stage)} RENAME TO ${q(t.name)}`);
  for(const o of before.filter(o=>o.type==='index'&&names.includes(o.tbl_name)))db.exec(o.sql);
  for(const o of before.filter(o=>o.type==='view'||o.type==='trigger')) {
   const edit=spec.triggerEdits?.[o.name];db.exec(edit?edit(o.sql):o.sql);
  }
  for(const name of Object.keys(spec.triggerEdits??{}))if(!before.some(o=>o.type==='trigger'&&o.name===name))fail(`TRIGGER_PREIMAGE_MISSING:${name}`);
  db.exec(spec.tailSql);
  for(const n of protectedNames)if(JSON.stringify(fingerprint(db,n,projections[n]))!==JSON.stringify(dataBefore[n]))fail(`LOSSLESS_COPY_CHECK_FAILED:${n}`);
  if(db.pragma('foreign_key_check').length)fail('FOREIGN_KEY_CHECK_FAILED');
  const integrity=db.pragma('quick_check');if(integrity.length!==1 || Object.values(integrity[0])[0]!=='ok')fail('QUICK_CHECK_FAILED');
  const changed=new Set([...names,...Object.keys(spec.triggerEdits??{})]);
  const after=objects(db);
  for(const old of before)if(!changed.has(old.name)) {
   const current=after.find(o=>o.name===old.name&&o.type===old.type);
   if(!current || current.sql!==old.sql)fail(`UNEXPECTED_SCHEMA_CHANGE:${old.name}`);
  }
  const owned=after.filter(o=>names.includes(o.tbl_name)||!before.some(b=>b.name===o.name&&b.type===o.type)).map(o=>o.name);
  const receipt=schemaReceipt(db,owned);
  db.exec(`CREATE TABLE ${q(marker)}(version INTEGER PRIMARY KEY,recipe_sha256 TEXT NOT NULL,schema_json TEXT NOT NULL,data_json TEXT NOT NULL) STRICT`);
  db.prepare(`INSERT INTO ${q(marker)} VALUES(?,?,?,?)`).run(spec.version,spec.recipeSha256,JSON.stringify(receipt),JSON.stringify(dataBefore));
  db.exec(`CREATE TRIGGER ${q(marker+'_no_update')} BEFORE UPDATE ON ${q(marker)} BEGIN SELECT RAISE(ABORT,'evolution receipt immutable'); END; CREATE TRIGGER ${q(marker+'_no_delete')} BEFORE DELETE ON ${q(marker)} BEGIN SELECT RAISE(ABORT,'evolution receipt immutable'); END;`);
  db.exec('COMMIT');result={installed:true,version:spec.version,dataBefore,schema:receipt};
 }catch(error) {
  problem=error;
  if(db.inTransaction)try{db.exec('ROLLBACK');}catch(rollback){problem=new AggregateError([error,rollback],'EVOLUTION_ROLLBACK_FAILED');}
 }finally {
  // Restore the original connection state on success AND every error path.
  try {
   if(db.inTransaction)fail('EVOLUTION_TRANSACTION_STILL_ACTIVE');
   db.pragma(`legacy_alter_table = ${legacy?'ON':'OFF'}`);db.pragma(`foreign_keys = ${fk?'ON':'OFF'}`);
   if(db.pragma('foreign_keys',{simple:true})!==fk || db.pragma('legacy_alter_table',{simple:true})!==legacy)fail('CONNECTION_PRAGMA_RESTORE_FAILED');
  }catch(restore){problem=problem?new AggregateError([problem,restore],'EVOLUTION_AND_RESTORE_FAILED'):restore;}
 }
 if(problem)throw problem;return result;
}
