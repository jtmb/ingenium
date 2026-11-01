/** Original Core authority for an already-approved Dot operation.
 * The empty handle is meaningful only in this process and on this exact DB.
 * It is not an AuthPrincipal, HTTP credential, tool grant or image approval. */
import {createHash} from "node:crypto";
import {getDb,execTransaction,checkpointAfterWrite} from "../db.js";
import * as jobs from "./jobs.js";
import * as runtimes from "./runtimes.js";
import * as context from "./context-conversations.js";
import * as events from "./trusted-job-events.js";

type Selection=Readonly<{followupId:string;operationId:string;runId:string}>;
type Scope={organizationId:string;ownerUserId:string;projectId:string;executionBindingId:string;executionBindingFingerprint:string;conversationId:string|null};
type Facts={selection:Selection;scope:Scope;runtimeId:string;automationPrincipalId:string;approvalDigest:string;runIdentityHash:string};
declare const approvedDotOriginal:unique symbol;
export interface ApprovedDotExecutionOriginal {readonly [approvedDotOriginal]:never}
const originals=new WeakMap<object,{db:ReturnType<typeof getDb>;facts:Facts;expiresAt:number;mode:"execute"|"cancel"}>();
const deny=():never=>{throw Object.assign(Error("DOT_ORIGINAL_DELEGATION_UNAVAILABLE"),{code:"DOT_ORIGINAL_DELEGATION_UNAVAILABLE",status:503});};
const hash=(v:unknown)=>createHash("sha256").update(typeof v==="string"?v:JSON.stringify(v)).digest("hex");
const text=(v:unknown):v is string=>typeof v==="string"&&v.length>0&&v.length<=512&&!/[\u0000-\u001f\u007f]/u.test(v);
const parse=(v:unknown):Record<string,any>=>{if(typeof v!=="string"||Buffer.byteLength(v)>65536)return deny();try{const r=JSON.parse(v);if(!r||typeof r!=="object"||Array.isArray(r))return deny();return r;}catch{return deny();}};
const key=(s:Scope)=>JSON.stringify([s.organizationId,s.ownerUserId,s.projectId,s.executionBindingId,s.executionBindingFingerprint,s.conversationId]);
const runIdentity=(run:Record<string,any>)=>hash([run.id,run.job_id,run.project_id,run.organization_id,run.effective_service_principal_id,run.job_revision,run.schedule_revision??null,run.authorization_revision,run.trigger,run.scheduled_for??null,run.created_at]);
function read(selection:Selection,mode:"execute"|"cancel",purpose:"production"|"candidate-inert-v1"="production"):Facts{
 const db=getDb(),record=(kind:string,id:string)=>db.prepare("SELECT id,organization_id,owner_user_id,scope_key,revision,body FROM veyra_dot_records WHERE kind=? AND id=?").get(kind,id) as Record<string,any>|undefined;
 const fr=record("followup",selection.followupId),f=fr&&parse(fr.body),sr=f&&record("suggestion",f.suggestionId),s=sr&&parse(sr.body),or=record("operation",selection.operationId),op=or&&parse(or.body);
 if(!fr||!f||!sr||!s||!or||!op||(s.state!=="approved"&&!(purpose==="candidate-inert-v1"&&mode==="cancel"))||f.id!==fr.id||s.id!==f.suggestionId||s.id!==f.id||op.id!==or.id||op.followupId!==f.id||op.runId!==selection.runId)return deny();
 if(mode==="execute"?(f.state!=="active"||!["claimed","running"].includes(op.state)):(!["active","paused","cancelled"].includes(f.state)||!["claimed","running","unknown","cancel_requested","success","failed","cancelled"].includes(op.state)))return deny();
 const marker=op.managedDispatch;
 if(purpose==="candidate-inert-v1"){
  if(!marker||Object.keys(marker).sort().join("|")!=="fence|protocol|runIdentityHash"||marker.protocol!=="core126-candidate-original-v1"||!["not-admitted-v1","core-owner-admitted-v1"].includes(marker.fence)||mode==="cancel"&&marker.fence!=="core-owner-admitted-v1")return deny();
 }else if(marker?.protocol==="core126-candidate-original-v1")return deny(); // Candidate never acquires production delegation.
 const scope=f.scope as Scope;
 if(!scope||![scope.organizationId,scope.ownerUserId,scope.projectId,scope.executionBindingId].every(text)||!/^[a-f0-9]{64}$/.test(scope.executionBindingFingerprint)||scope.conversationId!==null&&!text(scope.conversationId))return deny();
 const sk=key(scope);for(const r of [fr,sr,or])if(r.organization_id!==scope.organizationId||r.owner_user_id!==scope.ownerUserId||r.scope_key!==sk)return deny();
 if(key(s.scope)!==sk||key(op.scope)!==sk||f.revision!==fr.revision||s.revision!==sr.revision||op.revision!==or.revision)return deny();
 const job=jobs.getJob(scope.projectId,f.jobId),run=jobs.getJobRun(scope.projectId,selection.runId);
 if(!run||run.id!==selection.runId||run.job_id!==f.jobId||run.organization_id!==scope.organizationId||run.project_id!==scope.projectId||run.job_revision!==f.jobRevision||run.schedule_revision!==f.scheduleRevision)return deny();
 if(purpose==="candidate-inert-v1"&&marker.runIdentityHash!==runIdentity(run))return deny();
 if(mode==="cancel"){
  // Safety-reducing intent uses the retained original ledger, not current private
  // source access or a fabricated automation read scope. It proves no retirement.
  const ledger=db.prepare("SELECT run_id,attempt_id,job_id,project_id,organization_id,owner_user_id,workspace_id,runtime_id,parent_container_id,run_identity_hash,purpose FROM job_run_managed_execution WHERE run_id=?").get(run.id) as Record<string,any>|undefined;
  if(!ledger||ledger.run_identity_hash!==runIdentity(run)||ledger.purpose!==purpose||ledger.job_id!==f.jobId||ledger.project_id!==scope.projectId||ledger.organization_id!==scope.organizationId||ledger.owner_user_id!==scope.ownerUserId||ledger.workspace_id!==scope.executionBindingId||!text(ledger.runtime_id)||!text(ledger.parent_container_id))return deny();
  let candidateBinding:Readonly<{specHash:string;selectionSha256:string}>|undefined;
  if(purpose==="candidate-inert-v1"){
   // Negative control uses the retained canonical candidate ledger, not current
   // source/image approval, private conversation access or an execution handle.
   const retained=db.prepare("SELECT candidate_waiting_protocol,candidate_intent_hash,spec_hash,admission_json FROM job_run_managed_execution WHERE run_id=?").get(run.id) as Record<string,any>|undefined;
   const lifecycle=db.prepare("SELECT * FROM job_run_candidate_lifecycle WHERE run_id=?").get(run.id) as Record<string,any>|undefined;
   if(!retained||!lifecycle||retained.candidate_waiting_protocol!=="original-candidate-waiting-v1")return deny();
   const admission=parse(retained.admission_json),{specHash,...beforeSpec}=admission;
   if(admission.purpose!==purpose||admission.runId!==run.id||admission.attemptId!==ledger.attempt_id||admission.projectId!==scope.projectId||admission.organizationId!==scope.organizationId||admission.ownerUserId!==scope.ownerUserId||admission.jobId!==f.jobId||admission.runtimeId!==ledger.runtime_id||admission.workspaceId!==ledger.workspace_id||admission.parentContainerId!==ledger.parent_container_id||!/^[a-f0-9]{64}$/.test(specHash??"")||hash(beforeSpec)!==specHash||specHash!==retained.spec_hash||admission.candidateIntentHash!==retained.candidate_intent_hash||!/^[a-f0-9]{64}$/.test(admission.candidateIntentHash??"")||!/^[a-f0-9]{64}$/.test(admission.selectionSha256??""))return deny();
   if(lifecycle.run_id!==run.id||lifecycle.attempt_id!==ledger.attempt_id||lifecycle.run_identity_hash!==ledger.run_identity_hash||lifecycle.project_id!==scope.projectId||lifecycle.organization_id!==scope.organizationId||lifecycle.owner_user_id!==scope.ownerUserId||lifecycle.job_id!==f.jobId||lifecycle.runtime_id!==ledger.runtime_id||lifecycle.workspace_id!==ledger.workspace_id||lifecycle.parent_container_id!==ledger.parent_container_id||lifecycle.spec_hash!==specHash||lifecycle.candidate_intent_hash!==retained.candidate_intent_hash||lifecycle.selection_sha256!==admission.selectionSha256||lifecycle.deadline_at!==admission.deadlineAt)return deny();
   candidateBinding={specHash,selectionSha256:admission.selectionSha256};
  }
  if(getDb()!==db)return deny();
  return {selection:{...selection},scope:{...scope},runtimeId:ledger.runtime_id,automationPrincipalId:run.effective_service_principal_id,approvalDigest:hash(candidateBinding?[fr,sr,or,ledger,candidateBinding]:[fr,sr,or,ledger]),runIdentityHash:ledger.run_identity_hash};
 }
 if(!job||job.id!==run.job_id||job.organization_id!==scope.organizationId||job.project_id!==scope.projectId||run.effective_service_principal_id!==job.service_principal_id||job.owner_kind==="user"&&job.owner_user_id!==scope.ownerUserId||job.visibility==="private"&&job.owner_user_id!==scope.ownerUserId||job.prompt_template!==s.prompt)return deny();
 if(mode==="execute"&&(!["running","queued"].includes(run.status)||!job.enabled||job.revision!==run.job_revision||job.schedule_revision!==run.schedule_revision||!jobs.isJobRunAuthorizationCurrent(scope.projectId,run.id)))return deny();
 const member=db.prepare("SELECT u.security_epoch,m.role,pm.role AS project_role FROM users u JOIN organization_memberships m ON m.user_id=u.id AND m.organization_id=? AND m.status='active' LEFT JOIN project_memberships pm ON pm.project_id=? AND pm.user_id=u.id WHERE u.id=? AND u.status='active'").get(scope.organizationId,scope.projectId,scope.ownerUserId) as Record<string,any>|undefined;
 if(mode==="execute"&&(!member||!["owner","admin"].includes(member.role)&&!(member.role!=="viewer"&&member.project_role==="editor")))return deny();
 const ref=parse(s.source?.reference),source=s.source?.kind;
 let chatId=scope.conversationId??ref.chatId,ev:ReturnType<typeof events.getTrustedJobEvent>;
 if(source==="event"){ev=events.getTrustedJobEvent(scope.projectId,ref.id);chatId=ev?.payload&&typeof ev.payload==="object"?((ev.payload as Record<string,unknown>).targetConversationId??(ev.payload as Record<string,unknown>).conversationId):undefined;}
 // Memory delegation requires the existing private policy/source-read owner too;
 // it cannot be inferred from a persisted memory ID or an approval digest.
 if(source!=="user"&&source!=="event")return deny();
 if(!text(chatId)||scope.conversationId!==null&&chatId!==scope.conversationId||source==="user"&&ref.chatId!==chatId)return deny();
 const chat=context.getContextConversation(scope.projectId,chatId),meta=chat&&parse(chat.metadata);
 if(!chat||!meta||chat.id!==chatId||chat.project_id!==scope.projectId||chat.organization_id!==scope.organizationId||chat.owner_user_id!==scope.ownerUserId||chat.visibility!=="private"||meta.source!=="opencode-chat"||!text(meta.sourceRuntimeId)||!text(meta.sourceSessionId))return deny();
 const archive=db.prepare("SELECT event_type FROM context_checkpoint_audit_events WHERE project_id=? AND conversation_id=? AND archive_sequence IS NOT NULL ORDER BY archive_sequence DESC LIMIT 1").get(scope.projectId,chatId) as {event_type:string}|undefined;
 if(mode==="execute"&&archive&&archive.event_type!=="conversation_unarchived")return deny();
 if(source==="user"){
  const m=context.getContextMessage(scope.projectId,chatId,ref.id),mm=m&&parse(m.metadata);
  if(!m||!mm||m.id!==ref.id||m.project_id!==scope.projectId||m.conversation_id!==chatId||m.role!=="user"||m.content_hash!==ref.hash||hash(m.content)!==ref.hash||mm.source!=="opencode-chat"||mm.sourceRuntimeId!==meta.sourceRuntimeId||mm.sourceSessionId!==meta.sourceSessionId)return deny();
 }else if(!ev||ev.producer!=="context.maintenance"||ev.schema_version!==1||hash([ev.id,ev.project_id,ev.event_type,ev.schema_version,ev.producer,ev.source_audit_event_id,ev.created_at,ev.payload,meta.sourceSessionId])!==ref.hash)return deny();
 const w=runtimes.getAuthorizedWorkspace(scope.executionBindingId),r=runtimes.getRuntimeInstance(meta.sourceRuntimeId);
 if(!w||!r||w.id!==scope.executionBindingId||r.id!==meta.sourceRuntimeId||w.organizationId!==scope.organizationId||w.projectId!==scope.projectId||w.ownerUserId!==scope.ownerUserId||r.organizationId!==scope.organizationId||r.projectId!==scope.projectId||r.ownerUserId!==scope.ownerUserId||r.workspaceId!==w.id||r.securityEpoch!==w.securityEpoch)return deny();
 if(mode==="execute"&&(w.status!=="authorized"||!["READY","IDLE"].includes(r.state)||[r.absoluteExpiresAt,r.idleExpiresAt].some(t=>!Number.isFinite(Date.parse(t??""))||Date.parse(t!)<=Date.now())))return deny();
 const facts:Facts={selection:{...selection},scope:{...scope},runtimeId:r.id,automationPrincipalId:run.effective_service_principal_id,
  approvalDigest:hash([fr,sr,or,member??null,chat,archive??null,w,r]),runIdentityHash:runIdentity(run)};
 if(getDb()!==db)return deny();return facts;
}
export function acquireApprovedDotExecutionOriginal(selection:Selection,mode:"execute"|"cancel"="execute"):ApprovedDotExecutionOriginal{
 if(!selection||Object.keys(selection).sort().join("|")!=="followupId|operationId|runId"||!Object.values(selection).every(text)||!['execute','cancel'].includes(mode))return deny();
 const db=getDb(),facts=read(selection,mode),handle=Object.freeze({});originals.set(handle,{db,facts,mode,expiresAt:Date.now()+30000});return handle as ApprovedDotExecutionOriginal;
}
export function requireApprovedDotExecutionOriginal(handle:ApprovedDotExecutionOriginal,expected:{runId:string;projectId:string;runtimeId:string;workspaceId:string},action:"execute"|"cancel"):Readonly<Facts>{
 const original=handle&&originals.get(handle);if(!original||original.db!==getDb()||original.expiresAt<=Date.now()||action!==original.mode)return deny();
 const actual=read(original.facts.selection,action);if(JSON.stringify(actual)!==JSON.stringify(original.facts)||expected.runId!==actual.selection.runId||expected.projectId!==actual.scope.projectId||expected.runtimeId!==actual.runtimeId||expected.workspaceId!==actual.scope.executionBindingId)return deny();
 return structuredClone(actual);
}
/** Safety-reducing original Core operation. IDs select existing evidence; they
 * grant no private reads, credentials, launch material or physical retirement.
 * The persisted fence, not ledger absence alone, proves that admission is closed. */
