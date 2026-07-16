import { getDb, execTransaction, checkpointAfterWrite, sanitizeFts5Query } from "../db.js";
import { MAX_PAGE_CONTENT_LENGTH, MAX_COMMENT_LENGTH } from "../constants.js";

// ── Error Types ───────────────────────────────────────────────────────────────

/**
 * Canonical error codes for docs operations.
 * Returned in `DocsError` objects instead of thrown exceptions, so callers
 * can pattern-match on the code without try/catch.
 */
export type DocsErrorCode =
  | "CONTENT_TOO_LONG"
  | "COMMENT_TOO_LONG"
  | "SPACE_NOT_FOUND"
  | "PAGE_NOT_FOUND"
  | "COMMENT_NOT_FOUND"
  | "TEMPLATE_NOT_FOUND"
  | "ATTACHMENT_NOT_FOUND"
  | "PARENT_NOT_FOUND"
  | "PARENT_CROSS_SPACE"
  | "PARENT_ARCHIVED"
  | "PARENT_CYCLE"
  | "PARENT_SELF"
  | "PROJECT_NOT_FOUND"
  | "SLUG_CONFLICT"
  | "REVISION_CONFLICT";

/** Structured error with machine-readable code + human-readable message. */
export interface DocsError {
  code: DocsErrorCode;
  message: string;
}

// ── Type Interfaces ──────────────────────────────────────────────────────────

/** A docs space (wiki-style namespace grouping pages together). */
export interface DocSpace {
  id: number;
  name: string;
  slug: string;
  description: string;
  icon: string;
  sort_order: number;
  is_global: number;
  created_at: string;
  updated_at: string;
}

/**
 * A docs page with revision-based versioning.
 * Pages start as "draft" (revision 0), become "published" on first publish,
 * and can be "archived" (soft-delete). Revisions are bumped on each publish/update.
 */
export interface DocPage {
  id: number;
  space_id: number;
  parent_page_id: number | null;
  title: string;
  slug: string;
  content: string;
  revision: number;
  status: "draft" | "published" | "archived";
  sort_order: number;
  is_favorite: number;
  created_at: string;
  updated_at: string;
}

/** In-progress edits that haven't been published yet. Separate from the page table. */
export interface DocDraft {
  id: number;
  page_id: number;
  title: string;
  slug: string;
  content: string;
  base_revision: number | null;
  saved_at: string;
}

/** Snapshot of a page at a specific revision. Append-only — never mutated. */
export interface DocVersion {
  id: number;
  page_id: number;
  revision: number;
  title: string;
  content: string;
  created_at: string;
}

/** A tag (shared across all pages in all spaces). */
export interface DocTag {
  id: number;
  name: string;
  slug: string;
}

/** A comment on a page (supports threaded replies via parent_comment_id). */
export interface DocComment {
  id: number;
  page_id: number;
  parent_comment_id: number | null;
  content: string;
  selection_text: string;
  selection_offset: number;
  resolved: number;
  created_at: string;
  updated_at: string;
}

export interface DocAttachment {
  id: number;
  page_id: number;
  filename: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  created_at: string;
}

export interface DocTemplate {
  id: number;
  name: string;
  description: string;
  content: string;
  category: string;
  created_at: string;
}

export interface DocPageLink {
  id: number;
  source_page_id: number;
  target_page_id: number;
  link_text: string;
}

export interface DocProjectLink {
  page_id: number;
  project_id: string;
}

export interface DocStatCounts {
  spaces: number;
  pages: number;
  drafts: number;
  versions: number;
  tags: number;
  comments: number;
  attachments: number;
  templates: number;
}

// ── Result Types ──────────────────────────────────────────────────────────────

export interface CreatePageResult {
  page?: DocPage;
  error?: DocsError;
}

export interface PublishPageResult {
  page?: DocPage;
  conflict?: boolean;
  currentRevision?: number;
  error?: DocsError;
}

export interface UpdatePageResult {
  conflict?: boolean;
  currentRevision?: number;
  page?: DocPage;
  error?: DocsError;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function dbPath(): string {
  return process.env.INGENIUM_CORE_DB_PATH || "./.ingenium/data.db";
}

function nowISO(): string {
  return new Date().toISOString();
}

function makeError(code: DocsErrorCode, message: string): DocsError {
  return { code, message };
}

// ── Backlink Parsing ─────────────────────────────────────────────────────────

const WIKILINK_RE = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;

/** Extract unique target slugs from wikilinks in content. */
function extractWikilinkSlugs(content: string): string[] {
  const slugs = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = WIKILINK_RE.exec(content)) !== null) {
    slugs.add(m[1]!.trim());
  }
  return [...slugs];
}

