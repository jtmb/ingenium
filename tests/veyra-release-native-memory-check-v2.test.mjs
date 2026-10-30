import test from 'node:test'; import assert from 'node:assert/strict'; import {readFile} from 'node:fs/promises'; import {createHash} from 'node:crypto';
import {proposeSourceHashBatching} from '../tools/veyra-release/source-hash-batching-patch.mjs';
import {proposeNativeMemoryCheckV2} from '../tools/veyra-release/native-memory-check-v2-patch.mjs';
import {MEMORY_CHECK_POLICY as P} from '../tools/veyra-release/memory-check-profile.mjs';
const base=new URL('../',import.meta.url),read=name=>readFile(new URL(name,base));
const c240=Buffer.from(proposeSourceHashBatching(await read('tools/veyra-release/native-reviewed-cargo-check.mjs'),await read('tools/veyra-release/source-hash-batching.mjs')).after);
const proposal=proposeNativeMemoryCheckV2(c240,await read('tools/veyra-release/native-memory-check-v2-fragment.mjs'));
const M=await import('data:text/javascript;base64,'+Buffer.from(proposal.after).toString('base64'));
const h='a'.repeat(64),tree='b'.repeat(40),policy='c'.repeat(64),V2=M.MEMORY_CHECK_V2;
function resolution(){return{owner:M.CHECK.reviewer,beforeSha256:V2.baselineLock,command:['metadata','--offline','--format-version','1','--filter-platform','x86_64-pc-windows-msvc'],compiled:false,code:0,verification:{expectedSha256:V2.resolvedLock,actualSha256:V2.resolvedLock,registryRecordsUnchanged:true},actualLockResolvedByCoordinator:true};}
function fixture(profile=M.CHECK.profile){
 const capture={profile,actualLockSha256:profile===V2.profile?V2.resolvedLock:V2.baselineLock,memoryLockResolutionSha256:profile===V2.profile?V2.resolutionSha256:undefined,sourceTree:tree,sourceStateSha256:h,gatePolicySha256:policy,inputs:Object.fromEntries(['sourceFilesSha256','cacheSha256','toolchainSha256','rootsSha256','flagsSha256','nativeEnvironmentSha256'].map(k=>[k,h]))};
 const receipt=M.cargoCheckReviewFacts(capture);receipt.reviewed=true;receipt.hostInputsReviewed=true;
 const events=[],adapters={platform:()=> 'win32',read:async()=>{events.push('read');return{value:receipt,sha256:h};},capture:async(root,env,p)=>{events.push('capture:'+p);return capture;},guard:async()=>{events.push('guard');return{stage:{approved_native_wsl_pair:true,local_task_budget_bytes:M.CHECK.ceiling,estimated_growth_bytes:M.CHECK.growth,task_allocated_bytes:18000000000,system_free_bytes:50*1024**3,destination_free_bytes:50*1024**3,environment_filesystem_free_bytes:{WSL:500*1024**3}}};},verifySource:async()=>{events.push('source');},verifyResolution:async()=>{events.push('resolution');},launch:async()=>{events.push('launch');}};
 return{capture,receipt,events,adapters};
}
test('exact c240 patch retains original v1 pins and all shared validation/guard/launcher sections',()=>{
 assert.equal(proposal.v1FixedPinsPreserved,true);assert.equal(proposal.descriptorCacheGuardAndCompilerPreserved,true);
 assert.equal(M.CHECK.profile,'native-cargo-check-existing-inputs-v1');assert.equal(M.CHECK.growth,(2048+256)*1024**2);
 assert.throws(()=>proposeNativeMemoryCheckV2(Buffer.concat([c240,Buffer.from(' ')]),Buffer.from('')),/preimage/);
});
test('only explicit v1/default or exact v2 profile accepted, never caller maps/numbers',()=>{
 assert.equal(M.reviewedCheckProfile(),M.CHECK.profile);assert.equal(M.reviewedCheckProfile(V2.profile),V2.profile);
 for(const value of ['other',{},1,null])assert.throws(()=>M.reviewedCheckProfile(value),/unknown explicit/);
});
test('v2 overlays only exact c9 Memory declarations while v1 pins remain unchanged',()=>{
 const old=Object.fromEntries(P.manifests.filter(row=>row.beforeSha256).map(row=>[row.path,row.beforeSha256]));old['Cargo.lock']=V2.baselineLock;old['original-guard']='pinned';
 const before=structuredClone(old);assert.equal(M.pinsForCheckProfile(M.CHECK.profile,old),old);
 const next=M.pinsForCheckProfile(V2.profile,old);assert.deepEqual(old,before);assert.equal(next['original-guard'],'pinned');assert.equal(next['Cargo.lock'],P.expectedResolvedLockSha256);
 for(const row of P.manifests)assert.equal(next[row.path],row.afterSha256,row.path);
});
test('v2 includes Memory Source in original total and enforces separate small-library envelope',()=>{
 const files=[['crates/adapters/src/lib.rs',{bytes:20}],['crates/veyra-memory/src/lib.rs',{bytes:100}],['crates/veyra-memory/src/types.rs',{bytes:50}]];
 assert.equal(M.workspaceBytesForCheckProfile(M.CHECK.profile,files),20);assert.equal(M.workspaceBytesForCheckProfile(V2.profile,files),170);
 assert.throws(()=>M.workspaceBytesForCheckProfile(V2.profile,files.slice(0,1)),/absent/);
 assert.throws(()=>M.workspaceBytesForCheckProfile(V2.profile,[['crates/veyra-memory/src/lib.rs',{bytes:128*1024+1}]]),/envelope/);
});
test('actual pinned r2 receipt, current actual lock, command and resolver success all required',()=>{
 M.validateMemoryResolution(resolution(),V2.resolutionSha256,V2.resolvedLock);
 assert.throws(()=>M.validateMemoryResolution(resolution(),h,V2.resolvedLock),/actual pinned/);
 assert.throws(()=>M.validateMemoryResolution(resolution(),V2.resolutionSha256,V2.baselineLock),/actual pinned/);
 for(const patch of [{owner:'worker'},{code:1},{compiled:true},{actualLockResolvedByCoordinator:false},{beforeSha256:h},{command:['metadata','--offline','--no-deps']},{verification:{expectedSha256:V2.resolvedLock,actualSha256:V2.resolvedLock,registryRecordsUnchanged:false}}]){
  assert.throws(()=>M.validateMemoryResolution({...resolution(),...patch},V2.resolutionSha256,V2.resolvedLock),/actual pinned/);
 }
});
test('resolution receipt is fixed under registered paired task, no caller path selection',()=>{
 const paired='C:\\paired',root='C:\\paired\\real-gmail-ui\\veyra-phase-1\\windows-source',env={VEYRA_EXISTING_WSL_TASK_ROOT:paired,VEYRA_MEMORY_RESOLUTION_PATH:'D:\\fake.json'};
 assert.equal(M.memoryResolutionLocation(root,env).file,'C:\\paired\\real-gmail-ui\\veyra-phase-1\\coordination\\integration\\native-memory-lock-resolution-r2.json');
 assert.throws(()=>M.memoryResolutionLocation('D:\\other\\source',env),/paired Source/);
 assert.throws(()=>M.memoryResolutionLocation(root,{}),/paired Source/);
});
test('changed/missing/default/ASM/derive feature or artifact witnesses refuse',()=>{
 for(const expected of M.MEMORY_V2_WITNESSES){
  const fp={sha256:expected.fingerprint,value:{features:expected.features}},artifact={bytes:expected.bytes,sha256:h};M.validateMemoryFeatureWitness(expected,fp,artifact);
  assert.throws(()=>M.validateMemoryFeatureWitness(expected,{...fp,sha256:h},artifact),/feature witness/);
  assert.throws(()=>M.validateMemoryFeatureWitness(expected,{...fp,value:{features:'["default","std","asm"]'}},artifact),/feature witness/);
  assert.throws(()=>M.validateMemoryFeatureWitness(expected,fp,{...artifact,bytes:0}),/feature witness/);
 }
});
test('v1 schema stays strict; v2 requires exact resolution hash and matching capture profile/current lock',()=>{
 const a=fixture();M.validateReview(a.receipt,a.capture,tree,policy);assert(!Object.hasOwn(a.receipt,'memoryLockResolutionSha256'));
 assert.throws(()=>M.validateReview({...a.receipt,memoryLockResolutionSha256:V2.resolutionSha256},a.capture,tree,policy),/fixed-profile/);
 const b=fixture(V2.profile);M.validateReview(b.receipt,b.capture,tree,policy);
 for(const change of [()=>{delete b.receipt.memoryLockResolutionSha256;},()=>{b.capture.profile=M.CHECK.profile;},()=>{b.capture.actualLockSha256=V2.baselineLock;},()=>{b.receipt.memoryLockResolutionSha256=h;}]){
  const saved=structuredClone({receipt:b.receipt,capture:b.capture});change();assert.throws(()=>M.validateReview(b.receipt,b.capture,tree,policy));Object.assign(b,{receipt:saved.receipt,capture:saved.capture});
 }
});
test('unknown main receipt fields or stale Source/independent inputs never qualify either profile',()=>{
 for(const profile of [M.CHECK.profile,V2.profile]){
  const f=fixture(profile);assert.throws(()=>M.validateReview({...f.receipt,command:['build']},f.capture,tree,policy),/fixed-profile/);
  f.capture.inputs.rootsSha256='d'.repeat(64);assert.throws(()=>M.validateReview(f.receipt,f.capture,tree,policy),/inputs changed/);
 }
});
test('v1 runner keeps original path; v2 forwards explicit profile and rechecks actual witness just before launch',async()=>{
 for(const profile of [M.CHECK.profile,V2.profile]){
  const f=fixture(profile);const result=await M.createCheckRunner(f.adapters)('source',{},tree,policy);assert.equal(result.profile,profile);
  assert(f.events.includes('capture:'+profile));assert.equal(f.events.includes('resolution'),profile===V2.profile);
  if(profile===V2.profile)assert.equal(f.events[f.events.indexOf('launch')-1],'resolution');
 }
});
test('missing verifier, changed actual r2 or unsafe capture refuses before compiler',async()=>{
 const a=fixture(V2.profile);delete a.adapters.verifyResolution;await assert.rejects(M.createCheckRunner(a.adapters)('source',{},tree,policy),/verifier unavailable/);assert(!a.events.includes('launch'));
 const b=fixture(V2.profile);b.adapters.verifyResolution=async()=>{throw new Error('actual r2 changed');};await assert.rejects(M.createCheckRunner(b.adapters)('source',{},tree,policy),/r2 changed/);assert(!b.events.includes('launch'));
 const c=fixture(V2.profile);c.adapters.capture=async()=>{throw new Error('paired receipt ancestor redirected');};await assert.rejects(M.createCheckRunner(c.adapters)('source',{},tree,policy),/redirected/);assert(!c.events.includes('guard'));
});
test('v2 still preserves original first compiler failure when post-source verification also fails',async()=>{
 const f=fixture(V2.profile),first=new Error('compiler first');let checks=0;f.adapters.launch=async()=>{throw first;};f.adapters.verifySource=async()=>{if(++checks===3)throw new Error('later Source drift');};
 await assert.rejects(M.createCheckRunner(f.adapters)('source',{},tree,policy),error=>error===first&&error.sourceStabilityFailure==='later Source drift');
});
test('candidate facts cannot self-approve v2 or disclose internal environment',()=>{
 const f=fixture(V2.profile);f.capture.execution={env:{PRIVATE:'hidden'}};const facts=M.cargoCheckReviewFacts(f.capture);
 assert.equal(facts.reviewed,false);assert.equal(facts.hostInputsReviewed,false);assert.equal(facts.memoryLockResolutionSha256,V2.resolutionSha256);assert.equal(facts.execution,undefined);
});
test('delivered exact patch and metadata match, with in-memory application reproducing after bytes',async()=>{
 const patch=await read('docs/workstreams/packaging/native-memory-check-v2.patch'),meta=JSON.parse(await read('docs/workstreams/packaging/native-memory-check-v2.json'));
 const sha=b=>createHash('sha256').update(b).digest('hex');assert.equal(patch.toString(),proposal.patch);assert.equal(sha(patch),meta.patchSha256);assert.equal(sha(proposal.after),meta.afterSha256);
 const source=c240.toString().trimEnd().split('\n'),result=[];let cursor=0;
 for(const line of patch.toString().trimEnd().split('\n').slice(3)){
  const m=/^@@ -(\d+),(\d+) \+(\d+),(\d+) @@/.exec(line);if(m){const start=Number(m[1])-(Number(m[2])?1:0);result.push(...source.slice(cursor,start));cursor=start;continue;}
  const kind=line===''?' ':line[0],value=line===''?'':line.slice(1);if(kind===' '||kind==='-'){assert.equal(source[cursor++],value);if(kind===' ')result.push(value);}else if(kind==='+')result.push(value);else assert.fail('Unexpected patch record');
 }
 result.push(...source.slice(cursor));assert.equal(result.join('\n')+'\n',proposal.after);
});

test('bool-only in-memory resolver file cannot replace pinned actual r2 bytes; descriptor closes on rejection',async()=>{
 const content=Buffer.from(JSON.stringify(resolution())),paired='C:\\paired',root='C:\\paired\\phase\\windows-source';let closed=0;
 const stat={dev:1n,ino:2n,size:BigInt(content.length),nlink:1n,mtimeNs:3n,ctimeNs:4n,isFile:()=>true,isSymbolicLink:()=>false};
 const directory={isDirectory:()=>true,isSymbolicLink:()=>false};
 const api={realpath:async p=>p,lstat:async p=>p.endsWith('.json')?stat:directory,open:async()=>({stat:async()=>stat,
  read:async(buffer,offset,length,position)=>{const n=Math.max(0,Math.min(length,content.length-position));if(n)content.copy(buffer,offset,position,position+n);return{bytesRead:n};},close:async()=>{closed++;}})};
 await assert.rejects(M.readMemoryResolution(api,root,{VEYRA_EXISTING_WSL_TASK_ROOT:paired},V2.resolvedLock),/actual pinned/);assert.equal(closed,1);
});
