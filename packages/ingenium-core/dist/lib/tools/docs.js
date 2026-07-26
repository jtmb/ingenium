import { getDb, execTransaction, checkpointAfterWrite, sanitizeFts5Query } from "../db.js";
import { MAX_PAGE_CONTENT_LENGTH, MAX_COMMENT_LENGTH } from "../constants.js";
import { indexPublishedDoc } from "./rag.js";
// ── Helpers ───────────────────────────────────────────────────────────────────
function dbPath() {
    return process.env.INGENIUM_CORE_DB_PATH || "./.ingenium/data.db";
}
function nowISO() {
    return new Date().toISOString();
}
function makeError(code, message) {
    return { code, message };
}
// ── Backlink Parsing ─────────────────────────────────────────────────────────
const WIKILINK_RE = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
/** Extract unique target slugs from wikilinks in content. */
function extractWikilinkSlugs(content) {
    const slugs = new Set();
    let m;
    while ((m = WIKILINK_RE.exec(content)) !== null) {
        slugs.add(m[1].trim());
    }
    return [...slugs];
}
/** Rebuild backlinks for a given page by parsing its content for [[slug]] refs. */
function rebuildBacklinks(db, pageId, content) {
    // Remove existing outgoing links for this page
    db.prepare("DELETE FROM docs_page_links WHERE source_page_id = ?").run(pageId);
    const page = db.prepare("SELECT space_id FROM docs_pages WHERE id = ?").get(pageId);
    if (!page)
        return;
    const slugs = extractWikilinkSlugs(content);
    if (slugs.length === 0)
        return;
    const placeholders = slugs.map(() => "?").join(",");
    const targetPages = db.prepare(`SELECT id, slug FROM docs_pages WHERE space_id = ? AND slug IN (${placeholders})`).all(page.space_id, ...slugs);
    const slugMap = new Map();
    for (const tp of targetPages) {
        slugMap.set(tp.slug, tp.id);
    }
    const insertLink = db.prepare("INSERT OR IGNORE INTO docs_page_links (source_page_id, target_page_id, link_text) VALUES (?, ?, ?)");
    for (const slug of slugs) {
        const targetId = slugMap.get(slug);
        if (targetId && targetId !== pageId) {
            insertLink.run(pageId, targetId, slug);
        }
    }
}
// ── Defensive Parent Checks ───────────────────────────────────────────────────
/**
 * Verify a parent page exists and belongs to the given space.
 * Returns an error if the parent is invalid.
 */
function validateParentPage(db, spaceId, parentPageId) {
    if (parentPageId == null)
        return null;
    const parent = db.prepare("SELECT id, space_id, status FROM docs_pages WHERE id = ?").get(parentPageId);
    if (!parent) {
        return makeError("PARENT_NOT_FOUND", `Parent page ${parentPageId} does not exist`);
    }
    if (parent.space_id !== spaceId) {
        return makeError("PARENT_CROSS_SPACE", `Parent page ${parentPageId} belongs to a different space`);
    }
    if (parent.status === "archived") {
        return makeError("PARENT_ARCHIVED", `Parent page ${parentPageId} is archived`);
    }
    return null;
}
/**
 * Detect whether moving `pageId` under `newParentId` would create a cycle.
 * Walks up the parent chain from newParentId to check if it ever reaches pageId.
 */
function wouldCreateCycle(db, pageId, newParentId) {
    if (newParentId === pageId)
        return true;
    const visited = new Set();
    let current = newParentId;
    const stmt = db.prepare("SELECT parent_page_id FROM docs_pages WHERE id = ?");
    while (current !== null) {
        if (current === pageId)
            return true;
        if (visited.has(current))
            return true; // safety: broken chain
        visited.add(current);
        const row = stmt.get(current);
        if (!row)
            break;
        current = row.parent_page_id;
    }
    return false;
}
/**
 * Defensive parent-existence check before inserting a child row.
 * Throws if the parent page does not exist (prevents FK corruption).
 */
function defendChildPage(db, pageId) {
    const row = db.prepare("SELECT 1 FROM docs_pages WHERE id = ?").get(pageId);
    if (!row) {
        throw makeError("PAGE_NOT_FOUND", `Page ${pageId} does not exist`);
    }
}
/**
 * Defensive parent-existence check for comments.
 */
