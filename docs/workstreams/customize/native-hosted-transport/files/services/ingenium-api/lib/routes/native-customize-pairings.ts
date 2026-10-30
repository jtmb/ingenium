/** Root mounts only these closed browser-user account commands; existing auth + CSRF apply. */
import {Router,type Request,type Response,type NextFunction} from "express";
import {HostedRefusal} from "ingenium-core";
import {createNodeNativePairingOwner} from "../node-native-pairing-custody.js";
import {authMiddleware} from "../middleware/auth.js";import {csrfMiddleware} from "../middleware/csrf.js";
export function createNativePairingRouter(){
 const router=Router();router.use(authMiddleware,csrfMiddleware);
 const run=(work:(req:Request)=>unknown)=>async(req:Request,res:Response,next:NextFunction)=>{
  res.set("Cache-Control","no-store");try{res.json({data:await work(req)});}catch(e){next(e);}
 };
 router.post("/",run(req=>createNodeNativePairingOwner(req).pair(req.body)));
 router.get("/:enrollmentRequestId",run(req=>createNodeNativePairingOwner(req).status(String(req.params.enrollmentRequestId))));
 router.post("/:enrollmentRequestId/inspect",run(req=>{
  if(!req.body||Object.keys(req.body).length)throw new HostedRefusal("INVALID_PAIRING_INSPECTION",422);
  return createNodeNativePairingOwner(req).recover(String(req.params.enrollmentRequestId));
 }));
 return router;
}
