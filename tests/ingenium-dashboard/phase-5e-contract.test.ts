import { afterEach, describe, expect, it } from "vitest";
import { chmodSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import {
  DASHBOARD_API_PROXY_ERROR_STATUS,
  getDashboardApiToken,
  proxy,
} from "../../services/ingenium-dashboard/src/proxy";
import { resolvePlaywrightRepoRoot, visualQaArtifactDirectory } from "./visual-qa-artifacts";
import { suitePreflightHeaders } from "./suite-containment";

const originalEnvironment = {
  apiToken: process.env.INGENIUM_API_TOKEN,
  tokenFile: process.env.INGENIUM_API_TOKEN_FILE,
  repoRoot: process.env.INGENIUM_PLAYWRIGHT_REPO_ROOT,
  runId: process.env.INGENIUM_VISUAL_QA_RUN_ID,
};
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
  for (const [name, value] of Object.entries({
    INGENIUM_API_TOKEN: originalEnvironment.apiToken,
    INGENIUM_API_TOKEN_FILE: originalEnvironment.tokenFile,
    INGENIUM_PLAYWRIGHT_REPO_ROOT: originalEnvironment.repoRoot,
    INGENIUM_VISUAL_QA_RUN_ID: originalEnvironment.runId,
  })) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function fakeRepositoryRoot(): string {
  const root = temporaryDirectory("ingenium-phase-5e-repo-");
  mkdirSync(join(root, "services", "ingenium-dashboard"), { recursive: true });
  mkdirSync(join(root, "tests", "ingenium-dashboard"), { recursive: true });
  writeFileSync(join(root, "package.json"), "{}\n");
  return root;
}

describe("Phase 5E dashboard token contract", () => {
  it("rejects an inline credential in production", () => {
    expect(getDashboardApiToken({})).toBeNull();
    expect(getDashboardApiToken({
      NODE_ENV: "production",
      INGENIUM_API_TOKEN: "A".repeat(48),
    })).toBeNull();
  });

  it("loads the production credential from a protected token file only", () => {
    const root = temporaryDirectory("ingenium-phase-5e-token-");
    const tokenFile = join(root, "api-token");
    const token = "A".repeat(48);
    writeFileSync(tokenFile, `${token}\n`, { mode: 0o600 });
    chmodSync(tokenFile, 0o600);

    expect(getDashboardApiToken({
      NODE_ENV: "production",
      INGENIUM_API_TOKEN_FILE: tokenFile,
    })).toBe(token);
  });

  it("keeps the server token out of the proxy response", async () => {
    const root = temporaryDirectory("ingenium-phase-5e-token-");
    const tokenFile = join(root, "api-token");
    const token = "A".repeat(48);
    writeFileSync(tokenFile, `${token}\n`, { mode: 0o600 });
    process.env.INGENIUM_API_TOKEN_FILE = tokenFile;
    delete process.env.INGENIUM_API_TOKEN;

    const response = proxy(new NextRequest("http://dashboard.test/api/v1/health"));
    expect(response.status).not.toBe(DASHBOARD_API_PROXY_ERROR_STATUS);
    expect(response.headers.get("authorization")).toBeNull();
    await expect(response.text()).resolves.not.toContain(token);
  });

  it("fails closed for an unsafe token-file path without exposing file details", () => {
    const root = temporaryDirectory("ingenium-phase-5e-token-");
    const tokenFile = join(root, "api-token");
    writeFileSync(tokenFile, `${"A".repeat(48)}\n`, { mode: 0o644 });

    expect(getDashboardApiToken({ INGENIUM_API_TOKEN_FILE: tokenFile })).toBeNull();
    expect(getDashboardApiToken({ INGENIUM_API_TOKEN_FILE: `${tokenFile}\u0000secret` })).toBeNull();
  });

  it("rejects symlinked token files", () => {
    const root = temporaryDirectory("ingenium-phase-5e-token-");
    const realTokenFile = join(root, "real-token");
    const linkedTokenFile = join(root, "api-token");
    writeFileSync(realTokenFile, `${"A".repeat(48)}\n`, { mode: 0o600 });
    symlinkSync(realTokenFile, linkedTokenFile);

    expect(getDashboardApiToken({ INGENIUM_API_TOKEN_FILE: linkedTokenFile })).toBeNull();
  });
});

describe("Phase 5E suite containment", () => {
  it("sends a bearer only to the API preflight target", () => {
    process.env.INGENIUM_API_TOKEN = "A".repeat(48);

    expect(suitePreflightHeaders("api")).toEqual({ authorization: `Bearer ${process.env.INGENIUM_API_TOKEN}` });
    expect(suitePreflightHeaders("dashboard")).toEqual({});
    expect(suitePreflightHeaders("opencode")).toEqual({});
    expect(suitePreflightHeaders("cli")).toEqual({});
  });

  it("creates run-scoped artifacts below the validated repository root", () => {
    const repoRoot = process.cwd();
    process.env.INGENIUM_PLAYWRIGHT_REPO_ROOT = repoRoot;
    process.env.INGENIUM_VISUAL_QA_RUN_ID = "run-phase-5e";

    try {
      const directory = visualQaArtifactDirectory("dashboard-desktop");
      expect(directory).toBe(join(repoRoot, "tests", "artifacts", "visual-qa", "run-phase-5e", "dashboard-desktop"));
      expect(resolvePlaywrightRepoRoot()).toBe(repoRoot);
    } finally {
      rmSync(join(repoRoot, "tests", "artifacts", "visual-qa", "run-phase-5e"), { recursive: true, force: true });
    }
  });

  it("rejects a marker-only fake repository root that is not the git worktree", () => {
    const fakeRoot = fakeRepositoryRoot();
    process.env.INGENIUM_PLAYWRIGHT_REPO_ROOT = fakeRoot;

    expect(() => resolvePlaywrightRepoRoot()).toThrow(/git worktree|canonical repository root/);
  });

  it.each([
    "relative/repository",
    "",
    "/tmp/not-an-ingenium-repository",
  ])("rejects an invalid repository root: %s", (repoRoot) => {
    process.env.INGENIUM_PLAYWRIGHT_REPO_ROOT = repoRoot;
    expect(() => resolvePlaywrightRepoRoot()).toThrow(/repository root|absolute path/);
  });
});
