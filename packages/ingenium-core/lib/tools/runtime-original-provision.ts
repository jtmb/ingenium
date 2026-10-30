/** Original successful NEW manager flow metadata, never a current-label grant.
 * No token, capability, Env or raw profile content is returned/stored.
 */
import {createHash} from "node:crypto";
export interface OriginalLimits{cpuMillis:number;memoryBytes:number;pidsLimit:number;diskBytes:number;processLimit:number}
export interface PublicProvisionRequest{
 originalRequestId:string;runtimeId:string;backendName:string;organizationId:string;projectId:string;projectName:string;
 ownerUserId:string;workspaceId:string;storagePath:string;storageMappingHash:string;securityEpoch:number;revision:number;limits:OriginalLimits;
}
export interface RuntimeOriginalProvision{
 schemaVersion:1;kind:"original-runtime-provision-v1";requestId:string;requestSha256:string;
 runtimeId:string;parentContainerId:string;daemonId:string;hostId:string;imageId:string;startIdentity:string;
 publicProfileSha256:string;specSha256:string;workspaceId:string;organizationId:string;projectId:string;ownerUserId:string;
 bindingHash:string;bindingEpoch:number;provisioningRevision:number;limits:OriginalLimits;containerCreatedAt:string;
}
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const HEX=/^[a-f0-9]{64}$/u;
const fail=():never=>{throw Error("Original runtime provision owner unavailable");};
const obj=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=="object"||Array.isArray(v))return fail();return v as Record<string,unknown>;};
const text=(v:unknown,max=512):v is string=>typeof v==="string"&&v.length>0&&v.length<=max&&v===v.trim()&&!/[\u0000-\u001f\u007f]/u.test(v);
const integer=(v:unknown):v is number=>Number.isSafeInteger(v)&&typeof v==="number"&&v>=0;
const stamp=(v:unknown):v is string=>text(v,64)&&Number.isFinite(Date.parse(v));
function canonical(v:unknown):unknown{
 if(v===null||typeof v==="string"||typeof v==="boolean")return v;
 if(typeof v==="number"){if(!Number.isFinite(v))return fail();return v;}
 if(Array.isArray(v))return v.map(canonical);
 const value=obj(v);return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
}
export const provisionHash=(v:unknown):string=>createHash("sha256").update(typeof v==="string"?v:JSON.stringify(canonical(v))).digest("hex");
const equal=(a:unknown,b:unknown):boolean=>provisionHash(a)===provisionHash(b);
function frozen<T>(value:T):Readonly<T>{if(value&&typeof value==="object"){for(const child of Object.values(value))frozen(child);Object.freeze(value);}return value;}
function limits(value:unknown):OriginalLimits{
 const v=obj(value),keys=["cpuMillis","memoryBytes","pidsLimit","diskBytes","processLimit"];
 if(Object.keys(v).sort().join("|")!==keys.sort().join("|")||keys.some(key=>!integer(v[key])))return fail();
 const result=v as unknown as OriginalLimits;
 if(result.cpuMillis<100||result.cpuMillis>64000||result.memoryBytes<134217728||result.memoryBytes>274877906944||result.pidsLimit<16||result.pidsLimit>65536||result.diskBytes<67108864||result.diskBytes>1099511627776||result.processLimit<16||result.processLimit>result.pidsLimit)return fail();
 return {...result};
}
/** Exact public request only. Capability, expiry and Env are deliberately absent. */
export function publicProvisionRequest(input:PublicProvisionRequest):PublicProvisionRequest{
 if(![input.originalRequestId,input.runtimeId,input.organizationId,input.projectId,input.ownerUserId].every(v=>typeof v==="string"&&UUID.test(v))
  ||input.backendName!=="ingenium-runtime-"+input.runtimeId.replaceAll("-","")||!text(input.projectName,64)||!text(input.workspaceId,256)
  ||!text(input.storagePath,1024)||!input.storagePath.startsWith("/")||input.storagePath.includes("/../")||input.storagePath.includes("/./")||input.storagePath.endsWith("/..")||input.storagePath.endsWith("/.")
  ||!HEX.test(input.storageMappingHash)||input.storageMappingHash!==provisionHash(input.workspaceId+"\0"+input.storagePath)||!integer(input.securityEpoch)||!integer(input.revision))return fail();
 return frozen({originalRequestId:input.originalRequestId,runtimeId:input.runtimeId,backendName:input.backendName,organizationId:input.organizationId,projectId:input.projectId,projectName:input.projectName,ownerUserId:input.ownerUserId,workspaceId:input.workspaceId,storagePath:input.storagePath,storageMappingHash:input.storageMappingHash,securityEpoch:input.securityEpoch,revision:input.revision,limits:limits(input.limits)});
}
export function publicProvisionSpec(spec:unknown):Record<string,unknown>{
 const value=obj(spec),keys=["Image","User","WorkingDir","AttachStdin","AttachStdout","AttachStderr","OpenStdin","StdinOnce","Labels","StopTimeout","HostConfig","NetworkingConfig"];
 for(const key of keys)if(!Object.hasOwn(value,key))return fail();
 return Object.fromEntries(keys.map(key=>[key,value[key]]));
}
/** CLOSED initial probe. Unlike the fresh consumer, starting health is allowed;
 * no healthy observation or role qualification is manufactured here. */
