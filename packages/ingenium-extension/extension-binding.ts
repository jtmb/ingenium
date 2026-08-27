import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";

const CONFIG_MAX_BYTES = 1024 * 1024;
const DEFAULT_API_URL = "http://localhost:4097/api/v1";
const CANONICAL_LOOPBACK_API_URLS = new Set([
  DEFAULT_API_URL,
  "http://127.0.0.1:4097/api/v1",
]);
const CONFIG_FILE = "opencode.json";
const PURPOSE_FILES = {
  general: ".ingenium-mcp-credential",
  learning: ".ingenium-learning-credential",
  "repository-sync": ".ingenium-repository-sync-credential",
  runtime: "capability",
} as const;

export type ExtensionCredentialPurpose = keyof typeof PURPOSE_FILES;

export interface ExtensionBinding {
  apiUrl: string;
  project: string;
  projectId?: string;
  runtimeId?: string;
  workspaceId: string;
  launcherWorktree: string;
  storageMappingHash?: string;
  audience: "mcp" | "repository-sync" | "runtime";
  credentialFile: string;
  purpose: ExtensionCredentialPurpose;
}

export interface ResolveExtensionBindingOptions {
  purpose?: ExtensionCredentialPurpose;
  apiUrl?: string;
  project?: string;
  workspaceId?: string;
  launcherWorktree?: string;
  credentialFile?: string;
  allowMissingCredential?: boolean;
}

export function effectiveExtensionCredentialPurpose(
  requested: ExtensionCredentialPurpose,
): ExtensionCredentialPurpose {
  if (process.env.INGENIUM_MCP_AUDIENCE === "runtime") {
    if (process.env.INGENIUM_MCP_CREDENTIAL_PURPOSE !== undefined
      && process.env.INGENIUM_MCP_CREDENTIAL_PURPOSE !== "runtime") fail();
    return "runtime";
  }
  if (requested === "runtime" || process.env.INGENIUM_MCP_CREDENTIAL_PURPOSE === "runtime") fail();
  return requested;
}

/** Coordination follows the protected runtime audience, never a caller-selected purpose. */
export function coordinationCredentialPurpose(): "general" | "runtime" {
  return effectiveExtensionCredentialPurpose("general") as "general" | "runtime";
}

export class ExtensionBindingError extends Error {
  constructor() {
    super("Unable to resolve the Ingenium extension binding");
    this.name = "ExtensionBindingError";
  }
}

function fail(): never {
  throw new ExtensionBindingError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeString(value: unknown, maximum: number): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= maximum
    && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value)
    ? value
    : undefined;
}

export function isValidExtensionProjectName(value: unknown): value is string {
  return Boolean(safeString(value, 64)) && value !== "." && value !== ".." && !/[\\/]/.test(value as string);
}

function normalizedApiUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const parsed = new URL(value);
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:")
      || parsed.username || parsed.password || parsed.search || parsed.hash) return undefined;
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return undefined;
  }
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function isTrustedOperatorApiUrl(value: string): boolean {
  const parsed = new URL(value);
  return parsed.protocol === "https:" || (parsed.protocol === "http:" && isLoopbackHostname(parsed.hostname));
}

function trustedApiUrl(
  config: Record<string, string> | undefined,
  purpose: ExtensionCredentialPurpose,
): string {
  if (config?.INGENIUM_TRUSTED_API_URL !== undefined) fail();

  const configured = config?.INGENIUM_API_URL;
  const inherited = process.env.INGENIUM_API_URL;
  const explicitInherited = inherited !== undefined && inherited !== configured
    ? normalizedApiUrl(inherited)
    : undefined;
  const operatorConfigured = process.env.INGENIUM_TRUSTED_API_URL === undefined
    ? undefined
    : normalizedApiUrl(process.env.INGENIUM_TRUSTED_API_URL);

  if (process.env.INGENIUM_TRUSTED_API_URL !== undefined && !operatorConfigured) fail();
  if (inherited !== undefined && inherited !== configured && !explicitInherited) fail();
  if (operatorConfigured && explicitInherited && operatorConfigured !== explicitInherited) fail();

  if (operatorConfigured) {
    if (!isTrustedOperatorApiUrl(operatorConfigured)) fail();
    return operatorConfigured;
  }
  if (explicitInherited) {
    if (CANONICAL_LOOPBACK_API_URLS.has(explicitInherited)
      || (purpose === "runtime" && process.env.INGENIUM_MCP_AUDIENCE === "runtime")) return explicitInherited;
    fail();
  }

  if (configured !== undefined) {
    const normalized = normalizedApiUrl(configured);
    if (!normalized || !CANONICAL_LOOPBACK_API_URLS.has(normalized)) fail();
    return normalized;
  }
  return DEFAULT_API_URL;
}