/** Rebuild backlinks for a given page by parsing its content for [[slug]] refs. */
function rebuildBacklinks(db: ReturnType<typeof getDb>, pageId: number, content: string): void {
  // Remove existing outgoing links for this page
  db.prepare("DELETE FROM docs_page_links WHERE source_page_id = ?").run(pageId);

  const page = db.prepare("SELECT space_id FROM docs_pages WHERE id = ?").get(pageId) as Pick<DocPage, "space_id"> | undefined;
  if (!page) return;

  const slugs = extractWikilinkSlugs(content);
  if (slugs.length === 0) return;

  const placeholders = slugs.map(() => "?").join(",");
  const targetPages = db.prepare(
    `SELECT id, slug FROM docs_pages WHERE space_id = ? AND slug IN (${placeholders})`
  ).all(page.space_id, ...slugs) as Pick<DocPage, "id" | "slug">[];

  const slugMap = new Map<string, number>();
  for (const tp of targetPages) {
    slugMap.set(tp.slug, tp.id);
  }

  const insertLink = db.prepare(
    "INSERT OR IGNORE INTO docs_page_links (source_page_id, target_page_id, link_text) VALUES (?, ?, ?)"
  );
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
function validateParentPage(
  db: ReturnType<typeof getDb>,
  spaceId: number,
  parentPageId: number | null | undefined,
): DocsError | null {
  if (parentPageId == null) return null;

  const parent = db.prepare(
    "SELECT id, space_id, status FROM docs_pages WHERE id = ?"
  ).get(parentPageId) as Pick<DocPage, "id" | "space_id" | "status"> | undefined;

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
function wouldCreateCycle(
  db: ReturnType<typeof getDb>,
  pageId: number,
  newParentId: number,
): boolean {
  if (newParentId === pageId) return true;

  const visited = new Set<number>();
  let current: number | null = newParentId;
  const stmt = db.prepare("SELECT parent_page_id FROM docs_pages WHERE id = ?");

  while (current !== null) {
    if (current === pageId) return true;
    if (visited.has(current)) return true; // safety: broken chain
    visited.add(current);

    const row = stmt.get(current) as { parent_page_id: number | null } | undefined;
    if (!row) break;
    current = row.parent_page_id;
  }

  return false;
}

/**
 * Defensive parent-existence check before inserting a child row.
 * Throws if the parent page does not exist (prevents FK corruption).
 */
function defendChildPage(db: ReturnType<typeof getDb>, pageId: number): void {
  const row = db.prepare("SELECT 1 FROM docs_pages WHERE id = ?").get(pageId);
  if (!row) {
    throw makeError("PAGE_NOT_FOUND", `Page ${pageId} does not exist`);
  }
}

/**
 * Defensive parent-existence check for comments.
 */
function defendChildComment(db: ReturnType<typeof getDb>, commentId: number): void {
  const row = db.prepare("SELECT 1 FROM docs_comments WHERE id = ?").get(commentId);
  if (!row) {
    throw makeError("COMMENT_NOT_FOUND", `Comment ${commentId} does not exist`);
  }
}

// ── Spaces ───────────────────────────────────────────────────────────────────

export function listSpaces(): DocSpace[] {
  const db = getDb(dbPath());
  return db.prepare("SELECT * FROM docs_spaces ORDER BY sort_order, name").all() as DocSpace[];
}

export function getSpace(id: number): DocSpace | undefined {
  const db = getDb(dbPath());
  return db.prepare("SELECT * FROM docs_spaces WHERE id = ?").get(id) as DocSpace | undefined;
}

export function getSpaceBySlug(slug: string): DocSpace | undefined {
  const db = getDb(dbPath());
  return db.prepare("SELECT * FROM docs_spaces WHERE slug = ?").get(slug) as DocSpace | undefined;
}

export function createSpace(name: string, slug: string, description?: string, icon?: string): DocSpace {
  const space = execTransaction(() => {
    const db = getDb(dbPath());
    const now = nowISO();
    db.prepare(
      `INSERT INTO docs_spaces (name, slug, description, icon, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(name, slug, description || "", icon || "folder", now, now);
    return db.prepare("SELECT * FROM docs_spaces WHERE slug = ?").get(slug) as DocSpace;
  });
  checkpointAfterWrite();
  return space;
}

export function updateSpace(id: number, fields: { name?: string; slug?: string; description?: string; icon?: string; sort_order?: number }): DocSpace | undefined {
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const existing = db.prepare("SELECT * FROM docs_spaces WHERE id = ?").get(id) as DocSpace | undefined;
    if (!existing) return undefined;

    const now = nowISO();
    db.prepare(
      `UPDATE docs_spaces SET name = ?, slug = ?, description = ?, icon = ?, sort_order = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      fields.name ?? existing.name,
      fields.slug ?? existing.slug,
      fields.description ?? existing.description,
      fields.icon ?? existing.icon,
      fields.sort_order ?? existing.sort_order,
      now,
      id,
    );
    return db.prepare("SELECT * FROM docs_spaces WHERE id = ?").get(id) as DocSpace;
  });
  checkpointAfterWrite();
  return result;
}

export function deleteSpace(id: number): boolean {
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    return db.prepare("DELETE FROM docs_spaces WHERE id = ?").run(id).changes > 0;
  });
  checkpointAfterWrite();
  return result;
}

// ── Pages ────────────────────────────────────────────────────────────────────

