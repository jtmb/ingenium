import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {SourceTextModule,SyntheticModule} from 'node:vm';
import {spawnSync} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {managerChanges} from './manager-proposal.mjs';
const integration=process.env.LINUX_ADMISSION_INTEGRATION,root=process.env.LINUX_ADMISSION_TEST_ROOT;
assert.ok(integration?.startsWith('/')&&root?.startsWith('/'),'Explicit existing owned Linux roots required');
const {ManagedCpuProfile}=await import(pathToFileURL(path.join(integration,'services/ingenium-api/lib/voice-v2/managed-profile.mjs')));
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const canonical=v=>v&&typeof v==='object'?Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const changes=managerChanges(integration),removed=[];let sequence=0;
fs.mkdirSync(root,{recursive:true});assert.equal(fs.lstatSync(root).isSymbolicLink(),false);
async function fixture(action){
 const directory=path.join(root,'case-'+process.pid+'-'+(++sequence));assert.equal(fs.existsSync(directory),false);fs.mkdirSync(directory,{mode:0o700});
 const write=(relative,value)=>{const file=path.join(directory,relative);fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file,value,{mode:0o600});return file;};
 const codeNames=['managed_bootstrap.py','managed_entry.py','managed_pipe.py','managed_linux_tree.py','managed_api_tree.py','managed_recovery_witness.py','cpu_ownership.py','veyra_worker.py','cpu_models.py','inference_control.py','requirements-cpu.lock'];
 const bundle={};for(const name of codeNames){const code='# INERT FIXTURE ONLY: never executable\n';write('worker/'+name,code);bundle[name]=sha(code);}
 const python=write('python-inert','# Not an interpreter; tests never spawn it\n'),token=write('private/token','fixture-only-'+('x'.repeat(40)));
 const modelEntries=[{role:'transcription',file:'trans/model.bin'},{role:'kokoro-model',file:'kokoro/model.onnx'},{role:'kokoro-voices',file:'kokoro/voices.bin'}].map(entry=>{const value='inert-'+entry.role;write('models/'+entry.file,value);return {...entry,sha256:sha(value),bytes:Buffer.byteLength(value)};});
 const manifest={version:3,backend:'cpu-onnx',voice:'af_heart',license:'fixture',revision:'fixture',kokoro:{model:{file:modelEntries[1].file,sha256:modelEntries[1].sha256},voices:{file:modelEntries[2].file,sha256:modelEntries[2].sha256},revision:'fixture',license:'fixture',presets:[{id:'af_heart',label:'Fixture',language:'en-us'}]},transcription:{directory:'trans',files:[{file:modelEntries[0].file,sha256:modelEntries[0].sha256}],revision:'fixture',license:'fixture'}};
 const manifestText=JSON.stringify(manifest);write('models/manifest.json',manifestText);fs.mkdirSync(path.join(directory,'scratch'),{mode:0o700});
 const value={version:1,enableInference:true,python,pythonSha256:sha(fs.readFileSync(python)),workerRoot:path.join(directory,'worker'),bundle,pythonPaths:[path.join(directory,'worker')],settings:{version:1,backend:'cpu-onnx',instance_id:'fixture-instance',host:'127.0.0.1',port:9091,private_network:false,model_root:path.join(directory,'models'),model_manifest:'manifest.json',token_file:token,scratch_root:path.join(directory,'scratch'),cpu_threads:2},memoryBytes:536870912,defaultVoice:'af_heart',recoveryTransport:'abstract-unix'};
 const profilePath=write('private/profile.json',JSON.stringify(value)),profile=ManagedCpuProfile.load(profilePath);
 const now=Date.now(),components={modelsResidentBytes:1024,modelWarmupExtraBytes:1024,helperBytes:1024,witnessBytes:1024,probeBytes:65536,hotWorkspaceBytes:1024,coldTasks:8,hotAdditionalTasks:4,witnessTasks:2};
 const plan={version:1,profileDigest:profile.profileDigest,codeBundleDigest:sha(canonical(bundle)),helperSha256:sha(profile.helperSource),witnessSha256:sha(profile.witnessSource),modelManifestSha256:sha(manifestText),modelSetDigest:sha(canonical(modelEntries.map(({role,file,sha256})=>({role,file,sha256})).sort((a,b)=>a.file<b.file?-1:1))),assets:modelEntries,workerAddressSpaceBytes:value.memoryBytes,cpuThreads:2,components,stages:{cold:{additionalBytes:69632,additionalTasks:8,cpuMilli:2000},hot:{additionalBytes:67584,additionalTasks:4,cpuMilli:2000},witness:{additionalBytes:66560,additionalTasks:2,cpuMilli:1000}},qualifiedAt:now-1000,expiresAt:now+60000,retirementExpiresAt:now+120000,maxLifetimeMs:30000,maxWitnessLifetimeMs:20000,qualificationDigest:sha('SYNTHETIC FIXTURE qualification, not real RAM measurements')};
 const approvalPath=write('private/resource-plan.json',JSON.stringify(plan));
 write('kernel/proc/self/cgroup','0::/parent/leaf\n');write('kernel/proc/self/mountinfo','20 19 0:28 / /sys/fs/cgroup ro - cgroup2 cgroup rw\n');write('kernel/proc/meminfo','MemTotal: 4194304 kB\nMemAvailable: 2097152 kB\n');write('kernel/proc/sys/kernel/random/boot_id',crypto.randomUUID()+'\n');
 fs.symlinkSync('cgroup:[12345]',write('kernel/proc/self/ns-placeholder','').replace('ns-placeholder','namespace-link'));
 for(const node of ['','/parent','/parent/leaf'])for(const [file,contents]of Object.entries({'memory.max':node?'2147483648':'max','memory.current':'1024','pids.max':node?'100':'max','pids.current':'10','cpu.max':node?'200000 100000':'max 100000'}))write('kernel/sys/fs/cgroup'+node+'/'+file,contents+'\n');
 write('kernel/sys/fs/cgroup/parent/leaf/cpuset.cpus.effective','0-3\n');write('kernel/sys/fs/cgroup/parent/leaf/cpu.stat','usage_usec 123\n');
 const mapping=p=>p==='/proc/self/ns/cgroup'?path.join(directory,'kernel/proc/self/namespace-link'):typeof p==='string'&&(p.startsWith('/proc/')||p.startsWith('/sys/'))?path.join(directory,'kernel',p):p;
 const fakeFs={...fs,readFileSync:(p,...args)=>fs.readFileSync(mapping(p),...args),readlinkSync:(p,...args)=>fs.readlinkSync(mapping(p),...args),lstatSync:(p,...args)=>fs.lstatSync(mapping(p),...args),statfsSync:()=>({type:0x63677270n})};
 const state={spawnCalls:0,captured:null,onReserve:null,currentAllowed:true,controls:[],releaseChecks:0,spawnFixture:null};
 const synthetic=namespace=>new SyntheticModule(Object.keys(namespace),function(){for(const [key,value]of Object.entries(namespace))this.setExport(key,value);});
 const modules=new Map();
 const manager=new SourceTextModule(changes[0].after),probe=new SourceTextModule(fs.readFileSync(new URL('linux-resource-probe.mjs',import.meta.url),'utf8')),approval=new SourceTextModule(fs.readFileSync(new URL('resource-approval.mjs',import.meta.url),'utf8')),admission=new SourceTextModule(fs.readFileSync(new URL('linux-cpu-admission.mjs',import.meta.url),'utf8'));
 modules.set('./managed-supervisor.mjs',manager);modules.set('./linux-resource-probe.mjs',probe);modules.set('./resource-approval.mjs',approval);
 modules.set('./managed-profile.mjs',synthetic({ManagedCpuProfile}));modules.set('node:fs',synthetic(fakeFs));modules.set('node:path',synthetic(path));modules.set('node:crypto',synthetic(crypto));modules.set('node:child_process',synthetic({spawn:(...args)=>{state.spawnCalls++;if(state.spawnFixture)return state.spawnFixture(...args);throw new Error('FIXTURE_NO_PROCESS');}}));
 const linker=async specifier=>{
  if(modules.has(specifier))return modules.get(specifier);
  if(!['./cpu-ownership.mjs','./managed-channel.mjs','./core-cpu-owner.mjs','../../../../packages/veyra-voice/session.mjs'].includes(specifier))throw new Error('Unexpected test dependency '+specifier);
  const actual=await import(pathToFileURL(path.resolve(integration,'services/ingenium-api/lib/voice-v2',specifier)));const module=synthetic(actual);modules.set(specifier,module);return module;
 };
 const scope={actorId:'fixture-actor',accountId:'fixture-account',organizationId:'fixture-org',projectId:'fixture-project',conversationId:'fixture-conversation',runtimeId:'fixture-runtime',executionBindingId:'fixture-binding',executionRevision:'fixture-revision',agentId:'fixture-agent'};
 const context=Object.freeze({fixtureAuthenticatedRequest:true});let producer;
 const ledger={listControls:()=>state.controls,reserve:()=>{},settle:()=>{},privateRead:()=>{throw new Error('FIXTURE_NO_LIVE_CONTROL');},retireOriginal:()=>{},reserveControl:()=>{state.onReserve?.(state.captured,producer);throw new Error('FIXTURE_STOP_BEFORE_FORK');}};
 try{
  await admission.link(linker);await admission.evaluate();
  const create=()=>{producer=admission.namespace.createLinuxCpuSupervisor({profilePath,resourceApprovalPath:approvalPath,ledger,bindContext:(ctx,original,manager)=>{assert.equal(manager,producer);state.captured=original;return {ctx,original};},currentScope:bound=>({mode:'hosted',selectedConversationVerified:state.currentAllowed,scope:bound.original.scope,owner:bound.original.owner,deadlineAt:now+60000})});return producer;};
  await action({directory,write,profile,plan,approvalPath,profilePath,state,scope,context,create,probe:probe.namespace,approval:approval.namespace,admission:admission.namespace,ledger});
 }finally{
  const remove=directoryPath=>{assert.ok(path.resolve(directoryPath).startsWith(path.resolve(root)+'/'));for(const item of fs.readdirSync(directoryPath,{withFileTypes:true})){const full=path.join(directoryPath,item.name),facts=fs.lstatSync(full);if(facts.isDirectory()&&!facts.isSymbolicLink()){remove(full);continue;}assert.ok(facts.isFile()||facts.isSymbolicLink());if(facts.isFile()){assert.equal(facts.nlink,1);const active=spawnSync('/usr/bin/fuser',[full]);assert.equal(active.status,1);assert.equal(active.stdout.length+active.stderr.length,0);}fs.unlinkSync(full);removed.push({path:full,bytes:facts.size});}fs.rmdirSync(directoryPath);};remove(directory);
 }
}
test('concrete probe reads finite ancestor memory/pids/CPU and rejects missing/unbounded facts',()=>fixture(({probe,write})=>{
 const facts=probe.readLinuxCpuCapacity();assert.equal(facts.cpuMilli,2000);assert.equal(facts.pidsHeadroom,90);assert.equal(facts.chain.length,3);
 write('kernel/sys/fs/cgroup/parent/pids.max','max\n');write('kernel/sys/fs/cgroup/parent/leaf/pids.max','max\n');assert.throws(()=>probe.readLinuxCpuCapacity(),/FINITE_CGROUP/);
}));
test('ancestor pressure and CPU quota are checked before any helper fork',()=>fixture(async({write,create,scope,context,state})=>{
 write('kernel/sys/fs/cgroup/parent/memory.max','1024\n');const producer=create();await assert.rejects(producer.openScope({context,scope,sessionId:'fixture',deadlineAt:Date.now()+10000}),/CAPACITY_INSUFFICIENT/);assert.equal(state.spawnCalls,0);
}));
test('insufficient actual CPU quota or malformed cpuset cannot grant admission',()=>fixture(async({write,create,scope,context,state})=>{
 write('kernel/sys/fs/cgroup/parent/leaf/cpu.max','100000 100000\n');const producer=create();await assert.rejects(producer.openScope({context,scope,sessionId:'fixture',deadlineAt:Date.now()+10000}),/CAPACITY_INSUFFICIENT/);assert.equal(state.spawnCalls,0);
 write('kernel/sys/fs/cgroup/parent/leaf/cpuset.cpus.effective','unknown\n');await assert.rejects(producer.openScope({context,scope,sessionId:'fixture-2',deadlineAt:Date.now()+10000}),/CPUSET_INVALID/);
}));
test('missing or unqualified resource approval never defaults to allowed',()=>fixture(({create,approvalPath,plan})=>{
 fs.writeFileSync(approvalPath,JSON.stringify({...plan,qualificationDigest:'missing'}));assert.throws(create,/APPROVAL_MISMATCH/);
}));
test('expired approval and wrong exact profile/helper/thread envelope cannot grant inference',()=>fixture(async({create,approvalPath,plan,scope,context,state})=>{
 for(const change of [{profileDigest:sha('other profile')},{helperSha256:sha('other code')},{cpuThreads:3}]){fs.writeFileSync(approvalPath,JSON.stringify({...plan,...change}));assert.throws(create,/APPROVAL_MISMATCH/);}
 fs.writeFileSync(approvalPath,JSON.stringify({...plan,qualifiedAt:Date.now()-10000,expiresAt:Date.now()-1,retirementExpiresAt:Date.now()+50000}));const producer=create();await assert.rejects(producer.openScope({context,scope,sessionId:'fixture',deadlineAt:Date.now()+10000}),/APPROVAL_EXPIRED/);assert.equal(state.spawnCalls,0);
}));
test('approval custody is actual protected filesystem custody',()=>fixture(({create,approvalPath})=>{
 fs.chmodSync(approvalPath,0o644);assert.throws(create,/FILE_CUSTODY/);
}));
test('approved exact model set is hashed without execution and changed/undeclared files refuse',()=>fixture(async({write,create,scope,context,state})=>{
 write('models/trans/extra.bin','not declared');const producer=create();await assert.rejects(producer.openScope({context,scope,sessionId:'fixture',deadlineAt:Date.now()+10000}),/MODEL_SET_CHANGED/);assert.equal(state.spawnCalls,0);
}));
test('opaque admission binds only actual manager scope; JSON copies and release booleans cannot authorize',()=>fixture(async({create,scope,context,state})=>{
 const producer=create();state.onReserve=(original)=>{
  assert.throws(()=>producer.requireCpuAdmission({...original.admission},original),/ADMISSION_ORIGINAL_REQUIRED/);
  assert.throws(()=>producer.requireCpuAdmission(original.admission,{...original}),/ORIGINAL_SCOPE_REQUIRED/);
  assert.throws(()=>producer.releaseCpu(original.admission,{retired:true},producer),/RETIREMENT_PRODUCER_REQUIRED/);
 };
 await assert.rejects(producer.openScope({context,scope,sessionId:'fixture',deadlineAt:Date.now()+10000}),/STOP_BEFORE_FORK/);assert.equal(state.spawnCalls,0);
 // The actual producer's sealed before-fork path released the old token, so this independent attempt reaches the same gate.
 await assert.rejects(producer.openScope({context,scope,sessionId:'fixture-next',deadlineAt:Date.now()+10000}),/STOP_BEFORE_FORK/);
}));
test('requireCurrent revalidates actual selected context and changed original kernel identity before effects',()=>fixture(async({create,scope,context,state})=>{
 const producer=create();state.onReserve=original=>{state.currentAllowed=false;assert.throws(()=>producer.requireCpuAdmission(original.admission,original),/CORE_SCOPE_CHANGED/);};
 await assert.rejects(producer.openScope({context,scope,sessionId:'fixture',deadlineAt:Date.now()+10000}),/STOP_BEFORE_FORK/);assert.equal(state.spawnCalls,0);
}));
test('kernel directory replacement and model mutation close an existing admission instead of rebasing it',()=>fixture(async({create,scope,context,state,directory,write})=>{
 const producer=create();state.onReserve=original=>{
  const leaf=path.join(directory,'kernel/sys/fs/cgroup/parent/leaf'),previous=leaf+'-original';assert.ok(leaf.startsWith(directory+'/'));
  fs.renameSync(leaf,previous);fs.mkdirSync(leaf,{mode:0o700});for(const name of fs.readdirSync(previous))fs.copyFileSync(path.join(previous,name),path.join(leaf,name));
  assert.throws(()=>producer.requireCpuAdmission(original.admission,original),/CGROUP_ORIGINAL_CHANGED/);
  write('worker/managed_entry.py','# changed inert code fixture');assert.throws(()=>producer.requireCpuAdmission(original.admission,original),/ORIGINAL_CHANGED/);
  write('models/trans/model.bin','mutated model fixture');assert.throws(()=>producer.requireCpuAdmission(original.admission,original),/ORIGINAL_CHANGED/);
 };
 await assert.rejects(producer.openScope({context,scope,sessionId:'fixture',deadlineAt:Date.now()+10000}),/STOP_BEFORE_FORK/);assert.equal(state.spawnCalls,0);
}));
test('hot incremental and witness-only budgets do not re-add resident cold model memory',()=>fixture(({admission,plan})=>{
 const facts={memoryHeadroom:plan.stages.hot.additionalBytes,pidsHeadroom:4,cpuMilli:2000,cpus:2};assert.doesNotThrow(()=>admission.checkCpuResourceBudget(plan,facts,'hot'));assert.throws(()=>admission.checkCpuResourceBudget(plan,facts,'cold'),/CAPACITY_INSUFFICIENT/);
}));
test('actual recovery witness fork is gated before cold admission and no UI grant is used for cleanup',()=>fixture(async({create,scope,context,state,profile,write})=>{
 const owner={instanceId:profile.settings.instance_id,bootId:crypto.randomUUID(),ownerId:crypto.randomUUID(),ownerGeneration:1,leaseId:crypto.randomUUID()};
 state.controls=[{resourceRetired:false,owner,original:{operationId:crypto.randomUUID(),scope},control:{profileDigest:profile.profileDigest,workerBootId:crypto.randomUUID(),recoveryEndpointIdentity:'fixture-original-endpoint',retirementSecretSha256:sha('fixture-secret')}}];
 write('kernel/sys/fs/cgroup/parent/leaf/pids.max','10\n');const producer=create();state.currentAllowed=false;
 await assert.rejects(producer.openScope({context,scope,sessionId:'fixture',deadlineAt:Date.now()+10000}),/CAPACITY_INSUFFICIENT/);assert.equal(state.spawnCalls,0);
}));
test('model-free witness release comes from actual manager join/proof registry and never grants a new UI scope',()=>fixture(async({create,scope,context,state,profile})=>{
 const owner={instanceId:profile.settings.instance_id,bootId:crypto.randomUUID(),ownerId:crypto.randomUUID(),ownerGeneration:1,leaseId:crypto.randomUUID()};
 state.controls=[{resourceRetired:false,owner,original:{operationId:crypto.randomUUID(),scope},control:{profileDigest:profile.profileDigest,workerBootId:crypto.randomUUID(),recoveryEndpointIdentity:'fixture-original-endpoint',retirementSecretSha256:sha('fixture-secret')}}];
 state.spawnFixture=()=>{
  const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();let input='';child.stdin.on('data',chunk=>input+=chunk);
  child.stdin.on('finish',()=>{const request=JSON.parse(input);queueMicrotask(()=>{
   child.stdout.end(JSON.stringify({controlOperationId:request.controlOperationId,owner:request.owner,recoveryEndpointIdentity:request.recoveryEndpointIdentity,retirementSecretSha256:request.retirementSecretSha256,helperKernelExited:true,helperPipeEOF:true,treeEmpty:true,pipeEof:true,parentExited:true}));child.stderr.end();child.emit('exit',0,null);child.emit('close');
  });});return child;
 };
 const producer=create();state.currentAllowed=false;await assert.rejects(producer.openScope({context,scope,sessionId:'fixture',deadlineAt:Date.now()+10000}),/CORE_SCOPE_CHANGED/);
 assert.equal(state.spawnCalls,1); // One stream-only fixture witness; no OS process or model was created.
 assert.throws(()=>producer.inspectResourceRetirement({retired:true,treeEmpty:true}),/RETIREMENT_PRODUCER_REQUIRED/);
}));
test.after(()=>{if(fs.readdirSync(root).length===0)fs.rmdirSync(root);fs.writeFileSync(path.join(path.dirname(root),'linux-admission-cleanup.json'),JSON.stringify({removed,removedLogicalLinuxBytes:removed.reduce((n,x)=>n+x.bytes,0),retained:[],windowsRecoveryClaim:false,regeneration:'linux-admission.test.mjs with explicit same owned roots; no actual processes/models/kernel writes'},null,2)+'\n');});
