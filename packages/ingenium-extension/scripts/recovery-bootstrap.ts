#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync, spawnSync, type SpawnSyncReturns } from "node:child_process";
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const RUNTIME_BIN = dirname(process.execPath);
const NPM = `${RUNTIME_BIN}/npm`;
const RECOVERY_BOOTSTRAP_GUARD = "INGENIUM_RECOVERY_BOOTSTRAP_VERIFIED";
const RECOVERY_BOOTSTRAP_SHA256 = "INGENIUM_RECOVERY_GENERATED_BOOTSTRAP_SHA256";
const RECOVERY_CANONICAL_WORKTREE = "INGENIUM_RECOVERY_CANONICAL_WORKTREE";
const ADMITTED_RECOVERY_CONTEXT = "INGENIUM_ADMITTED_RECOVERY_CONTEXT";
export const RECOVERY_BOOTSTRAP_CHECK_TIMEOUT_MS = 120_000;
export const RECOVERY_BOOTSTRAP_RESTART_TIMEOUT_MS = 600_000;

export const RECOVERY_BOOTSTRAP_CHECKS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["/usr/bin/bash", ["tests/test-agent-validation.sh"]],
  [NPM, ["run", "test", "--workspace=packages/ingenium-extension", "--", "managed-command-wrapper.test.ts", "-t", "autonomous-recovery|recovery checkpoint|source recovery shim|installed current managed wrapper|fixed deployment|Basic authentication|recovery server secret|typed coordination"]],
  [NPM, ["run", "test", "--workspace=packages/ingenium-extension", "--", "session-coordinator.test.ts", "-t", "abort_without_after|idle_stale_pending|ambiguous_quarantine_replay|collision|outbox|trusteddeployment|protected runtime"]],
  [NPM, ["run", "test", "--workspace=packages/ingenium-extension", "--", "coordination-outbox.test.ts"]],
  [NPM, ["run", "typecheck", "--workspace=packages/ingenium-extension"]],
  [NPM, ["run", "build", "--workspace=packages/ingenium-extension"]],
];
export const RECOVERY_BOOTSTRAP_MAX_RUNTIME_MS =
  RECOVERY_BOOTSTRAP_CHECKS.length * RECOVERY_BOOTSTRAP_CHECK_TIMEOUT_MS + RECOVERY_BOOTSTRAP_RESTART_TIMEOUT_MS;

export interface RecoveryBootstrapEvidence {
  schemaVersion: 1;
  checks: Array<{ index: number; result: "passed"; timeoutMs: number }>;
  productionRestart: { result: "pending" | "passed" | "failed" | "timed_out"; timeoutMs: number };
  productionRestartScriptSha256: string;
}

type Runner = (
  command: string,
  argv: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; shell: false; stdio: "inherit"; timeout: number },
) => Pick<SpawnSyncReturns<Buffer>, "error" | "signal" | "status">;

interface PrivateNpmConfiguration {
  userConfig: string;
  globalConfig: string;
  cleanup(): void;
}

export class RecoveryBootstrapTimeoutError extends Error {
  readonly code = "RECOVERY_BOOTSTRAP_TIMEOUT";

  constructor(
    readonly stage: "check" | "restart",
    readonly checkIndex: number | null,
  ) {
    super(stage === "check" ? `Recovery bootstrap check ${checkIndex} timed out` : "Production restart timed out");
    this.name = "RecoveryBootstrapTimeoutError";
  }
}

