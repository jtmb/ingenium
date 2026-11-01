import {workspaceProjectMatchesExecution}from'./workspace-project-execution.mjs';
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const text=(v,n)=>typeof v==='string'&&v.length>0&&v.length<=n&&v===v.trim()&&!/[\u0000-\u001f\u007f]/.test(v);
const fields=['schemaVersion','instanceId','scopeKind','projectId','kind','workspaceId','runtimeId','ownerUserId','organizationId','hostId','environmentId','bindingHash','bindingEpoch','available'];
export function projectCreationExecution(value,scope){
 if(!value||value.schemaVersion!==2||value.scopeKind!=='workspace'||value.projectId!==null||value.kind!=='cluster'||value.available!==true||value.ownerUserId!==scope.ownerUserId||value.organizationId!==scope.organizationId||!uuid(value.ownerUserId)||!uuid(value.organizationId)||!uuid(value.runtimeId)||!/^[a-f0-9]{32}$/.test(value.instanceId)||!text(value.workspaceId,256)||!text(value.hostId,512)||!text(value.environmentId,512)||!/^[a-f0-9]{64}$/.test(value.bindingHash)||!Number.isSafeInteger(value.bindingEpoch)||value.bindingEpoch<0)throw Error('Confirm the selected workspace before adding a project.');
 return Object.freeze(Object.fromEntries(fields.map(k=>[k,value[k]])));
}
/** Durable intent only. Saved confirmation fields never replace fresh server
 * placement; recovery can only GET the original metadata ID. */
export function createWorkspaceProjectCreationJournal(storage,scope){
 if(!uuid(scope?.ownerUserId)||!uuid(scope?.organizationId)||typeof storage?.getItem!=='function'||typeof storage?.setItem!=='function')throw Error('Project creation cannot be tracked in this browser.');
 const key='veyra.project-create.v1:'+scope.ownerUserId+':'+scope.organizationId;
 function validate(row){
  if(!row||Object.keys(row).sort().join(',')!=='execution,id,label,version'||row.version!==1||!uuid(row.id)||!text(row.label,200))throw Error('A saved project creation needs review before another can start.');
  return Object.freeze({version:1,id:row.id,label:row.label,execution:projectCreationExecution(row.execution,scope)});
 }
 function read(){const raw=storage.getItem(key);if(raw===null)return null;const row=JSON.parse(raw);return row===null?null:validate(row)}
 function save(value){const raw=JSON.stringify(value);storage.setItem(key,raw);if(storage.getItem(key)!==raw)throw Error('Project creation could not be saved before submission.')}
 function begin(label,execution){if(read())throw Error('Check the earlier project creation before adding another.');if(!text(label,200))throw Error('Enter a project name of up to 200 characters.');const value=validate({version:1,id:crypto.randomUUID(),label,execution:projectCreationExecution(execution,scope)});save(value);return value}
 function finish(id){const current=read();if(!current||current.id!==id)throw Error('The saved project creation changed.');save(null)}
 return {read,begin,finish};
}
export function sameProjectCreationExecution(intent,execution){
 if(!intent||!execution)return false;
 try{const selected=projectCreationExecution(execution,{ownerUserId:intent.execution.ownerUserId,organizationId:intent.execution.organizationId});return fields.every(k=>selected[k]===intent.execution[k])}catch{return false}
}
export function createWorkspaceProjectCreationController(client,journal){
 let busy=false;
 async function submit(label,execution){
  if(busy)throw Error('A project creation is already being checked.');busy=true;let intent;
  try{intent=journal.begin(label,execution);const actual=await client.create(intent.id,intent.label,intent.execution);if(actual.id!==intent.id||actual.label!==intent.label||actual.roots?.length!==1||actual.roots[0]?.isPrimary!==true||!workspaceProjectMatchesExecution(actual,intent.execution))throw Error('Project creation is not confirmed. Check its saved status.');journal.finish(intent.id);return actual}
  catch(error){if(intent&&error?.status===409&&error?.code==='PROJECT_ROOT_ALREADY_ATTACHED')journal.finish(intent.id);throw error}
  finally{busy=false}
 }
 async function recover(){
  if(busy)throw Error('A project creation is already being checked.');busy=true;
  try{const intent=journal.read();if(!intent)throw Error('There is no saved project creation to check.');const actual=await client.get(intent.id);if(actual.id!==intent.id||actual.roots?.length!==1||actual.roots[0]?.isPrimary!==true||!workspaceProjectMatchesExecution({...actual,archived:false},intent.execution))throw Error('The saved project was found with a different folder or owner. Review its settings before continuing.');journal.finish(intent.id);return actual}
  finally{busy=false}
 }
 async function resume(execution){
  if(busy)throw Error('A project creation is already being checked.');busy=true;let intent;
  try{
   intent=journal.read();if(!intent)throw Error('There is no saved project creation to retry.');
   if(!sameProjectCreationExecution(intent,execution))throw Error('Reconnect the original workspace before retrying this saved creation.');
   // Explicit user retry only: SAME original ID, label and selectors. The
   // original API rechecks placement and either atomically creates once, returns
   // its exact unchanged preimage, or refuses. No runtime start is requested.
   const actual=await client.create(intent.id,intent.label,intent.execution);
   if(actual.id!==intent.id||actual.label!==intent.label||actual.roots?.length!==1||actual.roots[0]?.isPrimary!==true||!workspaceProjectMatchesExecution(actual,intent.execution))throw Error('Project creation is not confirmed. Check its saved status.');
   journal.finish(intent.id);return actual;
  }catch(error){if(intent&&error?.status===409&&error?.code==='PROJECT_ROOT_ALREADY_ATTACHED')journal.finish(intent.id);throw error}
  finally{busy=false}
 }
 return {submit,recover,resume,pending:()=>journal.read()};
}
