import { getDb, execTransaction, checkpointAfterWrite, sanitizeFts5Query } from "../db.js";

// ── Type Interfaces ──────────────────────────────────────────────────────────

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

export interface DocDraft {
  id: number;
  page_id: number;
  content: string;
  saved_at: string;
}

export interface DocVersion {
  id: number;
  page_id: number;
  revision: number;
  title: string;
  content: string;
  created_at: string;
}

export interface DocTag {
  id: number;
  name: string;
  slug: string;
}

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

function dbPath(): string {
  return process.env.INGENIUM_CORE_DB_PATH || "./.ingenium/data.db";
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

// ── Spaces ───────────────────────────────────────────────────────────────────

export function listSpaces(): DocSpace[] {
  const db = getDb(dbPath());
  return db.prepare("SELECT * FROM docs_spaces ORDER BY sort_order, name").all() as DocSpace[];
}

export function getSpace(id: number): DocSpace | undefined {
  const db = getDb(dbPath());
  return db.prepare("SELECT * FROM docs_spaces WHERE id = ?").get(id) as DocSpace | undefined;
}

export function createSpace(name: string, slug: string, description?: string, icon?: string): DocSpace {
  const space = execTransaction(() => {
    const db = getDb(dbPath());
    const now = new Date().toISOString();
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

    const now = new Date().toISOString();
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

export function createPage(spaceId: number, title: string, slug: string, content?: string, parentPageId?: number): DocPage {
  const page = execTransaction(() => {
    const db = getDb(dbPath());
    const now = new Date().toISOString();
    const safeContent = content || "";

    const result = db.prepare(
      `INSERT INTO docs_pages (space_id, parent_page_id, title, slug, content, revision, status, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, 'published', 0, ?, ?)`
    ).run(spaceId, parentPageId || null, title, slug, safeContent, now, now);

    const pageId = result.lastInsertRowid as number;

    // Save initial version
    db.prepare(
      "INSERT INTO docs_page_versions (page_id, revision, title, content, created_at) VALUES (?, 1, ?, ?, ?)"
    ).run(pageId, title, safeContent, now);

    // Rebuild backlinks
    rebuildBacklinks(db, pageId, safeContent);

    return db.prepare("SELECT * FROM docs_pages WHERE id = ?").get(pageId) as DocPage;
  });
  checkpointAfterWrite();
  return page;
}

export interface UpdatePageResult {
  conflict?: boolean;
  currentRevision?: number;
  page?: DocPage;
}

export function updatePage(
  id: number,
  fields: { title?: string; slug?: string; content?: string; expectedRevision?: number },
): UpdatePageResult {
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const existing = db.prepare("SELECT * FROM docs_pages WHERE id = ?").get(id) as DocPage | undefined;
    if (!existing) return {};

    // Optimistic concurrency check
    if (fields.expectedRevision !== undefined && fields.expectedRevision !== existing.revision) {
      return { conflict: true, currentRevision: existing.revision };
    }

    const now = new Date().toISOString();
    const newRevision = existing.revision + 1;
    const newTitle = fields.title ?? existing.title;
    const newSlug = fields.slug ?? existing.slug;
    const newContent = fields.content ?? existing.content;

    // Save old version
    db.prepare(
      "INSERT INTO docs_page_versions (page_id, revision, title, content, created_at) VALUES (?, ?, ?, ?, ?)"
    ).run(id, existing.revision, existing.title, existing.content, now);

    // Update page
    db.prepare(
      `UPDATE docs_pages SET title = ?, slug = ?, content = ?, revision = ?, updated_at = ?
       WHERE id = ?`
    ).run(newTitle, newSlug, newContent, newRevision, now, id);

    // Rebuild backlinks
    rebuildBacklinks(db, id, newContent);

    return { page: db.prepare("SELECT * FROM docs_pages WHERE id = ?").get(id) as DocPage };
  });
  checkpointAfterWrite();
  return result;
}

export function archivePage(id: number): boolean {
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    return db.prepare(
      "UPDATE docs_pages SET status = 'archived', updated_at = ? WHERE id = ? AND status != 'archived'"
    ).run(new Date().toISOString(), id).changes > 0;
  });
  checkpointAfterWrite();
  return result;
}

export function restorePage(id: number): DocPage | undefined {
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    db.prepare(
      "UPDATE docs_pages SET status = 'published', updated_at = ? WHERE id = ? AND status = 'archived'"
    ).run(new Date().toISOString(), id);
    return db.prepare("SELECT * FROM docs_pages WHERE id = ?").get(id) as DocPage | undefined;
  });
  checkpointAfterWrite();
  return result;
}

