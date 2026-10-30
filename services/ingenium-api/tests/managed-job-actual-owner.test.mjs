import{readFileSync}from'node:fs';
const fixtureURL=new URL('../../../docs/workstreams/dot/core126-sqlite.cpu.mjs',import.meta.url);
let source=readFileSync(fixtureURL,'utf8');
for(const [before,after] of [
 ['from "./managed-job-owner.proposal.mjs"',new URL('../lib/dot-v2/managed-job-owner.mjs',import.meta.url).href],
 ['from "./core126-owner.proposal.mjs"',new URL('../lib/dot-v2/core126-owner.mjs',import.meta.url).href],
 ['from "./core126-http.proposal.mjs"',new URL('../lib/dot-v2/core126-http.mjs',import.meta.url).href],
]) { if(!source.includes(before))throw Error('Canonical fixture import changed');source=source.replace(before,'from '+JSON.stringify(after)); }
// Load actual126/129 DDL and actual Core credential owner, preserving explicit fixture-only crypto/authority ports.
const oldDdl='raw.exec(readFileSync(new URL("./126_managed_job_execution.proposal.sql",import.meta.url),"utf8"));';
const oldCredentials='const extension=strip(readFileSync(new URL("./core126-credentials.proposal.ts",import.meta.url),"utf8"));';
if(!source.includes(oldDdl)||!source.includes(oldCredentials))throw Error('Original Core fixture source changed');
source=source.replace(oldDdl,'raw.exec(read("packages/ingenium-core/data/migrations/126_managed_job_execution.sql"));raw.exec(read("packages/ingenium-core/data/migrations/129_managed_candidate_purpose.sql"));').replace(oldCredentials,'const extension=strip(slice(actualCredentials,"export interface ManagedJobCredential {","/** Narrow self-withdrawal"));');
// The installed material producer consumes the existing Core five-field projection.
// Preserve named workspace IDs; only the obsolete fixture agent shape is updated.
const oldAgent='const agent={mode:"primary",permissions:[]}';
if(!source.includes(oldAgent))throw Error('Canonical fixture agent changed');
source=source.replace(oldAgent,'const agent={description:"Actual installed-source fixture",mode:"primary",system:"Fixture only.",hidden:false,permissions:[{action:"*",resource:"*",effect:"deny"}]}');
source=source.replaceAll('import.meta.url',JSON.stringify(fixtureURL.href));
source+=String.raw`
test("actual initial Core write rechecks image/profile after asynchronous qualification",async t=>{const f=fixture();t.after(f.close);const qualify=f.profiles.qualify.bind(f.profiles);f.profiles.qualify=async(...args)=>{const result=await qualify(...args);f.denyProfile();return result;};await assert.rejects(f.prepare(),/Unqualified image/);assert.equal(f.db.prepare("SELECT count(*) n FROM job_run_managed_execution").get().n,0);assert.equal(f.jobs.getJobRun(f.ids.projectId,f.ids.runId).status,"running");});
test("actual initial image/profile assertion is synchronous inside the original transaction",async t=>{const f=fixture();t.after(f.close);let calls=0;f.profiles.assertCurrent=()=>{calls++;assert.equal(f.db.inTransaction,true);};await f.prepare();assert.equal(calls,1);});
`;
source+='\n//# sourceURL=actual-managed-job-owner-fixture.mjs';
await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
