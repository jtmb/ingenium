import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { getDb, resetDbForTest } from "../lib/db.js";
import { createProject } from "../lib/tools/projects.js";
import {
  createSkill, getSkill, getSkillById, updateSkill, archiveSkill, restoreSkill,
  syncSkillFromDisk, getSkillVersions,
} from "../lib/tools/skills.js";
import {
  GovernanceError,
  createLineage, createProposal, getProposal, listLineage, resolveLineage,
  submitProposal, approveProposal, rejectProposal, rollbackProposal,
} from "../lib/tools/skill-governance.js";
import { getSkillsBase } from "../lib/tools/paths.js";

let tempDir: string;
let projectId: string;
let targetProjectId: string;
let counter = 0;
function uname(p: string): string { return `${p}-${counter++}`; }

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), "ingenium-final-gov-"));
  process.env.INGENIUM_CORE_DB_PATH = join(tempDir, "test.db");
  resetDbForTest();
  projectId = createProject("test-gov").id;
  targetProjectId = createProject("target-gov").id;
});
afterAll(() => { resetDbForTest(); rmSync(tempDir, { recursive: true, force: true }); });

// ============================================================
// Item 1: expected_source_revision + stale checks
// ============================================================
describe("Item 1 — source revision + stale checks", () => {
  it("merge captures expected_source_revision", () => {
    const sn = uname("esr-src"); createSkill(projectId, sn, "SRC", "# SRC");
    const p = createProposal(projectId, "merge", uname("esr-tgt"), JSON.stringify({ description: "M", content: "# M" }), { sourceProjectId: projectId, sourceName: sn });
    expect(p.expected_source_revision).toBe(0);
  });

  it("approve marks stale if source is missing", () => {
    const sn = uname("src-gone"); createSkill(projectId, sn, "GONE", "# G");
    const p = createProposal(projectId, "merge", uname("tgt-gone"), JSON.stringify({ description: "M", content: "# M" }), { sourceProjectId: projectId, sourceName: sn });
    submitProposal(projectId, p.id);
    // Archive source (which also bumps its revision) — source is no longer active
    archiveSkill(projectId, sn);
    const result = approveProposal(projectId, p.id, "r");
    expect(result.status).toBe("stale");
  });

  it("approve marks stale if source revision changed", () => {
    const sn = uname("src-rev"); createSkill(projectId, sn, "REV", "# R");
    const p = createProposal(projectId, "merge", uname("tgt-rev"), JSON.stringify({ description: "M", content: "# M" }), { sourceProjectId: projectId, sourceName: sn });
    submitProposal(projectId, p.id);
    updateSkill(projectId, sn, "# Changed"); // bumps source revision
    const result = approveProposal(projectId, p.id, "r");
    expect(result.status).toBe("stale");
  });

  it("approve marks stale if source is archived between draft and approval", () => {
    const sn = uname("src-arc"); createSkill(projectId, sn, "ARC", "# A");
    const p = createProposal(projectId, "merge", uname("tgt-arc"), JSON.stringify({ description: "M", content: "# M" }), { sourceProjectId: projectId, sourceName: sn });
    submitProposal(projectId, p.id);
    archiveSkill(projectId, sn);
    const result = approveProposal(projectId, p.id, "r");
    expect(result.status).toBe("stale");
  });

  it("create proposal marks stale if target name appeared after draft", () => {
    const tn = uname("created-after");
    const p = createProposal(projectId, "create", tn, JSON.stringify({ description: "C", content: "# C" }));
    submitProposal(projectId, p.id);
    // Another process creates the target name
    createSkill(projectId, tn, "Appeared", "# Appeared");
    const result = approveProposal(projectId, p.id, "r");
    expect(result.status).toBe("stale");
  });

  it("update/archive/merge reject archived target at creation", () => {
    const tn = uname("arc-tgt"); const s = createSkill(projectId, tn, "ARC", "# A");
    archiveSkill(projectId, tn);
    expect(() => createProposal(projectId, "update", tn, JSON.stringify({ description: "U", content: "# U" }))).toThrow(GovernanceError);
    expect(() => createProposal(projectId, "archive", tn, JSON.stringify({}))).toThrow(GovernanceError);
    const sn = uname("arc-ms"); createSkill(projectId, sn, "MS", "# M");
    expect(() => createProposal(projectId, "merge", tn, JSON.stringify({ description: "M", content: "# M" }), { sourceProjectId: projectId, sourceName: sn })).toThrow(GovernanceError);
  });
});

