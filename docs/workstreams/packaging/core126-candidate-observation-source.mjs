// Proposed canonical target: packages/veyra-operations/core126-candidate-observation.mjs.
// Metadata observation only. No production qualification or child launch authority.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {SOURCE_INPUTS,IMAGE_INPUTS,PROTOCOL_CASES,UUID,hex,imageId,hash,freeze} from './core126-image-contract.mjs';
import {createCore126ManagerProofProducer} from './core126-manager-proof.mjs';
import {parseStrictJobJson} from '../../services/ingenium-api/lib/dot-v2/job-bootstrap-frame.mjs';
import {createOriginalDockerBinaryIo,createCore126DockerProbeOwner} from '../../tools/veyra-release/core126-docker-binary.mjs';
export const CANDIDATE_SELECTION_FILE='/run/ingenium-core126/candidate-source.json';
export const CANDIDATE_CATALOG='/usr/local/share/ingenium/opencode-managed/candidate-inert-catalog.json';
const digest=b=>createHash('sha256').update(b).digest('hex');
const deny=()=>{throw Object.assign(Error('Original unapproved candidate observation unavailable'),{code:'CORE126_CANDIDATE_OBSERVATION_UNAVAILABLE',status:503});};
const must=v=>{if(!v)deny();};
const keys=(v,names)=>must(v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join('|')===[...names].sort().join('|'));
const uuid=v=>typeof v==='string'&&UUID.test(v),integer=v=>Number.isSafeInteger(v)&&v>=0;
const text=v=>typeof v==='string'&&v.length>0&&v.length<=256&&v===v.trim()&&!/[\u0000-\u001f\u007f]/u.test(v);
export function assertCandidateSourceDefinition(v,now=Date.now()){
 keys(v,['schemaVersion','kind','imageId','config','source','files','rawSchemaSha256','probeSha256','catalogSha256','validUntil','selection','canary']);
 must(v.schemaVersion===1&&v.kind==='unapproved-candidate-source-v1'&&imageId(v.imageId)&&integer(v.validUntil)&&v.validUntil>now&&['rawSchemaSha256','probeSha256','catalogSha256'].every(k=>hex(v[k])));
 keys(v.source,['revision','sha256','files']);must(typeof v.source.revision==='string'&&/^[a-f0-9]{40}$/.test(v.source.revision)&&hex(v.source.sha256));
 for(const[rows,names]of[[v.source.files,SOURCE_INPUTS],[v.files,IMAGE_INPUTS]]){must(Array.isArray(rows)&&rows.length===names.length&&rows.every(r=>r&&typeof r==='object'&&!Array.isArray(r))&&new Set(rows.map(r=>r.path)).size===names.length);for(const name of names){const r=rows.find(r=>r.path===name);must(r&&hex(r.sha256)&&Number.isSafeInteger(r.bytes)&&r.bytes>0);}}
 for(const r of v.files){keys(r,['path','sha256','bytes','uid','gid','mode','kind']);must(r.uid===0&&r.gid===0&&r.kind==='file'&&integer(r.mode)&&!(r.mode&0o022));}
 for(const r of v.source.files)keys(r,['path','sha256','bytes']);
 keys(v.config,['User','WorkingDir','Entrypoint','Cmd']);must(v.config.User==='appuser'&&v.config.WorkingDir==='/app'&&JSON.stringify(v.config.Entrypoint)===JSON.stringify(['/app/scripts/runtime-entrypoint.sh'])&&(v.config.Cmd===null||Array.isArray(v.config.Cmd)&&v.config.Cmd.length===0));
 keys(v.selection,['runId','caseId','nonce']);must(uuid(v.selection.runId)&&uuid(v.selection.nonce)&&Object.hasOwn(PROTOCOL_CASES,v.selection.caseId));
 keys(v.canary,['organizationId','projectId','ownerUserId','workspaceId','principalId','jobId','agentHash','promptHash','projectName']);must(['organizationId','projectId','ownerUserId','principalId','jobId'].every(k=>uuid(v.canary[k]))&&text(v.canary.workspaceId)&&text(v.canary.projectName)&&hex(v.canary.agentHash)&&hex(v.canary.promptHash));
 must(v.files.some(r=>r.path===CANDIDATE_CATALOG&&r.sha256===v.catalogSha256));return v;
}
/** Fixed private Root-owned source selection; never a caller path/approval/result. */
function readCandidateSourceFile(now){
 must(process.platform==='linux');for(const p of ['/run','/run/ingenium-core126']){const s=fs.lstatSync(p);must(s.isDirectory()&&!s.isSymbolicLink()&&s.uid===0&&!(s.mode&0o022)&&fs.realpathSync(p)===p);}
 let fd;try{const named=fs.lstatSync(CANDIDATE_SELECTION_FILE);must(named.isFile()&&!named.isSymbolicLink()&&fs.realpathSync(CANDIDATE_SELECTION_FILE)===CANDIDATE_SELECTION_FILE);fd=fs.openSync(CANDIDATE_SELECTION_FILE,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);const first=fs.fstatSync(fd);must(first.isFile()&&first.uid===0&&first.nlink===1&&!(first.mode&0o022)&&first.size>1&&first.size<=65536&&named.dev===first.dev&&named.ino===first.ino);const bytes=fs.readFileSync(fd),last=fs.fstatSync(fd),current=fs.lstatSync(CANDIDATE_SELECTION_FILE);must(bytes.length===first.size&&!current.isSymbolicLink()&&fs.realpathSync(CANDIDATE_SELECTION_FILE)===CANDIDATE_SELECTION_FILE&&[last,current].every(s=>['dev','ino','size','mtimeMs','ctimeMs','uid','gid','mode','nlink'].every(k=>s[k]===first[k])));const definition=freeze(assertCandidateSourceDefinition(parseStrictJobJson(bytes,65536),now));return Object.freeze({definition,selectionSha256:digest(bytes)});}finally{if(fd!==undefined)fs.closeSync(fd);}
}
export function readInstalledCandidateSource(now=Date.now()){
 try{return readCandidateSourceFile(now);}catch(error){if(error?.code==='CORE126_CANDIDATE_OBSERVATION_UNAVAILABLE')throw error;throw Object.assign(new Error('Original unapproved candidate source unavailable',{cause:error}),{code:'CORE126_CANDIDATE_OBSERVATION_UNAVAILABLE',status:503});}
}
/** Function text is the exact fixed original-manager exec payload; no caller paths,
 * commands, URLs, expected hashes, model/task calls or new native server. */
