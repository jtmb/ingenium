import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

export const SOURCE_ROOTS = [
  "package.json", "package-lock.json", "tsconfig.base.json", "vitest.config.ts", "opencode.json",
  "Dockerfile", "docker-compose.yml", ".dockerignore", ".gitignore", "AGENTS.md", "install-opencode-v2.sh",
  "supervisord.conf", "control-plane-supervisord.conf", "runtime-supervisord.conf",
  "packages", "services", "scripts", "config", "nginx", "docs", "tests",
  ".opencode/agents", ".opencode/commands", ".opencode/skills",
];
export const GENERATED = new Set(["node_modules", "dist", "build", ".next", "coverage", "artifacts", "test-results", "playwright-report"]);
export const PRIVATE = /^(?:\.git(?:$|[.-])|\.env(?:$|\.)|\.ingenium|protected-runtime-index$|\.npmrc$|\.netrc$|\.ssh$|secrets?$|credentials?\.json$|personal-space-backup\.json$)|\.(?:pem|key|p12|pfx|credential|cred|db(?:-.*)?|sqlite(?:3)?(?:-.*)?)$/i;
export const ROADMAP_LEDGER = "docs/reference/ROADMAP.md";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

export function includedSource(path) {
  const name = path.split("/").at(-1);
  return path !== ROADMAP_LEDGER && (!PRIVATE.test(name) || path === "services/ingenium-dashboard/src/app/secrets")
    && !GENERATED.has(name) && !name.endsWith(".tsbuildinfo");
}

export function readPinnedRoadmap(root, head) {
  const git = (args) => execFileSync("/usr/bin/git", ["--no-optional-locks", "-C", root,
    "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", ...args], {
    timeout: 30_000, maxBuffer: 16 * 1024 * 1024,
    env: { PATH: "/usr/bin:/bin", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" },
  });
  const match = /^100644 blob ([0-9a-f]{40})\tdocs\/reference\/ROADMAP\.md\n$/.exec(
    git(["ls-tree", head, "--", ROADMAP_LEDGER]).toString());
  if (!match) throw new Error("Pinned roadmap ledger is missing or unsafe");
  const bytes = git(["cat-file", "blob", match[1]]);
  if (bytes.length > 16 * 1024 * 1024
    || createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex") !== match[1]) {
    throw new Error("Pinned roadmap ledger blob changed");
  }
  return { bytes, sha256: sha256(bytes), mode: 0o644, oid: match[1] };
}

export function readSnapshotFile(path, owner = process.getuid()) {
  if (realpathSync(path) !== path) throw new Error("Snapshot input traverses a symbolic path");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.uid !== owner || before.nlink !== 1 || (before.mode & 0o002)
      || (before.mode & 0o7000) || before.size > 16 * 1024 * 1024) throw new Error("Unsafe snapshot input");
    const bytes = readFileSync(fd);
    for (const after of [fstatSync(fd), lstatSync(path)]) {
      if (!after.isFile() || ["dev", "ino", "uid", "mode", "nlink", "size", "mtimeMs", "ctimeMs"].some(
        (key) => before[key] !== after[key])) throw new Error("Snapshot input changed during read");
    }
    if (realpathSync(path) !== path) throw new Error("Snapshot input traverses a symbolic path");
    return { bytes, mode: before.mode & 0o7777, sha256: sha256(bytes) };
  } finally { closeSync(fd); }
}

