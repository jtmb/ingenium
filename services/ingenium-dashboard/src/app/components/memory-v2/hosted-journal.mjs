import { exact, text, integer, controllerBinding } from './hosted-contract.mjs';
const fail=()=>{throw new Error('Original memory operation journal unavailable; no write allowed');};
const operation=v=>typeof v==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(v);
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
function validateIdentity(identity,binding) {
  if(!exact(identity,['scopeKey','scopeHash','chatId','bindingHash','bindingEpoch'])
    ||identity.scopeHash!==binding.scopeHash||!text(identity.chatId)||!hash(identity.bindingHash)||!integer(identity.bindingEpoch))fail();
  let axes;try{axes=JSON.parse(identity.scopeKey);}catch{fail();}
  if(!Array.isArray(axes)||axes.length!==10||axes[0]!==binding.actorUserId||axes[1]!==binding.organizationId||axes[7]!==binding.scopeHash
    ||axes.slice(0,7).some(v=>!text(v))||!hash(axes[8])||!integer(axes[9])
    ||axes[5]!==identity.chatId||axes[8]!==identity.bindingHash||axes[9]!==identity.bindingEpoch)fail();
}
function policyRecord(v,binding) {
  if(!exact(v,['identity','operationId','change'])||!operation(v.operationId)
    ||!exact(v.change,['target','expectedRevision','values'])||!['host','chat'].includes(v.change.target)||!integer(v.change.expectedRevision))fail();
  validateIdentity(v.identity,binding);
  const fields=v.change.target==='host'?['enabled','generate','useMemory','externalContext']:['useMemory','contribute'];
  if(!exact(v.change.values,['revision',...fields])||v.change.values.revision!==v.change.expectedRevision
    ||fields.some(k=>typeof v.change.values[k]!=='boolean'))fail();
  return v;
}
function managementRecord(v,binding) {
  const fields=v?.action==='forget'?['operationId','scopeHash','origin','action','memoryId','expectedVersion']:['operationId','scopeHash','origin','action','confirmation'];
  if(!exact(v,fields)||!operation(v.operationId)||v.scopeHash!==binding.scopeHash||!['forget','reset'].includes(v.action)
    ||(v.action==='forget'?(!text(v.memoryId)||!integer(v.expectedVersion)||v.expectedVersion<1):!hash(v.confirmation)))fail();
  validateIdentity(v.origin,binding);return v;
}
/** Original metadata only. Separate immutable per-operation keys cannot overwrite
 * another tab's unknown result. Outstanding records refuse further writes;
 * multiple originals are reconciled one at a time, never overwritten.
 * Storage is persistence, never scope/permission authority. */
export function createHostedJournal(storage,binding) {
  if(!storage||!['getItem','setItem','removeItem','key'].every(k=>typeof storage[k]==='function'))fail();
  const prefix='veyra.memory.hosted.v1:'+JSON.stringify([binding.actorUserId,binding.organizationId,binding.scopeHash])+':';
  const validate=envelope=>{
    if(!exact(envelope,['version','kind','record'])||envelope.version!==1||!['policy','management'].includes(envelope.kind))fail();
    (envelope.kind==='policy'?policyRecord:managementRecord)(envelope.record,binding);
    return envelope;
  };
  function readAll() {
    if(!integer(storage.length)||storage.length>10000)fail();
    const rows=[];
    for(let i=0;i<storage.length;i++) {
      const key=storage.key(i);if(typeof key!=='string'||!key.startsWith(prefix))continue;
      const raw=storage.getItem(key);if(typeof raw!=='string'||raw.length>8192)fail();
      let v;try{v=validate(JSON.parse(raw));}catch{fail();}
      if(key!==prefix+v.record.operationId||rows.length>=32)fail();rows.push(v);
    }
    return rows;
  }
  const ordered=()=>readAll().sort((a,b)=>a.record.operationId.localeCompare(b.record.operationId));
  function put(kind,record) {
    const envelope=validate({version:1,kind,record}), raw=JSON.stringify(envelope);
    if(raw.length>8192)fail();
    const rows=readAll();if(rows.some(r=>r.record.operationId!==record.operationId))fail();
    const key=prefix+record.operationId,old=storage.getItem(key);
    if(old!==null&&old!==raw)fail();
    storage.setItem(key,raw);
    if(storage.getItem(key)!==raw)fail();
    // A racing operation remains separately retained; never overwrite it.
    if(readAll().length!==1)fail();
  }
  function remove(kind,id) {
    if(!operation(id))fail();const key=prefix+id,raw=storage.getItem(key);
    if(raw===null)fail();const saved=validate(JSON.parse(raw));
    if(saved.kind!==kind||saved.record.operationId!==id)fail();
    storage.removeItem(key);if(storage.getItem(key)!==null)fail();
  }
  const scope=key=>{if(key!==binding.scopeHash)fail();};
  return Object.freeze({
    policy:{
      get(key){scope(key);const rows=ordered();if(rows.some(v=>v.kind==='management'))fail();return rows[0]?.record;},
      set(key,record){scope(key);if(JSON.stringify(record.identity)!==JSON.stringify(controllerBinding(binding)))fail();put('policy',record);},
      remove(key,id){scope(key);remove('policy',id);},
    },
    management:{
      get(){return ordered().find(v=>v.kind==='management')?.record??null;},
      set(record){if(JSON.stringify(record.origin)!==JSON.stringify(controllerBinding(binding)))fail();put('management',record);},remove(id){remove('management',id);},
    },
  });
}
