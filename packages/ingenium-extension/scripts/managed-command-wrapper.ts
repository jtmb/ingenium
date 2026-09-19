#!/usr/bin/env node
import { createHash, randomBytes } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmdirSync,
  unlinkSync,
} from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { userInfo } from "node:os";
import {
  decodeReplacementFirstRestartRequest,
  runReplacementFirstRestart,
  type ReplacementFirstRestartDependencies,
  type ReplacementFirstRestartResult,
} from "../replacement-first-restart.js";

const ARG = /^[A-Za-z0-9_@%+=:,./-]{1,512}$/;
const BUILD_SCRIPTS = new Set(["build", "typecheck", "test", "lint"]);
const EXTENSION_TEST_FILES = new Set([
  "agent-validation.test.ts",
  "coordination-outbox.test.ts",
  "managed-command-wrapper.test.ts",
  "session-id-tui.test.ts",
]);
const DEPLOYMENT_OPERATIONS = new Set(["mcp-status", "compose-ps", "compose-build", "compose-up", "compose-restart", "health", "production-restart", "recovery-preflight", "recovery-prepare"]);
const IMAGE_REVISION_OPERATIONS = new Set(["compose-build", "compose-up", "compose-restart"]);
const REPOSITORY_INSPECTIONS = new Set(["status", "staged-paths", "recent-log", "head"]);
const REPOSITORY_PATH_INSPECTIONS = new Set(["diff", "staged-diff"]);
const REPOSITORY_RETIREMENT = new Set(["retirement-status", "archive", "restore-archive"]);
const RETIREMENT_RECORDS = ["coordination-outbox", "coordination-outbox-dispositions", "coordination-outbox-authorizations", "production-restart", "tui-recovery"] as const;
const GIT = "/usr/bin/git";
const RUNTIME_BIN = dirname(process.execPath);
const NPM = `${RUNTIME_BIN}/npm`;
const OPENCODE = "/usr/local/bin/opencode";
const DOCKER = "/usr/bin/docker";
const CURL = "/usr/bin/curl";
const MANAGED_COMMAND_NONCE = "INGENIUM_MANAGED_COMMAND_NONCE";
const RECOVERY_ATTESTED_CONTEXT = "INGENIUM_RECOVERY_ATTESTED_CONTEXT";
const RECOVERY_PREFLIGHT = "INGENIUM_RECOVERY_PREFLIGHT";
const RECOVERY_BOOTSTRAP_MAX_BYTES = 256 * 1024;
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
// Covers the trusted source build, generated checks/restart, and both cleanup grace periods.
export const MANAGED_RECOVERY_BOOTSTRAP_TIMEOUT_MS = 1_680_000;
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

