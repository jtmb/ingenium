import { createServer, request as httpRequest } from "node:http";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  buildRuntimeContainerSpec,
  readWorkspaceMappings,
  runtimeLabels,
  type RuntimeProvisionRequest,
} from "../lib/runtime-manager-contract.js";

const DOCKER_SOCKET = "/var/run/docker.sock";
const MAX_BODY_BYTES = 64 * 1024;
const MAX_DOCKER_RESPONSE_BYTES = 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type DockerResponse<T> = { status: number; data: T | null; raw: string };
type DockerInspect = {
  Id?: string;
  Name?: string;
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

function loadManagerToken(): string {
  const path = environment("INGENIUM_RUNTIME_MANAGER_TOKEN_FILE");
  const stat = lstatSync(path);
  const uid = typeof process.getuid === "function" ? process.getuid() : stat.uid;
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== uid || (stat.mode & 0o077) !== 0 || realpathSync(path) !== path) {
    throw new Error("Runtime manager token file is unsafe");
  }
  const token = readFileSync(path, "utf8").trim();
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(token)) throw new Error("Runtime manager token is invalid");
  return token;
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

async function provisionRuntime(input: RuntimeProvisionRequest, mappings: ReturnType<typeof readWorkspaceMappings>): Promise<DockerInspect> {
  const mapping = mappings.get(input.workspaceId);
  if (!mapping) throw new Error("Workspace mapping is unavailable");
  const config = {
    image: environment("INGENIUM_USER_RUNTIME_IMAGE"),
    network: runtimeNetworkName(input.runtimeId),
    apiUrl: environment("INGENIUM_RUNTIME_API_URL"),
  };
  const spec = buildRuntimeContainerSpec(input, mapping, config);
  await ensureRuntimeNetwork(config.network, input.runtimeId);
  await connectControlPlane(config.network);
  await connectRuntimeGateway(config.network);
  const expectedLabels = runtimeLabels(input);
  const prior = await inspectRuntime(input.runtimeId);
  if (prior) {
    const exact = Object.entries(expectedLabels).every(([key, value]) => prior.Config?.Labels?.[key] === value);
    if (exact && prior.State?.Status === "running") return prior;
    if (prior.State?.Status === "running") {
      const stopped = await dockerRequest("POST", `/containers/${encodeURIComponent(input.backendName)}/stop?t=30`);
      if (stopped.status !== 204 && stopped.status !== 304) throw new Error("Stale runtime container stop failed");
    }
    const removed = await dockerRequest("DELETE", `/containers/${encodeURIComponent(input.backendName)}?v=true`);
    if (removed.status !== 204 && removed.status !== 404) throw new Error("Stale runtime container removal failed");
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
  return inspect ? {
    backendId: inspect.Id,
    backendName: inspect.Name?.replace(/^\//, ""),
    state: inspect.State?.Status ?? "unknown",
    health: inspect.State?.Health?.Status ?? "unknown",
  } : { state: "absent", health: "absent" };
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
        response.writeHead(202).end(JSON.stringify({ data: publicInspect(inspect) }));
        return;
      }
      const match = /^\/v1\/runtimes\/([0-9a-f-]+)(\/stop)?$/.exec(url.pathname);
      if (match && UUID.test(match[1]!)) {
        if (request.method === "GET" && !match[2]) {
          response.writeHead(200).end(JSON.stringify({ data: publicInspect(await inspectRuntime(match[1]!)) }));
          return;
        }
        if (request.method === "POST" && match[2] === "/stop") {
          response.writeHead(200).end(JSON.stringify({ data: publicInspect(await stopRuntime(match[1]!)) }));
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
