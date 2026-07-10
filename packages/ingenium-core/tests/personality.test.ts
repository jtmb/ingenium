import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProject } from "../lib/tools/projects.js";
import { storeObservation } from "../lib/tools/observations.js";
import {
  upsertTrait,
  getTraits,
  getProfile,
  disableTrait,
  updateConfidence,
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

  it("clamps confidence to [0.0, 1.0]", () => {
    const trait = upsertTrait(projectId, "personality_trait", "test-clamp", "Test clamping", 0.9);
    const above = updateConfidence(projectId, "personality_trait", "test-clamp", 0.5);
    expect(above.confidence).toBeCloseTo(1.0, 1);
    const below = updateConfidence(projectId, "personality_trait", "test-clamp", -2.0);
    expect(below.confidence).toBeCloseTo(0.0, 1);
  });
});
