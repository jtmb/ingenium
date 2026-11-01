/** Request-bound adapter on the existing canonical writer. Every operation
 * requires the original current identity, null-Project runtime and placement.
 * Actual v2 image/producer qualification remains a release gate.
 */
import {getDb,checkpointAfterWrite,sanitizeFts5Query,runtimes,workspaceRuntimeCredentialsV2} from 'ingenium-core';
import {opencodeClient,isOpenCodeError} from '../opencode-client.js';
import {currentOpenCodeRuntimeTarget,withOpenCodeRuntimeTarget} from '../runtime-opencode-context.js';
import {revalidateRequestIdentity} from '../request-identity.js';
import {resolveCurrentWorkspaceV2Execution,withManagedWorkspaceV2Placement} from './workspace-v2-placement.mjs';
import {workspaceContext as store} from 'ingenium-core';
const fail=code=>{throw Object.assign(Error(code),{code,status:code==='WORKSPACE_CONTEXT_IDENTITY_UNAVAILABLE'?401:503});};
function current(request,selection,db) {
 if(!selection||selection.projectId!==null||Object.keys(selection).sort().join(',')!=='projectId,runtimeId,workspaceId')fail('INVALID_WORKSPACE_EXECUTION_SELECTION');
 const identity=revalidateRequestIdentity(request);
 // Service/browser-runtime credential v2 authentication remains a separate explicit
 // original-auth owner gate. A nullable credential row is never sufficient authority.
 if(identity?.principal.type!=='user'||!identity.principal.session)fail('WORKSPACE_CONTEXT_IDENTITY_UNAVAILABLE');
 const execution=resolveCurrentWorkspaceV2Execution(request,selection);
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
 if(db.inTransaction&&mutate)fail('WORKSPACE_CONTEXT_NESTED_TRANSACTION_UNAVAILABLE');
 const readOrWrite=()=>{
  const initial=current(request,selection,db),value=operation(db,initial.scope);
  if(current(request,selection,db).key!==initial.key)fail('WORKSPACE_CONTEXT_EXECUTION_CHANGED');
  return value;
 };
 // Memory/other canonical owners may recheck this binding in THEIR transaction
 // on the SAME Core handle. Only these fixed read operations may join it; no
 // nested writer, engine request, callback injection or checkpoint is admitted.
 const result=db.inTransaction?readOrWrite():db.transaction(readOrWrite).immediate();
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

/** Reads only the canonical original-engine source mapping. An engine label,
 * session identifier supplied by a browser, or Context metadata cannot mint it. */
export const findWorkspaceEngineContext=(request,selection,engineSessionId,purpose='active')=>run(request,selection,false,(db,s)=>{
 if(typeof engineSessionId!=='string'||!engineSessionId.length||engineSessionId.length>512||/[\u0000-\u001f\u007f]/.test(engineSessionId)||!['active','history'].includes(purpose))fail('INVALID_WORKSPACE_CONTEXT_INPUT');
 const matches=db.prepare(`SELECT conversation_id FROM context_conversation_sources WHERE project_id IS NULL AND workspace_id=? AND runtime_id=? AND execution_generation=? AND source_session_id=?`).all(s.workspaceId,s.runtimeId,s.executionGeneration,engineSessionId);
 if(matches.length!==1)fail('WORKSPACE_ENGINE_MAPPING_UNAVAILABLE');
 const mapping=store.resolveEngineMapping(db,s,matches[0].conversation_id,{purpose});
 if(mapping.engineSessionId!==engineSessionId||mapping.runtimeId!==s.runtimeId||mapping.executionGeneration!==s.executionGeneration)fail('WORKSPACE_ENGINE_MAPPING_UNAVAILABLE');
 return {conversation:store.getConversation(db,s,mapping.contextConversationId),mapping};
});

/** Selection only: the caller must still enter the original placement owner.
 * This never authenticates a browser or adopts a runtime from its labels. */
export function workspaceEngineSelection(request){
 const id=request.get('x-ingenium-runtime-id')??(typeof request.query.runtime_id==='string'?request.query.runtime_id:'');
 if(!id)return null;
 const runtime=runtimes.getWorkspaceRuntimeV2(id);
 return runtime?{projectId:null,workspaceId:runtime.workspaceId,runtimeId:runtime.id}:null;
}
function assertOriginalEngineTarget(scope){
 const runtime=runtimes.getWorkspaceRuntimeV2(scope.runtimeId),target=currentOpenCodeRuntimeTarget();
 if(!runtime||!target||target.baseUrl!=='http://'+runtime.backendName+':4098'||target.directory!=='/workspace'||target.authHeader!==workspaceRuntimeCredentialsV2.workspaceRuntimeOpenCodeAuthV2(scope.runtimeId))fail('WORKSPACE_ORIGINAL_ENGINE_TARGET_UNAVAILABLE');
}
/** This function owns the original create HTTP call. No caller-supplied session
 * response, metadata, readiness receipt, or engine identifier can create a link.
 * Network work stays outside the canonical writer's transaction. A changed
 * identity/execution after dispatch never writes a speculative Context record. */
export async function createOriginalWorkspaceEngineSession(request,selection,input={}){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>k!=='title')||(input.title!==undefined&&(typeof input.title!=='string'||!input.title.trim()||input.title.length>256)))fail('INVALID_WORKSPACE_CONTEXT_INPUT');
 const db=getDb(process.env.INGENIUM_CORE_DB_PATH);if(db.inTransaction)fail('WORKSPACE_CONTEXT_NESTED_TRANSACTION_UNAVAILABLE');
 const initial=await withManagedWorkspaceV2Placement(request,selection,()=>{const observed=current(request,selection,db);assertOriginalEngineTarget(observed.scope);return observed;});
 const created=await opencodeClient.createSession(input,'/workspace');
 if(isOpenCodeError(created))return {error:{code:'WORKSPACE_ENGINE_CREATION_UNCONFIRMED',message:'Agent conversation creation could not be confirmed. Reconcile existing agent history before creating another conversation.'}};
 try{
  // The original create request may outlive a short placement observation.
  // Obtain a fresh observation of the SAME original runtime before the writer.
  return await withManagedWorkspaceV2Placement(request,selection,()=>{
   const after=current(request,selection,db);if(after.key!==initial.key)fail('WORKSPACE_CONTEXT_EXECUTION_CHANGED');assertOriginalEngineTarget(after.scope);
   return run(request,selection,true,(writer,scope)=>{
    if(current(request,selection,writer).key!==initial.key)fail('WORKSPACE_CONTEXT_EXECUTION_CHANGED');
    const linked=store.linkOriginalEngineInTransaction(writer,scope,{engineSessionId:created.id,title:created.title});
    return {...created,contextConversationId:linked.conversation.id};
   });
  });
 }catch{
  // The engine may already hold the new session. Never reissue or report that
  // creation failed cleanly. Recovery/reconciliation remains a distinct gate.
  return {error:{code:'WORKSPACE_ENGINE_CONTEXT_UNCONFIRMED',message:'The agent conversation was created, but saved history could not be confirmed. Reconcile existing agent history before creating another conversation.'}};
 }
}