export function captureSourceSnapshot(root, expectedHead) {
  if (resolve(root) !== root || realpathSync(root) !== root || !/^[0-9a-f]{40}$/.test(expectedHead)) {
    throw new Error("Snapshot root or HEAD is invalid");
  }
  const directory = (path) => {
    const stat = lstatSync(path);
    if (!stat.isDirectory() || realpathSync(path) !== path || ![0, process.getuid()].includes(stat.uid)
      || (stat.mode & 0o002) && !(stat.uid === 0 && (stat.mode & 0o1000))) {
      throw new Error("Unsafe snapshot source ancestry");
    }
  };
  for (let path = root; ; path = dirname(path)) {
    directory(path);
    if (path === dirname(path)) break;
  }
  const git = (args) => execFileSync("/usr/bin/git", ["--no-optional-locks", "-C", root,
    "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", ...args], {
    encoding: "utf8", timeout: 30_000, maxBuffer: 16 * 1024 * 1024,
    env: { PATH: "/usr/bin:/bin", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" },
  }).trim();
  const head = () => git(["rev-parse", "--verify", "HEAD"]);
  if (git(["rev-parse", "--show-toplevel"]) !== root || head() !== expectedHead) throw new Error("Snapshot HEAD changed");
  if (git(["ls-files", "-v", "-z"]).split("\0").some((entry) => entry && entry[0] !== "H")) {
    throw new Error("Snapshot index hides source");
  }
  const pinnedLedger = readPinnedRoadmap(root, expectedHead);
  readSnapshotFile(join(root, ROADMAP_LEDGER));
  const files = {};
  let totalBytes = 0;
  const walk = (path) => {
    const name = relative(root, path).replaceAll("\\", "/");
    if (!includedSource(name)) return;
    const stat = lstatSync(path);
    if (realpathSync(path) !== path || stat.uid !== process.getuid() || (stat.mode & 0o002)
      || (stat.mode & 0o7000)) throw new Error("Unsafe snapshot source ancestry");
    if (stat.isDirectory()) {
      for (const entry of readdirSync(path).sort()) walk(join(path, entry));
    } else {
      if (!stat.isFile()) throw new Error("Snapshot source is not a regular file");
      const { bytes, mode, sha256: digest } = readSnapshotFile(path);
      totalBytes += bytes.length;
      if (++count > 30_000 || totalBytes > 512 * 1024 * 1024) throw new Error("Snapshot inventory exceeds bounds");
      files[name] = { sha256: digest, mode };
    }
  };
  let count = 0;
  for (const name of SOURCE_ROOTS) {
    const path = join(root, name);
    try { lstatSync(path); } catch (error) { if (error.code === "ENOENT") continue; throw error; }
    for (let parent = dirname(path); parent !== root; parent = dirname(parent)) directory(parent);
    walk(path);
  }
  if (head() !== expectedHead) throw new Error("Snapshot HEAD changed during inventory");
  const inventory = { schemaVersion: 1, repositoryRoot: root, head: expectedHead, files };
  return { inventory, sha256: sha256(JSON.stringify(inventory)),
    ledger: { sha256: pinnedLedger.sha256, mode: pinnedLedger.mode, oid: pinnedLedger.oid } };
}

export function verifySourceSnapshot(root, head, expectedDigest) {
  if (!/^[0-9a-f]{64}$/.test(expectedDigest)) throw new Error("Expected snapshot digest is invalid");
  const snapshot = captureSourceSnapshot(root, head);
  if (snapshot.sha256 !== expectedDigest) throw new Error("Canonical source snapshot changed");
  return snapshot;
}

export function verifyPrivateSnapshotCopy(workspace, inventory, ledger) {
  if (resolve(workspace) !== workspace || realpathSync(workspace) !== workspace
    || (lstatSync(workspace).mode & 0o7777) !== 0o700 || lstatSync(workspace).uid !== process.getuid()
    || inventory?.schemaVersion !== 1 || !inventory.files || typeof inventory.files !== "object") {
    throw new Error("Private source snapshot is invalid");
  }
  const observed = {};
  const walk = (path) => {
    const name = relative(workspace, path).replaceAll("\\", "/");
    if (!includedSource(name)) return;
    const stat = lstatSync(path);
    const expectedMode = stat.isDirectory() ? 0o700 : (inventory.files[name]?.mode & 0o111) ? 0o700 : 0o600;
    if (realpathSync(path) !== path || stat.uid !== process.getuid() || (stat.mode & 0o7777) !== expectedMode) {
      throw new Error("Private snapshot input is unsafe");
    }
    if (stat.isDirectory()) for (const child of readdirSync(path).sort()) walk(join(path, child));
    else {
      const expected = inventory.files[name];
      if (!expected || readSnapshotFile(path).sha256 !== expected.sha256) throw new Error("Private snapshot source changed");
      observed[name] = true;
    }
  };
  for (const name of SOURCE_ROOTS) {
    const path = join(workspace, name);
    try { lstatSync(path); } catch (error) { if (error.code === "ENOENT") continue; throw error; }
    walk(path);
  }
  if (JSON.stringify(Object.keys(observed).sort()) !== JSON.stringify(Object.keys(inventory.files).sort())) {
    throw new Error("Private snapshot inventory changed");
  }
  const path = join(workspace, ROADMAP_LEDGER);
  const file = readSnapshotFile(path);
  if (ledger?.mode !== 0o644 || !/^[0-9a-f]{40}$/.test(ledger.oid ?? "")
    || file.mode !== 0o600 || file.sha256 !== ledger.sha256) {
    throw new Error("Private snapshot roadmap ledger changed");
  }
}
