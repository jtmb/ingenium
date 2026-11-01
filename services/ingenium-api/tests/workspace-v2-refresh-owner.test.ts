/** Unit composition controls with explicit identity/Core/manager doubles.
 * The real placement qualifier executes; no Docker/runtime readiness is claimed. */
import {beforeEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({installation:'a'.repeat(32) as unknown,member:true,workspace:null as any,runtime:null as any,definition:null as any,original:null as any,proof:null as any,afterInspect:null as null|(()=>void),inspect:vi.fn(),health:vi.fn(),transition:vi.fn()}));
vi.mock('ingenium-core',()=>({getDb:()=>({prepare:(sql:string)=>({get:()=>{if(sql.includes('veyra_installation_identity'))return {instance_id:m.installation};if(sql.includes('organization_memberships'))return m.member?{present:1}:undefined;throw Error('Unexpected SQL in unit control')}})}),runtimes:{getAuthorizedWorkspaceV2:(id:string)=>id===m.workspace?.id?m.workspace:undefined,getWorkspaceRuntimeV2:(id:string)=>id===m.runtime?.id?m.runtime:undefined,recordWorkspaceRuntimeHealthV2:m.health,transitionWorkspaceRuntimeV2:m.transition},agents:{},workspaceRuntimeCredentialsV2:{}}));
vi.mock('ingenium-core/lib/tools/runtime-original-provision',async importOriginal=>({...await importOriginal<any>(),readWorkspaceRuntimeOriginalProvision:()=>m.original}));
vi.mock('../lib/request-identity.js',()=>({revalidateRequestIdentity:()=>({principal:{type:'user',id:'owner',session:{id:'session',security_epoch:1}}})}));
vi.mock('../lib/runtime-mode.js',()=>({deploymentMode:()=> 'control-plane'}));
vi.mock('../lib/runtime-provisioner.js',()=>({runtimeNumberSetting:()=>1000}));
vi.mock('../lib/runtime-manager-auth.js',()=>({loadManagerToken:()=>{throw Error('Unused manager token owner in unit control')}}));
vi.mock('../lib/dot-v2/core126-installed-image-owner.js',()=>({loadInstalledWorkspaceRuntimeV2ImageDefinition:()=>m.definition}));
vi.mock('../lib/runtime-manager-client.js',()=>({inspectOriginalWorkspaceRuntimeV2:m.inspect,postOriginalWorkspaceRuntimeV2:()=>{throw Error('No provisioning effects in unit control')},authenticatedOriginalWorkspaceProvisionV2:()=>null}));
import {provisionHash} from 'ingenium-core/lib/tools/runtime-original-provision';
import {refreshWorkspaceRuntimeFromRequestV2} from '../lib/projects-v2/workspace-v2-control.mjs';
const selection={projectId:null,workspaceId:'workspace',runtimeId:'runtime'};
beforeEach(()=>{
 m.installation='a'.repeat(32);m.member=true;m.afterInspect=null;vi.clearAllMocks();
 const now=Date.now(),image='sha256:'+'b'.repeat(64);
 m.workspace={id:'workspace',organizationId:'org',ownerUserId:'owner',projectId:null,status:'authorized',storageMappingHash:'c'.repeat(64),securityEpoch:1};
 m.runtime={id:'runtime',projectId:null,organizationId:'org',ownerUserId:'owner',workspaceId:'workspace',securityEpoch:1,revision:2,state:'STARTING',backendContainerId:'d'.repeat(64),absoluteExpiresAt:new Date(now+60000).toISOString(),idleExpiresAt:new Date(now+60000).toISOString(),leaseExpiresAt:null};
 m.definition={schemaVersion:2,imageId:image,validUntil:now+60000,files:[{path:'/opt/veyra/owned.mjs',sha256:'e'.repeat(64),bytes:12}]};
 m.original={schemaVersion:2,projectId:null,imageId:image,daemonId:'unit-daemon',hostId:'unit-host',parentContainerId:m.runtime.backendContainerId,startIdentity:'f'.repeat(64),publicProfileSha256:'1'.repeat(64),provisioningRevision:2,bindingHash:m.workspace.storageMappingHash,bindingEpoch:1};
 m.proof={schemaVersion:2,kind:'original-workspace-runtime-v2-placement',observedAt:now,expiresAt:now+5000,definitionSha256:provisionHash(m.definition),imageId:image,daemonId:m.original.daemonId,hostId:m.original.hostId,runtimeId:m.runtime.id,parentContainerId:m.runtime.backendContainerId,startIdentity:m.original.startIdentity,publicProfileSha256:m.original.publicProfileSha256,provisioningRevision:2,organizationId:'org',ownerUserId:'owner',workspaceId:'workspace',projectId:null,bindingHash:m.workspace.storageMappingHash,bindingEpoch:1,health:'healthy',state:'running',artifacts:structuredClone(m.definition.files)};
 m.inspect.mockImplementation(async()=>{m.afterInspect?.();return m.proof});
 m.health.mockImplementation(()=>({...m.runtime,revision:3}));
 m.transition.mockImplementation(()=>({...m.runtime,state:'READY',revision:4}));
});
it('original refresh supplies actual installation identity to the real placement qualifier before its original health/READY writes',async()=>{
 const result=await refreshWorkspaceRuntimeFromRequestV2({} as never,selection);expect(result).toMatchObject({state:'READY'});expect(m.inspect).toHaveBeenCalledWith('runtime');expect(m.health).toHaveBeenCalledWith('runtime',2,'d'.repeat(64));expect(m.transition).toHaveBeenCalledWith({id:'runtime',expectedRevision:3,toState:'READY',actorType:'manager',actorId:'runtime-manager'});
});
for(const installation of ['', 'A'.repeat(32),'a'.repeat(31),null,undefined])it('missing/invalid canonical installation stops before manager or health: '+String(installation),async()=>{
 m.installation=installation;await expect(refreshWorkspaceRuntimeFromRequestV2({} as never,selection)).rejects.toThrow('WORKSPACE_V2_INSTALLATION_IDENTITY');expect(m.inspect).not.toHaveBeenCalled();expect(m.health).not.toHaveBeenCalled();
});
it('installation replacement during original manager inspection cannot mint READY',async()=>{m.afterInspect=()=>{m.installation='b'.repeat(32)};await expect(refreshWorkspaceRuntimeFromRequestV2({} as never,selection)).rejects.toThrow('WORKSPACE_V2_SCOPE_CHANGED');expect(m.health).not.toHaveBeenCalled();expect(m.transition).not.toHaveBeenCalled()});
it('membership withdrawal during original manager inspection cannot mint READY',async()=>{m.afterInspect=()=>{m.member=false};await expect(refreshWorkspaceRuntimeFromRequestV2({} as never,selection)).rejects.toThrow('WORKSPACE_V2_SCOPE');expect(m.health).not.toHaveBeenCalled()});
it('the real qualifier still rejects changed image evidence before health or READY',async()=>{m.proof.imageId='sha256:'+'9'.repeat(64);await expect(refreshWorkspaceRuntimeFromRequestV2({} as never,selection)).rejects.toThrow('WORKSPACE_V2_ORIGINAL_PLACEMENT_UNAVAILABLE');expect(m.health).not.toHaveBeenCalled();expect(m.transition).not.toHaveBeenCalled()});
it('browser installation identity field is not accepted as an authority override',async()=>{await expect(refreshWorkspaceRuntimeFromRequestV2({} as never,{...selection,installationId:'a'.repeat(32)})).rejects.toThrow('WORKSPACE_V2_SELECTION');expect(m.inspect).not.toHaveBeenCalled()});