export function listPages(spaceId: number, status?: string): DocPage[] {
  const db = getDb(dbPath());
  if (status) {
    return db.prepare(
      "SELECT * FROM docs_pages WHERE space_id = ? AND status = ? ORDER BY sort_order, title"
    ).all(spaceId, status) as DocPage[];
  }
  return db.prepare(
    "SELECT * FROM docs_pages WHERE space_id = ? ORDER BY sort_order, title"
  ).all(spaceId) as DocPage[];
}

/** List archived pages (for admin review before purge). */
export function listArchivedPages(spaceId: number): DocPage[] {
  const db = getDb(dbPath());
  return db.prepare(
    "SELECT * FROM docs_pages WHERE space_id = ? AND status = 'archived' ORDER BY updated_at DESC"
  ).all(spaceId) as DocPage[];
}

/**
 * Permanently delete all archived pages in a space.
 * Returns the count of deleted pages.
 *
 * WARNING: This is a hard delete — versions, comments, and attachments for
 *          these pages are orphaned. Call `exportSpace` first for a backup.
 */
export function purgeArchivedPages(spaceId: number): number {
  const db = getDb(dbPath());
  const result = execTransaction(() => {
    return db.prepare(
      "DELETE FROM docs_pages WHERE space_id = ? AND status = 'archived'"
    ).run(spaceId).changes;
  });
  checkpointAfterWrite();
  return result;
}

