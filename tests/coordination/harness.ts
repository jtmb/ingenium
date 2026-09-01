import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { CoordinationOutbox, type CoordinationOutboxRecord } from "../../packages/ingenium-extension/coordination-outbox";
import { preflightApiAuthentication } from "../../packages/ingenium-extension/api-auth";
import {
  cleanupTestRun,
  createTestRunContext,
  markTestRunRecovered,
  markTestRunProcessCleared,
  readTestRunManifest,
  readTestRunTelemetry,
  releaseTestRunPortReservations,
  transferTestRunPortOwnership,
  updateTestRunManifest,
  type TestRunContext,
  type TestRunProcess,
} from "../test-run-context";
import { inspectProcessIdentity, waitForPortClosed } from "../test-server-lifecycle";
import { readProcStat } from "../test-run-process-discovery";
import {
  HARNESS_ARTIFACT_SCHEMA,
  HARNESS_MANIFEST_SCHEMA,
  EvidenceStore,
  assertOperationalMemoryEntry,
  decodeChangedPath,
  parseCoordinationMemoryBlock,
  readProtectedValue,
  sha256,
  type HarnessOptions,
  type HarnessOwnershipManifest,
  type OperationalMemoryEntry,
} from "./contracts";
import { CoordinationFaultProxy, type FaultProxyEvent } from "./fault-proxy";
import { CANARY_AGENT, CANARY_OPERATIONS, CANARY_TOOL, type CanaryOperation, type CanaryPlan, type CanaryStep } from "./canary-dispatcher";
import { ExecutionLifecycle } from "./execution-lifecycle";
import {
  prepareExternalHome,
  startHostOpenCode,
  stopHostOpenCode,
  waitForOpenCode,
  writeCanaryPlan,
  type HostOpenCodeProcess,
} from "./process-lifecycle";

const execFileAsync = promisify(execFile);
const POLL_INTERVAL_MS = 250;
const INTERNAL_READINESS_POLL_INTERVAL_MS = 5_000;
const INTERNAL_CANARY_AGENT = "ingenium-llm-broker";
const CANARY_TOOL_SYSTEM_PROMPT = `Follow only the current user request. Invoke ${CANARY_TOOL} exactly once with only the supplied nonce and operation. Never invoke any other tool, access files directly, inspect configuration, or reveal credentials.`;
const TRANSFORM_ONLY_SYSTEM_PROMPT = "Follow only the current user request. Never invoke tools, access files, inspect configuration, or reveal credentials.";

type JsonRecord = Record<string, unknown>;

interface StorageBinding {
  projectId: string;
  workspaceId: string;
  storageMappingHash: string;
}

interface RuntimeBinding {
  id: string;
  imageRevision: string;
  state: "READY" | "IDLE";
}

interface HarnessIdentity {
  binding: StorageBinding;
  runtime: RuntimeBinding;
}

export type HarnessCredentialName = "coordination-api" | "operator-api" | "repository-sync" | "opencode-auth";

export interface HarnessAccess {
  coordinationToken: string;
  repositoryToken: string;
  operatorToken: string;
  authContent: string;
  binding: StorageBinding;
  runtime: RuntimeBinding;
}

export interface HarnessAccessDependencies {
  read?: (name: HarnessCredentialName, locator: HarnessOptions["coordinationCredential"]) => string;
  preflight?: typeof preflightHarnessIdentity;
  request?: typeof fetch;
}

interface SessionRecord {
  label: "A" | "B" | "C";
  id: string;
  idHash: string;
  createdAt: string;
  model: { providerId: string; modelId: string; variant: string; agent: string };
}

interface ProjectedTool {
  partId: string;
  callId: string;
  name: string;
  status: string | null;
  nonce: string | null;
  operation: CanaryOperation | null;
  sessionId: string | null;
  messageId: string | null;
  paths: string[];
  commandSha256: string | null;
  outputSha256: string | null;
  outputBytes: number;
  markerObserved: boolean;
}

interface ProjectedTurn {
  label: "A" | "B" | "C";
  name: string;
  sessionIdHash: string;
  acceptedAt: string;
  completedAt: string;
  durationMs: number;
  model: { providerId: string | null; modelId: string | null };
  finish: string | null;
  tools: ProjectedTool[];
  promptSha256: string;
  responseSha256: string;
  responseBytes: number;
  transformEntryIds: string[];
  transformLinks: Array<{ captureIndex: number; captureSha256: string; entryIds: string[] }>;
  responseText: string;
}

interface CrossReadResult {
  turn: ProjectedTurn;
  entry: OperationalMemoryEntry;
}

interface CrossSessionEvidence {
  label: "B" | "C";
  phase: string;
  sessionId: string;
  modelId: string | null;
  promptSha256: string;
  responseSha256: string;
  extracted: {
    memoryNonce: string;
    actorIdSha256: string;
    sourceRevision: number;
    status: OperationalMemoryEntry["status"];
    actionKinds: OperationalMemoryEntry["actionKinds"];
    checkResults: OperationalMemoryEntry["checkResults"];
    todoState: OperationalMemoryEntry["todoState"];
    todoCounts: OperationalMemoryEntry["todoCounts"];
    currentTaskIdSha256: string | null;
    contextRevision: number;
    nextWork: OperationalMemoryEntry["nextWork"];
    changedPathSegments: string[][];
  };
  transformLink: { captureIndex: number; captureSha256: string; entryId: string; linkage: "direct-capture" | "exact-peer-response" };
}

interface OpenCodeApi {
  label: "A" | "B" | "C";
  createSession(title: string): Promise<string>;
  messages(sessionId: string): Promise<unknown[]>;
  status(): Promise<Record<string, unknown>>;
  prompt(sessionId: string, text: string): Promise<void>;
  inspect(signal?: AbortSignal): Promise<JsonRecord>;
}

function record(value: unknown, message: string): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value as JsonRecord;
}

function required(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function unwrap(value: unknown): unknown {
  if (value !== null && typeof value === "object" && !Array.isArray(value) && "data" in value) {
    return (value as { data: unknown }).data;
  }
  return value;
}

async function boundedJson(
  url: string,
  init: RequestInit = {},
  timeoutMs = 15_000,
  signal?: AbortSignal,
): Promise<{ status: number; value: unknown }> {
  signal?.throwIfAborted();
  const response = await fetch(url, { ...init, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs) });
  const value: unknown = await response.json().catch(() => null);
  return { status: response.status, value };
}

async function expectJson(
  url: string,
  init: RequestInit = {},
  statuses: readonly number[] = [200],
  timeoutMs = 15_000,
  signal?: AbortSignal,
): Promise<unknown> {
  const result = await boundedJson(url, init, timeoutMs, signal);
  if (!statuses.includes(result.status)) {
    const body = record(result.value, `Unexpected ${result.status} response from ${new URL(url).pathname}`);
    const error = body.error && typeof body.error === "object" ? body.error as JsonRecord : {};
    throw new Error(`${new URL(url).pathname} returned ${result.status}:${String(error.code ?? "unknown")}`);
  }
  return unwrap(result.value);
}

async function git(worktree: string, args: string[], timeoutMs = 30_000, signal?: AbortSignal): Promise<Buffer> {
  signal?.throwIfAborted();
  const result = await execFileAsync("git", args, {
    cwd: worktree,
    encoding: "buffer",
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    env: { PATH: process.env.PATH ?? "" },
    signal,
  });
  return result.stdout;
}

async function gitFootprint(worktree: string, signal?: AbortSignal): Promise<string> {
  return sha256(Buffer.concat([
    await git(worktree, ["status", "--porcelain=v1", "-z"], 30_000, signal),
    await git(worktree, ["diff", "--binary", "HEAD"], 30_000, signal),
  ]));
}

async function waitFor<T>(
  name: string,
  timeoutMs: number,
  signal: AbortSignal,
  read: (readSignal: AbortSignal) => Promise<T | undefined>,
  timeoutError?: () => Error,
  pollIntervalMs = POLL_INTERVAL_MS,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    const remainingMs = deadline - Date.now();
    const readController = new AbortController();
    const readSignal = AbortSignal.any([signal, readController.signal]);
    const readPromise = Promise.resolve().then(() => read(readSignal));
    void readPromise.catch(() => undefined);
    let deadlineTimer: NodeJS.Timeout | undefined;
    let onAbort: (() => void) | undefined;
    const abortPromise = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(readSignal.reason);
      if (readSignal.aborted) {
        onAbort();
        return;
      }
      readSignal.addEventListener("abort", onAbort, { once: true });
    });
    const deadlinePromise = new Promise<never>((_resolve, reject) => {
      deadlineTimer = setTimeout(() => {
        const error = timeoutError?.() ?? new Error(`Timed out waiting for ${name}`);
        reject(error);
        readController.abort(error);
      }, remainingMs);
    });
    let value: T | undefined;
    try {
      value = await Promise.race([readPromise, deadlinePromise, abortPromise]);
    } finally {
      if (deadlineTimer) clearTimeout(deadlineTimer);
      if (onAbort) readSignal.removeEventListener("abort", onAbort);
    }
    if (value !== undefined) return value;
    await new Promise<void>((resolve, reject) => {
      const onAbort = (): void => { clearTimeout(timer); reject(signal.reason); };
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }
  throw timeoutError?.() ?? new Error(`Timed out waiting for ${name}`);
}

