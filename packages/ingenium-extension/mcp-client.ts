import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ReadBuffer, serializeMessage } from "@modelcontextprotocol/sdk/shared/stdio.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { spawn, type ChildProcess } from "node:child_process";
import { PassThrough } from "node:stream";
import type { McpLauncherFailureStage } from "./scripts/mcp-server.js";
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
const REPOSITORY_SYNC_TIMEOUT_MS = MAX_TIMEOUT_MS;
const MAX_STDERR_BYTES = 1_024;
const TOKEN = /^[A-Za-z0-9_-]{32,128}$/;
const LEARNING_TOOLS = new Set(["extraction_run", "synthesis_run", "pipeline_event_log", "observe"]);
export const MCP_LIVE_RELOAD_MIN_TIMEOUT_MS = 5_000;
export const MCP_LIVE_RELOAD_MAX_TIMEOUT_MS = 300_000;

export type McpBridgeFailure = "authentication" | "timeout" | "rate_limited" | "revision_conflict" | "request_failed";
export type McpBridgeStage = McpLauncherFailureStage | "spawn" | "spawntimeout" | "connect" | "initialize" | "tools-list" | "call" | "close";
export type McpFailureBoundary = "launcher" | "parent-mcp-startup" | "parent-mcp-transport" | "bridge";
export interface McpChildExit { code: number | null; signal: NodeJS.Signals | null }

export class McpBridgeError extends Error {
  constructor(
    readonly failure: McpBridgeFailure,
    readonly diagnostic = "",
    readonly stage?: McpBridgeStage,
    readonly currentRevision?: number,
    readonly errorCode?: string,
    readonly boundary: McpFailureBoundary = "bridge",
    readonly childExit?: McpChildExit,
  ) {
    super("Ingenium MCP bridge is unavailable");
    this.name = "McpBridgeError";
  }
}

interface McpTransport {
  close(): Promise<void>;
  lastExit?: McpChildExit;
  stage?: McpBridgeStage;
  stderr?: { on(event: "data", listener: (chunk: unknown) => void): unknown; resume?(): unknown } | null;
}

interface McpClient {
  connect(transport: McpTransport): Promise<void>;
  callTool(request: { name: string; arguments: Record<string, unknown> }): Promise<unknown>;
  listTools?(): Promise<unknown>;
  close(): Promise<void>;
}

export interface McpToolClient {
  listTools?(): Promise<unknown>;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}

