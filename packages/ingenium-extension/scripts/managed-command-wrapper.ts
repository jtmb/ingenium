#!/usr/bin/env node
import { createHash, randomBytes } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, readlinkSync, realpathSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  decodeReplacementFirstRestartRequest,
  runReplacementFirstRestart,
  type ReplacementFirstRestartDependencies,
  type ReplacementFirstRestartResult,
} from "../replacement-first-restart.js";
import { RECOVERY_BOOTSTRAP_MAX_RUNTIME_MS } from "./recovery-bootstrap.js";

const ARG = /^[A-Za-z0-9_@%+=:,./-]{1,512}$/;
const BUILD_SCRIPTS = new Set(["build", "typecheck", "test", "lint"]);
const EXTENSION_TEST_FILES = new Set(["managed-command-wrapper.test.ts", "session-coordinator.test.ts"]);
const DEPLOYMENT_OPERATIONS = new Set(["mcp-status", "compose-ps", "compose-build", "compose-up", "compose-restart", "health", "production-restart"]);
const REPOSITORY_INSPECTIONS = new Set(["status", "staged-paths", "recent-log", "head"]);
const REPOSITORY_PATH_INSPECTIONS = new Set(["diff", "staged-diff"]);
const GIT = "/usr/bin/git";
const RUNTIME_BIN = dirname(process.execPath);
const NPM = `${RUNTIME_BIN}/npm`;
const OPENCODE = "/usr/local/bin/opencode";
const DOCKER = "/usr/bin/docker";
const CURL = "/usr/bin/curl";
const MANAGED_COMMAND_NONCE = "INGENIUM_MANAGED_COMMAND_NONCE";
const RECOVERY_ENVIRONMENT = [
  "CI",
  "FORCE_COLOR",
  "HOME",
  "INGENIUM_API_URL",
  "INGENIUM_MCP_AUDIENCE",
  "INGENIUM_MCP_CREDENTIAL_FILE",
  "INGENIUM_MCP_CREDENTIAL_PURPOSE",
  "INGENIUM_PROJECT",
  "INGENIUM_PROJECT_ID",
  "INGENIUM_RECOVERY_OWNER_NONCE",
  "INGENIUM_RECOVERY_OWNER_PID",
  "INGENIUM_RECOVERY_OWNER_START_TICKS",
  "INGENIUM_STORAGE_MAPPING_HASH",
  "INGENIUM_WORKSPACE_ID",
  "NO_COLOR",
  "TERM",
  "TMPDIR",
] as const;
export const MANAGED_RECOVERY_BOOTSTRAP_TIMEOUT_MS = RECOVERY_BOOTSTRAP_MAX_RUNTIME_MS + 30_000;
const GIT_CONFIGURATION = [
  "-c", "core.fsmonitor=false",
  "-c", "core.hooksPath=/dev/null",
];
const COMMIT_CONFIGURATION = [
  "-c", "commit.gpgSign=false",
  "-c", "credential.helper=",
  "-c", "user.name=Ingenium Managed Command",
  "-c", "user.email=managed-command@ingenium.invalid",
];
const EXECUTABLE_GIT_CONFIGURATION = /^(?:core\.(?:askPass|editor|fsmonitor|gitproxy|hooksPath|pager|sshCommand)|credential\..*helper|diff(?:\.external|\..*\.(?:command|textconv))|filter\..*\.(?:clean|process|smudge)|gpg(?:\..*)?\.program|interactive\.diffFilter|merge\..*\.driver|sequence\.editor)$/i;

export function managedWrapperPackageRoot(moduleUrl: string | URL = import.meta.url): string {
  const wrapper = realpathSync(fileURLToPath(moduleUrl));
  const scriptsDirectory = dirname(wrapper);
  const built = basename(dirname(scriptsDirectory)) === "dist";
  if (basename(scriptsDirectory) !== "scripts"
    || basename(wrapper) !== `managed-command-wrapper.${built ? "js" : "ts"}`) {
    throw new Error("Managed wrapper is outside its fixed source or distribution layout");
  }
  const packageRoot = realpathSync(resolve(scriptsDirectory, built ? "../.." : ".."));
  if (basename(packageRoot) !== "ingenium-extension" || basename(dirname(packageRoot)) !== "packages") {
    throw new Error("Managed wrapper is outside packages/ingenium-extension");
  }
  return packageRoot;
}

