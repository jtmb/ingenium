import { lstatSync, readdirSync, rmdirSync, unlinkSync, type Stats } from "node:fs";
import { join, resolve } from "node:path";

const ROOTS = ["home", "config", "data", "cache", "state", "tmp"] as const;
const MIB = 1024 * 1024;
const MAX_ENTRIES = 4096;
const MAX_BYTES = 64 * MIB;
type Entry = { path: string; directory: boolean; metadata: Stats };
type Snapshot = { entries: Entry[]; complete: boolean; bytes: number; run: Stats };

function directoryAllowed(root: string, path: string): boolean {
  if (!path) return true;
  if (root === "config") return path === "opencode";
  if (root === "data") return /^opencode(?:\/(?:log|repos|shell(?:\/[a-f0-9]{40})?))?$/.test(path);
  if (root === "cache") return /^(?:bun(?:\/@t@)?|opencode(?:\/bin)?)$/.test(path);
  if (root === "state" || root === "tmp") return path === "opencode";
  return false;
}
function fileMaximum(root: string, path: string, owner: number): number | null {
  if (root === "config" && path === "opencode/opencode.jsonc"
    || root === "data" && path === "opencode/auth.json") return MIB;
  if (root === "data" && /^opencode\/opencode\.db(?:-wal|-shm)?$/.test(path)) return 32 * MIB;
  if (root === "data" && /^opencode\/log\/opencode\.log(?:\.[0-9]+)?$/.test(path)) return 4 * MIB;
  if (root === "cache" && /^bun\/@t@\/[a-f0-9]{16}\.pile$/.test(path)) return 4 * MIB;
  if (root === "tmp" && new RegExp("^\\.bun-" + owner + "-[a-f0-9]{16}\\.(?:so|node)$").test(path)) return 32 * MIB;
  return null;
}
function directoryMode(metadata: Stats, privateRoot: boolean): boolean {
  const mode = metadata.mode & 0o7777;
  return privateRoot ? mode === 0o700 : [0o700, 0o750, 0o770].includes(mode);
}

/**
 * Recognize only the qualified native SDK's per-run artifacts. API umask0007
 * produces0640/0660 files under newly-created0750/0770 SDK directories; every
 * XDG root and its run parent must remain0700 from creation. Credential/config
 * files retain their exact0600 requirement. Unknown entries are retained.
 */
export function inspectJobRuntimeTree(runDir: string, owner: number): Snapshot | null {
  try {
    if (resolve(runDir) !== runDir) return null;
    const run = lstatSync(runDir);
    if (!run.isDirectory() || run.isSymbolicLink() || run.uid !== owner || !directoryMode(run, true)) return null;
    const entries: Entry[] = [];
    let complete = true; let bytes = 0;
    const visit = (root: string, relative: string): void => {
      const path = join(runDir, root, relative);
      const metadata = lstatSync(path);
      if (metadata.uid !== owner || metadata.gid !== run.gid || metadata.dev !== run.dev || metadata.isSymbolicLink()) throw new Error("unsafe");
      if (entries.length >= MAX_ENTRIES) throw new Error("limit");
      if (metadata.isDirectory()) {
        if (!directoryAllowed(root, relative) || !directoryMode(metadata, relative === "") || metadata.nlink < 2) throw new Error("unsafe");
        entries.push({ path, directory: true, metadata });
        for (const name of readdirSync(path)) visit(root, relative ? relative + "/" + name : name);
      } else {
        const maximum = fileMaximum(root, relative, owner);
        const controlFile = root === "config" || root === "data" && relative === "opencode/auth.json";
        const mode = metadata.mode & 0o7777;
        if (!metadata.isFile() || metadata.nlink !== 1 || maximum === null || metadata.size < (controlFile ? 1 : 0)
          || metadata.size > maximum || (controlFile ? mode !== 0o600 : ![0o600, 0o640, 0o660].includes(mode))) throw new Error("unsafe");
        bytes += metadata.size;
        if (bytes > MAX_BYTES) throw new Error("limit");
        entries.push({ path, directory: false, metadata });
      }
    };
    for (const root of ROOTS) {
      try { lstatSync(join(runDir, root)); } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") { complete = false; continue; }
        throw error;
      }
      visit(root, "");
    }
    for (const required of ["config/opencode/opencode.jsonc", "data/opencode/auth.json"]) {
      if (!entries.some((entry) => entry.path === join(runDir, required) && !entry.directory)) complete = false;
    }
    return { entries, complete, bytes, run };
  } catch { return null; }
}
function same(metadata: Stats, expected: Stats, directory: boolean): boolean {
  return metadata.dev === expected.dev && metadata.ino === expected.ino && metadata.uid === expected.uid
    && metadata.gid === expected.gid && metadata.mode === expected.mode && !metadata.isSymbolicLink()
    && (directory ? metadata.isDirectory() : metadata.isFile() && metadata.nlink === 1 && metadata.size === expected.size
      && metadata.mtimeMs === expected.mtimeMs && metadata.ctimeMs === expected.ctimeMs);
}

/** Revalidate every private ancestor and exact inode; remove no open-ended tree. */
export function removeJobRuntimeTree(runDir: string, owner: number, verifyBeforeDelete: () => boolean): boolean {
  const snapshot = inspectJobRuntimeTree(runDir, owner);
  if (!snapshot || !verifyBeforeDelete()) return false;
  const directories = snapshot.entries.filter((entry) => entry.directory);
  const stillInside = (path: string): boolean => {
    if (!same(lstatSync(runDir), snapshot.run, true)) return false;
    return directories.filter((entry) => path.startsWith(entry.path + "/") || path === entry.path)
      .every((entry) => same(lstatSync(entry.path), entry.metadata, true));
  };
  try {
    for (const entry of snapshot.entries.filter((entry) => !entry.directory)) {
      if (!stillInside(entry.path) || !same(lstatSync(entry.path), entry.metadata, false)) return false;
      unlinkSync(entry.path);
    }
    for (const entry of directories.sort((first, second) => second.path.length - first.path.length)) {
      if (!stillInside(entry.path) || !same(lstatSync(entry.path), entry.metadata, true)) return false;
      rmdirSync(entry.path);
    }
    return true;
  } catch { return false; }
}
