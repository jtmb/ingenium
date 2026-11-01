import {createOriginalAssistantSourceOwner,type OriginalAssistantSourceClaim,type OriginalAssistantSourceInspectors} from './voice-assistant-source.js';
import { createHash } from "node:crypto";
import { createVoiceCpuExtension, validateControl, initialCpu } from "./voice-operation-cpu.js";
import type {CpuPrivate,VoiceControl} from "./voice-operation-contract.js";

export interface VoiceScope {
  actorId:string;accountId:string;organizationId:string|null;projectId:string|null;conversationId:string;
  runtimeId:string;executionBindingId:string;executionRevision:string;agentId:string;
}
export interface CpuIdentity {instanceId:string;bootId:string;ownerId:string;ownerGeneration:number;requestId:string;operationId:string;generation:string;kind:"transcribe"|"synthesize";digest:string}
export interface VoiceOwner {instanceId:string;bootId:string;ownerId:string;ownerGeneration:number;leaseId:string}
export type VoiceKind="voice-agent-turn"|"voice-agent-steer"|"voice-agent-queue"|"voice-speech-stt"|"voice-speech-tts"|"voice-cpu-supervisor";
export type VoiceState="reserved"|"running"|"quarantined"|"terminal";
export type VoiceOutcome="completed"|"failed"|"cancelled"|"cancelled-before-dispatch"|"unknown";
export interface VoiceOriginal {operationId:string;requestId:string;kind:VoiceKind;scope:VoiceScope;turnGeneration:number;inputSha256:string;parentOperationId:string|null;controlOperationId:string|null;control:VoiceControl|null;deadlineAt:number;cpuIdentity:CpuIdentity|null}
export interface VoiceMetadata {original:VoiceOriginal;owner:VoiceOwner;revision:number;state:VoiceState;outcome:VoiceOutcome|null;resultFingerprint:string|null;retentionId:string|null;retired:boolean;replayAllowed:false;quarantineCode:string|null;cpu?:CpuPrivate;control?:VoiceControl&{workerBootId:string|null};resourceRetired?:boolean;privateRevision?:number;resourceRetirement?:{operationId:string;retentionId:string;verifiedAt:number}}
export interface VoiceChange {operationId:string;expectedRevision:number;owner:VoiceOwner;from:VoiceState;to:"running"|"quarantined"|"terminal";outcome?:VoiceOutcome;resultFingerprint?:string|null;proof?:unknown}
export interface VerifiedVoiceContext {scope:VoiceScope;authSessionId:string;workspaceId:string;userSecurityEpoch:number;workspaceSecurityEpoch:number;runtimeSecurityEpoch:number;deadlineAt:number;owner:VoiceOwner;mode:"hosted";selectedConversationVerified:true}
export interface VoiceRetirement {operationId:string;owner:VoiceOwner;identity:CpuIdentity|null;retentionId:string;drained:true;outcome:VoiceOutcome;resultFingerprint:string|null}
type Row=Record<string,any>;
export interface VoiceSqlDb {prepare(sql:string):{get(...values:any[]):any;all(...values:any[]):any[];run(...values:any[]):{changes:number|bigint}}}
export interface VoiceLedgerPorts<C> {
  originalAssistantSources?:OriginalAssistantSourceInspectors<C>;
  db():VoiceSqlDb;transaction<T>(work:()=>T,mode:"deferred"|"immediate"):T;checkpoint():void;now():number;
  currentScope(context:C,scope:VoiceScope|null,action:"reserve"|"read"|"transition"|"settle"|"quarantine"):VerifiedVoiceContext;
  verifyRetirement(context:C,operation:Readonly<VoiceMetadata>,proof:unknown):VoiceRetirement;
  requireOriginalResource(context:C,operation:Readonly<VoiceMetadata>|null,action:string,request:Readonly<Record<string,unknown>>):{operationId:string|null;owner:VoiceOwner;instanceId:string};
}
export class VoiceLedgerError extends Error {
  code:string;status:number;
  constructor(code:string,status=409){super(code);this.name="VoiceLedgerError";this.code=code;this.status=status;}
}
const fail=(code:string,status=409):never=>{throw new VoiceLedgerError(code,status);};
const scopeKeys=["actorId","accountId","organizationId","projectId","conversationId","runtimeId","executionBindingId","executionRevision","agentId"];
const cpuKeys=["instanceId","bootId","ownerId","ownerGeneration","requestId","operationId","generation","kind","digest"];
const ownerKeys=["instanceId","bootId","ownerId","ownerGeneration","leaseId"];
function object(value:unknown):value is Row {return !!value&&typeof value==="object"&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));}
function exact(value:unknown,keys:string[],optional:string[]=[]):asserts value is Row {
  if(!object(value)||keys.some(k=>!Object.hasOwn(value,k))||Object.keys(value).some(k=>![...keys,...optional].includes(k)))return fail("VOICE_SHAPE_INVALID",422);
}
const text=(v:unknown,max=256):v is string=>typeof v==="string"&&!!v.trim()&&v.length<=max&&Buffer.from(v,"utf8").toString("utf8")===v;
const uuid=(v:unknown):v is string=>typeof v==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v)&&v!=="00000000-0000-0000-0000-000000000000";
const integer=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0;
const hash=(v:unknown):v is string=>typeof v==="string"&&/^[0-9a-f]{64}$/.test(v);
function canonical(value:unknown):string {
  if(value===null||typeof value==="boolean"||typeof value==="string")return JSON.stringify(value);
  if(typeof value==="number"&&Number.isSafeInteger(value))return JSON.stringify(value);
  if(Array.isArray(value))return "["+value.map(canonical).join(",")+"]";
  if(!object(value))return fail("VOICE_JSON_INVALID",422);
  return "{"+Object.keys(value).sort().map(key=>JSON.stringify(key)+":"+canonical(value[key])).join(",")+"}";
}
const digest=(value:unknown)=>createHash("sha256").update(canonical(value)).digest("hex");
const equal=(a:unknown,b:unknown)=>canonical(a)===canonical(b);
export function validateVoiceScope(value:unknown):VoiceScope {
  exact(value,scopeKeys);
  if(scopeKeys.some(k=>!(["organizationId","projectId"].includes(k)&&value[k]===null)&&!text(value[k])))return fail("VOICE_SCOPE_INVALID",422);
  return Object.freeze({...value}) as VoiceScope;
}
export function validateCpuIdentity(value:unknown):CpuIdentity {
  exact(value,cpuKeys);
  if(!text(value.instanceId,160)||!/^[A-Za-z0-9:_-]+$/.test(value.instanceId)
    ||["bootId","ownerId","requestId","operationId","generation"].some(k=>!uuid(value[k]))
    ||value.requestId!==value.operationId||!integer(value.ownerGeneration)||value.ownerGeneration<1
    ||!["transcribe","synthesize"].includes(value.kind)||!hash(value.digest))return fail("VOICE_CPU_IDENTITY_INVALID",422);
  return Object.freeze({...value}) as CpuIdentity;
}
function owner(value:unknown):VoiceOwner {
  exact(value,ownerKeys);
  if(!text(value.instanceId,160)||!/^[A-Za-z0-9:_-]+$/.test(value.instanceId)||!uuid(value.bootId)||!uuid(value.ownerId)
    ||!integer(value.ownerGeneration)||value.ownerGeneration<1||!text(value.leaseId))return fail("VOICE_OWNER_INVALID",422);
  return Object.freeze({...value}) as VoiceOwner;
}
export function validateVoiceOriginal(value:unknown):VoiceOriginal {
  exact(value,["operationId","requestId","kind","scope","turnGeneration","inputSha256","parentOperationId","controlOperationId","control","deadlineAt","cpuIdentity"]);
  if(!uuid(value.operationId)||!text(value.requestId)||!["voice-agent-turn","voice-agent-steer","voice-agent-queue","voice-speech-stt","voice-speech-tts","voice-cpu-supervisor"].includes(value.kind)
    ||!integer(value.turnGeneration)||!hash(value.inputSha256)||!(value.parentOperationId===null||uuid(value.parentOperationId))
    ||!integer(value.deadlineAt))return fail("VOICE_ORIGINAL_INVALID",422);
  if(!(value.controlOperationId===null||uuid(value.controlOperationId)))return fail("VOICE_CONTROL_INVALID",422);
  if(value.kind==="voice-cpu-supervisor") {validateControl(value.control);if(value.control.profileDigest!==value.inputSha256||value.cpuIdentity!==null||value.controlOperationId!==null||value.parentOperationId!==null)return fail("VOICE_CONTROL_INVALID",422);}
  else if(value.control!==null)return fail("VOICE_CONTROL_INVALID",422);
  const scope=validateVoiceScope(value.scope),cpu=value.cpuIdentity===null?null:validateCpuIdentity(value.cpuIdentity);
  if(cpu&&(cpu.operationId!==value.operationId||cpu.digest!==value.inputSha256
    ||(cpu.kind==="transcribe"?value.kind!=="voice-speech-stt":value.kind!=="voice-speech-tts")))return fail("VOICE_CPU_ORIGINAL_CONFLICT",422);
  if(value.kind.startsWith("voice-speech-")&&!cpu)return fail("VOICE_CPU_IDENTITY_REQUIRED",422);
  if(cpu&&value.controlOperationId===null)return fail("VOICE_CONTROL_REQUIRED",422);
  if(value.kind==="voice-agent-turn"&&value.parentOperationId!==null||["voice-agent-steer","voice-agent-queue","voice-speech-tts"].includes(value.kind)&&value.parentOperationId===null)return fail("VOICE_PARENT_REQUIRED",422);
  return Object.freeze({...value,scope,cpuIdentity:cpu}) as VoiceOriginal;
}
function metadata(row:Row):VoiceMetadata {
  return {original:JSON.parse(row.original_json),owner:JSON.parse(row.owner_json),revision:row.revision,state:row.state,outcome:row.outcome,
    resultFingerprint:row.result_fingerprint,retentionId:row.retention_id,retired:row.retired===1,replayAllowed:false,quarantineCode:row.quarantine_code};
}
/** One existing Core writer. This module never dispatches work, creates inference identities or replays. */
export function createCoreVoiceOperationLedger<C>(ports:VoiceLedgerPorts<C>) {
  if([ports.db,ports.transaction,ports.checkpoint,ports.now,ports.currentScope,ports.verifyRetirement,ports.requireOriginalResource].some(p=>typeof p!=="function"))return fail("VOICE_LEDGER_BINDING_REQUIRED",503);
  const get=(id:string)=>ports.db().prepare("SELECT * FROM veyra_voice_operations WHERE operation_id=?").get(id) as Row|undefined;
  function authorize(context:C,scope:VoiceScope|null,action:Parameters<VoiceLedgerPorts<C>["currentScope"]>[2],live:boolean):VerifiedVoiceContext {
    const verified=ports.currentScope(context,scope,action);
    if(!verified||verified.mode!=="hosted"||verified.selectedConversationVerified!==true||scope!==null&&!equal(validateVoiceScope(verified.scope),scope)
      ||!text(verified.authSessionId)||!text(verified.workspaceId)||!integer(verified.userSecurityEpoch)||!integer(verified.workspaceSecurityEpoch)
      ||!integer(verified.runtimeSecurityEpoch)||!integer(verified.deadlineAt))return fail("VOICE_CONTEXT_UNAVAILABLE",503);
    owner(verified.owner);
    scope=validateVoiceScope(verified.scope);
    if(scope.organizationId===null||scope.projectId===null)return fail("VOICE_HOSTED_RUNTIME_REQUIRED",403);
    const now=ports.now();
    if(!integer(now)||verified.deadlineAt<=now)return fail("VOICE_CONTEXT_EXPIRED",403);
    const user=ports.db().prepare("SELECT u.status,u.security_epoch,s.revoked_at,s.security_epoch AS session_epoch,s.idle_expires_at,s.absolute_expires_at FROM users u JOIN auth_sessions s ON s.user_id=u.id WHERE u.id=? AND s.id=?").get(scope.actorId,verified.authSessionId);
    if(!user||user.status!=="active"||user.revoked_at!==null||user.security_epoch!==verified.userSecurityEpoch||user.session_epoch!==user.security_epoch
      ||!Number.isFinite(Date.parse(user.idle_expires_at))||!Number.isFinite(Date.parse(user.absolute_expires_at))
      ||Date.parse(user.idle_expires_at)<=now||Date.parse(user.absolute_expires_at)<=now)return fail("VOICE_UNAUTHENTICATED",401);
    const project=ports.db().prepare("SELECT p.archived_at,p.organization_id,o.status AS organization_status,m.status AS member_status,m.role,pm.role AS project_role FROM projects p JOIN organizations o ON o.id=p.organization_id JOIN organization_memberships m ON m.organization_id=o.id AND m.user_id=? LEFT JOIN project_memberships pm ON pm.project_id=p.id AND pm.user_id=m.user_id WHERE p.id=?").get(scope.actorId,scope.projectId);
    if(!project||project.archived_at!==null||project.organization_id!==scope.organizationId||project.organization_status!=="active"||project.member_status!=="active")return fail("VOICE_FORBIDDEN",403);
    if(live&&!["owner","admin"].includes(project.role)&&project.project_role!=="editor")return fail("VOICE_FORBIDDEN",403);
    const runtime=ports.db().prepare("SELECT r.*,w.status AS workspace_status,w.security_epoch AS workspace_epoch,w.organization_id AS workspace_organization,w.project_id AS workspace_project,w.owner_user_id AS workspace_owner FROM runtime_instances r JOIN authorized_workspaces w ON w.id=r.workspace_id WHERE r.id=?").get(scope.runtimeId);
    if(!runtime||runtime.workspace_id!==verified.workspaceId||runtime.organization_id!==scope.organizationId||runtime.project_id!==scope.projectId||runtime.owner_user_id!==scope.actorId
      ||runtime.workspace_organization!==scope.organizationId||runtime.workspace_project!==scope.projectId||runtime.workspace_owner!==scope.actorId
      ||runtime.workspace_status!=="authorized"||runtime.workspace_epoch!==verified.workspaceSecurityEpoch||runtime.security_epoch!==verified.runtimeSecurityEpoch
      ||runtime.workspace_epoch!==runtime.security_epoch)return fail("VOICE_RUNTIME_SCOPE_CHANGED",403);
    if(live&&(!["READY","IDLE"].includes(runtime.state)||!hash(runtime.lease_owner_hash)
      ||!Number.isFinite(Date.parse(runtime.lease_expires_at))||Date.parse(runtime.lease_expires_at)<=now
      ||!Number.isFinite(Date.parse(runtime.absolute_expires_at))||Date.parse(runtime.absolute_expires_at)<=now))return fail("VOICE_RUNTIME_UNAVAILABLE",403);
    return {...verified,deadlineAt:Math.min(verified.deadlineAt,Date.parse(user.idle_expires_at),Date.parse(user.absolute_expires_at),
      ...(live?[Date.parse(runtime.lease_expires_at),Date.parse(runtime.absolute_expires_at)]:[]))};
  }
  function originalEpochs(row:Row,current:VerifiedVoiceContext):void {
    if(row.user_epoch!==current.userSecurityEpoch||row.workspace_epoch!==current.workspaceSecurityEpoch||row.runtime_epoch!==current.runtimeSecurityEpoch)return fail("VOICE_ORIGINAL_EPOCH_CHANGED",403);
  }
  function requireRow(context:C,id:string,action:Parameters<VoiceLedgerPorts<C>["currentScope"]>[2],live:boolean) {
    if(!uuid(id))return fail("VOICE_OPERATION_INVALID",422);
    const row=get(id);if(!row){authorize(context,null,action,false);return fail("VOICE_NOT_FOUND",404);}
    const current=authorize(context,validateVoiceScope(JSON.parse(row.scope_json)),action,live);
    return {row,current};
  }
  const write=<T>(work:()=>T):T=>{const result=ports.transaction(work,"immediate");ports.checkpoint();return result;};
  function compare(change:VoiceChange,row:Row):void {
    if(!integer(change.expectedRevision)||change.expectedRevision!==row.revision||change.from!==row.state)return fail("VOICE_REVISION_CONFLICT");
    if(!equal(owner(change.owner),JSON.parse(row.owner_json)))return fail("VOICE_ORIGINAL_OWNER_CHANGED",403);
  }
  function update(row:Row,state:VoiceState,outcome:VoiceOutcome|null=null,fingerprint:string|null=null,retention:string|null=null,code:string|null=null):VoiceMetadata {
    const result=ports.db().prepare("UPDATE veyra_voice_operations SET state=?,outcome=?,result_fingerprint=?,retention_id=?,retired=?,quarantine_code=COALESCE(quarantine_code,?),revision=revision+1,updated_at=? WHERE operation_id=? AND revision=? AND state=?")
      .run(state,outcome,fingerprint,retention,state==="terminal"&&outcome!=="unknown"?1:0,code,ports.now(),row.operation_id,row.revision,row.state);
    if(Number(result.changes)!==1)return fail("VOICE_REVISION_CONFLICT");
    const stored=get(row.operation_id);if(!stored)throw new Error("Voice operation vanished");return metadata(stored);
  }
  function reserveWithinTransaction(context:C,input:unknown,ownerInput:unknown,assistantClaim:OriginalAssistantSourceClaim|null=null) {
      const original=validateVoiceOriginal(input),originalOwner=owner(ownerInput),originalHash=digest({original,owner:originalOwner});
        const current=authorize(context,original.scope,"reserve",true);
        if(!equal(current.owner,originalOwner))return fail("VOICE_ORIGINAL_OWNER_CHANGED",403);
        if(original.cpuIdentity&&!["instanceId","ownerId","ownerGeneration"].every(k=>original.cpuIdentity?.[k as keyof CpuIdentity]===originalOwner[k as keyof VoiceOwner]))return fail("VOICE_CPU_OWNER_CONFLICT",403);
        if(original.control) {
          const authority=ports.requireOriginalResource(context,null,"reserveControl",{operationId:original.operationId,owner:originalOwner,control:original.control});
          if(!authority||authority.operationId!==original.operationId||!equal(authority.owner,originalOwner)||authority.instanceId!==originalOwner.instanceId||original.control.instanceId!==originalOwner.instanceId)return fail("VOICE_RESOURCE_AUTHORITY_REQUIRED",403);
        }
        const old=get(original.operationId);
        if(old){if(old.actor_id!==original.scope.actorId||old.scope_hash!==digest(original.scope))return fail("VOICE_NOT_FOUND",404);if(old.original_hash!==originalHash)return fail("VOICE_ORIGINAL_REUSE_CONFLICT");return {accepted:false,fresh:false,operation:metadata(old)};}
        const duplicate=ports.db().prepare("SELECT operation_id FROM veyra_voice_operations WHERE scope_hash=? AND request_id=?").get(digest(original.scope),original.requestId);
        if(duplicate)return fail("VOICE_REQUEST_ALREADY_RETAINED");
        if(original.deadlineAt<=ports.now()||original.deadlineAt>current.deadlineAt)return fail("VOICE_DEADLINE_INVALID",403);
        if(original.cpuIdentity) {
          if(original.controlOperationId===null)return fail("VOICE_CONTROL_REQUIRED",403);
          const control=get(original.controlOperationId);
          if(!control||control.kind!=="voice-cpu-supervisor"||control.scope_hash!==digest(original.scope)||control.resource_retired!==0||control.state!=="running"||!equal(JSON.parse(control.owner_json),originalOwner)||JSON.parse(control.control_json).workerBootId!==original.cpuIdentity.bootId)return fail("VOICE_CONTROL_UNAVAILABLE",403);
        }
        if(assistantClaim!==null){sources.assertOriginalAssistantReservation(context,assistantClaim,original,originalOwner);}
        else if(original.parentOperationId){
          const parent=get(original.parentOperationId);
          if(!parent||parent.scope_hash!==digest(original.scope)||parent.turn_generation!==original.turnGeneration||parent.kind!=="voice-agent-turn"||parent.deadline_at<=ports.now()
            ||(original.kind==="voice-speech-tts"?parent.state!=="terminal"||parent.outcome!=="completed"||!parent.result_fingerprint:parent.state!=="running"))return fail("VOICE_PARENT_UNAVAILABLE",403);
        }
        const now=ports.now();
        ports.db().prepare("INSERT INTO veyra_voice_operations(operation_id,request_id,kind,scope_json,scope_hash,original_hash,original_json,input_sha256,actor_id,organization_id,project_id,runtime_id,workspace_id,user_epoch,workspace_epoch,runtime_epoch,turn_generation,parent_operation_id,cpu_identity_json,owner_json,deadline_at,control_operation_id,instance_id,owner_generation,control_json,cpu_json,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'reserved',?,?)")
          .run(original.operationId,original.requestId,original.kind,canonical(original.scope),digest(original.scope),originalHash,canonical(original),original.inputSha256,original.scope.actorId,original.scope.organizationId,original.scope.projectId,original.scope.runtimeId,current.workspaceId,current.userSecurityEpoch,current.workspaceSecurityEpoch,current.runtimeSecurityEpoch,original.turnGeneration,original.parentOperationId,original.cpuIdentity?canonical(original.cpuIdentity):null,canonical(originalOwner),original.deadlineAt,original.controlOperationId,originalOwner.instanceId,originalOwner.ownerGeneration,original.control?canonical({...original.control,workerBootId:null}):null,original.cpuIdentity?canonical(initialCpu(original.cpuIdentity)):null,now,now);
        const stored=get(original.operationId);if(!stored)throw new Error("Voice reserve was not retained");return {accepted:true,fresh:true,operation:metadata(stored)};
  }
  const sources=createOriginalAssistantSourceOwner(ports,{get,write,authorize,canonical,digest,equal,uuid,hash,integer,validateOriginal:validateVoiceOriginal,reserveAttached:reserveWithinTransaction});
  const publicLedger={
    reserve(context:C,input:unknown,ownerInput:unknown) {return write(()=>reserveWithinTransaction(context,input,ownerInput));},
    read(context:C,id:string):VoiceMetadata|null {
      if(!uuid(id))return fail("VOICE_OPERATION_INVALID",422);
      return ports.transaction(()=>{const row=get(id);authorize(context,row?validateVoiceScope(JSON.parse(row.scope_json)):null,"read",false);return row?metadata(row):null;},"deferred");
    },
    cas(context:C,change:VoiceChange):VoiceMetadata {
      exact(change,["operationId","expectedRevision","owner","from","to"]);
      if(!["running","quarantined"].includes(change.to))return fail("VOICE_TERMINAL_PROOF_REQUIRED",403);
      return write(()=>{
        const {row,current}=requireRow(context,change.operationId,"transition",change.to==="running");compare(change,row);
        if(row.state==="terminal"||row.state==="quarantined"||change.to==="running"&&row.state!=="reserved")return fail("VOICE_TRANSITION_INVALID");
        if(change.to==="running"){
          originalEpochs(row,current);if(!equal(current.owner,change.owner))return fail("VOICE_ORIGINAL_OWNER_CHANGED",403);
          if(row.deadline_at<=ports.now())return fail("VOICE_OPERATION_EXPIRED",403);
        }
        return change.to==="quarantined"?update(row,"terminal","unknown",null,null,"VOICE_OUTCOME_UNKNOWN"):update(row,change.to);
      });
    },
    settle(context:C,change:VoiceChange):VoiceMetadata {
      exact(change,["operationId","expectedRevision","owner","from","to","outcome","proof"],["resultFingerprint"]);
      if(change.to!=="terminal"||!["completed","failed","cancelled","cancelled-before-dispatch","unknown"].includes(change.outcome??"")
        ||!(change.resultFingerprint===undefined||change.resultFingerprint===null||hash(change.resultFingerprint)))return fail("VOICE_SETTLEMENT_INVALID",422);
      return write(()=>{
        const {row,current}=requireRow(context,change.operationId,"settle",false);compare(change,row);originalEpochs(row,current);
        if(row.state==="terminal")return fail("VOICE_TERMINAL_IMMUTABLE");
        if(change.outcome==="unknown") {if(change.proof!==null||change.resultFingerprint!=null)return fail("VOICE_SETTLEMENT_INVALID",422);return update(row,"terminal","unknown",null,null,"VOICE_OUTCOME_UNKNOWN");}
        if(row.cpu_json) {
          const cpu=JSON.parse(row.cpu_json);
          if(cpu.phase!=="terminal"||cpu.outcome!==change.outcome||cpu.drained!==true)return fail("VOICE_CPU_RESULT_UNCONFIRMED",403);
          if(change.outcome==="completed"&&(!cpu.resultFingerprint||cpu.resultFingerprint.sha256!==change.resultFingerprint))return fail("VOICE_CPU_RESULT_UNCONFIRMED",403);
        }
        const operation=metadata(row),proof=ports.verifyRetirement(context,structuredClone(operation),change.proof);
        exact(proof,["operationId","owner","identity","retentionId","drained","outcome","resultFingerprint"]);
        if(proof.operationId!==row.operation_id||!equal(owner(proof.owner),operation.owner)||proof.drained!==true||!uuid(proof.retentionId)
          ||proof.outcome!==change.outcome||!equal(proof.identity,operation.original.cpuIdentity)||proof.resultFingerprint!==(change.resultFingerprint??null))return fail("VOICE_RETIREMENT_UNCONFIRMED",403);
        if(proof.identity!==null)validateCpuIdentity(proof.identity);
        if(row.cpu_json&&JSON.parse(row.cpu_json).retentionId!==proof.retentionId)return fail("VOICE_RETIREMENT_UNCONFIRMED",403);
        if(change.resultFingerprint&&row.deadline_at<=ports.now())return fail("VOICE_RESULT_EXPIRED",403);
        if(row.state==="reserved"&&change.outcome==="completed")return fail("VOICE_DISPATCH_NOT_CLAIMED",403);
        return update(row,"terminal",change.outcome,change.resultFingerprint??null,proof.retentionId);
      });
    },
    quarantine(context:C,id:string,expectedRevision:number,reason:string):VoiceMetadata {
      if(!text(reason,64)||!/^[A-Z0-9_]+$/.test(reason))return fail("VOICE_QUARANTINE_CODE_INVALID",422);
      return write(()=>{
        const {row}=requireRow(context,id,"quarantine",false);
        if(!integer(expectedRevision)||expectedRevision!==row.revision)return fail("VOICE_REVISION_CONFLICT");
        if(row.state==="terminal"||row.state==="quarantined")return metadata(row);
        return update(row,"terminal","unknown",null,null,reason);
      });
    },
  };
  return Object.assign(publicLedger,{reserveOriginalAssistantSource:sources.reserveOriginalAssistantSource,reserveAttachedAssistantTts:sources.reserveAttachedAssistantTts,spendOriginalAssistantSource:sources.spendOriginalAssistantSource,fenceOriginalAssistantSources:sources.fenceOriginalAssistantSources,requireOriginalAssistantCpuLive:sources.requireOriginalAssistantCpuLive},createVoiceCpuExtension(ports,{get,write,authorize,metadata,update,reserve:publicLedger.reserve,requireOriginalAssistantCpuLive:sources.requireOriginalAssistantCpuLive,canonical,digest,equal,owner,uuid,hash,integer,text,exact,fail}));
}
