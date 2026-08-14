import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, normalize, resolve } from "node:path";

export interface RuntimeWorkspaceMapping {
  id: string;
  hostPath: string;
  validationPath: string;
}

export interface RuntimeProvisionRequest {
  runtimeId: string;
  backendName: string;
  organizationId: string;
  projectId: string;
  projectName: string;
  ownerUserId: string;
  workspaceId: string;
  storagePath: string;
  storageMappingHash: string;
  securityEpoch: number;
  revision: number;
  capability: string;
  capabilityExpiresAt: string;
  limits: {
    cpuMillis: number;
    memoryBytes: number;
    pidsLimit: number;
    diskBytes: number;
    processLimit: number;
  };
}

export interface RuntimeManagerConfig {
  image: string;
  network: string;
  apiUrl: string;
}

export interface DockerContainerSpec {
  Image: string;
  User: string;
  WorkingDir: string;
  AttachStdin: true;
  AttachStdout: false;
  AttachStderr: false;
  OpenStdin: true;
  StdinOnce: true;
  Env: string[];
  Labels: Record<string, string>;
  StopTimeout: number;
  HostConfig: {
    AutoRemove: false;
    Binds: string[];
    CapDrop: string[];
    Init: true;
    Memory: number;
    NanoCpus: number;
    NetworkMode: string;
    PidsLimit: number;
    PortBindings: Record<string, never>;
    PublishAllPorts: false;
    ReadonlyRootfs: true;
    SecurityOpt: string[];
    Tmpfs: Record<string, string>;
    Ulimits: Array<{ Name: string; Soft: number; Hard: number }>;
  };
  NetworkingConfig: { EndpointsConfig: Record<string, Record<string, never>> };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const SAFE_NAME = /^[a-z0-9][a-z0-9_.-]{0,127}$/;
const SAFE_WORKSPACE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const CAPABILITY = /^ing_[A-Za-z0-9_-]{12}_[A-Za-z0-9_-]{43}$/;

export function runtimeStorageMappingHash(workspaceId: string, storagePath: string): string {
  return createHash("sha256").update(`${workspaceId}\0${storagePath}`).digest("hex");
}

function exactAbsolutePath(value: string, label: string): string {
  if (!value || value !== value.trim() || !isAbsolute(value) || normalize(value) !== value
    || value.includes("/../") || value.endsWith("/..") || value.includes("/./") || value.endsWith("/.")) {
    throw new Error(`Invalid ${label}`);
  }
  return value.length > 1 && value.endsWith("/") ? value.slice(0, -1) : value;
}

function assertNoSymlink(path: string): void {
  const absolute = exactAbsolutePath(path, "validation path");
  const parts = absolute.split("/").filter(Boolean);
  let current = "/";
  for (const part of parts) {
    current = resolve(current, part);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error("Workspace validation path contains a symbolic link");
  }
  const final = lstatSync(absolute);
  if (!final.isDirectory() || realpathSync(absolute) !== absolute) throw new Error("Workspace validation path is not canonical");
}

function decodeMountPath(value: string): string {
  return value.replace(/\\(040|011|012|134)/g, (_match, code: string) => ({
    "040": " ", "011": "\t", "012": "\n", "134": "\\",
  })[code]!);
}

export function validateWorkspaceMapping(mapping: RuntimeWorkspaceMapping, mountInfo: string): RuntimeWorkspaceMapping {
  if (!SAFE_WORKSPACE_ID.test(mapping.id)) {
    throw new Error("Invalid workspace mapping ID");
  }
  const hostPath = exactAbsolutePath(mapping.hostPath, "workspace host path");
  const validationPath = exactAbsolutePath(mapping.validationPath, "workspace validation path");
  assertNoSymlink(validationPath);
  const matchingMount = mountInfo.split("\n").find((line) => {
    const separator = line.indexOf(" - ");
    if (separator < 0) return false;
    const fields = line.slice(0, separator).split(" ");
    return fields.length >= 5 && decodeMountPath(fields[4]!) === validationPath;
  });
  if (!matchingMount) throw new Error("Workspace validation path is not a dedicated mount");
  const root = decodeMountPath(matchingMount.split(" ")[3] ?? "");
  if (root !== hostPath) throw new Error("Workspace host path does not match its mounted canonical source");
  return { id: mapping.id, hostPath, validationPath };
}

export function readWorkspaceMappings(filePath: string, mountInfo = readFileSync("/proc/self/mountinfo", "utf8")): Map<string, RuntimeWorkspaceMapping> {
  const path = exactAbsolutePath(filePath, "workspace map file");
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o022) !== 0 || realpathSync(dirname(path)) !== dirname(path)) {
    throw new Error("Workspace map file is unsafe");
  }
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Workspace map is invalid");
  const root = parsed as { version?: unknown; workspaces?: unknown };
  if (root.version !== 1 || !Array.isArray(root.workspaces) || root.workspaces.length > 1000) throw new Error("Workspace map is invalid");
  const mappings = new Map<string, RuntimeWorkspaceMapping>();
  for (const candidate of root.workspaces) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error("Workspace map is invalid");
    const fields = candidate as Record<string, unknown>;
    if (Object.keys(fields).sort().join("\0") !== "hostPath\0id\0validationPath"
      || typeof fields.id !== "string" || typeof fields.hostPath !== "string" || typeof fields.validationPath !== "string") {
      throw new Error("Workspace map is invalid");
    }
    const mapping = validateWorkspaceMapping(fields as unknown as RuntimeWorkspaceMapping, mountInfo);
    if (mappings.has(mapping.id)) throw new Error("Workspace mapping is duplicated");
    mappings.set(mapping.id, mapping);
  }
  return mappings;
}

