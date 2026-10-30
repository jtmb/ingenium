import {candidateInertIntentHash} from '../../../../tools/veyra-release/core126-candidate-intent.mjs';
import {parseStrictJobJson} from './job-bootstrap-frame.mjs';
const fail=code=>{throw Object.assign(Error(code),{code,status:503});};
/** Persisted data discrimination ONLY. Never issues an original lease or approval. */
export function describeStoredManagedPurpose(row){
 if(!row||!['production','candidate-inert-v1'].includes(row.purpose))fail('MANAGED_JOB_PURPOSE_UNAVAILABLE');
 if(row.purpose==='production'){
  if(typeof row.profile_id!=='string'||!row.profile_id||typeof row.profile_hash!=='string'||!/^[a-f0-9]{64}$/.test(row.profile_hash)||row.candidate_intent_json!==null||row.candidate_intent_hash!==null)fail('MANAGED_JOB_PURPOSE_BINDING_UNAVAILABLE');
  return Object.freeze({purpose:'production',candidateIntentHash:null});
 }
 if(row.profile_id!==null||row.profile_hash!==null||typeof row.candidate_intent_json!=='string'||Buffer.byteLength(row.candidate_intent_json)>65536||typeof row.candidate_intent_hash!=='string')fail('MANAGED_JOB_PURPOSE_BINDING_UNAVAILABLE');
 const intent=parseStrictJobJson(Buffer.from(row.candidate_intent_json),65536);
 if(candidateInertIntentHash(intent)!==row.candidate_intent_hash)fail('MANAGED_JOB_PURPOSE_BINDING_UNAVAILABLE');
 const pairs=[[intent.run.runId,row.run_id],[intent.run.jobId,row.job_id],[intent.run.attemptId,row.attempt_id],[intent.run.runIdentityHash,row.run_identity_hash],[intent.run.jobRevision,row.job_revision],[intent.run.scheduleRevision,row.schedule_revision],[intent.run.promptHash,row.prompt_hash],[intent.scope.organizationId,row.organization_id],[intent.scope.projectId,row.project_id],[intent.scope.ownerUserId,row.owner_user_id],[intent.scope.workspaceId,row.workspace_id],[intent.scope.bindingHash,row.binding_hash],[intent.scope.bindingEpoch,row.binding_epoch],[intent.scope.grantRevision,row.grant_revision],[intent.parent.runtimeId,row.runtime_id],[intent.parent.containerId,row.parent_container_id],[intent.parent.daemonId,row.daemon_id],[intent.parent.provisioningRevision,row.provisioning_revision],[intent.imageId,row.image_id],[intent.resource.admissionId,row.resource_admission_id],[intent.resource.runtimeRevision,row.runtime_revision],[intent.expiresAt,row.deadline_at]];
 if(pairs.some(([a,b])=>a!==b))fail('MANAGED_JOB_PURPOSE_BINDING_UNAVAILABLE');
 return Object.freeze({purpose:'candidate-inert-v1',candidateIntentHash:row.candidate_intent_hash});
}
export function requireProductionManagedPurpose(row){
 const descriptor=describeStoredManagedPurpose(row);
 if(descriptor.purpose!=='production')fail('MANAGED_JOB_ORIGINAL_CANDIDATE_LEASE_UNAVAILABLE');
 return descriptor;
}
