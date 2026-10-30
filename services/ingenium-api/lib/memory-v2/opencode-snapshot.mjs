import {createHash} from 'node:crypto';
import {MemoryError,scopeKey} from './lifecycle.mjs';
import {createCompletedMemorySnapshot,COMPLETED_SNAPSHOT_LIMITS} from './bounded-snapshot.mjs';
const hash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const axes=['organizationId','ownerUserId','projectId','workspaceId','hostId','environmentId','bindingHash','bindingEpoch','visibility'];
const sameScope=(a,b)=>axes.every(key=>a?.[key]===b?.[key]);
const id=value=>typeof value==='string'&&value.length>0&&value.length<=512;
const time=value=>Number.isSafeInteger(value)&&value>=0;
const fail=code=>{throw new MemoryError(code);};
const unavailable=()=>fail('MEMORY_ENGINE_SOURCE_UNAVAILABLE');
function message(envelope,chatId) {
  if(!envelope||!id(envelope.info?.id)||envelope.info.sessionID!==chatId||!['user','assistant'].includes(envelope.info.role)
    ||!time(envelope.info.time?.created)||!Array.isArray(envelope.parts)
    ||Buffer.byteLength(JSON.stringify(envelope),'utf8')>COMPLETED_SNAPSHOT_LIMITS.maxRecordBytes) return null;
  if(envelope.parts.some(part=>!part||part.sessionID!==chatId||part.messageID!==envelope.info.id
    ||!['text','reasoning','step-start','step-finish','tool','file'].includes(part.type)))return null;
  if(envelope.parts.some(part=>part.type==='text'&&typeof part.text!=='string'))return null;
  const content=envelope.parts.filter(part=>part.type==='text').map(part=>part.text).join('\n\n');
  if(!content.length)return null;
  return {id:envelope.info.id,role:envelope.info.role,content,revision:hash(envelope),createdAt:envelope.info.time.created};
}
function terminal(envelope) {
 return envelope.info.role==='assistant'&&envelope.info.finish==='stop'&&envelope.info.error==null
  &&time(envelope.info.time?.completed)&&envelope.info.time.completed>=envelope.info.time.created
  &&!envelope.parts.some(part=>part.type==='tool'&&!['completed'].includes(part.state?.status));
}
function sessionIdentity(session,chatId,directory) {
 if(!session||session.id!==chatId||session.directory!==directory||session.path!==directory||!id(session.projectID)
   ||!time(session.time?.created)||!time(session.time?.updated)||session.time.updated<session.time.created)unavailable();
 return JSON.stringify([session.id,session.projectID,session.directory,session.time.created]);
}

/** Actual transport is supplied by opencode-snapshot.ts; the pure core makes
 * no HTTP calls, credential parsing, sender, scheduler or durable transcript.
 */
