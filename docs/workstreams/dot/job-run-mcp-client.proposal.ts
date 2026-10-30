import {openSync,fstatSync,readFileSync,closeSync,constants,realpathSync} from "node:fs";
const CAPABILITY="/run/ingenium-runtime/capability";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const denied=()=>{throw Error("Original JobRun MCP transport denied");};
export function readJobRunCredential():string{
 let fd:number|undefined;
 try{
  if(realpathSync(CAPABILITY)!==CAPABILITY)denied();
  fd=openSync(CAPABILITY,constants.O_RDONLY|constants.O_NOFOLLOW);
  const s=fstatSync(fd);
  if(!s.isFile()||s.nlink!==1||(s.mode&0o777)!==0o600||s.uid!==process.getuid?.()||s.size>256)denied();
  const token=readFileSync(fd,"utf8").trim();
  if(!/^ing_[A-Za-z0-9_-]{12}_[A-Za-z0-9_-]{43}$/.test(token))denied();
  return token;
 }finally{if(fd!==undefined)closeSync(fd);}
}
export interface JobRunTool {name:string;description?:string;inputSchema:Record<string,unknown>;}
function record(v:unknown):v is Record<string,unknown>{return !!v&&typeof v==="object"&&!Array.isArray(v);}
export function createJobRunMcpClient({environment=process.env,readCredential=readJobRunCredential,fetchImpl=fetch}:{environment?:NodeJS.ProcessEnv;readCredential?:()=>string;fetchImpl?:typeof fetch}={}){
 const runId=environment.INGENIUM_JOB_RUN_ID??"",attemptId=environment.INGENIUM_JOB_ATTEMPT_ID??"";
 if(environment.INGENIUM_MCP_AUDIENCE!=="job-run"||!UUID.test(runId)||!UUID.test(attemptId)||environment.INGENIUM_MCP_CREDENTIAL_FILE!==CAPABILITY)denied();
 const base=new URL(environment.INGENIUM_API_URL??"");
 if(!["http:","https:"].includes(base.protocol)||base.username||base.password||base.search||base.hash||base.pathname!=="/api/v1")denied();
 async function request(operation:string,body?:unknown):Promise<unknown>{
  const url=new URL(base);url.pathname+=`/runtime/job-runs/${runId}/${operation}`;
  const serialized=body===undefined?undefined:JSON.stringify(body);
  if(serialized!==undefined&&Buffer.byteLength(serialized)>65536)denied();
  const response=await fetchImpl(url,{method:body===undefined?"GET":"POST",redirect:"error",signal:AbortSignal.timeout(15_000),headers:{Authorization:`Bearer ${readCredential()}`,"X-Ingenium-Audience":"job-run","X-Ingenium-Job-Attempt":attemptId,Accept:"application/json",...(body===undefined?{}:{"Content-Type":"application/json"})},body:serialized});
  if(!response.ok){await response.body?.cancel();denied();}
  const reader=response.body?.getReader();if(!reader)denied();
  let size=0;const chunks:Uint8Array[]=[];
  try{while(true){const part=await reader!.read();if(part.done)break;size+=part.value.byteLength;if(size>1048576){await reader!.cancel();denied();}chunks.push(part.value);}}
  finally{reader!.releaseLock();}
  const parsed:unknown=JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if(!record(parsed)||!("data" in parsed))denied();return (parsed as Record<string,unknown>).data;
 }
 return {
  async listTools():Promise<JobRunTool[]>{
   const data=await request("mcp-tools");
   if(!Array.isArray(data)||data.length>512||data.some(t=>!record(t)||typeof t.name!=="string"||!/^ingenium_[A-Za-z0-9_]+$/.test(t.name)||!record(t.inputSchema)))denied();
   return data as JobRunTool[];
  },
  async callTool(name:string,args:unknown){
   if(!/^ingenium_[A-Za-z0-9_]+$/.test(name)||!record(args))denied();
   const data=await request(`mcp/${name}`,args);
   if(!record(data)||!Array.isArray(data.content)||data.content.some(c=>!record(c)||c.type!=="text"||typeof c.text!=="string"))denied();
   return data as {content:Array<{type:"text";text:string}>};
  },
 };
}