// Kept self-contained so the installer can put the same pre-import verifier in the launcher.
export function verifyPrivateBuildRelease(release: string, home = userInfo().homedir, verifyLaunchers = true) {
  const owner = process.getuid!();
  const launcherEntries = {
    "ingenium-build": "dist/scripts/build-command.js",
    "ingenium-opencode": "dist/scripts/opencode.js",
  } as const;
  const exact = (value: unknown, keys: string[]): value is Record<string, any> =>
    value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
  const fail = (): never => { throw new Error("Private build release failed trust validation"); };
  const stable = (path: string, mode?: number, expectedOwner = owner) => {
    if (realpathSync(path) !== path) fail();
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const before = fstatSync(fd);
      if (!before.isFile() || before.uid !== expectedOwner || before.nlink !== 1
        || (before.mode & 0o7022) !== 0 || (mode !== undefined && (before.mode & 0o7777) !== mode)) fail();
      const bytes = readFileSync(fd);
      for (const after of [fstatSync(fd), lstatSync(path)]) {
        if (!after.isFile() || ["dev", "ino", "uid", "mode", "nlink", "size", "mtimeMs", "ctimeMs"].some(
          (key) => before[key as keyof typeof before] !== after[key as keyof typeof after])) fail();
      }
      if (realpathSync(path) !== path) fail();
      return { bytes, sha256: createHash("sha256").update(bytes).digest("hex"), stat: before };
    } finally { closeSync(fd); }
  };
  const base = resolve(home, ".local/share/ingenium/host-build/releases");
  if (resolve(release) !== release || dirname(release) !== base || !/^[0-9a-f]{40}$/.test(basename(release))) fail();
  for (let path = release; ; path = dirname(path)) {
    const stat = lstatSync(path);
    if (!stat.isDirectory() || realpathSync(path) !== path || ![0, owner].includes(stat.uid)
      || ((stat.mode & 0o022) !== 0 && !(stat.uid === 0 && (stat.mode & 0o1000)))
      || (path.startsWith(resolve(home, ".local/share/ingenium")) && (stat.uid !== owner || (stat.mode & 0o7777) !== 0o700))) fail();
    if (path === dirname(path)) break;
  }
  const manifest = JSON.parse(stable(resolve(release, "release.json"), 0o400).bytes.toString());
  const files = ["package.json", "context-upload-codec.mjs", "dist/replacement-first-restart.js",
    "dist/scripts/build-command.js", "dist/scripts/managed-command-wrapper.js", "dist/scripts/opencode.js"];
  if (!exact(manifest, ["schemaVersion", "head", "repositoryRoot", "owner", "node", "sourceSha256", "files", "launchers"])
    || manifest.schemaVersion !== 1 || manifest.owner !== owner || manifest.head !== basename(release)
    || typeof manifest.repositoryRoot !== "string" || resolve(manifest.repositoryRoot) !== manifest.repositoryRoot
    || realpathSync(manifest.repositoryRoot) !== manifest.repositoryRoot
    || !/^[0-9a-f]{64}$/.test(manifest.sourceSha256) || !exact(manifest.files, files)
    || !exact(manifest.launchers, Object.keys(launcherEntries))
    || !exact(manifest.node, ["path", "sha256", "dev", "ino", "uid", "mode", "nlink"])) fail();
  const nodePath = realpathSync(process.execPath);
  if (manifest.node.path !== nodePath || ![0, owner].includes(manifest.node.uid)) fail();
  for (let path = dirname(nodePath); ; path = dirname(path)) {
    const stat = lstatSync(path);
    if (!stat.isDirectory() || realpathSync(path) !== path || ![0, owner].includes(stat.uid)
      || (stat.mode & 0o7022) !== 0 || path === manifest.repositoryRoot || path.startsWith(`${manifest.repositoryRoot}/`)) fail();
    if (path === dirname(path)) break;
  }
  const node = stable(nodePath, undefined, manifest.node.uid);
  if (!(node.stat.mode & 0o111) || node.sha256 !== manifest.node.sha256
    || ["dev", "ino", "uid", "mode", "nlink"].some((key) => node.stat[key as keyof typeof node.stat] !== manifest.node[key])) fail();
  const walk = (path: string, prefix = "") => {
    for (const name of readdirSync(path)) {
      const entry = resolve(path, name);
      const relative = prefix + name;
      const stat = lstatSync(entry);
      if (stat.isDirectory()) {
        if (!["dist", "dist/scripts"].includes(relative) || stat.uid !== owner || (stat.mode & 0o7777) !== 0o700
          || realpathSync(entry) !== entry) fail();
        walk(entry, `${relative}/`);
      } else if (relative !== "release.json" && !files.includes(relative)) fail();
    }
  };
  walk(release);
  for (const file of files) {
    const expected = manifest.files[file];
    if (!exact(expected, ["sha256", "mode"]) || expected.mode !== 0o400 || !/^[0-9a-f]{64}$/.test(expected.sha256)
      || stable(resolve(release, file), 0o400).sha256 !== expected.sha256) fail();
  }
  for (const [name, entry] of Object.entries(launcherEntries)) {
    const expected = manifest.launchers[name];
    if (!exact(expected, ["sha256", "mode", "entry"]) || expected.mode !== 0o500 || expected.entry !== entry
      || !/^[0-9a-f]{64}$/.test(expected.sha256)
      || (verifyLaunchers && stable(resolve(home, ".local/bin", name), 0o500).sha256 !== expected.sha256)) fail();
  }
  if (JSON.parse(stable(resolve(release, "package.json"), 0o400).bytes.toString()).type !== "module") fail();
  const git = (args: string[]) => execFileSync("/usr/bin/git", ["--no-optional-locks", "-C", manifest.repositoryRoot,
    "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", ...args], {
    encoding: "utf8", timeout: 10_000,
    env: { PATH: "/usr/bin:/bin", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" },
  }).trim();
  if (git(["rev-parse", "--show-toplevel"]) !== manifest.repositoryRoot || git(["rev-parse", "--verify", "HEAD"]) !== manifest.head) fail();
  return manifest;
}

