import { Router } from "express";
import { docs, MAX_ATTACHMENT_SIZE, MAX_IMPORT_SIZE, getDb, execTransaction, checkpointAfterWrite } from "ingenium-core";
import formidable from "formidable";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, unlinkSync, createReadStream, statSync } from "node:fs";
import { resolve, extname, basename, sep } from "node:path";
import { realpathSync } from "node:fs";

// ── DTO Mapper Layer ─────────────────────────────────────────────────────────
// Converts snake_case core types → camelCase wire format.
// Never leak raw DB rows to clients. All routes use these mappers before responding.
// Every mapper accepts `any` from the DB layer and returns a shaped object — this
// is intentional: the DB layer owns the schema, the API layer owns the contract.

function mapSpace(s: any) {
  return {
    id: s.id,
    name: s.name,
    slug: s.slug,
    description: s.description,
    icon: s.icon,
    sortOrder: s.sort_order,
    isGlobal: s.is_global,
    createdAt: s.created_at,
    updatedAt: s.updated_at,
  };
}

function mapPage(p: any) {
  return {
    id: p.id,
    spaceId: p.space_id,
    parentPageId: p.parent_page_id ?? null,
    title: p.title,
    slug: p.slug,
    content: p.content,
    revision: p.revision,
    status: p.status,
    sortOrder: p.sort_order,
    isFavorite: p.is_favorite,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  };
}

function mapDraft(d: any) {
  return {
    id: d.id,
    pageId: d.page_id,
    title: d.title ?? "",
    slug: d.slug ?? "",
    content: d.content,
    baseRevision: d.base_revision ?? null,
    savedAt: d.saved_at,
  };
}

function mapVersion(v: any) {
  return {
    id: v.id,
    pageId: v.page_id,
    revision: v.revision,
    title: v.title,
    content: v.content,
    createdAt: v.created_at,
  };
}

function mapTag(t: any) {
  return { id: t.id, name: t.name, slug: t.slug };
}

function mapComment(c: any) {
  return {
    id: c.id,
    pageId: c.page_id,
    parentCommentId: c.parent_comment_id ?? null,
    content: c.content,
    selectionText: c.selection_text ?? "",
    selectionOffset: c.selection_offset ?? 0,
    resolved: c.resolved,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
  };
}

function mapAttachment(a: any) {
  return {
    id: a.id,
    pageId: a.page_id,
    filename: a.filename,
    originalName: a.original_name,
    mimeType: a.mime_type,
    sizeBytes: a.size_bytes,
    storagePath: a.storage_path,
    createdAt: a.created_at,
  };
}

function mapTemplate(t: any) {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    content: t.content,
    category: t.category,
    createdAt: t.created_at,
  };
}

function mapPageLink(l: any) {
  return {
    id: l.id,
    sourcePageId: l.source_page_id,
    targetPageId: l.target_page_id,
    linkText: l.link_text,
    sourceTitle: l.source_title,
    sourceSlug: l.source_slug,
  };
}

function mapProjectLink(l: any) {
  return {
    pageId: l.page_id,
    projectId: l.project_id,
    projectName: (l as any).project_name,
  };
}

function mapSearchResult(p: any) {
  return { ...mapPage(p), rank: p.rank };
}

function mapStats(s: any) {
  return s; // already camelCase-adjacent: StatCounts has no underscores
}

// ── Error Mapper ──────────────────────────────────────────────────────────────

