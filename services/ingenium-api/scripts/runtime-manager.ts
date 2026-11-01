import {createOriginalManagerPeerOwner,MANAGER_ORIGINAL_CONNECTION_PATH} from '../lib/dot-v2/manager-peer-source.mjs';
import {workspaceDocker,workspaceDockerJson,joinWorkspaceAttach,requireRetainedWorkspaceAttach,joinStoppedWorkspaceAttach} from '../lib/projects-v2/workspace-manager-wire.mjs';
import {verifyWorkspaceArchive} from '../lib/projects-v2/workspace-v2-image.mjs';
import {parseStrictJobJson} from '../lib/dot-v2/job-bootstrap-frame.mjs';
import {buildWorkspaceRuntimeContainerSpecV2,type WorkspaceRuntimeProvisionRequestV2} from '../lib/runtime-manager-contract.js';
import {createOriginalCandidateWaitingOwner} from '../lib/dot-v2/candidate-original-manager.mjs';
import {createOriginalCandidateClosureProducer} from '../../../packages/veyra-operations/core126-candidate-observation.mjs';
import {createCore126ManagerProofProducer} from "../../../packages/veyra-operations/core126-manager-proof.mjs";
import {publicContainer as publicJobParent,hash as jobParentHash} from "../../../packages/veyra-operations/core126-image-contract.mjs";
import { createServer, request as httpRequest } from "node:http";
import { timingSafeEqual } from "node:crypto";
import * as runtimeProvision from "ingenium-core/lib/tools/runtime-original-provision";
import { pathToFileURL } from "node:url";
import {
  buildRuntimeContainerSpec,
  readWorkspaceMappings,
  runtimeLabels,
  type RuntimeProvisionRequest,
} from "../lib/runtime-manager-contract.js";

import { createManagedJobContainerOwner } from "../lib/dot-v2/managed-job-owner.mjs";
import { createManagedJobCoreClient } from "../lib/dot-v2/managed-job-core-client.mjs";
import { loadManagerToken } from "../lib/runtime-manager-auth.js";
import { observeManagedRuntime } from "../lib/runtime-placement-contract.js";

const DOCKER_SOCKET = "/var/run/docker.sock";
const MAX_BODY_BYTES = 64 * 1024;
const MAX_DOCKER_RESPONSE_BYTES = 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IMAGE_REVISION = /^[0-9a-f]{40}$/;

type DockerResponse<T> = { status: number; data: T | null; raw: string };
type DockerInspect = {
  Id?: string;
  Name?: string;
  Image?: string;
  Config?: { Labels?: Record<string, string> };
  State?: { Status?: string; Health?: { Status?: string } };
};
type DockerNetworkInspect = {
  Internal?: boolean;
  Labels?: Record<string, string>;
  Containers?: Record<string, { Name?: string }>;
};

function environment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}


function authorized(header: string | undefined, token: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const provided = header.slice(7);
  const left = Buffer.from(provided);
  const right = Buffer.from(token);
  return left.length === right.length && timingSafeEqual(left, right);
}

function dockerRequest<T>(method: string, path: string, body?: Buffer | object, contentType = "application/json"): Promise<DockerResponse<T>> {
  const payload = body === undefined ? undefined : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      socketPath: DOCKER_SOCKET,
      path: `/v1.45${path}`,
      method,
      headers: payload ? { "Content-Type": contentType, "Content-Length": payload.length } : undefined,
      timeout: 10_000,
    }, (response) => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > MAX_DOCKER_RESPONSE_BYTES) {
          response.destroy(new Error("Docker response exceeded limit"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let data: T | null = null;
        if (raw) {
          try { data = JSON.parse(raw) as T; } catch { data = null; }
        }
        resolve({ status: response.statusCode ?? 500, data, raw });
      });
    });
    request.on("timeout", () => request.destroy(new Error("Docker request timed out")));
    request.on("error", reject);
    if (payload) request.write(payload);
    request.end();
  });
}

function dockerHijack(path: string, body: object | undefined, input: Buffer): Promise<Buffer> {
  const payload = body === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const request = httpRequest({
      socketPath: DOCKER_SOCKET,
      path: `/v1.45${path}`,
      method: "POST",
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        "Content-Length": payload.length,
        Connection: "Upgrade",
        Upgrade: "tcp",
      },
      timeout: 10_000,
    });
    request.on("upgrade", (response, socket) => {
      if (response.statusCode !== 101) {
        socket.destroy();
        reject(new Error("Docker stream upgrade failed"));
        return;
      }
      socket.setTimeout(10_000, () => socket.destroy(new Error("Docker stream timed out")));
      socket.on("error", reject);
      socket.on("data", (chunk: Buffer) => chunks.push(chunk));
      socket.on("finish", () => {
        socket.setTimeout(0);
        setTimeout(() => {
          socket.destroy();
          resolve(Buffer.concat(chunks));
        }, 100);
      });
      socket.end(input);
    });
    request.on("response", (response) => {
      response.resume();
      reject(new Error(`Docker stream request failed (${response.statusCode ?? 500})`));
    });
    request.on("timeout", () => request.destroy(new Error("Docker stream request timed out")));
    request.on("error", reject);
    request.end(payload);
  });
}