// ============================================================
// Item 2: Disk reconciliation — multiple skills
// ============================================================
describe("Item 2 — disk reconciliation", () => {
  it("merge rollback writes restored source SKILL.md and restored existing target", () => {
    const sn = uname("dm-src"); const tn = uname("dm-tgt");
    createSkill(projectId, sn, "SRC orig", "# SRC original");
    const t = createSkill(projectId, tn, "TGT orig", "# TGT original");
    const p = createProposal(projectId, "merge", tn, JSON.stringify({ description: "Merged", content: "# Merged" }), { targetSkillId: t.id, sourceProjectId: projectId, sourceName: sn, expectedRevision: 0 });
    submitProposal(projectId, p.id); approveProposal(projectId, p.id, "r");
    rollbackProposal(projectId, p.id, "r");

    const skillsBase = getSkillsBase(projectId);
    // Source restored
    expect(existsSync(resolve(skillsBase, sn, "SKILL.md"))).toBe(true);
    expect(readFileSync(resolve(skillsBase, sn, "SKILL.md"), "utf-8")).toContain("SRC original");
    // Target restored
    expect(existsSync(resolve(skillsBase, tn, "SKILL.md"))).toBe(true);
    expect(readFileSync(resolve(skillsBase, tn, "SKILL.md"), "utf-8")).toContain("TGT original");
  });

  it("merge rollback (created target) removes target SKILL.md, writes source", () => {
    const sn = uname("dm-new-s"); const tn = uname("dm-new-t");
    createSkill(projectId, sn, "SRC new", "# SRC new");
    const p = createProposal(projectId, "merge", tn, JSON.stringify({ description: "M", content: "# M" }), { sourceProjectId: projectId, sourceName: sn });
    submitProposal(projectId, p.id); approveProposal(projectId, p.id, "r");
    rollbackProposal(projectId, p.id, "r");

    const skillsBase = getSkillsBase(projectId);
    expect(existsSync(resolve(skillsBase, tn, "SKILL.md"))).toBe(false);
    expect(existsSync(resolve(skillsBase, sn, "SKILL.md"))).toBe(true);
  });

  it("archive approval removes target SKILL.md", () => {
    const tn = uname("dm-arc"); const s = createSkill(projectId, tn, "ARC", "# ARC");
    const skillsBase = getSkillsBase(projectId);
    expect(existsSync(resolve(skillsBase, tn, "SKILL.md"))).toBe(true);
    const p = createProposal(projectId, "archive", tn, JSON.stringify({}), { targetSkillId: s.id, expectedRevision: 0 });
    submitProposal(projectId, p.id); approveProposal(projectId, p.id, "r");
    expect(existsSync(resolve(skillsBase, tn, "SKILL.md"))).toBe(false);
  });

  it("create approval writes target, rollback removes it", () => {
    const tn = uname("dm-cr");
    const p = createProposal(projectId, "create", tn, JSON.stringify({ description: "CR", content: "# CR" }));
    submitProposal(projectId, p.id); approveProposal(projectId, p.id, "r");
    const skillsBase = getSkillsBase(projectId);
    expect(existsSync(resolve(skillsBase, tn, "SKILL.md"))).toBe(true);
    rollbackProposal(projectId, p.id, "r");
    expect(existsSync(resolve(skillsBase, tn, "SKILL.md"))).toBe(false);
  });
});

// ============================================================
// Item 3: skill_versions database-enforced immutability
// ============================================================
describe("Item 3 — skill_versions immutability triggers", () => {
  it("BEFORE UPDATE trigger rejects modification of version rows", () => {
    const tn = uname("iv-upd"); createSkill(projectId, tn, "IV", "# IV");
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    expect(() => db.prepare("UPDATE skill_versions SET content='hacked' WHERE skill_id=(SELECT id FROM skills WHERE project_id=? AND name=?) AND revision=0").run(projectId, tn))
      .toThrow(/immutable/);
  });

  it("BEFORE DELETE trigger rejects deletion of version rows", () => {
    const tn = uname("iv-del"); createSkill(projectId, tn, "IVD", "# IVD");
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    expect(() => db.prepare("DELETE FROM skill_versions WHERE skill_id=(SELECT id FROM skills WHERE project_id=? AND name=?) AND revision=0").run(projectId, tn))
      .toThrow(/immutable/);
  });

  it("version rows survive after normal mutation (snapshot only via triggers)", () => {
    const tn = uname("iv-surv"); createSkill(projectId, tn, "Surv", "# S");
    updateSkill(projectId, tn, "# S2");
    const vers = getSkillVersions(getSkill(projectId, tn)!.id);
    expect(vers.length).toBe(2); // v0 + v1, neither modified
    expect(vers[0].content).toBe("# S2");
    expect(vers[1].content).toBe("# S");
  });
});

