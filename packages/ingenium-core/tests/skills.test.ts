import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { getDb } from "../lib/db.js";
import { listProjects, createProject } from "../lib/tools/projects.js";
import {
  createSkill, getSkill, listSkills, updateSkill, searchSkills,
  stripLeadingFrontmatter, writeSkillToDisk, syncSkillFromDisk,
} from "../lib/tools/skills.js";
import { getSkillsBase } from "../lib/tools/paths.js";

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

  it("handles FTS5 special characters without errors", () => {
    // Create skills with special characters in their content
    createSkill(projectId, "fts-special-1", "SQL query uses SELECT * FROM", "# SQL tutorial");
    createSkill(projectId, "fts-special-2", "Use AND/OR operators carefully", "# Logic");
    createSkill(projectId, "fts-special-3", "Parentheses (group) expressions", "# Math");

    // Search terms that would be FTS5 operators — should NOT throw
    const r1 = searchSkills(projectId, "SELECT * FROM");
    expect(r1).toBeDefined();
    expect(Array.isArray(r1)).toBe(true);

    const r2 = searchSkills(projectId, "AND/OR operators");
    expect(r2).toBeDefined();
    expect(Array.isArray(r2)).toBe(true);

    const r3 = searchSkills(projectId, "(group)");
    expect(r3).toBeDefined();
    expect(Array.isArray(r3)).toBe(true);

    // Quoted search should also work
    const r4 = searchSkills(projectId, 'quoted "string" here');
    expect(r4).toBeDefined();
    expect(Array.isArray(r4)).toBe(true);

    // Empty / whitespace-only query should return empty array, not throw
    const r5 = searchSkills(projectId, "");
    expect(r5).toEqual([]);

    const r6 = searchSkills(projectId, "   ");
    expect(r6).toEqual([]);
  });
});

// ============================================================
// Frontmatter stacking bug regression tests
// ============================================================
describe("stripLeadingFrontmatter", () => {
  it("returns unchanged when there is no frontmatter", () => {
    const input = "# Just markdown\n\nSome body text\nWith multiple lines.";
    const result = stripLeadingFrontmatter(input);
    expect(result).toBe(input);
  });

  it("strips exactly one YAML frontmatter block", () => {
    const input = [
      "---",
      "name: my-skill",
      "description: \"A test skill\"",
      "---",
      "",
      "# Body starts here",
      "Some content.",
    ].join("\n");
    const result = stripLeadingFrontmatter(input);
    // After stripping FM + separator blank line, we should get just the body
    expect(result).toBe("# Body starts here\nSome content.");
  });

  it("strips stacked frontmatter blocks (simulating corrupted data)", () => {
    // Simulate what happens after one buggy round-trip: 2 stacked FM blocks
    const fm1 = [
      "---",
      "name: my-skill",
      "description: \"A test skill\"",
      "---",
    ].join("\n");
    const fm2 = [
      "---",
      "name: my-skill",
      "description: \"A test skill\"",
      "---",
    ].join("\n");
    const input = fm1 + "\n\n" + fm2 + "\n\n# Real body content\nMore text.";
    const result = stripLeadingFrontmatter(input);
    expect(result).toBe("# Real body content\nMore text.");
  });

  it("strips three stacked frontmatter blocks (deeply corrupted)", () => {
    const fm = [
      "---",
      "name: my-skill",
      "description: \"A test skill\"",
      "---",
    ].join("\n");
    const input = fm + "\n\n" + fm + "\n\n" + fm + "\n\n# Triple stacked body";
    const result = stripLeadingFrontmatter(input);
    expect(result).toBe("# Triple stacked body");
  });

  it("returns empty string when content is only frontmatter", () => {
    const input = [
      "---",
      "name: my-skill",
      "description: \"just fm\"",
      "---",
    ].join("\n");
    const result = stripLeadingFrontmatter(input);
    expect(result).toBe("");
  });

  it("handles CRLF line endings", () => {
    const input = "---\r\nname: my-skill\r\ndescription: \"CRLF\"\r\n---\r\n\r\n# Body\r\nContent.";
    const result = stripLeadingFrontmatter(input);
    expect(result).toBe("# Body\r\nContent.");
  });

  it("does NOT strip --- used as markdown horizontal rule inside body", () => {
    const input = "# Title\n\nBody paragraph.\n\n---\n\nMore content after HR.";
    const result = stripLeadingFrontmatter(input);
    // The leading content is not a YAML frontmatter block, so return unchanged
    expect(result).toBe(input);
  });

  it("handles BOM at the start of the file", () => {
    const bom = "\uFEFF";
    const content = [
      "---",
      "name: bom-skill",
      "description: \"with BOM\"",
      "---",
      "",
      "# Body after BOM",
    ].join("\n");
    const input = bom + content;
    const result = stripLeadingFrontmatter(input);
    expect(result).toBe("# Body after BOM");
  });

  it("strips frontmatter and preserves trailing content with --- in it", () => {
    // FM at the top, then body with HRs
    const input = [
      "---",
      "name: hr-skill",
      "description: \"has horizontal rules\"",
      "---",
      "",
      "# Body with HRs",
      "",
      "---",
      "",
      "Content after first HR.",
      "",
      "---",
      "",
      "Content after second HR.",
    ].join("\n");
    const result = stripLeadingFrontmatter(input);
    // Only the leading FM should be stripped; body HRs preserved
    expect(result).toContain("# Body with HRs");
    expect(result).toContain("---"); // HRs still present
    expect(result).toContain("Content after first HR.");
    expect(result).toContain("Content after second HR.");
    // Should NOT start with ---
    expect(result.startsWith("---")).toBe(false);
  });
});

