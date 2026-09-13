import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, cpSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
  readdirSync, readlinkSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error The installer is a source-only Node entrypoint.
import { buildPrivateClosure, installHostBuild, parseInstallerArgs, verifyRecoveryRegistry } from "./scripts/install-host-build.mjs";
import * as wrapper from "./scripts/managed-command-wrapper.js";

const fixtures: string[] = [];
const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
afterEach(() => {
  for (const path of fixtures.splice(0)) {
    const sharedDist = join(path, "repository/packages/ingenium-extension/dist");
    if (existsSync(sharedDist)) chmodSync(sharedDist, 0o700);
    rmSync(path, { recursive: true, force: true });
  }
});

function fixture() {
  const base = mkdtempSync(join(tmpdir(), "ingenium-host-installer-"));
  fixtures.push(base);
  const root = join(base, "repository");
  const home = join(base, "home");
  const extension = join(root, "packages/ingenium-extension");
  const bin = join(home, ".local/bin");
  const state = join(home, ".local/state");
  for (const path of [join(extension, "scripts"), bin, state]) mkdirSync(path, { recursive: true, mode: 0o700 });
  const source = join(extension, "scripts/recovery-bootstrap.js");
  const packageSource = join(extension, "package.json");
  const buildSource = join(extension, "scripts/build-command.ts");
  const opencodeSource = join(extension, "scripts/opencode.ts");
  writeFileSync(source, 'throw new Error("outer bootstrap must not execute");\n', { mode: 0o644 });
  writeFileSync(buildSource, readFileSync(new URL("./scripts/build-command.ts", import.meta.url)), { mode: 0o644 });
  writeFileSync(opencodeSource, readFileSync(new URL("./scripts/opencode.ts", import.meta.url)), { mode: 0o644 });
  writeFileSync(packageSource, readFileSync(new URL("./package.json", import.meta.url)), { mode: 0o644 });
  writeFileSync(join(root, ".gitignore"), "**/dist/\n");
  const git = (args: string[]) => execFileSync("/usr/bin/git", ["-C", root, ...args], {
    env: { PATH: "/usr/bin:/bin", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" }, encoding: "utf8",
  }).trim();
  git(["init", "--quiet"]);
  git(["add", "."]);
  git(["-c", "user.name=Installer Test", "-c", "user.email=installer@example.invalid", "commit", "--quiet", "-m", "fixture"]);
  for (const path of [packageSource, buildSource, opencodeSource]) chmodSync(path, 0o674);
  const head = git(["rev-parse", "HEAD"]);
  const target = join(bin, "ingenium-build");
  const opencodeTarget = join(bin, "ingenium-opencode");
  writeFileSync(target, "original command; never execute\n", { mode: 0o755 });
  writeFileSync(opencodeTarget, "original opencode command; never execute\n", { mode: 0o700 });
  const originalHash = hash(target);
  const opencodeOriginalHash = hash(opencodeTarget);
  const transpile = (path: string) => Buffer.from(ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText);
  const material: Record<string, Buffer> = {
    "package.json": readFileSync(new URL("./package.json", import.meta.url)),
    "context-upload-codec.mjs": readFileSync(new URL("./context-upload-codec.mjs", import.meta.url)),
    "dist/replacement-first-restart.js": transpile("./replacement-first-restart.ts"),
    "dist/scripts/managed-command-wrapper.js": transpile("./scripts/managed-command-wrapper.ts"),
    "dist/scripts/build-command.js": Buffer.from("console.log(JSON.stringify({argv:process.argv.slice(2),env:process.env,cwd:process.cwd()}));\n"),
    "dist/scripts/opencode.js": Buffer.from('throw new Error("fixture launcher must not execute");\n'),
  };
  const build = vi.fn(() => material);
  const release = join(home, ".local/share/ingenium/host-build/releases", head);
  const options = { repositoryRoot: root, home, build };
  const manifest = () => JSON.parse(readFileSync(join(state, readdirSync(state).find((name) => name.endsWith(".json"))!), "utf8"));
  return { root, home, extension, bin, state, source, packageSource, buildSource, opencodeSource, head, target, opencodeTarget,
    originalHash, opencodeOriginalHash, build, git, options, manifest, material, release };
}

describe("private host build installer", () => {
  it("constructs the archive release closure from writable tracked metadata and rejects archive tree mismatch", async () => {
    const f = fixture();
    for (const name of ["scripts/recovery-bootstrap.js", "scripts/managed-command-wrapper.ts", "scripts/build-command.ts",
      "replacement-first-restart.ts", "context-upload-codec.mjs", "package.json"]) {
      writeFileSync(join(f.extension, name), readFileSync(new URL(name, import.meta.url)), { mode: 0o644 });
    }
    const metadata = [join(f.root, ".dockerignore"), join(f.extension, "package.json")];
    writeFileSync(metadata[0]!, "node_modules\n# $Format:%H$\n", { mode: 0o644 });
    f.git(["add", "."]);
    f.git(["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--quiet", "-m", "archive sources"]);
    const head = f.git(["rev-parse", "HEAD"]);
    for (const path of metadata) chmodSync(path, 0o674);
    expect(f.git(["status", "--porcelain=v1"])).toBe("");
    const prepareDependencies = vi.fn((_node: string, _args: string[], options: { cwd: string }) => {
      expect(options.cwd.startsWith(`${f.state}/git-stage-`)).toBe(true);
      expect(lstatSync(options.cwd).mode & 0o7777).toBe(0o700);
      for (const path of metadata) {
        const archived = join(options.cwd, path.slice(f.root.length + 1));
        expect(lstatSync(archived).mode & 0o7777).toBe(0o600);
        expect(readFileSync(archived)).toEqual(readFileSync(path));
      }
      const compiler = join(options.cwd, "node_modules/typescript/lib");
      mkdirSync(compiler, { recursive: true, mode: 0o700 });
      cpSync(new URL("../../node_modules/typescript/lib/typescript.js", import.meta.url), join(compiler, "typescript.js"));
    });
    const bundle = vi.fn((_workspace: string, source: string) => Buffer.from(ts.transpileModule(readFileSync(source, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
    }).outputText));
    const result = await buildPrivateClosure(f.root, head, f.state, readFileSync(f.source), prepareDependencies, bundle);
    expect(Object.keys(result).sort()).toEqual(Object.keys(f.material).sort());
    expect(result["dist/scripts/build-command.js"].toString()).toContain('runManagedCommandCli("build")');
    expect(result["dist/scripts/opencode.js"].toString()).toContain("runManagedTui");
    for (const path of metadata) expect(lstatSync(path).mode & 0o7777).toBe(0o674);
    expect(prepareDependencies).toHaveBeenCalledOnce();
    expect(bundle).toHaveBeenCalledOnce();
    expect(existsSync(join(f.extension, "dist"))).toBe(false);

    writeFileSync(join(f.root, ".git/info/attributes"), ".dockerignore export-subst\n");
    expect(f.git(["status", "--porcelain=v1"])).toBe("");
    await expect(buildPrivateClosure(f.root, head, f.state, readFileSync(f.source), prepareDependencies, bundle))
      .rejects.toThrow("Git archive/source hash mismatch");
    expect(prepareDependencies).toHaveBeenCalledOnce();
    expect(bundle).toHaveBeenCalledOnce();
  });

  it("builds the real ESM closure from archived source with distinct private npm configuration", async () => {
    const f = fixture();
    for (const name of ["scripts/recovery-bootstrap.js", "scripts/managed-command-wrapper.ts", "scripts/build-command.ts",
      "replacement-first-restart.ts", "context-upload-codec.mjs", "package.json"]) {
      writeFileSync(join(f.extension, name), readFileSync(new URL(name, import.meta.url)), { mode: 0o644 });
    }
    f.git(["add", "."]);
    f.git(["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--quiet", "-m", "private build sources"]);
    const head = f.git(["rev-parse", "HEAD"]);
    let configuration: string[] = [];
    const bundle = vi.fn((_workspace: string, source: string) => Buffer.from(ts.transpileModule(readFileSync(source, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
    }).outputText));
    const result = await buildPrivateClosure(f.root, head, f.state, readFileSync(f.source),
      (node: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }) => {
        expect(options.cwd.startsWith(`${f.state}/git-stage-`)).toBe(true);
        expect(args.slice(1)).toEqual(["ci", "--ignore-scripts", "--no-audit", "--no-fund", "--include=dev"]);
        configuration = [options.env.NPM_CONFIG_USERCONFIG!, options.env.NPM_CONFIG_GLOBALCONFIG!];
        expect(configuration[0]).not.toBe(configuration[1]);
        for (const path of configuration) {
          expect(readFileSync(path, "utf8")).toBe("");
          expect(lstatSync(path).mode & 0o7777).toBe(0o400);
        }
        expect(() => execFileSync(node, [args[0]!, "config", "list", "--json"], {
          ...options, stdio: "pipe", env: { ...options.env, NPM_CONFIG_USERCONFIG: "/dev/null", NPM_CONFIG_GLOBALCONFIG: "/dev/null" },
        })).toThrow();
        execFileSync(node, [args[0]!, "config", "list", "--json"], { ...options, stdio: "pipe" });
        const compiler = join(options.cwd, "node_modules/typescript/lib");
        mkdirSync(compiler, { recursive: true, mode: 0o700 });
        cpSync(new URL("../../node_modules/typescript/lib/typescript.js", import.meta.url), join(compiler, "typescript.js"));
      }, bundle);
    expect(Object.keys(result).sort()).toEqual(Object.keys(f.material).sort());
    expect(result["dist/scripts/build-command.js"].toString()).toContain('runManagedCommandCli("build")');
    expect(result["dist/scripts/opencode.js"].toString()).toContain("runManagedTui");
    expect(bundle).toHaveBeenCalledOnce();
    expect(configuration.every((path) => !existsSync(path))).toBe(true);
    expect(existsSync(join(f.extension, "dist"))).toBe(false);
  });

  it("retains the exact immutable closure and regular launcher, preserves argv and strips environment injection", async () => {
    const f = fixture();
    for (const path of [f.root, dirname(f.extension), f.extension, dirname(f.source)]) chmodSync(path, 0o775);
    const shared = join(f.extension, "dist/scripts");
    mkdirSync(shared, { recursive: true, mode: 0o775 });
    writeFileSync(join(shared, "build-command.js"), "throw Error('shared execution');\n");
    chmodSync(dirname(shared), 0o575);
    const result = await installHostBuild(f.head, f.options);
    for (const target of [f.target, f.opencodeTarget]) {
      expect(lstatSync(target).isFile()).toBe(true);
      expect(lstatSync(target).uid).toBe(process.getuid!());
      expect(lstatSync(target).nlink).toBe(1);
      expect(lstatSync(target).mode & 0o7777).toBe(0o500);
    }
    expect(Object.keys(result.launchers).sort()).toEqual(["ingenium-build", "ingenium-opencode"]);
    expect(result.head).toBe(f.head);
    expect(result.packageSource).toEqual({ path: f.packageSource, sha256: hash(f.packageSource), mode: 0o674 });
    for (const [name, target, source] of [
      ["ingenium-build", f.target, f.buildSource],
      ["ingenium-opencode", f.opencodeTarget, f.opencodeSource],
    ] as const) {
      expect(result.launchers[name].source).toMatchObject({ path: source, sha256: hash(source), mode: 0o674 });
      expect(result.launchers[name].artifact).toMatchObject({
        path: join(f.release, result.launchers[name].packageBin.slice(2)), mode: 0o400,
      });
      expect(hash(result.launchers[name].artifact.path)).toBe(result.launchers[name].artifact.sha256);
      expect(result.launchers[name].launcher).toEqual({ sha256: hash(target), mode: 0o500 });
      expect(result.launchers[name].installed.sha256).toBe(hash(target));
    }
    const launcher = readFileSync(f.target, "utf8");
    expect(launcher).toContain("/usr/bin/stat");
    expect(launcher.indexOf("/usr/bin/stat")).toBeLessThan(launcher.indexOf("node_hash="));
    expect(hash(result.backup)).toBe(f.originalHash);
    expect(hash(result.launchers["ingenium-opencode"].backup)).toBe(f.opencodeOriginalHash);
    expect(lstatSync(result.manifest).mode & 0o7777).toBe(0o600);
    expect(readdirSync(f.release).sort()).toEqual(["context-upload-codec.mjs", "dist", "package.json", "release.json"]);
    for (const artifact of Object.values(result.artifacts) as Array<{ path: string; sha256: string }>) {
      expect(hash(artifact.path)).toBe(artifact.sha256);
      expect(lstatSync(artifact.path).mode & 0o7777).toBe(0o400);
    }
    const argv = ["deployment", "recovery-prepare", "", "literal space", "$(touch never)", "a'\"b", "--", "YV9i"];
    const run = () => JSON.parse(execFileSync(f.target, argv, { encoding: "utf8", env: {
      ...process.env, NODE_OPTIONS: "--require=/nonexistent", NODE_PATH: "/nonexistent", BASH_ENV: "/nonexistent",
      INGENIUM_WORKTREE: "/foreign", GIT_DIR: "/foreign", npm_config_prefix: "/foreign", INGENIUM_PROJECT: "ingenium",
    } }));
    expect(run()).toMatchObject({ argv, cwd: f.root, env: { INGENIUM_PROJECT: "ingenium", HOME: f.home } });
    expect(run().env).not.toHaveProperty("NODE_OPTIONS");
    expect(run().env).not.toHaveProperty("INGENIUM_WORKTREE");
    writeFileSync(join(shared, "build-command.js"), "process.exit(99);\n");
    expect(run().argv).toEqual(argv);
    expect(lstatSync(f.root).mode & 0o7777).toBe(0o775);
    expect(lstatSync(dirname(shared)).mode & 0o7777).toBe(0o575);
    expect(wrapper.verifyPrivateBuildRelease(f.release, f.home).head).toBe(f.head);
    const before = Object.keys(f.material).map((name) => lstatSync(join(f.release, name)).ino);
    await installHostBuild(f.head, f.options);
    expect(Object.keys(f.material).map((name) => lstatSync(join(f.release, name)).ino)).toEqual(before);
    f.material["dist/scripts/build-command.js"] = Buffer.from("changed\n");
    await expect(installHostBuild(f.head, f.options)).rejects.toThrow("immutable release");
  }, 10_000);

  it.each([
    ["tampered", "Launcher source changed"],
    ["private-stage mismatch", "Private build closure is incomplete"],
    ["symlink", "Unsafe regular file"],
    ["hardlink", "Unsafe regular file"],
  ] as const)("rejects a %s launcher input after its exact HEAD-pinned read", async (failure, message) => {
    const f = fixture();
    const build = vi.fn(() => {
      if (failure === "tampered") writeFileSync(f.opencodeSource, "tampered launcher\n");
      if (failure === "private-stage mismatch") f.material["package.json"] = Buffer.from("{}\n");
      if (failure === "symlink") {
        const moved = join(f.home, "opencode-source");
        renameSync(f.opencodeSource, moved);
        symlinkSync(moved, f.opencodeSource);
      }
      if (failure === "hardlink") linkSync(f.opencodeSource, join(f.home, "opencode-source"));
      return f.material;
    });
    await expect(installHostBuild(f.head, { ...f.options, build })).rejects.toThrow(message);
    expect(build).toHaveBeenCalledOnce();
    expect(hash(f.target)).toBe(f.originalHash);
    expect(hash(f.opencodeTarget)).toBe(f.opencodeOriginalHash);
  });

  it.each([[], ["--expected-head", "A".repeat(40)], ["--expected-head", "a".repeat(39)],
    ["--expected-head", "a".repeat(40), "extra"]].map((argv) => [argv]))("rejects nonexact CLI arguments %j", (argv) => {
    expect(() => parseInstallerArgs(argv)).toThrow("Usage:");
  });

  it.each(["head", "source", "hidden-source", "source-mode", "source-link", "source-hardlink"])("rejects %s before building", async (failure) => {
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

  it.each(["bin-mode", "parent-link", "target-directory", "target-hardlink", "target-writable"])("rejects unsafe %s", async (failure) => {
    const f = fixture();
    if (failure === "bin-mode") chmodSync(f.bin, 0o777);
    if (failure === "parent-link") { renameSync(join(f.home, ".local"), join(f.home, "elsewhere")); symlinkSync(join(f.home, "elsewhere"), join(f.home, ".local")); }
    if (failure === "target-directory") { unlinkSync(f.target); mkdirSync(f.target); }
    if (failure === "target-hardlink") linkSync(f.target, join(f.home, "linked"));
    if (failure === "target-writable") chmodSync(f.target, 0o777);
    await expect(installHostBuild(f.head, f.options)).rejects.toThrow();
    expect(f.build).not.toHaveBeenCalled();
  });

  it("replaces an opaque relative npm symlink and restores its exact inode after post-adoption failure", async () => {
    const link = Buffer.from("../lib/node_modules/@ingenium/extension/dist/scripts/build-command.js");
    for (const failAfterAdoption of [false, true]) {
      const f = fixture();
      unlinkSync(f.target);
      symlinkSync(link, f.target);
      const before = lstatSync(f.target);
      const metadata = Object.fromEntries(["dev", "ino", "uid", "gid", "mode", "nlink", "size", "mtimeMs"].map(
        (key) => [key, before[key as keyof typeof before]],
      ));
      const assertOriginal = (path: string) => {
        expect(lstatSync(path)).toMatchObject(metadata);
        expect(readlinkSync(path, { encoding: "buffer" })).toEqual(link);
      };
      const afterAdoption = vi.fn(() => {
        expect(lstatSync(f.target).isFile()).toBe(true);
        expect(lstatSync(f.target).mode & 0o7777).toBe(0o500);
        assertOriginal(f.manifest().backup);
        expect(f.manifest().prior.linkBytes).toBe(link.toString("base64"));
        expect(f.manifest().prior).not.toHaveProperty("sha256");
        if (failAfterAdoption) throw Error("injected post-adoption failure");
      });
      const installation = installHostBuild(f.head, { ...f.options, afterAdoption });
      if (failAfterAdoption) {
        await expect(installation).rejects.toThrow("injected post-adoption failure");
        assertOriginal(f.target);
        expect(f.manifest().status).toBe("rolled_back");
        expect(readdirSync(f.bin).some((name) => name.endsWith(".previous"))).toBe(false);
      } else {
        const installed = await installation;
        expect(installed.status).toBe("installed");
        expect(lstatSync(f.target).isFile()).toBe(true);
        assertOriginal(installed.backup);
      }
      expect(afterAdoption).toHaveBeenCalledOnce();
      expect(existsSync(join(f.state, "ingenium-build-install.lock"))).toBe(false);
    }
  });

  it.each(["regular", "symlink", "absent"])("rolls back a prior %s target after a completed rename loses acknowledgement", async (kind) => {
    const f = fixture();
    if (kind === "absent") unlinkSync(f.target);
    if (kind === "symlink") { renameSync(f.target, join(f.home, "old")); symlinkSync(join(f.home, "old"), f.target); }
    await expect(installHostBuild(f.head, { ...f.options, rename: (from: string, to: string) => {
      renameSync(from, to); throw new Error("acknowledgement lost");
    } })).rejects.toThrow("acknowledgement lost");
    if (kind === "absent") expect(existsSync(f.target)).toBe(false);
    else expect(hash(f.target)).toBe(f.originalHash);
    if (kind === "symlink") expect(readlinkSync(f.target)).toBe(join(f.home, "old"));
    expect(hash(f.opencodeTarget)).toBe(f.opencodeOriginalHash);
    expect(f.manifest().status).toBe("rolled_back");
    expect(existsSync(join(f.state, "ingenium-build-install.lock"))).toBe(false);
  });

  it("restores or removes both launchers after a post-adoption failure", async () => {
    for (const prior of ["present", "absent"] as const) {
      const f = fixture();
      if (prior === "absent") {
        unlinkSync(f.target);
        unlinkSync(f.opencodeTarget);
      }
      await expect(installHostBuild(f.head, { ...f.options, afterAdoption: () => {
        expect(lstatSync(f.target).mode & 0o7777).toBe(0o500);
        expect(lstatSync(f.opencodeTarget).mode & 0o7777).toBe(0o500);
        throw new Error("injected paired-launcher failure");
      } })).rejects.toThrow("injected paired-launcher failure");
      for (const [target, original] of [[f.target, f.originalHash], [f.opencodeTarget, f.opencodeOriginalHash]] as const) {
        if (prior === "present") expect(hash(target)).toBe(original);
        else expect(existsSync(target)).toBe(false);
      }
      expect(f.manifest().status).toBe("rolled_back");
      expect(existsSync(join(f.state, "ingenium-build-install.lock"))).toBe(false);
    }
  });

  it("retains the lock, backup and alien target for unknown adoption rather than replaying rollback", async () => {
    const f = fixture();
    await expect(installHostBuild(f.head, { ...f.options, afterAdoption: () => {
      renameSync(f.target, join(f.bin, "lost-launcher")); writeFileSync(f.target, "another transaction", { mode: 0o500 });
    } })).rejects.toThrow("rollback requires reconciliation");
    expect(readFileSync(f.target, "utf8")).toBe("another transaction");
    expect(hash(f.manifest().backup)).toBe(f.originalHash);
    expect(f.manifest().status).toBe("rollback_failed");
    expect(existsSync(join(f.state, "ingenium-build-install.lock"))).toBe(true);
  });

  it.each(["before-rename", "post-verify", "release-hash", "replaced-lock"])("restores the prior launcher after %s", async (failure) => {
    const f = fixture();
    const lock = join(f.state, "ingenium-build-install.lock");
    await expect(installHostBuild(f.head, { ...f.options,
      rename: (from: string, to: string) => {
        if (failure === "before-rename") throw Error("rename rejected");
        renameSync(from, to);
      },
      afterAdoption: () => {
        if (failure === "post-verify") throw Error("post verification rejected");
        if (failure === "release-hash") {
          const file = join(f.release, "dist/scripts/build-command.js");
          chmodSync(file, 0o600); writeFileSync(file, "changed"); chmodSync(file, 0o400);
        }
        if (failure === "replaced-lock") {
          renameSync(lock, `${lock}.original`); writeFileSync(lock, "another installer", { mode: 0o600 });
        }
      },
    })).rejects.toThrow();
    expect(hash(f.target)).toBe(f.originalHash);
    expect(hash(f.opencodeTarget)).toBe(f.opencodeOriginalHash);
    expect(lstatSync(f.target).nlink).toBe(1);
    expect(lstatSync(f.target).mode & 0o7777).toBe(0o755);
    if (failure === "replaced-lock") expect(readFileSync(lock, "utf8")).toBe("another installer");
    else expect(existsSync(lock)).toBe(false);
  });

  it("restores through the pinned bin descriptor without mutating a substituted parent", async () => {
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
  });

  it("preserves a shared prior symlink without treating its backing bytes as authority", async () => {
    const f = fixture();
    const shared = join(f.extension, "dist");
    mkdirSync(shared, { mode: 0o700 });
    const old = join(shared, "old.js");
    renameSync(f.target, old); symlinkSync(old, f.target);
    chmodSync(shared, 0o575);
    const installed = await installHostBuild(f.head, { ...f.options, build: () => {
      writeFileSync(old, "external mutation");
      return f.build();
    } });
    expect(readlinkSync(installed.backup)).toBe(old);
    expect(lstatSync(f.target).isFile()).toBe(true);
    expect(readFileSync(old, "utf8")).toBe("external mutation");
    expect(lstatSync(shared).mode & 0o7777).toBe(0o575);
    expect(f.manifest().status).toBe("installed");
  });

  it.each(["hash", "file-mode", "directory-mode", "extra-file", "manifest-key", "manifest-link", "node", "worktree", "head"])("rejects malformed private %s before entry execution", async (failure) => {
    const f = fixture();
    await installHostBuild(f.head, f.options);
    const file = join(f.release, "dist/scripts/build-command.js");
    const manifestPath = join(f.release, "release.json");
    if (failure === "hash") { chmodSync(file, 0o600); writeFileSync(file, "process.exit(99);\n"); chmodSync(file, 0o400); }
    if (failure === "file-mode") chmodSync(file, 0o600);
    if (failure === "directory-mode") chmodSync(join(f.release, "dist"), 0o755);
    if (failure === "extra-file") writeFileSync(join(f.release, "extra"), "unexpected");
    if (failure === "manifest-link") linkSync(manifestPath, join(f.home, "linked-manifest"));
    if (["manifest-key", "node", "worktree"].includes(failure)) {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      if (failure === "manifest-key") manifest.extra = true;
      if (failure === "node") manifest.node.sha256 = "0".repeat(64);
      if (failure === "worktree") manifest.repositoryRoot = f.home;
      chmodSync(manifestPath, 0o600); writeFileSync(manifestPath, JSON.stringify(manifest)); chmodSync(manifestPath, 0o400);
    }
    if (failure === "head") f.git(["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "--quiet", "-m", "new head"]);
    expect(() => wrapper.verifyPrivateBuildRelease(f.release, f.home)).toThrow();
    expect(() => execFileSync(f.target, [], { stdio: "pipe" })).toThrow();
  });

  it("refuses a retained lock without deleting it or building", async () => {
    const f = fixture();
    const lock = join(f.state, "ingenium-build-install.lock");
    writeFileSync(lock, "retained transaction", { mode: 0o600 });
    await expect(installHostBuild(f.head, f.options)).rejects.toThrow();
    expect(f.build).not.toHaveBeenCalled();
    expect(readFileSync(lock, "utf8")).toBe("retained transaction");
  });

  it("checks literal and encoded recovery registry behavior without dispatching", () => {
    expect(() => verifyRecoveryRegistry(wrapper)).not.toThrow();
    expect(() => verifyRecoveryRegistry({ ...wrapper, validateManagedBuildArgv: (argv: string[]) => argv })).toThrow("nonliteral");
    expect(() => verifyRecoveryRegistry({ ...wrapper, decodeManagedBuildArgv: () => ["deployment", "recovery-prepare"] })).toThrow("encoded");
  });
});
