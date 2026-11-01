/** Separately versioned native consent. No model executor or credential/endpoint input. */
import {z} from 'zod';
import {payloadHash} from './hosted-governance.js';
export const SCOPED_PROTOCOL='customize-scoped-v1' as const;
export const ScopedVerbSchema=z.enum(['discover','source','project-source','archived-plugins','installations','operation','pending','publish','withdraw','restore-source','revise-plugin-source','connect','archive-plugin','restore-plugin','activate-plugin','deactivate-plugin','reconcile-plugin-projection','reconcile-local-metadata']);
export const ScopedVisibilitySchema=z.enum(['project','personal','public','system']);
const id=z.string().uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/),revision=z.number().int().min(1).max(4294967295),opaque=z.string().min(1).max(256).refine(v=>Array.from(v).every(c=>c.charCodeAt(0)>31)),nonnegative=z.number().int().min(0).max(4294967295);
export const ScopedSelectionSchema=z.object({scopes:z.array(ScopedVisibilitySchema).min(1).max(4),verbs:z.array(ScopedVerbSchema).min(1).max(18)}).strict().superRefine((v,c)=>{if(new Set(v.scopes).size!==v.scopes.length||new Set(v.verbs).size!==v.verbs.length)c.addIssue({code:'custom',message:'Explicit unique scopes/verbs required'});});
export const ScopedBindingSchema=z.object({authorityId:opaque,connectionId:opaque,grantId:opaque,grantRevision:nonnegative,epoch:opaque,nativeLibraryId:opaque,nativeServiceInstanceId:opaque,hostedServiceInstanceId:opaque,nativeProjectId:opaque.nullable(),nativeProjectRevision:nonnegative.nullable(),actorId:opaque,installationId:opaque,hostedProjectId:opaque,apiProject:z.string().min(1).max(64),visibility:z.enum(['project','system'])}).strict();
export const ScopedEffectSchema=z.object({protocol:z.literal(SCOPED_PROTOCOL),id,consentId:id,consentRevision:revision,consentRequestSha256:hash,baseBinding:ScopedBindingSchema,command:z.record(z.string(),z.unknown())}).strict();
export const ScopedReadSchema=z.object({protocol:z.literal(SCOPED_PROTOCOL),consentId:id,consentRevision:revision,verb:ScopedVerbSchema,query:z.record(z.string(),z.unknown())}).strict();
export const ScopedConsentRequestSchema=z.object({protocol:z.literal(SCOPED_PROTOCOL),consentId:id,parentGrantId:opaque,enrollmentRequestId:opaque,requestSha256:hash}).strict();
export type ScopedVerb=z.infer<typeof ScopedVerbSchema>;
export type ScopedVisibility=z.infer<typeof ScopedVisibilitySchema>;
export const scopedReadVerbs=new Set<ScopedVerb>(['discover','source','project-source','archived-plugins','installations','operation','pending']);
export const scopedRequestHash=(value:unknown)=>payloadHash(value);
export function requireScopedSubset(actual:{scopes:ScopedVisibility[];verbs:ScopedVerb[]},requested:{scopes:ScopedVisibility[];verbs:ScopedVerb[]}):void{
 if(requested.scopes.some(v=>!actual.scopes.includes(v))||requested.verbs.some(v=>!actual.verbs.includes(v)))throw new Error('Requested scoped consent is unavailable');
}const opaqueIdentifier=z.string().min(1).max(256).refine(v=>Array.from(v).every(c=>c.charCodeAt(0)>31));
const safe=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const ScopedLocalPolicySchema=z.object({role:z.enum(['owner','member','restricted','trusted_contact']),allowed_permissions:z.array(z.enum(['customize_scoped_v1_read','customize_scoped_v1_write'])).nullable(),expires_at:safe.nullable(),daily_window:z.object({start_minute_utc:safe.max(1439),end_minute_utc:safe.max(1440)}).strict().nullable(),max_mutating_admissions:safe.nullable()}).strict();
export const ScopedConsentOriginalSchema=z.object({protocol:z.literal(SCOPED_PROTOCOL),id,baseBinding:ScopedBindingSchema,nativeOwner:z.object({library_id:opaqueIdentifier,service_instance_id:opaqueIdentifier,project:z.record(z.string(),z.unknown()).nullable()}).strict(),accountId:id,selection:ScopedSelectionSchema,localPolicy:ScopedLocalPolicySchema,reviewSha256:hash}).strict();
export const ScopedProofSchema=z.object({protocol:z.literal(SCOPED_PROTOCOL),context:z.record(z.string(),z.unknown()),original:ScopedConsentOriginalSchema,requestSha256:hash,consentRevision:revision,state:z.enum(['prepared','active','revoked','unconfirmed']),effectiveVerbs:z.array(ScopedVerbSchema).max(18),localProfileRevision:revision,parentProfileRevision:revision}).strict();
export const ScopedOriginalProofSchema=z.object({protocol:z.literal('customize-scoped-v1-original'),proof:ScopedProofSchema,operationId:id,nativeRequestSha256:hash,dispatchClaimed:z.literal(true)}).strict();
export const ScopedNodeReceiptSchema=z.object({protocol:z.literal(SCOPED_PROTOCOL),consentId:id,revision,requestSha256:hash,actorId:opaqueIdentifier,installationId:opaqueIdentifier,enrollmentRequestId:opaqueIdentifier,baseBindingSha256:hash,selection:ScopedSelectionSchema,physicalErasure:z.literal(false)}).strict();