export function getPageTree(spaceId: number): (DocPage & { children: any[] })[] {
  const db = getDb(dbPath());
  const pages = db.prepare(
    "SELECT * FROM docs_pages WHERE space_id = ? AND status != 'archived' ORDER BY sort_order, title"
  ).all(spaceId) as DocPage[];

  const pageMap = new Map<number, DocPage & { children: any[] }>();
  const roots: (DocPage & { children: any[] })[] = [];

  for (const p of pages) {
    pageMap.set(p.id, { ...p, children: [] });
  }
  for (const p of pages) {
    const node = pageMap.get(p.id)!;
    if (p.parent_page_id && pageMap.has(p.parent_page_id)) {
      pageMap.get(p.parent_page_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

export function getPage(id: number): DocPage | undefined {
  const db = getDb(dbPath());
  return db.prepare("SELECT * FROM docs_pages WHERE id = ?").get(id) as DocPage | undefined;
}

export function getPageBySlug(spaceId: number, slug: string): DocPage | undefined {
  const db = getDb(dbPath());
  return db.prepare(
    "SELECT * FROM docs_pages WHERE space_id = ? AND slug = ?"
  ).get(spaceId, slug) as DocPage | undefined;
}

/** Check if a slug is already taken in a space. Optionally exclude a page ID for rename validation. */
export function slugExists(spaceId: number, slug: string, excludePageId?: number): boolean {
  const db = getDb(dbPath());
  if (excludePageId) {
    const row = db.prepare(
      "SELECT 1 FROM docs_pages WHERE space_id = ? AND slug = ? AND id != ?"
    ).get(spaceId, slug, excludePageId);
    return !!row;
  }
  const row = db.prepare(
    "SELECT 1 FROM docs_pages WHERE space_id = ? AND slug = ?"
  ).get(spaceId, slug);
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
export function createPage(
  spaceId: number,
  title: string,
  slug: string,
  content?: string,
  parentPageId?: number,
): CreatePageResult {
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
      return { error: makeError("SPACE_NOT_FOUND", `Space ${spaceId} does not exist`) } as CreatePageResult;
    }

    // Validate parent if provided
    if (parentPageId != null) {
      const parentErr = validateParentPage(db, spaceId, parentPageId);
      if (parentErr) return { error: parentErr } as CreatePageResult;
    }

    const now = nowISO();
    const result = db.prepare(
      `INSERT INTO docs_pages (space_id, parent_page_id, title, slug, content, revision, status, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, 'draft', 0, ?, ?)`
    ).run(spaceId, parentPageId || null, title, slug, safeContent, now, now);

    const pageId = result.lastInsertRowid as number;

    return {
      page: db.prepare("SELECT * FROM docs_pages WHERE id = ?").get(pageId) as DocPage,
    } as CreatePageResult;
  });
  checkpointAfterWrite();
  return (result ?? { error: makeError("PAGE_NOT_FOUND", "Failed to create page") }) as CreatePageResult;
}

// ── Publish Page ─────────────────────────────────────────────────────────────

/**
 * Publish a draft page: atomically validate revision, apply draft metadata,
 * bump revision once, create exactly one version, rebuild backlinks, clear draft.
 *
 * If expectedRevision is provided and the page's current revision doesn't match,
 * returns conflict details instead of overwriting.
 */
export function publishPage(pageId: number, expectedRevision?: number): PublishPageResult {
  const result = execTransaction(() => {
    const db = getDb(dbPath());

    const existing = db.prepare("SELECT * FROM docs_pages WHERE id = ?").get(pageId) as DocPage | undefined;
    if (!existing) {
      return { error: makeError("PAGE_NOT_FOUND", `Page ${pageId} does not exist`) } as PublishPageResult;
    }

    // Optimistic concurrency check
    if (expectedRevision !== undefined && expectedRevision !== existing.revision) {
      return { conflict: true, currentRevision: existing.revision } as PublishPageResult;
    }

    // Load draft metadata if present
    const draft = db.prepare("SELECT * FROM docs_page_drafts WHERE page_id = ?").get(pageId) as DocDraft | undefined;

    const newTitle = draft?.title || existing.title;
    const newSlug = draft?.slug || existing.slug;
    const newContent = draft?.content || existing.content;

    // Validate content length
    if (newContent.length > MAX_PAGE_CONTENT_LENGTH) {
      return { error: makeError("CONTENT_TOO_LONG", `Content exceeds maximum length of ${MAX_PAGE_CONTENT_LENGTH} bytes`) } as PublishPageResult;
    }

    const newRevision = existing.revision + 1;
    const now = nowISO();

    // Save old state as a version snapshot (exactly one version)
    db.prepare(
      "INSERT INTO docs_page_versions (page_id, revision, title, content, created_at) VALUES (?, ?, ?, ?, ?)"
    ).run(pageId, newRevision, newTitle, newContent, now);

    // Update page to published
    db.prepare(
      `UPDATE docs_pages SET title = ?, slug = ?, content = ?, revision = ?, status = 'published', updated_at = ?
       WHERE id = ?`
    ).run(newTitle, newSlug, newContent, newRevision, now, pageId);

    // Rebuild backlinks
    rebuildBacklinks(db, pageId, newContent);

    // Clear draft
    db.prepare("DELETE FROM docs_page_drafts WHERE page_id = ?").run(pageId);

    return {
      page: db.prepare("SELECT * FROM docs_pages WHERE id = ?").get(pageId) as DocPage,
    } as PublishPageResult;
  });
  checkpointAfterWrite();
  return (result ?? { error: makeError("PAGE_NOT_FOUND", "Failed to publish page") }) as PublishPageResult;
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
export function updatePage(
  id: number,
  fields: { title?: string; slug?: string; content?: string; expectedRevision?: number },
): UpdatePageResult {
  const safeContent = fields.content;
  if (safeContent !== undefined && safeContent.length > MAX_PAGE_CONTENT_LENGTH) {
    return { error: makeError("CONTENT_TOO_LONG", `Content exceeds maximum length of ${MAX_PAGE_CONTENT_LENGTH} bytes`) };
  }

  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const existing = db.prepare("SELECT * FROM docs_pages WHERE id = ?").get(id) as DocPage | undefined;
    if (!existing) {
      return { error: makeError("PAGE_NOT_FOUND", `Page ${id} does not exist`) } as UpdatePageResult;
    }

    // Optimistic concurrency check
    if (fields.expectedRevision !== undefined && fields.expectedRevision !== existing.revision) {
      return { conflict: true, currentRevision: existing.revision } as UpdatePageResult;
    }

    const now = nowISO();
    const newRevision = existing.revision + 1;
    const newTitle = fields.title ?? existing.title;
    const newSlug = fields.slug ?? existing.slug;
    const newContent = fields.content ?? existing.content;

    // Save old state as a version
    db.prepare(
      "INSERT INTO docs_page_versions (page_id, revision, title, content, created_at) VALUES (?, ?, ?, ?, ?)"
    ).run(id, newRevision, newTitle, newContent, now);

    // Update page
    db.prepare(
      `UPDATE docs_pages SET title = ?, slug = ?, content = ?, revision = ?, updated_at = ?
       WHERE id = ?`
    ).run(newTitle, newSlug, newContent, newRevision, now, id);

    // Rebuild backlinks
    rebuildBacklinks(db, id, newContent);

    return { page: db.prepare("SELECT * FROM docs_pages WHERE id = ?").get(id) as DocPage } as UpdatePageResult;
  });
  checkpointAfterWrite();
  return (result ?? { error: makeError("PAGE_NOT_FOUND", "Failed to update page") }) as UpdatePageResult;
}

/**
 * Soft-delete a page by setting status to "archived".
 * Does nothing if already archived (idempotent guard in WHERE clause).
 */
export function archivePage(id: number): boolean {
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    return db.prepare(
      "UPDATE docs_pages SET status = 'archived', updated_at = ? WHERE id = ? AND status != 'archived'"
    ).run(nowISO(), id).changes > 0;
  });
  checkpointAfterWrite();
  return result;
}

/** Restore an archived page back to "published" status. */
export function restorePage(id: number): DocPage | undefined {
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    db.prepare(
      "UPDATE docs_pages SET status = 'published', updated_at = ? WHERE id = ? AND status = 'archived'"
    ).run(nowISO(), id);
    return db.prepare("SELECT * FROM docs_pages WHERE id = ?").get(id) as DocPage | undefined;
  });
  checkpointAfterWrite();
  return result;
}

// ── Move Page (with cycle detection and parent validation) ───────────────────

export interface MovePageResult {
  page?: DocPage;
  error?: DocsError;
}

