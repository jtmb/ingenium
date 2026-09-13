import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, fchmodSync, fstatSync, fsyncSync, lstatSync, openSync,
  mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const extensionRelative = "packages/ingenium-extension";
const sourceRelative = `${extensionRelative}/scripts/recovery-bootstrap.js`;
const launcherNames = ["ingenium-build", "ingenium-opencode"];
const releaseClosure = ["package.json", "context-upload-codec.mjs", "dist/replacement-first-restart.js",
  "dist/scripts/build-command.js", "dist/scripts/managed-command-wrapper.js"];
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

function readRegular(path, owner, mode, links = 1, allowSharedAclMode = false) {
  const before = lstatSync(path);
  const permissions = before.mode & 0o7777;
  if (!before.isFile() || before.uid !== owner || before.nlink !== links
    || (allowSharedAclMode ? ![0o644, 0o674].includes(permissions) : (before.mode & 0o7022) !== 0)
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

function packageLauncherEntries(bytes) {
  const bin = JSON.parse(bytes).bin;
  const entries = {};
  for (const name of launcherNames) {
    const entry = bin?.[name];
    if (typeof entry !== "string" || !entry.startsWith("./dist/scripts/") || !entry.endsWith(".js")
      || entry.slice("./dist/scripts/".length, -3).includes("/")) throw new Error("Package launcher declaration is invalid");
    entries[name] = entry.slice(2);
  }
  return entries;
}

function privateClosure(packageBytes) {
  return [...new Set([...releaseClosure, ...Object.values(packageLauncherEntries(packageBytes))])];
}

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

async function bundlePrivateLauncher(workspace, source) {
  const esbuild = await import(pathToFileURL(join(workspace, "node_modules/esbuild/lib/main.js")).href);
  const result = await esbuild.build({ entryPoints: [source], bundle: true, platform: "node", format: "esm",
    target: "node18", write: false, logLevel: "silent" });
  if (result.outputFiles?.length !== 1 || !result.outputFiles[0].contents.length) {
    throw new Error("Private launcher bundle is incomplete");
  }
  return Buffer.from(result.outputFiles[0].contents);
}

export async function buildPrivateClosure(root, head, parent, sourceBytes, runNpm = execFileSync,
  bundle = bundlePrivateLauncher) {
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
  const packageBytes = readFileSync(join(packageRoot, "package.json"));
  const entries = packageLauncherEntries(packageBytes);
  const output = {};
  for (const relative of releaseClosure) {
    if (!relative.startsWith("dist/")) output[relative] = readFileSync(join(packageRoot, relative));
    else {
      const source = relative.slice(5).replace(/\.js$/, ".ts");
      output[relative] = Buffer.from(ts.transpileModule(readFileSync(join(packageRoot, source), "utf8"), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
      }).outputText);
    }
  }
  const opencodeEntry = entries["ingenium-opencode"];
  const opencodeSource = opencodeEntry.slice("dist/".length, -3) + ".ts";
  output[opencodeEntry] = await bundle(stage.workspace, join(packageRoot, opencodeSource));
  return output;
}

function launcherBytes(node, nodeSha256, release, root, home, entry, verifier, isolatedEnvironment) {
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
process.argv = [process.execPath, ${JSON.stringify(entry)}, ...process.argv.slice(1)];
await import(${JSON.stringify(pathToFileURL(entry).href)});`;
  const names = ["CI", "FORCE_COLOR", "NO_COLOR", "TERM", "INGENIUM_API_URL", "INGENIUM_MCP_AUDIENCE",
    "INGENIUM_MCP_CREDENTIAL_FILE", "INGENIUM_MCP_CREDENTIAL_PURPOSE", "INGENIUM_PROJECT", "INGENIUM_PROJECT_ID",
    "INGENIUM_RECOVERY_OWNER_NONCE", "INGENIUM_RECOVERY_OWNER_PID", "INGENIUM_RECOVERY_OWNER_START_TICKS",
    "INGENIUM_STORAGE_MAPPING_HASH", "INGENIUM_WORKSPACE_ID"];
  const environment = isolatedEnvironment
    ? `-i HOME=${quote(home)} PATH=${quote(`${dirname(node)}:/usr/bin:/bin`)} ${names.map((name) => `"${name}=\${${name}-}"`).join(" ")}`
    : `HOME=${quote(home)} PATH=${quote(`${dirname(node)}:/usr/bin:/bin`)}`;
  return Buffer.from(`#!/bin/sh\nset -eu\nunset ENV BASH_ENV CDPATH LD_PRELOAD LD_LIBRARY_PATH NODE_OPTIONS NODE_PATH\n${runtimeChecks.join("\n")}\ncd ${quote(root)}\nnode_hash=$(/usr/bin/env -i PATH=/usr/bin:/bin /usr/bin/sha256sum -- ${quote(node)})\n[ "$node_hash" = ${quote(`${nodeSha256}  ${node}`)} ] || exit 1\nexec /usr/bin/env ${environment} ${quote(node)} --input-type=module --eval ${quote(code)} -- "$@"\n`);
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
  let launchers = [];
  const adoptionAttempted = new Set();
  let rollbackFailed = false;
  const backupAttempted = new Set();
  const inspectTarget = (path) => {
    const stat = present(path);
    if (!stat) return null;
    if (stat.uid !== owner || stat.nlink !== 1) throw new Error("Unsafe existing target");
    if (stat.isSymbolicLink()) {
      // The prior link is rollback metadata, never authority for executable bytes.
      const bytes = readlinkSync(path, { encoding: "buffer" });
      const repeated = readlinkSync(path, { encoding: "buffer" });
      const after = lstatSync(path);
      if (!same(identity(after), identity(stat)) || after.size !== stat.size
        || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs
        || !repeated.equals(bytes)) throw new Error("Target symlink changed");
      return { ...identity(stat), link: bytes.toString(), linkBytes: bytes.toString("base64") };
    }
    const file = readRegular(path, owner);
    return { ...identity(stat), sha256: file.sha256 };
  };
  const releaseLock = () => {
    for (const launcher of launchers) {
      if (launcher.candidate && present(launcher.candidate)
        && same(identity(lstatSync(launcher.candidate)), launcher.candidateStat)) unlinkSync(launcher.candidate);
    }
    if (launchers.length) fsyncSync(bin.fd);
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
    const priorByName = Object.fromEntries(launcherNames.map((name) => [name, inspectTarget(`${bin.anchored}/${name}`)]));
    verifyHead(root.path, expectedHead);
    const extensionDirectory = openDirectory(join(root.path, extensionRelative), descriptors, owner, true);
    const sourceDirectory = openDirectory(join(root.path, extensionRelative, "scripts"), descriptors, owner, true);
    const source = () => {
      checkDirectory(sourceDirectory);
      const value = readRegular(`${sourceDirectory.anchored}/recovery-bootstrap.js`, owner, 0o644);
      if (!value.bytes.equals(git(root.path, ["show", `${expectedHead}:${sourceRelative}`]))) throw new Error("Bootstrap source mismatch");
      return value;
    };
    const verifiedSource = source();
    const sourceSha256 = verifiedSource.sha256;
    const trackedInputs = [];
    const trackedInput = (directory, relative, repositoryRelative, label) => {
      const bytes = git(root.path, ["show", `${expectedHead}:${repositoryRelative}`]);
      checkDirectory(directory);
      const value = readRegular(`${directory.anchored}/${relative}`, owner, undefined, 1, true);
      if (!value.bytes.equals(bytes)) throw new Error(`${label} source mismatch`);
      const input = { directory, relative, label, bytes, fileIdentity: identity(value),
        manifest: { path: join(directory.path, relative), sha256: sha256(bytes), mode: value.mode & 0o7777 } };
      trackedInputs.push(input);
      return input;
    };
    const revalidateTrackedInputs = () => {
      for (const input of trackedInputs) {
        checkDirectory(input.directory);
        const value = readRegular(`${input.directory.anchored}/${input.relative}`, owner, undefined, 1, true);
        if (!same(identity(value), input.fileIdentity) || !value.bytes.equals(input.bytes)) {
          throw new Error(`${input.label} source changed`);
        }
      }
    };
    const packageInput = trackedInput(extensionDirectory, "package.json", `${extensionRelative}/package.json`, "Package");
    const entries = packageLauncherEntries(packageInput.bytes);
    const wrapperSources = {};
    for (const name of launcherNames) {
      const relative = entries[name].slice("dist/".length, -3) + ".ts";
      wrapperSources[name] = trackedInput(extensionDirectory, relative, `${extensionRelative}/${relative}`, "Launcher").manifest;
    }
    let parent = openDirectory(join(home, ".local"), descriptors, owner);
    for (const name of ["share", "ingenium", "host-build", "releases"]) {
      const child = join(parent.path, name);
      if (!present(child)) { mkdirSync(`${parent.anchored}/${name}`, { mode: 0o700 }); fsyncSync(parent.fd); }
      parent = openDirectory(child, descriptors, owner);
      if (name !== "share" && (fstatSync(parent.fd).mode & 0o7777) !== 0o700) throw new Error("Private release parent mode is invalid");
    }
    const releasePath = join(parent.path, expectedHead);
    const id = randomUUID();
    launchers = launcherNames.map((name) => ({
      name,
      target: `${bin.anchored}/${name}`,
      prior: priorByName[name],
      backup: `${bin.anchored}/.${name}-${id}.previous`,
      candidate: `${bin.anchored}/.${name}-${id}.candidate`,
    }));
    const buildLauncher = launchers[0];
    const canonicalTarget = join(releasePath, entries["ingenium-build"]);
    manifestPath = `${state.anchored}/ingenium-build-install-${id}.json`;
    manifest = { schemaVersion: 2, head: expectedHead, repositoryRoot: root.path, owner,
      target: join(bin.path, "ingenium-build"), canonicalTarget, source: { path: join(root.path, sourceRelative), sha256: sourceSha256 },
      packageSource: packageInput.manifest, artifacts: {}, releasePath, prior: buildLauncher.prior,
      backup: buildLauncher.prior ? join(bin.path, `.ingenium-build-${id}.previous`) : null,
      candidate: join(bin.path, `.ingenium-build-${id}.candidate`),
      launchers: Object.fromEntries(launchers.map((launcher) => [launcher.name, {
        target: join(bin.path, launcher.name), packageBin: `./${entries[launcher.name]}`,
        source: wrapperSources[launcher.name], prior: launcher.prior,
        backup: launcher.prior ? join(bin.path, `.${launcher.name}-${id}.previous`) : null,
        candidate: join(bin.path, `.${launcher.name}-${id}.candidate`),
      }])), timestamp: new Date().toISOString() };
    save("preparing");
    manifest.backupMetadata = buildLauncher.prior;
    save("building");
    const result = build ? await build(root.path) : await buildPrivateClosure(root.path, expectedHead,
      dirname(parent.path), verifiedSource.bytes);
    revalidateTrackedInputs();
    const closure = privateClosure(packageInput.bytes);
    if (!same(Object.keys(result).sort(), [...closure].sort()) || Object.values(result).some((bytes) => !Buffer.isBuffer(bytes) || !bytes.length)
      || !result["package.json"].equals(packageInput.bytes)) {
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
      revalidateTrackedInputs();
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
      ["dist", ["replacement-first-restart.js", "scripts"]],
      ["dist/scripts", ["build-command.js", "managed-command-wrapper.js", "opencode.js"]]]) {
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
    const verifier = wrapperSource.slice(start + "export ".length, end).trim();
    for (const launcher of launchers) {
      launcher.bytes = launcherBytes(nodePath, node.sha256, releasePath, root.path, home,
        join(releasePath, entries[launcher.name]), verifier, launcher.name === "ingenium-build");
      const candidateFd = openSync(launcher.candidate, "wx", 0o500);
      try { fchmodSync(candidateFd, 0o500); writeFileSync(candidateFd, launcher.bytes); fsyncSync(candidateFd); }
      finally { closeSync(candidateFd); }
      launcher.candidateStat = identity(lstatSync(launcher.candidate));
      manifest.launchers[launcher.name].artifact = {
        path: join(releasePath, entries[launcher.name]), sha256: sha256(result[entries[launcher.name]]), mode: 0o400,
      };
      manifest.launchers[launcher.name].launcher = { sha256: sha256(launcher.bytes), mode: 0o500 };
      manifest.launchers[launcher.name].candidateIdentity = launcher.candidateStat;
    }
    fsyncSync(bin.fd);
    if (launchers.some((launcher) => !same(inspectTarget(launcher.target), launcher.prior)
      || readRegular(launcher.candidate, owner, 0o500).sha256 !== sha256(launcher.bytes))) {
      throw new Error("Target changed before adoption");
    }
    manifest.candidateIdentity = buildLauncher.candidateStat;
    save("prepared");
    checkDirectory(bin); verifyArtifacts();
    if (launchers.some((launcher) => !same(inspectTarget(launcher.target), launcher.prior) || present(launcher.backup))) {
      throw new Error("Prior target changed before backup");
    }
    for (const launcher of launchers) {
      if (!launcher.prior) continue;
      backupAttempted.add(launcher.name);
      renameSync(launcher.target, launcher.backup);
      fsyncSync(bin.fd);
      if (present(launcher.target) || !same(inspectTarget(launcher.backup), launcher.prior)) throw new Error("Prior backup changed");
    }
    for (const launcher of launchers) {
      adoptionAttempted.add(launcher.name);
      rename(launcher.candidate, launcher.target);
      fsyncSync(bin.fd);
    }
    afterAdoption();
    checkDirectory(bin); verifyArtifacts();
    wrapper.verifyPrivateBuildRelease(releasePath, home);
    for (const launcher of launchers) {
      const installed = inspectTarget(launcher.target);
      if (!same(identity(lstatSync(launcher.target)), launcher.candidateStat)
        || installed.sha256 !== sha256(launcher.bytes) || (installed.mode & 0o7777) !== 0o500) {
        throw new Error("Post-adoption verification failed");
      }
      manifest.launchers[launcher.name].installed = installed;
    }
    manifest.installed = manifest.launchers["ingenium-build"].installed;
    save("installed");
    checkDirectory(bin); checkDirectory(state);
    releaseLock();
    return { manifest: join(state.path, `ingenium-build-install-${id}.json`), ...manifest };
  } catch (error) {
    try {
      // A rename can complete and still report failure: inspect the pinned directory, never replay it.
      if (backupAttempted.size || adoptionAttempted.size) {
        for (const launcher of launchers) {
          const current = inspectTarget(launcher.target);
          if (launcher.prior) {
            const backedUp = same(inspectTarget(launcher.backup), launcher.prior);
            if (backedUp && current && !same(identity(current), launcher.candidateStat)) {
              throw new Error("Unknown adoption outcome; retained backup and lock");
            }
            if (!backedUp && (present(launcher.backup) || !same(current, launcher.prior))) {
              throw new Error("Backup changed before rollback");
            }
          } else if (current && !same(identity(current), launcher.candidateStat)) {
            throw new Error("Unknown adoption outcome; retained backup and lock");
          }
        }
        for (const launcher of [...launchers].reverse()) {
          const current = inspectTarget(launcher.target);
          if (launcher.prior && same(inspectTarget(launcher.backup), launcher.prior)) {
            try { renameSync(launcher.backup, launcher.target); } catch (failure) {
              if (present(launcher.backup) || !same(inspectTarget(launcher.target), launcher.prior)) throw failure;
            }
          } else if (!launcher.prior && current && same(identity(current), launcher.candidateStat)) {
            unlinkSync(launcher.target);
          }
        }
        fsyncSync(bin.fd);
        if (launchers.some((launcher) => !same(inspectTarget(launcher.target), launcher.prior))) {
          throw new Error("Rollback readback failed");
        }
        checkDirectory(bin);
      }
      if (manifest && launchers.some((launcher) => !same(inspectTarget(launcher.target), launcher.prior))) {
        throw new Error("Pre-build host entry was not restored");
      }
      if (manifest) save(adoptionAttempted.size ? "rolled_back" : "failed");
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
