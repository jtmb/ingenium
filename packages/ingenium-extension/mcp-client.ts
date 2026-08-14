import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { apiRequestHeaders } from "./api-auth.js";
import { resolveExtensionProject } from "./project-resolver.js";

const DEFAULT_API_URL = "http://localhost:4097/api/v1";
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 60_000;
const MAX_STDERR_BYTES = 1_024;
const TOKEN_REFERENCE = /^\{file:[^{}\u0000\r\n]+\}$/;
const TOKEN = /^[A-Za-z0-9_-]{32,128}$/;

export type McpBridgeFailure = "authentication" | "timeout" | "request_failed";

export class McpBridgeError extends Error {
  constructor(readonly failure: McpBridgeFailure, readonly diagnostic = "") {
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
      () => {
        clearTimeout(timer);
        rejectPromise(new McpBridgeError("request_failed"));
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

function bridgeEnvironment(worktree: string, requestedProject?: string): { project: string; environment: Record<string, string> } {
  const project = resolveExtensionProject(worktree, requestedProject);
  const apiUrl = normalizedApiUrl(process.env.INGENIUM_API_URL);
  const authorization = apiRequestHeaders(worktree).get("Authorization");
  if (!apiUrl || !authorization || !TOKEN.test(authorization.slice("Bearer ".length))) {
    throw new McpBridgeError("authentication");
  }

  const environment: Record<string, string> = {
    INGENIUM_API_URL: apiUrl,
    INGENIUM_API_TIMEOUT: String(boundedTimeout(process.env.INGENIUM_API_TIMEOUT)),
    INGENIUM_PROJECT: project,
    INGENIUM_WORKTREE: resolve(worktree),
  };
  const configuredToken = process.env.INGENIUM_MCP_CREDENTIAL;
  if (configuredToken && (TOKEN.test(configuredToken) || TOKEN_REFERENCE.test(configuredToken))) {
    environment.INGENIUM_MCP_CREDENTIAL = configuredToken;
  } else {
    environment.INGENIUM_MCP_CREDENTIAL_FILE = process.env.INGENIUM_MCP_CREDENTIAL_FILE ?? ".opencode/.ingenium-mcp-credential";
  }
  environment.INGENIUM_MCP_AUDIENCE = process.env.INGENIUM_MCP_AUDIENCE ?? "mcp";
  if (process.env.INGENIUM_RUNTIME_CREDENTIAL_FILE) environment.INGENIUM_RUNTIME_CREDENTIAL_FILE = process.env.INGENIUM_RUNTIME_CREDENTIAL_FILE;
  if (!process.env.INGENIUM_WORKSPACE_ID) throw new McpBridgeError("authentication");
  environment.INGENIUM_WORKSPACE_ID = process.env.INGENIUM_WORKSPACE_ID;
  return { project, environment };
}

function packagedLauncherPath(moduleUrl = import.meta.url): string {
  return fileURLToPath(new URL("./scripts/mcp-server.js", moduleUrl));
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
  const { project, environment } = bridgeEnvironment(worktree, dependencies.project);
  const timeoutMs = boundedTimeout(environment.INGENIUM_API_TIMEOUT);
  const transport = (dependencies.createTransport ?? defaultTransport)({
    command: process.execPath,
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
  let result: T | undefined;
  let failure: McpBridgeError | undefined;
  try {
    await bounded(() => client.connect(transport), timeoutMs);
    connected = true;
    result = await bounded(() => operation(client, project), timeoutMs);
  } catch (error) {
    failure = error instanceof McpBridgeError
      ? new McpBridgeError(error.failure, diagnostic)
      : new McpBridgeError("request_failed", diagnostic);
  }

  try {
    await closeBridge(client, transport, connected, timeoutMs, diagnostic);
  } catch (error) {
    if (!failure) failure = error instanceof McpBridgeError
      ? error
      : new McpBridgeError("request_failed", diagnostic);
  }
  if (failure) throw failure;
  return result as T;
}

/** Ensure the launcher provisions the bound project before a lifecycle call. */
export async function ensureMcpProject(worktree: string): Promise<string> {
  return withMcpClient(worktree, async (_client, project) => project);
}

/** Invoke one packaged Ingenium MCP tool without exposing child protocol details. */
export async function callMcpTool(
  worktree: string,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const project = typeof args.project === "string" ? args.project : undefined;
  return withMcpClient(worktree, async (client) => {
    const result = await client.callTool({ name, arguments: args });
    if (typeof result === "object" && result !== null && "isError" in result
      && (result as { isError?: unknown }).isError === true) {
      throw new McpBridgeError("request_failed");
    }
    return result;
  }, { project });
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
