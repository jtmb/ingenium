import {MemoryError,scopeKey} from './lifecycle.mjs';
import {resolveContextPairCandidate} from './opencode-context-pair.mjs';
import {normalizedMemoryMessage,isCanonicalMemoryTerminal,canonicalMemorySessionIdentity} from './opencode-snapshot.mjs';
const views=new WeakMap();
const axes=['organizationId','ownerUserId','projectId','workspaceId','hostId','environmentId','bindingHash','bindingEpoch','visibility'];
const same=(a,b)=>axes.every(key=>a?.[key]===b?.[key]);
const fail=code=>{throw new MemoryError(code);};
const refKey=(chatId,ref)=>JSON.stringify([chatId,ref.id,ref.contentHash]);
const pairKey=(chatId,pair)=>JSON.stringify([chatId,pair.user.id,pair.assistant.id]);
const ownerKey=owner=>JSON.stringify([axes.map(key=>owner.scope[key]),owner.execution.runtimeId,owner.execution.mode,owner.ownerInstanceId,owner.directory,
 [owner.target?.baseUrl,owner.target?.directory,owner.target?.authHeader,owner.target?.password]]);
const candidateKey=pair=>JSON.stringify([pair.conversationId,pair.sourceRefs,pair.user,pair.assistant]);
export const RECALL_SOURCE_LIMITS=Object.freeze({maxSources:32,maxMembers:32,maxChats:16,maxBytes:8*1024*1024,maxRecordBytes:1024*1024});

/** Read availability only. No capture idle policy, generation grant or old engine
 * version is inferred from stored provenance/Context. Actual ports read the engine.
 */
