import {projectCreationExecution}from'./workspace-project-creation.mjs';
import {workspaceProjectMatchesExecution}from'./workspace-project-execution.mjs';
/** Current-session project metadata reader. Client scope comparisons fence stale
 * presentation; the canonical API rechecks every permission and revision. */
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const text=(v,max=512)=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\u0000-\u001f\u007f]/.test(v);
export function createWorkspaceProjectClient(request,scope){
 if(typeof request!=='function'||!uuid(scope?.ownerUserId)||!uuid(scope?.organizationId))throw Error('Current actor and organization required.');
 const binding={...scope},base='/workspace-projects',query='?'+new URLSearchParams({organizationId:binding.organizationId});
 function project(row){
  if(!row||row.version!==1||!uuid(row.id)||!text(row.label,200)||!Number.isSafeInteger(row.revision)||row.revision<1||row.scope?.ownerUserId!==binding.ownerUserId||row.scope?.organizationId!==binding.organizationId||!text(row.scope?.instanceId)||row.source?.system!=='ingenium'||row.source.instanceId!==row.scope.instanceId||row.source.revision!==row.revision||typeof row.pinned!=='boolean'||typeof row.archived!=='boolean'||(row.archivedAt!==null&&!text(row.archivedAt))||row.archived!==(row.archivedAt!==null)||!Array.isArray(row.roots)||row.roots.length>32)throw Error('Project scope or revision changed. Refresh this catalog.');
  const ids=new Set();
  for(const root of row.roots){if(!root||!text(root.id)||ids.has(root.id)||!text(root.canonicalRootId)||!text(root.hostId)||!text(root.environmentId)||!text(root.displayPath,32760)||typeof root.isPrimary!=='boolean'||root.repositoryIdentity!==null&&!text(root.repositoryIdentity,4096))throw Error('Project root metadata is invalid.');ids.add(root.id)}
  return row;
 }
 async function list(archived=false){
  if(typeof archived!=='boolean')throw Error('Choose an explicit project view.');const rows=[],seen=new Set();let cursor='',instance=null;
  for(let page=0;page<100;page++){
   const response=await request(base+query+'&'+new URLSearchParams({after:cursor,limit:'50',archived:String(archived)}));
   if(!Array.isArray(response?.data)||response.data.length>50||typeof response.pagination?.hasMore!=='boolean'||typeof response.pagination?.cursor!=='string')throw Error('Project page could not be verified.');
   for(const raw of response.data){const row=project(raw);if(row.archived!==archived||seen.has(row.id)||row.id<=cursor||instance!==null&&row.scope.instanceId!==instance)throw Error('Project page scope changed.');instance=row.scope.instanceId;seen.add(row.id);rows.push(row)}
   if(!response.pagination.hasMore)return rows;
   if(!response.data.length||response.pagination.cursor!==response.data.at(-1).id||response.pagination.cursor<=cursor)throw Error('Project page did not advance.');cursor=response.pagination.cursor;
  }
  throw Error('Project catalog exceeds the bounded page limit.');
 }
 async function get(id){if(!uuid(id))throw Error('Select a project.');const row=project((await request(base+'/'+id+query))?.data);if(row.id!==id)throw Error('Project identity changed.');return row}
 async function update(current,patch){
  project(current);const keys=Object.keys(patch??{});if(!keys.length||keys.some(k=>!['label','pinned','archived'].includes(k))||patch.label!==undefined&&(!text(patch.label,200)||patch.label!==patch.label.trim())||keys.some(k=>k!=='label'&&typeof patch[k]!=='boolean'))throw Error('Invalid project change.');
  const actual=project((await request(base+'/'+current.id+query,{method:'PATCH',body:JSON.stringify({expectedRevision:current.revision,patch})}))?.data);
  if(actual.id!==current.id||actual.revision!==current.revision+1||keys.some(k=>actual[k]!==patch[k]))throw Error('The project change is not confirmed. Refresh its current status.');
  return actual;
 }
 async function create(id,label,execution){
  if(!uuid(id)||!text(label,200)||label!==label.trim())throw Error('Enter a project name and its original creation identity.');
  const actualExecution=projectCreationExecution(execution,binding);
  const response=await request(base+query,{method:'POST',body:JSON.stringify({id,label,selection:{projectId:null,workspaceId:actualExecution.workspaceId,runtimeId:actualExecution.runtimeId}})});
  const actual=project(response?.data);
  if(typeof response.replayed!=='boolean'||actual.id!==id||actual.label!==label||actual.revision!==1||actual.pinned||actual.archived||actual.roots.length!==1||actual.roots[0].isPrimary!==true||!workspaceProjectMatchesExecution(actual,actualExecution))throw Error('The new project could not be confirmed. Check its saved status.');
  return actual;
 }
 return {list,get,update,create};
}