function coordinationHeaders(token: string, options: HarnessOptions): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "x-ingenium-audience": "mcp",
    "x-ingenium-workspace": options.workspaceId,
    "x-ingenium-launcher-worktree": options.worktree,
  };
}

export async function preflightHarnessIdentity(
  options: HarnessOptions,
  signal: AbortSignal,
  request: typeof fetch = fetch,
): Promise<HarnessIdentity> {
  const boundedRequest: typeof fetch = (input, init = {}) => request(input, {
    ...init,
    signal: init.signal ? AbortSignal.any([signal, init.signal]) : signal,
  });
  const result = await preflightApiAuthentication(options.apiUrl, options.worktree, boundedRequest, {
    resolverInput: {
      apiUrl: options.apiUrl,
      project: options.project,
      workspaceId: options.workspaceId,
      launcherWorktree: options.worktree,
      credentialFile: options.coordinationCredential.path,
    },
    runtimeId: options.runtimeId,
    timeoutMs: 15_000,
  });
  required(result.authenticated && result.binding && result.runtime, "Protected preflight identity assertion failed");
  required(result.binding.audience === "mcp"
    && result.binding.scopes.includes("projects:read")
    && result.binding.scopes.includes("coordination:read")
    && result.binding.projectId === options.projectId
    && result.binding.workspaceId === options.workspaceId
    && result.binding.launcherWorktree === options.worktree
    && result.binding.storageMappingHash === options.storageMappingHash,
  "Explicit project/workspace/storage identity does not match the credential binding");
  required(result.runtime.id === options.runtimeId && result.runtime.imageRevision === options.expectedRevision,
    "Explicit runtime UUID or image revision does not match the protected preflight assertion");
  return {
    binding: {
      projectId: result.binding.projectId,
      workspaceId: result.binding.workspaceId,
      storageMappingHash: result.binding.storageMappingHash,
    },
    runtime: result.runtime,
  };
}

export async function establishHarnessAccess(
  options: HarnessOptions,
  signal: AbortSignal,
  dependencies: HarnessAccessDependencies = {},
): Promise<HarnessAccess> {
  const read = dependencies.read ?? ((_name, locator) => readProtectedValue(locator));
  const coordinationToken = read("coordination-api", options.coordinationCredential);
  const { binding, runtime } = await (dependencies.preflight ?? preflightHarnessIdentity)(options, signal, dependencies.request);
  const operatorToken = read("operator-api", options.operatorToken);
  const repositoryToken = read("repository-sync", options.repositoryCredential);
  const authContent = read("opencode-auth", options.openCodeAuth);
  return { coordinationToken, repositoryToken, operatorToken, authContent, binding, runtime };
}

export function buildExternalConfig(
  options: HarnessOptions,
  proxyApiUrl: string,
  binding: StorageBinding,
  label: "A" | "B" = "A",
): string {
  const parsed: unknown = JSON.parse(readFileSync(join(options.worktree, "opencode.json"), "utf8"));
  const config = record(parsed, "opencode.json is invalid");
  const mcp = record(config.mcp, "opencode.json omitted MCP configuration");
  const ingenium = record(mcp.ingenium, "opencode.json omitted Ingenium MCP configuration");
  const environment = record(ingenium.environment, "Ingenium MCP environment is invalid");
  mcp.ingenium = {
    ...ingenium,
    enabled: true,
    environment: {
      ...environment,
      INGENIUM_API_URL: proxyApiUrl,
      INGENIUM_PROJECT: options.project,
      INGENIUM_PROJECT_ID: binding.projectId,
      INGENIUM_WORKSPACE_ID: binding.workspaceId,
      INGENIUM_STORAGE_MAPPING_HASH: binding.storageMappingHash,
      INGENIUM_WORKTREE: options.worktree,
      INGENIUM_MCP_CREDENTIAL_FILE: "{env:INGENIUM_MCP_CREDENTIAL_FILE}",
      INGENIUM_REPOSITORY_SYNC_CREDENTIAL_FILE: "{env:INGENIUM_REPOSITORY_SYNC_CREDENTIAL_FILE}",
    },
  };
  const canUseCanary = label === "A";
  config.default_agent = CANARY_AGENT;
  config.permission = { "*": "deny" };
  config.tools = { "*": false, ...(canUseCanary ? { [CANARY_TOOL]: true } : {}) };
  if (canUseCanary) {
    const plugins = Array.isArray(config.plugin) ? config.plugin : [];
    config.plugin = [...plugins, "file://{env:INGENIUM_COORDINATION_CANARY_PLUGIN}"];
  }
  config.agent = {
    [CANARY_AGENT]: {
      mode: "subagent",
      model: `${options.providerId}/${options.modelId}`,
      variant: options.variant,
      maxSteps: canUseCanary ? 2 : 1,
      tools: { "*": false, ...(canUseCanary ? { [CANARY_TOOL]: true } : {}) },
      permission: { "*": "deny" },
      prompt: canUseCanary ? CANARY_TOOL_SYSTEM_PROMPT : TRANSFORM_ONLY_SYSTEM_PROMPT,
    },
  };
  return `${JSON.stringify(config, null, 2)}\n`;
}

function headersForControl(operatorToken: string, runtimeId: string): Record<string, string> {
  return {
    authorization: `Bearer ${operatorToken}`,
    "content-type": "application/json",
    "x-ingenium-internal-service": "1",
    "x-ingenium-runtime-id": runtimeId,
  };
}

function openCodeApi(
  label: "A" | "B" | "C",
  baseUrl: string,
  options: HarnessOptions,
  signal: AbortSignal,
  control?: { operatorToken: string; runtimeId: string },
): OpenCodeApi {
  const headers = control ? headersForControl(control.operatorToken, control.runtimeId) : { "content-type": "application/json" };
  const directoryQuery = "";
  const prefix = control ? "/sessions" : "/session";
  const request = (path: string, init: RequestInit = {}, statuses: readonly number[] = [200], requestSignal = signal) => expectJson(
    `${baseUrl}${path}${path.includes("?") ? "&" : directoryQuery ? "?" : ""}${directoryQuery.replace(/^\?/, "")}`,
    { ...init, headers: { ...headers, ...(init.headers ?? {}) } },
    statuses,
    options.timeoutMs,
    requestSignal,
  );
  return {
    label,
    async createSession(title) {
      const value = record(await request(prefix, { method: "POST", body: JSON.stringify({ title }) }, control ? [200, 201] : [200]), `${label} session create failed`);
      required(typeof value.id === "string", `${label} session ID is invalid`);
      return value.id;
    },
    async messages(sessionId) {
      const value = await request(control ? `${prefix}/${encodeURIComponent(sessionId)}/messages` : `${prefix}/${encodeURIComponent(sessionId)}/message`);
      required(Array.isArray(value), `${label} messages response is invalid`);
      return value;
    },
    async status() {
      const value = await request(control ? `${prefix}/status` : `${prefix}/status`);
      return record(value, `${label} status response is invalid`);
    },
    async prompt(sessionId, text) {
      const canUseCanary = label === "A";
      const body = JSON.stringify({
        agent: label === "C" ? INTERNAL_CANARY_AGENT : CANARY_AGENT,
        model: { providerID: options.providerId, modelID: options.modelId },
        variant: options.variant,
        tools: { "*": false, ...(canUseCanary ? { [CANARY_TOOL]: true } : {}) },
        system: canUseCanary ? CANARY_TOOL_SYSTEM_PROMPT : TRANSFORM_ONLY_SYSTEM_PROMPT,
        parts: [{ type: "text", text }],
      });
      await request(
        control ? `${prefix}/${encodeURIComponent(sessionId)}/prompt` : `${prefix}/${encodeURIComponent(sessionId)}/prompt_async`,
        { method: "POST", body },
        control ? [202] : [200, 202, 204],
      );
    },
    async inspect(readSignal = signal) {
      if (control) {
        const [health, agents, providers, mcp] = await Promise.all([
          request("/health", {}, [200], readSignal), request("/agents", {}, [200], readSignal),
          request("/providers", {}, [200], readSignal), request("/mcp", {}, [200], readSignal),
        ]);
        return { health, agents, providers, mcp };
      }
      const [health, agents, config, providers, mcp] = await Promise.all([
        request("/global/health", {}, [200], readSignal), request("/agent", {}, [200], readSignal),
        request("/config", {}, [200], readSignal), request("/provider", {}, [200], readSignal),
        request("/mcp", {}, [200], readSignal),
      ]);
      return { health, agents, config, providers, mcp };
    },
  };
}