interface OpenCodeMcpClient {
  mcp?: {
    disconnect?: (options: { path: { name: "ingenium" }; query?: { directory: string } }) => Promise<unknown>;
    connect?: (options: { path: { name: "ingenium" }; query?: { directory: string } }) => Promise<unknown>;
    status?: (options: { query: { directory: string } }) => Promise<unknown>;
  };
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
  timeoutMs?: number;
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

export async function reconnectIngeniumMcp(
  client: unknown,
  directory: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Record<string, unknown>> {
  if (!Number.isInteger(timeoutMs) || timeoutMs < MCP_LIVE_RELOAD_MIN_TIMEOUT_MS
    || timeoutMs > MCP_LIVE_RELOAD_MAX_TIMEOUT_MS || !isAbsolute(directory)) {
    throw new McpBridgeError("request_failed");
  }
  const mcp = (client as OpenCodeMcpClient | undefined)?.mcp;
  if (typeof mcp?.disconnect !== "function" || typeof mcp.connect !== "function" || typeof mcp.status !== "function") {
    throw new McpBridgeError("request_failed");
  }
  const target = { path: { name: "ingenium" as const }, query: { directory: resolve(directory) } };
  try {
    await bounded(() => mcp.disconnect!(target), timeoutMs);
    await bounded(() => mcp.connect!(target), timeoutMs);
    const response = await bounded(() => mcp.status!({ query: target.query }), timeoutMs);
    const data = typeof response === "object" && response !== null && "data" in response
      ? (response as { data?: unknown }).data
      : response;
    if (typeof data !== "object" || data === null || Array.isArray(data)
      || typeof (data as Record<string, unknown>).ingenium !== "object"
      || (data as Record<string, unknown>).ingenium === null
      || (data as Record<string, Record<string, unknown>>).ingenium?.status !== "connected") {
      throw new McpBridgeError("request_failed");
    }
    return (data as Record<string, Record<string, unknown>>).ingenium!;
  } catch (error) {
    throw error instanceof McpBridgeError ? error : new McpBridgeError("request_failed");
  }
}

/** Retain bounded child diagnostics without exposing credentials, URLs, or filesystem topology. */
export function sanitizeMcpStderr(value: string): string {
  const redacted = value
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [redacted]")
    .replace(/https?:\/\/[^\s]+/gi, "[url]")
    .replace(/(?:^|\s)\/(?:[^\s/]+\/){2,}[^\s]*/g, " [path]")
    .replace(/[A-Za-z0-9_-]{32,}/g, "[redacted]")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .slice(0, MAX_STDERR_BYTES);
  let bounded = "";
  for (const character of redacted) {
    if (Buffer.byteLength(bounded + character, "utf8") > MAX_STDERR_BYTES) break;
    bounded += character;
  }
  return bounded;
}

function collectDiagnostic(transport: McpTransport): () => string {
  let raw = Buffer.alloc(0);
  transport.stderr?.on("data", (chunk: unknown) => {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    raw = Buffer.concat([raw, bytes.subarray(0, Math.max(0, 8_192 - raw.length))]);
  });
  transport.stderr?.resume?.();
  // Sanitize after joining chunks so a split credential cannot bypass redaction.
  return () => {
    const text = raw.toString("utf8");
    const first = startupFailureRecord(text);
    return sanitizeMcpStderr(first ? `${JSON.stringify(first)} ${text}` : text);
  };
}

function startupFailureRecord(diagnostic: string): { boundary: McpFailureBoundary; stage?: McpBridgeStage; reason: string } | undefined {
  const stages: McpBridgeStage[] = ["local-binding", "project-preflight", "authentication", "import", "transport", "spawn", "spawntimeout", "connect", "initialize", "tools-list"];
  // Only fixed, allowlisted fields cross the child diagnostic boundary.
  const records = diagnostic.match(/\{[^{}]*\}/g) ?? [];
  for (const record of records) {
    try {
      const data = JSON.parse(record);
      if (data.boundary !== "launcher" && data.boundary !== "parent-mcp-startup" && data.boundary !== "parent-mcp-transport") continue;
      const childStage = stages.includes(data.stage) ? data.stage as McpBridgeStage : undefined;
      if (!childStage && data.reason !== "rate_limited") continue;
      return { boundary: data.boundary, stage: childStage, reason: data.reason === "rate_limited" ? "rate_limited" : "startup_failed" };
    } catch {}
  }
  return undefined;
}

function attributedFailure(error: unknown, diagnostic: string, stage: McpBridgeStage, transport: McpTransport): McpBridgeError {
  const original = error instanceof McpBridgeError ? error : new McpBridgeError("request_failed");
  const first = startupFailureRecord(diagnostic);
  if (first) return new McpBridgeError(first.reason === "rate_limited" ? "rate_limited"
    : first.stage === "authentication" ? "authentication" : original.failure,
  diagnostic, first.stage ?? stage, original.currentRevision, original.errorCode, first.boundary, transport.lastExit);
  return new McpBridgeError(original.failure, diagnostic, original.stage ?? (stage === "connect"
    ? transport.stage === "spawn" && original.failure === "timeout" ? "spawntimeout" : transport.stage ?? stage
    : stage === "call" && transport.stage === "tools-list" ? "tools-list" : stage), original.currentRevision, original.errorCode, original.boundary, transport.lastExit);
}

function bridgeEnvironment(
  worktree: string,
  requestedProject?: string,
  purpose: ExtensionCredentialPurpose = "general",
  timeoutMs?: number,
): { project: string; environment: Record<string, string> } {
  let binding: ReturnType<typeof resolveExtensionBinding>;
  try {
    binding = resolveExtensionBinding(worktree, { purpose, project: requestedProject });
  } catch {
    throw new McpBridgeError("authentication", "", "local-binding");
  }
  let project: string;
  try {
    project = resolveExtensionProject(worktree, requestedProject ?? binding.project);
  } catch {
    throw new McpBridgeError("request_failed", "", "project-preflight");
  }
  const apiUrl = normalizedApiUrl(binding.apiUrl);
  const authorization = apiRequestHeaders(worktree, undefined, { binding }).get("Authorization");
  if (!apiUrl || !authorization || !TOKEN.test(authorization.slice("Bearer ".length))) {
    throw new McpBridgeError("authentication", "", "authentication");
  }

  const localCredential = `.opencode/${basename(binding.credentialFile)}`;
  const childCredentialFile = binding.credentialFile === resolve(binding.launcherWorktree, localCredential)
    ? localCredential
    : binding.credentialFile;
  const environment: Record<string, string> = {
    INGENIUM_API_URL: apiUrl,
    INGENIUM_API_URL_TRUSTED: "1",
    INGENIUM_API_TIMEOUT: String(boundedTimeout(timeoutMs === undefined ? process.env.INGENIUM_API_TIMEOUT : String(timeoutMs))),
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
  throw new McpBridgeError("request_failed", "", "import");
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
  throw new McpBridgeError("request_failed", "", "local-binding");
}

// The SDK stdio transport discards exit status before onclose; own the child
// while retaining the SDK wire codec and its existing shutdown grace periods.
export class ObservableMcpTransport implements McpTransport {
  readonly stderr = new PassThrough();
  lastExit?: McpChildExit;
  stage: McpBridgeStage = "spawn";
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  private child?: ChildProcess;
  private readonly buffer = new ReadBuffer();
  private closing?: Promise<void>;
  private exited?: Promise<void>;

  constructor(private readonly options: McpBridgeLaunchOptions) {}

  async start(): Promise<void> {
    if (this.child || this.exited) throw new Error("Transport already started");
    const child = spawn(this.options.command, this.options.args, {
      cwd: this.options.cwd, env: { ...getDefaultEnvironment(), ...this.options.env },
      stdio: ["pipe", "pipe", "pipe"], shell: false, windowsHide: true,
    });
    this.child = child;
    this.exited = new Promise((resolveExit) => child.once("close", (code, signal) => {
      this.lastExit = { code, signal };
      this.child = undefined;
      resolveExit();
      this.onclose?.();
    }));
    child.stderr!.pipe(this.stderr);
    child.stdout!.on("data", (chunk: Buffer) => {
      this.buffer.append(chunk);
      try {
        let message;
        while ((message = this.buffer.readMessage()) !== null) this.onmessage?.(message);
      } catch {
        this.onerror?.(new Error("Invalid MCP response"));
      }
    });
    for (const stream of [child.stdin!, child.stdout!, child.stderr!]) {
      stream.on("error", () => this.onerror?.(new Error("MCP stream failed")));
    }
    await new Promise<void>((resolveStart, reject) => {
      child.once("spawn", resolveStart);
      child.once("error", () => {
        const error = new McpBridgeError("request_failed", "", "spawn");
        reject(error);
        this.onerror?.(error);
      });
    });
    this.stage = "connect";
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if ("method" in message) {
      if (message.method === "initialize") this.stage = "initialize";
      else if (message.method === "tools/list") this.stage = "tools-list";
      else if (message.method === "tools/call") this.stage = "call";
    }
    const stdin = this.child?.stdin;
    if (!stdin || stdin.destroyed) throw new McpBridgeError("request_failed");
    await new Promise<void>((resolveWrite, reject) => stdin.write(serializeMessage(message), (error) => {
      if (error) reject(error);
      else resolveWrite();
    }));
  }

  close(): Promise<void> {
    return this.closing ??= this.closeChild();
  }

  private async closeChild(): Promise<void> {
    const child = this.child;
    if (!child) return;
    const wait = () => new Promise<void>((resolveWait) => {
      const timer = setTimeout(resolveWait, 2_000);
      this.exited!.then(() => { clearTimeout(timer); resolveWait(); });
    });
    child.stdin?.end();
    await wait();
    if (!this.lastExit) { child.kill("SIGTERM"); await wait(); }
    if (!this.lastExit) { child.kill("SIGKILL"); await this.exited; }
    this.buffer.clear();
  }
}

function defaultTransport(options: McpBridgeLaunchOptions): McpTransport {
  return new ObservableMcpTransport(options);
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
    const currentRevision = error?.code === "MANIFEST_GENERATION_CONFLICT"
      ? (error as { currentGeneration?: unknown }).currentGeneration
      : error?.currentRevision;
    if ((error?.code === "REVISION_CONFLICT" || error?.code === "MANIFEST_GENERATION_CONFLICT")
      && typeof currentRevision === "number" && Number.isSafeInteger(currentRevision) && currentRevision >= 0) {
      return { failure: "revision_conflict", currentRevision, errorCode };
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
    dependencies.timeoutMs,
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
  const diagnostics = collectDiagnostic(transport);
  const client = (dependencies.createClient ?? defaultClient)();
  try {
    await bounded(() => client.connect(transport), timeoutMs);
  } catch (error) {
    const failure = attributedFailure(error, diagnostics(), "connect", transport);
    await closeBridge(client, transport, false, timeoutMs, diagnostics()).catch(() => undefined);
    throw failure;
  }

  let closed = false;
  return {
    async listTools() {
      if (closed || !client.listTools) throw new McpBridgeError("request_failed", "", "tools-list");
      try {
        return await bounded(() => client.listTools!(), timeoutMs);
      } catch (error) {
        throw attributedFailure(error, diagnostics(), "tools-list", transport);
      }
    },
    async callTool(name, args) {
      const diagnostic = diagnostics();
      if (closed) throw attributedFailure(new McpBridgeError("request_failed"), diagnostic, "call", transport);
      try {
        const result = await bounded(() => client.callTool({ name, arguments: args }), timeoutMs);
        const failure = toolFailure(result);
        if (failure) throw new McpBridgeError(failure.failure, diagnostic, "call", failure.currentRevision, failure.errorCode);
        return result;
      } catch (error) {
        throw attributedFailure(error, diagnostics(), "call", transport);
      }
    },
    async close() {
      const diagnostic = diagnostics();
      if (closed) return;
      closed = true;
      try {
        await closeBridge(client, transport, true, timeoutMs, diagnostic);
      } catch (error) {
        throw attributedFailure(error, diagnostics(), "close", transport);
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
    dependencies.timeoutMs,
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
  const diagnostics = collectDiagnostic(transport);

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
    failure = attributedFailure(error, diagnostics(), stage, transport);
  }

  try {
    stage = "close";
    await closeBridge(client, transport, connected, timeoutMs, diagnostics());
  } catch (error) {
    if (!failure) failure = attributedFailure(error, diagnostics(), stage, transport);
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
  }, {
    ...dependencies,
    project,
    credentialPurpose,
    timeoutMs: name === "repository_sync" ? REPOSITORY_SYNC_TIMEOUT_MS : dependencies.timeoutMs,
  });
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
