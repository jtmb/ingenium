import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { accessSync, constants, lstatSync, realpathSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { basename, delimiter, dirname, isAbsolute, resolve } from "node:path";
import { apiRequestHeaders } from "./api-auth.js";
import {
  credentialPurposeFromEnvironment,
  resolveExtensionBinding,
  type ExtensionCredentialPurpose,
} from "./extension-binding.js";
import { resolveExtensionProject } from "./project-resolver.js";

const DEFAULT_API_URL = "http://localhost:4097/api/v1";
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 60_000;
const MAX_STDERR_BYTES = 1_024;
const TOKEN = /^[A-Za-z0-9_-]{32,128}$/;
const LEARNING_TOOLS = new Set(["extraction_run", "synthesis_run", "pipeline_event_log", "observe"]);

export type McpBridgeFailure = "authentication" | "timeout" | "rate_limited" | "revision_conflict" | "request_failed";
export type McpBridgeStage = "connect" | "call" | "close";

export class McpBridgeError extends Error {
  constructor(
    readonly failure: McpBridgeFailure,
    readonly diagnostic = "",
    readonly stage?: McpBridgeStage,
    readonly currentRevision?: number,
    readonly errorCode?: string,
  ) {
    super("Ingenium MCP bridge is unavailable");
    this.name = "McpBridgeError";
  }
}

interface McpTransport {
  close(): Promise<void>;
  stderr?: { on(event: "data", listener: (chunk: unknown) => void): unknown; resume?(): unknown } | null;
}

interface McpClient {
  connect(transport: McpTransport): Promise<void>;
  callTool(request: { name: string; arguments: Record<string, unknown> }): Promise<unknown>;
  close(): Promise<void>;
}

export interface McpToolClient {
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}

export interface McpBridgeLaunchOptions {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  stderr: "pipe";
  shell: false;
}

export interface McpBridgeDependencies {
  launcherPath?: string;
  createTransport?: (options: McpBridgeLaunchOptions) => McpTransport;
  createClient?: () => McpClient;
  project?: string;
  credentialPurpose?: ExtensionCredentialPurpose;
}

function boundedTimeout(value: string | undefined): number {
  const parsed = Number(value ?? DEFAULT_TIMEOUT_MS);
  if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_TIMEOUT_MS;
  return Math.min(parsed, MAX_TIMEOUT_MS);
}

function normalizedApiUrl(value: string | undefined): string | null {
  try {
    const parsed = new URL(value ?? DEFAULT_API_URL);
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:")
      || parsed.username
      || parsed.password
      || parsed.search
      || parsed.hash) return null;
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function bounded<T>(operation: () => Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => rejectPromise(new McpBridgeError("timeout")), timeoutMs);
    Promise.resolve().then(operation).then(
      (value) => {
        clearTimeout(timer);
        resolvePromise(value);
      },
      (error) => {
        clearTimeout(timer);
        rejectPromise(error instanceof McpBridgeError ? error : new McpBridgeError("request_failed"));
      },
    );
  });
}

/** Retain bounded child diagnostics without exposing credentials, URLs, or filesystem topology. */
export function sanitizeMcpStderr(value: string): string {
  return value
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [redacted]")
    .replace(/https?:\/\/[^\s]+/gi, "[url]")
    .replace(/(?:^|\s)\/(?:[^\s/]+\/){2,}[^\s]*/g, " [path]")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .slice(0, MAX_STDERR_BYTES);
}

function appendDiagnostic(current: string, chunk: unknown): string {
  if (Buffer.byteLength(current, "utf8") >= MAX_STDERR_BYTES) return current;
  const text = sanitizeMcpStderr(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk));
  return sanitizeMcpStderr(`${current}${text}`).slice(0, MAX_STDERR_BYTES);
}

