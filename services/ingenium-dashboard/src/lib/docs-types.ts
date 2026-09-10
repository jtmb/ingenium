/**
 * Canonical Docs DTO types — single source of truth for the dashboard.
 * All types match the camelCase wire format from the API's DTO mapper layer.
 * No component should define its own Doc types; import from here.
 */

/** A documentation space (project/notebook container). */
export interface DocSpace {
  id: number;
  name: string;
  slug: string;
  description: string;
  icon: string;
  sortOrder: number;
  isGlobal?: boolean;
  createdAt: string;
  updatedAt: string;
}

/** A documentation page. */
export interface DocPage {
  id: number;
  spaceId: number;
  parentPageId: number | null;
  title: string;
  slug: string;
  content: string;
  /** Optimistic concurrency guard — the API rejects updates if the revision doesn't match. */
  revision: number;
  status: "draft" | "published" | "archived";
  sortOrder: number;
  /** SQLite boolean stored as 0/1 integer, typed as number for compatibility. */
  isFavorite: number;
  createdAt: string;
  updatedAt: string;
}

/** A page with nested children (tree structure). */
export interface DocPageTree extends DocPage {
  children: DocPageTree[];
}

/** An autosaved draft for a page. */
export interface DocDraft {
  id: number;
  pageId: number;
  title: string;
  slug: string;
  content: string;
  baseRevision: number | null;
  savedAt: string;
}

/** A threaded comment on a doc page. */
export interface DocComment {
  id: number;
  pageId: number;
  parentCommentId: number | null;
  content: string;
  selectionText: string;
  selectionOffset: number;
  resolved: boolean;
  createdAt: string;
  updatedAt: string;
}

/** A point-in-time version snapshot of a doc page. */
export interface DocVersion {
  id: number;
  pageId: number;
  revision: number;
  title: string;
  content: string;
  createdAt: string;
}

/** A full-text search result for doc pages. */
export interface DocSearchResult {
  id: number;
  spaceId: number;
  parentPageId: number | null;
  title: string;
  slug: string;
  content: string;
  revision: number;
  status: string;
  sortOrder: number;
  isFavorite: number;
  createdAt: string;
  updatedAt: string;
  /** BM25 relevance rank from FTS5 — higher means more relevant. */
  rank: number;
}

/** A tag associated with a doc page. */
export interface DocTag {
  id: number;
  name: string;
  slug: string;
}

/** A backlink — a page that links to the current page via wikilinks. */
export interface DocBacklink {
  id: number;
  sourcePageId: number;
  targetPageId: number;
  linkText: string;
  sourceTitle: string;
  sourceSlug: string;
}

/** A reusable template for creating new doc pages. */
export interface DocTemplate {
  id: number;
  name: string;
  description: string;
  content: string;
  category: string;
  createdAt: string;
}

/** A soft-deleted (archived) doc page in the trash. */
export interface DocTrashItem {
  id: number;
  spaceId: number;
  parentPageId: number | null;
  title: string;
  slug: string;
  content: string;
  revision: number;
  status: string;
  sortOrder: number;
  isFavorite: number;
  createdAt: string;
  updatedAt: string;
}

/** A file attachment on a page. */
export interface DocAttachment {
  id: number;
  pageId: number;
  filename: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  createdAt: string;
}

/** A project linked to a page. */
export interface DocProjectLink {
  pageId: number;
  projectId: string;
  projectName?: string;
}

/** Doc statistics. */
export interface DocStats {
  totalSpaces: number;
  totalPages: number;
  totalComments: number;
  totalAttachments: number;
  totalTemplates: number;
  publishedPages: number;
  draftPages: number;
  archivedPages: number;
  pagesCreatedLast7Days: number;
  pagesUpdatedLast7Days: number;
}

/** Canonical export data shape. */
export interface DocExportData {
  space: DocSpace;
  pages: DocPage[];
  tree: DocPageTree[];
  tags: Array<{ pageId: number; tags: DocTag[] }>;
  versions: DocVersion[];
  comments: DocComment[];
}

/** Import preview for a single page. */
export interface ImportPreview {
  title: string;
  slug: string;
  content: string;
  spaceName: string;
}
