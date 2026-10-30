import {timingSafeEqual} from "node:crypto";
// loadToken is the ORIGINAL runtime-manager token-file owner; no API_TOKEN, caller token or new session fallback.
export function createCore126ManagerGuard({loadToken}){
 const requireManager=ctx=>{let expected;try{expected=loadToken();}catch{throw Object.assign(Error("Original manager credential enrollment unavailable"),{status:503});}const header=ctx?.request?.headers?.authorization;if(typeof expected!=="string"||!/^[A-Za-z0-9_-]{43,128}$/.test(expected)||typeof header!=="string"||!header.startsWith("Bearer "))throw Object.assign(Error("Manager authentication required"),{status:401});const left=Buffer.from(header.slice(7)),right=Buffer.from(expected);if(left.length!==right.length||!timingSafeEqual(left,right))throw Object.assign(Error("Manager authentication required"),{status:401});};
 return {requireManager,context(request){const ctx={request};requireManager(ctx);return ctx;}};
}
/** Only self-reduction of the exact original credential/ledger; no owner/image/grant bootstrap. */
export function createCore126WithdrawalHandler({credentials}){
 return async request=>{
  const match=/^\/runtime\/job-runs\/([a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})\/withdraw$/.exec(request.path);
  if(!match)return null;
  const deny=()=>{throw Object.assign(Error("Original JobRun withdrawal denied"),{status:401});};
  const headers=request.headers,body=request.body,uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
  if(request.method!=="POST")throw Object.assign(Error("Method unavailable"),{status:405});
  if(!headers||headers["x-ingenium-audience"]!=="job-run"||headers.cookie!==undefined||headers.origin!==undefined||headers["x-ingenium-internal-service"]!==undefined||Object.keys(request.query??{}).length||!body||typeof body!=="object"||Array.isArray(body)||Object.keys(body).sort().join("|")!=="attemptId|reason|runId"||body.runId!==match[1]||typeof body.attemptId!=="string"||!uuid.test(body.attemptId)||headers["x-ingenium-job-attempt"]!==body.attemptId||!["CORE126_JOB_ENFORCEMENT_LOST","CORE126_JOB_PLUGIN_UNLOADED","CORE126_JOB_PARENT_STOP"].includes(body.reason))deny();
  const auth=headers.authorization;if(typeof auth!=="string"||!/^Bearer ing_[A-Za-z0-9_-]{12}_[A-Za-z0-9_-]{43}$/.test(auth))deny();
  if(typeof credentials?.withdrawManagedJobDispatch!=="function")throw Object.assign(Error("Original JobRun withdrawal unavailable"),{status:503});
  const narrowed=credentials.withdrawManagedJobDispatch(auth.slice(7),{runId:match[1],attemptId:body.attemptId,reason:body.reason});
  if(!narrowed)deny();
  if(narrowed.withdrawalRecorded!==true||narrowed.wholeContainerRetired!==false)throw Object.assign(Error("Original JobRun withdrawal unavailable"),{status:503});
  return {data:{withdrawalRecorded:true,wholeContainerRetired:false}};
 };
}
/** Mount these closed handlers before generic user/runtime auth; they authenticate their OWN exact audience.
 * No handler creates a browser/service/compatibility principal from a job-run credential.
 */
