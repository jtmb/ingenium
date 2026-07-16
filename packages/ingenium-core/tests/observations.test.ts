import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProject } from "../lib/tools/projects.js";
import {
  storeObservation,
  getObservations,
  searchObservations,
  getObservation,
  updateObservation,
  countUnprocessed,
  getUnprocessedBatch,
  deleteObservation,
  deleteObservationsBySource,
} from "../lib/tools/observations.js";

let tempDir: string;
let projectId: string;

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), "ingenium-test-observations-"));
  process.env.INGENIUM_CORE_DB_PATH = join(tempDir, "test.db");
  const project = createProject("test-project");
  projectId = project.id;
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("observations", () => {
  it("stores an observation with correct type", () => {
    const obs = storeObservation(projectId, "correction", "User prefers snake_case naming");
    expect(obs.observation_type).toBe("correction");
    expect(obs.content).toBe("User prefers snake_case naming");
    expect(obs.status).toBe("pending");
    expect(obs.importance).toBe(5);
    expect(obs.id).toBeGreaterThan(0);
  });

  it("stores a preference observation with custom importance", () => {
    const obs = storeObservation(projectId, "preference", "User likes brief responses", 8);
    expect(obs.importance).toBe(8);
  });

  it("lists observations with status filter", () => {
    storeObservation(projectId, "pattern", "User always adds JSDoc comments");
    const pending = getObservations(projectId, "pending");
    expect(pending.length).toBeGreaterThanOrEqual(3); // 3 created so far
  });

  it("filters by observation type", () => {
    const corrections = getObservations(projectId, undefined, "correction");
    expect(corrections.length).toBeGreaterThanOrEqual(1);
    corrections.forEach((o) => expect(o.observation_type).toBe("correction"));
  });

  it("searches observations via FTS5", () => {
    const results = searchObservations(projectId, "snake_case");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]!.content).toContain("snake_case");
  });

  it("handles FTS5 special characters without errors", () => {
    // Search terms that would be FTS5 operators — should NOT throw
    const r1 = searchObservations(projectId, "SELECT * FROM");
    expect(r1).toBeDefined();
    expect(Array.isArray(r1)).toBe(true);

    const r2 = searchObservations(projectId, "AND OR NOT test");
    expect(r2).toBeDefined();
    expect(Array.isArray(r2)).toBe(true);

    const r3 = searchObservations(projectId, "(parens) ^boost");
    expect(r3).toBeDefined();
    expect(Array.isArray(r3)).toBe(true);

    // Quoted search
    const r4 = searchObservations(projectId, 'has "quotes" inside');
    expect(r4).toBeDefined();
    expect(Array.isArray(r4)).toBe(true);

    // Empty / whitespace-only query returns empty
    const r5 = searchObservations(projectId, "");
    expect(r5).toEqual([]);
    const r6 = searchObservations(projectId, "   ");
    expect(r6).toEqual([]);
  });

  it("gets a single observation by ID", () => {
    const obs = storeObservation(projectId, "insight", "Terminal works with glibc");
    const found = getObservation(obs.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(obs.id);
    expect(found!.content).toBe("Terminal works with glibc");
  });

  it("updates observation status", () => {
    const obs = storeObservation(projectId, "feedback", "User accepted refactored code");
    const updated = updateObservation(obs.id, { status: "processed" });
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe("processed");
  });

  it("counts unprocessed observations", () => {
    storeObservation(projectId, "behavior", "User runs tests before committing");
    const count = countUnprocessed(projectId);
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it("gets unprocessed batch ordered by importance desc", () => {
    // Created earlier with lower importance
    storeObservation(projectId, "goal", "Low priority goal", 2);
    storeObservation(projectId, "goal", "High priority goal", 10);
    const batch = getUnprocessedBatch(projectId, 5);
    expect(batch.length).toBeGreaterThanOrEqual(1);
    // First item should be highest importance
    expect(batch[0]!.importance).toBeGreaterThanOrEqual(8);
  });

  it("deletes a single observation by id scoped to project", () => {
    const obs = storeObservation(projectId, "insight", "User prefers dark theme");
    const deleted = deleteObservation(projectId, obs.id);
    expect(deleted).toBe(true);
    const refetched = getObservation(obs.id);
    expect(refetched).toBeUndefined();
  });

  it("returns false when deleting non-existent observation", () => {
    const deleted = deleteObservation(projectId, 99999);
    expect(deleted).toBe(false);
  });

  it("deletes observations by source in bulk", () => {
    storeObservation(projectId, "pattern", "Bulk delete test 1", 5, "manual");
    storeObservation(projectId, "pattern", "Bulk delete test 2", 5, "manual");
    const count = deleteObservationsBySource(projectId, "manual");
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it("returns 0 when no observations match source", () => {
    const count = deleteObservationsBySource(projectId, "nonexistent-source");
    expect(count).toBe(0);
  });

  it("accepts auto-observer source on fresh DB (migration 015 regression)", () => {
    // Verifies the fresh-DB path includes migration 015 so the observations
    // source CHECK constraint permits "auto-observer".
    // If migration 015 is missing from the fresh-DB array, this throws
    // SQLITE_CONSTRAINT: CHECK constraint failed: observations
    const obs = storeObservation(projectId, "pattern", "Auto-observer detected user preference", 5, "auto-observer");
    expect(obs).not.toBeNull();
    expect(obs.id).toBeGreaterThan(0);
    expect(obs.source).toBe("auto-observer");
    expect(obs.observation_type).toBe("pattern");
    expect(obs.content).toBe("Auto-observer detected user preference");

    // Verify the observation is retrievable and persisted
    const found = getObservation(obs.id);
    expect(found).not.toBeNull();
    expect(found!.source).toBe("auto-observer");
  });

  it("migration state is valid: observations table allows all expected source values", () => {
    // Verify all allowed source values work (including auto-observer from migration 015)
    const sources: Array<string> = [
      "agent", "email", "chat", "document", "calendar",
      "synthesis", "import", "manual", "auto-observer",
    ];
    for (const source of sources) {
      const obs = storeObservation(projectId, "insight", `Test source: ${source}`, 5, source);
      expect(obs.source).toBe(source);
    }
  });

  it("can query and search observations with auto-observer source", () => {
    const obs = storeObservation(projectId, "behavior", "User frequently opens mail dashboard", 6, "auto-observer");
    // Can retrieve by ID
    const found = getObservation(obs.id);
    expect(found!.source).toBe("auto-observer");

    // Can search via FTS
    const results = searchObservations(projectId, "mail dashboard");
    const hasMatch = results.some(r => r.id === obs.id);
    expect(hasMatch).toBe(true);
  });
});
