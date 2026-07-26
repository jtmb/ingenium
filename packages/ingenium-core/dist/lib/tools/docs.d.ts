/**
 * Canonical error codes for docs operations.
 * Returned in `DocsError` objects instead of thrown exceptions, so callers
 * can pattern-match on the code without try/catch.
 */
export type DocsErrorCode = "CONTENT_TOO_LONG" | "COMMENT_TOO_LONG" | "SPACE_NOT_FOUND" | "PAGE_NOT_FOUND" | "COMMENT_NOT_FOUND" | "TEMPLATE_NOT_FOUND" | "ATTACHMENT_NOT_FOUND" | "PARENT_NOT_FOUND" | "PARENT_CROSS_SPACE" | "PARENT_ARCHIVED" | "PARENT_CYCLE" | "PARENT_SELF" | "PROJECT_NOT_FOUND" | "SLUG_CONFLICT" | "REVISION_CONFLICT";
/** Structured error with machine-readable code + human-readable message. */
export interface DocsError {
    code: DocsErrorCode;
    message: string;
}
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
export declare function listSpaces(): DocSpace[];
export declare function getSpace(id: number): DocSpace | undefined;
export declare function getSpaceBySlug(slug: string): DocSpace | undefined;
export declare function createSpace(name: string, slug: string, description?: string, icon?: string): DocSpace;
export declare function updateSpace(id: number, fields: {
    name?: string;
    slug?: string;
    description?: string;
    icon?: string;
    sort_order?: number;
}): DocSpace | undefined;
export declare function deleteSpace(id: number): boolean;
export declare function listPages(spaceId: number, status?: string): DocPage[];
/** List archived pages (for admin review before purge). */
export declare function listArchivedPages(spaceId: number): DocPage[];
/**
 * Permanently delete all archived pages in a space.
 * Returns the count of deleted pages.
 *
 * WARNING: This is a hard delete — versions, comments, and attachments for
 *          these pages are orphaned. Call `exportSpace` first for a backup.
 */
export declare function purgeArchivedPages(spaceId: number): number;
export declare function getPageTree(spaceId: number): (DocPage & {
    children: any[];
})[];
export declare function getPage(id: number): DocPage | undefined;
export declare function getPageBySlug(spaceId: number, slug: string): DocPage | undefined;
/** Check if a slug is already taken in a space. Optionally exclude a page ID for rename validation. */
export declare function slugExists(spaceId: number, slug: string, excludePageId?: number): boolean;
/**
 * Create a new page in draft state (revision 0).
 *
 * - Validates space exists
 * - Validates parent belongs to same space and is not archived
 * - Enforces MAX_PAGE_CONTENT_LENGTH on initial content
 * - Does NOT create a version (only publishPage creates versions)
 */
export declare function createPage(spaceId: number, title: string, slug: string, content?: string, parentPageId?: number): CreatePageResult;
/**
 * Publish a draft page: atomically validate revision, apply draft metadata,
 * bump revision once, create exactly one version, rebuild backlinks, clear draft.
 *
 * If expectedRevision is provided and the page's current revision doesn't match,
 * returns conflict details instead of overwriting.
 */
export declare function publishPage(pageId: number, expectedRevision?: number): PublishPageResult;
/**
 * Update a published page. Creates a new version snapshot and bumps revision.
 * If `expectedRevision` is provided and doesn't match, returns a conflict
 * instead of overwriting (optimistic concurrency).
 *
 * NOTE: Unlike createPage → publishPage lifecycle, this directly bumps the
 *       revision and creates a version in a single call.
 */
export declare function updatePage(id: number, fields: {
    title?: string;
    slug?: string;
    content?: string;
    expectedRevision?: number;
}): UpdatePageResult;
/**
 * Soft-delete a page by setting status to "archived".
 * Does nothing if already archived (idempotent guard in WHERE clause).
 */