function originalWorkspaceEngineTarget(scope){
 const runtime=runtimes.getWorkspaceRuntimeV2(scope.runtimeId);
 if(!runtime)fail('WORKSPACE_ORIGINAL_ENGINE_TARGET_UNAVAILABLE');
 return Object.freeze({baseUrl:'http://'+runtime.backendName+':4098',directory:'/workspace',authHeader:workspaceRuntimeCredentialsV2.workspaceRuntimeOpenCodeAuthV2(scope.runtimeId)});
}
function originalEngineConversation(request,selection,db,id,engineSessionId){
 const observed=current(request,selection,db),mapping=store.resolveEngineMapping(db,observed.scope,id);
 if(mapping.engineSessionId!==engineSessionId||mapping.runtimeId!==observed.scope.runtimeId||mapping.executionGeneration!==observed.scope.executionGeneration)fail('WORKSPACE_ENGINE_MAPPING_UNAVAILABLE');
 return {...observed,target:originalWorkspaceEngineTarget(observed.scope),key:JSON.stringify([observed.key,mapping])};
}
const originalEngineId=id=>typeof id==='string'&&id.length>0&&id.length<=512&&id===id.trim()&&!/[\u0000-\u001f\u007f]/.test(id);
function originalMessageText(message,role,engineSessionId,messageId){
 if(!message||message.info?.role!==role||message.info.id!==messageId||message.info.sessionID!==engineSessionId||!Array.isArray(message.parts))fail('WORKSPACE_ORIGINAL_MESSAGE_UNAVAILABLE');
 const text=[];
 for(const part of message.parts){
  if(part.sessionID!==engineSessionId||part.messageID!==messageId)fail('WORKSPACE_ORIGINAL_MESSAGE_UNAVAILABLE');
  if(part.type==='text'){if(typeof part.text!=='string')fail('WORKSPACE_ORIGINAL_MESSAGE_UNAVAILABLE');text.push(part.text);}
 }
 const content=text.join('\n\n');
 // File-only/oversized source projection requires its own structured-content
 // owner. Never invent a user utterance or accept the browser's text instead.
 if(!content.length||content.length>262144)fail('WORKSPACE_ORIGINAL_MESSAGE_TEXT_UNAVAILABLE');
 return content;
}
/** Browser inputs select IDs/revision only. Message bytes are read from the
 * actual authenticated engine under the original current runtime/Context.
 * The existing frontend's preceding-user association is retained; no causal
 * parent identity or engine execution retirement is inferred from that order. */