function defendChildComment(db, commentId) {
    const row = db.prepare("SELECT 1 FROM docs_comments WHERE id = ?").get(commentId);
    if (!row) {
        throw makeError("COMMENT_NOT_FOUND", `Comment ${commentId} does not exist`);
    }
}
// ── Spaces ───────────────────────────────────────────────────────────────────
export function listSpaces() {
    const db = getDb(dbPath());
    return db.prepare("SELECT * FROM docs_spaces ORDER BY sort_order, name").all();
}
export function getSpace(id) {
    const db = getDb(dbPath());
    return db.prepare("SELECT * FROM docs_spaces WHERE id = ?").get(id);
}
export function getSpaceBySlug(slug) {
    const db = getDb(dbPath());
    return db.prepare("SELECT * FROM docs_spaces WHERE slug = ?").get(slug);
}
export function createSpace(name, slug, description, icon) {
    const space = execTransaction(() => {
        const db = getDb(dbPath());
        const now = nowISO();
        db.prepare(`INSERT INTO docs_spaces (name, slug, description, icon, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`).run(name, slug, description || "", icon || "folder", now, now);
        return db.prepare("SELECT * FROM docs_spaces WHERE slug = ?").get(slug);
    });
    checkpointAfterWrite();
    return space;
}
export function updateSpace(id, fields) {
    const result = execTransaction(() => {
        const db = getDb(dbPath());
        const existing = db.prepare("SELECT * FROM docs_spaces WHERE id = ?").get(id);
        if (!existing)
            return undefined;
        const now = nowISO();
        db.prepare(`UPDATE docs_spaces SET name = ?, slug = ?, description = ?, icon = ?, sort_order = ?, updated_at = ?
       WHERE id = ?`).run(fields.name ?? existing.name, fields.slug ?? existing.slug, fields.description ?? existing.description, fields.icon ?? existing.icon, fields.sort_order ?? existing.sort_order, now, id);
        return db.prepare("SELECT * FROM docs_spaces WHERE id = ?").get(id);
    });
    checkpointAfterWrite();
    return result;
}
export function deleteSpace(id) {
    const result = execTransaction(() => {
        const db = getDb(dbPath());
        return db.prepare("DELETE FROM docs_spaces WHERE id = ?").run(id).changes > 0;
    });
    checkpointAfterWrite();
    return result;
}
// ── Pages ────────────────────────────────────────────────────────────────────
export function listPages(spaceId, status) {
    const db = getDb(dbPath());
    if (status) {
        return db.prepare("SELECT * FROM docs_pages WHERE space_id = ? AND status = ? ORDER BY sort_order, title").all(spaceId, status);
    }
    return db.prepare("SELECT * FROM docs_pages WHERE space_id = ? ORDER BY sort_order, title").all(spaceId);
}
/** List archived pages (for admin review before purge). */
export function listArchivedPages(spaceId) {
    const db = getDb(dbPath());
    return db.prepare("SELECT * FROM docs_pages WHERE space_id = ? AND status = 'archived' ORDER BY updated_at DESC").all(spaceId);
}
/**
 * Permanently delete all archived pages in a space.
 * Returns the count of deleted pages.
 *
 * WARNING: This is a hard delete — versions, comments, and attachments for
 *          these pages are orphaned. Call `exportSpace` first for a backup.
 */
export function purgeArchivedPages(spaceId) {
    const db = getDb(dbPath());
    const result = execTransaction(() => {
        return db.prepare("DELETE FROM docs_pages WHERE space_id = ? AND status = 'archived'").run(spaceId).changes;
    });
    checkpointAfterWrite();
    return result;
}
export function getPageTree(spaceId) {
    const db = getDb(dbPath());
    const pages = db.prepare("SELECT * FROM docs_pages WHERE space_id = ? AND status != 'archived' ORDER BY sort_order, title").all(spaceId);
    const pageMap = new Map();
    const roots = [];
    for (const p of pages) {
        pageMap.set(p.id, { ...p, children: [] });
    }
    for (const p of pages) {
        const node = pageMap.get(p.id);
        if (p.parent_page_id && pageMap.has(p.parent_page_id)) {
            pageMap.get(p.parent_page_id).children.push(node);
        }
        else {
            roots.push(node);
        }
    }
    return roots;
}
export function getPage(id) {
    const db = getDb(dbPath());
    return db.prepare("SELECT * FROM docs_pages WHERE id = ?").get(id);
}
export function getPageBySlug(spaceId, slug) {
    const db = getDb(dbPath());
    return db.prepare("SELECT * FROM docs_pages WHERE space_id = ? AND slug = ?").get(spaceId, slug);
}
/** Check if a slug is already taken in a space. Optionally exclude a page ID for rename validation. */
export function slugExists(spaceId, slug, excludePageId) {
    const db = getDb(dbPath());
    if (excludePageId) {
        const row = db.prepare("SELECT 1 FROM docs_pages WHERE space_id = ? AND slug = ? AND id != ?").get(spaceId, slug, excludePageId);
        return !!row;
    }
    const row = db.prepare("SELECT 1 FROM docs_pages WHERE space_id = ? AND slug = ?").get(spaceId, slug);
    return !!row;
}
// ── Create Page (draft lifecycle) ────────────────────────────────────────────
/**
 * Create a new page in draft state (revision 0).
 *
 * - Validates space exists
 * - Validates parent belongs to same space and is not archived
 * - Enforces MAX_PAGE_CONTENT_LENGTH on initial content
 * - Does NOT create a version (only publishPage creates versions)
 */
