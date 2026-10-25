import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb, resetDbForTest } from "../lib/db.js";
import { createProject } from "../lib/tools/projects.js";
import { createSkill, updateSkill, getSkill, archiveSkill, restoreSkill } from "../lib/tools/skills.js";
import { getSkillsBase, getConfigPath } from "../lib/tools/paths.js";

let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "ingenium-skill-projection-"));
  vi.stubEnv("INGENIUM_CORE_DB_PATH", join(directory, "application", ".ingenium", "data"));
  vi.stubEnv("INGENIUM_HOME", join(directory, "persistent-state"));
  vi.stubEnv("INGENIUM_GLOBAL_CONFIG_PATH", join(directory, "global-config"));
  resetDbForTest();
});
afterEach(() => { resetDbForTest(); vi.unstubAllEnvs(); rmSync(directory, { recursive: true, force: true }); });

describe("persistent project skill projections", () => {
  it("isolates same-named skills in registered project data and preserves model/config paths", () => {
    const first = createProject("first"); const second = createProject("second");
    const config = getConfigPath(first.id);
    mkdirSync(join(directory, "application"), { recursive: true });
    writeFileSync(config, '{"agents":{"retained":{"model":"unchanged/model#variant"}}}', { mode: 0o444 });
    const before = readFileSync(config);
    createSkill(first.id, "same-name", "First", "# First");
    createSkill(second.id, "same-name", "Second", "# Second");
    expect(getSkillsBase(first.id)).toBe(join(first.path, ".opencode", "skills"));
    expect(readFileSync(join(getSkillsBase(first.id), "same-name", "SKILL.md"), "utf8")).toContain("# First");
    expect(readFileSync(join(getSkillsBase(second.id), "same-name", "SKILL.md"), "utf8")).toContain("# Second");
    expect(readFileSync(config)).toEqual(before);
    updateSkill(first.id, "same-name", "# Edited"); archiveSkill(first.id, "same-name"); restoreSkill(first.id, "same-name");
    expect(readFileSync(join(getSkillsBase(first.id), "same-name", "SKILL.md"), "utf8")).toContain("# Edited");
    expect(readFileSync(join(getSkillsBase(second.id), "same-name", "SKILL.md"), "utf8")).toContain("# Second");
  });

  it("keeps global skill storage in the configured global directory", () => {
    const project = createProject("global", true); createSkill(project.id, "global-skill", "Global", "# Global");
    expect(getSkillsBase(project.id)).toBe(join(directory, "global-config", "skills"));
  });

  it("rolls back a failed upload instead of leaving a successful database record", () => {
    const project = createProject("failed-upload");
    mkdirSync(getSkillsBase(project.id), { recursive: true });
    writeFileSync(join(getSkillsBase(project.id), "blocked"), "not a directory");
    expect(() => createSkill(project.id, "blocked", "Blocked", "# Not saved")).toThrow();
    expect(getSkill(project.id, "blocked")).toBeUndefined();
    expect(getDb().prepare("SELECT COUNT(*) AS n FROM skill_versions").get()).toEqual({ n: 0 });
  });

  it("rolls back a failed edit without advancing its revision", () => {
    const project = createProject("failed-edit"); const before = createSkill(project.id, "blocked", "Before", "# Before");
    const file = join(getSkillsBase(project.id), "blocked", "SKILL.md"); rmSync(file); mkdirSync(file);
    expect(() => updateSkill(project.id, "blocked", "# Not saved")).toThrow();
    expect(getSkill(project.id, "blocked")).toEqual(before);
  });
});