export function movePage(
  id: number,
  newParentId?: number | null,
  newSortOrder?: number,
): MovePageResult {
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const existing = db.prepare("SELECT * FROM docs_pages WHERE id = ?").get(id) as DocPage | undefined;
    if (!existing) {
      return { error: makeError("PAGE_NOT_FOUND", `Page ${id} does not exist`) } as MovePageResult;
    }

    const targetParent = newParentId !== undefined ? newParentId : existing.parent_page_id;

    // Self-parent check
    if (targetParent != null && targetParent === id) {
      return { error: makeError("PARENT_SELF", "A page cannot be its own parent") } as MovePageResult;
    }

    // Cycle detection
    if (targetParent != null && wouldCreateCycle(db, id, targetParent)) {
      return { error: makeError("PARENT_CYCLE", "Moving under this parent would create a cycle") } as MovePageResult;
    }

    // Cross-space and archived check
    if (targetParent != null) {
      const parentErr = validateParentPage(db, existing.space_id, targetParent);
      if (parentErr) return { error: parentErr } as MovePageResult;
    }

    const now = nowISO();
    const sort = newSortOrder !== undefined ? newSortOrder : existing.sort_order;

    db.prepare(
      "UPDATE docs_pages SET parent_page_id = ?, sort_order = ?, updated_at = ? WHERE id = ?"
    ).run(targetParent, sort, now, id);

    return {
      page: db.prepare("SELECT * FROM docs_pages WHERE id = ?").get(id) as DocPage,
    } as MovePageResult;
  });
  checkpointAfterWrite();
  return (result ?? { error: makeError("PAGE_NOT_FOUND", "Failed to move page") }) as MovePageResult;
}

// ── Drafts ───────────────────────────────────────────────────────────────────

export function getDraft(pageId: number): DocDraft | undefined {
  const db = getDb(dbPath());
  return db.prepare("SELECT * FROM docs_page_drafts WHERE page_id = ?").get(pageId) as DocDraft | undefined;
}

/**
 * Save a working draft for a page. Uses ON CONFLICT DO UPDATE so there is
 * at most one draft per page at any time (upsert by page_id).
 * Content length is validated against MAX_PAGE_CONTENT_LENGTH before writing.
 */
export function saveDraft(
  pageId: number,
  content: string,
  title?: string,
  slug?: string,
  baseRevision?: number,
): DocDraft {
  // Validate content length
  if (content.length > MAX_PAGE_CONTENT_LENGTH) {
    throw makeError("CONTENT_TOO_LONG", `Draft content exceeds maximum length of ${MAX_PAGE_CONTENT_LENGTH} bytes`);
  }

  const draft = execTransaction(() => {
    const db = getDb(dbPath());

    // Parent-existence check before upsert
    defendChildPage(db, pageId);

    const now = nowISO();
    db.prepare(
      `INSERT INTO docs_page_drafts (page_id, title, slug, content, base_revision, saved_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(page_id) DO UPDATE SET
         title = excluded.title,
         slug = excluded.slug,
         content = excluded.content,
         base_revision = excluded.base_revision,
         saved_at = excluded.saved_at`
    ).run(pageId, title || "", slug || "", content, baseRevision ?? null, now);

    return db.prepare("SELECT * FROM docs_page_drafts WHERE page_id = ?").get(pageId) as DocDraft;
  });
  checkpointAfterWrite();
  return draft;
}

export function deleteDraft(pageId: number): boolean {
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    return db.prepare("DELETE FROM docs_page_drafts WHERE page_id = ?").run(pageId).changes > 0;
  });
  checkpointAfterWrite();
  return result;
}

// ── Versions ─────────────────────────────────────────────────────────────────

export function listVersions(pageId: number): DocVersion[] {
  const db = getDb(dbPath());
  return db.prepare(
    "SELECT * FROM docs_page_versions WHERE page_id = ? ORDER BY revision DESC"
  ).all(pageId) as DocVersion[];
}

export function getVersion(versionId: number): DocVersion | undefined {
  const db = getDb(dbPath());
  return db.prepare("SELECT * FROM docs_page_versions WHERE id = ?").get(versionId) as DocVersion | undefined;
}

/**
 * Restore a page to a previous version.
 * The current state is saved as a new version first (so the restore is itself
 * reversible), then the selected version's content is copied to the page.
 */
export function restoreVersion(pageId: number, versionId: number): DocPage | undefined {
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const version = db.prepare(
      "SELECT * FROM docs_page_versions WHERE id = ? AND page_id = ?"
    ).get(versionId, pageId) as DocVersion | undefined;
    if (!version) return undefined;

    const existing = db.prepare("SELECT * FROM docs_pages WHERE id = ?").get(pageId) as DocPage | undefined;
    if (!existing) return undefined;

    const now = nowISO();
    const newRevision = existing.revision + 1;

    // Save current state as a version before restoring
    db.prepare(
      "INSERT INTO docs_page_versions (page_id, revision, title, content, created_at) VALUES (?, ?, ?, ?, ?)"
    ).run(pageId, newRevision, version.title, version.content, now);

    // Restore from the selected version
    db.prepare(
      "UPDATE docs_pages SET title = ?, content = ?, revision = ?, updated_at = ? WHERE id = ?"
    ).run(version.title, version.content, newRevision, now, pageId);

    // Rebuild backlinks
    rebuildBacklinks(db, pageId, version.content);

    return db.prepare("SELECT * FROM docs_pages WHERE id = ?").get(pageId) as DocPage;
  });
  checkpointAfterWrite();
  return result;
}