function bridgeEnvironment(
  worktree: string,
  requestedProject?: string,
  purpose: ExtensionCredentialPurpose = "general",
): { project: string; environment: Record<string, string> } {
  const binding = resolveExtensionBinding(worktree, { purpose, project: requestedProject });
  const project = resolveExtensionProject(worktree, requestedProject ?? binding.project);
  const apiUrl = normalizedApiUrl(binding.apiUrl);
  const authorization = apiRequestHeaders(worktree, undefined, { binding }).get("Authorization");
  if (!apiUrl || !authorization || !TOKEN.test(authorization.slice("Bearer ".length))) {
    throw new McpBridgeError("authentication");
  }

  const localCredential = `.opencode/${basename(binding.credentialFile)}`;
  const childCredentialFile = binding.credentialFile === resolve(binding.launcherWorktree, localCredential)
    ? localCredential
    : binding.credentialFile;
  const environment: Record<string, string> = {
    INGENIUM_API_URL: apiUrl,
    INGENIUM_API_URL_TRUSTED: "1",
    INGENIUM_API_TIMEOUT: String(boundedTimeout(process.env.INGENIUM_API_TIMEOUT)),
    INGENIUM_PROJECT: project,
    INGENIUM_WORKTREE: binding.launcherWorktree,
    INGENIUM_MCP_CREDENTIAL_FILE: childCredentialFile,
    INGENIUM_MCP_CREDENTIAL_PURPOSE: binding.purpose,
    INGENIUM_MCP_AUDIENCE: binding.audience,
    INGENIUM_WORKSPACE_ID: binding.workspaceId,
  };
  if (binding.projectId) environment.INGENIUM_PROJECT_ID = binding.projectId;
  if (binding.runtimeId) environment.INGENIUM_RUNTIME_ID = binding.runtimeId;
  if (binding.storageMappingHash) environment.INGENIUM_STORAGE_MAPPING_HASH = binding.storageMappingHash;
  if (binding.purpose !== "runtime") environment.INGENIUM_TRUSTED_API_URL = apiUrl;
  if (binding.purpose === "learning") environment.INGENIUM_LEARNING_CREDENTIAL_FILE = childCredentialFile;
  if (binding.purpose === "repository-sync") environment.INGENIUM_REPOSITORY_SYNC_CREDENTIAL_FILE = childCredentialFile;
  if (binding.purpose === "runtime") environment.INGENIUM_RUNTIME_CREDENTIAL_FILE = childCredentialFile;
  return { project, environment };
}

export function packagedLauncherPath(moduleUrl = import.meta.url): string {
  const moduleDirectory = dirname(fileURLToPath(moduleUrl));
  const candidates = [
    resolve(moduleDirectory, "scripts/mcp-server.js"),
    resolve(moduleDirectory, "dist/scripts/mcp-server.js"),
  ];
  for (const candidate of candidates) {
    try {
      const stat = lstatSync(candidate);
      if (stat.isFile() && !stat.isSymbolicLink()) return candidate;
    } catch {
      // Source-loaded plugins fall through to the package's compiled launcher.
    }
  }
  throw new McpBridgeError("request_failed");
}

export function resolveNodeExecutable(
  currentExecutable = process.execPath,
  searchPath = process.env.PATH,
): string {
  const nodeName = process.platform === "win32" ? "node.exe" : "node";
  const candidates = basename(currentExecutable).toLowerCase() === nodeName
    ? [currentExecutable]
    : (searchPath ?? "").split(delimiter)
      .filter(isAbsolute)
      .map((directory) => resolve(directory, nodeName));

  for (const candidate of candidates) {
    try {
      const executable = realpathSync(candidate);
      const stat = statSync(executable);
      accessSync(executable, constants.X_OK);
      const owned = process.platform === "win32" || typeof process.getuid !== "function"
        || stat.uid === 0 || stat.uid === process.getuid();
      if (stat.isFile() && owned && (process.platform === "win32" || (stat.mode & 0o022) === 0)) return executable;
    } catch {
      // Try the next operator-provided executable search path entry.
    }
  }
  throw new McpBridgeError("request_failed");
}

function defaultTransport(options: McpBridgeLaunchOptions): McpTransport {
  return new StdioClientTransport(
    options as ConstructorParameters<typeof StdioClientTransport>[0] & { shell: false },
  );
}

function defaultClient(): McpClient {
  return new Client({ name: "ingenium-extension-bridge", version: "1.0.0" }) as unknown as McpClient;
}