function assertOpenCodeInspection(label: "A" | "B" | "C", value: JsonRecord, options: HarnessOptions): void {
  const health = record(value.health, `${label} OpenCode health is invalid`);
  const expectedVersion = label === "C" ? options.expectedRuntimeOpenCodeVersion : options.expectedOpenCodeVersion;
  required(health.healthy === true && health.version === expectedVersion, `${label} exact OpenCode version changed`);
  required(Array.isArray(value.agents), `${label} agent catalog is invalid`);
  const agentName = label === "C" ? INTERNAL_CANARY_AGENT : CANARY_AGENT;
  const agent = value.agents.find((entry) => (entry as JsonRecord).name === agentName) as JsonRecord | undefined;
  const model = agent?.model && typeof agent.model === "object" ? agent.model as JsonRecord : {};
  required(agent?.mode === "subagent", `${label} fixed canary agent is unavailable`);
  if (label !== "C") {
    required(model.providerID === options.providerId && model.modelID === options.modelId && agent.variant === options.variant,
      `${label} configured agent mapping does not match the requested model`);
  }
  if (label !== "C") {
    const config = record(value.config, `${label} OpenCode config is invalid`);
    const agents = record(config.agent, `${label} config omitted agents`);
    const mapping = record(agents[CANARY_AGENT], `${label} config omitted the fixed canary agent`);
    required(mapping.model === `${options.providerId}/${options.modelId}` && mapping.variant === options.variant, `${label} exact config mapping changed`);
    const expectedTools = { "*": false, ...(label === "A" ? { [CANARY_TOOL]: true } : {}) };
    required(JSON.stringify(mapping.tools) === JSON.stringify(expectedTools), `${label} canary tool boundary changed`);
  }
  const providers = record(value.providers, `${label} provider catalog is invalid`);
  required(Array.isArray(providers.connected) && providers.connected.includes(options.providerId), `${label} requested provider is disconnected`);
  const mcp = record(value.mcp, `${label} MCP status is invalid`);
  const expectedMcp = record(mcp[label === "C" ? "ingenium-runtime" : "ingenium"], `${label} Ingenium MCP status is missing`);
  required(expectedMcp.status === "connected", `${label} Ingenium MCP is disconnected`);
}

function projectOpenCodeInspection(label: "A" | "B" | "C", value: JsonRecord, options: HarnessOptions): JsonRecord {
  const agents = value.agents as JsonRecord[];
  const agentName = label === "C" ? INTERNAL_CANARY_AGENT : CANARY_AGENT;
  const agent = agents.find((entry) => entry.name === agentName)!;
  const model = agent.model && typeof agent.model === "object" ? agent.model as JsonRecord : {};
  const providers = value.providers as JsonRecord;
  const mcp = value.mcp as JsonRecord;
  const mcpEntry = mcp[label === "C" ? "ingenium-runtime" : "ingenium"] as JsonRecord;
  return {
    label,
    version: (value.health as JsonRecord).version,
    agent: { name: agent.name, mode: agent.mode, providerId: model.providerID ?? null, modelId: model.modelID ?? null, variant: agent.variant ?? null },
    providerConnected: (providers.connected as unknown[]).includes(options.providerId),
    mcpStatus: mcpEntry.status,
    ...(label === "C" ? {} : { configSha256: sha256(JSON.stringify(value.config)) }),
  };
}

export async function inspectReady(api: OpenCodeApi, options: HarnessOptions, signal: AbortSignal, timeoutMs = 90_000): Promise<JsonRecord> {
  let lastError: unknown;
  return waitFor(`${api.label} exact OpenCode/MCP readiness`, timeoutMs, signal, async (readSignal) => {
    try {
      const value = await api.inspect(readSignal);
      assertOpenCodeInspection(api.label, value, options);
      return value;
    } catch (error) {
      lastError = error;
      return undefined;
    }
  }, () => new Error(
    `Timed out waiting for ${api.label} exact OpenCode/MCP readiness: ${lastError instanceof Error ? lastError.message : "unknown readiness failure"}`,
    { cause: lastError },
  ), api.label === "C" ? INTERNAL_READINESS_POLL_INTERVAL_MS : POLL_INTERVAL_MS);
}

function extractToolPaths(part: JsonRecord, worktree: string): string[] {
  const state = part.state && typeof part.state === "object" ? part.state as JsonRecord : {};
  const input = state.input && typeof state.input === "object" ? state.input as JsonRecord : {};
  const paths = new Set<string>();
  for (const candidate of [input.filePath, input.path]) {
    if (typeof candidate !== "string") continue;
    const testsIndex = candidate.indexOf("/tests/");
    const normalized = candidate.startsWith(`${worktree}/`) ? relative(worktree, candidate)
      : testsIndex >= 0 ? candidate.slice(testsIndex + 1) : candidate;
    if (!normalized.startsWith("../") && !normalized.startsWith("/") && !normalized.includes("\\")) paths.add(normalized);
  }
  if (typeof input.patchText === "string") {
    for (const match of input.patchText.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)) {
      const path = match[1]?.trim();
      if (path && !path.startsWith("/") && !path.startsWith("../") && !path.includes("\\")) paths.add(path);
    }
  }
  return [...paths];
}

function canaryResult(output: string): JsonRecord | undefined {
  if (!output) return undefined;
  let value: unknown;
  try { value = JSON.parse(output); } catch { return undefined; }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const result = value as JsonRecord;
  return Object.keys(result).sort().join(",") === "command,messageId,nonce,operation,path,result,schema,sessionId"
    && result.schema === "ingenium.coordination-canary-result/v1" ? result : undefined;
}

function projectTurn(
  label: "A" | "B" | "C",
  name: string,
  sessionId: string,
  messages: unknown[],
  acceptedAt: number,
  marker: string,
  worktree: string,
  prompt: string,
  transformEntryIds: string[],
  transformLinks: ProjectedTurn["transformLinks"],
): ProjectedTurn {
  const tools: ProjectedTool[] = [];
  let text = "";
  let finish: string | null = null;
  let providerId: string | null = null;
  let modelId: string | null = null;
  for (const value of messages) {
    const message = record(value, `${label} message is invalid`);
    const info = message.info && typeof message.info === "object" ? message.info as JsonRecord : {};
    if (info.role !== "assistant" || !Array.isArray(message.parts)) continue;
    if (typeof info.sessionID === "string") required(info.sessionID === sessionId, `${label} message session identity changed`);
    if (typeof info.finish === "string" && info.finish !== "tool-calls") {
      finish = info.finish;
      providerId = typeof info.providerID === "string" ? info.providerID : null;
      modelId = typeof info.modelID === "string" ? info.modelID : null;
      text = message.parts.flatMap((part) => {
        const candidate = part as JsonRecord;
        return candidate.type === "text" && typeof candidate.text === "string" ? [candidate.text] : [];
      }).join("");
    }
    for (const rawPart of message.parts) {
      const part = rawPart as JsonRecord;
      if (part.type !== "tool") continue;
      const state = part.state && typeof part.state === "object" ? part.state as JsonRecord : {};
      const input = state.input && typeof state.input === "object" ? state.input as JsonRecord : {};
      const output = typeof state.output === "string" ? state.output : "";
      const receipt = canaryResult(output);
      const partId = typeof part.id === "string" ? part.id : "";
      const callId = typeof part.callID === "string" ? part.callID : "";
      required(partId.length > 0 && callId.length > 0, `${label} tool call identity is invalid`);
      if (part.tool === CANARY_TOOL) {
        required(Object.keys(input).sort().join(",") === "nonce,operation"
          && typeof input.nonce === "string" && typeof input.operation === "string"
          && CANARY_OPERATIONS.includes(input.operation as CanaryOperation), "Canary tool input exceeded the nonce/operation boundary");
        if (receipt) {
          required(receipt.nonce === input.nonce && receipt.operation === input.operation
            && receipt.sessionId === sessionId && receipt.messageId === info.id,
          "Canary tool receipt is not linked to its exact session, message, nonce, and operation");
        }
      }
      const receiptPath = receipt && typeof receipt.path === "string" ? receipt.path : undefined;
      const receiptCommand = receipt && typeof receipt.command === "string" ? receipt.command : undefined;
      tools.push({
        partId,
        callId,
        name: typeof part.tool === "string" ? part.tool : "unknown",
        status: typeof state.status === "string" ? state.status : null,
        nonce: typeof input.nonce === "string" ? input.nonce : null,
        operation: typeof input.operation === "string" && CANARY_OPERATIONS.includes(input.operation as CanaryOperation)
          ? input.operation as CanaryOperation : null,
        sessionId: receipt && typeof receipt.sessionId === "string" ? receipt.sessionId
          : typeof info.sessionID === "string" ? info.sessionID : null,
        messageId: receipt && typeof receipt.messageId === "string" ? receipt.messageId
          : typeof info.id === "string" ? info.id : null,
        paths: receiptPath ? [receiptPath] : extractToolPaths(part, worktree),
        commandSha256: receiptCommand ? sha256(receiptCommand) : typeof input.command === "string" ? sha256(input.command) : null,
        outputSha256: output ? sha256(output) : null,
        outputBytes: Buffer.byteLength(output),
        markerObserved: output.includes(marker),
      });
    }
  }
  required(finish !== null, `${label} turn did not contain a terminal assistant message`);
  const completedAt = Date.now();
  const projected: ProjectedTurn = {
    label,
    name,
    sessionIdHash: sha256(sessionId),
    acceptedAt: new Date(acceptedAt).toISOString(),
    completedAt: new Date(completedAt).toISOString(),
    durationMs: completedAt - acceptedAt,
    model: { providerId, modelId },
    finish,
    tools,
    promptSha256: sha256(prompt),
    responseSha256: sha256(text),
    responseBytes: Buffer.byteLength(text),
    transformEntryIds,
    transformLinks,
    responseText: text,
  };
  Object.defineProperty(projected, "responseText", { value: text, enumerable: false });
  return projected;
}