async function handoffOriginalJobFrame(container:string,capability:string,agentMaterial:unknown):Promise<void>{
 const payload=Buffer.from(JSON.stringify({capability,agentMaterial})+"\n","utf8");
 if(payload.length>384*1024+256)throw Error("Original JobRun frame exceeds its bound");
 await dockerHijack(`/containers/${encodeURIComponent(container)}/attach?stream=1&stdin=1&stdout=0&stderr=0`,undefined,payload);
}

async function handoffRuntimeCapability(container: string, capability: string): Promise<void> {
  await dockerHijack(
    `/containers/${encodeURIComponent(container)}/attach?stream=1&stdin=1&stdout=0&stderr=0`,
    undefined,
    Buffer.from(`${capability}\n`, "utf8"),
  );
}

async function ensureRuntimeNetwork(name: string, runtimeId: string): Promise<void> {
  const inspected = await dockerRequest<DockerNetworkInspect>("GET", `/networks/${encodeURIComponent(name)}`);
  if (inspected.status === 404) {
    const created = await dockerRequest("POST", "/networks/create", {
      Name: name,
      Internal: false,
      Attachable: false,
      CheckDuplicate: true,
      Labels: { "com.ingenium.managed": "runtime-manager", "com.ingenium.runtime.id": runtimeId },
    });
    if (created.status !== 201 && created.status !== 409) throw new Error("Runtime network creation failed");
  } else if (inspected.status !== 200) {
    throw new Error("Runtime network inspection failed");
  }
  const verified = await dockerRequest<DockerNetworkInspect>("GET", `/networks/${encodeURIComponent(name)}`);
  if (verified.status !== 200 || verified.data?.Internal !== false || verified.data.Labels?.["com.ingenium.managed"] !== "runtime-manager"
    || verified.data.Labels?.["com.ingenium.runtime.id"] !== runtimeId) {
    throw new Error("Runtime network identity is invalid");
  }
}

async function inspectControlPlane(): Promise<DockerInspect> {
  const container = environment("INGENIUM_CONTROL_PLANE_CONTAINER");
  const inspected = await dockerRequest<DockerInspect>("GET", `/containers/${encodeURIComponent(container)}/json`);
  if (inspected.status !== 200 || inspected.data?.Config?.Labels?.["com.ingenium.control-plane"] !== "true") {
    throw new Error("Control-plane container identity is invalid");
  }
  return inspected.data;
}

async function inspectRuntimeGateway(): Promise<DockerInspect> {
  const container = environment("INGENIUM_RUNTIME_GATEWAY_CONTAINER");
  const inspected = await dockerRequest<DockerInspect>("GET", `/containers/${encodeURIComponent(container)}/json`);
  if (inspected.status !== 200 || inspected.data?.Config?.Labels?.["com.ingenium.runtime-gateway"] !== "true") {
    throw new Error("Runtime gateway container identity is invalid");
  }
  return inspected.data;
}

async function connectControlPlane(network: string): Promise<void> {
  const inspected = await inspectControlPlane();
  const container = environment("INGENIUM_CONTROL_PLANE_CONTAINER");
  const connected = await dockerRequest("POST", `/networks/${encodeURIComponent(network)}/connect`, {
    Container: container,
    EndpointConfig: { Aliases: ["ingenium-control-plane"] },
  });
  if (connected.status !== 200 && connected.status !== 403) throw new Error("Control-plane runtime network attachment failed");
  const verified = await dockerRequest<DockerNetworkInspect>("GET", `/networks/${encodeURIComponent(network)}`);
  if (verified.status !== 200 || !inspected.Id || !verified.data?.Containers?.[inspected.Id]) {
    throw new Error("Control-plane runtime network attachment is invalid");
  }
}

async function connectRuntimeGateway(network: string): Promise<void> {
  const inspected = await inspectRuntimeGateway();
  const container = environment("INGENIUM_RUNTIME_GATEWAY_CONTAINER");
  const connected = await dockerRequest("POST", `/networks/${encodeURIComponent(network)}/connect`, {
    Container: container,
    EndpointConfig: { Aliases: ["ingenium-runtime-gateway"] },
  });
  if (connected.status !== 200 && connected.status !== 403) throw new Error("Runtime gateway network attachment failed");
  const verified = await dockerRequest<DockerNetworkInspect>("GET", `/networks/${encodeURIComponent(network)}`);
  if (verified.status !== 200 || !inspected.Id || !verified.data?.Containers?.[inspected.Id]) {
    throw new Error("Runtime gateway network attachment is invalid");
  }
}

function assertContainerIdentity(inspect: DockerInspect, runtimeId: string, expected?: Record<string, string>): void {
  const labels = inspect.Config?.Labels ?? {};
  if (!inspect.Id || !/^[0-9a-f]{64}$/.test(inspect.Id) || labels["com.ingenium.managed"] !== "runtime-manager"
    || labels["com.ingenium.runtime.id"] !== runtimeId
    || (expected && Object.entries(expected).some(([key, value]) => labels[key] !== value))) {
    throw new Error("Runtime container identity is invalid");
  }
}

async function inspectRuntime(runtimeId: string): Promise<DockerInspect | null> {
  const name = `ingenium-runtime-${runtimeId.replaceAll("-", "")}`;
  const inspected = await dockerRequest<DockerInspect>("GET", `/containers/${encodeURIComponent(name)}/json`);
  if (inspected.status === 404) return null;
  if (inspected.status !== 200 || !inspected.data) throw new Error("Runtime inspection failed");
  assertContainerIdentity(inspected.data, runtimeId);
  return inspected.data;
}