export function movePage(id: number, newParentId?: number | null, newSortOrder?: number): DocPage | undefined {
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const existing = db.prepare("SELECT * FROM docs_pages WHERE id = ?").get(id) as DocPage | undefined;
    if (!existing) return undefined;

    const now = new Date().toISOString();
    const parent = newParentId !== undefined ? newParentId : existing.parent_page_id;
    const sort = newSortOrder !== undefined ? newSortOrder : existing.sort_order;

    db.prepare(
      "UPDATE docs_pages SET parent_page_id = ?, sort_order = ?, updated_at = ? WHERE id = ?"
    ).run(parent, sort, now, id);
    return db.prepare("SELECT * FROM docs_pages WHERE id = ?").get(id) as DocPage;
  });
  checkpointAfterWrite();
  return result;
}

// ── Drafts ───────────────────────────────────────────────────────────────────

export function getDraft(pageId: number): DocDraft | undefined {
  const db = getDb(dbPath());
  return db.prepare("SELECT * FROM docs_page_drafts WHERE page_id = ?").get(pageId) as DocDraft | undefined;
}

export function saveDraft(pageId: number, content: string): DocDraft {
  const draft = execTransaction(() => {
    const db = getDb(dbPath());
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO docs_page_drafts (page_id, content, saved_at) VALUES (?, ?, ?)
       ON CONFLICT(page_id) DO UPDATE SET content = excluded.content, saved_at = excluded.saved_at`
    ).run(pageId, content, now);
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

export function restoreVersion(pageId: number, versionId: number): DocPage | undefined {
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const version = db.prepare(
      "SELECT * FROM docs_page_versions WHERE id = ? AND page_id = ?"
    ).get(versionId, pageId) as DocVersion | undefined;
    if (!version) return undefined;

    const existing = db.prepare("SELECT * FROM docs_pages WHERE id = ?").get(pageId) as DocPage | undefined;
    if (!existing) return undefined;

    const now = new Date().toISOString();
    const newRevision = existing.revision + 1;

    // Save current state as a version before restoring
    db.prepare(
      "INSERT INTO docs_page_versions (page_id, revision, title, content, created_at) VALUES (?, ?, ?, ?, ?)"
    ).run(pageId, existing.revision, existing.title, existing.content, now);

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

export function createComment(
  pageId: number,
  content: string,
  parentCommentId?: number,
  selectionText?: string,
  selectionOffset?: number,
): DocComment {
  const comment = execTransaction(() => {
    const db = getDb(dbPath());
    const now = new Date().toISOString();
    const result = db.prepare(
      `INSERT INTO docs_comments (page_id, parent_comment_id, content, selection_text, selection_offset, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(pageId, parentCommentId || null, content, selectionText || "", selectionOffset || 0, now, now);
    return db.prepare("SELECT * FROM docs_comments WHERE id = ?").get(result.lastInsertRowid) as DocComment;
  });
  checkpointAfterWrite();
  return comment;
}

export function resolveComment(commentId: number): DocComment | undefined {
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    db.prepare(
      "UPDATE docs_comments SET resolved = 1, updated_at = ? WHERE id = ?"
    ).run(new Date().toISOString(), commentId);
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
    const now = new Date().toISOString();
    db.prepare(
      `INSERT OR REPLACE INTO docs_attachments (page_id, filename, original_name, mime_type, size_bytes, storage_path, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(pageId, filename, originalName, mimeType, sizeBytes, storagePath, now);
    return db.prepare(
      "SELECT * FROM docs_attachments WHERE page_id = ? AND filename = ?"
    ).get(pageId, filename) as DocAttachment;
  });
  checkpointAfterWrite();
  return att;
}

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
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO docs_templates (name, description, content, category, created_at) VALUES (?, ?, ?, ?, ?)"
    ).run(name, description || "", content, category || "general", now);
    return db.prepare("SELECT * FROM docs_templates WHERE name = ?").get(name) as DocTemplate;
  });
  checkpointAfterWrite();
  return tmpl;
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
    ).run(newFav, new Date().toISOString(), pageId);
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
    const page = createPage(spaceId, entry.title, entry.slug, entry.content, parentId ?? undefined);
    slugToId.set(entry.slug, page.id);
    imported.push(page);
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