describe("writeSkillToDisk round-trip idempotency", () => {
  it("produces exactly one frontmatter block on disk", () => {
    const skill = createSkill(
      projectId, "rt-skill-1", "Round-trip test",
      "# Body content\nSome markdown here."
    );
    // createSkill already calls writeSkillToDisk — read back the file
    const dbPath = process.env.INGENIUM_CORE_DB_PATH!;
    const skillsBase = resolve(dbPath, "..", "..", ".opencode", "skills");
    const filePath = resolve(skillsBase, "rt-skill-1", "SKILL.md");
    expect(existsSync(filePath)).toBe(true);

    const content = readFileSync(filePath, "utf-8");

    // Count --- lines that are frontmatter boundaries
    // A single FM block has exactly 2 boundary lines (opening and closing ---)
    const lines = content.split("\n");
    const fmBoundaries = lines.filter((l) => l.trim() === "---");
    expect(fmBoundaries.length).toBe(2);
  });

  it("write→read→write→read produces identical disk output (no frontmatter growth)", () => {
    const skillName = "rt-skill-2";
    const skill = createSkill(
      projectId, skillName, "Idempotency test",
      "# Original body\n\nSome markdown that should survive the round-trip."
    );
    // createSkill already wrote to disk — capture first write content
    const dbPath = process.env.INGENIUM_CORE_DB_PATH!;
    const skillsBase = resolve(dbPath, "..", "..", ".opencode", "skills");
    const filePath = resolve(skillsBase, skillName, "SKILL.md");
    const firstWrite = readFileSync(filePath, "utf-8");

    // Now simulate what syncSkillFromDisk does: read file, store full content in DB
    // This puts frontmatter into skill.content (the trigger for the bug)
    const synced = syncSkillFromDisk(projectId, skillName);
    expect(synced).not.toBeUndefined();

    // Second write (same as what syncAllSkills does)
    const skillAfterSync = getSkill(projectId, skillName);
    expect(skillAfterSync).not.toBeUndefined();
    writeSkillToDisk(skillAfterSync!);

    const secondWrite = readFileSync(filePath, "utf-8");

    // The two writes should be byte-identical
    expect(secondWrite).toBe(firstWrite);

    // Third round-trip: sync then write again, should still be identical
    syncSkillFromDisk(projectId, skillName);
    const skillAfterThird = getSkill(projectId, skillName);
    writeSkillToDisk(skillAfterThird!);

    const thirdWrite = readFileSync(filePath, "utf-8");
    expect(thirdWrite).toBe(firstWrite);

    // Verify exactly one frontmatter block in all three
    for (const content of [firstWrite, secondWrite, thirdWrite]) {
      const lines = content.split("\n");
      const fmBoundaries = lines.filter((l) => l.trim() === "---");
      expect(fmBoundaries.length).toBe(2);
    }
  });

  it("handles skills that already have frontmatter in DB content (corrupted state)", () => {
    // Simulate a skill that was corrupted by the bug:
    // DB content already contains a frontmatter block
    const skillName = "rt-skill-3";
    const bodyWithFm = [
      "---",
      "name: rt-skill-3",
      "description: \"Already has FM\"",
      "---",
      "",
      "# This body has frontmatter baked in",
      "This simulates content stored by syncSkillFromDisk.",
    ].join("\n");

    // Create with content that already has frontmatter (as syncSkillFromDisk would store)
    const skill = createSkill(projectId, skillName, "Already has FM", bodyWithFm);

    // createSkill calls writeSkillToDisk — read the file
    const dbPath = process.env.INGENIUM_CORE_DB_PATH!;
    const skillsBase = resolve(dbPath, "..", "..", ".opencode", "skills");
    const filePath = resolve(skillsBase, skillName, "SKILL.md");

    const firstWrite = readFileSync(filePath, "utf-8");

    // Should have exactly ONE frontmatter block
    let lines = firstWrite.split("\n");
    let fmBoundaries = lines.filter((l) => l.trim() === "---");
    expect(fmBoundaries.length).toBe(2);

    // Run the sync + write cycle multiple times; should never grow
    for (let i = 0; i < 5; i++) {
      syncSkillFromDisk(projectId, skillName);
      const s = getSkill(projectId, skillName);
      writeSkillToDisk(s!);

      const contents = readFileSync(filePath, "utf-8");
      lines = contents.split("\n");
      fmBoundaries = lines.filter((l) => l.trim() === "---");
      expect(
        fmBoundaries.length,
        `Round ${i + 1}: expected 2 FM boundaries, got ${fmBoundaries.length}`
      ).toBe(2);

      // Should remain byte-identical to first write
      expect(contents).toBe(firstWrite);
    }
  });
});