export async function persistOriginalWorkspaceEngineTurn(request,selection,contextId,input){
 if(!originalEngineId(contextId)||!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).sort().join(',')!=='assistantMessageId,expectedRevision,sessionId,userMessageId'||![input.sessionId,input.userMessageId,input.assistantMessageId].every(originalEngineId)||input.userMessageId===input.assistantMessageId||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0)fail('INVALID_WORKSPACE_CONTEXT_INPUT');
 const db=getDb(process.env.INGENIUM_CORE_DB_PATH);if(db.inTransaction)fail('WORKSPACE_CONTEXT_NESTED_TRANSACTION_UNAVAILABLE');
 const observe=()=>originalEngineConversation(request,selection,db,contextId,input.sessionId);
 const initial=await withManagedWorkspaceV2Placement(request,selection,observe);
 const same=()=>{const now=observe();if(now.key!==initial.key||now.target.authHeader!==initial.target.authHeader||now.target.baseUrl!==initial.target.baseUrl)fail('WORKSPACE_CONTEXT_EXECUTION_CHANGED');return now;};
 let cursor,lastUser,pair;const cursors=new Set(),messageIds=new Set();
 for(let pageNumber=0;pageNumber<100;pageNumber++){
  const page=await withManagedWorkspaceV2Placement(request,selection,()=>{
   same();return withOpenCodeRuntimeTarget(initial.target,()=>opencodeClient.getMessagesPage(input.sessionId,100,cursor,'/workspace'));
  });
  if(isOpenCodeError(page)||!page||!Array.isArray(page.messages)||page.messages.length>100)fail('WORKSPACE_ORIGINAL_MESSAGE_UNAVAILABLE');
  for(const message of page.messages){
   const info=message?.info;
   if(!info||!originalEngineId(info.id)||info.sessionID!==input.sessionId||messageIds.has(info.id))fail('WORKSPACE_ORIGINAL_MESSAGE_UNAVAILABLE');
   messageIds.add(info.id);if(info.role==='user')lastUser=message;
   if(info.id!==input.assistantMessageId)continue;
   if(info.role!=='assistant'||info.finish!=='stop'||info.error||!Number.isFinite(info.time?.created)||!Number.isFinite(info.time?.completed)||info.time.completed<info.time.created||lastUser?.info.id!==input.userMessageId)fail('WORKSPACE_ORIGINAL_COMPLETED_TURN_UNAVAILABLE');
   pair={userContent:originalMessageText(lastUser,'user',input.sessionId,input.userMessageId),assistantContent:originalMessageText(message,'assistant',input.sessionId,input.assistantMessageId)};break;
  }
  if(pair)break;
  if(page.nextCursor===undefined)fail('WORKSPACE_ORIGINAL_COMPLETED_TURN_UNAVAILABLE');
  if(typeof page.nextCursor!=='string'||!page.nextCursor.length||page.nextCursor.length>8192||cursors.has(page.nextCursor))fail('WORKSPACE_ORIGINAL_MESSAGE_CURSOR_UNAVAILABLE');
  cursors.add(page.nextCursor);cursor=page.nextCursor;
 }
 if(!pair)fail('WORKSPACE_ORIGINAL_MESSAGE_LIMIT');
 return await withManagedWorkspaceV2Placement(request,selection,()=>{
  same();return run(request,selection,true,(writer,scope)=>{
   same();return store.persistOriginalEngineTurnInTransaction(writer,scope,contextId,{engineSessionId:input.sessionId,userMessageId:input.userMessageId,assistantMessageId:input.assistantMessageId,...pair,expectedRevision:input.expectedRevision});
  });
 });
}