function readCapture(path: string): JsonRecord[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).map((line) => {
    const capture = record(JSON.parse(line), "Transform capture line is invalid");
    required(Object.keys(capture).sort().join(",") === "activity,memory,schemaVersion" && capture.schemaVersion === 1
      && (capture.memory === null || typeof capture.memory === "string")
      && (capture.activity === null || typeof capture.activity === "string"), "Transform capture shape is invalid");
    return capture;
  });
}

function readTrace(path: string): JsonRecord[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).map((line) => record(JSON.parse(line), "Coordination trace line is invalid"));
}

async function runTurn(
  api: OpenCodeApi,
  sessionId: string,
  name: string,
  prompt: string,
  options: HarnessOptions,
  marker: string,
  signal: AbortSignal,
  captureFile?: string,
): Promise<ProjectedTurn> {
  signal.throwIfAborted();
  const before = await api.messages(sessionId);
  const captureCount = captureFile ? readCapture(captureFile).length : 0;
  const acceptedAt = Date.now();
  await api.prompt(sessionId, prompt);
  const messages = await waitFor(`${api.label} ${name} terminal message`, options.timeoutMs, signal, async () => {
    const all = await api.messages(sessionId);
    const current = all.slice(before.length);
    const terminal = current.some((value) => {
      const message = value as { info?: { role?: string; finish?: string } };
      return message.info?.role === "assistant" && typeof message.info.finish === "string" && message.info.finish !== "tool-calls";
    });
    if (!terminal) return undefined;
    const status = await api.status();
    const state = status[sessionId] as JsonRecord | undefined;
    return !state || state.type === "idle" || state.status === "idle" ? current : undefined;
  });
  const transformEntryIds: string[] = [];
  const transformLinks: ProjectedTurn["transformLinks"] = [];
  if (captureFile) {
    const captures = readCapture(captureFile);
    for (const [offset, capture] of captures.slice(captureCount).entries()) {
      const entries = parseCoordinationMemoryBlock(capture.memory ?? null);
      for (const entry of entries) {
        assertOperationalMemoryEntry(entry);
        transformEntryIds.push(entry.entryId);
      }
      if (entries.length > 0) transformLinks.push({
        captureIndex: captureCount + offset,
        captureSha256: sha256(JSON.stringify(capture)),
        entryIds: entries.map((entry) => entry.entryId),
      });
    }
    required(new Set(transformEntryIds).size === transformEntryIds.length, `${api.label} transform repeated a memory entry`);
  }
  const projected = projectTurn(api.label, name, sessionId, messages, acceptedAt, marker, options.worktree, prompt, transformEntryIds, transformLinks);
  required(projected.model.providerId === options.providerId && projected.model.modelId === options.modelId, `${api.label} used the wrong model`);
  return projected;
}

export const CROSS_READ_PROMPT = "Return only the newest entry object from the transform-injected COORDINATION_MEMORY_V2 memoryEntries array as exact JSON, with no markdown, tools, file reads, helper data, or explanation.";

export function parseCrossReadResponse(text: string): OperationalMemoryEntry {
  const value: unknown = JSON.parse(text.trim());
  assertOperationalMemoryEntry(value);
  return value;
}

export function crossReadPromptContainsExpected(entry: OperationalMemoryEntry): boolean {
  const values = [entry.entryId, entry.actorId, String(entry.sourceRevision), String(entry.contextRevision),
    ...entry.changedPathSegments.flat()];
  return values.some((value) => value.length >= 8 && CROSS_READ_PROMPT.includes(value));
}

async function runCrossReadTurn(
  api: OpenCodeApi,
  sessionId: string,
  name: string,
  options: HarnessOptions,
  signal: AbortSignal,
  captureFile?: string,
): Promise<CrossReadResult> {
  const turn = await runTurn(api, sessionId, name, CROSS_READ_PROMPT, options, "", signal, captureFile);
  required(turn.tools.length === 0, `${api.label} cross-read invoked a model tool`);
  return { turn, entry: parseCrossReadResponse(turn.responseText) };
}

function validateCrossReadResults(
  results: readonly CrossReadResult[],
  expectedEntries: readonly OperationalMemoryEntry[],
  expectedPath: string,
): ProjectedTurn["transformLinks"][number] {
  required(results.length > 0 && results.every((result) => !crossReadPromptContainsExpected(result.entry)), "Cross-read prompt contains an expected value");
  const expected = expectedEntries.find((entry) => entry.entryId === results[0]!.entry.entryId);
  required(expected !== undefined && memoryPaths([expected]).includes(expectedPath), "Cross-read response did not identify the expected transformed path");
  for (const result of results) {
    required(JSON.stringify(result.entry) === JSON.stringify(expected), `${result.turn.label} did not report the exact transform-injected typed entry`);
  }
  const direct = results.flatMap((result) => result.turn.transformLinks)
    .find((link) => link.entryIds.includes(expected.entryId));
  required(direct !== undefined, "Cross-read response has no transform capture linkage");
  return direct;
}

function projectCrossSessionEvidence(
  result: CrossReadResult,
  phase: string,
  sessionId: string,
  transformLink: ProjectedTurn["transformLinks"][number],
): CrossSessionEvidence {
  const entry = result.entry;
  return {
    label: result.turn.label as "B" | "C",
    phase,
    sessionId,
    modelId: result.turn.model.modelId,
    promptSha256: result.turn.promptSha256,
    responseSha256: result.turn.responseSha256,
    extracted: {
      memoryNonce: entry.entryId,
      actorIdSha256: sha256(entry.actorId),
      sourceRevision: entry.sourceRevision,
      status: entry.status,
      actionKinds: entry.actionKinds,
      checkResults: entry.checkResults,
      todoState: entry.todoState,
      todoCounts: entry.todoCounts,
      currentTaskIdSha256: entry.currentTaskId ? sha256(entry.currentTaskId) : null,
      contextRevision: entry.contextRevision,
      nextWork: entry.nextWork,
      changedPathSegments: entry.changedPathSegments,
    },
    transformLink: {
      captureIndex: transformLink.captureIndex,
      captureSha256: transformLink.captureSha256,
      entryId: entry.entryId,
      linkage: result.turn.transformLinks.some((link) => link.captureSha256 === transformLink.captureSha256)
        ? "direct-capture" : "exact-peer-response",
    },
  };
}

function dispatchPrompt(plan: CanaryPlan): string {
  const step = plan.steps[0]!;
  return `Invoke ${CANARY_TOOL} exactly once with ${JSON.stringify({ nonce: plan.nonce, operation: step.operation })}. Do not invoke another tool.`;
}

async function runDispatchTurn(
  api: OpenCodeApi,
  sessionId: string,
  name: string,
  plan: CanaryPlan,
  options: HarnessOptions,
  signal: AbortSignal,
  prepared: ReturnType<typeof prepareExternalHome>,
  captureFile?: string,
  expectedStatus: "completed" | "error" = "completed",
): Promise<ProjectedTurn> {
  const step = plan.steps[0]!;
  writeCanaryPlan(prepared, plan);
  const turn = await runTurn(api, sessionId, name, dispatchPrompt(plan), options, step.marker ?? "", signal, captureFile);
  required(turn.tools.length === 1, `Model A ${name} did not invoke exactly one tool`);
  const tool = turn.tools[0]!;
  required(tool.name === CANARY_TOOL && tool.status === expectedStatus && tool.callId.length > 0
    && tool.sessionId === sessionId && tool.messageId !== null
    && tool.nonce === plan.nonce && tool.operation === step.operation,
  `Model A ${name} tool-call identity or nonce binding changed`);
  if (expectedStatus === "completed") {
    required((step.path === null || tool.paths.includes(step.path))
      && (step.marker === null || tool.markerObserved), `Model A ${name} result is not linked to the exact side effect`);
  }
  return turn;
}

