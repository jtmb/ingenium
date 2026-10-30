import {createHash} from "node:crypto";
import {parseStrictJobJson} from "./job-bootstrap-frame.mjs";
import {describeStoredManagedPurpose} from "./core126-purpose.mjs";
import {candidateInertIntentHash} from "../../../../tools/veyra-release/core126-candidate-intent.mjs";
import * as original from "./candidate-lifecycle-original-gates.mjs";
const deny=code=>{throw Object.assign(Error(code),{code,status:503});},hex=/^[a-f0-9]{64}$/,uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const exact=(value,names)=>{if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).sort().join("|")!==[...names].sort().join("|"))deny("CORE131_ORIGINAL_FACTS_UNAVAILABLE");};
const readyKeys=["schemaVersion", "kind", "runId", "attemptId", "candidateIntentHash", "specHash", "containerId", "childBirthHash", "childStartHash", "daemonId", "imageId", "catalogSha256", "artifactClosureSha256", "selectionSha256", "attachIdentityHash", "trapAddress", "proxyAddress", "pid", "networkMode", "tty", "observedAt", "expiresAt"];
const resultKeys=["schemaVersion", "kind", "runId", "attemptId", "candidateIntentHash", "specHash", "containerId", "childBirthHash", "childStartHash", "materialReleaseId", "exitCode", "verification", "reportSha256"];
const physicalKeys=["schemaVersion", "kind", "runId", "attemptId", "candidateIntentHash", "specHash", "containerId", "childBirthHash", "childStartHash", "daemonId", "exitCode", "waitJoinSha256", "eofSha256", "retiredAtMs"];
const noCreateKeys=["schemaVersion", "kind", "runId", "attemptId", "candidateIntentHash", "specHash", "createEffectHash", "originalNotSentSha256", "retiredAtMs"];
const readyJson=facts=>{exact(facts,readyKeys);return boundedJson(facts,16384);};
const boundedJson=(value,limit)=>{const bytes=Buffer.from(JSON.stringify(value));if(bytes.length>limit)deny("CORE131_ORIGINAL_FACTS_UNAVAILABLE");parseStrictJobJson(bytes,limit);return bytes.toString("utf8");};
const originalHash=value=>createHash("sha256").update(typeof value==="string"?value:JSON.stringify(value)).digest("hex");
const hash=value=>{if(typeof value!=="string"||!hex.test(value))deny("CORE131_ORIGINAL_FACTS_UNAVAILABLE");return value;};
/** Extension methods run ONLY through the existing Core126 row/write/base/lease
 * closures. No database opener, credentials, scheduler, HTTP auth or fake owner. */
