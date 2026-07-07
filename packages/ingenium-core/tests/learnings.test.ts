import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProject } from "../lib/tools/projects.js";
import { logLearning, searchLearnings, recentLearnings } from "../lib/tools/learnings.js";

let tempDir: string;
let projectId: string;

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), "ingenium-test-learnings-"));
  process.env.INGENIUM_CORE_DB_PATH = join(tempDir, "test.db");
  const project = createProject("test-project");
  projectId = project.id;
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("learnings", () => {
  it("logs a learning entry with correct type", () => {
    const entry = logLearning(projectId, "pattern", "Use Zod for validation");
    expect(entry.entry_type).toBe("pattern");
    expect(entry.content).toBe("Use Zod for validation");
    expect(entry.id).toBeGreaterThan(0);
  });

  it("logs a bug learning with tags", () => {
    const entry = logLearning(projectId, "bug", "SQLite WAL checkpoint not running", "sqlite,bug");
    expect(entry.entry_type).toBe("bug");
    expect(entry.tags).toBe("sqlite,bug");
  });

  it("defaults priority to 5", () => {
    const entry = logLearning(projectId, "preference", "Default priority");
    expect(entry.priority).toBe(5);
  });

  it("searches learnings via FTS5", () => {
    logLearning(projectId, "research", "Hermes uses FTS5 for memory storage", "hermes,memory");
    const results = searchLearnings(projectId, "Hermes");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]!.content).toContain("Hermes");
  });

  it("returns recent learnings in reverse chronological order", () => {
    logLearning(projectId, "decision", "First decision");
    logLearning(projectId, "decision", "Second decision");
    const recent = recentLearnings(projectId, 5);
    expect(recent.length).toBeGreaterThanOrEqual(2);
    // Most recent first
    expect(new Date(recent[0]!.created_at).getTime())
      .toBeGreaterThanOrEqual(new Date(recent[1]!.created_at).getTime());
  });
});
