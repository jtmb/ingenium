#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import {
  closeSync,
  constants,
  fstatSync,
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
  const root = "/tmp/opencode";
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
  paths: { productionRestart?: string } = {},
): number {
  if (argv.length !== 2) throw new Error("Recovery bootstrap accepts no arguments");
  verifyRecoveryBootstrapInvocation(argv[1]!, source[RECOVERY_BOOTSTRAP_SHA256]);
  const root = recoveryBootstrapCanonicalWorktree(source);
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
      const result = runner(command, commandArgv, options);
      const status = completedStatus(result, "check", index + 1);
      if (status !== 0) return status;
    }
    const canonicalProductionRestart = realpathSync(productionRestart);
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
