# Docs Workspace Reference

The Docs Workspace is a full-featured documentation management system built into Ingenium. It provides global documentation spaces, hierarchical pages, version history, inline commenting, tagging, backlinks, full-text search, and more.

---

## Architecture Overview

```
docs_spaces (containers)
    └── docs_pages (content units, hierarchical via parent_page_id)
            ├── docs_page_drafts (autosave drafts, 1:1 with pages)
            ├── docs_page_versions (revision history)
            ├── docs_page_tags (tag associations)
            ├── docs_page_links (backlinks between pages)
            ├── docs_comments (inline comments with threading)
            ├── docs_page_projects (project associations)
            └── docs_attachments (file attachments)
docs_tags (tag catalog)
docs_templates (reusable page templates)
docs_pages_fts (FTS5 virtual table for full-text search)
```

### Key Concepts

- **Global spaces**: All documentation spaces are global (`is_global = 1`) by default, meaning they are visible across all projects.
- **Page hierarchy**: Pages can nest via `parent_page_id` (self-referencing FK with `ON DELETE SET NULL`).
- **Optimistic concurrency**: Each page has a `revision` counter that increments on every save.
- **Drafts**: Each published page can have one draft (autosave buffer). Drafts are kept separate from the published content.
- **Versions**: Every page save creates a snapshot in `docs_page_versions`, preserving the full revision history.
- **Backlinks**: `[[page-slug]]` references between pages are tracked in `docs_page_links` for bidirectional navigation.

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
| is_global | INTEGER | Global-first: all spaces are global (default: 1) |
| created_at | TEXT | Auto-set ISO timestamp |
| updated_at | TEXT | Auto-updated ISO timestamp |

### docs_pages

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment ID |
| space_id | INTEGER FK | References docs_spaces(id) ON DELETE CASCADE |
| parent_page_id | INTEGER FK | Self-referencing: references docs_pages(id) ON DELETE SET NULL |
| title | TEXT | Page title |
| slug | TEXT | URL-safe slug, unique within space |
| content | TEXT | Published Markdown content |
| revision | INTEGER | Optimistic concurrency counter (default: 1) |
| status | TEXT CHECK | 'draft', 'published', or 'archived' |
| sort_order | INTEGER | Display sort order |
| is_favorite | INTEGER | Bookmark flag (0/1) |
| created_at | TEXT | Auto-set ISO timestamp |
| updated_at | TEXT | Auto-updated ISO timestamp |
| UNIQUE(space_id, slug) | | No duplicate slugs per space |

### docs_page_drafts

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment ID |
| page_id | INTEGER FK | References docs_pages(id) ON DELETE CASCADE, UNIQUE |
| content | TEXT | Draft Markdown content |
| saved_at | TEXT | Auto-set ISO timestamp |

### docs_page_versions

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment ID |
| page_id | INTEGER FK | References docs_pages(id) ON DELETE CASCADE |
| revision | INTEGER | Revision number |
| title | TEXT | Snapshot of title |
| content | TEXT | Snapshot of Markdown content |
| created_at | TEXT | Auto-set ISO timestamp |

### docs_tags / docs_page_tags

**docs_tags:**

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment ID |
| name | TEXT UNIQUE | Display name |
| slug | TEXT UNIQUE | URL-safe slug |

**docs_page_tags:**

| Column | Type | Description |
|--------|------|-------------|
| page_id | INTEGER FK | References docs_pages(id) ON DELETE CASCADE |
| tag_id | INTEGER FK | References docs_tags(id) ON DELETE CASCADE |
| PRIMARY KEY(page_id, tag_id) | | Composite PK |

### docs_page_links

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment ID |
| source_page_id | INTEGER FK | References docs_pages(id) ON DELETE CASCADE |
| target_page_id | INTEGER FK | References docs_pages(id) ON DELETE CASCADE |
| link_text | TEXT | Display text for the link |
| UNIQUE(source_page_id, target_page_id) | | No duplicate links |

### docs_comments

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment ID |
| page_id | INTEGER FK | References docs_pages(id) ON DELETE CASCADE |
| parent_comment_id | INTEGER FK | Self-referencing (threaded replies), ON DELETE CASCADE |
| content | TEXT | Comment body |
| selection_text | TEXT | Highlighted text the comment refers to |
| selection_offset | INTEGER | Character offset of selection |
| resolved | INTEGER | Whether comment is resolved (0/1) |
| created_at | TEXT | Auto-set ISO timestamp |
| updated_at | TEXT | Auto-updated ISO timestamp |

### docs_page_projects

| Column | Type | Description |
|--------|------|-------------|
| page_id | INTEGER FK | References docs_pages(id) ON DELETE CASCADE |
| project_id | INTEGER FK | References projects(id) ON DELETE CASCADE |
| PRIMARY KEY(page_id, project_id) | | Composite PK |

### docs_attachments

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment ID |
| page_id | INTEGER FK | References docs_pages(id) ON DELETE CASCADE |
| filename | TEXT | Internal filename (unique per page) |
| original_name | TEXT | Original uploaded filename |
| mime_type | TEXT | MIME type (default: application/octet-stream) |
| size_bytes | INTEGER | File size in bytes |
| storage_path | TEXT | Relative path under INGENIUM_HOME/attachments/ |
| created_at | TEXT | Auto-set ISO timestamp |
| UNIQUE(page_id, filename) | | No duplicate filenames per page |

