import {RequestExecutionError} from './request-execution-owner.mjs';
const axes=['organizationId','ownerUserId','projectId','workspaceId','bindingHash','bindingEpoch','status','runtimeId','mode','hostId','environmentId','available'];
const text=v=>typeof v==='string'&&v.length>0&&v.length<=512&&v===v.trim()&&!/[\u0000-\u001f\u007f]/.test(v);
const deny=()=>{throw new RequestExecutionError('CHAT_BINDING_UNAVAILABLE',404);};
const sameExecution=(a,b)=>a&&b&&axes.every(key=>a[key]===b[key]);
function original(record,execution,id){
 if(!record||record.id!==id||record.project_id!==execution.projectId||record.organization_id!==execution.organizationId||record.owner_user_id!==execution.ownerUserId||record.visibility!=='private'||typeof record.metadata!=='string')return deny();
 let metadata;try{metadata=JSON.parse(record.metadata);}catch{return deny();}
 if(!metadata||metadata.source!=='opencode-chat'||metadata.sourceRuntimeId!==execution.runtimeId||!text(metadata.sourceSessionId))return deny();
 return {id:record.id,projectId:record.project_id,organizationId:record.organization_id,ownerUserId:record.owner_user_id,visibility:record.visibility,metadata:record.metadata,engineSessionId:metadata.sourceSessionId};
}
/** This adapter changes ID representation only. Existing request/execution/chat
 * owners authenticate, authorize, reject ambiguity and enforce archive state.
 * There is no new conversation, identity, permission or persistent mapping. */
export function createCanonicalRequestChatResolver(ports){
 if(['resolveExecution','resolveEngineChat','getConversation'].some(key=>typeof ports?.[key]!=='function'))throw new RequestExecutionError('CHAT_BINDING_OWNER_UNAVAILABLE');
 return (request,execution,contextId,purpose='active')=>{
  if(!text(contextId)||!execution||!['active','history'].includes(purpose))return deny();
  const selected={projectId:execution.projectId,workspaceId:execution.workspaceId,runtimeId:execution.runtimeId};
  const current=ports.resolveExecution(request,selected);if(!sameExecution(current,execution)||!text(current.projectId))return deny();
  // Current original identity/execution is checked before private Context metadata.
  const before=original(ports.getConversation(current.projectId,contextId),current,contextId);
  const bound=ports.resolveEngineChat(request,current,before.engineSessionId,purpose);
  if(!sameExecution(bound,current)||bound.chatId!==before.engineSessionId||bound.engineSessionId!==before.engineSessionId||bound.contextConversationId!==contextId||bound.visibility!=='private')return deny();
  const final=ports.resolveExecution(request,selected);if(!sameExecution(final,current))return deny();
  const after=original(ports.getConversation(final.projectId,contextId),final,contextId);if(JSON.stringify(after)!==JSON.stringify(before))return deny();
  return Object.freeze({...bound,chatId:contextId,contextConversationId:contextId});
 };
}