function runtimeNetworkName(runtimeId: string): string {
  if (!UUID.test(runtimeId)) throw new Error("Runtime identity is invalid");
  return `${environment("INGENIUM_RUNTIME_NETWORK_PREFIX")}${runtimeId.replaceAll("-", "")}`;
}

async function removeRuntimeResources(runtimeId: string): Promise<void> {
  const name = `ingenium-runtime-${runtimeId.replaceAll("-", "")}`;
  const runtime = await inspectRuntime(runtimeId);
  if (runtime?.State?.Status === "running") {
    const stopped = await dockerRequest("POST", `/containers/${encodeURIComponent(name)}/stop?t=30`);
    if (stopped.status !== 204 && stopped.status !== 304) throw new Error("Runtime removal stop failed");
  }
  if (runtime) {
    const removed = await dockerRequest("DELETE", `/containers/${encodeURIComponent(name)}?v=true`);
    if (removed.status !== 204 && removed.status !== 404) throw new Error("Runtime container removal failed");
  }

  const network = runtimeNetworkName(runtimeId);
  const inspectedNetwork = await dockerRequest<DockerNetworkInspect>("GET", `/networks/${encodeURIComponent(network)}`);
  if (inspectedNetwork.status === 404) return;
  if (inspectedNetwork.status !== 200 || inspectedNetwork.data?.Labels?.["com.ingenium.managed"] !== "runtime-manager"
    || inspectedNetwork.data.Labels?.["com.ingenium.runtime.id"] !== runtimeId) {
    throw new Error("Runtime network identity is invalid");
  }
  const endpoints = Object.keys(inspectedNetwork.data.Containers ?? {});
  if (endpoints.length > 0) {
    const controlPlane = await inspectControlPlane();
    const gateway = await inspectRuntimeGateway();
    const owned = new Set([controlPlane.Id, gateway.Id].filter((id): id is string => Boolean(id)));
    if (owned.size !== 2 || endpoints.some((id) => !owned.has(id))) throw new Error("Runtime network has foreign endpoints");
    for (const container of [environment("INGENIUM_CONTROL_PLANE_CONTAINER"), environment("INGENIUM_RUNTIME_GATEWAY_CONTAINER")]) {
      const disconnected = await dockerRequest("POST", `/networks/${encodeURIComponent(network)}/disconnect`, {
        Container: container,
        Force: false,
      });
      if (disconnected.status !== 200 && disconnected.status !== 404) throw new Error("Runtime network detach failed");
    }
  }
  const removedNetwork = await dockerRequest("DELETE", `/networks/${encodeURIComponent(network)}`);
  if (removedNetwork.status !== 204 && removedNetwork.status !== 404) throw new Error("Runtime network removal failed");
}

// Only the original private POST new-create flow populates this map. Inspect,
// labels or a replayed/current container cannot construct an original receipt.
const originalProvisionResponses=new WeakMap<DockerInspect,{disposition:"new_created"|"existing_reused"|"legacy_unqualified";original:runtimeProvision.RuntimeOriginalProvision|null}>();
async function provisionRuntime(input: RuntimeProvisionRequest, mappings: ReturnType<typeof readWorkspaceMappings>): Promise<DockerInspect> {
  const mapping = mappings.get(input.workspaceId);
  if (!mapping) throw new Error("Workspace mapping is unavailable");
  const config = {
    image: environment("INGENIUM_USER_RUNTIME_IMAGE"),
    network: runtimeNetworkName(input.runtimeId),
    apiUrl: environment("INGENIUM_RUNTIME_API_URL"),
  };
  let spec = buildRuntimeContainerSpec(input, mapping, config);
  await ensureRuntimeNetwork(config.network, input.runtimeId);
  await connectControlPlane(config.network);
  await connectRuntimeGateway(config.network);
  const expectedLabels = runtimeLabels(input);
  const prior = await inspectRuntime(input.runtimeId);
  if (prior) {
    const exact = Object.entries(expectedLabels).every(([key, value]) => prior.Config?.Labels?.[key] === value);
    if (exact && prior.State?.Status === "running") {originalProvisionResponses.set(prior,{disposition:"existing_reused",original:null});return prior;}
    if (prior.State?.Status === "running") {
      const stopped = await dockerRequest("POST", `/containers/${encodeURIComponent(input.backendName)}/stop?t=30`);
      if (stopped.status !== 204 && stopped.status !== 304) throw new Error("Stale runtime container stop failed");
    }
    const removed = await dockerRequest("DELETE", `/containers/${encodeURIComponent(input.backendName)}?v=true`);
    if (removed.status !== 204 && removed.status !== 404) throw new Error("Stale runtime container removal failed");
  }
  let originalCandidate:{daemon:{ID?:string};imageId:string}|null=null;
  if(input.originalRequestId){
    try{
      runtimeProvision.publicProvisionRequest({...input,originalRequestId:input.originalRequestId});
      const daemon=await dockerRequest<{ID?:string}>("GET","/info");
      const image=await dockerRequest<{Id?:string}>("GET",`/images/${encodeURIComponent(config.image)}/json`);
      if(daemon.status!==200||!daemon.data?.ID||image.status!==200||!/^sha256:[a-f0-9]{64}$/.test(image.data?.Id??""))throw Error("Original provision prerequisites unavailable");
      originalCandidate={daemon:daemon.data,imageId:image.data!.Id!};
      spec={...spec,Image:originalCandidate.imageId}; // immutable create image
    }catch{/* Preserve legacy lifecycle, but never qualify without an original. */}
  }
  try {
    const created = await dockerRequest<{ Id?: string }>("POST", `/containers/create?name=${encodeURIComponent(input.backendName)}`, spec);
    if (created.status !== 201) throw new Error("Runtime container creation failed");
    const existing = await inspectRuntime(input.runtimeId);
    if (!existing) throw new Error("Runtime container was not created");
    assertContainerIdentity(existing, input.runtimeId, expectedLabels);
    const started = await dockerRequest("POST", `/containers/${encodeURIComponent(input.backendName)}/start`);
    if (started.status !== 204 && started.status !== 304) throw new Error("Runtime container start failed");
    await handoffRuntimeCapability(input.backendName, input.capability);
    const ready = await inspectRuntime(input.runtimeId);
    if (!ready) throw new Error("Runtime disappeared after start");
    originalProvisionResponses.set(ready,{disposition:"legacy_unqualified",original:null});
    if(originalCandidate){
      try{
        const daemonAfter=await dockerRequest<{ID?:string}>("GET","/info");
        if(daemonAfter.status!==200||!daemonAfter.data)throw Error("Original daemon unavailable");
        const original=runtimeProvision.originalProvisionFromNewFlow({request:{...input,originalRequestId:input.originalRequestId!},spec,
          daemonBefore:originalCandidate.daemon,daemonAfter:daemonAfter.data,imageId:originalCandidate.imageId,createdId:created.data?.Id,
          createStatus:created.status,startStatus:started.status,attachJoined:true,container:ready});
        originalProvisionResponses.set(ready,{disposition:"new_created",original});
      }catch{/* A missing/changed birth witness refuses Dot qualification only. */}
    }
    return ready;
  } catch (error) {
    const logs = await dockerRequest<never>("GET", `/containers/${encodeURIComponent(input.backendName)}/logs?stdout=1&stderr=1&tail=20`).catch(() => null);
    if (logs?.status === 200 && logs.raw) {
      console.error("Runtime startup diagnostics:", logs.raw.replace(/[^\x20-\x7e\n\t]/g, "").slice(-2_048));
    }
    await removeRuntimeResources(input.runtimeId).catch(() => undefined);
    throw error;
  }
}