export function managedRecoveryWorktree(moduleUrl: string | URL = import.meta.url): string {
  const packageRoot = managedWrapperPackageRoot(moduleUrl);
  const repositoryRoot = realpathSync(resolve(packageRoot, "../.."));
  if (realpathSync(resolve(repositoryRoot, "packages/ingenium-extension")) !== packageRoot) {
    throw new Error("Managed wrapper package layout is not canonical");
  }
  if (existsSync(GIT) && existsSync(resolve(repositoryRoot, ".git"))) {
    const gitTopLevel = realpathSync(execFileSync(
      GIT,
      ["-C", repositoryRoot, ...GIT_CONFIGURATION, "rev-parse", "--show-toplevel"],
      {
        encoding: "utf8",
        timeout: 10_000,
        env: {
          PATH: "/usr/local/bin:/usr/bin:/bin",
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_TERMINAL_PROMPT: "0",
        },
      },
    ).trim());
    if (gitTopLevel !== repositoryRoot) throw new Error("Managed wrapper Git top-level does not match its repository layout");
  }
  return repositoryRoot;
}

export function managedRecoveryBootstrapPath(moduleUrl: string | URL = import.meta.url): string {
  return resolve(managedWrapperPackageRoot(moduleUrl), "scripts/recovery-bootstrap.js");
}

function isSafeCommitMessage(value: string): boolean {
  return value.length >= 1 && value.length <= 100 && value === value.trim()
    && !value.startsWith("-") && !/[\u0000-\u001f\u007f]/.test(value);
}

export function decodeManagedArgv(encoded: string): string[] {
  if (!/^[A-Za-z0-9_-]{2,8192}$/.test(encoded)) throw new Error("Invalid managed command payload");
  const parsed: unknown = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 64
    || !parsed.every((value) => typeof value === "string")
    || (parsed[0] === "commit"
      ? parsed.length !== 2 || !isSafeCommitMessage(parsed[1]!)
      : !parsed.every((value) => ARG.test(value)))) {
    throw new Error("Invalid managed command payload");
  }
  return parsed;
}

export function decodeManagedRepositoryArgv(encoded: string): string[] {
  return validateManagedRepositoryArgv(decodeManagedArgv(encoded));
}

export function decodeManagedBuildArgv(encoded: string): string[] {
  return validateManagedBuildArgv(decodeManagedArgv(encoded));
}

export async function managedReplacementFirstRestart<Session>(
  argv: readonly unknown[],
  dependencies: ReplacementFirstRestartDependencies<Session>,
  worktree = process.cwd(),
): Promise<ReplacementFirstRestartResult> {
  if (argv.length !== 1 || typeof argv[0] !== "string") {
    throw new Error("Managed replacement-first restart requires one encoded payload");
  }
  return runReplacementFirstRestart(decodeReplacementFirstRestartRequest(argv[0], worktree), dependencies);
}

function sourceFingerprint(cwd: string): string {
  const env = managedGitEnvironment();
  assertNonExecutableGitConfiguration(cwd, env);
  const names = execFileSync(GIT, ["-C", cwd, ...GIT_CONFIGURATION, "ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    encoding: "buffer", timeout: 10_000, maxBuffer: 16 * 1024 * 1024, env,
  });
  const hash = createHash("sha256");
  for (const path of names.toString("utf8").split("\0").filter(Boolean).sort()) {
    hash.update(path).update("\0");
    try {
      hash.update(execFileSync(GIT, ["-C", cwd, ...GIT_CONFIGURATION, "hash-object", "--", path], {
        encoding: "buffer", timeout: 10_000, env,
      }));
    } catch {
      hash.update("missing");
    }
  }
  return hash.digest("hex");
}

