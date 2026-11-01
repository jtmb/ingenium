import {Router,type Request,type Response,type NextFunction} from 'express';
import {z} from 'zod';
import {ProjectError} from '../projects-v2/catalog.mjs';
import {readInstallationRetention,writeInstallationRetention} from '../projects-v2/request-installation-retention.js';
/** Original auth/session/rate/CSRF precedes this router. Every operation also
 * revalidates the current browser and original installation-admin permission. */
export function createInstallationPreferencesRouter(){
 const router=Router(),empty=z.object({}).strict();
 const run=(work:(req:Request)=>unknown)=>(req:Request,res:Response,next:NextFunction)=>{
  res.set('Cache-Control','no-store');
  try{empty.parse(req.query);res.json(work(req))}catch(error){
   if(error instanceof z.ZodError){res.status(422).json({error:{code:'INVALID_INSTALLATION_PREFERENCE',message:'Use the current installation preference and revision'}});return}
   if(error instanceof ProjectError){res.status(error.status).json({error:{code:error.code,message:'Installation preference request refused'}});return}
   next(error);
  }
 };
 router.get('/archive-retention',run(readInstallationRetention));
 router.put('/archive-retention',run(req=>writeInstallationRetention(req,z.object({operationId:z.string().uuid(),expectedRevision:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),expectedValueHash:z.string().regex(/^[0-9a-f]{64}$/),value:z.string().regex(/^[1-9][0-9]{0,2}$/).refine(v=>Number(v)<=365)}).strict().parse(req.body))));
 router.use((_req,res)=>res.status(404).json({error:{code:'NOT_FOUND',message:'Installation preference endpoint not found'}}));
 return router;
}