export function closeOriginalUnadmittedDotOperation(selection:Selection):Readonly<{kind:"core-dot-unadmitted-closed-v1";runId:string;operationId:string;runIdentityHash:string;closedAt:string}>|undefined{
 if(!selection||Object.keys(selection).sort().join("|")!=="followupId|operationId|runId"||!Object.values(selection).every(text))return deny();
 const db=getDb();
 const result=execTransaction(()=>{
  if(getDb()!==db)return deny();
  const row=db.prepare("SELECT id,organization_id,owner_user_id,scope_key,revision,body FROM veyra_dot_records WHERE kind='operation' AND id=?").get(selection.operationId) as Record<string,any>|undefined;
  if(!row)return undefined;
  const op=parse(row.body),scope=op.scope as Scope,marker=op.managedDispatch;
  if(!scope||op.id!==row.id||op.runId!==selection.runId||op.followupId!==selection.followupId||row.scope_key!==key(scope)||row.organization_id!==scope.organizationId||row.owner_user_id!==scope.ownerUserId||op.revision!==row.revision||!marker||Object.keys(marker).sort().join("|")!=="fence|protocol|runIdentityHash"||!["core126-original-v1","core126-candidate-original-v1"].includes(marker.protocol))return deny();
  const run=jobs.getJobRun(scope.projectId,selection.runId);
  if(!run||run.id!==selection.runId||run.project_id!==scope.projectId||run.organization_id!==scope.organizationId||marker.runIdentityHash!==runIdentity(run))return deny();
  if(marker.fence==="core-owner-admitted-v1")return undefined;
  if(marker.fence==="closed-unadmitted-v1"){
   if(run.status!=="cancelled"||op.state!=="cancelled"||op.code!=="CORE126_ORIGINAL_UNADMITTED_CLOSED")return deny();
   return {kind:"core-dot-unadmitted-closed-v1" as const,runId:run.id,operationId:op.id,runIdentityHash:marker.runIdentityHash,closedAt:op.updatedAt};
  }
  if(marker.fence!=="not-admitted-v1"||db.prepare("SELECT 1 FROM job_run_managed_execution WHERE run_id=?").get(run.id))return deny();
  jobs.cancelJobRun(scope.projectId,run.id);
  const after=jobs.getJobRun(scope.projectId,run.id);
  if(!after||after.status!=="cancelled"||runIdentity(after)!==marker.runIdentityHash||getDb()!==db)return deny();
  const now=new Date().toISOString(),next={...op,revision:row.revision+1,state:"cancelled",code:"CORE126_ORIGINAL_UNADMITTED_CLOSED",updatedAt:now,managedDispatch:{...marker,fence:"closed-unadmitted-v1"}};
  const changed=db.prepare("UPDATE veyra_dot_records SET revision=?,body=? WHERE kind='operation' AND id=? AND revision=?").run(next.revision,JSON.stringify(next),op.id,row.revision);
  if(Number(changed.changes)!==1)return deny();
  return {kind:"core-dot-unadmitted-closed-v1" as const,runId:run.id,operationId:op.id,runIdentityHash:marker.runIdentityHash,closedAt:now};
 },1);
 if(result)checkpointAfterWrite();
 return result;
}