async function runControlTurn(
  api: OpenCodeApi,
  sessionId: string,
  name: string,
  options: HarnessOptions,
  signal: AbortSignal,
  captureFile?: string,
): Promise<ProjectedTurn> {
  const prompt = `Return only ${JSON.stringify({ role: api.label, mode: "transform-only-control" })}. Do not use tools.`;
  const turn = await runTurn(api, sessionId, name, prompt, options, "", signal, captureFile);
  required(turn.tools.length === 0, `${api.label} control turn invoked a model tool`);
  return turn;
}

function outboxRecords(worktree: string): CoordinationOutboxRecord[] {
  return new CoordinationOutbox(worktree).list();
}

function mutationPhase(record: CoordinationOutboxRecord): string | null {
  return record.mutation?.phase ?? null;
}

function outboxContainsPath(record: CoordinationOutboxRecord, expectedPath: string): boolean {
  return record.mutation?.declaredPathSegments.some((segments) => decodeChangedPath(segments) === expectedPath) ?? false;
}

async function bindProcess(
  context: TestRunContext,
  processRecord: HostOpenCodeProcess,
  name: "dashboard" | "fixture",
  signal: AbortSignal,
): Promise<TestRunProcess> {
  const identity = await waitFor(`${processRecord.label} process identity`, 5_000, signal, async () => {
    const found = processRecord.child.pid ? inspectProcessIdentity(processRecord.child.pid) : undefined;
    return found?.runNonce === context.runNonce ? found : undefined;
  });
  const record: TestRunProcess = {
    name,
    pid: processRecord.child.pid!,
    port: processRecord.port,
    startedAt: processRecord.startedAt,
    runNonce: context.runNonce,
    pidStartTime: identity.pidStartTime,
    pgid: identity.pgid,
    executable: identity.executable,
    groupIdentity: identity.groupIdentity,
    identityState: "bound",
  };
  const manifest = readTestRunManifest(context.manifestPath);
  updateTestRunManifest(context.manifestPath, { status: "running", processes: [...manifest.processes, record] });
  return record;
}

export function assertRecordedProcessExited(record: TestRunProcess): void {
  const current = inspectProcessIdentity(record.pid);
  const stat = readProcStat(record.pid);
  if (!current) {
    if (!stat || stat.state === "Z") return;
    throw new Error(`Process identity is ambiguous for ${record.name}; retaining its manifest record`);
  }
  const matches = current.runNonce === record.runNonce
    && current.pidStartTime === record.pidStartTime
    && current.pgid === record.pgid
    && current.executable === record.executable
    && current.groupIdentity === record.groupIdentity;
  if (matches) throw new Error(`Process ${record.name} (pid ${record.pid}) is still active; retaining its manifest record`);
  throw new Error(`Process identity changed for ${record.name}; retaining its manifest record`);
}

async function clearProcessAfterProof(context: TestRunContext, processRecord: HostOpenCodeProcess, record: TestRunProcess): Promise<void> {
  await stopHostOpenCode(processRecord, context.runNonce);
  assertRecordedProcessExited(record);
  await waitForPortClosed(record.port);
  markTestRunProcessCleared(context.manifestPath, record);
  const manifest = readTestRunManifest(context.manifestPath);
  updateTestRunManifest(context.manifestPath, { processes: manifest.processes.filter((entry) => entry.pid !== record.pid) });
}

async function assertGitCommit(worktree: string, expectedPath: string, previousRevision: string, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  const current = (await git(worktree, ["rev-parse", "HEAD"], 30_000, signal)).toString("utf8").trim();
  required(current !== previousRevision && /^[0-9a-f]{40}$/.test(current), "Model A did not create a Git commit");
  const parent = (await git(worktree, ["rev-parse", `${current}^`], 30_000, signal)).toString("utf8").trim();
  required(parent === previousRevision, "Model A commit was not based on the preflight revision");
  const paths = (await git(worktree, ["diff-tree", "--no-commit-id", "--name-only", "-r", current], 30_000, signal)).toString("utf8").trim().split("\n").filter(Boolean);
  required(paths.length === 1 && paths[0] === expectedPath, "Model A commit changed an unexpected path");
  return current;
}

function assertTurnTool(turn: ProjectedTurn, name: string, path?: string): void {
  required(turn.tools.some((tool) => tool.name.toLowerCase() === name.toLowerCase() && tool.status === "completed"
    && (path === undefined || tool.paths.includes(path))), `${turn.label} ${turn.name} did not complete ${name}${path ? ` for ${path}` : ""}`);
}

function assertTurnCommands(turn: ProjectedTurn, commands: readonly string[]): void {
  const actual = new Set(turn.tools.flatMap((tool) => tool.commandSha256 ? [tool.commandSha256] : []));
  for (const command of commands) required(actual.has(sha256(command)), `${turn.label} ${turn.name} omitted an exact managed command`);
}

function memoryPaths(entries: OperationalMemoryEntry[]): string[] {
  return [...new Set(entries.flatMap((entry) => entry.changedPathSegments.map(decodeChangedPath).filter((path): path is string => path !== undefined)))];
}

function newestMemoryForPath(captureFile: string, path: string): OperationalMemoryEntry[] {
  const entries = readCapture(captureFile).flatMap((capture) => parseCoordinationMemoryBlock(capture.memory ?? null));
  const matches = entries.filter((entry) => memoryPaths([entry]).includes(path));
  required(matches.length > 0, `Typed coordination memory omitted ${path}`);
  return matches;
}

function worktreeId(binding: StorageBinding): string {
  return `worktree-${sha256(`${binding.workspaceId}\0${binding.storageMappingHash}`)}`;
}

async function recoverQuarantinedEpoch(
  options: HarnessOptions,
  token: string,
  binding: StorageBinding,
  signal: AbortSignal,
): Promise<JsonRecord> {
  const identity = {
    worktree_id: worktreeId(binding),
    session_id: randomUUID(),
    incarnation: Date.now(),
    ownership_token: sha256(randomUUID()),
    ttl_ms: 300_000,
    idempotency_key: randomUUID(),
  };
  const call = async (pathname: string, body: unknown, statuses: readonly number[] = [200]): Promise<JsonRecord> => record(await expectJson(
    `${options.apiUrl}/coordination${pathname}?project=${encodeURIComponent(options.project)}`,
    { method: "POST", headers: coordinationHeaders(token, options), body: JSON.stringify(body) },
    statuses,
    15_000,
    signal,
  ), `Coordination recovery ${pathname} response is invalid`);
  let session = record((await call("/register", identity, [200, 201])).session, "Recovery registration omitted a session");
  const lease = (extra: JsonRecord = {}): JsonRecord => ({
    worktree_id: identity.worktree_id,
    session_id: identity.session_id,
    incarnation: identity.incarnation,
    expected_revision: session.revision,
    fence: session.fence,
    ownership_token: identity.ownership_token,
    idempotency_key: randomUUID(),
    ...extra,
  });
  const state = await call("/epoch/recovery-state", lease());
  const proof = {
    quarantined_session_id: state.quarantinedSessionId,
    quarantined_incarnation: state.quarantinedIncarnation,
    quarantined_fence: state.quarantinedFence,
    quarantined_actor_id: state.quarantinedActorId,
    accepted_epoch: state.acceptedEpoch,
    recovery_footprint_hash: await gitFootprint(options.worktree, signal),
  };
  session = record((await call("/epoch/reconcile", lease(proof))).session, "Epoch reconcile omitted a session");
  const recovered = await call("/epoch/recover", lease(proof));
  session = record(recovered.session, "Epoch recovery omitted a session");
  await call("/close", lease());
  return {
    quarantineCode: state.quarantineCode,
    acceptedEpochBefore: state.acceptedEpoch,
    acceptedEpochAfter: recovered.acceptedEpoch,
    footprintSha256: proof.recovery_footprint_hash,
  };
}

function canaryPlan(options: HarnessOptions, role: "A" | "B" | "C", step: CanaryStep): CanaryPlan {
  return { version: 1, role, nonce: randomUUID(), worktree: options.worktree, project: options.project, check: options.check, steps: [step] };
}

export async function finalizeCoordinationTestRun(context: TestRunContext): Promise<void> {
  const manifest = readTestRunManifest(context.manifestPath);
  if (!manifest.telemetryPath) throw new Error("Coordination cleanup requires runner telemetry");
  const telemetry = readTestRunTelemetry(manifest.telemetryPath, manifest.repoRoot);
  if (telemetry.runId !== manifest.runId
    || telemetry.runNonce !== manifest.runNonce
    || telemetry.repoRoot !== manifest.repoRoot
    || telemetry.manifestPath !== manifest.manifestPath) {
    throw new Error("Coordination cleanup telemetry identity does not match the current manifest");
  }
  const processKey = (record: TestRunProcess): string => [
    record.pid, record.pidStartTime, record.pgid, record.executable, record.groupIdentity, record.runNonce,
  ].join("\0");
  const processes = new Map<string, TestRunProcess>();
  for (const record of [
    ...manifest.processes,
    ...telemetry.processes
      .filter((entry) => entry.state === "active" || entry.state === "retained")
      .map((entry) => entry.record),
  ]) {
    processes.set(processKey(record), record);
  }
  processes.forEach(assertRecordedProcessExited);
  const ports = new Set([
    ...Object.values(manifest.ports),
    ...(manifest.portReservations ?? []).map((reservation) => reservation.port),
    ...manifest.processes.map((record) => record.port),
    ...Object.values(telemetry.ports),
    ...telemetry.processes.map((entry) => entry.record.port),
  ]);
  for (const port of ports) await waitForPortClosed(port);
  releaseTestRunPortReservations(manifest, { allowMissing: true });
  updateTestRunManifest(context.manifestPath, { status: "complete", processes: [], portReservations: [] });
  markTestRunRecovered(context.manifestPath);
  cleanupTestRun(context.manifestPath);
}