export function createCore126Handlers({owner,managerGuard,credentials,authorizeTool,dispatchExistingTool,listAuthorizedTools}){
 const withdraw=createCore126WithdrawalHandler({credentials});
 return {
  async internal(request){
   const match=/^\/internal\/managed-job-runs\/([a-f0-9-]+)\/(admission|launch-material|effect-intent|created|started|unknown|retired|no-create-close|consumed|removed)$/.exec(request.path);
   if(!match)return null;const ctx=managerGuard.context(request),runId=match[1],operation=match[2];
   if(operation==="admission"&&request.method==="GET")return {data:owner.admit(runId,request.query?.action,ctx)};
   if(request.method!=="POST")throw Object.assign(Error("Method unavailable"),{status:405});
   const body=request.body;
   if(operation==="consumed"){if(body&&Object.keys(body).length)throw Object.assign(Error("Invalid consume request"),{status:422});return {data:owner.consume(runId,ctx)};}
   if(!body||typeof body!=="object"||Array.isArray(body)||Buffer.byteLength(JSON.stringify(body))>65536)throw Object.assign(Error("Invalid journal request"),{status:422});
   const methods={"launch-material":"launchMaterial","effect-intent":"claimEffect",created:"recordCreated",started:"recordStarted",unknown:"recordUnknown",retired:"recordRetired","no-create-close":"closeNoCreate",removed:"recordRemoved"};
   if(!methods[operation])throw Object.assign(Error("Method unavailable"),{status:405});return {data:await owner[methods[operation]](runId,body,ctx)};
  },
  async runtime(request){
   const narrowed=await withdraw(request);if(narrowed)return narrowed;
   const match=/^\/runtime\/job-runs\/([a-f0-9-]+)\/(assignment|bootstrap-assignment|result|mcp-tools|mcp\/([A-Za-z0-9_:-]+))$/.exec(request.path);
   if(!match)return null;
   const header=request.headers?.authorization,token=typeof header==="string"&&header.startsWith("Bearer ")?header.slice(7):"";
   const credential=credentials.inspectManagedJobCredential(token,"job-run");
   if(!credential||credential.purpose!=="production"||credential.candidateIntentHash!==null||credential.runId!==match[1])throw Object.assign(Error("Original JobRun credential required"),{status:401});
   if(match[2]==="bootstrap-assignment"&&request.method==="GET"){
    if(request.headers?.["x-ingenium-audience"]!=="job-run"||request.headers?.["x-ingenium-job-attempt"]!==credential.attemptId)throw Object.assign(Error("Original JobRun bootstrap denied"),{status:401});
    return {data:owner.bootstrapAssignment(match[1],credential)};
   }
   if(match[2]==="assignment"&&request.method==="GET")return {data:owner.assignment(match[1],credential)};
   if(match[2]==="result"&&request.method==="POST")return {data:owner.result(match[1],request.body,credential)};
   if(match[2]==="mcp-tools"||match[3]){
    if(request.headers?.["x-ingenium-audience"]!=="job-run"||request.headers?.["x-ingenium-job-attempt"]!==credential.attemptId||request.headers?.cookie!==undefined||request.headers?.origin!==undefined)throw Object.assign(Error("JobRun MCP audience denied"),{status:401});
    owner.assignment(match[1],credential);
    if(match[2]==="mcp-tools"&&request.method==="GET"){
     if(!listAuthorizedTools)throw Object.assign(Error("JobRun catalog unavailable"),{status:503});
     return {data:await listAuthorizedTools(credential)};
    }
   }
   if(match[3]&&request.method==="POST"){
    if(!authorizeTool||!dispatchExistingTool)throw Object.assign(Error("JobRun broker route unavailable"),{status:503});
    owner.assignment(match[1],credential); // Recheck current run/profile/parent capability at each broker entry.
    const authorized=authorizeTool(credential,match[3],request.body);return {data:await dispatchExistingTool(authorized,request.body,credential)};
   }
   throw Object.assign(Error("Method unavailable"),{status:405});
  },
 };
}
/** A CLOSED per-tool Core policy decision, not a generic service principal returned to middleware. */
export function createCore126ToolAuthorizer({credentials,mcpAuthorizationPolicy,authorization,jobs,toolCatalog}){
 return (credential,toolName,body)=>{
  if(credential.purpose!=="production"||credential.candidateIntentHash!==null||credential.kind!=="job-run"||credential.audience!=="job-run"||!jobs.isJobRunAuthorizationCurrent(credential.projectId,credential.runId))throw Object.assign(Error("JobRun tool denied"),{status:403});
  const tool=toolCatalog?.getTool(toolName);if(!tool||tool.name!==toolName||typeof tool.category!=="string")throw Object.assign(Error("Qualified original tool catalog unavailable"),{status:503});
  const policy=mcpAuthorizationPolicy.explicitMcpAuthorizationPolicy(toolName,tool.category);
  // Preserve actual private-content policy: never impersonate the owner to unlock browser/user-token-only tools.
  if(policy.target!=="project"||policy.scopes.some(scope=>!credential.scopes.includes(scope))||body?.projectId&&body.projectId!==credential.projectId||body?.workspaceId&&body.workspaceId!==credential.workspaceId)throw Object.assign(Error("JobRun tool denied"),{status:403});
  const decision=authorization.requireProjectPermission({type:"service-principal",id:credential.servicePrincipalId,scopes:credential.scopes,organizationId:credential.organizationId,projectId:credential.projectId,projectIds:[credential.projectId]},credential.projectId,policy.resource,policy.permission);
  if(!decision.allowed)throw Object.assign(Error("JobRun tool denied"),{status:403});
  return Object.freeze({toolName,policy,jobRunId:credential.runId,attemptId:credential.attemptId,projectId:credential.projectId,workspaceId:credential.workspaceId,credentialId:credential.id});
 };
}
