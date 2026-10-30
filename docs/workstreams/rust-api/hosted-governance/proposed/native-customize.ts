import { Router, type Request } from "express";
import { createHostedGovernanceOwner, type HostedGovernanceAuthentication, HostedRefusal } from "ingenium-core";

export interface NativeCustomizeDependencies {
  /** Root composes actual-session/CSRF/project-policy and verified private Native context; never a body-derived actor/grant. */
  context(request:Request): HostedGovernanceAuthentication;
}

/** Install only after exact authorization-policy registration and real context composition. */
export function createNativeCustomizeRouter(dependencies:NativeCustomizeDependencies) {
  const router=Router();
  const run=(action:(owner:ReturnType<typeof createHostedGovernanceOwner>,request:Request)=>unknown)=>
    async(req:Request,res:any,next:any)=>{
      res.set("Cache-Control","no-store");
      try { res.json({data:await action(createHostedGovernanceOwner(dependencies.context(req)),req)}); }
      catch(error) {
        if(error instanceof HostedRefusal) {
          res.status(error.status).json({error:{code:error.code,message:"Hosted governance request refused"}});
        } else next(error); // Existing sanitized API error owner; no raw projection/auth/body logging here.
      }
    };
  router.get("/identity",run(owner=>{const identity=owner.identity();return {...identity,session_actor_id:identity.actorId};}));
  router.post("/enrollments",run((owner,req)=>({...owner.enroll(req.body),session_actor_id:owner.identity().actorId})));
  router.get("/enrollments/:grantId",run((owner,req)=>({...owner.binding(req.params.grantId!),session_actor_id:owner.identity().actorId})));
  router.post("/read",run(async(owner,req)=>{
    if(!req.body || Object.keys(req.body).sort().join(",")!=="command,grantId") throw new HostedRefusal("INVALID_COMMAND",422);
    return {...await owner.read(req.body.grantId,req.body.command),session_actor_id:owner.identity().actorId};
  }));
  router.post("/effects",run((owner,req)=>{
    if(!req.body || Object.keys(req.body).join(",")!=="original") throw new HostedRefusal("INVALID_COMMAND",422);
    // Private headers stay in this API owner, never the renderer/public original/payload hash/table.
    return owner.effect(req.body.original,{
      target:req.get("x-ingenium-lock-token"),
      source:req.get("x-ingenium-source-lock-token"),
    });
  }));
  router.get("/operations/:operationId",run((owner,req)=>{
    if(Object.keys(req.query).some(key=>key!=="grantId")||typeof req.query.grantId!=="string") throw new HostedRefusal("INVALID_CURSOR",422);
    return owner.inspect(req.params.operationId!,req.query.grantId);
  }));
  router.get("/operations",run((owner,req)=>{
    if(Object.keys(req.query).some(key=>!["grantId","after","limit"].includes(key))
      || typeof req.query.grantId!=="string" || req.query.after!==undefined&&typeof req.query.after!=="string"
      || req.query.limit!==undefined&&(typeof req.query.limit!=="string"||!/^([1-9]|[1-9][0-9]|100)$/.test(req.query.limit))) throw new HostedRefusal("INVALID_CURSOR",422);
    return owner.pending(req.query.grantId,req.query.after as string|undefined,req.query.limit===undefined?25:Number(req.query.limit));
  }));
  return router;
}
