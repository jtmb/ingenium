import {provisionWorkspaceRuntimeFromRequestV2,refreshWorkspaceRuntimeFromRequestV2,stopWorkspaceRuntimeFromRequestV2,prepareWorkspaceSuccessorFromRequestV2,workspaceStartWasNotDispatched} from './workspace-v2-control.mjs';
/** Current actor metadata discovery and fresh original-manager confirmation.
 * Listed state is descriptive; only confirm returns an available execution. */
import type {Request} from 'express';
import {getDb,authorization,runtimes} from 'ingenium-core';
import {revalidateRequestIdentity} from '../request-identity.js';
import {toAuthorizationPrincipal} from '../authorization-policy.js';
import {deploymentMode} from '../runtime-mode.js';
import {ProjectError,requireValue} from './catalog.mjs';
import {withManagedWorkspaceV2Placement,resolveCurrentWorkspaceV2Execution} from './workspace-v2-placement.mjs';
export interface WorkspaceExecutionOption {
 schemaVersion:2;instanceId:string;scopeKind:'workspace';projectId:null;kind:'cluster';workspaceId:string;runtimeId:string|null;
 organizationId:string;ownerUserId:string;label:string;claimedState:string;bindingHash:string;bindingEpoch:number;
}
export interface ConfirmedWorkspaceExecution {
 schemaVersion:2;instanceId:string;scopeKind:'workspace';projectId:null;kind:'cluster';workspaceId:string;runtimeId:string;
 organizationId:string;ownerUserId:string;hostId:string;environmentId:string;bindingHash:string;bindingEpoch:number;available:true;
}
function current(request:Request,organizationId:string){
 const actual=revalidateRequestIdentity(request);
 if(actual?.principal.type!=='user'||!actual.principal.session)throw new ProjectError('BROWSER_SESSION_REQUIRED',401);
 requireValue(deploymentMode()==='control-plane','MANAGED_EXECUTION_UNAVAILABLE',503);
 const db=getDb(process.env.INGENIUM_CORE_DB_PATH),principal=toAuthorizationPrincipal(actual.principal);
 requireValue(authorization.requireOrganizationPermission(principal,organizationId,'projects','read').allowed,'NOT_FOUND',404);
 const installation=db.prepare('SELECT instance_id FROM veyra_installation_identity WHERE singleton=1').get() as {instance_id:string}|undefined;
 requireValue(installation&&/^[a-f0-9]{32}$/.test(installation.instance_id),'INSTALLATION_IDENTITY_UNAVAILABLE',503);
 return {db,authSessionId:actual.principal.session.id,ownerUserId:actual.principal.id,organizationId,instanceId:installation.instance_id,key:JSON.stringify([actual.principal.id,actual.principal.session.id,actual.principal.session.security_epoch,organizationId,installation.instance_id])};
}
export function listRequestWorkspaceExecutions(request:Request,organizationId:string,page:{after?:string;limit?:number}={}):{data:WorkspaceExecutionOption[];pagination:{hasMore:boolean;cursor:string}}{
 const o=current(request,organizationId),limit=page.limit??50,after=page.after??'';
 requireValue(Number.isInteger(limit)&&limit>0&&limit<=100&&typeof after==='string'&&after.length<=256);
 const rows=o.db.prepare(`SELECT w.id,w.organization_id,w.owner_user_id,w.storage_mapping_hash,w.security_epoch,r.id runtime_id,r.state
 FROM authorized_workspaces w LEFT JOIN workspace_execution_generations generation ON generation.workspace_id=w.id
 AND generation.generation=(SELECT MAX(current.generation) FROM workspace_execution_generations current WHERE current.workspace_id=w.id)
 LEFT JOIN runtime_instances r ON r.id=generation.runtime_id AND r.workspace_id=w.id AND r.schema_version=2 AND r.project_id IS NULL
 AND r.organization_id=w.organization_id AND r.owner_user_id=w.owner_user_id AND r.security_epoch=w.security_epoch
 WHERE w.schema_version=2 AND w.project_id IS NULL AND w.status='authorized' AND w.organization_id=? AND w.owner_user_id=? AND w.id>?
 ORDER BY w.id LIMIT ?`).all(organizationId,o.ownerUserId,after,limit+1) as Array<{id:string;organization_id:string;owner_user_id:string;storage_mapping_hash:string;security_epoch:number;runtime_id:string|null;state:string|null}>;
 const visible=rows.slice(0,limit).map(row=>{
  const names=o.db.prepare(`SELECT p.label FROM veyra_workspace_projects p JOIN veyra_workspace_roots root
   ON root.instance_id=p.instance_id AND root.organization_id=p.organization_id AND root.owner_user_id=p.owner_user_id AND root.project_id=p.id
   WHERE p.instance_id=? AND p.organization_id=? AND p.owner_user_id=? AND p.archived_at IS NULL AND root.id=? AND root.canonical_root_id=? LIMIT 2`)
   .all(o.instanceId,organizationId,o.ownerUserId,row.id,'workspace-v2:'+row.id+':'+row.storage_mapping_hash) as Array<{label:string}>;
  return {schemaVersion:2 as const,instanceId:o.instanceId,scopeKind:'workspace' as const,projectId:null,kind:'cluster' as const,workspaceId:row.id,runtimeId:row.runtime_id,
   organizationId:row.organization_id,ownerUserId:row.owner_user_id,label:names.length===1?names[0]!.label:row.id,claimedState:row.state??'UNPREPARED',bindingHash:row.storage_mapping_hash,bindingEpoch:row.security_epoch};
 });
 return {data:visible,pagination:{hasMore:rows.length>limit,cursor:visible.at(-1)?.workspaceId??after}};
}
export async function confirmRequestWorkspaceExecution(request:Request,organizationId:string,selection:{projectId:null;workspaceId:string;runtimeId:string}):Promise<ConfirmedWorkspaceExecution>{
 const before=current(request,organizationId);
 return withManagedWorkspaceV2Placement(request,selection,():ConfirmedWorkspaceExecution=>{
  const after=current(request,organizationId),facts=resolveCurrentWorkspaceV2Execution(request,selection);
  requireValue(before.key===after.key&&facts.ownerUserId===after.ownerUserId&&facts.organizationId===organizationId&&facts.projectId===null&&facts.available===true,'EXECUTION_SCOPE_CHANGED',409);
  return {schemaVersion:2,instanceId:after.instanceId,scopeKind:'workspace',projectId:null,kind:'cluster',organizationId,ownerUserId:facts.ownerUserId,workspaceId:facts.workspaceId,runtimeId:facts.runtimeId,
   hostId:facts.hostId,environmentId:facts.environmentId,bindingHash:facts.bindingHash,bindingEpoch:facts.bindingEpoch,available:true};
 });
}

