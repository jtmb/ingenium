/** Root composition proposal for Worker5 VerifiedNativeContextOwner.
 * Actual paired credential custody MUST exist; this does not mint/load it from request metadata.
 * Preflight awaits real paired TLS reads before the synchronous Core transaction callback.
 */
import type {Request,Response,NextFunction} from "express";
import {getDb,HostedRefusal,hostedGovernancePayloadHash as payloadHash,type HostedGovernanceRow as Row,type VerifiedNativeGovernanceContext as VerifiedNative} from "ingenium-core";
import type {VerifiedNativeContextOwner} from "./routes/native-customize-context.js";
import {contextProof,originalProof,type NativePairOriginal,type NativeOwner} from "./paired-native-proof.js";
import type {createPairedNativeReader} from "./paired-native-reader.js";
export type NativeProofReader=ReturnType<typeof createPairedNativeReader>&{assertCurrent():void};
type Reader=NativeProofReader;
export interface OriginalNativeConnectionCustody {
 /** Root's existing private enrolled account/connection owner supplies the real paired Native credential.
  * No URL/token/actor/project/body can construct custody. The reader itself uses only fixed Native proof paths.
  */
 withOriginal<T>(actorId:string,installationId:string,enrollmentRequestId:string,work:(reader:Reader)=>Promise<T>):Promise<T>;
}
type Frame={actorId:string;installationId:string;requestId:string;proof:NativeOwner;original:NativePairOriginal;startedAt:number;operationId?:string;payloadHash?:string;assertCurrent:()=>void};
export function createVerifiedNativeContextOwner(custody:OriginalNativeConnectionCustody|((request:Request)=>OriginalNativeConnectionCustody)){
 const frames=new WeakMap<Request,Frame>();
 const currentUser=(req:Request)=>{const p=req.principal;if(p?.type!=="user"||!p.session)throw new HostedRefusal("BROWSER_SESSION_REQUIRED",401);return p;};
 function checked(req:Request,actorId:string):Frame{
  const p=currentUser(req),frame=frames.get(req);
  if(!frame||frame.actorId!==actorId||p.id!==actorId||performance.now()-frame.startedAt>2000)throw new HostedRefusal("NATIVE_ATTESTATION_UNAVAILABLE",503);
  frame.assertCurrent();return frame;
 }
 const owner:VerifiedNativeContextOwner={
  enrollment(req,requestId,actorId):VerifiedNative{
   const frame=checked(req,actorId);if(frame.requestId!==requestId)throw new HostedRefusal("NATIVE_ATTESTATION_REFUSED",503);
   return {actorId,nativeLibraryId:frame.proof.library_id,nativeServiceInstanceId:frame.proof.service_instance_id,
    nativeProjectId:frame.proof.project?.id as string??null,nativeProjectRevision:frame.proof.project?.revision as number??null};
  },
  current(req,grant:Row,_recovery:boolean,actorId){
   const frame=checked(req,actorId),n=frame.proof;
   if(grant.enrollment_request_id!==frame.requestId||grant.installation_id!==frame.installationId||grant.owner_user_id!==actorId||
    grant.native_library_id!==n.library_id||grant.native_service_instance_id!==n.service_instance_id||
    grant.native_project_id!==(n.project?.id??null)||grant.native_project_revision!==(n.project?.revision??null))throw new HostedRefusal("NATIVE_ATTESTATION_REFUSED",503);
   if(req.method==="POST"&&req.path.endsWith("/effects")&&(!frame.operationId||frame.operationId!==req.body?.original?.id||frame.payloadHash!==payloadHash(req.body.original)))throw new HostedRefusal("NATIVE_ORIGINAL_NOT_DISPATCHED",409);
  }
 };
 async function preflight(req:Request,_res:Response,next:NextFunction){
  try{
   if(req.method==="GET"&&req.path.endsWith("/identity")){next();return;}
   const p=currentUser(req),installation=getDb().prepare("SELECT instance_id FROM veyra_installation_identity WHERE singleton=1").get() as {instance_id:string}|undefined;
   if(!installation)throw new HostedRefusal("HOST_IDENTITY_UNAVAILABLE",503);
   let requestId:string,hostedProjectId:string;
   if(req.method==="POST"&&req.path.endsWith("/enrollments")){
    const body=req.body;if(!body||typeof body!=="object"||Array.isArray(body)||Object.keys(body).sort().join(",")!=="enrollmentRequestId,hostedProjectId,visibility"||typeof body.hostedProjectId!=="string"||!["project","system"].includes(body.visibility))throw new HostedRefusal("INVALID_ENROLLMENT",422);
    requestId=body.enrollmentRequestId;hostedProjectId=body.hostedProjectId;
   }
   else{
    const grantId=req.params.grantId??req.body?.grantId??req.body?.original?.binding?.grantId??req.query.grantId;
    if(typeof grantId!=="string")throw new HostedRefusal("INVALID_GRANT",422);
    const row=getDb().prepare("SELECT enrollment_request_id,hosted_project_id FROM native_hosted_governance_grants WHERE id=? AND owner_user_id=? AND installation_id=? AND revoked_at IS NULL").get(grantId,p.id,installation.instance_id) as {enrollment_request_id:string;hosted_project_id:string}|undefined;
    if(!row)throw new HostedRefusal("NOT_FOUND",404);requestId=row.enrollment_request_id;hostedProjectId=row.hosted_project_id;
   }
   if(typeof requestId!=="string"||!/^[A-Za-z0-9][A-Za-z0-9:_-]{0,255}$/.test(requestId))throw new HostedRefusal("INVALID_ENROLLMENT",422);
   const startedAt=performance.now();
   const currentCustody=typeof custody==="function"?custody(req):custody;
   const frame=await currentCustody.withOriginal(p.id,installation.instance_id,requestId,async reader=>{
    if(reader.original.hostedProjectId!==hostedProjectId||reader.original.actorId!==p.id||reader.original.installationId!==installation.instance_id||reader.original.enrollmentRequestId!==requestId)throw new HostedRefusal("NATIVE_ATTESTATION_REFUSED",503);
    if(req.method==="POST"&&req.path.endsWith("/effects")){
     const operationId=req.body?.original?.id,hash=payloadHash(req.body?.original);
     if(typeof operationId!=="string")throw new HostedRefusal("INVALID_OPERATION_ID",422);
     const proof=originalProof(await reader.readOriginal(operationId,hash),reader.original,operationId,hash);
     return {actorId:p.id,installationId:installation.instance_id,requestId,proof,original:reader.original,startedAt,assertCurrent:()=>reader.assertCurrent(),operationId,payloadHash:hash};
    }
    return {actorId:p.id,installationId:installation.instance_id,requestId,proof:contextProof(await reader.readContext(),reader.original),original:reader.original,startedAt,assertCurrent:()=>reader.assertCurrent()};
   });
   frames.set(req,frame);next();
  }catch(e){next(e instanceof HostedRefusal?e:new HostedRefusal("NATIVE_ATTESTATION_UNAVAILABLE",503));}
 }
 return {owner,preflight};
}
