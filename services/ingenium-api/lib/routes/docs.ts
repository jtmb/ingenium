import { Router } from "express";
import { docs } from "ingenium-core";
import { MAX_ATTACHMENT_SIZE } from "ingenium-core";
import formidable from "formidable";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { resolve, extname } from "node:path";

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

function ingeniumHome(): string {
  return process.env.INGENIUM_HOME || resolve(process.env.HOME || "/home/appuser", ".ingenium");
}

export const router = Router();

// ── SPACES ───────────────────────────────────────────────────────────────────

// GET /spaces — list all spaces (auto-creates default "Personal" space if none exist)
router.get("/spaces", (_req, res) => {
  try {
    const spaces = docs.listSpaces();
    if (spaces.length === 0) {
      // Auto-create default space
      docs.createSpace("Personal", "personal", "Your personal documentation space", "user");
      const created = docs.listSpaces();
      res.json({ data: created, total: created.length });
      return;
    }
    res.json({ data: spaces, total: spaces.length });
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

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
    res.json({ data: space });
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// POST /spaces — create space
router.post("/spaces", (req, res) => {
  try {
    const { name, slug, description, icon } = req.body;
    if (!name || !slug) {
      res.status(400).json({ error: { code: "BAD_REQUEST", message: "name and slug are required" } });
      return;
    }
    const space = docs.createSpace(name, slug, description, icon);
    res.status(201).json({ data: space });
  } catch (err: any) {
    if (err.message?.includes("UNIQUE")) {
      res.status(409).json({ error: { code: "CONFLICT", message: err.message } });
      return;
    }
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// PUT /spaces/:id — update space
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
    res.json({ data: updated });
  } catch (err: any) {
    if (err.message?.includes("UNIQUE")) {
      res.status(409).json({ error: { code: "CONFLICT", message: err.message } });
      return;
    }
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// DELETE /spaces/:id — delete space
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

// ── PAGES ────────────────────────────────────────────────────────────────────

// GET /spaces/:spaceId/pages — list pages in space
router.get("/spaces/:spaceId/pages", (req, res) => {
  try {
    const spaceId = parseIntParam(req.params.spaceId, "Space ID", res);
    if (spaceId === null) return;
    const statusFilter = req.query.status as string | undefined;
    const pages = docs.listPages(spaceId, statusFilter);
    res.json({ data: pages, total: pages.length });
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// GET /spaces/:spaceId/tree — page tree
router.get("/spaces/:spaceId/tree", (req, res) => {
  try {
    const spaceId = parseIntParam(req.params.spaceId, "Space ID", res);
    if (spaceId === null) return;
    const tree = docs.getPageTree(spaceId);
    res.json({ data: tree });
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
    const page = docs.createPage(spaceId, title, slug, content, parentPageId);
    res.status(201).json({ data: page });
  } catch (err: any) {
    if (err.message?.includes("UNIQUE")) {
      res.status(409).json({ error: { code: "CONFLICT", message: "A page with that slug already exists" } });
      return;
    }
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// GET /pages/:id — get page
router.get("/pages/:id", (req, res) => {
  try {
    const id = parseIntParam(req.params.id, "Page ID", res);
    if (id === null) return;
    const page = docs.getPage(id);
    if (!page) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: `Page ${id} not found` } });
      return;
    }
    res.json({ data: page });
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// PUT /pages/:id — update page (with optimistic concurrency)
router.put("/pages/:id", (req, res) => {
  try {
    const id = parseIntParam(req.params.id, "Page ID", res);
    if (id === null) return;
    const { title, slug, content, expectedRevision } = req.body;

    // If slug is being changed, check uniqueness
    if (slug) {
      const existing = docs.getPage(id);
      if (existing && slug !== existing.slug && docs.slugExists(existing.space_id, slug, id)) {
        res.status(409).json({ error: { code: "CONFLICT", message: `Slug '${slug}' already exists in this space` } });
        return;
      }
    }

    const result = docs.updatePage(id, { title, slug, content, expectedRevision });

    if (result.conflict) {
      res.status(409).json({ error: { code: "CONFLICT", message: "Page was modified since last read", currentRevision: result.currentRevision } });
      return;
    }
    if (!result.page) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: `Page ${id} not found` } });
      return;
    }
    res.json({ data: result.page });
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
    res.json({ data: page });
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// POST /pages/:id/move — move page (reparent / reorder)
router.post("/pages/:id/move", (req, res) => {
  try {
    const id = parseIntParam(req.params.id, "Page ID", res);
    if (id === null) return;
    const { newParentId, newSortOrder } = req.body;
    const page = docs.movePage(id, newParentId ?? null, newSortOrder);
    if (!page) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: `Page ${id} not found` } });
      return;
    }
    res.json({ data: page });
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// ── DRAFTS ───────────────────────────────────────────────────────────────────

// GET /pages/:id/draft — get autosave draft
router.get("/pages/:id/draft", (req, res) => {
  try {
    const id = parseIntParam(req.params.id, "Page ID", res);
    if (id === null) return;
    const draft = docs.getDraft(id);
    if (!draft) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: `No draft found for page ${id}` } });
      return;
    }
    res.json({ data: draft });
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// PUT /pages/:id/draft — save/update draft
router.put("/pages/:id/draft", (req, res) => {
  try {
    const id = parseIntParam(req.params.id, "Page ID", res);
    if (id === null) return;
    const { content } = req.body;
    if (content === undefined) {
      res.status(400).json({ error: { code: "BAD_REQUEST", message: "content is required" } });
      return;
    }
    const draft = docs.saveDraft(id, content);
    res.json({ data: draft });
  } catch (err: any) {
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

// GET /pages/:id/versions — list versions
router.get("/pages/:id/versions", (req, res) => {
  try {
    const id = parseIntParam(req.params.id, "Page ID", res);
    if (id === null) return;
    const versions = docs.listVersions(id);
    res.json({ data: versions, total: versions.length });
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// GET /pages/:id/versions/:versionId — get specific version
router.get("/pages/:id/versions/:versionId", (req, res) => {
  try {
    const pageId = parseIntParam(req.params.id, "Page ID", res);
    if (pageId === null) return;
    const versionId = parseIntParam(req.params.versionId, "Version ID", res);
    if (versionId === null) return;
    const version = docs.getVersion(versionId);
    if (!version) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: `Version ${versionId} not found` } });
      return;
    }
    res.json({ data: version });
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// POST /pages/:id/restore/:versionId — restore to version
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
    res.json({ data: page });
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// ── SEARCH ───────────────────────────────────────────────────────────────────

// GET /search?q=...&spaceId=...
router.get("/search", (req, res) => {
  try {
    const query = req.query.q as string;
    if (!query) {
      res.status(400).json({ error: { code: "BAD_REQUEST", message: "q parameter is required" } });
      return;
    }
    const spaceId = req.query.spaceId ? parseInt(req.query.spaceId as string, 10) : undefined;
    if (req.query.spaceId && (isNaN(spaceId as number) || spaceId! <= 0)) {
      res.status(400).json({ error: { code: "BAD_REQUEST", message: "spaceId must be a positive integer" } });
      return;
    }
    const results = docs.searchPages(query, spaceId);
    res.json({ data: results, total: results.length });
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// ── TAGS ─────────────────────────────────────────────────────────────────────

// GET /tags — list all tags
router.get("/tags", (_req, res) => {
  try {
    const tags = docs.listAllTags();
    res.json({ data: tags, total: tags.length });
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// GET /pages/:id/tags — get tags for page
router.get("/pages/:id/tags", (req, res) => {
  try {
    const id = parseIntParam(req.params.id, "Page ID", res);
    if (id === null) return;
    const tags = docs.getPageTags(id);
    res.json({ data: tags });
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// POST /pages/:id/tags — add tag to page
router.post("/pages/:id/tags", (req, res) => {
  try {
    const id = parseIntParam(req.params.id, "Page ID", res);
    if (id === null) return;
    const { tagName } = req.body;
    if (!tagName) {
      res.status(400).json({ error: { code: "BAD_REQUEST", message: "tagName is required" } });
      return;
    }
    const tag = docs.addTag(id, tagName);
    res.status(201).json({ data: tag });
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// DELETE /pages/:id/tags/:tagId — remove tag from page
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
    res.json({ data: backlinks, total: backlinks.length });
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// ── COMMENTS ─────────────────────────────────────────────────────────────────

// GET /pages/:id/comments — list comments
router.get("/pages/:id/comments", (req, res) => {
  try {
    const id = parseIntParam(req.params.id, "Page ID", res);
    if (id === null) return;
    const comments = docs.listComments(id);
    res.json({ data: comments, total: comments.length });
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
    const comment = docs.createComment(id, content, parentCommentId, selectionText, selectionOffset);
    res.status(201).json({ data: comment });
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// PUT /pages/:id/comments/:commentId/resolve — resolve comment
router.put("/pages/:id/comments/:commentId/resolve", (req, res) => {
  try {
    const pageId = parseIntParam(req.params.id, "Page ID", res);
    if (pageId === null) return;
    const commentId = parseIntParam(req.params.commentId, "Comment ID", res);
    if (commentId === null) return;
    const comment = docs.resolveComment(commentId);
    if (!comment) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: `Comment ${commentId} not found` } });
      return;
    }
    res.json({ data: comment });
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
    res.json({ data: attachments, total: attachments.length });
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

    // formidable v3 uses arrays; get first file from the expected field name or any field
    const fileField = Object.values(files)[0] as any;
    const uploadedFile = Array.isArray(fileField) ? fileField[0] : fileField;

    if (!uploadedFile) {
      res.status(400).json({ error: { code: "BAD_REQUEST", message: "No file uploaded" } });
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
    // Clean up temp file
    try { unlinkSync(uploadedFile.filepath); } catch { /* ignore */ }

    const att = docs.saveAttachment(
      pageId,
      filename,
      originalName,
      uploadedFile.mimetype || "application/octet-stream",
      uploadedFile.size || 0,
      `attachments/${pageId}/${filename}`,
    );

    res.status(201).json({ data: att });
  } catch (err: any) {
    if (err.message?.includes("maxFileSize")) {
      res.status(413).json({ error: { code: "PAYLOAD_TOO_LARGE", message: "File exceeds maximum attachment size" } });
      return;
    }
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

    const att = docs.deleteAttachment(attId);
    if (!att) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: `Attachment ${attId} not found` } });
      return;
    }

    // Remove file from disk
    const filePath = resolve(ingeniumHome(), att.storage_path);
    try { if (existsSync(filePath)) unlinkSync(filePath); } catch { /* ignore */ }

    res.status(204).send();
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// ── TEMPLATES ────────────────────────────────────────────────────────────────

// GET /templates — list templates
router.get("/templates", (_req, res) => {
  try {
    const templates = docs.listTemplates();
    res.json({ data: templates, total: templates.length });
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// GET /templates/:id — get template
router.get("/templates/:id", (req, res) => {
  try {
    const id = parseIntParam(req.params.id, "Template ID", res);
    if (id === null) return;
    const template = docs.getTemplate(id);
    if (!template) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: `Template ${id} not found` } });
      return;
    }
    res.json({ data: template });
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// POST /templates — create template
router.post("/templates", (req, res) => {
  try {
    const { name, content, description, category } = req.body;
    if (!name || content === undefined) {
      res.status(400).json({ error: { code: "BAD_REQUEST", message: "name and content are required" } });
      return;
    }
    const template = docs.createTemplate(name, content, description, category);
    res.status(201).json({ data: template });
  } catch (err: any) {
    if (err.message?.includes("UNIQUE")) {
      res.status(409).json({ error: { code: "CONFLICT", message: "Template name already exists" } });
      return;
    }
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// DELETE /templates/:id — delete template
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

// ── PROJECT LINKS ────────────────────────────────────────────────────────────

// GET /pages/:id/projects — get linked projects
router.get("/pages/:id/projects", (req, res) => {
  try {
    const id = parseIntParam(req.params.id, "Page ID", res);
    if (id === null) return;
    const projects = docs.getLinkedProjects(id);
    res.json({ data: projects });
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
    const link = docs.linkProject(id, projectId);
    res.status(201).json({ data: link });
  } catch (err: any) {
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
    res.json({ data: page });
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// GET /favorites — list favorite pages
router.get("/favorites", (_req, res) => {
  try {
    const favs = docs.listFavorites();
    res.json({ data: favs, total: favs.length });
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// ── IMPORT / EXPORT ──────────────────────────────────────────────────────────

// POST /import — import pages
router.post("/import", (req, res) => {
  try {
    const { spaceId, format, data } = req.body;
    if (!spaceId || !format || !data) {
      res.status(400).json({ error: { code: "BAD_REQUEST", message: "spaceId, format, and data are required" } });
      return;
    }

    let pages: docs.ImportPageEntry[] = [];

    if (format === "markdown") {
      // data is an array of { title, slug, content, parentSlug? }
      pages = data as docs.ImportPageEntry[];
    } else if (format === "json") {
      // data is an array of page objects
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

    // Verify space exists
    const space = docs.getSpace(spaceId);
    if (!space) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: `Space ${spaceId} not found` } });
      return;
    }

    const imported = docs.importPages(spaceId, pages);
    res.status(201).json({ data: imported, total: imported.length });
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// GET /spaces/:spaceId/export — export space as JSON
router.get("/spaces/:spaceId/export", (req, res) => {
  try {
    const spaceId = parseIntParam(req.params.spaceId, "Space ID", res);
    if (spaceId === null) return;
    const exportData = docs.exportSpace(spaceId);
    if (!exportData) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: `Space ${spaceId} not found` } });
      return;
    }
    res.json({ data: exportData });
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// ── STATS ────────────────────────────────────────────────────────────────────

// GET /stats — get doc counts
router.get("/stats", (_req, res) => {
  try {
    const stats = docs.getDocStats();
    res.json({ data: stats });
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});
