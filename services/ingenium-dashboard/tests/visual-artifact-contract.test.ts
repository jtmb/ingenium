import { afterEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  manualArtifactDirectory,
  resolvePlaywrightRepoRoot,
  visualQaArtifactDirectory,
  visualQaRunDirectory,
} from "../../../tests/ingenium-dashboard/visual-qa-artifacts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const hygieneScript = join(repoRoot, "tests", "test-artifact-hygiene.sh");
const originalEnvironment = {
  repoRoot: process.env.INGENIUM_PLAYWRIGHT_REPO_ROOT,
  manualRunId: process.env.INGENIUM_MANUAL_SCREENSHOT_RUN_ID,
  visualRunId: process.env.INGENIUM_VISUAL_QA_RUN_ID,
  testRunNonce: process.env.INGENIUM_TEST_RUN_NONCE,
};
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
  for (const [name, value] of Object.entries({
    INGENIUM_PLAYWRIGHT_REPO_ROOT: originalEnvironment.repoRoot,
    INGENIUM_MANUAL_SCREENSHOT_RUN_ID: originalEnvironment.manualRunId,
    INGENIUM_VISUAL_QA_RUN_ID: originalEnvironment.visualRunId,
    INGENIUM_TEST_RUN_NONCE: originalEnvironment.testRunNonce,
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

function temporaryRepository(prefix: string): string {
  const repository = temporaryDirectory(prefix);
  mkdirSync(join(repository, "tests", "ingenium-dashboard"), { recursive: true });
  writeFileSync(join(repository, "package.json"), "{}\n");
  execFileSync("git", ["init", "--quiet", repository], { encoding: "utf8" });
  return repository;
}

function hygieneRepository(): string {
  const repository = temporaryRepository("ingenium-visual-artifact-hygiene-");
  mkdirSync(join(repository, "tests", "artifacts", "visual-qa"), { recursive: true });
  mkdirSync(join(repository, "tests", "artifacts", "manual"), { recursive: true });
  mkdirSync(join(repository, "tests", "artifacts", "legacy"), { recursive: true });
  mkdirSync(join(repository, "tests", "test-results"), { recursive: true });
  writeFileSync(join(repository, "tests", "artifacts", ".gitkeep"), "");
  return repository;
}

function configureRepository(repository: string, runId: string): void {
  process.env.INGENIUM_PLAYWRIGHT_REPO_ROOT = repository;
  process.env.INGENIUM_VISUAL_QA_RUN_ID = runId;
}

function runHygiene(repository: string) {
  return spawnSync("bash", [hygieneScript], { cwd: repository, encoding: "utf8" });
}

describe("visual artifact containment", () => {
  it("creates canonical visual-QA root, run, and scope directories", () => {
    const repository = temporaryRepository("ingenium-visual-artifact-repo-");
    configureRepository(repository, "run-contract");

    const directory = visualQaArtifactDirectory("dashboard-desktop");
    const visualQaRoot = join(repository, "tests", "artifacts", "visual-qa");
    const runDirectory = join(visualQaRoot, "run-contract");

    expect(resolvePlaywrightRepoRoot()).toBe(repository);
    expect(directory).toBe(join(runDirectory, "dashboard-desktop"));
    expect(realpathSync(visualQaRoot)).toBe(visualQaRoot);
    expect(realpathSync(runDirectory)).toBe(runDirectory);
    expect(realpathSync(directory)).toBe(directory);
    expect(visualQaArtifactDirectory("dashboard-desktop")).toBe(directory);
    expect(visualQaRunDirectory("run-contract")).toBe(runDirectory);
  });

  it("requires an explicit deterministic visual-QA run id", () => {
    const repository = temporaryRepository("ingenium-visual-artifact-repo-");
    process.env.INGENIUM_PLAYWRIGHT_REPO_ROOT = repository;
    delete process.env.INGENIUM_VISUAL_QA_RUN_ID;
    delete process.env.INGENIUM_TEST_RUN_NONCE;

    expect(() => visualQaArtifactDirectory("dashboard-desktop")).toThrow(/deterministic run id/);
    expect(existsSync(join(repository, "tests", "artifacts"))).toBe(false);
  });

  it("rejects roots that are not canonical git worktrees", () => {
    const fakeRoot = temporaryDirectory("ingenium-visual-artifact-fake-");
    mkdirSync(join(fakeRoot, "tests", "ingenium-dashboard"), { recursive: true });
    writeFileSync(join(fakeRoot, "package.json"), "{}\n");

    expect(() => resolvePlaywrightRepoRoot(fakeRoot)).toThrow(/git worktree|canonical repository root/);
    for (const root of ["relative/repository", "", "/tmp/not-an-ingenium-repository"]) {
      expect(() => resolvePlaywrightRepoRoot(root)).toThrow(/repository root|absolute path/);
    }
  });

  it.each([".", ".."]) ("rejects dot-segment run ids before mkdir: %s", (runId) => {
    const repository = temporaryRepository("ingenium-visual-artifact-repo-");
    configureRepository(repository, runId);

    expect(() => visualQaArtifactDirectory("dashboard-desktop")).toThrow(/dot path component/);
    expect(existsSync(join(repository, "tests", "artifacts"))).toBe(false);
  });

  it.each([".", ".."]) ("rejects dot-segment scopes before mkdir: %s", (scope) => {
    const repository = temporaryRepository("ingenium-visual-artifact-repo-");
    configureRepository(repository, "run-safe");

    expect(() => visualQaArtifactDirectory(scope)).toThrow(/dot path component/);
    expect(existsSync(join(repository, "tests", "artifacts"))).toBe(false);
  });

  it.each([
    ["run id", "run/../../outside", "dashboard-desktop"],
    ["scope", "run-safe", "dashboard/../../outside"],
  ])("rejects lexical escape in the %s", (_name, runId, scope) => {
    const repository = temporaryRepository("ingenium-visual-artifact-repo-");
    configureRepository(repository, runId);

    expect(() => visualQaArtifactDirectory(scope)).toThrow(/lexical path component/);
    expect(readdirSync(join(repository, "tests"))).toEqual(["ingenium-dashboard"]);
  });

  it("rejects symlinked visual-QA roots and run directories without writing through them", () => {
    const rootRepository = temporaryRepository("ingenium-visual-artifact-repo-");
    const rootTarget = temporaryDirectory("ingenium-visual-artifact-root-target-");
    const visualQaRoot = join(rootRepository, "tests", "artifacts", "visual-qa");
    mkdirSync(dirname(visualQaRoot), { recursive: true });
    symlinkSync(rootTarget, visualQaRoot, "dir");
    configureRepository(rootRepository, "run-root-symlink");

    expect(() => visualQaArtifactDirectory("dashboard-desktop")).toThrow(/symlinked ancestor/);
    expect(readdirSync(rootTarget)).toHaveLength(0);
    expect(lstatSync(visualQaRoot).isSymbolicLink()).toBe(true);

    const runRepository = temporaryRepository("ingenium-visual-artifact-repo-");
    const runTarget = temporaryDirectory("ingenium-visual-artifact-run-target-");
    const runRoot = join(runRepository, "tests", "artifacts", "visual-qa");
    mkdirSync(runRoot, { recursive: true });
    symlinkSync(runTarget, join(runRoot, "run-symlink"), "dir");
    configureRepository(runRepository, "run-symlink");

    expect(() => visualQaArtifactDirectory("dashboard-desktop")).toThrow(/symlinked ancestor/);
    expect(readdirSync(runTarget)).toHaveLength(0);
    expect(lstatSync(join(runRoot, "run-symlink")).isSymbolicLink()).toBe(true);
  });

  it("allocates manual captures below manual/<run-id>/", () => {
    const repository = temporaryRepository("ingenium-visual-artifact-repo-");
    process.env.INGENIUM_PLAYWRIGHT_REPO_ROOT = repository;
    process.env.INGENIUM_MANUAL_SCREENSHOT_RUN_ID = "manual-2026-07-25-run-1";

    const directory = manualArtifactDirectory("mail-darkmode");

    expect(directory).toBe(join(repository, "tests", "artifacts", "manual", "manual-2026-07-25-run-1", "mail-darkmode"));
    expect(existsSync(directory)).toBe(true);
  });

  it("generates a date-and-UUID manual run id", () => {
    const repository = temporaryRepository("ingenium-visual-artifact-repo-");
    process.env.INGENIUM_PLAYWRIGHT_REPO_ROOT = repository;
    delete process.env.INGENIUM_MANUAL_SCREENSHOT_RUN_ID;
    delete process.env.INGENIUM_VISUAL_QA_RUN_ID;
    delete process.env.INGENIUM_TEST_RUN_NONCE;

    expect(basename(manualArtifactDirectory())).toMatch(/^manual-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[0-9a-f-]{36}$/);
  });
});

describe("artifact hygiene", () => {
  it("reports misplaced or loose artifacts without deleting evidence", () => {
    const repository = hygieneRepository();
    const misplaced = join(repository, "tests", "tests", "test-results", "test-failed-1.png");
    const loose = join(repository, "tests", "artifacts", "manual", "loose-screenshot.png");
    mkdirSync(dirname(misplaced), { recursive: true });
    writeFileSync(misplaced, "preserve misplaced");
    writeFileSync(loose, "preserve loose");

    const result = runHygiene(repository);
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).not.toBe(0);
    expect(output).toMatch(/misplaced tests\/tests\/test-results/i);
    expect(output).toMatch(/loose artifact/i);
    expect(readFileSync(misplaced, "utf8")).toBe("preserve misplaced");
    expect(readFileSync(loose, "utf8")).toBe("preserve loose");
  });

  it("does not classify agent Markdown as test-artifact evidence", () => {
    const repository = hygieneRepository();
    const reference = join(repository, ".agents", "skills", "input-systems", "references", "buffering-and-accessibility.md");
    mkdirSync(dirname(reference), { recursive: true });
    writeFileSync(reference, "reference material\n");

    const result = runHygiene(repository);

    expect(result.status).toBe(0);
    expect(readFileSync(reference, "utf8")).toBe("reference material\n");
  });

  it("reports loose artifacts outside canonical roots without deleting them", () => {
    const repository = hygieneRepository();
    const loose = join(repository, "tests", "loose-screenshot.png");
    writeFileSync(loose, "preserve me");

    const result = runHygiene(repository);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toMatch(/loose artifact/i);
    expect(readFileSync(loose, "utf8")).toBe("preserve me");
  });

  it("classifies retained legacy visual, test-run, and Playwright evidence", () => {
    const repository = hygieneRepository();
    const manualRun = join(repository, "tests", "artifacts", "visual-qa", "manual-2026-07-25T12-00-00-000Z");
    const legacyRun = join(repository, "tests", "artifacts", "test-runs", "legacy-pre-run-20260725");
    const playwrightMcp = join(repository, ".playwright-mcp");
    mkdirSync(manualRun, { recursive: true });
    mkdirSync(legacyRun, { recursive: true });
    mkdirSync(playwrightMcp, { recursive: true });
    writeFileSync(join(legacyRun, "evidence.txt"), "preserve me");
    writeFileSync(join(playwrightMcp, "snapshot.json"), "preserve me");

    const result = runHygiene(repository);
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(0);
    expect(output).toMatch(/retained legacy visual-QA manual evidence/i);
    expect(output).toMatch(/retained legacy test-run evidence/i);
    expect(output).toMatch(/retained legacy \.playwright-mcp evidence/i);
    expect(existsSync(manualRun)).toBe(true);
    expect(readFileSync(join(legacyRun, "evidence.txt"), "utf8")).toBe("preserve me");
    expect(readFileSync(join(playwrightMcp, "snapshot.json"), "utf8")).toBe("preserve me");
  });

  it("rejects future unscoped visual-QA output without deleting it", () => {
    const repository = hygieneRepository();
    const loose = join(repository, "tests", "artifacts", "visual-qa", "future-screenshot.png");
    writeFileSync(loose, "preserve me");

    const result = runHygiene(repository);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toMatch(/loose artifact/i);
    expect(readFileSync(loose, "utf8")).toBe("preserve me");
  });
});
