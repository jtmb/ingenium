import {ProjectError, requireValue} from "../../../../packages/veyra-projects/domain.mjs";

export function createProjectHandlers({catalog, operations, resolveScope}) {
  const run = (handler) => async (req, res) => {
    try {
      // resolveScope must authenticate and derive ownership; request body scope is never trusted.
      const scope = await resolveScope(req);
      requireValue(scope !== null && scope !== undefined, "UNAUTHENTICATED", 401);
      await handler(scope, req, res);
    } catch (error) {
      const known = error instanceof ProjectError;
      res.status(known ? error.status : 500).json({error:{
        code: known ? error.code : "INTERNAL_ERROR",
        message: known ? error.code.replaceAll("_", " ").toLowerCase() : "Project operation failed",
        requestId: typeof req.id === "string" ? req.id : undefined,
      }});
    }
  };
  return {
    list: run(async(scope,req,res)=>{
      const limit=req.query?.limit === undefined ? 50 : Number(req.query.limit);
      requireValue(req.query?.archived === undefined || ["true","false"].includes(req.query.archived));
      res.json(await catalog.list(scope,{after:req.query?.after ?? "",limit,archived:req.query?.archived==="true"}));
    }),
    get: run(async(scope,req,res)=>res.json({data:await catalog.get(scope,req.params.id)})),
    create: run(async(scope,req,res)=>{
      requireValue(typeof req.body?.id==="string" && req.body.id.length>0);
      const project=await catalog.create(scope,{label:req.body.label,roots:req.body.roots},req.body.id);
      res.status(201).location("/api/v1/workspace-projects/"+encodeURIComponent(project.id)).json({data:project});
    }),
    update: run(async(scope,req,res)=>res.json({data:await catalog.update(scope,req.params.id,
      req.body?.expectedRevision,req.body?.patch)})),
    reconcile: run(async(scope,req,res)=>{
      requireValue(req.body && typeof req.body==="object");
      const result=await operations.reconcile(scope,req.body);
      res.status(result.state==="pending" || result.state==="unknown" ? 202 : 200).json({data:result});
    }),
    execute: run(async(scope,req,res)=>{
      requireValue(req.body && typeof req.body==="object");
      const result=await operations.execute(scope,req.body);
      res.status(result.state==="pending" || result.state==="unknown" ? 202 : 200).json({data:result});
    }),
  };
}
