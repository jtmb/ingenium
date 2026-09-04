#!/usr/bin/env node
import { createHash, randomBytes } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
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
  readdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const BUILD_TIMEOUT_MS = 300_000;
const CLEANUP_GRACE_MS = 5_000;
const GENERATED_TIMEOUT_GRACE_MS = 30_000;
const MAX_TIMER_MS = 2_147_483_647;
const CHILD_NONCE = "INGENIUM_RECOVERY_SHIM_CHILD_NONCE";
const CANONICAL_WORKTREE = "INGENIUM_RECOVERY_CANONICAL_WORKTREE";
const GENERATED_BOOTSTRAP_SHA256 = "INGENIUM_RECOVERY_GENERATED_BOOTSTRAP_SHA256";
const GIT = "/usr/bin/git";
export const CANONICAL_DIRECTORY_AUDIT_PATH = "/tmp/opencode/recovery-bootstrap-directory-audit.jsonl";
export const CANONICAL_DIRECTORY_ROLES = Object.freeze([
  "repository_root",
  "packages_root",
  "extension_root",
  "scripts_root",
]);
const CHECKPOINT_PATHS = [
  "opencode.json",
  "package.json",
  "package-lock.json",
  "tsconfig.base.json",
  ".opencode/agents/execution/ingenium-recovery-engineer.md",
  ".opencode/agents/primary/ingenium-orchestrator.md",
  "packages/ingenium-extension",
  "services/ingenium-server",
  "tests/test-agent-validation.sh",
];
const COMMON_ENVIRONMENT = ["CI", "FORCE_COLOR", "HOME", "NO_COLOR", "TERM", "TMPDIR"];
const BUILD_ENVIRONMENT = ["CI", "FORCE_COLOR", "NO_COLOR", "TERM", "TMPDIR"];
const EXECUTABLE_GIT_CONFIGURATION = /^(?:core\.(?:askPass|editor|fsmonitor|gitproxy|hooksPath|pager|sshCommand)|credential\..*helper|diff(?:\.external|\..*\.(?:command|textconv))|filter\..*\.(?:clean|process|smudge)|gpg(?:\..*)?\.program|interactive\.diffFilter|merge\..*\.driver|sequence\.editor)$/i;
const RECOVERY_ENVIRONMENT = [
  ...COMMON_ENVIRONMENT,
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
  "INGENIUM_WORKTREE",
];
const SIGNALS = ["SIGHUP", "SIGINT", "SIGTERM"];

export const CANONICAL_OWNED_DIRECTORY_FAILURE_REASONS = Object.freeze([
  "directory",
  "canonical",
  "owner",
  "writable",
]);

export class CanonicalOwnedDirectoryError extends Error {
  constructor(reason) {
    super(reason);
    this.name = "CanonicalOwnedDirectoryError";
    this.code = "CANONICAL_OWNED_DIRECTORY_INVALID";
    this.reason = reason;
  }
}

export const TRUSTED_REGULAR_FILE_FAILURE_REASONS = Object.freeze([
  "regular_file",
  "symlink",
  "link_count",
  "identity",
  "owner",
  "writable",
  "realpath",
  "executable",
  "mode",
]);