// ============================================================
// Item 4: Migration 042 full integrity probe
// ============================================================
describe("Item 4 — migration 042 full probe", () => {
  it("getDb throws actionable error on partial 042 state (missing trigger)", () => {
    const partialDir = mkdtempSync(join(tmpdir(), "partial-042-probe-"));
    try {
      const partialPath = join(partialDir, "partial.db");
      const db = new Database(partialPath);
      db.pragma("journal_mode = WAL"); db.pragma("busy_timeout = 5000"); db.pragma("foreign_keys = ON");
      const migDir = resolve(__dirname, "../data/migrations");
      const migs = ["001_init.sql","002_archive.sql","003_agents.sql","004_learnings_status.sql","005_skills_metadata.sql","006_skill_file_tree.sql","007_observations.sql","008_personality_traits.sql","009_pipeline_events.sql","010_commands.sql","011_server_source.sql","012_project_is_global.sql","013_fix_plugins_unique.sql","014_configs.sql","016_mcp_tool_states.sql","017_fix_trait_fk.sql","018_extraction_pipeline_events.sql","019_trait_exemplar_fk_setnull.sql","020_kanban_board.sql","021_jobs.sql","022_email_cache.sql","023_fix_servers_unique.sql","024_skills_unique_per_project.sql","025_email_string_ids.sql","026_email_suggestions.sql","027_email_summaries.sql","028_email_suggestion_queue.sql","029_docs_spaces.sql","030_docs_pages.sql","031_docs_pages_fts.sql","032_docs_drafts.sql","033_docs_versions.sql","034_docs_tags.sql","035_docs_links.sql","036_docs_comments.sql","037_docs_project_links.sql","038_docs_attachments.sql","039_docs_templates.sql","040_docs_integrity.sql","041_skill_maintenance_locks.sql"];
      for (const m of migs) db.exec(readFileSync(resolve(migDir, m), "utf-8"));
      // Apply only part of 042: revision + archived_at + table, but omit the before_delete trigger
      db.exec("ALTER TABLE skills ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0)");
      db.exec("ALTER TABLE skills ADD COLUMN archived_at TEXT");
      db.exec("CREATE TABLE IF NOT EXISTS skill_versions (id INTEGER PRIMARY KEY AUTOINCREMENT, skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE RESTRICT, revision INTEGER NOT NULL CHECK(revision>=0), name TEXT NOT NULL, description TEXT NOT NULL, content TEXT NOT NULL, category TEXT, tags TEXT, always_apply INTEGER NOT NULL DEFAULT 0, file_tree TEXT, enabled INTEGER NOT NULL DEFAULT 1, archived_at TEXT, created_by TEXT NOT NULL DEFAULT 'system', created_at TEXT NOT NULL, UNIQUE(skill_id,revision))");
      db.exec("CREATE TRIGGER IF NOT EXISTS skill_versions_after_insert AFTER INSERT ON skills BEGIN INSERT INTO skill_versions(skill_id,revision,name,description,content,category,tags,always_apply,file_tree,enabled,archived_at,created_by,created_at) VALUES(NEW.id,NEW.revision,NEW.name,NEW.description,NEW.content,NEW.category,NEW.tags,COALESCE(NEW.always_apply,0),NEW.file_tree,COALESCE(NEW.enabled,1),NEW.archived_at,'system',datetime('now')); END");
      db.exec("CREATE TRIGGER IF NOT EXISTS skill_versions_after_update AFTER UPDATE ON skills WHEN NEW.revision!=OLD.revision BEGIN INSERT INTO skill_versions(skill_id,revision,name,description,content,category,tags,always_apply,file_tree,enabled,archived_at,created_by,created_at) VALUES(NEW.id,NEW.revision,NEW.name,NEW.description,NEW.content,NEW.category,NEW.tags,COALESCE(NEW.always_apply,0),NEW.file_tree,COALESCE(NEW.enabled,1),NEW.archived_at,'system',datetime('now')); END");
      // NOTE: deliberately missing skill_versions_before_delete trigger
      db.close();
      resetDbForTest();
      let threw = false;
      try { getDb(partialPath); } catch (e: any) { threw = true; expect(e.message).toMatch(/PARTIAL|before_delete/); }
      expect(threw).toBe(true);
    } finally { resetDbForTest(); rmSync(partialDir, { recursive: true, force: true }); }
  });
});

