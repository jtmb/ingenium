/** Actual dedicated runtime audience and original manager placement owner.
 * No browser identity, caller-supplied positive ports or metadata-only readiness. */
import {AsyncLocalStorage}from'node:async_hooks';
import {getDb,runtimes,workspaceRuntimeCredentialsV2 as credentials}from'ingenium-core';
import * as provision from'ingenium-core/lib/tools/runtime-original-provision';
import {deploymentMode}from'../runtime-mode.js';
import {loadInstalledWorkspaceRuntimeV2ImageDefinition}from'../dot-v2/core126-installed-image-owner.js';
import {inspectOriginalWorkspaceRuntimeV2}from'../runtime-manager-client.js';
import {requireOriginalWorkspaceMcpAdmissionV2}from'./workspace-v2-control.mjs';
import {qualifyWorkspaceV2Placement}from'./workspace-v2-placement.mjs';
const local=new AsyncLocalStorage(),root='/api/v1/runtime/workspace-v2/mcp/';
const fail=code=>{throw Object.assign(Error(code),{code,status:code==='WORKSPACE_MCP_AUTHENTICATION'?401:503})};
export function authenticateWorkspaceMcpCredentialV2(request){
 if(deploymentMode()!=='control-plane'||request.method!=='POST'||!['bootstrap','tools','call'].some(op=>request.path===root+op)||request.originalUrl!==request.path||request.headers.cookie!==undefined||request.headers.origin!==undefined||request.headers['x-ingenium-audience']!=='workspace-runtime-v2'||request.headers['content-type']!=='application/json')return fail('WORKSPACE_MCP_AUTHENTICATION');
 const header=request.headers.authorization,token=typeof header==='string'&&header.startsWith('Bearer ')?header.slice(7):'';
 const c=credentials.inspectWorkspaceMcpCredentialV2(token);if(!c)return fail('WORKSPACE_MCP_AUTHENTICATION');requireOriginalWorkspaceMcpAdmissionV2(c,request.body?.nonce);return c;
}
function current(request){
 const c=authenticateWorkspaceMcpCredentialV2(request);if(!['READY','IDLE'].includes(c.runtimeState))return fail('WORKSPACE_MCP_ACTIVE_RUNTIME_REQUIRED');
 const db=getDb(process.env.INGENIUM_CORE_DB_PATH),r=runtimes.getWorkspaceRuntimeV2(c.runtimeId),w=runtimes.getAuthorizedWorkspaceV2(c.workspaceId),o=provision.readWorkspaceRuntimeOriginalProvision(db,c.runtimeId);
 if(!r||!w||!o||r.id!==c.runtimeId||r.workspaceId!==c.workspaceId||r.projectId!==null||w.projectId!==null||o.projectId!==null||r.ownerUserId!==c.ownerUserId||w.ownerUserId!==c.ownerUserId||r.organizationId!==c.organizationId||w.organizationId!==c.organizationId||w.status!=='authorized'||r.securityEpoch!==c.bindingEpoch||w.securityEpoch!==c.bindingEpoch||w.storageMappingHash!==c.bindingHash||o.parentContainerId!==r.backendContainerId)return fail('WORKSPACE_MCP_SCOPE_CHANGED');
 const installation=db.prepare('SELECT instance_id FROM veyra_installation_identity WHERE singleton=1').get();if(!installation||!/^[a-f0-9]{32}$/.test(installation.instance_id))return fail('WORKSPACE_MCP_INSTALLATION_UNAVAILABLE');
 const d=loadInstalledWorkspaceRuntimeV2ImageDefinition(o.imageId),installationId=installation.instance_id;
 return {db,credential:c,runtime:r,workspace:w,original:o,definition:d,installationId,key:JSON.stringify([c,r,w,o,d,installationId])};
}
export async function withOriginalWorkspaceMcpPlacement(request,work){
 if(typeof work!=='function')return fail('WORKSPACE_MCP_OPERATION_UNAVAILABLE');const initial=current(request),proof=await inspectOriginalWorkspaceRuntimeV2(initial.runtime.id),final=current(request);
 if(initial.db!==final.db||initial.key!==final.key)return fail('WORKSPACE_MCP_SCOPE_CHANGED');qualifyWorkspaceV2Placement(final.runtime,final.workspace,final.original,final.definition,proof,final.installationId);
 const lease={active:true,key:final.key,proof,db:final.db};try{return await local.run(lease,work)}finally{lease.active=false}
}
export function resolveOriginalWorkspaceMcpFacts(request){
 const facts=current(request),lease=local.getStore();if(!lease?.active||lease.db!==facts.db||lease.key!==facts.key)return fail('WORKSPACE_MCP_ORIGINAL_PLACEMENT_REQUIRED');
 const execution=qualifyWorkspaceV2Placement(facts.runtime,facts.workspace,facts.original,facts.definition,lease.proof,facts.installationId);
 return Object.freeze({db:facts.db,credential:facts.credential,original:facts.original,execution:Object.freeze({...execution,executionGeneration:facts.original.startIdentity})});
}
