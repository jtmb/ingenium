import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
const { RECOVERY_BOOTSTRAP_CHECKS, runRecoveryBootstrap, verifyRecoveryBuildStage } =
  await vi.importActual<typeof import("./scripts/recovery-bootstrap.js")>("./scripts/recovery-bootstrap.ts");

const fixtures: string[] = [];
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
afterEach(() => {
  for (const path of fixtures.splice(0)) {
    const shared = join(path, "repository/packages/ingenium-extension/dist");
    if (existsSync(shared)) chmodSync(shared, 0o700);
    rmSync(path, { recursive: true, force: true });
  }
});

async function fixture() {
  const shim = await import(/* @vite-ignore */ `${new URL("./scripts/recovery-bootstrap.js", import.meta.url).href}?private-stage=1`);
  const base = mkdtempSync(join(tmpdir(), "ingenium-private-recovery-"));
  fixtures.push(base);
  const root = join(base, "repository");
  const parent = join(base, "staging");
  const scripts = join(root, "packages/ingenium-extension/scripts");
  mkdirSync(scripts, { recursive: true, mode: 0o775 });
  mkdirSync(parent, { mode: 0o700 });
  for (const path of [root, dirname(dirname(scripts)), dirname(scripts), scripts]) chmodSync(path, 0o775);
  const source = join(scripts, "recovery-bootstrap.js");
  writeFileSync(source, "export {};\n", { mode: 0o644 });
  writeFileSync(join(root, "package.json"), '{"type":"module"}\n', { mode: 0o644 });
  writeFileSync(join(root, ".gitignore"), "**/dist/\n", { mode: 0o644 });
  const git = (args: string[]) => execFileSync("/usr/bin/git", ["-C", root, ...args], {
    encoding: "utf8", env: { PATH: "/usr/bin:/bin", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
  }).trim();
  git(["init", "--quiet"]); git(["add", "."]);
  git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "archive fixture"]);
  const head = git(["rev-parse", "HEAD"]);
  const stage = (stageParent = parent) => shim.createPrivateRecoveryStage(root, head, stageParent);
  const environment = (staged: any) => ({
    INGENIUM_WORKTREE: root, INGENIUM_RECOVERY_CANONICAL_WORKTREE: root,
    INGENIUM_RECOVERY_STAGE_DIRECTORY: staged.directory,
    INGENIUM_RECOVERY_STAGE_SHA256: staged.manifestSha256,
    INGENIUM_ADMITTED_RECOVERY_CONTEXT: JSON.stringify({ head, binding: { worktree: root } }),
  });
  return { root, parent, source, head, git, stage, environment };
}