export function managedWrapperPackageRoot(moduleUrl: string | URL = import.meta.url): string {
  const wrapper = realpathSync(fileURLToPath(moduleUrl));
  const scriptsDirectory = dirname(wrapper);
  const built = basename(dirname(scriptsDirectory)) === "dist";
  if (basename(scriptsDirectory) !== "scripts"
    || basename(wrapper) !== `managed-command-wrapper.${built ? "js" : "ts"}`) {
    throw new Error("Managed wrapper is outside its fixed source or distribution layout");
  }
  const packageRoot = realpathSync(resolve(scriptsDirectory, built ? "../.." : ".."));
  if (built && basename(dirname(packageRoot)) === "releases") {
    verifyPrivateBuildRelease(packageRoot);
    return packageRoot;
  }
  if (basename(packageRoot) !== "ingenium-extension" || basename(dirname(packageRoot)) !== "packages") {
    throw new Error("Managed wrapper is outside packages/ingenium-extension");
  }
  return packageRoot;
}

export function managedRecoveryWorktree(moduleUrl: string | URL = import.meta.url): string {
  const packageRoot = managedWrapperPackageRoot(moduleUrl);
  if (basename(dirname(packageRoot)) === "releases") return verifyPrivateBuildRelease(packageRoot).repositoryRoot;
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
  return resolve(managedRecoveryWorktree(moduleUrl), "packages/ingenium-extension/scripts/recovery-bootstrap.js");
}

export interface VerifiedRecoveryBootstrap {
  descriptor: number;
  bytes: Buffer;
  context: Readonly<{
    schemaVersion: 1;
    kind: "source-bootstrap";
    sourcePath: string;
    repositoryRoot: string;
    head: string;
    sourceSha256: string;
  }>;
}

function readBoundedFileDescriptor(descriptor: number, size: number): Buffer {
  if (!Number.isSafeInteger(size) || size < 1 || size > RECOVERY_BOOTSTRAP_MAX_BYTES) {
    throw new Error("Managed recovery bootstrap is not trusted");
  }
  const bytes = Buffer.allocUnsafe(size);
  let offset = 0;
  while (offset < bytes.length) {
    const count = readSync(descriptor, bytes, offset, bytes.length - offset, offset);
    if (count === 0) break;
    offset += count;
  }
  if (offset !== size) throw new Error("Managed recovery bootstrap is not trusted");
  return bytes;
}

export function openVerifiedRecoveryBootstrap(
  sourcePath: string,
  repositoryRoot: string,
  afterOpen?: (sourcePath: string) => void,
): VerifiedRecoveryBootstrap {
  const root = realpathSync(resolve(repositoryRoot));
  const source = resolve(sourcePath);
  const relativePath = relative(root, source).replaceAll("\\", "/");
  if (relativePath !== "packages/ingenium-extension/scripts/recovery-bootstrap.js" || realpathSync(source) !== source) {
    throw new Error("Managed recovery bootstrap path is not canonical");
  }
  const env = managedGitEnvironment();
  assertNonExecutableGitConfiguration(root, env);
  const topLevel = execFileSync(GIT, ["-C", root, ...GIT_CONFIGURATION, "rev-parse", "--show-toplevel"], {
    encoding: "utf8", timeout: 10_000, maxBuffer: 1024 * 1024, env,
  }).trim();
  const head = execFileSync(GIT, ["-C", root, ...GIT_CONFIGURATION, "rev-parse", "--verify", "HEAD"], {
    encoding: "utf8", timeout: 10_000, maxBuffer: 1024 * 1024, env,
  }).trim();
  if (topLevel !== root || !/^[0-9a-f]{40,64}$/.test(head)) throw new Error("Managed recovery bootstrap is not trusted");
  const reviewed = execFileSync(GIT, ["-C", root, ...GIT_CONFIGURATION, "show", `${head}:${relativePath}`], {
    encoding: "buffer", timeout: 10_000, maxBuffer: 1024 * 1024, env,
  });
  execFileSync(GIT, ["-C", root, ...GIT_CONFIGURATION, "diff", "--quiet", "HEAD", "--", relativePath], {
    timeout: 10_000, env,
  });
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  let descriptor: number | undefined;
  try {
    descriptor = openSync(source, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.nlink !== 1 || (uid !== undefined && opened.uid !== uid)
      || (opened.mode & 0o7777) !== 0o644 || opened.size !== reviewed.length
      || opened.size < 1 || opened.size > RECOVERY_BOOTSTRAP_MAX_BYTES) {
      throw new Error("Managed recovery bootstrap is not trusted");
    }
    afterOpen?.(source);
    const bytes = readBoundedFileDescriptor(descriptor, opened.size);
    const after = fstatSync(descriptor);
    const current = lstatSync(source);
    if (!bytes.equals(reviewed) || !after.isFile() || after.nlink !== 1 || after.dev !== opened.dev
      || after.ino !== opened.ino || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs
      || after.ctimeMs !== opened.ctimeMs || !current.isFile() || current.isSymbolicLink()
      || current.nlink !== 1 || current.dev !== opened.dev || current.ino !== opened.ino
      || current.size !== opened.size || current.mtimeMs !== opened.mtimeMs || current.ctimeMs !== opened.ctimeMs
      || realpathSync(source) !== source || (current.mode & 0o7777) !== 0o644 || (uid !== undefined && current.uid !== uid)) {
      throw new Error("Managed recovery bootstrap is not trusted");
    }
    return {
      descriptor,
      bytes,
      context: Object.freeze({
        schemaVersion: 1,
        kind: "source-bootstrap",
        sourcePath: source,
        repositoryRoot: root,
        head,
        sourceSha256: createHash("sha256").update(bytes).digest("hex"),
      }),
    };
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    throw error;
  }
}

