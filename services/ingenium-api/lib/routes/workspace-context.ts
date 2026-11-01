/** Projectless chat persistence: canonical source IDs, never browser transcript authority. */
import {Router,type Request,type Response,type NextFunction} from 'express';
import {z} from 'zod';
import {runtimes} from 'ingenium-core';
import {listRequestSavedHistory,readRequestSavedHistory}from'../projects-v2/request-saved-history.js';
import {findWorkspaceEngineContext,persistOriginalWorkspaceEngineTurn} from '../projects-v2/projectless-context.mjs';
import {withManagedWorkspaceV2Placement} from '../projects-v2/workspace-v2-placement.mjs';
export function createWorkspaceContextRouter(){
 const router=Router(),identifier=z.string().min(1).max(512).regex(/^[^\u0000-\u001f\u007f]+$/),empty=z.object({}).strict();
 const selection=(runtimeId:string)=>{
  const runtime=runtimes.getWorkspaceRuntimeV2(runtimeId);
  if(!runtime)throw Object.assign(Error('WORKSPACE_RUNTIME_NOT_FOUND'),{code:'WORKSPACE_RUNTIME_NOT_FOUND',status:404});
  return {projectId:null,workspaceId:runtime.workspaceId,runtimeId:runtime.id} as const;
 };
 const run=(work:(request:Request)=>Promise<unknown>)=>async(request:Request,response:Response,_next:NextFunction)=>{
  response.set('Cache-Control','no-store');
  try{empty.parse(request.query);response.status(201).json({data:await work(request)})}catch(error){
   if(error instanceof z.ZodError){response.status(422).json({error:{code:'INVALID_WORKSPACE_CHAT_INPUT',message:'Use the original workspace conversation and message identities.'}});return}
   const code=error&&typeof error==='object'&&'code'in error?error.code:'';
   const conflict=code==='WORKSPACE_CONTEXT_REVISION_CONFLICT';
   const status=conflict?409:code==='WORKSPACE_ENGINE_MAPPING_UNAVAILABLE'||code==='WORKSPACE_RUNTIME_NOT_FOUND'?404:code==='INVALID_WORKSPACE_CONTEXT_INPUT'?422:503;
   response.status(status).json({error:{code:conflict?'REVISION_CONFLICT':'WORKSPACE_CHAT_UNAVAILABLE',message:conflict?'Saved conversation changed; refresh its revision before retrying.':'The original workspace conversation could not be verified.'}});
  }
 };
 const readHistory=(work:(request:Request)=>unknown)=>(request:Request,response:Response)=>{
  response.set('Cache-Control','no-store');
  try{empty.parse(request.body??{});response.json(work(request))}catch(error){
   if(error instanceof z.ZodError){response.status(422).json({error:{code:'INVALID_SAVED_HISTORY_INPUT',message:'Select the saved conversation and its current history page.'}});return}
   const code=error&&typeof error==='object'&&'code'in error?String(error.code):'SAVED_HISTORY_UNAVAILABLE';
   const status=error&&typeof error==='object'&&'status'in error&&[401,404,409,422,503].includes(Number(error.status))?Number(error.status):503;
   response.status(status).json({error:{code,message:code==='SAVED_HISTORY_CHANGED'?'Saved history changed. Refresh before loading another page.':'Saved conversation history could not be verified.'}});
  }
 };
 router.get('/history',readHistory(request=>{
  const q=z.object({organizationId:z.string().uuid(),workspaceId:identifier.optional(),afterCreatedAt:z.string().max(64).optional(),afterId:z.string().uuid().optional(),limit:z.coerce.number().int().min(1).max(50).optional(),includeArchived:z.enum(['true','false']).optional()}).strict().parse(request.query);
  return listRequestSavedHistory(request,q.organizationId,{workspaceId:q.workspaceId,afterCreatedAt:q.afterCreatedAt,afterId:q.afterId,limit:q.limit,includeArchived:q.includeArchived==='true'});
 }));
 router.get('/history/:id',readHistory(request=>{
  const q=z.object({organizationId:z.string().uuid(),expectedRevision:z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),afterSequence:z.coerce.number().int().min(-1).max(Number.MAX_SAFE_INTEGER).optional(),limit:z.coerce.number().int().min(1).max(50).optional()}).strict().parse(request.query);
  return {data:readRequestSavedHistory(request,q.organizationId,z.string().uuid().parse(request.params.id),{expectedRevision:q.expectedRevision,afterSequence:q.afterSequence,limit:q.limit})};
 }));
 router.post('/chat-sessions/link',run(async request=>{
  const input=z.object({runtimeId:z.string().uuid(),sessionId:identifier,title:z.string().trim().min(1).max(256)}).strict().parse(request.body),selected=selection(input.runtimeId);
  const linked=await withManagedWorkspaceV2Placement(request,selected,()=>findWorkspaceEngineContext(request,selected,input.sessionId));
  return linked.conversation;
 }));
 router.post('/conversations/:id/chat-turns',run(async request=>{
  const input=z.object({runtimeId:z.string().uuid(),sessionId:identifier,userMessageId:identifier,assistantMessageId:identifier,expectedRevision:z.number().int().nonnegative()}).strict().parse(request.body);
  return persistOriginalWorkspaceEngineTurn(request,selection(input.runtimeId),identifier.parse(request.params.id),{sessionId:input.sessionId,userMessageId:input.userMessageId,assistantMessageId:input.assistantMessageId,expectedRevision:input.expectedRevision});
 }));
 router.use((_request,response)=>{response.status(404).json({error:{code:'NOT_FOUND',message:'Workspace conversation endpoint not found'}})});
 return router;
}
