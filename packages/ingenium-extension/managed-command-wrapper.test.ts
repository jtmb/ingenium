import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  decodeManagedArgv,
  managedCommand,
  managedGitEnvironment,
  managedRepositoryArgv,
  runManagedCommandCli,
} from "./scripts/managed-command-wrapper.js";

describe("managed command wrappers", () => {
  it("decodes bounded argv without a shell and rejects unsupported commands", () => {
    const encoded = Buffer.from(JSON.stringify(["add", "src/file.ts"])).toString("base64url");
    expect(decodeManagedArgv(encoded)).toEqual(["add", "src/file.ts"]);
    expect(() => decodeManagedArgv(Buffer.from(JSON.stringify(["add", "src/file.ts;rm"])).toString("base64url")))
      .toThrow("Invalid managed command payload");
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
    for (const argv of [
      ["add", "--all"],
      ["add", "../outside"],
      ["add", ".git/config"],
      ["checkout", "main"],
      ["commit", "-m", "message"],
      ["merge", "--strategy=evil", "main"],
      ["rebase", "--exec=payload", "main"],
      ["reset", "--hard"],
      ["tag", "--local-user=attacker", "v1"],
    ]) expect(() => managedRepositoryArgv(argv)).toThrow("Repository wrapper rejected the command");
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

  it("stages a literal path without running repository hooks", () => {
    const directory = mkdtempSync(join(tmpdir(), "ingenium-managed-git-"));
    try {
      execFileSync("/usr/bin/git", ["-C", directory, "init", "--quiet"]);
      const marker = join(directory, "hook-ran");
      const hook = join(directory, ".git", "hooks", "post-index-change");
      writeFileSync(hook, `#!/bin/sh\ntouch '${marker}'\n`);
      chmodSync(hook, 0o700);
      writeFileSync(join(directory, "safe.txt"), "safe\n");

      expect(managedCommand("repository", ["add", "safe.txt"], directory)).toBe(0);
      expect(execFileSync("/usr/bin/git", ["-C", directory, "diff", "--cached", "--name-only"], { encoding: "utf8" }))
        .toBe("safe.txt\n");
      expect(existsSync(marker)).toBe(false);
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