export function createPage(spaceId, title, slug, content, parentPageId) {
    const safeContent = content || "";
    // Validate content length
    if (safeContent.length > MAX_PAGE_CONTENT_LENGTH) {
        return { error: makeError("CONTENT_TOO_LONG", `Content exceeds maximum length of ${MAX_PAGE_CONTENT_LENGTH} bytes`) };
    }
    const result = execTransaction(() => {
        const db = getDb(dbPath());
        // Validate space exists
        const space = db.prepare("SELECT id FROM docs_spaces WHERE id = ?").get(spaceId);
        if (!space) {
            return { error: makeError("SPACE_NOT_FOUND", `Space ${spaceId} does not exist`) };
        }
        // Validate parent if provided
        if (parentPageId != null) {
            const parentErr = validateParentPage(db, spaceId, parentPageId);
            if (parentErr)
                return { error: parentErr };
        }
        const now = nowISO();
        const result = db.prepare(`INSERT INTO docs_pages (space_id, parent_page_id, title, slug, content, revision, status, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, 'draft', 0, ?, ?)`).run(spaceId, parentPageId || null, title, slug, safeContent, now, now);
        const pageId = result.lastInsertRowid;
        return {
            page: db.prepare("SELECT * FROM docs_pages WHERE id = ?").get(pageId),
        };
    });
    checkpointAfterWrite();
    return (result ?? { error: makeError("PAGE_NOT_FOUND", "Failed to create page") });
}
// ── Publish Page ─────────────────────────────────────────────────────────────
/**
 * Publish a draft page: atomically validate revision, apply draft metadata,
 * bump revision once, create exactly one version, rebuild backlinks, clear draft.
 *
 * If expectedRevision is provided and the page's current revision doesn't match,
 * returns conflict details instead of overwriting.
 */
export function publishPage(pageId, expectedRevision) {
    const result = execTransaction(() => {
        const db = getDb(dbPath());
        const existing = db.prepare("SELECT * FROM docs_pages WHERE id = ?").get(pageId);
        if (!existing) {
            return { error: makeError("PAGE_NOT_FOUND", `Page ${pageId} does not exist`) };
        }
        // Optimistic concurrency check
        if (expectedRevision !== undefined && expectedRevision !== existing.revision) {
            return { conflict: true, currentRevision: existing.revision };
        }
        // Load draft metadata if present
        const draft = db.prepare("SELECT * FROM docs_page_drafts WHERE page_id = ?").get(pageId);
        const newTitle = draft?.title || existing.title;
        const newSlug = draft?.slug || existing.slug;
        const newContent = draft?.content || existing.content;
        // Validate content length
        if (newContent.length > MAX_PAGE_CONTENT_LENGTH) {
            return { error: makeError("CONTENT_TOO_LONG", `Content exceeds maximum length of ${MAX_PAGE_CONTENT_LENGTH} bytes`) };
        }
        const newRevision = existing.revision + 1;
        const now = nowISO();
        // Save old state as a version snapshot (exactly one version)
        db.prepare("INSERT INTO docs_page_versions (page_id, revision, title, content, created_at) VALUES (?, ?, ?, ?, ?)").run(pageId, newRevision, newTitle, newContent, now);
        // Update page to published
        db.prepare(`UPDATE docs_pages SET title = ?, slug = ?, content = ?, revision = ?, status = 'published', updated_at = ?
       WHERE id = ?`).run(newTitle, newSlug, newContent, newRevision, now, pageId);
        // Rebuild backlinks
        rebuildBacklinks(db, pageId, newContent);
        // Clear draft
        db.prepare("DELETE FROM docs_page_drafts WHERE page_id = ?").run(pageId);
        return {
            page: db.prepare("SELECT * FROM docs_pages WHERE id = ?").get(pageId),
        };
    });
    checkpointAfterWrite();
    if (result?.page)
        indexPublishedDoc(result.page);
    return (result ?? { error: makeError("PAGE_NOT_FOUND", "Failed to publish page") });
}
// ── Update Page (published edits) ────────────────────────────────────────────
/**
 * Update a published page. Creates a new version snapshot and bumps revision.
 * If `expectedRevision` is provided and doesn't match, returns a conflict
 * instead of overwriting (optimistic concurrency).
 *
 * NOTE: Unlike createPage → publishPage lifecycle, this directly bumps the
 *       revision and creates a version in a single call.
 */