// ============================================================
// Item 5: Migration 044 partial column detection
// ============================================================
describe("Item 5 — migration 044 partial detection", () => {
  it("throws actionable error when proposal table missing lifecycle columns", () => {
    const partialDir = mkdtempSync(join(tmpdir(), "partial-044-"));
    try {
      const partialPath = join(partialDir, "partial.db");
      const db = new Database(partialPath);
      db.pragma("journal_mode = WAL"); db.pragma("busy_timeout = 5000"); db.pragma("foreign_keys = ON");
      const migDir = resolve(__dirname, "../data/migrations");
      // Apply all migrations up to 043 (full skills schema)
      const allMigs = ["001_init.sql","002_archive.sql","003_agents.sql","004_learnings_status.sql","005_skills_metadata.sql","006_skill_file_tree.sql","007_observations.sql","008_personality_traits.sql","009_pipeline_events.sql","010_commands.sql","011_server_source.sql","012_project_is_global.sql","013_fix_plugins_unique.sql","014_configs.sql","016_mcp_tool_states.sql","017_fix_trait_fk.sql","018_extraction_pipeline_events.sql","019_trait_exemplar_fk_setnull.sql","020_kanban_board.sql","021_jobs.sql","022_email_cache.sql","023_fix_servers_unique.sql","024_skills_unique_per_project.sql","025_email_string_ids.sql","026_email_suggestions.sql","027_email_summaries.sql","028_email_suggestion_queue.sql","029_docs_spaces.sql","030_docs_pages.sql","031_docs_pages_fts.sql","032_docs_drafts.sql","033_docs_versions.sql","034_docs_tags.sql","035_docs_links.sql","036_docs_comments.sql","037_docs_project_links.sql","038_docs_attachments.sql","039_docs_templates.sql","040_docs_integrity.sql","041_skill_maintenance_locks.sql","042_skill_versions.sql","043_skill_lineage.sql"];
      for (const m of allMigs) db.exec(readFileSync(resolve(migDir, m), "utf-8"));
      // Drop the real proposals table and create a minimal one WITHOUT lifecycle columns
      db.exec("DROP TABLE IF EXISTS skill_proposals");
      db.exec("CREATE TABLE skill_proposals (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), status TEXT NOT NULL DEFAULT 'draft', proposal_type TEXT NOT NULL, target_name TEXT NOT NULL, proposed_state TEXT NOT NULL, created_at TEXT NOT NULL)");
      db.close();
      resetDbForTest();
      let threw = false;
      try { getDb(partialPath); } catch (e: any) { threw = true; expect(e.message).toMatch(/PARTIAL|missing required/); }
      expect(threw).toBe(true);
    } finally { resetDbForTest(); rmSync(partialDir, { recursive: true, force: true }); }
  });
});

// ============================================================
// Item 6: Race-time unique candidate constraint → GovernanceError
// ============================================================
describe("Item 6 — race-time candidate constraint mapping", () => {
  it("duplicate candidate key insertion throws GovernanceError DUPLICATE_PROPOSAL", () => {
    const key = "race-key-" + Date.now();
    createProposal(projectId, "create", uname("r1"), JSON.stringify({ description: "D1", content: "# D1" }), { candidateGroupKey: key });
    try {
      createProposal(projectId, "create", uname("r2"), JSON.stringify({ description: "D2", content: "# D2" }), { candidateGroupKey: key });
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(GovernanceError);
    }
  });
});

// ============================================================
// Item 7: Proposed state category handling, no fabrication
// ============================================================
describe("Item 7 — proposed state coverage", () => {
  it("createSkillWithinTransaction uses exact proposed state values (no fabrication)", () => {
    const tn = uname("ps-cat");
    const p = createProposal(projectId, "create", tn, JSON.stringify({
      description: "With category", content: "# With category", category: "custom-cat", tags: "a,b", always_apply: 1, file_tree: JSON.stringify({ "ref/g.md": "# G" })
    }));
    submitProposal(projectId, p.id); approveProposal(projectId, p.id, "r");
    const skill = getSkill(projectId, tn);
    expect(skill!.description).toBe("With category");
    expect(skill!.content).toBe("# With category");
    expect(skill!.category).toBe("custom-cat");
    expect(skill!.tags).toBe("a,b");
    expect(skill!.always_apply).toBe(1);
    expect(skill!.file_tree).toBe(JSON.stringify({ "ref/g.md": "# G" }));
  });

  it("update covers category in proposed state", () => {
    const tn = uname("ps-upd"); const s = createSkill(projectId, tn, "Orig", "# Orig", "orig-cat");
    const p = createProposal(projectId, "update", tn, JSON.stringify({ description: "Updated", content: "# Updated", category: "new-cat" }), { targetSkillId: s.id, expectedRevision: 0 });
    submitProposal(projectId, p.id); approveProposal(projectId, p.id, "r");
    expect(getSkill(projectId, tn)!.category).toBe("new-cat");
  });
});