async function readonlyProbe(paths,catalog){
 const fs=await import('node:fs'),{createHash}=await import('node:crypto'),sha=b=>createHash('sha256').update(b).digest('hex');
 const must=v=>{if(!v)throw Error('candidate-readonly-observation');};must(process.platform==='linux'&&process.getuid()===1000&&process.getgid()===1000);
 async function file(path){let fd;try{fd=fs.openSync(path,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);const a=fs.fstatSync(fd);must(a.isFile()&&a.nlink===1&&a.uid===0&&a.gid===0&&!(a.mode&0o022)&&a.size>0&&a.size<=256*1024*1024);const h=createHash('sha256'),buf=Buffer.alloc(65536);let n,count=0;while((n=fs.readSync(fd,buf,0,buf.length,null))){must(Date.now()<deadline);h.update(buf.subarray(0,n));count+=n;}const b=fs.fstatSync(fd),c=fs.lstatSync(path);must(!c.isSymbolicLink()&&fs.realpathSync(path)===path&&count===a.size&&[b,c].every(s=>['dev','ino','size','mtimeMs','ctimeMs','uid','gid','mode','nlink'].every(k=>s[k]===a[k])));return{path,sha256:h.digest('hex'),bytes:count,uid:a.uid,gid:a.gid,mode:a.mode&0o777,kind:'file'};}finally{if(fd!==undefined)fs.closeSync(fd);}}
 const deadline=Date.now()+3000;const files=[];for(const p of paths)files.push(await file(p));const catalogFile=files.find(r=>r.path===catalog);must(catalogFile);
 const secretPath='/run/ingenium-runtime/opencode-server-password';let fd,password;
 try{must(fs.realpathSync(secretPath)===secretPath);fd=fs.openSync(secretPath,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);const s=fs.fstatSync(fd);must(s.isFile()&&s.uid===1000&&s.nlink===1&&(s.mode&0o777)===0o600&&s.size>=16&&s.size<=256);password=fs.readFileSync(fd,'utf8').trim();must(password.length>=16&&!/[\r\n\u0000]/.test(password));}finally{if(fd!==undefined)fs.closeSync(fd);}
 const response=await fetch('http://127.0.0.1:4098/openapi.json',{redirect:'error',headers:{Authorization:'Basic '+Buffer.from('opencode:'+password).toString('base64'),Accept:'application/json'},signal:AbortSignal.timeout(Math.max(1,Math.min(1500,deadline-Date.now())))});must(response.status===200&&response.body);must(Date.now()<deadline);let size=0;const h=createHash('sha256');for await(const chunk of response.body){size+=chunk.length;must(Date.now()<deadline&&size<=512*1024);h.update(chunk);}must(size>0);
 const result={schemaVersion:1,kind:'actual-retained-parent-readonly-files-and-schema',files,rawSchemaSha256:h.digest('hex'),rawSchemaBytes:size,catalogSha256:catalogFile.sha256,probeSha256:sha(Buffer.from(process._eval))};process.stdout.write(JSON.stringify(result)+'\n');
}
export function originalCandidateReadonlyProbeSource(){return'await ('+readonlyProbe.toString()+')('+JSON.stringify(IMAGE_INPUTS)+','+JSON.stringify(CANDIDATE_CATALOG)+');';}
/** Call only INSIDE existing manager using its original request/socket/version.
 * originalProof is its existing real daemon/parent before/after producer, not DTO. */
