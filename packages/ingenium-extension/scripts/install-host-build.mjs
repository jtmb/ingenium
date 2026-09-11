import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, fchmodSync, fstatSync, fsyncSync, linkSync, lstatSync, openSync,
  readFileSync, readlinkSync, realpathSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const extensionRelative = "packages/ingenium-extension";
const sourceRelative = `${extensionRelative}/scripts/recovery-bootstrap.js`;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const identity = (stat) => ({ dev: stat.dev, ino: stat.ino, uid: stat.uid, mode: stat.mode, nlink: stat.nlink });
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
function openDirectory(path, descriptors, owner) {
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
      || ((stat.mode & 0o022) !== 0 && !stickyRoot)
      || !same(identity(stat), identity(lstatSync(canonical))) || realpathSync(canonical) !== canonical) {
      throw new Error("Unsafe directory ancestry");
    }
    parent = fd;
  }
  if (fstatSync(parent).uid !== owner || (fstatSync(parent).mode & 0o022) !== 0) throw new Error("Directory is not owner-controlled");
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
  let adopted = false;
  let rollbackFailed = false;
  let distribution;
  let priorLinked = false;
  const inspectTarget = (path, links = 1) => {
    const stat = present(path);
    if (!stat) return null;
    if (stat.uid !== owner || stat.nlink !== links) throw new Error("Unsafe existing target");
    if (stat.isSymbolicLink()) {
      const link = readlinkSync(path);
      if (resolve(link) !== link || realpathSync(path) !== link) throw new Error("Unsafe target symlink resolution");
      const parent = openDirectory(dirname(link), descriptors, owner);
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
    const root = openDirectory(repositoryRoot, descriptors, owner);
    openDirectory(home, descriptors, owner);
    bin = openDirectory(join(home, ".local/bin"), descriptors, owner);
    state = openDirectory(join(home, ".local/state"), descriptors, owner);
    const lockPath = `${state.anchored}/ingenium-build-install.lock`;
    lock = openSync(lockPath, "wx", 0o600);
    fsyncSync(lock); fsyncSync(state.fd);
    target = `${bin.anchored}/ingenium-build`;
    prior = inspectTarget(target);
    verifyHead(root.path, expectedHead);
    const sourceDirectory = openDirectory(join(root.path, extensionRelative, "scripts"), descriptors, owner);
    const source = () => {
      checkDirectory(sourceDirectory);
      const value = readRegular(`${sourceDirectory.anchored}/recovery-bootstrap.js`, owner, 0o644);
      if (!value.bytes.equals(git(root.path, ["show", `${expectedHead}:${sourceRelative}`]))) throw new Error("Bootstrap source mismatch");
      return value.sha256;
    };
    const sourceSha256 = source();
    for (const relative of [extensionRelative, "services/ingenium-server"]) {
      openDirectory(join(root.path, relative), descriptors, owner);
      for (const child of ["build", "dist"]) {
        const path = join(root.path, relative, child);
        if (present(path)) openDirectory(path, descriptors, owner);
      }
    }
    const canonicalTarget = join(root.path, extensionRelative, "dist/scripts/build-command.js");
    const id = randomUUID();
    backup = `${bin.anchored}/.ingenium-build-${id}.previous`;
    candidate = `${bin.anchored}/.ingenium-build-${id}.candidate`;
    manifestPath = `${state.anchored}/ingenium-build-install-${id}.json`;
    manifest = { schemaVersion: 1, head: expectedHead, repositoryRoot: root.path, owner,
      target: join(bin.path, "ingenium-build"), canonicalTarget, source: { path: join(root.path, sourceRelative), sha256: sourceSha256 },
      artifacts: {}, distributionJournal: null, prior, backup: prior ? join(bin.path, `.ingenium-build-${id}.previous`) : null,
      candidate: join(bin.path, `.ingenium-build-${id}.candidate`), timestamp: new Date().toISOString() };
    save("preparing");
    if (prior) {
      if (!same(inspectTarget(target), prior)) throw new Error("Prior target changed");
      // Preserve the entry inode as well as its link text: dist adoption changes what that link executes.
      linkSync(target, backup);
      priorLinked = true;
      if (!same(inspectTarget(backup, 2), { ...prior, nlink: 2 })) throw new Error("Prior backup changed");
      manifest.backupMetadata = prior;
      fsyncSync(bin.fd);
    } else manifest.backupMetadata = null;
    save("building");
    const result = distribution = build ? await build(root.path) : await (async () => {
      const { buildDistributions } = await import("./build-distributions.mjs");
      return buildDistributions({ repositoryRoot: root.path, retainTransaction: true, compile: (repository, packageRoot, output) => {
        execFileSync(process.execPath, [join(repository, "node_modules/typescript/bin/tsc"), "--project",
          join(packageRoot, "tsconfig.json"), "--outDir", output], {
          cwd: packageRoot, stdio: "inherit", timeout: 300_000,
          env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin` },
        });
      } });
    })();
    manifest.distributionJournal = result.journal;
    save("built");
    const stage = result.stages.find((entry) => entry.packageRoot === join(root.path, extensionRelative));
    if (!stage || stage.active !== join(root.path, extensionRelative, "dist")) throw new Error("Distribution provenance mismatch");
    const artifactDirectory = openDirectory(join(stage.active, "scripts"), descriptors, owner);
    const artifacts = manifest.artifacts;
    for (const [relative, expected] of Object.entries(stage.candidateManifest)) {
      const path = join(stage.active, relative);
      if (resolve(path) !== path || !path.startsWith(`${stage.active}/`)) throw new Error("Noncanonical distribution entry");
      const retained = descriptors.length;
      try {
        const parent = openDirectory(dirname(path), descriptors, owner);
        const artifact = readRegular(`${parent.anchored}/${path.slice(dirname(path).length + 1)}`, owner, expected.mode);
        if (artifact.sha256 !== expected.sha256) throw new Error("Artifact hash mismatch");
      } finally { while (descriptors.length > retained) closeSync(descriptors.pop()); }
    }
    const verifyArtifacts = () => {
      checkDirectory(root); checkDirectory(artifactDirectory);
      verifyHead(root.path, expectedHead);
      if (source() !== sourceSha256) throw new Error("Bootstrap source changed");
      for (const name of ["build-command.js", "managed-command-wrapper.js", "recovery-bootstrap.js"]) {
        const artifact = readRegular(`${artifactDirectory.anchored}/${name}`, owner, 0o555);
        if (artifact.sha256 !== stage.candidateManifest[`scripts/${name}`]?.sha256
          || stage.candidateManifest[`scripts/${name}`]?.mode !== 0o555) throw new Error("Artifact hash mismatch");
        artifacts[name] = { path: join(artifactDirectory.path, name), sha256: artifact.sha256, mode: 0o555 };
      }
    };
    verifyArtifacts();
    verifyRecoveryRegistry(await import(pathToFileURL(join(artifactDirectory.path, "managed-command-wrapper.js")).href + `?install=${randomUUID()}`));
    symlinkSync(canonicalTarget, candidate);
    candidateStat = identity(lstatSync(candidate));
    fsyncSync(bin.fd);
    const currentPrior = inspectTarget(target, prior ? 2 : 1);
    const expectedPrior = prior ? { ...prior, nlink: 2, ...(prior.link ? { sha256: currentPrior?.sha256 } : {}) } : null;
    if (!same(currentPrior, expectedPrior) || inspectTarget(candidate)?.link !== canonicalTarget) throw new Error("Target changed before adoption");
    manifest.candidateIdentity = candidateStat;
    save("prepared");
    checkDirectory(bin); verifyArtifacts();
    adoptionAttempted = true;
    rename(candidate, target);
    adopted = true;
    fsyncSync(bin.fd);
    afterAdoption();
    checkDirectory(bin); verifyArtifacts();
    const installed = inspectTarget(target);
    if (!same(identity(lstatSync(target)), candidateStat) || installed.link !== canonicalTarget
      || installed.sha256 !== artifacts["build-command.js"].sha256) throw new Error("Post-adoption verification failed");
    manifest.installed = installed;
    save("installed");
    checkDirectory(bin); checkDirectory(state);
    releaseLock();
    distribution.commit();
    return { manifest: join(state.path, `ingenium-build-install-${id}.json`), ...manifest };
  } catch (error) {
    try {
      let distributionError;
      try { distribution?.rollback(); } catch (failure) { distributionError = failure; }
      // A rename can complete and still report failure: inspect the pinned directory, never replay it.
      if (adoptionAttempted) {
        const current = present(target);
        if (adopted || (current && same(identity(current), candidateStat))) {
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
      if (distributionError) throw distributionError;
      distribution?.release();
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
