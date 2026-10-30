import { Router, type Request, type Response, type NextFunction } from "express";
import { explicitMemory } from "ingenium-core";
import { createRequestMemorySession } from "../memory-v2/request-session.js";
import { MemoryError, type MemoryPermission } from "../memory-v2/lifecycle.mjs";
import { memoryResponse } from "../memory-v2/http.mjs";
import { mapRequestExecutionFailure } from "../memory-v2/request-policy.mjs";
import { RequestExecutionError, type RequestExecutionSelection } from "../projects-v2/request-execution.js";
import { withManagedRequestPlacement } from "../runtime-placement.js";

type Session=ReturnType<typeof createRequestMemorySession>;
type Action=Parameters<typeof memoryResponse>[2]["action"];
export interface MemoryLifecycleRouterPorts {
  createSession:(request:Request,selected:RequestExecutionSelection)=>Session;
  withPlacement:<T>(request:Request,selected:RequestExecutionSelection,work:()=>T|Promise<T>)=>Promise<T>;
}
const statusByCode:Record<string,number>={MEMORY_ADAPTER_UNAVAILABLE:503,FORBIDDEN:403,INVALID_INPUT:422,INVALID_SCOPE:422,NOT_FOUND:404,VERSION_CONFLICT:409,OPERATION_CONFLICT:409,RESET_CHANGED:409};
const scalar=(value:unknown,max=256):value is string=>typeof value==="string" && value.length>0 && value.length<=max && value===value.trim() && !/[\u0000-\u001f\u007f]/u.test(value);
function selectionFor(req:Request):RequestExecutionSelection {
  const projectless=req.query.projectless;
  if(!scalar(req.query.workspaceId)||!scalar(req.query.runtimeId)||!(projectless===undefined||projectless==="true"))throw new MemoryError("INVALID_INPUT");
  if(projectless==="true") {
    if(req.query.projectId!==undefined)throw new MemoryError("INVALID_INPUT");
    return {projectId:null,workspaceId:req.query.workspaceId,runtimeId:req.query.runtimeId};
  }
  if(!scalar(req.query.projectId))throw new MemoryError("INVALID_INPUT");
  return {projectId:req.query.projectId,workspaceId:req.query.workspaceId,runtimeId:req.query.runtimeId};
}
/** Mounted only after the existing authentication, CSRF, authorization and limiters. */
export function createMemoryLifecycleRouter(overrides:Partial<MemoryLifecycleRouterPorts>={}):Router {
  const router=Router(),createSession=overrides.createSession??createRequestMemorySession,withPlacement=overrides.withPlacement??withManagedRequestPlacement;
  function handler(action:Action,method:string,domainKeys:readonly string[]=[]) {
    return async(req:Request,res:Response,next:NextFunction)=>{
      res.set("Cache-Control","no-store");
      if(req.method!==method){res.set("Allow",method).status(405).json({error:{code:"METHOD_NOT_ALLOWED",message:"Method not allowed"}});return;}
      try {
        const keys=new Set(["projectId","projectless","workspaceId","runtimeId","chatId",...domainKeys]);
        if(Object.keys(req.query).some(key=>!keys.has(key)))throw new MemoryError("INVALID_INPUT");
        const selected=selectionFor(req),pathChat=req.params.chatId,queryChat=req.query.chatId;
        if(queryChat!==undefined&&!scalar(queryChat))throw new MemoryError("INVALID_INPUT");
        if(pathChat!==undefined&&(!scalar(pathChat)||(queryChat!==undefined&&pathChat!==queryChat)))throw new MemoryError("INVALID_INPUT");
        const chatId=pathChat??queryChat;
        const headerOperation=req.get("Idempotency-Key");
        let body=req.body;
        if(headerOperation!==undefined) {
          if(!["PUT","POST"].includes(req.method) || !scalar(headerOperation,128) || !body || typeof body!=="object" || Array.isArray(body)
            || (body.operationId!==undefined && body.operationId!==headerOperation))throw new MemoryError("INVALID_INPUT");
          body={...body,operationId:headerOperation};
        }
        const query:Record<string,number>={};
        for(const key of domainKeys) {
          const value=req.query[key]; if(value===undefined)continue;
          if(typeof value!=="string" || !/^(0|[1-9][0-9]*)$/u.test(value) || !Number.isSafeInteger(Number(value)))throw new MemoryError("INVALID_INPUT");
          query[key]=Number(value);
        }
        const result=await withPlacement(req,selected,()=>{
          const session=createSession(req,selected);
          return memoryResponse(session.memory,(_request,permission:MemoryPermission)=>session.resolveScope(permission,typeof chatId==="string"?chatId:null),{
            action,method:req.method,body,query,chatId:typeof chatId==="string"?chatId:undefined,operationId:typeof req.params.operationId==="string"?req.params.operationId:undefined,
          });
        });
        res.set(result.headers).status(result.status).json(result.body);
      } catch(error) {
        let mapped:unknown=error;
        if(error instanceof RequestExecutionError) {
          try{mapped=mapRequestExecutionFailure(error,RequestExecutionError);}
          catch(unmapped){next(unmapped);return;}
        }
        if(error instanceof explicitMemory.ExplicitMemoryError && error.code==="MEMORY_SCOPE_NOT_FOUND")mapped=new MemoryError("FORBIDDEN");
        if(mapped instanceof MemoryError && Object.hasOwn(statusByCode,mapped.code)) {
          res.status(statusByCode[mapped.code]!).json({error:{code:mapped.code,message:"Memory request could not be completed"}});return;
        }
        next(mapped);
      }
    };
  }
  router.all("/scope-policy",handler("scope-policy","GET"));
  router.all("/policy",(req,res,next)=>{
    if(req.method==="GET")void handler("policy","GET")(req,res,next);
    else if(req.method==="PUT")void handler("set-policy","PUT")(req,res,next);
    else res.set({"Allow":"GET, PUT","Cache-Control":"no-store"}).status(405).json({error:{code:"METHOD_NOT_ALLOWED",message:"Method not allowed"}});
  });
  router.all("/chats/:chatId/policy",handler("set-chat-policy","PUT"));
  router.all("/recall",handler("recall","GET",["maxItems","maxTokens"]));
  router.all("/entries",handler("entries","GET",["offset","limit"]));
  router.all("/forget",handler("forget","POST"));
  router.all("/reset-preview",handler("reset-preview","GET"));
  router.all("/reset",handler("reset","POST"));
  router.all("/operations/:operationId",handler("operation","GET"));
  return router;
}