// ============================================================
// Item 8: Remaining regression tests
// ============================================================
describe("remaining regression tests", () => {
  it("rollback refinement — all NO FALLBACK checks", () => {
    const tn = uname("rr"); createSkill(projectId, tn, "RR", "# RR");
    const p = createProposal(projectId, "archive", tn, JSON.stringify({}), { targetSkillId: getSkill(projectId, tn)!.id, expectedRevision: 0 });
    submitProposal(projectId, p.id); approveProposal(projectId, p.id, "r");
    expect(rollbackProposal(projectId, p.id, "r").status).toBe("rolled_back");
    expect(getSkill(projectId, tn)!.archived_at).toBeNull();
  });

  it("checkpoint reachability across all governance mutations", () => {
    const p = createProposal(projectId, "create", uname("chk-all"), JSON.stringify({ description: "C", content: "# C" }));
    expect(submitProposal(projectId, p.id)).not.toBeUndefined();
    expect(approveProposal(projectId, p.id, "r").status).toBe("applied");
    expect(rollbackProposal(projectId, p.id, "r").status).toBe("rolled_back");
    const p2 = createProposal(projectId, "create", uname("chk-rej"), JSON.stringify({ description: "R", content: "# R" }));
    submitProposal(projectId, p2.id);
    expect(rejectProposal(projectId, p2.id, "r").status).toBe("rejected");
  });

  it("lineage cycle and ownership", () => {
    const s = createSkill(projectId, uname("lin"), "L", "# L");
    expect(() => createLineage(projectId, projectId, s.name, s.id)).toThrow(/cycle|self/);
    const other = createSkill(targetProjectId, uname("lo-other"), "O", "# O");
    expect(() => createLineage(projectId, projectId, "ext", other.id)).toThrow(GovernanceError);
  });

  it("proposal lifecycle: stale, reject, cannot approve non-pending", () => {
    const tn = uname("lc-s"); createSkill(projectId, tn, "V0", "# V0");
    const p = createProposal(projectId, "update", tn, JSON.stringify({ description: "S", content: "# V99" }), { targetSkillId: getSkill(projectId, tn)!.id, expectedRevision: 0 });
    updateSkill(projectId, tn, "# V1");
    submitProposal(projectId, p.id);
    expect(approveProposal(projectId, p.id, "r").status).toBe("stale");
    expect(getSkill(projectId, tn)!.content).toBe("# V1");

    const p2 = createProposal(projectId, "create", uname("rej"), JSON.stringify({ description: "R", content: "# R" }));
    expect(() => approveProposal(projectId, p2.id, "r")).toThrow(GovernanceError);
  });

  // ── Stale reason formatter: system cause always retained, reviewer note appended ──
  it("stale reason retains system cause and appends reviewer note (target archived)", () => {
    const tn = uname("sr-tarc"); const s = createSkill(projectId, tn, "TARC", "# T");
    const p = createProposal(projectId, "update", tn, JSON.stringify({ description: "U", content: "# U" }), { targetSkillId: s.id, expectedRevision: 0 });
    submitProposal(projectId, p.id);
    archiveSkill(projectId, tn);
    const result = approveProposal(projectId, p.id, "reviewer1", "my custom note");
    expect(result.status).toBe("stale");
    expect(result.reviewer).toBe("reviewer1");
    // System cause must be present AND reviewer note appended
    expect(result.review_reason).toMatch(/Target skill is archived/);
    expect(result.review_reason).toContain("my custom note");
    expect(result.review_reason).toContain(" | ");
  });

  it("stale reason retains system cause and appends reviewer note (source archived)", () => {
    const sn = uname("sr-sarc"); const tn = uname("sr-sarc-t");
    createSkill(projectId, sn, "SARC", "# S");
    const s = createSkill(projectId, tn, "TARC", "# T");
    const p = createProposal(projectId, "merge", tn, JSON.stringify({ description: "M", content: "# M" }), {
      targetSkillId: s.id, sourceProjectId: projectId, sourceName: sn, expectedRevision: 0,
    });
    submitProposal(projectId, p.id);
    archiveSkill(projectId, sn);
    const result = approveProposal(projectId, p.id, "reviewer2", "merge invalid");
    expect(result.status).toBe("stale");
    expect(result.reviewer).toBe("reviewer2");
    expect(result.review_reason).toMatch(/Source skill is archived/);
    expect(result.review_reason).toContain("merge invalid");
    expect(result.review_reason).toContain(" | ");
  });

  it("stale reason uses system cause only when no reviewer note", () => {
    const tn = uname("sr-nonote"); const s = createSkill(projectId, tn, "NN", "# N");
    const p = createProposal(projectId, "update", tn, JSON.stringify({ description: "U", content: "# U" }), { targetSkillId: s.id, expectedRevision: 0 });
    submitProposal(projectId, p.id);
    archiveSkill(projectId, tn);
    const result = approveProposal(projectId, p.id, "reviewer3");
    expect(result.status).toBe("stale");
    // System cause only, no pipe separator
    expect(result.review_reason).toBe("Target skill is archived");
  });

  it("max lineage depth guard: deep graph does not loop unbounded", () => {
    // Create a chain of 5 skills and build lineage links
    const skills: { id: string; name: string }[] = [];
    for (let i = 0; i < 5; i++) {
      const nm = uname(`chain-${i}`);
      skills.push({ id: createSkill(projectId, nm, `C${i}`, `# C${i}`).id, name: nm });
    }
    for (let i = 0; i < 4; i++) {
      createLineage(projectId, projectId, skills[i].name, skills[i + 1].id);
    }
    // resolveLineage should return results without infinite loop
    const ancestry = resolveLineage(skills[4].id, projectId);
    expect(ancestry.length).toBeGreaterThanOrEqual(3);
    expect(ancestry.length).toBeLessThan(200);
  });
});

