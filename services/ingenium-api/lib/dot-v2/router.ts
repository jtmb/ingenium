import { Router, type Request, type Response, type NextFunction } from "express";
import type { Actor, DotScope } from "../../../../packages/veyra-automation/contracts.js";
import type { DotService } from "./service.js";
import { executeDotCommand, dotErrorResponse, type DotCommand } from "./commands.js";
import { DotError } from "./service.js";

export interface DotRequestContext { actor: Actor; scope: DotScope }
export type DotContextResolver = (request: Request) => DotRequestContext;
export interface DotQueueReader {
  page(context: DotRequestContext, after: string, limit: number): { data: {id:string;state:string;projectId:string}[]; nextCursor:string|null };
}
/** Mount behind the existing session/API-token, CSRF, policy and rate-limit middleware. */
export function createDotRouter(service: DotService, resolveContext: DotContextResolver, queue: DotQueueReader): Router {
 return resolvedRouter(request=>({service,context:resolveContext(request),queue}),false);
}

export interface DotRequestSession {service:DotService;context:DotRequestContext;queue:DotQueueReader;asyncCancel?:(actor:Actor,scope:DotScope,id:string,revision:number)=>Promise<void>}
/** Build fresh request authority behind the existing auth/CSRF/journal middleware. */
export function createRequestDotRouter(factory:(request:Request)=>DotRequestSession):Router {
 return resolvedRouter(factory,true);
}
function resolvedRouter(factory:(request:Request)=>DotRequestSession,forwardUnknown:boolean):Router {
 const router=Router();
 const fail=(error:unknown,res:Response,next:NextFunction)=>{
  if(forwardUnknown && !(error instanceof DotError) && !(error instanceof RangeError)){next(error);return;}
  const result=dotErrorResponse(error);res.status(result.status).json(result.body);
 };
 router.use((_req,res,next)=>{res.setHeader("Cache-Control","no-store");next();});
 router.get("/:collection",(req,res,next)=>{
  try {
   const {service,context,queue}=factory(req);
   const kinds={suggestions:"suggestion",followups:"followup",operations:"operation",notifications:"notification"} as const;
   const collection=req.params.collection!;
   const limit=req.query.limit===undefined?20:Number(req.query.limit);
   const cursor=req.query.cursor===undefined?"":req.query.cursor;
   if(!Number.isInteger(limit)||limit<1||limit>100||typeof cursor!=="string"||cursor.length>512)throw new DotError("DOT_VALIDATION");
   if(collection==="queue") {
    service.page(context.actor,context.scope,"operation","",1);
    res.json(queue.page(context,cursor,limit));return;
   }
   if(!Object.prototype.hasOwnProperty.call(kinds,collection))throw new DotError("DOT_NOT_FOUND");
   res.json(service.page(context.actor,context.scope,kinds[collection as keyof typeof kinds],cursor,limit));
  }catch(error){fail(error,res,next);}
 });
 router.get("/:collection/:id",(req,res,next)=>{
  try {
   const {service,context}=factory(req);
   const {actor,scope}=context;
   const kinds={suggestions:"suggestion",followups:"followup",operations:"operation",notifications:"notification"} as const;
   const collection=req.params.collection!;
   if(!Object.prototype.hasOwnProperty.call(kinds,collection))throw new DotError("DOT_NOT_FOUND");
   res.json({data:service.get(actor,scope,kinds[collection as keyof typeof kinds],req.params.id!)});
  }catch(error){fail(error,res,next);}
 });
 router.post("/commands",async(req,res,next)=>{
  try {
   const {service,context,asyncCancel}=factory(req);
   const {actor,scope}=context;
   const command=req.body as DotCommand;
   if(command?.type==="cancel"&&asyncCancel&&(typeof command.id!=="string"||!command.id.length||!Number.isSafeInteger(command.revision)||command.revision<0))throw new DotError("DOT_VALIDATION");
   const data=command?.type==="cancel"&&asyncCancel?await asyncCancel(actor,scope,command.id,command.revision):executeDotCommand(service,actor,scope,command);
   res.status(req.body.type==="propose"?201:200);
   if(req.body.type==="propose")res.setHeader("Location",`./suggestions/${encodeURIComponent(String((data as {id:string}).id))}`);
   res.json({data:data??null});
  }catch(error){fail(error,res,next);}
 });
 return router;
}
