/** Decodes actual paired Native proofs against original PRIVATE custody; no body-derived identities. */
export type NativeOwner={library_id:string;service_instance_id:string;project:Record<string,unknown>|null};
export type NativePairOriginal={actorId:string;installationId:string;enrollmentRequestId:string;authorityId:string;grantId:string;grantRevision:number;nativeOwner:NativeOwner};
type Json=Record<string,unknown>;
const obj=(v:unknown):v is Json=>!!v&&typeof v==="object"&&!Array.isArray(v);
const same=(a:unknown,b:unknown)=>stable(a)===stable(b);
function stable(v:unknown):string{return JSON.stringify(v,(_k,value)=>obj(value)?Object.fromEntries(Object.keys(value).sort().map(k=>[k,value[k]])):value);}
function denied():never{throw new Error("NATIVE_ORIGINAL_PROOF_REFUSED");}
export function contextProof(value:unknown,original:NativePairOriginal):NativeOwner{
 if(!obj(value)||Object.keys(value).sort().join(",")!=="actor_id,enrollment_request_id,grant,installation_id,native_authority_id,native_owner,protocol"||
 value.protocol!=="node_hosted_native_custodian_v1"||value.actor_id!==original.actorId||value.installation_id!==original.installationId||
 value.enrollment_request_id!==original.enrollmentRequestId||value.native_authority_id!==original.authorityId||!obj(value.grant)||
 value.grant.id!==original.grantId||value.grant.revision!==original.grantRevision||value.grant.revoked!==false||
 !obj(value.grant.scope)||!Array.isArray(value.grant.scope.permissions)||!value.grant.scope.permissions.includes("hosted_enrollment")||
 !same(value.native_owner,original.nativeOwner))return denied();
 const n=original.nativeOwner;
 if(!n.library_id||!n.service_instance_id||n.project!==null&&(!obj(n.project)||typeof n.project.id!=="string"||!Number.isSafeInteger(n.project.revision)))return denied();
 return structuredClone(n);
}
export function originalProof(value:unknown,original:NativePairOriginal,operationId:string,payloadHash:string):NativeOwner{
 if(!obj(value)||Object.keys(value).sort().join(",")!=="context,dispatch_claimed,operation_id,payload_hash,protocol"||
 value.protocol!=="node_hosted_native_original_v1"||value.operation_id!==operationId||value.payload_hash!==payloadHash||value.dispatch_claimed!==true)return denied();
 return contextProof(value.context,original);
}
