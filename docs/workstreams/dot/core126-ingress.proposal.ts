import type {RequestHandler} from "express";
import type {Core126Handlers} from "./managed-job-contracts.mjs";
/** Mount after JSON parser and preauth limiter, BEFORE generic auth/CSRF/authorization.
 * Does not set req.principal and never calls next() after matching a private audience path.
 */
export function createCore126Ingress(handlers:Core126Handlers):RequestHandler{
 return (req,res,next)=>{
  const internal=req.path.startsWith("/api/v1/internal/managed-job-runs/");
  const runtime=req.path.startsWith("/api/v1/runtime/job-runs/");
  if(!internal&&!runtime){next();return;}
  if(req.headers.cookie!==undefined||req.headers.origin!==undefined||req.headers["x-ingenium-internal-service"]!==undefined){res.status(404).json({error:{code:"NOT_FOUND",message:"Resource not found"}});return;}
  const request={path:req.path.slice("/api/v1".length),method:req.method,headers:req.headers,query:{action:req.query.action},body:req.body};
  Promise.resolve().then(()=>internal?handlers.internal(request):handlers.runtime(request)).then(result=>{
   if(!result){res.status(404).json({error:{code:"NOT_FOUND",message:"Resource not found"}});return;}
   res.json(result);
  }).catch((error:unknown)=>{
   const candidate=error&&typeof error==="object"&&"status" in error?error.status:500;
   const status=typeof candidate==="number"&&[401,403,404,405,409,422,503].includes(candidate)?candidate:500;
   res.status(status).json({error:{code:status===503?"MANAGED_JOB_UNAVAILABLE":status===500?"INTERNAL_ERROR":"MANAGED_JOB_DENIED",message:"Managed JobRun request unavailable"}});
  });
 };
}
