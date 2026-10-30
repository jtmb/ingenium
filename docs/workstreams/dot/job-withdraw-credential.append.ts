
/** Narrow self-withdrawal remains available after expiry/revocation. Never resolves an Auth principal. */
export function withdrawManagedJobDispatch(token:string,input:{runId:string;attemptId:string;reason:string}):{withdrawalRecorded:true;wholeContainerRetired:false}|undefined {
 if(!/^ing_[A-Za-z0-9_-]{12}_[A-Za-z0-9_-]{43}$/.test(token)||!input||Object.keys(input).sort().join("|")!=="attemptId|reason|runId"||!["CORE126_JOB_ENFORCEMENT_LOST","CORE126_JOB_PLUGIN_UNLOADED","CORE126_JOB_PARENT_STOP"].includes(input.reason))return undefined;
 const result=execTransaction(()=>{
  const db=getDb(process.env.INGENIUM_CORE_DB_PATH);
  const row=db.prepare(`SELECT credential.id,credential.run_id,credential.attempt_id,ledger.project_id,ledger.phase
   FROM job_run_mcp_credentials credential JOIN job_run_managed_execution ledger
   ON ledger.run_id=credential.run_id AND ledger.attempt_id=credential.attempt_id AND ledger.credential_id=credential.id
   JOIN job_runs run ON run.id=ledger.run_id AND run.project_id=ledger.project_id AND run.effective_service_principal_id=credential.service_principal_id
   WHERE credential.token_hash=? AND credential.kind='job-run' AND credential.audience='job-run'
    AND credential.run_id=? AND credential.attempt_id=?`).get(hashSecurityToken(token),input.runId,input.attemptId) as {id:string;run_id:string;attempt_id:string;project_id:string;phase:string}|undefined;
  if(!row)return undefined;
  const now=new Date().toISOString();
  if(row.phase!=="retired"){
   db.prepare("UPDATE job_run_managed_execution SET phase='cancel_requested',revision=revision+1,updated_at=? WHERE run_id=? AND attempt_id=? AND credential_id=? AND phase NOT IN ('retired','cancel_requested')").run(now,row.run_id,row.attempt_id,row.id);
   db.prepare("UPDATE veyra_dot_records SET revision=revision+1,body=json_set(body,'$.state','cancel_requested','$.revision',revision+1,'$.updatedAt',?) WHERE kind='operation' AND json_extract(body,'$.runId')=? AND json_extract(body,'$.scope.projectId')=? AND json_extract(body,'$.state') NOT IN ('cancel_requested','success','failed','cancelled','skipped')").run(now,row.run_id,row.project_id);
  }
  db.prepare("UPDATE job_run_mcp_credentials SET revoked_at=COALESCE(revoked_at,?) WHERE id=? AND run_id=? AND attempt_id=?").run(now,row.id,row.run_id,row.attempt_id);
  return {withdrawalRecorded:true as const,wholeContainerRetired:false as const};
 });if(result)checkpointAfterWrite();return result;
}
