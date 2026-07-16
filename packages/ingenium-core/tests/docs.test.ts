/**
 * docs.test.ts — Comprehensive core unit tests for the Docs module.
 *
 * Covers:
 * - Migration 040 schema integrity (project_id TEXT, versions UNIQUE, drafts metadata)
 * - createPage draft lifecycle (revision 0, no version, space/parent validation)
 * - publishPage (revision bump, version creation, draft application, draft clear, conflict)
 * - updatePage (content limits, revision bump, version creation, conflict)
 * - saveDraft (content limits, metadata, no revision bump)
 * - movePage (self-parent, cycle, cross-space, archived, nonexistent parent)
 * - Attachment upsert ON CONFLICT (not INSERT OR REPLACE), delete ownership
 * - Comment length limits, parent page/comment validation
 * - Project link existence check
 * - FTS/backlink rebuild on publish
 * - Archived page list/purge/restore
 * - Slug lookups, template update
 * - Favorites projection
 * - Search with content
 *
 * Run: npx vitest run packages/ingenium-core/tests/docs.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb } from "../lib/db.js";
import { createProject } from "../lib/tools/projects.js";
import {
  // Spaces
  createSpace,
  getSpace,
  getSpaceBySlug,
  listSpaces,
  deleteSpace,
  // Pages
  createPage,
  getPage,
  getPageBySlug,
  listPages,
  listArchivedPages,
  purgeArchivedPages,
  publishPage,
  updatePage,
  archivePage,
  restorePage,
  movePage,
  // Drafts
  saveDraft,
  getDraft,
  deleteDraft,
  // Versions
  listVersions,
  getVersion,
  // Comments
  createComment,
  listComments,
  resolveComment,
  deleteComment,
  // Attachments
  saveAttachment,
  deleteAttachment,
  listAttachments,
  getAttachment,
  getAttachmentsByPage,
  // Tags
  addTag,
  getPageTags,
  removeTag,
  listAllTags,
  // Backlinks
  getBacklinks,
  // Templates
  createTemplate,
  updateTemplate,
  getTemplate,
  deleteTemplate,
  listTemplates,
  // Project links
  linkProject,
  unlinkProject,
  getLinkedProjects,
  // Favorites
  toggleFavorite,
  listFavorites,
  // Search
  searchPages,
  // Import/Export
  importPages,
  exportSpace,
  // Stats
  getDocStats,
  // Utilities
  slugExists,
  // Types
  type DocPage,
  type DocDraft,
  type DocVersion,
  type DocAttachment,
  type DocComment,
  type DocTemplate,
} from "../lib/tools/docs.js";
import { MAX_PAGE_CONTENT_LENGTH, MAX_COMMENT_LENGTH } from "../lib/constants.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

let tempDir: string;
let dbPath: string;
let spaceSerial = 0;
let projectSerial = 0;

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), "ingenium-core-docs-test-"));
  dbPath = join(tempDir, "test.db");
  process.env.INGENIUM_CORE_DB_PATH = dbPath;
  getDb(dbPath);
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function seq() { return ++spaceSerial; }

function mkSpace(): ReturnType<typeof createSpace> {
  const n = seq();
  return createSpace(`Test Space ${n}`, `test-space-${n}`);
}

function mkProject(): ReturnType<typeof createProject> {
  projectSerial++;
  return createProject(`docs-test-proj-${projectSerial}`);
}

/** Create a page in draft and publish it, returning the published page. */
function createPublished(spaceId: number, title: string, slug: string, content?: string, parentId?: number): DocPage {
  const r = createPage(spaceId, title, slug, content, parentId);
  expect(r.error).toBeUndefined();
  expect(r.page).toBeDefined();
  const p = publishPage(r.page!.id);
  expect(p.error).toBeUndefined();
  expect(p.page).toBeDefined();
  return p.page!;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Migration 040: schema integrity
// ═══════════════════════════════════════════════════════════════════════════════

describe("Migration 040: schema integrity", () => {
  it("docs_page_projects.project_id is TEXT (not INTEGER)", () => {
    const db = getDb(dbPath);
    const col = db.prepare(
      "SELECT type FROM pragma_table_info('docs_page_projects') WHERE name = 'project_id'"
    ).get() as { type: string } | undefined;
    expect(col).toBeDefined();
    expect(col!.type).toBe("TEXT");
  });

  it("docs_page_projects FK references projects(id) which is TEXT", () => {
    const db = getDb(dbPath);
    // Verify the FK exists on project_id referencing projects
    const fks = db.prepare(
      "SELECT * FROM pragma_foreign_key_list('docs_page_projects') WHERE \"from\" = 'project_id' AND \"table\" = 'projects'"
    ).all() as any[];
    expect(fks.length).toBeGreaterThan(0);
  });

  it("docs_page_versions has UNIQUE index on (page_id, revision)", () => {
    const db = getDb(dbPath);
    const idx = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_docs_versions_page_rev_unique'"
    ).get() as any;
    expect(idx).toBeDefined();
  });

  it("docs_page_versions prevents duplicate (page_id, revision)", () => {
    const space = mkSpace();
    const page = createPublished(space.id, "Ver Uniq", `ver-uniq-${seq()}`);
    const db = getDb(dbPath);
    // Manual insert of duplicate (page_id, 1)
    expect(() => {
      db.prepare(
        "INSERT INTO docs_page_versions (page_id, revision, title, content) VALUES (?, 1, 'dup', 'dup')"
      ).run(page.id);
    }).toThrow();
  });

  it("docs_page_drafts has title, slug, base_revision columns", () => {
    const db = getDb(dbPath);
    const cols = db.prepare("PRAGMA table_info('docs_page_drafts')").all() as any[];
    const names = cols.map((c: any) => c.name);
    expect(names).toContain("title");
    expect(names).toContain("slug");
    expect(names).toContain("base_revision");
  });

  it("docs_page_drafts title/slug persist through save and get", () => {
    const space = mkSpace();
    const page = createPublished(space.id, "Draft Meta", `draft-meta-${seq()}`);
    saveDraft(page.id, "# Draft v2", "Meta Title", "meta-slug", page.revision);
    const draft = getDraft(page.id);
    expect(draft).toBeDefined();
    expect(draft!.title).toBe("Meta Title");
    expect(draft!.slug).toBe("meta-slug");
    expect(draft!.content).toBe("# Draft v2");
    expect(draft!.base_revision).toBe(page.revision);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. createPage draft lifecycle
// ═══════════════════════════════════════════════════════════════════════════════

describe("createPage: draft lifecycle", () => {
  it("creates page with status='draft' and revision=0", () => {
    const space = mkSpace();
    const r = createPage(space.id, "Draft Page", `draft-page-${seq()}`);
    expect(r.page).toBeDefined();
    expect(r.page!.status).toBe("draft");
    expect(r.page!.revision).toBe(0);
    expect(r.page!.title).toBe("Draft Page");
  });

  it("does not create any versions for a draft page", () => {
    const space = mkSpace();
    const r = createPage(space.id, "No Ver", `no-ver-${seq()}`);
    const versions = listVersions(r.page!.id);
    expect(versions.length).toBe(0);
  });

  it("validates space exists", () => {
    const r = createPage(99999, "Bad Space", `bad-space-${seq()}`);
    expect(r.error).toBeDefined();
    expect(r.error!.code).toBe("SPACE_NOT_FOUND");
  });

  it("rejects cross-space parent", () => {
    const s1 = mkSpace();
    const s2 = mkSpace();
    const p2 = createPublished(s2.id, "Other", `other-${seq()}`);
    const r = createPage(s1.id, "Cross", `cross-${seq()}`, "# Bad", p2.id);
    expect(r.error).toBeDefined();
    expect(r.error!.code).toBe("PARENT_CROSS_SPACE");
  });

  it("rejects archived parent", () => {
    const space = mkSpace();
    const parent = createPublished(space.id, "Will Arch", `will-arch-${seq()}`);
    archivePage(parent.id);
    const r = createPage(space.id, "Child", `child-${seq()}`, "# Child", parent.id);
    expect(r.error).toBeDefined();
    expect(r.error!.code).toBe("PARENT_ARCHIVED");
  });

  it("rejects nonexistent parent", () => {
    const space = mkSpace();
    const r = createPage(space.id, "Orphan", `orphan-${seq()}`, "# Orphan", 99999);
    expect(r.error).toBeDefined();
    expect(r.error!.code).toBe("PARENT_NOT_FOUND");
  });

  it("accepts valid parent in same space", () => {
    const space = mkSpace();
    const parent = createPublished(space.id, "Parent", `parent-${seq()}`);
    const r = createPage(space.id, "Child", `child-${seq()}`, "# Child", parent.id);
    expect(r.error).toBeUndefined();
    expect(r.page).toBeDefined();
    expect(r.page!.parent_page_id).toBe(parent.id);
    expect(r.page!.space_id).toBe(space.id);
  });

  it("rejects content exceeding MAX_PAGE_CONTENT_LENGTH", () => {
    const space = mkSpace();
    const tooLong = "x".repeat(MAX_PAGE_CONTENT_LENGTH + 1);
    const r = createPage(space.id, "Big", `big-${seq()}`, tooLong);
    expect(r.error).toBeDefined();
    expect(r.error!.code).toBe("CONTENT_TOO_LONG");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. publishPage lifecycle
// ═══════════════════════════════════════════════════════════════════════════════

describe("publishPage: explicit publish", () => {
  it("promotes draft to published with revision increment", () => {
    const space = mkSpace();
    const r = createPage(space.id, "To Publish", `to-pub-${seq()}`, "# Draft");
    expect(r.page!.revision).toBe(0);
    expect(r.page!.status).toBe("draft");

    const p = publishPage(r.page!.id);
    expect(p.page).toBeDefined();
    expect(p.page!.status).toBe("published");
    expect(p.page!.revision).toBe(1);
  });

  it("creates exactly one version at the new revision", () => {
    const space = mkSpace();
    const r = createPage(space.id, "One Ver", `one-ver-${seq()}`, "# V0");
    publishPage(r.page!.id);

    const versions = listVersions(r.page!.id);
    expect(versions.length).toBe(1);
    expect(versions[0].revision).toBe(1);
    expect(versions[0].content).toBe("# V0");
  });

  it("uses draft title/slug/content when draft exists", () => {
    const space = mkSpace();
    const r = createPage(space.id, "Orig Title", `orig-${seq()}`, "# Orig");
    saveDraft(r.page!.id, "# Draft Content", "Draft Title", `draft-slug-${seq()}`, 0);

    const p = publishPage(r.page!.id);
    expect(p.page!.title).toBe("Draft Title");
    expect(p.page!.slug).toBe(`draft-slug-${spaceSerial}`);
    expect(p.page!.content).toBe("# Draft Content");
  });

  it("falls back to page fields when draft has empty metadata", () => {
    const space = mkSpace();
    const slug = `fallback-${seq()}`;
    const r = createPage(space.id, "Fallback", slug, "# Page Content");
    // Save draft with content only, empty title/slug
    saveDraft(r.page!.id, "# Draft Content", "", "", 0);

    const p = publishPage(r.page!.id);
    // Title and slug should fall back to page values (since draft title is "")
    expect(p.page!.content).toBe("# Draft Content"); // draft content wins
    // slug stays original since draft slug is ""
    expect(p.page!.slug).toBe(slug);
  });

  it("clears draft after publish", () => {
    const space = mkSpace();
    const r = createPage(space.id, "Clear Draft", `clear-${seq()}`, "# Page");
    saveDraft(r.page!.id, "# Draft", "T", `s-${seq()}`, 0);
    expect(getDraft(r.page!.id)).toBeDefined();

    publishPage(r.page!.id);
    expect(getDraft(r.page!.id)).toBeUndefined();
  });

  it("returns conflict when expectedRevision does not match", () => {
    const space = mkSpace();
    const r = createPage(space.id, "Conflict", `conflict-${seq()}`, "# V0");
    publishPage(r.page!.id); // now at rev 1

    const p = publishPage(r.page!.id, 0); // expect rev 0 but it's 1
    expect(p.conflict).toBe(true);
    expect(p.currentRevision).toBe(1);
    expect(p.page).toBeUndefined();
  });

  it("succeeds when expectedRevision matches", () => {
    const space = mkSpace();
    const r = createPage(space.id, "Match Rev", `match-${seq()}`, "# V0");
    const p = publishPage(r.page!.id, 0);
    expect(p.error).toBeUndefined();
    expect(p.page).toBeDefined();
    expect(p.page!.revision).toBe(1);
  });

  it("multiple publishes create unique versions with sequential revisions", () => {
    const space = mkSpace();
    const r = createPage(space.id, "Multi", `multi-${seq()}`, "# V0");
    publishPage(r.page!.id); // v0 -> v1

    saveDraft(r.page!.id, "# V2", "", "", 1);
    publishPage(r.page!.id, 1); // v1 -> v2

    const versions = listVersions(r.page!.id);
    expect(versions.length).toBe(2);
    const revs = versions.map(v => v.revision).sort((a, b) => a - b);
    expect(revs).toEqual([1, 2]);
  });

  it("rejects publish when draft content exceeds MAX_PAGE_CONTENT_LENGTH", () => {
    const space = mkSpace();
    const r = createPage(space.id, "Big Draft", `big-draft-${seq()}`, "# V0");
    const tooLong = "x".repeat(MAX_PAGE_CONTENT_LENGTH + 1);
    expect(() => saveDraft(r.page!.id, tooLong, "Big", `big-${seq()}`, 0)).toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. updatePage semantics
// ═══════════════════════════════════════════════════════════════════════════════

describe("updatePage: safe explicit updates", () => {
  it("bumps revision and creates version on update", () => {
    const space = mkSpace();
    const page = createPublished(space.id, "Upd", `upd-${seq()}`, "# V1");
    expect(page.revision).toBe(1);

    const r = updatePage(page.id, { content: "# V2", expectedRevision: 1 });
    expect(r.page).toBeDefined();
    expect(r.page!.revision).toBe(2);
    expect(r.page!.content).toBe("# V2");

    const versions = listVersions(page.id);
    expect(versions.length).toBe(2); // rev 1 and rev 2
  });

  it("returns conflict on expectedRevision mismatch", () => {
    const space = mkSpace();
    const page = createPublished(space.id, "Upd Con", `upd-con-${seq()}`, "# V1");
    const r = updatePage(page.id, { content: "# V2", expectedRevision: 0 });
    expect(r.conflict).toBe(true);
    expect(r.currentRevision).toBe(1);
  });

  it("rejects content exceeding MAX_PAGE_CONTENT_LENGTH", () => {
    const space = mkSpace();
    const page = createPublished(space.id, "Upd Big", `upd-big-${seq()}`, "# V1");
    const tooLong = "x".repeat(MAX_PAGE_CONTENT_LENGTH + 1);
    const r = updatePage(page.id, { content: tooLong });
    expect(r.error).toBeDefined();
    expect(r.error!.code).toBe("CONTENT_TOO_LONG");
  });

  it("returns error for nonexistent page", () => {
    const r = updatePage(99999, { content: "# Nope" });
    expect(r.error).toBeDefined();
    expect(r.error!.code).toBe("PAGE_NOT_FOUND");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. saveDraft (no revision bump)
// ═══════════════════════════════════════════════════════════════════════════════

describe("saveDraft: safe autosave", () => {
  it("does NOT bump page revision", () => {
    const space = mkSpace();
    const page = createPublished(space.id, "Draft Rev", `draft-rev-${seq()}`, "# V1");
    const revBefore = page.revision;

    saveDraft(page.id, "# Draft content");
    const after = getPage(page.id);
    expect(after!.revision).toBe(revBefore);
  });

  it("rejects content exceeding MAX_PAGE_CONTENT_LENGTH", () => {
    const space = mkSpace();
    const page = createPublished(space.id, "Draft Big", `draft-big-${seq()}`, "# V1");
    const tooLong = "x".repeat(MAX_PAGE_CONTENT_LENGTH + 1);
    expect(() => saveDraft(page.id, tooLong)).toThrow();
  });

  it("throws when page does not exist (defensive parent check)", () => {
    expect(() => saveDraft(99999, "# Orphan")).toThrow();
  });

  it("upserts: second save updates existing draft", () => {
    const space = mkSpace();
    const page = createPublished(space.id, "Draft Upsert", `draft-upsert-${seq()}`, "# V1");

    saveDraft(page.id, "# First", "T1", `s1-${seq()}`, 1);
    const d1 = getDraft(page.id);
    expect(d1!.content).toBe("# First");

    saveDraft(page.id, "# Second", "T2", `s2-${seq()}`, 1);
    const d2 = getDraft(page.id);
    expect(d2!.content).toBe("# Second");
    expect(d2!.title).toBe("T2");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. movePage cycle detection and parent validation
// ═══════════════════════════════════════════════════════════════════════════════

describe("movePage: cycle detection", () => {
  it("prevents self-parenting", () => {
    const space = mkSpace();
    const pageA = createPublished(space.id, "Self", `self-${seq()}`);
    const r = movePage(pageA.id, pageA.id);
    expect(r.error!.code).toBe("PARENT_SELF");
  });

  it("prevents direct cycle: parent -> child -> parent", () => {
    const space = mkSpace();
    const a = createPublished(space.id, "A", `mc-a-${seq()}`);
    const b = createPublished(space.id, "B", `mc-b-${seq()}`, "", a.id);
    // Try to move A under B (would create B -> A -> B)
    const r = movePage(a.id, b.id);
    expect(r.error).toBeDefined();
    if (r.error) expect(r.error.code).toBe("PARENT_CYCLE");
  });

  it("prevents deep cycle: grandparent -> parent -> child -> grandparent", () => {
    const space = mkSpace();
    const root = createPublished(space.id, "Root", `root-${seq()}`);
    const mid = createPublished(space.id, "Mid", `mid-${seq()}`, "", root.id);
    const leaf = createPublished(space.id, "Leaf", `leaf-${seq()}`, "", mid.id);
    // Try to move root under leaf (would create leaf -> root -> mid -> leaf)
    const r = movePage(root.id, leaf.id);
    expect(r.error).toBeDefined();
    if (r.error) expect(r.error.code).toBe("PARENT_CYCLE");
  });

  it("prevents cross-space move", () => {
    const s1 = mkSpace();
    const s2 = mkSpace();
    const a = createPublished(s1.id, "A", `mcsa-${seq()}`);
    const b = createPublished(s2.id, "B", `mcsb-${seq()}`);
    const r = movePage(a.id, b.id);
    expect(r.error!.code).toBe("PARENT_CROSS_SPACE");
  });

  it("prevents moving under archived parent", () => {
    const space = mkSpace();
    const a = createPublished(space.id, "A", `ma-a-${seq()}`);
    const b = createPublished(space.id, "B", `ma-b-${seq()}`);
    archivePage(b.id);
    const r = movePage(a.id, b.id);
    expect(r.error!.code).toBe("PARENT_ARCHIVED");
  });

  it("allows moving to root (null parent)", () => {
    const space = mkSpace();
    const a = createPublished(space.id, "A", `mv-a-${seq()}`);
    const b = createPublished(space.id, "B", `mv-b-${seq()}`, "", a.id);
    const r = movePage(b.id, null);
    expect(r.error).toBeUndefined();
    expect(r.page!.parent_page_id).toBeNull();
  });

  it("allows valid move between siblings", () => {
    const space = mkSpace();
    const parent = createPublished(space.id, "Parent", `sib-p-${seq()}`);
    const a = createPublished(space.id, "A", `sib-a-${seq()}`);
    const b = createPublished(space.id, "B", `sib-b-${seq()}`, "", parent.id);
    // Move A under parent
    const r = movePage(a.id, parent.id);
    expect(r.error).toBeUndefined();
    expect(r.page!.parent_page_id).toBe(parent.id);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. Attachment: ON CONFLICT DO UPDATE (not INSERT OR REPLACE)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Attachments: ON CONFLICT DO UPDATE", () => {
  it("upsert preserves ID on conflict", () => {
    const space = mkSpace();
    const page = createPublished(space.id, "Att Page", `att-page-${seq()}`);

    const a1 = saveAttachment(page.id, "doc.pdf", "orig.pdf", "application/pdf", 100, "/tmp/doc.pdf");
    const id1 = a1.id;

    // Update same (page_id, filename) — should keep same ID
    const a2 = saveAttachment(page.id, "doc.pdf", "renamed.pdf", "application/pdf", 200, "/tmp/renamed.pdf");
    expect(a2.id).toBe(id1);
    expect(a2.original_name).toBe("renamed.pdf");
    expect(a2.size_bytes).toBe(200);
    expect(a2.storage_path).toBe("/tmp/renamed.pdf");
  });

  it("delete returns attachment with page_id for ownership verification", () => {
    const space = mkSpace();
    const page = createPublished(space.id, "Att Del", `att-del-${seq()}`);
    const att = saveAttachment(page.id, "del.pdf", "del.pdf", "application/pdf", 50, "/tmp/del.pdf");

    const deleted = deleteAttachment(att.id);
    expect(deleted).toBeDefined();
    expect(deleted!.page_id).toBe(page.id);
    expect(deleted!.filename).toBe("del.pdf");

    // Double-delete returns undefined
    expect(deleteAttachment(att.id)).toBeUndefined();
  });

  it("listAttachments and getAttachmentsByPage return same results", () => {
    const space = mkSpace();
    const page = createPublished(space.id, "Att List", `att-list-${seq()}`);
    saveAttachment(page.id, "a.pdf", "a.pdf", "application/pdf", 10, "/tmp/a.pdf");
    saveAttachment(page.id, "b.pdf", "b.pdf", "application/pdf", 20, "/tmp/b.pdf");

    const viaList = listAttachments(page.id);
    const viaGet = getAttachmentsByPage(page.id);
    expect(viaList.length).toBe(2);
    expect(viaGet.length).toBe(2);
    expect(viaList.map(a => a.filename).sort()).toEqual(["a.pdf", "b.pdf"]);
    expect(viaGet.map(a => a.filename).sort()).toEqual(["a.pdf", "b.pdf"]);
  });

  it("getAttachment by ID works", () => {
    const space = mkSpace();
    const page = createPublished(space.id, "Att Get", `att-get-${seq()}`);
    const att = saveAttachment(page.id, "get.pdf", "get.pdf", "application/pdf", 10, "/tmp/get.pdf");

    const found = getAttachment(att.id);
    expect(found).toBeDefined();
    expect(found!.id).toBe(att.id);
    expect(found!.page_id).toBe(page.id);
  });

  it("getAttachment returns undefined for nonexistent id", () => {
    expect(getAttachment(99999)).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. Comment: length limits and parent validation
// ═══════════════════════════════════════════════════════════════════════════════

describe("Comments: validation and lifecycle", () => {
  it("rejects comment exceeding MAX_COMMENT_LENGTH", () => {
    const space = mkSpace();
    const page = createPublished(space.id, "Cmt Big", `cmt-big-${seq()}`);
    const tooLong = "y".repeat(MAX_COMMENT_LENGTH + 1);
    const r = createComment(page.id, tooLong);
    expect(r.error).toBeDefined();
    expect(r.error!.code).toBe("COMMENT_TOO_LONG");
  });

  it("accepts comment at MAX_COMMENT_LENGTH boundary", () => {
    const space = mkSpace();
    const page = createPublished(space.id, "Cmt Limit", `cmt-limit-${seq()}`);
    const atLimit = "y".repeat(MAX_COMMENT_LENGTH);
    const r = createComment(page.id, atLimit);
    expect(r.error).toBeUndefined();
    expect(r.comment).toBeDefined();
  });

  it("throws when parent page does not exist", () => {
    expect(() => createComment(99999, "orphan")).toThrow();
  });

  it("throws when parent comment does not exist", () => {
    const space = mkSpace();
    const page = createPublished(space.id, "Cmt Reply", `cmt-reply-${seq()}`);
    expect(() => createComment(page.id, "reply to nothing", 99999)).toThrow();
  });

  it("create, resolve, and delete comment CRUD", () => {
    const space = mkSpace();
    const page = createPublished(space.id, "Cmt CRUD", `cmt-crud-${seq()}`);

    const c = createComment(page.id, "Hello world", undefined, "selected", 10);
    expect(c.comment).toBeDefined();
    expect(c.comment!.content).toBe("Hello world");
    expect(c.comment!.selection_text).toBe("selected");
    expect(c.comment!.selection_offset).toBe(10);
    expect(c.comment!.resolved).toBe(0);

    // Resolve
    const resolved = resolveComment(c.comment!.id);
    expect(resolved!.resolved).toBe(1);

    // Delete
    const deleted = deleteComment(c.comment!.id);
    expect(deleted).toBe(true);
    expect(deleteComment(c.comment!.id)).toBe(false);
  });

  it("nested comments (parent_comment_id)", () => {
    const space = mkSpace();
    const page = createPublished(space.id, "Cmt Nest", `cmt-nest-${seq()}`);
    const parent = createComment(page.id, "Parent comment");
    const child = createComment(page.id, "Child reply", parent.comment!.id);
    expect(child.comment).toBeDefined();
    expect(child.comment!.parent_comment_id).toBe(parent.comment!.id);

    const all = listComments(page.id);
    expect(all.length).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. Project links: existence check and TEXT FK
// ═══════════════════════════════════════════════════════════════════════════════

describe("Project links: TEXT FK with existence check", () => {
  it("linkProject succeeds with existing project", () => {
    const space = mkSpace();
    const page = createPublished(space.id, "Proj Link", `proj-link-${seq()}`);
    const project = mkProject();

    const link = linkProject(page.id, project.id);
    expect(link.page_id).toBe(page.id);
    expect(link.project_id).toBe(project.id);
  });

  it("linkProject throws when project does not exist", () => {
    const space = mkSpace();
    const page = createPublished(space.id, "Bad Proj", `bad-proj-${seq()}`);
    expect(() => linkProject(page.id, "nonexistent-project")).toThrow();
  });

  it("linkProject throws when page does not exist", () => {
    const project = mkProject();
    expect(() => linkProject(99999, project.id)).toThrow();
  });

  it("getLinkedProjects returns linked projects", () => {
    const space = mkSpace();
    const page = createPublished(space.id, "Get Proj", `get-proj-${seq()}`);
    const p1 = mkProject();
    const p2 = mkProject();

    linkProject(page.id, p1.id);
    linkProject(page.id, p2.id);

    const links = getLinkedProjects(page.id);
    expect(links.length).toBe(2);
    const ids = links.map(l => l.project_id).sort();
    expect(ids).toContain(p1.id);
    expect(ids).toContain(p2.id);
  });

  it("unlinkProject removes the link", () => {
    const space = mkSpace();
    const page = createPublished(space.id, "Unlink", `unlink-${seq()}`);
    const project = mkProject();

    linkProject(page.id, project.id);
    expect(getLinkedProjects(page.id).length).toBe(1);

    const result = unlinkProject(page.id, project.id);
    expect(result).toBe(true);
    expect(getLinkedProjects(page.id).length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. FTS search and backlink rebuild
// ═══════════════════════════════════════════════════════════════════════════════

describe("FTS and backlinks", () => {
  it("publishPage rebuilds backlinks from wikilinks", () => {
    const space = mkSpace();
    // Create a target page first
    const target = createPublished(space.id, "Target", `target-${seq()}`, "# Target Page");
    // Create source page with a wikilink to target
    const slug = `source-${seq()}`;
    const r = createPage(space.id, "Source", slug, `See [[${target.slug}]] for details`);
    publishPage(r.page!.id);

    const backlinks = getBacklinks(target.id);
    expect(backlinks.length).toBe(1);
    expect(backlinks[0].source_slug).toBe(slug);
    expect(backlinks[0].link_text).toBe(target.slug);
  });

  it("updatePage rebuilds backlinks", () => {
    const space = mkSpace();
    const t1 = createPublished(space.id, "T1", `t1-${seq()}`, "# First");
    const t2 = createPublished(space.id, "T2", `t2-${seq()}`, "# Second");
    const source = createPublished(space.id, "Src", `src-${seq()}`, `Link to [[${t1.slug}]]`);

    // Initially links to t1
    let bl = getBacklinks(t1.id);
    expect(bl.length).toBe(1);

    // Update to link to t2 instead
    updatePage(source.id, { content: `Link to [[${t2.slug}]]`, expectedRevision: 1 });

    bl = getBacklinks(t1.id);
    expect(bl.length).toBe(0);
    bl = getBacklinks(t2.id);
    expect(bl.length).toBe(1);
  });

  it("searchPages finds published pages by content", () => {
    const space = mkSpace();
    createPublished(space.id, "Unique Title", `unique-${seq()}`, "# UniqueContent42 for search");

    // Wait a moment for FTS to be available (external content FTS might need sync)
    const results = searchPages("UniqueContent42", space.id);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].title).toBe("Unique Title");
  });

  it("searchPages with sanitized query returns empty for no match", () => {
    const space = mkSpace();
    const results = searchPages("NoSuchContentXYZ123", space.id);
    expect(results.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 11. Archived page management
// ═══════════════════════════════════════════════════════════════════════════════

describe("Archived pages: list, purge, restore", () => {
  it("archivePage sets status to archived", () => {
    const space = mkSpace();
    const page = createPublished(space.id, "To Archive", `to-archive-${seq()}`);
    const result = archivePage(page.id);
    expect(result).toBe(true);

    const p = getPage(page.id);
    expect(p!.status).toBe("archived");
  });

  it("listArchivedPages returns only archived pages", () => {
    const space = mkSpace();
    const active = createPublished(space.id, "Active", `active-${seq()}`);
    const archived = createPublished(space.id, "Archived", `archived-${seq()}`);
    archivePage(archived.id);

    const archivedList = listArchivedPages(space.id);
    expect(archivedList.length).toBe(1);
    expect(archivedList[0].id).toBe(archived.id);
  });

  it("purgeArchivedPages permanently deletes archived pages", () => {
    const space = mkSpace();
    const page = createPublished(space.id, "Purge Me", `purge-me-${seq()}`);
    archivePage(page.id);

    const deleted = purgeArchivedPages(space.id);
    expect(deleted).toBe(1);
    expect(getPage(page.id)).toBeUndefined();
  });

  it("purgeArchivedPages does not delete non-archived pages", () => {
    const space = mkSpace();
    const active = createPublished(space.id, "Stay Active", `stay-${seq()}`);
    const archived = createPublished(space.id, "Go Away", `go-${seq()}`);
    archivePage(archived.id);

    purgeArchivedPages(space.id);
    expect(getPage(active.id)).toBeDefined();
    expect(getPage(archived.id)).toBeUndefined();
  });

  it("restorePage sets status back to published", () => {
    const space = mkSpace();
    const page = createPublished(space.id, "Restore Me", `restore-${seq()}`);
    archivePage(page.id);

    const restored = restorePage(page.id);
    expect(restored).toBeDefined();
    expect(restored!.status).toBe("published");
  });

  it("archivePage returns false for already archived page", () => {
    const space = mkSpace();
    const page = createPublished(space.id, "Double Arch", `double-${seq()}`);
    archivePage(page.id);
    const result = archivePage(page.id);
    expect(result).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 12. Slug lookups and template updates
// ═══════════════════════════════════════════════════════════════════════════════

describe("Slug lookups and templates", () => {
  it("getPageBySlug finds page by space and slug", () => {
    const space = mkSpace();
    const slug = `page-slug-${seq()}`;
    createPublished(space.id, "Slug Page", slug);

    const found = getPageBySlug(space.id, slug);
    expect(found).toBeDefined();
    expect(found!.slug).toBe(slug);
  });

  it("getPageBySlug returns undefined for wrong space", () => {
    const s1 = mkSpace();
    const s2 = mkSpace();
    const slug = `ps-${seq()}`;
    createPublished(s1.id, "S1 Page", slug);

    const found = getPageBySlug(s2.id, slug);
    expect(found).toBeUndefined();
  });

  it("getSpaceBySlug works", () => {
    const space = mkSpace();
    const found = getSpaceBySlug(space.slug);
    expect(found).toBeDefined();
    expect(found!.id).toBe(space.id);
  });

  it("updateTemplate modifies template", () => {
    const tmpl = createTemplate(`template-${seq()}`, "# Original", "Desc", "test");
    const updated = updateTemplate(tmpl.id, { content: "# New", description: "New desc" });
    expect(updated).toBeDefined();
    expect(updated!.content).toBe("# New");
    expect(updated!.description).toBe("New desc");
  });

  it("updateTemplate returns undefined for nonexistent", () => {
    expect(updateTemplate(99999, { content: "# Nope" })).toBeUndefined();
  });

  it("template CRUD: create, get, list, delete", () => {
    const name = `tpl-${seq()}`;
    const tmpl = createTemplate(name, "# Template content", "A test template", "general");
    expect(tmpl.name).toBe(name);
    expect(tmpl.content).toBe("# Template content");

    const found = getTemplate(tmpl.id);
    expect(found!.id).toBe(tmpl.id);

    const all = listTemplates();
    expect(all.some(t => t.name === name)).toBe(true);

    const deleted = deleteTemplate(tmpl.id);
    expect(deleted).toBe(true);
    expect(getTemplate(tmpl.id)).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 13. Favorites projection
// ═══════════════════════════════════════════════════════════════════════════════

describe("Favorites projection", () => {
  it("toggleFavorite toggles is_favorite", () => {
    const space = mkSpace();
    const page = createPublished(space.id, "Fav", `fav-${seq()}`);

    const toggled = toggleFavorite(page.id);
    expect(toggled!.is_favorite).toBe(1);

    const untoggled = toggleFavorite(page.id);
    expect(untoggled!.is_favorite).toBe(0);
  });

  it("listFavorites returns non-archived favorites only", () => {
    const space = mkSpace();
    const fav = createPublished(space.id, "Fav Page", `fav-page-${seq()}`);
    toggleFavorite(fav.id);

    const favs = listFavorites();
    expect(favs.some(f => f.id === fav.id)).toBe(true);

    // Archive it — should disappear
    archivePage(fav.id);
    const after = listFavorites();
    expect(after.some(f => f.id === fav.id)).toBe(false);
  });

  it("toggleFavorite returns undefined for nonexistent page", () => {
    expect(toggleFavorite(99999)).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 14. Tags CRUD
// ═══════════════════════════════════════════════════════════════════════════════

describe("Tags", () => {
  it("addTag creates tag and links to page", () => {
    const space = mkSpace();
    const page = createPublished(space.id, "Tag Page", `tag-${seq()}`);
    const tag = addTag(page.id, `test-tag-${seq()}`);
    expect(tag).toBeDefined();

    const tags = getPageTags(page.id);
    expect(tags.length).toBe(1);
    expect(tags[0].name).toBe(tag!.name);
  });

  it("addTag is idempotent for same tag on same page", () => {
    const space = mkSpace();
    const page = createPublished(space.id, "Dup Tag", `dup-tag-${seq()}`);
    const tagName = `dup-${seq()}`;
    addTag(page.id, tagName);
    addTag(page.id, tagName);

    const tags = getPageTags(page.id);
    expect(tags.length).toBe(1);
  });

  it("removeTag removes the link but keeps the tag", () => {
    const space = mkSpace();
    const page = createPublished(space.id, "Rem Tag", `rem-tag-${seq()}`);
    const tag = addTag(page.id, `removable-${seq()}`);
    expect(tag).toBeDefined();

    const removed = removeTag(page.id, tag!.id);
    expect(removed).toBe(true);
    expect(getPageTags(page.id).length).toBe(0);

    // Tag itself still exists in docs_tags
    const allTags = listAllTags();
    expect(allTags.some(t => t.id === tag!.id)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 15. Spaces CRUD
// ═══════════════════════════════════════════════════════════════════════════════

describe("Spaces CRUD", () => {
  it("listSpaces returns all spaces", () => {
    const before = listSpaces().length;
    mkSpace();
    const after = listSpaces().length;
    expect(after).toBe(before + 1);
  });

  it("getSpace returns space by id", () => {
    const space = mkSpace();
    const found = getSpace(space.id);
    expect(found!.name).toBe(space.name);
  });

  it("deleteSpace removes space", () => {
    const space = mkSpace();
    const result = deleteSpace(space.id);
    expect(result).toBe(true);
    expect(getSpace(space.id)).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 16. Import / Export
// ═══════════════════════════════════════════════════════════════════════════════

describe("Import / Export", () => {
  it("importPages creates multiple pages from entries", () => {
    const space = mkSpace();
    const pages = importPages(space.id, [
      { title: "Imp A", slug: `imp-a-${seq()}`, content: "# A" },
      { title: "Imp B", slug: `imp-b-${seq()}`, content: "# B" },
    ]);
    expect(pages.length).toBe(2);

    // Imported pages are still drafts
    expect(pages[0].status).toBe("draft");
    expect(pages[1].status).toBe("draft");
  });

  it("exportSpace returns full space data", () => {
    const space = mkSpace();
    const slug = `exp-${seq()}`;
    createPublished(space.id, "Export Page", slug, "# Export content");

    const exported = exportSpace(space.id);
    expect(exported).toBeDefined();
    expect(exported!.space.id).toBe(space.id);
    expect(exported!.pages.length).toBeGreaterThanOrEqual(1);
    expect(exported!.tree.length).toBeGreaterThanOrEqual(1);
  });

  it("exportSpace returns undefined for nonexistent space", () => {
    expect(exportSpace(99999)).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 17. Stats
// ═══════════════════════════════════════════════════════════════════════════════

describe("Stats", () => {
  it("getDocStats returns counts for all entities", () => {
    const stats = getDocStats();
    expect(stats.spaces).toBeGreaterThanOrEqual(0);
    expect(stats.pages).toBeGreaterThanOrEqual(0);
    expect(typeof stats.drafts).toBe("number");
    expect(typeof stats.versions).toBe("number");
    expect(typeof stats.tags).toBe("number");
    expect(typeof stats.comments).toBe("number");
    expect(typeof stats.attachments).toBe("number");
    expect(typeof stats.templates).toBe("number");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 18. Edge cases: slug conflicts, double publish, error propagation
// ═══════════════════════════════════════════════════════════════════════════════

describe("Edge cases", () => {
  it("createPage with duplicate slug in same space fails", () => {
    const space = mkSpace();
    const slug = `dup-slug-${seq()}`;
    createPublished(space.id, "First", slug);
    expect(() => {
      createPage(space.id, "Second", slug, "# Duplicate");
    }).toThrow();
  });

  it("createPage with same slug in different space succeeds", () => {
    const s1 = mkSpace();
    const s2 = mkSpace();
    const slug = `same-slug-${seq()}`;
    createPublished(s1.id, "S1 Page", slug);
    createPublished(s2.id, "S2 Page", slug);
    // Both should exist in their respective spaces
    expect(getPageBySlug(s1.id, slug)).toBeDefined();
    expect(getPageBySlug(s2.id, slug)).toBeDefined();
  });

  it("publishPage on already published page bumps revision correctly", () => {
    const space = mkSpace();
    const r = createPage(space.id, "RePub", `repub-${seq()}`, "# V0");
    publishPage(r.page!.id); // v0 -> v1

    const afterFirst = getPage(r.page!.id);
    expect(afterFirst!.revision).toBe(1);

    // Save new draft and publish
    saveDraft(r.page!.id, "# V2", "", "", 1);
    publishPage(r.page!.id, 1); // v1 -> v2

    const afterSecond = getPage(r.page!.id);
    expect(afterSecond!.revision).toBe(2);
    expect(afterSecond!.content).toBe("# V2");
  });

  it("deleteDraft returns false when draft doesn't exist", () => {
    expect(deleteDraft(99999)).toBe(false);
  });

  it("slugExists returns correct values", () => {
    const space = mkSpace();
    const slug = `slug-exists-${seq()}`;

    expect(slugExists(space.id, slug)).toBe(false);
    createPublished(space.id, "Exists", slug);
    expect(slugExists(space.id, slug)).toBe(true);
    // Exclude self
    const page = getPageBySlug(space.id, slug);
    expect(slugExists(space.id, slug, page!.id)).toBe(false);
  });
});
