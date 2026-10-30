import {PROTOCOL_CASES,hash,UUID,hex,imageId,freeze} from '../../packages/veyra-operations/core126-image-contract.mjs';
/** Pure closed DTO validation ONLY. This module NEVER issues an original lease,
 * accepts a credential, creates an approval, touches Core/manager state or brands authority. */
export const CANDIDATE_PURPOSE='candidate-inert-v1';
export const MAX_CANDIDATE_LEASE_MS=120000;
export const CANDIDATE_CASE_IDS=Object.freeze(Object.keys(PROTOCOL_CASES));
const deny=()=>{throw Object.assign(Error('Original candidate intent unavailable'),{code:'CORE126_CANDIDATE_INTENT_UNAVAILABLE'});};
const must=v=>{if(!v)deny();};
const keys=(o,k)=>{must(o&&typeof o==='object'&&!Array.isArray(o)&&[Object.prototype,null].includes(Object.getPrototypeOf(o)));const own=Reflect.ownKeys(o);must(own.every(key=>typeof key==='string')&&own.sort().join('|')===[...k].sort().join('|')&&Object.values(Object.getOwnPropertyDescriptors(o)).every(d=>Object.hasOwn(d,'value')&&d.enumerable));};
const uuid=v=>typeof v==='string'&&UUID.test(v);
const text=v=>typeof v==='string'&&v.length>0&&v.length<=256&&v===v.trim()&&!/[\u0000-\u001f\u007f]/u.test(v);
const integer=v=>Number.isSafeInteger(v)&&v>=0;
const positive=v=>Number.isSafeInteger(v)&&v>0;
const iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
function shape(v){
 keys(v,['schemaVersion','purpose','caseId','nonce','source','imageId','artifactClosureSha256','rawSchemaSha256','probeSha256','parent','scope','run','resource','canary','issuedAt','expiresAt']);
 must(v.schemaVersion===1&&v.purpose===CANDIDATE_PURPOSE&&CANDIDATE_CASE_IDS.includes(v.caseId)&&uuid(v.nonce)&&imageId(v.imageId));
 keys(v.source,['revision','sha256','filesSha256']);must(typeof v.source.revision==='string'&&/^[a-f0-9]{40}$/.test(v.source.revision)&&hex(v.source.sha256)&&hex(v.source.filesSha256));
 must(['artifactClosureSha256','rawSchemaSha256','probeSha256'].every(k=>hex(v[k])));
 keys(v.parent,['runtimeId','containerId','daemonId','hostId','startIdentity','publicProfileSha256','provisioningRevision']);
 must(uuid(v.parent.runtimeId)&&hex(v.parent.containerId)&&text(v.parent.daemonId)&&typeof v.parent.hostId==='string'&&/^docker-daemon:[a-f0-9]{64}$/.test(v.parent.hostId)&&hex(v.parent.startIdentity)&&hex(v.parent.publicProfileSha256)&&integer(v.parent.provisioningRevision));
 keys(v.scope,['organizationId','projectId','ownerUserId','workspaceId','bindingHash','bindingEpoch','principalId','principalSecurityEpoch','grantRevision']);
 must(['organizationId','projectId','ownerUserId','principalId'].every(k=>uuid(v.scope[k]))&&text(v.scope.workspaceId)&&hex(v.scope.bindingHash)&&['bindingEpoch','principalSecurityEpoch','grantRevision'].every(k=>integer(v.scope[k])));
 keys(v.run,['runId','jobId','attemptId','runIdentityHash','jobRevision','scheduleRevision','promptHash','agentHash']);
 must(['runId','jobId','attemptId'].every(k=>uuid(v.run[k]))&&['runIdentityHash','promptHash','agentHash'].every(k=>hex(v.run[k]))&&integer(v.run.jobRevision)&&integer(v.run.scheduleRevision));
 keys(v.resource,['admissionId','runtimeRevision','limits']);must(v.resource.admissionId===v.run.runId&&integer(v.resource.runtimeRevision));
 keys(v.resource.limits,['cpuMillis','memoryBytes','pidsLimit','diskBytes','processLimit']);must(Object.values(v.resource.limits).every(positive));
 keys(v.canary,['agent','model','tool','projectName','trapOrigin','catalogSha256']);must(v.canary.agent==='qualification'&&v.canary.model==='opencode/qualification-canary'&&v.canary.tool==='ingenium_project_detail'&&text(v.canary.projectName)&&v.canary.trapOrigin==='http://127.0.0.1:39261'&&hex(v.canary.catalogSha256));
 must(iso(v.issuedAt)&&iso(v.expiresAt));const span=Date.parse(v.expiresAt)-Date.parse(v.issuedAt);must(span>0&&span<=MAX_CANDIDATE_LEASE_MS);
 // This shape intentionally contains no approvedScopes/profileId/profileQualified,
 // credential/token, arbitrary command/environment, prompt text, pass/trace or brand.
 return v;
}
/** A stable digest is a persistence identity, never an approval or live authority. */
export function candidateInertIntentHash(value){return hash(shape(value));}
export function assertCandidateInertIntentLive(value,now=Date.now()){
 shape(value);must(Number.isSafeInteger(now)&&now>=0&&Date.parse(value.issuedAt)<=now&&Date.parse(value.expiresAt)>now);
}
/** recomputed MUST be built by Root from current original owners, not echoed input.
 * Equality is only one check BEFORE Root issues/consumes its non-serializable brand. */
export function assertCandidateInertBinding(value,recomputed,now=Date.now()){
 assertCandidateInertIntentLive(value,now);assertCandidateInertIntentLive(recomputed,now);must(candidateInertIntentHash(value)===candidateInertIntentHash(recomputed));
}
export function freezeCandidateInertIntent(value){shape(value);return freeze(structuredClone(value));}