export function normalizeManagedRecoveryBootstrapMode(sourcePath: string, repositoryRoot: string): string {
  const verified = openVerifiedRecoveryBootstrap(sourcePath, repositoryRoot);
  closeSync(verified.descriptor);
  return verified.context.sourcePath;
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
  const argv = validateManagedBuildArgv(decodeManagedArgv(encoded));
  if (argv[0] === "deployment" && ["recovery-preflight", "recovery-prepare"].includes(argv[1]!)) {
    throw new Error("Recovery operations require the exact literal command");
  }
  return argv;
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

function managedImageRevision(cwd: string): string {
  const env = managedGitEnvironment();
  assertNonExecutableGitConfiguration(cwd, env);
  return execFileSync(GIT, ["-C", cwd, ...managedRepositoryArgv(["head"])], {
    encoding: "utf8", timeout: 10_000, maxBuffer: 1024 * 1024, env,
  }).trim();
}

function validatedImageRevision(value: unknown): string {
  if (typeof value !== "string" || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value)) {
    throw new Error("Managed build Git HEAD is invalid");
  }
  return value;
}

function isSafeRepositoryPath(value: string): boolean {
  return value.length <= 1024 && value === value.trim() && !value.startsWith("/") && !value.startsWith("~")
    && !value.startsWith("-") && !value.includes("\\") && !/[\u0000-\u001f\u007f]/.test(value)
    && value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== ".." && segment !== ".git");
}

export function validateManagedRepositoryArgv(argv: string[]): string[] {
  const [operation, ...paths] = argv;
  if (paths.length === 0 && REPOSITORY_INSPECTIONS.has(operation!)) return argv;
  if (paths.length === 0 && REPOSITORY_RETIREMENT.has(operation!)) return argv;
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
    case "recovery-prepare":
      return { command: process.execPath, argv: [managedRecoveryBootstrapPath(moduleUrl), "recovery-prepare"] };
    case "recovery-preflight":
      return { command: process.execPath, argv: [managedRecoveryBootstrapPath(moduleUrl), "recovery-preflight"] };
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
    ...Object.fromEntries(RECOVERY_ENVIRONMENT.flatMap((name) =>
      source[name] === undefined || source[name] === "" ? [] : [[name, source[name]!]])),
    INGENIUM_WORKTREE: managedRecoveryWorktree(moduleUrl),
    PATH: `${RUNTIME_BIN}:/usr/local/bin:/usr/bin:/bin`,
  };
}