### docs_templates

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment ID |
| name | TEXT UNIQUE | Template name |
| description | TEXT | Optional description |
| content | TEXT | Template Markdown (with placeholders) |
| category | TEXT | Category (default: 'general') |
| created_at | TEXT | Auto-set ISO timestamp |

### docs_pages_fts (Virtual Table)

```sql
CREATE VIRTUAL TABLE docs_pages_fts USING fts5(
    title,
    content,
    content='docs_pages',
    content_rowid='id'
);
```

FTS is kept in sync via INSERT/DELETE/UPDATE triggers on `docs_pages`.

---

## API Endpoints

Documentation endpoints are grouped under `/api/v1/docs/`:

### Spaces

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/docs/spaces` | List all spaces |
| POST | `/api/v1/docs/spaces` | Create a new space |
| GET | `/api/v1/docs/spaces/:id` | Get space details |
| PUT | `/api/v1/docs/spaces/:id` | Update space |
| DELETE | `/api/v1/docs/spaces/:id` | Delete space (cascades to pages) |

### Pages

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/docs/spaces/:spaceId/pages` | List pages in a space (tree) |
| POST | `/api/v1/docs/spaces/:spaceId/pages` | Create page |
| GET | `/api/v1/docs/pages/:id` | Get page with content |
| PUT | `/api/v1/docs/pages/:id` | Update page (increments revision) |
| DELETE | `/api/v1/docs/pages/:id` | Delete page |
| PATCH | `/api/v1/docs/pages/:id/move` | Move page (change parent or sort_order) |
| PATCH | `/api/v1/docs/pages/:id/favorite` | Toggle favorite |
| PATCH | `/api/v1/docs/pages/:id/status` | Change status (draft/published/archived) |

### Drafts

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/docs/pages/:id/draft` | Get current draft |
| PUT | `/api/v1/docs/pages/:id/draft` | Save/update autosave draft |
| DELETE | `/api/v1/docs/pages/:id/draft` | Discard draft |

### Versions

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/docs/pages/:id/versions` | List version history |
| GET | `/api/v1/docs/pages/:id/versions/:versionId` | Get specific version content |
| POST | `/api/v1/docs/pages/:id/versions/:versionId/restore` | Restore version (creates new revision) |

### Tags

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/docs/tags` | List all tags |
| POST | `/api/v1/docs/tags` | Create tag |
| PUT | `/api/v1/docs/pages/:id/tags` | Set tags on a page (replace all) |

### Links

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/docs/pages/:id/links` | Get inbound/outbound links for page |
| POST | `/api/v1/docs/pages/:id/links` | Create link between pages |

### Comments

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/docs/pages/:id/comments` | List comments on page |
| POST | `/api/v1/docs/pages/:id/comments` | Create comment |
| PUT | `/api/v1/docs/comments/:id` | Update comment |
| DELETE | `/api/v1/docs/comments/:id` | Delete comment |
| PATCH | `/api/v1/docs/comments/:id/resolve` | Toggle resolved state |

### Attachments

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/docs/pages/:id/attachments` | List attachments |
| POST | `/api/v1/docs/pages/:id/attachments` | Upload attachment |
| GET | `/api/v1/docs/attachments/:id/download` | Download attachment file |
| DELETE | `/api/v1/docs/attachments/:id` | Delete attachment |

### Templates

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/docs/templates` | List templates |
| POST | `/api/v1/docs/templates` | Create template |
| PUT | `/api/v1/docs/templates/:id` | Update template |
| DELETE | `/api/v1/docs/templates/:id` | Delete template |

### Search

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/docs/search?q=...` | Full-text search across pages |

---

## Editor Modes

The Docs Workspace supports four editor modes:

| Mode | Description |
|------|-------------|
| **View** | Rendered Markdown output — read-only view |
| **Edit** | WYSIWYG-style rich text editor (TipTap/ProseMirror-based) |
| **Source** | Raw Markdown source editor with syntax highlighting |
| **Split** | Side-by-side Source + Preview (live preview as you type) |

---

## AI Actions and Dictation

When an LLM is configured, the Docs Workspace supports AI-powered actions:

- **Summarize** — Generate an AI summary of the current page
- **Suggest edits** — LLM-powered improvement suggestions
- **Generate from template** — Fill template placeholders using AI
- **Dictation** — Voice-to-text input for page content (browser SpeechRecognition API)

---

## Security

### Markdown Sanitization

All page content and comments are sanitized before rendering to prevent XSS:

1. DOMPurify sanitization on rendered HTML output
2. HTML tags are stripped from Markdown source in non-edit modes
3. Raw HTML in Markdown is escaped unless explicitly allowed

### Path Traversal Prevention

File uploads to `docs_attachments` are protected against path traversal attacks:

1. `path.basename()` is used to strip directory components from upload filenames
2. Storage paths are generated server-side as UUID-based filenames
3. Download endpoints validate the `storage_path` column against `INGENIUM_HOME/attachments/`

### FTS5 Sanitization

Full-text search queries via `docs_pages_fts` are sanitized to prevent FTS5 syntax errors:

1. Special characters in user queries are escaped
2. Query length is limited to prevent DoS
3. FTS5 syntax injection (`'`, `*`, `"`) is controlled

### Resource Limits

| Resource | Limit |
|----------|-------|
| Page content | 1 MB max |
| Attachment size | 50 MB per file |
| Comment length | 10,000 chars |
| Tags per page | 20 max |
| Version history | Last 100 versions kept (older versions pruned) |
| Draft save interval | Autosave every 30 seconds |