function mapDocsError(err: docs.DocsError): { status: number; code: string } {
  const mapping: Record<docs.DocsErrorCode, { status: number; code: string }> = {
    CONTENT_TOO_LONG: { status: 413, code: "PAYLOAD_TOO_LARGE" },
    COMMENT_TOO_LONG: { status: 413, code: "PAYLOAD_TOO_LARGE" },
    SPACE_NOT_FOUND: { status: 404, code: "NOT_FOUND" },
    PAGE_NOT_FOUND: { status: 404, code: "NOT_FOUND" },
    COMMENT_NOT_FOUND: { status: 404, code: "NOT_FOUND" },
    TEMPLATE_NOT_FOUND: { status: 404, code: "NOT_FOUND" },
    ATTACHMENT_NOT_FOUND: { status: 404, code: "NOT_FOUND" },
    PARENT_NOT_FOUND: { status: 400, code: "BAD_REQUEST" },
    PARENT_CROSS_SPACE: { status: 409, code: "CONFLICT" },
    PARENT_ARCHIVED: { status: 400, code: "BAD_REQUEST" },
    PARENT_CYCLE: { status: 409, code: "CONFLICT" },
    PARENT_SELF: { status: 400, code: "BAD_REQUEST" },
    PROJECT_NOT_FOUND: { status: 404, code: "NOT_FOUND" },
    SLUG_CONFLICT: { status: 409, code: "CONFLICT" },
    REVISION_CONFLICT: { status: 409, code: "CONFLICT" },
  };
  return mapping[err.code] || { status: 500, code: "INTERNAL_ERROR" };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseIntParam(val: string | undefined, label: string, res: any): number | null {
  if (!val) {
    res.status(400).json({ error: { code: "BAD_REQUEST", message: `${label} is required` } });
    return null;
  }
  const n = Number(val);
  if (isNaN(n) || n <= 0 || !Number.isInteger(n)) {
    res.status(400).json({ error: { code: "BAD_REQUEST", message: `${label} must be a positive integer` } });
    return null;
  }
  return n;
}

/** Parse optional integer query param. Returns undefined if absent or invalid. */
function parseOptionalInt(val: string | undefined): number | undefined {
  if (!val) return undefined;
  const n = Number(val);
  if (isNaN(n) || n <= 0 || !Number.isInteger(n)) return undefined;
  return n;
}

function ingeniumHome(): string {
  return process.env.INGENIUM_HOME || resolve(process.env.HOME || "/home/appuser", ".ingenium");
}

function nowISO(): string {
  return new Date().toISOString();
}

// ── Router ────────────────────────────────────────────────────────────────────

/**
 * Documentation/wiki routes. This is the largest route file in the API (~90 routes).
 *
 * Route organization:
 *   /spaces            — space CRUD + scoped page routes
 *   /pages             — page CRUD, drafts, versions, tags, comments, attachments, backlinks
 *   /search            — FTS5 full-text search
 *   /tags              — tag listing
 *   /templates         — template CRUD
 *   /favorites         — favorite page listing
 *   /import            — markdown/JSON import
 *   /stats             — doc statistics
 *
 * 🔴 Static routes (/search, /tags, /pages?slug=, etc.) are registered before
 * dynamic :id routes so Express doesn't capture "search" as a page ID.
 * All route handlers wrap errors uniformly via mapDocsError().
 */
export const router = Router();

// ═══════════════════════════════════════════════════════════════════════════════
// STATIC ROUTES (registered before dynamic :id routes)
// ═══════════════════════════════════════════════════════════════════════════════

// ── SPACES ────────────────────────────────────────────────────────────────────

// GET /spaces — list all spaces OR lookup by slug
router.get("/spaces", (_req, res) => {
  try {
    // Slug lookup: GET /spaces?slug=...
    const slug = _req.query.slug as string | undefined;
    if (slug) {
      const space = docs.getSpaceBySlug(slug);
      if (!space) {
        res.status(404).json({ error: { code: "NOT_FOUND", message: `Space with slug '${slug}' not found` } });
        return;
      }
      res.json({ data: mapSpace(space) });
      return;
    }

    const spaces = docs.listSpaces();
    if (spaces.length === 0) {
      docs.createSpace("Personal", "personal", "Your personal documentation space", "user");
      const created = docs.listSpaces();
      res.json({ data: created.map(mapSpace), total: created.length });
      return;
    }
    res.json({ data: spaces.map(mapSpace), total: spaces.length });
  } catch (err: any) {
    if (err.code && err.message) {
      const mapped = mapDocsError(err as docs.DocsError);
      res.status(mapped.status).json({ error: { code: mapped.code, message: err.message } });
      return;
    }
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// ── SEARCH ───────────────────────────────────────────────────────────────────

router.get("/search", (req, res) => {
  try {
    const query = req.query.q as string;
    if (!query) {
      res.status(400).json({ error: { code: "BAD_REQUEST", message: "q parameter is required" } });
      return;
    }
    const spaceId = parseOptionalInt(req.query.spaceId as string);
    const results = docs.searchPages(query, spaceId);
    res.json({ data: results.map(mapSearchResult), total: results.length });
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// ── TAGS ─────────────────────────────────────────────────────────────────────

router.get("/tags", (_req, res) => {
  try {
    const tags = docs.listAllTags();
    res.json({ data: tags.map(mapTag), total: tags.length });
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// ── TEMPLATES ────────────────────────────────────────────────────────────────

router.get("/templates", (_req, res) => {
  try {
    const templates = docs.listTemplates();
    res.json({ data: templates.map(mapTemplate), total: templates.length });
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

router.post("/templates", (req, res) => {
  try {
    const { name, content, description, category } = req.body;
    if (!name || content === undefined) {
      res.status(400).json({ error: { code: "BAD_REQUEST", message: "name and content are required" } });
      return;
    }
    const template = docs.createTemplate(name, content, description, category);
    res.status(201).json({ data: mapTemplate(template) });
  } catch (err: any) {
    if (err.message?.includes("UNIQUE")) {
      res.status(409).json({ error: { code: "CONFLICT", message: "Template name already exists" } });
      return;
    }
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// ── FAVORITES ────────────────────────────────────────────────────────────────

router.get("/favorites", (_req, res) => {
  try {
    const favs = docs.listFavorites();
    res.json({ data: favs.map(mapPage), total: favs.length });
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// ── IMPORT ───────────────────────────────────────────────────────────────────
// 🔴 MAX_IMPORT_SIZE is enforced at the serialization level (before any parsing),
// not the raw body level, because the wire format differs from the storage format.

router.post("/import", (req, res) => {
  try {
    const { spaceId, format, data } = req.body;
    if (!spaceId || !format || !data) {
      res.status(400).json({ error: { code: "BAD_REQUEST", message: "spaceId, format, and data are required" } });
      return;
    }

    const sid = Number(spaceId);
    if (isNaN(sid) || sid <= 0 || !Number.isInteger(sid)) {
      res.status(400).json({ error: { code: "BAD_REQUEST", message: "spaceId must be a positive integer" } });
      return;
    }

    // Serialize to measure import payload size — deserialization would be too lenient
    const serialized = JSON.stringify(data);
    if (Buffer.byteLength(serialized) > MAX_IMPORT_SIZE) {
      res.status(413).json({ error: { code: "PAYLOAD_TOO_LARGE", message: "Import data exceeds maximum size" } });
      return;
    }

    let pages: docs.ImportPageEntry[] = [];
    if (format === "markdown") {
      pages = data as docs.ImportPageEntry[];
    } else if (format === "json") {
      pages = (data as any[]).map((p: any) => ({
        title: p.title,
        slug: p.slug,
        content: p.content || "",
        parentSlug: p.parentSlug,
      }));
    } else {
      res.status(400).json({ error: { code: "BAD_REQUEST", message: `Unsupported format: ${format}` } });
      return;
    }

    const space = docs.getSpace(sid);
    if (!space) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: `Space ${sid} not found` } });
      return;
    }

    const imported = docs.importPages(sid, pages);
    res.status(201).json({ data: imported.map(mapPage), total: imported.length });
  } catch (err: any) {
    if (err.code && err.message) {
      const mapped = mapDocsError(err as docs.DocsError);
      res.status(mapped.status).json({ error: { code: mapped.code, message: err.message } });
      return;
    }
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// ── STATS ────────────────────────────────────────────────────────────────────

router.get("/stats", (_req, res) => {
  try {
    const stats = docs.getDocStats();
    res.json({ data: mapStats(stats) });
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// ── PAGES (slug lookup) ──────────────────────────────────────────────────────

// GET /pages?spaceId=&slug= — lookup page by slug within space
// Must be registered before GET /pages/:id
router.get("/pages", (req, res) => {
  try {
    const spaceId = parseOptionalInt(req.query.spaceId as string);
    const slug = req.query.slug as string | undefined;

    if (!spaceId || !slug) {
      res.status(400).json({ error: { code: "BAD_REQUEST", message: "spaceId and slug query parameters are required" } });
      return;
    }

    const page = docs.getPageBySlug(spaceId, slug);
    if (!page) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: `Page with slug '${slug}' not found in space ${spaceId}` } });
      return;
    }
    res.json({ data: mapPage(page) });
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});


function mapTree(node: any): any {
  return {
    ...mapPage(node),
    children: (node.children || []).map(mapTree),
  };
}


// ═══════════════════════════════════════════════════════════════════════════════
// SPACE DYNAMIC ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// GET /spaces/:id
router.get("/spaces/:id", (req, res) => {
  try {
    const id = parseIntParam(req.params.id, "Space ID", res);
    if (id === null) return;
    const space = docs.getSpace(id);
    if (!space) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: `Space ${id} not found` } });
      return;
    }
    res.json({ data: mapSpace(space) });
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// POST /spaces
router.post("/spaces", (req, res) => {
  try {
    const { name, slug, description, icon } = req.body;
    if (!name || !slug) {
      res.status(400).json({ error: { code: "BAD_REQUEST", message: "name and slug are required" } });
      return;
    }
    const space = docs.createSpace(name, slug, description, icon);
    res.status(201).json({ data: mapSpace(space) });
  } catch (err: any) {
    if (err.message?.includes("UNIQUE")) {
      res.status(409).json({ error: { code: "CONFLICT", message: err.message } });
      return;
    }
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// PUT /spaces/:id
router.put("/spaces/:id", (req, res) => {
  try {
    const id = parseIntParam(req.params.id, "Space ID", res);
    if (id === null) return;
    const { name, slug, description, icon, sort_order } = req.body;
    const updated = docs.updateSpace(id, { name, slug, description, icon, sort_order });
    if (!updated) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: `Space ${id} not found` } });
      return;
    }
    res.json({ data: mapSpace(updated) });
  } catch (err: any) {
    if (err.message?.includes("UNIQUE")) {
      res.status(409).json({ error: { code: "CONFLICT", message: err.message } });
      return;
    }
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// DELETE /spaces/:id
router.delete("/spaces/:id", (req, res) => {
  try {
    const id = parseIntParam(req.params.id, "Space ID", res);
    if (id === null) return;
    const deleted = docs.deleteSpace(id);
    if (!deleted) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: `Space ${id} not found` } });
      return;
    }
    res.status(204).send();
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// ── SPACE-SCOPED PAGES ──────────────────────────────────────────────────────

// GET /spaces/:spaceId/pages
router.get("/spaces/:spaceId/pages", (req, res) => {
  try {
    const spaceId = parseIntParam(req.params.spaceId, "Space ID", res);
    if (spaceId === null) return;
    const statusFilter = req.query.status as string | undefined;
    const pages = docs.listPages(spaceId, statusFilter);
    res.json({ data: pages.map(mapPage), total: pages.length });
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// GET /spaces/:spaceId/tree
router.get("/spaces/:spaceId/tree", (req, res) => {
  try {
    const spaceId = parseIntParam(req.params.spaceId, "Space ID", res);
    if (spaceId === null) return;
    const tree = docs.getPageTree(spaceId);
    res.json({ data: tree.map(mapTree) });
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// POST /spaces/:spaceId/pages — create page
router.post("/spaces/:spaceId/pages", (req, res) => {
  try {
    const spaceId = parseIntParam(req.params.spaceId, "Space ID", res);
    if (spaceId === null) return;
    const { title, slug, content, parentPageId } = req.body;
    if (!title || !slug) {
      res.status(400).json({ error: { code: "BAD_REQUEST", message: "title and slug are required" } });
      return;
    }

    // Slug uniqueness check
    if (docs.slugExists(spaceId, slug)) {
      res.status(409).json({ error: { code: "CONFLICT", message: `Slug '${slug}' already exists in this space` } });
      return;
    }

    const result = docs.createPage(spaceId, title, slug, content, parentPageId);
    if (result.error) {
      const mapped = mapDocsError(result.error);
      res.status(mapped.status).json({ error: { code: mapped.code, message: result.error.message } });
      return;
    }
    res.status(201).json({ data: mapPage(result.page) });
  } catch (err: any) {
    if (err.message?.includes("UNIQUE")) {
      res.status(409).json({ error: { code: "CONFLICT", message: "A page with that slug already exists" } });
      return;
    }
    if (err.code && err.message) {
      const mapped = mapDocsError(err as docs.DocsError);
      res.status(mapped.status).json({ error: { code: mapped.code, message: err.message } });
      return;
    }
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// ── SPACE TRASH ──────────────────────────────────────────────────────────────

// GET /spaces/:spaceId/trash — list archived pages in space
router.get("/spaces/:spaceId/trash", (req, res) => {
  try {
    const spaceId = parseIntParam(req.params.spaceId, "Space ID", res);
    if (spaceId === null) return;
    const archived = docs.listArchivedPages(spaceId);
    res.json({ data: archived.map(mapPage), total: archived.length });
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// DELETE /spaces/:spaceId/trash — purge all archived pages in space
router.delete("/spaces/:spaceId/trash", (req, res) => {
  try {
    const spaceId = parseIntParam(req.params.spaceId, "Space ID", res);
    if (spaceId === null) return;
    docs.purgeArchivedPages(spaceId);
    res.status(204).send();
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// ── SPACE EXPORT ─────────────────────────────────────────────────────────────

// GET /spaces/:spaceId/export
router.get("/spaces/:spaceId/export", (req, res) => {
  try {
    const spaceId = parseIntParam(req.params.spaceId, "Space ID", res);
    if (spaceId === null) return;
    const exportData = docs.exportSpace(spaceId);
    if (!exportData) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: `Space ${spaceId} not found` } });
      return;
    }
    res.json({
      data: {
        space: mapSpace(exportData.space),
        pages: exportData.pages.map(mapPage),
        tree: exportData.tree.map((n: any) => mapTree(n)),
        tags: exportData.tags.map((t: any) => ({ pageId: t.pageId, tags: t.tags.map(mapTag) })),
        versions: exportData.versions.map(mapVersion),
        comments: exportData.comments.map(mapComment),
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// PAGE DYNAMIC ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// GET /pages/:id
router.get("/pages/:id", (req, res) => {
  try {
    const id = parseIntParam(req.params.id, "Page ID", res);
    if (id === null) return;
    const page = docs.getPage(id);
    if (!page) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: `Page ${id} not found` } });
      return;
    }
    res.json({ data: mapPage(page) });
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// PUT /pages/:id — update page
router.put("/pages/:id", (req, res) => {
  try {
    const id = parseIntParam(req.params.id, "Page ID", res);
    if (id === null) return;
    const { title, slug, content, expectedRevision, expected_revision } = req.body;

    // Accept both camelCase and snake_case for backward compatibility
    const revision = expectedRevision ?? expected_revision;

    // If slug is being changed, check uniqueness
    if (slug) {
      const existing = docs.getPage(id);
      if (existing && slug !== existing.slug && docs.slugExists(existing.space_id, slug, id)) {
        res.status(409).json({ error: { code: "CONFLICT", message: `Slug '${slug}' already exists in this space` } });
        return;
      }
    }

    const result = docs.updatePage(id, { title, slug, content, expectedRevision: revision });

    if (result.error) {
      const mapped = mapDocsError(result.error);
      res.status(mapped.status).json({ error: { code: mapped.code, message: result.error.message } });
      return;
    }
    if (result.conflict) {
      res.status(409).json({ error: { code: "CONFLICT", message: "Page was modified since last read", currentRevision: result.currentRevision } });
      return;
    }
    if (!result.page) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: `Page ${id} not found` } });
      return;
    }
    res.json({ data: mapPage(result.page) });
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// DELETE /pages/:id — archive page (soft delete)
router.delete("/pages/:id", (req, res) => {
  try {
    const id = parseIntParam(req.params.id, "Page ID", res);
    if (id === null) return;
    const deleted = docs.archivePage(id);
    if (!deleted) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: `Page ${id} not found or already archived` } });
      return;
    }
    res.status(204).send();
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// POST /pages/:id/restore — restore archived page
router.post("/pages/:id/restore", (req, res) => {
  try {
    const id = parseIntParam(req.params.id, "Page ID", res);
    if (id === null) return;
    const page = docs.restorePage(id);
    if (!page) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: `Page ${id} not found or not archived` } });
      return;
    }
    res.json({ data: mapPage(page) });
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// POST /pages/:id/move — move page
router.post("/pages/:id/move", (req, res) => {
  try {
    const id = parseIntParam(req.params.id, "Page ID", res);
    if (id === null) return;
    const { newParentId, newSortOrder } = req.body;
    const result = docs.movePage(id, newParentId ?? null, newSortOrder);
    if (result.error) {
      const mapped = mapDocsError(result.error);
      res.status(mapped.status).json({ error: { code: mapped.code, message: result.error.message } });
      return;
    }
    if (!result.page) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: `Page ${id} not found` } });
      return;
    }
    res.json({ data: mapPage(result.page) });
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});


// ── PUBLISH ──────────────────────────────────────────────────────────────────

// POST /pages/:id/publish — publish a draft page
router.post("/pages/:id/publish", (req, res) => {
  try {
    const id = parseIntParam(req.params.id, "Page ID", res);
    if (id === null) return;
    const { expectedRevision } = req.body;
    const result = docs.publishPage(id, expectedRevision);

    if (result.error) {
      const mapped = mapDocsError(result.error);
      res.status(mapped.status).json({ error: { code: mapped.code, message: result.error.message } });
      return;
    }
    if (result.conflict) {
      res.status(409).json({ error: { code: "CONFLICT", message: "Page was modified since last read", currentRevision: result.currentRevision } });
      return;
    }
    if (!result.page) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: `Page ${id} not found` } });
      return;
    }
    res.json({ data: mapPage(result.page) });
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// ── DRAFTS ───────────────────────────────────────────────────────────────────

// GET /pages/:id/draft
router.get("/pages/:id/draft", (req, res) => {
  try {
    const id = parseIntParam(req.params.id, "Page ID", res);
    if (id === null) return;
    const draft = docs.getDraft(id);
    if (!draft) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: `No draft found for page ${id}` } });
      return;
    }
    res.json({ data: mapDraft(draft) });
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// PUT /pages/:id/draft — save/update draft
router.put("/pages/:id/draft", (req, res) => {
  try {
    const id = parseIntParam(req.params.id, "Page ID", res);
    if (id === null) return;
    const { content, title, slug, baseRevision } = req.body;
    if (content === undefined) {
      res.status(400).json({ error: { code: "BAD_REQUEST", message: "content is required" } });
      return;
    }
    const draft = docs.saveDraft(id, content, title, slug, baseRevision);
    res.json({ data: mapDraft(draft) });
  } catch (err: any) {
    if (err.code && err.message) {
      // map CONTENT_TOO_LONG → 413
      if ((err as docs.DocsError).code === "CONTENT_TOO_LONG") {
        res.status(413).json({ error: { code: "PAYLOAD_TOO_LARGE", message: err.message } });
        return;
      }
    }
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// DELETE /pages/:id/draft — delete draft
router.delete("/pages/:id/draft", (req, res) => {
  try {
    const id = parseIntParam(req.params.id, "Page ID", res);
    if (id === null) return;
    const deleted = docs.deleteDraft(id);
    if (!deleted) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: `No draft found for page ${id}` } });
      return;
    }
    res.status(204).send();
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// ── VERSIONS ─────────────────────────────────────────────────────────────────

// GET /pages/:id/versions
router.get("/pages/:id/versions", (req, res) => {
  try {
    const id = parseIntParam(req.params.id, "Page ID", res);
    if (id === null) return;
    const versions = docs.listVersions(id);
    res.json({ data: versions.map(mapVersion), total: versions.length });
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// GET /pages/:id/versions/:versionId
router.get("/pages/:id/versions/:versionId", (req, res) => {
  try {
    const pageId = parseIntParam(req.params.id, "Page ID", res);
    if (pageId === null) return;
    const versionId = parseIntParam(req.params.versionId, "Version ID", res);
    if (versionId === null) return;
    const version = docs.getVersion(versionId);
    if (!version || version.page_id !== pageId) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: `Version ${versionId} not found for page ${pageId}` } });
      return;
    }
    res.json({ data: mapVersion(version) });
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// POST /pages/:id/restore/:versionId — restore to version
// Note: this uses /pages/:id/restore/:versionId but docs-restore is also at /pages/:id/restore
// Express will match /restore/:versionId before /restore (since :versionId is more specific)
// So we need to handle both. The /pages/:id/restore route handles restore from archive (no params).
// This route restores from a specific version.
router.post("/pages/:id/restore/:versionId", (req, res) => {
  try {
    const pageId = parseIntParam(req.params.id, "Page ID", res);
    if (pageId === null) return;
    const versionId = parseIntParam(req.params.versionId, "Version ID", res);
    if (versionId === null) return;
    const page = docs.restoreVersion(pageId, versionId);
    if (!page) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Page or version not found" } });
      return;
    }
    res.json({ data: mapPage(page) });
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// ── PAGE TAGS ────────────────────────────────────────────────────────────────

// GET /pages/:id/tags
router.get("/pages/:id/tags", (req, res) => {
  try {
    const id = parseIntParam(req.params.id, "Page ID", res);
    if (id === null) return;
    const tags = docs.getPageTags(id);
    res.json({ data: tags.map(mapTag) });
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// POST /pages/:id/tags — add tag
router.post("/pages/:id/tags", (req, res) => {
  try {
    const id = parseIntParam(req.params.id, "Page ID", res);
    if (id === null) return;
    // Accept both camelCase 'tagName' and 'name' for backward compat
    const tagName = req.body.tagName || req.body.name;
    if (!tagName) {
      res.status(400).json({ error: { code: "BAD_REQUEST", message: "tagName is required" } });
      return;
    }
    const tag = docs.addTag(id, tagName);
    if (!tag) {
      res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to add tag" } });
      return;
    }
    res.status(201).json({ data: mapTag(tag) });
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// DELETE /pages/:id/tags/:tagId — remove tag
router.delete("/pages/:id/tags/:tagId", (req, res) => {
  try {
    const pageId = parseIntParam(req.params.id, "Page ID", res);
    if (pageId === null) return;
    const tagId = parseIntParam(req.params.tagId, "Tag ID", res);
    if (tagId === null) return;
    const removed = docs.removeTag(pageId, tagId);
    if (!removed) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Tag not found on page" } });
      return;
    }
    res.status(204).send();
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// ── BACKLINKS ────────────────────────────────────────────────────────────────

// GET /pages/:id/backlinks
router.get("/pages/:id/backlinks", (req, res) => {
  try {
    const id = parseIntParam(req.params.id, "Page ID", res);
    if (id === null) return;
    const backlinks = docs.getBacklinks(id);
    res.json({ data: backlinks.map(mapPageLink), total: backlinks.length });
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// ── COMMENTS ─────────────────────────────────────────────────────────────────

// GET /pages/:id/comments
router.get("/pages/:id/comments", (req, res) => {
  try {
    const id = parseIntParam(req.params.id, "Page ID", res);
    if (id === null) return;
    const comments = docs.listComments(id);
    res.json({ data: comments.map(mapComment), total: comments.length });
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// POST /pages/:id/comments — create comment
router.post("/pages/:id/comments", (req, res) => {
  try {
    const id = parseIntParam(req.params.id, "Page ID", res);
    if (id === null) return;
    const { content, parentCommentId, selectionText, selectionOffset } = req.body;
    if (!content) {
      res.status(400).json({ error: { code: "BAD_REQUEST", message: "content is required" } });
      return;
    }
    const result = docs.createComment(id, content, parentCommentId, selectionText, selectionOffset);
    if (result.error) {
      const mapped = mapDocsError(result.error);
      res.status(mapped.status).json({ error: { code: mapped.code, message: result.error.message } });
      return;
    }
    res.status(201).json({ data: mapComment(result.comment) });
  } catch (err: any) {
    if (err.code && err.message) {
      const mapped = mapDocsError(err as docs.DocsError);
      res.status(mapped.status).json({ error: { code: mapped.code, message: err.message } });
      return;
    }
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// PUT /pages/:id/comments/:commentId — update comment body
// Ownership verified via listComments; direct DB used for the update itself
router.put("/pages/:id/comments/:commentId", (req, res) => {
  try {
    const pageId = parseIntParam(req.params.id, "Page ID", res);
    if (pageId === null) return;
    const commentId = parseIntParam(req.params.commentId, "Comment ID", res);
    if (commentId === null) return;

    const { content } = req.body;
    if (!content) {
      res.status(400).json({ error: { code: "BAD_REQUEST", message: "content is required" } });
      return;
    }

    // Verify comment belongs to this page using the docs module
    const pageComments = docs.listComments(pageId);
    const existing = pageComments.find((c: any) => c.id === commentId);
    if (!existing) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: `Comment ${commentId} not found for page ${pageId}` } });
      return;
    }

    // Perform the update via direct DB
    const dbPath = process.env.INGENIUM_CORE_DB_PATH || "./.ingenium/data.db";
    execTransaction(() => {
      const db = getDb(dbPath);
      db.prepare("UPDATE docs_comments SET content = ?, updated_at = ? WHERE id = ?")
        .run(content, nowISO(), commentId);
    });
    checkpointAfterWrite();

    const db = getDb(dbPath);
    const updated = db.prepare("SELECT * FROM docs_comments WHERE id = ?").get(commentId);
    res.json({ data: mapComment(updated) });
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// PUT /pages/:id/comments/:commentId/resolve — resolve comment (toggle)
router.put("/pages/:id/comments/:commentId/resolve", (req, res) => {
  try {
    const pageId = parseIntParam(req.params.id, "Page ID", res);
    if (pageId === null) return;
    const commentId = parseIntParam(req.params.commentId, "Comment ID", res);
    if (commentId === null) return;

    // Verify comment belongs to page
    const pageComments = docs.listComments(pageId);
    const existing = pageComments.find((c: any) => c.id === commentId);
    if (!existing) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: `Comment ${commentId} not found for page ${pageId}` } });
      return;
    }

    const comment = docs.resolveComment(commentId);
    if (!comment) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: `Comment ${commentId} not found` } });
      return;
    }
    res.json({ data: mapComment(comment) });
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// DELETE /pages/:id/comments/:commentId — delete comment
router.delete("/pages/:id/comments/:commentId", (req, res) => {
  try {
    const pageId = parseIntParam(req.params.id, "Page ID", res);
    if (pageId === null) return;
    const commentId = parseIntParam(req.params.commentId, "Comment ID", res);
    if (commentId === null) return;

    // Verify comment belongs to page
    const pageComments = docs.listComments(pageId);
    const existing = pageComments.find((c: any) => c.id === commentId);
    if (!existing) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: `Comment ${commentId} not found for page ${pageId}` } });
      return;
    }

    const deleted = docs.deleteComment(commentId);
    if (!deleted) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: `Comment ${commentId} not found` } });
      return;
    }
    res.status(204).send();
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// ── ATTACHMENTS ──────────────────────────────────────────────────────────────

// GET /pages/:id/attachments
router.get("/pages/:id/attachments", (req, res) => {
  try {
    const id = parseIntParam(req.params.id, "Page ID", res);
    if (id === null) return;
    const attachments = docs.listAttachments(id);
    res.json({ data: attachments.map(mapAttachment), total: attachments.length });
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// POST /pages/:id/attachments — upload attachment (multipart)
router.post("/pages/:id/attachments", async (req, res) => {
  try {
    const pageId = parseIntParam(req.params.id, "Page ID", res);
    if (pageId === null) return;

    // Verify page exists
    const page = docs.getPage(pageId);
    if (!page) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: `Page ${pageId} not found` } });
      return;
    }

    const form = formidable({
      maxFileSize: MAX_ATTACHMENT_SIZE,
      maxFiles: 10,
    });

    const [, files] = await form.parse(req);
    const fileField = Object.values(files)[0] as any;
    const uploadedFile = Array.isArray(fileField) ? fileField[0] : fileField;

    if (!uploadedFile) {
      res.status(400).json({ error: { code: "BAD_REQUEST", message: "No file uploaded" } });
      return;
    }

    // SECURITY: MIME type allowlist prevents arbitrary file uploads (no .exe, .js, .sh, etc.)
    // These types cover documentation-relevant formats: images, PDFs, text, office docs, archives
    const ALLOWED_MIMES = new Set([
      "image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml",
      "application/pdf", "text/plain", "text/csv", "text/markdown",
      "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/zip", "application/json",
    ]);
    const mimeType = uploadedFile.mimetype || "application/octet-stream";
    if (!ALLOWED_MIMES.has(mimeType)) {
      res.status(415).json({ error: { code: "UNSUPPORTED_MEDIA_TYPE", message: `File type '${mimeType}' is not allowed` } });
      return;
    }

    const originalName = uploadedFile.originalFilename || "untitled";
    const uuid = randomUUID();
    const ext = extname(originalName);
    const filename = `${uuid}${ext}`;

    const storageDir = resolve(ingeniumHome(), "attachments", String(pageId));
    if (!existsSync(storageDir)) {
      mkdirSync(storageDir, { recursive: true });
    }

    const storagePath = resolve(storageDir, filename);

    // Move temp file to final location
    const { copyFileSync } = await import("node:fs");
    copyFileSync(uploadedFile.filepath, storagePath);
    try { unlinkSync(uploadedFile.filepath); } catch { /* ignore */ }

    const att = docs.saveAttachment(
      pageId,
      filename,
      originalName,
      uploadedFile.mimetype || "application/octet-stream",
      uploadedFile.size || 0,
      `attachments/${pageId}/${filename}`,
    );

    res.status(201).json({ data: mapAttachment(att) });
  } catch (err: any) {
    if (err.message?.includes("maxFileSize")) {
      res.status(413).json({ error: { code: "PAYLOAD_TOO_LARGE", message: "File exceeds maximum attachment size" } });
      return;
    }
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// GET /pages/:id/attachments/:attId/download — download attachment
router.get("/pages/:id/attachments/:attId/download", (req, res) => {
  try {
    const pageId = parseIntParam(req.params.id, "Page ID", res);
    if (pageId === null) return;
    const attId = parseIntParam(req.params.attId, "Attachment ID", res);
    if (attId === null) return;

    const att = docs.getAttachment(attId);
    if (!att) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: `Attachment ${attId} not found` } });
      return;
    }

    // Ownership check
    if (att.page_id !== pageId) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: `Attachment ${attId} not found for page ${pageId}` } });
      return;
    }

    // SECURITY: resolved-root containment check — prevent path traversal
    // We resolve symlinks via realpathSync() then verify the resolved path is
    // still under the attachments root. This catches both ".." traversal and
    // symlink-based escapes.
    const attachmentsRoot = resolve(ingeniumHome(), "attachments");
    const filePath = resolve(ingeniumHome(), att.storage_path);

    let realPath: string;
    try {
      realPath = realpathSync(filePath);
    } catch {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Attachment file not found on disk" } });
      return;
    }

    if (!realPath.startsWith(attachmentsRoot + sep) && realPath !== attachmentsRoot) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Attachment not found" } });
      return;
    }

    if (!existsSync(filePath)) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Attachment file not found on disk" } });
      return;
    }

    // SECURITY: Content-Disposition forces download (not inline render) and
    // escapes double-quotes in the filename to prevent header injection
    const safeMimeType = att.mime_type || "application/octet-stream";
    const safeFilename = basename(att.original_name || att.filename || "download");
    res.setHeader("Content-Type", safeMimeType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${safeFilename.replace(/"/g, '\\"')}"`,
    );
    res.setHeader("Content-Length", att.size_bytes || statSync(filePath).size);

    // Stream instead of read-into-memory to handle large files without OOM
    const stream = createReadStream(filePath);
    stream.on("error", () => {
      // headersSent check: if the stream errors mid-pipe, headers are already sent
      if (!res.headersSent) {
        res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to read attachment" } });
      }
    });
    stream.pipe(res);
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// DELETE /pages/:id/attachments/:attId — delete attachment
router.delete("/pages/:id/attachments/:attId", (req, res) => {
  try {
    const pageId = parseIntParam(req.params.id, "Page ID", res);
    if (pageId === null) return;
    const attId = parseIntParam(req.params.attId, "Attachment ID", res);
    if (attId === null) return;

    // Verify attachment belongs to page before deleting
    const att = docs.getAttachment(attId);
    if (!att || att.page_id !== pageId) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: `Attachment ${attId} not found for page ${pageId}` } });
      return;
    }

    const deleted = docs.deleteAttachment(attId);
    if (!deleted) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: `Attachment ${attId} not found` } });
      return;
    }

    // Remove file from disk
    const filePath = resolve(ingeniumHome(), deleted.storage_path);
    try { if (existsSync(filePath)) unlinkSync(filePath); } catch { /* ignore */ }

    res.status(204).send();
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// ── PROJECT LINKS ────────────────────────────────────────────────────────────

// GET /pages/:id/projects
router.get("/pages/:id/projects", (req, res) => {
  try {
    const id = parseIntParam(req.params.id, "Page ID", res);
    if (id === null) return;
    const projects = docs.getLinkedProjects(id);
    res.json({ data: projects.map(mapProjectLink) });
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// POST /pages/:id/projects — link page to project
router.post("/pages/:id/projects", (req, res) => {
  try {
    const id = parseIntParam(req.params.id, "Page ID", res);
    if (id === null) return;
    const { projectId } = req.body;
    if (!projectId) {
      res.status(400).json({ error: { code: "BAD_REQUEST", message: "projectId is required" } });
      return;
    }
    const link = docs.linkProject(id, String(projectId));
    res.status(201).json({ data: mapProjectLink(link) });
  } catch (err: any) {
    if (err.code && err.message) {
      const mapped = mapDocsError(err as docs.DocsError);
      res.status(mapped.status).json({ error: { code: mapped.code, message: err.message } });
      return;
    }
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});


// DELETE /pages/:id/projects/:projectId — unlink
router.delete("/pages/:id/projects/:projectId", (req, res) => {
  try {
    const pageId = parseIntParam(req.params.id, "Page ID", res);
    if (pageId === null) return;
    const projectId = req.params.projectId;
    if (!projectId) {
      res.status(400).json({ error: { code: "BAD_REQUEST", message: "projectId is required" } });
      return;
    }
    const removed = docs.unlinkProject(pageId, projectId);
    if (!removed) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Project link not found" } });
      return;
    }
    res.status(204).send();
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// ── FAVORITES ────────────────────────────────────────────────────────────────

// POST /pages/:id/favorite — toggle favorite
router.post("/pages/:id/favorite", (req, res) => {
  try {
    const id = parseIntParam(req.params.id, "Page ID", res);
    if (id === null) return;
    const page = docs.toggleFavorite(id);
    if (!page) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: `Page ${id} not found` } });
      return;
    }
    res.json({ data: mapPage(page) });
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// ── TEMPLATES (DYNAMIC) ──────────────────────────────────────────────────────

// GET /templates/:id
router.get("/templates/:id", (req, res) => {
  try {
    const id = parseIntParam(req.params.id, "Template ID", res);
    if (id === null) return;
    const template = docs.getTemplate(id);
    if (!template) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: `Template ${id} not found` } });
      return;
    }
    res.json({ data: mapTemplate(template) });
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// PUT /templates/:id — update template
router.put("/templates/:id", (req, res) => {
  try {
    const id = parseIntParam(req.params.id, "Template ID", res);
    if (id === null) return;
    const { name, content, description, category } = req.body;
    const updated = docs.updateTemplate(id, { name, content, description, category });
    if (!updated) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: `Template ${id} not found` } });
      return;
    }
    res.json({ data: mapTemplate(updated) });
  } catch (err: any) {
    if (err.message?.includes("UNIQUE")) {
      res.status(409).json({ error: { code: "CONFLICT", message: "Template name already exists" } });
      return;
    }
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// DELETE /templates/:id
router.delete("/templates/:id", (req, res) => {
  try {
    const id = parseIntParam(req.params.id, "Template ID", res);
    if (id === null) return;
    const deleted = docs.deleteTemplate(id);
    if (!deleted) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: `Template ${id} not found` } });
      return;
    }
    res.status(204).send();
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});