async function closeBridge(
  client: McpClient,
  transport: McpTransport,
  connected: boolean,
  timeoutMs: number,
  diagnostic: string,
): Promise<void> {
  try {
    if (connected) await bounded(() => client.close(), timeoutMs);
    else await bounded(() => transport.close(), timeoutMs);
  } catch (error) {
    try {
      await bounded(() => transport.close(), timeoutMs);
      return;
    } catch {
      const failure = error instanceof McpBridgeError ? error.failure : "request_failed";
      throw new McpBridgeError(failure, diagnostic);
    }
  }
}

function toolFailure(result: unknown): { failure: McpBridgeFailure; currentRevision?: number; errorCode?: string } | undefined {
  if (typeof result !== "object" || result === null || !("isError" in result)
    || (result as { isError?: unknown }).isError !== true) return undefined;
  try {
    const data = mcpToolData(result);
    const error = typeof data === "object" && data !== null && "error" in data
      ? (data as { error?: { code?: unknown; currentRevision?: unknown } }).error
      : undefined;
    const errorCode = typeof error?.code === "string" && /^[A-Z][A-Z0-9_]{1,63}$/.test(error.code) ? error.code : undefined;
    if (errorCode === "RATE_LIMITED") return { failure: "rate_limited", errorCode };
    if (error?.code === "REVISION_CONFLICT" && typeof error.currentRevision === "number"
      && Number.isSafeInteger(error.currentRevision) && error.currentRevision >= 0) {
      return { failure: "revision_conflict", currentRevision: error.currentRevision, errorCode };
    }
    return { failure: "request_failed", ...(errorCode ? { errorCode } : {}) };
  } catch {}
  return { failure: "request_failed" };
}

