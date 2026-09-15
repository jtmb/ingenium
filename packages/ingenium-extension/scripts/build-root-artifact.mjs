import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT_BUILD_WORKSPACES = [
  "packages/ingenium-core", "packages/ingenium-email", "packages/ingenium-extension",
  "services/ingenium-api", "services/ingenium-server", "services/ingenium-dashboard",
];
const SOURCE_ROOTS = [
  "package.json", "package-lock.json", "tsconfig.base.json", "vitest.config.ts", "opencode.json",
  "Dockerfile", "docker-compose.yml", ".dockerignore", "README.md",
  "supervisord.conf", "control-plane-supervisord.conf", "runtime-supervisord.conf",
  "packages", "services", "scripts", "config", "nginx", "docs", "tests",
  ".opencode/agents", ".opencode/commands", ".opencode/skills",
];
const GENERATED = new Set(["node_modules", "dist", "build", ".next", "coverage", "artifacts", "test-results", "playwright-report"]);
const PRIVATE = /^(?:\.git(?:$|[.-])|\.env(?:$|\.)|\.ingenium|protected-runtime-index$|\.npmrc$|\.netrc$|\.ssh$|secrets?$|credentials?\.json$|personal-space-backup\.json$)|\.(?:pem|key|p12|pfx|credential|cred|db(?:-.*)?|sqlite(?:3)?(?:-.*)?)$/i;
const PUBLIC_ENVIRONMENT = ["NEXT_PUBLIC_OPENCODE_WEB_URL", "NEXT_PUBLIC_OPENCODE_CLI_URL", "NEXT_PUBLIC_RUNTIME_ROOT_DOMAIN", "NEXT_PUBLIC_RUNTIME_SCHEME", "INGENIUM_API_PORT"];
const OUTPUTS = [
  "packages/ingenium-core/dist/lib/index.js", "packages/ingenium-email/dist/index.js",
  "packages/ingenium-extension/dist/scripts/mcp-server.js", "services/ingenium-api/dist/scripts/api-server.js",
  "services/ingenium-server/dist/scripts/mcp-server.js", "services/ingenium-dashboard/.next/BUILD_ID",
];

function outputManifest(candidate, directory, entries) {
  for (const name of readdirSync(directory).sort()) {
    const path = join(directory, name);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) {
      if (!inside(candidate, realpathSync(path))) throw new Error("Build output link escapes candidate");
      entries[relative(candidate, path)] = { link: relative(candidate, realpathSync(path)) };
    } else if (stat.isDirectory()) outputManifest(candidate, path, entries);
    else entries[relative(candidate, path)] = createHash("sha256").update(readStableFile(path)).digest("hex");
  }
}

function inside(root, path) {
  const value = relative(root, path);
  return value !== "" && value !== ".." && !value.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(value);
}

function readStableFile(path) {
  if (realpathSync(path) !== path) throw new Error("Build input traverses a symbolic path");
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(descriptor);
    if (!before.isFile()) throw new Error("Build input is not a regular file");
    const bytes = readFileSync(descriptor);
    const after = lstatSync(path);
    if (!after.isFile() || before.dev !== after.dev || before.ino !== after.ino || before.size !== bytes.length
      || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
      throw new Error("Build input changed during snapshot");
    }
    return bytes;
  } finally { closeSync(descriptor); }
}

