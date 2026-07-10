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
});