/** Fresh original placement is mandatory before the canonical ticket writer. */
export async function launchRequestWorkspaceExecution(request:Request,organizationId:string,input:{workspaceId:string;runtimeId:string;audience:'web'|'cli';exchangeProof:string}){
 const before=current(request,organizationId),selection={projectId:null,workspaceId:input.workspaceId,runtimeId:input.runtimeId} as const;
 return withManagedWorkspaceV2Placement(request,selection,()=>{
  const after=current(request,organizationId),facts=resolveCurrentWorkspaceV2Execution(request,selection);
  requireValue(before.key===after.key&&facts.ownerUserId===after.ownerUserId&&facts.organizationId===organizationId&&facts.projectId===null&&facts.available===true,'EXECUTION_SCOPE_CHANGED',409);
  const rootDomain=process.env.INGENIUM_RUNTIME_ROOT_DOMAIN?.trim(),scheme=process.env.INGENIUM_RUNTIME_SCHEME?.trim();
  requireValue(rootDomain&&(scheme==='http'||scheme==='https'),'BROWSER_RUNTIME_CONFIGURATION_UNAVAILABLE',503);
  const ticket=runtimes.issueWorkspaceBrowserLaunchTicketV2({runtimeId:facts.runtimeId,workspaceId:facts.workspaceId,organizationId,ownerUserId:after.ownerUserId,authSessionId:after.authSessionId,bindingHash:facts.bindingHash,bindingEpoch:facts.bindingEpoch,audience:input.audience,exchangeProof:input.exchangeProof,rootDomain,scheme,launcherOrigin:request.get('origin')??''});
  return {schemaVersion:2 as const,instanceId:after.instanceId,scopeKind:'workspace' as const,projectId:null,organizationId,workspaceId:facts.workspaceId,runtimeId:facts.runtimeId,launchUrl:ticket.origin+'/__ingenium/exchange',status:'ready' as const};
 });
}

/** Same authenticated organization owner; actual effects remain inside fixed Core/manager owners. */
export async function controlRequestWorkspaceExecution(request:Request,organizationId:string,input:{workspaceId:string;runtimeId:string},operation:'start'|'refresh'|'stop'|'successor'){
 const before=current(request,organizationId),selection={projectId:null,workspaceId:input.workspaceId,runtimeId:input.runtimeId} as const;
 const runtime=runtimes.getWorkspaceRuntimeV2(input.runtimeId),workspace=runtimes.getAuthorizedWorkspaceV2(input.workspaceId);
 requireValue(runtime&&workspace&&runtime.workspaceId===workspace.id&&workspace.organizationId===organizationId&&workspace.ownerUserId===before.ownerUserId&&runtime.ownerUserId===before.ownerUserId&&runtime.organizationId===organizationId,'EXECUTION_SCOPE_UNAVAILABLE',404);
 const owner={start:provisionWorkspaceRuntimeFromRequestV2,refresh:refreshWorkspaceRuntimeFromRequestV2,stop:stopWorkspaceRuntimeFromRequestV2,successor:prepareWorkspaceSuccessorFromRequestV2,workspaceStartWasNotDispatched}[operation];
 requireValue(typeof owner==='function','INVALID_EXECUTION_OPERATION',422);
 let result:unknown;
 try{result=await owner(request,selection)}catch(error){
  if(error instanceof ProjectError)throw error;
  if(operation==='start'&&workspaceStartWasNotDispatched(error,input.runtimeId))throw new ProjectError('WORKSPACE_START_NOT_DISPATCHED',503);
  const code=error&&typeof error==='object'&&'code'in error?String(error.code):'';
  if(['REVISION_CONFLICT','STATE_CONFLICT'].includes(code))throw new ProjectError(code,409);
  throw new ProjectError(/^WORKSPACE_V2_[A-Z_]+$/.test(code)?code:'EXECUTION_CONTROL_UNAVAILABLE',503);
 }
 const after=current(request,organizationId);
 requireValue(before.key===after.key,'EXECUTION_SCOPE_CHANGED',409);return result;
}
