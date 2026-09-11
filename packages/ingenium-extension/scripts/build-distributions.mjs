import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, closeSync, cpSync, existsSync, fsyncSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, rmdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertMcpTransportParity } from "./verify-mcp-transport-parity.mjs";

const EXTENSION_EXECUTABLES = [
  "mcp-server", "init-project", "managed-command-wrapper", "recovery-bootstrap",
  "repository-command", "build-command", "coordination-reset", "production-restart", "opencode", "recovery-owner",
].map((name) => `scripts/${name}.js`);
const EXTENSION_REQUIRED = [
  "index.js", "index.d.ts", "config/index.js", "scripts/mcp-transport.js", ...EXTENSION_EXECUTABLES,
  ...["auto-observer", "observer", "resource-sync", "session-coordinator"].map((name) => `plugins/${name}.js`),
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
  compile = compileTypeScript,
  parity = assertMcpTransportParity,
  rename = renameSync,
} = {}) {
  const root = realpathSync(repositoryRoot);
  const extension = join(root, "packages/ingenium-extension");
  const server = join(root, "services/ingenium-server");
  const buildRoot = join(extension, "build");
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
      const parent = join(packageRoot, "build");
      mkdirSync(parent, { mode: 0o700, recursive: true });
      ownedDirectory(parent);
      const directory = mkdtempSync(join(parent, "distribution-"));
      const active = join(packageRoot, "dist");
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
      requireArtifacts(candidate, EXTENSION_REQUIRED);
      for (const path of EXTENSION_EXECUTABLES) chmodSync(join(candidate, path), 0o555);
      parity(root, candidate);
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