function isSafeRepositoryPath(value: string): boolean {
  return value.length <= 1024 && value === value.trim() && !value.startsWith("/") && !value.startsWith("~")
    && !value.startsWith("-") && !value.includes("\\") && !/[\u0000-\u001f\u007f]/.test(value)
    && value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== ".." && segment !== ".git");
}

export function validateManagedRepositoryArgv(argv: string[]): string[] {
  const [operation, ...paths] = argv;
  if (paths.length === 0 && REPOSITORY_INSPECTIONS.has(operation!)) return argv;
  if (operation === "commit") {
    if (paths.length !== 1 || !isSafeCommitMessage(paths[0]!)) {
      throw new Error("Repository wrapper rejected the command");
    }
    return argv;
  }
  const validPaths = paths.length > 0 && paths.length <= 32
    && paths.every((path) => ARG.test(path) && isSafeRepositoryPath(path));
  if (validPaths && REPOSITORY_PATH_INSPECTIONS.has(operation!)) return argv;
  if (!validPaths || (operation === "mv" && paths.length !== 2)
    || (operation !== "add" && operation !== "mv" && operation !== "rm")) {
    throw new Error("Repository wrapper rejected the command");
  }
  return argv;
}

export function validateManagedBuildArgv(argv: string[]): string[] {
  const valid = (argv.length === 1 && BUILD_SCRIPTS.has(argv[0]!))
    || (argv.length === 2 && argv[0] === "run" && BUILD_SCRIPTS.has(argv[1]!))
    || (argv.length === 3 && argv[0] === "run" && argv[1] === "typecheck"
      && argv[2] === "--workspace=packages/ingenium-extension")
    || (argv.length === 7 && argv[0] === "run" && argv[1] === "test"
      && argv[2] === "--workspace=packages/ingenium-extension" && argv[3] === "--"
      && EXTENSION_TEST_FILES.has(argv[4]!) && argv[5] === "-t" && /^[A-Za-z0-9_-]{1,64}$/.test(argv[6]!))
    || (argv.length === 1 && argv[0] === "agent-validation")
    || isManagedDeploymentArgv(argv);
  if (!valid) throw new Error("Build wrapper rejected the command");
  return argv;
}

export function isManagedDeploymentArgv(argv: readonly string[]): boolean {
  return argv.length === 2 && argv[0] === "deployment" && DEPLOYMENT_OPERATIONS.has(argv[1]!);
}

export function managedBuildExecution(argv: string[], moduleUrl: string | URL = import.meta.url): { command: string; argv: string[] } {
  validateManagedBuildArgv(argv);
  if (argv.length === 1 && argv[0] === "agent-validation") {
    return { command: "/usr/bin/bash", argv: ["tests/test-agent-validation.sh", "--role-matrix"] };
  }
  if (!isManagedDeploymentArgv(argv)) return { command: NPM, argv };
  switch (argv[1]) {
    case "mcp-status":
      return { command: OPENCODE, argv: ["mcp", "list"] };
    case "compose-ps":
      return { command: DOCKER, argv: ["compose", "--profile", "compatibility", "-p", "ingenium", "ps"] };
    case "compose-build":
      return { command: DOCKER, argv: ["compose", "--profile", "compatibility", "-p", "ingenium", "build"] };
    case "compose-up":
      return { command: DOCKER, argv: ["compose", "--profile", "compatibility", "-p", "ingenium", "up", "--build", "-d"] };
    case "compose-restart":
      return { command: DOCKER, argv: ["compose", "--profile", "compatibility", "-p", "ingenium", "restart", "ingenium"] };
    case "health":
      return { command: CURL, argv: ["--fail", "--show-error", "http://127.0.0.1:4097/api/v1/health"] };
    case "production-restart":
      return { command: process.execPath, argv: [managedRecoveryBootstrapPath(moduleUrl)] };
    default:
      throw new Error("Build wrapper rejected the command");
  }
}

