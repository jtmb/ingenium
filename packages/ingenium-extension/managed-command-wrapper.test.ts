import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  decodeManagedArgv,
  decodeManagedBuildArgv,
  decodeManagedRepositoryArgv,
  managedCommand,
  managedGitEnvironment,
  managedRepositoryArgv,
  runManagedCommandCli,
  validateManagedBuildArgv,
  validateManagedRepositoryArgv,
} from "./scripts/managed-command-wrapper.js";

describe("managed command wrappers", () => {
  it("decodes bounded argv without a shell and rejects unsupported commands", () => {
    const encoded = Buffer.from(JSON.stringify(["add", "src/file.ts"])).toString("base64url");
    const message = "chore(checkpoint): preserve runtime and coordination hardening work";
    expect(decodeManagedArgv(encoded)).toEqual(["add", "src/file.ts"]);
    expect(decodeManagedArgv(Buffer.from(JSON.stringify(["commit", message])).toString("base64url")))
      .toEqual(["commit", message]);
    expect(decodeManagedRepositoryArgv(encoded)).toEqual(["add", "src/file.ts"]);
    expect(decodeManagedBuildArgv(Buffer.from(JSON.stringify(["run", "typecheck"])).toString("base64url")))
      .toEqual(["run", "typecheck"]);
    expect(() => decodeManagedArgv(Buffer.from(JSON.stringify(["add", "src/file.ts;rm"])).toString("base64url")))
      .toThrow("Invalid managed command payload");
    expect(() => decodeManagedRepositoryArgv(Buffer.from(JSON.stringify(["status"])).toString("base64url")))
      .toThrow("Repository wrapper rejected the command");
    expect(() => decodeManagedBuildArgv(Buffer.from(JSON.stringify(["run", "test", "--watch"])).toString("base64url")))
      .toThrow("Build wrapper rejected the command");
    expect(() => managedCommand("repository", ["status"])).toThrow("Repository wrapper rejected the command");
    expect(() => managedCommand("build", ["exec", "arbitrary"])).toThrow("Build wrapper rejected the command");
  });

  it("admits only literal path operations and rejects executable Git forms", () => {
    expect(managedRepositoryArgv(["add", "src/file.ts"])).toEqual([
      "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "add", "--", "src/file.ts",
    ]);
    expect(managedRepositoryArgv(["mv", "src/old.ts", "src/new.ts"])).toEqual([
      "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "mv", "--", "src/old.ts", "src/new.ts",
    ]);
    expect(managedRepositoryArgv(["commit", "chore(checkpoint): preserve runtime and coordination hardening work"])).toEqual([
      "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null",
      "-c", "commit.gpgSign=false", "-c", "credential.helper=",
      "-c", "user.name=Ingenium Managed Command", "-c", "user.email=managed-command@ingenium.invalid",
      "commit", "--no-verify", "--no-gpg-sign", "--cleanup=verbatim", "-m",
      "chore(checkpoint): preserve runtime and coordination hardening work",
    ]);
    for (const argv of [
      ["add", "--all"],
      ["add", "../outside"],
      ["add", ".git/config"],
      ["add", "src/file with spaces.ts"],
      ["add", "src/file.ts;touch-marker"],
      ["add", "src/control\u007f.ts"],
      ["checkout", "main"],
      ["commit"],
      ["commit", ""],
      ["commit", " leading"],
      ["commit", "trailing "],
      ["commit", "line\nbreak"],
      ["commit", "control\u0000character"],
      ["commit", "-option-like"],
      ["commit", "x".repeat(101)],
      ["commit", "-m", "message"],
      ["commit", "message", "extra"],
      ["merge", "--strategy=evil", "main"],
      ["rebase", "--exec=payload", "main"],
      ["reset", "--hard"],
      ["tag", "--local-user=attacker", "v1"],
    ]) {
      expect(() => validateManagedRepositoryArgv(argv)).toThrow("Repository wrapper rejected the command");
      expect(() => managedRepositoryArgv(argv)).toThrow("Repository wrapper rejected the command");
    }

    for (const argv of [
      [],
      ["run"],
      ["run", "test", "--watch"],
      ["run", "pretest"],
      ["exec", "build"],
      ["build", "--workspace=outside"],
      ["test\nmalicious"],
    ]) expect(() => validateManagedBuildArgv(argv)).toThrow("Build wrapper rejected the command");

    for (const argv of [
      ["build"],
      ["typecheck"],
      ["test"],
      ["lint"],
      ["run", "build"],
      ["run", "typecheck"],
      ["run", "test"],
      ["run", "lint"],
    ]) expect(validateManagedBuildArgv(argv)).toEqual(argv);
  });

  it("removes Git execution environment overrides", () => {
    expect(managedGitEnvironment({
      PATH: "/tmp/attacker",
      GIT_EXEC_PATH: "/tmp/helpers",
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "core.hooksPath",
      GIT_CONFIG_VALUE_0: "/tmp/hooks",
      GIT_EDITOR: "/tmp/editor",
      SSH_ASKPASS: "/tmp/askpass",
      SAFE_VALUE: "retained",
    })).toMatchObject({
      PATH: "/usr/local/bin:/usr/bin:/bin",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_EDITOR: "true",
      GIT_SEQUENCE_EDITOR: "true",
      GIT_PAGER: "cat",
      GIT_TERMINAL_PROMPT: "0",
      GIT_LITERAL_PATHSPECS: "1",
      SAFE_VALUE: "retained",
    });
    const serialized = JSON.stringify(managedGitEnvironment({ GIT_EXEC_PATH: "/tmp/helpers", SSH_ASKPASS: "/tmp/askpass" }));
    expect(serialized).not.toContain("/tmp/helpers");
    expect(serialized).not.toContain("/tmp/askpass");
  });

  it("rejects repository-local hooks and helper configuration before Git mutation", () => {
    const directory = mkdtempSync(join(tmpdir(), "ingenium-managed-git-"));
    try {
      execFileSync("/usr/bin/git", ["-C", directory, "init", "--quiet"]);
      for (const [key, value] of [
        ["core.hooksPath", "/tmp/hooks"],
        ["filter.inject.process", "/tmp/filter"],
        ["merge.inject.driver", "/tmp/merge-driver"],
      ] as const) {
        execFileSync("/usr/bin/git", ["-C", directory, "config", key, value]);
        expect(() => managedCommand("repository", ["add", "safe.txt"], directory))
          .toThrow("Repository wrapper rejected executable Git configuration");
        execFileSync("/usr/bin/git", ["-C", directory, "config", "--unset", key]);
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("stages a literal path without executing a hook or exposing its inherited sentinel", () => {
    const directory = mkdtempSync(join(tmpdir(), "ingenium-managed-git-"));
    const previousSentinel = process.env.MANAGED_HOOK_SENTINEL;
    try {
      execFileSync("/usr/bin/git", ["-C", directory, "init", "--quiet"]);
      const marker = join(directory, "hook-ran");
      const exposure = join(directory, "hook-sentinel");
      const hook = join(directory, ".git", "hooks", "post-index-change");
      const sentinel = "post-index-change-private-sentinel";
      process.env.MANAGED_HOOK_SENTINEL = sentinel;
      writeFileSync(hook, `#!/bin/sh\ntouch '${marker}'\nprintf '%s' "$MANAGED_HOOK_SENTINEL" > '${exposure}'\n`);
      chmodSync(hook, 0o700);
      writeFileSync(join(directory, "safe.txt"), "safe\n");

      expect(managedCommand("repository", ["add", "safe.txt"], directory)).toBe(0);
      expect(execFileSync("/usr/bin/git", ["-C", directory, "diff", "--cached", "--name-only"], { encoding: "utf8" }))
        .toBe("safe.txt\n");
      expect(existsSync(marker)).toBe(false);
      expect(existsSync(exposure)).toBe(false);
    } finally {
      if (previousSentinel === undefined) delete process.env.MANAGED_HOOK_SENTINEL;
      else process.env.MANAGED_HOOK_SENTINEL = previousSentinel;
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("commits with the exact message without executing a hook or exposing its inherited sentinel", () => {
    const directory = mkdtempSync(join(tmpdir(), "ingenium-managed-git-"));
    const previousSentinel = process.env.MANAGED_HOOK_SENTINEL;
    try {
      execFileSync("/usr/bin/git", ["-C", directory, "init", "--quiet"]);
      const marker = join(directory, "hook-ran");
      const exposure = join(directory, "hook-sentinel");
      const hook = join(directory, ".git", "hooks", "pre-commit");
      const sentinel = "pre-commit-private-sentinel";
      process.env.MANAGED_HOOK_SENTINEL = sentinel;
      writeFileSync(hook, `#!/bin/sh\ntouch '${marker}'\nprintf '%s' "$MANAGED_HOOK_SENTINEL" > '${exposure}'\n`);
      chmodSync(hook, 0o700);
      writeFileSync(join(directory, "safe.txt"), "safe\n");
      const message = "chore(checkpoint): preserve runtime and coordination hardening work";

      expect(managedCommand("repository", ["add", "safe.txt"], directory)).toBe(0);
      expect(managedCommand("repository", ["commit", message], directory)).toBe(0);
      expect(execFileSync("/usr/bin/git", ["-C", directory, "log", "-1", "--format=%s"], { encoding: "utf8" }))
        .toBe(`${message}\n`);
      expect(existsSync(marker)).toBe(false);
      expect(existsSync(exposure)).toBe(false);
    } finally {
      if (previousSentinel === undefined) delete process.env.MANAGED_HOOK_SENTINEL;
      else process.env.MANAGED_HOOK_SENTINEL = previousSentinel;
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("preserves the native index lock and propagates Git's nonzero status", () => {
    const directory = mkdtempSync(join(tmpdir(), "ingenium-managed-git-"));
    try {
      execFileSync("/usr/bin/git", ["-C", directory, "init", "--quiet"]);
      writeFileSync(join(directory, "safe.txt"), "safe\n");
      const lock = join(directory, ".git", "index.lock");
      writeFileSync(lock, "competing writer\n");

      expect(managedCommand("repository", ["add", "safe.txt"], directory)).toBe(128);
      expect(existsSync(lock)).toBe(true);
      expect(execFileSync("/usr/bin/git", ["-C", directory, "diff", "--cached", "--name-only"], { encoding: "utf8" }))
        .toBe("");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("allows exactly one managed commit when an executable hook would change the ref", () => {
    const directory = mkdtempSync(join(tmpdir(), "ingenium-managed-git-"));
    try {
      execFileSync("/usr/bin/git", ["-C", directory, "init", "--quiet"]);
      execFileSync("/usr/bin/git", ["-C", directory, "config", "user.name", "Managed Wrapper Test"]);
      execFileSync("/usr/bin/git", ["-C", directory, "config", "user.email", "managed-wrapper@example.invalid"]);
      const competingStatus = join(directory, "competing-status");
      const hook = join(directory, ".git", "hooks", "pre-commit");
      writeFileSync(hook, `#!/bin/sh\nchmod -x "$0"\n/usr/bin/git commit -m 'competing commit'\nprintf '%s' "$?" > '${competingStatus}'\nexit 0\n`);
      chmodSync(hook, 0o700);
      writeFileSync(join(directory, "safe.txt"), "safe\n");
      const message = "chore: native lock wins";

      expect(managedCommand("repository", ["add", "safe.txt"], directory)).toBe(0);
      expect(managedCommand("repository", ["commit", message], directory)).toBe(0);
      expect(existsSync(competingStatus)).toBe(false);
      expect(execFileSync("/usr/bin/git", ["-C", directory, "rev-list", "--count", "HEAD"], { encoding: "utf8" }))
        .toBe("1\n");
      expect(execFileSync("/usr/bin/git", ["-C", directory, "log", "-1", "--format=%s"], { encoding: "utf8" }))
        .toBe(`${message}\n`);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("fails safely when the index is empty", () => {
    const directory = mkdtempSync(join(tmpdir(), "ingenium-managed-git-"));
    try {
      execFileSync("/usr/bin/git", ["-C", directory, "init", "--quiet"]);
      execFileSync("/usr/bin/git", ["-C", directory, "config", "user.name", "Managed Wrapper Test"]);
      execFileSync("/usr/bin/git", ["-C", directory, "config", "user.email", "managed-wrapper@example.invalid"]);

      expect(managedCommand("repository", ["commit", "chore: empty index"], directory)).toBe(1);
      expect(() => execFileSync("/usr/bin/git", ["-C", directory, "rev-parse", "--verify", "HEAD"]))
        .toThrow();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("allows ignored build output without changing the source fingerprint", () => {
    const directory = mkdtempSync(join(tmpdir(), "ingenium-managed-build-"));
    try {
      execFileSync("/usr/bin/git", ["-C", directory, "init", "--quiet"]);
      writeFileSync(join(directory, ".gitignore"), "dist/\n");
      writeFileSync(join(directory, "source.ts"), "export const value = 1;\n");
      writeFileSync(join(directory, "package.json"), JSON.stringify({
        scripts: {
          typecheck: "node -e \"require('node:fs').mkdirSync('dist'); require('node:fs').writeFileSync('dist/output.js', 'built')\"",
        },
      }));

      expect(managedCommand("build", ["run", "typecheck"], directory)).toBe(0);
      expect(readFileSync(join(directory, "source.ts"), "utf8")).toBe("export const value = 1;\n");
      expect(readFileSync(join(directory, "dist", "output.js"), "utf8")).toBe("built");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects a build that changes repository source", () => {
    const directory = mkdtempSync(join(tmpdir(), "ingenium-managed-build-"));
    try {
      execFileSync("/usr/bin/git", ["-C", directory, "init", "--quiet"]);
      writeFileSync(join(directory, "source.ts"), "export const value = 1;\n");
      writeFileSync(join(directory, "package.json"), JSON.stringify({
        scripts: {
          build: "node -e \"require('node:fs').writeFileSync('source.ts', 'export const value = 2;\\n')\"",
        },
      }));

      expect(() => managedCommand("build", ["run", "build"], directory))
        .toThrow("Build wrapper produced source changes");
      expect(readFileSync(join(directory, "source.ts"), "utf8")).toBe("export const value = 2;\n");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("propagates a real nonzero build result", () => {
    const directory = mkdtempSync(join(tmpdir(), "ingenium-managed-build-"));
    try {
      execFileSync("/usr/bin/git", ["-C", directory, "init", "--quiet"]);
      writeFileSync(join(directory, "package.json"), JSON.stringify({
        scripts: { lint: "node -e \"process.exit(7)\"" },
      }));

      expect(managedCommand("build", ["run", "lint"], directory)).toBe(7);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("routes each package bin through an explicit wrapper kind", () => {
    const manifest = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
      bin: Record<string, string>;
    };
    expect(manifest.bin).toMatchObject({
      "ingenium-repository": "./dist/scripts/repository-command.js",
      "ingenium-build": "./dist/scripts/build-command.js",
    });
    expect(manifest.bin["ingenium-repository"]).not.toBe(manifest.bin["ingenium-build"]);

    expect(() => runManagedCommandCli("repository", ["node", "repository-command", Buffer.from(JSON.stringify(["status"])).toString("base64url")]))
      .toThrow("Repository wrapper rejected the command");
    expect(() => runManagedCommandCli("build", ["node", "build-command", Buffer.from(JSON.stringify(["exec", "arbitrary"])).toString("base64url")]))
      .toThrow("Build wrapper rejected the command");
  });
});
