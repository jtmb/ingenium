/** Dedicated versioned MCP audience over the original API. No generic Project auth fallback. */
import {getDb,mcpToolStates,authorization} from 'ingenium-core';
import {workspaceRuntimeCredentialsV2 as credentials} from 'ingenium-core';
import {authenticateWorkspaceMcpCredentialV2}from'./workspace-mcp-identity.mjs';
import {executeWorkspaceMcpMemoryTool}from'./workspace-mcp-memory-owner.js';
const root='/api/v1/runtime/workspace-v2/mcp/';
const deny=code=>{throw Object.assign(Error(code),{code,status:401});};
const result=(value,isError=false)=>({content:[{type:'text',text:JSON.stringify(value)}],...(isError?{isError:true}:{})});
const scope=authenticateWorkspaceMcpCredentialV2;

function workspaceTool(){
 const entry=mcpToolStates.getAllTools().get('ingenium_workspace_runtime_scope'),facet=entry?.workspaceRuntimeV2,policy=entry?.authorization;
 if(!entry||entry.projectScope!=='workspace'||facet?.protocol!==2||facet.enabled!==true||!facet.inputSchema||policy?.target!=='private'||policy.resource!=='runtime'||policy.permission!=='read'||JSON.stringify(policy.scopes)!==JSON.stringify(['runtime:activity']))return deny('WORKSPACE_MCP_CANONICAL_DEFINITION_UNAVAILABLE');
 return {name:entry.name,description:entry.description,inputSchema:facet.inputSchema};
}
const memoryNames=['ingenium_workspace_memory_policy','ingenium_workspace_memory_read'];
function memoryTools(c){
 // Stable descriptions let an engine cache its catalog during bootstrap.
 // Execution still enters the separate READY/IDLE + fresh placement owner.
 if(!c.scopes.includes('memory:read'))return [];
 const decision=authorization.requireOrganizationPermission({type:'service-principal',id:c.servicePrincipalId,scopes:c.scopes,organizationId:c.organizationId,projectId:null,projectIds:[]},c.organizationId,'memory','read');if(!decision.allowed)return [];
 return memoryNames.map(name=>{const entry=mcpToolStates.getAllTools().get(name),facet=entry?.workspaceRuntimeV2,policy=entry?.authorization;if(!entry||entry.projectScope!=='workspace'||facet?.protocol!==2||facet.enabled!==true||!facet.inputSchema||policy?.target!=='private'||policy.resource!=='memory'||policy.permission!=='read'||JSON.stringify(policy.scopes)!==JSON.stringify(['memory:read']))return deny('WORKSPACE_MCP_CANONICAL_DEFINITION_UNAVAILABLE');return {name:entry.name,description:entry.description,inputSchema:facet.inputSchema}});
}
function projection(c){return {schemaVersion:2,scopeKind:'workspace',projectId:null,organizationId:c.organizationId,ownerUserId:c.ownerUserId,workspaceId:c.workspaceId,runtimeId:c.runtimeId,credentialId:c.credentialId,bindingHash:c.bindingHash,bindingEpoch:c.bindingEpoch,runtimeState:c.runtimeState};}
export async function workspaceV2McpIngress(req,res,next){
 if(!req.path.startsWith(root))return next();
 try{
  const operation=req.path.slice(root.length);if(req.method!=='POST'||req.originalUrl!==req.path||!['bootstrap','tools','call'].includes(operation)||!req.body||Buffer.byteLength(JSON.stringify(req.body))>65536)return deny('WORKSPACE_MCP_INPUT');
  const c=scope(req),input=req.body,tool=workspaceTool(),readTools=memoryTools(c);if(Object.keys(input).some(k=>!['schemaVersion','nonce','name','arguments'].includes(k))||input.schemaVersion!==2)return deny('WORKSPACE_MCP_INPUT');
  let data;
  if(operation==='bootstrap')data={scope:projection(c),tools:[tool,...readTools]};
  else if(operation==='tools')data=[tool,...readTools];
  else{
   if(typeof input.name!=='string'||!input.arguments||typeof input.arguments!=='object'||Array.isArray(input.arguments))return deny('WORKSPACE_MCP_INPUT');
   if(input.name===tool.name){if(Object.keys(input.arguments).length)return deny('WORKSPACE_MCP_SCOPE_ARGUMENTS');data=result(projection(c));}
   else if(readTools.some(t=>t.name===input.name))data=result(await executeWorkspaceMcpMemoryTool(req,input.name,input.arguments));
   else{
    // Same actual original catalog, but never feed null/global/guessed Project to a handler.
    const known=mcpToolStates.getAllTools().get(input.name),policy=known?.authorization;
    if(!known)data=result({code:'TOOL_NOT_REGISTERED'},true);
    else if(known.projectScope==='per-project'||policy?.target==='project'||policy?.target==='organization')data=result({code:'PROJECT_REQUIRED',tool:input.name},true);
    else if(policy?.target==='installation'){
     const decision=authorization.requireInstallationPermission({type:'service-principal',id:c.servicePrincipalId,scopes:c.scopes,organizationId:c.organizationId,projectId:null,projectIds:[]},policy.resource,policy.permission);
     data=result({code:decision.allowed?'INSTALLATION_TOOL_OWNER_UNAVAILABLE':'INSTALLATION_PERMISSION_DENIED',tool:input.name},true);
    }else data=result({code:'WORKSPACE_TOOL_OWNER_UNAVAILABLE',tool:input.name},true);
   }
  }
  // Revalidate after catalog/permission callbacks. No serialized scope is authority.
  if(JSON.stringify(scope(req))!==JSON.stringify(c))return deny('WORKSPACE_MCP_SCOPE_CHANGED');
  res.set('Cache-Control','no-store');res.status(200).json({data});
 }catch(error){res.status(error.status??503).json({error:{code:error.code??'WORKSPACE_MCP_UNAVAILABLE'}});}
}