export function createOriginalCandidateClosureProducer({docker,makeOriginalRequest,now=Date.now}){
 must(typeof docker==='function'&&typeof makeOriginalRequest==='function');
 const originalProof=createCore126ManagerProofProducer({docker,now}),source=Buffer.from(originalCandidateReadonlyProbeSource()),io=createOriginalDockerBinaryIo({makeOriginalRequest}),pending=new Map(),byContainer=new Map();
 const probe=createCore126DockerProbeOwner({io,probeSource:source,probeSha256:digest(source),retainOriginalExec:actual=>{const state=byContainer.get(actual.containerId);must(state&&state.execId===null&&actual.probeSha256===digest(source));state.execId=actual.execId;state.stage='original-exec-created';}});
 return Object.freeze({
  pendingObservations(){return freeze([...pending.entries()].map(([runtimeId,s])=>({runtimeId,...s})));},
  /** Read-only recovery proves STOPPED only; never manufactures missing output,
   * clears an unknown claim, reruns it or returns candidate observation authority. */
  async reconcileUnknown(runtimeId){const s=pending.get(runtimeId);must(s&&hex(s.execId));const p=await originalProof.observe(runtimeId);must(p.daemonId===s.daemonId&&p.parent.id===s.containerId&&p.parent.imageId===s.imageId&&p.parent.startIdentity===s.startIdentity);const r=await io.request('GET','/exec/'+s.execId+'/json');must(r.status===200);const value=parseStrictJobJson(r.bytes,65536);must((value.ID===s.execId||value.Id===s.execId)&&value.ContainerID===s.containerId&&value.Running===false&&Number.isInteger(value.ExitCode));s.stage='exec-stopped-observation-incomplete';s.inspectSha256=digest(r.bytes);return freeze({runtimeId,...s,exitCode:value.ExitCode});},
  async observe(runtimeId){
   must(uuid(runtimeId)&&!pending.has(runtimeId));const selected=readInstalledCandidateSource(now()),d=selected.definition;must(d.probeSha256===digest(source));const first=await originalProof.observe(runtimeId),deadline=first.observedAt+5000;must(first.parent.imageId===d.imageId&&first.parent.projectId===d.canary.projectId&&first.parent.organizationId===d.canary.organizationId&&first.parent.ownerUserId===d.canary.ownerUserId&&first.parent.workspaceId===d.canary.workspaceId);
   const remaining=deadline-now()-250;must(remaining>=1);const state={containerId:first.parent.id,imageId:first.parent.imageId,startIdentity:first.parent.startIdentity,daemonId:first.daemonId,execId:null,stage:'original-exec-create-intent',selectionSha256:selected.selectionSha256};pending.set(runtimeId,state);byContainer.set(first.parent.id,state);
   let execution;try{execution=await probe.exec(first.parent.id,{}, {timeoutMs:Math.min(3500,remaining),maxBytes:128*1024});}catch(error){state.stage='original-exec-outcome-unconfirmed';state.failureCode=error?.code??'CORE126_CANDIDATE_EXEC_UNKNOWN';throw error;}
   // Only the shared helper's actual EOF+stopped-exec inspect permits release.
   pending.delete(runtimeId);byContainer.delete(first.parent.id);
   must(execution.exitCode===0&&execution.stderr.length===0);const measured=parseStrictJobJson(execution.stdout,128*1024);assertCandidateMeasuredClosure(measured,d);
   const last=await originalProof.observe(runtimeId),current=readInstalledCandidateSource(now());must(now()<deadline&&current.selectionSha256===selected.selectionSha256&&hash(last.parent)===hash(first.parent)&&last.daemonId===first.daemonId&&hash(last.image)===hash(first.image));
   return freeze({schemaVersion:1,kind:'original-manager-unapproved-candidate-closure-v1',selectionSha256:selected.selectionSha256,proof:first,measurement:measured,exec:{id:execution.execId,exitCode:execution.exitCode,stdoutSha256:execution.stdoutSha256,inspectSha256:execution.rawInspectSha256},completedAt:now()});
  }
 });
}
export function assertCandidateMeasuredClosure(m,d){
 keys(m,['schemaVersion','kind','files','rawSchemaSha256','rawSchemaBytes','catalogSha256','probeSha256']);must(m.schemaVersion===1&&m.kind==='actual-retained-parent-readonly-files-and-schema'&&Number.isSafeInteger(m.rawSchemaBytes)&&m.rawSchemaBytes>0&&m.rawSchemaBytes<=512*1024&&m.rawSchemaSha256===d.rawSchemaSha256&&m.catalogSha256===d.catalogSha256&&m.probeSha256===d.probeSha256&&hash(m.files)===hash(d.files));return true;
}
