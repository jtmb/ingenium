---
title: Docs Workspace Reference
description: Canonical contract for the Documentation Workspace API — routes, schemas, error codes, and Dashboard UI reference.
---

# Docs Workspace Reference — Canonical Contract

> **STATUS**: ✅ ROUTES VERIFIED (W1B) + ✅ DASHBOARD UI (W2) — The Express API implements **52 canonical endpoints** (51 in `docs.ts` + 1 in `docs-ai.ts`). All 6 backward-compatibility aliases have been **removed** from the API. All routes have DTO camelCase mapping, ownership checks, and error mapping.  
> 🟢 **MCP handlers: ALIGNED** — All 7 handler defects verified as fixed in `services/ingenium-server/lib/tools/docs.ts`. Handlers use canonical paths with pageId scoping.  
> 🟢 **Dashboard client: ALIGNED** — All paths verified in `services/ingenium-dashboard/src/lib/api.ts`. PUT (not PATCH), `expectedRevision` camelCase, pageId in all comment/version/trash routes.  
> 🟢 **DOCS_ENDPOINTS catalog: ALIGNED** (49 entries; 3 source-verified gaps in `mcp-tool-catalog.ts`) — Gaps: slug-lookup `GET /pages` (not in array), non-resolve `PUT /comments/:commentId` (not in array), and `POST /docs/ai` (docs-ai.ts, separate router).
> 🟢 **Route parity test: ALIGNED** — `tests/route-parity-docs.test.ts` (385 lines) has green assertions for all 3 layers.  
> 🟢 **Dashboard UI (W2): IMPLEMENTED** — `/docs` is an immersive responsive 3-pane workspace with tree refresh/mutations, named create dialog, explicit publish, archive/trash/restore, move with cycle prevention, rename, project links, attachments, panel tabs (Info/Tags/Backlinks/Comments/History/Linked/Files/Trash), FTS5 search, template picker, and import/export entry actions. `/standalone` routes into `/docs?space=...` as a docs-space selector/creator. Navigation Docs link is active (stale Coming Soon badge removed). See [docs-workspace Dashboard UI](#dashboard-ui-w2) below.
> 🔴 **W3 Editor (TipTap/source)**: Rich WYSIWYG TipTap editor and source-mode split pane remain pending. Current editor is a basic textarea-based Markdown editor. W3 E2E Playwright proof also pending.
>
> Core module items marked ✅ FIXED are verified at the core layer. API endpoint status is documented in the [Route tables](#canonical-routes) below. See the [Rescue Contract Ledger](#-rescue-contract-ledger) for current status.

This reference defines the canonical contract for the Docs Workspace API, models, and behavior rules. It is the single source of truth for all callers (Dashboard, MCP tools, third-party clients).

**Related canonical references** (do not duplicate):
- [Database Migrations](database-migrations.md) — migration file format and execution rules
- [docs/* schema definitions](#database-schema) — only copied here for contract completeness
- [API error handler conventions](../../services/ingenium-api/lib/middleware/errors.ts) — error envelope pattern
- [INGENIUM_HOME convention](../../docs/VARIABLES.md) — attachment storage root

---

## 🔴 Rescue Contract Ledger

🟢 **W1A Core-fixed items** are verified at the `packages/ingenium-core` level by unit tests (89+ tests).  
🟢 **W1B Route-implemented items** are verified by reading `services/ingenium-api/lib/routes/docs.ts` + `docs-ai.ts` (51 canonical endpoints in docs.ts + 1 in docs-ai.ts = 52 route registrations; all 6 aliases removed from API).  
🟢 **W2 Dashboard UI items** are verified by reading `services/ingenium-dashboard/src/app/docs/page.tsx` (1152 lines) — 3-pane workspace, tree refresh/mutations, create/publish/archive/move/rename, panel tabs, attachments, project links, search, templates, import/export, trash, and `services/ingenium-dashboard/src/app/standalone/page.tsx` (552 lines) — docs space selector/creator. Navigation Docs link is active (stale badge removed).  
🔴 **W3 items still pending**: rich TipTap WYSIWYG/source editor, E2E Playwright test suite.

| # | Defect | Layer | Status | Notes |
|---|--------|-------|--------|-------|
| 1 | **Attachment download endpoint missing** | API | ✅ ROUTE IMPL | `GET /pages/:id/attachments/:attId/download` implemented at line 1256. Headers, ownership check, path traversal prevention, streaming. Dashboard UI: `/docs` Attachments tab has upload/download/delete buttons (page.tsx:326-437). |
| 2 | **Template update endpoint missing** | API | ✅ ROUTE IMPL | `PUT /templates/:id` implemented at line 1468, uses core `updateTemplate()`. Dashboard UI: Template picker dialog (`TemplatePicker`) available from toolbar. |
| 3 | **Comment update endpoint missing** | API | ✅ ROUTE IMPL | `PUT /pages/:id/comments/:commentId` implemented at line 1072 (inline DB update with ownership check). No core `updateComment()` — update is in route layer. |
| 4 | **Trash endpoints missing** | API | ✅ ROUTE IMPL | `GET /spaces/:spaceId/trash` (list, line 634) and `DELETE /spaces/:spaceId/trash` (purge all, line 646) implemented. Dashboard UI: `TrashPanel` component in right sidebar with archive/restore per page and purge-all button. Soft-delete (`handleArchive`) sends page to trash, restore available from trash tab. |
| 5 | **Slug-based page lookup broken** | MCP → API | ✅ ROUTE IMPL | `GET /pages?spaceId=&slug=` implemented at line 371, uses core `getPageBySlug()`. MCP handler `docsGetPage` calls correct path at line 71. Dashboard UI: pages selected by URL `?page=<id>` param. |
| 6 | **Slug-based space lookup broken** | MCP → API | ✅ ROUTE IMPL | `GET /spaces?slug=` implemented at line 201, uses core `getSpaceBySlug()`. MCP handler `docsGetSpace` calls correct path at line 22. Dashboard UI: `/docs?space=<id>` param selects space, `/standalone?page=docs` lists spaces and routes into `/docs?space=...`. |
| 7 | **DOCS_ENDPOINTS mismatch** — 3 of 48 paths missing (not 11+ wrong) | Catalog | 🟢 W1B CALLER ALIGNED | `mcp-tool-catalog.ts:233-283` has 48 entries. Verified: 0 wrong paths. Missing: `GET /pages` (slug lookup), `PUT /pages/:id/comments/:commentId` (non-resolve), `POST /docs/ai` (docs-ai.ts). All other routes present with correct verb+path. |
| 8 | **Project link MCP handler sends `linkedProjectId: number`** | MCP → API | 🟢 W1B CALLER ALIGNED | `docsLinkProject` (line 298) now uses `projectId: string` param and POST `/docs/pages/${pageId}/projects`. `docsUnlinkProject` (line 304) uses DELETE `/docs/pages/${pageId}/projects/${encodeURIComponent(linkedProjectId)}`. Both verified from source. |
| 9 | **`saveAttachment` uses `INSERT OR REPLACE`** | Core | ✅ FIXED | Changed to `ON CONFLICT(page_id, filename) DO UPDATE` in `docs.ts:986-994`. HARD RULE #11 compliant. Tested. |
| 10 | **No trash/prune lifecycle** | API | ✅ ROUTE IMPL | `GET /spaces/:spaceId/trash` (line 634), `DELETE /spaces/:spaceId/trash` (line 646). Core `purgeArchivedPages()`, `listArchivedPages()` at lines 376-393. |
| 11 | **No draft-first page creation** | API | ✅ FIXED | Core `createPage()` creates at revision 0, status `'draft'`. API `POST /spaces/:spaceId/pages` (line 594) + `POST /pages/:id/publish` (line 823). Tested. |
| 12 | **`GET /docs/versions/:versionId` endpoint path** | DOCS_ENDPOINTS | 🟢 W1B CALLER ALIGNED | `GET /api/v1/docs/pages/:pageId/versions/:versionId` is in catalog at line 253. MCP `docsGetVersion` (line 159) uses correct page-scoped path. Both verified from source. |
| 13 | **MCP ↔ API path mismatches** | MCP → API | 🟢 W1B CALLER ALIGNED | All 7 handler defects verified as fixed in `services/ingenium-server/lib/tools/docs.ts`. Handlers use canonical routes (POST /move, page-scoped comments/versions, /projects suffix). No alias-dependent handlers remain. |
| 14 | **Dashboard client PATCH → PUT** | Dashboard | 🟢 W1B CALLER ALIGNED | Dashboard `api.docs.pages.update` (line 777) uses PUT with `expectedRevision` camelCase. Comments (line 841) use PUT with pageId. Versions (line 858-865) page-scoped. All verified from source. |

---

## Canonical Envelope & Error Shape

### ✅ Success Response

```typescript
{
  data: T;              // The resource payload (object, array, or primitive)
  total?: number;       // Present for list endpoints (array length)
}
```

### ❌ Error Response

```typescript
{
  error: {
    code: string;           // Machine-readable: one of the codes below
    message: string;        // Human-readable description
    currentRevision?: number; // Only on CONFLICT for page updates
  }
}
```

### Error Codes

| HTTP Status | Code | Meaning |
|-------------|------|---------|
| 400 | `BAD_REQUEST` | Missing/ invalid required field |
| 400 | `LLM_NOT_CONFIGURED` | No LLM configured in Settings (AI-only) |
| 404 | `NOT_FOUND` | Resource does not exist |
| 409 | `CONFLICT` | Slug/name uniqueness violation OR optimistic concurrency failure |
| 413 | `PAYLOAD_TOO_LARGE` | Import data or attachment exceeds size limit |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Attachment MIME type not in allowlist |
| 500 | `INTERNAL_ERROR` | Unexpected server error; AI transport/internal failures return generic message with no details leaked |
| 502 | `LLM_ERROR` | AI upstream returned an error, no upstream body leaked in response (AI-only) |

---

## Database Schema

### docs_spaces

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment ID |
| name | TEXT UNIQUE | Display name (e.g., "Engineering") |
| slug | TEXT UNIQUE | URL-safe slug (e.g., "engineering") |
| description | TEXT | Optional description |
| icon | TEXT | Icon name for UI (default: "folder") |
| sort_order | INTEGER | Display sort order |
| is_global | INTEGER | All spaces are global (default: 1) |
| created_at | TEXT | ISO timestamp |
| updated_at | TEXT | ISO timestamp |

### docs_pages

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment ID |
| space_id | INTEGER FK → docs_spaces.id ON DELETE CASCADE |
| parent_page_id | INTEGER FK → docs_pages.id ON DELETE SET NULL |
| title | TEXT | Page title |
| slug | TEXT | URL-safe slug, UNIQUE(space_id, slug) |
| content | TEXT | Published Markdown content |
| revision | INTEGER | Optimistic concurrency counter. Starts at **0** for draft pages. Becomes **1** on first publish. Incremented on every subsequent publish and on `PUT /pages/:id` (published edit). |
| status | TEXT CHECK | `'draft'` (default on creation), `'published'`, or `'archived'` |
| sort_order | INTEGER | Display sort order |
| is_favorite | INTEGER | 0/1 bookmark flag |
| created_at | TEXT | ISO timestamp |
| updated_at | TEXT | ISO timestamp |

> Pages are always created as `'draft'` with `revision=0`. Explicit `POST /pages/:id/publish` promotes to `'published'` with `revision=1`. No `publish: true` creation flag exists — publishing is always a separate action.

### docs_page_drafts

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment ID |
| page_id | INTEGER FK → docs_pages.id ON DELETE CASCADE, UNIQUE | One draft per page |
| title | TEXT | Draft title override (applied atomically on publish). Added by migration 040. |
| slug | TEXT | Draft slug override (applied atomically on publish). Added by migration 040. |
| content | TEXT | Draft Markdown content |
| base_revision | INTEGER | The page revision at the time this draft was last saved. Used for conflict detection during publish. Added by migration 040. |
| saved_at | TEXT | ISO timestamp |

> `title` and `slug` in the draft allow users to preview title/slug changes before publishing. On `POST /pages/:id/publish`, the draft's title/slug/content are atomically copied to the published page, and the draft row is cleared. If draft title/slug are empty strings, the page's current values are preserved.

### docs_page_versions

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment ID |
| page_id | INTEGER FK → docs_pages.id ON DELETE CASCADE |
| revision | INTEGER | Revision number at snapshot time. UNIQUE with page_id. |
| title | TEXT | Snapshot of title |
| content | TEXT | Snapshot of Markdown content |
| created_at | TEXT | ISO timestamp |

> `UNIQUE(page_id, revision)` enforced by index `idx_docs_versions_page_rev_unique` (migration 040). Duplicate revisions for the same page are rejected.

### docs_tags / docs_page_tags

**docs_tags:** id (PK), name (UNIQUE), slug (UNIQUE)
**docs_page_tags:** page_id (FK), tag_id (FK), PK(page_id, tag_id)

### docs_page_links

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment ID |
| source_page_id | INTEGER FK → docs_pages.id ON DELETE CASCADE |
| target_page_id | INTEGER FK → docs_pages.id ON DELETE CASCADE |
| link_text | TEXT | Display text for `[[wikilink]]` |
| UNIQUE(source_page_id, target_page_id) |

### docs_comments

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment ID |
| page_id | INTEGER FK → docs_pages.id ON DELETE CASCADE |
| parent_comment_id | INTEGER FK → docs_comments.id ON DELETE CASCADE | Threaded replies |
| content | TEXT | Comment body |
| selection_text | TEXT | Highlighted text the comment refers to |
| selection_offset | INTEGER | Character offset of selection |
| resolved | INTEGER | 0/1 resolved state |
| created_at | TEXT | ISO timestamp |
| updated_at | TEXT | ISO timestamp |

### docs_page_projects

| Column | Type | Description |
|--------|------|-------------|
| page_id | INTEGER FK → docs_pages.id ON DELETE CASCADE |
| project_id | TEXT FK → projects.id ON DELETE CASCADE |
| PK(page_id, project_id) |

> `project_id` is **TEXT** (not INTEGER) to match `projects.id TEXT PRIMARY KEY`. Migration `037_docs_project_links.sql` originally declared `INTEGER`; **migration 040** rebuilt the table with correct TEXT type.

### docs_attachments

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment ID |
| page_id | INTEGER FK → docs_pages.id ON DELETE CASCADE |
| filename | TEXT | Internal UUID-based filename |
| original_name | TEXT | Original uploaded filename |
| mime_type | TEXT | MIME type |
| size_bytes | INTEGER | File size in bytes |
| storage_path | TEXT | Relative path under INGENIUM_HOME/attachments/ |
| created_at | TEXT | ISO timestamp |
| UNIQUE(page_id, filename) |

### docs_templates

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment ID |
| name | TEXT UNIQUE | Template name |
| description | TEXT | Optional description |
| content | TEXT | Template Markdown (with placeholders) |
| category | TEXT | Category (default: 'general') |
| created_at | TEXT | ISO timestamp |

### docs_pages_fts (FTS5 Virtual Table)

```sql
CREATE VIRTUAL TABLE docs_pages_fts USING fts5(
    title,
    content,
    content='docs_pages',
    content_rowid='id'
);
```

Kept in sync via INSERT/DELETE/UPDATE triggers on `docs_pages`.

---

## Canonical Routes

All routes are prefixed with `/api/v1/docs`. Payloads use **camelCase**.

### Spaces

| Method | Endpoint | Request Body | Response `data` | Notes |
|--------|----------|-------------|-----------------|-------|
| GET | `/spaces` | — | `DocSpace[]` | Also supports `?slug=<slug>` for slug lookup (line 201). Auto-creates default "Personal" space if none exist. |
| GET | `/spaces/:id` | — | `DocSpace` | By integer ID |
| POST | `/spaces` | `{ name, slug, description?, icon? }` | `DocSpace` | 201 created |
| PUT | `/spaces/:id` | `{ name?, slug?, description?, icon?, sort_order? }` | `DocSpace` | |
| DELETE | `/spaces/:id` | — | — | 204 no content. Cascades to all pages. |

### Pages

| Method | Endpoint | Request Body | Response `data` | Notes |
|--------|----------|-------------|-----------------|-------|
| GET | `/spaces/:spaceId/pages` | — | `DocPage[]` | Supports `?status=published\|draft\|archived` filter |
| GET | `/spaces/:spaceId/tree` | — | `(DocPage & { children[] })[]` | Nested tree, excludes archived |
| POST | `/spaces/:spaceId/pages` | `{ title, slug, content?, parentPageId? }` | `DocPage` | 201. Creates at revision 0, status `draft`. No published version yet. Use `POST /pages/:id/publish` to publish. Rebuilds backlinks only on publish. |
| GET | `/pages/:id` | — | `DocPage` | By integer page ID |
| GET | `/pages` | `?spaceId=<id>&slug=<slug>` | `DocPage` | Slug-based lookup. Returns 404 if not found. |
| PUT | `/pages/:id` | `{ title?, slug?, content?, expectedRevision }` | `DocPage` | Also accepts `expected_revision` (snake alias). 409 on conflict (includes `currentRevision`). Increments revision. Saves old version. |
| DELETE | `/pages/:id` | — | — | 204. Soft-delete: sets status → `'archived'`. | 
| POST | `/pages/:id/restore` | — | `DocPage` | Restores status → `'published'`. See also version restore below. |
| POST | `/pages/:id/move` | `{ newParentId?, newSortOrder? }` | `DocPage` | Reparent/reorder. Rejects self-parent and descendant cycles with 409. |
| POST | `/pages/:id/publish` | `{ expectedRevision? }` | `DocPage` | **Explicit publish.** Atomically copies draft content/title/slug → published columns. Sets status → `'published'`. Increments revision (0→1 on first, N→N+1 on re-publish). Saves exactly one version in `docs_page_versions`. Clears the draft row in `docs_page_drafts`. Returns updated `DocPage`. | 

### Page by Slug

✅ **Implemented.** `GET /pages?spaceId=<int>&slug=<text>` at `docs.ts:371`. The MCP tool `ingenium_docs_get_page` already calls this correctly (server `docs.ts:71`).

| Method | Endpoint | Query Params | Response `data` |
|--------|----------|-------------|-----------------|
| GET | `/pages` | `spaceId=<int>&slug=<text>` | `DocPage` |

### Drafts

| Method | Endpoint | Request Body | Response `data` |
|--------|----------|-------------|-----------------|
| GET | `/pages/:id/draft` | — | `DocDraft` |
| PUT | `/pages/:id/draft` | `{ content }` | `DocDraft` | Uses `ON CONFLICT DO UPDATE` |
| DELETE | `/pages/:id/draft` | — | — | 204 |

### Versions

| Method | Endpoint | Request Body | Response `data` |
|--------|----------|-------------|-----------------|
| GET | `/pages/:id/versions` | — | `DocVersion[]` | Ordered by revision DESC |
| GET | `/pages/:id/versions/:versionId` | — | `DocVersion` |
| POST | `/pages/:id/versions/:versionId/restore` | — | `DocPage` | Saves current state as version, restores selected version, increments revision. |

### Search

| Method | Endpoint | Query Params | Response `data` |
|--------|----------|-------------|-----------------|
| GET | `/search` | `q=<query>` (required), `spaceId=<int>` (optional) | `(DocPage & { rank })[]` | FTS5-backed, BM25 ranking. Query sanitized. |

### Tags

| Method | Endpoint | Request Body | Response `data` |
|--------|----------|-------------|-----------------|
| GET | `/tags` | — | `DocTag[]` | All tags, ordered by name |
| GET | `/pages/:id/tags` | — | `DocTag[]` | Tags for a specific page |
| POST | `/pages/:id/tags` | `{ tagName }` | `DocTag` | 201. Upserts tag + page association. |
| DELETE | `/pages/:id/tags/:tagId` | — | — | 204. Removes tag association. |

### Backlinks

| Method | Endpoint | Request Body | Response `data` |
|--------|----------|-------------|-----------------|
| GET | `/pages/:id/backlinks` | — | `(DocPageLink & { source_title, source_slug })[]` | Pages linking TO `:id` via `[[slug]]` |

### Comments

| Method | Endpoint | Request Body | Response `data` | Notes |
|--------|----------|-------------|-----------------|-------|
| GET | `/pages/:id/comments` | — | `DocComment[]` | Ordered by created_at ASC |
| POST | `/pages/:id/comments` | `{ content, parentCommentId?, selectionText?, selectionOffset? }` | `DocComment` | 201. |
| PUT | `/pages/:id/comments/:commentId` | `{ content }` | `DocComment` | Update comment body. Ownership verified against pageId. |
| PUT | `/pages/:id/comments/:commentId/resolve` | — | `DocComment` | Toggle resolved → 1. Ownership verified against pageId. |
| DELETE | `/pages/:id/comments/:commentId` | — | — | 204. Ownership verified against pageId. |

### Attachments

| Method | Endpoint | Request Body | Response `data` | Notes |
|--------|----------|-------------|-----------------|-------|
| GET | `/pages/:id/attachments` | — | `DocAttachment[]` | Ordered by created_at DESC |
| POST | `/pages/:id/attachments` | multipart/form-data | `DocAttachment` | 201. MIME allowlist enforced. Stored under `INGENIUM_HOME/attachments/{pageId}/{uuid}.{ext}`. |
| GET | `/pages/:id/attachments/:attId/download` | — | Binary file stream | Streaming download. Sets `Content-Type` + `Content-Disposition: attachment`. Path traversal prevention via resolved-root containment check (line 1288). Ownership verified against pageId. |
| DELETE | `/pages/:id/attachments/:attId` | — | — | 204. Removes file from disk. Ownership verified against pageId. |

### Templates

| Method | Endpoint | Request Body | Response `data` | Notes |
|--------|----------|-------------|-----------------|-------|
| GET | `/templates` | — | `DocTemplate[]` | Ordered by category, name |
| GET | `/templates/:id` | — | `DocTemplate` |
| POST | `/templates` | `{ name, content, description?, category? }` | `DocTemplate` | 201. Name UNIQUE → 409. |
| PUT | `/templates/:id` | `{ name?, content?, description?, category? }` | `DocTemplate` | Uses core `updateTemplate()` (partial field update). |
| DELETE | `/templates/:id` | — | — | 204 |

### Project Links

| Method | Endpoint | Request Body | Response `data` | Notes |
|--------|----------|-------------|-----------------|-------|
| GET | `/pages/:id/projects` | — | `(DocProjectLink & { project_name })[]` | Resolves project name via JOIN |
| POST | `/pages/:id/projects` | `{ projectId }` | `DocProjectLink` | 201. `projectId` is TEXT (FK to projects.id). Core `linkProject()` accepts string. |
| DELETE | `/pages/:id/projects/:projectId` | — | — | 204. `projectId` is TEXT path param (string, not number). |

### Favorites

| Method | Endpoint | Request Body | Response `data` | Notes |
|--------|----------|-------------|-----------------|-------|
| GET | `/favorites` | — | `DocPage[]` | Non-archived pages with `is_favorite=1`, ordered by updated_at DESC |
| POST | `/pages/:id/favorite` | — | `DocPage` | Toggles `is_favorite` (0→1 or 1→0) |
 
### Trash

✅ **Implemented** as space-scoped endpoints (global trash is space-scoped per design — all spaces are global):

| Method | Endpoint | Request Body | Response `data` | Notes |
|--------|----------|-------------|-----------------|-------|
| GET | `/spaces/:spaceId/trash` | — | `DocPage[]` | All pages with status `'archived'` in space. Uses core `listArchivedPages()`. |
| DELETE | `/spaces/:spaceId/trash` | — | — | 204. **Permanently** deletes ALL archived pages in space. Uses core `purgeArchivedPages()`. |
 
### Import / Export

| Method | Endpoint | Request Body | Response `data` | Notes |
|--------|----------|-------------|-----------------|-------|
| POST | `/import` | `{ spaceId, format, data }` | `DocPage[]` | 201. Pages imported as status `draft`, revision 0. `format`: `"markdown"` or `"json"`. Enforced by `MAX_IMPORT_SIZE` (50 MB). |
| GET | `/spaces/:spaceId/export` | — | `ExportSpaceResult` | Full space export: space + pages + tree + tags + versions + comments |

### Stats

| Method | Endpoint | Request Body | Response `data` |
|--------|----------|-------------|-----------------|
| GET | `/stats` | — | `DocStatCounts` |

### AI Actions

These live under `/api/v1/docs/ai` (separate router in `docs-ai.ts`):

| Method | Endpoint | Request Body | Response `data` |
|--------|----------|-------------|-----------------|
| POST | `/ai` | `{ action, content, title?, selectedText? }` | `{ result: string }` |

Supported actions: `outline`, `continue`, `rewrite`, `summarize`, `fix_grammar`, `tone_professional`, `tone_casual`, `tone_technical`.

#### 🔴 AI Error Contract

The `POST /docs/ai` endpoint returns the following error codes on top of the general codes above:

| HTTP Status | Code | Condition | Upstream body leaked? |
|-------------|------|-----------|-----------------------|
| 400 | `LLM_NOT_CONFIGURED` | No primary LLM model configured in Settings → Providers | N/A |
| 502 | `LLM_ERROR` | Upstream LLM provider returned a non-2xx response | ❌ No — only the HTTP status is logged server-side |
| 500 | `INTERNAL_ERROR` | Transport failure (network error, JSON parse failure, etc.) | ❌ No — only generic message returned; thrown error details logged server-side only |

> 🔴 **Body safety**: The response NEVER includes upstream LLM provider response body text, thrown Error messages, or internal diagnostics. Upstream non-ok response bodies are released via `response.body?.cancel()` to prevent connection-pool exhaustion. All error details are logged server-side via `logger.warn`/`logger.error` with source `"docs-ai"`. Verified by `docs-ai-security.test.ts` (3 tests: upstream body non-leakage, connection hygiene body release on non-ok, and thrown error non-leakage).

---

## Canonical Payload Interfaces

All interfaces use **camelCase** for wire transfer. The DB stores `snake_case` columns. This is the contract for request/response bodies:

```typescript
// Wire-format interfaces (camelCase)
interface DocSpace {
  id: number;
  name: string;
  slug: string;
  description: string;
  icon: string;
  sortOrder: number;
  isGlobal: number;
  createdAt: string;
  updatedAt: string;
}

interface DocPage {
  id: number;
  spaceId: number;
  parentPageId: number | null;
  title: string;
  slug: string;
  content: string;
  revision: number;
  status: "draft" | "published" | "archived";
  sortOrder: number;
  isFavorite: number;
  createdAt: string;
  updatedAt: string;
}

interface DocDraft {
  id: number;
  pageId: number;
  title: string;        // Draft title override (applied on publish)
  slug: string;         // Draft slug override (applied on publish)
  content: string;
  baseRevision: number | null;  // Page revision at time of last save
  savedAt: string;
}

interface DocVersion {
  id: number;
  pageId: number;
  revision: number;
  title: string;
  content: string;
  createdAt: string;
}

interface DocTag {
  id: number;
  name: string;
  slug: string;
}

interface DocComment {
  id: number;
  pageId: number;
  parentCommentId: number | null;
  content: string;
  selectionText: string;
  selectionOffset: number;
  resolved: number;
  createdAt: string;
  updatedAt: string;
}

interface DocAttachment {
  id: number;
  pageId: number;
  filename: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  createdAt: string;
}

interface DocTemplate {
  id: number;
  name: string;
  description: string;
  content: string;
  category: string;
  createdAt: string;
}

interface DocStatCounts {
  spaces: number;
  pages: number;
  drafts: number;
  versions: number;
  tags: number;
  comments: number;
  attachments: number;
  templates: number;
}
```

---

## Contract Rules

### 🔴 Payload Casing — ✅ VERIFIED

All request bodies and response payloads use **camelCase**. The DB stores `snake_case` — the API layer is responsible for the translation.

✅ **Response mapping**: 12 DTO mapper functions in `docs.ts:9-134` (`mapSpace`, `mapPage`, `mapDraft`, `mapVersion`, `mapTag`, `mapComment`, `mapAttachment`, `mapTemplate`, `mapPageLink`, `mapProjectLink`, `mapSearchResult`, `mapStats`) convert every snake_case DB row to camelCase before sending.

✅ **Request parsing**: Routes read camelCase fields from `req.body` (e.g., `expectedRevision`, `parentPageId`, `tagName`, `projectId`, `spaceId`, `newParentId`, `parentCommentId`, `selectionText`, `selectionOffset`). Some routes also accept snake_case fallbacks (`expected_revision`) and legacy names (`linkedProjectId`, `name` for tags) for backward compatibility.

### 🔴 Project IDs are TEXT (canonical fact)

`projects.id` is defined as **TEXT PRIMARY KEY** in `001_init.sql`. Migration `037_docs_project_links.sql` originally declared `project_id INTEGER`, but **migration 040** now rebuilds `docs_page_projects` with `project_id TEXT`. This fix is verified at the core layer — `linkProject()` accepts `string projectId`, tests confirm TEXT FK (`docs-contract.test.ts:737-744`).

✅ **API route**: `POST /pages/:id/projects` accepts `projectId` as any type and converts with `String(projectId)` (line 1375). `DELETE /pages/:id/projects/:projectId` treats path param as raw string (line 1415). **MCP handler `linkedProjectId` is still `number` type** (needs fix).

### 🔴 Optimistic Concurrency

Pages have a `revision` counter (starts at 0 for draft, incremented on every publish and on `PUT /pages/:id` mutation). Any `PUT /pages/:id` must include `expectedRevision` matching the current DB value. On mismatch, return:
```json
{ "error": { "code": "CONFLICT", "message": "...", "currentRevision": 5 } }
```

✅ **Core-implemented**: `createPage()` starts revision at 0. `publishPage()` and `updatePage()` both accept optional `expectedRevision` and return `{ conflict: true, currentRevision }` on mismatch. Verified by tests (`docs.test.ts:345-363`, `docs-contract.test.ts:282-303`).

### 🔴 Draft/Publish Lifecycle (Draft-First)

- Pages are **always created as `'draft'`** with revision 0. There is no `publish: true` creation flag — publishing is always an explicit separate action.
- Unsaved changes are persisted to the **draft** buffer (`docs_page_drafts`) via autosave timer (30s). Draft autosave does NOT create published versions or touch `docs_pages.revision`. Drafts carry optional `title`, `slug`, and `base_revision` metadata that are atomically applied during publish (migration 040).
- **Explicit Publish** (`POST /pages/:id/publish`) atomically: copies draft content/title/slug → published columns, increments `revision` (0→1 on first publish, N→N+1 on re-publish), saves exactly one version snapshot in `docs_page_versions`, rebuilds backlinks from wikilinks, and clears the draft row. Optional `expectedRevision` enables optimistic concurrency. This is an API action, not just editor-side UX.
- **Soft delete** sets status → `'archived'`. Permanent delete removes from trash.

✅ **Core-implemented**: `createPage()`, `publishPage()`, `saveDraft()`, `archivePage()`, `restorePage()` all verified by tests (`docs.test.ts` sections 2–5, `docs-contract.test.ts` "draft/publish lifecycle"). API routes and Dashboard UI implemented.

### 🔴 Content Limits

| Resource | Limit | Enforced At | W1A Status |
|----------|-------|-------------|------------|
| Page content | **2 MB** (`MAX_PAGE_CONTENT_LENGTH` = 2,097,152 bytes) | ✅ Core (`createPage()`, `saveDraft()`, `updatePage()`, `publishPage()` all check) | 🟢 **Core-fixed** (`constants.ts:25`, `docs.ts` throughout) |
| Attachment size | **10 MB** per file (`MAX_ATTACHMENT_SIZE`) | API (`formidable` config) | 🔴 API-level only |
| Import payload | **50 MB** (`MAX_IMPORT_SIZE`) | API (buffer byte check) | 🔴 API-level only |
| Comment length | **64 KB** (`MAX_COMMENT_LENGTH` = 65,536 bytes) | ✅ Core (`createComment()` rejects over-limit) | 🟢 **Core-fixed** (`constants.ts:28`, `docs.ts:901`) |
| Tags per page | 20 | Not enforced | 🔴 Not implemented |
| Attachments per upload | 10 files | API (`formidable maxFiles`) | 🔴 API-level only |
| Version history | Last 100 kept; older pruned | Not implemented | 🔴 Not implemented |
| Draft save interval | 30 seconds (frontend timer) | Dashboard | 🔴 Frontend |

✅ **Content limit boundary tests verify**: `docs.test.ts:273-279` (createPage), `docs.test.ts:414-421` (updatePage), `docs.test.ts:445-449` (saveDraft), `docs.test.ts:611-628` (comments), `docs-contract.test.ts:153-204` (all boundary tests).

### 🔴 Cycle Prevention (Mandatory Validation)

Page hierarchy cycle prevention is **mandatory** in create and move operations:

- **On page creation**: `POST /spaces/:spaceId/pages` with `parentPageId` must validate that the proposed parent is not a descendant of the new page (cycle check).
- **On page move**: `POST /pages/:id/move` with `newParentId` must validate that the target parent is not the page itself or one of its descendants. Reject with `409 CONFLICT` and code `CYCLE_DETECTED` if a cycle would be created.
- **Backlink graph** (`docs_page_links`): Rebuilt by `rebuildBacklinks()` after every create/update/restore. This parses `[[wikilink]]` patterns, resolves slugs, inserts links (skipping self-references), and uses `INSERT OR IGNORE`. This is a separate concern from hierarchy cycle prevention.

✅ **Core-implemented**: `movePage()` in `docs.ts:641-684` implements `wouldCreateCycle()` (walks parent chain), returns `PARENT_SELF`/`PARENT_CYCLE` errors. `createPage()` validates parent through `validateParentPage()`. Verified by 7 tests (`docs.test.ts:475-541`, `docs-contract.test.ts:347-400`). API cycle-to-HTTP-409 mapping pending.

### 🔴 Attachment Rules

1. **MIME allowlist**: Only permitted MIME types are accepted (images, PDF, text, CSV, Markdown, MS Office, ZIP, JSON).
2. **Storage path**: Files stored at `{INGENIUM_HOME}/attachments/{pageId}/{uuid}.{ext}`.
3. **Path traversal prevention**: The stored `filename` is a server-generated UUID; the `original_name` is stored separately for display.
4. **Delete cascade**: When a page is archived/permanently deleted, attachments are removed from disk + DB (ON DELETE CASCADE).
5. **✅ `saveAttachment` uses `ON CONFLICT DO UPDATE`** (not `INSERT OR REPLACE`). HARD RULE #11 compliance verified by tests: same (page_id, filename) upsert preserves row ID (`docs.test.ts:548-561`, `docs-contract.test.ts:81-99`). `deleteAttachment()` returns the deleted row for ownership verification (`docs.test.ts:563-575`).

### 🔴 max_tokens = 8192 (AI)

The AI actions endpoint (`POST /ai`) uses `max_tokens: 8192` and **never falls back to `reasoning_content`** (consistent with HARD RULE #9).

---

## RAG Indexing Lifecycle

Pages in the Docs Workspace are automatically indexed into the RAG (Retrieval-Augmented Generation) system at lifecycle boundaries. This means every published page is searchable via `ingenium_docs_search_semantic` and answerable via `ingenium_docs_ask` without manual re-indexing.

| Lifecycle Event | RAG Action | Source Path |
|----------------|------------|-------------|
| `publishPage()` | Creates/replaces chunk index | `docs-page:{page.id}` |
| `updatePage()` (published) | Updates chunk index | `docs-page:{page.id}` |
| `archivePage()` | Deletes from index | — |
| `restorePage()` | Creates chunk index | `docs-page:{page.id}` |

See `indexPublishedDoc()` in `packages/ingenium-core/lib/tools/rag.ts` and its call sites in `docs.ts`.

For canonical repository docs (`docs/**/*.md`), use `POST /api/v1/rag/ingest` or `ingenium_docs_ingest` — these are indexed with `source_type='file'` and `source_path='docs/relative/path.md'`, NOT as editable Docs Workspace pages.

### RAG Tools

| MCP Tool | API Route | Purpose |
|----------|-----------|---------|
| `ingenium_docs_search_semantic` | `GET /rag/search?q=` | BM25 FTS5 full-text search |
| `ingenium_docs_ask` | `POST /rag/ask` | LLM-grounded Q&A with citations |
| `ingenium_docs_ingest` | `POST /rag/sources` | Manual document ingestion |
| `ingenium_docs_rag_sources_list` | `GET /rag/sources` | List indexed sources |
| `ingenium_docs_rag_source_get` | `GET /rag/sources/:id` | Get source detail |
| `ingenium_docs_rag_source_delete` | `DELETE /rag/sources/:id` | Remove source + chunks |
| `ingenium_docs_rag_reingest` | `POST /rag/sources/:id/ingest` | Replace source content |
| `ingenium_docs_rag_stats` | `GET /rag/stats` | Index statistics |

See [../concepts/architecture.md](../concepts/architecture.md) for the full RAG indexing architecture, embedding strategy, chunker details, and citation format.

## MCP Tool Catalog (48 Documentation Tools — 🟢 CALLER ALIGNED)

All tools are in the `"Documentation"` category, default-enabled, and per-project scoped. The canonical tool names and their mapping to API endpoints are defined in [mcp-tool-catalog.ts](../../packages/ingenium-core/lib/tools/mcp-tool-catalog.ts) (the `DOCS_ENDPOINTS` array at line 233).

**Status: 🟢 ALIGNED.** The `DOCS_ENDPOINTS` array at `mcp-tool-catalog.ts:233-283` contains **49 entries** (source-verified count; includes `GET /api/v1/docs/stats` at line 282). All 6 backward-compat aliases have been **removed** from `docs.ts`.

All canonical routes present except 3 source-verified gaps (not in array):
1. `GET /api/v1/docs/pages` (slug lookup, docs.ts line 371 — registered with query params, no param-capture conflict with `GET /pages/:id`)
2. `PUT /api/v1/docs/pages/:id/comments/:commentId` (non-resolve comment update, docs.ts line 1072 — inline DB update, no core function)
3. `POST /api/v1/docs/ai` (docs-ai.ts — separate router, not in DOCS_ENDPOINTS)

The 6 backward-compat aliases (`PUT /move`, `POST /link-project`, `POST /comments/:commentId/resolve`, `DELETE /comments/:commentId`, `DELETE /attachments/:attId`, `GET /export/:spaceId`) are intentionally excluded — they have been **removed** from the API and no longer exist in `docs.ts`.

---

## Dashboard UI (W2 Implemented)

The Docs Workspace dashboard at `/docs` provides an immersive responsive 3-pane workspace.

### Layout
- **Left pane** — `PageTree` component: collapsible tree of pages in the selected space. Supports keyboard navigation, inline rename, move dialog, archive action, and tree refresh after mutations. A "New Page" button opens the `CreatePageDialog`.
- **Center pane** — Main content area: `DocsEditor` (basic textarea-based Markdown editor with View/Edit/Source/Split mode buttons). Shows `WelcomeScreen` when no page is selected, `PageLoadingSkeleton` during load, and error states on failure. Rename inline bar appears above the editor when triggered.
- **Right sidebar** — Tabbed panel (`RightSidebar`) with 8 tabs: Info, Tags, Backlinks, Comments, History, Linked (project links), Files (attachments), Trash. Toggleable via the sidebar button. Page-scoped tabs are disabled when no page is selected.

### Actions (source-verified from `page.tsx`)
| Action | Implementation | API Call |
|--------|---------------|----------|
| **Create page** | `CreatePageDialog` modal — enter title, auto-generates unique slug | `POST /spaces/:spaceId/pages` |
| **Publish** | Publish button in top bar (visible when status is `draft`) | `POST /pages/:id/publish` |
| **Archive** | Archive button in top bar — soft-deletes to trash | `DELETE /pages/:id` |
| **Restore** | `TrashPanel` — restore button per archived page | `POST /pages/:id/restore` |
| **Move** | `MovePageDialog` — select new parent from tree; self+descendant exclusion prevents cycles | `POST /pages/:id/move` |
| **Rename** | Inline rename bar with `autoFocus` — triggered from tree context, input auto-focuses for immediate typing, Enter submits, Escape cancels | `PUT /pages/:id` |
| **Delete attachment** | Attachments tab — per-file delete button | `DELETE /pages/:id/attachments/:attId` |
| **Link/unlink project** | Linked tab — input field + link button, per-link unlink | `POST /pages/:id/projects`, `DELETE /pages/:id/projects/:projectId` |

### Dialogs & Panels
- **SearchDialog** — FTS5-backed full-text search, keyboard-navigable, selects page and navigates to it
- **TemplatePicker** — Browse/create from templates, creates a new page with the template name
- **ImportExportDialog** — Import Markdown/JSON, export full space (Markdown or JSON)
- **TrashPanel** — Lists archived pages with per-page restore and purge-all
- **CommentsPanel** — Add/edit/resolve comments on a page
- **HistoryPanel** — Version history with restore to previous version
- **BacklinksPanel** — Pages linking to the current page via `[[wikilink]]`

### Standalone Mode (`/standalone?page=docs`)
The `/standalone` page supports `page=docs` as a valid value. `StandaloneDocs()` fetches all spaces, displays them as a selectable list with "New Space" creation dialog (name + description). Selecting a space navigates to `/docs?space=<id>`. This enables embedding the docs workspace in tiling window managers or Electron BrowserView.

### Editor Modes (Current — W2 Basic)

The Docs Workspace currently offers a basic textarea-based Markdown editor:

| Mode | Description | W3 Status |
|------|-------------|-----------|
| **View** | Rendered Markdown output — read-only view | ✅ Implemented |
| **Edit** | Basic textarea-based Markdown editing | 🔴 Pending (TipTap/rich editor) |
| **Source** | Raw Markdown source editing in textarea | 🔴 Pending (syntax highlighting) |
| **Split** | Side-by-side Source + Preview | 🔴 Pending (live preview) |

> The WYSIWYG TipTap/ProseMirror rich editor, source-mode syntax highlighting, and split-pane live preview are **W3 pending** and not yet implemented.

### Navigation
The Docs link in the navigation sidebar (`Navigation.tsx:230`) is active with no "Coming Soon" badge. The stale badge was removed as part of W2.

---

## AI Actions and Dictation

When an LLM is configured, the Docs Workspace supports AI-powered actions via `POST /docs/ai`:

- **Summarize** — AI summary of current page
- **Suggest edits** / **Continue** — LLM-powered improvement/continuation
- **Outline** — Generate structured outline
- **Rewrite** / **Fix grammar** — Targeted improvements
- **Tone adjustments** — professional, casual, technical
- **Dictation** — Voice-to-text via browser SpeechRecognition API

---

## Security

### Markdown Sanitization

1. DOMPurify sanitization on rendered HTML output
2. HTML tags stripped from Markdown source in non-edit modes
3. Raw HTML in Markdown escaped unless explicitly allowed

### Path Traversal Prevention

1. `path.basename()` strips directory components from upload filenames
2. Storage paths are server-generated UUID-based filenames
3. Download endpoints validate `storage_path` against `INGENIUM_HOME/attachments/`

### FTS5 Sanitization

1. Special characters in user queries escaped via `sanitizeFts5Query()`
2. Query length limited to prevent DoS
3. FTS5 syntax injection (`'`, `*`, `"`) controlled

---

## MCP Tool Handlers (Server Layer — 🟢 CALLER ALIGNED)

The MCP tool handlers live in `services/ingenium-server/lib/tools/docs.ts`. Each handler makes an HTTP call to the Ingenium API (`services/ingenium-api`).

**Status: 🟢 ALL 7 DEFECTS VERIFIED AS FIXED** (from source). Every handler now uses canonical routes — no alias dependencies remain.

| Handler | Current Path | Canonical Path | Method | Status |
|---------|-------------|----------------|--------|--------|
| `docsMovePage` (line 106) | `POST /docs/pages/${id}/move` | `POST /docs/pages/${id}/move` | POST → same | ✅ Canonical |
| `docsGetVersion` (line 159) | `GET /docs/pages/${pageId}/versions/${versionId}` | `GET /docs/pages/${pageId}/versions/${versionId}` | With pageId | ✅ Canonical |
| `docsResolveComment` (line 185) | `PUT /docs/pages/${pageId}/comments/${commentId}/resolve` | `PUT /docs/pages/${pageId}/comments/${commentId}/resolve` | With pageId | ✅ Canonical |
| `docsDeleteComment` (line 191) | `DELETE /docs/pages/${pageId}/comments/${commentId}` | `DELETE /docs/pages/${pageId}/comments/${commentId}` | With pageId | ✅ Canonical |
| `docsDeleteAttachment` (line 245) | `DELETE /docs/pages/${pageId}/attachments/${attachmentId}` | `DELETE /docs/pages/${pageId}/attachments/${attId}` | With pageId | ✅ Canonical |
| `docsLinkProject` (line 298) | `POST /docs/pages/${pageId}/projects` | `POST /docs/pages/${pageId}/projects` | `/projects` suffix | ✅ Canonical. Uses `projectId: string` param (not `linkedProjectId: number`). |
| `docsUnlinkProject` (line 304) | `DELETE /docs/pages/${pageId}/projects/${linkedProjectId}` | `DELETE /docs/pages/${pageId}/projects/${projectId}` | Correct suffix | ✅ Canonical. Uses `encodeURIComponent`. |
| `docsExportSpace` (line 360) | `GET /docs/spaces/${spaceId}/export` | `GET /docs/spaces/${spaceId}/export` | Correct path | ✅ Canonical |

**Additionally implemented** (new handlers for previously missing functionality):
- `docsPublishPage` (line 112) — `POST /docs/pages/${id}/publish` with `expectedRevision`
- `docsListTrash` (line 335) — `GET /docs/spaces/${spaceId}/trash`
- `docsPurgeTrash` (line 341) — `DELETE /docs/spaces/${spaceId}/trash`
- `docsGetAttachmentDownload` (line 254) — Returns download URL for `GET /docs/pages/${pageId}/attachments/${attachmentId}/download`
- `docsUpdateTemplate` (line 281) — `PUT /docs/templates/${id}`

All 6 backward-compat API aliases (`PUT /move`, `POST /link-project`, `POST /comments/:commentId/resolve`, `DELETE /comments/:commentId`, `DELETE /attachments/:attId`, `GET /export/:spaceId`) have been **removed** from the API. No MCP handler depended on them.
