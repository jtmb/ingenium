import { randomUUID } from "node:crypto";
import type {VoiceLedgerPorts,VoiceMetadata,VoiceOriginal,VoiceOwner,CpuIdentity,VoiceOutcome,VoiceScope,VerifiedVoiceContext,VoiceState} from "./voice-operation-ledger.js";
import type {CpuPrivate,CpuRetentionChange,CpuRetentionAck,CpuResultFingerprint,VoiceControl,OriginalResourceRequest} from "./contract-v1.js";
type Row=Record<string,any>;
interface Internal<C> {
 get(id:string):Row|undefined;write<T>(work:()=>T):T;
 authorize(context:C,scope:VoiceScope|null,action:"reserve"|"read"|"transition"|"settle"|"quarantine",live:boolean):VerifiedVoiceContext;
 metadata(row:Row):VoiceMetadata;update(row:Row,state:VoiceState,outcome?:VoiceOutcome|null,fingerprint?:string|null,retention?:string|null,code?:string|null):VoiceMetadata;
 reserve(context:C,original:unknown,owner:unknown):{accepted:boolean;fresh:boolean;operation:VoiceMetadata};
 canonical(value:unknown):string;digest(value:unknown):string;equal(a:unknown,b:unknown):boolean;owner(value:unknown):VoiceOwner;
 uuid(value:unknown):value is string;hash(value:unknown):value is string;integer(value:unknown):value is number;text(value:unknown,max?:number):value is string;
 exact(value:unknown,keys:string[],optional?:string[]):asserts value is Row;fail(code:string,status?:number):never;
}
export function validateControl(value:unknown):asserts value is VoiceControl {
 if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("VOICE_CONTROL_INVALID");
 const c=value as Record<string,unknown>;
 if(Object.keys(c).sort().join()!==["instanceId","profileDigest","recoveryEndpointIdentity","retirementSecretSha256"].sort().join()
  ||typeof c.instanceId!=="string"||!/^[A-Za-z0-9:_-]{1,160}$/.test(c.instanceId)
  ||typeof c.profileDigest!=="string"||!/^[a-f0-9]{64}$/.test(c.profileDigest)
  ||typeof c.retirementSecretSha256!=="string"||!/^[a-f0-9]{64}$/.test(c.retirementSecretSha256)
  ||typeof c.recoveryEndpointIdentity!=="string"||!c.recoveryEndpointIdentity||c.recoveryEndpointIdentity.length>512)throw new Error("VOICE_CONTROL_INVALID");
}
export function initialCpu(identity:CpuIdentity):CpuPrivate&{permitId:string|null;transactions:Record<string,{digest:string;ack:CpuRetentionAck}>} {
 return {identity,revision:0,phase:"bound",outcome:null,drained:false,retentionId:null,lastTransactionId:null,lastTransactionDigest:null,resultFingerprint:null,dispatchClaimed:false,quarantined:false,permitId:null,transactions:{}};
}
export function createVoiceCpuExtension<C>(ports:VoiceLedgerPorts<C>,i:Internal<C>) {
 type Cpu=ReturnType<typeof initialCpu>;
 const privateMetadata=(row:Row):VoiceMetadata=>({...i.metadata(row),...(row.cpu_json?{cpu:JSON.parse(row.cpu_json)}:{}),...(row.control_json?{control:JSON.parse(row.control_json)}:{}),...(row.resource_retirement_json?{resourceRetirement:JSON.parse(row.resource_retirement_json)}:{}),resourceRetired:row.resource_retired===1,privateRevision:row.private_revision});
 function authority(context:C,row:Row|null,action:string,request:Row):void {
   const actual=ports.requireOriginalResource(context,row?privateMetadata(row):null,action,request);
   const requested=i.owner(request.owner);
   if(!actual||!i.equal(i.owner(actual.owner),requested)||actual.instanceId!==requested.instanceId||actual.operationId!==(row?.operation_id??null))return i.fail("VOICE_RESOURCE_AUTHORITY_REQUIRED",403);
   if(row&&!i.equal(JSON.parse(row.owner_json),requested))return i.fail("VOICE_ORIGINAL_OWNER_CHANGED",403);
 }
 function owned(context:C,request:OriginalResourceRequest,action:string):Row {
   if(!i.uuid(request.operationId))return i.fail("VOICE_OPERATION_INVALID",422);
   const row=i.get(request.operationId);if(!row)return i.fail("VOICE_NOT_FOUND",404);
   authority(context,row,action,request);return row;
 }
 function cpuOwned(context:C,request:OriginalResourceRequest&{identity:CpuIdentity;expectedCpuRevision:number},action:string):{row:Row;cpu:Cpu} {
   const row=owned(context,request,action);if(!row.cpu_json)return i.fail("VOICE_CPU_ORIGINAL_REQUIRED",403);
   const cpu:Cpu=JSON.parse(row.cpu_json);
   if(!i.equal(cpu.identity,request.identity))return i.fail("VOICE_CPU_ORIGINAL_CONFLICT",403);
   if(!i.integer(request.expectedCpuRevision)||request.expectedCpuRevision!==cpu.revision)return i.fail("VOICE_CPU_REVISION_CONFLICT");
   return {row,cpu};
 }
 function saveCpu(row:Row,cpu:Cpu):VoiceMetadata {
   const serialized=i.canonical(cpu);if(Buffer.byteLength(serialized)>131072)return i.fail("VOICE_CPU_METADATA_LIMIT",503);
   const changed=ports.db().prepare("UPDATE veyra_voice_operations SET cpu_json=?,private_revision=private_revision+1 WHERE operation_id=? AND private_revision=?").run(serialized,row.operation_id,row.private_revision);
   if(Number(changed.changes)!==1)return i.fail("VOICE_PRIVATE_REVISION_CONFLICT");
   const stored=i.get(row.operation_id);if(!stored)throw new Error("Voice CPU metadata vanished");return privateMetadata(stored);
 }
 function live(context:C,row:Row,requestedOwner:VoiceOwner):void {
   const current=i.authorize(context,JSON.parse(row.scope_json),"transition",true);
   if(!i.equal(current.owner,requestedOwner)||row.user_epoch!==current.userSecurityEpoch||row.workspace_epoch!==current.workspaceSecurityEpoch||row.runtime_epoch!==current.runtimeSecurityEpoch||row.deadline_at<=ports.now())return i.fail("VOICE_CPU_DISPATCH_REVOKED",403);
   if(row.resource_retired)return i.fail("VOICE_CPU_DISPATCH_REVOKED",403);
   if(row.control_operation_id) {
     const control=i.get(row.control_operation_id);
     if(!control||control.resource_retired||control.state!=="running"||control.scope_hash!==row.scope_hash)return i.fail("VOICE_CPU_DISPATCH_REVOKED",403);
   }
 }
 function fingerprint(value:unknown):asserts value is CpuResultFingerprint {
   i.exact(value,["status","contentType","sha256","bytes"]);
   if(!i.integer(value.status)||value.status<100||value.status>599||!["application/json","audio/wav"].includes(value.contentType)||!i.hash(value.sha256)||!i.integer(value.bytes)||value.bytes>1440044)return i.fail("VOICE_CPU_RESULT_INVALID",422);
 }
 return {
   reserveControl(context:C,input:{original:VoiceOriginal;owner:VoiceOwner;control:VoiceControl}) {
     i.exact(input,["original","owner","control"]);validateControl(input.control);
     if(input.original.kind!=="voice-cpu-supervisor"||!i.equal(input.original.control,input.control))return i.fail("VOICE_CONTROL_INVALID",422);
     return i.reserve(context,input.original,input.owner);
   },
   privateRead(context:C,request:OriginalResourceRequest):VoiceMetadata {
     i.exact(request,["operationId","owner"]);
     return ports.transaction(()=>privateMetadata(owned(context,request,"read")),"deferred");
   },
   listControls(context:C,request:{instanceId:string;owner:VoiceOwner}):readonly VoiceMetadata[] {
     i.exact(request,["instanceId","owner"]);
     return ports.transaction(()=>{
       authority(context,null,"listControls",request);
       if(request.instanceId!==request.owner.instanceId)return i.fail("VOICE_RESOURCE_AUTHORITY_REQUIRED",403);
       return ports.db().prepare("SELECT * FROM veyra_voice_operations WHERE kind='voice-cpu-supervisor' AND instance_id=? ORDER BY owner_generation DESC,operation_id LIMIT 128").all(request.instanceId).map(privateMetadata);
     },"deferred");
   },
   bindWorkerBoot(context:C,request:OriginalResourceRequest&{workerBootId:string;physicalProof:unknown}):VoiceMetadata {
     i.exact(request,["operationId","owner","workerBootId","physicalProof"]);
     return i.write(()=>{
       const row=owned(context,request,"bindWorkerBoot");
       if(row.kind!=="voice-cpu-supervisor"||!i.uuid(request.workerBootId)||row.resource_retired)return i.fail("VOICE_CONTROL_INVALID",403);
       const control=JSON.parse(row.control_json);
       if(control.workerBootId!==null){if(control.workerBootId!==request.workerBootId)return i.fail("VOICE_WORKER_BOOT_IMMUTABLE");return privateMetadata(row);}
       live(context,row,request.owner);
       if(row.state!=="reserved")return i.fail("VOICE_CONTROL_INVALID",403);
       control.workerBootId=request.workerBootId;
       ports.db().prepare("UPDATE veyra_voice_operations SET control_json=?,private_revision=private_revision+1 WHERE operation_id=? AND private_revision=?").run(i.canonical(control),row.operation_id,row.private_revision);
       i.update(row,"running");const stored=i.get(row.operation_id);if(!stored)throw new Error("Voice control vanished");return privateMetadata(stored);
     });
   },
   claimCpuDispatch(context:C,request:OriginalResourceRequest&{identity:CpuIdentity;expectedCpuRevision:number}) {
     i.exact(request,["operationId","owner","identity","expectedCpuRevision"]);
     return i.write(()=>{
       const {row,cpu}=cpuOwned(context,request,"claimCpuDispatch");live(context,row,request.owner);
       if(row.state!=="reserved"||cpu.dispatchClaimed||cpu.quarantined||cpu.phase!=="bound")return i.fail("VOICE_CPU_DISPATCH_ALREADY_CLAIMED",403);
       cpu.dispatchClaimed=true;cpu.permitId=randomUUID();saveCpu(row,cpu);i.update(row,"running");
       return {identity:cpu.identity,permitId:cpu.permitId,revision:cpu.revision};
     });
   },
   retainCpu(context:C,request:CpuRetentionChange):CpuRetentionAck {
     i.exact(request,["operationId","owner","identity","transactionId","expectedCpuRevision","phase","outcome","drained"]);
     if(!i.uuid(request.transactionId))return i.fail("VOICE_CPU_TRANSACTION_INVALID",422);
     return i.write(()=>{
       const row=owned(context,request,"retainCpu");if(!row.cpu_json)return i.fail("VOICE_CPU_ORIGINAL_REQUIRED",403);
       const cpu:Cpu=JSON.parse(row.cpu_json),transactionDigest=i.digest(request);
       if(!i.equal(cpu.identity,request.identity))return i.fail("VOICE_CPU_ORIGINAL_CONFLICT",403);
       const old=cpu.transactions[request.transactionId];
       if(old){if(old.digest!==transactionDigest)return i.fail("VOICE_CPU_TRANSACTION_CONFLICT");return old.ack;}
       if(!i.integer(request.expectedCpuRevision)||request.expectedCpuRevision!==cpu.revision)return i.fail("VOICE_CPU_REVISION_CONFLICT");
       if(Object.keys(cpu.transactions).length>=64)return i.fail("VOICE_CPU_TRANSACTION_LIMIT",503);
       if(!cpu.dispatchClaimed||cpu.phase==="terminal")return i.fail("VOICE_CPU_TRANSITION_INVALID",403);
       if(request.phase==="terminal") {
         if(request.drained!==true||!["completed","failed","cancelled","cancelled-before-dispatch"].includes(request.outcome??""))return i.fail("VOICE_CPU_TERMINAL_UNCONFIRMED",403);
         if(["bound","reserved"].includes(cpu.phase)&&request.outcome!=="cancelled-before-dispatch")return i.fail("VOICE_CPU_TRANSITION_INVALID",403);
       } else {
         if(request.outcome!==null||request.drained!==false||cpu.quarantined&&request.phase!=="uncertain")return i.fail("VOICE_CPU_TRANSITION_INVALID",403);
         if(request.phase==="uncertain") { /* Durable uncertainty ACK is not retirement or dispatch authority. */ }
         else if(request.phase==="reserved") {if(!["bound","reserved"].includes(cpu.phase))return i.fail("VOICE_CPU_TRANSITION_INVALID",403);}
         else if(request.phase==="running") {if(cpu.phase!=="reserved"||row.state!=="running")return i.fail("VOICE_CPU_TRANSITION_INVALID",403);live(context,row,request.owner);}
         else return i.fail("VOICE_CPU_TRANSITION_INVALID",422);
       }
       const ack={identity:cpu.identity,transactionId:request.transactionId,revision:cpu.revision+1,retentionId:randomUUID()};
       Object.assign(cpu,{revision:ack.revision,phase:request.phase,outcome:request.outcome,drained:request.drained,retentionId:ack.retentionId,lastTransactionId:request.transactionId,lastTransactionDigest:transactionDigest});
       if(request.phase==="uncertain")cpu.quarantined=true;
       cpu.transactions[request.transactionId]={digest:transactionDigest,ack};saveCpu(row,cpu);
       if(request.phase==="uncertain"&&row.state!=="terminal")i.update(row,"terminal","unknown",null,null,"CPU_OUTCOME_UNCERTAIN");
       return ack;
     });
   },
   recordCpuResult(context:C,request:OriginalResourceRequest&{identity:CpuIdentity;expectedCpuRevision:number;resultFingerprint:CpuResultFingerprint}):VoiceMetadata {
     i.exact(request,["operationId","owner","identity","expectedCpuRevision","resultFingerprint"]);fingerprint(request.resultFingerprint);
     return i.write(()=>{
       const {row,cpu}=cpuOwned(context,request,"recordCpuResult");
       if(cpu.phase!=="terminal"||!cpu.drained)return i.fail("VOICE_CPU_TERMINAL_UNCONFIRMED",403);
       if((cpu.outcome==="completed")!==(request.resultFingerprint.status>=200&&request.resultFingerprint.status<300)
         ||request.resultFingerprint.contentType!==(cpu.outcome==="completed"&&cpu.identity.kind==="synthesize"?"audio/wav":"application/json"))return i.fail("VOICE_CPU_RESULT_CONFLICT",403);
       if(cpu.resultFingerprint){if(!i.equal(cpu.resultFingerprint,request.resultFingerprint))return i.fail("VOICE_CPU_RESULT_IMMUTABLE");return privateMetadata(row);}
       cpu.resultFingerprint=request.resultFingerprint;return saveCpu(row,cpu);
     });
   },
   quarantineCpu(context:C,request:OriginalResourceRequest&{identity:CpuIdentity;expectedCpuRevision:number;reason:string}):VoiceMetadata {
     i.exact(request,["operationId","owner","identity","expectedCpuRevision","reason"]);
     if(!i.text(request.reason,64)||!/^[A-Z0-9_]+$/.test(request.reason))return i.fail("VOICE_QUARANTINE_CODE_INVALID",422);
     return i.write(()=>{
       const {row,cpu}=cpuOwned(context,request,"quarantineCpu");cpu.quarantined=true;if(cpu.phase!=="terminal")cpu.phase="uncertain";
       saveCpu(row,cpu);if(row.state!=="terminal")i.update(row,"terminal","unknown",null,null,request.reason);
       const stored=i.get(row.operation_id);if(!stored)throw new Error("Voice operation vanished");return privateMetadata(stored);
     });
   },
   retireOriginal(context:C,request:OriginalResourceRequest&{physicalProof:unknown}):VoiceMetadata {
     i.exact(request,["operationId","owner","physicalProof"]);
     return i.write(()=>{
       const row=owned(context,request,"retireOriginal");
       const leaves:Row[]=row.kind==="voice-cpu-supervisor"
         ?ports.db().prepare("SELECT * FROM veyra_voice_operations WHERE control_operation_id=? AND owner_json=? AND cpu_identity_json IS NOT NULL AND resource_retired=0 ORDER BY operation_id LIMIT 1025").all(row.operation_id,row.owner_json):[];
       if(leaves.length>1024)return i.fail("VOICE_CONTROL_RETIREMENT_LIMIT",503);
       if(row.resource_retired&&leaves.length===0)return privateMetadata(row);
       const control=row.control_json?JSON.parse(row.control_json):null;
       for(const leaf of leaves){
         const original:VoiceOriginal=JSON.parse(leaf.original_json);
         if(leaf.scope_hash!==row.scope_hash||i.digest(original.scope)!==row.scope_hash||original.controlOperationId!==row.operation_id
           ||!leaf.cpu_json||!original.cpuIdentity||original.cpuIdentity.bootId!==control?.workerBootId
           ||!i.equal(original.cpuIdentity,JSON.parse(leaf.cpu_identity_json))||!i.equal(JSON.parse(leaf.owner_json),JSON.parse(row.owner_json)))return i.fail("VOICE_CONTROL_LEAF_SCOPE_CHANGED",403);
       }
       // Validate the original physical scope for the parent and every exact leaf BEFORE writes.
       // The same opaque proof is reused; callbacks must validate it without consuming it.
       const receipts=[row,...leaves].map(originalRow=>{
         const operation=privateMetadata(originalRow),proof=ports.verifyRetirement(context,structuredClone(operation),request.physicalProof);
         if(!proof||proof.operationId!==originalRow.operation_id||!i.equal(proof.owner,operation.owner)||proof.drained!==true||!i.uuid(proof.retentionId)||!i.equal(proof.identity,operation.original.cpuIdentity))return i.fail("VOICE_RETIREMENT_UNCONFIRMED",403);
         if(originalRow.cpu_json){const cpu:Cpu=JSON.parse(originalRow.cpu_json);if(cpu.phase==="terminal"&&cpu.retentionId!==proof.retentionId)return i.fail("VOICE_RETIREMENT_UNCONFIRMED",403);}
         return {row:originalRow,receipt:{operationId:originalRow.operation_id,owner:operation.owner,identity:operation.original.cpuIdentity,retentionId:proof.retentionId,drained:true,verifiedAt:ports.now()}};
       });
       // One Core transaction commits all bookkeeping or none; public and CPU producer fields stay untouched.
       for(const retained of receipts){
         if(retained.row.resource_retired)continue;
         const changed=ports.db().prepare("UPDATE veyra_voice_operations SET resource_retired=1,resource_retirement_json=?,private_revision=private_revision+1 WHERE operation_id=? AND private_revision=? AND resource_retired=0").run(i.canonical(retained.receipt),retained.row.operation_id,retained.row.private_revision);
         if(Number(changed.changes)!==1)return i.fail("VOICE_PRIVATE_REVISION_CONFLICT");
       }
       const stored=i.get(row.operation_id);if(!stored)throw new Error("Voice resource vanished");return privateMetadata(stored);
     });
   },
 };
}
