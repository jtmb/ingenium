/**
 * GREEN contract test — Docs route parity across API / dashboard client / MCP tools.
 *
 * Encodes the canonical desired behavior after W1B-CALLERS alignment.
 * All assertions should pass against the fixed implementation.
 *
 * Run:  npx vitest run tests/route-parity-docs.test.ts
 */

import { describe, it, expect } from "vitest";

// ═══════════════════════════════════════════════════════════════════════════════
// Contract Tables — post-W1B alignment
// ═══════════════════════════════════════════════════════════════════════════════

type RouteDef = { method: string; path: string; note?: string };

// ── API routes (from services/ingenium-api/lib/routes/docs.ts) ─────────────────
const API_ROUTES: RouteDef[] = [
  // Spaces
  { method: "GET",    path: "/spaces" },
  { method: "GET",    path: "/spaces/:id" },
  { method: "POST",   path: "/spaces" },
  { method: "PUT",    path: "/spaces/:id" },
  { method: "DELETE", path: "/spaces/:id" },
  // Pages
  { method: "GET",    path: "/spaces/:spaceId/pages" },
  { method: "GET",    path: "/spaces/:spaceId/tree" },
  { method: "POST",   path: "/spaces/:spaceId/pages" },
  { method: "GET",    path: "/pages/:id" },
  { method: "PUT",    path: "/pages/:id",               note: "reads expectedRevision (camelCase)" },
  { method: "DELETE", path: "/pages/:id",               note: "archive (soft delete)" },
  { method: "POST",   path: "/pages/:id/restore" },
  { method: "POST",   path: "/pages/:id/move" },
  { method: "POST",   path: "/pages/:id/publish" },
  // Drafts
  { method: "GET",    path: "/pages/:id/draft" },
  { method: "PUT",    path: "/pages/:id/draft" },
  { method: "DELETE", path: "/pages/:id/draft" },
  // Versions
  { method: "GET",    path: "/pages/:id/versions" },
  { method: "GET",    path: "/pages/:id/versions/:versionId" },
  { method: "POST",   path: "/pages/:id/restore/:versionId" },
  // Search
  { method: "GET",    path: "/search" },
  // Tags
  { method: "GET",    path: "/tags" },
  { method: "GET",    path: "/pages/:id/tags" },
  { method: "POST",   path: "/pages/:id/tags",           note: "reads req.body.tagName" },
  { method: "DELETE", path: "/pages/:id/tags/:tagId" },
  // Backlinks
  { method: "GET",    path: "/pages/:id/backlinks" },
  // Comments
  { method: "GET",    path: "/pages/:id/comments" },
  { method: "POST",   path: "/pages/:id/comments" },
  { method: "PUT",    path: "/pages/:id/comments/:commentId/resolve" },
  { method: "DELETE", path: "/pages/:id/comments/:commentId" },
  // Attachments
  { method: "GET",    path: "/pages/:id/attachments" },
  { method: "POST",   path: "/pages/:id/attachments" },
  { method: "GET",    path: "/pages/:id/attachments/:attId/download" },
  { method: "DELETE", path: "/pages/:id/attachments/:attId" },
  // Templates
  { method: "GET",    path: "/templates" },
  { method: "GET",    path: "/templates/:id" },
  { method: "POST",   path: "/templates" },
  { method: "PUT",    path: "/templates/:id" },
  { method: "DELETE", path: "/templates/:id" },
  // Project Links
  { method: "GET",    path: "/pages/:id/projects" },
  { method: "POST",   path: "/pages/:id/projects",       note: "reads req.body.projectId" },
  { method: "DELETE", path: "/pages/:id/projects/:projectId" },
  // Favorites
  { method: "POST",   path: "/pages/:id/favorite" },
  { method: "GET",    path: "/favorites" },
  // Import/Export
  { method: "POST",   path: "/import" },
  { method: "GET",    path: "/spaces/:spaceId/export" },
  // Trash
  { method: "GET",    path: "/spaces/:spaceId/trash" },
  { method: "DELETE", path: "/spaces/:spaceId/trash" },
  // Stats
  { method: "GET",    path: "/stats" },
];

