import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { resolvePlaywrightRepoRoot, visualQaArtifactDirectory } from "./visual-qa-artifacts";

const originalEnvironment = {
  repoRoot: process.env.INGENIUM_PLAYWRIGHT_REPO_ROOT,
  runId: process.env.INGENIUM_VISUAL_QA_RUN_ID,
};
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
  for (const [name, value] of Object.entries({
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

function temporaryRepository(): string {
  const repository = temporaryDirectory("ingenium-phase-5i-repo-");
  mkdirSync(join(repository, "tests", "ingenium-dashboard"), { recursive: true });
  writeFileSync(join(repository, "package.json"), "{}\n");
  execFileSync("git", ["init", "--quiet", repository], { encoding: "utf8" });
  return repository;
}

function configureRepository(repository: string, runId: string): void {
  process.env.INGENIUM_PLAYWRIGHT_REPO_ROOT = repository;
  process.env.INGENIUM_VISUAL_QA_RUN_ID = runId;
}

describe("Phase 5I visual artifact containment", () => {
  it("creates a canonical visual-QA root, run directory, and scope directory", () => {
    const repository = temporaryRepository();
    const runId = `phase-5i-${Date.now()}`;
    configureRepository(repository, runId);

    const directory = visualQaArtifactDirectory("dashboard-desktop");
    const visualQaRoot = join(repository, "tests", "artifacts", "visual-qa");
    const runDirectory = join(visualQaRoot, runId);

    expect(resolvePlaywrightRepoRoot()).toBe(repository);
    expect(realpathSync(visualQaRoot)).toBe(visualQaRoot);
    expect(realpathSync(runDirectory)).toBe(runDirectory);
    expect(realpathSync(directory)).toBe(directory);
    expect(visualQaArtifactDirectory("dashboard-desktop")).toBe(directory);
  });

  it.each([".", ".."]) ("rejects a dot-segment run id: %s", (runId) => {
    const repository = temporaryRepository();
    configureRepository(repository, runId);

    expect(() => visualQaArtifactDirectory("dashboard-desktop")).toThrow(/dot path component/);
    expect(existsSync(join(repository, "tests", "artifacts"))).toBe(false);
  });

  it.each([".", ".."]) ("rejects a dot-segment scope: %s", (scope) => {
    const repository = temporaryRepository();
    configureRepository(repository, "phase-5i-safe-run");

    expect(() => visualQaArtifactDirectory(scope)).toThrow(/dot path component/);
    expect(existsSync(join(repository, "tests", "artifacts"))).toBe(false);
  });

  it.each([
    ["run id", "phase-5i/../../outside", "dashboard-desktop"],
    ["scope", "phase-5i-safe-run", "dashboard/../../outside"],
  ])("rejects lexical escape in the %s", (_name, runId, scope) => {
    const repository = temporaryRepository();
    configureRepository(repository, runId);

    expect(() => visualQaArtifactDirectory(scope)).toThrow(/lexical path component/);
    expect(readdirSync(join(repository, "tests"))).toEqual(["ingenium-dashboard"]);
  });

  it("rejects a symlinked visual-QA root without writing through it", () => {
    const repository = temporaryRepository();
    const visualQaRoot = join(repository, "tests", "artifacts", "visual-qa");
    const outside = temporaryDirectory("ingenium-phase-5i-root-target-");
    mkdirSync(dirname(visualQaRoot), { recursive: true });
    symlinkSync(outside, visualQaRoot, "dir");
    configureRepository(repository, "phase-5i-root-symlink");

    expect(() => visualQaArtifactDirectory("dashboard-desktop")).toThrow(/symlinked ancestor/);
    expect(readdirSync(outside)).toHaveLength(0);
    expect(lstatSync(visualQaRoot).isSymbolicLink()).toBe(true);
  });

  it("rejects a symlinked run parent without writing through it", () => {
    const repository = temporaryRepository();
    const visualQaRoot = join(repository, "tests", "artifacts", "visual-qa");
    const outside = temporaryDirectory("ingenium-phase-5i-run-target-");
    const runId = "phase-5i-run-symlink";
    mkdirSync(visualQaRoot, { recursive: true });
    symlinkSync(outside, join(visualQaRoot, runId), "dir");
    configureRepository(repository, runId);

    expect(() => visualQaArtifactDirectory("dashboard-desktop")).toThrow(/symlinked ancestor/);
    expect(readdirSync(outside)).toHaveLength(0);
    expect(lstatSync(join(visualQaRoot, runId)).isSymbolicLink()).toBe(true);
  });
});
