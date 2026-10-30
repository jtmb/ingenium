import {createHash} from 'node:crypto';
import * as code from './core126-candidate-construction-code.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const once=(s,a,b)=>{if(s.split(a).length!==2)throw Error('Changed/ambiguous candidate construction anchor '+a.slice(0,90));return s.replace(a,b);};
export function proposeCandidateConstruction(originals,observerBytes,catalogBytes){
 const files=[];
 const edit=(path,fn)=>{const before=originals.get(path);if(!Buffer.isBuffer(before))throw Error('Missing exact source '+path);const text=new TextDecoder('utf-8',{fatal:true}).decode(before),nl=text.includes('\r\n')?'\r\n':'\n';const after=Buffer.from(fn(text,(s,a,b)=>once(s,a.replaceAll('\r\n','\n').replaceAll('\n',nl),b.replaceAll('\r\n','\n').replaceAll('\n',nl))));files.push({path,before,after,beforeSha256:sha(before),afterSha256:sha(after)});};
 edit('packages/veyra-operations/core126-image-owner.mjs',(s,r)=>{
  s=code.imageOwnerImport+s;s=r(s,'const clients=new WeakMap(),','const candidateImageOwners=new WeakMap();\nconst clients=new WeakMap(),');
  s=r(s,"const owner={async acquire(runtimeId){","const owner={"+code.candidateClientMethod+"\n async acquire(runtimeId){");
  s=r(s,' const local=new AsyncLocalStorage();',' const local=new AsyncLocalStorage();'+code.imageOwnerCandidateSetup);
  const at=s.indexOf('export function createCore126ImageOwner('),end=s.indexOf('/** Manager calls after',at);if(at<0||end<0)throw Error('owner boundaries');let section=s.slice(at,end);section=r(section,' return Object.freeze({\n  async withFreshOriginalJobRole',' const owner=Object.freeze({\n  async withFreshOriginalJobRole');section=r(section,' });\n}',' });\n candidateImageOwners.set(owner,candidateState);return owner;\n}');s=s.slice(0,at)+section+s.slice(end);return s+code.imageOwnerCandidateExports;
 });
 edit('services/ingenium-api/lib/dot-v2/core126-owner.mjs',(s,r)=>{
  s="import {withOriginalCandidateSourceObservation,spendOriginalCandidateSourceObservation} from '../../../../packages/veyra-operations/core126-image-owner.mjs';\nimport {candidateInertIntentHash} from '../../../../tools/veyra-release/core126-candidate-intent.mjs';\n"+s;
  s=r(s,' const same=()=>',' const candidateLeases=new WeakMap();\n const same=()=>');
  const start=s.indexOf('  async prepareCandidateInert('),end=s.indexOf('  factsForImagePreparation(',start);if(start<0||end<0)throw Error('candidate prepare boundary');return s.slice(0,start)+code.coreCandidatePrepare+'\n'+s.slice(end);
 });
 edit('services/ingenium-api/lib/runtime-manager-client.ts',(s,r)=>s+`\n/** Same original private manager/token; no caller-selected closure paths. */
export async function inspectManagedRuntimeCandidateClosure(runtimeId:string):Promise<unknown>{
 if(!UUID.test(runtimeId))throw Error('Original candidate runtime identity');const result=await requestManager('/v1/runtimes/'+runtimeId+'/candidate-closure');
 if(!('candidateClosure' in result)||!result.candidateClosure||typeof result.candidateClosure!=='object')throw Error('Original candidate closure unavailable');
 const value=result.candidateClosure as {proof?:{parent?:{runtimeId?:string;id?:string;name?:string}}};
 if(value.proof?.parent?.runtimeId!==runtimeId||value.proof.parent.id!==result.backendId||value.proof.parent.name!==result.backendName)throw Error('Original candidate parent changed');return value;
}\n`);
 edit('services/ingenium-api/scripts/runtime-manager.ts',(s,r)=>{
  s="import {createOriginalCandidateClosureProducer} from '../../../packages/veyra-operations/core126-candidate-observation.mjs';\n"+s;
  s=r(s,'  const originalJobRoleProof=createCore126ManagerProofProducer({docker:dockerRequest});',`  const originalJobRoleProof=createCore126ManagerProofProducer({docker:dockerRequest});
  const originalCandidateClosure=createOriginalCandidateClosureProducer({docker:dockerRequest,makeOriginalRequest:(options,callback)=>httpRequest({...options,socketPath:DOCKER_SOCKET,path:'/v1.45'+options.path},callback)});`);
  const marker='      const jobRole=/^';const index=s.indexOf(marker);if(index<0)throw Error('original manager route anchor');const route=`      const candidateRole=/^\\/v1\\/runtimes\\/([a-f0-9-]+)\\/candidate-closure$/.exec(url.pathname);
      if(request.method==='GET'&&candidateRole&&UUID.test(candidateRole[1]!)&&url.search===''&&request.headers.cookie===undefined&&request.headers.origin===undefined){
        const closure=await originalCandidateClosure.observe(candidateRole[1]!),current=await inspectRuntime(candidateRole[1]!);
        if(!current||jobParentHash(publicJobParent(current))!==jobParentHash(closure.proof.parent)||Date.now()>=closure.proof.expiresAt)throw Error('Original candidate parent changed before publication');
        response.writeHead(200).end(JSON.stringify({data:{...publicInspect(current),candidateClosure:closure}}));return;
      }
`;return s.slice(0,index)+route+s.slice(index);
 });
 edit('services/ingenium-api/lib/dot-v2/core126-installed-image-owner.ts',(s,r)=>{
  s="import {readInstalledCandidateSource} from '../../../../packages/veyra-operations/core126-candidate-observation.mjs';\n"+s;
  s=r(s,'import {inspectManagedRuntimeJobRole}', 'import {inspectManagedRuntimeCandidateClosure,inspectManagedRuntimeJobRole}');return s+code.installedCandidateLoader;
 });
 edit('services/ingenium-api/lib/dot-v2/core126-actual-factory.ts',(s,r)=>{
  s=r(s,'originalDotContextAuthority,withPersistedApprovedDotOperation','requireOriginalCandidateCoordinatorContext,originalDotContextAuthority,withPersistedApprovedDotOperation');
  s=r(s,'createCore126Owner({approvedDot:','createCore126Owner({imageOwner,originalCandidate:{require:requireOriginalCandidateCoordinatorContext},approvedDot:');return s;
 });
 edit('services/ingenium-api/lib/dot-v2/managed-job-contracts.d.mts',(s,r)=>{
  s="import type {Core126ImageOwner} from '../../../../packages/veyra-operations/core126-image-owner.mjs';\n"+s;s=r(s,'export interface Core126OwnerPorts {',`export interface Core126OwnerPorts {
 imageOwner?:Core126ImageOwner;
 originalCandidate?:{require(context:CoreActorContext,selection:Core126Selection):void};`);
  s=r(s,'prepareCandidateInert(selection:Core126Selection,context:CoreActorContext):Promise<never>;','prepareCandidateInert(selection:Core126Selection,context:CoreActorContext):Promise<OriginalCandidateLease>;\n describeCandidateLease(lease:OriginalCandidateLease):Readonly<{purpose:"candidate-inert-v1";candidateIntentHash:string;runId:string;attemptId:string;stage:"prepared-no-child-material"}>;\n candidateLaunchMaterial():never;');return s;
 });
 edit('packages/veyra-operations/core126-image-owner.d.mts',(s,r)=>{
  s=r(s,'acquire(runtimeId:string):Promise<Core126Observation>}','acquire(runtimeId:string):Promise<Core126Observation>;acquireCandidate(runtimeId:string):Promise<Core126Observation>}');return s+`\nexport function withOriginalCandidateSourceObservation<T>(owner:Core126ImageOwner,facts:Core126Facts,work:()=>T|Promise<T>):Promise<T>;
export function spendOriginalCandidateSourceObservation(owner:Core126ImageOwner,facts:Core126Facts,attemptId:string,runIdentityHash:string):Readonly<{intent:import('../../tools/veyra-release/core126-candidate-intent.mjs').CandidateInertIntent;selectionSha256:string}>;\n`;
 });
 edit('tools/veyra-release/core126-docker-binary.mjs',(s,r)=>{
  s=r(s,'createCore126DockerProbeOwner({io,probeSource,probeSha256})','createCore126DockerProbeOwner({io,probeSource,probeSha256,retainOriginalExec})');
  s=r(s," const text=new TextDecoder('utf-8'", " if(retainOriginalExec!==undefined&&typeof retainOriginalExec!=='function')throw failure('CORE126_ORIGINAL_EXEC_RETENTION');\n const text=new TextDecoder('utf-8'");
  return r(s,"const exec=json(create,201);if(!id(exec.Id))throw failure('CORE126_EXEC_ID');","const exec=json(create,201);if(!id(exec.Id))throw failure('CORE126_EXEC_ID');\n   retainOriginalExec?.(Object.freeze({containerId,execId:exec.Id,probeSha256}));");
 });
 edit('tools/veyra-release/core126-docker-binary.d.mts',(s,r)=>r(s,'probeSource:Buffer;probeSha256:string}','probeSource:Buffer;probeSha256:string;retainOriginalExec?:(actual:Readonly<{containerId:string;execId:string;probeSha256:string}>)=>void}'));
 edit('services/ingenium-api/scripts/copy-domain-runtime.mjs',(s,r)=>r(s,"target: 'veyra-tools/veyra-release/core126-candidate-intent.mjs' }];","target: 'veyra-tools/veyra-release/core126-candidate-intent.mjs' }, { source: 'tools/veyra-release/core126-docker-binary.mjs', target: 'veyra-tools/veyra-release/core126-docker-binary.mjs' }];"));
 edit('packages/veyra-operations/core126-image-contract.mjs',(s,r)=>{
  const src=['packages/veyra-operations/core126-candidate-observation.mjs','packages/veyra-operations/core126-image-owner.mjs','tools/veyra-release/core126-docker-binary.mjs','config/opencode-managed/candidate-inert-catalog.json','services/ingenium-api/lib/dot-v2/core126-installed-image-owner.ts'];
  const image=['/usr/local/share/ingenium/opencode-managed/candidate-inert-catalog.json','/app/services/ingenium-api/dist/veyra-packages/veyra-operations/core126-candidate-observation.mjs','/app/services/ingenium-api/dist/veyra-packages/veyra-operations/core126-image-owner.mjs','/app/services/ingenium-api/dist/veyra-tools/veyra-release/core126-docker-binary.mjs'];
  s=r(s,"'tools/veyra-release/core126-candidate-intent.mjs']);","'tools/veyra-release/core126-candidate-intent.mjs',"+src.map(v=>JSON.stringify(v)).join(',')+"]);");return r(s,"'/app/services/ingenium-api/dist/veyra-tools/veyra-release/core126-candidate-intent.mjs']);","'/app/services/ingenium-api/dist/veyra-tools/veyra-release/core126-candidate-intent.mjs',"+image.map(v=>JSON.stringify(v)).join(',')+"]);");
 });
 edit('Dockerfile',(s,r)=>r(s,'    install -o root -g root -m 0444 /app/config/opencode-managed/job-opencode.json /usr/local/share/ingenium/opencode-managed/job-opencode.json && \\', '    install -o root -g root -m 0444 /app/config/opencode-managed/job-opencode.json /usr/local/share/ingenium/opencode-managed/job-opencode.json && \\\n    install -o root -g root -m 0444 /app/config/opencode-managed/candidate-inert-catalog.json /usr/local/share/ingenium/opencode-managed/candidate-inert-catalog.json && \\'));
 for(const[path,after]of[['packages/veyra-operations/core126-candidate-observation.mjs',observerBytes],['config/opencode-managed/candidate-inert-catalog.json',catalogBytes]]){if(originals.has(path))throw Error('Protected new target already exists');files.push({path,before:Buffer.alloc(0),after,beforeSha256:null,afterSha256:sha(after)});}
 const declaration=`import type {Core126ManagerProof} from './core126-image-owner.mjs';
export const CANDIDATE_SELECTION_FILE:'/run/ingenium-core126/candidate-source.json';
export const CANDIDATE_CATALOG:'/usr/local/share/ingenium/opencode-managed/candidate-inert-catalog.json';
export function assertCandidateSourceDefinition(value:unknown,now?:number):any;
export function readInstalledCandidateSource(now?:number):Readonly<{definition:any;selectionSha256:string}>;
export function originalCandidateReadonlyProbeSource():string;
export function assertCandidateMeasuredClosure(measurement:unknown,definition:any):true;
export function createOriginalCandidateClosureProducer(ports:{docker:(method:string,path:string)=>Promise<any>;makeOriginalRequest:(options:any,callback:any)=>any;now?:()=>number}):Readonly<{pendingObservations():readonly Record<string,unknown>[];reconcileUnknown(runtimeId:string):Promise<Readonly<Record<string,unknown>>>;observe(runtimeId:string):Promise<{schemaVersion:1;kind:'original-manager-unapproved-candidate-closure-v1';selectionSha256:string;proof:Core126ManagerProof;measurement:any;exec:any;completedAt:number}>}>;
`;
 files.push({path:'packages/veyra-operations/core126-candidate-observation.d.mts',before:Buffer.alloc(0),after:Buffer.from(declaration),beforeSha256:null,afterSha256:sha(declaration)});
 return files;
}
