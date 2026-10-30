import {constants,openSync,closeSync,fstatSync,readSync,lstatSync,readdirSync} from 'node:fs';
import {resolve,dirname,parse,join,isAbsolute,sep} from 'node:path';
import {createHash} from 'node:crypto';
export const fail=code=>{throw Object.assign(new Error(code),{code});};
export const canonical=v=>v&&typeof v==='object'?Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
export const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const integer=n=>Number.isSafeInteger(n)&&n>=0;
const sha=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
function shape(v,keys){if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join()!==keys.sort().join())fail('CPU_RESOURCE_PLAN_INVALID');}
function custody(path,privateLeaf=false){
 if(!isAbsolute(path)||path.split(sep).some(p=>p==='..'||p==='.'))fail('CPU_RESOURCE_PATH_INVALID');
 let current=parse(path).root;for(const part of path.slice(current.length).split(sep).filter(Boolean)){
  current=join(current,part);const s=lstatSync(current);if(!s.isDirectory()||s.isSymbolicLink()||![0,process.getuid()].includes(s.uid)||s.mode&0o022)fail('CPU_RESOURCE_DIRECTORY_CUSTODY');
 }
 if(privateLeaf){const s=lstatSync(path);if(s.uid!==process.getuid()||s.mode&0o077)fail('CPU_RESOURCE_DIRECTORY_CUSTODY');}
}
const facts=s=>({device:String(s.dev),inode:String(s.ino),bytes:Number(s.size),mtime:String(s.mtimeNs),ctime:String(s.ctimeNs)});
function read(path,{privateFile=false,max=65536,expectedBytes,expectedSha,deadline=Infinity,signal,contents=false}={}){
 custody(dirname(path),privateFile);let fd;
 try{
  fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_CLOEXEC);const before=fstatSync(fd,{bigint:true});
  if(!before.isFile()||before.nlink!==1n||![0n,BigInt(process.getuid())].includes(before.uid)||Number(before.mode)&(privateFile?0o077:0o022)
   ||privateFile&&before.uid!==BigInt(process.getuid())||before.size<1n||before.size>BigInt(max)||expectedBytes!==undefined&&before.size!==BigInt(expectedBytes))fail('CPU_RESOURCE_FILE_CUSTODY');
  const digest=createHash('sha256'),buffer=Buffer.alloc(65536),chunks=[];let count=0;
  for(;;){signal?.throwIfAborted();if(Date.now()>=deadline)fail('CPU_RESOURCE_DEADLINE');const n=readSync(fd,buffer,0,buffer.length,null);if(!n)break;count+=n;if(count>max)fail('CPU_RESOURCE_FILE_LIMIT');digest.update(buffer.subarray(0,n));if(contents)chunks.push(Buffer.from(buffer.subarray(0,n)));}
  const after=fstatSync(fd,{bigint:true}),observed=hash(canonical(facts(before)));
  if(count!==Number(before.size)||canonical(facts(before))!==canonical(facts(after)))fail('CPU_RESOURCE_FILE_CHANGED');
  const sha256=digest.digest('hex');if(expectedSha&&sha256!==expectedSha)fail('CPU_RESOURCE_MODEL_HASH');
  return {path,identity:observed,facts:facts(before),sha256,...(contents?{bytes:Buffer.concat(chunks)}:{})};
 }finally{if(fd!==undefined)closeSync(fd);}
}
export function readResourceApproval(path,profile){
 const snapshot=read(path,{privateFile:true,max:65536,contents:true}),plan=JSON.parse(snapshot.bytes.toString('utf8'));
 shape(plan,['version','profileDigest','codeBundleDigest','helperSha256','witnessSha256','modelManifestSha256','modelSetDigest','assets','workerAddressSpaceBytes','cpuThreads','components','stages','qualifiedAt','expiresAt','retirementExpiresAt','maxLifetimeMs','maxWitnessLifetimeMs','qualificationDigest']);
 if(plan.version!==1||!['profileDigest','codeBundleDigest','helperSha256','witnessSha256','modelManifestSha256','modelSetDigest','qualificationDigest'].every(k=>sha(plan[k]))
  ||plan.profileDigest!==profile.profileDigest||plan.codeBundleDigest!==hash(canonical(profile.value.bundle))||plan.helperSha256!==hash(profile.helperSource)||plan.witnessSha256!==hash(profile.witnessSource)
  ||plan.workerAddressSpaceBytes!==profile.value.memoryBytes||plan.cpuThreads!==profile.settings.cpu_threads
  ||![plan.qualifiedAt,plan.expiresAt,plan.retirementExpiresAt,plan.maxLifetimeMs,plan.maxWitnessLifetimeMs].every(integer)
  ||plan.qualifiedAt>Date.now()||plan.expiresAt<=plan.qualifiedAt||plan.retirementExpiresAt<plan.expiresAt||plan.retirementExpiresAt>plan.expiresAt+60000
  ||plan.maxLifetimeMs<1||plan.maxLifetimeMs>1800000||plan.maxWitnessLifetimeMs<1||plan.maxWitnessLifetimeMs>60000)fail('CPU_RESOURCE_APPROVAL_MISMATCH');
 shape(plan.components,['modelsResidentBytes','modelWarmupExtraBytes','helperBytes','witnessBytes','probeBytes','hotWorkspaceBytes','coldTasks','hotAdditionalTasks','witnessTasks']);
 if(!Object.values(plan.components).every(n=>integer(n)&&n>0))fail('CPU_RESOURCE_PLAN_INVALID');
 shape(plan.stages,['cold','hot','witness']);for(const stage of Object.values(plan.stages)){shape(stage,['additionalBytes','additionalTasks','cpuMilli']);if(!Object.values(stage).every(n=>integer(n)&&n>0))fail('CPU_RESOURCE_PLAN_INVALID');}
 const c=plan.components;
 if(plan.stages.cold.additionalBytes!==c.modelsResidentBytes+c.modelWarmupExtraBytes+c.helperBytes+c.witnessBytes+c.probeBytes
  ||plan.stages.hot.additionalBytes!==c.hotWorkspaceBytes+c.witnessBytes+c.probeBytes||plan.stages.witness.additionalBytes!==c.witnessBytes+c.probeBytes
  ||plan.stages.cold.additionalTasks!==c.coldTasks||plan.stages.hot.additionalTasks!==c.hotAdditionalTasks||plan.stages.witness.additionalTasks!==c.witnessTasks)fail('CPU_RESOURCE_PEAK_COMPONENTS_INVALID');
 if(!Array.isArray(plan.assets)||plan.assets.length<3||plan.assets.length>128)fail('CPU_RESOURCE_MODEL_SET_INVALID');
 const paths=new Set();for(const asset of plan.assets){shape(asset,['role','file','sha256','bytes']);if(!['transcription','kokoro-model','kokoro-voices'].includes(asset.role)||typeof asset.file!=='string'||!asset.file||isAbsolute(asset.file)||asset.file.split('/').some(p=>['','..','.'].includes(p))||asset.file.includes('\\')||paths.has(asset.file)||!sha(asset.sha256)||!integer(asset.bytes)||asset.bytes<1||asset.bytes>68719476736)fail('CPU_RESOURCE_MODEL_SET_INVALID');paths.add(asset.file);}
 if(hash(canonical(plan.assets.map(({role,file,sha256})=>({role,file,sha256})).sort((a,b)=>a.file<b.file?-1:a.file>b.file?1:0)))!==plan.modelSetDigest)fail('CPU_RESOURCE_MODEL_SET_INVALID');
 const codeSnapshots=[read(profile.value.python,{max:67108864,expectedSha:profile.value.pythonSha256}),
  ...Object.entries(profile.value.bundle).map(([name,expectedSha])=>read(join(profile.value.workerRoot,name),{max:1048576,expectedSha}))];
 return {plan,snapshot,codeSnapshots};
}
export function assertSnapshot(snapshot){
 custody(dirname(snapshot.path));let fd;try{fd=openSync(snapshot.path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_CLOEXEC);const s=fstatSync(fd,{bigint:true});if(!s.isFile()||s.nlink!==1n||Number(s.mode)&0o022||hash(canonical(facts(s)))!==snapshot.identity)fail('CPU_RESOURCE_ORIGINAL_CHANGED');}finally{if(fd!==undefined)closeSync(fd);}
}
export function verifyModelSet(profile,plan,deadline,signal){
 const modelRoot=profile.settings.model_root,name=profile.settings.model_manifest;
 if(typeof name!=='string'||isAbsolute(name)||name.split('/').some(p=>['','..','.'].includes(p))||name.includes('\\'))fail('CPU_RESOURCE_MANIFEST_PATH_INVALID');
 custody(modelRoot);const manifest=read(resolve(modelRoot,name),{max:65536,expectedSha:plan.modelManifestSha256,deadline,signal,contents:true}),value=JSON.parse(manifest.bytes.toString('utf8'));
 if(value.version!==3||value.backend!=='cpu-onnx'||!Array.isArray(value.transcription?.files)||!value.kokoro?.model||!value.kokoro?.voices)fail('CPU_RESOURCE_MANIFEST_INVALID');
 const declared=[...value.transcription.files.map(file=>({role:'transcription',...file})),{role:'kokoro-model',...value.kokoro.model},{role:'kokoro-voices',...value.kokoro.voices}];
 if(canonical(declared.sort((a,b)=>a.file<b.file?-1:a.file>b.file?1:0))!==canonical(plan.assets.map(({role,file,sha256})=>({role,file,sha256})).sort((a,b)=>a.file<b.file?-1:a.file>b.file?1:0)))fail('CPU_RESOURCE_MODEL_SET_CHANGED');
 const snapshots=[manifest,...plan.assets.map(asset=>read(resolve(modelRoot,asset.file),{max:asset.bytes,expectedBytes:asset.bytes,expectedSha:asset.sha256,deadline,signal}))];
 const directory=value.transcription.directory;if(typeof directory!=='string'||isAbsolute(directory)||directory.split('/').some(p=>['','..','.'].includes(p)))fail('CPU_RESOURCE_MODEL_SET_INVALID');
 const actual=[];const walk=(dir,depth)=>{if(depth>8||actual.length>256)fail('CPU_RESOURCE_MODEL_SET_LIMIT');for(const item of readdirSync(dir,{withFileTypes:true})){const file=join(dir,item.name);if(item.isSymbolicLink())fail('CPU_RESOURCE_MODEL_CUSTODY');if(item.isDirectory())walk(file,depth+1);else if(item.isFile())actual.push(file);else fail('CPU_RESOURCE_MODEL_CUSTODY');}};
 walk(resolve(modelRoot,directory),0);const expected=plan.assets.filter(a=>a.role==='transcription').map(a=>resolve(modelRoot,a.file));if(canonical(actual.sort())!==canonical(expected.sort()))fail('CPU_RESOURCE_MODEL_SET_CHANGED');
 return snapshots;
}