export function updatePage(id, fields) {
    const safeContent = fields.content;
    if (safeContent !== undefined && safeContent.length > MAX_PAGE_CONTENT_LENGTH) {
        return { error: makeError("CONTENT_TOO_LONG", `Content exceeds maximum length of ${MAX_PAGE_CONTENT_LENGTH} bytes`) };
    }
    const result = execTransaction(() => {
        const db = getDb(dbPath());
        const existing = db.prepare("SELECT * FROM docs_pages WHERE id = ?").get(id);
        if (!existing) {
            return { error: makeError("PAGE_NOT_FOUND", `Page ${id} does not exist`) };
        }
        // Optimistic concurrency check
        if (fields.expectedRevision !== undefined && fields.expectedRevision !== existing.revision) {
            return { conflict: true, currentRevision: existing.revision };
        }
        const now = nowISO();
        const newRevision = existing.revision + 1;
        const newTitle = fields.title ?? existing.title;
        const newSlug = fields.slug ?? existing.slug;
        const newContent = fields.content ?? existing.content;
        // Save old state as a version
        db.prepare("INSERT INTO docs_page_versions (page_id, revision, title, content, created_at) VALUES (?, ?, ?, ?, ?)").run(id, newRevision, newTitle, newContent, now);
        // Update page
        db.prepare(`UPDATE docs_pages SET title = ?, slug = ?, content = ?, revision = ?, updated_at = ?
       WHERE id = ?`).run(newTitle, newSlug, newContent, newRevision, now, id);
        // Rebuild backlinks
        rebuildBacklinks(db, id, newContent);
        return { page: db.prepare("SELECT * FROM docs_pages WHERE id = ?").get(id) };
    });
    checkpointAfterWrite();
    if (result?.page?.status === "published")
        indexPublishedDoc(result.page);
    return (result ?? { error: makeError("PAGE_NOT_FOUND", "Failed to update page") });
}
/**
 * Soft-delete a page by setting status to "archived".
 * Does nothing if already archived (idempotent guard in WHERE clause).
 */
export function archivePage(id) {
    const page = getPage(id);
    const result = execTransaction(() => {
        const db = getDb(dbPath());
        return db.prepare("UPDATE docs_pages SET status = 'archived', updated_at = ? WHERE id = ? AND status != 'archived'").run(nowISO(), id).changes > 0;
    });
    checkpointAfterWrite();
    if (result && page)
        indexPublishedDoc({ ...page, status: "archived" });
    return result;
}
/** Restore an archived page back to "published" status. */
export function restorePage(id) {
    const result = execTransaction(() => {
        const db = getDb(dbPath());
        db.prepare("UPDATE docs_pages SET status = 'published', updated_at = ? WHERE id = ? AND status = 'archived'").run(nowISO(), id);
        return db.prepare("SELECT * FROM docs_pages WHERE id = ?").get(id);
    });
    checkpointAfterWrite();
    if (result)
        indexPublishedDoc(result);
    return result;
}
export function movePage(id, newParentId, newSortOrder) {
    const result = execTransaction(() => {
        const db = getDb(dbPath());
        const existing = db.prepare("SELECT * FROM docs_pages WHERE id = ?").get(id);
        if (!existing) {
            return { error: makeError("PAGE_NOT_FOUND", `Page ${id} does not exist`) };
        }
        const targetParent = newParentId !== undefined ? newParentId : existing.parent_page_id;
        // Self-parent check
        if (targetParent != null && targetParent === id) {
            return { error: makeError("PARENT_SELF", "A page cannot be its own parent") };
        }
        // Cycle detection
        if (targetParent != null && wouldCreateCycle(db, id, targetParent)) {
            return { error: makeError("PARENT_CYCLE", "Moving under this parent would create a cycle") };
        }
        // Cross-space and archived check
        if (targetParent != null) {
            const parentErr = validateParentPage(db, existing.space_id, targetParent);
            if (parentErr)
                return { error: parentErr };
        }
        const now = nowISO();
        const sort = newSortOrder !== undefined ? newSortOrder : existing.sort_order;
        db.prepare("UPDATE docs_pages SET parent_page_id = ?, sort_order = ?, updated_at = ? WHERE id = ?").run(targetParent, sort, now, id);
        return {
            page: db.prepare("SELECT * FROM docs_pages WHERE id = ?").get(id),
        };
    });
    checkpointAfterWrite();
    return (result ?? { error: makeError("PAGE_NOT_FOUND", "Failed to move page") });
}
// ── Drafts ───────────────────────────────────────────────────────────────────
export function getDraft(pageId) {
    const db = getDb(dbPath());
    return db.prepare("SELECT * FROM docs_page_drafts WHERE page_id = ?").get(pageId);
}
/**
 * Save a working draft for a page. Uses ON CONFLICT DO UPDATE so there is
 * at most one draft per page at any time (upsert by page_id).
 * Content length is validated against MAX_PAGE_CONTENT_LENGTH before writing.
 */
