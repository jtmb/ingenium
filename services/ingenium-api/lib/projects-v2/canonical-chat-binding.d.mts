import type{Request}from'express';
import type{contextConversations}from'ingenium-core';
import type{RequestExecutionFacts,RequestExecutionSelection,RequestChatBinding,RequestChatPurpose}from'./request-execution-owner.mjs';
export function createCanonicalRequestChatResolver(ports:{
 resolveExecution(request:Request,selection:RequestExecutionSelection):Readonly<RequestExecutionFacts>;
 resolveEngineChat(request:Request,execution:RequestExecutionFacts,engineSessionId:string,purpose?:RequestChatPurpose):Readonly<RequestChatBinding>;
 getConversation(projectId:string,contextId:string):contextConversations.ContextConversationSummary|undefined;
}):(request:Request,execution:RequestExecutionFacts,contextId:string,purpose?:RequestChatPurpose)=>Readonly<RequestChatBinding>;
