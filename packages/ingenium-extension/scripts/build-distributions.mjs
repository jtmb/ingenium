import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, closeSync, cpSync, existsSync, fsyncSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, rmdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { assertMcpTransportParity } from "./verify-mcp-transport-parity.mjs";

const EXTENSION_EXECUTABLES = [
  "mcp-server", "init-project", "managed-command-wrapper", "recovery-bootstrap",
  "repository-command", "build-command", "coordination-reset", "production-restart", "opencode", "recovery-owner",
].map((name) => `scripts/${name}.js`);
const EXTENSION_REQUIRED = [
  "index.js", "index.d.ts", "config/index.js", "scripts/mcp-transport.js", "scripts/job-run-mcp-client.js", "scripts/job-run-mcp-transport.js", "scripts/workspace-runtime-mcp-client.js", "scripts/workspace-runtime-mcp-transport.js", "scripts/source-snapshot.mjs", ...EXTENSION_EXECUTABLES,
  ...[
    "auto-observer", "observer", "resource-sync", "lifecycle", "ponytail",
  ].flatMap((name) => [
    ...(name === "ponytail" ? [] : [`plugins/${name}.js`]),
    `plugins/v2/${name}/index.js`,
  ]),
];
const SERVER_REQUIRED = ["config/index.js", "lib/client.js", "scripts/mcp-server.js"];

function ownedDirectory(path) {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(path) !== path
    || (process.getuid && stat.uid !== process.getuid()) || (stat.mode & 0o022) !== 0) {
    throw new Error("Distribution build directory is not owner-controlled");
  }
}

function manifest(directory) {
  const entries = {};
  function visit(relative = "") {
    for (const name of readdirSync(join(directory, relative)).sort()) {
      const path = join(relative, name);
      const stat = lstatSync(join(directory, path));
      if (stat.isSymbolicLink()) throw new Error("Distribution contains a symbolic link");
      if (stat.isDirectory()) visit(path);
      else if (stat.isFile()) entries[path] = {
        sha256: createHash("sha256").update(readFileSync(join(directory, path))).digest("hex"),
        mode: stat.mode & 0o777,
      };
      else throw new Error("Distribution contains a non-regular artifact");
    }
  }
  visit();
  return entries;
}

function requireArtifacts(directory, paths) {
  for (const path of paths) {
    const stat = lstatSync(join(directory, path));
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0) throw new Error(`Missing build artifact: ${path}`);
  }
}

