import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProject } from "../lib/tools/projects.js";
import { storeObservation } from "../lib/tools/observations.js";
import { runSynthesis, getSynthesisStatus } from "../lib/tools/synthesis.js";
import { getTraits, upsertTrait } from "../lib/tools/personality.js";

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

  it("pattern and insight observations do not create traits", async () => {
    storeObservation(projectId, "pattern", "User always adds JSDoc comments", 5);
    storeObservation(projectId, "insight", "Discovered container PTY needs glibc", 6);

    const traitCountBefore = getTraits(projectId).length;
    const result = await runSynthesis(projectId);
    const traitCountAfter = getTraits(projectId).length;

    // Observations should be processed but no new traits created
    expect(result.observations_processed).toBe(2);
    expect(traitCountAfter).toBe(traitCountBefore);
  });

  it("new traits start below display threshold", async () => {
    storeObservation(projectId, "correction", "User corrected formatting style", 7);

    await runSynthesis(projectId);

    const traits = getTraits(projectId);
    const newTrait = traits.find(t => t.trait_value === "User corrected formatting style");
    expect(newTrait).toBeDefined();
    expect(newTrait!.confidence).toBeLessThan(0.3);
  });

  it("trait reaches display threshold after 2 confirmations", async () => {
    // First observation — confidence starts at 0.15
    storeObservation(projectId, "preference", "User wants dark theme", 8);
    await runSynthesis(projectId);

    const traitsAfter1 = getTraits(projectId);
    const trait1 = traitsAfter1.find(t => t.trait_value === "User wants dark theme");
    expect(trait1).toBeDefined();
    expect(trait1!.confidence).toBeCloseTo(0.15, 1);

    // Second observation — confidence boosts to 0.15 + 0.15 = 0.30
    storeObservation(projectId, "preference", "User wants dark theme", 8);
    await runSynthesis(projectId);

    const traitsAfter2 = getTraits(projectId);
    const trait2 = traitsAfter2.find(t => t.trait_value === "User wants dark theme");
    expect(trait2).toBeDefined();
    expect(trait2!.confidence).toBeGreaterThanOrEqual(0.3);
  });

  it("trait decay reduces confidence after 7 days", async () => {
    // Create a trait with old updated_at
    const oldDate = new Date(Date.now() - 9 * 24 * 60 * 60 * 1000).toISOString();
    const trait = upsertTrait(
      projectId,
      "code_preference",
      "old-formatting-style",
      "Old formatting style",
      0.4,
    );

    // Manually set updated_at to 9 days ago via raw update (bypass upsertTrait clock reset)
    const { getDb, checkpointAfterWrite } = await import("../lib/db.js");
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./.ingenium/data.db");
    db.prepare("UPDATE personality_traits SET updated_at = ? WHERE id = ?").run(oldDate, trait.id);
    checkpointAfterWrite();

    // Run synthesis — decay should apply
    await runSynthesis(projectId);

    const traits = getTraits(projectId);
    const decayed = traits.find(t => t.id === trait.id);
    expect(decayed).toBeDefined();
    expect(decayed!.confidence).toBeLessThan(0.4); // Should be 0.35 after -0.05 decay
  });
});