/** Separate immutable-purpose Core original. It can authorize only Root's
 * candidate source/prepare path; production APIs cannot consume this brand. */
declare const candidateDotOriginal:unique symbol;
export interface CandidateDotExecutionOriginal {readonly [candidateDotOriginal]:never}
const candidateOriginals=new WeakMap<object,{db:ReturnType<typeof getDb>;facts:Facts;expiresAt:number}>();
export function acquireCandidateDotExecutionOriginal(selection:Selection):CandidateDotExecutionOriginal{
 if(!selection||Object.keys(selection).sort().join("|")!=="followupId|operationId|runId"||!Object.values(selection).every(text))return deny();
 const db=getDb(),facts=read(selection,"execute","candidate-inert-v1"),handle=Object.freeze({});
 candidateOriginals.set(handle,{db,facts,expiresAt:Date.now()+30000});return handle as CandidateDotExecutionOriginal;
}
export function requireCandidateDotExecutionOriginal(handle:CandidateDotExecutionOriginal,expected:{runId:string;projectId:string;runtimeId:string;workspaceId:string}):Readonly<Facts>{
 const original=handle&&candidateOriginals.get(handle);if(!original||original.db!==getDb()||original.expiresAt<=Date.now())return deny();
 const actual=read(original.facts.selection,"execute","candidate-inert-v1");
 if(JSON.stringify(actual)!==JSON.stringify(original.facts)||expected.runId!==actual.selection.runId||expected.projectId!==actual.scope.projectId||expected.runtimeId!==actual.runtimeId||expected.workspaceId!==actual.scope.executionBindingId)return deny();
 return structuredClone(actual);
}

