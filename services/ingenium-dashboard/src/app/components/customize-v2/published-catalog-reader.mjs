/** Read-only adapter to the original session-owned published catalog. No source
 * payload executes here; installed state must come from the target projection. */
const text=v=>typeof v==='string'&&v.length>0&&v.length<=512&&v===v.trim();
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const states=new Set(['available','unavailable','proposal-review-required','archived','installed','disabled']);
export function createPublishedCatalogPageReader(request,binding){
 if(typeof request!=='function'||!binding||!['public','personal'].includes(binding.visibility)||!text(binding.actorUserId)||!text(binding.projectId)||!text(binding.apiProject))throw Error('Explicit authenticated catalog target required');
 const b={...binding},scopeId=JSON.stringify(['published-catalog-v1',b.actorUserId,b.projectId,b.apiProject,b.visibility]);
 return async kind=>{
  if(!['plugin','skill'].includes(kind))throw Error('Invalid resource kind');const entries=[],seen=new Set();let cursor='';
  for(let page=0;page<100;page++){
   const params=new URLSearchParams({projectId:b.projectId,visibility:b.visibility,kind,after:cursor,limit:'100'});
   const response=await request('/customize/catalog?'+params),result=response?.data;
   if(!result||result.projectId!==b.projectId||result.visibility!==b.visibility||result.kind!==kind||!Array.isArray(result.data)||result.data.length>100||(result.next!==null&&!uuid(result.next)))throw Error('Published catalog target changed');
   for(const row of result.data){
    if(!row||!uuid(row.id)||seen.has(row.id)||row.id<=cursor||row.kind!==kind||row.visibility!==b.visibility||row.projectId!==b.projectId||!uuid(row.organizationId)||!text(row.name)||typeof row.description!=='string'||row.description.length>2000||!Number.isSafeInteger(row.revision)||row.revision<0||!hash(row.sourceSha256)||row.connectNeedsProject!==true||!states.has(row.connectionState)||typeof row.installed!=='boolean'||typeof row.enabled!=='boolean'||typeof row.archived!=='boolean'||!Array.isArray(row.actions)||row.actions.some(a=>!['connect','review'].includes(a)))throw Error('Invalid published catalog record');
    if(row.installed?(!uuid(row.resourceId)||!text(row.targetName)||!Number.isSafeInteger(row.resourceRevision)||row.resourceRevision<0||!hash(row.installedSourceSha256)||!['installed','disabled','archived'].includes(row.connectionState)||row.connectionState==='installed'&&(!row.enabled||row.archived)||row.connectionState==='disabled'&&(row.enabled||row.archived)||row.connectionState==='archived'&&!row.archived):(row.enabled||row.archived||row.resourceId!==null||row.targetName!==null||row.resourceRevision!==null||row.installedSourceSha256!==null||['installed','disabled','archived'].includes(row.connectionState)))throw Error('Installed state is not backed by an exact resource');
    seen.add(row.id);entries.push({id:row.id,name:row.name,description:row.description,kind,scope:b.visibility==='public'?'Public':'Personal',scopeId,scopeKind:b.visibility,category:kind==='plugin'?'Published plugins':'Published skills',installed:row.installed,enabled:row.enabled,archived:row.archived,revision:row.revision,actions:[...row.actions],apiProject:row.installed?b.apiProject:undefined,connectionState:row.connectionState,catalog:{sourceId:row.id,sourceSha256:row.sourceSha256,sourceRevision:row.revision,organizationId:row.organizationId,projectId:b.projectId,apiProject:b.apiProject,resourceId:row.resourceId,targetName:row.targetName}});
   }
   if(result.next===null)return entries;
   if(!result.data.length||result.next!==result.data.at(-1).id||result.next<=cursor)throw Error('Published catalog cursor did not advance');cursor=result.next;
  }
  throw Error('Published catalog exceeds bounded page window');
 };
}
