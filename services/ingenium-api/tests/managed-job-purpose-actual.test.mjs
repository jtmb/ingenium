import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';

const integration=process.env.CANDIDATE_OWNER_INTEGRATION;if(!integration?.startsWith('/'))throw Error('Explicit existing integration required');
const actualPaths=["services/ingenium-api/lib/dot-v2/core126-owner.mjs","services/ingenium-api/lib/dot-v2/managed-job-contracts.d.mts","packages/ingenium-core/lib/tools/mcp-credentials.ts","services/ingenium-api/lib/dot-v2/core126-actual-factory.ts","services/ingenium-api/lib/dot-v2/core126-http.mjs","services/ingenium-api/lib/dot-v2/core126-purpose.mjs","services/ingenium-api/lib/dot-v2/core126-purpose.d.mts"];const byName=new Map(actualPaths.map(p=>[p,readFileSync(resolve(integration,p),'utf8')])),api='services/ingenium-api/lib/dot-v2/';
let sourceSequence=0;
const url=p=>pathToFileURL(resolve(integration,p)).href,data=s=>'data:text/javascript;base64,'+Buffer.from(s+'\n//# sourceURL=candidate-source-'+(++sourceSequence)+'.mjs').toString('base64');
let purpose=byName.get(api+'core126-purpose.mjs').replace("'../../../../tools/veyra-release/core126-candidate-intent.mjs'",JSON.stringify(url('tools/veyra-release/core126-candidate-intent.mjs'))).replace("'./job-bootstrap-frame.mjs'",JSON.stringify(url(api+'job-bootstrap-frame.mjs')));
const purposeURL=data(purpose);
let owner=byName.get(api+'core126-owner.mjs').replace("'./core126-purpose.mjs'",JSON.stringify(purposeURL)).replace('"../../../../packages/veyra-operations/core126-agent-material.mjs"',JSON.stringify(url('packages/veyra-operations/core126-agent-material.mjs')));
const fixtureURL=pathToFileURL(resolve(integration,'docs/workstreams/dot/core126-sqlite.cpu.mjs'));
let fixture=readFileSync(fixtureURL,'utf8');fixture=fixture.slice(0,fixture.indexOf('\ntest('));
for(const [before,after]of [['"./managed-job-owner.proposal.mjs"',url(api+'managed-job-owner.mjs')],['"./core126-owner.proposal.mjs"',data(owner)],['"./core126-http.proposal.mjs"',data(byName.get(api+'core126-http.mjs'))]])fixture=fixture.replace(before,JSON.stringify(after));
fixture=fixture.replace('const extension=strip(readFileSync(new URL("./core126-credentials.proposal.ts",import.meta.url),"utf8"));','const extension=strip('+JSON.stringify(byName.get('packages/ingenium-core/lib/tools/mcp-credentials.ts').split('export interface ManagedJobCredential')[1].split('export function withdrawManagedJobDispatch')[0].replace(/^[\s\S]*?(?=function managedJobCredentialBinding)/,''))+');');
fixture=fixture.replace('raw.exec(readFileSync(new URL("./126_managed_job_execution.proposal.sql",import.meta.url),"utf8"));',`raw.exec(read('packages/ingenium-core/data/migrations/126_managed_job_execution.sql'));raw.exec(read('packages/ingenium-core/data/migrations/129_managed_candidate_purpose.sql'));`);
fixture=fixture.replace('const agent={mode:"primary",permissions:[]}', 'const agent={description:"In-memory purpose policy fixture",mode:"primary",system:"Public fixture only.",hidden:false,permissions:[{action:"*",resource:"*",effect:"deny"}]}');
fixture=fixture.replaceAll('import.meta.url',JSON.stringify(fixtureURL.href));
fixture+='\nconst purpose=await import('+JSON.stringify(purposeURL)+');\n';
const intentTests=readFileSync(resolve(integration,'tests/veyra-release-core126-candidate-intent.test.mjs'),'utf8');
const start=intentTests.indexOf('function fixture(){'),end=intentTests.indexOf('\ntest(',start);
if(start<0||end<start)throw Error('Frozen pure candidate fixture source changed');
fixture+='\nconst CANDIDATE_CASE_IDS='+JSON.stringify((await import(url('tools/veyra-release/core126-candidate-intent.mjs'))).CANDIDATE_CASE_IDS)+';const candidateNow=Date.now();\n'+intentTests.slice(start,end).replace('function fixture()','function candidateIntentFixture()').replaceAll('now','candidateNow');
fixture+='\nconst candidateHelpers=await import('+JSON.stringify(url('tools/veyra-release/core126-candidate-intent.mjs'))+');\n';
fixture+=String.raw`
test('SQL129 original production prepare/material uses original table, profile and one-use fence',async t=>{
 const f=fixture();t.after(f.close);const a=await f.prepare(),r=f.db.prepare('SELECT * FROM job_run_managed_execution').get();
 assert.equal(r.purpose,'production');assert.equal(r.candidate_intent_json,null);assert.equal(r.candidate_intent_hash,null);
 assert.deepEqual(f.owner.admissionPurpose(a.runId),{purpose:'production',candidateIntentHash:null});
 const persisted=JSON.parse(r.admission_json);assert.equal(persisted.purpose,undefined);delete persisted.specHash;assert.equal(r.spec_hash,digest(JSON.stringify(persisted)));
 const material=await f.owner.launchMaterial(a.runId,f.key(a),f.managerCtx);assert.equal(material.profileQualified,true);assert.equal(material.admission.effectFence,'material-admitted-v1');
 await assert.rejects(f.owner.launchMaterial(a.runId,f.key(a),f.managerCtx),/REVISION_CONFLICT|MATERIAL_UNAVAILABLE/);
 assert.equal(f.db.prepare('SELECT count(*) n FROM job_run_mcp_credentials').get().n,1);assert.equal(f.legacy()[0].encrypted_token,'legacy-encrypted-unchanged');
});
test('production original credential is purpose-bound and inspected without re-encryption or rotation',async t=>{
 const f=fixture();t.after(f.close);const m=await f.material(),row=f.db.prepare('SELECT * FROM job_run_mcp_credentials').get();
 const c=f.credential.inspectManagedJobCredential(m.capability,'job-run');assert.equal(c.purpose,'production');assert.equal(c.candidateIntentHash,null);assert.equal(row.purpose,'production');
 const bytes=row.encrypted_token;assert.deepEqual(f.credential.inspectManagedJobCredential(m.capability,'job-run'),c);assert.equal(f.db.prepare('SELECT encrypted_token FROM job_run_mcp_credentials').get().encrypted_token,bytes);
 assert.throws(()=>f.credential.issueManagedJobCredential({runId:m.runId,attemptId:m.attemptId}),/already issued/);
});
test('candidate preparation performs existing auth/source/quota reads then refuses with zero rows/credentials',async t=>{
 const f=fixture();t.after(f.close);const selection={runId:f.ids.runId,projectId:f.ids.projectId,runtimeId:f.ids.runtimeId,workspaceId:f.ids.workspaceId};
 await assert.rejects(f.owner.prepareCandidateInert(selection,f.ctx),/ORIGINAL_CANDIDATE_LEASE_UNAVAILABLE/);
 assert.equal(f.db.prepare('SELECT count(*) n FROM job_run_managed_execution').get().n,0);assert.equal(f.db.prepare('SELECT count(*) n FROM job_run_mcp_credentials').get().n,0);
 await assert.rejects(f.owner.prepareCandidateInert({...selection,purpose:'candidate-inert-v1'},f.ctx),/INVALID_SELECTION/);
 f.db.prepare("UPDATE automation_principal_grants SET status='revoked'").run();await assert.rejects(f.owner.prepareCandidateInert(selection,f.ctx),/AUTHORIZATION_UNAVAILABLE/);
});
test('original job/schedule/grant/member/parent facts still deny production before credential effects',async t=>{
 for(const sql of ["UPDATE jobs SET revision=revision+1","UPDATE jobs SET schedule_revision=schedule_revision+1","UPDATE automation_principal_grants SET revision=revision+1","UPDATE organization_memberships SET status='removed'","UPDATE runtime_instances SET state='STOPPED'"]){const f=fixture();try{f.raw.exec(sql);await assert.rejects(f.prepare(),/UNAVAILABLE|PRIVATE_DENIED/);assert.equal(f.db.prepare('SELECT count(*) n FROM job_run_mcp_credentials').get().n,0);}finally{f.close();}}
});
test('async profile qualification race preserves original transaction recheck',async t=>{
 const f=fixture();t.after(f.close);const qualify=f.profiles.qualify;f.profiles.qualify=async()=>{const result=await qualify();f.denyProfile();return result;};await assert.rejects(f.prepare(),/Unqualified image/);assert.equal(f.db.prepare('SELECT count(*) n FROM job_run_managed_execution').get().n,0);
});
test('material admission commits before asynchronous profile failure and cannot replay',async t=>{
 const f=fixture();t.after(f.close);const a=await f.prepare();f.profiles.qualify=async()=>{assert.equal(f.db.inTransaction,false);assert.equal(f.db.prepare('SELECT effect_fence FROM job_run_managed_execution').get().effect_fence,'material-admitted-v1');throw Error('Synthetic lost qualification acknowledgement');};
 await assert.rejects(f.owner.launchMaterial(a.runId,f.key(a),f.managerCtx),/lost qualification/);assert.equal(f.db.prepare('SELECT count(*) n FROM job_run_mcp_credentials').get().n,0);
 const latest=f.owner.admit(a.runId,'inspect',f.managerCtx);await assert.rejects(f.owner.launchMaterial(a.runId,f.key(latest),f.managerCtx),/MATERIAL_UNAVAILABLE/);
});
test('production discriminator refuses absent/unknown purpose and profile/candidate hybrids',()=>{
 const original={purpose:'production',profile_id:'actual-fixture-profile',profile_hash:h(4),candidate_intent_json:null,candidate_intent_hash:null};assert.equal(purpose.describeStoredManagedPurpose(original).purpose,'production');
 for(const change of [{purpose:undefined},{purpose:'unknown'},{profile_id:null},{profile_hash:null},{candidate_intent_hash:h(8)},{candidate_intent_json:'{}'}])assert.throws(()=>purpose.describeStoredManagedPurpose({...original,...change}),/PURPOSE_/);
});
test('forged candidate credential cannot enter assignment/bootstrap or normal HTTP/tool dispatch',async t=>{
 const f=fixture();t.after(f.close);const state=await f.running(),forged={...state.credential,purpose:'candidate-inert-v1',candidateIntentHash:h(8)};
 assert.throws(()=>f.owner.assignment(state.a.runId,forged),/CREDENTIAL_DENIED/);assert.throws(()=>f.owner.bootstrapAssignment(state.a.runId,forged),/CREDENTIAL_DENIED/);
 let effects=0;const handlers=createCore126Handlers({owner:f.owner,managerGuard:{context:()=>f.managerCtx},credentials:{inspectManagedJobCredential:()=>forged},authorizeTool:()=>{effects++;},dispatchExistingTool:()=>{effects++;}});
 for(const route of ['assignment','bootstrap-assignment','mcp/ingenium_project_detail','result'])await assert.rejects(handlers.runtime({path:'/runtime/job-runs/'+state.a.runId+'/'+route,method:'GET',headers:{authorization:'Bearer irrelevant','x-ingenium-audience':'job-run','x-ingenium-job-attempt':state.a.attemptId}}),/credential required/);
 assert.equal(effects,0);
 const tool=createCore126ToolAuthorizer({jobs:{isJobRunAuthorizationCurrent:()=>true},toolCatalog:{getTool:()=>{effects++;}},authorization:{},mcpAuthorizationPolicy:{}});assert.throws(()=>tool(forged,'ingenium_project_detail',{}),/tool denied/);assert.equal(effects,0);
});
test('persisted candidate DTO/hash is data only; owner material/create/bootstrap and credential issuance stay closed',async t=>{
 const f=fixture();t.after(f.close);await f.prepare();const r=f.db.prepare('SELECT * FROM job_run_managed_execution').get(),a=JSON.parse(r.admission_json),intent=candidateIntentFixture();
 Object.assign(intent.run,{runId:r.run_id,jobId:r.job_id,attemptId:r.attempt_id,runIdentityHash:r.run_identity_hash,jobRevision:r.job_revision,scheduleRevision:r.schedule_revision,promptHash:r.prompt_hash,agentHash:a.agentHash});
 Object.assign(intent.scope,{organizationId:r.organization_id,projectId:r.project_id,ownerUserId:r.owner_user_id,workspaceId:r.workspace_id,bindingHash:r.binding_hash,bindingEpoch:r.binding_epoch,principalId:f.ids.principal,principalSecurityEpoch:a.principalSecurityEpoch,grantRevision:r.grant_revision});
 Object.assign(intent.parent,{runtimeId:r.runtime_id,containerId:r.parent_container_id,daemonId:r.daemon_id,provisioningRevision:r.provisioning_revision});Object.assign(intent.resource,{admissionId:r.resource_admission_id,runtimeRevision:r.runtime_revision,limits:a.limits});intent.imageId=r.image_id;
 const hash=candidateHelpers.candidateInertIntentHash(intent);Object.assign(r,{purpose:'candidate-inert-v1',profile_id:null,profile_hash:null,candidate_intent_json:JSON.stringify(intent),candidate_intent_hash:hash,deadline_at:intent.expiresAt,admission_json:JSON.stringify({purpose:'candidate-inert-v1',candidateIntentHash:hash})});
 // Synthetic in-memory persisted row exercises REFUSAL, never an original lease constructor.
 f.db.prepare('DELETE FROM job_run_managed_execution').run();f.db.prepare('INSERT INTO job_run_managed_execution('+Object.keys(r).join(',')+') VALUES('+Object.keys(r).map(()=>'?').join(',')+')').run(...Object.values(r));
 assert.deepEqual(f.owner.admissionPurpose(r.run_id),{purpose:'candidate-inert-v1',candidateIntentHash:hash});
 for(const action of ['launch','inspect','cleanup'])assert.throws(()=>f.owner.admit(r.run_id,action,f.managerCtx),/ORIGINAL_CANDIDATE_LEASE_UNAVAILABLE/);
 await assert.rejects(f.owner.launchMaterial(r.run_id,f.key(a),f.managerCtx),/ORIGINAL_CANDIDATE_LEASE_UNAVAILABLE/);assert.throws(()=>f.owner.claimEffect(r.run_id,{...f.key(a),kind:'create'},f.managerCtx),/ORIGINAL_CANDIDATE_LEASE_UNAVAILABLE/);
 assert.throws(()=>f.credential.issueManagedJobCredential({runId:r.run_id,attemptId:r.attempt_id}),/binding unavailable/);assert.equal(f.db.prepare('SELECT count(*) n FROM job_run_mcp_credentials').get().n,0);assert.equal(f.db.prepare('SELECT revision FROM job_run_managed_execution').get().revision,r.revision);
 const mismatched={...r,candidate_intent_hash:h(9)};assert.throws(()=>purpose.describeStoredManagedPurpose(mismatched),/PURPOSE_BINDING/);
});
test('candidate persisted JSON rejects duplicate keys before a DTO can become a binding',()=>{
 const row={purpose:'candidate-inert-v1',profile_id:null,profile_hash:null,candidate_intent_hash:h(8),candidate_intent_json:'{"purpose":"production","purpose":"candidate-inert-v1"}'};assert.throws(()=>purpose.describeStoredManagedPurpose(row));
});
`;
await import(data(fixture));
