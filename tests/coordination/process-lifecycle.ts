import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, openSync, closeSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { terminateChildProcessHandle } from "../test-server-lifecycle";
import type { HarnessOptions } from "./contracts";
import { assertCanaryPlan, type CanaryActionContext, type CanaryPlan, type CanaryRequest } from "./canary-dispatcher";

const SAFE_ENVIRONMENT_KEYS = ["LANG", "LC_ALL", "NO_COLOR", "PATH", "SHELL", "TERM", "TZ"] as const;
const CANARY_ACTION_ENVIRONMENT_KEYS = [
  "HOME", "INGENIUM_API_URL", "INGENIUM_PROJECT", "INGENIUM_PROJECT_ID", "INGENIUM_WORKSPACE_ID",
  "INGENIUM_STORAGE_MAPPING_HASH", "INGENIUM_WORKTREE", "INGENIUM_MCP_AUDIENCE",
  "INGENIUM_MCP_CREDENTIAL_PURPOSE", "INGENIUM_MCP_CREDENTIAL_FILE", "INGENIUM_REPOSITORY_SYNC_CREDENTIAL_FILE",
  "INGENIUM_COORDINATION_TRACE", "INGENIUM_COORDINATION_TRACE_FILE", "INGENIUM_TEST_RUN_NONCE",
  "INGENIUM_COORDINATION_NODE_EXECUTABLE", "INGENIUM_COORDINATION_NODE_ARGV",
] as const;

export interface HostOpenCodeProcess {
  label: "external-a" | "external-b";
  child: ChildProcess;
  port: number;
  home: string;
  captureFile: string;
  traceFile: string;
  logFile: string;
  startedAt: string;
}

export interface CanaryActionRunOptions {
  terminationTimeoutMs?: number;
  onSpawn?: (child: ChildProcess) => void;
}

export function allowlistedBaseEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(SAFE_ENVIRONMENT_KEYS.flatMap((key) => source[key] === undefined ? [] : [[key, source[key]]])) as NodeJS.ProcessEnv;
}

export function allowlistedCanaryActionEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const environment = allowlistedBaseEnvironment(source);
  for (const key of CANARY_ACTION_ENVIRONMENT_KEYS) {
    if (source[key] !== undefined) environment[key] = source[key];
  }
  if (environment.INGENIUM_API_URL !== undefined) {
    environment.INGENIUM_TRUSTED_API_URL = environment.INGENIUM_API_URL;
  }
  return environment;
}

export function externalHomePaths(root: string, label: "external-a" | "external-b") {
  const home = join(root, label);
  return {
    home,
    configFile: join(home, ".config", "opencode", "opencode.json"),
    captureFile: join(home, "coordination-capture.jsonl"),
    traceFile: join(home, "coordination-trace.jsonl"),
    logFile: join(home, "opencode.log"),
    pluginFile: join(home, "coordination-canary-plugin.ts"),
    planFile: join(home, "coordination-canary-plan.json"),
  };
}