// ── Search ───────────────────────────────────────────────────────────────────

export interface SearchResult extends DocPage {
  rank: number;
}

export function searchPages(query: string, spaceId?: number): SearchResult[] {
  const db = getDb(dbPath());
  const sanitized = sanitizeFts5Query(query);
  if (!sanitized) return [];

  let sql = `SELECT p.*, rank FROM docs_pages p
     INNER JOIN docs_pages_fts fts ON fts.rowid = p.id
     WHERE docs_pages_fts MATCH ?`;
  const params: (string | number)[] = [sanitized];

  if (spaceId) {
    sql += " AND p.space_id = ?";
    params.push(spaceId);
  }

  sql += " ORDER BY rank";
  return db.prepare(sql).all(...params) as SearchResult[];
}

// ── Tags ─────────────────────────────────────────────────────────────────────

function ensureTagSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function listAllTags(): DocTag[] {
  const db = getDb(dbPath());
  return db.prepare("SELECT * FROM docs_tags ORDER BY name").all() as DocTag[];
}

export function getPageTags(pageId: number): DocTag[] {
  const db = getDb(dbPath());
  return db.prepare(
    `SELECT t.* FROM docs_tags t
     INNER JOIN docs_page_tags pt ON pt.tag_id = t.id
     WHERE pt.page_id = ?
     ORDER BY t.name`
  ).all(pageId) as DocTag[];
}

export function addTag(pageId: number, tagName: string): DocTag | undefined {
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const slug = ensureTagSlug(tagName);

    // Ensure tag exists
    db.prepare(
      "INSERT OR IGNORE INTO docs_tags (name, slug) VALUES (?, ?)"
    ).run(tagName, slug);

    const tag = db.prepare("SELECT * FROM docs_tags WHERE slug = ?").get(slug) as DocTag | undefined;
    if (!tag) return undefined;

    // Link tag to page
    db.prepare(
      "INSERT OR IGNORE INTO docs_page_tags (page_id, tag_id) VALUES (?, ?)"
    ).run(pageId, tag.id);

    return tag;
  });
  checkpointAfterWrite();
  return result;
}

export function removeTag(pageId: number, tagId: number): boolean {
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    return db.prepare(
      "DELETE FROM docs_page_tags WHERE page_id = ? AND tag_id = ?"
    ).run(pageId, tagId).changes > 0;
  });
  checkpointAfterWrite();
  return result;
}

// ── Backlinks ────────────────────────────────────────────────────────────────

export function getBacklinks(pageId: number): (DocPageLink & { source_title: string; source_slug: string })[] {
  const db = getDb(dbPath());
  return db.prepare(
    `SELECT dl.*, p.title AS source_title, p.slug AS source_slug
     FROM docs_page_links dl
     INNER JOIN docs_pages p ON p.id = dl.source_page_id
     WHERE dl.target_page_id = ?
     ORDER BY p.title`
  ).all(pageId) as any[];
}

// ── Comments ─────────────────────────────────────────────────────────────────

export function listComments(pageId: number): DocComment[] {
  const db = getDb(dbPath());
  return db.prepare(
    "SELECT * FROM docs_comments WHERE page_id = ? ORDER BY created_at"
  ).all(pageId) as DocComment[];
}

export interface CreateCommentResult {
  comment?: DocComment;
  error?: DocsError;
}