export function verifyInstalledBuildDependencies(root) {
  const manifest = JSON.parse(readStableFile(join(root, "package.json")));
  const lock = JSON.parse(readStableFile(join(root, "package-lock.json")));
  if (JSON.stringify(manifest.workspaces) !== JSON.stringify(ROOT_BUILD_WORKSPACES)
    || JSON.stringify(lock.packages?.[""]?.workspaces) !== JSON.stringify(ROOT_BUILD_WORKSPACES)) {
    throw new Error("Root build workspace inventory does not match the lockfile");
  }
  for (const workspace of ["", ...ROOT_BUILD_WORKSPACES]) {
    const source = JSON.parse(readStableFile(join(root, workspace, "package.json")));
    for (const field of ["dependencies", "devDependencies", "optionalDependencies"]) {
      const declared = source[field] ?? {};
      const locked = lock.packages[workspace]?.[field] ?? {};
      if (Object.keys(declared).length !== Object.keys(locked).length
        || Object.entries(declared).some(([name, version]) => locked[name] !== version)) {
        throw new Error(`Build dependency declaration differs from lockfile: ${workspace || "root"}`);
      }
    }
  }
  let verified = 0;
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!path.includes("node_modules/") || entry.link) continue;
    if (!inside(root, resolve(root, path))) throw new Error("Unsafe dependency lock path");
    if (entry.resolved) {
      const url = new URL(entry.resolved);
      if (url.origin !== "https://registry.npmjs.org" || url.username || url.password || url.search || url.hash) {
        throw new Error("Build lockfile contains an unsupported registry origin");
      }
    }
  }
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!path.includes("node_modules/") || entry.link) continue;
    const installedPath = join(root, path, "package.json");
    if (!existsSync(installedPath) && entry.optional) continue;
    if (!existsSync(installedPath)) throw Object.assign(new Error(`Installed build dependency is missing: ${path}`), { code: "BUILD_DEPENDENCIES_INCOMPLETE" });
    const installed = JSON.parse(readStableFile(installedPath));
    if (installed.version !== entry.version) throw Object.assign(new Error(`Installed build dependency differs from lockfile: ${path}`), { code: "BUILD_DEPENDENCIES_INCOMPLETE" });
    verified += 1;
  }
  return { lock, verified };
}

function copyInputs(root, candidate, source, dependency, hashes) {
  const path = relative(root, source);
  const name = path.split(/[\\/]/).at(-1);
  if ((PRIVATE.test(name) && path !== "services/ingenium-dashboard/src/app/secrets")
    || (!dependency && (GENERATED.has(name) || name.endsWith(".tsbuildinfo")))) return;
  const stat = lstatSync(source);
  const destination = join(candidate, path);
  if (stat.isSymbolicLink()) {
    if (!dependency) throw new Error("Source snapshot refuses symbolic links");
    const target = resolve(dirname(source), readlinkSync(source));
    const targetPath = relative(root, target);
    if (!inside(root, target) || !inside(root, realpathSync(source))
      || !(targetPath.startsWith("node_modules/") || ROOT_BUILD_WORKSPACES.some((workspace) => targetPath === workspace || targetPath.startsWith(`${workspace}/`)))) {
      throw new Error("Dependency link escapes the candidate workspace");
    }
    mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
    symlinkSync(relative(dirname(destination), join(candidate, targetPath)), destination);
    return;
  }
  if (realpathSync(source) !== source) throw new Error("Build input traverses a symbolic directory");
  if (stat.isDirectory()) {
    mkdirSync(destination, { recursive: true, mode: 0o700 });
    for (const entry of readdirSync(source).sort()) copyInputs(root, candidate, join(source, entry), dependency, hashes);
    return;
  }
  if (!stat.isFile()) throw new Error("Build input is not a regular file");
  const bytes = readStableFile(source);
  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
  writeFileSync(destination, bytes, { flag: "wx", mode: stat.mode & 0o111 ? 0o700 : 0o600 });
  if (!dependency) hashes[path] = createHash("sha256").update(bytes).digest("hex");
}

