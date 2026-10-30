import { lstatSync, readFileSync, realpathSync } from "node:fs";
import type { runtimes } from "ingenium-core";
import { isManagedRuntimeObservation, type ManagedRuntimeObservation } from "./runtime-placement-contract.js";

export interface RuntimeManagerInspect {
  placement?: unknown;
  backendId?: string;
  backendName?: string;
  runtimeId?: string;
  imageRevision?: string;
  state: string;
  health: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA1 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;

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
    redirect: "error",
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
  if (result.data.state !== "absent" && (!result.data.runtimeId || !UUID.test(result.data.runtimeId)
    || !result.data.backendId || !SHA256.test(result.data.backendId)
    || result.data.backendName !== `ingenium-runtime-${result.data.runtimeId.replaceAll("-", "")}`
    || !result.data.imageRevision || !SHA1.test(result.data.imageRevision))) {
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

export async function inspectManagedRuntimePlacement(runtimeId: string): Promise<ManagedRuntimeObservation> {
  if (!UUID.test(runtimeId)) throw new Error("Runtime placement identity is invalid");
  const result=await requestManager(`/v1/runtimes/${encodeURIComponent(runtimeId)}/placement`);
  if (!isManagedRuntimeObservation(result.placement) || result.placement.runtimeId!==runtimeId
    || result.placement.backendId!==result.backendId || result.placement.backendName!==result.backendName
    || result.placement.imageRevision!==result.imageRevision || result.placement.state!==result.state
    || result.placement.health!==result.health) throw new Error("Runtime placement evidence is invalid");
  return Object.freeze({...result.placement});
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

export interface ManagedJobObservation {state:"active"|"settled"|"unknown"|"removed";code:string;proof?:unknown}
async function requestManagedJob(runId:string,operation:"inspect"|"launch"|"cancel"|"cleanup",runtimeId?:string):Promise<ManagedJobObservation>{
  if(!UUID.test(runId)||(operation==="launch"&&(!runtimeId||!UUID.test(runtimeId))))throw Error("Managed JobRun identity is invalid");
  const response=await fetch(new URL(`/v1/job-runs/${encodeURIComponent(runId)}${operation==="inspect"?"":"/"+operation}`,managerUrl()),{
    method:operation==="inspect"?"GET":"POST",redirect:"error",headers:{Authorization:`Bearer ${managerToken()}`,Accept:"application/json",...(operation==="launch"?{"Content-Type":"application/json"}:{})},
    body:operation==="launch"?JSON.stringify({runId,runtimeId}):undefined,signal:AbortSignal.timeout(30_000),
  });
  if(!response.ok){await response.body?.cancel().catch(()=>undefined);throw Error("Managed JobRun owner unavailable");}
  const result=await response.json() as {data?:ManagedJobObservation};
  if(!result.data||!["active","settled","unknown",...(operation==="cleanup"?["removed"]:[])].includes(result.data.state)||typeof result.data.code!=="string"||result.data.code.length>128||(result.data.state==="settled"&&!result.data.proof))throw Error("Managed JobRun owner response invalid");
  return result.data;
}
export const launchManagedJobRun=(runId:string,runtimeId:string)=>requestManagedJob(runId,"launch",runtimeId);
export const inspectManagedJobRun=(runId:string)=>requestManagedJob(runId,"inspect");
export const cancelManagedJobRun=(runId:string)=>requestManagedJob(runId,"cancel");

export const cleanupManagedJobRun=(runId:string)=>requestManagedJob(runId,"cleanup");
