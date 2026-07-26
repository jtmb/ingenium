import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  rmdirSync,
  statSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  cleanupTestRun,
  createTestRunContext,
  getTestRunApiTokenPath,
  resetTestRunContextForTests,
  updateTestRunManifest,
} from "../test-run-context";
import {
  getDashboardFixtureEnvironment,
  ensureDashboardApiTokenFile,
} from "./fixture-credentials";
import { resolvePlaywrightRepoRoot, visualQaArtifactDirectory } from "./visual-qa-artifacts";

const TEST_TOKEN = "A".repeat(48);
const originalEnvironment = {
  apiToken: process.env.INGENIUM_API_TOKEN,
  tokenFile: process.env.INGENIUM_API_TOKEN_FILE,
  repoRoot: process.env.INGENIUM_PLAYWRIGHT_REPO_ROOT,
  runId: process.env.INGENIUM_VISUAL_QA_RUN_ID,
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

function contextForCredentialTest() {
  const context = createTestRunContext({
    tempRoot: temporaryDirectory("ingenium-phase-5g-run-"),
    ports: { api: 45401, dashboard: 45402, fixture: 45403 },
  });
  contexts.push(context);
  return context;
}

describe("Phase 5G dashboard fixture credential boundary", () => {
  it("passes only a run-owned token-file path and creates it as 0600", () => {
    process.env.INGENIUM_API_TOKEN = "inline-parent-secret";
    const context = contextForCredentialTest();

    const environment = getDashboardFixtureEnvironment(context, TEST_TOKEN);
    const tokenFile = getTestRunApiTokenPath(context);
    const metadata = statSync(tokenFile);

    expect(environment).toEqual({ INGENIUM_API_TOKEN_FILE: tokenFile });
    expect(environment.INGENIUM_API_TOKEN).toBeUndefined();
    expect(metadata.mode & 0o777).toBe(0o600);
    expect(readFileSync(tokenFile, "utf8")).toBe(`${TEST_TOKEN}\n`);
    expect(lstatSync(tokenFile).isSymbolicLink()).toBe(false);
  });

  it("removes the token file with a successful run cleanup", () => {
    const context = contextForCredentialTest();
    const tokenFile = ensureDashboardApiTokenFile(context, TEST_TOKEN);

    expect(existsSync(tokenFile)).toBe(true);
    cleanupTestRun(context.manifestPath);

    expect(existsSync(tokenFile)).toBe(false);
    expect(existsSync(context.runDir)).toBe(false);
  });

  it("retains the token with stopping recovery evidence", () => {
    const context = contextForCredentialTest();
    const tokenFile = ensureDashboardApiTokenFile(context, TEST_TOKEN);
    updateTestRunManifest(context.manifestPath, { status: "stopping" });

    expect(() => cleanupTestRun(context.manifestPath)).toThrow(/recovery evidence/);
    expect(existsSync(tokenFile)).toBe(true);

    updateTestRunManifest(context.manifestPath, { status: "created" });
  });
});

describe("Phase 5G canonical visual artifact boundary", () => {
  it("rejects lexical escape in the run-id component before mkdir", () => {
    process.env.INGENIUM_PLAYWRIGHT_REPO_ROOT = process.cwd();
    process.env.INGENIUM_VISUAL_QA_RUN_ID = "../outside";

    expect(() => visualQaArtifactDirectory("dashboard-desktop")).toThrow(/lexical path component/);
  });

  it("rejects a symlinked artifact parent before mkdir", () => {
    const repoRoot = resolvePlaywrightRepoRoot(process.cwd());
    const artifactRoot = join(repoRoot, "tests", "artifacts", "visual-qa");
    const runId = `phase-5g-symlink-${randomUUID()}`;
    const linkedParent = join(artifactRoot, runId);
    const target = temporaryDirectory("ingenium-phase-5g-artifact-target-");
    mkdirSync(artifactRoot, { recursive: true });
    symlinkSync(target, linkedParent, "dir");
    process.env.INGENIUM_PLAYWRIGHT_REPO_ROOT = repoRoot;
    process.env.INGENIUM_VISUAL_QA_RUN_ID = runId;

    try {
      expect(() => visualQaArtifactDirectory("dashboard-desktop")).toThrow(/symlinked ancestor/);
      expect(existsSync(join(target, "dashboard-desktop"))).toBe(false);
    } finally {
      unlinkSync(linkedParent);
      try {
        if (lstatSync(artifactRoot).isDirectory() && readdirEmpty(artifactRoot)) rmdirSync(artifactRoot);
      } catch {
        // Preserve pre-existing artifact evidence if another run owns it.
      }
    }
  });
});

function readdirEmpty(path: string): boolean {
  return readdirSync(path).length === 0;
}
