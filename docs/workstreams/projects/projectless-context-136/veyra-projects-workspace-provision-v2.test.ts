// AUTHORED, NOT RUN. Pure contract fixtures; never a Docker/runtime qualification.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
 buildWorkspaceRuntimeContainerSpecV2,buildRuntimeContainerSpec,
 runtimeStorageMappingHash,type WorkspaceRuntimeProvisionRequestV2,
} from '../lib/runtime-manager-contract.js';
import {
 publicWorkspaceProvisionRequest,originalWorkspaceProvisionFromNewFlow,
 decodeWorkspaceRuntimeOriginalProvision,decodeRuntimeOriginalProvision,
 validateWorkspaceProvisionResponse,type PublicWorkspaceProvisionRequest,
} from '../../../packages/ingenium-core/lib/tools/runtime-original-provision.js';
const id='00000000-0000-4000-8000-000000000001',org='00000000-0000-4000-8000-000000000002',owner='00000000-0000-4000-8000-000000000003';
function input():WorkspaceRuntimeProvisionRequestV2{return {
 schemaVersion:2,scopeKind:'workspace',projectId:null,originalRequestId:'00000000-0000-4000-8000-000000000004',
 runtimeId:id,organizationId:org,ownerUserId:owner,workspaceId:'workspace',storagePath:'/synthetic/workspace',
 storageMappingHash:runtimeStorageMappingHash('workspace','/synthetic/workspace'),securityEpoch:0,revision:2,
 backendName:'ingenium-runtime-'+id.replaceAll('-',''),capability:'ing_'+'a'.repeat(12)+'_'+'b'.repeat(43),
 capabilityExpiresAt:new Date(Date.now()+60000).toISOString(),
 limits:{cpuMillis:1000,memoryBytes:1073741824,pidsLimit:256,diskBytes:2147483648,processLimit:128},
};}
function proofFixture(){
 const request=input(),mapping={id:'workspace',hostPath:'/synthetic/workspace',validationPath:'/synthetic/mounted'},config={image:'sha256:'+'a'.repeat(64),network:'fixture-net',apiUrl:'http://api.example.invalid/api/v1'};
 const spec=buildWorkspaceRuntimeContainerSpecV2(request,mapping,config);
 const {capability:_capability,capabilityExpiresAt:_expires,...publicRequest}=request;
 const container={Id:'b'.repeat(64),Name:'/'+request.backendName,Image:config.image,Created:'2026-01-01T00:00:00.000Z',RestartCount:0,AppArmorProfile:'docker-default',
  Config:{Image:config.image,User:spec.User,WorkingDir:spec.WorkingDir,Labels:spec.Labels,Env:spec.Env,Entrypoint:['/app/entrypoint'],Cmd:null},
  HostConfig:{...spec.HostConfig,Privileged:false,CapAdd:null,Devices:null,DeviceRequests:null,PidMode:'',IpcMode:'private',UsernsMode:''},
  Mounts:[{Type:'bind',Source:mapping.hostPath,Destination:'/workspace',RW:true,Propagation:'rprivate'}],
  NetworkSettings:{Networks:{'fixture-net':{}}},State:{StartedAt:'2026-01-01T00:00:01.000Z',Pid:123,Running:true,Status:'running',Health:{Status:'starting'}}};
 return {request:publicWorkspaceProvisionRequest(publicRequest),spec,daemonBefore:{ID:'fixture-daemon'},daemonAfter:{ID:'fixture-daemon'},imageId:config.image,createdId:container.Id,createStatus:201,startStatus:204,attachJoined:true,container};
}
test('v2 omits Project labels and all Project env while retaining actual sandbox fields',()=>{
 const p=proofFixture();assert.equal(Object.hasOwn(p.spec.Labels,'com.ingenium.runtime.project'),false);
 assert.equal(p.spec.Labels['com.ingenium.runtime.scope'],'workspace');
 assert.equal(p.spec.Env.some(v=>/^INGENIUM_PROJECT(?:_|=)/.test(v)),false);
 assert.equal(p.spec.HostConfig.ReadonlyRootfs,true);assert.deepEqual(p.spec.HostConfig.CapDrop,['ALL']);
 assert.equal(p.spec.Env.includes('INGENIUM_EXECUTION_SCOPE=workspace'),true);
 assert.throws(()=>buildRuntimeContainerSpec(input() as never,{id:'workspace',hostPath:'/synthetic/workspace',validationPath:'/synthetic/mounted'},{image:'fixture',network:'fixture-net',apiUrl:'http://api.example.invalid/api/v1'}));
});
test('v2 public request keeps actual null and rejects Project/sentinel/name/version ambiguity',()=>{
 const p=proofFixture();assert.equal(p.request.projectId,null);
 for(const changed of [{projectId:'global'},{projectId:id},{projectName:'shadow'},{scopeKind:'project'},{schemaVersion:1},{storageMappingHash:'f'.repeat(64)}])assert.throws(()=>publicWorkspaceProvisionRequest({...p.request,...changed} as PublicWorkspaceProvisionRequest));
 assert.equal(JSON.stringify(p.request).includes('capability'),false);
});
test('original v2 initial metadata is distinct from current readiness and v1 metadata',()=>{
 const p=proofFixture(),original=originalWorkspaceProvisionFromNewFlow(p);
 assert.equal(original.schemaVersion,2);assert.equal(original.projectId,null);assert.equal(original.scopeKind,'workspace');
 assert.equal(original.kind,'original-workspace-runtime-provision-v2');
 assert.equal(validateWorkspaceProvisionResponse(original,p.request,p.createdId).runtimeId,id);
 assert.throws(()=>decodeRuntimeOriginalProvision(original));
 assert.throws(()=>decodeWorkspaceRuntimeOriginalProvision({...original,schemaVersion:1,kind:'original-runtime-provision-v1'}));
 assert.throws(()=>validateWorkspaceProvisionResponse(original,{...p.request,revision:3},p.createdId));
});
for(const [name,alter] of [
 ['wrong create status',(p:ReturnType<typeof proofFixture>)=>{p.createStatus=200;}],
 ['wrong start status',(p:ReturnType<typeof proofFixture>)=>{p.startStatus=200;}],
 ['missing joined attach',(p:ReturnType<typeof proofFixture>)=>{p.attachJoined=false;}],
 ['daemon changed',(p:ReturnType<typeof proofFixture>)=>{p.daemonAfter.ID='different';}],
 ['project label',(p:ReturnType<typeof proofFixture>)=>{p.container.Config.Labels={...p.container.Config.Labels,'com.ingenium.runtime.project':'global'};}],
 ['project env',(p:ReturnType<typeof proofFixture>)=>{p.container.Config.Env=[...p.container.Config.Env,'INGENIUM_PROJECT_ID=null'];}],
 ['wrong mount',(p:ReturnType<typeof proofFixture>)=>{p.container.Mounts[0]!.Source='/other';}],
 ['privileged profile',(p:ReturnType<typeof proofFixture>)=>{p.container.HostConfig.Privileged=true;}],
 ['restart changed',(p:ReturnType<typeof proofFixture>)=>{p.container.RestartCount=1;}],
] as const)test(name+' refuses synthetic initial proof',()=>{const p=proofFixture();alter(p);assert.throws(()=>originalWorkspaceProvisionFromNewFlow(p));});
