import {randomUUID} from 'node:crypto';
import type {VoiceScope,VoiceOwner,VoiceOriginal,VoiceMetadata,VerifiedVoiceContext,VoiceLedgerPorts} from './voice-operation-ledger.js';
export interface OriginalAssistantSourceClaim {readonly segmentIndex:number;readonly requestId:string}
export interface OriginalAssistantPlanFacts {
 call:object;plan:object;metadata:Record<string,any>;authSessionId:string;backendId:string;startIdentity:string;owner:VoiceOwner;
 segments:readonly {index:number;kind:string;textSha256:string;bytes:number;characters:number}[];
}
export interface OriginalAssistantDispatchFacts {scope:VoiceScope;owner:VoiceOwner;controlOperationId:string;operationId:string;identity:Record<string,any>;textSha256:string;voice:string;requestId:string;segmentIndex:number;sourceClaim:OriginalAssistantSourceClaim;prepared:boolean}
/** Root installs ONLY fixed functions over the ACTUAL API WeakMaps. Never renderer callbacks. */
export interface OriginalAssistantSourceInspectors<C> {
 inspectPlan(context:C,actualPrivatePlan:object):OriginalAssistantPlanFacts;
 inspectDispatch(context:C,actualOpaqueDispatch:object):OriginalAssistantDispatchFacts;
 inspectCallForFence(actualOriginalCall:object):{call:object;callId:string;callInstanceId:string;generation:number};
}
type Row=Record<string,any>;
export interface AssistantSourceInternal<C> {
 get(id:string):Row|undefined;write<T>(fn:()=>T):T;authorize(context:C,scope:VoiceScope|null,action:'reserve'|'transition',live:boolean):VerifiedVoiceContext;
 canonical(v:unknown):string;digest(v:unknown):string;equal(a:unknown,b:unknown):boolean;uuid(v:unknown):v is string;hash(v:unknown):v is string;integer(v:unknown):v is number;validateOriginal(v:unknown):VoiceOriginal;
 reserveAttached(context:C,original:VoiceOriginal,owner:VoiceOwner,claim:OriginalAssistantSourceClaim):{accepted:boolean;fresh:boolean;operation:VoiceMetadata};
}
/** Core metadata only. No text, socket, process, model, queue or physical-retirement authority. */
export function createOriginalAssistantSourceOwner<C>(ports:VoiceLedgerPorts<C>&{originalAssistantSources?:OriginalAssistantSourceInspectors<C>},i:AssistantSourceInternal<C>){
 const claims=new WeakMap<object,{context:C;plan:object;call:object;id:string;segmentIndex:number;closed:boolean;dispatch:object|null}>(),calls=new WeakMap<object,{through:number;closed:boolean}>();
 const operationHandles=new Map<string,{claim:OriginalAssistantSourceClaim;dispatch:object}>();
 const fail=(code='VOICE_ASSISTANT_SOURCE_UNAVAILABLE'):never=>{throw Object.assign(Error(code),{code,status:503});};
 const actual=()=>{const p=ports.originalAssistantSources;if(!p||[p.inspectPlan,p.inspectDispatch,p.inspectCallForFence].some(f=>typeof f!=='function'))return fail('VOICE_ASSISTANT_ORIGINAL_INSPECTORS_UNAVAILABLE');return p;};
 const object=(v:unknown):v is object=>!!v&&typeof v==='object';
 const row=(id:string)=>ports.db().prepare('SELECT * FROM veyra_voice_assistant_sources WHERE claim_id=?').get(id) as Row|undefined;
 function inspected(context:C,plan:object){
  const f=actual().inspectPlan(context,plan),m=f?.metadata;
  if(!f||f.plan!==plan||!object(f.call)||!m||!i.uuid(m.sourceId)||!i.uuid(m.callId)||!i.uuid(m.callInstanceId)||!i.integer(m.callGeneration)||m.turnGeneration!==m.callGeneration||m.policyId!=='verbatim-assistant-text-v1'||m.agentSettlementProof!==false||!i.integer(m.deadlineAt)||m.deadlineAt<=ports.now()||!Array.isArray(m.segments)||m.segments.length>512||!Array.isArray(f.segments)||f.segments.length!==m.segments.length)return fail();
  const local=calls.get(f.call);if(local&&(local.closed||m.callGeneration<=local.through))return fail('VOICE_ASSISTANT_SOURCE_FENCED');
  const verified=i.authorize(context,m.scope,'reserve',true);
  if(verified.authSessionId!==f.authSessionId||verified.userSecurityEpoch!==m.userEpoch||verified.workspaceSecurityEpoch!==m.workspaceEpoch||verified.runtimeSecurityEpoch!==m.runtimeEpoch||!i.equal(verified.owner,f.owner)||!i.hash(f.backendId)||!i.hash(f.startIdentity)||!i.hash(m.profileDigest)||typeof m.voice!=='string'||!m.voice||m.voice.length>64)return fail();
  for(const k of ['sourceHash','planHash','sessionBeforeSha256','responseSha256','sessionAfterSha256','snapshotSha256','rangeSha256','prefixSha256','policyImplementationSha256','segmenterImplementationSha256','rawTextSha256','projectedSha256'])if(!i.hash(m[k]))return fail();
  const {sourceHash,planHash,...base}=m;
  if(i.digest(base)!==sourceHash||i.digest({sourceHash,profileDigest:m.profileDigest,voice:m.voice,policyId:m.policyId,policyImplementationSha256:m.policyImplementationSha256,segmenterImplementationSha256:m.segmenterImplementationSha256,projectedSha256:m.projectedSha256,segments:m.segments})!==planHash)return fail('VOICE_ASSISTANT_PLAN_HASH_CHANGED');
  const control=i.get(m.controlOperationId);
  if(!control||control.kind!=='voice-cpu-supervisor'||control.state!=='running'||control.resource_retired!==0||control.scope_hash!==i.digest(m.scope)||!i.equal(JSON.parse(control.owner_json),f.owner)||JSON.parse(control.control_json).profileDigest!==m.profileDigest||m.controlOwnerHash!==i.digest(f.owner))return fail('VOICE_ASSISTANT_CPU_CONTROL_REQUIRED');
  const runtime=ports.db().prepare('SELECT backend_container_id FROM runtime_instances WHERE id=?').get(m.scope.runtimeId) as Row|undefined;if(runtime?.backend_container_id!==f.backendId)return fail('VOICE_ASSISTANT_BACKEND_CHANGED');
  return {f,m,verified};
 }
 function identity(v:ReturnType<typeof inspected>,index:number){
  const {f,m,verified}=v,segment=m.segments[index],text=f.segments[index];
  if(!segment||!text||segment.index!==index||segment.kind!=='tts'||text.index!==index||text.kind!=='tts'||text.textSha256!==segment.digest||!i.hash(segment.digest)||!Number.isSafeInteger(text.bytes)||text.bytes<1||text.bytes>2400||!Number.isSafeInteger(text.characters)||text.characters<1||text.characters>600||segment.sourceEnd-segment.sourceStart!==text.bytes)return fail('VOICE_ASSISTANT_SEGMENT_INVALID');
  const {segments:_segments,...metadata}=m;return {metadata,segment,textFacts:text,authSessionId:f.authSessionId,backendId:f.backendId,startIdentity:f.startIdentity,owner:f.owner,deadlineAt:Math.min(m.deadlineAt,verified.deadlineAt)};
 }
 function live(context:C,claim:OriginalAssistantSourceClaim){
  const retained=object(claim)&&claims.get(claim);if(!retained||retained.closed)return fail('VOICE_ASSISTANT_CLAIM_ORIGINAL_REQUIRED');
  const stored=row(retained.id);if(!stored||stored.fenced||stored.phase==='unknown')return fail('VOICE_ASSISTANT_SOURCE_FENCED');
  const current=inspected(context,retained.plan);if(current.f.call!==retained.call||i.canonical(identity(current,retained.segmentIndex))!==stored.identity_json)return fail('VOICE_ASSISTANT_ORIGINAL_CHANGED');
  return {retained,stored,current};
 }
 return {
  reserveOriginalAssistantSource(context:C,actualPrivatePlan:object):OriginalAssistantSourceClaim{
   if(!object(actualPrivatePlan))return fail('VOICE_ASSISTANT_PLAN_ORIGINAL_REQUIRED');
   if(operationHandles.size>=4096)return fail('VOICE_ASSISTANT_SOURCE_CAPACITY');
   let retained:ReturnType<typeof inspected>,index=-1,id='',requestId='';
   i.write(()=>{
    retained=inspected(context,actualPrivatePlan);const {f,m}=retained;
    const existing=ports.db().prepare('SELECT segment_index,source_hash,plan_hash FROM veyra_voice_assistant_sources WHERE call_instance_id=? AND source_id=? ORDER BY segment_index LIMIT 513').all(m.callInstanceId,m.sourceId) as Row[];
    if(existing.length>512||existing.some(r=>r.source_hash!==m.sourceHash||r.plan_hash!==m.planHash))return fail('VOICE_ASSISTANT_SOURCE_REUSED');
    const count=ports.db().prepare('SELECT count(*) AS n FROM veyra_voice_assistant_sources WHERE call_instance_id=?').get(m.callInstanceId) as Row;if(Number(count.n)>=4096)return fail('VOICE_ASSISTANT_SOURCE_CAPACITY');
    const used=new Set(existing.map(r=>r.segment_index));index=m.segments.findIndex((s:any,n:number)=>s.kind==='tts'&&!used.has(n));if(index<0)return fail('VOICE_ASSISTANT_SOURCE_EXHAUSTED');
    const value=identity(retained,index),serialized=i.canonical(value);if(Buffer.byteLength(serialized)>16384)return fail('VOICE_ASSISTANT_SOURCE_CAPACITY');
    id=randomUUID();requestId='attached-tts:'+m.sourceId+':'+index;
    ports.db().prepare(`INSERT INTO veyra_voice_assistant_sources(claim_id,source_id,call_id,call_instance_id,call_generation,segment_index,scope_json,scope_hash,owner_json,control_operation_id,source_hash,plan_hash,profile_digest,voice,text_sha256,request_id,identity_json,identity_hash,deadline_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,m.sourceId,m.callId,m.callInstanceId,m.callGeneration,index,i.canonical(m.scope),i.digest(m.scope),i.canonical(f.owner),m.controlOperationId,m.sourceHash,m.planHash,m.profileDigest,m.voice,value.textFacts.textSha256,requestId,serialized,i.digest(value),value.deadlineAt,ports.now());
   });
   const token=Object.freeze({segmentIndex:index,requestId});claims.set(token,{context,plan:actualPrivatePlan,call:retained!.f.call,id,segmentIndex:index,closed:false,dispatch:null});return token;
  },
  assertOriginalAssistantReservation(context:C,claim:OriginalAssistantSourceClaim,original:VoiceOriginal,owner:VoiceOwner){
   const {stored}=live(context,claim);if(stored.phase!=='linked'||stored.cpu_operation_id!==original.operationId||original.kind!=='voice-speech-tts'||original.parentOperationId!==stored.control_operation_id||original.controlOperationId!==stored.control_operation_id||original.turnGeneration!==stored.call_generation||original.requestId!==stored.request_id||i.digest(original.scope)!==stored.scope_hash||i.canonical(owner)!==stored.owner_json||original.cpuIdentity?.kind!=='synthesize'||original.deadlineAt>stored.deadline_at)return fail('VOICE_ASSISTANT_RESERVATION_MISMATCH');
  },
  reserveAttachedAssistantTts(context:C,claim:OriginalAssistantSourceClaim,input:unknown,owner:VoiceOwner){
   const original=i.validateOriginal(input);
   return i.write(()=>{const {stored}=live(context,claim);if(stored.phase!=='reserved'||stored.cpu_operation_id)return fail('VOICE_ASSISTANT_CLAIM_ALREADY_LINKED');
    const changed=ports.db().prepare("UPDATE veyra_voice_assistant_sources SET phase='linked',cpu_operation_id=?,revision=revision+1 WHERE claim_id=? AND phase='reserved' AND fenced=0").run(original.operationId,stored.claim_id);if(Number(changed.changes)!==1)return fail();
    return i.reserveAttached(context,original,owner,claim);
   });
  },
  spendOriginalAssistantSource(context:C,claim:OriginalAssistantSourceClaim,actualOpaqueCpuDispatch:object):void{
   if(operationHandles.size>=4096)return fail('VOICE_ASSISTANT_SOURCE_CAPACITY');
   const {retained}=live(context,claim);if(retained.dispatch||!object(actualOpaqueCpuDispatch))return fail('VOICE_ASSISTANT_DISPATCH_ALREADY_SPENT');
   // Close local issuance BEFORE a commit/ACK can become uncertain; never reopen on error.
   retained.dispatch=actualOpaqueCpuDispatch;
   try{i.write(()=>{const {stored,current}=live(context,claim),d=actual().inspectDispatch(context,actualOpaqueCpuDispatch),cpu=i.get(stored.cpu_operation_id);
    if(stored.phase!=='linked'||!d||d.prepared!==true||d.sourceClaim!==claim||d.segmentIndex!==retained.segmentIndex||d.operationId!==stored.cpu_operation_id||d.controlOperationId!==stored.control_operation_id||d.requestId!==stored.request_id||d.voice!==stored.voice||d.textSha256!==stored.text_sha256||!i.equal(d.scope,current.m.scope)||!i.equal(d.owner,current.f.owner)||!cpu||cpu.state!=='reserved'||cpu.resource_retired||!i.equal(d.identity,JSON.parse(cpu.cpu_identity_json))||JSON.parse(cpu.cpu_json).dispatchClaimed)return fail('VOICE_ASSISTANT_DISPATCH_ORIGINAL_REQUIRED');
    const changed=ports.db().prepare("UPDATE veyra_voice_assistant_sources SET phase='spent',dispatch_id=?,cpu_identity_json=?,spent_at=?,revision=revision+1 WHERE claim_id=? AND phase='linked' AND fenced=0").run(randomUUID(),i.canonical(d.identity),ports.now(),stored.claim_id);if(Number(changed.changes)!==1)return fail();
   });operationHandles.set(row(retained.id)!.cpu_operation_id,{claim,dispatch:actualOpaqueCpuDispatch});}catch(error){
    retained.closed=true;
    // A failed acknowledgement may follow a committed spend. Reduce only; retain it.
    try{i.write(()=>{ports.db().prepare("UPDATE veyra_voice_assistant_sources SET fenced=1,fence_reason=COALESCE(fence_reason,'SPEND_UNCERTAIN'),phase=CASE WHEN phase IN ('reserved','linked') THEN 'unknown' ELSE phase END,revision=revision+1 WHERE claim_id=? AND fenced=0").run(retained.id);});}catch{/* Local closure survives a database/checkpoint failure. */}
    throw error;
   }
  },
  requireOriginalAssistantCpuLive(context:C,operationId:string,requestedOwner:VoiceOwner):void{
   const stored=ports.db().prepare('SELECT * FROM veyra_voice_assistant_sources WHERE cpu_operation_id=?').get(operationId) as Row|undefined;
   const operation=i.get(operationId);if(!stored){if(operation?.parent_operation_id===operation?.control_operation_id&&operation?.kind==='voice-speech-tts')return fail('VOICE_ASSISTANT_SOURCE_LINK_REQUIRED');return;}
   if(stored.phase!=='spent'||stored.fenced||stored.deadline_at<=ports.now()||stored.owner_json!==i.canonical(requestedOwner))return fail('VOICE_ASSISTANT_SOURCE_FENCED');
   // Handles cannot be rehydrated. No persisted row or JSON reconstructs a plan.
   const bound=operationHandles.get(operationId);if(!bound)return fail('VOICE_ASSISTANT_RESTART_ORIGINAL_UNAVAILABLE');const value=live(context,bound.claim);if(value.stored.claim_id!==stored.claim_id||value.retained.dispatch!==bound.dispatch)return fail();
   const d=actual().inspectDispatch(context,bound.dispatch);
   if(!d||d.sourceClaim!==bound.claim||d.operationId!==operationId||d.controlOperationId!==stored.control_operation_id||d.requestId!==stored.request_id||d.segmentIndex!==value.retained.segmentIndex||d.voice!==stored.voice||d.textSha256!==stored.text_sha256||!i.equal(d.scope,value.current.m.scope)||!i.equal(d.owner,requestedOwner)||i.canonical(d.identity)!==stored.cpu_identity_json)return fail('VOICE_ASSISTANT_DISPATCH_ORIGINAL_REQUIRED');
  },
  fenceOriginalAssistantSources(actualOriginalCall:object,reason:string):void{
   if(!['BARGE_IN','END','AUTH_LOST','SOURCE_CHANGED'].includes(reason))return fail('VOICE_ASSISTANT_FENCE_REASON');
   const inspector=ports.originalAssistantSources?.inspectCallForFence;if(typeof inspector!=='function')return fail('VOICE_ASSISTANT_ORIGINAL_FENCE_INSPECTOR_UNAVAILABLE');
   const f=inspector(actualOriginalCall);if(!f||f.call!==actualOriginalCall||!i.uuid(f.callId)||!i.uuid(f.callInstanceId)||!i.integer(f.generation))return fail('VOICE_ASSISTANT_CALL_ORIGINAL_REQUIRED');
   const old=calls.get(actualOriginalCall);calls.set(actualOriginalCall,{through:Math.max(old?.through??-1,f.generation),closed:old?.closed===true||reason==='END'});
   for(const [id,bound] of operationHandles){const held=claims.get(bound.claim);if(held?.call===actualOriginalCall){held.closed=true;operationHandles.delete(id);}}
   i.write(()=>{ports.db().prepare("UPDATE veyra_voice_assistant_sources SET fenced=1,fence_reason=COALESCE(fence_reason,?),phase=CASE WHEN phase IN ('reserved','linked') THEN 'fenced' ELSE phase END,revision=revision+1 WHERE call_instance_id=? AND call_generation<=? AND fenced=0").run(reason,f.callInstanceId,f.generation);});
  },
 };
}