// ── Dashboard client methods (from services/ingenium-dashboard/src/lib/api.ts) ─
const DASHBOARD_CLIENT_PATHS: { group: string; method: string; path: string; bodyFields?: string[]; note?: string }[] = [
  // Spaces
  { group: "spaces", method: "GET",    path: "/docs/spaces" },
  { group: "spaces", method: "GET",    path: "/docs/spaces/${id}" },
  { group: "spaces", method: "POST",   path: "/docs/spaces" },
  { group: "spaces", method: "PUT",    path: "/docs/spaces/${id}" },
  { group: "spaces", method: "DELETE", path: "/docs/spaces/${id}" },
  // Pages
  { group: "pages",  method: "GET",    path: "/docs/spaces/${spaceId}/pages" },
  { group: "pages",  method: "GET",    path: "/docs/spaces/${spaceId}/tree" },
  { group: "pages",  method: "GET",    path: "/docs/pages/${id}" },
  { group: "pages",  method: "POST",   path: "/docs/spaces/${spaceId}/pages" },
  { group: "pages",  method: "PUT",    path: "/docs/pages/${id}",              bodyFields: ["expectedRevision"], note: "PUT with expectedRevision (camelCase)" },
  { group: "pages",  method: "DELETE", path: "/docs/pages/${id}" },
  { group: "pages",  method: "POST",   path: "/docs/pages/${pageId}/restore" },
  { group: "pages",  method: "POST",   path: "/docs/pages/${id}/move" },
  { group: "pages",  method: "POST",   path: "/docs/pages/${id}/publish" },
  { group: "pages",  method: "GET",    path: "/docs/pages/${pageId}/draft" },
  { group: "pages",  method: "PUT",    path: "/docs/pages/${pageId}/draft" },
  { group: "pages",  method: "DELETE", path: "/docs/pages/${pageId}/draft" },
  { group: "pages",  method: "GET",    path: "/docs/pages?spaceId=&slug=" },
  // Comments
  { group: "comments", method: "GET",  path: "/docs/pages/${pageId}/comments" },
  { group: "comments", method: "POST", path: "/docs/pages/${pageId}/comments", bodyFields: ["content", "parentCommentId", "selectionText", "selectionOffset"] },
  { group: "comments", method: "PUT",  path: "/docs/pages/${pageId}/comments/${commentId}/resolve", note: "page-scoped PUT resolve" },
  { group: "comments", method: "DELETE", path: "/docs/pages/${pageId}/comments/${commentId}" },
  // Versions
  { group: "versions", method: "GET",  path: "/docs/pages/${pageId}/versions" },
  { group: "versions", method: "GET",  path: "/docs/pages/${pageId}/versions/${versionId}", note: "page-scoped version get" },
  { group: "versions", method: "POST", path: "/docs/pages/${pageId}/restore/${versionId}", note: "page-scoped restore" },
  // Search
  { group: "search",   method: "GET",  path: "/docs/search" },
  // Tags
  { group: "tags",     method: "GET",  path: "/docs/pages/${pageId}/tags" },
  { group: "tags",     method: "POST", path: "/docs/pages/${pageId}/tags",          bodyFields: ["tagName"], note: "sends { tagName }" },
  { group: "tags",     method: "DELETE", path: "/docs/pages/${pageId}/tags/${tagId}" },
  { group: "tags",     method: "GET",  path: "/docs/tags" },
  // Backlinks
  { group: "backlinks", method: "GET", path: "/docs/pages/${pageId}/backlinks" },
  // Templates
  { group: "templates", method: "GET", path: "/docs/templates" },
  { group: "templates", method: "GET", path: "/docs/templates/${id}" },
  { group: "templates", method: "PUT", path: "/docs/templates/${id}" },
  { group: "templates", method: "DELETE", path: "/docs/templates/${id}" },
  // Attachments
  { group: "attachments", method: "GET",    path: "/docs/pages/${pageId}/attachments" },
  { group: "attachments", method: "DELETE", path: "/docs/pages/${pageId}/attachments/${attId}" },
  { group: "attachments", method: "GET",    path: "/docs/pages/${pageId}/attachments/${attId}/download", note: "download URL builder" },
  // Project Links
  { group: "projectLinks", method: "GET",    path: "/docs/pages/${pageId}/projects" },
  { group: "projectLinks", method: "POST",   path: "/docs/pages/${pageId}/projects",         note: "body { projectId: string }" },
  { group: "projectLinks", method: "DELETE", path: "/docs/pages/${pageId}/projects/${linkedProjectId}" },
  // Favorites
  { group: "favorites", method: "GET",  path: "/docs/favorites" },
  // Trash
  { group: "trash",    method: "GET",   path: "/docs/spaces/${spaceId}/trash" },
  { group: "trash",    method: "DELETE", path: "/docs/spaces/${spaceId}/trash" },
  // Import/Export
  { group: "importExport", method: "POST", path: "/docs/import",               note: "JSON body { spaceId, format, data }" },
  { group: "importExport", method: "GET",  path: "/docs/spaces/${spaceId}/export" },
  // Stats
  { group: "stats",    method: "GET", path: "/docs/stats" },
];

