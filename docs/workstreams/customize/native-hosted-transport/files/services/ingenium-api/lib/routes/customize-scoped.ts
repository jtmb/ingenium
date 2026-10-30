/** Mounted alongside existing project Customize; genuine cookie/session/CSRF owner. */
import {Router,type Request,type Response,type NextFunction} from 'express';
import {customizeCatalog,authentication} from 'ingenium-core';
import {z} from 'zod';
import {authMiddleware} from '../middleware/auth.js';
import {csrfMiddleware} from '../middleware/csrf.js';
import {toAuthorizationPrincipal} from '../authorization-policy.js';
import {AppError} from '../middleware/errors.js';
export function createScopedCustomizeRouter(){
 const router=Router();
 const current=(req:Request,res:Response)=>{
  // Recheck the actual original cookie/session epoch, status and CSRF for each request.
  authMiddleware(req,res,()=>{});csrfMiddleware(req,res,()=>{});
  if(req.principal?.type!=='user'||!req.principal.session)throw new AppError('Browser session required','BROWSER_SESSION_REQUIRED',401);
  return customizeCatalog.createCustomizeCatalogOwner(toAuthorizationPrincipal(req.principal));
 };
 const run=(work:(owner:ReturnType<typeof customizeCatalog.createCustomizeCatalogOwner>,req:Request)=>unknown)=>(req:Request,res:Response,next:NextFunction)=>{
  res.set('Cache-Control','no-store');
  try{res.json({data:work(current(req,res),req)});}catch(e){
   if(e instanceof customizeCatalog.CustomizeCatalogRefusal){res.status(e.status).json({error:{code:e.code,message:'Customize request refused'}});return;}
   if(e instanceof z.ZodError){res.status(422).json({error:{code:'INVALID_CUSTOMIZE_COMMAND',message:'Use the reviewed scoped command contract'}});return;}
   next(e);
  }
 };
 router.get('/sources',run((owner,req)=>owner.discover(req.query.visibility,req.query.after??'',req.query.limit===undefined?50:Number(req.query.limit))));
 router.get('/sources/:sourceId',run((owner,req)=>owner.source(String(req.params.sourceId))));
 router.get('/project-source',run((owner,req)=>{
  const q=z.object({projectId:z.string().uuid(),kind:z.enum(['plugin','skill']),name:z.string()}).strict().parse(req.query);
  return owner.projectSource(q.projectId,q.kind,q.name);
 }));
 router.get('/archived-plugins',run((owner,req)=>owner.archivedPlugins(z.string().uuid().parse(req.query.projectId))));
 router.get('/installations',run((owner,req)=>owner.installations(z.string().uuid().parse(req.query.projectId))));
 router.get('/commands/:operationId',run((owner,req)=>owner.inspect(String(req.params.operationId))));
 router.post('/commands',run((owner,req)=>{
  const command=customizeCatalog.CatalogCommandSchema.parse(req.body);
  if(command.op==='activate-plugin'||command.op==='publish'&&command.visibility!=='personal'||command.op==='withdraw'||command.op==='restore-source'||command.op==='revise-plugin-source'){
   if(req.principal?.type!=='user'||!req.principal.session)throw new AppError('Browser session required','BROWSER_SESSION_REQUIRED',401);
   if(!authentication.hasRecentStepUp(req.principal.session))throw new AppError('Recent authentication required','STEP_UP_REQUIRED',403);
  }
  return owner.command(command);
 }));
 return router;
}