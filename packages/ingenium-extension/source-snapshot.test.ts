import { execFileSync } from "node:child_process";
import { chmodSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
// @ts-expect-error Source snapshotting is a Node entrypoint.
import { captureSourceSnapshot, verifySourceSnapshot } from "./scripts/source-snapshot.mjs";

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "ingenium-source-snapshot-"));
  directories.push(root);
  mkdirSync(join(root, "packages"));
  mkdirSync(join(root, "docs/reference"), { recursive: true });
  writeFileSync(join(root, "docs/reference/ROADMAP.md"), "initial ledger\n", { mode: 0o644 });
  writeFileSync(join(root, "package.json"), "{}\n");
  const file = join(root, "packages", "source.ts");
  writeFileSync(file, "original\n");
  const git = (args: string[]) => execFileSync("/usr/bin/git", ["-C", root, ...args], {
    encoding: "utf8", env: { PATH: "/usr/bin:/bin", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
  }).trim();
  git(["init", "--quiet"]); git(["add", "."]);
  git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "snapshot"]);
  return { root, file, git, head: git(["rev-parse", "HEAD"]) };
}

it("attests dirty, untracked and ignored generated inputs without treating a builder manifest as authority", () => {
  const f = fixture();
  writeFileSync(f.file, "modified\n");
  writeFileSync(join(f.root, "packages", "new.ts"), "new\n");
  mkdirSync(join(f.root, "packages", "dist"));
  writeFileSync(join(f.root, "packages", "dist", "generated.js"), "ignored\n");
  const pinned = captureSourceSnapshot(f.root, f.head);
  expect(Object.keys(pinned.inventory.files).sort()).toEqual(["package.json", "packages/new.ts", "packages/source.ts"]);
  expect(verifySourceSnapshot(f.root, f.head, pinned.sha256)).toEqual(pinned);
  writeFileSync(join(f.root, "packages", "dist", "generated.js"), "changed\n");
  expect(verifySourceSnapshot(f.root, f.head, pinned.sha256)).toEqual(pinned);
  writeFileSync(f.file, "MODIFIED\n");
  expect(() => verifySourceSnapshot(f.root, f.head, pinned.sha256)).toThrow("changed");
});

it("keeps the exact committed roadmap ledger pinned separately across authorized append", () => {
  const f = fixture();
  const roadmap = join(f.root, "docs/reference/ROADMAP.md");
  const pinned = captureSourceSnapshot(f.root, f.head);
  expect(pinned.inventory.files).not.toHaveProperty("docs/reference/ROADMAP.md");
  expect(pinned.ledger).toMatchObject({ mode: 0o644 });
  writeFileSync(roadmap, "initial ledger\nauthorized append\n");
  expect(verifySourceSnapshot(f.root, f.head, pinned.sha256)).toEqual(pinned);
  writeFileSync(join(f.root, "opencode.json"), "{\"agent\":{}}\n");
  expect(() => verifySourceSnapshot(f.root, f.head, pinned.sha256)).toThrow("changed");
  rmSync(join(f.root, "opencode.json"));
  writeFileSync(f.file, "changed executable\n");
  expect(() => verifySourceSnapshot(f.root, f.head, pinned.sha256)).toThrow("changed");
});

it.each(["extra", "missing", "symlink", "hardlink", "unsafe-mode", "head", "hidden-index"])("rejects %s source drift", (kind) => {
  const f = fixture();
  const pinned = captureSourceSnapshot(f.root, f.head);
  if (kind === "extra") writeFileSync(join(f.root, "packages", "extra.ts"), "new");
  if (kind === "missing") rmSync(f.file);
  if (kind === "symlink") { rmSync(f.file); symlinkSync(join(f.root, "package.json"), f.file); }
  if (kind === "hardlink") linkSync(f.file, join(f.root, "packages", "hardlink.ts"));
  if (kind === "unsafe-mode") chmodSync(f.file, 0o666);
  if (kind === "head") gitNext(f.git);
  if (kind === "hidden-index") f.git(["update-index", "--assume-unchanged", "packages/source.ts"]);
  expect(() => verifySourceSnapshot(f.root, f.head, pinned.sha256)).toThrow();
});

it("rejects an unsafe ancestor of a declared nested root before inventory", () => {
  const f = fixture();
  const opencode = join(f.root, ".opencode");
  mkdirSync(join(opencode, "agents"), { recursive: true });
  writeFileSync(join(opencode, "agents", "agent.md"), "trusted\n");
  chmodSync(opencode, 0o777);
  expect(() => captureSourceSnapshot(f.root, f.head)).toThrow("Unsafe snapshot source ancestry");
});

function gitNext(git: (args: string[]) => string) {
  git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "--allow-empty", "-m", "next"]);
}