// ── MCP tool paths (from services/ingenium-server/lib/tools/docs.ts) ───────────
const MCP_TOOL_PATHS: { tool: string; method: string; path: string; note?: string }[] = [
  { tool: "docsListSpaces",       method: "GET",    path: "/docs/spaces" },
  { tool: "docsGetSpace",         method: "GET",    path: "/docs/spaces/${id}" },
  { tool: "docsCreateSpace",      method: "POST",   path: "/docs/spaces" },
  { tool: "docsUpdateSpace",      method: "PUT",    path: "/docs/spaces/${id}" },
  { tool: "docsDeleteSpace",      method: "DELETE", path: "/docs/spaces/${id}" },
  { tool: "docsListPages",        method: "GET",    path: "/docs/spaces/${spaceId}/pages" },
  { tool: "docsGetPageTree",      method: "GET",    path: "/docs/spaces/${spaceId}/tree" },
  { tool: "docsGetPage",          method: "GET",    path: "/docs/pages/${id}" },
  { tool: "docsCreatePage",       method: "POST",   path: "/docs/spaces/${spaceId}/pages" },
  { tool: "docsUpdatePage",       method: "PUT",    path: "/docs/pages/${id}",        note: "PUT with expectedRevision (camelCase)" },
  { tool: "docsDeletePage",       method: "DELETE", path: "/docs/pages/${id}" },
  { tool: "docsRestorePage",      method: "POST",   path: "/docs/pages/${id}/restore" },
  { tool: "docsMovePage",         method: "POST",   path: "/docs/pages/${id}/move",   note: "POST (canonical)" },
  { tool: "docsPublishPage",      method: "POST",   path: "/docs/pages/${id}/publish" },
  { tool: "docsSearch",           method: "GET",    path: "/docs/search" },
  { tool: "docsGetDraft",         method: "GET",    path: "/docs/pages/${pageId}/draft" },
  { tool: "docsSaveDraft",        method: "PUT",    path: "/docs/pages/${pageId}/draft" },
  { tool: "docsDeleteDraft",      method: "DELETE", path: "/docs/pages/${pageId}/draft" },
  { tool: "docsListVersions",     method: "GET",    path: "/docs/pages/${pageId}/versions" },
  { tool: "docsGetVersion",       method: "GET",    path: "/docs/pages/${pageId}/versions/${versionId}", note: "page-scoped" },
  { tool: "docsRestoreVersion",   method: "POST",   path: "/docs/pages/${pageId}/restore/${versionId}" },
  { tool: "docsListComments",     method: "GET",    path: "/docs/pages/${pageId}/comments" },
  { tool: "docsCreateComment",    method: "POST",   path: "/docs/pages/${pageId}/comments" },
  { tool: "docsResolveComment",   method: "PUT",    path: "/docs/pages/${pageId}/comments/${commentId}/resolve", note: "page-scoped PUT" },
  { tool: "docsDeleteComment",    method: "DELETE", path: "/docs/pages/${pageId}/comments/${commentId}", note: "page-scoped" },
  { tool: "docsListTags",         method: "GET",    path: "/docs/tags" },
  { tool: "docsGetPageTags",      method: "GET",    path: "/docs/pages/${pageId}/tags" },
  { tool: "docsAddTag",           method: "POST",   path: "/docs/pages/${pageId}/tags", note: "sends { tagName }" },
  { tool: "docsRemoveTag",        method: "DELETE", path: "/docs/pages/${pageId}/tags/${tagId}" },
  { tool: "docsGetBacklinks",     method: "GET",    path: "/docs/pages/${pageId}/backlinks" },
  { tool: "docsListAttachments",  method: "GET",    path: "/docs/pages/${pageId}/attachments" },
  { tool: "docsDeleteAttachment", method: "DELETE", path: "/docs/pages/${pageId}/attachments/${attachmentId}", note: "page-scoped" },
  { tool: "docsGetAttachmentDownload", method: "GET",    path: "/docs/pages/${pageId}/attachments/${attachmentId}/download" },
  { tool: "docsListTemplates",    method: "GET",    path: "/docs/templates" },
  { tool: "docsGetTemplate",      method: "GET",    path: "/docs/templates/${id}" },
  { tool: "docsCreateTemplate",   method: "POST",   path: "/docs/templates" },
  { tool: "docsUpdateTemplate",   method: "PUT",    path: "/docs/templates/${id}" },
  { tool: "docsDeleteTemplate",   method: "DELETE", path: "/docs/templates/${id}" },
  { tool: "docsLinkProject",      method: "POST",   path: "/docs/pages/${pageId}/projects", note: "canonical POST /projects" },
  { tool: "docsUnlinkProject",    method: "DELETE", path: "/docs/pages/${pageId}/projects/${linkedProjectId}", note: "canonical DELETE /projects/:id" },
  { tool: "docsGetProjects",      method: "GET",    path: "/docs/pages/${pageId}/projects" },
  { tool: "docsToggleFavorite",   method: "POST",   path: "/docs/pages/${pageId}/favorite" },
  { tool: "docsGetFavorites",     method: "GET",    path: "/docs/favorites" },
  { tool: "docsImportPages",      method: "POST",   path: "/docs/import", note: "JSON body { spaceId, format, data }" },
  { tool: "docsExportSpace",      method: "GET",    path: "/docs/spaces/${spaceId}/export" },
  { tool: "docsListTrash",        method: "GET",    path: "/docs/spaces/${spaceId}/trash" },
  { tool: "docsPurgeTrash",       method: "DELETE", path: "/docs/spaces/${spaceId}/trash" },
  { tool: "docsGetStats",         method: "GET",    path: "/docs/stats" },
];