async function stopRuntime(runtimeId: string): Promise<DockerInspect | null> {
  const inspected = await inspectRuntime(runtimeId);
  if (!inspected) return null;
  if (inspected.State?.Status === "running") {
    const name = `ingenium-runtime-${runtimeId.replaceAll("-", "")}`;
    const stopped = await dockerRequest("POST", `/containers/${encodeURIComponent(name)}/stop?t=30`);
    if (stopped.status !== 204 && stopped.status !== 304) throw new Error("Runtime stop failed");
  }
  return inspectRuntime(runtimeId);
}

function publicInspect(inspect: DockerInspect | null): object {
  if (!inspect) return { state: "absent", health: "absent" };
  const runtimeId = inspect.Config?.Labels?.["com.ingenium.runtime.id"];
  const imageRevision = inspect.Config?.Labels?.["org.opencontainers.image.revision"];
  if (!runtimeId || !UUID.test(runtimeId) || !imageRevision || !IMAGE_REVISION.test(imageRevision)) {
    throw new Error("Runtime image provenance is invalid");
  }
  return {
    backendId: inspect.Id,
    backendName: inspect.Name?.replace(/^\//, ""),
    runtimeId,
    imageRevision,
    state: inspect.State?.Status ?? "unknown",
    health: inspect.State?.Health?.Status ?? "unknown",
  };
}

export async function respondWithRuntimeInspect(
  response: import("node:http").ServerResponse,
  operation: () => Promise<DockerInspect | null>,
): Promise<void> {
  const inspect = await operation();
  const body = JSON.stringify({ data: publicInspect(inspect) });
  response.writeHead(200).end(body);
}

async function readJsonBody(request: import("node:http").IncomingMessage, strict = false): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_BODY_BYTES) throw new Error("Request body exceeded limit");
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks);
  return strict ? parseStrictJobJson(raw, MAX_BODY_BYTES) : JSON.parse(raw.toString("utf8"));
}