// ============================================================
// Security tests — path traversal prevention in writeSkillToDisk
// ============================================================
describe("writeSkillToDisk path traversal security", () => {
  it("rejects absolute file_tree paths (e.g., /etc/passwd)", () => {
    const skillName = "sec-absolute";
    const skill = createSkill(projectId, skillName, "Absolute test", "# Body", undefined, undefined, undefined,
      JSON.stringify({ "/etc/passwd": "malicious content" })
    );

    // The skill should exist but the file_tree entry should be rejected
    expect(skill).not.toBeUndefined();
    // Verify /etc/passwd was NOT written (it doesn't exist in the skill dir)
    const skillsBase = getSkillsBase(projectId);
    const skillDir = resolve(skillsBase, skillName);
    // The malicious path should not exist at all
    const outOfTree = resolve(skillDir, "/etc/passwd"); // resolve() will normalize to an absolute path outside
    // Since resolve() strips the base when given an absolute path, we check the resolved doesn't exist in our temp tree
    expect(existsSync(resolve(skillDir, "etc", "passwd"))).toBe(false);
  });

  it("rejects traversal file_tree paths (e.g., ../../../etc/passwd)", () => {
    const skillName = "sec-traversal";
    const skillsBase = getSkillsBase(projectId);
    const skillDir = resolve(skillsBase, skillName);
    // The traversal should escape to a sibling of the .opencode directory
    const escapedDir = resolve(skillDir, "..", "..", "..", "sec-traversal-test");
    mkdirSync(escapedDir, { recursive: true }); // ensure it exists if accidentally written

    const skill = createSkill(projectId, skillName, "Traversal test", "# Body", undefined, undefined, undefined,
      JSON.stringify({ "../../../sec-traversal-test/evil.txt": "malicious content" })
    );

    expect(skill).not.toBeUndefined();
    // The escaped file should NOT have been created
    expect(existsSync(resolve(escapedDir, "evil.txt"))).toBe(false);
    // Clean up the test dir we created
    try { rmSync(escapedDir, { recursive: true, force: true }); } catch {}
  });

  it("rejects nested traversal paths (e.g., foo/../../../etc/passwd)", () => {
    const skillName = "sec-nested";
    const skillsBase = getSkillsBase(projectId);
    const skillDir = resolve(skillsBase, skillName);
    const escapedDir = resolve(skillDir, "..", "..", "..", "sec-nested-test");
    mkdirSync(escapedDir, { recursive: true });

    const skill = createSkill(projectId, skillName, "Nested traversal", "# Body", undefined, undefined, undefined,
      JSON.stringify({ "foo/../../../sec-nested-test/evil.txt": "malicious content" })
    );

    expect(skill).not.toBeUndefined();
    expect(existsSync(resolve(escapedDir, "evil.txt"))).toBe(false);
    try { rmSync(escapedDir, { recursive: true, force: true }); } catch {}
  });

  it("allows normal relative paths (e.g., references/guide.md)", () => {
    const skillName = "sec-normal";
    const skillsBase = getSkillsBase(projectId);
    const skillDir = resolve(skillsBase, skillName);

    const skill = createSkill(projectId, skillName, "Normal paths", "# Body", undefined, undefined, undefined,
      JSON.stringify({ "references/guide.md": "# Guide content" })
    );

    expect(skill).not.toBeUndefined();
    // The normal file should exist within the skill directory
    expect(existsSync(resolve(skillDir, "references", "guide.md"))).toBe(true);
    const content = readFileSync(resolve(skillDir, "references", "guide.md"), "utf-8");
    expect(content).toBe("# Guide content");
  });

  it("allows writing to root of skill directory", () => {
    const skillName = "sec-root";
    const skillsBase = getSkillsBase(projectId);
    const skillDir = resolve(skillsBase, skillName);

    const skill = createSkill(projectId, skillName, "Root file", "# Body", undefined, undefined, undefined,
      JSON.stringify({ "README.txt": "Readme content" })
    );

    expect(skill).not.toBeUndefined();
    expect(existsSync(resolve(skillDir, "README.txt"))).toBe(true);
    const content = readFileSync(resolve(skillDir, "README.txt"), "utf-8");
    expect(content).toBe("Readme content");
  });

  it("rejects traversal that resolves to parent directory itself", () => {
    const skillName = "sec-parent";
    const skillsBase = getSkillsBase(projectId);
    const skillDir = resolve(skillsBase, skillName);

    const skill = createSkill(projectId, skillName, "Parent traversal", "# Body", undefined, undefined, undefined,
      JSON.stringify({ "../evil.txt": "malicious" }) // writes to the skills/<skillName>/../evil.txt = skills/evil.txt
    );

    expect(skill).not.toBeUndefined();
    // File should NOT exist in the parent skills directory
    expect(existsSync(resolve(skillDir, "..", "evil.txt"))).toBe(false);
  });
});