describe("private recovery archive staging", () => {
  it("archives exact HEAD, verifies every source blob, and never changes shared directory modes", async () => {
    const f = await fixture();
    const shared = join(dirname(dirname(f.source)), "dist");
    mkdirSync(shared, { mode: 0o575 });
    chmodSync(shared, 0o575);
    const staged = f.stage();
    expect(verifyRecoveryBuildStage(f.environment(staged))).toBe(staged.workspace);
    expect(lstatSync(f.root).mode & 0o7777).toBe(0o775);
    expect(lstatSync(shared).mode & 0o7777).toBe(0o575);
    expect(lstatSync(staged.directory).mode & 0o7777).toBe(0o700);
    expect(lstatSync(staged.manifestPath).mode & 0o7777).toBe(0o400);
    expect(staged.manifest.archiveSha256).toBe(hash(readFileSync(join(staged.directory, "source.tar"))));
    expect(readFileSync(join(staged.workspace, "packages/ingenium-extension/scripts/recovery-bootstrap.js"))).toEqual(readFileSync(f.source));
    expect(execFileSync("/usr/bin/git", ["-C", staged.workspace, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()).toBe(f.head);
    expect(execFileSync("/usr/bin/git", ["-C", staged.workspace, "status", "--porcelain"], { encoding: "utf8" }).trim()).toBe("");
  });

  it.each(["dirty", "hidden", "symlink", "hardlink", "head"])("rejects %s source before build execution", async (failure) => {
    const f = await fixture();
    if (failure === "dirty" || failure === "hidden") writeFileSync(f.source, "unreviewed\n");
    if (failure === "hidden") f.git(["update-index", "--assume-unchanged", "packages/ingenium-extension/scripts/recovery-bootstrap.js"]);
    if (failure === "symlink") { renameSync(f.source, join(f.parent, "source")); symlinkSync(join(f.parent, "source"), f.source); }
    if (failure === "hardlink") linkSync(f.source, join(f.parent, "linked"));
    if (failure === "head") f.git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "--allow-empty", "-m", "next"]);
    expect(() => f.stage()).toThrow();
    expect(lstatSync(f.root).mode & 0o7777).toBe(0o775);
  });

  it("rejects staging beneath a shared ancestor without changing its permissions", async () => {
    const f = await fixture();
    const shared = join(f.parent, "shared");
    const privateChild = join(shared, "private");
    mkdirSync(shared, { mode: 0o775 }); chmodSync(shared, 0o775);
    mkdirSync(privateChild, { mode: 0o700 });
    expect(() => f.stage(privateChild)).toThrow("ancestry is unsafe");
    expect(readdirSync(privateChild)).toEqual([]);
    expect(lstatSync(shared).mode & 0o7777).toBe(0o775);
  });

  it("rejects a shared executable even when its hash and private stage provenance are valid", async () => {
    const f = await fixture();
    const staged = f.stage();
    const runner = vi.fn();
    expect(() => runRecoveryBootstrap([process.execPath, f.source], runner, undefined, {
      ...f.environment(staged), INGENIUM_RECOVERY_GENERATED_BOOTSTRAP_SHA256: hash(readFileSync(f.source)),
    })).toThrow("outside the private stage");
    expect(runner).not.toHaveBeenCalled();
  });

  it.each(["archive", "manifest", "source", "mode", "link", "node", "binding", "head"])("rejects staged %s drift before any generated check", async (failure) => {
    const f = await fixture();
    const staged = f.stage();
    const env = f.environment(staged);
    const manifest = JSON.parse(readFileSync(staged.manifestPath, "utf8"));
    const source = join(staged.workspace, "package.json");
    if (failure === "archive") { const path = join(staged.directory, "source.tar"); chmodSync(path, 0o600); writeFileSync(path, "bad archive"); chmodSync(path, 0o400); }
    if (failure === "manifest") env.INGENIUM_RECOVERY_STAGE_SHA256 = "0".repeat(64);
    if (failure === "source") writeFileSync(source, "changed source");
    if (failure === "mode") chmodSync(staged.workspace, 0o775);
    if (failure === "link") linkSync(source, join(f.parent, "linked"));
    if (failure === "node") {
      manifest.node.sha256 = "0".repeat(64);
      chmodSync(staged.manifestPath, 0o600); writeFileSync(staged.manifestPath, JSON.stringify(manifest)); chmodSync(staged.manifestPath, 0o400);
      env.INGENIUM_RECOVERY_STAGE_SHA256 = hash(readFileSync(staged.manifestPath));
    }
    if (failure === "binding") env.INGENIUM_ADMITTED_RECOVERY_CONTEXT = JSON.stringify({ head: f.head, binding: { worktree: f.parent } });
    if (failure === "head") f.git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "--allow-empty", "-m", "next"]);
    const runner = vi.fn();
    expect(() => runRecoveryBootstrap([process.execPath, f.source], runner as any, undefined,
      { ...env, INGENIUM_RECOVERY_GENERATED_BOOTSTRAP_SHA256: hash(readFileSync(f.source)) })).toThrow("stage provenance");
    expect(runner).not.toHaveBeenCalled();
  });

  it("runs all generated checks and restart code only in the private stage while preserving canonical binding", async () => {
    const f = await fixture();
    const staged = f.stage();
    const scripts = join(staged.workspace, "packages/ingenium-extension/dist/scripts");
    mkdirSync(scripts, { recursive: true, mode: 0o700 });
    const generated = join(scripts, "recovery-bootstrap.js");
    const restart = join(scripts, "production-restart.js");
    writeFileSync(generated, "export {};\n", { mode: 0o555 });
    writeFileSync(restart, "export {};\n", { mode: 0o555 });
    const runner = vi.fn((_command, _args, options) => {
      expect(options.cwd).toBe(staged.workspace);
      expect(options.env.NODE_OPTIONS).toBeUndefined();
      return { status: 0, signal: null };
    });
    const evidence = vi.fn();
    expect(runRecoveryBootstrap([process.execPath, generated], runner, evidence, {
      ...f.environment(staged), NODE_OPTIONS: "--require=/untrusted",
      INGENIUM_RECOVERY_GENERATED_BOOTSTRAP_SHA256: hash(readFileSync(generated)),
    })).toBe(0);
    expect(runner).toHaveBeenCalledTimes(RECOVERY_BOOTSTRAP_CHECKS.length + 1);
    expect(runner.mock.calls.at(-1)).toMatchObject([process.execPath, [restart], { env: { INGENIUM_WORKTREE: f.root } }]);
    expect(evidence.mock.calls.at(-1)?.[0].productionRestart.result).toBe("passed");
    expect(lstatSync(f.root).mode & 0o7777).toBe(0o775);
    expect(readdirSync(f.parent)).toHaveLength(1);
  });
});
