import { afterEach, describe, expect, it, vi } from "vitest";
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
import { GET as bootstrapFixtureSession } from "../src/app/test-fixture/session/route";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const testToken = "A".repeat(48);
const originalEnvironment = {
  apiToken: process.env.INGENIUM_API_TOKEN,
  tokenFile: process.env.INGENIUM_API_TOKEN_FILE,
  repoRoot: process.env.INGENIUM_PLAYWRIGHT_REPO_ROOT,
  apiPort: process.env.INGENIUM_API_PORT,
  port: process.env.PORT,
  project: process.env.INGENIUM_PROJECT,
  runNonce: process.env.INGENIUM_TEST_RUN_NONCE,
  testMode: process.env.INGENIUM_API_TEST_MODE,
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
  vi.unstubAllGlobals();
  for (const [name, value] of Object.entries({
    INGENIUM_API_TOKEN: originalEnvironment.apiToken,
    INGENIUM_API_TOKEN_FILE: originalEnvironment.tokenFile,
    INGENIUM_PLAYWRIGHT_REPO_ROOT: originalEnvironment.repoRoot,
    INGENIUM_API_PORT: originalEnvironment.apiPort,
    PORT: originalEnvironment.port,
    INGENIUM_PROJECT: originalEnvironment.project,
    INGENIUM_TEST_RUN_NONCE: originalEnvironment.runNonce,
    INGENIUM_API_TEST_MODE: originalEnvironment.testMode,
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

  it("bootstraps QA Vision through a test-only server exchange without exposing the bearer", async () => {
    const context = contextForCredentialTest();
    getDashboardFixtureEnvironment(context, testToken);
    process.env.INGENIUM_API_TEST_MODE = "1";
    process.env.INGENIUM_TEST_RUN_NONCE = context.runNonce;
    process.env.INGENIUM_PROJECT = context.project;
    process.env.INGENIUM_API_PORT = String(context.ports.api);
    process.env.PORT = String(context.ports.dashboard);
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { authenticated: true } }), {
      status: 200,
      headers: { "Set-Cookie": "__Host-ingenium_session=fixture-session; Path=/; Secure; HttpOnly; SameSite=Strict" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await bootstrapFixtureSession(new Request(`http://127.0.0.1:${context.ports.dashboard}/test-fixture/session`, {
      headers: { Authorization: "Bearer browser-supplied-value" },
    }));

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(`http://127.0.0.1:${context.ports.dashboard}/`);
    expect(response.headers.get("set-cookie")).toContain("fixture-session");
    expect(fetchMock).toHaveBeenCalledWith(
      `http://127.0.0.1:${context.ports.api}/api/v1/auth/fixture-session`,
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: `Bearer ${testToken}`,
          "x-ingenium-fixture-run-nonce": context.runNonce,
          "x-ingenium-fixture-project": context.project,
          "x-ingenium-internal-service": "1",
        },
      }),
    );
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("browser-supplied-value");
  });
});