// ── rejectProposal — full governance rejection path ──────────────────

describe("rejectProposal", () => {
  it("rejects a pending proposal and sets status to 'rejected'", () => {
    const tn = uname("rj-pending");
    createSkill(projectId, tn, "V0", "# V0");
    const p = createProposal(projectId, "update", tn, JSON.stringify({ description: "U", content: "# U" }));
    submitProposal(projectId, p.id);
    const result = rejectProposal(projectId, p.id, "reviewer1");
    expect(result.status).toBe("rejected");
    expect(getProposal(projectId, p.id)!.status).toBe("rejected");
  });

  it("throws INVALID_STATUS_TRANSITION when rejecting a non-pending (draft) proposal", () => {
    const tn = uname("rj-draft");
    createSkill(projectId, tn, "V0", "# V0");
    const p = createProposal(projectId, "update", tn, JSON.stringify({ description: "U", content: "# U" }));
    try {
      rejectProposal(projectId, p.id, "reviewer1");
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(GovernanceError);
      expect((e as GovernanceError).code).toBe("INVALID_STATUS_TRANSITION");
    }
  });

  it("throws INVALID_STATUS_TRANSITION when rejecting an already applied proposal", () => {
    const tn = uname("rj-applied");
    createSkill(projectId, tn, "V0", "# V0");
    const p = createProposal(projectId, "update", tn, JSON.stringify({ description: "U", content: "# U" }));
    submitProposal(projectId, p.id);
    approveProposal(projectId, p.id, "r");
    try {
      rejectProposal(projectId, p.id, "reviewer1");
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(GovernanceError);
      expect((e as GovernanceError).code).toBe("INVALID_STATUS_TRANSITION");
    }
  });

  it("sets reviewer and review_reason on rejection", () => {
    const tn = uname("rj-review");
    createSkill(projectId, tn, "V0", "# V0");
    const p = createProposal(projectId, "update", tn, JSON.stringify({ description: "U", content: "# U" }));
    submitProposal(projectId, p.id);
    const result = rejectProposal(projectId, p.id, "reviewer-alice", "Not needed anymore");
    expect(result.reviewer).toBe("reviewer-alice");
    expect(result.review_reason).toBe("Not needed anymore");
  });

  it("sets reviewed_at timestamp on rejection", () => {
    const tn = uname("rj-ts");
    createSkill(projectId, tn, "V0", "# V0");
    const p = createProposal(projectId, "update", tn, JSON.stringify({ description: "U", content: "# U" }));
    submitProposal(projectId, p.id);
    const beforeReject = Date.now();
    const result = rejectProposal(projectId, p.id, "reviewer1");
    expect(result.reviewed_at).not.toBeNull();
    expect(Date.parse(result.reviewed_at!)).toBeGreaterThanOrEqual(beforeReject);
  });

  it("throws INVALID_STATUS_TRANSITION when rejecting a stale proposal", () => {
    const tn = uname("rj-stale");
    createSkill(projectId, tn, "V0", "# V0");
    const dupName = tn + "-dup";
    const p = createProposal(projectId, "create", dupName, JSON.stringify({ description: "C", content: "# C" }));
    submitProposal(projectId, p.id);
    // Make it stale by creating the target skill after proposal was submitted
    createSkill(projectId, dupName, "Appeared", "# Appeared");
    approveProposal(projectId, p.id, "r"); // turns it stale
    try {
      rejectProposal(projectId, p.id, "reviewer1");
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(GovernanceError);
      expect((e as GovernanceError).code).toBe("INVALID_STATUS_TRANSITION");
    }
  });

  it("throws PROPOSAL_NOT_FOUND for nonexistent proposal", () => {
    try {
      rejectProposal(projectId, "nonexistent-id-99999", "reviewer1");
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(GovernanceError);
      expect((e as GovernanceError).code).toBe("PROPOSAL_NOT_FOUND");
    }
  });

  it("reject with no review reason sets review_reason to null", () => {
    const tn = uname("rj-noreason");
    createSkill(projectId, tn, "V0", "# V0");
    const p = createProposal(projectId, "update", tn, JSON.stringify({ description: "U", content: "# U" }));
    submitProposal(projectId, p.id);
    const result = rejectProposal(projectId, p.id, "reviewer1");
    expect(result.review_reason).toBeNull();
  });
});

