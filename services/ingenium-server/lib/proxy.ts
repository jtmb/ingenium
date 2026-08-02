/**
 * Runtime bridge for persisted child MCP definitions.
 *
 * This module intentionally has no database access. Callers provide the
 * shell-free executable/argument contract established by MCP-001, and may
 * inject already-resolved environment values at the trusted boundary. Vault
 * references themselves are never passed to child processes or logged here.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { deserializeMessage, serializeMessage } from "@modelcontextprotocol/sdk/shared/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { logger } from "./logger.js";

export const CHILD_MCP_STARTUP_TIMEOUT_MS = 5_000;
/** One bounded multipart file upload may take longer than an ordinary tool call. */
export const CHILD_MCP_REQUEST_TIMEOUT_MS = 30_000;
export const CHILD_MCP_SHUTDOWN_TIMEOUT_MS = 3_000;

const MAX_CHILD_MCP_ARGS = 32;
const MAX_CHILD_MCP_TOOLS = 128;
const MAX_CHILD_MCP_TOOL_PAGES = 8;
const MAX_CHILD_MCP_SCHEMA_BYTES = 16 * 1024;
const MAX_CHILD_MCP_ARGUMENT_BYTES = 64 * 1024;
const MAX_STDIO_MESSAGE_BYTES = 1_048_576;
const MAX_ENV_VALUE_LENGTH = 16 * 1024;

const CHILD_SERVER_NAME_PATTERN = /^[a-z][a-z0-9]{0,47}$/;
const CHILD_TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const ENVIRONMENT_KEY_PATTERN = /^[A-Z_][A-Z0-9_]{0,63}$/;

/** A runtime-ready form of the MCP-001 executable/argument persistence contract. */
export interface ChildMcpRuntimeDefinition {
  name: string;
  executable: string;
  args: readonly string[];
  /**
   * Values must be resolved by a trusted API/vault boundary before reaching
   * this module. The persisted MCP-001 vault references are deliberately not
   * accepted here.
   */
  environment?: Readonly<Record<string, string>>;
}

export interface ChildMcpTimeouts {
  startupMs?: number;
  requestMs?: number;
  shutdownMs?: number;
}

export type ChildMcpLifecycleState =
  | "registered"
  | "starting"
  | "ready"
  | "degraded"
  | "stopping"
  | "stopped"
  | "failed"
  | "exited";

export type ChildMcpDiagnostic = "timeout" | "unavailable" | "invalid_response" | null;