export function runManagedRecoveryBootstrap(
  moduleUrl: string | URL = import.meta.url,
  dependencies: {
    runner?: typeof spawnSync;
    openBootstrap?: typeof openVerifiedRecoveryBootstrap;
    preflight?: boolean;
    preparation?: boolean;
  } = {},
): number {
  if (dependencies.preflight && dependencies.preparation) throw new Error("Managed recovery mode is ambiguous");
  const worktree = managedRecoveryWorktree(moduleUrl);
  const verified = (dependencies.openBootstrap ?? openVerifiedRecoveryBootstrap)(
    managedRecoveryBootstrapPath(moduleUrl),
    worktree,
  );
  try {
    const packageRoot = managedWrapperPackageRoot(moduleUrl);
    if (basename(dirname(packageRoot)) === "releases") {
      const release = verifyPrivateBuildRelease(packageRoot);
      if (verified.context.head !== release.head || verified.context.sourceSha256 !== release.sourceSha256) {
        throw new Error("Private release bootstrap provenance changed");
      }
    }
    const result = (dependencies.runner ?? spawnSync)(process.execPath, ["--input-type=module"], {
      cwd: worktree,
      input: verified.bytes,
      stdio: ["pipe", "inherit", "inherit"],
      shell: false,
      env: {
        ...managedRecoveryEnvironment(process.env, moduleUrl),
        [RECOVERY_ATTESTED_CONTEXT]: JSON.stringify(verified.context),
        ...(dependencies.preflight ? { [RECOVERY_PREFLIGHT]: "1" } : {}),
        ...(dependencies.preparation ? { INGENIUM_RECOVERY_PREPARATION: "1" } : {}),
      },
    });
    if (result.error) throw result.error;
    if (result.signal) throw new Error(`Managed recovery bootstrap exited on ${result.signal}`);
    return result.status ?? 1;
  } finally {
    closeSync(verified.descriptor);
  }
}