function canaryPluginSource(options: HarnessOptions): string {
  const plugin = pathToFileURL(join(options.worktree, "node_modules", "@opencode-ai", "plugin", "dist", "index.js")).href;
  const dispatcher = pathToFileURL(join(options.worktree, "tests", "coordination", "canary-dispatcher.ts")).href;
  const lifecycle = pathToFileURL(join(options.worktree, "tests", "coordination", "process-lifecycle.ts")).href;
  return `import { readFileSync } from "node:fs";
import { tool } from ${JSON.stringify(plugin)};
import { CANARY_AGENT, CANARY_OPERATIONS, CANARY_TOOL, CanaryDispatcher, assertCanaryPlan } from ${JSON.stringify(dispatcher)};
import { allowlistedCanaryActionEnvironment, runCanaryAction } from ${JSON.stringify(lifecycle)};

function actionEnvironment() {
  return allowlistedCanaryActionEnvironment(process.env);
}

function readPlan() {
  const path = process.env.INGENIUM_COORDINATION_CANARY_PLAN_FILE;
  if (!path) throw new Error("Canary plan file is unavailable");
  const plan = JSON.parse(readFileSync(path, "utf8"));
  assertCanaryPlan(plan);
  if (plan.role !== "A" || plan.steps.length !== 1) throw new Error("Canary plan is not bound to Model A");
  return plan;
}

const server = async () => ({
  tool: {
    [CANARY_TOOL]: tool({
      description: "Execute the one nonce-bound coordination harness operation.",
      args: {
        nonce: tool.schema.string().uuid(),
        operation: tool.schema.enum(CANARY_OPERATIONS),
      },
      async execute(args, context) {
        if (context.agent !== CANARY_AGENT) throw new Error("Canary agent identity changed");
        const plan = readPlan();
        const gate = new CanaryDispatcher(plan, { execute: async () => "unreachable" });
        const request = gate.requestForCurrentStep(args.nonce, args.operation);
        context.metadata({ title: "coordination canary: " + args.operation, metadata: { nonce: args.nonce, operation: args.operation } });
        const result = await runCanaryAction(
          plan,
          request,
          { sessionId: context.sessionID, messageId: context.messageID },
          actionEnvironment(),
          context.abort,
        );
        return {
          title: "coordination canary: " + args.operation,
          output: JSON.stringify({
            schema: "ingenium.coordination-canary-result/v1",
            nonce: args.nonce,
            operation: args.operation,
            path: request.path,
            command: request.command,
            result,
            sessionId: context.sessionID,
            messageId: context.messageID,
          }),
          metadata: { nonce: args.nonce, operation: args.operation },
        };
      },
    }),
  },
});

export default { id: "ingenium-coordination-canary", server };
`;
}

export function prepareExternalHome(
  root: string,
  label: "external-a" | "external-b",
  options: HarnessOptions,
  configContent: string,
): ReturnType<typeof externalHomePaths> {
  const paths = externalHomePaths(root, label);
  const { home } = paths;
  const configDir = join(home, ".config", "opencode");
  const dataDir = join(home, ".local", "share");
  const cacheDir = join(home, ".cache");
  for (const directory of [home, configDir, dataDir, cacheDir]) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
  }
  writeFileSync(paths.configFile, configContent, { mode: 0o600, flag: "wx" });
  writeFileSync(paths.captureFile, "", { mode: 0o600, flag: "wx" });
  writeFileSync(paths.traceFile, "", { mode: 0o600, flag: "wx" });
  if (label === "external-a") {
    writeFileSync(paths.pluginFile, canaryPluginSource(options), { mode: 0o600, flag: "wx" });
    writeFileSync(paths.planFile, "{}\n", { mode: 0o600, flag: "wx" });
  }
  return paths;
}

export function writeCanaryPlan(prepared: ReturnType<typeof externalHomePaths>, plan: CanaryPlan): void {
  assertCanaryPlan(plan);
  if (plan.role !== "A" || plan.steps.length !== 1) throw new Error("Only one-step Model A plans may be installed");
  const temporary = `${prepared.planFile}.${plan.nonce}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(plan)}\n`, { mode: 0o600, flag: "wx" });
  renameSync(temporary, prepared.planFile);
}

export function canaryActionEnvironment(
  options: HarnessOptions,
  binding: { projectId: string; storageMappingHash: string },
  apiUrl: string,
  home: string,
  runNonce: string,
  sourceEnvironment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return {
    ...allowlistedBaseEnvironment(sourceEnvironment),
    HOME: home,
    INGENIUM_API_URL: apiUrl,
    INGENIUM_TRUSTED_API_URL: apiUrl,
    INGENIUM_PROJECT: options.project,
    INGENIUM_PROJECT_ID: binding.projectId,
    INGENIUM_WORKSPACE_ID: options.workspaceId,
    INGENIUM_STORAGE_MAPPING_HASH: binding.storageMappingHash,
    INGENIUM_WORKTREE: options.worktree,
    INGENIUM_MCP_AUDIENCE: "mcp",
    INGENIUM_MCP_CREDENTIAL_PURPOSE: "general",
    INGENIUM_MCP_CREDENTIAL_FILE: options.coordinationCredential.path,
    INGENIUM_REPOSITORY_SYNC_CREDENTIAL_FILE: options.repositoryCredential.path,
    INGENIUM_TEST_RUN_NONCE: runNonce,
  };
}