export class TrustedRegularFileError extends Error {
  constructor(label, reason) {
    super(`${label} failed trust validation: ${reason}`);
    this.name = "TrustedRegularFileError";
    this.code = "TRUSTED_REGULAR_FILE_INVALID";
    this.reason = reason;
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function ownerUid() {
  if (process.platform !== "linux" || typeof process.getuid !== "function") {
    throw new Error("Recovery bootstrap shim requires Linux process identity support");
  }
  return process.getuid();
}

function directoryIdentityMatches(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function directoryMode(stat) {
  return stat.mode & 0o7777;
}

function auditMode(mode) {
  return mode === undefined ? null : mode.toString(8).padStart(4, "0");
}

export function canonicalOwnedDirectory(path, _label, owner = ownerUid(), options = {}) {
  const canonical = resolve(path);
  const fileSystem = {
    closeSync,
    fchmodSync,
    fstatSync,
    fsyncSync,
    lstatSync,
    openSync,
    realpathSync,
    ...options.fileSystem,
  };
  let audited = false;
  let beforeMode;
  let afterMode;
  let result = "rejected";
  const retainAudit = () => {
    if (!options.retainAudit || audited) return;
    audited = true;
    options.retainAudit({
      role: options.auditRole,
      directoryPathSha256: sha256(canonical),
      beforeMode: auditMode(beforeMode),
      afterMode: auditMode(afterMode),
      result,
      timestamp: new Date().toISOString(),
    });
  };
  const fail = (reason) => {
    retainAudit();
    throw new CanonicalOwnedDirectoryError(reason);
  };
  if (options.retainAudit && !CANONICAL_DIRECTORY_ROLES.includes(options.auditRole)) fail("canonical");
  let reference;
  try {
    reference = fileSystem.lstatSync(canonical);
  } catch {
    fail("directory");
  }
  if (!reference.isDirectory() && !reference.isSymbolicLink()) fail("directory");
  if (reference.isSymbolicLink()) fail("canonical");
  let real;
  try {
    real = fileSystem.realpathSync(canonical);
  } catch {
    fail("canonical");
  }
  if (real !== canonical) fail("canonical");
  let descriptor;
  try {
    try {
      descriptor = fileSystem.openSync(canonical, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    } catch {
      fail("canonical");
    }
    const opened = fileSystem.fstatSync(descriptor);
    const current = fileSystem.lstatSync(canonical);
    beforeMode = directoryMode(opened);
    afterMode = beforeMode;
    if (!opened.isDirectory() || !current.isDirectory()) fail("directory");
    if (current.isSymbolicLink() || !directoryIdentityMatches(reference, opened)
      || !directoryIdentityMatches(opened, current) || directoryMode(reference) !== beforeMode
      || directoryMode(current) !== beforeMode) fail("canonical");
    if (reference.uid !== owner || opened.uid !== owner || current.uid !== owner) fail("owner");
    try {
      if (fileSystem.realpathSync(canonical) !== canonical) fail("canonical");
    } catch (error) {
      if (error instanceof CanonicalOwnedDirectoryError) throw error;
      fail("canonical");
    }
    if ((beforeMode & 0o022) === 0) {
      result = "validated";
      retainAudit();
      return canonical;
    }
    if (options.hardenWritablePath !== canonical) fail("writable");

    const hardenedMode = beforeMode & ~0o022;
    try {
      options.afterOpen?.(canonical);
      fileSystem.fchmodSync(descriptor, hardenedMode);
      fileSystem.fsyncSync(descriptor);
      const hardened = fileSystem.fstatSync(descriptor);
      const hardenedPath = fileSystem.lstatSync(canonical);
      afterMode = directoryMode(hardened);
      if (!hardened.isDirectory() || !hardenedPath.isDirectory()) fail("directory");
      if (hardenedPath.isSymbolicLink() || !directoryIdentityMatches(opened, hardened)
        || !directoryIdentityMatches(opened, hardenedPath)) fail("canonical");
      if (hardened.uid !== owner || hardenedPath.uid !== owner) fail("owner");
      if (directoryMode(hardenedPath) !== afterMode || afterMode !== hardenedMode
        || (afterMode & 0o022) !== 0) fail("writable");
      if (fileSystem.realpathSync(canonical) !== canonical) fail("canonical");
    } catch (error) {
      if (error instanceof CanonicalOwnedDirectoryError) throw error;
      fail("writable");
    }
    result = "hardened";
    retainAudit();
    return canonical;
  } catch (error) {
    if (error instanceof CanonicalOwnedDirectoryError) throw error;
    fail("canonical");
  } finally {
    if (descriptor !== undefined) fileSystem.closeSync(descriptor);
  }
}

export function readTrustedRegularFile(path, label, options = {}) {
  const owner = options.expectedOwner ?? ownerUid();
  const requested = resolve(path);
  const fail = (reason) => { throw new TrustedRegularFileError(label, reason); };
  let reference;
  try {
    reference = lstatSync(requested);
  } catch {
    fail("regular_file");
  }
  if (!reference.isFile() && !reference.isSymbolicLink()) fail("regular_file");
  if (!options.allowReferenceSymlink && reference.isSymbolicLink()) fail("symlink");
  let canonical;
  try {
    canonical = realpathSync(requested);
  } catch {
    fail("realpath");
  }
  let descriptor;
  try {
    try {
      descriptor = openSync(canonical, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch {
      fail("identity");
    }
    const opened = fstatSync(descriptor);
    const before = lstatSync(canonical);
    if (!opened.isFile() || (!before.isFile() && !before.isSymbolicLink())) fail("regular_file");
    if (before.isSymbolicLink()) fail("symlink");
    if (opened.nlink !== 1 || before.nlink !== 1) fail("link_count");
    if (opened.dev !== before.dev || opened.ino !== before.ino) fail("identity");
    if (opened.uid !== owner || before.uid !== owner) fail("owner");
    if ((opened.mode & 0o022) !== 0 || (before.mode & 0o022) !== 0) fail("writable");
    try {
      if (realpathSync(canonical) !== canonical || (!options.allowReferenceSymlink && canonical !== requested)) fail("realpath");
    } catch {
      fail("realpath");
    }
    if (options.executable && (opened.mode & 0o111) === 0) fail("executable");
    if (options.expectedMode !== undefined && (opened.mode & 0o777) !== options.expectedMode) fail("mode");
    options.afterOpen?.(canonical);
    const bytes = readFileSync(descriptor);
    const afterDescriptor = fstatSync(descriptor);
    const afterPath = lstatSync(canonical);
    if (!afterDescriptor.isFile() || (!afterPath.isFile() && !afterPath.isSymbolicLink())) fail("regular_file");
    if (afterPath.isSymbolicLink()) fail("symlink");
    if (afterDescriptor.nlink !== 1 || afterPath.nlink !== 1) fail("link_count");
    if (afterDescriptor.dev !== opened.dev || afterDescriptor.ino !== opened.ino || afterDescriptor.size !== opened.size
      || afterDescriptor.mtimeMs !== opened.mtimeMs || afterDescriptor.ctimeMs !== opened.ctimeMs
      || afterPath.dev !== opened.dev || afterPath.ino !== opened.ino) fail("identity");
    if (afterDescriptor.uid !== owner || afterPath.uid !== owner) fail("owner");
    if ((afterDescriptor.mode & 0o022) !== 0 || (afterPath.mode & 0o022) !== 0) fail("writable");
    try {
      if (realpathSync(canonical) !== canonical || (!options.allowReferenceSymlink && canonical !== requested)) fail("realpath");
    } catch {
      fail("realpath");
    }
    if (options.executable && (afterDescriptor.mode & 0o111) === 0) fail("executable");
    if (options.expectedMode !== undefined && (afterDescriptor.mode & 0o777) !== options.expectedMode) fail("mode");
    return { bytes, path: canonical, sha256: sha256(bytes) };
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function privateTemporaryRoot(owner) {
  const root = dirname(CANONICAL_DIRECTORY_AUDIT_PATH);
  try {
    mkdirSync(root, { mode: 0o700 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  return canonicalOwnedDirectory(root, "Recovery temporary root", owner);
}

export function canonicalDirectoryAuditJsonl(audits) {
  const keys = ["afterMode", "beforeMode", "directoryPathSha256", "result", "role", "timestamp"];
  if (audits.length !== CANONICAL_DIRECTORY_ROLES.length
    || audits.some((audit, index) => audit.role !== CANONICAL_DIRECTORY_ROLES[index]
      || Object.keys(audit).sort().some((key, keyIndex) => key !== keys[keyIndex])
      || !/^[0-9a-f]{64}$/.test(audit.directoryPathSha256)
      || !/^[0-7]{4}$/.test(audit.beforeMode) || !/^[0-7]{4}$/.test(audit.afterMode)
      || !["hardened", "validated"].includes(audit.result)
      || new Date(audit.timestamp).toISOString() !== audit.timestamp)) {
    throw new Error("Recovery canonical directory audit is incomplete");
  }
  const lines = audits.map((audit) => JSON.stringify(audit));
  if (lines.some((line) => Buffer.byteLength(line) >= 512)) {
    throw new Error("Recovery canonical directory audit record is too large");
  }
  return Buffer.from(`${lines.join("\n")}\n`);
}

function retainCanonicalDirectoryAudit(audits, owner) {
  const root = privateTemporaryRoot(owner);
  const directory = mkdtempSync(resolve(root, "recovery-directory-audit-"));
  const stagedPath = resolve(directory, "audit.json");
  const bytes = canonicalDirectoryAuditJsonl(audits);
  let moved = false;
  try {
    writeFileSync(stagedPath, bytes, { flag: "wx", mode: 0o600 });
    const staged = readTrustedRegularFile(stagedPath, "Recovery directory audit", {
      expectedMode: 0o600,
      expectedOwner: owner,
    });
    if (!staged.bytes.equals(bytes)) throw new Error("Recovery directory audit content changed");
    renameSync(stagedPath, CANONICAL_DIRECTORY_AUDIT_PATH);
    moved = true;
    const rootDescriptor = openSync(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
      fsyncSync(rootDescriptor);
    } finally {
      closeSync(rootDescriptor);
    }
  } finally {
    if (!moved) {
      try {
        unlinkSync(stagedPath);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    rmdirSync(directory);
  }
}

export function hardenCanonicalRepositoryDirectories(sourcePath, expectedRepositoryRoot, owner = ownerUid(), options = {}) {
  const source = resolve(sourcePath);
  const scriptsPath = dirname(source);
  const packageRoot = resolve(scriptsPath, "..");
  const packagesRoot = resolve(packageRoot, "..");
  const repoRoot = resolve(packagesRoot, "..");
  if (repoRoot !== resolve(expectedRepositoryRoot)
    || basename(packageRoot) !== "ingenium-extension" || basename(packagesRoot) !== "packages"
    || packagesRoot !== resolve(repoRoot, "packages")
    || packageRoot !== resolve(packagesRoot, "ingenium-extension")
    || scriptsPath !== resolve(packageRoot, "scripts")
    || source !== resolve(scriptsPath, "recovery-bootstrap.js")) {
    throw new Error("Recovery bootstrap shim is outside the canonical extension package");
  }

  const audits = [];
  const directories = [
    { role: CANONICAL_DIRECTORY_ROLES[0], path: repoRoot, label: "Repository root" },
    { role: CANONICAL_DIRECTORY_ROLES[1], path: packagesRoot, label: "Packages root" },
    { role: CANONICAL_DIRECTORY_ROLES[2], path: packageRoot, label: "Extension package root" },
    { role: CANONICAL_DIRECTORY_ROLES[3], path: scriptsPath, label: "Extension scripts directory" },
  ];
  for (const directory of directories) {
    canonicalOwnedDirectory(directory.path, directory.label, owner, {
      auditRole: directory.role,
      hardenWritablePath: directory.path,
      retainAudit: (audit) => audits.push(audit),
      fileSystem: options.fileSystem,
      afterOpen: options.afterOpen,
    });
  }
  options.retainAudit?.(audits);
  return { repoRoot, packagesRoot, packageRoot, scriptsPath };
}

function gitEnvironment() {
  return {
    PATH: "/usr/local/bin:/usr/bin:/bin",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_LITERAL_PATHSPECS: "1",
  };
}

function git(root, args, encoding = "buffer") {
  return execFileSync(GIT, ["-C", root, "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", ...args], {
    encoding,
    env: gitEnvironment(),
    maxBuffer: 16 * 1024 * 1024,
    timeout: 10_000,
  });
}

function gitConfiguration(root) {
  return execFileSync(GIT, ["-C", root, "config", "--null", "--list", "--includes"], {
    encoding: "utf8",
    env: gitEnvironment(),
    maxBuffer: 16 * 1024 * 1024,
    timeout: 10_000,
  });
}

function isExecutableGitConfiguration(entry) {
  const separator = entry.indexOf("\n");
  const key = separator === -1 ? entry : entry.slice(0, separator);
  const value = separator === -1 ? "" : entry.slice(separator + 1);
  return EXECUTABLE_GIT_CONFIGURATION.test(key)
    || (/^alias\./i.test(key) && value.trimStart().startsWith("!"));
}

export function verifyScopedCheckpoint(root, sourcePath, sourceBytes) {
  const canonicalRoot = canonicalOwnedDirectory(root, "Repository root");
  const configuration = gitConfiguration(canonicalRoot);
  if (configuration.split("\0").some(isExecutableGitConfiguration)) {
    throw new Error("Recovery bootstrap checkpoint rejected executable Git configuration");
  }
  const topLevel = git(canonicalRoot, ["rev-parse", "--show-toplevel"], "utf8").trim();
  const head = git(canonicalRoot, ["rev-parse", "--verify", "HEAD"], "utf8").trim();
  if (topLevel !== canonicalRoot || !/^[0-9a-f]{40,64}$/.test(head)) {
    throw new Error("Recovery bootstrap checkpoint identity is invalid");
  }
  const relativeSource = "packages/ingenium-extension/scripts/recovery-bootstrap.js";
  if (resolve(canonicalRoot, relativeSource) !== sourcePath
    || !Buffer.from(git(canonicalRoot, ["show", `${head}:${relativeSource}`])).equals(sourceBytes)) {
    throw new Error("Recovery bootstrap shim does not match reviewed Git HEAD");
  }
  try {
    git(canonicalRoot, ["diff", "--no-ext-diff", "--quiet", head, "--", ...CHECKPOINT_PATHS]);
  } catch {
    throw new Error("Recovery bootstrap scoped checkpoint has tracked drift");
  }
  const untracked = git(canonicalRoot, ["ls-files", "-z", "--others", "--exclude-standard", "--", ...CHECKPOINT_PATHS]);
  if (untracked.length !== 0) throw new Error("Recovery bootstrap scoped checkpoint has untracked drift");
  return head;
}

function selectedEnvironment(source, names) {
  return Object.fromEntries(names.flatMap((name) => source[name] === undefined ? [] : [[name, source[name]]]));
}

function childEnvironment(names, runtime, extra = {}) {
  return {
    ...selectedEnvironment(process.env, names),
    PATH: `${dirname(runtime)}:/usr/local/bin:/usr/bin:/bin`,
    ...extra,
  };
}

function processStat(pid) {
  try {
    const source = readFileSync(`/proc/${pid}/stat`, "utf8");
    const closeParen = source.lastIndexOf(")");
    if (closeParen < 1) return undefined;
    const fields = source.slice(closeParen + 1).trim().split(/\s+/);
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

function processEnvironmentHasNonce(pid, nonce) {
  try {
    return readFileSync(`/proc/${pid}/environ`, "utf8").split("\0").includes(`${CHILD_NONCE}=${nonce}`);
  } catch {
    return false;
  }
}

function processIdentity(pid, nonce) {
  const stat = processStat(pid);
  if (!stat || !processEnvironmentHasNonce(pid, nonce)) return undefined;
  try {
    const executable = realpathSync(readlinkSync(`/proc/${pid}/exe`));
    return { pid, ...stat, executableSha256: sha256(readFileSync(executable)) };
  } catch {
    return undefined;
  }
}

function processGroupMembers(processGroupId, nonce) {
  const members = new Map();
  for (const entry of readdirSync("/proc")) {
    if (!/^[1-9][0-9]*$/.test(entry)) continue;
    const pid = Number(entry);
    if (processStat(pid)?.processGroupId !== processGroupId) continue;
    const identity = processIdentity(pid, nonce);
    if (!identity) throw new Error("Recovery child process group contains an unattested member");
    members.set(identity.pid, identity);
  }
  return members;
}

function sameProcess(left, right) {
  return left?.pid === right.pid && left.startTimeTicks === right.startTimeTicks
    && left.processGroupId === right.processGroupId && left.executableSha256 === right.executableSha256;
}

function attestProcessGroup(identity, allowNewMembers) {
  const current = processGroupMembers(identity.pid, identity.nonce);
  if (current.size === 0) return false;
  for (const [pid, member] of current) {
    const expected = identity.members.get(pid);
    if (expected && !sameProcess(member, expected)) throw new Error("Recovery child process-group identity changed before signal");
    if (!expected && !allowNewMembers) throw new Error("Recovery child process group gained an ambiguous member");
    identity.members.set(pid, member);
  }
  const confirmed = processGroupMembers(identity.pid, identity.nonce);
  if (confirmed.size !== current.size
    || [...confirmed].some(([pid, member]) => !sameProcess(member, identity.members.get(pid)))) {
    throw new Error("Recovery child process group changed during signal attestation");
  }
  return true;
}

function signalProcessGroup(identity, signal, allowNewMembers) {
  if (!attestProcessGroup(identity, allowNewMembers)) return;
  try {
    process.kill(-identity.pid, signal);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

async function waitForProcessLeader(pid, nonce) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const identity = processIdentity(pid, nonce);
    if (identity?.processGroupId === pid) return identity;
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
  return undefined;
}

async function runFixed(command, args, timeoutMs, env, cwd) {
  const nonce = randomBytes(32).toString("base64url");
  const child = spawn(command, args, {
    cwd,
    detached: true,
    env: { ...env, [CHILD_NONCE]: nonce },
    shell: false,
    stdio: "inherit",
  });
  await new Promise((resolveSpawn, rejectSpawn) => {
    child.once("error", rejectSpawn);
    child.once("spawn", resolveSpawn);
  });
  if (!child.pid) throw new Error("Recovery bootstrap shim could not identify its child");
  const leader = await waitForProcessLeader(child.pid, nonce);
  if (!leader) {
    throw new Error("Recovery bootstrap shim child identity is unavailable");
  }
  const identity = { pid: child.pid, nonce, members: new Map([[child.pid, leader]]) };

  return await new Promise((resolveResult, reject) => {
    let timedOut = false;
    let forwardedSignal;
    let forceTimer;
    let settled = false;
    const finish = () => {
      clearTimeout(timeout);
      if (forceTimer) clearTimeout(forceTimer);
      for (const [signal, handler] of Object.entries(handlers)) process.off(signal, handler);
    };
    const failClosed = (error) => {
      if (settled) return;
      settled = true;
      finish();
      child.unref();
      reject(error);
    };
    const forward = (signal, allowNewMembers) => {
      try {
        signalProcessGroup(identity, signal, allowNewMembers);
      } catch (error) {
        failClosed(error);
      }
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      forward("SIGTERM", true);
      if (!settled) forceTimer = setTimeout(() => forward("SIGKILL", false), CLEANUP_GRACE_MS);
    }, timeoutMs);
    const handlers = Object.fromEntries(SIGNALS.map((signal) => [signal, () => {
      forwardedSignal ??= signal;
      forward(signal, true);
      if (!settled) forceTimer ??= setTimeout(() => forward("SIGKILL", false), CLEANUP_GRACE_MS);
    }]));
    for (const [signal, handler] of Object.entries(handlers)) process.on(signal, handler);
    child.once("error", failClosed);
    child.once("close", (status, signal) => {
      if (settled) return;
      if (timedOut || forwardedSignal) forward("SIGKILL", false);
      if (settled) return;
      settled = true;
      finish();
      resolveResult({ status, signal: forwardedSignal ?? signal, timedOut });
    });
  });
}

function propagate(result, timeoutLabel) {
  if (result.timedOut) {
    console.error(`${timeoutLabel} timed out`);
    process.exitCode = 124;
    return false;
  }
  if (result.signal) {
    process.kill(process.pid, result.signal);
    return false;
  }
  process.exitCode = result.status ?? 1;
  return result.status === 0;
}

function privateStagedBootstrap(bytes, owner) {
  const root = privateTemporaryRoot(owner);
  const directory = mkdtempSync(resolve(root, "recovery-bootstrap-"));
  canonicalOwnedDirectory(directory, "Recovery staging directory", owner);
  const path = resolve(directory, "recovery-bootstrap.js");
  writeFileSync(path, bytes, { flag: "wx", mode: 0o400 });
  const staged = readTrustedRegularFile(path, "Staged recovery bootstrap", { expectedMode: 0o400, expectedOwner: owner });
  if (!staged.bytes.equals(bytes)) throw new Error("Staged recovery bootstrap content changed");
  return {
    path,
    sha256: staged.sha256,
    cleanup() {
      unlinkSync(path);
      rmdirSync(directory);
    },
  };
}

export async function runRecoveryBootstrapShim(argv = process.argv) {
  if (argv.length !== 2) throw new Error("Recovery bootstrap shim accepts no arguments");
  const owner = ownerUid();
  const sourcePath = resolve(fileURLToPath(import.meta.url));
  const declaredWorktree = process.env.INGENIUM_WORKTREE;
  if (!declaredWorktree) {
    throw new Error("Recovery bootstrap shim requires the attested canonical worktree");
  }
  try {
    if (realpathSync(declaredWorktree) !== resolve(declaredWorktree)) {
      throw new Error("Recovery bootstrap shim requires the attested canonical worktree");
    }
  } catch (error) {
    if (error instanceof Error && error.message === "Recovery bootstrap shim requires the attested canonical worktree") {
      throw error;
    }
    throw new Error("Recovery bootstrap shim requires the attested canonical worktree");
  }
  const { repoRoot, packageRoot, scriptsPath } = hardenCanonicalRepositoryDirectories(
    sourcePath,
    declaredWorktree,
    owner,
    { retainAudit: (audits) => retainCanonicalDirectoryAudit(audits, owner) },
  );
  const source = readTrustedRegularFile(resolve(scriptsPath, "recovery-bootstrap.js"), "Recovery bootstrap shim", {
    expectedOwner: owner,
  });
  verifyScopedCheckpoint(repoRoot, source.path, source.bytes);

  const runtimeOwner = lstatSync(realpathSync(process.execPath)).uid;
  if (runtimeOwner !== 0 && runtimeOwner !== owner) throw new Error("Node runtime owner is not trusted");
  const runtime = readTrustedRegularFile(process.execPath, "Node runtime", {
    executable: true,
    expectedOwner: runtimeOwner,
  }).path;
  const npm = readTrustedRegularFile(resolve(dirname(process.execPath), "npm"), "Adjacent npm executable", {
    allowReferenceSymlink: true,
    executable: true,
    expectedOwner: runtimeOwner,
  }).path;
  const recoveryEnvironment = {
    [CANONICAL_WORKTREE]: repoRoot,
    INGENIUM_WORKTREE: repoRoot,
  };
  const build = await runFixed(
    npm,
    ["run", "build", "--workspace=packages/ingenium-extension"],
    BUILD_TIMEOUT_MS,
    childEnvironment(BUILD_ENVIRONMENT, runtime, {
      ...recoveryEnvironment,
      NPM_CONFIG_GLOBALCONFIG: "/dev/null",
      NPM_CONFIG_SCRIPT_SHELL: "/bin/sh",
      NPM_CONFIG_USERCONFIG: "/dev/null",
    }),
    repoRoot,
  );
  if (!propagate(build, "Extension recovery bootstrap build")) return;
  verifyScopedCheckpoint(repoRoot, source.path, source.bytes);

  const generatedDirectory = canonicalOwnedDirectory(resolve(packageRoot, "dist/scripts"), "Generated scripts directory", owner);
  const generated = readTrustedRegularFile(resolve(generatedDirectory, "recovery-bootstrap.js"), "Generated recovery bootstrap", {
    executable: true,
    expectedMode: 0o555,
    expectedOwner: owner,
  });
  if (generated.path !== resolve(repoRoot, "packages/ingenium-extension/dist/scripts/recovery-bootstrap.js")) {
    throw new Error("Generated recovery bootstrap path is invalid");
  }
  const staged = privateStagedBootstrap(generated.bytes, owner);
  try {
    const generatedModule = await import(`${pathToFileURL(staged.path).href}?inspect=1`);
    const declaredRuntimeMs = generatedModule.RECOVERY_BOOTSTRAP_MAX_RUNTIME_MS;
    if (!Number.isSafeInteger(declaredRuntimeMs) || declaredRuntimeMs < 1
      || declaredRuntimeMs > MAX_TIMER_MS - GENERATED_TIMEOUT_GRACE_MS) {
      throw new Error("Generated recovery bootstrap timeout declaration is invalid");
    }
    const generatedResult = await runFixed(
      runtime,
      [staged.path],
      declaredRuntimeMs + GENERATED_TIMEOUT_GRACE_MS,
      childEnvironment(RECOVERY_ENVIRONMENT, runtime, {
        ...recoveryEnvironment,
        [GENERATED_BOOTSTRAP_SHA256]: staged.sha256,
      }),
      repoRoot,
    );
    propagate(generatedResult, "Generated recovery bootstrap");
  } finally {
    staged.cleanup();
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(realpathSync(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) await runRecoveryBootstrapShim();