// Additive private methods in actual scripts/runtime-manager.ts. v1 is unchanged.
const workspaceV2Attempts=new Map<string,{requestSha256:string;phase:string;containerId?:string;failure?:string;failurePhase?:string}>();
async function workspaceV2Core(operation:'admission'|'original'|'retirement',body:unknown):Promise<any>{
 const base=new URL(environment('INGENIUM_RUNTIME_API_URL'));
 if(base.protocol!=='http:'||base.pathname!=='/api/v1'||base.username||base.password||base.search||base.hash)throw Error('WORKSPACE_V2_CORE_URL');
 base.pathname+='/internal/workspace-runtime-v2/'+operation;
 const response=await fetch(base,{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+loadManagerToken(),'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
 if(response.status!==200||!response.body)throw Error('WORKSPACE_V2_CORE_OWNER_UNAVAILABLE');
 let size=0;const chunks:Buffer[]=[];for await(const chunk of response.body){size+=chunk.length;if(size>1024*1024)throw Error('WORKSPACE_V2_CORE_BOUND');chunks.push(Buffer.from(chunk));}
 const envelope=parseStrictJobJson(Buffer.concat(chunks),1024*1024) as {data?:unknown};if(!envelope.data)throw Error('WORKSPACE_V2_CORE_RESPONSE');return envelope.data;
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
function workspaceV2Parent(raw:any,expected:any,original?:any,retirement=false){
 const c=raw?.Config,h=raw?.HostConfig,s=raw?.State,l=c?.Labels??{};
 if(!raw||!/^([a-f0-9]{64})$/.test(raw.Id)||raw.Name!=='/'+expected.backendName||c.User!=='1000:1000'||c.WorkingDir!=='/workspace'||l['com.ingenium.managed']!=='runtime-manager'||l['com.ingenium.runtime.scope']!=='workspace'||Object.hasOwn(l,'com.ingenium.runtime.project')
 ||l['com.ingenium.runtime.id']!==expected.runtimeId||l['com.ingenium.runtime.organization']!==expected.organizationId||l['com.ingenium.runtime.owner']!==expected.ownerUserId||l['com.ingenium.runtime.workspace']!==expected.workspaceId||l['com.ingenium.runtime.storage']!==expected.storageMappingHash||l['com.ingenium.runtime.security-epoch']!==String(expected.securityEpoch)||l['com.ingenium.runtime.revision']!==String(expected.revision)
 ||!/^([a-f0-9]{40})$/.test(l['org.opencontainers.image.revision']??''))throw Error('WORKSPACE_V2_PARENT_SCOPE');
 const profile=runtimeProvision.provisionHash({User:c.User,WorkingDir:c.WorkingDir,Entrypoint:c.Entrypoint,Cmd:c.Cmd,HostConfig:h,Mounts:raw.Mounts,AppArmorProfile:raw.AppArmorProfile}),start=runtimeProvision.provisionHash([s?.StartedAt,raw.RestartCount]);
 if(original&&(raw.Id!==original.parentContainerId||raw.Image!==original.imageId||profile!==original.publicProfileSha256||start!==original.startIdentity||(!retirement&&(s?.Running!==true||s.Status!=='running'||s.Health?.Status!=='healthy'))))throw Error('WORKSPACE_V2_ORIGINAL_PROFILE_CHANGED');
 return {profile,start,imageRevision:l['org.opencontainers.image.revision']};
}
async function verifyRetiredWorkspacePredecessorsV2(publicRequest:any,predecessors:any){
 if(!Array.isArray(predecessors)||predecessors.length>512)throw Error('WORKSPACE_V2_PREDECESSOR_BOUND');
 const daemon=await workspaceDockerJson('GET','/info'),daemonId=(daemon as any).value?.ID,ids=new Set<string>(),runtimeIds=new Set<string>();
 for(const prior of predecessors){
  const o=prior?.original;
  if(!o||o.schemaVersion!==2||o.projectId!==null||o.runtimeId!==prior.runtimeId||!UUID.test(prior.runtimeId)||prior.runtimeId===publicRequest.runtimeId||runtimeIds.has(prior.runtimeId)||ids.has(o.parentContainerId)||!(/^[a-f0-9]{64}$/).test(o.parentContainerId)||prior.backendName!=='ingenium-runtime-'+prior.runtimeId.replaceAll('-','')||o.daemonId!==daemonId
   ||o.workspaceId!==publicRequest.workspaceId||o.organizationId!==publicRequest.organizationId||o.ownerUserId!==publicRequest.ownerUserId||o.bindingHash!==publicRequest.storageMappingHash||o.bindingEpoch!==publicRequest.securityEpoch||!(/^[a-f0-9]{64}$/).test(prior.proofSha256)||!Number.isFinite(Date.parse(prior.finishedAt)))throw Error('WORKSPACE_V2_PREDECESSOR_SCOPE');
  ids.add(o.parentContainerId);runtimeIds.add(prior.runtimeId);
  const response=await workspaceDocker('GET','/containers/'+o.parentContainerId+'/json') as {status:number;bytes:Buffer};
  // Absence is acceptable only after a retained original stopped receipt.
  if(response.status===404)continue;if(response.status!==200)throw Error('WORKSPACE_V2_PREDECESSOR_UNKNOWN');
  const raw=parseStrictJobJson(response.bytes,1024*1024) as any;workspaceV2Parent(raw,{runtimeId:o.runtimeId,backendName:prior.backendName,organizationId:o.organizationId,ownerUserId:o.ownerUserId,workspaceId:o.workspaceId,storageMappingHash:o.bindingHash,securityEpoch:o.bindingEpoch,revision:o.provisioningRevision},o,true);
  const state=raw.State;if(state?.Running!==false||state.Pid!==0||state.Status!=='exited'||state.Restarting!==false||state.Dead!==false||state.RemovalInProgress||state.FinishedAt!==prior.finishedAt)throw Error('WORKSPACE_V2_PREDECESSOR_NOT_RETIRED');
  await joinStoppedWorkspaceAttach(o.parentContainerId,o.runtimeId);
 }
 const filters=encodeURIComponent(JSON.stringify({label:['com.ingenium.managed=runtime-manager','com.ingenium.runtime.workspace='+publicRequest.workspaceId]}));
 const listed=await workspaceDockerJson('GET','/containers/json?all=1&filters='+filters),rows=(listed as any).value;
 if(!Array.isArray(rows)||rows.length>512||rows.some(row=>!ids.has(row?.Id)||row.State!=='exited'))throw Error('WORKSPACE_V2_UNRECONCILED_PREDECESSOR');
 const end=await workspaceDockerJson('GET','/info');if((end as any).value?.ID!==daemonId)throw Error('WORKSPACE_V2_PREDECESSOR_DAEMON_CHANGED');
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
  const finalAdmission=await workspaceV2Core('admission',{runtimeId,requestId:publicRequest.originalRequestId,requestSha256});
  if(runtimeProvision.provisionHash(finalAdmission.retiredPredecessors)!==runtimeProvision.provisionHash(admitted.retiredPredecessors))throw Error('WORKSPACE_V2_PREDECESSOR_SET_CHANGED');
  await verifyRetiredWorkspacePredecessorsV2(publicRequest,finalAdmission.retiredPredecessors);
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

async function stopOriginalWorkspaceV2(runtimeId:string){
 const {runtime:r,workspace:w,original:o}=await workspaceV2Core('retirement',{runtimeId});
 if(r?.state!=='STOPPING'||o?.schemaVersion!==2||o.projectId!==null||r.id!==runtimeId||r.backendContainerId!==o.parentContainerId||w.id!==o.workspaceId)throw Error('WORKSPACE_V2_RETIREMENT_BINDING');
 const expected={runtimeId,backendName:r.backendName,organizationId:o.organizationId,ownerUserId:o.ownerUserId,workspaceId:o.workspaceId,storageMappingHash:o.bindingHash,securityEpoch:o.bindingEpoch,revision:o.provisioningRevision};
 const begin=Date.now(),deadline=begin+30000,daemon=await workspaceDockerJson('GET','/info');if((daemon as any).value?.ID!==o.daemonId)throw Error('WORKSPACE_V2_RETIREMENT_DAEMON_CHANGED');
 let raw=(await workspaceDockerJson('GET','/containers/'+o.parentContainerId+'/json') as any).value;
 workspaceV2Parent(raw,expected,o,true);
 if(raw.State?.Running===true){
  if(raw.State.Status!=='running'||raw.State.Restarting||raw.State.RemovalInProgress||raw.State.Dead)throw Error('WORKSPACE_V2_RETIREMENT_STATE_UNKNOWN');
  const response=await workspaceDocker('POST','/containers/'+o.parentContainerId+'/stop?t=5') as {status:number};if(response.status!==204&&response.status!==304)throw Error('WORKSPACE_V2_RETIREMENT_STOP_UNKNOWN');
 }
 for(;;){
  raw=(await workspaceDockerJson('GET','/containers/'+o.parentContainerId+'/json') as any).value;workspaceV2Parent(raw,expected,o,true);
  const state=raw.State;
  if(state?.Running===false&&state.Pid===0&&state.Status==='exited'&&state.Restarting===false&&state.Dead===false&&!state.RemovalInProgress&&Number.isSafeInteger(state.ExitCode)&&Number.isFinite(Date.parse(state.FinishedAt))&&Date.parse(state.FinishedAt)>=Date.parse(state.StartedAt)&&Date.parse(state.FinishedAt)<=Date.now())break;
  if(Date.now()>=deadline)throw Error('WORKSPACE_V2_RETIREMENT_STOP_UNCONFIRMED');await new Promise(resolve=>setTimeout(resolve,100));
 }
 await joinStoppedWorkspaceAttach(o.parentContainerId,runtimeId);
 const finalDaemon=await workspaceDockerJson('GET','/info');if((finalDaemon as any).value?.ID!==o.daemonId)throw Error('WORKSPACE_V2_RETIREMENT_DAEMON_CHANGED');
 const after=await workspaceV2Core('retirement',{runtimeId});if(runtimeProvision.provisionHash(after)!==runtimeProvision.provisionHash({runtime:r,workspace:w,original:o}))throw Error('WORKSPACE_V2_RETIREMENT_SCOPE_CHANGED');
 const finalRaw=(await workspaceDockerJson('GET','/containers/'+o.parentContainerId+'/json') as any).value;workspaceV2Parent(finalRaw,expected,o,true);
 if(finalRaw.State?.Running!==false||finalRaw.State.Pid!==0||finalRaw.State.Status!=='exited'||finalRaw.State.Restarting!==false||finalRaw.State.Dead!==false||finalRaw.State.RemovalInProgress||finalRaw.State.FinishedAt!==raw.State.FinishedAt)throw Error('WORKSPACE_V2_RETIREMENT_FINAL_STATE_CHANGED');
 // No removal, restart, engine/model call or old-container adoption occurs here.
 const observedAt=Date.now();return {schemaVersion:2,kind:'original-workspace-runtime-v2-retirement',runtimeId,workspaceId:w.id,parentContainerId:o.parentContainerId,daemonId:o.daemonId,startIdentity:o.startIdentity,publicProfileSha256:o.publicProfileSha256,requestSha256:o.requestSha256,state:'stopped',finishedAt:raw.State.FinishedAt,observedAt,expiresAt:observedAt+5000};
}

export function startRuntimeManager(): import("node:http").Server {
  const token = loadManagerToken();
  const originalCandidateWaiting=createOriginalCandidateWaitingOwner();
  const originalJobRoleProof=createCore126ManagerProofProducer({docker:dockerRequest});
  const originalCandidateClosure=createOriginalCandidateClosureProducer({docker:dockerRequest,makeOriginalRequest:(options,callback)=>httpRequest({...options,socketPath:DOCKER_SOCKET,path:'/v1.45'+options.path},callback)});
  const mappings = readWorkspaceMappings(environment("INGENIUM_RUNTIME_WORKSPACE_MAP_FILE"));
  const jobCore=createManagedJobCoreClient({apiUrl:environment("INGENIUM_RUNTIME_API_URL"),managerToken:token});
  const jobOwner=createManagedJobContainerOwner({core:jobCore,docker:dockerRequest,
    async buildRuntimeSpec(admission){
      const material=await jobCore.launchMaterial(admission),input=material.provision;
      if(material.runId!==admission.runId||material.attemptId!==admission.attemptId||material.credentialRunId!==admission.runId||material.profileQualified!==true||input.capability!==material.capability
        ||input.runtimeId!==admission.runtimeId||input.organizationId!==admission.organizationId||input.projectId!==admission.projectId||input.ownerUserId!==admission.ownerUserId||input.workspaceId!==admission.workspaceId||input.storageMappingHash!==admission.bindingHash||input.securityEpoch!==admission.bindingEpoch||input.revision!==admission.provisioningRevision)throw Error("Managed JobRun material binding changed");
      const mapping=mappings.get(input.workspaceId);if(!mapping)throw Error("Managed JobRun workspace mapping unavailable");
      if(!material.agentMaterial)throw Error("Original JobRun agent material unavailable");
      return {admission:material.admission,capability:material.capability,agentMaterial:material.agentMaterial,spec:buildRuntimeContainerSpec(input,mapping,{image:admission.imageId,network:runtimeNetworkName(admission.runtimeId),apiUrl:environment("INGENIUM_RUNTIME_API_URL")})};
    },
    handoff:(containerId,_admission,capability,agentMaterial)=>handoffOriginalJobFrame(containerId,capability,agentMaterial),
  });
  const port = Number(environment("INGENIUM_RUNTIME_MANAGER_PORT"));
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error("Runtime manager port is invalid");
  const server = createServer(async (request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (!authorized(request.headers.authorization, token)) {
      response.writeHead(401).end(JSON.stringify({ error: { code: "UNAUTHORIZED", message: "Authentication is required" } }));
      return;
    }
    try {
      const url = new URL(request.url ?? "/", "http://runtime-manager");
      if (request.method === "GET" && url.pathname === "/v1/health") {
        response.writeHead(200).end(JSON.stringify({ data: { status: "ok" } }));
        return;
      }
      if(request.method==='POST'&&request.url===MANAGER_ORIGINAL_CONNECTION_PATH){
        const data=await originalManagerPeer.challenge(request,response,await readJsonBody(request,true));
        response.writeHead(200).end(JSON.stringify({data}));return;
      }
      // Separate exact v2 route under the SAME original protected manager token.
      if(request.headers.cookie===undefined&&request.headers.origin===undefined&&url.search===''){
        if(request.method==='POST'&&url.pathname==='/v2/workspace-runtimes'){
          const data=await provisionOriginalWorkspaceV2(await readJsonBody(request) as Record<string,unknown>,mappings);
          response.writeHead(200).end(JSON.stringify({data}));return;
        }
        const stopV2=/^\/v2\/workspace-runtimes\/([a-f0-9-]+)\/stop$/.exec(url.pathname);
        if(request.method==='POST'&&stopV2&&UUID.test(stopV2[1]!)){
          const input=await readJsonBody(request);if(!input||Object.keys(input).length!==0)throw Error('WORKSPACE_V2_RETIREMENT_INPUT');
          const data=await stopOriginalWorkspaceV2(stopV2[1]!);response.writeHead(200).end(JSON.stringify({data}));return;
        }
        const v2=/^\/v2\/workspace-runtimes\/([a-f0-9-]+)\/placement$/.exec(url.pathname);
        if(request.method==='GET'&&v2&&UUID.test(v2[1]!)){
          const data=await observeOriginalWorkspaceV2(v2[1]!);response.writeHead(200).end(JSON.stringify({data}));return;
        }
      }
      if (request.method === "POST" && url.pathname === "/v1/runtimes") {
        const inspect = await provisionRuntime(await readJsonBody(request) as RuntimeProvisionRequest, mappings);
        const original=originalProvisionResponses.get(inspect);
        response.writeHead(202).end(JSON.stringify({data:{...publicInspect(inspect),
          provisionDisposition:original?.disposition??"legacy_unqualified",originalProvision:original?.original??null}}));
        return;
      }
      // Existing protected manager-token authentication above is mandatory.
      const candidateRoute=/^\/v1\/candidate-job-runs\/([0-9a-f-]+)\/(launch|readiness|stopped)$/.exec(url.pathname);
      if(request.method==='POST'&&candidateRoute&&UUID.test(candidateRoute[1]!)){
        const runId=candidateRoute[1]!,operation=candidateRoute[2]!,body=await readJsonBody(request,true);
        if(!body||typeof body!=='object'||Array.isArray(body))throw Error('Candidate manager input unavailable');
        const fields=Object.keys(body).sort().join('|');let result;
        if(operation==='launch'){
          if(fields!=='attemptId|challenge|deadlineAt|intentHash|runId|selectionSha256|specHash')throw Error('Original candidate RPC handshake unavailable');
          const originalPeer=originalManagerPeer.begin(request,response);
          result=await originalCandidateWaiting.launch(runId,body as import('../lib/dot-v2/candidate-original-manager.mjs').OriginalCandidateRpcHandshake,request,response,originalPeer);
        }else{
          if(fields!=='custodyId'||typeof (body as {custodyId?:unknown}).custodyId!=='string')throw Error('Original candidate custody unavailable');
          const custodyId=(body as {custodyId:string}).custodyId;
          result=operation==='readiness'?await originalCandidateWaiting.readiness(custodyId):await originalCandidateWaiting.stoppedObservation(custodyId);
          if(result.observation.runId!==runId)throw Error('Original candidate Run changed');
        }
        response.writeHead(200).end(JSON.stringify({data:result}));return;
      }
      const jobRoute=/^\/v1\/job-runs\/([0-9a-f-]+)(\/launch|\/cancel|\/cleanup)?$/.exec(url.pathname);
      if(jobRoute&&UUID.test(jobRoute[1]!)){
        const runId=jobRoute[1]!;let result;
        if(request.method==="GET"&&!jobRoute[2])result=await jobOwner.inspect(runId);
        else if(request.method==="POST"&&jobRoute[2]==="/cancel")result=await jobOwner.cancel(runId);
        else if(request.method==="POST"&&jobRoute[2]==="/cleanup")result=await jobOwner.cleanup(runId);
        else if(request.method==="POST"&&jobRoute[2]==="/launch"){
          const input=await readJsonBody(request) as Record<string,unknown>;
          if(!input||typeof input!=="object"||Array.isArray(input)||Object.keys(input).sort().join("|")!=="runId|runtimeId"||
             input.runId!==runId||typeof input.runtimeId!=="string"||!UUID.test(input.runtimeId))throw Error("Managed JobRun path binding changed");
          result=await jobOwner.launch({runId,runtimeId:input.runtimeId});
        }
        if(result){response.writeHead(200).end(JSON.stringify({data:result}));return;}
      }
      const placement = /^\/v1\/runtimes\/([0-9a-f-]+)\/placement$/.exec(url.pathname);
      if (request.method === "GET" && placement && UUID.test(placement[1]!)) {
        const [runtime,daemon] = await Promise.all([
          inspectRuntime(placement[1]!), dockerRequest<{ID?:string}>("GET","/info"),
        ]);
        if (!runtime || daemon.status!==200 || !daemon.data) throw new Error("Runtime placement owner unavailable");
        const observation=observeManagedRuntime(runtime,daemon.data.ID,Date.now());
        response.writeHead(200).end(JSON.stringify({data:{...publicInspect(runtime),placement:observation}}));
        return;
      }
      const candidateRole=/^\/v1\/runtimes\/([a-f0-9-]+)\/candidate-closure$/.exec(url.pathname);
      if(request.method==='GET'&&candidateRole&&UUID.test(candidateRole[1]!)&&url.search===''&&request.headers.cookie===undefined&&request.headers.origin===undefined){
        const closure=await originalCandidateClosure.observe(candidateRole[1]!),current=await inspectRuntime(candidateRole[1]!);
        if(!current||jobParentHash(publicJobParent(current))!==jobParentHash(closure.proof.parent)||Date.now()>=closure.proof.expiresAt)throw Error('Original candidate parent changed before publication');
        response.writeHead(200).end(JSON.stringify({data:{...publicInspect(current),candidateClosure:closure}}));return;
      }
      const jobRole=/^\/v1\/runtimes\/([a-f0-9-]+)\/job-role-proof$/.exec(url.pathname);
      if(request.method==="GET"&&jobRole&&UUID.test(jobRole[1]!)&&url.search===""&&request.headers.cookie===undefined&&request.headers.origin===undefined){
        const runtimeId=jobRole[1]!;
        const proof=await originalJobRoleProof.observe(runtimeId);
        const current=await inspectRuntime(runtimeId);
        if(!current||jobParentHash(publicJobParent(current))!==jobParentHash(proof.parent))throw Error("Original job parent changed before publication");
        response.writeHead(200).end(JSON.stringify({data:{...publicInspect(current),jobRoleProof:proof}}));return;
      }
      const match = /^\/v1\/runtimes\/([0-9a-f-]+)(\/stop)?$/.exec(url.pathname);
      if (match && UUID.test(match[1]!)) {
        if (request.method === "GET" && !match[2]) {
          await respondWithRuntimeInspect(response, () => inspectRuntime(match[1]!));
          return;
        }
        if (request.method === "POST" && match[2] === "/stop") {
          await respondWithRuntimeInspect(response, () => stopRuntime(match[1]!));
          return;
        }
        if (request.method === "DELETE" && !match[2]) {
          await removeRuntimeResources(match[1]!);
          response.writeHead(200).end(JSON.stringify({ data: { state: "absent", health: "absent" } }));
          return;
        }
      }
      response.writeHead(404).end(JSON.stringify({ error: { code: "NOT_FOUND", message: "Resource not found" } }));
    } catch (error) {
      console.error("Runtime manager request rejected:", error instanceof Error ? error.message : "unknown error");
      response.writeHead(422).end(JSON.stringify({ error: { code: "RUNTIME_REQUEST_REJECTED", message: "Runtime request rejected" } }));
    }
  });
  const originalManagerPeer=createOriginalManagerPeerOwner(server,token);
  server.listen(port, "0.0.0.0");
  return server;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) startRuntimeManager();
