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

async function readJsonBody(request: import("node:http").IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_BODY_BYTES) throw new Error("Request body exceeded limit");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function startRuntimeManager(): import("node:http").Server {
  const token = loadManagerToken();
  const mappings = readWorkspaceMappings(environment("INGENIUM_RUNTIME_WORKSPACE_MAP_FILE"));
  const jobCore=createManagedJobCoreClient({apiUrl:environment("INGENIUM_RUNTIME_API_URL"),managerToken:token});
  const jobOwner=createManagedJobContainerOwner({core:jobCore,docker:dockerRequest,
    async buildRuntimeSpec(admission){
      const material=await jobCore.launchMaterial(admission),input=material.provision;
      if(material.runId!==admission.runId||material.attemptId!==admission.attemptId||material.credentialRunId!==admission.runId||material.profileQualified!==true||input.capability!==material.capability
        ||input.runtimeId!==admission.runtimeId||input.organizationId!==admission.organizationId||input.projectId!==admission.projectId||input.ownerUserId!==admission.ownerUserId||input.workspaceId!==admission.workspaceId||input.storageMappingHash!==admission.bindingHash||input.securityEpoch!==admission.bindingEpoch||input.revision!==admission.provisioningRevision)throw Error("Managed JobRun material binding changed");
      const mapping=mappings.get(input.workspaceId);if(!mapping)throw Error("Managed JobRun workspace mapping unavailable");
      return {admission:material.admission,capability:material.capability,spec:buildRuntimeContainerSpec(input,mapping,{image:admission.imageId,network:runtimeNetworkName(admission.runtimeId),apiUrl:environment("INGENIUM_RUNTIME_API_URL")})};
    },
    handoff:(containerId,_admission,capability)=>handoffRuntimeCapability(containerId,capability),
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
      if (request.method === "POST" && url.pathname === "/v1/runtimes") {
        const inspect = await provisionRuntime(await readJsonBody(request) as RuntimeProvisionRequest, mappings);
        const original=originalProvisionResponses.get(inspect);
        response.writeHead(202).end(JSON.stringify({data:{...publicInspect(inspect),
          provisionDisposition:original?.disposition??"legacy_unqualified",originalProvision:original?.original??null}}));
        return;
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
  server.listen(port, "0.0.0.0");
  return server;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) startRuntimeManager();
