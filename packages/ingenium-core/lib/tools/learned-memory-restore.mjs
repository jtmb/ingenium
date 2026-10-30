import { createHash } from 'node:crypto';

const MAX_ROWS = 100000, MAX_BYTES = 8 * 1024 * 1024;
const tables = ['veyra_memory_policy','veyra_memory_chat_policy','veyra_memory_recall','veyra_memory_suppression','veyra_memory_receipt','veyra_memory_extraction'];
const hash = value => createHash('sha256').update(value).digest('hex');
const fail = () => { throw new Error('Invalid learned-memory restore suppression ledger'); };
const text = (value, max = 8192) => typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= max && !/[\u0000-\u001f\u007f]/u.test(value);
const exact = (row, keys) => row && !Array.isArray(row) && Object.keys(row).sort().join('|') === [...keys].sort().join('|');
function schemaAvailable(db) {
  const present = tables.filter(name => db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
  if (present.length && present.length !== tables.length) fail();
  return present.length === tables.length;
}
function validate(body) {
  if (!exact(body,['version','entries','receipts']) || body.version !== 1
    || !Array.isArray(body.entries) || !Array.isArray(body.receipts)
    || body.entries.length > MAX_ROWS || body.receipts.length > MAX_ROWS
    || Buffer.byteLength(JSON.stringify(body)) > MAX_BYTES) fail();
  const originals = new Set(), suppressions = new Set();
  for (const row of body.entries) {
    if (!exact(row,['scope_key','kind','target','receipt_id']) || !text(row.scope_key)
      || !['memory','source','content'].includes(row.kind) || !text(row.target,512) || !text(row.receipt_id,128)) fail();
    const key=JSON.stringify([row.scope_key,row.kind,row.target]);if(suppressions.has(key))fail();suppressions.add(key);
  }
  for (const row of body.receipts) {
    if (!exact(row,['scope_key','operation_id','request_hash','receipt_json']) || !text(row.scope_key)
      || !text(row.operation_id,128) || !/^[a-f0-9]{64}$/u.test(row.request_hash) || !text(row.receipt_json,4096)) fail();
    const value=JSON.parse(row.receipt_json), allowed=['schemaVersion','receiptId','operationId','status','operation','committedAt','scopeHash','memoryId','version','forgottenCount'];
    if (Object.keys(value).some(key=>!allowed.includes(key)) || value.schemaVersion!==1 || value.status!=='committed'
      || !['forget','reset'].includes(value.operation) || value.scopeHash!==hash(row.scope_key)
      || value.operationId!==row.operation_id || !text(value.receiptId,128) || !text(value.committedAt,128)
      || !Number.isSafeInteger(value.forgottenCount) || value.forgottenCount<0
      || (value.operation==='forget' && (!text(value.memoryId,512)||!Number.isSafeInteger(value.version)||value.version<1))) fail();
    const key=JSON.stringify([row.scope_key,row.operation_id]);if(originals.has(key))fail();originals.add(key);
  }
  return body;
}

/** Metadata only, captured by the existing quiesced maintenance owner. No new
 * connection, authorization principal, writer, transcript or background work. */
export function captureLearnedMemorySuppressions(db) {
  const available=schemaAvailable(db);
  const body=validate({version:1,
    entries:available?db.prepare('SELECT scope_key,kind,target,receipt_id FROM veyra_memory_suppression ORDER BY scope_key,kind,target LIMIT ?').all(MAX_ROWS+1):[],
    receipts:available?db.prepare("SELECT scope_key,operation_id,request_hash,receipt_json FROM veyra_memory_receipt WHERE json_extract(receipt_json,'$.operation') IN ('forget','reset') ORDER BY scope_key,operation_id LIMIT ?").all(MAX_ROWS+1):[],
  });
  return {...body,sha256:hash(JSON.stringify(body))};
}

/** Called inside the existing restored-Core transaction before it can serve.
 * Current suppressions are unioned with restored ones; immutable originals are
 * never deleted/replaced. The capsule contains no learned content/provenance. */
export function mergeLearnedMemorySuppressions(db,ledger) {
  if (!db.inTransaction || !exact(ledger,['version','entries','receipts','sha256'])) fail();
  const body=validate({version:ledger.version,entries:ledger.entries,receipts:ledger.receipts});
  if (ledger.sha256!==hash(JSON.stringify(body))) fail();
  if (!schemaAvailable(db)) { if(body.entries.length||body.receipts.length)fail();return {erased:0}; }
  for (const row of body.receipts) {
    const old=db.prepare('SELECT request_hash,receipt_json FROM veyra_memory_receipt WHERE scope_key=? AND operation_id=?').get(row.scope_key,row.operation_id);
    if (old && (old.request_hash!==row.request_hash || old.receipt_json!==row.receipt_json)) fail();
    db.prepare('INSERT INTO veyra_memory_receipt VALUES (?,?,?,?) ON CONFLICT(scope_key,operation_id) DO NOTHING').run(row.scope_key,row.operation_id,row.request_hash,row.receipt_json);
  }
  for (const row of body.entries) db.prepare('INSERT INTO veyra_memory_suppression VALUES (?,?,?,?) ON CONFLICT(scope_key,kind,target) DO NOTHING').run(row.scope_key,row.kind,row.target,row.receipt_id);
  const matches=`s.scope_key=r.scope_key AND ((s.kind='memory' AND s.target=r.id)
    OR (s.kind='content' AND s.target=r.content_hash)
    OR (s.kind='source' AND EXISTS(SELECT 1 FROM json_each(r.provenance_json,'$.sources') j WHERE json_extract(j.value,'$.id')=s.target)))`;
  const selected=`SELECT s.receipt_id FROM veyra_memory_suppression s WHERE ${matches} ORDER BY s.kind,s.target LIMIT 1`;
  for (const [kind,target] of [['memory','r.id'],['content','r.content_hash']]) {
    db.prepare(`INSERT INTO veyra_memory_suppression SELECT r.scope_key,?,${target},(${selected}) FROM veyra_memory_recall r
      WHERE r.state='active' AND EXISTS(SELECT 1 FROM veyra_memory_suppression s WHERE ${matches})
      ON CONFLICT(scope_key,kind,target) DO NOTHING`).run(kind);
  }
  const result=db.prepare(`UPDATE veyra_memory_recall AS r SET content='',provenance_json='[]',state='forgotten',version=version+1,updated_at=?
    WHERE r.state='active' AND EXISTS(SELECT 1 FROM veyra_memory_suppression s WHERE ${matches})`).run(new Date().toISOString());
  return {erased:result.changes};
}
