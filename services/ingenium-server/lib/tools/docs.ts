/**
 * MCP tool handlers for Documentation module.
 * Each function calls the Ingenium API via HTTP and returns MCP-formatted results.
 * The server has ZERO database access — all data goes through the API layer.
 *
 * All paths match the canonical API routes registered in services/ingenium-api/lib/routes/docs.ts.
 */
import { api } from "../client.js";

// ── Spaces ──────────────────────────────────────────────

/** List all documentation spaces */
export async function docsListSpaces(project: string) {
  const res = await api.get("/docs/spaces", { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Get a documentation space by ID or slug */
export async function docsGetSpace(project: string, id?: number, slug?: string) {
  if (id) {
    const res = await api.get(`/docs/spaces/${id}`, { project });
    return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
  }
  const res = await api.get("/docs/spaces", { project, slug: slug! });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Create a new documentation space */
export async function docsCreateSpace(project: string, name: string, slug?: string, description?: string, icon?: string) {
  const res = await api.post("/docs/spaces", { name, slug, description, icon }, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Update a documentation space */
export async function docsUpdateSpace(project: string, id: number, name?: string, description?: string) {
  const res = await api.put(`/docs/spaces/${id}`, { name, description }, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Delete a documentation space */
export async function docsDeleteSpace(project: string, id: number) {
  const res = await api.del(`/docs/spaces/${id}`, { project });
  if (res.status === 204) {
    return { content: [{ type: "text" as const, text: "Space deleted" }] };
  }
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

// ── Pages ───────────────────────────────────────────────

/** List pages in a documentation space */
export async function docsListPages(project: string, spaceId: number, parentPageId?: number) {
  const params: Record<string, string> = { project };
  if (parentPageId) params.parentPageId = String(parentPageId);
  const res = await api.get(`/docs/spaces/${spaceId}/pages`, params);
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Get the page tree for a space */
export async function docsGetPageTree(project: string, spaceId: number) {
  const res = await api.get(`/docs/spaces/${spaceId}/tree`, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Get a documentation page by ID or slug */
export async function docsGetPage(project: string, id?: number, spaceId?: number, slug?: string) {
  if (id) {
    const res = await api.get(`/docs/pages/${id}`, { project });
    return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
  }
  const params: Record<string, string> = { project, slug: slug! };
  if (spaceId) params.spaceId = String(spaceId);
  const res = await api.get("/docs/pages", params);
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Create a new documentation page */
export async function docsCreatePage(project: string, spaceId: number, title: string, slug?: string, content?: string, parentPageId?: number) {
  const res = await api.post(`/docs/spaces/${spaceId}/pages`, { title, slug, content, parentPageId }, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Update a documentation page. Requires expectedRevision for optimistic concurrency. */
export async function docsUpdatePage(project: string, id: number, title?: string, slug?: string, content?: string, expectedRevision?: number) {
  const res = await api.put(`/docs/pages/${id}`, { title, slug, content, expectedRevision }, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Archive (soft-delete) a documentation page */
export async function docsDeletePage(project: string, id: number) {
  const res = await api.del(`/docs/pages/${id}`, { project });
  if (res.status === 204) {
    return { content: [{ type: "text" as const, text: "Page archived" }] };
  }
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Restore an archived documentation page */
export async function docsRestorePage(project: string, id: number) {
  const res = await api.post(`/docs/pages/${id}/restore`, {}, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Move a page to a different parent or position — POST /pages/:id/move */
export async function docsMovePage(project: string, id: number, newParentId?: number, newSortOrder?: number) {
  const res = await api.post(`/docs/pages/${id}/move`, { newParentId, newSortOrder }, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Publish a draft page — POST /pages/:id/publish */
export async function docsPublishPage(project: string, id: number, expectedRevision?: number) {
  const res = await api.post(`/docs/pages/${id}/publish`, { expectedRevision }, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

// ── Search ──────────────────────────────────────────────

/** Full-text search across documentation pages */
export async function docsSearch(project: string, query: string, spaceId?: number) {
  const params: Record<string, string> = { project, q: query };
  if (spaceId) params.spaceId = String(spaceId);
  const res = await api.get("/docs/search", params);
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

// ── Drafts ──────────────────────────────────────────────

/** Get the autosaved draft for a page */
export async function docsGetDraft(project: string, pageId: number) {
  const res = await api.get(`/docs/pages/${pageId}/draft`, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Save a draft for a documentation page */
export async function docsSaveDraft(project: string, pageId: number, content: string, title?: string, slug?: string, baseRevision?: number) {
  const res = await api.put(`/docs/pages/${pageId}/draft`, { content, title, slug, baseRevision }, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Delete a draft for a documentation page */
export async function docsDeleteDraft(project: string, pageId: number) {
  const res = await api.del(`/docs/pages/${pageId}/draft`, { project });
  if (res.status === 204) {
    return { content: [{ type: "text" as const, text: "Draft deleted" }] };
  }
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

// ── Versions ────────────────────────────────────────────

/** List version history for a page */
export async function docsListVersions(project: string, pageId: number) {
  const res = await api.get(`/docs/pages/${pageId}/versions`, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Get a specific version of a page — page-scoped: GET /pages/:pageId/versions/:versionId */
export async function docsGetVersion(project: string, pageId: number, versionId: number) {
  const res = await api.get(`/docs/pages/${pageId}/versions/${versionId}`, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Restore a page to a previous version — POST /pages/:pageId/restore/:versionId */
export async function docsRestoreVersion(project: string, pageId: number, versionId: number) {
  const res = await api.post(`/docs/pages/${pageId}/restore/${versionId}`, {}, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

// ── Comments ────────────────────────────────────────────

/** List comments on a documentation page */
export async function docsListComments(project: string, pageId: number) {
  const res = await api.get(`/docs/pages/${pageId}/comments`, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Add a comment to a documentation page */
export async function docsCreateComment(project: string, pageId: number, content: string, parentCommentId?: number, selectionText?: string, selectionOffset?: number) {
  const res = await api.post(`/docs/pages/${pageId}/comments`, { content, parentCommentId, selectionText, selectionOffset }, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Resolve a comment — PUT /pages/:pageId/comments/:commentId/resolve */
export async function docsResolveComment(project: string, pageId: number, commentId: number) {
  const res = await api.put(`/docs/pages/${pageId}/comments/${commentId}/resolve`, {}, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Delete a comment — DELETE /pages/:pageId/comments/:commentId */
export async function docsDeleteComment(project: string, pageId: number, commentId: number) {
  const res = await api.del(`/docs/pages/${pageId}/comments/${commentId}`, { project });
  if (res.status === 204) {
    return { content: [{ type: "text" as const, text: "Comment deleted" }] };
  }
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

// ── Tags ────────────────────────────────────────────────

/** List all tags */
export async function docsListTags(project: string) {
  const res = await api.get("/docs/tags", { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Get tags for a page */
export async function docsGetPageTags(project: string, pageId: number) {
  const res = await api.get(`/docs/pages/${pageId}/tags`, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Add a tag to a page — sends { tagName } */
export async function docsAddTag(project: string, pageId: number, tagName: string) {
  const res = await api.post(`/docs/pages/${pageId}/tags`, { tagName }, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Remove a tag from a page */
export async function docsRemoveTag(project: string, pageId: number, tagId: number) {
  const res = await api.del(`/docs/pages/${pageId}/tags/${tagId}`, { project });
  if (res.status === 204) {
    return { content: [{ type: "text" as const, text: "Tag removed" }] };
  }
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

// ── Backlinks ───────────────────────────────────────────

/** Get pages linking to this page */
export async function docsGetBacklinks(project: string, pageId: number) {
  const res = await api.get(`/docs/pages/${pageId}/backlinks`, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

// ── Attachments ─────────────────────────────────────────

/** List attachments on a page */
export async function docsListAttachments(project: string, pageId: number) {
  const res = await api.get(`/docs/pages/${pageId}/attachments`, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Delete an attachment — DELETE /pages/:pageId/attachments/:attId */
export async function docsDeleteAttachment(project: string, pageId: number, attachmentId: number) {
  const res = await api.del(`/docs/pages/${pageId}/attachments/${attachmentId}`, { project });
  if (res.status === 204) {
    return { content: [{ type: "text" as const, text: "Attachment deleted" }] };
  }
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Get attachment download metadata URL — GET /pages/:pageId/attachments/:attId/download */
export async function docsGetAttachmentDownload(project: string, pageId: number, attachmentId: number) {
  const apiBase = process.env.INGENIUM_API_URL ?? "http://localhost:4097/api/v1";
  const url = `${apiBase}/docs/pages/${pageId}/attachments/${attachmentId}/download?project=${encodeURIComponent(project)}`;
  return { content: [{ type: "text" as const, text: JSON.stringify({ downloadUrl: url }) }] };
}

// ── Templates ───────────────────────────────────────────

/** List page templates */
export async function docsListTemplates(project: string) {
  const res = await api.get("/docs/templates", { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Get a template by ID */
export async function docsGetTemplate(project: string, id: number) {
  const res = await api.get(`/docs/templates/${id}`, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Create a page template */
export async function docsCreateTemplate(project: string, name: string, content: string, description?: string, category?: string) {
  const res = await api.post("/docs/templates", { name, content, description, category }, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Update a page template — PUT /templates/:id */
export async function docsUpdateTemplate(project: string, id: number, name?: string, content?: string, description?: string, category?: string) {
  const res = await api.put(`/docs/templates/${id}`, { name, content, description, category }, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Delete a template */
export async function docsDeleteTemplate(project: string, id: number) {
  const res = await api.del(`/docs/templates/${id}`, { project });
  if (res.status === 204) {
    return { content: [{ type: "text" as const, text: "Template deleted" }] };
  }
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

// ── Project Links ───────────────────────────────────────

/** Link a documentation page to a project — POST /pages/:pageId/projects */
export async function docsLinkProject(project: string, pageId: number, projectId: string) {
  const res = await api.post(`/docs/pages/${pageId}/projects`, { projectId }, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Unlink a page from a project — DELETE /pages/:pageId/projects/:linkedProjectId */
export async function docsUnlinkProject(project: string, pageId: number, linkedProjectId: string) {
  const res = await api.del(`/docs/pages/${pageId}/projects/${encodeURIComponent(linkedProjectId)}`, { project });
  if (res.status === 204) {
    return { content: [{ type: "text" as const, text: "Project unlinked" }] };
  }
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Get projects linked to a page */
export async function docsGetProjects(project: string, pageId: number) {
  const res = await api.get(`/docs/pages/${pageId}/projects`, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

// ── Favorites ───────────────────────────────────────────

/** Toggle favorite status for a page */
export async function docsToggleFavorite(project: string, pageId: number) {
  const res = await api.post(`/docs/pages/${pageId}/favorite`, {}, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Get favorite pages */
export async function docsGetFavorites(project: string) {
  const res = await api.get("/docs/favorites", { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

// ── Trash ───────────────────────────────────────────────

/** List archived pages in space trash — GET /spaces/:spaceId/trash */
export async function docsListTrash(project: string, spaceId: number) {
  const res = await api.get(`/docs/spaces/${spaceId}/trash`, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Purge all archived pages in space — DELETE /spaces/:spaceId/trash */
export async function docsPurgeTrash(project: string, spaceId: number) {
  const res = await api.del(`/docs/spaces/${spaceId}/trash`, { project });
  if (res.status === 204) {
    return { content: [{ type: "text" as const, text: "Trash emptied" }] };
  }
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

// ── Import / Export ─────────────────────────────────────

/** Import pages into a space — POST /docs/import with JSON body { spaceId, format, data } */
export async function docsImportPages(project: string, spaceId: number, format: string, data: string) {
  let parsed: unknown;
  try { parsed = JSON.parse(data); } catch { parsed = data; }
  const res = await api.post("/docs/import", { spaceId, format, data: parsed }, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Export a space as JSON — GET /docs/spaces/:spaceId/export */
export async function docsExportSpace(project: string, spaceId: number) {
  const res = await api.get(`/docs/spaces/${spaceId}/export`, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

// ── Stats ───────────────────────────────────────────────

/** Get documentation statistics */
export async function docsGetStats(project: string) {
  const res = await api.get("/docs/stats", { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}