export function createComment(
  pageId: number,
  content: string,
  parentCommentId?: number,
  selectionText?: string,
  selectionOffset?: number,
): CreateCommentResult {
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
    const insertResult = db.prepare(
      `INSERT INTO docs_comments (page_id, parent_comment_id, content, selection_text, selection_offset, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(pageId, parentCommentId || null, content, selectionText || "", selectionOffset || 0, now, now);

    return {
      comment: db.prepare("SELECT * FROM docs_comments WHERE id = ?").get(insertResult.lastInsertRowid) as DocComment,
    } as CreateCommentResult;
  });
  checkpointAfterWrite();
  return (result ?? { error: makeError("PAGE_NOT_FOUND", "Failed to create comment") }) as CreateCommentResult;
}

export function resolveComment(commentId: number): DocComment | undefined {
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    db.prepare(
      "UPDATE docs_comments SET resolved = 1, updated_at = ? WHERE id = ?"
    ).run(nowISO(), commentId);
    return db.prepare("SELECT * FROM docs_comments WHERE id = ?").get(commentId) as DocComment | undefined;
  });
  checkpointAfterWrite();
  return result;
}

export function deleteComment(commentId: number): boolean {
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    return db.prepare("DELETE FROM docs_comments WHERE id = ?").run(commentId).changes > 0;
  });
  checkpointAfterWrite();
  return result;
}

// ── Attachments ──────────────────────────────────────────────────────────────

export function listAttachments(pageId: number): DocAttachment[] {
  const db = getDb(dbPath());
  return db.prepare(
    "SELECT * FROM docs_attachments WHERE page_id = ? ORDER BY created_at DESC"
  ).all(pageId) as DocAttachment[];
}

export function getAttachment(attId: number): DocAttachment | undefined {
  const db = getDb(dbPath());
  return db.prepare("SELECT * FROM docs_attachments WHERE id = ?").get(attId) as DocAttachment | undefined;
}

/** Look up attachments by owning page (alias for listAttachments). */
export function getAttachmentsByPage(pageId: number): DocAttachment[] {
  return listAttachments(pageId);
}

/**
 * Save or update an attachment record.
 * Uses ON CONFLICT DO UPDATE (not INSERT OR REPLACE) so FK-referenced child
 * rows are preserved (see 🔴 HARD RULE #11 in AGENTS.md).
 * Parent-existence check via `defendChildPage` prevents FK corruption.
 */
export function saveAttachment(
  pageId: number,
  filename: string,
  originalName: string,
  mimeType: string,
  sizeBytes: number,
  storagePath: string,
): DocAttachment {
  const att = execTransaction(() => {
    const db = getDb(dbPath());

    // Parent-existence check before upsert
    defendChildPage(db, pageId);

    const now = nowISO();
    // HARD RULE #11: ON CONFLICT DO UPDATE, never INSERT OR REPLACE
    db.prepare(
      `INSERT INTO docs_attachments (page_id, filename, original_name, mime_type, size_bytes, storage_path, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(page_id, filename) DO UPDATE SET
         original_name = excluded.original_name,
         mime_type = excluded.mime_type,
         size_bytes = excluded.size_bytes,
         storage_path = excluded.storage_path,
         created_at = excluded.created_at`
    ).run(pageId, filename, originalName, mimeType, sizeBytes, storagePath, now);

    return db.prepare(
      "SELECT * FROM docs_attachments WHERE page_id = ? AND filename = ?"
    ).get(pageId, filename) as DocAttachment;
  });
  checkpointAfterWrite();
  return att;
}

/**
 * Delete an attachment, returning the deleted row so callers can verify
 * ownership (e.g., that the attachment belongs to the expected page).
 */
export function deleteAttachment(attId: number): DocAttachment | undefined {
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const att = db.prepare("SELECT * FROM docs_attachments WHERE id = ?").get(attId) as DocAttachment | undefined;
    if (!att) return undefined;
    db.prepare("DELETE FROM docs_attachments WHERE id = ?").run(attId);
    return att;
  });
  checkpointAfterWrite();
  return result;
}

// ── Templates ────────────────────────────────────────────────────────────────

export function listTemplates(): DocTemplate[] {
  const db = getDb(dbPath());
  return db.prepare("SELECT * FROM docs_templates ORDER BY category, name").all() as DocTemplate[];
}

export function getTemplate(id: number): DocTemplate | undefined {
  const db = getDb(dbPath());
  return db.prepare("SELECT * FROM docs_templates WHERE id = ?").get(id) as DocTemplate | undefined;
}

export function createTemplate(name: string, content: string, description?: string, category?: string): DocTemplate {
  const tmpl = execTransaction(() => {
    const db = getDb(dbPath());
    const now = nowISO();
    db.prepare(
      "INSERT INTO docs_templates (name, description, content, category, created_at) VALUES (?, ?, ?, ?, ?)"
    ).run(name, description || "", content, category || "general", now);
    return db.prepare("SELECT * FROM docs_templates WHERE name = ?").get(name) as DocTemplate;
  });
  checkpointAfterWrite();
  return tmpl;
}

export function updateTemplate(
  id: number,
  fields: { name?: string; description?: string; content?: string; category?: string },
): DocTemplate | undefined {
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const existing = db.prepare("SELECT * FROM docs_templates WHERE id = ?").get(id) as DocTemplate | undefined;
    if (!existing) return undefined;

    db.prepare(
      `UPDATE docs_templates SET name = ?, description = ?, content = ?, category = ?
       WHERE id = ?`
    ).run(
      fields.name ?? existing.name,
      fields.description ?? existing.description,
      fields.content ?? existing.content,
      fields.category ?? existing.category,
      id,
    );
    return db.prepare("SELECT * FROM docs_templates WHERE id = ?").get(id) as DocTemplate;
  });
  checkpointAfterWrite();
  return result;
}

export function deleteTemplate(id: number): boolean {
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    return db.prepare("DELETE FROM docs_templates WHERE id = ?").run(id).changes > 0;
  });
  checkpointAfterWrite();
  return result;
}

// ── Project Links ────────────────────────────────────────────────────────────

export function getLinkedProjects(pageId: number): DocProjectLink[] {
  const db = getDb(dbPath());
  return db.prepare(
    `SELECT dpp.page_id, dpp.project_id, p.name AS project_name
     FROM docs_page_projects dpp
     INNER JOIN projects p ON p.id = dpp.project_id
     WHERE dpp.page_id = ?`
  ).all(pageId) as any[];
}

export function linkProject(pageId: number, projectId: string): DocProjectLink {
  const link = execTransaction(() => {
    const db = getDb(dbPath());

    // Defensive page existence check
    defendChildPage(db, pageId);

    // Verify project exists before linking (TEXT FK integrity check)
    const project = db.prepare("SELECT id FROM projects WHERE id = ?").get(projectId);
    if (!project) {
      throw makeError("PROJECT_NOT_FOUND", `Project '${projectId}' does not exist`);
    }

    db.prepare(
      "INSERT OR IGNORE INTO docs_page_projects (page_id, project_id) VALUES (?, ?)"
    ).run(pageId, projectId);
    return { page_id: pageId, project_id: projectId };
  });
  checkpointAfterWrite();
  return link;
}

export function unlinkProject(pageId: number, projectId: string): boolean {
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    return db.prepare(
      "DELETE FROM docs_page_projects WHERE page_id = ? AND project_id = ?"
    ).run(pageId, projectId).changes > 0;
  });
  checkpointAfterWrite();
  return result;
}

// ── Favorites ────────────────────────────────────────────────────────────────

export function toggleFavorite(pageId: number): DocPage | undefined {
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const existing = db.prepare("SELECT * FROM docs_pages WHERE id = ?").get(pageId) as DocPage | undefined;
    if (!existing) return undefined;

    const newFav = existing.is_favorite ? 0 : 1;
    db.prepare(
      "UPDATE docs_pages SET is_favorite = ?, updated_at = ? WHERE id = ?"
    ).run(newFav, nowISO(), pageId);
    return db.prepare("SELECT * FROM docs_pages WHERE id = ?").get(pageId) as DocPage;
  });
  checkpointAfterWrite();
  return result;
}

export function listFavorites(): DocPage[] {
  const db = getDb(dbPath());
  return db.prepare(
    "SELECT * FROM docs_pages WHERE is_favorite = 1 AND status != 'archived' ORDER BY updated_at DESC"
  ).all() as DocPage[];
}

// ── Import / Export ──────────────────────────────────────────────────────────

export interface ImportPageEntry {
  title: string;
  slug: string;
  content: string;
  parentSlug?: string;
}

export function importPages(spaceId: number, pages: ImportPageEntry[]): DocPage[] {
  const imported: DocPage[] = [];
  const slugToId = new Map<string, number>();

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

export interface ExportSpaceResult {
  space: DocSpace;
  pages: DocPage[];
  tree: (DocPage & { children: any[] })[];
  tags: { pageId: number; tags: DocTag[] }[];
  versions: DocVersion[];
  comments: DocComment[];
}

/**
 * Export a full space with all pages, tree, tags, versions, and comments.
 *
 * PERF: This makes N+1 queries (iterates every page to fetch tags, versions,
 *       and comments individually). Fine for small spaces but slow for large ones.
 *       A future optimization should batch-fetch all relations per space.
 */
export function exportSpace(spaceId: number): ExportSpaceResult | undefined {
  const space = getSpace(spaceId);
  if (!space) return undefined;

  const pages = listPages(spaceId);
  const tree = getPageTree(spaceId);

  const tags: { pageId: number; tags: DocTag[] }[] = [];
  for (const p of pages) {
    tags.push({ pageId: p.id, tags: getPageTags(p.id) });
  }

  const allVersions: DocVersion[] = [];
  for (const p of pages) {
    allVersions.push(...listVersions(p.id));
  }

  const allComments: DocComment[] = [];
  for (const p of pages) {
    allComments.push(...listComments(p.id));
  }

  return { space, pages, tree, tags, versions: allVersions, comments: allComments };
}

// ── Stats ────────────────────────────────────────────────────────────────────

export function getDocStats(): DocStatCounts {
  const db = getDb(dbPath());
  const spaces = (db.prepare("SELECT COUNT(*) as count FROM docs_spaces").get() as { count: number }).count;
  const pages = (db.prepare("SELECT COUNT(*) as count FROM docs_pages").get() as { count: number }).count;
  const drafts = (db.prepare("SELECT COUNT(*) as count FROM docs_page_drafts").get() as { count: number }).count;
  const versions = (db.prepare("SELECT COUNT(*) as count FROM docs_page_versions").get() as { count: number }).count;
  const tags = (db.prepare("SELECT COUNT(*) as count FROM docs_tags").get() as { count: number }).count;
  const comments = (db.prepare("SELECT COUNT(*) as count FROM docs_comments").get() as { count: number }).count;
  const attachments = (db.prepare("SELECT COUNT(*) as count FROM docs_attachments").get() as { count: number }).count;
  const templates = (db.prepare("SELECT COUNT(*) as count FROM docs_templates").get() as { count: number }).count;

  return { spaces, pages, drafts, versions, tags, comments, attachments, templates };
}
