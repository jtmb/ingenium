import {Router,type Request,type Response,type NextFunction} from 'express';
import {z} from 'zod';
import {ProjectError} from '../projects-v2/catalog.mjs';
import {RequestExecutionError} from '../projects-v2/request-execution-owner.mjs';
import {listRequestWorkspaceExecutions,listRequestWorkspaceRegistration,prepareRequestWorkspaceExecution,confirmRequestWorkspaceExecution,launchRequestWorkspaceExecution,controlRequestWorkspaceExecution} from '../projects-v2/request-execution-catalog.js';
export function createWorkspaceExecutionRouter(){
 const router=Router(),id=z.string().uuid(),workspace=z.string().min(1).max(256);
 const run=(work:(request:Request)=>unknown|Promise<unknown>)=>async(request:Request,response:Response,next:NextFunction)=>{
  response.set('Cache-Control','no-store');
  try{response.json(await work(request))}catch(error){
   if(error instanceof z.ZodError){response.status(422).json({error:{code:'INVALID_EXECUTION_SELECTION',message:'Select an explicit registered execution target'}});return}
   if(error instanceof ProjectError||error instanceof RequestExecutionError){response.status(error.status).json({error:{code:error.code,message:'Execution target is unavailable'}});return}
   const code=error&&typeof error==='object'&&'code'in error?String(error.code):'';
   if(/^WORKSPACE_V2_[A-Z_]+$/.test(code)||['REVISION_CONFLICT','STATE_CONFLICT','SCOPE_UNAVAILABLE'].includes(code)){
    response.status(['REVISION_CONFLICT','STATE_CONFLICT'].includes(code)?409:503).json({error:{code,message:'Workspace state could not be verified. Refresh before trying again.'}});return;
   }
   next(error);
  }
 };
 router.get('/',run(request=>{
  const q=z.object({organizationId:id,after:z.string().max(256).optional(),limit:z.coerce.number().int().min(1).max(100).optional()}).strict().parse(request.query);
  return listRequestWorkspaceExecutions(request,q.organizationId,{after:q.after,limit:q.limit});
 }));
 router.get('/confirm',run(async request=>{
  const q=z.object({organizationId:id,workspaceId:workspace,runtimeId:id}).strict().parse(request.query);
  return {data:await confirmRequestWorkspaceExecution(request,q.organizationId,{projectId:null,workspaceId:q.workspaceId,runtimeId:q.runtimeId})};
 }));
 router.get('/available',run(request=>{
  const q=z.object({organizationId:id}).strict().parse(request.query);
  return listRequestWorkspaceRegistration(request,q.organizationId);
 }));
 router.post('/prepare',run(async request=>{
  const q=z.object({organizationId:id}).strict().parse(request.query),body=z.object({workspaceId:workspace}).strict().parse(request.body);
  return {data:await prepareRequestWorkspaceExecution(request,q.organizationId,body.workspaceId)};
 }));
 router.post('/launch',run(async request=>{
  const q=z.object({organizationId:id}).strict().parse(request.query);
  const body=z.object({workspaceId:workspace,runtimeId:id,audience:z.enum(['web','cli']),exchangeProof:z.string().regex(/^[A-Za-z0-9_-]{43}$/)}).strict().parse(request.body);
  return {data:await launchRequestWorkspaceExecution(request,q.organizationId,body)};
 }));
 for(const operation of ['start','refresh','stop','successor'] as const)router.post('/'+operation,run(async request=>{
  const q=z.object({organizationId:id}).strict().parse(request.query),body=z.object({workspaceId:workspace,runtimeId:id}).strict().parse(request.body);
  return {data:await controlRequestWorkspaceExecution(request,q.organizationId,body,operation)};
 }));
 router.use((_request,response)=>{response.status(404).json({error:{code:'NOT_FOUND',message:'Execution endpoint not found'}})});
 return router;
}