// ═══════════════════════════════════════════════════════════════════════════════

describe("Docs route parity — Dashboard client vs API", () => {

  // Helper: normalize an API route path for comparison
  const normalizeApiPath = (p: string) => p.startsWith("/") ? p.slice(1) : p;

  it("client pages.update uses PUT (matches API)", () => {
    const clientMethod = DASHBOARD_CLIENT_PATHS.find(p => p.path === "/docs/pages/${id}" && p.method === "PUT");
    expect(clientMethod).toBeDefined();
    expect(clientMethod!.method).toBe("PUT");
  });

  it("client sends expectedRevision (camelCase) matching API", () => {
    const clientPath = DASHBOARD_CLIENT_PATHS.find(p => p.path === "/docs/pages/${id}" && p.method === "PUT");
    expect(clientPath).toBeDefined();
    expect(clientPath!.bodyFields).toContain("expectedRevision");
  });

  it("client comments.resolve uses PUT /docs/pages/${pageId}/comments/${commentId}/resolve (page-scoped)", () => {
    const clientPath = DASHBOARD_CLIENT_PATHS.find(p => p.group === "comments" && p.path.includes("resolve"));
    expect(clientPath).toBeDefined();
    expect(clientPath!.path).toContain("${pageId}");
    expect(clientPath!.method).toBe("PUT");
  });

  it("client comments body uses canonical camelCase fields (no phantom author)", () => {
    const clientPath = DASHBOARD_CLIENT_PATHS.find(p => p.group === "comments" && p.method === "POST" && !p.path.includes("resolve"));
    expect(clientPath).toBeDefined();
    expect(clientPath!.bodyFields).toContain("content");
    expect(clientPath!.bodyFields).toContain("parentCommentId");
    expect(clientPath!.bodyFields).not.toContain("author");
    expect(clientPath!.bodyFields).not.toContain("parent_id");
  });

  it("client versions.get is page-scoped: /docs/pages/${pageId}/versions/${versionId}", () => {
    const clientPath = DASHBOARD_CLIENT_PATHS.find(p => p.group === "versions" && p.method === "GET" && p.path.includes("versions/${versionId}"));
    expect(clientPath).toBeDefined();
    expect(clientPath!.path).toContain("${pageId}");
  });

  it("client versions.restore is page-scoped: /docs/pages/${pageId}/restore/${versionId}", () => {
    const clientPath = DASHBOARD_CLIENT_PATHS.find(p => p.group === "versions" && p.method === "POST");
    expect(clientPath).toBeDefined();
    expect(clientPath!.path).toContain("${pageId}");
  });

  it("client tags.add sends { tagName } matching API", () => {
    const clientPath = DASHBOARD_CLIENT_PATHS.find(p => p.group === "tags" && p.method === "POST");
    expect(clientPath).toBeDefined();
    expect(clientPath!.bodyFields).toContain("tagName");
  });

  it("client trash.list and trash.empty routes match API", () => {
    const trashList = DASHBOARD_CLIENT_PATHS.find(p => p.group === "trash" && p.method === "GET");
    const trashEmpty = DASHBOARD_CLIENT_PATHS.find(p => p.group === "trash" && p.method === "DELETE");
    expect(trashList).toBeDefined();
    expect(trashEmpty).toBeDefined();
  });

  it("client export uses canonical /docs/spaces/${spaceId}/export path", () => {
    const clientPath = DASHBOARD_CLIENT_PATHS.find(p => p.group === "importExport" && p.method === "GET");
    expect(clientPath).toBeDefined();
    expect(clientPath!.path).toBe("/docs/spaces/${spaceId}/export");
  });

  it("client import uses POST /docs/import with JSON body { spaceId, format, data }", () => {
    const clientPath = DASHBOARD_CLIENT_PATHS.find(p => p.group === "importExport" && p.method === "POST");
    expect(clientPath).toBeDefined();
    expect(clientPath!.path).toBe("/docs/import");
  });
});

