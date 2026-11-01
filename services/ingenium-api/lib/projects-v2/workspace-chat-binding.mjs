import {RequestExecutionError} from './request-execution-owner.mjs';
const axes=['organizationId','ownerUserId','projectId','workspaceId','bindingHash','bindingEpoch','status','runtimeId','mode','hostId','environmentId','available'];
const validId=id=>typeof id==='string'&&id.length>0&&id.length<=512&&id===id.trim()&&!/[\u0000-\u001f\u007f]/.test(id);
const deny=()=>{throw new RequestExecutionError('CHAT_BINDING_UNAVAILABLE',404);};
const same=(a,b)=>a&&b&&axes.every(key=>a[key]===b[key]);
/** Identity and placement remain with the original execution owner. This
 * adapter changes ID representation using canonical Context/source records. */
export function createWorkspaceRequestChatResolver(ports){
 if(['resolveExecution','findEngineContext','getConversation','resolveMapping'].some(key=>typeof ports?.[key]!=='function'))throw new RequestExecutionError('CHAT_BINDING_OWNER_UNAVAILABLE');
 return(request,execution,id,purpose='active',representation='engine')=>{
  if(!execution||execution.projectId!==null||!validId(id)||!['active','history'].includes(purpose)||!['engine','context'].includes(representation))return deny();
  const selection={projectId:null,workspaceId:execution.workspaceId,runtimeId:execution.runtimeId};
  const current=ports.resolveExecution(request,selection);if(!same(current,execution))return deny();
  const read=()=>{
   const result=representation==='engine'?ports.findEngineContext(request,selection,id,purpose):{conversation:ports.getConversation(request,selection,id),mapping:ports.resolveMapping(request,selection,id,{purpose})};
   const c=result?.conversation,m=result?.mapping;
   if(!c||!m||!validId(c.id)||c.id!==m.contextConversationId||c.project_id!==null||c.scope_kind!=='workspace'||c.visibility!=='private'||c.organization_id!==current.organizationId||c.owner_user_id!==current.ownerUserId||c.workspace_id!==current.workspaceId||c.runtime_id!==m.runtimeId||c.execution_generation!==m.executionGeneration||c.binding_hash!==current.bindingHash||c.binding_epoch!==current.bindingEpoch||!validId(m.engineSessionId)||m.purpose!==purpose||m.runtimeId!==current.runtimeId||m.executionGeneration!==current.executionGeneration||
    (representation==='engine'?m.engineSessionId!==id:c.id!==id)||(purpose==='active'&&c.archived===true))return deny();
   let metadata;try{metadata=JSON.parse(c.metadata);}catch{return deny();}
   if(!metadata||metadata.source!=='opencode-chat'||metadata.sourceRuntimeId!==m.runtimeId||metadata.sourceSessionId!==m.engineSessionId)return deny();
   return {contextConversationId:c.id,engineSessionId:m.engineSessionId,runtimeId:m.runtimeId,executionGeneration:m.executionGeneration,archived:c.archived===true};
  };
  const original=read();const final=ports.resolveExecution(request,selection);
  if(!same(final,current)||final.executionGeneration!==current.executionGeneration||JSON.stringify(read())!==JSON.stringify(original))return deny();
  return Object.freeze({...final,chatId:representation==='engine'?original.engineSessionId:original.contextConversationId,contextConversationId:original.contextConversationId,engineSessionId:original.engineSessionId,visibility:'private'});
 };
}
