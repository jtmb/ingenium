import {openSync,fstatSync,readFileSync,closeSync,constants,realpathSync} from "node:fs";
export const JOB_CAPABILITY="/run/ingenium-runtime/capability";
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const jobDenied=()=>{throw Error("Original JobRun private authority unavailable");};
export function readOriginalJobCapability(){let fd;try{if(realpathSync(JOB_CAPABILITY)!==JOB_CAPABILITY)jobDenied();fd=openSync(JOB_CAPABILITY,constants.O_RDONLY|constants.O_NOFOLLOW);const s=fstatSync(fd);if(!s.isFile()||s.nlink!==1||s.uid!==process.getuid?.()||(s.mode&0o777)!==0o600||s.size>256)jobDenied();const value=readFileSync(fd,"utf8").trim();if(!/^ing_[A-Za-z0-9_-]{12}_[A-Za-z0-9_-]{43}$/.test(value))jobDenied();return value;}finally{if(fd!==undefined)closeSync(fd);}}
export function createOriginalJobAuthority({environment=process.env,readCapability=readOriginalJobCapability,fetchImpl=fetch}={}){
 const runId=environment.INGENIUM_JOB_RUN_ID,attemptId=environment.INGENIUM_JOB_ATTEMPT_ID;if(!uuid.test(runId??"")||!uuid.test(attemptId??""))jobDenied();const base=new URL(environment.INGENIUM_API_URL??"");if(base.protocol!=="http:"||base.username||base.password||base.pathname!=="/api/v1"||base.search||base.hash)jobDenied();
 return Object.freeze({runId,attemptId,base:base.href,async request(operation,body){
  if(!["assignment","bootstrap-assignment","result","withdraw"].includes(operation))jobDenied();
  const url=new URL(base);url.pathname+=`/runtime/job-runs/${runId}/${operation}`;
  const response=await fetchImpl(url,{method:body===undefined?"GET":"POST",redirect:"error",headers:{Authorization:`Bearer ${readCapability()}`,"X-Ingenium-Audience":"job-run","X-Ingenium-Job-Attempt":attemptId,Accept:"application/json",...(body===undefined?{}:{"Content-Type":"application/json"})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  if(!response.ok){await response.body?.cancel();jobDenied();}const reader=response.body?.getReader();if(!reader)jobDenied();let size=0;const chunks=[];try{while(true){const item=await reader.read();if(item.done)break;size+=item.value.byteLength;if(size>384*1024){await reader.cancel();jobDenied();}chunks.push(item.value);}}finally{reader.releaseLock();}let value;try{value=JSON.parse(Buffer.concat(chunks).toString("utf8"));}catch{jobDenied();}if(!value||typeof value!=="object"||!("data" in value))jobDenied();return value.data;
 }});
}
