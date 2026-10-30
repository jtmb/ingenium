import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const own=n=>readFileSync(new URL(n,import.meta.url),'utf8');
const asData=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
// Execute both frozen fixture suites against the composed overlapping modules.
// Only source resolution is substituted; original frozen test files stay intact.
let finite=own('./candidate-response-program.test.mjs').replaceAll('import.meta.url',JSON.stringify(new URL('./candidate-response-program.test.mjs',import.meta.url).href));
const finiteNeedle="raw('candidate-loopback-program.proposal.mjs')";
assert.equal(finite.split(finiteNeedle).length-1,1);
finite=finite.replace(finiteNeedle,"raw('candidate-composed-loopback.proposal.mjs')");
await import(asData(finite));
let waiting=own('./candidate-original-manager.test.mjs').replaceAll('import.meta.url',JSON.stringify(new URL('./candidate-original-manager.test.mjs',import.meta.url).href));
const waitingNeedle="own('./candidate-loopback-readiness.proposal.mjs')";
assert.equal(waiting.split(waitingNeedle).length-1,1);
waiting=waiting.replace(waitingNeedle,"own('./candidate-composed-loopback.proposal.mjs')");
// The original listener-only test deliberately never configures a finite program.
// Supply a rejecting module for that uncalled import; real finite behavior is
// tested above through the actual composed loopback and real program source.
const linkNeedle='await m.link(name=>modules[name]);';assert.equal(waiting.split(linkNeedle).length-1,1);
waiting=waiting.replace(linkNeedle,"modules['./candidate-response-program.mjs']=synth('program-unconfigured',{createCandidateResponseProgram(){throw Error('Listener-only fixture never configures a program');}});"+linkNeedle);
waiting=waiting.replace("candidateDenied:()=>{throw Error('denied');},operationRoute(){},", "candidateDenied:()=>{throw Error('denied');},exact(){throw Error('Listener-only fixture never configures a program');},operationRoute(){},");
await import(asData(waiting));
test('composed artifacts preserve both frozen chains and both application orders byte-for-byte',()=>{const report=JSON.parse(execFileSync('python3',[new URL('./candidate-composed-freeze.py',import.meta.url).pathname,'--check-only'],{encoding:'utf8',env:{...process.env,NODE_COMPILE_CACHE:''}}));assert.equal(report.artifacts,11);assert.equal(report.emitted.js,5);assert.equal(report.emitted.types,5);assert.equal(report.emitted.failures,0);assert.equal(report.writes,0);assert.deepEqual(report.patches.map(p=>p.targets),[11,5,9]);assert.equal(report.patches[0].sha256,'e1baf7a784819e70b99be6b87906d7e220158e2a85f3543a8cae3c0498f912b0');});
test('actual current Core lifecycle denies reconstructed row/JSON/metadata in place of the ORIGINAL prepare lease',async()=>{const root=process.env.VEYRA_DOT_PROPOSAL_SOURCE_ROOT;const{pathToFileURL}=await import('node:url');const{createCandidateLifecycleExtension}=await import(pathToFileURL(root+'/services/ingenium-api/lib/dot-v2/candidate-lifecycle-owner.mjs'));const db={},leases=new WeakMap();let writes=0,reads=0;const owner=createCandidateLifecycleExtension({db,getDb:()=>db,write(){writes++;throw Error('must not write');},clock:()=>new Date(),readManagedRow(){reads++;throw Error('must not read');},baseCurrent(){throw Error('must not reach current');},originalRunIdentity(){throw Error('must not derive new identity');},jobs:{},candidateLeases:leases});for(const copied of [{},Object.freeze({}),{runId:'fake',intent:{purpose:'candidate-inert-v1'}},{purpose:'candidate-inert-v1',stage:'prepared-no-child-material'},JSON.stringify({runId:'fake'}),Promise.resolve({})])assert.throws(()=>owner.createIntent(copied,{manager:true},{signature:'copied'}),/ORIGINAL_LEASE_UNAVAILABLE/);assert.equal(reads,0);assert.equal(writes,0);});
