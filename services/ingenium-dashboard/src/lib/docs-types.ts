/** A threaded comment on a doc page. */
export type DocComment = {
  id: number;
  page_id: number;
  content: string;
  author: string;
  parent_id: number | null;
  selection_text: string | null;
  offset: number | null;
  resolved: boolean;
  created_at: string;
};

/** A point-in-time version snapshot of a doc page. */
export type DocVersion = {
  id: number;
  page_id: number;
  revision: number;
  title: string;
  content: string;
  created_at: string;
};

/** A full-text search result for doc pages. */
export type DocSearchResult = {
  page_id: number;
  space_id: number;
  title: string;
  slug: string;
  space_name: string;
  snippet: string;
  highlight: string;
};

/** A tag associated with a doc page. */
export type DocTag = {
  id: number;
  name: string;
  page_id: number;
};

/** A backlink — a page that links to the current page via wikilinks. */
export type DocBacklink = {
  page_id: number;
  space_id: number;
  title: string;
  slug: string;
  space_name: string;
  link_text: string;
};

/** A reusable template for creating new doc pages. */
export type DocTemplate = {
  id: number;
  name: string;
  description: string;
  category: string;
  content: string;
  created_at: string;
};

/** A soft-deleted (archived) doc page in the trash. */
export type DocTrashItem = {
  page_id: number;
  space_id: number;
  title: string;
  slug: string;
  deleted_at: string;
};

/** Import preview for a single page. */
export type ImportPreview = {
  title: string;
  slug: string;
  content: string;
  space_name: string;
};
