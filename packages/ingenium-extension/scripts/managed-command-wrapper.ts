#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  decodeReplacementFirstRestartRequest,
  runReplacementFirstRestart,
  type ReplacementFirstRestartDependencies,
  type ReplacementFirstRestartResult,
} from "../replacement-first-restart.js";

const ARG = /^[A-Za-z0-9_@%+=:,./-]{1,512}$/;
const BUILD_SCRIPTS = new Set(["build", "typecheck", "test", "lint"]);
const EXTENSION_TEST_FILES = new Set(["managed-command-wrapper.test.ts", "session-coordinator.test.ts"]);
const DEPLOYMENT_OPERATIONS = new Set(["mcp-status", "compose-ps", "compose-build", "compose-up", "compose-restart", "health", "production-restart"]);
const GIT = "/usr/bin/git";
const RUNTIME_BIN = dirname(process.execPath);
const NPM = `${RUNTIME_BIN}/npm`;
const OPENCODE = "/usr/local/bin/opencode";
const DOCKER = "/usr/bin/docker";
const CURL = "/usr/bin/curl";
const PRODUCTION_RESTART = resolve(dirname(fileURLToPath(import.meta.url)), "production-restart.js");
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
const EXECUTABLE_GIT_CONFIGURATION = /^(?:core\.(?:askPass|editor|fsmonitor|gitproxy|hooksPath|pager|sshCommand)|credential\..*helper|diff\..*\.(?:command|textconv)|filter\..*\.(?:clean|process|smudge)|gpg(?:\..*)?\.program|interactive\.diffFilter|merge\..*\.driver|sequence\.editor)$/i;

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
  if (operation === "commit") {
    if (paths.length !== 1 || !isSafeCommitMessage(paths[0]!)) {
      throw new Error("Repository wrapper rejected the command");
    }
    return argv;
  }
  const validPaths = paths.length > 0 && paths.length <= 32
    && paths.every((path) => ARG.test(path) && isSafeRepositoryPath(path));
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

export function managedBuildExecution(argv: string[]): { command: string; argv: string[] } {
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
      return { command: process.execPath, argv: [PRODUCTION_RESTART] };
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

export function managedRepositoryArgv(argv: string[]): string[] {
  const [operation, ...paths] = validateManagedRepositoryArgv(argv);
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
  const env = Object.fromEntries(Object.entries(source).filter(([key]) => !key.startsWith("GIT_") && key !== "SSH_ASKPASS"));
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

function assertNonExecutableGitConfiguration(cwd: string, env: NodeJS.ProcessEnv): void {
  const configuration = execFileSync(GIT, ["-C", cwd, "config", "--null", "--list", "--includes"], {
    encoding: "utf8", timeout: 10_000, maxBuffer: 1024 * 1024, env,
  });
  if (configuration.split("\0").some((entry) => EXECUTABLE_GIT_CONFIGURATION.test(entry.slice(0, entry.indexOf("\n"))))) {
    throw new Error("Repository wrapper rejected executable Git configuration");
  }
}

export function managedCommand(kind: "repository" | "build", argv: string[], cwd = process.cwd()): number {
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
    env = managedBuildEnvironment();
  }
  const before = kind === "build" ? sourceFingerprint(cwd) : undefined;
  const result = spawnSync(command, commandArgv, { cwd, stdio: "inherit", shell: false, env });
  if (result.error) throw result.error;
  if (kind === "build" && sourceFingerprint(cwd) !== before) throw new Error("Build wrapper produced source changes");
  return result.status ?? 1;
}

export function runManagedCommandCli(kind: "repository" | "build", argv = process.argv): void {
  if (argv.length !== 3) throw new Error("Managed wrapper requires one encoded argv payload");
  const commandArgv = kind === "repository"
    ? decodeManagedRepositoryArgv(argv[2]!)
    : decodeManagedBuildArgv(argv[2]!);
  process.exitCode = managedCommand(kind, commandArgv);
}