function completedStatus(
  result: ReturnType<Runner>,
  stage: "check" | "restart",
  checkIndex: number | null = null,
): number {
  if ((result.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT") {
    throw new RecoveryBootstrapTimeoutError(stage, checkIndex);
  }
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function selectedEnvironment(source: NodeJS.ProcessEnv, names: readonly string[]): NodeJS.ProcessEnv {
  return Object.fromEntries(names.flatMap((name) => source[name] === undefined ? [] : [[name, source[name]!]]));
}

function privateNpmConfiguration(): PrivateNpmConfiguration {
  if (process.platform !== "linux" || typeof process.getuid !== "function") {
    throw new Error("Recovery bootstrap requires Linux process identity support");
  }
  const owner = process.getuid();
  const root = `/tmp/opencode-${owner}`;
  try {
    mkdirSync(root, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const rootStat = lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || rootStat.uid !== owner
    || (rootStat.mode & 0o022) !== 0 || realpathSync(root) !== root) {
    throw new Error("Recovery npm configuration root is not private");
  }
  const directory = mkdtempSync(resolve(root, "recovery-npm-config-"));
  const created: string[] = [];
  const create = (name: string): string => {
    const path = resolve(directory, name);
    writeFileSync(path, "", { flag: "wx", mode: 0o400 });
    created.push(path);
    const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const opened = fstatSync(descriptor);
      const current = lstatSync(path);
      if (!opened.isFile() || !current.isFile() || current.isSymbolicLink()
        || opened.dev !== current.dev || opened.ino !== current.ino
        || opened.nlink !== 1 || current.nlink !== 1 || opened.uid !== owner || current.uid !== owner
        || (opened.mode & 0o777) !== 0o400 || (current.mode & 0o777) !== 0o400
        || opened.size !== 0 || current.size !== 0 || realpathSync(path) !== path
        || readFileSync(descriptor).length !== 0) {
        throw new Error("Recovery npm configuration file is not private");
      }
      return path;
    } finally {
      closeSync(descriptor);
    }
  };
  let userConfig: string | undefined;
  let globalConfig: string | undefined;
  try {
    userConfig = create("user.npmrc");
    globalConfig = create("global.npmrc");
  } catch (error) {
    for (const path of created.reverse()) unlinkSync(path);
    rmdirSync(directory);
    throw error;
  }
  if (!userConfig || !globalConfig) throw new Error("Recovery npm configuration is incomplete");
  return {
    userConfig,
    globalConfig,
    cleanup() {
      try {
        unlinkSync(userConfig);
      } finally {
        try {
          unlinkSync(globalConfig);
        } finally {
          rmdirSync(directory);
        }
      }
    },
  };
}

export function recoveryBootstrapCheckEnvironment(
  npmConfiguration: Pick<PrivateNpmConfiguration, "userConfig" | "globalConfig">,
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return {
    ...selectedEnvironment(source, ["CI", "FORCE_COLOR", "HOME", "NO_COLOR", "TERM", "TMPDIR"]),
    NPM_CONFIG_GLOBALCONFIG: npmConfiguration.globalConfig,
    NPM_CONFIG_SCRIPT_SHELL: "/bin/sh",
    NPM_CONFIG_USERCONFIG: npmConfiguration.userConfig,
    PATH: `${RUNTIME_BIN}:/usr/local/bin:/usr/bin:/bin`,
  };
}

export function recoveryBootstrapRestartEnvironment(
  productionRestartScriptSha256: string,
  npmConfiguration: Pick<PrivateNpmConfiguration, "userConfig" | "globalConfig">,
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  if (!/^[0-9a-f]{64}$/.test(productionRestartScriptSha256)) {
    throw new Error("Production restart script hash is invalid");
  }
  return {
    ...recoveryBootstrapCheckEnvironment(npmConfiguration, source),
    ...selectedEnvironment(source, [
      "INGENIUM_API_URL",
      "INGENIUM_MCP_AUDIENCE",
      "INGENIUM_MCP_CREDENTIAL_FILE",
      "INGENIUM_MCP_CREDENTIAL_PURPOSE",
      "INGENIUM_PROJECT",
      "INGENIUM_PROJECT_ID",
      "INGENIUM_RECOVERY_OWNER_NONCE",
      "INGENIUM_RECOVERY_OWNER_PID",
      "INGENIUM_RECOVERY_OWNER_START_TICKS",
      ADMITTED_RECOVERY_CONTEXT,
      RECOVERY_CANONICAL_WORKTREE,
      "INGENIUM_STORAGE_MAPPING_HASH",
      "INGENIUM_WORKSPACE_ID",
      "INGENIUM_WORKTREE",
    ]),
    [RECOVERY_BOOTSTRAP_GUARD]: productionRestartScriptSha256,
  };
}

export function recoveryBootstrapCanonicalWorktree(source: NodeJS.ProcessEnv = process.env): string {
  const declared = source[RECOVERY_CANONICAL_WORKTREE];
  const bound = source.INGENIUM_WORKTREE;
  if (!declared || !bound || resolve(declared) !== declared || resolve(bound) !== bound) {
    throw new Error("Recovery bootstrap requires an attested canonical worktree");
  }
  const canonical = realpathSync(declared);
  if (canonical !== declared || realpathSync(bound) !== canonical) {
    throw new Error("Recovery bootstrap canonical worktree binding changed");
  }
  return canonical;
}

export function verifyRecoveryBuildStage(source: NodeJS.ProcessEnv = process.env): string {
  const canonical = recoveryBootstrapCanonicalWorktree(source);
  const directory = source.INGENIUM_RECOVERY_STAGE_DIRECTORY;
  const digest = source.INGENIUM_RECOVERY_STAGE_SHA256;
  const owner = process.getuid!();
  const fail = (): never => { throw new Error("Recovery private stage provenance is invalid"); };
  if (!directory || resolve(directory) !== directory || !digest || !/^[0-9a-f]{64}$/.test(digest)) return fail();
  for (let path = directory; ; path = dirname(path)) {
    const stat = lstatSync(path);
    if (!stat.isDirectory() || realpathSync(path) !== path || ![0, owner].includes(stat.uid)
      || ((stat.mode & 0o022) !== 0 && !(stat.uid === 0 && (stat.mode & 0o1000)))) fail();
    if (path === dirname(path)) break;
  }
  if ((lstatSync(directory).mode & 0o7777) !== 0o700 || lstatSync(directory).uid !== owner) fail();
  const stable = (path: string, mode?: number, expectedOwner = owner) => {
    if (realpathSync(path) !== path) fail();
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const before = fstatSync(fd);
      if (!before.isFile() || before.nlink !== 1 || before.uid !== expectedOwner || (before.mode & 0o7022)
        || (mode !== undefined && (before.mode & 0o7777) !== mode)) fail();
      const bytes = readFileSync(fd);
      for (const after of [fstatSync(fd), lstatSync(path)]) {
        if (!after.isFile() || ["dev", "ino", "mode", "uid", "nlink", "size", "mtimeMs", "ctimeMs"].some(
          (key) => before[key as keyof typeof before] !== after[key as keyof typeof after])) fail();
      }
      if (realpathSync(path) !== path) fail();
      return { bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
    } finally { closeSync(fd); }
  };
  const bytes = stable(resolve(directory, "stage.json"), 0o400);
  if (bytes.sha256 !== digest) fail();
  const manifest = JSON.parse(bytes.bytes.toString());
  const exact = (value: unknown, keys: string[]): value is Record<string, any> => value !== null && typeof value === "object"
    && !Array.isArray(value) && Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
  const context = JSON.parse(source[ADMITTED_RECOVERY_CONTEXT] ?? "null");
  if (!exact(manifest, ["schemaVersion", "repositoryRoot", "head", "archiveSha256", "node", "files"])
    || manifest.schemaVersion !== 1 || manifest.repositoryRoot !== canonical || !/^[0-9a-f]{40}$/.test(manifest.head)
    || context?.head !== manifest.head || context?.binding?.worktree !== canonical
    || !exact(manifest.node, ["path", "sha256"]) || manifest.node.path !== realpathSync(process.execPath)
    || !manifest.files || typeof manifest.files !== "object" || Array.isArray(manifest.files)
    || stable(resolve(directory, "source.tar"), 0o400).sha256 !== manifest.archiveSha256) fail();
  const nodeOwner = lstatSync(manifest.node.path).uid;
  if (![0, owner].includes(nodeOwner) || stable(manifest.node.path, undefined, nodeOwner).sha256 !== manifest.node.sha256) fail();
  const workspace = resolve(directory, "workspace");
  if (workspace === canonical || canonical.startsWith(`${directory}/`)) fail();
  for (const [relative, value] of Object.entries(manifest.files)) {
    if (!exact(value, ["sha256", "mode"])) return fail();
    if (!relative || relative.startsWith("/") || relative.includes("\\")
      || relative.split("/").some((part) => !part || [".", "..", ".git", "node_modules"].includes(part))
      || ![0o600, 0o700].includes(value.mode) || !/^[0-9a-f]{64}$/.test(value.sha256)) fail();
    for (let path = dirname(resolve(workspace, relative)); ; path = dirname(path)) {
      const stat = lstatSync(path);
      if (!stat.isDirectory() || realpathSync(path) !== path || stat.uid !== owner || (stat.mode & 0o7777) !== 0o700) fail();
      if (path === workspace) break;
    }
    if (stable(resolve(workspace, relative), value.mode).sha256 !== value.sha256
      || stable(resolve(canonical, relative)).sha256 !== value.sha256) fail();
  }
  const git = (args: string[]) => execFileSync("/usr/bin/git", ["--no-optional-locks", "-C", canonical,
    "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", ...args], {
    encoding: "utf8", timeout: 10_000,
    env: { PATH: "/usr/bin:/bin", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
  }).trim();
  if (git(["rev-parse", "--show-toplevel"]) !== canonical || git(["rev-parse", "HEAD"]) !== manifest.head) fail();
  return workspace;
}

export function hardenGeneratedBootstrapDirectories(
  root: string,
  afterOpen?: (path: string) => void,
): string {
  if (process.platform !== "linux" || typeof process.getuid !== "function") {
    throw new Error("Recovery bootstrap requires Linux process identity support");
  }
  const owner = process.getuid();
  const directories = [
    resolve(root, "packages/ingenium-extension/dist"),
    resolve(root, "packages/ingenium-extension/dist/scripts"),
  ];
  for (const path of directories) {
    const reference = lstatSync(path);
    if (!reference.isDirectory() || reference.isSymbolicLink() || reference.uid !== owner || realpathSync(path) !== path) {
      throw new Error("Recovery bootstrap generated directory identity is invalid");
    }
    const descriptor = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
      const opened = fstatSync(descriptor);
      const current = lstatSync(path);
      const mode = opened.mode & 0o7777;
      if (!opened.isDirectory() || !current.isDirectory() || current.isSymbolicLink()
        || reference.dev !== opened.dev || reference.ino !== opened.ino
        || opened.dev !== current.dev || opened.ino !== current.ino
        || (reference.mode & 0o7777) !== mode || (current.mode & 0o7777) !== mode
        || opened.uid !== owner || current.uid !== owner || realpathSync(path) !== path) {
        throw new Error("Recovery bootstrap generated directory identity changed");
      }
      afterOpen?.(path);
      const hardenedMode = mode & ~0o022;
      if (hardenedMode !== mode) {
        fchmodSync(descriptor, hardenedMode);
        fsyncSync(descriptor);
      }
      const hardened = fstatSync(descriptor);
      const hardenedPath = lstatSync(path);
      if (!hardened.isDirectory() || !hardenedPath.isDirectory() || hardenedPath.isSymbolicLink()
        || opened.dev !== hardened.dev || opened.ino !== hardened.ino
        || opened.dev !== hardenedPath.dev || opened.ino !== hardenedPath.ino
        || hardened.uid !== owner || hardenedPath.uid !== owner
        || (hardened.mode & 0o7777) !== hardenedMode || (hardenedPath.mode & 0o7777) !== hardenedMode
        || realpathSync(path) !== path) {
        throw new Error("Recovery bootstrap generated directory hardening failed");
      }
    } finally {
      closeSync(descriptor);
    }
  }
  return directories[1]!;
}

export function normalizeGeneratedRecoveryExecutable(path: string): string {
  if (process.platform !== "linux" || typeof process.getuid !== "function") {
    throw new Error("Recovery bootstrap requires Linux process identity support");
  }
  const canonical = realpathSync(resolve(path));
  if (canonical !== resolve(path)) throw new Error("Recovery executable path is not canonical");
  const reference = lstatSync(canonical);
  let descriptor: number | undefined;
  try {
    descriptor = openSync(canonical, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = fstatSync(descriptor);
    const mode = opened.mode & 0o777;
    if (!reference.isFile() || reference.isSymbolicLink() || reference.nlink !== 1 || reference.uid !== process.getuid()
      || !opened.isFile() || opened.nlink !== 1 || opened.uid !== process.getuid()
      || reference.dev !== opened.dev || reference.ino !== opened.ino || (mode & 0o555) !== 0o555) {
      throw new Error("Recovery executable identity is invalid");
    }
    if (mode !== 0o555) {
      fchmodSync(descriptor, 0o555);
      fsyncSync(descriptor);
    }
    const hardened = fstatSync(descriptor);
    const current = lstatSync(canonical);
    if (!hardened.isFile() || hardened.nlink !== 1 || (hardened.mode & 0o777) !== 0o555
      || hardened.dev !== opened.dev || hardened.ino !== opened.ino || hardened.size !== opened.size
      || hardened.mtimeMs !== opened.mtimeMs || !current.isFile() || current.isSymbolicLink()
      || current.dev !== opened.dev || current.ino !== opened.ino || (current.mode & 0o777) !== 0o555) {
      throw new Error("Recovery executable mode normalization failed");
    }
    return canonical;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function verifyRecoveryBootstrapInvocation(
  scriptPath: string,
  expectedSha256 = process.env[RECOVERY_BOOTSTRAP_SHA256],
): string {
  if (!expectedSha256 || !/^[0-9a-f]{64}$/.test(expectedSha256)) {
    throw new Error("Recovery bootstrap requires stable generated content");
  }
  const actualSha256 = createHash("sha256").update(readFileSync(realpathSync(scriptPath))).digest("hex");
  if (actualSha256 !== expectedSha256) throw new Error("Recovery bootstrap generated content changed before execution");
  return actualSha256;
}

function writeRecoveryBootstrapEvidence(evidence: RecoveryBootstrapEvidence, productionRestart: string): void {
  writeFileSync(resolve(dirname(realpathSync(productionRestart)), "recovery-bootstrap-evidence.json"), `${JSON.stringify(evidence)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

export function runRecoveryBootstrap(
  argv: readonly string[] = process.argv,
  runner: Runner = spawnSync,
  retainEvidence?: (evidence: RecoveryBootstrapEvidence) => void,
  source: NodeJS.ProcessEnv = process.env,
  paths: { productionRestart?: string; afterDirectoryOpen?: (path: string) => void; verifyStage?: typeof verifyRecoveryBuildStage } = {},
): number {
  if (argv.length !== 2) throw new Error("Recovery bootstrap accepts no arguments");
  verifyRecoveryBootstrapInvocation(argv[1]!, source[RECOVERY_BOOTSTRAP_SHA256]);
  const verifyStage = paths.verifyStage ?? verifyRecoveryBuildStage;
  const root = verifyStage(source);
  if (!paths.verifyStage && realpathSync(argv[1]!) !== resolve(root, "packages/ingenium-extension/dist/scripts/recovery-bootstrap.js")) {
    throw new Error("Recovery bootstrap executable is outside the private stage");
  }
  const productionRestart = paths.productionRestart
    ?? resolve(root, "packages/ingenium-extension/dist/scripts/production-restart.js");
  const npmConfiguration = privateNpmConfiguration();
  try {
    const options = {
      cwd: root,
      env: recoveryBootstrapCheckEnvironment(npmConfiguration, source),
      shell: false as const,
      stdio: "inherit" as const,
      timeout: RECOVERY_BOOTSTRAP_CHECK_TIMEOUT_MS,
    };
    for (const [index, [command, commandArgv]] of RECOVERY_BOOTSTRAP_CHECKS.entries()) {
      if (verifyStage(source) !== root) throw new Error("Recovery private stage identity changed");
      const result = runner(command, commandArgv, options);
      const status = completedStatus(result, "check", index + 1);
      if (status !== 0) return status;
    }
    if (verifyStage(source) !== root) throw new Error("Recovery private stage identity changed");
    hardenGeneratedBootstrapDirectories(root, paths.afterDirectoryOpen);
    const canonicalProductionRestart = normalizeGeneratedRecoveryExecutable(productionRestart);
    if (canonicalProductionRestart !== productionRestart) throw new Error("Production restart path is not canonical");
    const retain = retainEvidence ?? ((evidence: RecoveryBootstrapEvidence) =>
      writeRecoveryBootstrapEvidence(evidence, canonicalProductionRestart));
    const productionRestartScriptSha256 = createHash("sha256").update(readFileSync(canonicalProductionRestart)).digest("hex");
    const evidence: RecoveryBootstrapEvidence = {
      schemaVersion: 1,
      checks: RECOVERY_BOOTSTRAP_CHECKS.map((_, index) => ({
        index: index + 1,
        result: "passed",
        timeoutMs: RECOVERY_BOOTSTRAP_CHECK_TIMEOUT_MS,
      })),
      productionRestart: { result: "pending", timeoutMs: RECOVERY_BOOTSTRAP_RESTART_TIMEOUT_MS },
      productionRestartScriptSha256,
    };
    retain(evidence);
    const result = runner(process.execPath, [canonicalProductionRestart], {
      ...options,
      env: recoveryBootstrapRestartEnvironment(productionRestartScriptSha256, npmConfiguration, source),
      timeout: RECOVERY_BOOTSTRAP_RESTART_TIMEOUT_MS,
    });
    let status: number;
    try {
      status = completedStatus(result, "restart");
    } catch (error) {
      evidence.productionRestart.result = error instanceof RecoveryBootstrapTimeoutError ? "timed_out" : "failed";
      retain(evidence);
      throw error;
    }
    evidence.productionRestart.result = status === 0 ? "passed" : "failed";
    retain(evidence);
    return status;
  } finally {
    npmConfiguration.cleanup();
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(realpathSync(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) process.exitCode = runRecoveryBootstrap();