export function managedBuildEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    ...Object.fromEntries(Object.entries(source).filter(([key]) =>
      !key.startsWith("COMPOSE_") && !key.startsWith("DOCKER_") && !key.startsWith("npm_")
      && key !== "NODE_OPTIONS" && key !== "PATH")),
    PATH: `${RUNTIME_BIN}:/usr/local/bin:/usr/bin:/bin`,
  };
}

export function managedRecoveryEnvironment(
  source: NodeJS.ProcessEnv = process.env,
  moduleUrl: string | URL = import.meta.url,
): NodeJS.ProcessEnv {
  return {
    ...Object.fromEntries(RECOVERY_ENVIRONMENT.flatMap((name) => source[name] === undefined ? [] : [[name, source[name]!]])),
    INGENIUM_WORKTREE: managedRecoveryWorktree(moduleUrl),
    PATH: `${RUNTIME_BIN}:/usr/local/bin:/usr/bin:/bin`,
  };
}

export function managedRepositoryArgv(argv: string[]): string[] {
  const [operation, ...paths] = validateManagedRepositoryArgv(argv);
  if (operation === "status") return [...GIT_CONFIGURATION, "status", "--short"];
  if (operation === "staged-paths") {
    return [...GIT_CONFIGURATION, "diff", "--cached", "--name-only", "--no-ext-diff"];
  }
  if (operation === "recent-log") {
    return [...GIT_CONFIGURATION, "log", "--format=%h %s", "--max-count=10", "--no-decorate"];
  }
  if (operation === "head") return [...GIT_CONFIGURATION, "rev-parse", "HEAD"];
  if (operation === "diff") return [...GIT_CONFIGURATION, "diff", "--no-ext-diff", "--", ...paths];
  if (operation === "staged-diff") {
    return [...GIT_CONFIGURATION, "diff", "--cached", "--no-ext-diff", "--", ...paths];
  }
  if (operation === "commit") {
    return [
      ...GIT_CONFIGURATION,
      ...COMMIT_CONFIGURATION,
      "commit", "--no-verify", "--no-gpg-sign", "--cleanup=verbatim", "-m", paths[0]!,
    ];
  }
  return [...GIT_CONFIGURATION, operation!, "--", ...paths];
}

export function managedGitEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = Object.fromEntries(Object.entries(source).filter(([key]) => !key.startsWith("GIT_")
    && !key.startsWith("LD_") && !key.startsWith("DYLD_") && key !== "NODE_OPTIONS" && key !== "SSH_ASKPASS"));
  return {
    ...env,
    PATH: "/usr/local/bin:/usr/bin:/bin",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_EDITOR: "true",
    GIT_SEQUENCE_EDITOR: "true",
    GIT_PAGER: "cat",
    GIT_TERMINAL_PROMPT: "0",
    GIT_LITERAL_PATHSPECS: "1",
  };
}

export interface ManagedProcessIdentity {
  pid: number;
  processGroupId: number;
  startTimeTicks: number;
  executableSha256: string;
}

export interface ManagedProcessGroupIdentity {
  leader: ManagedProcessIdentity;
  members: Map<number, ManagedProcessIdentity>;
}

export interface ManagedTimedOutProcessAttestation {
  nonce: string;
  executableSha256: string;
}

function managedProcessStat(pid: number): { processGroupId: number; startTimeTicks: number } | undefined {
  try {
    const source = readFileSync(`/proc/${pid}/stat`, "utf8");
    const fields = source.slice(source.lastIndexOf(")") + 1).trim().split(/\s+/);
    const processGroupId = Number(fields[2]);
    const startTimeTicks = Number(fields[19]);
    return Number.isSafeInteger(processGroupId) && processGroupId > 0
      && Number.isSafeInteger(startTimeTicks) && startTimeTicks > 0
      ? { processGroupId, startTimeTicks }
      : undefined;
  } catch {
    return undefined;
  }
}

function managedProcessHasNonce(pid: number, nonce: string): boolean {
  try {
    return readFileSync(`/proc/${pid}/environ`, "utf8").split("\0").includes(`${MANAGED_COMMAND_NONCE}=${nonce}`);
  } catch {
    return false;
  }
}

