---
title: Docs Workspace
description: Using the documentation workspace — creating, editing, publishing, and managing documentation pages.
---

# Usage: Docs Workspace

## Overview

An immersive 3-pane docs workspace at `/docs` for creating, editing, and managing documentation pages organized into spaces. Each page supports a draft-first lifecycle, hierarchical nesting, rich metadata (tags, backlinks, comments, version history, attachments, project links), and full-text search.

## How to Use

1. Navigate to `/docs` in the dashboard (or `/docs?space=<id>` to open a specific space)
2. The **left pane** shows a collapsible page tree for the selected space
3. The **center pane** displays the page editor (View/Edit/Source/Split modes)
4. The **right sidebar** has 8 tabbed panels: Info, Tags, Backlinks, Comments, History, Linked (project links), Files (attachments), Trash
5. Use the **top toolbar** to: create a new page, publish a draft, archive a page, search (FTS5), create from template, import/export

### Actions

| Action | How To |
|--------|--------|
| **Create page** | Click "New Page" button or use `CreatePageDialog` |
| **Publish** | Publish button in top bar (visible when draft) |
| **Archive** | Archive button in top bar — soft-deletes to trash |
| **Restore** | Trash panel — restore button per archived page |
| **Move** | Move dialog — select new parent from tree |
| **Rename** | Inline rename — triggered from tree context |
| **Edit** | Switch to Edit/Source mode in the editor |

### Create a Task from a Page

On the selected page, choose **Create task** in the top toolbar. The
confirmation form is **title-only**: enter a non-empty title and choose
**Create Task**. The page body and any autosaved editor draft are not copied to
the task.

Capture is authorized by the selected dashboard project. The page must be
available to that project through its project link (or be globally available);
otherwise the capture fails without creating a task. The request sends the
canonical page ID, and repeated capture of the same page reuses the existing
task and reference. Task Detail displays the server-derived provenance after
reload as `available`, `missing`, or `unavailable`; it does not fabricate a
source URL or link.

The Create task and confirmation controls are labeled and keyboard-usable with
at least 44px targets, including in the responsive workspace layout.

### MCP Tools

All 48 documentation tools use the `ingenium_docs_` prefix. See the full reference in [Docs Workspace Reference](../reference/docs-workspace.md).

### Standalone Mode

Use `/standalone?page=docs&space=<id>` for embedding in tiling window managers or Electron BrowserView (no sidebar chrome).

## Security

- DOMPurify sanitization on rendered HTML output
- HTML tags stripped from Markdown source
- Path traversal prevention on attachments
- FTS5 sanitization on search queries

## Related Docs
- [Docs Workspace Reference](../reference/docs-workspace.md) — Full canonical contract, route tables, schemas