function isContainedBy(parent: string, candidate: string): boolean {
  const path = relative(parent, candidate);
  return path !== "" && !path.startsWith("..") && !isAbsolute(path);
}

function configuredEnvironment(worktree: string): Record<string, string> | undefined {
  const configPath = resolve(worktree, CONFIG_FILE);
  let descriptor: number | undefined;
  let source: string;
  try {
    descriptor = openSync(configPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size > CONFIG_MAX_BYTES) fail();
    source = readFileSync(descriptor, "utf8");
  } catch {
    try {
      lstatSync(configPath);
      fail();
    } catch (error) {
      if (error instanceof ExtensionBindingError) throw error;
      return undefined;
    }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    fail();
  }
  if (!isRecord(parsed) || !isRecord(parsed.mcp)) fail();

  const candidates = Object.entries(parsed.mcp).filter(([name, entry]) => {
    if (name === "ingenium") return true;
    if (!isRecord(entry)) return false;
    const command = entry.command;
    const environment = entry.environment;
    return (Array.isArray(command) && command.some((part) => typeof part === "string"
      && part.endsWith("/packages/ingenium-extension/dist/scripts/mcp-server.js")))
      || (isRecord(environment) && typeof environment.INGENIUM_MCP_AUDIENCE === "string");
  });
  if (candidates.length === 0) return undefined;
  if (candidates.length !== 1 || candidates[0]![0] !== "ingenium") fail();

  const entry = candidates[0]![1];
  if (!isRecord(entry) || entry.type !== "local" || entry.enabled === false || !isRecord(entry.environment)) fail();
  const environment: Record<string, string> = {};
  for (const [key, value] of Object.entries(entry.environment)) {
    if (typeof value !== "string") fail();
    environment[key] = value;
  }
  if (environment.INGENIUM_MCP_AUDIENCE !== undefined
    && environment.INGENIUM_MCP_AUDIENCE !== "mcp"
    && environment.INGENIUM_MCP_AUDIENCE !== "runtime"
    && environment.INGENIUM_MCP_AUDIENCE !== "repository-sync") fail();
  return environment;
}

function operationCredentialFile(
  purpose: ExtensionCredentialPurpose,
  config: Record<string, string> | undefined,
  explicit: string | undefined,
  environmentFirst = false,
): string {
  if (config?.INGENIUM_MCP_CREDENTIAL !== undefined || process.env.INGENIUM_MCP_CREDENTIAL !== undefined) fail();
  if (explicit !== undefined) return explicit;
  if (purpose === "learning") {
    return process.env.INGENIUM_LEARNING_CREDENTIAL_FILE
      ?? config?.INGENIUM_LEARNING_CREDENTIAL_FILE
      ?? `.opencode/${PURPOSE_FILES.learning}`;
  }
  if (purpose === "repository-sync") {
    return process.env.INGENIUM_REPOSITORY_SYNC_CREDENTIAL_FILE
      ?? config?.INGENIUM_REPOSITORY_SYNC_CREDENTIAL_FILE
      ?? `.opencode/${PURPOSE_FILES["repository-sync"]}`;
  }
  if (purpose === "runtime") {
    return process.env.INGENIUM_RUNTIME_CREDENTIAL_FILE ?? "/run/ingenium-runtime/capability";
  }
  if (environmentFirst) {
    return process.env.INGENIUM_MCP_CREDENTIAL_FILE
      ?? config?.INGENIUM_MCP_CREDENTIAL_FILE
      ?? `.opencode/${PURPOSE_FILES.general}`;
  }
  return config?.INGENIUM_MCP_CREDENTIAL_FILE
    ?? process.env.INGENIUM_MCP_CREDENTIAL_FILE
    ?? `.opencode/${PURPOSE_FILES.general}`;
}

