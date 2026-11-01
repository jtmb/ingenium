/** Original session/CSRF middleware precedes this actor-owned metadata router. */
import {Router,type Request,type Response,type NextFunction} from 'express';
import {z} from 'zod';
import {RequestExecutionError} from '../projects-v2/request-execution-owner.mjs';
import {ProjectError} from '../projects-v2/catalog.mjs';
import {listRequestWorkspaceProjects,getRequestWorkspaceProject,updateRequestWorkspaceProject,createRequestWorkspaceProject} from '../projects-v2/request-catalog.js';
const id=z.string().uuid(),organization=z.object({organizationId:id}).strict();
const label=z.string().min(1).max(200).refine(v=>v===v.trim()&&!/[\u0000-\u001f\u007f]/.test(v));
export function createWorkspaceProjectsRouter(){
 const router=Router();
 const run=(work:(req:Request)=>unknown|Promise<unknown>)=>async(req:Request,res:Response,next:NextFunction)=>{
  res.set('Cache-Control','no-store');
  try{res.json(await work(req))}catch(error){
   if(error instanceof z.ZodError){res.status(422).json({error:{code:'INVALID_WORKSPACE_PROJECT_INPUT',message:'Use the selected project and execution target'}});return}
   if(error instanceof ProjectError||error instanceof RequestExecutionError){res.status(error.status).json({error:{code:error.code,message:'Workspace project request refused'}});return}
   next(error);
  }
 };
 router.get('/',run(req=>{
  const q=z.object({organizationId:id,after:z.string().max(256).optional(),limit:z.coerce.number().int().min(1).max(100).optional(),archived:z.enum(['true','false']).optional()}).strict().parse(req.query);
  return listRequestWorkspaceProjects(req,q.organizationId,{after:q.after,limit:q.limit,archived:q.archived==='true'});
 }));
 router.get('/:id',run(req=>({data:getRequestWorkspaceProject(req,organization.parse(req.query).organizationId,id.parse(req.params.id))})));
 router.post('/',run(async req=>{
  const {organizationId}=organization.parse(req.query);
  const body=z.object({id,label,selection:z.object({projectId:z.null(),workspaceId:z.string().min(1).max(256),runtimeId:id}).strict()}).strict().parse(req.body);
  return createRequestWorkspaceProject(req,organizationId,body);
 }));
 router.patch('/:id',run(req=>{
  const {organizationId}=organization.parse(req.query);
  const body=z.object({expectedRevision:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),patch:z.object({label:label.optional(),pinned:z.boolean().optional(),archived:z.boolean().optional()}).strict().refine(v=>Object.keys(v).length>0)}).strict().parse(req.body);
  return {data:updateRequestWorkspaceProject(req,organizationId,id.parse(req.params.id),body.expectedRevision,body.patch)};
 }));
 // Do not fall through to legacy global-Project authorization or another owner.
 router.use((_req,res)=>{res.status(404).json({error:{code:'NOT_FOUND',message:'Workspace project endpoint not found'}})});
 return router;
}