/** Keep one package-owned stdio bridge alive for a bounded plugin lifecycle. */
export async function openMcpToolClient(
  worktree: string,
  dependencies: McpBridgeDependencies = {},
): Promise<McpToolClient> {
  const { project, environment } = bridgeEnvironment(
    worktree,
    dependencies.project,
    dependencies.credentialPurpose,
  );
  const timeoutMs = boundedTimeout(environment.INGENIUM_API_TIMEOUT);
  const transport = (dependencies.createTransport ?? defaultTransport)({
    command: resolveNodeExecutable(),
    args: [dependencies.launcherPath ?? packagedLauncherPath()],
    cwd: resolve(worktree),
    env: environment,
    stderr: "pipe",
    shell: false,
  });
  let diagnostic = "";
  transport.stderr?.on("data", (chunk: unknown) => {
    diagnostic = appendDiagnostic(diagnostic, chunk);
  });
  transport.stderr?.resume?.();
  const client = (dependencies.createClient ?? defaultClient)();
  try {
    await bounded(() => client.connect(transport), timeoutMs);
  } catch (error) {
    await closeBridge(client, transport, false, timeoutMs, diagnostic).catch(() => undefined);
    const rateLimited = diagnostic.includes('"reason":"rate_limited"');
    throw new McpBridgeError(
      rateLimited ? "rate_limited" : error instanceof McpBridgeError ? error.failure : "request_failed",
      diagnostic,
      "connect",
    );
  }

  let closed = false;
  return {
    async callTool(name, args) {
      if (closed) throw new McpBridgeError("request_failed", diagnostic, "call");
      try {
        const result = await bounded(() => client.callTool({ name, arguments: args }), timeoutMs);
        const failure = toolFailure(result);
        if (failure) throw new McpBridgeError(failure.failure, diagnostic, "call", failure.currentRevision, failure.errorCode);
        return result;
      } catch (error) {
        throw error instanceof McpBridgeError
          ? new McpBridgeError(error.failure, diagnostic, error.stage ?? "call", error.currentRevision, error.errorCode)
          : new McpBridgeError("request_failed", diagnostic, "call");
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      try {
        await closeBridge(client, transport, true, timeoutMs, diagnostic);
      } catch (error) {
        throw error instanceof McpBridgeError
          ? new McpBridgeError(error.failure, error.diagnostic, "close", error.currentRevision)
          : new McpBridgeError("request_failed", diagnostic, "close");
      }
    },
  };
}

/**
 * Runs one operation over a short-lived, package-owned stdio transport. The
 * closed environment prevents an extension lifecycle hook from inheriting any
 * OpenCode model or tool configuration.
 */
export async function withMcpClient<T>(
  worktree: string,
  operation: (client: McpClient, project: string) => Promise<T>,
  dependencies: McpBridgeDependencies = {},
): Promise<T> {
  const { project, environment } = bridgeEnvironment(
    worktree,
    dependencies.project,
    dependencies.credentialPurpose,
  );
  const timeoutMs = boundedTimeout(environment.INGENIUM_API_TIMEOUT);
  const transport = (dependencies.createTransport ?? defaultTransport)({
    command: resolveNodeExecutable(),
    args: [dependencies.launcherPath ?? packagedLauncherPath()],
    cwd: resolve(worktree),
    env: environment,
    stderr: "pipe",
    shell: false,
  });
  let diagnostic = "";
  transport.stderr?.on("data", (chunk: unknown) => {
    diagnostic = appendDiagnostic(diagnostic, chunk);
  });
  transport.stderr?.resume?.();

  const client = (dependencies.createClient ?? defaultClient)();
  let connected = false;
  let stage: McpBridgeStage = "connect";
  let result: T | undefined;
  let failure: McpBridgeError | undefined;
  try {
    await bounded(() => client.connect(transport), timeoutMs);
    connected = true;
    stage = "call";
    result = await bounded(() => operation(client, project), timeoutMs);
  } catch (error) {
    const connectRateLimited = stage === "connect" && diagnostic.includes('"reason":"rate_limited"');
    failure = error instanceof McpBridgeError
      ? new McpBridgeError(connectRateLimited ? "rate_limited" : error.failure, diagnostic, error.stage ?? stage,
        error.currentRevision, error.errorCode)
      : new McpBridgeError(connectRateLimited ? "rate_limited" : "request_failed", diagnostic, stage);
  }

  try {
    stage = "close";
    await closeBridge(client, transport, connected, timeoutMs, diagnostic);
  } catch (error) {
    if (!failure) failure = error instanceof McpBridgeError
      ? new McpBridgeError(error.failure, error.diagnostic, error.stage ?? stage, error.currentRevision, error.errorCode)
      : new McpBridgeError("request_failed", diagnostic, stage);
  }
  if (failure) throw failure;
  return result as T;
}

/** Ensure the launcher provisions the bound project before a lifecycle call. */
export async function ensureMcpProject(
  worktree: string,
  credentialPurpose: ExtensionCredentialPurpose = "general",
): Promise<string> {
  return withMcpClient(worktree, async (_client, project) => project, { credentialPurpose });
}

/** Invoke one packaged Ingenium MCP tool without exposing child protocol details. */
export async function callMcpTool(
  worktree: string,
  name: string,
  args: Record<string, unknown>,
  dependencies: Omit<McpBridgeDependencies, "project" | "credentialPurpose"> = {},
): Promise<unknown> {
  const project = typeof args.project === "string" ? args.project : undefined;
  const credentialPurpose: ExtensionCredentialPurpose = name === "repository_sync"
    ? "repository-sync"
    : LEARNING_TOOLS.has(name)
      ? "learning"
      : credentialPurposeFromEnvironment();
  return withMcpClient(worktree, async (client) => {
    const result = await client.callTool({ name, arguments: args });
    const failure = toolFailure(result);
    if (failure) throw new McpBridgeError(failure.failure, "", undefined, failure.currentRevision, failure.errorCode);
    return result;
  }, { ...dependencies, project, credentialPurpose });
}

/** Extract the only supported text response shape from a bridged MCP tool call. */
export function mcpToolData(result: unknown): unknown {
  if (typeof result !== "object" || result === null || !Array.isArray((result as { content?: unknown }).content)) {
    throw new McpBridgeError("request_failed");
  }
  const text = (result as { content: Array<{ type?: unknown; text?: unknown }> }).content
    .find((part) => part.type === "text" && typeof part.text === "string")?.text;
  if (typeof text !== "string") throw new McpBridgeError("request_failed");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new McpBridgeError("request_failed");
  }
}