function validatedCredentialFile(
  worktree: string,
  reference: string,
  purpose: ExtensionCredentialPurpose,
  allowMissing = false,
): string {
  const expectedName = PURPOSE_FILES[purpose];
  const path = isAbsolute(reference) ? resolve(reference) : resolve(worktree, reference);
  if (basename(path) !== expectedName) fail();

  if (purpose === "runtime" && path !== "/run/ingenium-runtime/capability") fail();

  if (!isAbsolute(reference)) {
    const expected = resolve(worktree, ".opencode", expectedName);
    if (path !== expected || !isContainedBy(resolve(worktree, ".opencode"), path)) fail();
  } else {
    try {
      const parent = lstatSync(dirname(path));
      if (!parent.isDirectory() || parent.isSymbolicLink() || (parent.mode & 0o077) !== 0
        || (process.platform !== "win32" && typeof process.getuid === "function" && parent.uid !== process.getuid())) fail();
    } catch {
      fail();
    }
  }

  try {
    const file = lstatSync(path);
    if (!file.isFile() || file.isSymbolicLink() || (file.mode & 0o400) === 0 || (file.mode & 0o077) !== 0
      || (process.platform !== "win32" && typeof process.getuid === "function" && file.uid !== process.getuid())) fail();
  } catch (error) {
    if (allowMissing && (error as NodeJS.ErrnoException).code === "ENOENT") return path;
    fail();
  }
  return path;
}

export function resolveExtensionBinding(
  worktree: string,
  options: ResolveExtensionBindingOptions = {},
): ExtensionBinding {
  let root: string;
  try {
    root = realpathSync(resolve(worktree));
    if (!statSync(root).isDirectory()) fail();
  } catch {
    fail();
  }

  const config = configuredEnvironment(root);
  const purpose = effectiveExtensionCredentialPurpose(options.purpose ?? "general");
  const operationEnvironment = process.env.INGENIUM_MCP_CREDENTIAL_PURPOSE === purpose
    || (purpose === "runtime" && process.env.INGENIUM_MCP_AUDIENCE === "runtime")
    || (purpose === "repository-sync" && process.env.INGENIUM_MCP_AUDIENCE === "repository-sync");
  const preferred = (key: string): string | undefined => operationEnvironment
    ? process.env[key] ?? config?.[key]
    : config?.[key] ?? process.env[key];
  const configuredWorktree = options.launcherWorktree ?? preferred("INGENIUM_WORKTREE") ?? root;
  if (!isAbsolute(configuredWorktree) || resolve(configuredWorktree) !== root) fail();

  const project = options.project ?? preferred("INGENIUM_PROJECT") ?? basename(root);
  if (!isValidExtensionProjectName(project) || (root === "/workspace" && options.project === undefined
    && config?.INGENIUM_PROJECT === undefined && process.env.INGENIUM_PROJECT === undefined)) fail();

  const workspaceId = safeString(
    options.workspaceId ?? preferred("INGENIUM_WORKSPACE_ID"),
    256,
  );
  const apiUrl = trustedApiUrl(config, purpose);
  if (options.apiUrl !== undefined && normalizedApiUrl(options.apiUrl) !== apiUrl) fail();
  if (!workspaceId) fail();
  const projectId = preferred("INGENIUM_PROJECT_ID");
  if (projectId !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(projectId)) fail();
  const runtimeId = preferred("INGENIUM_RUNTIME_ID");
  if (runtimeId !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(runtimeId)) fail();
  const storageMappingHash = preferred("INGENIUM_STORAGE_MAPPING_HASH");
  if (storageMappingHash !== undefined && !/^[0-9a-f]{64}$/.test(storageMappingHash)) fail();
  if (purpose === "runtime" && (!projectId || !runtimeId || !storageMappingHash)) fail();

  return {
    apiUrl,
    project,
    ...(projectId === undefined ? {} : { projectId }),
    ...(runtimeId === undefined ? {} : { runtimeId }),
    workspaceId,
    launcherWorktree: root,
    ...(storageMappingHash === undefined ? {} : { storageMappingHash }),
    audience: purpose === "repository-sync" ? "repository-sync" : purpose === "runtime" ? "runtime" : "mcp",
    credentialFile: validatedCredentialFile(
      root,
      operationCredentialFile(purpose, config, options.credentialFile, operationEnvironment),
      purpose,
      options.allowMissingCredential === true,
    ),
    purpose,
  };
}

export function credentialPurposeFromEnvironment(): ExtensionCredentialPurpose {
  const purpose = process.env.INGENIUM_MCP_CREDENTIAL_PURPOSE;
  if (purpose === undefined) {
    if (process.env.INGENIUM_MCP_AUDIENCE === "repository-sync") return "repository-sync";
    if (process.env.INGENIUM_MCP_AUDIENCE === "runtime") return "runtime";
    return "general";
  }
  if (purpose === "general" || purpose === "learning" || purpose === "repository-sync" || purpose === "runtime") {
    return effectiveExtensionCredentialPurpose(purpose);
  }
  return fail();
}