function assertProvisionRequest(input: RuntimeProvisionRequest, mapping: RuntimeWorkspaceMapping): void {
  if (![input.runtimeId, input.organizationId, input.projectId, input.ownerUserId].every((value) => UUID.test(value))) {
    throw new Error("Invalid runtime identity");
  }
  if (input.backendName !== `ingenium-runtime-${input.runtimeId.replaceAll("-", "")}` || !SAFE_NAME.test(input.backendName)) {
    throw new Error("Invalid runtime backend name");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._ -]{0,63}$/.test(input.projectName)
    || input.workspaceId !== mapping.id || input.storagePath !== mapping.hostPath
    || !SHA256.test(input.storageMappingHash)
    || input.storageMappingHash !== runtimeStorageMappingHash(input.workspaceId, input.storagePath)) {
    throw new Error("Invalid runtime workspace scope");
  }
  if (!Number.isSafeInteger(input.securityEpoch) || input.securityEpoch < 0
    || !Number.isSafeInteger(input.revision) || input.revision < 0 || !CAPABILITY.test(input.capability)) {
    throw new Error("Invalid runtime capability");
  }
  const expiresAt = new Date(input.capabilityExpiresAt);
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) throw new Error("Invalid runtime capability expiry");
  const { cpuMillis, memoryBytes, pidsLimit, diskBytes, processLimit } = input.limits;
  if (![cpuMillis, memoryBytes, pidsLimit, diskBytes, processLimit].every(Number.isSafeInteger)
    || cpuMillis < 100 || cpuMillis > 64_000 || memoryBytes < 134_217_728 || memoryBytes > 274_877_906_944
    || pidsLimit < 16 || pidsLimit > 65_536 || diskBytes < 67_108_864 || diskBytes > 1_099_511_627_776
    || processLimit < 16 || processLimit > pidsLimit) throw new Error("Invalid runtime resource limits");
}

function assertManagerConfig(config: RuntimeManagerConfig): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,255}$/.test(config.image) || config.image.includes("..")
    || !SAFE_NAME.test(config.network)) throw new Error("Invalid runtime manager image or network");
  const api = new URL(config.apiUrl);
  if (api.protocol !== "http:" || api.username || api.password || api.pathname !== "/api/v1"
    || api.search || api.hash || !SAFE_NAME.test(api.hostname)) throw new Error("Invalid private runtime API URL");
}

export function runtimeLabels(input: RuntimeProvisionRequest): Record<string, string> {
  return {
    "com.ingenium.managed": "runtime-manager",
    "com.ingenium.runtime.id": input.runtimeId,
    "com.ingenium.runtime.organization": input.organizationId,
    "com.ingenium.runtime.project": input.projectId,
    "com.ingenium.runtime.owner": input.ownerUserId,
    "com.ingenium.runtime.workspace": input.workspaceId,
    "com.ingenium.runtime.storage": input.storageMappingHash,
    "com.ingenium.runtime.security-epoch": String(input.securityEpoch),
    "com.ingenium.runtime.revision": String(input.revision),
  };
}

export function buildRuntimeContainerSpec(
  input: RuntimeProvisionRequest,
  mapping: RuntimeWorkspaceMapping,
  config: RuntimeManagerConfig,
): DockerContainerSpec {
  assertProvisionRequest(input, mapping);
  assertManagerConfig(config);
  return {
    Image: config.image,
    User: "1000:1000",
    WorkingDir: "/workspace",
    AttachStdin: true,
    AttachStdout: false,
    AttachStderr: false,
    OpenStdin: true,
    StdinOnce: true,
    Env: [
      "HOME=/home/appuser",
      "XDG_CONFIG_HOME=/home/appuser/.config",
      "XDG_DATA_HOME=/home/appuser/.local/share",
      "XDG_STATE_HOME=/home/appuser/.local/state",
      `INGENIUM_API_URL=${config.apiUrl}`,
      `INGENIUM_PROJECT=${input.projectName}`,
      `INGENIUM_PROJECT_ID=${input.projectId}`,
      `INGENIUM_ORGANIZATION_ID=${input.organizationId}`,
      `INGENIUM_RUNTIME_ID=${input.runtimeId}`,
      `INGENIUM_RUNTIME_OWNER_ID=${input.ownerUserId}`,
      `INGENIUM_WORKSPACE_ID=${input.workspaceId}`,
      "INGENIUM_WORKTREE=/workspace",
      "INGENIUM_MCP_AUDIENCE=runtime",
      "INGENIUM_MCP_CREDENTIAL_FILE=/run/ingenium-runtime/capability",
      "INGENIUM_DEPLOYMENT_MODE=user-runtime",
    ],
    Labels: runtimeLabels(input),
    StopTimeout: 30,
    HostConfig: {
      AutoRemove: false,
      Binds: [`${mapping.hostPath}:/workspace:rw,rprivate`],
      CapDrop: ["ALL"],
      Init: true,
      Memory: input.limits.memoryBytes,
      NanoCpus: input.limits.cpuMillis * 1_000_000,
      NetworkMode: config.network,
      PidsLimit: Math.min(input.limits.pidsLimit, input.limits.processLimit),
      PortBindings: {},
      PublishAllPorts: false,
      ReadonlyRootfs: true,
      SecurityOpt: ["no-new-privileges:true"],
      Tmpfs: {
        "/home/appuser": `rw,nosuid,nodev,size=${input.limits.diskBytes},uid=1000,gid=1000,mode=0700`,
        "/run/ingenium-runtime": "rw,noexec,nosuid,nodev,size=1048576,uid=1000,gid=1000,mode=0700",
        "/tmp": "rw,noexec,nosuid,nodev,size=67108864,uid=1000,gid=1000,mode=0700",
      },
      Ulimits: [],
    },
    NetworkingConfig: { EndpointsConfig: { [config.network]: {} } },
  };
}
