import { createHash } from 'node:crypto';
const fail = code => { throw Object.assign(new Error(code), { code }); };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value);
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const keys = ['actorId','accountId','organizationId','projectId','conversationId','runtimeId','executionBindingId','executionRevision','agentId'];
function identity(input) {
  if (!input || Object.keys(input).sort().join()!=='inputHash,kind,originalMessageId,requestId,scope' || !['message','cancel-agent'].includes(input.kind) || !text(input.requestId) || !hex(input.inputHash)
    || !text(input.originalMessageId) || input.originalMessageId.length > 128 || !input.scope
    || Object.keys(input.scope).sort().join() !== [...keys].sort().join()
    || keys.some(k => !text(input.scope[k]) && !(['organizationId','projectId'].includes(k) && input.scope[k] === null))) fail('CALL_DELIVERY_IDENTITY_INVALID');
  const scopeJson = JSON.stringify(Object.fromEntries(keys.map(k => [k,input.scope[k]])));
  return Object.freeze({ ...input, scope:Object.freeze({...input.scope}), scopeJson, scopeHash: sha(scopeJson) });
}
/** Metadata-only receipts on Root's SAME Core writer. db()/assertContext are
 * fixed private Core/API constructors, never request-body ports or a new DB.
 * No execution queue, transcript, audio, model lease or retirement proof exists.
 */
export function createAttachmentDeliveryOwner({ db, assertContext, now = Date.now }) {
  if(typeof db!=='function'||typeof assertContext!=='function'||typeof now!=='function')fail('CALL_CORE_WRITER_REQUIRED');
  const originals = new WeakMap();
  const authorize=(context,scope,action)=>{if(assertContext(context,scope,action)!==undefined)fail('CALL_CONTEXT_ASSERTION_MUST_BE_SYNCHRONOUS_VOID');};
  const readRow = (database, i) => database.prepare('SELECT * FROM veyra_voice_attachment_deliveries WHERE scope_hash=? AND request_id=? AND kind=?').get(i.scopeHash,i.requestId,i.kind);
  function matching(row,i) { if (!row || row.scope_json !== i.scopeJson || row.input_hash !== i.inputHash || row.original_message_id !== i.originalMessageId) fail('CALL_DELIVERY_ORIGINAL_CONFLICT'); }
  const metadata = row => Object.freeze({ requestId: row.request_id, originalMessageId: row.original_message_id,
    state: row.state === 'ack' ? row.ack_kind : 'unknown', dispatchPending: row.state === 'intent', executionCompleted: false, agentSettlementProof: false });
  function retained(handle) { const value=originals.get(handle); if(!value)fail('CALL_DELIVERY_ORIGINAL_REQUIRED'); return value; }
  return Object.freeze({
    reserve(context,input) {
      const i=identity(input); authorize(context,i.scope,i.kind);
      const database=db(), row=database.transaction(() => {
        const previous=readRow(database,i); if(previous){matching(previous,i);return {fresh:false,row:previous};}
        if(database.prepare('SELECT count(*) AS n FROM veyra_voice_attachment_deliveries WHERE scope_hash=?').get(i.scopeHash).n>=4096)fail('CALL_DELIVERY_CAPACITY');
        const at=now(); if(!Number.isSafeInteger(at))fail('CALL_DELIVERY_CLOCK');
        database.prepare('INSERT INTO veyra_voice_attachment_deliveries(scope_hash,request_id,kind,scope_json,input_hash,original_message_id,state,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,\'intent\',1,?,?)')
          .run(i.scopeHash,i.requestId,i.kind,i.scopeJson,i.inputHash,i.originalMessageId,at,at);
        return {fresh:true,row:readRow(database,i)};
      })();
      if(!row.fresh)return {fresh:false,receipt:metadata(row.row)}; // Never replay, even an abandoned intent.
      const handle=Object.freeze({}); originals.set(handle,{database,i,context,completed:false,spent:false});
      return {fresh:true,handle,receipt:metadata(row.row)};
    },
    /** Must precede the one actual canonical message/control dispatch. A stale
     * caller cannot get a new attempt from a row or a copied receipt. */
    claim(handle) {
      const original=retained(handle); if(original.spent||original.completed||db()!==original.database)fail('CALL_DELIVERY_SPENT');
      authorize(original.context,original.i.scope,original.i.kind);
      const row=readRow(original.database,original.i);matching(row,original.i);
      if(row.state!=='intent'||row.revision!==1)fail('CALL_DELIVERY_SPENT');original.spent=true;
    },
    acknowledge(handle,ack) {
      const original=retained(handle); if(!original.spent||original.completed||db()!==original.database)fail('CALL_DELIVERY_SPENT');
      const {i,database}=original;
      if(!ack||ack.originalMessageId!==i.originalMessageId||ack.sessionId!==i.scope.conversationId
        || !(i.kind==='message'?['delivered','rejected']:['pending','rejected']).includes(ack.state))fail('CALL_DELIVERY_ACK_INVALID');
      const ackHash=sha(JSON.stringify([i.scopeHash,i.requestId,i.kind,ack.originalMessageId,ack.sessionId,ack.state]));
      const result=database.prepare('UPDATE veyra_voice_attachment_deliveries SET state=\'ack\',ack_kind=?,ack_hash=?,revision=2,updated_at=? WHERE scope_hash=? AND request_id=? AND kind=? AND state=\'intent\' AND revision=1')
        .run(ack.state,ackHash,now(),i.scopeHash,i.requestId,i.kind);
      if(result.changes!==1)fail('CALL_DELIVERY_CAS_FAILED');original.completed=true;return metadata(readRow(database,i));
    },
    unknown(handle) {
      const original=retained(handle); if(original.completed||db()!==original.database)fail('CALL_DELIVERY_SPENT');
      const {i,database}=original;
      // Negative original completion remains recordable after user revocation;
      // it authorizes no new external effect and requires the private handle.
      const result=database.prepare('UPDATE veyra_voice_attachment_deliveries SET state=\'unknown\',revision=2,updated_at=? WHERE scope_hash=? AND request_id=? AND kind=? AND state=\'intent\' AND revision=1')
        .run(now(),i.scopeHash,i.requestId,i.kind);
      if(result.changes!==1)fail('CALL_DELIVERY_CAS_FAILED');original.completed=true;return metadata(readRow(database,i));
    },
    read(context,input) {
      const i=identity(input);authorize(context,i.scope,'read');const row=readRow(db(),i);if(!row)return null;matching(row,i);return metadata(row);
    },
  });
}