// ── Governance name/file_tree validation (B + C) ──────────────────────

describe("governance name & file_tree validation", () => {
  it("rejects proposal targetName with path separator", () => {
    expect(() => createProposal(projectId, "create", "../../escape", JSON.stringify({ description: "x", content: "# x" })))
      .toThrow(GovernanceError);
  });

  it("rejects proposal sourceName with path separator", () => {
    const tn = uname("gv-srcsafe");
    expect(() => createProposal(projectId, "merge", tn, JSON.stringify({ description: "x", content: "# x" }), {
      sourceProjectId: projectId, sourceName: "../bad",
    })).toThrow(GovernanceError);
  });

  it("rejects proposal targetName with null byte", () => {
    expect(() => createProposal(projectId, "create", "bad\x00name", JSON.stringify({ description: "x", content: "# x" })))
      .toThrow(GovernanceError);
  });

  it("rejects proposal targetName = dot", () => {
    expect(() => createProposal(projectId, "create", ".", JSON.stringify({ description: "x", content: "# x" })))
      .toThrow(GovernanceError);
  });
});

// ── file_tree validation (C) ──────────────────────────────────────────

describe("isValidSkillFileTree validation", () => {
  it("rejects empty string file_tree", () => {
    expect(() => createSkill(projectId, uname("ft-empty"), "FT", "# FT", undefined, undefined, undefined, "")).toThrow();
  });

  it("rejects non-JSON file_tree", () => {
    expect(() => createSkill(projectId, uname("ft-badj"), "FT", "# FT", undefined, undefined, undefined, "not-json")).toThrow();
  });

  it("rejects array file_tree", () => {
    expect(() => createSkill(projectId, uname("ft-arr"), "FT", "# FT", undefined, undefined, undefined, '["a","b"]')).toThrow();
  });

  it("rejects file_tree with non-string values", () => {
    expect(() => createSkill(projectId, uname("ft-nons"), "FT", "# FT", undefined, undefined, undefined, '{"a":1}')).toThrow();
  });

  it("accepts valid nested file_tree object", () => {
    const s = createSkill(projectId, uname("ft-valid"), "FT", "# FT", undefined, undefined, undefined, '{"a":"# A","b/c":"# C"}');
    expect(s).not.toBeUndefined();
  });

  it("accepts null and undefined file_tree", () => {
    expect(() => createSkill(projectId, uname("ft-null"), "FT", "# FT", undefined, undefined, undefined, null as any)).not.toThrow();
    expect(() => createSkill(projectId, uname("ft-undef"), "FT", "# FT", undefined, undefined, undefined, undefined)).not.toThrow();
  });
});

// ── Governance file_tree validation (item 3) ────────────────────────────

