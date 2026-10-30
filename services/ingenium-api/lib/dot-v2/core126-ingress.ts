import type {RequestHandler} from "express";
import type {Core126Handlers} from "./managed-job-contracts.mjs";
/** Exact private audiences; generic browser/runtime auth never receives these requests. */
export function createCore126Ingress(handlers:Core126Handlers):RequestHandler {
 const internalPrefix="/api/v1/internal/managed-job-runs",runtimePrefix="/api/v1/runtime/job-runs";
 const uuid="[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}";
 const internalPath=new RegExp("^"+internalPrefix+"/("+uuid+")/(admission|launch-material|effect-intent|created|started|unknown|retired|no-create-close|consumed|removed)$");
 const runtimePath=new RegExp("^"+runtimePrefix+"/("+uuid+")/(assignment|bootstrap-assignment|withdraw|result|mcp-tools|mcp/[A-Za-z0-9_:-]{1,128})$");
 return (req,res,next)=>{
  const internal=req.path===internalPrefix||req.path.startsWith(internalPrefix+"/");
  const runtime=req.path===runtimePrefix||req.path.startsWith(runtimePrefix+"/");
  if(!internal&&!runtime){next();return;}
  res.setHeader("Cache-Control","no-store");
  const refuse=()=>res.status(404).json({error:{code:"NOT_FOUND",message:"Resource not found"}});
  const match=(internal?internalPath:runtimePath).exec(req.path),operation=match?.[2];
  if(!match||req.headers.cookie!==undefined||req.headers.origin!==undefined||req.headers["x-ingenium-internal-service"]!==undefined){refuse();return;}
  const read=operation==="admission"||operation==="assignment"||operation==="bootstrap-assignment"||operation==="mcp-tools";
  if(req.method!==(read?"GET":"POST")){refuse();return;}
  const keys=Object.keys(req.query),action=req.query.action;
  if(operation==="admission" ? keys.length!==1||keys[0]!=="action"||typeof action!=="string"||!["launch","inspect","cancel","cleanup"].includes(action) : keys.length!==0){refuse();return;}
  const request={path:req.path.slice("/api/v1".length),method:req.method,headers:req.headers,query:operation==="admission"?{action}: {},body:req.body};
  Promise.resolve().then(()=>internal?handlers.internal(request):handlers.runtime(request)).then(result=>{
   if(!result){refuse();return;}res.json(result);
  }).catch((error:unknown)=>{
   const candidate=error&&typeof error==="object"&&"status" in error?error.status:500;
   const status=typeof candidate==="number"&&[401,403,404,405,409,422,503].includes(candidate)?candidate:500;
   res.status(status).json({error:{code:status===503?"MANAGED_JOB_UNAVAILABLE":status===500?"INTERNAL_ERROR":"MANAGED_JOB_DENIED",message:"Managed JobRun request unavailable"}});
  });
 };
}