export async function startHostOpenCode(
  label: "external-a" | "external-b",
  port: number,
  prepared: ReturnType<typeof prepareExternalHome>,
  options: HarnessOptions,
  proxyApiUrl: string,
  configContent: string,
  storageBinding: { projectId: string; storageMappingHash: string },
  authContent: string,
  runNonce: string,
  signal: AbortSignal,
  sourceEnvironment: NodeJS.ProcessEnv = process.env,
): Promise<HostOpenCodeProcess> {
  signal.throwIfAborted();
  const log = openSync(prepared.logFile, "a", 0o600);
  const environment: NodeJS.ProcessEnv = {
    ...allowlistedBaseEnvironment(sourceEnvironment),
    HOME: prepared.home,
    XDG_CONFIG_HOME: join(prepared.home, ".config"),
    XDG_DATA_HOME: join(prepared.home, ".local", "share"),
    XDG_CACHE_HOME: join(prepared.home, ".cache"),
    PWD: options.worktree,
    OPENCODE_DISABLE_PROJECT_CONFIG: "1",
    OPENCODE_AUTH_CONTENT: authContent,
    OPENCODE_CONFIG: prepared.configFile,
    OPENCODE_CONFIG_CONTENT: configContent,
    INGENIUM_API_URL: proxyApiUrl,
    INGENIUM_TRUSTED_API_URL: proxyApiUrl,
    INGENIUM_PROJECT: options.project,
    INGENIUM_PROJECT_ID: storageBinding.projectId,
    INGENIUM_WORKSPACE_ID: options.workspaceId,
    INGENIUM_STORAGE_MAPPING_HASH: storageBinding.storageMappingHash,
    INGENIUM_WORKTREE: options.worktree,
    INGENIUM_MCP_AUDIENCE: "mcp",
    INGENIUM_MCP_CREDENTIAL_PURPOSE: "general",
    INGENIUM_MCP_CREDENTIAL_FILE: options.coordinationCredential.path,
    INGENIUM_REPOSITORY_SYNC_CREDENTIAL_FILE: options.repositoryCredential.path,
    INGENIUM_COORDINATION_TRANSFORM_CAPTURE: "1",
    INGENIUM_COORDINATION_TRANSFORM_CAPTURE_FILE: prepared.captureFile,
    INGENIUM_COORDINATION_TRACE: "1",
    INGENIUM_COORDINATION_TRACE_FILE: prepared.traceFile,
    INGENIUM_TEST_RUN_NONCE: runNonce,
    INGENIUM_COORDINATION_NODE_EXECUTABLE: process.execPath,
    INGENIUM_COORDINATION_NODE_ARGV: Buffer.from(JSON.stringify(process.execArgv), "utf8").toString("base64url"),
    ...(label === "external-a" ? {
      INGENIUM_COORDINATION_CANARY_PLUGIN: prepared.pluginFile,
      INGENIUM_COORDINATION_CANARY_PLAN_FILE: prepared.planFile,
    } : {}),
  };
  let child: ChildProcess;
  try {
    child = spawn(options.openCodeBinary, ["serve", "--hostname", "127.0.0.1", "--port", String(port)], {
      cwd: options.worktree,
      detached: process.platform !== "win32",
      env: environment,
      stdio: ["ignore", log, log],
    });
  } finally {
    closeSync(log);
  }
  if (!child.pid) throw new Error(`${label} OpenCode process did not start`);
  if (signal.aborted) {
    await terminateChildProcessHandle(child, 10_000, runNonce);
    signal.throwIfAborted();
  }
  return { label, child, port, home: prepared.home, captureFile: prepared.captureFile, traceFile: prepared.traceFile, logFile: prepared.logFile, startedAt: new Date().toISOString() };
}

export async function stopHostOpenCode(processRecord: HostOpenCodeProcess, runNonce: string): Promise<void> {
  await terminateChildProcessHandle(processRecord.child, 10_000, runNonce);
}