function managedProcessIdentity(pid: number, nonce: string): ManagedProcessIdentity | undefined {
  const stat = managedProcessStat(pid);
  if (!stat || !managedProcessHasNonce(pid, nonce)) return undefined;
  try {
    const executable = realpathSync(readlinkSync(`/proc/${pid}/exe`));
    return {
      pid,
      ...stat,
      executableSha256: createHash("sha256").update(readFileSync(executable)).digest("hex"),
    };
  } catch {
    return undefined;
  }
}

export function inspectManagedProcessGroup(pid: number, nonce: string): ManagedProcessGroupIdentity | undefined {
  const leader = managedProcessIdentity(pid, nonce);
  if (!leader || leader.processGroupId !== pid) return undefined;
  const members = new Map<number, ManagedProcessIdentity>();
  for (const entry of readdirSync("/proc")) {
    if (!/^[1-9][0-9]*$/.test(entry)) continue;
    const memberPid = Number(entry);
    const stat = managedProcessStat(memberPid);
    if (stat?.processGroupId !== pid) continue;
    const member = managedProcessIdentity(memberPid, nonce);
    if (!member) throw new Error("Managed process group contains an unattested member");
    members.set(memberPid, member);
  }
  if (!members.has(pid)) throw new Error("Managed process-group leader is unavailable");
  return { leader, members };
}

function sameManagedProcess(left: ManagedProcessIdentity | undefined, right: ManagedProcessIdentity): boolean {
  return left?.pid === right.pid && left.processGroupId === right.processGroupId
    && left.startTimeTicks === right.startTimeTicks && left.executableSha256 === right.executableSha256;
}

function groupRemainsAttested(
  expected: ManagedProcessGroupIdentity,
  current: ManagedProcessGroupIdentity | undefined,
): boolean {
  if (!current) return false;
  if (!sameManagedProcess(current.leader, expected.leader)) {
    throw new Error("Managed process-group leader identity changed before signal");
  }
  for (const [pid, member] of current.members) {
    if (!sameManagedProcess(expected.members.get(pid), member)) {
      throw new Error("Managed process-group member identity changed before signal");
    }
  }
  return true;
}

