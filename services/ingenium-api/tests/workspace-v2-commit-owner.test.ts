/** Focused lost-reply regression. Identity/Core/manager doubles are explicit;
 * the original request decoder, private ingress and API coordinator execute.
 * These controls do not qualify a physical Kubernetes runtime or image. */
import {beforeEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({db:null as any,workspace:null as any,runtime:null as any,definition:null as any,original:null as any,persisted:null as any,post:vi.fn(),transition:vi.fn(),revoke:vi.fn(),mode:'lost',commits:0,responses:[] as number[]}));
vi.mock('ingenium-core',()=>({getDb:()=>m.db,agents:{validateProtectedOpenCodeDeployment:()=>{}},runtimes:{
 getAuthorizedWorkspaceV2:()=>m.workspace,getWorkspaceRuntimeV2:()=>m.runtime,bindWorkspaceRuntimeCapabilityV2:()=>{},
 claimWorkspaceRuntimeLeaseV2:()=>{m.runtime={...m.runtime,revision:m.runtime.revision+1,leaseExpiresAt:new Date(Date.now()+60000).toISOString()};return m.runtime;},
 transitionWorkspaceRuntimeV2:m.transition,
},workspaceRuntimeCredentialsV2:{issueWorkspaceRuntimeCredentialV2:()=>({id:'00000000-0000-4000-8000-000000000004',token:'ing_'+'a'.repeat(12)+'_'+'b'.repeat(43),expiresAt:new Date(Date.now()+300000).toISOString()}),revokeWorkspaceRuntimeCredentialV2:m.revoke,
 inspectWorkspaceBootstrapCredentialV2:()=>({runtimeId:m.runtime.id,workspaceId:m.workspace.id,bindingHash:m.workspace.storageMappingHash,bindingEpoch:0,credentialId:'00000000-0000-4000-8000-000000000004',organizationId:m.workspace.organizationId,ownerUserId:m.workspace.ownerUserId,projectId:null})}}));
vi.mock('ingenium-core/lib/tools/runtime-original-provision',async()=>({...await import('../../../packages/ingenium-core/lib/tools/runtime-original-provision.ts'),readWorkspaceRuntimeOriginalProvision:()=>m.persisted}));
vi.mock('../lib/request-identity.js',()=>({revalidateRequestIdentity:()=>({principal:{type:'user',id:'00000000-0000-4000-8000-000000000003',session:{id:'session',security_epoch:1}}})}));
vi.mock('../lib/runtime-mode.js',()=>({deploymentMode:()=> 'control-plane'}));
vi.mock('../lib/runtime-provisioner.js',()=>({runtimeNumberSetting:(_name:string,value:number)=>value}));
vi.mock('../lib/runtime-manager-auth.js',()=>({loadManagerToken:()=> 'unit-only-manager-token'}));
vi.mock('../lib/dot-v2/core126-installed-image-owner.js',()=>({loadInstalledWorkspaceRuntimeV2ImageDefinition:()=>m.definition,configuredWorkspaceRuntimeImageV2:()=>m.definition.imageId}));
vi.mock('../lib/runtime-manager-client.js',()=>({preflightOriginalWorkspaceRuntimeV2:async()=>{},postOriginalWorkspaceRuntimeV2:m.post,authenticatedOriginalWorkspaceProvisionV2:()=>m.original,
 inspectOriginalWorkspaceRuntimeV2:()=>{throw Error('No placement in this regression');},stopOriginalWorkspaceRuntimeV2:()=>{},authenticatedWorkspaceRetirementV2:()=>false,finishOriginalWorkspaceRetirementV2:()=>{}}));
