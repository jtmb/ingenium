import type {Request} from 'express';
import type {OwnerScope,WorkspaceRoot,ProjectRef} from '../../../../packages/veyra-projects/contracts.js';
type Selection={projectId:null;workspaceId:string;runtimeId:string};
/** Actor-scoped metadata on the existing Core writer. A browser supplies only
 * selectors; original manager placement owns every attached execution root. */
import {getDb,execTransaction,checkpointAfterWrite,authorization,runtimes} from 'ingenium-core';
import {revalidateRequestIdentity} from '../request-identity.js';
import {toAuthorizationPrincipal} from '../authorization-policy.js';
import {ProjectCatalog,ProjectError,requireValue} from './catalog.mjs';
import {withManagedWorkspaceV2Placement,resolveCurrentWorkspaceV2Execution} from './workspace-v2-placement.mjs';
function fail(code:string,status:number):never{throw new ProjectError(code,status)}
function owner(request:Request,organizationId:string,attachedRoot:WorkspaceRoot|null=null){
 const db=getDb(process.env.INGENIUM_CORE_DB_PATH);
 function identity(){
  const actual=revalidateRequestIdentity(request);
  if(actual?.principal.type!=='user'||!actual.principal.session)fail('BROWSER_SESSION_REQUIRED',401);
  const row=db.prepare('SELECT instance_id FROM veyra_installation_identity WHERE singleton=1').get() as {instance_id:string}|undefined;
  if(!row||!/^[a-f0-9]{32}$/.test(row.instance_id))fail('INSTALLATION_IDENTITY_UNAVAILABLE',503);
  return {principal:toAuthorizationPrincipal(actual.principal),scope:{instanceId:row.instance_id,organizationId,ownerUserId:actual.principal.id}};
 }
 const first=identity(),scope=Object.freeze(first.scope);
 function authorize(candidate:OwnerScope,action:string,target:string|WorkspaceRoot|null){
  const now=identity();
  if(JSON.stringify(now.scope)!==JSON.stringify(scope)||JSON.stringify(candidate)!==JSON.stringify(scope))return false;
  const permission=action==='projects:read'||action==='projects:list'?'read':'admin';
  if(!authorization.requireOrganizationPermission(now.principal,organizationId,'projects',permission).allowed)return false;
  if(action==='roots:attach')return attachedRoot!==null&&JSON.stringify(target)===JSON.stringify(attachedRoot);
  return ['projects:read','projects:list','projects:create','projects:write'].includes(action);
 }
 requireValue(authorize(scope,'projects:list',null),'NOT_FOUND',404);
 return {db,scope,authorize,catalog:new ProjectCatalog({db,transaction:execTransaction,checkpointAfterWrite,authorize})};
}
export function listRequestWorkspaceProjects(request:Request,organizationId:string,page?:{after?:string;limit?:number;archived?:boolean}):{data:ProjectRef[];pagination:{hasMore:boolean;cursor:string}}{const o=owner(request,organizationId);return o.catalog.list(o.scope,page)}
export function getRequestWorkspaceProject(request:Request,organizationId:string,id:string):ProjectRef{const o=owner(request,organizationId);return o.catalog.get(o.scope,id)}
export function updateRequestWorkspaceProject(request:Request,organizationId:string,id:string,expectedRevision:number,patch:{label?:string;pinned?:boolean;archived?:boolean}):ProjectRef{const o=owner(request,organizationId);return o.catalog.update(o.scope,id,expectedRevision,patch)}
export async function createRequestWorkspaceProject(request:Request,organizationId:string,input:{id:string;label:string;selection:Selection}):Promise<{data:ProjectRef;replayed:boolean}>{
 return withManagedWorkspaceV2Placement(request,input.selection,()=>{
  const facts=resolveCurrentWorkspaceV2Execution(request,input.selection);
  requireValue(facts.organizationId===organizationId&&facts.projectId===null&&facts.available,'NOT_FOUND',404);
  const workspace=runtimes.getAuthorizedWorkspaceV2(facts.workspaceId);
  requireValue(workspace&&workspace.ownerUserId===facts.ownerUserId&&workspace.organizationId===facts.organizationId&&workspace.storageMappingHash===facts.bindingHash&&workspace.securityEpoch===facts.bindingEpoch&&workspace.status==='authorized','WORKSPACE_BINDING_CHANGED',409);
  const root=Object.freeze({id:workspace.id,canonicalRootId:'workspace-v2:'+workspace.id+':'+workspace.storageMappingHash,hostId:facts.hostId,environmentId:facts.environmentId,displayPath:workspace.storagePath,isPrimary:true,repositoryIdentity:null});
  const o=owner(request,organizationId,root);requireValue(o.authorize(o.scope,'projects:create',null),'FORBIDDEN',403);
  // Same selected project ID is a recoverable original intent, not an instruction
  // to duplicate a project after a lost response. Only an exact unchanged preimage
  // is accepted as the same creation; later edits require the revisioned API.
  const existing=o.db.prepare('SELECT 1 FROM veyra_workspace_projects WHERE instance_id=? AND organization_id=? AND owner_user_id=? AND id=?').get(o.scope.instanceId,o.scope.organizationId,o.scope.ownerUserId,input.id);
  if(existing){
   const actual=o.catalog.get(o.scope,input.id);
   requireValue(actual.revision===1&&actual.label===input.label&&!actual.archived&&actual.roots.length===1&&(Object.keys(root) as (keyof WorkspaceRoot)[]).every(k=>actual.roots[0]?.[k]===root[k]),'PROJECT_CREATE_CONFLICT',409);
   return {data:actual,replayed:true};
  }
  const created=o.catalog.create(o.scope,{label:input.label,roots:[root]},input.id);
  return {data:created,replayed:false};
 });
}
