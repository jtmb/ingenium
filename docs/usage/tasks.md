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

### Moving Tasks Between Columns
- **Drag and drop**: Drag a task card from one column and drop it onto another column using `@dnd-kit/core`
- **Click to advance**: Click any task card to open the `TaskDetail` overlay

### Quick-Add per Column
Each column has its own **"+ Add card"** button for rapid title-only entry.

### Bulk Editing
Toggle "Bulk Edit" mode to select multiple task cards and update column, assignee, and/or priority.

### View Switcher
Three views: **Board** (Kanban columns), **List** (flat list), **Timeline** (chronological).

## MCP Tools

| Tool | Purpose |
|------|---------|
| `ingenium_task_create` | Create a new task with title, description, assignee, and priority |
| `ingenium_task_list` | List tasks, optionally filtered by column |
| `ingenium_task_move` | Move a task to a different column |
| `ingenium_task_complete` | Mark a task as completed |
| `ingenium_task_next` | Get the highest-priority next task to work on |

## API Endpoints
- `GET /api/v1/tasks?project=<name>` — list tasks (optional `?column_id=` filter)
- `POST /api/v1/tasks?project=<name>` — create task
- `PATCH /api/v1/tasks/:id?project=<name>` — move task
- `DELETE /api/v1/tasks/:id?project=<name>` — delete a task

## Code Location
- Page: `services/ingenium-dashboard/src/app/tasks/page.tsx`
- Route: `services/ingenium-api/lib/routes/tasks.ts`
- Core: `packages/ingenium-core/lib/tools/tasks.ts`
