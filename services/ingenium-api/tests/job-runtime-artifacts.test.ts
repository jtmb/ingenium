import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmodSync, closeSync, existsSync, linkSync, mkdirSync, mkdtempSync, openSync, readFileSync, renameSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { inspectJobRuntimeTree, removeJobRuntimeTree } from "../lib/job-runtime-artifacts.js";

let parent: string; let run: string;
const owner = process.getuid!();
const fixture = JSON.parse(readFileSync(new URL("./fixtures/job-native-runtime-layout.json", import.meta.url), "utf8")) as {
  entries: Array<{ root: string; path: string; type: string; mode: number; size: number }>;
};
const roots: Record<string, string> = { HOME: "home", XDG_CONFIG_HOME: "config", XDG_DATA_HOME: "data",
  XDG_CACHE_HOME: "cache", XDG_STATE_HOME: "state", TMPDIR: "tmp" };
function file(path: string, bytes = "fixture", mode = 0o600) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, bytes, { mode }); chmodSync(path, mode);
}
beforeEach(() => {
  parent = mkdtempSync(join(tmpdir(), "ingenium-job-runtime-layout-"));
  run = join(parent, "run"); mkdirSync(run, { mode: 0o700 });
  for (const entry of fixture.entries) {
    const path = join(run, roots[entry.root]!, entry.path.replace(".bun-1101-", ".bun-" + owner + "-"));
    if (entry.type === "directory") { mkdirSync(path, { recursive: true, mode: entry.mode }); chmodSync(path, entry.mode); }
    else {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      closeSync(openSync(path, "wx", entry.mode)); chmodSync(path, entry.mode); truncateSync(path, entry.size);
    }
  }
});
afterEach(() => rmSync(parent, { recursive: true, force: true }));

describe("bounded native Job runtime artifacts", () => {
  it("accepts the actual packaged SDK qualification layout and removes it only after the ownership fence", () => {
    const snapshot = inspectJobRuntimeTree(run, owner);
    expect(snapshot).toMatchObject({ complete: true, bytes: 30992330 });
    expect(snapshot?.entries).toHaveLength(fixture.entries.length);
    expect(removeJobRuntimeTree(run, owner, () => true)).toBe(true);
    expect(existsSync(join(run, "data"))).toBe(false);
    expect(existsSync(join(run, "config"))).toBe(false);
    expect(existsSync(run)).toBe(true);
  });
  it("does not remove anything while process ownership is unverified", () => {
    expect(removeJobRuntimeTree(run, owner, () => false)).toBe(false);
    expect(existsSync(join(run, "data/opencode/auth.json"))).toBe(true);
  });
  it.each(["unknown", "symlink", "hardlink", "world-readable-control", "world-writable-directory", "nonprivate-root"])(
    "retains a tree with %s metadata", (kind) => {
      if (kind === "unknown") file(join(run, "home/user-created-output.md"));
      if (kind === "symlink") symlinkSync(parent, join(run, "cache/outside"));
      if (kind === "hardlink") linkSync(join(run, "data/opencode/auth.json"), join(parent, "external-link"));
      if (kind === "world-readable-control") chmodSync(join(run, "data/opencode/auth.json"), 0o644);
      if (kind === "world-writable-directory") chmodSync(join(run, "cache/bun"), 0o777);
      if (kind === "nonprivate-root") chmodSync(join(run, "data"), 0o770);
      expect(inspectJobRuntimeTree(run, owner)).toBeNull();
      expect(removeJobRuntimeTree(run, owner, () => true)).toBe(false);
      expect(existsSync(join(run, "data/opencode/auth.json"))).toBe(true);
    },
  );
  it("does not follow a parent swapped to a symlink after the final ownership fence", () => {
    const outside = join(parent, "moved-cache");
    expect(removeJobRuntimeTree(run, owner, () => {
      renameSync(join(run, "cache"), outside); symlinkSync(outside, join(run, "cache")); return true;
    })).toBe(false);
    expect(existsSync(join(outside, "bun/@t@"))).toBe(true);
  });
  it("rejects aggregate oversized runtime output without deleting it", () => {
    for (const name of ["opencode.db", "opencode.db-wal", "opencode.db-shm"]) {
      const path = join(run, "data/opencode", name); file(path); truncateSync(path, 32 * 1024 * 1024);
    }
    expect(inspectJobRuntimeTree(run, owner)).toBeNull();
    expect(removeJobRuntimeTree(run, owner, () => true)).toBe(false);
  });
});