export function createOpenCodeSnapshotReader({scope,execution,chatId,minRolloutIdleHours,getOwner,transport,mapContext,externalContext,clock=Date.now}) {
 scopeKey(scope);
 if(!id(chatId)||!Number.isInteger(minRolloutIdleHours)||minRolloutIdleHours<1||minRolloutIdleHours>48||typeof getOwner!=='function'||typeof mapContext!=='function'||typeof externalContext!=='function'
   ||!transport||!['getSession','getMessages','getSessionMessage'].every(key=>typeof transport[key]==='function'))fail('INVALID_ADAPTER');
 let owner=null,identity=null,selected=null,snapshot=null,sourceRefs=null,external=null,ready=false,gate=false,busy=false,attempted=false,prepared=false,verificationEpoch=0;
 const selectedEnvelopes=new Map(),verified=new Map();
 const invalidate=()=>{verificationEpoch++;ready=false;verified.clear();};
 function validOwner(value) {
  if(!value||!sameScope(value.scope,scope)||value.execution?.runtimeId!==execution.runtimeId
    ||value.execution?.mode!==execution.mode||!sameScope({...value.execution,visibility:'private'},scope)
    ||!id(value.ownerInstanceId)||!id(value.directory)||value.execution.available!==true||value.execution.status!=='authorized')fail('MEMORY_ENGINE_OWNER_UNAVAILABLE');
  return value;
 }
 const ownerKey=value=>JSON.stringify([axes.map(key=>value.scope[key]),value.execution.runtimeId,value.execution.mode,value.ownerInstanceId,value.directory,[value.target?.baseUrl,value.target?.directory,value.target?.authHeader,value.target?.password]]);
 async function currentOwner() {
  const value=validOwner(await getOwner());
  if(owner&&ownerKey(value)!==ownerKey(owner))fail('MEMORY_ENGINE_OWNER_CHANGED');
  return value;
 }
 async function read(method,...args) {
  const value=await currentOwner();const result=await transport[method](value,...args);
  await currentOwner(); if(!result||Object.hasOwn(result,'error'))unavailable();return result;
 }
 function canonical(pair,envelopes) {
  const user=message(envelopes[0],chatId),assistant=message(envelopes[1],chatId);
  if(!user||!assistant||user.role!=='user'||assistant.role!=='assistant'||!terminal(envelopes[1])
    ||user.createdAt>assistant.createdAt||envelopes[1].info.time.completed>clock())unavailable();
  if(envelopes[1].info.parentID!==undefined&&envelopes[1].info.parentID!==user.id)unavailable();
  const completedAtMs=envelopes[1].info.time.completed;
  const result=[user,assistant].map(item=>({id:item.id,revision:item.revision,role:item.role,content:item.content,
    turnId:user.id,terminalAssistantId:assistant.id,completion:'complete',completedAtMs}));
  if(pair&&result.some((item,index)=>JSON.stringify(item)!==JSON.stringify(pair[index])))unavailable();
  return result;
 }
 async function classify(envelopes,phase) {
  const answer=await externalContext({owner:await currentOwner(),chatId,messages:envelopes,phase});await currentOwner();
  if(typeof answer!=='boolean')fail('MEMORY_EXTERNAL_PROVENANCE_UNAVAILABLE');return answer;
 }
 async function prepare() {
  if(busy||attempted)fail('INVALID_ADAPTER');attempted=true;busy=true;invalidate();
  try {
   owner=structuredClone(validOwner(await getOwner()));
   const before=await read('getSession',chatId);identity=sessionIdentity(before,chatId,owner.directory);
   const now=clock();if(!time(now)||before.time.updated>now||now-before.time.updated<minRolloutIdleHours*3_600_000)unavailable();
   const page=await read('getMessages',chatId,32);
   if(!Array.isArray(page)||page.length>32||Buffer.byteLength(JSON.stringify(page),'utf8')>COMPLETED_SNAPSHOT_LIMITS.maxBytes)unavailable();
   const pairs=[];
   for(let index=0;index+1<page.length;index++) {
    const user=message(page[index],chatId),assistant=message(page[index+1],chatId);
    if(user?.role==='user'&&assistant?.role==='assistant'&&terminal(page[index+1])) {
     const pair=canonical(null,[page[index],page[index+1]]);
     if(pair[0].completedAtMs>before.time.updated)unavailable();
     pairs.push(pair);for(const envelope of [page[index],page[index+1]])selectedEnvelopes.set(envelope.info.id,structuredClone(envelope));index++;
    }
   }
   if(!pairs.length)unavailable();selected=pairs.flat();
   const envelopes=[...selectedEnvelopes.values()];external=await classify(envelopes,'prepare');
   const after=await read('getSession',chatId);
   if(sessionIdentity(after,chatId,owner.directory)!==identity||after.time.updated!==before.time.updated)unavailable();
   if(after.revert&&selected.some(item=>item.id===after.revert.messageID))unavailable();
   const captured={scope,runtimeId:execution.runtimeId,chatId,ownerInstanceId:owner.ownerInstanceId,
    watermark:hash([identity,before.time.updated,selected.map(item=>[item.id,item.revision])]),capturedAtMs:now,
    lastActivityAtMs:before.time.updated,externalContextUsed:external,messages:selected};
   snapshot=createCompletedMemorySnapshot({scope,execution,chatId,minRolloutIdleHours,nowMs:now,captureSnapshot:()=>captured,
    readCanonicalMessage:({messageId})=>gate&&ready?verified.get(messageId)??null:null});
   sourceRefs=[];
   for(const pair of pairs) {
    const mapping=mapContext({scope,execution,chatId,user:pair[0],assistant:pair[1]});
    if(!mapping||!id(mapping.conversationId)||!Array.isArray(mapping.sourceRefs)||mapping.sourceRefs.length!==2
      ||mapping.sourceRefs.some((ref,index)=>!id(ref.id)||ref.contentHash!==hash(pair[index].content)))fail('MEMORY_CONTEXT_MAPPING_UNAVAILABLE');
    if(sourceRefs.length&&mapping.conversationId!==sourceRefs[0].conversationId)fail('MEMORY_CONTEXT_MAPPING_UNAVAILABLE');
    sourceRefs.push(...mapping.sourceRefs.map(ref=>Object.freeze({...ref,conversationId:mapping.conversationId})));
   }
   if(new Set(sourceRefs.map(ref=>ref.id)).size!==sourceRefs.length)fail('MEMORY_CONTEXT_MAPPING_UNAVAILABLE');
   // Direct exact-ID verification, not list labels or synthetic step-finish time.
   await refreshMembers();prepared=true;return Object.freeze({snapshot,conversationId:sourceRefs[0].conversationId,
    sourceRefs:Object.freeze(sourceRefs.map(({id,contentHash})=>Object.freeze({id,contentHash}))),ownerInstanceId:owner.ownerInstanceId});
  }catch(error){invalidate();throw error;}finally{busy=false;}
 }
 async function refreshMembers() {
  invalidate();const epoch=verificationEpoch;
  const session=await read('getSession',chatId);
  if(sessionIdentity(session,chatId,owner.directory)!==identity)unavailable();
  if(session.revert&&selected.some(item=>item.id===session.revert.messageID))unavailable();
  const envelopes=[];
  for(let index=0;index<selected.length;index+=2) {
   const pair=[await read('getSessionMessage',chatId,selected[index].id),await read('getSessionMessage',chatId,selected[index+1].id)];
   canonical(selected.slice(index,index+2),pair);envelopes.push(...pair);
   const mapping=mapContext({scope,execution,chatId,user:selected[index],assistant:selected[index+1]});
   if(!mapping||mapping.conversationId!==sourceRefs[0].conversationId
     ||mapping.sourceRefs?.some((ref,offset)=>ref.id!==sourceRefs[index+offset].id||ref.contentHash!==sourceRefs[index+offset].contentHash)
     ||mapping.sourceRefs?.length!==2)fail('MEMORY_CONTEXT_MAPPING_UNAVAILABLE');
  }
  if(await classify(envelopes,'refresh')!==external)fail('MEMORY_EXTERNAL_PROVENANCE_UNAVAILABLE');
  const after=await read('getSession',chatId);if(sessionIdentity(after,chatId,owner.directory)!==identity
    ||after.revert&&selected.some(item=>item.id===after.revert.messageID))unavailable();
  if(epoch!==verificationEpoch)fail('MEMORY_ENGINE_REFRESH_REQUIRED');
  for(const item of selected)verified.set(item.id,Object.freeze({...item,ownerInstanceId:owner.ownerInstanceId,externalContextUsed:external}));
  ready=true;
 }
 async function refresh() {
  if(busy||!prepared||gate)fail('INVALID_ADAPTER');busy=true;
  try{await refreshMembers();return true;}catch(error){invalidate();throw error;}finally{busy=false;}
 }
 function withVerifiedSources(work) {
  if(busy||!ready||gate||typeof work!=='function')fail('MEMORY_ENGINE_REFRESH_REQUIRED');
  gate=true;
  try{const result=work(Object.freeze(selected.map(item=>Object.freeze({...item}))));if(result&&typeof result.then==='function')fail('INVALID_ADAPTER');return result;}
  finally{gate=false;invalidate();}
 }
 return Object.freeze({prepare,refresh,withVerifiedSources,invalidate});
}