export function managedRepositoryArgv(argv: string[]): string[] {
  const [operation, ...paths] = validateManagedRepositoryArgv(argv);
  if (REPOSITORY_RETIREMENT.has(operation!)) throw new Error("Retirement requires the fixed repository transaction");
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

export function runRepositoryRetirement(
  argv: string[],
  root: string,
  dependencies: { runner?: typeof spawnSync; temporaryDirectory?: string } = {},
) {
  validateManagedRepositoryArgv(argv);
  const operation = argv[0]!;
  if (!REPOSITORY_RETIREMENT.has(operation)) throw new Error("Invalid retirement operation");
  const present = (path: string): boolean => {
    try { lstatSync(path); return true; } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  };
  const owned = (path: string, directory: boolean) => {
    const stat = lstatSync(path);
    if (realpathSync(path) !== path || stat.isSymbolicLink()
      || (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1)
      || (typeof process.getuid === "function" && stat.uid !== process.getuid())) {
      throw new Error("Retirement path identity mismatch");
    }
    return stat;
  };
  owned(root, true);
  const common = resolve(root, ".git");
  owned(common, true);
  const temporary = dependencies.temporaryDirectory ?? "/tmp/opencode";
  owned(temporary, true);
  owned(resolve(root, ".opencode"), true);
  const readStable = (path: string, limit: number) => {
    const expected = owned(path, false);
    if (expected.size > limit) throw new Error("Retirement file limit exceeded");
    const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const bytes = Buffer.alloc(expected.size);
      let offset = 0;
      while (offset < bytes.length) {
        const count = readSync(descriptor, bytes, offset, bytes.length - offset, offset);
        if (!count) break;
        offset += count;
      }
      for (const current of [fstatSync(descriptor), owned(path, false)]) {
        if (offset !== bytes.length || current.dev !== expected.dev || current.ino !== expected.ino
          || current.size !== expected.size || current.mtimeMs !== expected.mtimeMs || current.ctimeMs !== expected.ctimeMs) {
          throw new Error("Retirement file changed during verification");
        }
      }
      return bytes;
    } finally { closeSync(descriptor); }
  };
  const metadata = (path: string) => {
    return readStable(path, 4096).toString("utf8").trim();
  };
  const candidates = [
    { source: resolve(root, ".opencode/protected-runtime-index"), archive: resolve(temporary, "ingenium-retired-protected-runtime-index"), registration: "protected-runtime-index", head: "1cd90d4998e4f8fffa4ab11941f2b4821b336847" },
    { source: resolve(temporary, "ingenium-deploy-6991061"), archive: resolve(temporary, "ingenium-retired-deploy-6991061"), registration: "ingenium-deploy-6991061", head: "6991061533e0830b4dccb6a9987eece6448e6e10" },
  ];
  const git = (args: string[]): string => {
    const result = (dependencies.runner ?? spawnSync)(GIT, ["-C", root, ...GIT_CONFIGURATION, ...args], {
      encoding: "utf8", shell: false, timeout: 10_000, maxBuffer: 1024 * 1024, env: managedGitEnvironment(),
    });
    if (result.error || result.signal || result.status !== 0) throw new Error("Retirement Git operation failed");
    return String(result.stdout).trim();
  };
  const records = (base: string) => {
    const hash = createHash("sha256");
    let count = 0;
    let bytes = 0;
    let locked = false;
    const walk = (path: string, name: string, depth: number) => {
      if (++count > 4096 || depth > 8) throw new Error("Retirement record limit exceeded");
      const stat = lstatSync(path);
      owned(path, stat.isDirectory());
      locked ||= name.endsWith(".lock");
      hash.update(name).update("\0");
      if (stat.isDirectory()) {
        hash.update("directory\0");
        for (const child of readdirSync(path).sort()) walk(resolve(path, child), `${name}/${child}`, depth + 1);
      } else {
        bytes += stat.size;
        if (stat.size > 1024 * 1024 || bytes > 64 * 1024 * 1024) throw new Error("Retirement record limit exceeded");
        hash.update(createHash("sha256").update(readStable(path, 1024 * 1024)).digest());
      }
    };
    for (const name of [...RETIREMENT_RECORDS, "coordination-outbox-mutation.lock"]) {
      if (present(resolve(base, name))) walk(resolve(base, name), name, 0);
    }
    return { count, sha256: hash.digest("hex"), locked };
  };
  const inspect = () => candidates.map((candidate, index) => {
    const registration = resolve(common, "worktrees", candidate.registration);
    const source = present(candidate.source);
    const archive = present(candidate.archive);
    const sourceCheckout = present(resolve(candidate.source, ".git"));
    const location = sourceCheckout ? candidate.source : archive ? candidate.archive : undefined;
    let head: string | null = null;
    let linked = false;
    let locked = false;
    try {
      owned(registration, true);
      const rawHead = metadata(resolve(registration, "HEAD"));
      head = /^[0-9a-f]{40}$/.test(rawHead) ? rawHead : null;
      locked = ["locked", "index.lock", "HEAD.lock"].some((name) => present(resolve(registration, name)))
        || ["index.lock", "HEAD.lock", "config.lock"].some((name) => present(resolve(common, name)));
      if (location) {
        owned(location, true);
        linked = metadata(resolve(location, ".git")) === `gitdir: ${registration}`
          && metadata(resolve(registration, "gitdir")) === resolve(location, ".git")
          && realpathSync(resolve(registration, metadata(resolve(registration, "commondir")))) === common;
      }
    } catch { linked = false; }
    let recordState = { count: 0, sha256: "", locked: false };
    let archivedRecords: ReturnType<typeof records> | undefined;
    let validRecords = true;
    try {
      if (index === 0 && source) owned(candidate.source, true);
      recordState = records(index === 0 ? candidate.source : resolve(location ?? candidate.source, ".opencode/protected-runtime-index"));
      archivedRecords = index === 0 && archive ? records(candidate.archive) : undefined;
    } catch { validRecords = false; }
    const state = linked && head === candidate.head && !locked && validRecords
      ? sourceCheckout && !archive ? "original"
        : !sourceCheckout && archive && (index === 0 ? source && archivedRecords?.count === 0 : !source) ? "archived" : "partial"
      : "partial";
    return { source, archive, registration: linked, head, locked: locked || recordState.locked || !!archivedRecords?.locked,
      records: { ...recordState, valid: validRecords }, archiveRecords: archivedRecords ?? null, state };
  });
  const lockPath = resolve(common, "ingenium-retirement.lock");
  if (operation === "retirement-status") return inspect().map((entry) => ({ ...entry, locked: entry.locked || present(lockPath) }));
  const lock = openSync(lockPath, "wx", 0o600);
  const undo: Array<() => void> = [];
  let before: ReturnType<typeof inspect> | undefined;
  try {
    before = inspect();
    const expected = operation === "archive" ? "original" : "archived";
    if (before.some((entry) => entry.state !== expected || entry.locked)) throw new Error("Retirement candidate verification failed");
    for (const candidate of candidates) {
      if (git(["rev-parse", "--verify", `${candidate.head}^{commit}`]) !== candidate.head) {
        throw new Error("Retirement HEAD object verification failed");
      }
    }
    const move = (from: string, to: string, worktree: boolean) => {
      if (present(to)) throw new Error("Retirement destination exists");
      const restore = () => {
        if (present(from)) throw new Error("Retirement rollback destination exists");
        if (worktree) git(["worktree", "move", "--", to, from]);
        else renameSync(to, from);
      };
      try {
        if (worktree) git(["worktree", "move", "--", from, to]);
        else renameSync(from, to);
      } catch (error) {
        // A timed-out Git move may already have relocated the checkout.
        if (!present(from) && present(to)) undo.push(restore);
        throw error;
      }
      undo.push(restore);
    };
    const runtime = candidates[0]!;
    if (operation === "archive") {
      move(runtime.source, runtime.archive, true);
      mkdirSync(runtime.source, { mode: 0o700 });
      undo.push(() => rmdirSync(runtime.source));
      for (const name of RETIREMENT_RECORDS) {
        if (present(resolve(runtime.archive, name))) move(resolve(runtime.archive, name), resolve(runtime.source, name), false);
      }
      move(candidates[1]!.source, candidates[1]!.archive, true);
    } else {
      move(candidates[1]!.archive, candidates[1]!.source, true);
      for (const name of RETIREMENT_RECORDS) {
        if (present(resolve(runtime.source, name))) move(resolve(runtime.source, name), resolve(runtime.archive, name), false);
      }
      rmdirSync(runtime.source);
      undo.push(() => mkdirSync(runtime.source, { mode: 0o700 }));
      move(runtime.archive, runtime.source, true);
    }
    const after = inspect();
    if (after.some((entry, index) => entry.state !== (operation === "archive" ? "archived" : "original")
      || entry.locked || entry.records.sha256 !== before![index]!.records.sha256)) {
      throw new Error("Retirement post-move verification failed");
    }
    return after;
  } catch (error) {
    const failures: unknown[] = [error];
    for (const restore of undo.reverse()) {
      try { restore(); } catch (failure) { failures.push(failure); }
    }
    if (before && undo.length > 0) {
      try {
        if (JSON.stringify(inspect()) !== JSON.stringify(before)) throw new Error("Retirement rollback verification failed");
      } catch (failure) { failures.push(failure); }
    }
    throw new AggregateError(failures, failures.length > 1 ? "Retirement rollback incomplete" : "Retirement failed; moves restored");
  } finally {
    closeSync(lock);
    unlinkSync(lockPath);
  }
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
    openRecoveryBootstrap?: typeof openVerifiedRecoveryBootstrap;
    readImageRevision?: typeof managedImageRevision;
  } = {},
): number {
  if (kind === "build" && argv[0] === "deployment"
    && ["recovery-preflight", "recovery-prepare"].includes(argv[1]!)) {
    validateManagedBuildArgv(argv);
    if (realpathSync(cwd) !== managedRecoveryWorktree()) throw new Error("Recovery operation requires the canonical repository");
    return runManagedRecoveryBootstrap(import.meta.url, {
      runner: dependencies.runner,
      openBootstrap: dependencies.openRecoveryBootstrap,
      ...(argv[1] === "recovery-preflight" ? { preflight: true } : { preparation: true }),
    });
  }
  const productionRestart = kind === "build" && argv[0] === "deployment" && argv[1] === "production-restart";
  const requiresImageRevision = kind === "build" && argv[0] === "deployment" && IMAGE_REVISION_OPERATIONS.has(argv[1]!);
  let command: string;
  let commandArgv: string[];
  let env: NodeJS.ProcessEnv | undefined;
  if (kind === "repository") {
    validateManagedRepositoryArgv(argv);
    env = managedGitEnvironment();
    assertNonExecutableGitConfiguration(cwd, env);
    if (REPOSITORY_RETIREMENT.has(argv[0]!)) {
      if (realpathSync(cwd) !== managedRecoveryWorktree()) throw new Error("Retirement requires the canonical repository");
      console.log(JSON.stringify(runRepositoryRetirement(argv, realpathSync(cwd), { runner: dependencies.runner })));
      return 0;
    }
    command = GIT;
    commandArgv = ["-C", cwd, ...managedRepositoryArgv(argv)];
  } else {
    const execution = managedBuildExecution(argv);
    command = execution.command;
    commandArgv = productionRestart ? ["--input-type=module"] : execution.argv;
    env = productionRestart ? managedRecoveryEnvironment() : {
      ...managedBuildEnvironment(),
      ...(requiresImageRevision ? {
        IMAGE_REVISION: validatedImageRevision((dependencies.readImageRevision ?? managedImageRevision)(cwd)),
      } : {}),
    };
  }
  const before = kind === "build" ? sourceFingerprint(cwd) : undefined;
  const detached = productionRestart && process.platform !== "win32";
  const managedNonce = productionRestart ? randomBytes(32).toString("base64url") : undefined;
  const timedOutProcessAttestation = productionRestart ? {
    nonce: managedNonce!,
    executableSha256: createHash("sha256").update(readFileSync(realpathSync(process.execPath))).digest("hex"),
  } : undefined;
  const verified = productionRestart
    ? (dependencies.openRecoveryBootstrap ?? openVerifiedRecoveryBootstrap)(managedRecoveryBootstrapPath(), cwd)
    : undefined;
  let result: ReturnType<typeof spawnSync>;
  try {
    result = (dependencies.runner ?? spawnSync)(command, commandArgv, {
      cwd,
      ...(verified ? { input: verified.bytes, stdio: ["pipe", "inherit", "inherit"] as const } : { stdio: "inherit" as const }),
      shell: false,
      env: {
        ...env,
        ...(managedNonce ? { [MANAGED_COMMAND_NONCE]: managedNonce } : {}),
        ...(verified ? { [RECOVERY_ATTESTED_CONTEXT]: JSON.stringify(verified.context) } : {}),
      },
      ...(productionRestart ? { timeout: MANAGED_RECOVERY_BOOTSTRAP_TIMEOUT_MS, killSignal: "SIGTERM", detached } : {}),
    });
  } finally {
    if (verified) closeSync(verified.descriptor);
  }
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

export function runManagedCommandCli(
  kind: "repository" | "build",
  argv = process.argv,
  dependencies: {
    runRecoveryBootstrap?: typeof runManagedRecoveryBootstrap;
    runCommand?: typeof managedCommand;
  } = {},
): void {
  const packageRoot = managedWrapperPackageRoot();
  if (basename(dirname(packageRoot)) === "releases" && realpathSync(process.cwd()) !== managedRecoveryWorktree()) {
    throw new Error("Private build launcher requires its canonical worktree");
  }
  const fixedProductionRestart = kind === "build" && argv.length === 4
    && argv[2] === "deployment" && argv[3] === "production-restart";
  const fixedPreparation = kind === "build" && argv.length === 4
    && argv[2] === "deployment" && argv[3] === "recovery-prepare";
  const fixedPreflight = kind === "build" && argv.length === 4
    && argv[2] === "deployment" && argv[3] === "recovery-preflight";
  if (!fixedProductionRestart && !fixedPreparation && !fixedPreflight && argv.length !== 3) {
    throw new Error("Managed wrapper requires one encoded argv payload");
  }
  if (fixedPreflight) {
    process.exitCode = (dependencies.runRecoveryBootstrap ?? runManagedRecoveryBootstrap)(import.meta.url, { preflight: true });
    return;
  }
  if (fixedPreparation) {
    process.exitCode = (dependencies.runRecoveryBootstrap ?? runManagedRecoveryBootstrap)(import.meta.url, { preparation: true });
    return;
  }
  const commandArgv = fixedProductionRestart
    ? validateManagedBuildArgv(argv.slice(2))
    : kind === "repository"
      ? decodeManagedRepositoryArgv(argv[2]!)
      : decodeManagedBuildArgv(argv[2]!);
  if (kind === "build" && commandArgv.length === 2
    && commandArgv[0] === "deployment" && commandArgv[1] === "production-restart") {
    process.exitCode = (dependencies.runRecoveryBootstrap ?? runManagedRecoveryBootstrap)();
    return;
  }
  process.exitCode = (dependencies.runCommand ?? managedCommand)(kind, commandArgv);
}
