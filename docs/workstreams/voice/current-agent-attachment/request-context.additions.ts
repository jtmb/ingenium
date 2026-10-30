/* Append INSIDE actual request-context.ts; uses its existing private WeakMap,
 * helpers and imports. Root-only source proposal, not a replacement file.
 * No CPU ownership binding or voice-agent-turn retirement is required here.
 */
import {selectedStateAdmission} from '../selected-state-admission.mjs';
export type VoiceAttachmentAction='read'|'speech'|'message'|'cancel-agent';
export function assertHostedVoiceAttachment(context:HostedVoiceRequestContext,scope:Readonly<VoiceScope>,action:VoiceAttachmentAction):void{
 if(!['read','speech','message','cancel-agent'].includes(action))return fail('VOICE_ATTACHMENT_ACTION_INVALID',422);
 const record=original(context),facts=liveFacts(record);
 if(!sameScope(scope,record.scope)||Date.now()>=record.deadlineAt)return fail('VOICE_EXECUTION_CHANGED',409);
 const permission=action==='message'||action==='cancel-agent'?'write':'read';
 const principal=toAuthorizationPrincipal(facts.p);
 if(!authorization.requireProjectPermission(principal,record.selection.projectId,'context',permission).allowed)return fail('VOICE_FORBIDDEN',403);
 const chat=contextConversations.getContextConversation(record.selection.projectId,record.selection.contextConversationId);
 if(!chat||!authorization.requireContentPermission(principal,{resourceType:'context_conversation',resourceId:chat.id,organizationId:chat.organization_id,projectId:chat.project_id,visibility:chat.visibility,ownerUserId:chat.owner_user_id},permission).allowed)return fail('VOICE_FORBIDDEN',403);
}
export async function withHostedVoiceAttachment<T>(context:HostedVoiceRequestContext,scope:Readonly<VoiceScope>,action:VoiceAttachmentAction,effect:(selection:Readonly<{scope:Readonly<VoiceScope>;sessionId:string;directory:string;agentId:string;modelId:string;providerId:string;variant:string|null;configurationRevision:string}>)=>Promise<T>|T):Promise<T>{
 assertHostedVoiceAttachment(context,scope,action);
 const record=original(context),placement={projectId:record.selection.projectId,workspaceId:record.selection.workspaceId,runtimeId:record.selection.runtimeId};
 const selectedEffect=()=>withManagedRequestPlacement(record.request,placement,async()=>{
  assertHostedVoiceAttachment(context,scope,action);
  const execution=resolveRequestExecution(record.request,placement),chat=resolveRequestContextChatBinding(record.request,execution,record.selection.contextConversationId);
  if(axes.some(k=>execution[k]!==record.execution[k])||chat.engineSessionId!==record.sessionId)return fail('VOICE_EXECUTION_CHANGED',409);
  const facts=liveFacts(record);
  const manager=await inspectManagedRuntimeJobRole(record.selection.runtimeId);
  if(!manager||typeof manager!=='object'||!('schemaVersion'in manager)||manager.schemaVersion!==1||!('observedAt'in manager)||typeof manager.observedAt!=='number'||!Number.isSafeInteger(manager.observedAt)||manager.observedAt>Date.now()||!('expiresAt'in manager)||manager.expiresAt!==manager.observedAt+5000)return fail('VOICE_EXECUTION_CHANGED',409);
  if(!manager||typeof manager!=='object'||!('kind'in manager)||manager.kind!=='original-manager-core126-parent-v1'||!('hostId'in manager)||manager.hostId!==execution.hostId||!('expiresAt'in manager)||typeof manager.expiresAt!=='number'||!Number.isSafeInteger(manager.expiresAt)||manager.expiresAt<=Date.now()||!('parent'in manager)||!manager.parent||typeof manager.parent!=='object')return fail('VOICE_EXECUTION_CHANGED',409);
  const parent=manager.parent;
  if(Object.entries({id:record.backendId,startIdentity:record.startIdentity,runtimeId:record.selection.runtimeId,workspaceId:execution.workspaceId,organizationId:execution.organizationId,projectId:execution.projectId,ownerUserId:execution.ownerUserId,bindingHash:execution.bindingHash,bindingEpoch:execution.bindingEpoch}).some(([key,value])=>Reflect.get(parent,key)!==value))return fail('VOICE_EXECUTION_CHANGED',409);
  assertHostedVoiceAttachment(context,scope,action);
  return withOpenCodeRuntimeTarget({baseUrl:`http://${facts.runtime.backendName}:4098`,directory:'/workspace',selectionOwnerId:`runtime:${record.selection.runtimeId}`},async()=>{
   const session=await opencodeClient.getSession(record.sessionId,'/workspace');
   assertHostedVoiceAttachment(context,scope,action);
   if(isOpenCodeError(session)||session.id!==record.sessionId||session.directory!=='/workspace'||session.agent!==scope.agentId||!session.model||!text(session.model.id)||!text(session.model.providerID))return fail('VOICE_AGENT_SELECTION_CHANGED',409);
   const configurationRevision=createHash('sha256').update(JSON.stringify([scope.executionRevision,session.agent,session.model,session.permission??null])).digest('hex');
   // Fingerprint of actual selected session/model/permission projection only;
   // not an upstream tool census, execution proof or rendered baseline claim.
   return effect(Object.freeze({scope:record.scope,sessionId:session.id,directory:'/workspace',agentId:scope.agentId,modelId:session.model.id,providerId:session.model.providerID,variant:session.model.variant??null,configurationRevision}));
  });
 });
 return action==='message'||action==='cancel-agent'
  ?selectedStateAdmission.run(`runtime:${record.selection.runtimeId}`,record.sessionId,selectedEffect):selectedEffect();
}
