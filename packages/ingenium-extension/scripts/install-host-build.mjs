import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, fchmodSync, fstatSync, fsyncSync, linkSync, lstatSync, openSync,
  mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const extensionRelative = "packages/ingenium-extension";
const sourceRelative = `${extensionRelative}/scripts/recovery-bootstrap.js`;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const identity = (stat) => ({ dev: stat.dev, ino: stat.ino, uid: stat.uid, mode: stat.mode, nlink: stat.isDirectory?.() ? undefined : stat.nlink });
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const present = (path) => {
  try { return lstatSync(path); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
};

export function parseInstallerArgs(argv) {
  if (argv.length !== 2 || argv[0] !== "--expected-head" || !/^[0-9a-f]{40}$/.test(argv[1])) {
    throw new Error("Usage: npm run install:host-build --workspace=@ingenium/extension -- --expected-head <40 lowercase hex>");
  }
  return argv[1];
}

// Linux descriptor-relative paths keep mutations in the opened directory, even after a parent rename.
function openDirectory(path, descriptors, owner, sourceOnly = false) {
  if (resolve(path) !== path) throw new Error("Noncanonical directory");
  let parent;
  let canonical = "/";
  for (const part of ["", ...path.split("/").filter(Boolean)]) {
    canonical = part ? join(canonical, part) : "/";
    const anchored = parent === undefined ? "/" : `/proc/self/fd/${parent}/${part}`;
    const fd = openSync(anchored, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    descriptors.push(fd);
    const stat = fstatSync(fd);
    const stickyRoot = stat.uid === 0 && (stat.mode & 0o1000) !== 0;
    if (!stat.isDirectory() || ![0, owner].includes(stat.uid)
      || ((stat.mode & 0o022) !== 0 && !stickyRoot && !(sourceOnly && [0o775, 0o575].includes(stat.mode & 0o7777)))
      || !same(identity(stat), identity(lstatSync(canonical))) || realpathSync(canonical) !== canonical) {
      throw new Error("Unsafe directory ancestry");
    }
    parent = fd;
  }
  if (fstatSync(parent).uid !== owner || (!sourceOnly && (fstatSync(parent).mode & 0o022) !== 0)) throw new Error("Directory is not owner-controlled");
  return { fd: parent, path, anchored: `/proc/self/fd/${parent}`, stat: identity(fstatSync(parent)) };
}

function checkDirectory(directory) {
  if (!same(identity(fstatSync(directory.fd)), directory.stat)
    || !same(identity(lstatSync(directory.path)), directory.stat)
    || realpathSync(directory.path) !== directory.path) throw new Error("Directory identity changed");
}

function readRegular(path, owner, mode, links = 1) {
  const before = lstatSync(path);
  if (!before.isFile() || before.uid !== owner || before.nlink !== links || (before.mode & 0o7022) !== 0
    || (mode !== undefined && (before.mode & 0o7777) !== mode)) throw new Error("Unsafe regular file");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = fstatSync(fd);
    const bytes = readFileSync(fd);
    for (const stat of [opened, fstatSync(fd), lstatSync(path)]) {
      if (!same(identity(stat), identity(before)) || stat.size !== before.size
        || stat.mtimeMs !== before.mtimeMs || stat.ctimeMs !== before.ctimeMs) throw new Error("File identity changed");
    }
    return { bytes, sha256: sha256(bytes), ...identity(before) };
  } finally { closeSync(fd); }
}

function git(root, args) {
  return execFileSync("/usr/bin/git", ["--no-optional-locks", "-C", root, "-c", "core.fsmonitor=false",
    "-c", "core.hooksPath=/dev/null", ...args], {
    env: { PATH: "/usr/bin:/bin", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" },
    timeout: 30_000, maxBuffer: 16 * 1024 * 1024,
  });
}

function verifyHead(root, expectedHead) {
  const config = git(root, ["config", "--null", "--list", "--includes"]).toString();
  if (config.split("\0").some((entry) => /^(?:filter\.|diff\.|merge\.|alias\.|core\.(?:fsmonitor|hooksPath|sshCommand)|include)/i.test(entry)
    && !["core.fsmonitor\nfalse", "core.hookspath\n/dev/null"].includes(entry))) throw new Error("Unsafe Git configuration");
  if (git(root, ["rev-parse", "--show-toplevel"]).toString().trim() !== root
    || git(root, ["rev-parse", "--verify", "HEAD"]).toString().trim() !== expectedHead) throw new Error("HEAD/worktree mismatch");
  if (git(root, ["ls-files", "-v", "-z"]).toString().split("\0").some((entry) => entry && entry[0] !== "H")
    || git(root, ["status", "--porcelain=v1", "--untracked-files=all", "--ignore-submodules=none"]).length) {
    throw new Error("Repository must be clean without hidden index entries");
  }
}

export function verifyRecoveryRegistry(wrapper) {
  const literal = ["deployment", "recovery-prepare"];
  if (!same(wrapper.validateManagedBuildArgv([...literal]), literal) || !wrapper.isManagedDeploymentArgv(literal)) {
    throw new Error("Registry lacks literal recovery-prepare");
  }
  for (const argv of [[...literal, "extra"], ["deployment", "recovery-prepare;id"], ["deployment", "--recovery-prepare"]]) {
    let rejected = false;
    try { wrapper.validateManagedBuildArgv(argv); } catch { rejected = true; }
    if (!rejected) throw new Error("Registry accepts nonliteral recovery-prepare");
  }
  let rejected = false;
  try { wrapper.decodeManagedBuildArgv(Buffer.from(JSON.stringify(literal)).toString("base64url")); } catch { rejected = true; }
  if (!rejected) throw new Error("Registry accepts encoded recovery-prepare");
}

const closure = ["package.json", "context-upload-codec.mjs", "dist/replacement-first-restart.js",
  "dist/scripts/build-command.js", "dist/scripts/managed-command-wrapper.js"];

function runtimeAncestry(runtime, root) {
  const entries = [];
  for (let path = runtime; ; path = dirname(path)) {
    const stat = lstatSync(path);
    if (realpathSync(path) !== path || ![0, process.getuid()].includes(stat.uid)
      || (stat.mode & 0o7022) !== 0 || (path === runtime ? !stat.isFile() || stat.nlink !== 1 : !stat.isDirectory())
      || path === root || path.startsWith(`${root}/`)) throw new Error("Runtime ancestry is not private");
    entries.push({ path, identity: `${stat.dev}:${stat.ino}:${stat.uid}:${stat.mode.toString(16)}` });
    if (path === dirname(path)) return entries;
  }
}

export async function buildPrivateClosure(root, head, parent, sourceBytes, runNpm = execFileSync) {
  const shim = await import(`data:text/javascript;base64,${sourceBytes.toString("base64")}`);
  const stage = shim.createPrivateRecoveryStage(root, head, parent);
  const node = realpathSync(process.execPath);
  const npm = realpathSync(join(dirname(node), "npm"));
  runtimeAncestry(node, root);
  runtimeAncestry(npm, root);
  const npmStat = lstatSync(npm);
  if (![0, process.getuid()].includes(npmStat.uid)) throw new Error("Untrusted npm runtime");
  readRegular(npm, npmStat.uid);
  const configuration = shim.privateNpmConfiguration();
  try {
    runNpm(node, [npm, "ci", "--ignore-scripts", "--no-audit", "--no-fund", "--include=dev"], {
      cwd: stage.workspace, timeout: 300_000, stdio: "inherit",
      env: { PATH: `${dirname(node)}:/usr/bin:/bin`, HOME: stage.directory, NPM_CONFIG_USERCONFIG: configuration.userConfig,
        NPM_CONFIG_GLOBALCONFIG: configuration.globalConfig, NPM_CONFIG_CACHE: join(stage.directory, "npm-cache") },
    });
  } finally { configuration.cleanup(); }
  const ts = (await import(pathToFileURL(join(stage.workspace, "node_modules/typescript/lib/typescript.js")).href)).default;
  const packageRoot = join(stage.workspace, extensionRelative);
  const output = {};
  for (const relative of closure) {
    if (!relative.startsWith("dist/")) output[relative] = readFileSync(join(packageRoot, relative));
    else {
      const source = relative.slice(5).replace(/\.js$/, ".ts");
      output[relative] = Buffer.from(ts.transpileModule(readFileSync(join(packageRoot, source), "utf8"), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
      }).outputText);
    }
  }
  return output;
}

function launcherBytes(node, nodeSha256, release, root, home, verifier) {
  const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
  const runtimeChecks = runtimeAncestry(node, root).map(({ path, identity }) =>
    `[ "$(/usr/bin/stat -c '%d:%i:%u:%f' -- ${quote(path)})" = ${quote(identity)} ] || exit 1`);
  const code = `import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { closeSync,constants,fstatSync,lstatSync,openSync,readFileSync,readdirSync,realpathSync } from 'node:fs';
import { basename,dirname,resolve } from 'node:path';
import { userInfo } from 'node:os';
const verify = ${verifier};
verify(${JSON.stringify(release)}, ${JSON.stringify(home)});
process.argv = [process.execPath, ${JSON.stringify(join(release, "dist/scripts/build-command.js"))}, ...process.argv.slice(1)];
await import(${JSON.stringify(pathToFileURL(join(release, "dist/scripts/build-command.js")).href)});`;
  const names = ["CI", "FORCE_COLOR", "NO_COLOR", "TERM", "INGENIUM_API_URL", "INGENIUM_MCP_AUDIENCE",
    "INGENIUM_MCP_CREDENTIAL_FILE", "INGENIUM_MCP_CREDENTIAL_PURPOSE", "INGENIUM_PROJECT", "INGENIUM_PROJECT_ID",
    "INGENIUM_RECOVERY_OWNER_NONCE", "INGENIUM_RECOVERY_OWNER_PID", "INGENIUM_RECOVERY_OWNER_START_TICKS",
    "INGENIUM_STORAGE_MAPPING_HASH", "INGENIUM_WORKSPACE_ID"];
  return Buffer.from(`#!/bin/sh\nset -eu\nunset ENV BASH_ENV CDPATH LD_PRELOAD LD_LIBRARY_PATH NODE_OPTIONS NODE_PATH\n${runtimeChecks.join("\n")}\ncd ${quote(root)}\nnode_hash=$(/usr/bin/env -i PATH=/usr/bin:/bin /usr/bin/sha256sum -- ${quote(node)})\n[ "$node_hash" = ${quote(`${nodeSha256}  ${node}`)} ] || exit 1\nexec /usr/bin/env -i HOME=${quote(home)} PATH=${quote(`${dirname(node)}:/usr/bin:/bin`)} ${names.map((name) => `"${name}=\${${name}-}"`).join(" ")} ${quote(node)} --input-type=module --eval ${quote(code)} -- "$@"\n`);
}

export async function installHostBuild(expectedHead, {
  repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../.."),
  home = userInfo().homedir,
  build,
  rename = renameSync,
  afterAdoption = () => {},
} = {}) {
  parseInstallerArgs(["--expected-head", expectedHead]);
  if (process.platform !== "linux" || process.getuid() !== process.geteuid()) throw new Error("Installer requires unswitched Linux user identity");
  const owner = process.getuid();
  const descriptors = [];
  let lock;
  let state;
  let bin;
  let manifest;
  let manifestPath;
  let backup;
  let candidate;
  let candidateStat;
  let prior;
  let target;
  let adoptionAttempted = false;
  let rollbackFailed = false;
  let priorLinked = false;
  const inspectTarget = (path, links = 1) => {
    const stat = present(path);
    if (!stat) return null;
    if (stat.uid !== owner || stat.nlink !== links) throw new Error("Unsafe existing target");
    if (stat.isSymbolicLink()) {
      const link = readlinkSync(path);
      if (resolve(link) !== link || realpathSync(path) !== link) throw new Error("Unsafe target symlink resolution");
      const parent = openDirectory(dirname(link), descriptors, owner, true);
      const file = readRegular(`${parent.anchored}/${link.slice(dirname(link).length + 1)}`, owner);
      checkDirectory(parent);
      if (!same(identity(lstatSync(path)), identity(stat)) || readlinkSync(path) !== link) throw new Error("Target symlink changed");
      return { ...identity(stat), link, sha256: file.sha256 };
    }
    const file = readRegular(path, owner, undefined, links);
    return { ...identity(stat), sha256: file.sha256 };
  };
  const releaseLock = () => {
    if (candidate && present(candidate) && same(identity(lstatSync(candidate)), candidateStat)) {
      unlinkSync(candidate); fsyncSync(bin.fd);
    }
    if (lock !== undefined) {
      const path = `${state.anchored}/ingenium-build-install.lock`;
      const current = present(path);
      if (current) {
        if (!same(identity(current), identity(fstatSync(lock)))) throw new Error("Installer lock identity changed");
        unlinkSync(path);
      }
      fsyncSync(state.fd);
      closeSync(lock);
      lock = undefined;
    }
  };
  const save = (status) => {
    manifest.status = status;
    manifest.updatedAt = new Date().toISOString();
    checkDirectory(state);
    const temporary = `${manifestPath}.${randomUUID()}.tmp`;
    const fd = openSync(temporary, "wx", 0o600);
    try { fchmodSync(fd, 0o600); writeFileSync(fd, JSON.stringify(manifest, null, 2) + "\n"); fsyncSync(fd); }
    finally { closeSync(fd); }
    renameSync(temporary, manifestPath);
    fsyncSync(state.fd);
    const persisted = readRegular(manifestPath, owner, 0o600);
    if (!same(JSON.parse(persisted.bytes), manifest)) throw new Error("Provenance readback failed");
  };
  try {
    const root = openDirectory(repositoryRoot, descriptors, owner, true);
    openDirectory(home, descriptors, owner);
    bin = openDirectory(join(home, ".local/bin"), descriptors, owner);
    state = openDirectory(join(home, ".local/state"), descriptors, owner);
    const lockPath = `${state.anchored}/ingenium-build-install.lock`;
    lock = openSync(lockPath, "wx", 0o600);
    fsyncSync(lock); fsyncSync(state.fd);
    target = `${bin.anchored}/ingenium-build`;
    prior = inspectTarget(target);
    verifyHead(root.path, expectedHead);
    const sourceDirectory = openDirectory(join(root.path, extensionRelative, "scripts"), descriptors, owner, true);
    const source = () => {
      checkDirectory(sourceDirectory);
      const value = readRegular(`${sourceDirectory.anchored}/recovery-bootstrap.js`, owner, 0o644);
      if (!value.bytes.equals(git(root.path, ["show", `${expectedHead}:${sourceRelative}`]))) throw new Error("Bootstrap source mismatch");
      return value;
    };
    const verifiedSource = source();
    const sourceSha256 = verifiedSource.sha256;
    let parent = openDirectory(join(home, ".local"), descriptors, owner);
    for (const name of ["share", "ingenium", "host-build", "releases"]) {
      const child = join(parent.path, name);
      if (!present(child)) { mkdirSync(`${parent.anchored}/${name}`, { mode: 0o700 }); fsyncSync(parent.fd); }
      parent = openDirectory(child, descriptors, owner);
      if (name !== "share" && (fstatSync(parent.fd).mode & 0o7777) !== 0o700) throw new Error("Private release parent mode is invalid");
    }
    const releasePath = join(parent.path, expectedHead);
    const canonicalTarget = join(releasePath, "dist/scripts/build-command.js");
    const id = randomUUID();
    backup = `${bin.anchored}/.ingenium-build-${id}.previous`;
    candidate = `${bin.anchored}/.ingenium-build-${id}.candidate`;
    manifestPath = `${state.anchored}/ingenium-build-install-${id}.json`;
    manifest = { schemaVersion: 1, head: expectedHead, repositoryRoot: root.path, owner,
      target: join(bin.path, "ingenium-build"), canonicalTarget, source: { path: join(root.path, sourceRelative), sha256: sourceSha256 },
      artifacts: {}, releasePath, prior, backup: prior ? join(bin.path, `.ingenium-build-${id}.previous`) : null,
      candidate: join(bin.path, `.ingenium-build-${id}.candidate`), timestamp: new Date().toISOString() };
    save("preparing");
    if (prior) {
      if (!same(inspectTarget(target), prior)) throw new Error("Prior target changed");
      linkSync(target, backup);
      priorLinked = true;
      if (!same(inspectTarget(backup, 2), { ...prior, nlink: 2 })) throw new Error("Prior backup changed");
      manifest.backupMetadata = prior;
      fsyncSync(bin.fd);
    } else manifest.backupMetadata = null;
    save("building");
    const result = build ? await build(root.path) : await buildPrivateClosure(root.path, expectedHead,
      dirname(parent.path), verifiedSource.bytes);
    if (!same(Object.keys(result).sort(), [...closure].sort()) || Object.values(result).some((bytes) => !Buffer.isBuffer(bytes) || !bytes.length)) {
      throw new Error("Private build closure is incomplete");
    }
    const nodePath = realpathSync(process.execPath);
    const nodeOwner = lstatSync(nodePath).uid;
    if (![0, owner].includes(nodeOwner)) throw new Error("Untrusted Node runtime");
    const node = readRegular(nodePath, nodeOwner);
    const releaseManifest = { schemaVersion: 1, head: expectedHead, repositoryRoot: root.path, owner,
      node: { path: nodePath, sha256: node.sha256, ...identity(lstatSync(nodePath)) }, sourceSha256,
      files: Object.fromEntries(closure.map((name) => [name, { sha256: sha256(result[name]), mode: 0o400 }])) };
    const releaseBytes = Buffer.from(JSON.stringify(releaseManifest) + "\n");
    const material = { ...result, "release.json": releaseBytes };
    if (!present(releasePath)) {
      const stagedPath = join(parent.path, `.candidate-${id}`);
      mkdirSync(`${parent.anchored}/.candidate-${id}`, { mode: 0o700 });
      const staged = openDirectory(stagedPath, descriptors, owner);
      mkdirSync(`${staged.anchored}/dist`, { mode: 0o700 });
      mkdirSync(`${staged.anchored}/dist/scripts`, { mode: 0o700 });
      for (const [name, bytes] of Object.entries(material)) {
        const fd = openSync(`${staged.anchored}/${name}`, "wx", 0o400);
        try { fchmodSync(fd, 0o400); writeFileSync(fd, bytes); fsyncSync(fd); }
        finally { closeSync(fd); }
      }
      for (const path of [join(stagedPath, "dist/scripts"), join(stagedPath, "dist")]) {
        const dir = openDirectory(path, descriptors, owner); fsyncSync(dir.fd);
      }
      fsyncSync(staged.fd); checkDirectory(parent);
      renameSync(`${parent.anchored}/.candidate-${id}`, `${parent.anchored}/${expectedHead}`); fsyncSync(parent.fd);
    }
    const release = openDirectory(releasePath, descriptors, owner);
    const verifyArtifacts = () => {
      checkDirectory(root); checkDirectory(release);
      verifyHead(root.path, expectedHead);
      if (source().sha256 !== sourceSha256) throw new Error("Bootstrap source changed");
      for (const [name, bytes] of Object.entries(material)) {
        const artifact = readRegular(`${release.anchored}/${name}`, owner, 0o400);
        if (!artifact.bytes.equals(bytes)) throw new Error("Existing revision does not match immutable release");
        manifest.artifacts[name] = { path: join(release.path, name), sha256: artifact.sha256, mode: 0o400 };
      }
    };
    verifyArtifacts();
    // Validate directories before importing any private bytes, including for an existing revision.
    for (const [relative, expected] of [["", ["context-upload-codec.mjs", "dist", "package.json", "release.json"]],
      ["dist", ["replacement-first-restart.js", "scripts"]], ["dist/scripts", ["build-command.js", "managed-command-wrapper.js"]]]) {
      const dir = openDirectory(join(releasePath, relative), descriptors, owner);
      if ((fstatSync(dir.fd).mode & 0o7777) !== 0o700 || !same(readdirSync(dir.anchored).sort(), expected.sort())) throw new Error("Invalid release directory");
    }
    const wrapper = await import(pathToFileURL(join(releasePath, "dist/scripts/managed-command-wrapper.js")).href + `?install=${randomUUID()}`);
    verifyRecoveryRegistry(wrapper);
    wrapper.verifyPrivateBuildRelease(releasePath, home);
    const wrapperSource = result["dist/scripts/managed-command-wrapper.js"].toString();
    const start = wrapperSource.indexOf("export function verifyPrivateBuildRelease(");
    const end = wrapperSource.indexOf("\nexport function managedWrapperPackageRoot(", start);
    if (start < 0 || end <= start) throw new Error("Private release verifier export is missing");
    const launcher = launcherBytes(nodePath, node.sha256, releasePath, root.path, home, wrapperSource.slice(start + "export ".length, end).trim());
    const candidateFd = openSync(candidate, "wx", 0o500);
    try { fchmodSync(candidateFd, 0o500); writeFileSync(candidateFd, launcher); fsyncSync(candidateFd); }
    finally { closeSync(candidateFd); }
    candidateStat = identity(lstatSync(candidate));
    fsyncSync(bin.fd);
    const currentPrior = inspectTarget(target, prior ? 2 : 1);
    const expectedPrior = prior ? { ...prior, nlink: 2 } : null;
    if (!same(currentPrior, expectedPrior) || readRegular(candidate, owner, 0o500).sha256 !== sha256(launcher)) throw new Error("Target changed before adoption");
    manifest.candidateIdentity = candidateStat;
    save("prepared");
    checkDirectory(bin); verifyArtifacts();
    adoptionAttempted = true;
    rename(candidate, target);
    fsyncSync(bin.fd);
    afterAdoption();
    checkDirectory(bin); verifyArtifacts();
    wrapper.verifyPrivateBuildRelease(releasePath, home);
    const installed = inspectTarget(target);
    if (!same(identity(lstatSync(target)), candidateStat) || installed.sha256 !== sha256(launcher)
      || (installed.mode & 0o7777) !== 0o500) throw new Error("Post-adoption verification failed");
    manifest.installed = installed;
    save("installed");
    checkDirectory(bin); checkDirectory(state);
    releaseLock();
    return { manifest: join(state.path, `ingenium-build-install-${id}.json`), ...manifest };
  } catch (error) {
    try {
      // A rename can complete and still report failure: inspect the pinned directory, never replay it.
      if (adoptionAttempted) {
        const current = present(target);
        if (current && same(identity(current), candidateStat)) {
          if (prior && (!same(identity(lstatSync(backup)), identity(manifest.backupMetadata))
            || (prior.link ? readlinkSync(backup) !== prior.link
              : readRegular(backup, owner).sha256 !== prior.sha256))) throw new Error("Backup changed before rollback");
          if (prior) {
            try { renameSync(backup, target); } catch (failure) {
              if (present(backup) || !same(identity(lstatSync(target)), identity(prior))) throw failure;
            }
            priorLinked = false;
          }
          else unlinkSync(target);
          fsyncSync(bin.fd);
          if (prior?.link ? readlinkSync(target) !== prior.link : prior
            ? readRegular(target, owner).sha256 !== prior.sha256 : present(target) !== null) throw new Error("Rollback readback failed");
          checkDirectory(bin);
        } else if (!same(inspectTarget(target, priorLinked ? 2 : 1), priorLinked ? { ...prior, nlink: 2 } : prior)) {
          throw new Error("Unknown adoption outcome; retained backup and lock");
        }
      }
      if (priorLinked) {
        if (!same(inspectTarget(backup, 2), { ...prior, nlink: 2 })) throw new Error("Prior backup changed during rollback");
        unlinkSync(backup); priorLinked = false; fsyncSync(bin.fd);
      }
      if (manifest && !same(inspectTarget(target), prior)) throw new Error("Pre-build host entry was not restored");
      if (manifest) save(adoptionAttempted ? "rolled_back" : "failed");
    } catch (rollbackError) {
      rollbackFailed = true;
      try { if (manifest) save("rollback_failed"); } catch {}
      throw new AggregateError([error, rollbackError], "Installation failed; rollback requires reconciliation");
    }
    throw error;
  } finally {
    try {
      if (!rollbackFailed) releaseLock();
    } finally {
      if (lock !== undefined) closeSync(lock);
      for (const fd of descriptors.reverse()) closeSync(fd);
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  installHostBuild(parseInstallerArgs(process.argv.slice(2))).then((result) => console.log(JSON.stringify(result)))
    .catch((error) => { console.error(error.message); process.exitCode = 1; });
}
