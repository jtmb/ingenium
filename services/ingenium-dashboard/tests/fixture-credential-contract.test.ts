import { afterEach, describe, expect, it } from "vitest";
import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  cleanupTestRun,
  createTestRunContext,
  getTestRunApiTokenPath,
  resetTestRunContextForTests,
  updateTestRunManifest,
} from "../../../tests/test-run-context";
import {
  ensureDashboardApiTokenFile,
  getDashboardFixtureEnvironment,
} from "../../../tests/ingenium-dashboard/fixture-credentials";
import { suitePreflightHeaders } from "../../../tests/ingenium-dashboard/suite-containment";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const testToken = "A".repeat(48);
const originalEnvironment = {
  apiToken: process.env.INGENIUM_API_TOKEN,
  tokenFile: process.env.INGENIUM_API_TOKEN_FILE,
  repoRoot: process.env.INGENIUM_PLAYWRIGHT_REPO_ROOT,
};
const contexts: Array<ReturnType<typeof createTestRunContext>> = [];
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const context of contexts.splice(0)) {
    try {
      if (existsSync(context.manifestPath)) cleanupTestRun(context.manifestPath);
    } catch {
      rmSync(context.runDir, { recursive: true, force: true });
    }
    rmSync(dirname(context.telemetryPath!), { recursive: true, force: true });
  }
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
  resetTestRunContextForTests();
  for (const [name, value] of Object.entries({
    INGENIUM_API_TOKEN: originalEnvironment.apiToken,
    INGENIUM_API_TOKEN_FILE: originalEnvironment.tokenFile,
    INGENIUM_PLAYWRIGHT_REPO_ROOT: originalEnvironment.repoRoot,
  })) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

function contextForCredentialTest() {
  process.env.INGENIUM_PLAYWRIGHT_REPO_ROOT = repoRoot;
  const context = createTestRunContext({
    tempRoot: mkdtempSync(join(tmpdir(), "ingenium-fixture-credential-")),
    ports: { api: 45401, dashboard: 45402, fixture: 45403 },
  });
  contexts.push(context);
  temporaryDirectories.push(context.tempRoot);
  return context;
}

describe("dashboard fixture credential boundary", () => {
  it("sends a bearer only to the API preflight target", () => {
    process.env.INGENIUM_API_TOKEN = testToken;

    expect(suitePreflightHeaders("api")).toEqual({ authorization: `Bearer ${testToken}` });
    expect(suitePreflightHeaders("dashboard")).toEqual({});
    expect(suitePreflightHeaders("opencode")).toEqual({});
    expect(suitePreflightHeaders("cli")).toEqual({});
  });

  it("passes only a run-owned 0600 token-file path to the dashboard", () => {
    process.env.INGENIUM_API_TOKEN = "inline-parent-secret";
    const context = contextForCredentialTest();

    const environment = getDashboardFixtureEnvironment(context, testToken);
    const tokenFile = getTestRunApiTokenPath(context);

    expect(environment).toEqual({ INGENIUM_API_TOKEN_FILE: tokenFile });
    expect(environment.INGENIUM_API_TOKEN).toBeUndefined();
    expect(statSync(tokenFile).mode & 0o777).toBe(0o600);
    expect(readFileSync(tokenFile, "utf8")).toBe(`${testToken}\n`);
    expect(lstatSync(tokenFile).isSymbolicLink()).toBe(false);
  });

  it("removes the token with successful run cleanup", () => {
    const context = contextForCredentialTest();
    const tokenFile = ensureDashboardApiTokenFile(context, testToken);

    expect(existsSync(tokenFile)).toBe(true);
    cleanupTestRun(context.manifestPath);

    expect(existsSync(tokenFile)).toBe(false);
    expect(existsSync(context.runDir)).toBe(false);
  });

  it("retains the token with stopping recovery evidence", () => {
    const context = contextForCredentialTest();
    const tokenFile = ensureDashboardApiTokenFile(context, testToken);
    updateTestRunManifest(context.manifestPath, { status: "stopping" });

    expect(() => cleanupTestRun(context.manifestPath)).toThrow(/recovery evidence/);
    expect(existsSync(tokenFile)).toBe(true);

    updateTestRunManifest(context.manifestPath, { status: "created" });
  });
});
