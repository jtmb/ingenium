// Real SDK transport. Workspace catalog/permission/ownership always comes from original Core HTTP.
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {ListToolsRequestSchema,CallToolRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {mkdir,open,lstat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {createWorkspaceRuntimeMcpClient,type WorkspaceMcpHints} from './workspace-runtime-mcp-client.js';
const fail=():never=>{throw Error('Workspace MCP bootstrap unavailable');};
async function createServer(hints:WorkspaceMcpHints){
 const backend=createWorkspaceRuntimeMcpClient(hints),scope=await backend.bootstrap();
 const server=new Server({name:'ingenium-workspace-runtime-v2',version:'2.0.0'},{capabilities:{tools:{}}});
 server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:await backend.listTools()}));
 server.setRequestHandler(CallToolRequestSchema,async request=>backend.callTool(request.params.name,request.params.arguments??{}));
 return {server,backend,scope};
}
/** Called by original PID bootstrap. This performs actual MCP initialize/list/call
 * against actual current Core, before reporting ready or starting an engine. */
export async function bootstrapWorkspaceRuntimeV2(hints:WorkspaceMcpHints){
 const {server,backend}=await createServer(hints),client=new Client({name:'original-workspace-runtime-bootstrap',version:'2.0.0'}),[serverSide,clientSide]=InMemoryTransport.createLinkedPair();
 try{
  await Promise.all([server.connect(serverSide),client.connect(clientSide)]);
  const tools=await client.listTools();if(tools.tools.length!==1||tools.tools[0]?.name!=='ingenium_workspace_runtime_scope')return fail();
  const response=await client.callTool({name:'ingenium_workspace_runtime_scope',arguments:{}});if(response.isError||!Array.isArray(response.content)||response.content.length!==1)return fail();
  const c=response.content[0];if(!c||c.type!=='text'||typeof c.text!=='string')return fail();const scope=backend.scope(JSON.parse(c.text));
  // Real OpenCode launches the SAME fixed module; no generic ensureProject import.
  const dir='/home/appuser/.config/opencode/runtime';await mkdir(dir,{recursive:true,mode:0o700});const st=await lstat(dir);if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==1000||(st.mode&0o077)!==0)return fail();
  const config={mcp:{servers:{ingenium:{type:'local',command:['node','/app/packages/ingenium-extension/dist/scripts/mcp-server.js'],disabled:false,environment:{INGENIUM_EXECUTION_SCOPE:'workspace',INGENIUM_MCP_AUDIENCE:'runtime',INGENIUM_API_URL:hints.apiUrl,INGENIUM_MCP_CREDENTIAL_FILE:hints.credentialFile,INGENIUM_RUNTIME_CREDENTIAL_FILE:hints.credentialFile,INGENIUM_WORKSPACE_ID:scope.workspaceId,INGENIUM_RUNTIME_ID:scope.runtimeId,INGENIUM_STORAGE_MAPPING_HASH:scope.bindingHash,INGENIUM_WORKSPACE_BINDING_EPOCH:String(scope.bindingEpoch),...(hints.nonce?{INGENIUM_WORKSPACE_BOOTSTRAP_NONCE:hints.nonce}:{}),INGENIUM_WORKTREE:'/workspace'}}}}};
  const target=dir+'/opencode.jsonc';
  // Original new runtime only. Never overwrite/adopt an existing config file.
  try{await lstat(target);return fail();}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  const fd=await open(target,constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW|constants.O_WRONLY,0o600);
  try{await fd.writeFile(JSON.stringify(config));await fd.sync();}finally{await fd.close();}
  return {schemaVersion:2 as const,ready:true as const,scope};
 }finally{const closed=await Promise.allSettled([client.close(),server.close()]);if(closed.some(result=>result.status==='rejected'))throw Error('Workspace MCP bootstrap cleanup unavailable');}
}
export async function runWorkspaceRuntimeMcpTransportV2(){
 const epoch=process.env.INGENIUM_WORKSPACE_BINDING_EPOCH;if(!epoch||!/^(0|[1-9][0-9]*)$/.test(epoch))return fail();
 const hints={credentialFile:process.env.INGENIUM_RUNTIME_CREDENTIAL_FILE??'',apiUrl:process.env.INGENIUM_API_URL??'',workspaceId:process.env.INGENIUM_WORKSPACE_ID??'',runtimeId:process.env.INGENIUM_RUNTIME_ID??'',bindingHash:process.env.INGENIUM_STORAGE_MAPPING_HASH??'',bindingEpoch:Number(epoch),nonce:process.env.INGENIUM_WORKSPACE_BOOTSTRAP_NONCE};
 const {server}=await createServer(hints);await server.connect(new StdioServerTransport());
 const close=()=>{void server.close().catch(()=>{process.exitCode=1;});};process.once('SIGINT',close);process.once('SIGTERM',close);
}
