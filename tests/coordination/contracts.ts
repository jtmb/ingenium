import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  constants,
  accessSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { delimiter, isAbsolute, join, relative, resolve } from "node:path";

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const FIXED_MODEL_SOURCE_AGENT = "ingenium-software-engineer-premium";
const SECRET_KEY = /(?:authorization|cookie|credential|password|passphrase|secret|token|api[_-]?key|auth(?:content)?)/i;
const REDACTION_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._~-]+/gi,
  /\bing_[A-Za-z0-9_-]+\b/g,
  /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{20,}\b/g,
] as const;

export const COORDINATION_MEMORY_PREFIX = "COORDINATION_MEMORY_V2\n";
export const HARNESS_ARTIFACT_SCHEMA = "ingenium.coordination-harness/v1";
export const HARNESS_MANIFEST_SCHEMA = "ingenium.coordination-harness-ownership/v1";
export const PROXY_EVENT_SCHEMA = "ingenium.coordination-fault-event/v1";

export type HarnessCheck = "build" | "lint" | "test" | "typecheck";
export type FaultPhase = "pass" | "fail_registration" | "lose_completion_response";

export interface ProtectedLocator {
  path: string;
  dev: number;
  ino: number;
  uid: number;
  mode: number;
  size: number;
}

export interface HarnessOptions {
  worktree: string;
  project: string;
  projectId: string;
  workspaceId: string;
  storageMappingHash: string;
  apiUrl: string;
  operatorToken: ProtectedLocator;
  openCodeBinary: string;
  openCodeAuth: ProtectedLocator;
  providerId: string;
  modelId: string;
  variant: string;
  expectedRevision: string;
  expectedOpenCodeVersion: string;
  expectedRuntimeOpenCodeVersion: string;
  runtimeId: string;
  timeoutMs: number;
  check: HarnessCheck;
}

export interface OperationalMemoryEntry {
  entryId: string;
  actorId: string;
  sourceRevision: number;
  publishedAt: string | null;
  status: "active" | "working" | "idle" | "completed" | "error";
  actionKinds: Array<"read" | "search" | "write" | "edit" | "execute">;
  checkResults: Array<{
    kind: "test" | "typecheck" | "lint" | "build" | "format" | "security" | "other";
    result: "passed" | "failed";
  }>;
  todoState: "none" | "pending" | "in_progress" | "complete" | "cancelled" | "mixed";
  todoCounts: {
    total: number;
    pending: number;
    inProgress: number;
    completed: number;
    cancelled: number;
  };
  currentTaskId: string | null;
  contextRevision: number;
  nextWork: {
    kind: "none" | "continue_task" | "review_changes" | "run_checks" | "address_failure";
    referenceHash: string | null;
  };
  changedPathSegments: string[][];
}