/** Separate negative-only candidate brand. It can select existing control work
 * after revocation; no execution, private read, material or retirement grant. */
declare const candidateDotControlOriginal:unique symbol;
export interface CandidateDotControlOriginal {readonly [candidateDotControlOriginal]:never}
const candidateControls=new WeakMap<object,{db:ReturnType<typeof getDb>;facts:Facts;expiresAt:number}>();
export function acquireCandidateDotControlOriginal(selection:Selection):CandidateDotControlOriginal{
 if(!selection||Object.keys(selection).sort().join("|")!=="followupId|operationId|runId"||!Object.values(selection).every(text))return deny();
 const db=getDb(),facts=read(selection,"cancel","candidate-inert-v1"),handle=Object.freeze({});candidateControls.set(handle,{db,facts,expiresAt:Date.now()+30000});return handle as CandidateDotControlOriginal;
}
export function requireCandidateDotControlOriginal(handle:CandidateDotControlOriginal,expected:{runId:string;projectId:string;runtimeId:string;workspaceId:string}):Readonly<Facts>{
 const original=handle&&candidateControls.get(handle);if(!original||original.db!==getDb()||original.expiresAt<=Date.now())return deny();
 const actual=read(original.facts.selection,"cancel","candidate-inert-v1");
 if(JSON.stringify(actual)!==JSON.stringify(original.facts)||expected.runId!==actual.selection.runId||expected.projectId!==actual.scope.projectId||expected.runtimeId!==actual.runtimeId||expected.workspaceId!==actual.scope.executionBindingId)return deny();return structuredClone(actual);
}
