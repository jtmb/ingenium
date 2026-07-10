import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProject } from "../lib/tools/projects.js";
import { storeObservation } from "../lib/tools/observations.js";
import { runSynthesis, getSynthesisStatus } from "../lib/tools/synthesis.js";

let tempDir: string;
let projectId: string;

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), "ingenium-test-synthesis-"));
  process.env.INGENIUM_CORE_DB_PATH = join(tempDir, "test.db");
  const project = createProject("test-project");
  projectId = project.id;
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("synthesis pipeline", () => {
  it("returns empty result when no observations exist", async () => {
    const result = await runSynthesis(projectId);
    expect(result.observations_processed).toBe(0);
    expect(result.errors.length).toBe(0);
  });

  it("processes correction observations into traits", async () => {
    storeObservation(projectId, "correction", "User corrected method naming", 7);
    storeObservation(projectId, "correction", "User asked for more concise code", 6);
    storeObservation(projectId, "preference", "User likes 2-space indentation", 8);

    const result = await runSynthesis(projectId);
    expect(result.observations_processed).toBe(3);
    expect(result.traits_created + result.traits_updated).toBeGreaterThanOrEqual(1);
    expect(result.errors.length).toBe(0);
  });

  it("skips already processed observations", async () => {
    const result = await runSynthesis(projectId);
    // Second run should find no pending observations
    expect(result.observations_processed).toBe(0);
  });

  it("reports synthesis status", () => {
    const status = getSynthesisStatus(projectId);
    expect(status.total_observations).toBeGreaterThanOrEqual(3);
    expect(status.pending_count).toBe(0);
    expect(status.processed_count).toBeGreaterThanOrEqual(3);
    expect(status.trait_count).toBeGreaterThanOrEqual(1);
    expect(status.last_synthesis_at).toBeTruthy();
  });

  it("handles terminology observations", async () => {
    storeObservation(projectId, "terminology", "User calls it 'deploy' not 'release'", 5);
    const result = await runSynthesis(projectId);
    expect(result.observations_processed).toBe(1);
    expect(result.traits_created + result.traits_updated).toBeGreaterThanOrEqual(1);
  });

  it("handles mixed observation types", async () => {
    storeObservation(projectId, "behavior", "User always reviews PRs in the morning", 4);
    storeObservation(projectId, "workflow", "User runs lint before commit", 7);
    storeObservation(projectId, "goal", "User wants to improve test coverage", 6);
    storeObservation(projectId, "error", "User hit TypeScript strict mode error", 3);
    storeObservation(projectId, "feedback", "User said the response was too long", 8);

    const result = await runSynthesis(projectId);
    expect(result.observations_processed).toBe(5);
    expect(result.errors.length).toBe(0);
  });
});
