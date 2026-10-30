// Existing manager identity calls the proposed Core-only execution journal endpoints.
// This client never reads/writes a database or accepts an owner/container/command from a public request.
export function createManagedJobCoreClient({apiUrl,managerToken,fetchOwner=fetch}){
 const base=new URL(apiUrl);if(base.protocol!=="http:"||base.username||base.password||base.pathname!=="/api/v1"||base.search||base.hash||!/^[a-z0-9][a-z0-9.-]*$/i.test(base.hostname)||!managerToken)throw Error("Managed JobRun Core authority unavailable");
 async function request(runId,operation,body,action){
  const url=new URL(base);url.pathname+=`/internal/managed-job-runs/${encodeURIComponent(runId)}/${operation}`;if(action)url.searchParams.set("action",action);
  const response=await fetchOwner(url,{method:body===undefined?"GET":"POST",redirect:"error",headers:{Authorization:`Bearer ${managerToken}`,Accept:"application/json",...(body===undefined?{}:{"Content-Type":"application/json"})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30_000)});
  if(!response.ok){await response.body?.cancel();throw Object.assign(Error("Managed JobRun Core authority rejected operation"),{code:"MANAGED_JOB_CORE_UNAVAILABLE"});}
  const data=await response.json();if(!data||typeof data!=="object"||!("data" in data))throw Error("Managed JobRun Core response invalid");return data.data;
 }
 const key=a=>({attemptId:a.attemptId,revision:a.revision,specHash:a.specHash});
 return Object.freeze({
  admit:(runId,action)=>request(runId,"admission",undefined,action),
  claimEffect:async(a,kind)=>{const result=await request(a.runId,"effect-intent",{...key(a),kind});return result?.accepted===true;},
  recordCreated:(a,containerId)=>request(a.runId,"created",{...key(a),containerId}),
  recordStarted:a=>request(a.runId,"started",key(a)),
  recordUnknown:(a,phase)=>request(a.runId,"unknown",{...key(a),phase}),
  recordRetired:(a,proof)=>request(a.runId,"retired",{...key(a),proof}),
  launchMaterial:a=>request(a.runId,"launch-material",key(a)),
  recordRemoved:a=>request(a.runId,"removed",key(a)),
 });
}
