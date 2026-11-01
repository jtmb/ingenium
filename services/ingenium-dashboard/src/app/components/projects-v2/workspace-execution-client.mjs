/** Execution state is descriptive. Only a fresh canonical confirm can bind Work. */
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const text=(v,max=512)=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\u0000-\u001f\u007f]/.test(v);
const states=new Set(['UNPREPARED','ABSENT','PROVISIONING','STARTING','READY','IDLE','STOPPING','STOPPED','FAILED','REVOKED']);
const hex=(v,n)=>typeof v==='string'&&new RegExp('^[a-f0-9]{'+n+'}$').test(v);
export function createWorkspaceExecutionClient(request,scope){
 if(typeof request!=='function'||!uuid(scope?.ownerUserId)||!uuid(scope?.organizationId))throw Error('Current actor and organization required.');
 const owner=scope.ownerUserId,org=scope.organizationId,query='?'+new URLSearchParams({organizationId:org}),base='/workspace-execution';
 function option(row){
  if(!row||row.schemaVersion!==2||!hex(row.instanceId,32)||row.scopeKind!=='workspace'||row.projectId!==null||row.kind!=='cluster'||row.ownerUserId!==owner||row.organizationId!==org||!text(row.workspaceId,256)||row.runtimeId!==null&&!uuid(row.runtimeId)||!text(row.label,256)||!states.has(row.claimedState)||!hex(row.bindingHash,64)||!Number.isSafeInteger(row.bindingEpoch)||row.bindingEpoch<0||Object.hasOwn(row,'available')||row.claimedState==='UNPREPARED'&&row.runtimeId!==null||row.claimedState!=='UNPREPARED'&&row.runtimeId===null)throw Error('Execution metadata scope changed. Refresh the target list.');
  return Object.freeze({...row});
 }
 async function list(){
  const rows=[],seen=new Set();let cursor='',instance=null;
  for(let page=0;page<100;page++){
   const response=await request(base+query+'&'+new URLSearchParams({after:cursor,limit:'50'}));
   if(!Array.isArray(response?.data)||response.data.length>50||typeof response.pagination?.hasMore!=='boolean'||typeof response.pagination?.cursor!=='string')throw Error('Execution page could not be verified.');
   for(const value of response.data){const row=option(value);if(seen.has(row.workspaceId)||row.workspaceId<=cursor||instance!==null&&row.instanceId!==instance)throw Error('Execution page identity changed.');seen.add(row.workspaceId);instance=row.instanceId;rows.push(row)}
   if(!response.pagination.hasMore)return rows;
   if(!response.data.length||response.pagination.cursor!==response.data.at(-1).workspaceId||response.pagination.cursor<=cursor)throw Error('Execution page did not advance.');cursor=response.pagination.cursor;
  }
  throw Error('Execution registry exceeds the bounded page limit.');
 }
 const selection=row=>{option(row);if(!uuid(row.runtimeId))throw Error('This target has no prepared runtime.');return {projectId:null,workspaceId:row.workspaceId,runtimeId:row.runtimeId}};
 async function confirm(row){
  selection(row);if(!['READY','IDLE'].includes(row.claimedState))throw Error('This target is not ready for confirmation.');
  const data=(await request(base+'/confirm'+query+'&'+new URLSearchParams({workspaceId:row.workspaceId,runtimeId:row.runtimeId})))?.data;
  if(!data||data.schemaVersion!==2||data.instanceId!==row.instanceId||data.scopeKind!=='workspace'||data.projectId!==null||data.kind!=='cluster'||data.ownerUserId!==owner||data.organizationId!==org||data.workspaceId!==row.workspaceId||data.runtimeId!==row.runtimeId||data.bindingHash!==row.bindingHash||data.bindingEpoch!==row.bindingEpoch||data.available!==true||!text(data.hostId)||!text(data.environmentId))throw Error('Fresh execution confirmation did not match the selected target.');
  return Object.freeze({...data});
 }
 async function provision(row,journal){
  if(row.claimedState!=='ABSENT')throw Error('Only an unstarted runtime can be provisioned.');const input=selection(row);
  // Intent must survive reload BEFORE any dispatch. An unknown result never
  // authorizes a second provision call for the same original runtime identity.
  journal.begin(row);
  try{return await request(base+'/start'+query,{method:'POST',body:JSON.stringify({workspaceId:input.workspaceId,runtimeId:input.runtimeId})})}
  catch(error){if(error?.status===503&&error?.code==='WORKSPACE_START_NOT_DISPATCHED')journal.rejected(row);throw error;}
 }
 async function refresh(row){if(row.claimedState!=='STARTING')throw Error('Only the original starting runtime can be refreshed.');const input=selection(row);return request(base+'/refresh'+query,{method:'POST',body:JSON.stringify({workspaceId:input.workspaceId,runtimeId:input.runtimeId})})}
 async function stop(row){selection(row);if(!['STARTING','READY','IDLE','STOPPING','FAILED'].includes(row.claimedState))throw Error('This workspace is not running.');return request(base+'/stop'+query,{method:'POST',body:JSON.stringify({workspaceId:row.workspaceId,runtimeId:row.runtimeId})})}
 async function successor(row){selection(row);if(!['STOPPED','FAILED'].includes(row.claimedState))throw Error('Stop the workspace before reopening it.');const data=(await request(base+'/successor'+query,{method:'POST',body:JSON.stringify({workspaceId:row.workspaceId,runtimeId:row.runtimeId})}))?.data;
  if(!data||data.schemaVersion!==2||data.scopeKind!=='workspace'||data.projectId!==null||!uuid(data.id)||data.id===row.runtimeId||data.workspaceId!==row.workspaceId||data.organizationId!==org||data.ownerUserId!==owner||data.securityEpoch!==row.bindingEpoch||data.state!=='ABSENT'||data.backendContainerId!==null)throw Error('The new execution could not be verified. Refresh before starting it.');return Object.freeze({...data});}
 return {list,confirm,provision,refresh,stop,successor,option};
}
export function createWorkspaceExecutionJournal(storage,scope){
 if(!storage||!uuid(scope?.ownerUserId)||!uuid(scope?.organizationId))throw Error('Durable execution intent storage is required.');
 const key='veyra-workspace-execution-start-v1:'+scope.ownerUserId+':'+scope.organizationId;
 function read(){let entries;try{const raw=storage.getItem(key);entries=raw===null?[]:JSON.parse(raw)}catch{throw Error('Execution intent storage could not be read. No runtime was started.')}
  if(!Array.isArray(entries)||entries.length>64||entries.some(e=>!e||typeof e.key!=='string'||!['dispatched','confirmed'].includes(e.phase)))throw Error('Execution intent history needs review. No runtime was started.');return entries}
 const identity=row=>{if(!hex(row.instanceId,32)||!hex(row.bindingHash,64)||!text(row.workspaceId,256)||!uuid(row.runtimeId)||!Number.isSafeInteger(row.bindingEpoch)||row.bindingEpoch<0||row.ownerUserId!==scope.ownerUserId||row.organizationId!==scope.organizationId||row.projectId!==null)throw Error('Execution intent scope changed.');return JSON.stringify([row.instanceId,row.workspaceId,row.runtimeId,row.bindingHash,row.bindingEpoch])};
 function write(entries){const raw=JSON.stringify(entries);try{storage.setItem(key,raw);if(storage.getItem(key)!==raw)throw Error('write did not persist')}catch{throw Error('Execution intent could not be retained. No new start was dispatched.')}}
 return {
  has(row){return read().some(e=>e.key===identity(row))},
  begin(row){const entries=read().filter(e=>e.phase!=='confirmed'),id=identity(row);if(entries.some(e=>e.key===id))throw Error('This runtime already has a start intent. Refresh its status; do not repeat its start.');if(entries.length>=64)throw Error('Execution intent history needs review before starting another runtime.');write([...entries,{key:id,phase:'dispatched'}])},
  confirmed(row){const entries=read(),id=identity(row);if(entries.some(e=>e.key===id))write(entries.filter(e=>e.key!==id))},
  rejected(row){const entries=read(),id=identity(row);if(entries.some(e=>e.key===id&&e.phase==='dispatched'))write(entries.filter(e=>e.key!==id||e.phase!=='dispatched'))},
 };
}