export function buildRootArtifact({
  repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../.."),
  runner = spawnSync,
  installer = spawnSync,
} = {}) {
  const root = realpathSync(repositoryRoot);
  let dependencies;
  try { dependencies = verifyInstalledBuildDependencies(root); } catch (error) {
    if (error.code !== "BUILD_DEPENDENCIES_INCOMPLETE") throw error;
  }
  const parent = join(root, "build");
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const parentStat = lstatSync(parent);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink() || realpathSync(parent) !== parent
    || (process.getuid && parentStat.uid !== process.getuid()) || (parentStat.mode & 0o022)) throw new Error("Build artifact root is not private");
  const directory = mkdtempSync(join(parent, "root-artifact-"));
  const candidate = join(directory, "workspace");
  const manifestPath = join(directory, "manifest.json");
  const manifest = { version: 1, status: "snapshotting", workspaces: ROOT_BUILD_WORKSPACES,
    dependencyCount: dependencies?.verified ?? 0, dependencyPreparation: dependencies ? "copy" : "npm-ci", sourceSha256: {}, outputs: {} };
  const save = () => {
    writeFileSync(`${manifestPath}.tmp`, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    renameSync(`${manifestPath}.tmp`, manifestPath);
  };
  save();
  console.log(JSON.stringify({ directory, candidate, manifestPath }));
  try {
    mkdirSync(candidate, { mode: 0o700 });
    for (const path of SOURCE_ROOTS) {
      if (existsSync(join(root, path))) copyInputs(root, candidate, join(root, path), false, manifest.sourceSha256);
    }
    for (const name of [".home", ".tmp", ".cache"]) mkdirSync(join(candidate, name), { mode: 0o700 });
    const options = {
      cwd: candidate, shell: false, stdio: "inherit",
      env: { PATH: `${join(candidate, "node_modules/.bin")}:${dirname(process.execPath)}:/usr/bin:/bin`,
        HOME: join(candidate, ".home"), TMPDIR: join(candidate, ".tmp"), XDG_CACHE_HOME: join(candidate, ".cache"),
        npm_config_cache: join(candidate, ".cache/npm"), PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1",
        CI: "1", NEXT_TELEMETRY_DISABLED: "1",
        ...Object.fromEntries(PUBLIC_ENVIRONMENT.flatMap((name) => process.env[name] === undefined ? [] : [[name, process.env[name]]])),
      },
    };
    if (dependencies) {
      for (const workspace of ["", ...ROOT_BUILD_WORKSPACES]) {
        const path = join(root, workspace, "node_modules");
        if (existsSync(path)) copyInputs(root, candidate, path, true, {});
      }
    } else {
      manifest.status = "installing";
      save();
      const installed = installer(join(dirname(process.execPath), "npm"), ["ci", "--prefer-offline", "--no-audit", "--no-fund", "--include=dev"], options);
      if (installed.error || installed.status !== 0) throw new Error("Candidate dependency installation failed");
      manifest.dependencyCount = verifyInstalledBuildDependencies(candidate).verified;
      if (createHash("sha256").update(readStableFile(join(candidate, "package-lock.json"))).digest("hex") !== manifest.sourceSha256["package-lock.json"]) {
        throw new Error("Candidate installation changed the lockfile");
      }
    }
    for (const workspace of ROOT_BUILD_WORKSPACES) {
      const name = JSON.parse(readStableFile(join(candidate, workspace, "package.json"))).name;
      if (realpathSync(join(candidate, "node_modules", name)) !== join(candidate, workspace)) {
        throw new Error("Build workspace dependency does not resolve to candidate source");
      }
    }
    for (const [path, expected] of Object.entries(manifest.sourceSha256)) {
      if (createHash("sha256").update(readStableFile(join(root, path))).digest("hex") !== expected) throw new Error("Canonical source changed during snapshot");
    }
    manifest.status = "building";
    save();
    const result = runner(join(dirname(process.execPath), "npm"), ["run", "build", "--workspaces", "--if-present"], options);
    if (result.error || result.status !== 0) throw new Error("Isolated workspace build failed");
    for (const path of OUTPUTS) readStableFile(join(candidate, path));
    for (const workspace of ROOT_BUILD_WORKSPACES) {
      outputManifest(candidate, join(candidate, workspace, workspace.endsWith("ingenium-dashboard") ? ".next" : "dist"), manifest.outputs);
    }
    manifest.status = "complete";
    save();
    return { directory, candidate, manifestPath };
  } catch (error) {
    manifest.status = "failed";
    save();
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) throw new Error("Root artifact build accepts no arguments");
  console.log(JSON.stringify(buildRootArtifact()));
}
