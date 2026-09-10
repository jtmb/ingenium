---
title: Tasks
description: Kanban task board workflow — creating, managing, and tracking tasks across columns.
---

# HOW-TO: Tasks

## What It Does
Kanban-style task board for tracking work items across 4 columns (configurable via `boardConfig`). Supports task creation with full field set, drag-and-drop between columns, priority scoring, dependency tracking, bulk editing, swimlane grouping, and timeline/list views.

## Kanban Board Columns
| Column | Purpose |
|--------|---------|
| **todo** | New tasks not yet started |
| **in_progress** | Tasks currently being worked on |
| **review** | Tasks awaiting review or approval |
| **done** | Completed tasks |

## How to Use

### Creating a Task — "+ Add Task" Modal

1. Click the **+ Add Task** button in the header bar to open the `TaskCreateModal` overlay with a full field set:

| Field | Required | Type | Notes |
|-------|----------|------|-------|
| Title | **Yes** | Text input | Auto-focused on open; Enter key submits |
| Status | No | Select dropdown | Defaults to "To Do" |
| Assignee | No | Text input | Free-text; shown as colored initial avatar |
| Priority | No | Select dropdown | Critical, High, Medium, Low |
| Due Date | No | Date picker | Overdue dates turn red |
| Issue Type | No | Select dropdown | Task, Epic, Story, Subtask |
| Estimate (minutes) | No | Number input | Time-remaining pie chart |
| Description | No | Textarea | Full-width field |

The board's **+ Add Task** action opens the full task form above. Source
captures use a separate explicit **Create task** control and a title-only
confirmation: enter a non-empty title, then choose **Create Task**. No source
body, transcript, attachment, draft, or other content is copied into the task.

### Moving Tasks Between Columns
- **Drag and drop**: Drag a task card from one column and drop it onto another column using `@dnd-kit/core`
- **Click to advance**: Click any task card to open the `TaskDetail` overlay

### Quick-Add per Column
Each column has its own **"+ Add card"** button for rapid title-only entry.

### Bulk Editing
Toggle "Bulk Edit" mode to select multiple task cards and update column, assignee, and/or priority.

### View Switcher
Three views: **Board** (Kanban columns), **List** (flat list), **Timeline** (chronological).

### Responsive Behavior
On narrow screens, the search field and **+ Add Task** control stack vertically so both remain usable without widening the page. The Kanban board keeps its column width and uses an intentional, bounded horizontal scroll region; on mobile, the **“Swipe horizontally to view all columns.”** hint identifies that region. Focus the **Kanban board** region with the keyboard before using horizontal scrolling when touch input is unavailable.

## Create task from Mail or Context

Use the explicit **Create task** action on a loaded Mail message or in the
Context sources list. The confirmation form is title-only: enter a non-empty
title, then choose **Create Task**. No source body, attachment, or other source
content is copied into the task.

- **Mail** sends the exact loaded `account_id`, `folder`, and `uid`. Mail capture
  always belongs to the active global project (`global-default`, normally), not
  the dashboard's selected worktree project.
- **Context** lists source metadata for the explicitly selected project. A
  Context capture is project-scoped and sends the source's canonical ID; it does
  not fall back to the global project.
- Capture creates a `todo` task and an immutable, metadata-only reference. The
  reference contains only server-derived display metadata and source identity.
- Repeating the same capture returns the existing task and reference instead of
  creating a duplicate.

### Create task from Chat or Docs

- **Chat**: Choose **Create task** from an idle, selected Chat conversation.
  Chat capture belongs to the active global project. The server verifies the
  session ID, OpenCode source instance, upstream project, and mapped global
  project before creating the task. The reference keeps fixed metadata
  (`OpenCode chat`); it never stores the session title or transcript. An
  unmapped, mismatched, or unavailable session is not captured.
- **Docs**: On a selected documentation page, choose **Create task**. The
  selected dashboard project authorizes the page: it must be linked to that
  project (or be globally available). Capture sends the page ID only; it does
  not copy page content or an editor draft.
- Repeating either capture reuses the existing task and metadata-only reference
  rather than creating a duplicate. The server supplies display metadata;
  clients must not fabricate source titles or links.

If the source is missing, outside the required project scope, or not currently
available, capture returns a neutral not-found/error result and creates no task.
Malformed or incomplete title/source identity input is rejected. The UI keeps
the error in the capture form so it can be corrected or cancelled.

Tasks can also carry a metadata-only reference to **chat**, **job**, or **docs**.
These references likewise store only a server-derived display snapshot and IDs;
they never store or return source bodies, attachments, or secrets. Later reads
report whether a source is currently `available`, `missing`, or `unavailable`.

The Task Detail **Source references** section is loaded again when the task is
opened, including after a page reload. It shows the server-reported
`available`, `missing`, or `unavailable` state. It does not turn source IDs into
links or invent URLs when a source cannot be resolved.

Treat every `source_id` as a canonical opaque ID. Do not decode or construct
these IDs in clients; capture adapters will provide them later. Ownership
follows the source policy: email and chat use the global project, context and
jobs are project-scoped, and docs are global unless linked to a project.

## API Endpoints
- `GET /api/v1/tasks?project=<name>` — list tasks (optional `?column_id=` filter)
- `POST /api/v1/tasks?project=<name>` — create task
- `PATCH /api/v1/tasks/:id?project=<name>` — move task
- `DELETE /api/v1/tasks/:id?project=<name>` — delete a task

### Reference routes

| Method | Endpoint | Result |
|--------|----------|--------|
| POST | `/api/v1/tasks/:taskId/references?project=<name>` | Send `{ "source_type": "…", "source_id": "…" }`. `201` creates; `200` returns the existing identical reference (idempotent). |
| GET | `/api/v1/tasks/:taskId/references?project=<name>` | Returns references, immutable display snapshots, and current availability. |
| DELETE | `/api/v1/tasks/:taskId/references?project=<name>&reference_id=<referenceId>` | Removes one reference; `/references/:referenceId` is also accepted. |

Errors are deliberately neutral: `404 TASK_REFERENCE_NOT_FOUND` for unknown or
foreign references, `422 VALIDATION_ERROR` for malformed IDs or input, and
`503 TASK_REFERENCE_UNAVAILABLE` for a temporary source outage. A missing source
does not reveal why it disappeared.

## Code Location
- Page: `services/ingenium-dashboard/src/app/tasks/page.tsx`
- Route: `services/ingenium-api/lib/routes/tasks.ts`
- Core: `packages/ingenium-core/lib/tools/tasks.ts`