export function saveDraft(pageId, content, title, slug, baseRevision) {
    // Validate content length
    if (content.length > MAX_PAGE_CONTENT_LENGTH) {
        throw makeError("CONTENT_TOO_LONG", `Draft content exceeds maximum length of ${MAX_PAGE_CONTENT_LENGTH} bytes`);
    }
    const draft = execTransaction(() => {
        const db = getDb(dbPath());
        // Parent-existence check before upsert
        defendChildPage(db, pageId);
        const now = nowISO();
        db.prepare(`INSERT INTO docs_page_drafts (page_id, title, slug, content, base_revision, saved_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(page_id) DO UPDATE SET
         title = excluded.title,
         slug = excluded.slug,
         content = excluded.content,
         base_revision = excluded.base_revision,
         saved_at = excluded.saved_at`).run(pageId, title || "", slug || "", content, baseRevision ?? null, now);
        return db.prepare("SELECT * FROM docs_page_drafts WHERE page_id = ?").get(pageId);
    });
    checkpointAfterWrite();
    return draft;
}
export function deleteDraft(pageId) {
    const result = execTransaction(() => {
        const db = getDb(dbPath());
        return db.prepare("DELETE FROM docs_page_drafts WHERE page_id = ?").run(pageId).changes > 0;
    });
    checkpointAfterWrite();
    return result;
}
// ── Versions ─────────────────────────────────────────────────────────────────
export function listVersions(pageId) {
    const db = getDb(dbPath());
    return db.prepare("SELECT * FROM docs_page_versions WHERE page_id = ? ORDER BY revision DESC").all(pageId);
}
export function getVersion(versionId) {
    const db = getDb(dbPath());
    return db.prepare("SELECT * FROM docs_page_versions WHERE id = ?").get(versionId);
}
/**
 * Restore a page to a previous version.
 * The current state is saved as a new version first (so the restore is itself
 * reversible), then the selected version's content is copied to the page.
 */
