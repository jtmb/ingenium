import { afterEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { manualArtifactDirectory } from "./visual-qa-artifacts";

const require = createRequire(import.meta.url);
const screenshotScript = require("../../scripts/take-screenshots.js") as {
  createRunId: (now: Date) => string;
};
const hygieneScript = join(process.cwd(), "tests", "test-artifact-hygiene.sh");
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

function temporaryRepository(): string {
  const repository = temporaryDirectory("ingenium-phase-5y-repo-");
  mkdirSync(join(repository, "tests", "artifacts", "visual-qa"), { recursive: true });
  mkdirSync(join(repository, "tests", "artifacts", "manual"), { recursive: true });
  mkdirSync(join(repository, "tests", "artifacts", "legacy"), { recursive: true });
  mkdirSync(join(repository, "tests", "test-results"), { recursive: true });
  writeFileSync(join(repository, "tests", "artifacts", ".gitkeep"), "");
  writeFileSync(join(repository, "package.json"), "{}\n");
  execFileSync("git", ["init", "--quiet", repository], { encoding: "utf8" });
  return repository;
}

function runHygiene(repository: string) {
  return spawnSync("bash", [hygieneScript], {
    cwd: repository,
    encoding: "utf8",
  });
}

describe("Phase 5Y screenshot and artifact hygiene", () => {
  it("uses a date-and-UUID run id in the standalone screenshot script", () => {
    expect(screenshotScript.createRunId(new Date("2026-07-25T12:34:56.789Z")))
      .toMatch(/^manual-2026-07-25T12-34-56-789Z-[0-9a-f-]{36}$/);
  });

  it("allocates manual captures below manual/<run-id>/", () => {
    const repository = temporaryRepository();
    process.env.INGENIUM_PLAYWRIGHT_REPO_ROOT = repository;
    process.env.INGENIUM_MANUAL_SCREENSHOT_RUN_ID = "manual-2026-07-25-run-1";

    const directory = manualArtifactDirectory("mail-darkmode");

    expect(directory).toBe(join(
      repository,
      "tests",
      "artifacts",
      "manual",
      "manual-2026-07-25-run-1",
      "mail-darkmode",
    ));
    expect(existsSync(directory)).toBe(true);
  });

  it("generates a date-and-UUID run id when no manual run id is provided", () => {
    const repository = temporaryRepository();
    process.env.INGENIUM_PLAYWRIGHT_REPO_ROOT = repository;
    delete process.env.INGENIUM_MANUAL_SCREENSHOT_RUN_ID;
    delete process.env.INGENIUM_VISUAL_QA_RUN_ID;
    delete process.env.INGENIUM_TEST_RUN_NONCE;

    const directory = manualArtifactDirectory();
    const runId = directory.split("/").at(-1);

    expect(runId).toMatch(/^manual-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[0-9a-f-]{36}$/);
    expect(readFileSync(join(repository, "package.json"), "utf8")).toBe("{}\n");
  });

  it("reports nested tests/tests/test-results without deleting evidence", () => {
    const repository = temporaryRepository();
    const misplaced = join(repository, "tests", "tests", "test-results");
    const evidence = join(misplaced, "test-failed-1.png");
    mkdirSync(misplaced, { recursive: true });
    writeFileSync(evidence, "preserve me");

    const result = runHygiene(repository);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toMatch(/misplaced tests\/tests\/test-results/i);
    expect(readFileSync(evidence, "utf8")).toBe("preserve me");
  });

  it("reports a loose artifact outside canonical roots without deleting it", () => {
    const repository = temporaryRepository();
    const loose = join(repository, "tests", "loose-screenshot.png");
    writeFileSync(loose, "preserve me");

    const result = runHygiene(repository);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toMatch(/loose artifact/i);
    expect(readFileSync(loose, "utf8")).toBe("preserve me");
  });

  it("does not misclassify agent reference Markdown as a loose test artifact", () => {
    const repository = temporaryRepository();
    const reference = join(
      repository,
      ".agents",
      "skills",
      "input-systems",
      "references",
      "buffering-and-accessibility.md",
    );
    mkdirSync(dirname(reference), { recursive: true });
    writeFileSync(reference, "reference material\n");

    const result = runHygiene(repository);

    expect(result.status).toBe(0);
    expect(readFileSync(reference, "utf8")).toBe("reference material\n");
  });

  it("reports a manual capture placed directly under the manual root", () => {
    const repository = temporaryRepository();
    const loose = join(repository, "tests", "artifacts", "manual", "loose-screenshot.png");
    writeFileSync(loose, "preserve me");

    const result = runHygiene(repository);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toMatch(/loose artifact/i);
    expect(readFileSync(loose, "utf8")).toBe("preserve me");
  });

  it("classifies retained manual runs under the visual-QA root without deleting them", () => {
    const repository = temporaryRepository();
    const misplaced = join(
      repository,
      "tests",
      "artifacts",
      "visual-qa",
      "manual-2026-07-25T12-00-00-000Z",
    );
    mkdirSync(misplaced, { recursive: true });

    const result = runHygiene(repository);

    expect(result.status).toBe(0);
    expect(`${result.stdout}${result.stderr}`).toMatch(/retained legacy visual-QA manual evidence/i);
    expect(existsSync(misplaced)).toBe(true);
  });

  it("fails a future unscoped visual-QA artifact without deleting it", () => {
    const repository = temporaryRepository();
    const loose = join(repository, "tests", "artifacts", "visual-qa", "future-screenshot.png");
    writeFileSync(loose, "preserve me");

    const result = runHygiene(repository);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toMatch(/loose artifact/i);
    expect(readFileSync(loose, "utf8")).toBe("preserve me");
  });

  it("classifies retained test-run and Playwright MCP evidence", () => {
    const repository = temporaryRepository();
    const legacyRun = join(repository, "tests", "artifacts", "test-runs", "legacy-pre-run-20260725");
    const playwrightMcp = join(repository, ".playwright-mcp");
    mkdirSync(legacyRun, { recursive: true });
    mkdirSync(playwrightMcp, { recursive: true });
    writeFileSync(join(legacyRun, "evidence.txt"), "preserve me");
    writeFileSync(join(playwrightMcp, "snapshot.json"), "preserve me");

    const result = runHygiene(repository);
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(0);
    expect(output).toMatch(/retained legacy test-run evidence/i);
    expect(output).toMatch(/retained legacy \.playwright-mcp evidence/i);
    expect(readFileSync(join(legacyRun, "evidence.txt"), "utf8")).toBe("preserve me");
    expect(readFileSync(join(playwrightMcp, "snapshot.json"), "utf8")).toBe("preserve me");
  });
});
