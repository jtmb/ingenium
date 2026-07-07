import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb } from "../lib/db.js";
import { listProjects, createProject } from "../lib/tools/projects.js";
import { createSkill, getSkill, listSkills, updateSkill, searchSkills } from "../lib/tools/skills.js";

let tempDir: string;
let projectId: string;

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), "ingenium-test-skills-"));
  process.env.INGENIUM_CORE_DB_PATH = join(tempDir, "test.db");
  const project = createProject("test-project");
  projectId = project.id;
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("skills", () => {
  it("creates and retrieves a skill", () => {
    const skill = createSkill(projectId, "test-skill", "A test skill", "# Test Content\nSome body");
    expect(skill.name).toBe("test-skill");
    expect(skill.description).toBe("A test skill");

    const retrieved = getSkill(projectId, "test-skill");
    expect(retrieved).not.toBeUndefined();
    expect(retrieved!.description).toBe("A test skill");
  });

  it("lists all skills for a project", () => {
    createSkill(projectId, "skill-a", "Alpha", "# Alpha");
    createSkill(projectId, "skill-b", "Beta", "# Beta");
    const all = listSkills(projectId);
    expect(all.length).toBeGreaterThanOrEqual(3);
  });

  it("updates skill content", () => {
    const updated = updateSkill(projectId, "test-skill", "# Updated content");
    expect(updated).not.toBeUndefined();
    expect(updated!.content).toBe("# Updated content");
  });

  it("returns undefined for non-existent skill", () => {
    const missing = getSkill(projectId, "nonexistent");
    expect(missing).toBeUndefined();
  });

  it("searches skills via FTS5", () => {
    createSkill(projectId, "searchable-skill", "Has unique keyword ZYXW", "# Searchable content");
    const results = searchSkills(projectId, "ZYXW");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]!.name).toBe("searchable-skill");
  });
});
