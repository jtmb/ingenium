import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProject } from "../lib/tools/projects.js";
import { storeObservation, deleteObservation, getObservation } from "../lib/tools/observations.js";
import {
  upsertTrait,
  getTraits,
  getProfile,
  disableTrait,
  updateConfidence,
  setActive,
  listTraits,
  deleteTrait,
  deleteAllTraits,
} from "../lib/tools/personality.js";

let tempDir: string;
let projectId: string;

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), "ingenium-test-personality-"));
  process.env.INGENIUM_CORE_DB_PATH = join(tempDir, "test.db");
  const project = createProject("test-project");
  projectId = project.id;
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("personality traits", () => {
  it("creates a new trait", () => {
    const obs = storeObservation(projectId, "preference", "User prefers snake_case");
    const trait = upsertTrait(projectId, "code_preference", "snake_case", "Prefers snake_case naming", 0.6, obs.id);
    expect(trait.trait_type).toBe("code_preference");
    expect(trait.trait_value).toBe("snake_case");
    expect(trait.confidence).toBe(0.6);
    expect(trait.is_active).toBe(1);
  });

  it("boosts confidence on re-observation", () => {
    const obs = storeObservation(projectId, "preference", "User wrote snake_case again");
    const trait = upsertTrait(projectId, "code_preference", "snake_case", undefined, undefined, obs.id);
    // Confidence should be original (0.6) + boost (0.1) = 0.7
    expect(trait.confidence).toBeCloseTo(0.7, 1);
  });

  it("lists traits filtered by type", () => {
    upsertTrait(projectId, "communication_style", "concise", "Prefers concise communication", 0.5);
    const codeTraits = getTraits(projectId, "code_preference");
    expect(codeTraits.length).toBeGreaterThanOrEqual(1);
    expect(codeTraits[0]!.trait_type).toBe("code_preference");
  });

  it("lists all active traits", () => {
    const all = getTraits(projectId);
    expect(all.length).toBeGreaterThanOrEqual(2);
    all.forEach((t) => expect(t.is_active).toBe(1));
  });

  it("returns aggregated profile", () => {
    const profile = getProfile(projectId);
    expect(Array.isArray(profile)).toBe(true);
    // Should have entries for each trait_type
    expect(profile.length).toBeGreaterThanOrEqual(1);
  });

  it("getProfile filters traits below 0.30 by default", () => {
    // Create a low-confidence trait
    const obs = storeObservation(projectId, "preference", "User might prefer 4-space indentation");
    upsertTrait(projectId, "code_preference", "low-conf-trait", "Low confidence trait", 0.12, obs.id);

    const profile = getProfile(projectId);
    // The low-confidence trait (0.12) should NOT appear in the profile
    // Parse the traits JSON string to check
    let foundLow = false;
    for (const row of profile) {
      const traits = JSON.parse(row.traits);
      if (traits.some((t: any) => t.trait_value === "low-conf-trait")) {
        foundLow = true;
      }
    }
    expect(foundLow).toBe(false);
  });

  it("getProfile with includeHidden shows all active traits", () => {
    const profile = getProfile(projectId, { includeHidden: true });
    expect(Array.isArray(profile)).toBe(true);
    // Should include the low-confidence trait now
    let foundLow = false;
    for (const row of profile) {
      const traits = JSON.parse(row.traits);
      if (traits.some((t: any) => t.trait_value === "low-conf-trait")) {
        foundLow = true;
      }
    }
    expect(foundLow).toBe(true);
  });

  it("disables a trait", () => {
    const obs = storeObservation(projectId, "pattern", "User stopped using X pattern");
    const trait = upsertTrait(projectId, "workflow_pattern", "X-pattern", "Old X pattern", 0.3, obs.id);
    disableTrait(trait.id);
    const afterDisable = getTraits(projectId, "workflow_pattern");
    expect(afterDisable.find((t) => t.id === trait.id)).toBeUndefined();
  });

  it("updates confidence with delta", () => {
    const trait = upsertTrait(projectId, "terminology", "foo-bar", "Uses foo-bar term", 0.5);
    const updated = updateConfidence(projectId, "terminology", "foo-bar", 0.2);
    expect(updated.confidence).toBeCloseTo(0.7, 1);
  });

  it("clamps confidence to [0.0, 0.95]", () => {
    const trait = upsertTrait(projectId, "personality_trait", "test-clamp", "Test clamping", 0.9);
    const above = updateConfidence(projectId, "personality_trait", "test-clamp", 0.5);
    expect(above.confidence).toBeCloseTo(0.95, 1);
    const below = updateConfidence(projectId, "personality_trait", "test-clamp", -2.0);
    expect(below.confidence).toBeCloseTo(0.0, 1);
  });

  it("dismiss sets is_active to false", () => {
    const obs = storeObservation(projectId, "preference", "User likes camelCase naming");
    const trait = upsertTrait(projectId, "code_preference", "camelCase-naming", "Prefers camelCase", 0.5, obs.id);
    expect(trait.is_active).toBe(1);

    setActive(projectId, trait.id, false);

    // Verify via listTraits with includeInactive
    const allTraits = listTraits(projectId, true);
    const dismissed = allTraits.find(t => t.id === trait.id);
    expect(dismissed).toBeDefined();
    expect(dismissed!.is_active).toBe(0);
  });

  it("listTraits excludes inactive by default", () => {
    // Create two traits
    const obs1 = storeObservation(projectId, "preference", "User uses TypeScript strict mode");
    const obs2 = storeObservation(projectId, "correction", "User prefers explicit return types");
    upsertTrait(projectId, "code_preference", "ts-strict-mode", "Uses strict mode", 0.6, obs1.id);
    upsertTrait(projectId, "feedback_style", "explicit-returns", "Explicit return types", 0.4, obs2.id);

    // Dismiss one
    const all = listTraits(projectId, true);
    const toDismiss = all.find(t => t.trait_value === "ts-strict-mode")!;
    setActive(projectId, toDismiss.id, false);

    // Default list should exclude inactive
    const active = listTraits(projectId);
    expect(active.some(t => t.trait_value === "ts-strict-mode")).toBe(false);
    expect(active.some(t => t.trait_value === "explicit-returns")).toBe(true);
  });

  it("includeInactive flag shows all traits", () => {
    const all = listTraits(projectId, true);
    const active = listTraits(projectId, false);

    // includeInactive=true should return at least as many as the default
    expect(all.length).toBeGreaterThanOrEqual(active.length);

    // The includeInactive list should contain previously dismissed trait
    expect(all.some(t => t.trait_value === "ts-strict-mode")).toBe(true);
    expect(all.some(t => t.trait_value === "explicit-returns")).toBe(true);
  });

  it("deletes a single trait by id scoped to project", () => {
    const obs = storeObservation(projectId, "preference", "User prefers tabs over spaces");
    const trait = upsertTrait(projectId, "code_preference", "tabs-over-spaces", "Prefers tabs", 0.5, obs.id);
    const deleted = deleteTrait(projectId, trait.id);
    expect(deleted).toBe(true);
    const allTraits = listTraits(projectId, true);
    expect(allTraits.find(t => t.id === trait.id)).toBeUndefined();
  });

  it("returns false when deleting non-existent trait", () => {
    const deleted = deleteTrait(projectId, 99999);
    expect(deleted).toBe(false);
  });

  it("deletes all traits for a project", () => {
    // Create a few traits
    const obs1 = storeObservation(projectId, "preference", "User likes async/await");
    const obs2 = storeObservation(projectId, "correction", "User prefers early returns");
    upsertTrait(projectId, "code_preference", "async-await", "Uses async/await", 0.6, obs1.id);
    upsertTrait(projectId, "feedback_style", "early-returns", "Prefers early returns", 0.4, obs2.id);

    const count = deleteAllTraits(projectId);
    expect(count).toBeGreaterThanOrEqual(2);

    const remaining = listTraits(projectId, true);
    expect(remaining.length).toBe(0);
  });

  it("sets exemplar_observation_id to NULL when referenced observation is deleted (ON DELETE SET NULL)", () => {
    const obs = storeObservation(projectId, "preference", "User prefers async/await pattern");
    const trait = upsertTrait(projectId, "code_preference", "async-await-delete-test", "Uses async/await", 0.6, obs.id);
    expect(trait.exemplar_observation_id).toBe(obs.id);

    // Delete the observation — should succeed (FK uses ON DELETE SET NULL)
    const deleted = deleteObservation(projectId, obs.id);
    expect(deleted).toBe(true);

    // Verify observation is gone
    const refetchedObs = getObservation(obs.id);
    expect(refetchedObs).toBeUndefined();

    // Verify trait still exists but exemplar_observation_id is now NULL
    const allTraits = listTraits(projectId, true);
    const refetchedTrait = allTraits.find(t => t.id === trait.id);
    expect(refetchedTrait).toBeDefined();
    expect(refetchedTrait!.exemplar_observation_id).toBeNull();
  });
});
