/** Request-bound adapter. No injectable owner/clock/permission/placement port.
 * Install beside request-execution.ts. Current real owner refuses null Project;
 * that refusal is intentionally preserved until Root integrates genuine v2 production.
 */
import {getDb,checkpointAfterWrite,sanitizeFts5Query} from 'ingenium-core';
import {revalidateRequestIdentity} from '../request-identity.js';
import {resolveRequestExecution} from './request-execution.js';
import * as store from '../../../../packages/ingenium-core/lib/tools/workspace-context-store.mjs';
const fail=code=>{throw Object.assign(Error(code),{code,status:code==='WORKSPACE_CONTEXT_IDENTITY_UNAVAILABLE'?401:503});};
function current(request,selection,db) {
 if(!selection||selection.projectId!==null||Object.keys(selection).sort().join(',')!=='projectId,runtimeId,workspaceId')fail('INVALID_WORKSPACE_EXECUTION_SELECTION');
 const identity=revalidateRequestIdentity(request);
 // Service/browser-runtime credential v2 authentication remains a separate explicit
 // original-auth owner gate. A nullable credential row is never sufficient authority.
 if(identity?.principal.type!=='user'||!identity.principal.session)fail('WORKSPACE_CONTEXT_IDENTITY_UNAVAILABLE');
 const execution=resolveRequestExecution(request,selection);
 if(execution.projectId!==null||execution.available!==true||execution.ownerUserId!==identity.principal.id)fail('WORKSPACE_CONTEXT_EXECUTION_UNAVAILABLE');
 const original=db.prepare(`SELECT * FROM runtime_original_provisions WHERE runtime_id=? AND project_id IS NULL AND schema_version=2`).get(execution.runtimeId);
 if(!original)fail('WORKSPACE_ORIGINAL_PROVISION_UNAVAILABLE');
 const scope=Object.freeze({...execution,executionGeneration:original.start_identity});
 const runtime=store.assertWorkspaceStoreScope(db,scope);
 return {scope,key:JSON.stringify([identity.principal.id,identity.principal.session.id,identity.principal.session.security_epoch,execution,runtime.revision,runtime.backend_container_id,original.start_identity])};
}
function run(request,selection,mutate,operation) {
 const db=getDb(process.env.INGENIUM_CORE_DB_PATH);
 for(const version of [136,137])if(!db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(`veyra_evolution_${version}`))fail('WORKSPACE_CONTEXT_MIGRATION_UNAVAILABLE');
 // Own one aggregate transaction on the canonical writer. Read callbacks also get
 // a coherent snapshot; no network/engine request, await, or external effect inside.
 if(db.inTransaction)fail('WORKSPACE_CONTEXT_NESTED_TRANSACTION_UNAVAILABLE');
 const result=db.transaction(()=>{
  const initial=current(request,selection,db),value=operation(db,initial.scope);
  if(current(request,selection,db).key!==initial.key)fail('WORKSPACE_CONTEXT_EXECUTION_CHANGED');
  return value;
 }).immediate();
 if(mutate)checkpointAfterWrite();return result;
}
export const getWorkspaceExecutionV2=(request,selection)=>run(request,selection,false,(_db,scope)=>scope);
export const createWorkspaceContext=(request,selection,input)=>run(request,selection,true,(db,s)=>store.createInTransaction(db,s,input));
export const getWorkspaceContext=(request,selection,id)=>run(request,selection,false,(db,s)=>store.getConversation(db,s,id));
export const listWorkspaceContexts=(request,selection,options)=>run(request,selection,false,(db,s)=>store.listConversations(db,s,options));
export const resolveWorkspaceEngineMapping=(request,selection,id,options)=>run(request,selection,false,(db,s)=>store.resolveEngineMapping(db,s,id,options));
export const listWorkspaceMessages=(request,selection,id,options)=>run(request,selection,false,(db,s)=>store.listMessageSummaries(db,s,id,options));
export const retrieveWorkspaceMessages=(request,selection,id,ids)=>run(request,selection,false,(db,s)=>store.retrieveMessages(db,s,id,ids));
export const appendWorkspaceMessage=(request,selection,id,input)=>run(request,selection,true,(db,s)=>store.appendInTransaction(db,s,id,input));
export const checkpointWorkspaceContext=(request,selection,id,input)=>run(request,selection,true,(db,s)=>store.checkpointInTransaction(db,s,id,input));
export const listWorkspaceCheckpoints=(request,selection,id,options)=>run(request,selection,false,(db,s)=>store.listCheckpoints(db,s,id,options));
export const authorizeWorkspaceContextMaintenance=(request,selection,id,input)=>run(request,selection,true,(db,s)=>store.authorizeMaintenanceInTransaction(db,s,id,input));
export const archiveWorkspaceContext=(request,selection,id,input)=>run(request,selection,true,(db,s)=>store.archiveInTransaction(db,s,id,input));
export const restoreWorkspaceCheckpoint=(request,selection,id,checkpointId,input)=>run(request,selection,true,(db,s)=>store.restoreInTransaction(db,s,id,checkpointId,input));
export const deleteWorkspaceContext=(request,selection)=>run(request,selection,true,()=>store.deleteInTransaction());
// Memory3 owns actual extraction/forget policy/suppression/receipt transactions.
// There is deliberately no second transcript deletion/lifecycle store here.
export const forgetWorkspaceContext=(request,selection)=>run(request,selection,true,()=>store.forgetInTransaction());

export const searchWorkspaceMessages=(request,selection,id,query,limit)=>{
 if(typeof query!=='string'||!query.trim()||query.length>512)fail('INVALID_WORKSPACE_CONTEXT_INPUT');
 return run(request,selection,false,(db,s)=>store.searchMessageSummaries(db,s,id,sanitizeFts5Query(query),limit));
};