export function restoreVersion(pageId, versionId) {
    const result = execTransaction(() => {
        const db = getDb(dbPath());
        const version = db.prepare("SELECT * FROM docs_page_versions WHERE id = ? AND page_id = ?").get(versionId, pageId);
        if (!version)
            return undefined;
        const existing = db.prepare("SELECT * FROM docs_pages WHERE id = ?").get(pageId);
        if (!existing)
            return undefined;
        const now = nowISO();
        const newRevision = existing.revision + 1;
        // Save current state as a version before restoring
        db.prepare("INSERT INTO docs_page_versions (page_id, revision, title, content, created_at) VALUES (?, ?, ?, ?, ?)").run(pageId, newRevision, version.title, version.content, now);
        // Restore from the selected version
        db.prepare("UPDATE docs_pages SET title = ?, content = ?, revision = ?, updated_at = ? WHERE id = ?").run(version.title, version.content, newRevision, now, pageId);
        // Rebuild backlinks
        rebuildBacklinks(db, pageId, version.content);
        return db.prepare("SELECT * FROM docs_pages WHERE id = ?").get(pageId);
    });
    checkpointAfterWrite();
    return result;
}
export function searchPages(query, spaceId) {
    const db = getDb(dbPath());
    const sanitized = sanitizeFts5Query(query);
    if (!sanitized)
        return [];
    let sql = `SELECT p.*, rank FROM docs_pages p
     INNER JOIN docs_pages_fts fts ON fts.rowid = p.id
     WHERE docs_pages_fts MATCH ?`;
    const params = [sanitized];
    if (spaceId) {
        sql += " AND p.space_id = ?";
        params.push(spaceId);
    }
    sql += " ORDER BY rank";
    return db.prepare(sql).all(...params);
}
// ── Tags ─────────────────────────────────────────────────────────────────────
function ensureTagSlug(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
export function listAllTags() {
    const db = getDb(dbPath());
    return db.prepare("SELECT * FROM docs_tags ORDER BY name").all();
}
export function getPageTags(pageId) {
    const db = getDb(dbPath());
    return db.prepare(`SELECT t.* FROM docs_tags t
     INNER JOIN docs_page_tags pt ON pt.tag_id = t.id
     WHERE pt.page_id = ?
     ORDER BY t.name`).all(pageId);
}
export function addTag(pageId, tagName) {
    const result = execTransaction(() => {
        const db = getDb(dbPath());
        const slug = ensureTagSlug(tagName);
        // Ensure tag exists
        db.prepare("INSERT OR IGNORE INTO docs_tags (name, slug) VALUES (?, ?)").run(tagName, slug);
        const tag = db.prepare("SELECT * FROM docs_tags WHERE slug = ?").get(slug);
        if (!tag)
            return undefined;
        // Link tag to page
        db.prepare("INSERT OR IGNORE INTO docs_page_tags (page_id, tag_id) VALUES (?, ?)").run(pageId, tag.id);
        return tag;
    });
    checkpointAfterWrite();
    return result;
}
export function removeTag(pageId, tagId) {
    const result = execTransaction(() => {
        const db = getDb(dbPath());
        return db.prepare("DELETE FROM docs_page_tags WHERE page_id = ? AND tag_id = ?").run(pageId, tagId).changes > 0;
    });
    checkpointAfterWrite();
    return result;
}
// ── Backlinks ────────────────────────────────────────────────────────────────
export function getBacklinks(pageId) {
    const db = getDb(dbPath());
    return db.prepare(`SELECT dl.*, p.title AS source_title, p.slug AS source_slug
     FROM docs_page_links dl
     INNER JOIN docs_pages p ON p.id = dl.source_page_id
     WHERE dl.target_page_id = ?
     ORDER BY p.title`).all(pageId);
}
// ── Comments ─────────────────────────────────────────────────────────────────
export function listComments(pageId) {
    const db = getDb(dbPath());
    return db.prepare("SELECT * FROM docs_comments WHERE page_id = ? ORDER BY created_at").all(pageId);
}
export function createComment(pageId, content, parentCommentId, selectionText, selectionOffset) {
    // Validate content length
    if (content.length > MAX_COMMENT_LENGTH) {
        return { error: makeError("COMMENT_TOO_LONG", `Comment exceeds maximum length of ${MAX_COMMENT_LENGTH} bytes`) };
    }
    const result = execTransaction(() => {
        const db = getDb(dbPath());
        // Defensive parent page check
        defendChildPage(db, pageId);
        // Defensive parent comment check
        if (parentCommentId != null) {
            defendChildComment(db, parentCommentId);
        }
        const now = nowISO();
        const insertResult = db.prepare(`INSERT INTO docs_comments (page_id, parent_comment_id, content, selection_text, selection_offset, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`).run(pageId, parentCommentId || null, content, selectionText || "", selectionOffset || 0, now, now);
        return {
            comment: db.prepare("SELECT * FROM docs_comments WHERE id = ?").get(insertResult.lastInsertRowid),
        };
    });
    checkpointAfterWrite();
    return (result ?? { error: makeError("PAGE_NOT_FOUND", "Failed to create comment") });
}
export function resolveComment(commentId) {
    const result = execTransaction(() => {
        const db = getDb(dbPath());
        db.prepare("UPDATE docs_comments SET resolved = 1, updated_at = ? WHERE id = ?").run(nowISO(), commentId);
        return db.prepare("SELECT * FROM docs_comments WHERE id = ?").get(commentId);
    });
    checkpointAfterWrite();
    return result;
}
export function deleteComment(commentId) {
    const result = execTransaction(() => {
        const db = getDb(dbPath());
        return db.prepare("DELETE FROM docs_comments WHERE id = ?").run(commentId).changes > 0;
    });
    checkpointAfterWrite();
    return result;
}
// ── Attachments ──────────────────────────────────────────────────────────────
export function listAttachments(pageId) {
    const db = getDb(dbPath());
    return db.prepare("SELECT * FROM docs_attachments WHERE page_id = ? ORDER BY created_at DESC").all(pageId);
}
export function getAttachment(attId) {
    const db = getDb(dbPath());
    return db.prepare("SELECT * FROM docs_attachments WHERE id = ?").get(attId);
}
/** Look up attachments by owning page (alias for listAttachments). */
export function getAttachmentsByPage(pageId) {
    return listAttachments(pageId);
}
/**
 * Save or update an attachment record.
 * Uses ON CONFLICT DO UPDATE (not INSERT OR REPLACE) so FK-referenced child
 * rows are preserved (see 🔴 HARD RULE #11 in AGENTS.md).
 * Parent-existence check via `defendChildPage` prevents FK corruption.
 */
export function saveAttachment(pageId, filename, originalName, mimeType, sizeBytes, storagePath) {
    const att = execTransaction(() => {
        const db = getDb(dbPath());
        // Parent-existence check before upsert
        defendChildPage(db, pageId);
        const now = nowISO();
        // HARD RULE #11: ON CONFLICT DO UPDATE, never INSERT OR REPLACE
        db.prepare(`INSERT INTO docs_attachments (page_id, filename, original_name, mime_type, size_bytes, storage_path, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(page_id, filename) DO UPDATE SET
         original_name = excluded.original_name,
         mime_type = excluded.mime_type,
         size_bytes = excluded.size_bytes,
         storage_path = excluded.storage_path,
         created_at = excluded.created_at`).run(pageId, filename, originalName, mimeType, sizeBytes, storagePath, now);
        return db.prepare("SELECT * FROM docs_attachments WHERE page_id = ? AND filename = ?").get(pageId, filename);
    });
    checkpointAfterWrite();
    return att;
}
/**
 * Delete an attachment, returning the deleted row so callers can verify
 * ownership (e.g., that the attachment belongs to the expected page).
 */
export function deleteAttachment(attId) {
    const result = execTransaction(() => {
        const db = getDb(dbPath());
        const att = db.prepare("SELECT * FROM docs_attachments WHERE id = ?").get(attId);
        if (!att)
            return undefined;
        db.prepare("DELETE FROM docs_attachments WHERE id = ?").run(attId);
        return att;
    });
    checkpointAfterWrite();
    return result;
}
// ── Templates ────────────────────────────────────────────────────────────────
export function listTemplates() {
    const db = getDb(dbPath());
    return db.prepare("SELECT * FROM docs_templates ORDER BY category, name").all();
}
export function getTemplate(id) {
    const db = getDb(dbPath());
    return db.prepare("SELECT * FROM docs_templates WHERE id = ?").get(id);
}
export function createTemplate(name, content, description, category) {
    const tmpl = execTransaction(() => {
        const db = getDb(dbPath());
        const now = nowISO();
        db.prepare("INSERT INTO docs_templates (name, description, content, category, created_at) VALUES (?, ?, ?, ?, ?)").run(name, description || "", content, category || "general", now);
        return db.prepare("SELECT * FROM docs_templates WHERE name = ?").get(name);
    });
    checkpointAfterWrite();
    return tmpl;
}
export function updateTemplate(id, fields) {
    const result = execTransaction(() => {
        const db = getDb(dbPath());
        const existing = db.prepare("SELECT * FROM docs_templates WHERE id = ?").get(id);
        if (!existing)
            return undefined;
        db.prepare(`UPDATE docs_templates SET name = ?, description = ?, content = ?, category = ?
       WHERE id = ?`).run(fields.name ?? existing.name, fields.description ?? existing.description, fields.content ?? existing.content, fields.category ?? existing.category, id);
        return db.prepare("SELECT * FROM docs_templates WHERE id = ?").get(id);
    });
    checkpointAfterWrite();
    return result;
}
export function deleteTemplate(id) {
    const result = execTransaction(() => {
        const db = getDb(dbPath());
        return db.prepare("DELETE FROM docs_templates WHERE id = ?").run(id).changes > 0;
    });
    checkpointAfterWrite();
    return result;
}
// ── Project Links ────────────────────────────────────────────────────────────
export function getLinkedProjects(pageId) {
    const db = getDb(dbPath());
    return db.prepare(`SELECT dpp.page_id, dpp.project_id, p.name AS project_name
     FROM docs_page_projects dpp
     INNER JOIN projects p ON p.id = dpp.project_id
     WHERE dpp.page_id = ?`).all(pageId);
}
export function linkProject(pageId, projectId) {
    const link = execTransaction(() => {
        const db = getDb(dbPath());
        // Defensive page existence check
        defendChildPage(db, pageId);
        // Verify project exists before linking (TEXT FK integrity check)
        const project = db.prepare("SELECT id FROM projects WHERE id = ?").get(projectId);
        if (!project) {
            throw makeError("PROJECT_NOT_FOUND", `Project '${projectId}' does not exist`);
        }
        db.prepare("INSERT OR IGNORE INTO docs_page_projects (page_id, project_id) VALUES (?, ?)").run(pageId, projectId);
        return { page_id: pageId, project_id: projectId };
    });
    checkpointAfterWrite();
    return link;
}
export function unlinkProject(pageId, projectId) {
    const result = execTransaction(() => {
        const db = getDb(dbPath());
        return db.prepare("DELETE FROM docs_page_projects WHERE page_id = ? AND project_id = ?").run(pageId, projectId).changes > 0;
    });
    checkpointAfterWrite();
    return result;
}
// ── Favorites ────────────────────────────────────────────────────────────────
export function toggleFavorite(pageId) {
    const result = execTransaction(() => {
        const db = getDb(dbPath());
        const existing = db.prepare("SELECT * FROM docs_pages WHERE id = ?").get(pageId);
        if (!existing)
            return undefined;
        const newFav = existing.is_favorite ? 0 : 1;
        db.prepare("UPDATE docs_pages SET is_favorite = ?, updated_at = ? WHERE id = ?").run(newFav, nowISO(), pageId);
        return db.prepare("SELECT * FROM docs_pages WHERE id = ?").get(pageId);
    });
    checkpointAfterWrite();
    return result;
}
export function listFavorites() {
    const db = getDb(dbPath());
    return db.prepare("SELECT * FROM docs_pages WHERE is_favorite = 1 AND status != 'archived' ORDER BY updated_at DESC").all();
}
export function importPages(spaceId, pages) {
    const imported = [];
    const slugToId = new Map();
    for (const entry of pages) {
        const parentId = entry.parentSlug ? slugToId.get(entry.parentSlug) ?? null : null;
        const result = createPage(spaceId, entry.title, entry.slug, entry.content, parentId ?? undefined);
        if (result.page) {
            slugToId.set(entry.slug, result.page.id);
            imported.push(result.page);
        }
    }
    return imported;
}
/**
 * Export a full space with all pages, tree, tags, versions, and comments.
 *
 * PERF: This makes N+1 queries (iterates every page to fetch tags, versions,
 *       and comments individually). Fine for small spaces but slow for large ones.
 *       A future optimization should batch-fetch all relations per space.
 */
export function exportSpace(spaceId) {
    const space = getSpace(spaceId);
    if (!space)
        return undefined;
    const pages = listPages(spaceId);
    const tree = getPageTree(spaceId);
    const tags = [];
    for (const p of pages) {
        tags.push({ pageId: p.id, tags: getPageTags(p.id) });
    }
    const allVersions = [];
    for (const p of pages) {
        allVersions.push(...listVersions(p.id));
    }
    const allComments = [];
    for (const p of pages) {
        allComments.push(...listComments(p.id));
    }
    return { space, pages, tree, tags, versions: allVersions, comments: allComments };
}
// ── Stats ────────────────────────────────────────────────────────────────────
export function getDocStats() {
    const db = getDb(dbPath());
    const spaces = db.prepare("SELECT COUNT(*) as count FROM docs_spaces").get().count;
    const pages = db.prepare("SELECT COUNT(*) as count FROM docs_pages").get().count;
    const drafts = db.prepare("SELECT COUNT(*) as count FROM docs_page_drafts").get().count;
    const versions = db.prepare("SELECT COUNT(*) as count FROM docs_page_versions").get().count;
    const tags = db.prepare("SELECT COUNT(*) as count FROM docs_tags").get().count;
    const comments = db.prepare("SELECT COUNT(*) as count FROM docs_comments").get().count;
    const attachments = db.prepare("SELECT COUNT(*) as count FROM docs_attachments").get().count;
    const templates = db.prepare("SELECT COUNT(*) as count FROM docs_templates").get().count;
    return { spaces, pages, drafts, versions, tags, comments, attachments, templates };
}
