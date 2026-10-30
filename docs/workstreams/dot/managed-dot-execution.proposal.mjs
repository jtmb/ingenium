// AsyncCoreDotExecution adapter. Core owns all records/grants and the original claim; manager owns Docker only.
export function createManagedDotExecution({core,manager}){
 const fail=code=>{throw Object.assign(Error(code),{code});};
 const owned=async(scope,run)=>{if(core.inTransaction())fail("DOT_OUTER_TRANSACTION_UNSUPPORTED");const current=await core.requireOriginalRun(scope,run.id);if(current.id!==run.id||current.job_id!==run.job_id||current.project_id!==run.project_id||current.organization_id!==run.organization_id)fail("DOT_RUN_BINDING_CHANGED");return current;};
 return Object.freeze({
  async executeJobRun(runId,job,prompt){
   if(core.inTransaction())fail("DOT_OUTER_TRANSACTION_UNSUPPORTED");
   // This does NOT call startJobRun. Existing core-binding already committed original JobRun and Dot operation.
   const admission=await core.prepareManagedExecution(runId,job,prompt);
   if(core.inTransaction()||admission.runId!==runId||admission.jobId!==job.id||admission.projectId!==job.project_id||admission.jobRevision!==job.revision||admission.scheduleRevision!==job.schedule_revision)fail("DOT_RUN_BINDING_CHANGED");
   const result=await manager.launchManagedJobRun(runId,admission.runtimeId);
   if(result.state!=="active")fail("DOT_MANAGED_LAUNCH_OUTCOME_UNKNOWN");
  },
  async requestCancellation(scope,run){await owned(scope,run);await core.requireCancellationIntent(scope,run.id);await manager.cancelManagedJobRun(run.id);},
  async inspectOwnedRun(scope,run){
   await owned(scope,run);const observation=await manager.inspectManagedJobRun(run.id);
   if(observation.state==="active")return "running";if(observation.state!=="settled")return "unknown";
   await core.requireOriginalRetirementProof(run.id,observation.proof);
   const latest=await owned(scope,run); // Never equate wait/exit zero with a verified model response.
   return latest.status==="success"?"success":latest.status==="failed"||latest.status==="timeout"?"failed":latest.status==="cancelled"?"cancelled":"unknown";
  },
 });
}