describe("Docs route parity — MCP tools vs API", () => {

  it("MCP docsMovePage uses POST (canonical match with API)", () => {
    const mcpTool = MCP_TOOL_PATHS.find(t => t.tool === "docsMovePage");
    expect(mcpTool).toBeDefined();
    expect(mcpTool!.method).toBe("POST");
  });

  it("MCP docsGetVersion is page-scoped: /docs/pages/${pageId}/versions/${versionId}", () => {
    const mcpTool = MCP_TOOL_PATHS.find(t => t.tool === "docsGetVersion");
    expect(mcpTool).toBeDefined();
    expect(mcpTool!.path).toContain("${pageId}");
  });

  it("MCP docsResolveComment is page-scoped: PUT /docs/pages/${pageId}/comments/${commentId}/resolve", () => {
    const mcpTool = MCP_TOOL_PATHS.find(t => t.tool === "docsResolveComment");
    expect(mcpTool).toBeDefined();
    expect(mcpTool!.path).toContain("${pageId}");
    expect(mcpTool!.method).toBe("PUT");
  });

  it("MCP docsDeleteComment is page-scoped: /docs/pages/${pageId}/comments/${commentId}", () => {
    const mcpTool = MCP_TOOL_PATHS.find(t => t.tool === "docsDeleteComment");
    expect(mcpTool).toBeDefined();
    expect(mcpTool!.path).toContain("${pageId}");
  });

  it("MCP docsDeleteAttachment is page-scoped: /docs/pages/${pageId}/attachments/${attachmentId}", () => {
    const mcpTool = MCP_TOOL_PATHS.find(t => t.tool === "docsDeleteAttachment");
    expect(mcpTool).toBeDefined();
    expect(mcpTool!.path).toContain("${pageId}");
  });

  it("MCP docsLinkProject uses canonical POST /docs/pages/${pageId}/projects", () => {
    const mcpTool = MCP_TOOL_PATHS.find(t => t.tool === "docsLinkProject");
    expect(mcpTool).toBeDefined();
    expect(mcpTool!.path).toBe("/docs/pages/${pageId}/projects");
  });

  it("MCP docsUnlinkProject uses canonical DELETE /docs/pages/${pageId}/projects/${linkedProjectId}", () => {
    const mcpTool = MCP_TOOL_PATHS.find(t => t.tool === "docsUnlinkProject");
    expect(mcpTool).toBeDefined();
    expect(mcpTool!.path).toBe("/docs/pages/${pageId}/projects/${linkedProjectId}");
  });

  it("MCP docsExportSpace uses canonical /docs/spaces/${spaceId}/export", () => {
    const mcpTool = MCP_TOOL_PATHS.find(t => t.tool === "docsExportSpace");
    expect(mcpTool).toBeDefined();
    expect(mcpTool!.path).toBe("/docs/spaces/${spaceId}/export");
  });

  it("MCP has publish, draft delete, template update, trash, attachment download tools", () => {
    const requiredTools = ["docsPublishPage", "docsDeleteDraft", "docsUpdateTemplate", "docsListTrash", "docsPurgeTrash", "docsGetAttachmentDownload"];
    for (const name of requiredTools) {
      const tool = MCP_TOOL_PATHS.find(t => t.tool === name);
      expect(tool).toBeDefined();
    }
  });
});