export declare function archivePage(id: number): boolean;
/** Restore an archived page back to "published" status. */
export declare function restorePage(id: number): DocPage | undefined;
export interface MovePageResult {
    page?: DocPage;
    error?: DocsError;
}
export declare function movePage(id: number, newParentId?: number | null, newSortOrder?: number): MovePageResult;
export declare function getDraft(pageId: number): DocDraft | undefined;
/**
 * Save a working draft for a page. Uses ON CONFLICT DO UPDATE so there is
 * at most one draft per page at any time (upsert by page_id).
 * Content length is validated against MAX_PAGE_CONTENT_LENGTH before writing.
 */
export declare function saveDraft(pageId: number, content: string, title?: string, slug?: string, baseRevision?: number): DocDraft;
export declare function deleteDraft(pageId: number): boolean;
export declare function listVersions(pageId: number): DocVersion[];
export declare function getVersion(versionId: number): DocVersion | undefined;
/**
 * Restore a page to a previous version.
 * The current state is saved as a new version first (so the restore is itself
 * reversible), then the selected version's content is copied to the page.
 */
export declare function restoreVersion(pageId: number, versionId: number): DocPage | undefined;
export interface SearchResult extends DocPage {
    rank: number;
}
export declare function searchPages(query: string, spaceId?: number): SearchResult[];
export declare function listAllTags(): DocTag[];
export declare function getPageTags(pageId: number): DocTag[];
export declare function addTag(pageId: number, tagName: string): DocTag | undefined;
export declare function removeTag(pageId: number, tagId: number): boolean;
export declare function getBacklinks(pageId: number): (DocPageLink & {
    source_title: string;
    source_slug: string;
})[];
export declare function listComments(pageId: number): DocComment[];
export interface CreateCommentResult {
    comment?: DocComment;
    error?: DocsError;
}
export declare function createComment(pageId: number, content: string, parentCommentId?: number, selectionText?: string, selectionOffset?: number): CreateCommentResult;
export declare function resolveComment(commentId: number): DocComment | undefined;
export declare function deleteComment(commentId: number): boolean;
export declare function listAttachments(pageId: number): DocAttachment[];
export declare function getAttachment(attId: number): DocAttachment | undefined;
/** Look up attachments by owning page (alias for listAttachments). */
export declare function getAttachmentsByPage(pageId: number): DocAttachment[];
/**
 * Save or update an attachment record.
 * Uses ON CONFLICT DO UPDATE (not INSERT OR REPLACE) so FK-referenced child
 * rows are preserved (see 🔴 HARD RULE #11 in AGENTS.md).
 * Parent-existence check via `defendChildPage` prevents FK corruption.
 */
export declare function saveAttachment(pageId: number, filename: string, originalName: string, mimeType: string, sizeBytes: number, storagePath: string): DocAttachment;
/**
 * Delete an attachment, returning the deleted row so callers can verify
 * ownership (e.g., that the attachment belongs to the expected page).
 */
export declare function deleteAttachment(attId: number): DocAttachment | undefined;
export declare function listTemplates(): DocTemplate[];
export declare function getTemplate(id: number): DocTemplate | undefined;
export declare function createTemplate(name: string, content: string, description?: string, category?: string): DocTemplate;
export declare function updateTemplate(id: number, fields: {
    name?: string;
    description?: string;
    content?: string;
    category?: string;
}): DocTemplate | undefined;
export declare function deleteTemplate(id: number): boolean;
export declare function getLinkedProjects(pageId: number): DocProjectLink[];
export declare function linkProject(pageId: number, projectId: string): DocProjectLink;
export declare function unlinkProject(pageId: number, projectId: string): boolean;
export declare function toggleFavorite(pageId: number): DocPage | undefined;
export declare function listFavorites(): DocPage[];
export interface ImportPageEntry {
    title: string;
    slug: string;
    content: string;
    parentSlug?: string;
}
export declare function importPages(spaceId: number, pages: ImportPageEntry[]): DocPage[];
export interface ExportSpaceResult {
    space: DocSpace;
    pages: DocPage[];
    tree: (DocPage & {
        children: any[];
    })[];
    tags: {
        pageId: number;
        tags: DocTag[];
    }[];
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
export declare function exportSpace(spaceId: number): ExportSpaceResult | undefined;
export declare function getDocStats(): DocStatCounts;
//# sourceMappingURL=docs.d.ts.map