import {provisionHash,publicWorkspaceProvisionRequest,decodeWorkspaceRuntimeOriginalProvision} from 'ingenium-core/lib/tools/runtime-original-provision';
import {provisionWorkspaceRuntimeFromRequestV2,workspaceV2PrivateIngress} from '../lib/projects-v2/workspace-v2-control.mjs';
const runtimeId='00000000-0000-4000-8000-000000000001',selection={projectId:null,workspaceId:'workspace',runtimeId};
function ingress(path:string,body:unknown,authorization='Bearer unit-only-manager-token'){
 const response={statusCode:200,body:null as any,status(code:number){this.statusCode=code;return this;},json(value:unknown){this.body=value;return this;}};
 workspaceV2PrivateIngress({method:'POST',path,originalUrl:path,body,headers:{authorization,'content-type':'application/json'}} as never,response as never,()=>{throw Error('Unexpected private routing');});
 return response;
}
beforeEach(()=>{
 vi.clearAllMocks();m.mode='lost';m.commits=0;m.persisted=null;m.responses=[];
 m.db={prepare:(sql:string)=>({get:()=>sql.includes('veyra_installation_identity')?{instance_id:'a'.repeat(32)}:sql.includes('organization_memberships')?{present:1}:sql.includes('runtime_original_provisions')?m.persisted:undefined,all:()=>[]})};
 const limits={cpuMillis:1000,memoryBytes:1073741824,pidsLimit:256,diskBytes:2147483648,processLimit:128};
 m.workspace={id:'workspace',organizationId:'00000000-0000-4000-8000-000000000002',ownerUserId:'00000000-0000-4000-8000-000000000003',status:'authorized',securityEpoch:0,storagePath:'/synthetic/workspace',storageMappingHash:provisionHash('workspace\0/synthetic/workspace')};
 m.runtime={...limits,id:runtimeId,workspaceId:'workspace',organizationId:m.workspace.organizationId,ownerUserId:m.workspace.ownerUserId,projectId:null,state:'ABSENT',revision:1,securityEpoch:0,backendContainerId:null,backendName:'ingenium-runtime-'+runtimeId.replaceAll('-','')};
 m.definition={schemaVersion:2,backendKind:'kubernetes',imageId:'sha256:'+'b'.repeat(64),pullReference:'registry.example.invalid/veyra@sha256:'+'c'.repeat(64),sourceRevision:'d'.repeat(40),validUntil:Date.now()+300000,files:[]};
 m.transition.mockImplementation((input:any)=>{
  expect(input.expectedRevision).toBe(m.runtime.revision);
  if(input.toState==='STARTING'){m.commits++;m.persisted={...structuredClone(input.originalProvision),recordedAt:new Date().toISOString()};}
  m.runtime={...m.runtime,state:input.toState,revision:m.runtime.revision+1,backendContainerId:input.backendContainerId??m.runtime.backendContainerId};return m.runtime;
 });
 m.post.mockImplementation(async(payload:any)=>{
  const {capability,capabilityExpiresAt:_expires,bootstrapNonce,...publicInput}=payload,request=publicWorkspaceProvisionRequest(publicInput);
  const uid='00000000-0000-4000-8000-000000000005',k={schemaVersion:1,namespace:'unit',namespaceUid:uid,apiCaSha256:'e'.repeat(64),podName:request.backendName,podUid:uid,containerId:'f'.repeat(64),nodeName:'unit-node',nodeUid:uid,nodeBootId:uid,startedAt:'2026-01-01T00:00:01.000Z',claimName:'unit-claim',claimUid:uid,pullReference:m.definition.pullReference,enforcedPodPidsLimit:128,nodePidPolicySha256:'1'.repeat(64)};
  const daemonId='kubernetes-api:'+provisionHash(['veyra-kubernetes-api-v1',k.namespaceUid,k.apiCaSha256]);
  m.original=decodeWorkspaceRuntimeOriginalProvision({schemaVersion:2,scopeKind:'workspace',projectId:null,kind:'original-kubernetes-workspace-runtime-provision-v1',backendKind:'kubernetes',requestId:request.originalRequestId,requestSha256:provisionHash(request),runtimeId,parentContainerId:k.containerId,daemonId,hostId:'kubernetes-node:'+provisionHash(['veyra-kubernetes-node-v1',daemonId,k.nodeUid,k.nodeBootId]),imageId:m.definition.imageId,startIdentity:provisionHash([k.podUid,k.containerId,k.startedAt,0]),publicProfileSha256:'2'.repeat(64),specSha256:'3'.repeat(64),workspaceId:'workspace',organizationId:request.organizationId,ownerUserId:request.ownerUserId,bindingHash:request.storageMappingHash,bindingEpoch:0,provisioningRevision:request.revision,limits:request.limits,containerCreatedAt:'2026-01-01T00:00:00.000Z',kubernetes:k});
  if(m.mode!=='before-bootstrap'){
   const boot=ingress('/api/v1/runtime/workspace-v2/bootstrap',{schemaVersion:2,nonce:bootstrapNonce,runtimeId,workspaceId:'workspace',bindingHash:request.storageMappingHash,startIdentity:m.original.startIdentity,requestId:request.originalRequestId},'Bearer '+capability);
   m.responses.push(boot.statusCode);if(boot.statusCode!==200)throw Error('Unit bootstrap rejected');
  }
  const input={runtimeId,requestId:request.originalRequestId,requestSha256:provisionHash(request),originalProvision:m.original};
  const response=ingress('/api/v1/internal/workspace-runtime-v2/commit',input);
  m.responses.push(response.statusCode);
  if(m.mode==='before-bootstrap')throw Error('Bootstrap not committed');
  if(m.mode==='duplicate'||m.mode==='contradictory'){
   if(m.mode==='duplicate')m.responses.push(ingress('/api/v1/internal/workspace-runtime-v2/commit',input).statusCode);
   else m.original={...m.original,publicProfileSha256:'4'.repeat(64)};
   return {runtimeId,backendId:m.original.parentContainerId,backendName:request.backendName,imageRevision:m.definition.sourceRevision,state:'running',health:'starting'};
  }
  throw Error('Simulated lost manager response after Core commit');
 });
});
it('retains the committed STARTING original and capability after a lost outer reply',async()=>{
 const result=await provisionWorkspaceRuntimeFromRequestV2({} as never,selection);
 expect(result.state).toBe('STARTING');expect(m.commits).toBe(1);expect(m.revoke).not.toHaveBeenCalled();expect(m.persisted.parentContainerId).toBe(m.original.parentContainerId);
 expect(m.responses).toEqual([200,200]);
 expect(m.transition.mock.calls.map(([input])=>input.toState)).toEqual(['PROVISIONING','STARTING']);
});
it('ordinary replies and duplicate private acknowledgements preserve the same original without another state write',async()=>{
 m.mode='duplicate';await provisionWorkspaceRuntimeFromRequestV2({} as never,selection);expect(m.commits).toBe(1);expect(m.revoke).not.toHaveBeenCalled();expect(m.responses).toEqual([200,200,200]);
});
it('cannot commit before the original bootstrap acknowledgement',async()=>{
 m.mode='before-bootstrap';await expect(provisionWorkspaceRuntimeFromRequestV2({} as never,selection)).rejects.toThrow('Bootstrap not committed');expect(m.commits).toBe(0);expect(m.persisted).toBeNull();expect(m.revoke).toHaveBeenCalledOnce();expect(m.responses).toEqual([503]);
});
it('rejects a conflicting decoded reply without revoking the committed execution',async()=>{
 m.mode='contradictory';await expect(provisionWorkspaceRuntimeFromRequestV2({} as never,selection)).rejects.toThrow('WORKSPACE_V2_COMMITTED_ORIGINAL_CHANGED');
 expect(m.commits).toBe(1);expect(m.runtime.state).toBe('STARTING');expect(m.persisted.publicProfileSha256).toBe('2'.repeat(64));expect(m.revoke).not.toHaveBeenCalled();
});
