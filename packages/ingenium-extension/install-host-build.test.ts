import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
  readdirSync, readlinkSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error Source-only Node entrypoints deliberately have no generated declarations.
import { buildDistributions } from "./scripts/build-distributions.mjs";
// @ts-expect-error The installer must run independently of the distribution it replaces.
import { installHostBuild, parseInstallerArgs, verifyRecoveryRegistry } from "./scripts/install-host-build.mjs";
import * as wrapper from "./scripts/managed-command-wrapper.js";

const fixtures: string[] = [];
const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
afterEach(() => { for (const path of fixtures.splice(0)) rmSync(path, { recursive: true, force: true }); });

function fixture(distributionRename = renameSync) {
  const base = mkdtempSync(join(tmpdir(), "ingenium-host-installer-"));
  fixtures.push(base);
  const root = join(base, "repository");
  const home = join(base, "home");
  const extension = join(root, "packages/ingenium-extension");
  const server = join(root, "services/ingenium-server");
  const bin = join(home, ".local/bin");
  const state = join(home, ".local/state");
  for (const path of [join(extension, "scripts"), server, bin, state]) mkdirSync(path, { recursive: true, mode: 0o700 });
  const source = join(extension, "scripts/recovery-bootstrap.js");
  writeFileSync(source, 'throw new Error("outer bootstrap must not execute");\n', { mode: 0o644 });
  writeFileSync(join(root, ".gitignore"), "**/build/\n**/dist/\n");
  writeFileSync(join(extension, "package.json"), '{"type":"module"}\n');
  const git = (args: string[]) => execFileSync("/usr/bin/git", ["-C", root, ...args], {
    env: { PATH: "/usr/bin:/bin", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" }, encoding: "utf8",
  }).trim();
  git(["init", "--quiet"]);
  git(["add", "."]);
  git(["-c", "user.name=Installer Test", "-c", "user.email=installer@example.invalid", "commit", "--quiet", "-m", "fixture"]);
  const head = git(["rev-parse", "HEAD"]);
  const target = join(bin, "ingenium-build");
  writeFileSync(target, "original command; never execute\n", { mode: 0o755 });
  const originalHash = hash(target);
  const wrapperJs = ts.transpileModule(readFileSync(new URL("./scripts/managed-command-wrapper.ts", import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText;
  const build = vi.fn(() => buildDistributions({ repositoryRoot: root, parity: () => {},
    retainTransaction: true, rename: distributionRename,
    compile: (_root: string, packageRoot: string, output: string) => {
      const files = packageRoot === server ? ["config/index.js", "lib/client.js", "scripts/mcp-server.js"] : [
        "index.js", "index.d.ts", "replacement-first-restart.js",
        ...["mcp-server", "init-project", "managed-command-wrapper", "recovery-bootstrap", "repository-command",
          "build-command", "coordination-reset", "production-restart", "opencode", "recovery-owner"].map((name) => `scripts/${name}.js`),
        ...["auto-observer", "observer", "resource-sync", "session-coordinator"].map((name) => `plugins/${name}.js`),
      ];
      for (const path of files) {
        mkdirSync(dirname(join(output, path)), { recursive: true, mode: 0o700 });
        writeFileSync(join(output, path), path === "scripts/managed-command-wrapper.js" ? wrapperJs
          : path === "replacement-first-restart.js" ? "export const decodeReplacementFirstRestartRequest = () => { throw Error('must not run'); }; export const runReplacementFirstRestart = decodeReplacementFirstRestartRequest;"
          : 'throw new Error("artifact must not execute");\n');
      }
    },
  }));
  const options = { repositoryRoot: root, home, build };
  const manifest = () => JSON.parse(readFileSync(join(state, readdirSync(state).find((name) => name.endsWith(".json"))!), "utf8"));
  return { root, home, extension, bin, state, source, head, target, originalHash, build, git, options, manifest };
}

describe("host build installer", () => {
  it("atomically adopts the exact target, retains rollback bytes and independently readable provenance", async () => {
    const f = fixture();
    const result = await installHostBuild(f.head, f.options);
    const canonical = join(f.extension, "dist/scripts/build-command.js");
    expect(readlinkSync(f.target)).toBe(canonical);
    expect(realpathSync(f.target)).toBe(canonical);
    expect(lstatSync(f.target).isSymbolicLink()).toBe(true);
    expect(hash(result.backup)).toBe(f.originalHash);
    expect(lstatSync(result.manifest).mode & 0o777).toBe(0o600);
    expect(f.manifest()).toMatchObject({ head: f.head, status: "installed", canonicalTarget: canonical,
      source: { sha256: hash(f.source) }, prior: { sha256: f.originalHash } });
    for (const artifact of Object.values(result.artifacts) as Array<{ path: string; sha256: string }>) {
      expect(hash(artifact.path)).toBe(artifact.sha256);
      expect(lstatSync(artifact.path).mode & 0o777).toBe(0o555);
    }
    expect(existsSync(join(f.state, "ingenium-build-install.lock"))).toBe(false);
  });

  it.each([[], ["--expected-head", "A".repeat(40)], ["--expected-head", "a".repeat(39)],
    ["--expected-head", "a".repeat(40), "--target", "/tmp/other"]].map((argv) => [argv]))("rejects nonexact CLI arguments %j", (argv) => {
    expect(() => parseInstallerArgs(argv)).toThrow("Usage:");
  });

  it.each(["head", "source", "hidden-source", "source-mode", "source-link", "source-hardlink"])("rejects %s mismatch before building", async (failure) => {
    const f = fixture();
    if (failure === "source" || failure === "hidden-source") writeFileSync(f.source, "changed source\n");
    if (failure === "hidden-source") f.git(["update-index", "--assume-unchanged", "packages/ingenium-extension/scripts/recovery-bootstrap.js"]);
    if (failure === "source-mode") chmodSync(f.source, 0o600);
    if (failure === "source-link") { renameSync(f.source, join(f.home, "source")); symlinkSync(join(f.home, "source"), f.source); }
    if (failure === "source-hardlink") linkSync(f.source, join(f.home, "source"));
    await expect(installHostBuild(failure === "head" ? "0".repeat(40) : f.head, f.options)).rejects.toThrow();
    expect(f.build).not.toHaveBeenCalled();
    expect(hash(f.target)).toBe(f.originalHash);
  });

  it.each(["bin-mode", "parent-link", "target-directory", "target-hardlink", "target-relative", "target-chain", "target-writable"])("rejects unsafe %s", async (failure) => {
    const f = fixture();
    if (failure === "bin-mode") chmodSync(f.bin, 0o777);
    if (failure === "parent-link") {
      renameSync(join(f.home, ".local"), join(f.home, "elsewhere"));
      symlinkSync(join(f.home, "elsewhere"), join(f.home, ".local"));
    }
    if (failure === "target-directory") { unlinkSync(f.target); mkdirSync(f.target); }
    if (failure === "target-hardlink") linkSync(f.target, join(f.home, "linked"));
    if (failure === "target-writable") chmodSync(f.target, 0o777);
    if (failure === "target-relative" || failure === "target-chain") {
      renameSync(f.target, join(f.home, "old"));
      symlinkSync(join(f.home, "old"), join(f.home, "chain"));
      symlinkSync(failure === "target-relative" ? "../../old" : join(f.home, "chain"), f.target);
    }
    await expect(installHostBuild(f.head, f.options)).rejects.toThrow();
    expect(readdirSync(f.state).filter((name) => name.endsWith(".json"))).toEqual([]);
  });

  it.each(["before-rename", "unknown-rename", "post-verify", "artifact-mode", "artifact-hash", "target-replaced"])("restores the original after %s failure", async (failure) => {
    const f = fixture();
    await expect(installHostBuild(f.head, { ...f.options,
      rename: (from: string, to: string) => {
        if (failure === "before-rename") throw new Error("adoption failure");
        renameSync(from, to);
        if (failure === "unknown-rename") throw new Error("unknown rename outcome");
      },
      afterAdoption: () => {
        if (failure === "post-verify") throw new Error("post verification failure");
        if (failure === "artifact-mode" || failure === "artifact-hash") {
          const artifact = join(f.extension, "dist/scripts/build-command.js");
          chmodSync(artifact, 0o755);
          if (failure === "artifact-hash") { writeFileSync(artifact, "changed artifact\n"); chmodSync(artifact, 0o555); }
        }
        if (failure === "target-replaced") { unlinkSync(f.target); symlinkSync(f.source, f.target); }
      },
    })).rejects.toThrow();
    expect(lstatSync(f.target).isFile()).toBe(true);
    expect(hash(f.target)).toBe(f.originalHash);
    expect(lstatSync(f.target).mode & 0o777).toBe(0o755);
    expect(f.manifest().status).toBe("rolled_back");
    expect(existsSync(join(f.state, "ingenium-build-install.lock"))).toBe(false);
  });

  it("supports a previously absent target and removes it on post-adoption failure", async () => {
    const f = fixture();
    unlinkSync(f.target);
    await expect(installHostBuild(f.head, { ...f.options, afterAdoption: () => { throw Error("post failure"); } })).rejects.toThrow("post failure");
    expect(existsSync(f.target)).toBe(false);
    expect(f.manifest()).toMatchObject({ prior: null, backup: null, status: "rolled_back" });
  });

  it("restores through the retained directory descriptor without traversing a replaced parent", async () => {
    const f = fixture();
    const moved = join(f.home, "original-bin");
    const other = join(f.home, "other-bin");
    mkdirSync(other, { mode: 0o700 });
    writeFileSync(join(other, "ingenium-build"), "untouched");
    await expect(installHostBuild(f.head, { ...f.options, afterAdoption: () => {
      renameSync(f.bin, moved); symlinkSync(other, f.bin);
    } })).rejects.toThrow("rollback requires reconciliation");
    expect(hash(join(moved, "ingenium-build"))).toBe(f.originalHash);
    expect(readFileSync(join(other, "ingenium-build"), "utf8")).toBe("untouched");
    expect(f.manifest().status).toBe("rollback_failed");
    expect(existsSync(join(f.state, "ingenium-build-install.lock"))).toBe(true);
  });

  it("restores a validated old symlink without executing it", async () => {
    const f = fixture();
    const old = join(f.home, "old");
    renameSync(f.target, old); symlinkSync(old, f.target);
    await expect(installHostBuild(f.head, { ...f.options, afterAdoption: () => { throw Error("post failure"); } })).rejects.toThrow("post failure");
    expect(readlinkSync(f.target)).toBe(old);
    expect(hash(f.target)).toBe(f.originalHash);
  });

  it("restores_prebuild_canonical_dist_behavior_after_host_adoption_failure", async () => {
    let reconciledRenames = 0;
    const f = fixture((from, to) => {
      renameSync(from, to);
      if (String(from).endsWith("/previous")) {
        reconciledRenames++;
        throw new Error("rename completed but acknowledgement was lost");
      }
    });
    const command = join(f.extension, "dist/scripts/build-command.js");
    const imported = join(f.extension, "dist/lib/behavior.js");
    const serverImport = join(f.root, "services/ingenium-server/dist/value.mjs");
    for (const path of [command, imported, serverImport]) mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(command, 'import { value } from "../lib/behavior.js"; process.stdout.write(value);\n', { mode: 0o555 });
    writeFileSync(imported, 'export { value } from "../../../../services/ingenium-server/dist/value.mjs";\n', { mode: 0o644 });
    writeFileSync(serverImport, 'export const value = "pre-install behavior";\n', { mode: 0o644 });
    unlinkSync(f.target); symlinkSync(command, f.target);
    const before = lstatSync(f.target);
    const paths = [command, imported, serverImport];
    const hashes = paths.map(hash);
    const behavior = () => execFileSync(process.execPath, [f.target], { encoding: "utf8", env: { PATH: "/usr/bin:/bin" } });
    expect(behavior()).toBe("pre-install behavior");
    let adopted = false;
    await expect(installHostBuild(f.head, { ...f.options, afterAdoption: () => {
      adopted = true;
      expect(readlinkSync(f.target)).toBe(command);
      expect(hash(command)).not.toBe(hashes[0]);
      expect(existsSync(join(f.extension, "build/distribution-build.lock"))).toBe(true);
      throw new Error("injected post-adoption failure");
    } })).rejects.toThrow("injected post-adoption failure");
    expect(adopted).toBe(true);
    expect(reconciledRenames).toBe(2);
    expect(paths.map(hash)).toEqual(hashes);
    expect(behavior()).toBe("pre-install behavior");
    expect(realpathSync(f.target)).toBe(command);
    expect(readlinkSync(f.target)).toBe(command);
    const after = lstatSync(f.target);
    for (const key of ["dev", "ino", "uid", "gid", "mode", "nlink", "mtimeMs"] as const) expect(after[key]).toBe(before[key]);
    expect(f.manifest()).toMatchObject({ prior: { sha256: hashes[0], link: command }, status: "rolled_back" });
    expect(JSON.parse(readFileSync(f.manifest().distributionJournal, "utf8")).phase).toBe("rolled_back");
    expect(existsSync(join(f.extension, "build/distribution-build.lock"))).toBe(false);
    expect(existsSync(join(f.state, "ingenium-build-install.lock"))).toBe(false);
  });

  it("rejects stale artifact hashes before target adoption", async () => {
    const f = fixture();
    await expect(installHostBuild(f.head, { ...f.options, build: () => {
      const result = f.build();
      result.stages[1].candidateManifest["scripts/build-command.js"].sha256 = "0".repeat(64);
      return result;
    } })).rejects.toThrow("Artifact hash mismatch");
    expect(hash(f.target)).toBe(f.originalHash);
  });

  it("refuses an existing lock without building or deleting another installer's lock", async () => {
    const f = fixture();
    const lock = join(f.state, "ingenium-build-install.lock");
    writeFileSync(lock, "retained transaction", { mode: 0o600 });
    await expect(installHostBuild(f.head, f.options)).rejects.toThrow();
    expect(f.build).not.toHaveBeenCalled();
    expect(readFileSync(lock, "utf8")).toBe("retained transaction");
    expect(hash(f.target)).toBe(f.originalHash);
  });

  it("does not unlink a replaced lock when a post-adoption release fails", async () => {
    const f = fixture();
    const lock = join(f.state, "ingenium-build-install.lock");
    await expect(installHostBuild(f.head, { ...f.options, afterAdoption: () => {
      renameSync(lock, join(f.state, "original.lock"));
      writeFileSync(lock, "other transaction", { mode: 0o600 });
    } })).rejects.toThrow("lock identity changed");
    expect(hash(f.target)).toBe(f.originalHash);
    expect(readFileSync(lock, "utf8")).toBe("other transaction");
    expect(f.manifest().status).toBe("rolled_back");
  });

  it("checks real registry literal acceptance and rejection without dispatching recovery", () => {
    expect(() => verifyRecoveryRegistry(wrapper)).not.toThrow();
    expect(() => verifyRecoveryRegistry({ ...wrapper, isManagedDeploymentArgv: () => false })).toThrow("lacks literal");
    expect(() => verifyRecoveryRegistry({ ...wrapper, validateManagedBuildArgv: (argv: string[]) => argv })).toThrow("nonliteral");
    expect(() => verifyRecoveryRegistry({ ...wrapper, decodeManagedBuildArgv: () => ["deployment", "recovery-prepare"] })).toThrow("encoded");
  });
});
