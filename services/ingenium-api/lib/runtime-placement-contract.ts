import { createHash } from "node:crypto";
import type { PlacementRequest, TrustedPlacement } from "./projects-v2/request-execution-owner.mjs";

export interface ManagedRuntimeObservation {
  schemaVersion: 1; hostId: string; runtimeId: string; backendId: string; backendName: string;
  organizationId: string; ownerUserId: string; projectId: string; workspaceId: string;
  bindingHash: string; bindingEpoch: number; runtimeRevision: number; imageRevision: string;
  state: "running"; health: "healthy"; observedAt: number; expiresAt: number;
}
export interface ManagedContainerFacts {
  Id?: string; Name?: string; Config?: { Labels?: Record<string,string> };
  State?: { Status?: string; Health?: { Status?: string } };
}
const text=(v:unknown,max=512):v is string=>typeof v==="string" && v.length>0 && v.length<=max && v===v.trim() && !/[\u0000-\u001f\u007f]/u.test(v);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const sha=(v:unknown,n=64):v is string=>typeof v==="string" && new RegExp(`^[a-f0-9]{${n}}$`,"u").test(v);
const integer=(v:unknown):v is number=>typeof v==="number" && Number.isSafeInteger(v) && v>=0;
const invalid=():never=>{throw Error("Managed runtime placement evidence is invalid");};
const numberLabel=(value:string|undefined):number=>{
  if(!value || !/^(0|[1-9][0-9]*)$/u.test(value))return invalid(); const result=Number(value);
  if(!integer(result))return invalid(); return result;
};
/** Called only by the authenticated existing manager over its original Docker socket. */
export function observeManagedRuntime(container:ManagedContainerFacts,daemonId:unknown,now:number):ManagedRuntimeObservation {
  const labels=container.Config?.Labels??{},runtimeId=labels["com.ingenium.runtime.id"],name=container.Name?.replace(/^\//u,"");
  if(!text(daemonId,256) || (!integer(now) || !integer(now+5_000)) || !runtimeId || !UUID.test(runtimeId)
    || labels["com.ingenium.managed"]!=="runtime-manager" || name!==`ingenium-runtime-${runtimeId.replaceAll("-","")}`
    || !sha(container.Id) || !sha(labels["org.opencontainers.image.revision"],40)
    || container.State?.Status!=="running" || container.State.Health?.Status!=="healthy")return invalid();
  const scope={organizationId:labels["com.ingenium.runtime.organization"],ownerUserId:labels["com.ingenium.runtime.owner"],
    projectId:labels["com.ingenium.runtime.project"],workspaceId:labels["com.ingenium.runtime.workspace"]};
  if(!text(scope.organizationId)||!text(scope.ownerUserId)||!text(scope.projectId)||!text(scope.workspaceId)
    || !sha(labels["com.ingenium.runtime.storage"]))return invalid();
  return Object.freeze({schemaVersion:1,hostId:"docker-daemon:"+createHash("sha256").update("veyra-docker-host-v1\0"+daemonId).digest("hex"),
    runtimeId,backendId:container.Id,backendName:name,organizationId:scope.organizationId,ownerUserId:scope.ownerUserId,
    projectId:scope.projectId,workspaceId:scope.workspaceId,bindingHash:labels["com.ingenium.runtime.storage"],
    bindingEpoch:numberLabel(labels["com.ingenium.runtime.security-epoch"]),runtimeRevision:numberLabel(labels["com.ingenium.runtime.revision"]),
    imageRevision:labels["org.opencontainers.image.revision"],state:"running",health:"healthy",observedAt:now,expiresAt:now+5_000});
}
export function isManagedRuntimeObservation(value:unknown):value is ManagedRuntimeObservation {
  if(!value || typeof value!=="object" || Array.isArray(value))return false;
  const v=value as Record<string,unknown>;
  const keys=["schemaVersion","hostId","runtimeId","backendId","backendName","organizationId","ownerUserId","projectId","workspaceId","bindingHash","bindingEpoch","runtimeRevision","imageRevision","state","health","observedAt","expiresAt"];
  return Object.keys(v).sort().join("|")===keys.sort().join("|") && v.schemaVersion===1
    && text(v.hostId) && /^docker-daemon:[a-f0-9]{64}$/u.test(v.hostId) && text(v.runtimeId)
    && UUID.test(v.runtimeId) && sha(v.backendId) && v.backendName===`ingenium-runtime-${v.runtimeId.replaceAll("-","")}`
    && [v.organizationId,v.ownerUserId,v.projectId,v.workspaceId].every(x=>text(x)) && sha(v.bindingHash) && sha(v.imageRevision,40)
    && integer(v.bindingEpoch) && integer(v.runtimeRevision) && v.state==="running" && v.health==="healthy"
    && integer(v.observedAt) && integer(v.expiresAt) && v.expiresAt-v.observedAt===5_000;
}
/** Request-local qualification; an observation is never an authorization grant. */
export function qualifyManagedRuntimePlacement(expected:PlacementRequest,observation:unknown,installationId:unknown):TrustedPlacement|null {
  if(!isManagedRuntimeObservation(observation)||!sha(installationId,32)||!integer(expected.now)
    || observation.observedAt>expected.now || observation.expiresAt<=expected.now
    || observation.runtimeId!==expected.runtimeId || observation.backendId!==expected.backendContainerId
    || observation.backendName!==expected.backendName || observation.organizationId!==expected.organizationId
    || observation.ownerUserId!==expected.ownerUserId || observation.projectId!==expected.projectId
    || observation.workspaceId!==expected.workspaceId || observation.bindingHash!==expected.bindingHash
    || observation.bindingEpoch!==expected.bindingEpoch || observation.runtimeRevision!==expected.runtimeRevision)return null;
  const {now,...facts}=expected; void now;
  return Object.freeze({...facts,hostId:observation.hostId,environmentId:`managed-runtime-v1:${installationId}`,
    observedAt:observation.observedAt,expiresAt:observation.expiresAt});
}