export function terminateTimedOutManagedProcess(
  pid: number | undefined,
  detached: boolean,
  attestation: ManagedTimedOutProcessAttestation,
  dependencies: {
    inspect?: typeof inspectManagedProcessGroup;
    kill?: typeof process.kill;
  } = {},
): void {
  if (!Number.isSafeInteger(pid) || pid! < 2) return;
  const inspect = dependencies.inspect ?? inspectManagedProcessGroup;
  const kill = dependencies.kill ?? process.kill;
  const captured = inspect(pid!, attestation.nonce);
  if (!captured) return;
  if (captured.leader.executableSha256 !== attestation.executableSha256) {
    throw new Error("Managed timed-out process executable identity changed");
  }
  const signal = (name: NodeJS.Signals) => {
    if (!groupRemainsAttested(captured, inspect(pid!, attestation.nonce))) return;
    try { kill(detached ? -pid! : pid!, name); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  };
  signal("SIGTERM");
  if (detached) signal("SIGKILL");
}

export function isExecutableGitConfiguration(entry: string): boolean {
  const separator = entry.indexOf("\n");
  const key = separator === -1 ? entry : entry.slice(0, separator);
  const value = separator === -1 ? "" : entry.slice(separator + 1);
  return EXECUTABLE_GIT_CONFIGURATION.test(key)
    || (/^alias\./i.test(key) && value.trimStart().startsWith("!"));
}

function assertNonExecutableGitConfiguration(cwd: string, env: NodeJS.ProcessEnv): void {
  const configurationEnvironment = { ...env };
  delete configurationEnvironment.GIT_CONFIG_GLOBAL;
  const options = {
    encoding: "utf8" as const,
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
    env: configurationEnvironment,
  };
  let worktreeConfig: string;
  try {
    worktreeConfig = execFileSync(
      GIT,
      ["-C", cwd, "config", "--local", "--bool", "--get", "extensions.worktreeConfig"],
      options,
    ).trim();
  } catch (error) {
    if ((error as { status?: unknown }).status === 1) worktreeConfig = "false";
    else throw new Error("Repository wrapper worktreeConfig probe failed", { cause: error });
  }
  if (worktreeConfig !== "true" && worktreeConfig !== "false") {
    throw new Error("Repository wrapper worktreeConfig probe is invalid");
  }
  const configuration = execFileSync(
    GIT,
    ["-C", cwd, "config", "--null", "--local", "--list", "--includes"],
    options,
  ).split("\0");
  if (worktreeConfig === "true") {
    configuration.push(...execFileSync(
      GIT,
      ["-C", cwd, "config", "--null", "--worktree", "--list", "--includes"],
      options,
    ).split("\0"));
  }
  if (configuration.some(isExecutableGitConfiguration)) {
    throw new Error("Repository wrapper rejected executable Git configuration");
  }
}

export function managedCommand(
  kind: "repository" | "build",
  argv: string[],
  cwd = process.cwd(),
  dependencies: {
    runner?: typeof spawnSync;
    terminateTimedOut?: typeof terminateTimedOutManagedProcess;
  } = {},
): number {
  const productionRestart = kind === "build" && argv[0] === "deployment" && argv[1] === "production-restart";
  let command: string;
  let commandArgv: string[];
  let env: NodeJS.ProcessEnv | undefined;
  if (kind === "repository") {
    env = managedGitEnvironment();
    assertNonExecutableGitConfiguration(cwd, env);
    command = GIT;
    commandArgv = ["-C", cwd, ...managedRepositoryArgv(argv)];
  } else {
    const execution = managedBuildExecution(argv);
    command = execution.command;
    commandArgv = execution.argv;
    env = productionRestart ? managedRecoveryEnvironment() : managedBuildEnvironment();
  }
  const before = kind === "build" ? sourceFingerprint(cwd) : undefined;
  const detached = productionRestart && process.platform !== "win32";
  const managedNonce = productionRestart ? randomBytes(32).toString("base64url") : undefined;
  const timedOutProcessAttestation = productionRestart ? {
    nonce: managedNonce!,
    executableSha256: createHash("sha256").update(readFileSync(realpathSync(process.execPath))).digest("hex"),
  } : undefined;
  const result = (dependencies.runner ?? spawnSync)(command, commandArgv, {
    cwd,
    stdio: "inherit",
    shell: false,
    env: managedNonce ? { ...env, [MANAGED_COMMAND_NONCE]: managedNonce } : env,
    ...(productionRestart ? { timeout: MANAGED_RECOVERY_BOOTSTRAP_TIMEOUT_MS, killSignal: "SIGTERM", detached } : {}),
  });
  if ((result.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT") {
    (dependencies.terminateTimedOut ?? terminateTimedOutManagedProcess)(result.pid, detached, timedOutProcessAttestation!);
    const error = new Error(`Managed recovery bootstrap timed out after ${MANAGED_RECOVERY_BOOTSTRAP_TIMEOUT_MS}ms`) as NodeJS.ErrnoException;
    error.code = "ETIMEDOUT";
    throw error;
  }
  if (result.error) throw result.error;
  if (kind === "build" && sourceFingerprint(cwd) !== before) throw new Error("Build wrapper produced source changes");
  return result.status ?? 1;
}

export function runManagedCommandCli(kind: "repository" | "build", argv = process.argv): void {
  const fixedProductionRestart = kind === "build" && argv.length === 4
    && argv[2] === "deployment" && argv[3] === "production-restart";
  if (!fixedProductionRestart && argv.length !== 3) throw new Error("Managed wrapper requires one encoded argv payload");
  const commandArgv = fixedProductionRestart
    ? validateManagedBuildArgv(argv.slice(2))
    : kind === "repository"
      ? decodeManagedRepositoryArgv(argv[2]!)
      : decodeManagedBuildArgv(argv[2]!);
  process.exitCode = managedCommand(kind, commandArgv);
}