export interface HarnessOwnershipManifest {
  schema: typeof HARNESS_MANIFEST_SCHEMA;
  runId: string;
  runNonce: string;
  createdAt: string;
  repoRoot: string;
  artifactRoot: string;
  tempRoot: string;
  revision: string;
  project: string;
  workspaceId: string;
  ports: { proxy: number; externalA: number; externalB: number; internalC: number | null };
  processes: Array<{
    role: "proxy" | "external-a" | "external-b" | "internal-c";
    pid: number | null;
    externalId: string | null;
    port: number | null;
    startedAt: string;
    stoppedAt: string | null;
    commandSha256: string;
  }>;
  boundaries: {
    liveRun: true;
    applicationSourceMutation: false;
    tokenBytesRetained: false;
    runtimeCreated: false;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return isRecord(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function pathIsInside(parent: string, child: string): boolean {
  const value = relative(resolve(parent), resolve(child));
  return value === "" || (!value.startsWith("..") && !isAbsolute(value));
}

function parsePositiveInteger(value: string, name: string, minimum: number, maximum: number): number {
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function safeAbsolute(value: string, name: string, mustExist = true): string {
  if (!isAbsolute(value) || value !== resolve(value) || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${name} must be a canonical absolute path`);
  }
  if (!mustExist) return value;
  let canonical: string;
  try { canonical = realpathSync(value); } catch { throw new Error(`${name} does not exist`); }
  if (canonical !== value) throw new Error(`${name} must not contain symlinks`);
  return canonical;
}

export function validateProtectedLocator(value: string, name = "protected file"): ProtectedLocator {
  const path = safeAbsolute(value, name);
  const stat = lstatSync(path);
  const uid = typeof process.getuid === "function" ? process.getuid() : stat.uid;
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== uid || stat.nlink !== 1 || (stat.mode & 0o077) !== 0
    || stat.size > 1024 * 1024) {
    throw new Error(`${name} must be an owner-only, single-link regular file`);
  }
  return { path, dev: stat.dev, ino: stat.ino, uid: stat.uid, mode: stat.mode, size: stat.size };
}

function canonicalExecutable(path: string): string {
  let canonical: string;
  try { canonical = realpathSync(path); } catch { throw new Error("openCodeBinary does not exist"); }
  const stat = statSync(canonical);
  if (!stat.isFile()) throw new Error("openCodeBinary is not a regular file");
  try { accessSync(canonical, constants.X_OK); } catch { throw new Error("openCodeBinary is not executable"); }
  return canonical;
}

export function resolveOpenCodeExecutable(value: string, environment: NodeJS.ProcessEnv): string {
  if (/[\u0000-\u001f\u007f]/.test(value)) throw new Error("openCodeBinary is invalid");
  if (value.includes("/")) {
    if (!isAbsolute(value)) throw new Error("openCodeBinary must be absolute or a bare executable name");
    return canonicalExecutable(value);
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/.test(value)) throw new Error("openCodeBinary is invalid");
  const searchPath = environment.PATH ?? process.env.PATH;
  if (!searchPath) throw new Error("PATH is required to resolve openCodeBinary");
  for (const entry of searchPath.split(delimiter)) {
    if (!entry || !isAbsolute(entry) || resolve(entry) !== entry || /[\u0000-\u001f\u007f]/.test(entry)) {
      throw new Error("PATH contains an unsafe executable search entry");
    }
    const candidate = join(entry, value);
    try { return canonicalExecutable(candidate); } catch (error) {
      if ((error as Error).message !== "openCodeBinary does not exist") throw error;
    }
  }
  throw new Error("openCodeBinary was not found in PATH");
}

function openCodeVersion(binary: string, environment: NodeJS.ProcessEnv): string {
  let output: string;
  try {
    output = execFileSync(binary, ["--version"], {
      encoding: "utf8",
      env: { PATH: environment.PATH ?? process.env.PATH ?? "" },
      maxBuffer: 1024,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10_000,
    }).trim();
  } catch {
    throw new Error("openCodeBinary --version failed");
  }
  if (!/^\d+\.\d+\.\d+$/.test(output)) throw new Error("openCodeBinary --version must return an exact version");
  return output;
}

function apiUrl(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== "http:" || parsed.username || parsed.password || parsed.search || parsed.hash
    || !["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname)
    || !/^\/api\/v1\/?$/.test(parsed.pathname)) {
    throw new Error("apiUrl must be a loopback HTTP /api/v1 endpoint");
  }
  return parsed.toString().replace(/\/$/, "");
}

function readRootConfig(worktree: string): Record<string, unknown> {
  const configPath = join(worktree, "opencode.json");
  const parsed: unknown = JSON.parse(readFileSync(configPath, "utf8"));
  if (!isRecord(parsed)) throw new Error("opencode.json must contain an object");
  return parsed;
}

function configuredMcpEnvironment(config: Record<string, unknown>): Record<string, unknown> {
  const mcp = isRecord(config.mcp) ? config.mcp : undefined;
  const ingenium = mcp && isRecord(mcp.ingenium) ? mcp.ingenium : undefined;
  if (!ingenium || ingenium.type !== "local" || ingenium.enabled !== true || !isRecord(ingenium.environment)) {
    throw new Error("opencode.json does not contain an enabled local Ingenium MCP entry");
  }
  return ingenium.environment;
}

function configuredValue(
  flag: string | undefined,
  environment: NodeJS.ProcessEnv,
  environmentName: string,
  configValue: unknown,
  name: string,
): string {
  const value = flag ?? environment[environmentName] ?? (typeof configValue === "string" ? configValue : undefined);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function parseArgs(argv: readonly string[]): Map<string, string> {
  const values = new Map<string, string>();
  const allowed = new Set([
    "worktree", "project", "project-id", "workspace", "storage-mapping-hash", "api-url",
    "operator-token-file", "opencode-binary", "opencode-auth-file",
    "expected-revision", "runtime-id", "timeout-ms", "check",
  ]);
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new Error("Harness arguments must be --name value pairs");
    }
    const name = flag.slice(2);
    if (!allowed.has(name) || values.has(name)) throw new Error(`Unsupported or repeated harness argument: ${flag}`);
    values.set(name, value);
  }
  return values;
}

export function parseHarnessOptions(
  argv: readonly string[],
  environment: NodeJS.ProcessEnv = process.env,
): HarnessOptions {
  const args = parseArgs(argv);
  const worktree = safeAbsolute(args.get("worktree") ?? environment.COORDINATION_HARNESS_WORKTREE ?? process.cwd(), "worktree");
  const config = readRootConfig(worktree);
  const mcp = configuredMcpEnvironment(config);
  const project = configuredValue(args.get("project"), environment, "COORDINATION_HARNESS_PROJECT", undefined, "project");
  const projectId = configuredValue(args.get("project-id"), environment, "COORDINATION_HARNESS_PROJECT_ID", undefined, "projectId");
  const workspaceId = configuredValue(args.get("workspace"), environment, "COORDINATION_HARNESS_WORKSPACE", undefined, "workspace");
  const storageMappingHash = configuredValue(args.get("storage-mapping-hash"), environment, "COORDINATION_HARNESS_STORAGE_MAPPING_HASH", undefined, "storageMappingHash");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(project) || !SAFE_NAME.test(workspaceId)
    || !UUID.test(projectId) || !SHA256.test(storageMappingHash)) {
    throw new Error("project, projectId, workspace, or storageMappingHash is invalid");
  }

  const configuredApi = configuredValue(args.get("api-url"), environment, "COORDINATION_HARNESS_API_URL", mcp.INGENIUM_API_URL, "apiUrl");
  const resolveFile = (value: string): string => isAbsolute(value) ? resolve(value) : resolve(worktree, value);
  const operatorFile = resolveFile(configuredValue(
    args.get("operator-token-file"),
    environment,
    "COORDINATION_HARNESS_OPERATOR_TOKEN_FILE",
    environment.INGENIUM_API_TOKEN_FILE,
    "operatorTokenFile",
  ));
  const authFile = resolveFile(configuredValue(
    args.get("opencode-auth-file"),
    environment,
    "COORDINATION_HARNESS_OPENCODE_AUTH_FILE",
    undefined,
    "openCodeAuthFile",
  ));

  const agents = isRecord(config.agent) ? config.agent : undefined;
  const mapping = agents && isRecord(agents[FIXED_MODEL_SOURCE_AGENT]) ? agents[FIXED_MODEL_SOURCE_AGENT] : undefined;
  if (!mapping || typeof mapping.model !== "string" || !mapping.model.includes("/") || typeof mapping.variant !== "string") {
    throw new Error("fixed harness model source must resolve to an exact configured model and variant");
  }
  const separator = mapping.model.indexOf("/");
  const providerId = mapping.model.slice(0, separator);
  const modelId = mapping.model.slice(separator + 1);
  if (!SAFE_NAME.test(providerId) || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(modelId)
    || !SAFE_NAME.test(mapping.variant)) throw new Error("fixed harness model mapping is invalid");

  const expectedRevision = configuredValue(
    args.get("expected-revision"),
    environment,
    "COORDINATION_HARNESS_EXPECTED_REVISION",
    undefined,
    "expectedRevision",
  );
  if (!/^[0-9a-f]{40}$/.test(expectedRevision)) throw new Error("expectedRevision must be a full lowercase Git SHA");
  const manifest = JSON.parse(readFileSync(join(worktree, "package.json"), "utf8")) as { devDependencies?: Record<string, unknown> };
  const pluginVersion = manifest.devDependencies?.["@opencode-ai/plugin"];
  if (typeof pluginVersion !== "string" || !/^\d+\.\d+\.\d+$/.test(pluginVersion)) {
    throw new Error("root @opencode-ai/plugin must pin an exact OpenCode version");
  }
  const openCodeBinary = resolveOpenCodeExecutable(
    args.get("opencode-binary") ?? environment.COORDINATION_HARNESS_OPENCODE_BINARY ?? "opencode",
    environment,
  );
  const expectedOpenCodeVersion = openCodeVersion(openCodeBinary, environment);
  const check = (args.get("check") ?? environment.COORDINATION_HARNESS_CHECK ?? "typecheck") as HarnessCheck;
  if (!["build", "lint", "test", "typecheck"].includes(check)) throw new Error("check must be build, lint, test, or typecheck");
  const runtimeId = configuredValue(args.get("runtime-id"), environment, "COORDINATION_HARNESS_RUNTIME_ID", undefined, "runtimeId");
  if (!UUID.test(runtimeId)) throw new Error("runtimeId must be a UUID");

  return {
    worktree,
    project,
    projectId,
    workspaceId,
    storageMappingHash,
    apiUrl: apiUrl(configuredApi),
    operatorToken: validateProtectedLocator(operatorFile, "operatorTokenFile"),
    openCodeBinary,
    openCodeAuth: validateProtectedLocator(authFile, "openCodeAuthFile"),
    providerId,
    modelId,
    variant: mapping.variant,
    expectedRevision,
    expectedOpenCodeVersion,
    expectedRuntimeOpenCodeVersion: pluginVersion,
    runtimeId,
    timeoutMs: parsePositiveInteger(
      args.get("timeout-ms") ?? environment.COORDINATION_HARNESS_TIMEOUT_MS ?? "600000",
      "timeoutMs",
      30_000,
      1_800_000,
    ),
    check,
  };
}

export function usage(): string {
  return [
    "Usage: npx tsx tests/coordination/run.ts --project NAME --project-id UUID --workspace ID --storage-mapping-hash SHA256 --runtime-id UUID --expected-revision SHA --operator-token-file PATH --opencode-auth-file PATH [options]",
    "All identity values are required CLI inputs or COORDINATION_HARNESS_* environment variables; operator and OpenCode auth inputs remain protected file locators.",
    "This command performs a live model/runtime run and creates a managed Git commit. It is not a fixture self-test.",
  ].join("\n");
}

function redactString(value: string, secrets: readonly string[]): string {
  let redacted = value;
  for (const pattern of REDACTION_PATTERNS) redacted = redacted.replace(pattern, "<redacted>");
  for (const secret of secrets.filter((entry) => entry.length >= 8)) redacted = redacted.split(secret).join("<redacted>");
  return redacted;
}

function isSecretKey(key: string): boolean {
  if (/^(?:tokenBytesRetained|credentialChangeMode|restartRequiredOnCredentialChange)$/i.test(key)) return false;
  return SECRET_KEY.test(key);
}

export function redactEvidence(value: unknown, secrets: readonly string[] = []): unknown {
  if (typeof value === "string") return redactString(value, secrets);
  if (Array.isArray(value)) return value.map((entry) => redactEvidence(entry, secrets));
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    key,
    isSecretKey(key) ? "<redacted>" : redactEvidence(entry, secrets),
  ]));
}

export function assertNoSecrets(value: unknown, secrets: readonly string[] = []): void {
  const serialized = JSON.stringify(value);
  requireValue(!REDACTION_PATTERNS.some((pattern) => new RegExp(pattern.source, pattern.flags).test(serialized)), "Evidence contains a secret-like value");
  requireValue(secrets.filter((entry) => entry.length >= 8).every((secret) => !serialized.includes(secret)), "Evidence contains configured secret bytes");
}

export function readProtectedValue(locator: ProtectedLocator, afterOpen?: () => void): string {
  let descriptor: number | undefined;
  try {
    const before = lstatSync(locator.path);
    requireValue(before.dev === locator.dev && before.ino === locator.ino && before.uid === locator.uid
      && before.mode === locator.mode && before.size === locator.size && before.nlink === 1, "Protected file identity changed before open");
    descriptor = openSync(locator.path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = fstatSync(descriptor);
    requireValue(opened.isFile() && opened.dev === locator.dev && opened.ino === locator.ino && opened.uid === locator.uid
      && opened.mode === locator.mode && opened.size === locator.size && opened.nlink === 1 && opened.size <= 1024 * 1024,
    "Protected file descriptor identity changed");
    afterOpen?.();
    const value = readFileSync(descriptor, "utf8").trim();
    requireValue(value.length > 0, "Protected file is empty");
    const afterDescriptor = fstatSync(descriptor);
    const afterPath = lstatSync(locator.path);
    requireValue(afterDescriptor.dev === locator.dev && afterDescriptor.ino === locator.ino && afterDescriptor.uid === locator.uid
      && afterDescriptor.mode === locator.mode && afterDescriptor.size === locator.size && afterDescriptor.nlink === 1
      && afterPath.dev === locator.dev && afterPath.ino === locator.ino && afterPath.uid === locator.uid
      && afterPath.mode === locator.mode && afterPath.size === locator.size && afterPath.nlink === 1,
    "Protected file identity changed during read");
    return value;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function integer(value: unknown, minimum = 0): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
}

export function decodeChangedPath(segments: unknown): string | undefined {
  if (!Array.isArray(segments) || segments.length < 1 || segments.length > 128) return undefined;
  const decoded: string[] = [];
  for (const segment of segments) {
    if (typeof segment !== "string" || !/^[A-Za-z0-9_-]{1,342}$/.test(segment)) return undefined;
    const bytes = Buffer.from(segment, "base64url");
    const value = bytes.toString("utf8");
    if (Buffer.from(value, "utf8").toString("base64url") !== segment || !value || value === "." || value === ".." || value.includes("/")) return undefined;
    decoded.push(value);
  }
  const path = decoded.join("/");
  return !path.startsWith("/") && !path.includes("\\") ? path : undefined;
}

export function assertOperationalMemoryEntry(value: unknown): asserts value is OperationalMemoryEntry {
  const keys = ["entryId", "actorId", "sourceRevision", "publishedAt", "status", "actionKinds", "checkResults", "todoState",
    "todoCounts", "currentTaskId", "contextRevision", "nextWork", "changedPathSegments"] as const;
  requireValue(hasExactKeys(value, keys), "Operational memory shape is invalid");
  requireValue(typeof value.entryId === "string" && UUID.test(value.entryId), "Operational memory entry ID is invalid");
  requireValue(typeof value.actorId === "string" && /^actor-[0-9a-f]{64}$/.test(value.actorId), "Operational memory actor is invalid");
  requireValue(integer(value.sourceRevision, 1)
    && (value.publishedAt === null || (typeof value.publishedAt === "string" && Number.isFinite(Date.parse(value.publishedAt)))), "Operational memory revision/time is invalid");
  requireValue(["active", "working", "idle", "completed", "error"].includes(String(value.status)), "Operational memory status is invalid");
  requireValue(Array.isArray(value.actionKinds) && value.actionKinds.length <= 64
    && value.actionKinds.every((kind) => ["read", "search", "write", "edit", "execute"].includes(String(kind))), "Operational memory actions are invalid");
  requireValue(Array.isArray(value.checkResults) && value.checkResults.length <= 32, "Operational memory checks are invalid");
  for (const check of value.checkResults) {
    requireValue(hasExactKeys(check, ["kind", "result"])
      && ["test", "typecheck", "lint", "build", "format", "security", "other"].includes(String(check.kind))
      && ["passed", "failed"].includes(String(check.result)), "Operational memory check is invalid");
  }
  requireValue(hasExactKeys(value.todoCounts, ["total", "pending", "inProgress", "completed", "cancelled"]), "Operational memory todos are invalid");
  const todos = value.todoCounts;
  requireValue(["total", "pending", "inProgress", "completed", "cancelled"].every((key) => integer(todos[key])), "Operational memory todos are invalid");
  requireValue(todos.total === (todos.pending as number) + (todos.inProgress as number) + (todos.completed as number) + (todos.cancelled as number), "Operational memory todo counts are inconsistent");
  requireValue(["none", "pending", "in_progress", "complete", "cancelled", "mixed"].includes(String(value.todoState)), "Operational memory todo state is invalid");
  requireValue(value.currentTaskId === null || (typeof value.currentTaskId === "string" && /^task-[0-9a-f]{64}$/.test(value.currentTaskId)), "Operational memory task is invalid");
  requireValue(integer(value.contextRevision), "Operational memory context revision is invalid");
  requireValue(Array.isArray(value.changedPathSegments) && value.changedPathSegments.length <= 32
    && value.changedPathSegments.every((segments) => decodeChangedPath(segments) !== undefined), "Operational memory changed paths are invalid");
  requireValue(hasExactKeys(value.nextWork, ["kind", "referenceHash"])
    && ["none", "continue_task", "review_changes", "run_checks", "address_failure"].includes(String(value.nextWork.kind))
    && (value.nextWork.referenceHash === null || (typeof value.nextWork.referenceHash === "string" && SHA256.test(value.nextWork.referenceHash))), "Operational memory next work is invalid");
}

export function parseCoordinationMemoryBlock(value: unknown): OperationalMemoryEntry[] {
  if (value === null) return [];
  requireValue(typeof value === "string" && value.startsWith(COORDINATION_MEMORY_PREFIX), "Coordination memory block is missing");
  const lines = value.split("\n");
  const payload: unknown = JSON.parse(lines.slice(2).join("\n"));
  requireValue(hasExactKeys(payload, ["schemaVersion", "pathEncoding", "memoryEntries"]) && payload.schemaVersion === 2
    && payload.pathEncoding === "base64url-utf8-segments" && Array.isArray(payload.memoryEntries), "Coordination memory payload is invalid");
  requireValue(payload.memoryEntries.length <= 8, "Coordination memory payload is too large");
  for (const entry of payload.memoryEntries) assertOperationalMemoryEntry(entry);
  const entries = payload.memoryEntries as OperationalMemoryEntry[];
  requireValue(new Set(entries.map((entry) => entry.entryId)).size === entries.length, "Coordination memory contains duplicate entries");
  return entries;
}

export function assertOwnershipManifest(value: unknown): asserts value is HarnessOwnershipManifest {
  requireValue(isRecord(value) && value.schema === HARNESS_MANIFEST_SCHEMA && typeof value.runId === "string" && UUID.test(value.runId)
    && typeof value.runNonce === "string" && UUID.test(value.runNonce) && typeof value.createdAt === "string" && Number.isFinite(Date.parse(value.createdAt)), "Harness manifest identity is invalid");
  requireValue(typeof value.repoRoot === "string" && typeof value.artifactRoot === "string" && typeof value.tempRoot === "string"
    && isAbsolute(value.repoRoot) && pathIsInside(value.repoRoot, value.artifactRoot) && !pathIsInside(value.repoRoot, value.tempRoot), "Harness manifest paths are invalid");
  requireValue(typeof value.revision === "string" && /^[0-9a-f]{40}$/.test(value.revision) && typeof value.project === "string"
    && typeof value.workspaceId === "string", "Harness manifest binding is invalid");
  requireValue(isRecord(value.ports) && [value.ports.proxy, value.ports.externalA, value.ports.externalB].every((port) => integer(port, 1024) && port <= 65535)
    && new Set([value.ports.proxy, value.ports.externalA, value.ports.externalB]).size === 3
    && (value.ports.internalC === null || (integer(value.ports.internalC, 1024) && value.ports.internalC <= 65535)), "Harness manifest ports are invalid");
  requireValue(Array.isArray(value.processes) && value.processes.length <= 4, "Harness manifest processes are invalid");
  for (const process of value.processes) {
    requireValue(isRecord(process) && ["proxy", "external-a", "external-b", "internal-c"].includes(String(process.role))
      && (process.pid === null || integer(process.pid, 2)) && (process.externalId === null || typeof process.externalId === "string")
      && (process.port === null || (integer(process.port, 1024) && process.port <= 65535))
      && typeof process.commandSha256 === "string" && SHA256.test(process.commandSha256), "Harness manifest process is invalid");
  }
  requireValue(isRecord(value.boundaries) && value.boundaries.liveRun === true && value.boundaries.applicationSourceMutation === false
    && value.boundaries.tokenBytesRetained === false && value.boundaries.runtimeCreated === false, "Harness manifest boundaries are invalid");
}

export class EvidenceStore {
  readonly root: string;

  constructor(repoRoot: string, artifactRoot: string, private readonly secrets: readonly string[]) {
    const repo = realpathSync(repoRoot);
    const resolved = resolve(artifactRoot);
    if (!pathIsInside(join(repo, "tests", "artifacts", "test-runs"), resolved)) throw new Error("Evidence root escaped test-runs");
    mkdirSync(resolved, { recursive: true, mode: 0o700 });
    chmodSync(resolved, 0o700);
    if (realpathSync(resolved) !== resolved || lstatSync(resolved).isSymbolicLink()) throw new Error("Evidence root is unsafe");
    this.root = resolved;
  }

  write(name: string, value: unknown): void {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.json$/.test(name)) throw new Error("Evidence filename is invalid");
    const safe = redactEvidence(value, this.secrets);
    assertNoSecrets(safe, this.secrets);
    const destination = join(this.root, name);
    const temporary = join(this.root, `.${name}.${process.pid}.tmp`);
    try {
      writeFileSync(temporary, `${JSON.stringify(safe, null, 2)}\n`, { mode: 0o600, flag: "wx" });
      renameSync(temporary, destination);
      chmodSync(destination, 0o600);
    } catch (error) {
      try { unlinkSync(temporary); } catch {}
      throw error;
    }
  }
}

export function managedCommandPayload(argv: readonly string[]): string {
  return Buffer.from(JSON.stringify(argv), "utf8").toString("base64url");
}