export function attachCoordinationCleanupFailure(primaryError: unknown, cleanupError: unknown): void {
  if (!(primaryError instanceof Error)) return;
  try {
    Object.defineProperty(primaryError, "cleanupError", {
      configurable: true,
      enumerable: false,
      value: cleanupError,
    });
  } catch {}
}

export async function finishCoordinationCleanup(
  primaryError: unknown,
  hasPrimaryError: boolean,
  cleanup: () => Promise<void>,
  retain: (cleanupError: unknown) => void,
): Promise<void> {
  try {
    await cleanup();
  } catch (cleanupError) {
    let retentionError: unknown;
    try { retain(cleanupError); } catch (error) { retentionError = error; }
    if (hasPrimaryError) {
      attachCoordinationCleanupFailure(primaryError, cleanupError);
      if (primaryError instanceof Error && retentionError !== undefined) {
        try {
          Object.defineProperty(primaryError, "cleanupRetentionError", {
            configurable: true,
            enumerable: false,
            value: retentionError,
          });
        } catch {}
      }
      return;
    }
    if (retentionError !== undefined) {
      throw new AggregateError([cleanupError, retentionError], "Coordination cleanup and retention failed", { cause: cleanupError });
    }
    throw cleanupError;
  }
}

export async function runCoordinationHarness(options: HarnessOptions): Promise<string> {
  const lifecycle = new ExecutionLifecycle();
  lifecycle.start();
  const originalRevision = (await git(options.worktree, ["rev-parse", "HEAD"], 30_000, lifecycle.signal)).toString("utf8").trim();
  required(originalRevision === options.expectedRevision, "Git revision does not match --expected-revision");
  required((await git(options.worktree, ["status", "--porcelain=v1"], 30_000, lifecycle.signal)).byteLength === 0, "Live coordination harness requires a clean worktree");

  const { coordinationToken, repositoryToken, operatorToken, authContent, binding, runtime } = await establishHarnessAccess(options, lifecycle.signal);
  const secrets = [
    coordinationToken, repositoryToken, operatorToken, authContent,
    options.coordinationCredential.path, options.repositoryCredential.path,
    options.operatorToken.path, options.openCodeAuth.path,
  ];
  const context = createTestRunContext({ repoRoot: options.worktree, applyEnvironment: false });
  const artifactRoot = join(options.worktree, "tests", "artifacts", "test-runs", context.runId);
  const evidence = new EvidenceStore(options.worktree, artifactRoot, secrets);
  const proxyEvents: FaultProxyEvent[] = [];
  const proxy = new CoordinationFaultProxy({ upstream: options.apiUrl, port: context.ports.api, onEvent: (event) => proxyEvents.push(event) });
  let externalA: HostOpenCodeProcess | undefined;
  let externalB: HostOpenCodeProcess | undefined;
  let recordA: TestRunProcess | undefined;
  let recordB: TestRunProcess | undefined;
  const turns: ProjectedTurn[] = [];
  const sessions: SessionRecord[] = [];
  const crossSessionEvidence: CrossSessionEvidence[] = [];
  const markerA = `coordination-${context.runId}-a`;
  const markerB = `coordination-${context.runId}-ambiguous`;
  const markerFailure = `coordination-${context.runId}-local-failure`;
  const markerRestart = `coordination-${context.runId}-restart`;
  const pathA = `tests/coordination/${context.runId}-a.txt`;
  const pathAmbiguous = `tests/coordination/${context.runId}-ambiguous.txt`;
  const pathFailure = `tests/coordination/${context.runId}-local-failure.txt`;
  const pathRestart = `tests/coordination/${context.runId}-restart.txt`;
  const cleanup = (): Promise<void> => lifecycle.cleanup(async () => {
    const errors: unknown[] = [];
    updateTestRunManifest(context.manifestPath, { status: "stopping" });
    for (const processRecord of [externalB, externalA]) {
      if (!processRecord) continue;
      try { await stopHostOpenCode(processRecord, context.runNonce); } catch (error) { errors.push(error); }
    }
    try { await proxy.close(); } catch (error) { errors.push(error); }
    if (errors.length === 0) {
      try { await finalizeCoordinationTestRun(context); } catch (error) { errors.push(error); }
    }
    evidence.write("cleanup.json", {
      schema: HARNESS_ARTIFACT_SCHEMA,
      completedAt: new Date().toISOString(),
      externalAStopped: !externalA || externalA.child.exitCode !== null || externalA.child.signalCode !== null,
      externalBStopped: !externalB || externalB.child.exitCode !== null || externalB.child.signalCode !== null,
      proxyStopped: true,
      tempRemoved: !existsSync(context.runDir),
      errors: errors.map((error) => error instanceof Error ? error.message : String(error)),
    });
    if (errors.length > 0) throw new AggregateError(errors, "Coordination harness cleanup failed");
  });
  const signals = ["SIGINT", "SIGTERM"] as const;
  const signalHandlers = new Map(signals.map((signal) => [signal, () => {
    lifecycle.abort(new Error(`Harness received ${signal}`));
    void cleanup().finally(() => { process.exitCode = 130; });
  }] as const));
  signals.forEach((signal) => process.once(signal, signalHandlers.get(signal)!));
  let primaryError: unknown;
  let hasPrimaryError = false;

  try {
    lifecycle.assertRunning();
    evidence.write("preflight.json", {
      schema: HARNESS_ARTIFACT_SCHEMA,
      checkedAt: new Date().toISOString(),
      gitRevision: originalRevision,
      project: options.project,
      workspaceId: binding.workspaceId,
      projectId: binding.projectId,
      storageMappingHash: binding.storageMappingHash,
      runtime,
      model: { agent: CANARY_AGENT, providerId: options.providerId, modelId: options.modelId, variant: options.variant },
      openCodeVersion: options.expectedOpenCodeVersion,
      runtimeOpenCodeVersion: options.expectedRuntimeOpenCodeVersion,
    });
    await proxy.start(lifecycle.signal);
    lifecycle.assertRunning();
    transferTestRunPortOwnership(context.manifestPath, context.ports.api);
    const proxyApiUrl = `${proxy.url}/api/v1`;
    const configA = buildExternalConfig(options, proxyApiUrl, binding, "A");
    const configB = buildExternalConfig(options, proxyApiUrl, binding, "B");
    const preparedA = prepareExternalHome(context.runDir, "external-a", options, configA);
    const preparedB = prepareExternalHome(context.runDir, "external-b", options, configB);
    externalA = await startHostOpenCode("external-a", context.ports.dashboard, preparedA, options, proxyApiUrl, configA, binding, authContent, context.runNonce, lifecycle.signal);
    externalB = await startHostOpenCode("external-b", context.ports.fixture, preparedB, options, proxyApiUrl, configB, binding, authContent, context.runNonce, lifecycle.signal);
    recordA = await bindProcess(context, externalA, "dashboard", lifecycle.signal);
    recordB = await bindProcess(context, externalB, "fixture", lifecycle.signal);
    await Promise.all([
      waitForOpenCode(`http://127.0.0.1:${context.ports.dashboard}`, options.expectedOpenCodeVersion, lifecycle.signal),
      waitForOpenCode(`http://127.0.0.1:${context.ports.fixture}`, options.expectedOpenCodeVersion, lifecycle.signal),
    ]);
    transferTestRunPortOwnership(context.manifestPath, context.ports.dashboard);
    transferTestRunPortOwnership(context.manifestPath, context.ports.fixture);

    const apiA = openCodeApi("A", `http://127.0.0.1:${context.ports.dashboard}`, options, lifecycle.signal);
    let apiB = openCodeApi("B", `http://127.0.0.1:${context.ports.fixture}`, options, lifecycle.signal);
    const apiC = openCodeApi("C", `${options.apiUrl}/opencode`, options, lifecycle.signal, { operatorToken, runtimeId: runtime.id });
    const inspected = await Promise.all([inspectReady(apiA, options, lifecycle.signal), inspectReady(apiB, options, lifecycle.signal), inspectReady(apiC, options, lifecycle.signal)]);
    evidence.write("processes.json", {
      schema: HARNESS_ARTIFACT_SCHEMA,
      capturedAt: new Date().toISOString(),
      externalA: { pid: externalA.child.pid, port: externalA.port, homeSha256: sha256(externalA.home) },
      externalB: { pid: externalB.child.pid, port: externalB.port, homeSha256: sha256(externalB.home) },
      internalC: { runtimeId: runtime.id, imageRevision: runtime.imageRevision, state: runtime.state },
      inspections: inspected.map((value, index) => projectOpenCodeInspection((["A", "B", "C"] as const)[index]!, value, options)),
    });

    const [sessionA, sessionB, sessionC] = await Promise.all([
      apiA.createSession(`coordination-${context.runId}-A`),
      apiB.createSession(`coordination-${context.runId}-B`),
      apiC.createSession(`coordination-${context.runId}-C`),
    ]);
    for (const [label, id] of [["A", sessionA], ["B", sessionB], ["C", sessionC]] as const) {
      sessions.push({ label, id, idHash: sha256(id), createdAt: new Date().toISOString(), model: {
         providerId: options.providerId, modelId: options.modelId, variant: options.variant, agent: label === "C" ? INTERNAL_CANARY_AGENT : CANARY_AGENT,
      } });
    }
    proxy.setPhase("fail_registration", lifecycle.signal);
    const overlapStart = Date.now();
    const planAInitial = canaryPlan(options, "A", { operation: "mutate_commit_sync", slot: "a", path: pathA, marker: markerA });
    const [turnA, turnB, turnC] = await Promise.all([
      runDispatchTurn(apiA, sessionA, "registration-outage-mutation", planAInitial, options, lifecycle.signal, preparedA, preparedA.captureFile),
      runControlTurn(apiB, sessionB, "concurrent-control", options, lifecycle.signal, preparedB.captureFile),
      runControlTurn(apiC, sessionC, "concurrent-control", options, lifecycle.signal),
    ]);
    turns.push(turnA, turnB, turnC);
    const overlapEnd = Date.now();
    const overlappedTurns = [turnA, turnB, turnC];
    required(overlappedTurns.every((turn) => Date.parse(turn.acceptedAt) < overlapEnd && Date.parse(turn.completedAt) > overlapStart)
      && Math.max(...overlappedTurns.map((turn) => Date.parse(turn.acceptedAt)))
        < Math.min(...overlappedTurns.map((turn) => Date.parse(turn.completedAt))), "A/B/C model windows did not overlap");
    evidence.write("overlap.json", {
      schema: HARNESS_ARTIFACT_SCHEMA,
      windowStartedAt: new Date(overlapStart).toISOString(),
      windowCompletedAt: new Date(overlapEnd).toISOString(),
      turns: overlappedTurns.map((turn) => ({ label: turn.label, acceptedAt: turn.acceptedAt, completedAt: turn.completedAt, model: turn.model })),
    });
    assertTurnTool(turnA, "coordination_canary", pathA);
    const initialCommands = ["fixed:edit-check-commit-sync"];
    assertTurnCommands(turnA, initialCommands);
    const managedTrace = readTrace(preparedA.traceFile).filter((entry) => entry.operation === "tool.execute.before" || entry.operation === "tool.execute.after");
    required(managedTrace.some((entry) => entry.operation === "tool.execute.before")
      && managedTrace.some((entry) => entry.operation === "tool.execute.after"), "Model A commands did not traverse the managed execution hooks");
    required(readFileSync(join(options.worktree, pathA), "utf8") === `${markerA}\n`, "Model A evidence content is invalid");
    let currentRevision = await assertGitCommit(options.worktree, pathA, originalRevision, lifecycle.signal);
    const localApplied = await waitFor("local_applied coordination outbox evidence", 30_000, lifecycle.signal, async () => outboxRecords(options.worktree)
      .find((entry) => mutationPhase(entry) === "local_applied" && outboxContainsPath(entry, pathA)));
    const resourceSync = await waitFor("resource sync while coordination registration is unavailable", 90_000, lifecycle.signal, async () => proxy.snapshot().find((event) => event.pathname.endsWith("/repository/sync") && event.disposition === "forwarded" && event.upstreamStatus !== null && event.upstreamStatus < 300));
    required(proxy.snapshot().some((event) => event.pathname.endsWith("/coordination/register") && event.disposition === "blocked"), "Registration fault was not exercised");

    proxy.setPhase("pass", lifecycle.signal);
    turns.push(await runDispatchTurn(apiA, sessionA, "registration-recovery", canaryPlan(options, "A", { operation: "noop", slot: "control", path: null, marker: null }), options, lifecycle.signal, preparedA, preparedA.captureFile));
    await waitFor("local_applied outbox replay", 90_000, lifecycle.signal, async () => outboxRecords(options.worktree).some((entry) => entry.key === localApplied.key) ? undefined : true);
    const [bRead, cRead] = await Promise.all([
      runCrossReadTurn(apiB, sessionB, "cross-read-a", options, lifecycle.signal, preparedB.captureFile),
      runCrossReadTurn(apiC, sessionC, "cross-read-a", options, lifecycle.signal),
    ]);
    turns.push(bRead.turn, cRead.turn);
    const memoryA = newestMemoryForPath(preparedB.captureFile, pathA);
    const memoryALink = validateCrossReadResults([bRead, cRead], memoryA, pathA);
    crossSessionEvidence.push(
      projectCrossSessionEvidence(bRead, "cross-read-a", sessionB, memoryALink),
      projectCrossSessionEvidence(cRead, "cross-read-a", sessionC, memoryALink),
    );

    proxy.setPhase("lose_completion_response", lifecycle.signal);
    const ambiguous = await runDispatchTurn(apiA, sessionA, "completion-response-lost", canaryPlan(options, "A", { operation: "mutate_only", slot: "ambiguous", path: pathAmbiguous, marker: markerB }), options, lifecycle.signal, preparedA, preparedA.captureFile);
    turns.push(ambiguous);
    assertTurnTool(ambiguous, "coordination_canary", pathAmbiguous);
    const ambiguousRecord = await waitFor("completion_ambiguous outbox evidence", 30_000, lifecycle.signal, async () => outboxRecords(options.worktree)
      .find((entry) => mutationPhase(entry) === "completion_ambiguous" && outboxContainsPath(entry, pathAmbiguous)));
    proxy.setPhase("pass", lifecycle.signal);
    turns.push(await runDispatchTurn(apiA, sessionA, "completion-idempotent-replay", canaryPlan(options, "A", { operation: "noop", slot: "control", path: null, marker: null }), options, lifecycle.signal, preparedA, preparedA.captureFile));
    await waitFor("ambiguous outbox replay", 90_000, lifecycle.signal, async () => outboxRecords(options.worktree).some((entry) => entry.key === ambiguousRecord.key) ? undefined : true);
    const completionEvents = await waitFor("receipt-backed completion replay", 30_000, lifecycle.signal, async () => {
      const events = proxy.snapshot().filter((event) => event.pathname.endsWith("/coordination/claims/complete")
        && event.requestSha256 === proxy.snapshot().find((candidate) => candidate.pathname.endsWith("/coordination/claims/complete")
          && candidate.disposition === "response_lost")?.requestSha256);
      return events.length >= 2 ? events : undefined;
    });
    const lostCompletion = completionEvents.find((event) => event.disposition === "response_lost");
    const replayedCompletion = completionEvents.find((event) => event.disposition === "forwarded" && event.phase === "pass");
    required(lostCompletion?.upstreamStatus === 200 && replayedCompletion?.upstreamStatus === 200
      && lostCompletion.upstreamResponseSha256 !== null
      && lostCompletion.upstreamResponseSha256 === replayedCompletion.upstreamResponseSha256,
    "Completion replay did not return the prior receipt-backed success");
    required(!proxy.snapshot().some((event) => event.pathname.endsWith("/coordination/claims/quarantine")),
      "Delivered completion was incorrectly quarantined");

    const failedLocal = await runDispatchTurn(apiA, sessionA, "local-action-failure", canaryPlan(options, "A", {
      operation: "fail_local", slot: "ambiguous", path: pathFailure, marker: markerFailure,
    }), options, lifecycle.signal, preparedA, preparedA.captureFile, "error");
    turns.push(failedLocal);
    required(!existsSync(join(options.worktree, pathFailure)), "Failed local action changed its declared path");
    const localFailureQuarantine = await waitFor("local failure quarantine", 30_000, lifecycle.signal, async () => proxy.snapshot()
      .find((event) => event.pathname.endsWith("/coordination/claims/quarantine") && event.disposition === "forwarded" && event.upstreamStatus === 200));
    const recovery = await recoverQuarantinedEpoch(options, coordinationToken, binding, lifecycle.signal);

    const commitAmbiguous = await runDispatchTurn(apiA, sessionA, "commit-recovered-mutation", canaryPlan(options, "A", { operation: "commit_sync", slot: "ambiguous", path: pathAmbiguous, marker: markerB }), options, lifecycle.signal, preparedA, preparedA.captureFile);
    turns.push(commitAmbiguous);
    currentRevision = await assertGitCommit(options.worktree, pathAmbiguous, currentRevision, lifecycle.signal);
    const [bAmbiguousRead, cAmbiguousRead] = await Promise.all([
      runCrossReadTurn(apiB, sessionB, "cross-read-recovered", options, lifecycle.signal, preparedB.captureFile),
      runCrossReadTurn(apiC, sessionC, "cross-read-recovered", options, lifecycle.signal),
    ]);
    turns.push(bAmbiguousRead.turn, cAmbiguousRead.turn);
    const memoryAmbiguous = newestMemoryForPath(preparedB.captureFile, pathAmbiguous);
    const memoryAmbiguousLink = validateCrossReadResults([bAmbiguousRead, cAmbiguousRead], memoryAmbiguous, pathAmbiguous);
    crossSessionEvidence.push(
      projectCrossSessionEvidence(bAmbiguousRead, "cross-read-recovered", sessionB, memoryAmbiguousLink),
      projectCrossSessionEvidence(cAmbiguousRead, "cross-read-recovered", sessionC, memoryAmbiguousLink),
    );

    const preservedCount = (await apiB.messages(sessionB)).length;
    await clearProcessAfterProof(context, externalB, recordB);
    externalB = undefined;
    recordB = undefined;
    lifecycle.assertRunning();
    const restartMutation = await runDispatchTurn(apiA, sessionA, "restart-handoff", canaryPlan(options, "A", { operation: "mutate_commit_sync", slot: "restart", path: pathRestart, marker: markerRestart }), options, lifecycle.signal, preparedA, preparedA.captureFile);
    turns.push(restartMutation);
    currentRevision = await assertGitCommit(options.worktree, pathRestart, currentRevision, lifecycle.signal);
    lifecycle.assertRunning();
    externalB = await startHostOpenCode("external-b", context.ports.fixture, preparedB, options, proxyApiUrl, configB, binding, authContent, context.runNonce, lifecycle.signal);
    recordB = await bindProcess(context, externalB, "fixture", lifecycle.signal);
    await waitForOpenCode(`http://127.0.0.1:${context.ports.fixture}`, options.expectedOpenCodeVersion, lifecycle.signal);
    apiB = openCodeApi("B", `http://127.0.0.1:${context.ports.fixture}`, options, lifecycle.signal);
    required((await apiB.messages(sessionB)).length >= preservedCount, "B session messages were not preserved across restart");
    const bRestartRead = await runCrossReadTurn(apiB, sessionB, "restart-replay", options, lifecycle.signal, preparedB.captureFile);
    turns.push(bRestartRead.turn);
    const memoryRestart = newestMemoryForPath(preparedB.captureFile, pathRestart);
    const memoryRestartLink = validateCrossReadResults([bRestartRead], memoryRestart, pathRestart);
    crossSessionEvidence.push(projectCrossSessionEvidence(bRestartRead, "restart-replay", sessionB, memoryRestartLink));
    const duplicate = await runTurn(apiB, sessionB, "restart-dedupe", "Return only {\"noNewMemory\":true} if no COORDINATION_MEMORY_V2 block is injected. Do not use tools or files.", options, "", lifecycle.signal, preparedB.captureFile);
    turns.push(duplicate);
    required(duplicate.transformEntryIds.length === 0 && duplicate.tools.length === 0
      && JSON.stringify(JSON.parse(duplicate.responseText.trim())) === JSON.stringify({ noNewMemory: true }), "Restarted B repeated acknowledged memory");

    const identityAfter = await preflightHarnessIdentity(options, lifecycle.signal);
    required(JSON.stringify(identityAfter.binding) === JSON.stringify(binding)
      && identityAfter.runtime.id === runtime.id
      && identityAfter.runtime.imageRevision === runtime.imageRevision,
    "Protected runtime identity changed during the harness");
    required((await git(options.worktree, ["status", "--porcelain=v1"], 30_000, lifecycle.signal)).byteLength === 0, "Harness left the worktree dirty");

    const manifest: HarnessOwnershipManifest = {
      schema: HARNESS_MANIFEST_SCHEMA,
      runId: context.runId,
      runNonce: context.runNonce,
      createdAt: context.createdAt,
      repoRoot: options.worktree,
      artifactRoot,
      tempRoot: context.runDir,
      revision: currentRevision,
      project: options.project,
      workspaceId: options.workspaceId,
      ports: { proxy: context.ports.api, externalA: context.ports.dashboard, externalB: context.ports.fixture, internalC: 4098 },
      processes: [
        { role: "external-a", pid: externalA.child.pid!, externalId: null, port: externalA.port, startedAt: externalA.startedAt, stoppedAt: null, commandSha256: sha256(`${options.openCodeBinary}\0serve\0${externalA.port}`) },
        { role: "external-b", pid: externalB.child.pid!, externalId: null, port: externalB.port, startedAt: externalB.startedAt, stoppedAt: null, commandSha256: sha256(`${options.openCodeBinary}\0serve\0${externalB.port}`) },
        { role: "internal-c", pid: null, externalId: runtime.id, port: null, startedAt: context.createdAt, stoppedAt: null, commandSha256: sha256(`${runtime.id}\0${runtime.imageRevision}\0opencode`) },
      ],
      boundaries: { liveRun: true, applicationSourceMutation: false, tokenBytesRetained: false, runtimeCreated: false },
    };
    evidence.write("ownership.json", manifest);
    evidence.write("sessions.json", { schema: HARNESS_ARTIFACT_SCHEMA, sessions });
    evidence.write("turns.json", { schema: HARNESS_ARTIFACT_SCHEMA, turns });
    evidence.write("managed-path.json", {
      schema: HARNESS_ARTIFACT_SCHEMA,
      commandSha256: initialCommands.map(sha256),
      trace: managedTrace,
       commitRevisions: (await git(options.worktree, ["rev-list", "--reverse", `${originalRevision}..HEAD`], 30_000, lifecycle.signal)).toString("utf8").trim().split(/\s+/).filter(Boolean),
    });
    evidence.write("faults.json", {
      schema: HARNESS_ARTIFACT_SCHEMA,
      events: proxy.snapshot(),
      registrationBlocked: true,
      resourceSyncDuringOutage: resourceSync,
      localApplied: { keySha256: sha256(localApplied.key), phase: mutationPhase(localApplied) },
       completionReplay: {
         keySha256: sha256(ambiguousRecord.key),
         retainedPhase: mutationPhase(ambiguousRecord),
         requestSha256: replayedCompletion.requestSha256,
         responseSha256: replayedCompletion.upstreamResponseSha256,
       },
       localFailureQuarantine: { requestSha256: localFailureQuarantine.requestSha256, disposition: localFailureQuarantine.disposition },
    });
    evidence.write("memory.json", {
      schema: HARNESS_ARTIFACT_SCHEMA,
      paths: [pathA, pathAmbiguous, pathRestart],
      entries: [...memoryA, ...memoryRestart],
      crossRead: crossSessionEvidence,
      restart: { sessionIdHash: sha256(sessionB), preservedMessages: preservedCount, replayedPath: pathRestart, duplicateToolCount: duplicate.tools.length },
    });
    evidence.write("recovery.json", { schema: HARNESS_ARTIFACT_SCHEMA, recovery });
    evidence.write("result.json", {
      schema: HARNESS_ARTIFACT_SCHEMA,
      result: "PASS",
      completedAt: new Date().toISOString(),
      revisionBefore: originalRevision,
      revisionAfter: currentRevision,
      changedPaths: [pathA, pathAmbiguous, pathRestart],
      sourceTestsProve: ["harness contracts and model-executed focused checks"],
      deployedCanariesProve: ["existing API/runtime coordination and repository-sync paths"],
      modelSessionArtifactsProve: ["simultaneous A/B/C calls, exact models, cross-read, restart replay"],
      boundaries: ["live harness only", "no runtime creation", "no application source mutation", "no retained credential bytes"],
    });
    return context.runId;
  } catch (error) {
    primaryError = error;
    hasPrimaryError = true;
    lifecycle.abort(error);
    evidence.write("failure.json", {
      schema: HARNESS_ARTIFACT_SCHEMA,
      failedAt: new Date().toISOString(),
      error: error instanceof Error ? { name: error.name, message: error.message, stackSha256: sha256(error.stack ?? "") } : { name: "Error", message: String(error) },
      turns,
      proxyEvents,
      retainedForRecovery: true,
    });
    throw error;
  } finally {
    signals.forEach((signal) => process.removeListener(signal, signalHandlers.get(signal)!));
    await finishCoordinationCleanup(primaryError, hasPrimaryError, cleanup, (cleanupError) => {
      evidence.write("cleanup-failure.json", {
        schema: HARNESS_ARTIFACT_SCHEMA,
        failedAt: new Date().toISOString(),
        error: cleanupError instanceof Error
          ? { name: cleanupError.name, message: cleanupError.message, stackSha256: sha256(cleanupError.stack ?? "") }
          : { name: "Error", message: String(cleanupError) },
        primaryErrorRetained: hasPrimaryError,
        retainedForRecovery: true,
      });
    });
  }
}