export function createCandidateLifecycleExtension({db,getDb,write,clock,readManagedRow,baseCurrent,originalRunIdentity,jobs,candidateLeases}){
 const same=()=>{if(getDb()!==db)deny("CORE131_DATABASE_REPLACED");};
 const now=()=>{const value=clock().getTime();if(!Number.isSafeInteger(value)||value<0)deny("CORE131_CLOCK_UNAVAILABLE");return value;};
 function requireSchema(){same();if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='managed_candidate_lifecycle_schema'").get()||db.prepare("SELECT schema_version FROM managed_candidate_lifecycle_schema WHERE singleton=1").get()?.schema_version!==1)deny("CORE131_SCHEMA_UNAVAILABLE");}
 function bound(runId){
  requireSchema();if(!uuid.test(runId??""))deny("CORE131_ORIGINAL_UNAVAILABLE");const r=readManagedRow(runId),purpose=r&&describeStoredManagedPurpose(r),c=db.prepare("SELECT * FROM job_run_candidate_lifecycle WHERE run_id=?").get(runId);
  if(!r||purpose.purpose!=="candidate-inert-v1"||r.candidate_waiting_protocol!=="original-candidate-waiting-v1"||!c||c.run_id!==r.run_id||c.attempt_id!==r.attempt_id||c.candidate_intent_hash!==purpose.candidateIntentHash||c.spec_hash!==r.spec_hash||c.run_identity_hash!==r.run_identity_hash||c.deadline_at!==r.deadline_at||c.deadline_ms!==Date.parse(r.deadline_at))deny("CORE131_ORIGINAL_UNAVAILABLE");
  const a=parseStrictJobJson(Buffer.from(r.admission_json),65536),intent=parseStrictJobJson(Buffer.from(r.candidate_intent_json),65536),run=jobs.getJobRun(r.project_id,r.run_id);
  if(!run||originalRunIdentity(run)!==c.run_identity_hash||candidateInertIntentHash(intent)!==c.candidate_intent_hash||a.selectionSha256!==c.selection_sha256||a.specHash!==c.spec_hash||a.attemptId!==c.attempt_id||a.deadlineAt!==c.deadline_at)deny("CORE131_ORIGINAL_UNAVAILABLE");
  return {r,c,a,intent,selection:{runId:r.run_id,projectId:r.project_id,runtimeId:r.runtime_id,workspaceId:r.workspace_id},binding:Object.freeze({runId:r.run_id,attemptId:r.attempt_id,candidateIntentHash:c.candidate_intent_hash,specHash:c.spec_hash,selectionSha256:c.selection_sha256,deadlineAt:c.deadline_at,deadlineMs:c.deadline_ms,runIdentityHash:c.run_identity_hash,organizationId:c.organization_id,ownerUserId:c.owner_user_id,projectId:c.project_id,jobId:c.job_id,runtimeId:c.runtime_id,parentContainerId:c.parent_container_id,workspaceId:c.workspace_id,bindingHash:c.binding_hash,bindingEpoch:c.binding_epoch,daemonId:c.daemon_id,imageId:c.image_id,artifactClosureSha256:c.artifact_closure_sha256,catalogSha256:c.catalog_sha256,containerId:c.child_id,childBirthHash:c.child_birth_hash,childStartHash:c.child_start_hash,createEffectHash:c.create_effect_hash,attachIdentityHash:c.attach_identity_hash})};
 }
 function current(value,context){
  // Fixed missing constructor refuses. Root must compare refreshed actual source
  // selection/intent to these ORIGINAL persisted hashes, never remint prepare.
  if(original.requireOriginalCandidateLifecycleCurrent(context,value.binding)!==undefined)deny("CORE131_CURRENT_CONTEXT_UNAVAILABLE");
  const facts=baseCurrent(value.selection,context,"candidate-inert-v1");
  if(now()>=value.c.deadline_ms||originalHash(facts.agentConfig)!==value.a.agentHash||originalHash(facts.job.prompt_template)!==value.a.promptHash||originalRunIdentity(facts.run)!==value.c.run_identity_hash||facts.runtime.revision!==value.a.runtimeRevision||facts.runtime.backendContainerId!==value.a.parentContainerId||facts.workspace.storageMappingHash!==value.a.bindingHash||facts.workspace.securityEpoch!==value.a.bindingEpoch||facts.principalEpoch!==value.a.principalSecurityEpoch)deny("CORE131_CURRENT_BINDING_UNAVAILABLE");
 }
 const control=(value,context)=>{if(original.requireOriginalCandidateLifecycleControl(context,value.binding)!==undefined)deny("CORE131_CONTROL_CONTEXT_UNAVAILABLE");};
 function prepared(runId){const value=bound(runId);if(value.c.phase!=="prepared"||value.c.cancel_requested_ms!==null||value.c.unknown_ms!==null||now()>=value.c.deadline_ms)deny("CORE131_PREPARED_UNAVAILABLE");return value;}
 function lease(key){const saved=key&&candidateLeases.get(key);if(!saved||saved.db!==db)deny("CORE131_ORIGINAL_LEASE_UNAVAILABLE");const value=prepared(saved.intent.run.runId);if(value.r.admission_json!==JSON.stringify(saved.admission)||value.c.selection_sha256!==saved.selectionSha256||candidateInertIntentHash(saved.intent)!==value.c.candidate_intent_hash)deny("CORE131_ORIGINAL_LEASE_UNAVAILABLE");return value;}
 const metadata=value=>Object.freeze({purpose:"candidate-inert-v1",runId:value.c.run_id,attemptId:value.c.attempt_id,candidateIntentHash:value.c.candidate_intent_hash,specHash:value.c.spec_hash,phase:value.c.phase,revision:value.c.revision,containerId:value.c.child_id,childBirthHash:value.c.child_birth_hash,deadlineAt:value.c.deadline_at,unknown:value.c.unknown_ms!==null,retirementRecorded:value.c.phase==="retired"});
 function cas(value,phase,fields){
  const names=Object.keys(fields);if(names.some(k=>!["create_effect_hash","child_id","child_birth_hash","child_created_ms","start_effect_hash","attach_identity_hash","child_start_hash","child_started_ms","readiness_json","ready_observed_ms","ready_expires_ms","material_release_id","material_spent_ms","material_readiness_json","material_ready_observed_ms","material_ready_expires_ms","result_json","unknown_code","unknown_ms","cancel_requested_ms","retirement_json","retired_ms"].includes(k)))deny("CORE131_INVALID_WRITE");
  const timestamp=now(),changed=db.prepare("UPDATE job_run_candidate_lifecycle SET phase=?,"+names.map(k=>k+"=?").join(",")+(names.length?",":"")+"revision=revision+1,updated_ms=? WHERE run_id=? AND attempt_id=? AND candidate_intent_hash=? AND spec_hash=? AND revision=? AND phase=?").run(phase,...names.map(k=>fields[k]),timestamp,value.c.run_id,value.c.attempt_id,value.c.candidate_intent_hash,value.c.spec_hash,value.c.revision,value.c.phase);
  if(Number(changed.changes)!==1)deny("CORE131_REVISION_CONFLICT");return metadata(bound(value.c.run_id));
 }
 function transition(runId,context,handle,mode,method,next,fields){
  const before=bound(runId);mode==="current"?current(before,context):control(before,context);
  return write(()=>{const value=bound(runId);mode==="current"?current(value,context):control(value,context);const facts=original[method](handle,value.binding);return cas(value,typeof next==="function"?next(value):next,fields(facts,value));});
 }
 return Object.freeze({requireSchema,requirePrepared(runId){return metadata(prepared(runId));},
  inspect(runId,context){const value=bound(runId);control(value,context);return metadata(value);},
  createIntent(key,context,handle){const value=lease(key);return transition(value.c.run_id,context,handle,"current","requireOriginalCandidateCreateIntent","create_intent",facts=>{exact(facts,["createEffectHash"]);return{create_effect_hash:hash(facts.createEffectHash)};});},
  bindChild:(runId,context,handle)=>transition(runId,context,handle,"control","requireOriginalCandidateChild",value=>value.c.phase==="unknown"?"unknown":"created",facts=>{exact(facts,["containerId","childBirthHash","createdAtMs"]);return{child_id:hash(facts.containerId),child_birth_hash:hash(facts.childBirthHash),child_created_ms:facts.createdAtMs};}),
  startIntent:(runId,context,handle)=>transition(runId,context,handle,"current","requireOriginalCandidateAttachIntent","start_intent",facts=>{exact(facts,["startEffectHash","attachIdentityHash"]);return{start_effect_hash:hash(facts.startEffectHash),attach_identity_hash:hash(facts.attachIdentityHash)};}),
  observeWaiting:(runId,context,handle)=>transition(runId,context,handle,"control","requireOriginalCandidateWaiting",value=>value.c.phase==="unknown"?"unknown":"waiting",facts=>{exact(facts,["childStartHash","startedAtMs"]);return{child_start_hash:hash(facts.childStartHash),child_started_ms:facts.startedAtMs};}),
  observeReady:(runId,context,handle)=>transition(runId,context,handle,"current","requireOriginalCandidateReady","ready",facts=>({readiness_json:readyJson(facts),ready_observed_ms:facts.observedAt,ready_expires_ms:facts.expiresAt})),
  commitOriginalMaterial:(runId,context,handle)=>transition(runId,context,handle,"current","spendOriginalCandidateMaterial","material_spent",facts=>{exact(facts,["releaseId","spentAtMs","readiness"]);if(typeof facts.releaseId!=="string"||!uuid.test(facts.releaseId))deny("CORE131_ORIGINAL_FACTS_UNAVAILABLE");return{material_release_id:facts.releaseId,material_spent_ms:facts.spentAtMs,material_readiness_json:readyJson(facts.readiness),material_ready_observed_ms:facts.readiness.observedAt,material_ready_expires_ms:facts.readiness.expiresAt};}),
  observeRunning:(runId,context,handle)=>transition(runId,context,handle,"current","requireOriginalCandidateRunning","running",facts=>{exact(facts,[]);return{};}),
  recordResult:(runId,context,handle)=>transition(runId,context,handle,"control","requireOriginalCandidateResult","result",facts=>{exact(facts,resultKeys);return{result_json:boundedJson(facts,4096)};}),
  cancel(runId,context){const before=bound(runId);control(before,context);return write(()=>{const value=bound(runId);control(value,context);if(value.c.cancel_requested_ms!==null)return metadata(value);return cas(value,value.c.phase,{cancel_requested_ms:now()});});},
  unknown:(runId,context,handle)=>transition(runId,context,handle,"control","requireOriginalCandidateUnknown","unknown",facts=>{exact(facts,["code","observedAtMs"]);return{unknown_code:facts.code,unknown_ms:facts.observedAtMs};}),
  retire:(runId,context,handle)=>transition(runId,context,handle,"control","requireOriginalCandidateRetirement","retired",facts=>{exact(facts,facts?.kind==="original-candidate-no-create-v1"?noCreateKeys:physicalKeys);return{retirement_json:boundedJson(facts,8192),retired_ms:facts.retiredAtMs};}),
 });
}
