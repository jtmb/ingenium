# HOW-TO: Tasks

## What It Does
Kanban-style task board for tracking work items across 4 columns. Supports task creation with descriptions and assignees, drag-and-drop between columns, priority scoring, and dependency tracking.

## Kanban Board Columns
| Column | Purpose |
|--------|---------|
| **todo** | New tasks not yet started |
| **in_progress** | Tasks currently being worked on |
| **review** | Tasks awaiting review or approval |
| **done** | Completed tasks |

## How to Use

### Creating a Task
1. Navigate to `/tasks` from the dashboard nav bar
2. Click the **Add Task** button or use the input field at the top
3. Enter a task title (required)
4. Optionally add a description, assignee, and priority
5. The task appears in the **todo** column by default

### Moving Tasks Between Columns
- **Click to advance**: Click any task card to move it to the next column (todo → in_progress → review → done)
- **Drag and drop**: Drag a task card from one column and drop it onto another column
- **Move backward**: Tasks in later columns can be moved back to earlier ones via drag-and-drop

### Priority Scoring
Tasks can be assigned a priority value (0-10). The `ingenium_task_next` tool returns the highest-priority pending task to work on next.

### Dependency Tracking
Tasks can reference parent-child relationships. When a task has dependencies, it may show blocker information on its card.

### Task Details
- Click a task card to view its full details (description, assignee, priority, creation date)
- The task card shows the title and a truncated description snippet

## MCP Tools

| Tool | Purpose |
|------|---------|
| `ingenium_task_create` | Create a new task with title, description, and assignee |
| `ingenium_task_list` | List tasks, optionally filtered by column |
| `ingenium_task_move` | Move a task to a different column |
| `ingenium_task_complete` | Mark a task as completed |
| `ingenium_task_next` | Get the highest-priority next task to work on |

## API Endpoints
- `GET /api/v1/tasks?project=<name>` — list tasks (optional `?column_id=` filter)
- `POST /api/v1/tasks?project=<name>` — create task (body: `{ title, description?, assigned_to? }`)
- `PATCH /api/v1/tasks/:id?project=<name>` — move task (body: `{ column_id }`)
- `DELETE /api/v1/tasks/:id?project=<name>` — delete a task
- `GET /api/v1/tasks/next?project=<name>` — get highest-priority task

## Code Location
- Page: `services/ingenium-dashboard/src/app/tasks/page.tsx`
- API client: `services/ingenium-dashboard/src/lib/api.ts` → `api.tasks`
- Route: `services/ingenium-api/lib/routes/tasks.ts`
- Core: `packages/ingenium-core/lib/tools/tasks.ts`

## Related Docs
- [mcp-tools.md](./mcp-tools.md) — Full MCP tools reference
- [STYLING-GUIDE.md](../STYLING-GUIDE.md) — Kanban column styling
