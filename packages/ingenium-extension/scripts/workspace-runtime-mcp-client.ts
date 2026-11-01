// Actual fixed v2 runtime credential/HTTP transport. No injectable fetch/credential/grant port.
import {openSync,closeSync,readFileSync,fstatSync,lstatSync,realpathSync,constants} from 'node:fs';
const CAPABILITY='/run/ingenium-runtime/capability';
const originalFetch=globalThis.fetch.bind(globalThis);
const deny=():never=>{throw Error('Workspace MCP transport unavailable');};
export interface WorkspaceMcpHints {credentialFile:string;apiUrl:string;workspaceId:string;runtimeId:string;bindingHash:string;bindingEpoch:number;nonce?:string}
export interface WorkspaceMcpScope {schemaVersion:2;scopeKind:'workspace';projectId:null;organizationId:string;ownerUserId:string;workspaceId:string;runtimeId:string;credentialId:string;bindingHash:string;bindingEpoch:number;runtimeState:string}
export interface WorkspaceMcpTool {name:string;description:string;inputSchema:{type:'object';properties:Record<string,unknown>;additionalProperties:false}}
function credential():string{
 let fd:number|undefined;
 try{
  if(process.getuid?.()!==1000||realpathSync(CAPABILITY)!==CAPABILITY)return deny();
  const named=lstatSync(CAPABILITY);fd=openSync(CAPABILITY,constants.O_RDONLY|constants.O_NOFOLLOW);const a=fstatSync(fd);
  if(!a.isFile()||a.uid!==1000||a.gid!==1000||a.nlink!==1||(a.mode&0o777)!==0o600||a.size!==61||named.dev!==a.dev||named.ino!==a.ino)return deny();
  const bytes=readFileSync(fd),b=fstatSync(fd),now=lstatSync(CAPABILITY);
  if([b,now].some(s=>s.dev!==a.dev||s.ino!==a.ino||s.size!==a.size||s.mtimeMs!==a.mtimeMs||s.ctimeMs!==a.ctimeMs)||now.isSymbolicLink())return deny();
  const token=bytes.toString('utf8');bytes.fill(0);if(!/^ing_[A-Za-z0-9_-]{12}_[A-Za-z0-9_-]{43}\n$/.test(token))return deny();return token.slice(0,-1);
 }finally{if(fd!==undefined)closeSync(fd);}
}
function record(v:unknown):v is Record<string,unknown>{return !!v&&typeof v==='object'&&!Array.isArray(v);}
export function createWorkspaceRuntimeMcpClient(hints:WorkspaceMcpHints){
 if(hints.credentialFile!==CAPABILITY||process.env.INGENIUM_EXECUTION_SCOPE!=='workspace'||['INGENIUM_PROJECT','INGENIUM_PROJECT_ID','INGENIUM_PROJECT_NAME'].some(k=>Object.hasOwn(process.env,k)))return deny();
 const base=new URL(hints.apiUrl);if(base.protocol!=='http:'||base.pathname!=='/api/v1'||base.username||base.password||base.search||base.hash||!Number.isSafeInteger(hints.bindingEpoch))return deny();
 async function request(operation:'bootstrap'|'tools'|'call',body:Record<string,unknown>={}):Promise<unknown>{
  const url=new URL(base);url.pathname+='/runtime/workspace-v2/mcp/'+operation;
  const payload=JSON.stringify({schemaVersion:2,...(hints.nonce?{nonce:hints.nonce}:{}),...body});if(Buffer.byteLength(payload)>65536)return deny();
  const response=await originalFetch(url,{method:'POST',redirect:'error',credentials:'omit',cache:'no-store',headers:{Authorization:'Bearer '+credential(),'X-Ingenium-Audience':'workspace-runtime-v2','Content-Type':'application/json',Accept:'application/json','Accept-Encoding':'identity'},body:payload,signal:AbortSignal.timeout(10000)});
  if(response.status!==200||!response.body||!/^application\/json\b/i.test(response.headers.get('content-type')??'')){await response.body?.cancel();return deny();}
  const chunks:Buffer[]=[];let count=0;for await(const b of response.body){count+=b.length;if(count>1048576)return deny();chunks.push(Buffer.from(b));}
  let parsed:unknown;try{parsed=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return deny();}if(!record(parsed)||!Object.hasOwn(parsed,'data'))return deny();return parsed.data;
 }
 function scope(value:unknown):WorkspaceMcpScope{
  if(!record(value)||value.schemaVersion!==2||value.scopeKind!=='workspace'||value.projectId!==null||value.workspaceId!==hints.workspaceId||value.runtimeId!==hints.runtimeId||value.bindingHash!==hints.bindingHash||value.bindingEpoch!==hints.bindingEpoch||typeof value.organizationId!=='string'||typeof value.ownerUserId!=='string'||typeof value.credentialId!=='string'||typeof value.runtimeState!=='string')return deny();return value as unknown as WorkspaceMcpScope;
 }
 function tools(value:unknown):WorkspaceMcpTool[]{
  const names=new Set(['ingenium_workspace_runtime_scope','ingenium_workspace_memory_policy','ingenium_workspace_memory_read']);
  if(!Array.isArray(value)||value.length<1||value.length>3||value[0]?.name!=='ingenium_workspace_runtime_scope')return deny();
  const seen=new Set<string>();for(const row of value){if(!record(row)||typeof row.name!=='string'||!names.has(row.name)||seen.has(row.name)||typeof row.description!=='string'||row.description.length>4096||!record(row.inputSchema)||row.inputSchema.type!=='object'||row.inputSchema.additionalProperties!==false||!record(row.inputSchema.properties))return deny();seen.add(row.name)}
  return value as WorkspaceMcpTool[];
 }
 return Object.freeze({
  async bootstrap(){const data=await request('bootstrap');if(!record(data))return deny();tools(data.tools);return scope(data.scope);},
  async listTools():Promise<WorkspaceMcpTool[]>{return tools(await request('tools'));},
  async callTool(name:string,args:Record<string,unknown>){
   if(!/^ingenium_[a-zA-Z0-9_]+$/.test(name)||!record(args))return deny();const data=await request('call',{name,arguments:args});
   if(!record(data)||!Array.isArray(data.content)||data.content.some(c=>!record(c)||c.type!=='text'||typeof c.text!=='string'))return deny();return data as unknown as {content:Array<{type:'text';text:string}>;isError?:boolean};
  },scope,
 });
}
