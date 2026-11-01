import {expect,it,vi} from 'vitest';
vi.mock('ingenium-core',()=>({getDb:()=>{throw Error('No database authority in this pure qualifier test')},runtimes:{}}));
vi.mock('../lib/request-identity.js',()=>({revalidateRequestIdentity:()=>null}));
vi.mock('../lib/runtime-mode.js',()=>({deploymentMode:()=> 'control-plane'}));
vi.mock('../lib/dot-v2/core126-installed-image-owner.js',()=>({loadInstalledWorkspaceRuntimeV2ImageDefinition:()=>{throw Error('No installed image authority in fixture')}}));
vi.mock('../lib/runtime-manager-client.js',()=>({inspectOriginalWorkspaceRuntimeV2:()=>{throw Error('No physical runtime in fixture')}}));
import {provisionHash} from 'ingenium-core/lib/tools/runtime-original-provision';
import {qualifyWorkspaceV2Placement} from '../lib/projects-v2/workspace-v2-placement.mjs';
const installation='a'.repeat(32);
function facts(image='sha256:'+'b'.repeat(64)){
 const now=Date.now(),w={id:'workspace',organizationId:'org',ownerUserId:'owner',projectId:null,storageMappingHash:'c'.repeat(64),securityEpoch:1};
 const r={id:'runtime',projectId:null,organizationId:'org',ownerUserId:'owner',workspaceId:w.id,securityEpoch:1,backendContainerId:'d'.repeat(64),absoluteExpiresAt:new Date(now+60000).toISOString(),idleExpiresAt:new Date(now+60000).toISOString(),leaseExpiresAt:null};
 const d={schemaVersion:2,imageId:image,validUntil:now+60000,files:[{path:'/opt/veyra/owned.mjs',sha256:'e'.repeat(64),bytes:12}]};
 const o={schemaVersion:2,projectId:null,imageId:image,daemonId:'daemon',hostId:'physical-host',parentContainerId:r.backendContainerId,startIdentity:'f'.repeat(64),publicProfileSha256:'1'.repeat(64),provisioningRevision:2,bindingHash:w.storageMappingHash,bindingEpoch:1};
 const proof={schemaVersion:2,kind:'original-workspace-runtime-v2-placement',observedAt:now,expiresAt:now+5000,definitionSha256:provisionHash(d),imageId:image,daemonId:o.daemonId,hostId:o.hostId,runtimeId:r.id,parentContainerId:r.backendContainerId,startIdentity:o.startIdentity,publicProfileSha256:o.publicProfileSha256,provisioningRevision:2,organizationId:'org',ownerUserId:'owner',workspaceId:w.id,projectId:null,bindingHash:w.storageMappingHash,bindingEpoch:1,health:'healthy',state:'running',artifacts:structuredClone(d.files)};
 return {r,w,o,d,proof};
}
const qualify=(f:ReturnType<typeof facts>,id=installation)=>qualifyWorkspaceV2Placement(f.r,f.w,f.o,f.d,f.proof,id);
it('verified image upgrades retain the same installation environment identity',()=>{
 const first=qualify(facts()),next=qualify(facts('sha256:'+'2'.repeat(64)));expect(first.environmentId).toBe('managed-workspace-runtime-v2:'+installation);expect(next.environmentId).toBe(first.environmentId);expect(next.projectId).toBeNull();expect(next.hostId).toBe('physical-host');
});
it('separate installations do not share an environment identity',()=>expect(qualify(facts(),'3'.repeat(32)).environmentId).not.toBe(qualify(facts()).environmentId));
for(const id of ['', 'a'.repeat(31),'A'.repeat(32),'a'.repeat(64),null,undefined])it('missing or invalid installation identity is unavailable: '+String(id),()=>{
 const f=facts();expect(()=>qualifyWorkspaceV2Placement(f.r,f.w,f.o,f.d,f.proof,id as never)).toThrow('WORKSPACE_V2_ORIGINAL_PLACEMENT_UNAVAILABLE');
});
for(const [name,change] of [
 ['unapproved image',(f:any)=>{f.proof.imageId='sha256:'+'4'.repeat(64)}],
 ['definition content',(f:any)=>{f.d.files[0].bytes++}],
 ['artifact hash',(f:any)=>{f.proof.artifacts[0].sha256='5'.repeat(64)}],
 ['container',(f:any)=>{f.proof.parentContainerId='6'.repeat(64)}],
 ['original start',(f:any)=>{f.proof.startIdentity='7'.repeat(64)}],
 ['binding epoch',(f:any)=>{f.proof.bindingEpoch++}],
 ['host',(f:any)=>{f.proof.hostId='other'}],
 ['expired proof',(f:any)=>{f.proof.observedAt=Date.now()-6000;f.proof.expiresAt=f.proof.observedAt+5000}],
 ['workspace expiry',(f:any)=>{f.r.absoluteExpiresAt=new Date(0).toISOString()}]
] as const)it('stable identity does not weaken original release verification: '+name,()=>{
 const f=facts();change(f);expect(()=>qualify(f)).toThrow('WORKSPACE_V2_ORIGINAL_PLACEMENT_UNAVAILABLE');
});
