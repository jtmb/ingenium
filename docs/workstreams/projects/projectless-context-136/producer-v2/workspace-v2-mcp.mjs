/** Dedicated versioned MCP audience over the original API. No generic Project auth fallback. */
import {getDb,mcpToolStates,authorization} from 'ingenium-core';
import {workspaceRuntimeCredentialsV2 as credentials} from 'ingenium-core';
import {requireOriginalWorkspaceMcpAdmissionV2} from './workspace-v2-control.mjs';
const root='/api/v1/runtime/workspace-v2/mcp/';
const deny=code=>{throw Object.assign(Error(code),{code,status:401});};
const result=(value,isError=false)=>({content:[{type:'text',text:JSON.stringify(value)}],...(isError?{isError:true}:{})});
function scope(request){
 if(request.headers.cookie!==undefined||request.headers.origin!==undefined||request.headers['x-ingenium-audience']!=='workspace-runtime-v2'||request.headers['content-type']!=='application/json')return deny('WORKSPACE_MCP_AUTHENTICATION');
 const header=request.headers.authorization,token=typeof header==='string'&&header.startsWith('Bearer ')?header.slice(7):'';
 const c=credentials.inspectWorkspaceMcpCredentialV2(token);if(!c)return deny('WORKSPACE_MCP_AUTHENTICATION');
 requireOriginalWorkspaceMcpAdmissionV2(c,request.body?.nonce);
 return c; // Derived from actual hash/epoch/current user/org/workspace/runtime/capability owner.
}
function workspaceTool(){
 const entry=mcpToolStates.getAllTools().get('ingenium_workspace_runtime_scope'),facet=entry?.workspaceRuntimeV2,policy=entry?.authorization;
 if(!entry||entry.projectScope!=='workspace'||facet?.protocol!==2||facet.enabled!==true||!facet.inputSchema||policy?.target!=='private'||policy.resource!=='runtime'||policy.permission!=='read'||JSON.stringify(policy.scopes)!==JSON.stringify(['runtime:activity']))return deny('WORKSPACE_MCP_CANONICAL_DEFINITION_UNAVAILABLE');
 return {name:entry.name,description:entry.description,inputSchema:facet.inputSchema};
}
function projection(c){return {schemaVersion:2,scopeKind:'workspace',projectId:null,organizationId:c.organizationId,ownerUserId:c.ownerUserId,workspaceId:c.workspaceId,runtimeId:c.runtimeId,credentialId:c.credentialId,bindingHash:c.bindingHash,bindingEpoch:c.bindingEpoch,runtimeState:c.runtimeState};}
export function workspaceV2McpIngress(req,res,next){
 if(!req.path.startsWith(root))return next();
 try{
  const operation=req.path.slice(root.length);if(req.method!=='POST'||req.originalUrl!==req.path||!['bootstrap','tools','call'].includes(operation)||!req.body||JSON.stringify(req.body).length>65536)return deny('WORKSPACE_MCP_INPUT');
  const c=scope(req),input=req.body,tool=workspaceTool();if(Object.keys(input).some(k=>!['schemaVersion','nonce','name','arguments'].includes(k))||input.schemaVersion!==2)return deny('WORKSPACE_MCP_INPUT');
  let data;
  if(operation==='bootstrap')data={scope:projection(c),tools:[tool]};
  else if(operation==='tools')data=[tool];
  else{
   if(typeof input.name!=='string'||!input.arguments||typeof input.arguments!=='object'||Array.isArray(input.arguments))return deny('WORKSPACE_MCP_INPUT');
   if(input.name===tool.name){if(Object.keys(input.arguments).length)return deny('WORKSPACE_MCP_SCOPE_ARGUMENTS');data=result(projection(c));}
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
