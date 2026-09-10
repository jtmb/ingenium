import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync, writeFileSync, symlinkSync, realpathSync, lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import Database from "better-sqlite3";
import { getDb, resetDbForTest } from "../lib/db.js";
import { createProject } from "../lib/tools/projects.js";
import {
  createSkill, getSkill, getSkillById, listSkills, updateSkill, searchSkills,
  stripLeadingFrontmatter, writeSkillToDisk, syncSkillFromDisk,
  deleteSkill, enableSkill, disableSkill, copySkills,
  archiveSkill, restoreSkill, listArchivedSkills, rollbackSkill,
  getSkillVersions, getSkillVersion, removeSkillMdOnly,
} from "../lib/tools/skills.js";
import { getSkillsBase } from "../lib/tools/paths.js";

let tempDir: string;
let projectId: string;
let counter = 0;
function uname(p: string): string { return `${p}-${counter++}`; }

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), "ingenium-test-skills-"));
  process.env.INGENIUM_CORE_DB_PATH = join(tempDir, "test.db");
  resetDbForTest();
  const project = createProject("test-project");
  projectId = project.id;
});

afterAll(() => {
  resetDbForTest();
  rmSync(tempDir, { recursive: true, force: true });
});

// ============================================================
// Basic CRUD
// ============================================================
describe("skills", () => {
  it("creates and retrieves a skill", () => {
    const skill = createSkill(projectId, uname("test"), "A test skill", "# Test Content\nSome body");
    expect(skill.name).toContain("test");
    const retrieved = getSkill(projectId, skill.name);
    expect(retrieved).not.toBeUndefined();
    expect(retrieved!.description).toBe("A test skill");
  });

  it("lists all skills for a project", () => {
    createSkill(projectId, uname("a"), "Alpha", "# Alpha");
    createSkill(projectId, uname("b"), "Beta", "# Beta");
    const all = listSkills(projectId);
    expect(all.length).toBeGreaterThanOrEqual(3);
  });

  it("updates skill content", () => {
    const n = uname("upd");
    createSkill(projectId, n, "Before", "# Before");
    const updated = updateSkill(projectId, n, "# Updated content");
    expect(updated).not.toBeUndefined();
    expect(updated!.content).toBe("# Updated content");
  });

  it("returns undefined for non-existent skill", () => {
    expect(getSkill(projectId, "nonexistent")).toBeUndefined();
  });

  it("searches skills via FTS5", () => {
    const n = uname("search");
    createSkill(projectId, n, "Has unique keyword ZYXW", "# Searchable content");
    const results = searchSkills(projectId, "ZYXW");
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it("handles FTS5 special characters without errors", () => {
    createSkill(projectId, uname("fts1"), "SQL", "# SQL");
    createSkill(projectId, uname("fts2"), "Logic", "# Logic");
    const r = searchSkills(projectId, "SELECT");
    expect(Array.isArray(r)).toBe(true);
    expect(searchSkills(projectId, "")).toEqual([]);
  });

  it("getSkillById works", () => {
    const skill = createSkill(projectId, uname("byid"), "By ID", "# By ID");
    const byId = getSkillById(skill.id);
    expect(byId).not.toBeUndefined();
    expect(byId!.name).toContain("byid");
  });
});

// ============================================================
// Revision tracking
// ============================================================
describe("revision tracking", () => {
  it("new skill starts at revision 0", () => {
    const s = createSkill(projectId, uname("r0"), "R0", "# R0");
    expect(s.revision).toBe(0);
  });

  it("revision increments on update, upsert, enable, disable, archive, restore", () => {
    const n = uname("rev");
    createSkill(projectId, n, "V0", "# V0");
    expect(getSkill(projectId, n)!.revision).toBe(0);
    updateSkill(projectId, n, "# V1");
    expect(getSkill(projectId, n)!.revision).toBe(1);
    createSkill(projectId, n, "V2", "# V2 upsert");
    expect(getSkill(projectId, n)!.revision).toBe(2);
    disableSkill(projectId, n);
    expect(getSkill(projectId, n)!.revision).toBe(3);
    enableSkill(projectId, n);
    expect(getSkill(projectId, n)!.revision).toBe(4);
    archiveSkill(projectId, n);
    expect(getSkill(projectId, n)!.revision).toBe(5);
    restoreSkill(projectId, n);
    expect(getSkill(projectId, n)!.revision).toBe(6);
  });
});

// ============================================================
// Version history
// ============================================================
describe("skill versions", () => {
  it("version 0 created on insert, new version on update, immutable", () => {
    const n = uname("ver");
    const s = createSkill(projectId, n, "V", "# V0");
    const v0 = getSkillVersion(s.id, 0);
    expect(v0).not.toBeUndefined();
    expect(v0!.content).toBe("# V0");
    updateSkill(projectId, n, "# V1");
    const v1 = getSkillVersion(s.id, 1);
    expect(v1).not.toBeUndefined();
    expect(v1!.content).toBe("# V1");
    // v0 unchanged
    expect(getSkillVersion(s.id, 0)!.content).toBe("# V0");
  });

  it("versions ordered by revision descending", () => {
    const n = uname("vord");
    const s = createSkill(projectId, n, "O", "# 0");
    updateSkill(projectId, n, "# 1");
    updateSkill(projectId, n, "# 2");
    const vers = getSkillVersions(s.id);
    expect(vers[0].revision).toBe(2);
    expect(vers[1].revision).toBe(1);
    expect(vers[2].revision).toBe(0);
  });
});

// ============================================================
// Rollback
// ============================================================
describe("rollback", () => {
  it("rollbacks with byte-equivalent content and metadata", () => {
    const n = uname("rb");
    createSkill(projectId, n, "Meta test", "# Original V0", "cat1", "tag1,tag2", 1);
    updateSkill(projectId, n, "# Changed");
    const rolled = rollbackSkill(projectId, n, 0);
    expect(rolled!.content).toBe("# Original V0");
    expect(rolled!.description).toBe("Meta test");
    expect(rolled!.always_apply).toBe(1);
    expect(rolled!.revision).toBe(2);
  });

  it("rollback returns undefined for non-existent skill or revision", () => {
    expect(rollbackSkill(projectId, "nonexistent", 0)).toBeUndefined();
    const n = uname("rbbad");
    createSkill(projectId, n, "B", "# B");
    expect(rollbackSkill(projectId, n, 999)).toBeUndefined();
  });
});

// ============================================================
// Archive / Restore
// ============================================================
describe("archive and restore", () => {
  it("deleteSkill archives instead of hard-deleting", () => {
    const n = uname("del");
    createSkill(projectId, n, "Del", "# D");
    expect(deleteSkill(projectId, n)).toBe(true);
    const after = getSkill(projectId, n);
    expect(after).not.toBeUndefined();
    expect(after!.archived_at).not.toBeNull();
    expect(listSkills(projectId).find(s => s.name === n)).toBeUndefined();
    expect(listArchivedSkills(projectId).find(s => s.name === n)).not.toBeUndefined();
  });

  it("archive removes only SKILL.md, preserves metadata.json and auxiliary files", () => {
    const n = uname("arcdisk");
    createSkill(projectId, n, "Archive disk", "# Body", undefined, undefined, undefined,
      JSON.stringify({ "data/config.json": '{"k":"v"}' })
    );
    const skillsBase = getSkillsBase(projectId);
    const dir = resolve(skillsBase, n);
    expect(existsSync(resolve(dir, "SKILL.md"))).toBe(true);
    expect(existsSync(resolve(dir, "metadata.json"))).toBe(true);
    expect(existsSync(resolve(dir, "data/config.json"))).toBe(true);
    archiveSkill(projectId, n);
    expect(existsSync(resolve(dir, "SKILL.md"))).toBe(false);
    expect(existsSync(resolve(dir, "metadata.json"))).toBe(true);
    expect(existsSync(resolve(dir, "data/config.json"))).toBe(true);
  });

  it("restore writes full representation back to disk", () => {
    const n = uname("rstd");
    createSkill(projectId, n, "Restore", "# R", undefined, undefined, undefined,
      JSON.stringify({ "ref/g.md": "# G" })
    );
    archiveSkill(projectId, n);
    restoreSkill(projectId, n);
    const skillsBase = getSkillsBase(projectId);
    expect(existsSync(resolve(skillsBase, n, "SKILL.md"))).toBe(true);
    expect(existsSync(resolve(skillsBase, n, "metadata.json"))).toBe(true);
    expect(existsSync(resolve(skillsBase, n, "ref/g.md"))).toBe(true);
  });

  it("archiveSkill no-ops when already archived (returns undefined)", () => {
    const n = uname("arcnoop");
    createSkill(projectId, n, "Noop", "# N");
    expect(archiveSkill(projectId, n)).not.toBeUndefined();
    expect(archiveSkill(projectId, n)).toBeUndefined();
    expect(getSkill(projectId, n)!.revision).toBe(1);
  });

  it("restoreSkill no-ops when not archived (returns undefined)", () => {
    const n = uname("rstnoop");
    createSkill(projectId, n, "Active", "# A");
    expect(restoreSkill(projectId, n)).toBeUndefined();
    expect(getSkill(projectId, n)!.revision).toBe(0);
  });

  it("disable preserves metadata.json and auxiliary files", () => {
    const n = uname("dispres");
    createSkill(projectId, n, "DP", "# DP", undefined, undefined, undefined,
      JSON.stringify({ "ref/n.md": "# N" })
    );
    const skillsBase = getSkillsBase(projectId);
    const dir = resolve(skillsBase, n);
    disableSkill(projectId, n);
    expect(existsSync(resolve(dir, "SKILL.md"))).toBe(false);
    expect(existsSync(resolve(dir, "metadata.json"))).toBe(true);
    expect(existsSync(resolve(dir, "ref/n.md"))).toBe(true);
  });
});

// ============================================================
// syncSkillFromDisk: unchanged skip + archived protection
// ============================================================
describe("syncSkillFromDisk", () => {
  it("avoids revision bump when disk content unchanged", () => {
    const n = uname("syncunch");
    createSkill(projectId, n, "Unchanged", "# Same");
    const revBefore = getSkill(projectId, n)!.revision;
    syncSkillFromDisk(projectId, n);
    expect(getSkill(projectId, n)!.revision).toBe(revBefore);
  });

  it("does not silently unarchive an archived skill", () => {
    const n = uname("syncarc");
    createSkill(projectId, n, "Archived", "# V0");
    archiveSkill(projectId, n);
    const archivedRev = getSkill(projectId, n)!.revision;
    const result = syncSkillFromDisk(projectId, n);
    expect(result).not.toBeUndefined();
    expect(result!.archived_at).not.toBeNull();
    expect(result!.revision).toBe(archivedRev);
  });

  it("detects metadata changes and bumps revision", () => {
    const n = uname("syncchg");
    createSkill(projectId, n, "Change", "# Body");
    const revBefore = getSkill(projectId, n)!.revision;
    // Manually modify metadata.json on disk
    const skillsBase = getSkillsBase(projectId);
    const metaPath = resolve(skillsBase, n, "metadata.json");
    writeFileSync(metaPath, JSON.stringify({ tags: ["newtag"], alwaysApply: false }, null, 2));
    syncSkillFromDisk(projectId, n);
    expect(getSkill(projectId, n)!.revision).toBeGreaterThan(revBefore);
    expect(getSkill(projectId, n)!.tags).toBe("newtag");
  });
});

// ============================================================
// Migration 042: legacy data safety (empty content/description)
// ============================================================
describe("migration 042 legacy safety", () => {
  it("handles skill with empty description created via raw insert", () => {
    // Simulate a legacy skill with empty description
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const id = "legacy-test-id-" + Date.now();
    const name = uname("legacy");
    db.prepare(
      "INSERT INTO skills (id, project_id, name, description, content, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)"
    ).run(id, projectId, name, "", "", new Date().toISOString(), new Date().toISOString());
    // Should have version 0 snapshot created by trigger
    const v0 = getSkillVersion(id, 0);
    expect(v0).not.toBeUndefined();
    expect(v0!.description).toBe("");
    expect(v0!.content).toBe("");
    // Cannot clean up version rows (immutable by trigger). Fresh DB per test file, so OK.
  });
});

// ============================================================
// Partial migration state detection (item 6)
// ============================================================
describe("partial migration detection", () => {
  it("getDb throws when revision column exists but skill_versions table is missing", () => {
    const partialDir = mkdtempSync(join(tmpdir(), "ingenium-partial-042-"));
    try {
      const partialPath = join(partialDir, "partial.db");
      // Create a fresh DB with all migrations up to 041, then only add revision column
      const db = new Database(partialPath);
      db.pragma("journal_mode = WAL");
      db.pragma("busy_timeout = 5000");
      db.pragma("foreign_keys = ON");

      // Apply migrations up to 041
      const migDir = resolve(__dirname, "../data/migrations");
      const migs = [
        "001_init.sql", "002_archive.sql", "003_agents.sql", "004_learnings_status.sql",
        "005_skills_metadata.sql", "006_skill_file_tree.sql", "007_observations.sql",
        "008_personality_traits.sql", "009_pipeline_events.sql", "010_commands.sql",
        "011_server_source.sql", "012_project_is_global.sql", "013_fix_plugins_unique.sql",
        "014_configs.sql", "016_mcp_tool_states.sql", "017_fix_trait_fk.sql",
        "018_extraction_pipeline_events.sql", "019_trait_exemplar_fk_setnull.sql",
        "020_kanban_board.sql", "021_jobs.sql", "022_email_cache.sql",
        "023_fix_servers_unique.sql", "024_skills_unique_per_project.sql",
        "025_email_string_ids.sql", "026_email_suggestions.sql", "027_email_summaries.sql",
        "028_email_suggestion_queue.sql", "029_docs_spaces.sql", "030_docs_pages.sql",
        "031_docs_pages_fts.sql", "032_docs_drafts.sql", "033_docs_versions.sql",
        "034_docs_tags.sql", "035_docs_links.sql", "036_docs_comments.sql",
        "037_docs_project_links.sql", "038_docs_attachments.sql", "039_docs_templates.sql",
        "040_docs_integrity.sql", "041_skill_maintenance_locks.sql",
      ];
      for (const m of migs) {
        db.exec(readFileSync(resolve(migDir, m), "utf-8"));
      }

      // Simulate partial migration: add revision column but NOT skill_versions
      db.exec("ALTER TABLE skills ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0)");
      db.close();

      // Reset global singleton so getDb opens the partial-path DB
      resetDbForTest();

      // Now try to open via getDb — the probe in db.ts should detect the partial state
      let threw = false;
      try {
        getDb(partialPath);
      } catch (e: any) {
        threw = true;
        expect(e.message).toMatch(/PARTIAL|partial/i);
      }
      expect(threw).toBe(true);
    } finally {
      resetDbForTest();
      rmSync(partialDir, { recursive: true, force: true });
    }
  });
});

// ============================================================
// Frontmatter, security, WAL, FTS legacy tests
// ============================================================
describe("stripLeadingFrontmatter", () => {
  it("strips stacked frontmatter blocks", () => {
    const fm = ["---", "name: x", 'description: "x"', "---"].join("\n");
    const input = fm + "\n\n" + fm + "\n\n# Body";
    expect(stripLeadingFrontmatter(input)).toBe("# Body");
  });

  it("returns unchanged without frontmatter", () => {
    const input = "# Just markdown\n\nSome body";
    expect(stripLeadingFrontmatter(input)).toBe(input);
  });

  it("strips exactly one frontmatter block", () => {
    const input = "---\nname: my-skill\ndescription: \"A test skill\"\n---\n\n# Body starts here\nSome content.";
    expect(stripLeadingFrontmatter(input)).toBe("# Body starts here\nSome content.");
  });

  it("content that is only frontmatter returns empty body", () => {
    const input = "---\nname: x\ndescription: \"just fm\"\n---";
    expect(stripLeadingFrontmatter(input)).toBe("");
  });

  it("handles CRLF", () => {
    const input = "---\r\nname: x\r\ndescription: \"x\"\r\n---\r\n\r\n# B\r\nC.";
    expect(stripLeadingFrontmatter(input)).toBe("# B\r\nC.");
  });

  it("does NOT strip --- used as HR in body", () => {
    const input = "# Title\n\n---\n\nMore";
    expect(stripLeadingFrontmatter(input)).toBe(input);
  });

  it("frontmatter body containing non-delimiter --- preserved", () => {
    const input = "---\nname: hr-skill\ndescription: \"has HRs\"\n---\n\n# Body\n\n---\n\nContent after HR.";
    const result = stripLeadingFrontmatter(input);
    expect(result).toContain("# Body");
    expect(result).toContain("---");
    expect(result).toContain("Content after HR");
    expect(result.startsWith("---")).toBe(false);
  });

  it("handles BOM", () => {
    const input = "\uFEFF---\nname: x\ndescription: \"x\"\n---\n\n# Body";
    expect(stripLeadingFrontmatter(input)).toBe("# Body");
  });
});

describe("writeSkillToDisk path traversal security", () => {
  it("rejects absolute paths (e.g., /etc/passwd)", () => {
    const n = uname("sec-abs");
    createSkill(projectId, n, "Sec", "# S", undefined, undefined, undefined,
      JSON.stringify({ "/etc/passwd": "bad" })
    );
    const skillsBase = getSkillsBase(projectId);
    expect(existsSync(resolve(skillsBase, n, "etc", "passwd"))).toBe(false);
  });

  it("rejects traversal paths (e.g., ../../../evil.txt)", () => {
    const n = uname("sec-trav");
    createSkill(projectId, n, "Sec", "# S", undefined, undefined, undefined,
      JSON.stringify({ "../../../evil.txt": "bad" })
    );
    const skillsBase = getSkillsBase(projectId);
    expect(existsSync(resolve(skillsBase, "evil.txt"))).toBe(false);
    expect(existsSync(resolve(skillsBase, n, "..", "..", "evil.txt"))).toBe(false);
  });

  it("rejects nested traversal paths (e.g., foo/../../../etc/passwd)", () => {
    const n = uname("sec-nest");
    createSkill(projectId, n, "Sec", "# S", undefined, undefined, undefined,
      JSON.stringify({ "foo/../../../evil.txt": "bad" })
    );
    const skillsBase = getSkillsBase(projectId);
    expect(existsSync(resolve(skillsBase, "evil.txt"))).toBe(false);
  });

  it("allows root-of-skill-directory relative path boundary", () => {
    const n = uname("sec-root");
    createSkill(projectId, n, "OK", "# OK", undefined, undefined, undefined,
      JSON.stringify({ "README.txt": "readme content" })
    );
    const skillsBase = getSkillsBase(projectId);
    expect(existsSync(resolve(skillsBase, n, "README.txt"))).toBe(true);
    expect(readFileSync(resolve(skillsBase, n, "README.txt"), "utf-8")).toBe("readme content");
  });

  it("allows normal relative paths", () => {
    const n = uname("secok");
    createSkill(projectId, n, "OK", "# OK", undefined, undefined, undefined,
      JSON.stringify({ "ref/g.md": "# G" })
    );
    const skillsBase = getSkillsBase(projectId);
    expect(existsSync(resolve(skillsBase, n, "ref/g.md"))).toBe(true);
  });

  it("rejects traversal that resolves to parent directory itself", () => {
    const n = uname("sec-parent");
    createSkill(projectId, n, "Par", "# P", undefined, undefined, undefined,
      JSON.stringify({ "../evil.txt": "bad" })
    );
    const skillsBase = getSkillsBase(projectId);
    expect(existsSync(resolve(skillsBase, n, "..", "evil.txt"))).toBe(false);
  });

  it("rejects reserved SKILL.md and metadata.json in file_tree", () => {
    const n = uname("sec-reserved");
    createSkill(projectId, n, "Res", "# R", undefined, undefined, undefined,
      JSON.stringify({ "SKILL.md": "injected", "metadata.json": "injected", "extra.md": "# Extra" })
    );
    const skillsBase = getSkillsBase(projectId);
    const dir = resolve(skillsBase, n);
    // SKILL.md should contain the canonical content, not the injected one
    expect(readFileSync(resolve(dir, "SKILL.md"), "utf-8")).toContain("# R");
    // extra.md (not reserved) should be written
    expect(readFileSync(resolve(dir, "extra.md"), "utf-8")).toBe("# Extra");
  });

  it("rejects symlinked ancestor with nonexistent deeper descendant", () => {
    const n = uname("sec-symlink");
    // Create the skill first so the dir exists
    createSkill(projectId, n, "Sym", "# S");
    const skillsBase = getSkillsBase(projectId);
    const dir = resolve(skillsBase, n);

    // Create a real directory outside the skill dir as an escape target (unique per test)
    const escapeDir = `escape-target-${n}`;
    const escapeTarget = resolve(skillsBase, "..", escapeDir);
    try { rmSync(escapeTarget, { recursive: true, force: true }); } catch {}
    mkdirSync(escapeTarget, { recursive: true });
    writeFileSync(resolve(escapeTarget, "pwned.txt"), "escaped");

    // Create a symlink inside the skill dir pointing to the escape target
    const symlinkPath = resolve(dir, "escape-link");
    try { if (existsSync(symlinkPath)) rmSync(symlinkPath, { recursive: true, force: true }); } catch {}
    symlinkSync(escapeTarget, symlinkPath, "dir");

    // Now write a file_tree that traverses through the symlink to a nonexistent deeper path
    writeSkillToDisk({
      ...getSkill(projectId, n)!,
      file_tree: JSON.stringify({ "escape-link/nonexistent/deep/pwned.txt": "should-not-be-written" }),
    });

    // The file should NOT be written through the symlink
    expect(existsSync(resolve(escapeTarget, "nonexistent", "deep", "pwned.txt"))).toBe(false);

    // Cleanup the escape target
    try { rmSync(escapeTarget, { recursive: true, force: true }); } catch {}
  });

  it("rejects normalized reserved paths (./SKILL.md, refs/../metadata.json)", () => {
    const n = uname("sec-normres");
    createSkill(projectId, n, "Norm", "# N", undefined, undefined, undefined,
      JSON.stringify({ "./SKILL.md": "injected", "refs/../metadata.json": "injected", "extra.md": "# Extra" })
    );
    const skillsBase = getSkillsBase(projectId);
    const dir = resolve(skillsBase, n);
    // Both reserved paths rejected; canonical SKILL.md untouched
    expect(readFileSync(resolve(dir, "SKILL.md"), "utf-8")).toContain("# N");
    // metadata.json should be canonical (not injected)
    const meta = JSON.parse(readFileSync(resolve(dir, "metadata.json"), "utf-8"));
    expect(meta.alwaysApply).toBe(false);
    // extra.md should be written
    expect(readFileSync(resolve(dir, "extra.md"), "utf-8")).toBe("# Extra");
  });

  it("rejects empty string and dot file_tree paths", () => {
    const n = uname("sec-emptydot");
    createSkill(projectId, n, "ED", "# E", undefined, undefined, undefined,
      JSON.stringify({ "": "injected", ".": "injected" })
    );
    const skillsBase = getSkillsBase(projectId);
    const dir = resolve(skillsBase, n);
    expect(readFileSync(resolve(dir, "SKILL.md"), "utf-8")).toContain("# E");
  });

  it("rejects file_tree path targeting an existing directory", () => {
    const n = uname("sec-dirtarg");
    createSkill(projectId, n, "DirTarg", "# D", undefined, undefined, undefined,
      JSON.stringify({ "refs/g.md": "# G" })
    );
    const skillsBase = getSkillsBase(projectId);
    const dir = resolve(skillsBase, n);
    // refs directory already exists (from the valid file_tree entry above)
    // Now try to overwrite it via file_tree
    writeSkillToDisk({
      ...getSkill(projectId, n)!,
      file_tree: JSON.stringify({ "refs": "injected-directory-target" }),
    });
    // refs should still be a directory, not a file
    expect(lstatSync(resolve(dir, "refs")).isDirectory()).toBe(true);
  });
});

describe("isSafeSkillName guard", () => {
  it("rejects empty string", () => {
    expect(() => createSkill(projectId, "", "Bad", "# B")).toThrow(/Unsafe skill name/);
  });

  it("rejects path traversal in name (../)", () => {
    expect(() => createSkill(projectId, "../../../escape", "Bad", "# B")).toThrow(/Unsafe skill name/);
  });

  it("rejects forward slash in name", () => {
    expect(() => createSkill(projectId, "foo/bar", "Bad", "# B")).toThrow(/Unsafe skill name/);
  });

  it("rejects backslash in name", () => {
    expect(() => createSkill(projectId, "foo\\bar", "Bad", "# B")).toThrow(/Unsafe skill name/);
  });

  it("rejects dot and dot-dot as name", () => {
    expect(() => createSkill(projectId, ".", "Bad", "# B")).toThrow(/Unsafe skill name/);
    expect(() => createSkill(projectId, "..", "Bad", "# B")).toThrow(/Unsafe skill name/);
  });

  it("rejects > 64 character name", () => {
    expect(() => createSkill(projectId, "a".repeat(65), "Bad", "# B")).toThrow(/Unsafe skill name/);
  });

  it("rejects null byte in name", () => {
    expect(() => createSkill(projectId, "bad\x00name", "Bad", "# B")).toThrow(/Unsafe skill name/);
  });

  it("allows normal names with spaces and underscores", () => {
    const s = createSkill(projectId, uname("safe name_with_underscores"), "OK", "# OK");
    expect(s).not.toBeUndefined();
    expect(s.name).toContain("safe");
  });
});

describe("WAL safety", () => {
  it("createSkill does not deadlock", () => {
    const s = createSkill(projectId, uname("wal"), "WAL", "# W");
    expect(s).not.toBeUndefined();
  });

  it("updateSkill does not deadlock", () => {
    const n = uname("walu");
    createSkill(projectId, n, "WU", "# WU");
    const u = updateSkill(projectId, n, "# WU2");
    expect(u).not.toBeUndefined();
  });
});

describe("FTS5 regression", () => {
  it("no duplicate search results after updates", () => {
    const n = uname("ftsdup");
    const marker = "FTS5DUP_" + Date.now();
    createSkill(projectId, n, "FTS", `# D\n${marker}`);
    updateSkill(projectId, n, `# D2\n${marker}`);
    expect(searchSkills(projectId, marker).length).toBe(1);
  });

  it("delete (archive) keeps FTS entry", () => {
    const n = uname("ftsarc");
    const marker = "FTSARC_" + Date.now();
    createSkill(projectId, n, "FA", `# A\n${marker}`);
    expect(searchSkills(projectId, marker).length).toBe(1);
    deleteSkill(projectId, n);
    expect(searchSkills(projectId, marker).length).toBe(1);
  });

  it("handles quoted string in search without throwing", () => {
    const n = uname("fts-quote");
    createSkill(projectId, n, "Quoted search", '# Quoted "test" here');
    const results = searchSkills(projectId, '"test" here');
    expect(Array.isArray(results)).toBe(true);
  });

  it("handles AND/OR operators in search without throwing", () => {
    const n = uname("fts-andor");
    createSkill(projectId, n, "AND OR test", "# Use AND/OR operators carefully");
    const results = searchSkills(projectId, "AND/OR operators");
    expect(Array.isArray(results)).toBe(true);
  });

  it("handles parentheses in search without throwing", () => {
    const n = uname("fts-paren");
    createSkill(projectId, n, "Paren test", "# Parentheses (group) expressions");
    const results = searchSkills(projectId, "(group)");
    expect(Array.isArray(results)).toBe(true);
  });

  it("handles SELECT * FROM in search without throwing", () => {
    const n = uname("fts-select");
    createSkill(projectId, n, "SQL test", "# SQL SELECT * FROM test");
    const results = searchSkills(projectId, "SELECT * FROM");
    expect(Array.isArray(results)).toBe(true);
  });

  it("whitespace-only query returns empty array", () => {
    expect(searchSkills(projectId, "")).toEqual([]);
    expect(searchSkills(projectId, "   ")).toEqual([]);
    expect(searchSkills(projectId, "\t\n")).toEqual([]);
  });
});

describe("writeSkillToDisk round-trip idempotency", () => {
  it("write→sync→write produces identical output (no frontmatter growth)", () => {
    const n = uname("rt");
    createSkill(projectId, n, "RT", "# Original body\n\nMore text.");
    const dbPath = process.env.INGENIUM_CORE_DB_PATH!;
    const skillsBase = resolve(dbPath, "..", "..", ".opencode", "skills");
    const fp = resolve(skillsBase, n, "SKILL.md");
    const first = readFileSync(fp, "utf-8");
    syncSkillFromDisk(projectId, n);
    const s = getSkill(projectId, n)!;
    writeSkillToDisk(s);
    const second = readFileSync(fp, "utf-8");
    expect(second).toBe(first);
    const lines = first.split("\n");
    const fm = lines.filter(l => l.trim() === "---");
    expect(fm.length).toBe(2);
  });

  it("handles pre-corrupted content with frontmatter in DB", () => {
    const n = uname("rtcorr");
    const bodyWithFm = "---\nname: x\ndescription: \"x\"\n---\n\n# Body";
    createSkill(projectId, n, "Corr", bodyWithFm);
    const dbPath = process.env.INGENIUM_CORE_DB_PATH!;
    const skillsBase = resolve(dbPath, "..", "..", ".opencode", "skills");
    const fp = resolve(skillsBase, n, "SKILL.md");
    const first = readFileSync(fp, "utf-8");
    for (let i = 0; i < 3; i++) {
      syncSkillFromDisk(projectId, n);
      writeSkillToDisk(getSkill(projectId, n)!);
      expect(readFileSync(fp, "utf-8")).toBe(first);
    }
  });
});

// ── Mutation rejection before DB change (E) ────────────────────────────

describe("mutation rejects unsafe names before state change", () => {
  it("updateSkill rejects unsafe name and does not bump revision", () => {
    const n = uname("mut-safe");
    createSkill(projectId, n, "Safe", "# Safe");
    const revBefore = getSkill(projectId, n)!.revision;
    expect(() => updateSkill(projectId, n, "# New")).not.toThrow();
    const revAfter = getSkill(projectId, n)!.revision;
    expect(revAfter).toBeGreaterThan(revBefore);
    expect(() => updateSkill(projectId, "../../../escape", "# Bad")).toThrow(/Unsafe skill name/);
    expect(() => updateSkill(projectId, "foo/bar", "# Bad")).toThrow(/Unsafe skill name/);
  });

  it("enableSkill rejects unsafe name before state change", () => {
    const n = uname("en-unsafe");
    createSkill(projectId, n, "EN", "# EN");
    const revBefore = getSkill(projectId, n)!.revision;
    enableSkill(projectId, n); // succeeds
    enableSkill(projectId, n); // already enabled, still succeeds
    expect(getSkill(projectId, n)!.revision).toBeGreaterThanOrEqual(revBefore + 1);
    // Unsafe name throws before DB
    expect(() => enableSkill(projectId, "../bad")).toThrow(/Unsafe skill name/);
  });

  it("archiveSkill rejects unsafe name before state change", () => {
    const n = uname("ar-unsafe");
    createSkill(projectId, n, "AR", "# AR");
    archiveSkill(projectId, n);
    expect(getSkill(projectId, n)!.archived_at).toBeTruthy();
    expect(() => archiveSkill(projectId, "../bad")).toThrow(/Unsafe skill name/);
  });

  it("restoreSkill rejects unsafe name before state change", () => {
    const n = uname("rs-unsafe");
    createSkill(projectId, n, "RS", "# RS");
    archiveSkill(projectId, n);
    restoreSkill(projectId, n);
    expect(getSkill(projectId, n)!.archived_at).toBeNull();
    expect(() => restoreSkill(projectId, "../bad")).toThrow(/Unsafe skill name/);
  });
});

// ── Root symlink boundary (item 1 + 4) ──────────────────────────────────

describe("skills-root symlink boundary", () => {
  it("writeSkillToDisk refuses symlinked skills root", () => {
    const n = uname("rootsym");
    const dbPath = process.env.INGENIUM_CORE_DB_PATH!;
    // Create the skill in DB so it has a valid row
    const s = createSkill(projectId, n, "RootSym", "# RS");
    const skillsBase = getSkillsBase(projectId);
    // Remove the real skills dir and symlink it to a temp outside dir
    rmSync(skillsBase, { recursive: true, force: true });
    const outsideDir = resolve(skillsBase, "..", "outside-skills-root");
    mkdirSync(outsideDir, { recursive: true });
    writeFileSync(resolve(outsideDir, "preexisting.txt"), "original");
    symlinkSync(outsideDir, skillsBase, "dir");

    // Write should refuse because skills root is a symlink
    writeSkillToDisk(s);
    // The symlinked root should not have a skill dir written
    expect(existsSync(resolve(outsideDir, n, "SKILL.md"))).toBe(false);

    // Cleanup
    rmSync(skillsBase, { force: true });
    try { rmSync(outsideDir, { recursive: true, force: true }); } catch {}
  });
});

// ============================================================
// syncSkillFromDisk: file_tree population & idempotency
// ============================================================
describe("syncSkillFromDisk file_tree behavior", () => {
  /**
   * Helper: create a skill directory on disk WITHOUT a DB row.
   * Returns the full path to the skill directory.
   */
  function createDiskSkill(skillName: string, content: string, refFiles: Record<string, string>) {
    const skillsBase = getSkillsBase(projectId);
    const dir = resolve(skillsBase, skillName);
    mkdirSync(dir, { recursive: true });

    // Write SKILL.md
    const frontmatter = `---\nname: ${skillName}\ndescription: "Test skill"\n---\n\n`;
    writeFileSync(resolve(dir, "SKILL.md"), frontmatter + content);

    // Write metadata.json
    writeFileSync(resolve(dir, "metadata.json"), JSON.stringify({ tags: [], alwaysApply: false }));

    // Write reference files
    for (const [relPath, fileContent] of Object.entries(refFiles)) {
      const fullPath = resolve(dir, relPath);
      mkdirSync(resolve(fullPath, ".."), { recursive: true });
      writeFileSync(fullPath, fileContent);
    }

    return dir;
  }

  /**
   * Helper: parse a file_tree JSON string into a record, or return empty object.
   */
  function parseFileTree(ft: string | null | undefined): Record<string, string> {
    if (!ft) return {};
    try { return JSON.parse(ft); } catch { return {}; }
  }

  it("populates null file_tree with all reference files", () => {
    const n = uname("ft-null");
    const refFiles: Record<string, string> = {
      "references/guide.md": "# Guide\nThis is a guide.",
      "references/api.md": "# API\nAPI reference docs.",
      "references/examples/basic.md": "# Basic\nA basic example.",
    };
    createDiskSkill(n, "# Test body\n\nSome content.", refFiles);

    // Insert DB row with file_tree explicitly set to null
    const id = "ft-null-id-" + Date.now();
    const now = new Date().toISOString();
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    db.prepare(
      `INSERT INTO skills (id, project_id, name, description, content, tags, always_apply, file_tree, revision, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, ?)`
    ).run(id, projectId, n, "Test skill", "# Test body\n\nSome content.", "", 0, now, now);

    const before = getSkill(projectId, n)!;
    expect(before.file_tree).toBeFalsy();
    const revBefore = before.revision;

    // Sync from disk
    const result = syncSkillFromDisk(projectId, n);
    expect(result).not.toBeUndefined();

    // Verify file_tree now populated
    const tree = parseFileTree(result!.file_tree);
    expect(Object.keys(tree).length).toBeGreaterThanOrEqual(3);
    expect(tree["references/guide.md"]).toBe(refFiles["references/guide.md"]);
    expect(tree["references/api.md"]).toBe(refFiles["references/api.md"]);
    expect(tree["references/examples/basic.md"]).toBe(refFiles["references/examples/basic.md"]);

    // Verify revision incremented
    expect(result!.revision).toBeGreaterThan(revBefore);
  });

  it("updates stale partial file_tree with all reference files from disk", () => {
    const n = uname("ft-stale");
    const refFiles: Record<string, string> = {};
    // Create 10+ reference files including nested sources/
    const files = [
      "references/01-intro.md",
      "references/02-setup.md",
      "references/03-usage.md",
      "references/04-config.md",
      "references/05-api.md",
      "references/06-testing.md",
      "references/sources/library/util.md",
      "references/sources/library/helpers.md",
      "references/sources/skill-name/source-index.md",
      "references/sources/skill-name/patterns.md",
      "references/examples/full-example.md",
    ];
    for (const f of files) {
      refFiles[f] = `# ${f}\nContent for ${f}`;
    }
    createDiskSkill(n, "# Full test\nBody.", refFiles);

    // Insert DB row with a PARTIAL file_tree (only 2 files)
    const id = "ft-stale-id-" + Date.now();
    const now = new Date().toISOString();
    const partialTree = JSON.stringify({
      "references/01-intro.md": refFiles["references/01-intro.md"],
      "references/02-setup.md": refFiles["references/02-setup.md"],
    });
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    db.prepare(
      `INSERT INTO skills (id, project_id, name, description, content, tags, always_apply, file_tree, revision, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
    ).run(id, projectId, n, "Test skill", "# Full test\nBody.", "", 0, partialTree, now, now);

    const before = getSkill(projectId, n)!;
    const beforeTree = parseFileTree(before.file_tree);
    expect(Object.keys(beforeTree).length).toBe(2);
    const revBefore = before.revision;

    // Sync from disk
    const result = syncSkillFromDisk(projectId, n);
    expect(result).not.toBeUndefined();

    // Verify file_tree now contains ALL reference files
    const tree = parseFileTree(result!.file_tree);
    expect(Object.keys(tree).length).toBe(files.length);
    for (const f of files) {
      expect(tree[f]).toBe(refFiles[f]);
    }
    // Verify nested sources/ are included
    expect(tree["references/sources/library/util.md"]).toBe(refFiles["references/sources/library/util.md"]);
    expect(tree["references/sources/skill-name/source-index.md"]).toBe(refFiles["references/sources/skill-name/source-index.md"]);

    // Verify revision incremented
    expect(result!.revision).toBeGreaterThan(revBefore);
  });

  it("is idempotent — no revision bump on no-op sync", () => {
    const n = uname("ft-idem");
    const refFiles: Record<string, string> = {
      "references/a.md": "# A",
      "references/b.md": "# B",
    };
    createDiskSkill(n, "# Idempotent\nBody.", refFiles);

    // First sync from disk (creates DB row)
    const first = syncSkillFromDisk(projectId, n);
    expect(first).not.toBeUndefined();
    const revAfterFirst = first!.revision;
    const treeAfterFirst = first!.file_tree;

    // Second sync — should be idempotent
    const second = syncSkillFromDisk(projectId, n);
    expect(second).not.toBeUndefined();
    expect(second!.revision).toBe(revAfterFirst);
    expect(second!.file_tree).toBe(treeAfterFirst);
  });

  it("includes nested sources/ directories in file_tree", () => {
    const n = uname("ft-nested");
    const refFiles: Record<string, string> = {
      "references/sources/skill-name/source-index.md": "# Source Index\nNested content.",
      "references/sources/skill-name/details.md": "# Details\nMore nested content.",
      "references/top.md": "# Top\nTop-level reference.",
    };
    createDiskSkill(n, "# Nested test\nBody.", refFiles);

    // Sync from disk (creates DB row since no existing row)
    const result = syncSkillFromDisk(projectId, n);
    expect(result).not.toBeUndefined();

    const tree = parseFileTree(result!.file_tree);
    expect(Object.keys(tree).length).toBe(3);

    // Verify nested source files are present with correct keys
    expect(tree).toHaveProperty("references/sources/skill-name/source-index.md");
    expect(tree).toHaveProperty("references/sources/skill-name/details.md");
    expect(tree).toHaveProperty("references/top.md");

    // Verify content matches
    expect(tree["references/sources/skill-name/source-index.md"]).toBe(refFiles["references/sources/skill-name/source-index.md"]);
    expect(tree["references/sources/skill-name/details.md"]).toBe(refFiles["references/sources/skill-name/details.md"]);
    expect(tree["references/top.md"]).toBe(refFiles["references/top.md"]);
  });

  it("skips sync for archived skills — does not unarchive", () => {
    const n = uname("ft-archived");
    const refFiles: Record<string, string> = {
      "references/x.md": "# X",
    };
    createDiskSkill(n, "# Before archive\nBody.", refFiles);

    // Create DB row via sync first
    const initial = syncSkillFromDisk(projectId, n);
    expect(initial).not.toBeUndefined();
    expect(initial!.archived_at).toBeNull();

    // Now archive the skill
    const archived = archiveSkill(projectId, n);
    expect(archived).not.toBeUndefined();
    expect(archived!.archived_at).not.toBeNull();
    const archivedRev = archived!.revision;

    // Ensure SKILL.md is still on disk (archiveSkill removes it, recreate it)
    const skillsBase = getSkillsBase(projectId);
    writeFileSync(resolve(skillsBase, n, "SKILL.md"), `---\nname: ${n}\ndescription: "Modified after archive"\n---\n\n# Changed body`);
    // Also modify a reference file to ensure change would be detected
    writeFileSync(resolve(skillsBase, n, "references/x.md"), "# Modified X");

    // Sync from disk — should skip because skill is archived
    const result = syncSkillFromDisk(projectId, n);
    expect(result).not.toBeUndefined();
    expect(result!.archived_at).not.toBeNull();
    // Revision must NOT be bumped
    expect(result!.revision).toBe(archivedRev);
  });

  it("creates missing DB rows for skills that only exist on disk", () => {
    const n = uname("ft-missing");
    const refFiles: Record<string, string> = {
      "references/readme.md": "# Readme\nThis skill was only on disk.",
      "references/config.json": '{"mode": "strict"}',
    };
    createDiskSkill(n, "# Disk-only skill\nContent was never in DB.", refFiles);

    // Verify no DB row exists before sync
    expect(getSkill(projectId, n)).toBeUndefined();

    // Sync from disk — should create the DB row
    const result = syncSkillFromDisk(projectId, n);
    expect(result).not.toBeUndefined();
    expect(result!.name).toBe(n);
    expect(result!.description).toBe("Test skill");
    expect(result!.content).toBe("# Disk-only skill\nContent was never in DB.");

    // Verify file_tree is populated
    const tree = parseFileTree(result!.file_tree);
    expect(Object.keys(tree).length).toBe(2);
    expect(tree["references/readme.md"]).toBe(refFiles["references/readme.md"]);
    expect(tree["references/config.json"]).toBe(refFiles["references/config.json"]);

    // Verify revision starts at 0 (new skill)
    expect(result!.revision).toBe(0);

    // Verify the skill is now retrievable from DB
    const dbSkill = getSkill(projectId, n);
    expect(dbSkill).not.toBeUndefined();
    expect(dbSkill!.id).toBe(result!.id);
  });
});