export function originalProvisionFromNewFlow(input:{request:PublicProvisionRequest;spec:unknown;daemonBefore:unknown;daemonAfter:unknown;imageId:unknown;createdId:unknown;createStatus:number;startStatus:number;attachJoined:boolean;container:unknown}):RuntimeOriginalProvision{
 const request=publicProvisionRequest(input.request),spec=obj(input.spec),h=obj(spec.HostConfig),raw=obj(input.container),c=obj(raw.Config),actual=obj(raw.HostConfig),s=obj(raw.State);
 const daemon=obj(input.daemonBefore),after=obj(input.daemonAfter),labels=obj(c.Labels),expected=obj(spec.Labels),network=obj(spec.NetworkingConfig),endpoints=obj(network.EndpointsConfig);
 if(input.createStatus!==201||input.startStatus!==204||input.attachJoined!==true||!text(daemon.ID,256)||daemon.ID!==after.ID||typeof input.createdId!=="string"||!HEX.test(input.createdId)
  ||raw.Id!==input.createdId||raw.Name!=="/"+request.backendName||typeof input.imageId!=="string"||!/^sha256:[a-f0-9]{64}$/u.test(input.imageId)||raw.Image!==input.imageId||spec.Image!==input.imageId||c.Image!==input.imageId
  ||c.User!=="1000:1000"||c.WorkingDir!=="/workspace"||!Object.hasOwn(c,"Entrypoint")||!Object.hasOwn(c,"Cmd")||!Array.isArray(c.Entrypoint)||!(c.Cmd===null||Array.isArray(c.Cmd))
  ||!Array.isArray(raw.Mounts)||typeof raw.AppArmorProfile!=="string"||!stamp(raw.Created)||!stamp(s.StartedAt)||Date.parse(s.StartedAt)<Date.parse(raw.Created)||raw.RestartCount!==0||!integer(s.Pid)||s.Pid===0||s.Running!==true||s.Status!=="running"
  ||!['starting','healthy'].includes(String(obj(s.Health).Status)))return fail();
 if(Object.entries(expected).some(([key,value])=>labels[key]!==value)||labels['com.ingenium.managed']!=='runtime-manager'
  ||labels['com.ingenium.runtime.id']!==request.runtimeId||labels['com.ingenium.runtime.organization']!==request.organizationId||labels['com.ingenium.runtime.project']!==request.projectId||labels['com.ingenium.runtime.owner']!==request.ownerUserId||labels['com.ingenium.runtime.workspace']!==request.workspaceId||labels['com.ingenium.runtime.storage']!==request.storageMappingHash||labels['com.ingenium.runtime.security-epoch']!==String(request.securityEpoch)||labels['com.ingenium.runtime.revision']!==String(request.revision))return fail();
 // Compare every requested nonsecret HostConfig field against the actual raw
 // daemon response, then hash the complete public profile including defaults.
 for(const key of Object.keys(h)){
  // Docker's closed empty Ulimits/PortBindings forms carry no additional grant;
  // preserve the observed raw form in the profile hash rather than normalize it.
  if(key==='Ulimits'&&Array.isArray(h[key])&&h[key].length===0&&(actual[key]===null||(Array.isArray(actual[key])&&actual[key].length===0)))continue;
  if(key==='PortBindings'&&Object.keys(obj(h[key])).length===0&&(actual[key]===null||Object.keys(obj(actual[key])).length===0))continue;
  if(!equal(actual[key],h[key]))return fail();
 }
 if(actual.ReadonlyRootfs!==true||actual.Privileged!==false||actual.Init!==true||actual.AutoRemove!==false||actual.PublishAllPorts!==false||!equal(actual.CapDrop,['ALL'])
  ||(actual.CapAdd!==null&&(!Array.isArray(actual.CapAdd)||actual.CapAdd.length))||actual.PidMode||actual.IpcMode==='host'||actual.UsernsMode==='host'
  ||(actual.Devices!==null&&(!Array.isArray(actual.Devices)||actual.Devices.length))||(actual.DeviceRequests!==null&&(!Array.isArray(actual.DeviceRequests)||actual.DeviceRequests.length))
  ||actual.Memory!==request.limits.memoryBytes||actual.NanoCpus!==request.limits.cpuMillis*1000000||actual.PidsLimit!==Math.min(request.limits.pidsLimit,request.limits.processLimit))return fail();
 const mounts=raw.Mounts.map(obj),workspace=mounts.filter(m=>m.Destination==='/workspace');
 if(workspace.length!==1||workspace[0]!.Type!=='bind'||workspace[0]!.Source!==request.storagePath||workspace[0]!.RW!==true||workspace[0]!.Propagation!=='rprivate'||mounts.some(m=>m.Type==='bind'?m.Destination!=='/workspace':m.Type!=='tmpfs'||typeof m.Destination!=='string'||!Object.hasOwn(obj(h.Tmpfs),m.Destination)))return fail();
 const networks=obj(obj(raw.NetworkSettings).Networks),names=Object.keys(endpoints);
 if(names.length!==1||Object.keys(networks).sort().join('|')!==names.sort().join('|')||actual.NetworkMode!==names[0])return fail();
 const profile={User:c.User,WorkingDir:c.WorkingDir,Entrypoint:c.Entrypoint,Cmd:c.Cmd,HostConfig:actual,Mounts:raw.Mounts,AppArmorProfile:raw.AppArmorProfile};
 return decodeRuntimeOriginalProvision({schemaVersion:1,kind:'original-runtime-provision-v1',requestId:request.originalRequestId,requestSha256:provisionHash(request),runtimeId:request.runtimeId,parentContainerId:input.createdId,daemonId:daemon.ID,hostId:'docker-daemon:'+provisionHash('veyra-docker-host-v1\0'+daemon.ID),imageId:input.imageId,startIdentity:provisionHash([s.StartedAt,raw.RestartCount]),publicProfileSha256:provisionHash(profile),specSha256:provisionHash(publicProvisionSpec(spec)),workspaceId:request.workspaceId,organizationId:request.organizationId,projectId:request.projectId,ownerUserId:request.ownerUserId,bindingHash:request.storageMappingHash,bindingEpoch:request.securityEpoch,provisioningRevision:request.revision,limits:request.limits,containerCreatedAt:raw.Created});
}
/** Validated metadata/read DTO, never proof that a network request was made. */
export function decodeRuntimeOriginalProvision(value:unknown):RuntimeOriginalProvision{
 const v=obj(value),keys=['schemaVersion','kind','requestId','requestSha256','runtimeId','parentContainerId','daemonId','hostId','imageId','startIdentity','publicProfileSha256','specSha256','workspaceId','organizationId','projectId','ownerUserId','bindingHash','bindingEpoch','provisioningRevision','limits','containerCreatedAt'];
 if(Object.keys(v).sort().join('|')!==keys.sort().join('|')||v.schemaVersion!==1||v.kind!=='original-runtime-provision-v1'
  ||![v.requestId,v.runtimeId,v.organizationId,v.projectId,v.ownerUserId].every(x=>typeof x==='string'&&UUID.test(x))
  ||![v.requestSha256,v.parentContainerId,v.startIdentity,v.publicProfileSha256,v.specSha256,v.bindingHash].every(x=>typeof x==='string'&&HEX.test(x))
  ||!text(v.workspaceId,256)||!text(v.daemonId,256)||v.hostId!=='docker-daemon:'+provisionHash('veyra-docker-host-v1\0'+v.daemonId)
  ||typeof v.imageId!=='string'||!/^sha256:[a-f0-9]{64}$/u.test(v.imageId)||!integer(v.bindingEpoch)||!integer(v.provisioningRevision)||!stamp(v.containerCreatedAt))return fail();
 return frozen({...v,limits:limits(v.limits)}) as unknown as RuntimeOriginalProvision;
}
export function validateProvisionResponse(value:unknown,request:PublicProvisionRequest,backendId:unknown):RuntimeOriginalProvision{
 const original=decodeRuntimeOriginalProvision(value),expected=publicProvisionRequest(request);
 if(original.requestId!==expected.originalRequestId||original.requestSha256!==provisionHash(expected)||original.parentContainerId!==backendId||original.runtimeId!==expected.runtimeId
  ||original.organizationId!==expected.organizationId||original.projectId!==expected.projectId||original.ownerUserId!==expected.ownerUserId||original.workspaceId!==expected.workspaceId||original.bindingHash!==expected.storageMappingHash||original.bindingEpoch!==expected.securityEpoch||original.provisioningRevision!==expected.revision||!equal(original.limits,expected.limits))return fail();
 return original;
}
export interface OriginalDb{prepare(sql:string):{get(...args:unknown[]):unknown;run(...args:unknown[]):{changes:number|bigint}}}
interface ProvisionRuntimeRow{id:string;workspace_id:string;organization_id:string;project_id:string;owner_user_id:string;state:string;revision:number;security_epoch:number;cpu_millis:number;memory_bytes:number;pids_limit:number;disk_bytes:number;process_limit:number;backend_container_id:string|null;lease_owner_hash:string|null;lease_expires_at:string|null}
export interface StoredRuntimeOriginalProvision extends RuntimeOriginalProvision{readonly recordedAt:string}
const originalColumns=`runtime_id,parent_container_id,daemon_id,host_id,image_id,start_identity,public_profile_sha256,spec_sha256,workspace_id,organization_id,project_id,owner_user_id,binding_hash,binding_epoch,provisioning_revision,request_id,request_sha256,cpu_millis,memory_bytes,pids_limit,disk_bytes,process_limit,container_created_at,created_at`;
export function readRuntimeOriginalProvision(db:OriginalDb,id:string):StoredRuntimeOriginalProvision|undefined{
 if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='runtime_original_provisions'").get())return undefined;
 const raw=db.prepare('SELECT * FROM runtime_original_provisions WHERE runtime_id=?').get(id);if(!raw)return undefined;
 const r=obj(raw);if(!stamp(r.created_at))return fail();
 const value=decodeRuntimeOriginalProvision({schemaVersion:1,kind:'original-runtime-provision-v1',runtimeId:r.runtime_id,parentContainerId:r.parent_container_id,daemonId:r.daemon_id,hostId:r.host_id,imageId:r.image_id,startIdentity:r.start_identity,publicProfileSha256:r.public_profile_sha256,specSha256:r.spec_sha256,workspaceId:r.workspace_id,organizationId:r.organization_id,projectId:r.project_id,ownerUserId:r.owner_user_id,bindingHash:r.binding_hash,bindingEpoch:r.binding_epoch,provisioningRevision:r.provisioning_revision,requestId:r.request_id,requestSha256:r.request_sha256,limits:{cpuMillis:r.cpu_millis,memoryBytes:r.memory_bytes,pidsLimit:r.pids_limit,diskBytes:r.disk_bytes,processLimit:r.process_limit},containerCreatedAt:r.container_created_at});
 return frozen({...value,recordedAt:r.created_at});
}
/** Invoke ONLY inside the original transitionRuntime transaction before UPDATE.
 * Authenticated-client ownership is checked in the API producer, not minted by
 * this metadata validator. Existing immutable originals are never overwritten.
 */