export function createRecallSourceReader({scope,execution,getOwner,transport,getDb,verifyPair}) {
 scopeKey(scope);scope=Object.freeze({...scope});execution=Object.freeze({...execution});
 if(typeof getOwner!=='function'||typeof getDb!=='function'||!transport
   ||!['getSession','getMessages','getSessionMessage'].every(key=>typeof transport[key]==='function'))fail('INVALID_ADAPTER');
 const view=Object.freeze({version:'verified-recall-source-v1'});
 let gate=false,ready=false,busy=false,epoch=0;const verified=new Map();
 const invalidate=()=>{epoch++;ready=false;verified.clear();};
 views.set(view,{scope,execution,verified,isOpen:()=>gate&&ready});
 async function prime(sourceRefs) {
  if(busy||gate||!Array.isArray(sourceRefs)||sourceRefs.length>32)fail('INVALID_ADAPTER');
  busy=true;invalidate();const capturedEpoch=epoch,unavailable=[];let bytes=0,members=0;
  const owners=new Map(),sessions=new Map(),pages=new Map(),pairs=new Map(),messages=new Map();
  const validRef=ref=>ref&&typeof ref.id==='string'&&ref.id.length>0&&ref.id.length<=256&&typeof ref.chatId==='string'&&ref.chatId.length>0&&ref.chatId.length<=256
    &&typeof ref.contentHash==='string'&&/^[a-f0-9]{64}$/.test(ref.contentHash);
  if(sourceRefs.some(ref=>!validRef(ref))){busy=false;fail('INVALID_INPUT');}
  async function currentOwner(chatId) {
   const owner=await getOwner({scope,execution,chatId});
   if(!owner||!same(owner.scope,scope)||owner.execution?.runtimeId!==execution.runtimeId||owner.execution?.mode!==execution.mode
     ||!same({...owner.execution,visibility:'private'},scope)||owner.execution.available!==true||owner.execution.status!=='authorized'
     ||typeof owner.ownerInstanceId!=='string'||!owner.ownerInstanceId||!owner.directory)fail('MEMORY_ENGINE_OWNER_UNAVAILABLE');
   const previous=owners.get(chatId);if(previous&&ownerKey(previous)!==ownerKey(owner))fail('MEMORY_ENGINE_OWNER_CHANGED');
   if(!previous){if(owners.size>=16)fail('MEMORY_SOURCE_READ_BUDGET');owners.set(chatId,structuredClone(owner));}
   return owner;
  }
  function accept(message) {
   const size=Buffer.byteLength(JSON.stringify(message),'utf8');bytes+=size;
   if(size>RECALL_SOURCE_LIMITS.maxRecordBytes||bytes>RECALL_SOURCE_LIMITS.maxBytes)fail('MEMORY_SOURCE_READ_BUDGET');return message;
  }
  async function read(chatId,method,...args) {
   const owner=await currentOwner(chatId),result=await transport[method](owner,chatId,...args);await currentOwner(chatId);
   if(!result||Object.hasOwn(result,'error'))fail('MEMORY_ENGINE_SOURCE_UNAVAILABLE');return result;
  }
  async function getSession(chatId) {
   const session=await read(chatId,'getSession');
   const identity=canonicalMemorySessionIdentity(session,chatId,owners.get(chatId).directory);
   if(sessions.has(chatId)&&sessions.get(chatId)!==identity)fail('MEMORY_ENGINE_OWNER_CHANGED');sessions.set(chatId,identity);return session;
  }
  async function getMessage(chatId,id) {
   const key=JSON.stringify([chatId,id]);if(messages.has(key))return messages.get(key);
   if(members>=32)fail('MEMORY_SOURCE_READ_BUDGET');members++;
   const result=accept(await read(chatId,'getSessionMessage',id));messages.set(key,result);return result;
  }
  async function relation(chatId,pair,envelopes,normalized) {
   const [user,assistant]=envelopes;
   if(assistant.info.parentID!==undefined){if(assistant.info.parentID!==user.info.id)fail('MEMORY_ENGINE_PAIR_RELATION_UNAVAILABLE');return;}
   if(verifyPair) {
    const proof=await verifyPair({owner:await currentOwner(chatId),chatId,user,assistant});await currentOwner(chatId);
    if(proof?.ownerInstanceId===owners.get(chatId).ownerInstanceId&&proof.chatId===chatId&&proof.userId===pair.user.id&&proof.assistantId===pair.assistant.id)return;
   }
   if(!pages.has(chatId)) {
    const page=await read(chatId,'getMessages',32);
    if(!Array.isArray(page)||page.length>32)fail('MEMORY_SOURCE_READ_BUDGET');page.forEach(accept);pages.set(chatId,page);
   }
   const page=pages.get(chatId);
   let userAt=page.findIndex(item=>item.info?.id===pair.user.id),assistantAt=userAt+1;
   if(scope.projectId===null){
    // The original workspace writer retains the preceding actual user when an
    // assistant continues a turn. Recheck that same relation in the actual
    // bounded engine page; this does not assert causal execution retirement.
    assistantAt=page.findIndex(item=>item.info?.id===pair.assistant.id);userAt=-1;
    for(let i=assistantAt-1;i>=0;i--)if(page[i].info?.role==='user'){userAt=i;break;}
   }
   const u=userAt>=0?normalizedMemoryMessage(page[userAt],chatId):null,a=assistantAt>=0&&assistantAt<page.length?normalizedMemoryMessage(page[assistantAt],chatId):null;
   if(!u||!a||u.id!==pair.user.id||u.revision!==normalized[0].revision||a.revision!==normalized[1].revision||a.id!==pair.assistant.id)fail('MEMORY_ENGINE_PAIR_RELATION_UNAVAILABLE');
  }
  try {
   for(const ref of sourceRefs) {
    try {
     const pair=resolveContextPairCandidate(getDb(),{scope,execution,chatId:ref.chatId,sourceRef:ref});
     if(!pair)fail('MEMORY_CONTEXT_MAPPING_UNAVAILABLE');
     const key=pairKey(ref.chatId,pair);
     if(!pairs.has(key)) {
      const session=await getSession(ref.chatId);
      if(session.revert&&[pair.user.id,pair.assistant.id].includes(session.revert.messageID))fail('MEMORY_ENGINE_SOURCE_UNAVAILABLE');
      const envelopes=[await getMessage(ref.chatId,pair.user.id),await getMessage(ref.chatId,pair.assistant.id)];
      const normalized=envelopes.map(item=>normalizedMemoryMessage(item,ref.chatId));
      if(!normalized[0]||!normalized[1]||normalized[0].role!=='user'||normalized[1].role!=='assistant'
        ||normalized[0].id!==pair.user.id||normalized[1].id!==pair.assistant.id||normalized[0].content!==pair.user.content||normalized[1].content!==pair.assistant.content
        ||normalized[0].createdAt>normalized[1].createdAt||!isCanonicalMemoryTerminal(envelopes[1]))fail('MEMORY_ENGINE_SOURCE_UNAVAILABLE');
      await relation(ref.chatId,pair,envelopes,normalized);
      const after=await getSession(ref.chatId);if(after.revert&&[pair.user.id,pair.assistant.id].includes(after.revert.messageID))fail('MEMORY_ENGINE_SOURCE_UNAVAILABLE');
      pairs.set(key,{signature:candidateKey(pair),ownerInstanceId:owners.get(ref.chatId).ownerInstanceId});
     }
     const proof=pairs.get(key);if(proof.signature!==candidateKey(pair))fail('MEMORY_CONTEXT_MAPPING_UNAVAILABLE');
     verified.set(refKey(ref.chatId,ref),{...proof,chatId:ref.chatId,ref:{...ref}});
    }catch(error){
     if(!(error instanceof MemoryError))throw error;
     unavailable.push({id:ref.id,chatId:ref.chatId,reason:error.code});
    }
   }
   // Recheck every participating source owner after all awaited reads.
   for(const chatId of owners.keys()) {
    try{await currentOwner(chatId);}catch(error){
     if(!(error instanceof MemoryError))throw error;
     for(const [key,proof]of verified)if(proof.chatId===chatId){verified.delete(key);unavailable.push({id:proof.ref.id,chatId,reason:error.code});}
    }
   }
   if(capturedEpoch!==epoch)fail('MEMORY_ENGINE_REFRESH_REQUIRED');ready=true;
   return {verifiedSources:verified.size,unavailableSources:unavailable,memberReads:members,chatReads:owners.size,acceptedBytes:bytes};
  }catch(error){invalidate();throw error;}finally{busy=false;}
 }
 function withVerifiedSources(work) {
  if(busy||gate||!ready||typeof work!=='function')fail('MEMORY_ENGINE_REFRESH_REQUIRED');gate=true;
  try{const result=work();if(result&&typeof result.then==='function')fail('INVALID_ADAPTER');return result;}
  finally{gate=false;invalidate();}
 }
 return Object.freeze({view,prime,withVerifiedSources,invalidate});
}

export function readVerifiedRecallSource(view,{db,scope,execution,chatId,messageId,contentHash}) {
 const saved=views.get(view);
 if(!saved||!saved.isOpen()||!same(saved.scope,scope)||saved.execution.runtimeId!==execution.runtimeId||saved.execution.mode!==execution.mode)return null;
 const proof=saved.verified.get(refKey(chatId,{id:messageId,contentHash}));if(!proof)return null;
 const pair=resolveContextPairCandidate(db,{scope,execution,chatId,sourceRef:{id:messageId,contentHash}});
 if(!pair||candidateKey(pair)!==proof.signature)return null;
 const excluded=!!db.prepare(`SELECT 1 FROM veyra_memory_suppression WHERE scope_key=? AND
  ((kind='source' AND target IN (?,?)) OR (kind='content' AND target IN (?,?))) LIMIT 1`)
  .get(scopeKey(scope),pair.sourceRefs[0].id,pair.sourceRefs[1].id,pair.sourceRefs[0].contentHash,pair.sourceRefs[1].contentHash);
 return {active:false,excluded,uncertain:false,idleEligible:false};
}
