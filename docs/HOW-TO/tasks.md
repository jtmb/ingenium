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

Columns are fetched from the API's `boardConfig` endpoint and can be customized per project.

## How to Use

### Creating a Task — "+ Add Task" Modal

1. Click the **+ Add Task** button in the header bar to open the `TaskCreateModal` overlay with a full field set:

| Field | Required | Type | Notes |
|-------|----------|------|-------|
| Title | **Yes** | Text input | Auto-focused on open; Enter key submits |
| Status | No | Select dropdown | Defaults to "To Do". Options come from `boardConfig` columns. Can set directly to any column (e.g., In Progress, Review, Done) — on submit, if status is not "todo" the API calls create-then-move (creates as todo, then moves to chosen column). |
| Assignee | No | Text input | Free-text; shown as colored initial avatar on cards |
| Priority | No | Select dropdown | Options: `—` (none), Critical, High, Medium, Low |
| Due Date | No | Date picker | Rendered on card; overdue dates turn red |
| Issue Type | No | Text input | Labels shown on card (e.g. "bug", "feature", "task") |
| Estimate (minutes) | No | Number input | Rendered as time-remaining pie chart on cards |
| Description | No | Textarea | Full-width field below the grid |

2. Click **Create Task** to submit. The modal calls `api.tasks.create()` first, then conditionally calls `api.tasks.move()` if the chosen status is not the default "todo".
3. On success, the new task is prepended to the task list and the modal closes.

### Search Bar (Client-Side Filter)

The search bar at the top filters tasks **client-side** across all columns:
- **Case-insensitive substring match** on both `title` and `description` fields
- Filtering is instantaneous — no API call — via `useMemo` on the `filteredTasks` derivation:
  ```typescript
  const filteredTasks = useMemo(() => {
    if (!search.trim()) return tasks;
    const q = search.toLowerCase();
    return tasks.filter(
      (t) => t.title.toLowerCase().includes(q) ||
            (t.description ?? "").toLowerCase().includes(q)
    );
  }, [tasks, search]);
  ```
- The filter applies to **all views** (Board, List, Timeline) simultaneously
- Only the `+ Add Task` button sits beside the search bar — the old inline input was replaced by the modal

### Quick-Add per Column ("+ Add card")

Each column in Board view has its own **"+ Add card"** button at the bottom that works independently of the modal:
- Click to reveal an inline title input + Add button
- Press Enter to submit, Escape to cancel
- Creates the task via `api.tasks.create()` then conditionally moves it to the target column via `api.tasks.move()`
- After creation, the full task list is re-fetched from the server

The modal and quick-add coexist — use the modal for full-field creation and quick-add for rapid title-only entry.

### Moving Tasks Between Columns
- **Drag and drop**: Drag a task card from one column and drop it onto another column using `@dnd-kit/core`
- **Click to advance**: Click any task card to open the `TaskDetail` overlay, where you can change the status via the detail form
- **Move backward**: Tasks in later columns can be moved back to earlier ones via drag-and-drop

### Priority Scoring
Tasks can be assigned a priority value: Critical (weight 4), High (3), Medium (2), Low (1). Cards are sorted by priority within each column (highest first), then by creation date. The `ingenium_task_next` tool returns the highest-priority pending task.

### Bulk Editing
Toggle "Bulk Edit" mode to select multiple task cards with checkboxes:
1. Click **Bulk Edit** in the toolbar
2. Check the cards to edit
3. Use the floating action bar to set column, assignee, and/or priority across all selected cards
4. Click **Apply** — calls `api.tasks.bulkUpdate()` and refreshes from server

### Swimlane Grouping
Group tasks by **Assignee**, **Epic**, or **Priority** using the toolbar select. Each group becomes a row with all columns. Empty groups are collapsed. "No Grouping" restores the flat board layout.

### View Switcher
Three views available via tabs:
- **Board** — Kanban columns (default)
- **List** — Flat list of tasks
- **Timeline** — Chronological timeline view

### Dependency Tracking
Tasks can reference parent-child relationships via `epic_id`. When a task has dependencies, the `TaskDetail` overlay shows blocker information. Click associated tasks to navigate between them.

### Task Details
- Click a task card to view its full details in the `TaskDetail` overlay (all fields + dependency navigation)
- The task card shows title, priority badge, issue type, assignee avatar, due date, and time-remaining pie chart (when estimate is set)
- Compact density mode is available via the toolbar toggle — persists in localStorage

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
- `POST /api/v1/tasks?project=<name>` — create task (body: `{ title, description?, assigned_to?, priority?, due_date?, issue_type?, estimate_minutes? }`)
- `PATCH /api/v1/tasks/:id?project=<name>` — move task (body: `{ column_id }`)
- `DELETE /api/v1/tasks/:id?project=<name>` — delete a task
- `GET /api/v1/tasks/next?project=<name>` — get highest-priority task
- `POST /api/v1/tasks/bulk-update?project=<name>` — bulk update tasks (body: `{ task_ids, column_id?, assigned_to?, priority? }`)

## Code Location
- Page: `services/ingenium-dashboard/src/app/tasks/page.tsx`
- TaskCreateModal: `services/ingenium-dashboard/src/app/tasks/components/TaskCreateModal.tsx`
- BoardView: `services/ingenium-dashboard/src/app/tasks/components/BoardView.tsx`
- TaskDetail overlay: `services/ingenium-dashboard/src/app/tasks/components/TaskDetail.tsx`
- API client: `services/ingenium-dashboard/src/lib/api.ts` → `api.tasks`
- Route: `services/ingenium-api/lib/routes/tasks.ts`
- Core: `packages/ingenium-core/lib/tools/tasks.ts`

## Related Docs
- [mcp-tools.md](./mcp-tools.md) — Full MCP tools reference
- [STYLING-GUIDE.md](../STYLING-GUIDE.md) — Kanban column styling
