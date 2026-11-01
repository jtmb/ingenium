/** Pure validation of actual TLS responses. Callers still must own private paired custody. */
import {ScopedProofSchema,ScopedOriginalProofSchema,ScopedEffectSchema,scopedRequestHash,requireScopedSubset} from 'ingenium-core/lib/tools/customize-scoped-v1-contracts';
import {contextProof,type NativePairOriginal} from './paired-native-proof.js';
export function verifyScopedProof(value:unknown,paired:NativePairOriginal,expected:{consentId:string;requestSha256?:string;purpose:'prepare'|'domain'}){
 const proof=ScopedProofSchema.parse(value);contextProof(proof.context,paired);
 const o=proof.original,b=o.baseBinding,n=paired.nativeOwner;
 if(o.id!==expected.consentId||proof.requestSha256!==scopedRequestHash(o)||expected.requestSha256&&proof.requestSha256!==expected.requestSha256||
 b.actorId!==paired.actorId||b.installationId!==paired.installationId||b.hostedProjectId!==paired.hostedProjectId||
 b.nativeLibraryId!==n.library_id||b.nativeServiceInstanceId!==n.service_instance_id||b.nativeProjectId!==(n.project?.id??null)||b.nativeProjectRevision!==(n.project?.revision??null)||
 scopedRequestHash(o.nativeOwner)!==scopedRequestHash(n)||proof.consentRevision!==1||
 (expected.purpose==='prepare'?proof.state!=='prepared':proof.state!=='active'))throw Error('SCOPED_NATIVE_PROOF_REFUSED');
 requireScopedSubset(o.selection,{scopes:o.selection.scopes,verbs:proof.effectiveVerbs});
 return proof;
}
export function verifyScopedOriginal(value:unknown,paired:NativePairOriginal,input:unknown){
 const original=ScopedEffectSchema.parse(input),proof=ScopedOriginalProofSchema.parse(value),hash=scopedRequestHash(original);
 if(proof.operationId!==original.id||proof.nativeRequestSha256!==hash)throw Error('SCOPED_ORIGINAL_NOT_DISPATCHED');
 const consent=verifyScopedProof(proof.proof,paired,{consentId:original.consentId,requestSha256:original.consentRequestSha256,purpose:'domain'});
 if(consent.consentRevision!==original.consentRevision||scopedRequestHash(consent.original.baseBinding)!==scopedRequestHash(original.baseBinding))throw Error('SCOPED_ORIGINAL_BINDING_CONFLICT');
 return {original,proof:consent,nativeRequestSha256:hash};
}