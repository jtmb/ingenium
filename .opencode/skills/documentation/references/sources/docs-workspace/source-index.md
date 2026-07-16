---
name: docs-workspace
description: "Documentation workspace conventions — creating, editing, and managing pages in the Ingenium Docs system. Use when creating or editing documentation pages via agents."
---

# Docs Workspace

## When to Use

- Creating new documentation pages via agents
- Editing existing documentation content
- Organizing pages into spaces and hierarchies
- Searching for documentation
- Managing tags, backlinks, and comments
- Importing or exporting documentation

## 🔴 HARD RULEs

### 🔴 Search Before Creating

Before creating a new page, ALWAYS search for existing pages on the same topic. Use `ingenium_docs_search` to check for duplicates. If a relevant page exists, update it instead.

### 🔴 Use Descriptive Slugs

Page slugs must be lowercase, hyphenated, and descriptive. Example: `api-authentication-guide`, not `page1` or `API_Auth`.

Bad: `My Page`, `my_page`, `api`
Good: `my-page`, `api-authentication`, `getting-started-with-docker`

### 🔴 Place Pages in the Right Space

- Engineering documentation → "Engineering" space (or create one if needed)
- Personal notes → "Personal" space
- Project-specific docs → Link to the project using `ingenium_docs_link_project`

### 🔴 Use Internal Wikilinks

Link to other pages using the `[[page-slug]]` syntax. This auto-creates backlinks and keeps the documentation graph connected.

### 🔴 One Topic Per Page

Each page should cover one topic or concept. If a page gets too long, split it into sub-pages using the page hierarchy.

### 🔴 Frontmatter for Metadata

Pages should start with YAML frontmatter when appropriate:
```yaml
---
tags: [api, authentication]
status: draft
---
```

### 🔴 Draft First, Publish After Review

Create pages as drafts. Only publish (`status: published`) after the content has been reviewed and is complete.

### 🔴 Respect Revision Conflicts

When updating a page, use `expectedRevision` to prevent overwriting others' changes. If you get a 409 Conflict, re-read the page and retry.

### 🔴 Backlinks Matter

After creating or moving a page, check backlinks (`ingenium_docs_get_backlinks`) to ensure references are still valid. Update any broken wikilinks.

## Reference Files

| File | Content |
|------|---------|
| [`references/markdown-conventions.md`](references/markdown-conventions.md) | Markdown syntax and conventions for docs pages |
| [`references/agent-workflow.md`](references/agent-workflow.md) | Agent workflow for creating and managing documentation |

## MCP Tools Reference

| Category | Tools |
|----------|-------|
| Spaces | ingenium_docs_list_spaces, ingenium_docs_get_space, ingenium_docs_create_space |
| Pages | ingenium_docs_get_page_tree, ingenium_docs_get_page, ingenium_docs_create_page, ingenium_docs_update_page, ingenium_docs_delete_page, ingenium_docs_restore_page, ingenium_docs_move_page |
| Search | ingenium_docs_search |
| Drafts | ingenium_docs_get_draft, ingenium_docs_save_draft |
| Versions | ingenium_docs_list_versions, ingenium_docs_restore_version |
| Tags | ingenium_docs_list_tags, ingenium_docs_get_page_tags, ingenium_docs_add_tag, ingenium_docs_remove_tag |
| Backlinks | ingenium_docs_get_backlinks |
| Comments | ingenium_docs_list_comments, ingenium_docs_create_comment, ingenium_docs_resolve_comment, ingenium_docs_delete_comment |
| Templates | ingenium_docs_list_templates, ingenium_docs_get_template, ingenium_docs_create_template |
| Favorites | ingenium_docs_toggle_favorite, ingenium_docs_get_favorites |
| Projects | ingenium_docs_link_project, ingenium_docs_unlink_project, ingenium_docs_get_projects |
| Import/Export | ingenium_docs_import_pages, ingenium_docs_export_space |
| Stats | ingenium_docs_get_stats |

## Cross-References

- **`development-conventions`** — Code and API conventions
- **`configuring-opencode`** — Agent permission patterns
- **`skill-maintenance`** — Skill lifecycle management
