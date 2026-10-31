// Additive private methods in actual scripts/runtime-manager.ts. v1 is unchanged.
const workspaceV2Attempts=new Map<string,{requestSha256:string;phase:string;containerId?:string;failure?:string;failurePhase?:string}>();
async function workspaceV2Core(operation:'admission'|'original',body:unknown):Promise<any>{
 const base=new URL(environment('INGENIUM_RUNTIME_API_URL'));
 if(base.protocol!=='http:'||base.pathname!=='/api/v1'||base.username||base.password||base.search||base.hash)throw Error('WORKSPACE_V2_CORE_URL');
 base.pathname+='/internal/workspace-runtime-v2/'+operation;
 const response=await fetch(base,{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+loadManagerToken(),'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
 if(response.status!==200||!response.body)throw Error('WORKSPACE_V2_CORE_OWNER_UNAVAILABLE');
 let size=0;const chunks:Buffer[]=[];for await(const chunk of response.body){size+=chunk.length;if(size>65536)throw Error('WORKSPACE_V2_CORE_BOUND');chunks.push(Buffer.from(chunk));}
 const envelope=parseStrictJobJson(Buffer.concat(chunks),65536) as {data?:unknown};if(!envelope.data)throw Error('WORKSPACE_V2_CORE_RESPONSE');return envelope.data;
}
function workspaceV2Public(input:Record<string,unknown>){
 const {capability:_capability,capabilityExpiresAt:_expires,bootstrapNonce:_nonce,...publicRequest}=input;
 return runtimeProvision.publicWorkspaceProvisionRequest(publicRequest as unknown as runtimeProvision.PublicWorkspaceProvisionRequest);
}
async function workspaceV2Artifacts(containerId:string,definition:any){
 const measurements=[];
 for(const file of definition.files){const r=await workspaceDocker('GET','/containers/'+containerId+'/archive?path='+encodeURIComponent(file.path),undefined,file.bytes+65536) as {status:number;bytes:Buffer};if(r.status!==200)throw Error('WORKSPACE_V2_IMAGE_ARTIFACT_UNAVAILABLE');measurements.push(verifyWorkspaceArchive(r.bytes,file));}
 return measurements;
}
function workspaceV2Parent(raw:any,expected:any,original?:any){
 const c=raw?.Config,h=raw?.HostConfig,s=raw?.State,l=c?.Labels??{};
 if(!raw||!/^([a-f0-9]{64})$/.test(raw.Id)||raw.Name!=='/'+expected.backendName||c.User!=='1000:1000'||c.WorkingDir!=='/workspace'||l['com.ingenium.managed']!=='runtime-manager'||l['com.ingenium.runtime.scope']!=='workspace'||Object.hasOwn(l,'com.ingenium.runtime.project')
 ||l['com.ingenium.runtime.id']!==expected.runtimeId||l['com.ingenium.runtime.organization']!==expected.organizationId||l['com.ingenium.runtime.owner']!==expected.ownerUserId||l['com.ingenium.runtime.workspace']!==expected.workspaceId||l['com.ingenium.runtime.storage']!==expected.storageMappingHash||l['com.ingenium.runtime.security-epoch']!==String(expected.securityEpoch)||l['com.ingenium.runtime.revision']!==String(expected.revision)
 ||!/^([a-f0-9]{40})$/.test(l['org.opencontainers.image.revision']??''))throw Error('WORKSPACE_V2_PARENT_SCOPE');
 const profile=runtimeProvision.provisionHash({User:c.User,WorkingDir:c.WorkingDir,Entrypoint:c.Entrypoint,Cmd:c.Cmd,HostConfig:h,Mounts:raw.Mounts,AppArmorProfile:raw.AppArmorProfile}),start=runtimeProvision.provisionHash([s?.StartedAt,raw.RestartCount]);
 if(original&&(raw.Id!==original.parentContainerId||raw.Image!==original.imageId||profile!==original.publicProfileSha256||start!==original.startIdentity||s?.Running!==true||s.Status!=='running'||s.Health?.Status!=='healthy'))throw Error('WORKSPACE_V2_ORIGINAL_PROFILE_CHANGED');
 return {profile,start,imageRevision:l['org.opencontainers.image.revision']};
}
async function provisionOriginalWorkspaceV2(input:Record<string,unknown>,mappings:ReturnType<typeof readWorkspaceMappings>){
 const publicRequest=workspaceV2Public(input),requestSha256=runtimeProvision.provisionHash(publicRequest),runtimeId=publicRequest.runtimeId;
 if(Object.keys(input).sort().join('|')!==[...Object.keys(publicRequest),'capability','capabilityExpiresAt','bootstrapNonce'].sort().join('|')||typeof input.bootstrapNonce!=='string'||!/^[a-f0-9]{64}$/.test(input.bootstrapNonce)||workspaceV2Attempts.has(runtimeId))throw Error('WORKSPACE_V2_NEW_REQUEST_REQUIRED');
 const attempt={requestSha256,phase:'admission'} as {requestSha256:string;phase:string;containerId?:string;failure?:string;failurePhase?:string};workspaceV2Attempts.set(runtimeId,attempt);
 try{
  const admitted=await workspaceV2Core('admission',{runtimeId,requestId:publicRequest.originalRequestId,requestSha256});
  if(runtimeProvision.provisionHash(admitted.publicRequest)!==requestSha256||admitted.nonce!==input.bootstrapNonce||!admitted.credentialId)throw Error('WORKSPACE_V2_ORIGINAL_ADMISSION_CHANGED');
  const mapping=mappings.get(publicRequest.workspaceId);if(!mapping||mapping.hostPath!==publicRequest.storagePath)throw Error('WORKSPACE_V2_REAL_MAPPING_UNAVAILABLE');
  const definition=admitted.definition;
  if(definition?.schemaVersion!==2||definition.imageId!==environment('INGENIUM_USER_RUNTIME_IMAGE')||!/^sha256:[a-f0-9]{64}$/.test(definition.imageId)||definition.validUntil<=Date.now())throw Error('WORKSPACE_V2_IMMUTABLE_IMAGE_UNAVAILABLE');
  const prior=await workspaceDocker('GET','/containers/'+encodeURIComponent(publicRequest.backendName)+'/json') as {status:number};if(prior.status!==404)throw Error('WORKSPACE_V2_PRIOR_CONTAINER_PRESERVED');
  const image=await workspaceDockerJson('GET','/images/'+encodeURIComponent(definition.imageId)+'/json');
  if((image as any).value?.Id!==definition.imageId||runtimeProvision.provisionHash(Object.fromEntries(['User','WorkingDir','Entrypoint','Cmd'].map(k=>[k,(image as any).value.Config?.[k]??null])))!==runtimeProvision.provisionHash(definition.imageConfig))throw Error('WORKSPACE_V2_IMAGE_CONFIG_CHANGED');
  const config={image:definition.imageId,network:runtimeNetworkName(runtimeId),apiUrl:environment('INGENIUM_RUNTIME_API_URL')};
  const spec=buildWorkspaceRuntimeContainerSpecV2(input as unknown as WorkspaceRuntimeProvisionRequestV2,mapping,config);
  await ensureRuntimeNetwork(config.network,runtimeId);await connectControlPlane(config.network);await connectRuntimeGateway(config.network);
  await workspaceV2Core('admission',{runtimeId,requestId:publicRequest.originalRequestId,requestSha256});
  const daemon=await workspaceDockerJson('GET','/info');
  attempt.phase='create-sent';const created=await workspaceDockerJson('POST','/containers/create?name='+encodeURIComponent(publicRequest.backendName),spec,201);
  const containerId=(created as any).value?.Id;if(typeof containerId!=='string'||!/^[a-f0-9]{64}$/.test(containerId))throw Error('WORKSPACE_V2_CREATE_ID_UNKNOWN');attempt.containerId=containerId;attempt.phase='created';
  const born=await workspaceDockerJson('GET','/containers/'+containerId+'/json');workspaceV2Parent((born as any).value,publicRequest);
  await workspaceV2Artifacts(containerId,definition);
  await workspaceV2Core('admission',{runtimeId,requestId:publicRequest.originalRequestId,requestSha256});
  attempt.phase='start-sent';const started=await workspaceDockerJson('POST','/containers/'+containerId+'/start',undefined,204); // 304 is NEVER an original start
  const starting=await workspaceDockerJson('GET','/containers/'+containerId+'/json'),startIdentity=runtimeProvision.provisionHash([(starting as any).value?.State?.StartedAt,(starting as any).value?.RestartCount]);
  attempt.phase='attach-sent';await joinWorkspaceAttach(containerId,input.capability,{nonce:admitted.nonce,runtimeId,workspaceId:publicRequest.workspaceId,credentialId:admitted.credentialId,bindingHash:publicRequest.storageMappingHash,bindingEpoch:publicRequest.securityEpoch,startIdentity,requestId:publicRequest.originalRequestId});
  const after=await workspaceDockerJson('GET','/containers/'+containerId+'/json'),daemonAfter=await workspaceDockerJson('GET','/info');
  const original=runtimeProvision.originalWorkspaceProvisionFromNewFlow({request:publicRequest,spec,daemonBefore:(daemon as any).value,daemonAfter:(daemonAfter as any).value,imageId:definition.imageId,createdId:containerId,createStatus:(created as any).status,startStatus:(started as any).status,attachJoined:requireRetainedWorkspaceAttach(containerId)!==undefined,container:(after as any).value});
  attempt.phase='original-joined';return {...publicInspect((after as any).value),disposition:'new_created',originalProvision:original};
 }catch(error){const e=error as {code?:unknown;message?:unknown},code=typeof e.code==='string'?e.code:typeof e.message==='string'?e.message:'';attempt.failure=/^WORKSPACE_V2_[A-Z0-9_]+$/.test(code)?code:'WORKSPACE_V2_ORIGINAL_OUTCOME_UNAVAILABLE';attempt.failurePhase=attempt.phase;attempt.phase='retained-failure';throw error;}
 // No stale stop/remove/reuse, retry, log scraping, credential replay or adoption.
}
async function observeOriginalWorkspaceV2(runtimeId:string){
 const originalContext=await workspaceV2Core('original',{runtimeId}),{runtime:r,workspace:w,original:o,definition:d}=originalContext;
 if(o?.schemaVersion!==2||o.projectId!==null||r.projectId!==null||r.backendContainerId!==o.parentContainerId||o.imageId!==d.imageId||d.validUntil<=Date.now())throw Error('WORKSPACE_V2_ORIGINAL_BINDING');
 requireRetainedWorkspaceAttach(o.parentContainerId); // A manager restart is a gate, never label adoption.
 const begin=Date.now(),daemon=await workspaceDockerJson('GET','/info'),first=await workspaceDockerJson('GET','/containers/'+o.parentContainerId+'/json');
 const expected={runtimeId,backendName:r.backendName,organizationId:r.organizationId,ownerUserId:r.ownerUserId,workspaceId:w.id,storageMappingHash:w.storageMappingHash,securityEpoch:w.securityEpoch,revision:o.provisioningRevision};
 const a=workspaceV2Parent((first as any).value,expected,o),artifacts=await workspaceV2Artifacts(o.parentContainerId,d);
 const last=await workspaceDockerJson('GET','/containers/'+o.parentContainerId+'/json'),endDaemon=await workspaceDockerJson('GET','/info'),b=workspaceV2Parent((last as any).value,expected,o);
 if((daemon as any).value?.ID!==o.daemonId||(endDaemon as any).value?.ID!==o.daemonId||a.profile!==b.profile||a.start!==b.start||Date.now()>=begin+5000)throw Error('WORKSPACE_V2_FRESH_ORIGINAL_CHANGED');
 requireRetainedWorkspaceAttach(o.parentContainerId);
 return {schemaVersion:2,kind:'original-workspace-runtime-v2-placement',runtimeId,parentContainerId:o.parentContainerId,startIdentity:o.startIdentity,publicProfileSha256:o.publicProfileSha256,provisioningRevision:o.provisioningRevision,imageId:o.imageId,daemonId:o.daemonId,hostId:o.hostId,organizationId:w.organizationId,ownerUserId:w.ownerUserId,projectId:null,workspaceId:w.id,bindingHash:w.storageMappingHash,bindingEpoch:w.securityEpoch,state:'running',health:'healthy',artifacts,definitionSha256:runtimeProvision.provisionHash(d),observedAt:begin,expiresAt:begin+5000};
}
