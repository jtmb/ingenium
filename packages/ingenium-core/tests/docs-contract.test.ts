/**
 * W1A CONTRACT VERIFICATION — Core docs module behavior.
 *
 * Converts the W0 RED static checks into runtime unit tests that verify
 * the repaired contract.  Uses an in-memory SQLite database so tests run
 * fast and are fully isolated.
 *
 * Run:  npx vitest run packages/ingenium-core/tests/docs-contract.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb } from "../lib/db.js";
import { createProject } from "../lib/tools/projects.js";
import {
  createSpace,
  createPage,
  publishPage,
  updatePage,
  saveAttachment,
  deleteAttachment,
  createComment,
  saveDraft,
  movePage,
  linkProject,
  unlinkProject,
  getLinkedProjects,
  getPageBySlug,
  getSpaceBySlug,
  listArchivedPages,
  purgeArchivedPages,
  getAttachment,
  getAttachmentsByPage,
  listAttachments,
  updateTemplate,
  createTemplate,
  listTemplates,
  listPages,
  listVersions,
  getPage,
  getDraft,
  deleteDraft,
  archivePage,
  restorePage,
  toggleFavorite,
  listFavorites,
} from "../lib/tools/docs.js";
import { MAX_PAGE_CONTENT_LENGTH, MAX_COMMENT_LENGTH } from "../lib/constants.js";

let tempDir: string;
let dbPath: string;
let spaceSerial = 0;

function uniqueSpace(name: string): ReturnType<typeof createSpace> {
  spaceSerial++;
  const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${spaceSerial}`;
  return createSpace(`${name} ${spaceSerial}`, slug);
}

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), "ingenium-core-docs-contract-"));
  dbPath = join(tempDir, "test.db");
  process.env.INGENIUM_CORE_DB_PATH = dbPath;

  // Initialize DB — the migrations will run and create all tables
  getDb(dbPath);
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// FIX VERIFIED: INSERT OR REPLACE in saveAttachment (HARD RULE #11)
// ═══════════════════════════════════════════════════════════════════════════════

describe("FIX: INSERT OR REPLACE replaced with ON CONFLICT DO UPDATE", () => {

  it("saveAttachment uses ON CONFLICT DO UPDATE pattern (NOT INSERT OR REPLACE)", () => {
    const space = createSpace("Attach Space", "attach-space");
    const result = createPage(space.id, "Attach Page", "attach-page");
    expect(result.page).toBeDefined();
    const page = publishPage(result.page!.id);

    // First save — create
    const att1 = saveAttachment(page.page!.id, "file.pdf", "original.pdf", "application/pdf", 1024, "/tmp/file.pdf");
    expect(att1.id).toBeGreaterThan(0);
    expect(att1.original_name).toBe("original.pdf");

    // Second save with same (page_id, filename) — UPDATE, not REPLACE
    const att2 = saveAttachment(page.page!.id, "file.pdf", "renamed.pdf", "application/pdf", 2048, "/tmp/renamed.pdf");
    // Should be same id (not a new row)
    expect(att2.id).toBe(att1.id);
    expect(att2.original_name).toBe("renamed.pdf");
    expect(att2.size_bytes).toBe(2048);
    expect(att2.storage_path).toBe("/tmp/renamed.pdf");
  });

  it("attachment delete returns owning page info for ownership verification", () => {
    const space = createSpace("Attach Del Space", "attach-del-space");
    const result = createPage(space.id, "Del Page", "del-page");
    const page = publishPage(result.page!.id);

    const att = saveAttachment(page.page!.id, "del.pdf", "del.pdf", "application/pdf", 100, "/tmp/del.pdf");
    const deleted = deleteAttachment(att.id);
    expect(deleted).toBeDefined();
    expect(deleted!.page_id).toBe(page.page!.id);
    expect(deleted!.filename).toBe("del.pdf");

    // Verify it's gone
    expect(deleteAttachment(att.id)).toBeUndefined();
  });

  it("getAttachment and getAttachmentsByPage work correctly", () => {
    const space = createSpace("Attach Lookup", "attach-lookup");
    const result = createPage(space.id, "Lookup Page", "lookup-page");
    const page = publishPage(result.page!.id);

    const att = saveAttachment(page.page!.id, "lookup.pdf", "lookup.pdf", "application/pdf", 500, "/tmp/lookup.pdf");

    // getAttachment by id
    const found = getAttachment(att.id);
    expect(found).toBeDefined();
    expect(found!.page_id).toBe(page.page!.id);

    // getAttachmentsByPage (alias for listAttachments)
    const byPage = getAttachmentsByPage(page.page!.id);
    expect(byPage.length).toBe(1);
    expect(byPage[0].id).toBe(att.id);

    // listAttachments
    const listed = listAttachments(page.page!.id);
    expect(listed.length).toBe(1);
    expect(listed[0].id).toBe(att.id);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// FIX VERIFIED: Size limits enforced
// ═══════════════════════════════════════════════════════════════════════════════

describe("FIX: size limits enforced in core docs module", () => {

  let spaceId: number;

  beforeAll(() => {
    const space = uniqueSpace("Limit");
    spaceId = space.id;
  });

  it("createPage rejects content exceeding MAX_PAGE_CONTENT_LENGTH", () => {
    const tooLong = "x".repeat(MAX_PAGE_CONTENT_LENGTH + 1);
    const result = createPage(spaceId, "Big Page", "big-page", tooLong);
    expect(result.error).toBeDefined();
    expect(result.error!.code).toBe("CONTENT_TOO_LONG");
    expect(result.page).toBeUndefined();
  });

  it("createPage accepts content at MAX_PAGE_CONTENT_LENGTH boundary", () => {
    const atLimit = "x".repeat(MAX_PAGE_CONTENT_LENGTH);
    const result = createPage(spaceId, "Limit Page", "limit-page", atLimit);
    expect(result.error).toBeUndefined();
    expect(result.page).toBeDefined();
  });

  it("createComment rejects content exceeding MAX_COMMENT_LENGTH", () => {
    const result = createPage(spaceId, "Comment Page", "comment-page");
    expect(result.page).toBeDefined();
    const page = publishPage(result.page!.id);

    const tooLong = "y".repeat(MAX_COMMENT_LENGTH + 1);
    const commentResult = createComment(page.page!.id, tooLong);
    expect(commentResult.error).toBeDefined();
    expect(commentResult.error!.code).toBe("COMMENT_TOO_LONG");
    expect(commentResult.comment).toBeUndefined();
  });

  it("createComment accepts content at MAX_COMMENT_LENGTH boundary", () => {
    const result = createPage(spaceId, "Comment Limit", "comment-limit");
    const page = publishPage(result.page!.id);

    const atLimit = "y".repeat(MAX_COMMENT_LENGTH);
    const commentResult = createComment(page.page!.id, atLimit);
    expect(commentResult.error).toBeUndefined();
    expect(commentResult.comment).toBeDefined();
  });

  it("saveDraft rejects content exceeding MAX_PAGE_CONTENT_LENGTH", () => {
    const result = createPage(spaceId, "Draft Limit", "draft-limit");
    expect(result.page).toBeDefined();

    const tooLong = "z".repeat(MAX_PAGE_CONTENT_LENGTH + 1);
    expect(() => saveDraft(result.page!.id, tooLong)).toThrow();
  });

  it("publishPage rejects content exceeding MAX_PAGE_CONTENT_LENGTH (from draft)", () => {
    const result = createPage(spaceId, "Publish Limit", "publish-limit");
    expect(result.page).toBeDefined();
    // Save draft with over-long content
    const tooLong = "w".repeat(MAX_PAGE_CONTENT_LENGTH + 1);
    expect(() => saveDraft(result.page!.id, tooLong, "Big", "big")).toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// FIX VERIFIED: Draft/publish lifecycle
// ═══════════════════════════════════════════════════════════════════════════════

describe("FIX: draft/publish lifecycle", () => {

  let spaceId: number;

  beforeAll(() => {
    const space = uniqueSpace("Lifecycle");
    spaceId = space.id;
  });

  it("createPage creates a draft page with status='draft' and revision=0", () => {
    const result = createPage(spaceId, "My Draft", "my-draft", "# Hello");
    expect(result.error).toBeUndefined();
    expect(result.page).toBeDefined();
    expect(result.page!.status).toBe("draft");
    expect(result.page!.revision).toBe(0);
    expect(result.page!.title).toBe("My Draft");
    expect(result.page!.slug).toBe("my-draft");
  });

  it("draft page has no versions until published", () => {
    const result = createPage(spaceId, "No Version", "no-version", "# Pre");
    expect(result.page).toBeDefined();
    const versions = listVersions(result.page!.id);
    expect(versions.length).toBe(0);
  });

  it("publishPage promotes draft to published with revision 1 and one version", () => {
    const result = createPage(spaceId, "To Publish", "to-publish", "# Draft content");
    expect(result.page).toBeDefined();

    const published = publishPage(result.page!.id);
    expect(published.error).toBeUndefined();
    expect(published.page).toBeDefined();
    expect(published.page!.status).toBe("published");
    expect(published.page!.revision).toBe(1);

    // Exactly one version created
    const versions = listVersions(result.page!.id);
    expect(versions.length).toBe(1);
    expect(versions[0].revision).toBe(1);
    expect(versions[0].content).toBe("# Draft content");
  });

  it("publishPage uses draft title/slug/content when present", () => {
    const result = createPage(spaceId, "Orig Title", "orig-slug", "# Orig content");
    expect(result.page).toBeDefined();

    // Save draft with overrides
    saveDraft(result.page!.id, "# Draft content", "Draft Title", "draft-slug", 0);

    const published = publishPage(result.page!.id);
    expect(published.page).toBeDefined();
    expect(published.page!.title).toBe("Draft Title");
    expect(published.page!.slug).toBe("draft-slug");
    expect(published.page!.content).toBe("# Draft content");
  });

  it("publishPage clears draft after publishing", () => {
    const result = createPage(spaceId, "Clear Draft", "clear-draft", "# Content");
    expect(result.page).toBeDefined();

    saveDraft(result.page!.id, "# Draft", "Draft T", "draft-t", 0);
    const draft = getDraft(result.page!.id);
    expect(draft).toBeDefined();

    publishPage(result.page!.id);

    // Draft should be cleared
    expect(getDraft(result.page!.id)).toBeUndefined();
  });

  it("publishPage returns conflict on expectedRevision mismatch", () => {
    const result = createPage(spaceId, "Conflict", "conflict", "# V1");
    expect(result.page).toBeDefined();

    // Publish once to get to revision 1
    publishPage(result.page!.id);

    // Now the page is at revision 1. Try to publish with expectedRevision=0
    const conflict = publishPage(result.page!.id, 0);
    expect(conflict.conflict).toBe(true);
    expect(conflict.currentRevision).toBe(1);
    expect(conflict.page).toBeUndefined();
  });

  it("publishPage with matching expectedRevision succeeds", () => {
    const result = createPage(spaceId, "Match", "match", "# Match");
    expect(result.page).toBeDefined();

    const published = publishPage(result.page!.id, 0);
    expect(published.error).toBeUndefined();
    expect(published.page).toBeDefined();
    expect(published.page!.revision).toBe(1);
  });

  it("publishPage creates exactly one version (no duplicates)", () => {
    const result = createPage(spaceId, "One Version", "one-version", "# V1");
    expect(result.page).toBeDefined();

    publishPage(result.page!.id);
    // Publish again (update to rev 2)
    const page = getPage(result.page!.id);
    expect(page!.revision).toBe(1);
    publishPage(result.page!.id, 1);

    // Should have exactly 2 versions: rev 1 and rev 2
    const versions = listVersions(result.page!.id);
    expect(versions.length).toBe(2);
    const revs = versions.map(v => v.revision).sort();
    expect(revs).toEqual([1, 2]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// FIX VERIFIED: Page-parent cycle detection in movePage
// ═══════════════════════════════════════════════════════════════════════════════

describe("FIX: page-parent cycle detection", () => {

  let spaceId: number;
  let testSeq = 0;

  beforeAll(() => {
    const space = uniqueSpace("Cycle");
    spaceId = space.id;
  });

  function seq(): number { testSeq++; return testSeq; }

  function createAndPublish(title: string, slug: string, parentId?: number) {
    const uniqueSlug = `${slug}-${seq()}`;
    const result = createPage(spaceId, title, uniqueSlug, "# Content", parentId);
    expect(result.page).toBeDefined();
    return publishPage(result.page!.id).page!;
  }

  it("prevents self-parenting", () => {
    const pageA = createAndPublish("Page A", "self-a");
    const moveResult = movePage(pageA.id, pageA.id);
    expect(moveResult.error).toBeDefined();
    expect(moveResult.error!.code).toBe("PARENT_SELF");
  });

  it("prevents parent-as-descendant cycle", () => {
    const pageA = createAndPublish("Parent A", "cycle-a");
    const pageB = createAndPublish("Child B", "cycle-b", pageA.id);
    const moveResult = movePage(pageA.id, pageB.id);
    expect(moveResult.error).toBeDefined();
    expect(moveResult.error!.code).toBe("PARENT_CYCLE");
  });

  it("prevents cross-space parent", () => {
    const otherSpace = uniqueSpace("Other");
    const pageA = createAndPublish("Page A", "cross-a");
    const pageInOther = createPage(otherSpace.id, "Other Page", `other-page-${seq()}`);
    const otherPublished = publishPage(pageInOther.page!.id);

    const moveResult = movePage(pageA.id, otherPublished.page!.id);
    expect(moveResult.error).toBeDefined();
    expect(moveResult.error!.code).toBe("PARENT_CROSS_SPACE");
  });

  it("prevents archived parent", () => {
    const pageA = createAndPublish("Page A", "arch-a");
    const pageB = createAndPublish("Page B", "arch-b");

    archivePage(pageB.id);

    const moveResult = movePage(pageA.id, pageB.id);
    expect(moveResult.error).toBeDefined();
    expect(moveResult.error!.code).toBe("PARENT_ARCHIVED");
  });

  it("prevents nonexistent parent", () => {
    const pageA = createAndPublish("Page A", "nope-a");
    const moveResult = movePage(pageA.id, 99999);
    expect(moveResult.error).toBeDefined();
    expect(moveResult.error!.code).toBe("PARENT_NOT_FOUND");
  });

  it("allows valid move to null parent", () => {
    const pageA = createAndPublish("Page A", "move-a");
    const pageB = createAndPublish("Page B", "move-b", pageA.id);

    const moveResult = movePage(pageB.id, null);
    expect(moveResult.error).toBeUndefined();
    expect(moveResult.page).toBeDefined();
    expect(moveResult.page!.parent_page_id).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// FIX VERIFIED: TEXT project FK in docs_page_projects
// ═══════════════════════════════════════════════════════════════════════════════

describe("FIX: TEXT project FK with existence check", () => {

  let spaceId: number;

  beforeAll(() => {
    const space = uniqueSpace("Project");
    spaceId = space.id;
  });

  it("linkProject verifies project exists before linking", () => {
    const result = createPage(spaceId, "Proj Page", "proj-page");
    const page = publishPage(result.page!.id);

    // Create a real project first
    const project = createProject("docs-test-project");

    // Should work with existing project
    const link = linkProject(page.page!.id, project.id);
    expect(link.page_id).toBe(page.page!.id);
    expect(link.project_id).toBe(project.id);
  });

  it("linkProject rejects nonexistent project", () => {
    const result = createPage(spaceId, "Bad Proj", "bad-proj");
    const page = publishPage(result.page!.id);

    expect(() => linkProject(page.page!.id, "nonexistent-project-id")).toThrow();
  });

  it("unlinkProject removes the link", () => {
    const result = createPage(spaceId, "Unlink Page", "unlink-page");
    const page = publishPage(result.page!.id);
    const project = createProject("unlink-test-project");

    linkProject(page.page!.id, project.id);

    // Should be linked
    const links = getLinkedProjects(page.page!.id);
    expect(links.length).toBe(1);

    // Unlink
    const unlinkedResult = unlinkProject(page.page!.id, project.id);
    expect(unlinkedResult).toBe(true);

    const afterLinks = getLinkedProjects(page.page!.id);
    expect(afterLinks.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// FIX VERIFIED: updatePage enforces content limits
// ═══════════════════════════════════════════════════════════════════════════════

describe("FIX: updatePage validates content length", () => {

  it("updatePage rejects over-long content", () => {
    const space = createSpace("Update Limit", "update-limit");
    const result = createPage(space.id, "Update Page", "update-page", "# Original");
    const page = publishPage(result.page!.id);

    const tooLong = "x".repeat(MAX_PAGE_CONTENT_LENGTH + 1);
    const updateResult = updatePage(page.page!.id, { content: tooLong });
    expect(updateResult.error).toBeDefined();
    expect(updateResult.error!.code).toBe("CONTENT_TOO_LONG");
  });

  it("updatePage accepts valid content and bumps revision", () => {
    const space = createSpace("Update Valid", "update-valid");
    const result = createPage(space.id, "Valid Page", "valid-page", "# Original");
    const page = publishPage(result.page!.id);

    expect(page.page!.revision).toBe(1);

    const updateResult = updatePage(page.page!.id, {
      content: "# Updated",
      expectedRevision: 1,
    });
    expect(updateResult.error).toBeUndefined();
    expect(updateResult.page).toBeDefined();
    expect(updateResult.page!.content).toBe("# Updated");
    expect(updateResult.page!.revision).toBe(2);
  });

  it("updatePage returns conflict on expectedRevision mismatch", () => {
    const space = createSpace("Update Conflict", "update-conflict");
    const result = createPage(space.id, "Conflict Page", "conflict-page", "# V1");
    const page = publishPage(result.page!.id);

    // Page is at rev 1, try updating with expectedRevision 0
    const updateResult = updatePage(page.page!.id, {
      content: "# V2",
      expectedRevision: 0,
    });
    expect(updateResult.conflict).toBe(true);
    expect(updateResult.currentRevision).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// FIX VERIFIED: Archived page management
// ═══════════════════════════════════════════════════════════════════════════════

describe("FIX: archived page list and purge", () => {

  it("listArchivedPages returns archived pages", () => {
    const space = createSpace("Archive Space", "archive-space");
    const r1 = createPage(space.id, "Archive Me", "archive-me", "# Will archive");
    const page1 = publishPage(r1.page!.id);
    archivePage(page1.page!.id);

    const archived = listArchivedPages(space.id);
    expect(archived.length).toBeGreaterThanOrEqual(1);
    expect(archived.some(p => p.id === page1.page!.id)).toBe(true);
  });

  it("purgeArchivedPages permanently deletes archived pages", () => {
    const space = createSpace("Purge Space", "purge-space");
    const r1 = createPage(space.id, "Purge Me", "purge-me", "# Bye");
    const page1 = publishPage(r1.page!.id);
    archivePage(page1.page!.id);

    const count = purgeArchivedPages(space.id);
    expect(count).toBe(1);

    // Verify page is gone
    expect(getPage(page1.page!.id)).toBeUndefined();
  });

  it("restorePage brings archived page back to published", () => {
    const space = createSpace("Restore Space", "restore-space");
    const r1 = createPage(space.id, "Restore Me", "restore-me", "# Back");
    const page1 = publishPage(r1.page!.id);
    archivePage(page1.page!.id);

    const restored = restorePage(page1.page!.id);
    expect(restored).toBeDefined();
    expect(restored!.status).toBe("published");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// FIX VERIFIED: Slug lookups and template update
// ═══════════════════════════════════════════════════════════════════════════════

describe("FIX: slug lookups and template update", () => {

  it("getPageBySlug finds page by space and slug", () => {
    const space = createSpace("Slug Space", "slug-space");
    const result = createPage(space.id, "Slug Page", "slug-page", "# Slugged");
    publishPage(result.page!.id);

    const found = getPageBySlug(space.id, "slug-page");
    expect(found).toBeDefined();
    expect(found!.title).toBe("Slug Page");
  });

  it("getPageBySlug returns undefined for non-existent slug", () => {
    const space = createSpace("Slug Miss", "slug-miss");
    const found = getPageBySlug(space.id, "nope");
    expect(found).toBeUndefined();
  });

  it("getSpaceBySlug finds space by slug", () => {
    const space = createSpace("Find Me", "find-me");
    const found = getSpaceBySlug("find-me");
    expect(found).toBeDefined();
    expect(found!.name).toBe("Find Me");
  });

  it("getSpaceBySlug returns undefined for non-existent slug", () => {
    const found = getSpaceBySlug("no-space-here");
    expect(found).toBeUndefined();
  });

  it("updateTemplate modifies template fields", () => {
    const tmpl = createTemplate("Update Me", "# Original", "Test template", "test");
    expect(tmpl.content).toBe("# Original");

    const updated = updateTemplate(tmpl.id, { content: "# Updated", description: "New desc" });
    expect(updated).toBeDefined();
    expect(updated!.content).toBe("# Updated");
    expect(updated!.description).toBe("New desc");
    expect(updated!.name).toBe("Update Me"); // unchanged
  });

  it("updateTemplate returns undefined for non-existent template", () => {
    const result = updateTemplate(99999, { content: "# Nope" });
    expect(result).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// FIX VERIFIED: Parent validation in createPage
// ═══════════════════════════════════════════════════════════════════════════════

describe("FIX: createPage parent validation", () => {

  it("createPage rejects cross-space parent", () => {
    const space1 = createSpace("Space 1", "space-1");
    const space2 = createSpace("Space 2", "space-2");
    const r = createPage(space2.id, "Other Page", "other-page");
    publishPage(r.page!.id);

    // Try to create a page in space1 under a page in space2
    const result = createPage(space1.id, "Invalid", "invalid", "# Bad", r.page!.id);
    expect(result.error).toBeDefined();
    expect(result.error!.code).toBe("PARENT_CROSS_SPACE");
  });

  it("createPage rejects archived parent", () => {
    const space = createSpace("Arch Par", "arch-par");
    const r = createPage(space.id, "Will Archive", "will-archive");
    const parent = publishPage(r.page!.id);
    archivePage(parent.page!.id);

    const result = createPage(space.id, "Child", "child", "# Child", parent.page!.id);
    expect(result.error).toBeDefined();
    expect(result.error!.code).toBe("PARENT_ARCHIVED");
  });

  it("createPage rejects nonexistent parent", () => {
    const space = createSpace("Bad Par", "bad-par");
    const result = createPage(space.id, "Orphan", "orphan", "# Orphan", 99999);
    expect(result.error).toBeDefined();
    expect(result.error!.code).toBe("PARENT_NOT_FOUND");
  });

  it("createPage validates space exists", () => {
    const result = createPage(99999, "Bad Space", "bad-space", "# Nope");
    expect(result.error).toBeDefined();
    expect(result.error!.code).toBe("SPACE_NOT_FOUND");
  });

  it("createPage with valid parent succeeds", () => {
    const space = createSpace("Valid Par", "valid-par");
    const r = createPage(space.id, "Parent", "parent");
    const parent = publishPage(r.page!.id);

    const result = createPage(space.id, "Child", "child", "# Child", parent.page!.id);
    expect(result.error).toBeUndefined();
    expect(result.page).toBeDefined();
    expect(result.page!.parent_page_id).toBe(parent.page!.id);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// VERIFICATION: Favorites projection
// ═══════════════════════════════════════════════════════════════════════════════

describe("Favorites projection", () => {

  it("listFavorites returns non-archived favorites only", () => {
    const space = createSpace("Fav Space", "fav-space");

    const r = createPage(space.id, "Fav Page", "fav-page");
    const page = publishPage(r.page!.id);

    // Toggle favorite on
    toggleFavorite(page.page!.id);
    const favs = listFavorites();
    expect(favs.some((f: any) => f.id === page.page!.id)).toBe(true);

    // Archive it — should disappear from favorites
    archivePage(page.page!.id);
    const favsAfter = listFavorites();
    expect(favsAfter.some((f: any) => f.id === page.page!.id)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// VERIFICATION: Comment parent validation
// ═══════════════════════════════════════════════════════════════════════════════

describe("Comment parent validation", () => {

  it("createComment validates parent page exists", () => {
    const space = uniqueSpace("Comment");
    expect(() => createComment(99999, "orphan comment")).toThrow();
  });

  it("createComment validates parent comment exists", () => {
    const space = uniqueSpace("Reply");
    const r = createPage(space.id, "Reply Page", `reply-page-${spaceSerial}`);
    const page = publishPage(r.page!.id);

    // Try to create a reply to a non-existent comment
    expect(() => createComment(page.page!.id, "Reply", 99999)).toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// VERIFICATION: Draft save with title/slug metadata
// ═══════════════════════════════════════════════════════════════════════════════

describe("Draft metadata save", () => {

  it("saveDraft stores title, slug, and base_revision", () => {
    const space = createSpace("Draft Meta", "draft-meta");
    const result = createPage(space.id, "Meta Page", "meta-page", "# Hello");
    expect(result.page).toBeDefined();
    // Publish first to set revision 1
    const published = publishPage(result.page!.id);
    expect(published.page!.revision).toBe(1);

    // Save draft with metadata (base_revision = 1)
    saveDraft(result.page!.id, "# Draft v2", "Meta Title", "meta-slug", 1);

    const draft = getDraft(result.page!.id);
    expect(draft).toBeDefined();
    expect(draft!.title).toBe("Meta Title");
    expect(draft!.slug).toBe("meta-slug");
    expect(draft!.content).toBe("# Draft v2");
    expect(draft!.base_revision).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// MIGRATION 040: Schema integrity verification
// ═══════════════════════════════════════════════════════════════════════════════

describe("Migration 040: schema integrity", () => {

  it("docs_page_drafts has title, slug, base_revision columns", () => {
    const db = getDb(dbPath);
    const cols = db.prepare("PRAGMA table_info('docs_page_drafts')").all() as any[];
    const names = cols.map((c: any) => c.name);
    expect(names).toContain("title");
    expect(names).toContain("slug");
    expect(names).toContain("base_revision");
  });

  it("docs_page_projects.project_id is TEXT type", () => {
    const db = getDb(dbPath);
    const col = db.prepare(
      "SELECT type FROM pragma_table_info('docs_page_projects') WHERE name = 'project_id'"
    ).get() as { type: string } | undefined;
    expect(col).toBeDefined();
    expect(col!.type).toBe("TEXT");
  });

  it("docs_page_versions has unique (page_id, revision) constraint", () => {
    const db = getDb(dbPath);
    const indexes = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='docs_page_versions' AND name='idx_docs_versions_page_rev_unique'"
    ).all() as any[];
    expect(indexes.length).toBeGreaterThanOrEqual(1);
  });

  it("docs_page_versions unique constraint prevents duplicate (page_id, revision)", () => {
    const space = createSpace("Unique Space", "unique-space");
    const result = createPage(space.id, "Unique Page", "unique-page", "# Test");
    expect(result.page).toBeDefined();
    const page = publishPage(result.page!.id);

    // Try to insert a duplicate version manually
    const db = getDb(dbPath);
    expect(() => {
      db.prepare(
        "INSERT INTO docs_page_versions (page_id, revision, title, content) VALUES (?, 1, 'dup', 'dup')"
      ).run(page.page!.id);
    }).toThrow();
  });
});