export async function runCanaryAction(
  plan: CanaryPlan,
  request: CanaryRequest,
  context: Omit<CanaryActionContext, "abort">,
  environment: NodeJS.ProcessEnv,
  signal: AbortSignal,
  runOptions: CanaryActionRunOptions = {},
): Promise<string> {
  signal.throwIfAborted();
  const runner = join(plan.worktree, "tests", "coordination", "canary-action-runner.ts");
  const executable = environment.INGENIUM_COORDINATION_NODE_EXECUTABLE ?? process.execPath;
  const encodedArgv = environment.INGENIUM_COORDINATION_NODE_ARGV;
  const decodedArgv: unknown = encodedArgv
    ? JSON.parse(Buffer.from(encodedArgv, "base64url").toString("utf8"))
    : process.execArgv;
  if (!Array.isArray(decodedArgv) || decodedArgv.length > 32
    || !decodedArgv.every((value) => typeof value === "string" && value.length <= 4096 && !/[\u0000\r\n]/.test(value))) {
    throw new Error("Canary action runner arguments are invalid");
  }
  const child = spawn(executable, [...decodedArgv, runner], {
    cwd: plan.worktree,
    detached: process.platform !== "win32",
    env: { ...environment, NODE_OPTIONS: "" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  runOptions.onSpawn?.(child);
  let termination: Promise<void> | undefined;
  let rejectTermination: (error: unknown) => void = () => {};
  const terminationFailure = new Promise<never>((_resolve, reject) => { rejectTermination = reject; });
  const terminate = (): Promise<void> => {
    termination ??= terminateChildProcessHandle(
      child,
      runOptions.terminationTimeoutMs ?? 4_000,
      environment.INGENIUM_TEST_RUN_NONCE,
    );
    termination.catch(rejectTermination);
    return termination;
  };
  const abort = () => { void terminate(); };
  signal.addEventListener("abort", abort, { once: true });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let outputBytes = 0;
  const capture = (target: Buffer[]) => (chunk: Buffer): void => {
    outputBytes += chunk.length;
    if (outputBytes > 16 * 1024 * 1024) void terminate();
    else target.push(chunk);
  };
  child.stdout?.on("data", capture(stdout));
  child.stderr?.on("data", capture(stderr));
  child.stdin?.end(JSON.stringify({ plan, request, context }));
  const exit = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  const code = await Promise.race([exit, terminationFailure]).finally(() => signal.removeEventListener("abort", abort));
  if (termination) await termination;
  signal.throwIfAborted();
  if (code !== 0) {
    let message = Buffer.concat(stderr).toString("utf8").trim().slice(0, 1000);
    for (const key of ["INGENIUM_MCP_CREDENTIAL_FILE", "INGENIUM_REPOSITORY_SYNC_CREDENTIAL_FILE"]) {
      const value = environment[key];
      if (value) message = message.split(value).join("[REDACTED_PATH]");
    }
    throw new Error(`Canary action failed: ${message}`);
  }
  const output = Buffer.concat(stdout).toString("utf8");
  const match = /(?:^|\n)INGENIUM_CANARY_RESULT:([A-Za-z0-9_-]+)\r?\n?$/.exec(output);
  if (!match) throw new Error("Canary action omitted its bounded result envelope");
  const value: unknown = JSON.parse(Buffer.from(match[1]!, "base64url").toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value) || typeof (value as { result?: unknown }).result !== "string") {
    throw new Error("Canary action returned an invalid result");
  }
  return (value as { result: string }).result;
}

export async function waitForOpenCode(baseUrl: string, expectedVersion: string, signal: AbortSignal, timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    try {
      const response = await fetch(`${baseUrl}/global/health`, { signal: AbortSignal.any([signal, AbortSignal.timeout(2_000)]) });
      const body = await response.json() as { healthy?: boolean; version?: string };
      if (response.ok && body.healthy === true && body.version === expectedVersion) return;
    } catch {}
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 250);
      signal.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
    });
  }
  throw new Error(`OpenCode did not become ready at ${baseUrl}`);
}