export function insertRuntimeOriginalProvision(db:OriginalDb,current:ProvisionRuntimeRow,input:{toState:string;actorType:string;actorId:string;backendContainerId?:string|null;originalProvision?:RuntimeOriginalProvision},timestamp:string):void{
 if(!input.originalProvision)return;
 if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='runtime_original_provisions'").get())return; // staged rollout stays legacy/unqualified
 const p=decodeRuntimeOriginalProvision(input.originalProvision),l=p.limits;
 if(current.state!=='PROVISIONING'||input.toState!=='STARTING'||input.actorType!=='manager'||input.actorId!=='runtime-manager'||current.backend_container_id!==null||input.backendContainerId!==p.parentContainerId
  ||p.runtimeId!==current.id||p.provisioningRevision!==current.revision||p.organizationId!==current.organization_id||p.projectId!==current.project_id||p.ownerUserId!==current.owner_user_id||p.workspaceId!==current.workspace_id||p.bindingEpoch!==current.security_epoch
  ||l.cpuMillis!==current.cpu_millis||l.memoryBytes!==current.memory_bytes||l.pidsLimit!==current.pids_limit||l.diskBytes!==current.disk_bytes||l.processLimit!==current.process_limit
  ||!current.lease_owner_hash||!current.lease_expires_at||current.lease_expires_at<=timestamp)return fail();
 const workspace=db.prepare("SELECT * FROM authorized_workspaces WHERE id=? AND organization_id=? AND project_id=? AND owner_user_id=? AND status='authorized' AND security_epoch=? AND storage_mapping_hash=?").get(p.workspaceId,p.organizationId,p.projectId,p.ownerUserId,p.bindingEpoch,p.bindingHash);if(!workspace)return fail();
 const binding=db.prepare("SELECT 1 FROM runtime_capability_bindings b JOIN mcp_credentials c ON c.id=b.mcp_credential_id JOIN service_principals sp ON sp.id=c.service_principal_id WHERE b.runtime_id=? AND b.organization_id=? AND b.project_id=? AND b.owner_user_id=? AND b.workspace_id=? AND b.security_epoch=? AND b.revoked_at IS NULL AND b.expires_at>? AND c.revoked_at IS NULL AND c.expires_at=b.expires_at AND c.kind='runtime' AND c.audience='runtime' AND c.organization_id=b.organization_id AND c.project_id=b.project_id AND c.workspace_id=b.workspace_id AND c.created_by_user_id=b.owner_user_id AND c.security_epoch=b.security_epoch AND sp.organization_id=b.organization_id AND sp.security_epoch=b.security_epoch AND sp.status='active'").get(p.runtimeId,p.organizationId,p.projectId,p.ownerUserId,p.workspaceId,p.bindingEpoch,timestamp);if(!binding)return fail();
 // A replacement runtime keeps existing legacy lifecycle behavior, but cannot
 // overwrite/requalify the initial physical original under the same runtimeId.
 if(readRuntimeOriginalProvision(db,p.runtimeId))return;
 const values=[p.runtimeId,p.parentContainerId,p.daemonId,p.hostId,p.imageId,p.startIdentity,p.publicProfileSha256,p.specSha256,p.workspaceId,p.organizationId,p.projectId,p.ownerUserId,p.bindingHash,p.bindingEpoch,p.provisioningRevision,p.requestId,p.requestSha256,l.cpuMillis,l.memoryBytes,l.pidsLimit,l.diskBytes,l.processLimit,p.containerCreatedAt,timestamp];
 if(Number(db.prepare(`INSERT INTO runtime_original_provisions(${originalColumns}) VALUES(${values.map(()=>'?').join(',')})`).run(...values).changes)!==1)return fail();
}
