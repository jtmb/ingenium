// APPEND to actual runtime-manager-client.ts with raw-helper import. Legacy
// requestManager unchanged: new call path owns strict body/cancel evidence.
const originalCallManagerFetch=globalThis.fetch.bind(globalThis);
export async function inspectOriginalCallRuntimeJobRole(runtimeId:string,signal:AbortSignal):Promise<unknown> {
 if(!UUID.test(runtimeId)||!(signal instanceof AbortSignal))throw Object.assign(Error('RAW_CALL_MANAGER_INPUT'),{code:'RAW_CALL_MANAGER_INPUT'});
 const bounded=AbortSignal.any([signal,AbortSignal.timeout(15000)]);bounded.throwIfAborted();
 const url=new URL('/v1/runtimes/'+runtimeId+'/job-role-proof',managerUrl()).href;
 try{
  const response=await originalCallManagerFetch(url,{method:'GET',redirect:'manual',credentials:'omit',cache:'no-store',signal:bounded,
   headers:{Authorization:`Bearer ${managerToken()}`,Accept:'application/json','Accept-Encoding':'identity'}});
  const body=await consumeBoundedRawJson(response,url,RAW_ASSISTANT_LIMITS.sessionBytes,bounded);
  try{
   const envelope=body.json as {data?:RuntimeManagerInspect},result=envelope?.data;
   if(!result||result.runtimeId!==runtimeId||typeof result.state!=='string'||typeof result.health!=='string'
    ||!result.backendId||!SHA256.test(result.backendId)||result.backendName!==`ingenium-runtime-${runtimeId.replaceAll('-','')}`
    ||!result.imageRevision||!SHA1.test(result.imageRevision)||!('jobRoleProof'in result)||!result.jobRoleProof||typeof result.jobRoleProof!=='object')throw Error('invalid original manager selection');
   const proof=result.jobRoleProof;
   if(!('parent'in proof)||!proof.parent||typeof proof.parent!=='object'||!('runtimeId'in proof.parent)||proof.parent.runtimeId!==runtimeId
    ||!('id'in proof.parent)||proof.parent.id!==result.backendId||!('name'in proof.parent)||proof.parent.name!==result.backendName)throw Error('invalid original manager parent');
   bounded.throwIfAborted();return proof;
  }finally{body.raw.fill(0);}
 }catch(error:unknown){
  const code=error&&typeof error==='object'&&'code'in error&&typeof error.code==='string'&&/^RAW_[A-Z_]+$/u.test(error.code)?error.code:bounded.aborted?'RAW_READ_ABORTED':'RAW_CALL_MANAGER_FAILED';
  throw Object.assign(Error(code),{code});
 }
}