export interface ChildMcpExitStatus {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export interface ChildMcpRuntimeStatus {
  name: string;
  state: ChildMcpLifecycleState;
  pid: number | null;
  toolCount: number;
  diagnostic: ChildMcpDiagnostic;
  lastExit: ChildMcpExitStatus | null;
  /** Bounded metadata only; child stderr text is never surfaced or logged. */
  stderrBytes: number;
}

export interface ChildMcpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export type ChildMcpToolCallResult = Awaited<ReturnType<Client["callTool"]>>;

export type ChildMcpRuntimeErrorCode =
  | "CHILD_MCP_CONFIG_INVALID"
  | "CHILD_MCP_NOT_FOUND"
  | "CHILD_MCP_NOT_READY"
  | "CHILD_MCP_UNKNOWN_TOOL"
  | "CHILD_MCP_INVALID_ARGUMENTS"
  | "CHILD_MCP_STARTUP_TIMEOUT"
  | "CHILD_MCP_REQUEST_TIMEOUT"
  | "CHILD_MCP_SHUTDOWN_TIMEOUT"
  | "CHILD_MCP_UNAVAILABLE"
  | "CHILD_MCP_INVALID_RESPONSE";

/** Error messages are stable codes so child output, arguments, and secrets cannot leak. */
export class ChildMcpRuntimeError extends Error {
  constructor(public readonly code: ChildMcpRuntimeErrorCode) {
    super(code);
    this.name = "ChildMcpRuntimeError";
  }
}

interface RuntimeRecord {
  definition: ChildMcpRuntimeDefinition;
  state: ChildMcpLifecycleState;
  diagnostic: ChildMcpDiagnostic;
  client: Client | null;
  transport: ObservableStdioClientTransport | null;
  tools: Map<string, ChildMcpTool>;
  lastExit: ChildMcpExitStatus | null;
  stderrBytes: number;
  stopRequested: boolean;
  preserveFailureOnStop: boolean;
  startPromise: Promise<ChildMcpRuntimeStatus> | null;
  stopPromise: Promise<void> | null;
}

interface NormalizedTimeouts {
  startupMs: number;
  requestMs: number;
  shutdownMs: number;
}

function normalizedTimeout(value: number | undefined, fallback: number): number {
  if (!Number.isInteger(value) || value === undefined || value < 50 || value > 60_000) return fallback;
  return value;
}

function timeoutOptions(timeouts: ChildMcpTimeouts): NormalizedTimeouts {
  return {
    startupMs: normalizedTimeout(timeouts.startupMs, CHILD_MCP_STARTUP_TIMEOUT_MS),
    requestMs: normalizedTimeout(timeouts.requestMs, CHILD_MCP_REQUEST_TIMEOUT_MS),
    shutdownMs: normalizedTimeout(timeouts.shutdownMs, CHILD_MCP_SHUTDOWN_TIMEOUT_MS),
  };
}

function cloneDefinition(definition: ChildMcpRuntimeDefinition): ChildMcpRuntimeDefinition {
  return {
    name: definition.name,
    executable: definition.executable,
    args: [...definition.args],
    environment: definition.environment ? { ...definition.environment } : undefined,
  };
}

function validateDefinition(definition: ChildMcpRuntimeDefinition): void {
  if (!CHILD_SERVER_NAME_PATTERN.test(definition.name) || definition.name === "thread") {
    throw new ChildMcpRuntimeError("CHILD_MCP_CONFIG_INVALID");
  }
  if (
    definition.executable.length === 0
    || definition.executable.length > 1_024
    || /[\s\u0000-\u001f\u007f]/.test(definition.executable)
  ) {
    throw new ChildMcpRuntimeError("CHILD_MCP_CONFIG_INVALID");
  }
  if (definition.args.length > MAX_CHILD_MCP_ARGS) throw new ChildMcpRuntimeError("CHILD_MCP_CONFIG_INVALID");
  for (const argument of definition.args) {
    if (typeof argument !== "string" || argument.length > 2_048 || /[\u0000-\u001f\u007f]/.test(argument)) {
      throw new ChildMcpRuntimeError("CHILD_MCP_CONFIG_INVALID");
    }
  }
  for (const [key, value] of Object.entries(definition.environment ?? {})) {
    if (!ENVIRONMENT_KEY_PATTERN.test(key) || typeof value !== "string" || value.length > MAX_ENV_VALUE_LENGTH || value.includes("\0")) {
      throw new ChildMcpRuntimeError("CHILD_MCP_CONFIG_INVALID");
    }
  }
}

function safeBaseEnvironment(): Record<string, string> {
  const keys = process.platform === "win32"
    ? ["PATH", "SYSTEMROOT", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA"]
    : ["PATH", "HOME", "TMPDIR", "TMP", "TEMP"];
  const environment: Record<string, string> = {};
  for (const key of keys) {
    const value = process.env[key];
    if (value !== undefined && !value.startsWith("()")) environment[key] = value;
  }
  return environment;
}

function childEnvironment(definition: ChildMcpRuntimeDefinition): Record<string, string> {
  return { ...safeBaseEnvironment(), ...definition.environment };
}

function errorDiagnostic(error: unknown): Exclude<ChildMcpDiagnostic, null> {
  if (error instanceof ChildMcpRuntimeError && error.code.includes("TIMEOUT")) return "timeout";
  if (typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === -32001) {
    return "timeout";
  }
  if (error instanceof SyntaxError || (error instanceof Error && error.name === "ZodError")) return "invalid_response";
  if (error instanceof Error && /timeout/i.test(error.message)) return "timeout";
  return "unavailable";
}

function isErrno(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === code;
}

function runtimeError(error: unknown, timeoutCode: ChildMcpRuntimeErrorCode): ChildMcpRuntimeError {
  if (error instanceof ChildMcpRuntimeError) return error;
  if (errorDiagnostic(error) === "timeout") return new ChildMcpRuntimeError(timeoutCode);
  if (errorDiagnostic(error) === "invalid_response") return new ChildMcpRuntimeError("CHILD_MCP_INVALID_RESPONSE");
  return new ChildMcpRuntimeError("CHILD_MCP_UNAVAILABLE");
}

async function bounded<T>(operation: Promise<T>, timeoutMs: number, timeoutCode: ChildMcpRuntimeErrorCode): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new ChildMcpRuntimeError(timeoutCode)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function isJsonValue(value: unknown, depth = 0, nodes: { value: number } = { value: 0 }): value is null | boolean | number | string | unknown[] | Record<string, unknown> {
  nodes.value += 1;
  if (nodes.value > 512 || depth > 16) return false;
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return value.length <= MAX_CHILD_MCP_ARGUMENT_BYTES;
  if (Array.isArray(value)) return value.length <= 128 && value.every((entry) => isJsonValue(entry, depth + 1, nodes));
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const entries = Object.entries(value as Record<string, unknown>);
  return entries.length <= 128 && entries.every(([key, entry]) => (
    key !== "__proto__" && key !== "constructor" && key !== "prototype" && isJsonValue(entry, depth + 1, nodes)
  ));
}

function safeJsonRecord(value: unknown, maxBytes: number): Record<string, unknown> | null {
  if (!isJsonValue(value) || value === null || Array.isArray(value) || typeof value !== "object") return null;
  try {
    const serialized = JSON.stringify(value);
    if (serialized.length > maxBytes) return null;
    return JSON.parse(serialized) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function validateTool(tool: { name: string; description?: string; inputSchema: unknown }): ChildMcpTool {
  if (
    !CHILD_TOOL_NAME_PATTERN.test(tool.name)
    || tool.name.startsWith("ingenium_")
    || typeof tool.description !== "string"
    || tool.description.length === 0
    || tool.description.length > 1_024
  ) {
    throw new ChildMcpRuntimeError("CHILD_MCP_INVALID_RESPONSE");
  }
  const inputSchema = safeJsonRecord(tool.inputSchema, MAX_CHILD_MCP_SCHEMA_BYTES);
  if (!inputSchema || inputSchema.type !== "object") throw new ChildMcpRuntimeError("CHILD_MCP_INVALID_RESPONSE");
  return { name: tool.name, description: tool.description, inputSchema };
}

/**
 * A stdio transport with explicit process exit observability. The SDK's stock
 * transport intentionally hides its ChildProcess, which prevents reporting an
 * exit code/signal or proving graceful shutdown to this runtime boundary.
 */
class ObservableStdioClientTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: <T extends JSONRPCMessage>(message: T) => void;

  private child: ChildProcess | null = null;
  private stdoutBuffer = Buffer.alloc(0);
  private exitPromise: Promise<ChildMcpExitStatus> | null = null;
  private resolveExit: ((status: ChildMcpExitStatus) => void) | null = null;
  private closePromise: Promise<void> | null = null;
  /**
   * POSIX children run in a dedicated session/process group. Retaining its ID
   * after the direct child exits lets shutdown reap descendants that outlive
   * their parent instead of treating the stdio close as successful cleanup.
   */
  private processGroupId: number | null = null;
  private closed = false;
  private stderrBytes = 0;

  constructor(
    private readonly definition: ChildMcpRuntimeDefinition,
    private readonly shutdownMs: number,
    private readonly onExit: (status: ChildMcpExitStatus, stderrBytes: number) => void,
  ) {}

  get pid(): number | null {
    return this.child?.pid ?? null;
  }

  async start(): Promise<void> {
    if (this.child) throw new ChildMcpRuntimeError("CHILD_MCP_UNAVAILABLE");
    this.closed = false;
    this.exitPromise = new Promise<ChildMcpExitStatus>((resolve) => {
      this.resolveExit = resolve;
    });

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const settle = (callback: () => void) => {
        if (settled) return;
        settled = true;
        callback();
      };

      const child = spawn(this.definition.executable, [...this.definition.args], {
        env: childEnvironment(this.definition),
        stdio: ["pipe", "pipe", "pipe"],
        shell: false,
        // A separate POSIX process group makes a group signal affect only this
        // child server and its descendants, never the parent MCP process.
        detached: process.platform !== "win32",
        windowsHide: true,
      });
      this.child = child;
      this.processGroupId = process.platform === "win32" ? null : child.pid ?? null;

      child.once("spawn", () => settle(resolve));
      child.once("error", (error) => {
        this.emitError(error);
        settle(() => reject(error));
      });
      child.once("close", (code, signal) => {
        const status = { code, signal };
        this.child = null;
        this.resolveExit?.(status);
        this.resolveExit = null;
        this.onExit(status, this.stderrBytes);
        this.emitClose();
        settle(() => reject(new ChildMcpRuntimeError("CHILD_MCP_UNAVAILABLE")));
      });
      child.stdout?.on("data", (chunk: Buffer) => this.handleStdout(chunk));
      child.stdout?.on("error", (error) => this.emitError(error));
      child.stdin?.on("error", (error) => this.emitError(error));
      child.stderr?.on("data", (chunk: Buffer) => {
        this.stderrBytes = Math.min(MAX_STDIO_MESSAGE_BYTES, this.stderrBytes + chunk.length);
      });
      child.stderr?.on("error", (error) => this.emitError(error));
    });
  }

  async send(message: JSONRPCMessage): Promise<void> {
    const stdin = this.child?.stdin;
    if (!stdin || stdin.destroyed) throw new ChildMcpRuntimeError("CHILD_MCP_UNAVAILABLE");
    const serialized = serializeMessage(message);
    await new Promise<void>((resolve, reject) => {
      try {
        stdin.write(serialized, (error: Error | null | undefined) => {
          if (error) reject(error);
          else resolve();
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    const closePromise = this.closeChild();
    this.closePromise = closePromise;
    void closePromise.then(
      () => {
        if (this.closePromise === closePromise) this.closePromise = null;
      },
      () => {
        // Share one result with concurrent callers while allowing an explicit
        // retry after a surfaced shutdown failure.
        if (this.closePromise === closePromise) this.closePromise = null;
      },
    );
    return closePromise;
  }

  /** True only while the directly-spawned POSIX process group still exists. */
  hasLiveProcessGroup(): boolean {
    const processGroupId = this.processGroupId;
    if (processGroupId === null) {
      const child = this.child;
      return child !== null && child.exitCode === null && child.signalCode === null;
    }
    try {
      process.kill(-processGroupId, 0);
      return true;
    } catch (error) {
      if (isErrno(error, "ESRCH")) {
        this.processGroupId = null;
        return false;
      }
      // EPERM still proves that a process group exists. The subsequent signal
      // attempt surfaces the failure rather than reporting a false success.
      return true;
    }
  }

  private handleStdout(chunk: Buffer): void {
    this.stdoutBuffer = Buffer.concat([this.stdoutBuffer, chunk]);
    if (this.stdoutBuffer.length > MAX_STDIO_MESSAGE_BYTES) {
      this.emitError(new ChildMcpRuntimeError("CHILD_MCP_INVALID_RESPONSE"));
      void this.close();
      return;
    }

    while (true) {
      const newline = this.stdoutBuffer.indexOf("\n");
      if (newline === -1) return;
      const line = this.stdoutBuffer.toString("utf8", 0, newline).replace(/\r$/, "");
      this.stdoutBuffer = this.stdoutBuffer.subarray(newline + 1);
      try {
        this.onmessage?.(deserializeMessage(line));
      } catch (error) {
        this.emitError(error instanceof Error ? error : new Error("invalid child MCP response"));
        void this.close();
        return;
      }
    }
  }

  private async closeChild(): Promise<void> {
    const child = this.child;
    if (!child && !this.hasLiveProcessGroup()) {
      this.emitClose();
      return;
    }

    try {
      child?.stdin?.end();
    } catch {
      // The process may have exited between the lookup and stdin shutdown.
    }

    const gracefulMs = Math.max(1, Math.floor(this.shutdownMs / 3));
    const terminateMs = Math.max(1, Math.floor(this.shutdownMs / 3));
    const killMs = Math.max(1, this.shutdownMs - gracefulMs - terminateMs);

    if (await this.waitForTermination(gracefulMs)) return;
    this.sendTerminationSignal("SIGTERM");
    if (await this.waitForTermination(terminateMs)) return;
    this.sendTerminationSignal("SIGKILL");
    if (await this.waitForTermination(killMs)) return;
    throw new ChildMcpRuntimeError("CHILD_MCP_SHUTDOWN_TIMEOUT");
  }

  private async waitForTermination(timeoutMs: number): Promise<boolean> {
    if (this.processGroupId === null) return this.waitForExit(timeoutMs);
    if (!this.hasLiveProcessGroup()) return true;

    return new Promise((resolve) => {
      const pollMs = Math.min(25, Math.max(1, Math.floor(timeoutMs / 4)));
      let settled = false;
      const settle = (value: boolean) => {
        if (settled) return;
        settled = true;
        clearInterval(poll);
        clearTimeout(timeout);
        resolve(value);
      };
      const poll = setInterval(() => {
        if (!this.hasLiveProcessGroup()) settle(true);
      }, pollMs);
      const timeout = setTimeout(() => settle(!this.hasLiveProcessGroup()), timeoutMs);
    });
  }

  private async waitForExit(timeoutMs: number): Promise<boolean> {
    if (!this.exitPromise) return true;
    let timeout: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        this.exitPromise.then(() => true),
        new Promise<boolean>((resolve) => {
          timeout = setTimeout(() => resolve(false), timeoutMs);
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private sendTerminationSignal(signal: NodeJS.Signals): void {
    const processGroupId = this.processGroupId;
    try {
      if (processGroupId !== null) {
        process.kill(-processGroupId, signal);
        return;
      }
      const child = this.child;
      if (!child || child.exitCode !== null || child.signalCode !== null) return;
      child.kill(signal);
    } catch (error) {
      if (isErrno(error, "ESRCH")) {
        this.processGroupId = null;
        return;
      }
      throw new ChildMcpRuntimeError("CHILD_MCP_SHUTDOWN_TIMEOUT");
    }
  }

  private emitError(error: Error): void {
    if (!this.closed) this.onerror?.(error);
  }

  private emitClose(): void {
    if (this.closed) return;
    this.closed = true;
    this.stdoutBuffer = Buffer.alloc(0);
    this.onclose?.();
  }
}

/**
 * Owns live child MCP client connections. There is deliberately no automatic
 * retry loop: a caller can observe a terminal state and explicitly reconnect.
 */
export class ChildMcpRuntimeManager {
  private readonly servers = new Map<string, RuntimeRecord>();
  private readonly timeouts: NormalizedTimeouts;
  private stopAllPromise: Promise<void> | null = null;

  constructor(timeouts: ChildMcpTimeouts = {}) {
    this.timeouts = timeoutOptions(timeouts);
  }

  registerServer(definition: ChildMcpRuntimeDefinition): void {
    validateDefinition(definition);
    const current = this.servers.get(definition.name);
    if (
      this.stopAllPromise
      || (current && (
        !["registered", "stopped", "failed", "exited"].includes(current.state)
        || current.transport !== null
        || current.startPromise !== null
        || current.stopPromise !== null
      ))
    ) {
      throw new ChildMcpRuntimeError("CHILD_MCP_NOT_READY");
    }
    this.servers.set(definition.name, {
      definition: cloneDefinition(definition),
      state: "registered",
      diagnostic: null,
      client: null,
      transport: null,
      tools: new Map(),
      lastExit: null,
      stderrBytes: 0,
      stopRequested: false,
      preserveFailureOnStop: false,
      startPromise: null,
      stopPromise: null,
    });
  }

  async unregisterServer(name: string): Promise<void> {
    const record = this.getRecord(name);
    await this.stopRecord(record);
    this.servers.delete(name);
  }

  async startServer(name: string): Promise<ChildMcpRuntimeStatus> {
    const record = this.getRecord(name);
    if (this.stopAllPromise) throw new ChildMcpRuntimeError("CHILD_MCP_NOT_READY");
    if (record.stopPromise) await record.stopPromise;
    if (record.state === "ready" || record.state === "degraded") return this.status(record);
    if (record.startPromise) return record.startPromise;
    // A direct child can exit while a descendant remains in its dedicated
    // process group. Reap that group before a reconnect can replace its record.
    if (record.transport) await this.stopRecord(record);

    const startPromise = this.startRecord(record);
    record.startPromise = startPromise;
    try {
      return await startPromise;
    } finally {
      if (record.startPromise === startPromise) record.startPromise = null;
    }
  }

  /** Explicit reconnect only; child failures never start background retry loops. */
  async reconnectServer(name: string): Promise<ChildMcpRuntimeStatus> {
    const record = this.getRecord(name);
    if (record.transport || ["ready", "degraded", "starting", "stopping"].includes(record.state)) await this.stopRecord(record);
    if (record.startPromise) await record.startPromise.catch(() => undefined);
    return this.startServer(name);
  }

  async listTools(name: string): Promise<ChildMcpTool[]> {
    const record = this.getRecord(name);
    this.requireConnected(record);
    return this.discoverTools(record);
  }

  async callTool(name: string, toolName: string, arguments_: unknown = {}): Promise<ChildMcpToolCallResult> {
    const record = this.getRecord(name);
    this.requireConnected(record);
    if (!CHILD_TOOL_NAME_PATTERN.test(toolName) || toolName.startsWith("ingenium_")) {
      throw new ChildMcpRuntimeError("CHILD_MCP_UNKNOWN_TOOL");
    }
    if (record.tools.size === 0) await this.discoverTools(record);
    if (!record.tools.has(toolName)) throw new ChildMcpRuntimeError("CHILD_MCP_UNKNOWN_TOOL");
    const argumentsRecord = safeJsonRecord(arguments_, MAX_CHILD_MCP_ARGUMENT_BYTES);
    if (!argumentsRecord) throw new ChildMcpRuntimeError("CHILD_MCP_INVALID_ARGUMENTS");

    try {
      return await bounded(
        record.client!.callTool(
          { name: toolName, arguments: argumentsRecord },
          undefined,
          { timeout: this.timeouts.requestMs, maxTotalTimeout: this.timeouts.requestMs },
        ),
        this.timeouts.requestMs,
        "CHILD_MCP_REQUEST_TIMEOUT",
      );
    } catch (error) {
      const normalized = runtimeError(error, "CHILD_MCP_REQUEST_TIMEOUT");
      this.markDegraded(record, errorDiagnostic(normalized), "tools/call");
      throw normalized;
    }
  }

  async healthServer(name: string): Promise<ChildMcpRuntimeStatus> {
    const record = this.getRecord(name);
    this.requireConnected(record);
    try {
      await bounded(
        record.client!.ping({ timeout: this.timeouts.requestMs, maxTotalTimeout: this.timeouts.requestMs }),
        this.timeouts.requestMs,
        "CHILD_MCP_REQUEST_TIMEOUT",
      );
      record.state = "ready";
      record.diagnostic = null;
      return this.status(record);
    } catch (error) {
      const normalized = runtimeError(error, "CHILD_MCP_REQUEST_TIMEOUT");
      this.markDegraded(record, errorDiagnostic(normalized), "ping");
      throw normalized;
    }
  }

  async stopServer(name: string): Promise<void> {
    await this.stopRecord(this.getRecord(name));
  }

  stopAll(): Promise<void> {
    if (this.stopAllPromise) return this.stopAllPromise;
    const stopAllPromise = this.stopAllRecords();
    this.stopAllPromise = stopAllPromise;
    void stopAllPromise.then(
      () => {
        if (this.stopAllPromise === stopAllPromise) this.stopAllPromise = null;
      },
      () => {
        if (this.stopAllPromise === stopAllPromise) this.stopAllPromise = null;
      },
    );
    return stopAllPromise;
  }

  private async stopAllRecords(): Promise<void> {
    const results = await Promise.allSettled([...this.servers.values()].map((record) => this.stopRecord(record)));
    let failed = false;
    for (const result of results) {
      if (result.status === "rejected") {
        failed = true;
        logger.error({ boundary: "child-mcp-shutdown", diagnostic: errorDiagnostic(result.reason) }, "Child MCP shutdown did not complete cleanly");
      }
    }
    // Process shutdown callers must receive a rejection rather than exit with
    // success after a child process group could not be verified as gone.
    if (failed) throw new ChildMcpRuntimeError("CHILD_MCP_SHUTDOWN_TIMEOUT");
  }

  getStatus(name: string): ChildMcpRuntimeStatus {
    return this.status(this.getRecord(name));
  }

  getStatuses(): ChildMcpRuntimeStatus[] {
    return [...this.servers.values()].map((record) => this.status(record));
  }

  private async startRecord(record: RuntimeRecord): Promise<ChildMcpRuntimeStatus> {
    record.state = "starting";
    record.diagnostic = null;
    record.tools.clear();
    record.lastExit = null;
    record.stderrBytes = 0;
    record.stopRequested = false;
    record.preserveFailureOnStop = false;

    const transport = new ObservableStdioClientTransport(
      record.definition,
      this.timeouts.shutdownMs,
      (exit, stderrBytes) => this.onTransportExit(record, transport, exit, stderrBytes),
    );
    const client = new Client({ name: "ingenium-child-mcp-proxy", version: "1.0.0" });
    record.transport = transport;
    record.client = client;
    transport.onerror = (error) => this.onTransportError(record, transport, error);

    try {
      await bounded(
        (async () => {
          await client.connect(transport, { timeout: this.timeouts.startupMs, maxTotalTimeout: this.timeouts.startupMs });
          await this.discoverTools(record, this.timeouts.startupMs, "CHILD_MCP_STARTUP_TIMEOUT");
        })(),
        this.timeouts.startupMs,
        "CHILD_MCP_STARTUP_TIMEOUT",
      );
      if (record.state !== "starting") throw new ChildMcpRuntimeError("CHILD_MCP_UNAVAILABLE");
      record.state = "ready";
      logger.info({ child: record.definition.name, pid: transport.pid, boundary: "initialize" }, "Child MCP server ready");
      return this.status(record);
    } catch (error) {
      const normalized = runtimeError(error, "CHILD_MCP_STARTUP_TIMEOUT");
      if (record.stopRequested && !record.preserveFailureOnStop) {
        await record.stopPromise?.catch(() => undefined);
        throw normalized;
      }
      record.state = "failed";
      record.diagnostic = errorDiagnostic(normalized);
      logger.warn({ child: record.definition.name, boundary: "initialize", diagnostic: record.diagnostic }, "Child MCP server failed to start");
      await this.closeFailedStart(record);
      throw normalized;
    }
  }

  private async discoverTools(
    record: RuntimeRecord,
    requestTimeoutMs = this.timeouts.requestMs,
    timeoutCode: ChildMcpRuntimeErrorCode = "CHILD_MCP_REQUEST_TIMEOUT",
  ): Promise<ChildMcpTool[]> {
    const client = record.client;
    if (!client) throw new ChildMcpRuntimeError("CHILD_MCP_NOT_READY");
    const tools = new Map<string, ChildMcpTool>();
    let cursor: string | undefined;
    for (let page = 0; page < MAX_CHILD_MCP_TOOL_PAGES; page += 1) {
      let result: Awaited<ReturnType<Client["listTools"]>>;
      try {
        result = await bounded(
          client.listTools(
            cursor ? { cursor } : undefined,
            { timeout: requestTimeoutMs, maxTotalTimeout: requestTimeoutMs },
          ),
          requestTimeoutMs,
          timeoutCode,
        );
      } catch (error) {
        const normalized = runtimeError(error, timeoutCode);
        this.markDegraded(record, errorDiagnostic(normalized), "tools/list");
        throw normalized;
      }
      for (const candidate of result.tools) {
        const tool = validateTool(candidate);
        if (tools.has(tool.name) || tools.size >= MAX_CHILD_MCP_TOOLS) {
          throw new ChildMcpRuntimeError("CHILD_MCP_INVALID_RESPONSE");
        }
        tools.set(tool.name, tool);
      }
      if (!result.nextCursor) {
        record.tools = tools;
        return [...tools.values()];
      }
      if (result.nextCursor.length > 1_024) throw new ChildMcpRuntimeError("CHILD_MCP_INVALID_RESPONSE");
      cursor = result.nextCursor;
    }
    throw new ChildMcpRuntimeError("CHILD_MCP_INVALID_RESPONSE");
  }

  private async closeFailedStart(record: RuntimeRecord): Promise<void> {
    record.stopRequested = true;
    record.preserveFailureOnStop = true;
    const transport = record.transport;
    try {
      await transport?.close();
    } catch (error) {
      logger.error({ child: record.definition.name, boundary: "startup-cleanup", diagnostic: errorDiagnostic(error) }, "Child MCP startup cleanup failed");
      throw runtimeError(error, "CHILD_MCP_SHUTDOWN_TIMEOUT");
    } finally {
      record.client = null;
      record.tools.clear();
      if (record.transport === transport && !transport?.hasLiveProcessGroup()) record.transport = null;
    }
  }

  private async stopRecord(record: RuntimeRecord): Promise<void> {
    if (record.stopPromise) return record.stopPromise;
    const transport = record.transport;
    if (!transport) {
      if (record.state !== "failed" && record.state !== "exited") record.state = "stopped";
      return;
    }

    const stopPromise = (async () => {
      record.stopRequested = true;
      record.preserveFailureOnStop = false;
      record.state = "stopping";
      try {
        await transport.close();
      } catch (error) {
        record.state = "failed";
        record.diagnostic = errorDiagnostic(error);
        logger.error({ child: record.definition.name, boundary: "shutdown", diagnostic: record.diagnostic }, "Child MCP server did not stop cleanly");
        throw runtimeError(error, "CHILD_MCP_SHUTDOWN_TIMEOUT");
      } finally {
        record.client = null;
        record.tools.clear();
        if (record.transport === transport && !transport.hasLiveProcessGroup()) record.transport = null;
        if (record.state === "stopping" && record.transport === null) record.state = "stopped";
      }
    })();
    record.stopPromise = stopPromise;
    try {
      await stopPromise;
    } finally {
      if (record.stopPromise === stopPromise) record.stopPromise = null;
    }
  }

  private onTransportError(record: RuntimeRecord, transport: ObservableStdioClientTransport, error: Error): void {
    if (record.transport !== transport || record.stopRequested) return;
    this.markDegraded(record, errorDiagnostic(error), "transport");
  }

  private onTransportExit(
    record: RuntimeRecord,
    transport: ObservableStdioClientTransport,
    exit: ChildMcpExitStatus,
    stderrBytes: number,
  ): void {
    if (record.transport !== transport) return;
    record.lastExit = exit;
    record.stderrBytes = stderrBytes;
    record.client = null;
    record.tools.clear();
    const descendantsRemain = transport.hasLiveProcessGroup();
    if (!descendantsRemain) record.transport = null;
    if (record.stopRequested) {
      record.state = record.preserveFailureOnStop ? "failed" : descendantsRemain ? "stopping" : "stopped";
    } else {
      record.state = record.state === "starting" ? "failed" : "exited";
      record.diagnostic = "unavailable";
      logger.warn(
        { child: record.definition.name, boundary: "child-exit", code: exit.code, signal: exit.signal, stderrBytes, descendantsRemain },
        "Child MCP server exited",
      );
    }
  }

  private markDegraded(record: RuntimeRecord, diagnostic: Exclude<ChildMcpDiagnostic, null>, boundary: string): void {
    if (record.stopRequested || record.state === "stopped" || record.state === "exited") return;
    record.diagnostic = diagnostic;
    if (record.state === "ready") record.state = "degraded";
    logger.warn({ child: record.definition.name, boundary, diagnostic }, "Child MCP transport reported an error");
  }

  private requireConnected(record: RuntimeRecord): void {
    if (!record.client || !record.transport || !["starting", "ready", "degraded"].includes(record.state)) {
      throw new ChildMcpRuntimeError("CHILD_MCP_NOT_READY");
    }
  }

  private getRecord(name: string): RuntimeRecord {
    const record = this.servers.get(name);
    if (!record) throw new ChildMcpRuntimeError("CHILD_MCP_NOT_FOUND");
    return record;
  }

  private status(record: RuntimeRecord): ChildMcpRuntimeStatus {
    return {
      name: record.definition.name,
      state: record.state,
      pid: record.transport?.pid ?? null,
      toolCount: record.tools.size,
      diagnostic: record.diagnostic,
      lastExit: record.lastExit ? { ...record.lastExit } : null,
      stderrBytes: record.stderrBytes,
    };
  }
}
