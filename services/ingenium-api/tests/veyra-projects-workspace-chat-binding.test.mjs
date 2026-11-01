import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspaceRequestChatResolver} from '../lib/projects-v2/workspace-chat-binding.mjs';
// Unit records only. Actual original runtime/image creation remains a release gate.
const copy=x=>structuredClone(x);
function setup(){
 const execution={organizationId:'org',ownerUserId:'owner',projectId:null,workspaceId:'workspace',runtimeId:'runtime',bindingHash:'a'.repeat(64),bindingEpoch:2,status:'authorized',mode:'runtime',hostId:'host',environmentId:'environment',available:true,executionGeneration:'b'.repeat(64)};
 const conversation={id:'canonical-context',project_id:null,scope_kind:'workspace',visibility:'private',organization_id:'org',owner_user_id:'owner',workspace_id:'workspace',runtime_id:'runtime',binding_hash:execution.bindingHash,binding_epoch:2,execution_generation:execution.executionGeneration,archived:false,metadata:JSON.stringify({source:'opencode-chat',sourceRuntimeId:'runtime',sourceSessionId:'original-engine'})};
 const mapping={contextConversationId:conversation.id,engineSessionId:'original-engine',runtimeId:'runtime',executionGeneration:execution.executionGeneration,purpose:'active'};
 let reads=0,identities=0;
 const ports={resolveExecution(){identities++;return copy(execution)},findEngineContext(_r,_s,id,purpose){reads++;assert.equal(id,mapping.engineSessionId);return {conversation:copy(conversation),mapping:{...mapping,purpose}}},getConversation(){reads++;return copy(conversation)},resolveMapping(_r,_s,_id,{purpose}){return {...mapping,purpose}}};
 return {execution,conversation,mapping,ports,counts:()=>({reads,identities})};
}
for(const representation of ['engine','context'])test('resolves distinct original engine and canonical Context IDs: '+representation,()=>{
 const f=setup(),r=createWorkspaceRequestChatResolver(f.ports)({},copy(f.execution),representation==='engine'?'original-engine':'canonical-context','active',representation);
 assert.equal(r.chatId,representation==='engine'?'original-engine':'canonical-context');assert.equal(r.contextConversationId,'canonical-context');assert.equal(r.engineSessionId,'original-engine');assert.equal(r.projectId,null);assert.ok(Object.isFrozen(r));assert.deepEqual(f.counts(),{reads:2,identities:2});
});
for(const [field,value]of [['organization_id','foreign'],['owner_user_id','foreign'],['workspace_id','foreign'],['project_id','invented-project'],['scope_kind','project'],['visibility','shared'],['binding_hash','c'.repeat(64)],['binding_epoch',3],['runtime_id','foreign'],['execution_generation','c'.repeat(64)]])test('rejects canonical scope drift: '+field,()=>{
 const f=setup();f.conversation[field]=value;assert.throws(()=>createWorkspaceRequestChatResolver(f.ports)({},f.execution,'original-engine'),/CHAT_BINDING_UNAVAILABLE/);
});
test('metadata alone cannot replace original source mapping',()=>{
 const f=setup();f.mapping.engineSessionId='different-engine';f.ports.findEngineContext=()=>({conversation:copy(f.conversation),mapping:copy(f.mapping)});
 assert.throws(()=>createWorkspaceRequestChatResolver(f.ports)({},f.execution,'original-engine'),/CHAT_BINDING_UNAVAILABLE/);
});
for(const field of ['runtimeId','executionGeneration'])test('history never routes a past engine generation into the current execution: '+field,()=>{
 const f=setup();f.mapping[field]='old';f.conversation[field==='runtimeId'?'runtime_id':'execution_generation']='old';f.conversation.metadata=JSON.stringify({source:'opencode-chat',sourceRuntimeId:f.mapping.runtimeId,sourceSessionId:'original-engine'});
 assert.throws(()=>createWorkspaceRequestChatResolver(f.ports)({},f.execution,'canonical-context','history','context'),/CHAT_BINDING_UNAVAILABLE/);
});
test('archived chat is unavailable for active use but readable as current-generation history',()=>{
 const f=setup();f.conversation.archived=true;const resolve=createWorkspaceRequestChatResolver(f.ports);
 assert.throws(()=>resolve({},f.execution,'original-engine'),/CHAT_BINDING_UNAVAILABLE/);assert.equal(resolve({},f.execution,'original-engine','history').contextConversationId,'canonical-context');
});
test('revalidates actual execution after the Context reads',()=>{
 const f=setup();let calls=0;f.ports.resolveExecution=()=>({...f.execution,bindingEpoch:++calls===1?2:3});assert.throws(()=>createWorkspaceRequestChatResolver(f.ports)({},f.execution,'original-engine'),/CHAT_BINDING_UNAVAILABLE/);
});
test('rechecks canonical source mapping before returning a binding',()=>{
 const f=setup(),read=f.ports.findEngineContext;let calls=0;f.ports.findEngineContext=(...args)=>{const result=read(...args);if(++calls===2)result.mapping.engineSessionId='changed';return result};assert.throws(()=>createWorkspaceRequestChatResolver(f.ports)({},f.execution,'original-engine'),/CHAT_BINDING_UNAVAILABLE/);
});
test('rejects missing private owner, invalid IDs and invalid selector variants before lookup',()=>{
 assert.throws(()=>createWorkspaceRequestChatResolver({}),/CHAT_BINDING_OWNER_UNAVAILABLE/);
 for(const [id,purpose,representation]of [['','active','engine'],['engine\n','active','engine'],['original-engine','invented','engine'],['original-engine','active','invented']]){
  const f=setup();assert.throws(()=>createWorkspaceRequestChatResolver(f.ports)({},f.execution,id,purpose,representation),/CHAT_BINDING_UNAVAILABLE/);assert.deepEqual(f.counts(),{reads:0,identities:0});
 }
});
