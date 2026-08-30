import { lstatSync, readFileSync, realpathSync } from "node:fs";
import type { runtimes } from "ingenium-core";

export interface RuntimeManagerInspect {
  backendId?: string;
  backendName?: string;
  state: string;
  health: string;
}

export interface RuntimeProvisionPayload {
  runtime: runtimes.RuntimeInstance;
  projectName: string;
  storagePath: string;
  storageMappingHash: string;
  capability: string;
  capabilityExpiresAt: string;
}

function managerUrl(): URL {
  const value = process.env.INGENIUM_RUNTIME_MANAGER_URL?.trim();
  if (!value) throw new Error("Runtime manager is not configured");
  const url = new URL(value);
  if (url.protocol !== "http:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash
    || !/^[a-z0-9][a-z0-9.-]*$/i.test(url.hostname)) throw new Error("Runtime manager URL is invalid");
  return url;
}

function managerToken(): string {
  const path = process.env.INGENIUM_RUNTIME_MANAGER_TOKEN_FILE?.trim();
  if (!path) throw new Error("Runtime manager authentication is not configured");
  const stat = lstatSync(path);
  const uid = typeof process.getuid === "function" ? process.getuid() : stat.uid;
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== uid || (stat.mode & 0o077) !== 0 || realpathSync(path) !== path) {
    throw new Error("Runtime manager token file is unsafe");
  }
  const token = readFileSync(path, "utf8").trim();
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(token)) throw new Error("Runtime manager token is invalid");
  return token;
}

async function requestManager(path: string, method = "GET", body?: unknown): Promise<RuntimeManagerInspect> {
  const base = managerUrl();
  const response = await fetch(new URL(path, base), {
    method,
    headers: {
      Authorization: `Bearer ${managerToken()}`,
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("Runtime manager request failed");
  }
  const result = await response.json() as { data?: RuntimeManagerInspect };
  if (!result.data || typeof result.data.state !== "string" || typeof result.data.health !== "string") {
    throw new Error("Runtime manager response is invalid");
  }
  return result.data;
}

export function provisionManagedRuntime(payload: RuntimeProvisionPayload): Promise<RuntimeManagerInspect> {
  const { runtime } = payload;
  return requestManager("/v1/runtimes", "POST", {
    runtimeId: runtime.id,
    backendName: runtime.backendName,
    organizationId: runtime.organizationId,
    projectId: runtime.projectId,
    projectName: payload.projectName,
    ownerUserId: runtime.ownerUserId,
    workspaceId: runtime.workspaceId,
    storagePath: payload.storagePath,
    storageMappingHash: payload.storageMappingHash,
    securityEpoch: runtime.securityEpoch,
    revision: runtime.revision,
    capability: payload.capability,
    capabilityExpiresAt: payload.capabilityExpiresAt,
    limits: {
      cpuMillis: runtime.cpuMillis,
      memoryBytes: runtime.memoryBytes,
      pidsLimit: runtime.pidsLimit,
      diskBytes: runtime.diskBytes,
      processLimit: runtime.processLimit,
    },
  });
}

export function inspectManagedRuntime(runtimeId: string): Promise<RuntimeManagerInspect> {
  return requestManager(`/v1/runtimes/${encodeURIComponent(runtimeId)}`);
}

export function stopManagedRuntime(runtimeId: string): Promise<RuntimeManagerInspect> {
  return requestManager(`/v1/runtimes/${encodeURIComponent(runtimeId)}/stop`, "POST");
}

export function removeManagedRuntime(runtimeId: string): Promise<RuntimeManagerInspect> {
  return requestManager(`/v1/runtimes/${encodeURIComponent(runtimeId)}`, "DELETE");
}

export async function runtimeManagerHealth(): Promise<boolean> {
  try {
    const base = managerUrl();
    const response = await fetch(new URL("/v1/health", base), {
      headers: { Authorization: `Bearer ${managerToken()}`, Accept: "application/json" },
      signal: AbortSignal.timeout(2_000),
    });
    await response.body?.cancel().catch(() => undefined);
    return response.ok;
  } catch {
    return false;
  }
}
