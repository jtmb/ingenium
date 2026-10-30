import {execFileSync,spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
export const base='a2151e6b12c051efa751843d1f4db577ffd26388';
export const sha=value=>createHash('sha256').update(value).digest('hex');
export function changes(root){
 const result=[];
 const change=(path,work)=>{const before=execFileSync('git',['-C',root,'show',base+':'+path],{encoding:'utf8',maxBuffer:2*1024*1024});let after=before;
  const replace=(from,to)=>{if(after.split(from).length!==2)throw Error('Exact anchor missing/ambiguous '+path+': '+from.slice(0,80));after=after.replace(from,to);};work(replace);result.push({path,before,after});};
 const api='services/ingenium-api/lib/dot-v2/';
 change(api+'core126-owner.mjs',r=>{
  r('import {projectCore126AgentMaterial}',"import {describeStoredManagedPurpose,requireProductionManagedPurpose} from './core126-purpose.mjs';\nimport {projectCore126AgentMaterial}");
  r('if(!r)fail("MANAGED_JOB_NOT_FOUND");return {r,a:', 'if(!r)fail("MANAGED_JOB_NOT_FOUND");requireProductionManagedPurpose(r);return {r,a:');
  r(' return Object.freeze({\n  factsForImagePreparation',` return Object.freeze({
  /** Private original-owner lookup only: data discrimination is never a grant. */
  admissionPurpose(runId){const r=row(runId);if(!r)fail('MANAGED_JOB_NOT_FOUND');return describeStoredManagedPurpose(r);},
  async prepareCandidateInert(selection,ctx){
   if(Object.keys(selection).sort().join('|')!=='projectId|runId|runtimeId|workspaceId')fail('MANAGED_JOB_INVALID_SELECTION');
   base(selection,ctx); // Reuse original permission, source, run, epochs and quota checks; no second claim.
   // Root's real observation/source/canary constructor is not installed. A DTO or injected port cannot supply it.
   fail('MANAGED_JOB_ORIGINAL_CANDIDATE_LEASE_UNAVAILABLE');
  },
  factsForImagePreparation`);
  r('credential.kind!=="job-run"||credential.audience!=="job-run"', 'credential.purpose!=="production"||credential.candidateIntentHash!==null||credential.kind!=="job-run"||credential.audience!=="job-run"');
 });
 change(api+'managed-job-contracts.d.mts',r=>{
  r('export interface Core126Owner {',`export type ManagedAdmissionPurpose = Readonly<{purpose:'production';candidateIntentHash:null}> | Readonly<{purpose:'candidate-inert-v1';candidateIntentHash:string}>;
/** Not constructed here. A DTO/hash or TypeScript brand is not a runtime original lease. */
declare const originalCandidateLeaseBrand:unique symbol;
export interface OriginalCandidateLease {readonly [originalCandidateLeaseBrand]:never}
export interface Core126Owner {
 admissionPurpose(runId:string):ManagedAdmissionPurpose;
 /** Closed until the original image/physical-parent/source/canary constructor is installed. No lease parameter. */
 prepareCandidateInert(selection:Core126Selection,context:CoreActorContext):Promise<never>;`);
 });
 change('packages/ingenium-core/lib/tools/mcp-credentials.ts',r=>{
  r('export interface ManagedJobCredential {',`/** Only the existing production credential is currently issued/inspected. Candidate authority remains closed. */
export interface ManagedJobCredential {
  purpose:'production';candidateIntentHash:null;`);
  r('if(!row||attemptId!==undefined&&row.attempt_id!==attemptId)return undefined;',`if(!row||attemptId!==undefined&&row.attempt_id!==attemptId)return undefined;
  // Persisted purpose only. SQL129 defaults old rows to production without changing encrypted bytes.
  // A candidate DTO/hash is NOT a genuine original lease; no candidate credential can be issued here yet.
  if(row.purpose==='candidate-inert-v1')return undefined;
  if(row.purpose!=='production'||row.candidate_intent_json!==null||row.candidate_intent_hash!==null||typeof row.profile_id!=='string'||!row.profile_id||typeof row.profile_hash!=='string'||!/^[a-f0-9]{64}$/.test(row.profile_hash))return undefined;`);
  r('return {id:generated.id,kind:"job-run" as const', 'return {purpose:"production" as const,candidateIntentHash:null,id:generated.id,kind:"job-run" as const');
  r('if(!binding||binding.row.principal_epoch', 'if(!binding||credential.purpose!=="production"||credential.candidate_intent_hash!==null||binding.row.principal_epoch');
  r('const a=binding.a;return {id:String(credential.id),kind:"job-run"', 'const a=binding.a;return {purpose:"production",candidateIntentHash:null,id:String(credential.id),kind:"job-run"');
 });
 change(api+'core126-actual-factory.ts',r=>{
  r(' const rawHandlers=createCore126Handlers',` const requireProductionPurpose=(runId:string)=>{const original=owner.admissionPurpose(runId);
  if(original.purpose!=='production')throw Object.assign(Error('MANAGED_JOB_ORIGINAL_CANDIDATE_LEASE_UNAVAILABLE'),{status:503});};
 const rawHandlers=createCore126Handlers`);
  r('   return needsImage?withImage(', '   if(needsImage)requireProductionPurpose(runId);\n   return needsImage?withImage(');
  r('   if(!credential||credential.runId!==runId)', '   if(!credential||credential.purpose!=="production"||credential.candidateIntentHash!==null||credential.runId!==runId)');
  r('   return withImage(owner.factsForOriginalImageCheck(runId),()=>rawHandlers.runtime(request));','   requireProductionPurpose(runId);\n   return withImage(owner.factsForOriginalImageCheck(runId),()=>rawHandlers.runtime(request));');
 });
 change(api+'core126-http.mjs',r=>{
  r('   if(!credential||credential.runId!==match[1])','   if(!credential||credential.purpose!=="production"||credential.candidateIntentHash!==null||credential.runId!==match[1])');
  r('  if(credential.kind!=="job-run"||credential.audience!=="job-run"', '  if(credential.purpose!=="production"||credential.candidateIntentHash!==null||credential.kind!=="job-run"||credential.audience!=="job-run"');
 });
 for(const name of ['core126-purpose.mjs','core126-purpose.d.mts'])result.push({path:api+name,before:'',after:readFileSync(new URL(name,import.meta.url),'utf8'),expectedAbsent:true});
 return result;
}
export function prepare(root){
 const items=changes(root);for(const c of items)if(!c.expectedAbsent&&sha(readFileSync(root+'/'+c.path))!==sha(c.before))throw Error('Canonical preimage drift '+c.path);
 const py="import sys,json,difflib\nfor c in json.load(sys.stdin):\n sys.stdout.writelines(difflib.unified_diff(c['before'].splitlines(True),c['after'].splitlines(True),fromfile='/dev/null' if c.get('expectedAbsent') else 'a/'+c['path'],tofile='b/'+c['path'],n=3))\n";
 const output=spawnSync('python3',['-c',py],{input:JSON.stringify(items),encoding:'utf8',maxBuffer:2*1024*1024});if(output.status!==0)throw Error('Patch render failed');
 writeFileSync(new URL('candidate-core-owner.patch',import.meta.url),output.stdout);
 const references=['packages/ingenium-core/data/migrations/129_managed_candidate_purpose.sql','docs/workstreams/packaging/core126-candidate-fixture-audit.md','docs/workstreams/packaging/core126-candidate-fixture-audit-inputs.json','tools/veyra-release/core126-candidate-intent.mjs','tools/veyra-release/core126-candidate-intent.d.mts','packages/veyra-operations/core126-image-owner.mjs','services/ingenium-api/lib/dot-v2/job-bootstrap-frame.mjs'];
 const manifest={base,scope:'Explicit-purpose refusal integration; real candidate constructor remains closed. Root owns SQL129 registration/canonical apply.',patchSha256:sha(output.stdout),changes:items.map(c=>({path:c.path,expectedAbsent:!!c.expectedAbsent,preimageSha256:c.expectedAbsent?null:sha(c.before),proposedSha256:sha(c.after)})),referenceInputs:references.map(path=>({path,sha256:sha(readFileSync(root+'/'+path))}))};writeFileSync(new URL('preimages.json',import.meta.url),JSON.stringify(manifest,null,2)+'\n');return manifest;
}
if(process.argv[1]?.endsWith('/proposal.mjs'))console.log(JSON.stringify(prepare(process.argv[2])));