describe("proposal fileTree validation", () => {
  it("rejects non-string fileTree value (object with non-string values) via INVALID_PROPOSED_STATE", () => {
    try {
      createProposal(projectId, "create", uname("pft-ns"), JSON.stringify({
        description: "x", content: "# x",
        file_tree: JSON.stringify({ "a.md": 1 }),
      }));
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(GovernanceError);
      expect((e as GovernanceError).code).toBe("INVALID_PROPOSED_STATE");
    }
  });

  it("accepts valid nested string map fileTree", () => {
    const p = createProposal(projectId, "create", uname("pft-ok"), JSON.stringify({
      description: "x", content: "# x",
      file_tree: JSON.stringify({ "a.md": "# A" }),
    }));
    expect(p).not.toBeUndefined();
  });

  it("accepts null fileTree", () => {
    const p = createProposal(projectId, "create", uname("pft-null"), JSON.stringify({
      description: "x", content: "# x",
      file_tree: null,
    }));
    expect(p).not.toBeUndefined();
  });
});

// ── Rollback proposal version.name validation (item 3) ──────────────────

describe("rollback version.name validation", () => {
  it("rollbackProposal rejects corrupted version name and preserves skill state", () => {
    // Direct DB insert of a skill with an unsafe name bypasses createSkill's guard.
    // The AFTER INSERT trigger creates version 0 with this unsafe name.
    // createProposal validates targetName → must match the DB name but not trip
    // isSafeSkillName. Use a name that is technically unsafe but createProposal
    // is bypassed by using a normal flow: create a normal skill, then create
    // an update proposal to bump it. After approve, the version_0 has the
    // ORIGINAL safe name. For the test to hit validateVersionName, we need
    // version_0 to have an unsafe name when rollback loads it.
    //
    // Strategy: create normal skill s (revision 0). Approve an update on s (revision 1).
    // At rollback, proposal.target_revision_before = 0, so it loads version 0.
    // If version 0 has a safe name (true), rollback succeeds → unchanged test.
    // To make version 0 unsafe: insert the skill directly via DB with unsafe name.
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const sid = "rv-" + Date.now();
    const unsafeName = "bad/slash";
    const now = new Date().toISOString();
    db.prepare("INSERT INTO skills (id,project_id,name,description,content,revision,created_at,updated_at) VALUES (?,?,?,?,?,0,?,?)")
      .run(sid, projectId, unsafeName, "Bad", "# Bad", now, now);

    const s = getSkill(projectId, unsafeName)!;
    // Create proposal with targetSkillId to bypass name lookup (but createProposal
    // still validates targetName). Use any normal name and targetSkillId override.
    // Actually validateName check on targetName is unavoidable.
    // Simplest path: use an always-on safe name with the same unsafe DB row.
    // The version 0 name IS the DB row name = unsafeName.
    // createProposal calls validateName("target_name") which checks isSafeSkillName.
    // This rejects the unsafe name. We cannot bypass this in the public API.
    //
    // Instead test at a different layer: verify that if a version row has an
    // unsafe name, the GovernanceError prevents its application. We can test
    // this by calling rollbackProposal on a proposal whose target_revision_before
    // points to a version we directly insert with an unsafe name into a DIFFERENT
    // skill that has a safe name.
    const normalName = uname("rv-normal");
    const ns = createSkill(projectId, normalName, "N", "# N");
    // Create an update proposal on the normal skill
    const p = createProposal(projectId, "update", normalName, JSON.stringify({ description: "U", content: "# U" }), { targetSkillId: ns.id, expectedRevision: 0 });
    submitProposal(projectId, p.id); approveProposal(projectId, p.id, "r");
    // The normal skill now has revision 1, and rollback tries version 0 (safe name).
    // To make it unsafe: insert a fake version 0 with a new unsafe revision at
    // a higher number, then modify target_revision_before in the proposal to point there.
    // But skill_versions UNIQUE prevents duplicate (skill_id, rev). So use a new rev.
    db.prepare("INSERT INTO skill_versions (skill_id,revision,name,description,content,created_by,created_at) VALUES (?,99,?,?,?,?,?)")
      .run(ns.id, "../../escape", "Corrupt", "# C", "system", now);
    db.prepare("UPDATE skill_proposals SET target_revision_before=99 WHERE id=?").run(p.id);

    // Now rollback tries to apply version name "../../escape" → should reject
    expect(() => rollbackProposal(projectId, p.id, "r")).toThrow(GovernanceError);

    // Skill state unchanged
    const after = getSkill(projectId, normalName)!;
    expect(after.content).toBe("# U"); // from approve, unchanged by failed rollback
    expect(after.revision).toBe(1);
  });
});