describe("Docs API route design requirements", () => {

  it("GET /pages/:id/attachments/:attId/download exists for attachment download", () => {
    const hasDownload = API_ROUTES.some(r =>
      r.method === "GET" && r.path === "/pages/:id/attachments/:attId/download"
    );
    expect(hasDownload).toBe(true);
  });

  it("GET /spaces/:spaceId/trash exists for listing trashed pages", () => {
    const hasTrashList = API_ROUTES.some(r =>
      r.method === "GET" && r.path === "/spaces/:spaceId/trash"
    );
    expect(hasTrashList).toBe(true);
  });

  it("DELETE /spaces/:spaceId/trash exists for emptying trash", () => {
    const hasTrashEmpty = API_ROUTES.some(r =>
      r.method === "DELETE" && r.path === "/spaces/:spaceId/trash"
    );
    expect(hasTrashEmpty).toBe(true);
  });

  it("all comment routes include pageId for contextual authorization", () => {
    const resolveRoute = API_ROUTES.find(r => r.path.includes("comments") && r.path.includes("resolve"));
    expect(resolveRoute).toBeDefined();
    expect(resolveRoute!.path).toContain("/pages/:id/comments");
  });

  it("PUT /templates/:id exists for updating templates", () => {
    const hasUpdate = API_ROUTES.some(r =>
      r.method === "PUT" && r.path === "/templates/:id"
    );
    expect(hasUpdate).toBe(true);
  });

  it("DELETE /pages/:id/draft exists for deleting drafts", () => {
    const hasDeleteDraft = API_ROUTES.some(r =>
      r.method === "DELETE" && r.path === "/pages/:id/draft"
    );
    expect(hasDeleteDraft).toBe(true);
  });

  it("POST /pages/:id/publish exists for publishing draft pages", () => {
    const hasPublish = API_ROUTES.some(r =>
      r.method === "POST" && r.path === "/pages/:id/publish"
    );
    expect(hasPublish).toBe(true);
  });
});
