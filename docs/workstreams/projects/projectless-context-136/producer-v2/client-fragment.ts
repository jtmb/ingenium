// Append to actual runtime-manager-client.ts; uses its ORIGINAL URL/token/raw-fetch owners.
const workspaceOriginalResponses=new WeakMap<object,runtimeProvision.WorkspaceRuntimeOriginalProvision>();
export function authenticatedOriginalWorkspaceProvisionV2(result:object):runtimeProvision.WorkspaceRuntimeOriginalProvision|undefined{return workspaceOriginalResponses.get(result);}
async function originalWorkspaceManagerV2(path:string,body?:unknown):Promise<Record<string,unknown>>{
 const url=new URL(path,managerUrl()).href,signal=AbortSignal.timeout(45000);
 const response=await originalCallManagerFetch(url,{method:body===undefined?'GET':'POST',redirect:'manual',credentials:'omit',cache:'no-store',signal,
 headers:{Authorization:'Bearer '+managerToken(),Accept:'application/json','Accept-Encoding':'identity',...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
 const consumed=await consumeBoundedRawJson(response,url,RAW_ASSISTANT_LIMITS.sessionBytes,signal);
 try{const envelope=consumed.json as {data?:Record<string,unknown>};if(!envelope?.data||typeof envelope.data!=='object')throw Error('WORKSPACE_V2_MANAGER_RESPONSE');return envelope.data;}finally{consumed.raw.fill(0);}
}
export async function postOriginalWorkspaceRuntimeV2(payload:runtimeProvision.PublicWorkspaceProvisionRequest&{capability:string;capabilityExpiresAt:string;bootstrapNonce:string}):Promise<RuntimeManagerInspect>{
 const {capability:_capability,capabilityExpiresAt:_expires,bootstrapNonce:_nonce,...publicRequest}=payload;
 const expected=runtimeProvision.publicWorkspaceProvisionRequest(publicRequest),raw=await originalWorkspaceManagerV2('/v2/workspace-runtimes',payload);
 if(raw.disposition!=='new_created'||raw.runtimeId!==expected.runtimeId||typeof raw.backendId!=='string'||!SHA256.test(raw.backendId)||raw.backendName!==expected.backendName||typeof raw.imageRevision!=='string'||!SHA1.test(raw.imageRevision)||raw.state!=='running')throw Error('WORKSPACE_V2_ORIGINAL_RESPONSE');
 const original=runtimeProvision.validateWorkspaceProvisionResponse(raw.originalProvision,expected,raw.backendId);
 const result:RuntimeManagerInspect={backendId:raw.backendId,backendName:expected.backendName,runtimeId:expected.runtimeId,imageRevision:raw.imageRevision,state:'running',health:typeof raw.health==='string'?raw.health:'unknown'};
 workspaceOriginalResponses.set(result,original);return result; // no DTO constructor/adoption path
}
export async function inspectOriginalWorkspaceRuntimeV2(runtimeId:string):Promise<unknown>{
 if(!UUID.test(runtimeId))throw Error('WORKSPACE_V2_RUNTIME_ID');return await originalWorkspaceManagerV2('/v2/workspace-runtimes/'+runtimeId+'/placement');
}