function compileTypeScript(repositoryRoot, packageRoot, output) {
  const result = spawnSync(process.execPath, [
    join(repositoryRoot, "node_modules/typescript/bin/tsc"), "--project", join(packageRoot, "tsconfig.json"),
    "--outDir", output,
  ], { cwd: packageRoot, stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("Distribution TypeScript compilation failed");
}

export function buildDistributions({
  repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../.."),
  serverOnly = false,
  outputRoot,
  compile = compileTypeScript,
  parity = assertMcpTransportParity,
  rename = renameSync,
} = {}) {
  const root = realpathSync(repositoryRoot);
  const extension = join(root, "packages/ingenium-extension");
  const server = join(root, "services/ingenium-server");
  // An explicit artifact root reuses the original source/compiler/parity flow
  // while keeping both installed distributions and their rollback sources intact.
  // The caller owns storage admission and process/mount lifetime checks.
  const isolated = outputRoot === undefined ? null : resolve(outputRoot);
  if (isolated) {
    if ([root, extension, server].some(source => relative(isolated, source) === "" || (relative(isolated, source) !== ".." && !relative(isolated, source).startsWith(".." + sep) && !isAbsolute(relative(isolated, source))))) {
      throw new Error("Isolated distribution output overlaps original source");
    }
    ownedDirectory(isolated);
    const marker = join(isolated, ".ingenium-distribution-output.json");
    const identity = JSON.stringify({ schemaVersion: 1, repositoryRoot: root, ownerUid: process.getuid?.() ?? null });
    if (existsSync(marker)) {
      const stat = lstatSync(marker);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || realpathSync(marker) !== marker
        || (process.getuid && stat.uid !== process.getuid()) || (stat.mode & 0o022) !== 0
        || readFileSync(marker, "utf8") !== identity) throw new Error("Isolated distribution identity changed");
    } else {
      if (readdirSync(isolated).length !== 0) throw new Error("Isolated distribution output must be empty or previously owned");
      writeFileSync(marker, identity, { flag: "wx", mode: 0o600 });
    }
  }
  const buildRoot = isolated ? join(isolated, "build") : join(extension, "build");
  mkdirSync(buildRoot, { recursive: true, mode: 0o700 });
  ownedDirectory(buildRoot);
  const lock = join(buildRoot, "distribution-build.lock");
  mkdirSync(lock, { mode: 0o700 });
  const stages = [];
  let journal;
  let rollbackFailed = false;
  const restoreStages = () => {
    const failures = [];
    for (const stage of [...stages].reverse()) {
      try {
        if (stage.adopted) rename(stage.active, stage.candidate);
        if (stage.movedPrevious) rename(stage.previous, stage.active);
        stage.adopted = false;
        stage.movedPrevious = false;
      } catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError(failures, "Distribution rollback incomplete");
  };
  const save = (phase) => {
    if (!journal) return;
    const temporary = `${journal}.tmp`;
    const descriptor = openSync(temporary, "wx", 0o600);
    try {
      writeFileSync(descriptor, `${JSON.stringify({ phase, stages }, null, 2)}\n`);
      fsyncSync(descriptor);
    } finally { closeSync(descriptor); }
    renameSync(temporary, journal);
    const parent = openSync(dirname(journal), "r");
    try { fsyncSync(parent); } finally { closeSync(parent); }
  };
  try {
    for (const packageRoot of serverOnly ? [server] : [server, extension]) {
      ownedDirectory(packageRoot);
      const artifactRoot = isolated ? join(isolated, packageRoot === server ? "server" : "extension") : packageRoot;
      if (isolated) {
        mkdirSync(artifactRoot, { mode: 0o700, recursive: true });
        ownedDirectory(artifactRoot);
        const originalManifest = readFileSync(join(packageRoot, "package.json"));
        const targetManifest = join(artifactRoot, "package.json");
        if (existsSync(targetManifest)) {
          const stat = lstatSync(targetManifest);
          if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || realpathSync(targetManifest) !== targetManifest
            || (process.getuid && stat.uid !== process.getuid()) || (stat.mode & 0o022) !== 0
            || !readFileSync(targetManifest).equals(originalManifest)) throw new Error("Isolated package manifest changed");
        } else writeFileSync(targetManifest, originalManifest, { flag: "wx", mode: 0o444 });
      }
      const parent = join(artifactRoot, "build");
      mkdirSync(parent, { mode: 0o700, recursive: true });
      ownedDirectory(parent);
      const directory = mkdtempSync(join(parent, "distribution-"));
      const active = join(artifactRoot, "dist");
      if (existsSync(active)) ownedDirectory(active);
      stages.push({ packageRoot, directory, active, candidate: join(directory, "candidate"),
        previous: join(directory, "previous"), hadPrevious: existsSync(active), movedPrevious: false, adopted: false });
    }
    journal = join(stages[0].directory, "adoption.json");
    save("compiling");
    for (const stage of stages) {
      mkdirSync(stage.candidate, { mode: 0o700 });
      compile(root, stage.packageRoot, stage.candidate);
    }
    requireArtifacts(stages[0].candidate, SERVER_REQUIRED);
    if (!serverOnly) {
      const candidate = stages[1].candidate;
      for (const directory of ["config", "lib"]) cpSync(join(stages[0].candidate, directory), join(candidate, directory), { recursive: true });
      cpSync(join(stages[0].candidate, "scripts/mcp-server.js"), join(candidate, "scripts/mcp-transport.js"));
      const sourceHelper = join(extension, "scripts/source-snapshot.mjs");
      const helperStat = lstatSync(sourceHelper);
      if (!helperStat.isFile() || helperStat.isSymbolicLink() || helperStat.nlink !== 1
        || helperStat.uid !== process.getuid() || (helperStat.mode & 0o002) !== 0 || helperStat.size < 1
        || helperStat.size > 64 * 1024) throw new Error("Distribution snapshot helper is unsafe");
      const helperBytes = readFileSync(sourceHelper);
      const helperDigest = createHash("sha256").update(helperBytes).digest("hex");
      const packagedHelper = join(candidate, "scripts/source-snapshot.mjs");
      writeFileSync(packagedHelper, helperBytes, { flag: "wx", mode: 0o444 });
      requireArtifacts(candidate, EXTENSION_REQUIRED);
      for (const path of EXTENSION_EXECUTABLES) chmodSync(join(candidate, path), 0o555);
      parity(root, candidate);
      if (createHash("sha256").update(readFileSync(sourceHelper)).digest("hex") !== helperDigest
        || createHash("sha256").update(readFileSync(packagedHelper)).digest("hex") !== helperDigest) {
        throw new Error("Distribution snapshot helper changed");
      }
    }
    for (const stage of stages) {
      stage.candidateManifest = manifest(stage.candidate);
      stage.previousManifest = stage.hadPrevious ? manifest(stage.active) : null;
    }
    save("validated");
    for (const stage of stages) {
      if (stage.hadPrevious) {
        rename(stage.active, stage.previous);
        stage.movedPrevious = true;
        save("adopting");
      }
      rename(stage.candidate, stage.active);
      stage.adopted = true;
      save("adopting");
    }
    save("adopted");
    return { journal, stages };
  } catch (error) {
    try { restoreStages(); } catch { rollbackFailed = true; }
    save(rollbackFailed ? "rollback_failed" : "failed");
    throw error;
  } finally {
    // An interrupted adoption keeps its lock and journal for explicit recovery, never a blind rebuild.
    if (!rollbackFailed) rmdirSync(lock);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some((arg) => arg !== "--server-only") || process.argv.length > 3) throw new Error("Unsupported distribution build arguments");
  const result = buildDistributions({ serverOnly: process.argv[2] === "--server-only" });
  console.log(`Validated distributions adopted; previous artifacts retained at ${result.journal}`);
}
