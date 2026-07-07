# HOW-TO: Tasks

## What It Does
Kanban-style task board for tracking work items across columns: todo, in_progress, review, done. Clicking a task advances it to the next column.

## How to Use
1. Navigate to `/tasks` from the dashboard nav bar
2. Type a task title in the input field
3. Click **Add** to create the task in the "todo" column
4. Click any task to advance it to the next column (todo → in_progress → review → done)
5. The board has 4 columns displayed as a 4-column grid

## API Endpoints
- `GET /api/v1/tasks?project=<name>` — list tasks
- `POST /api/v1/tasks?project=<name>` — create task
- `PATCH /api/v1/tasks/:id?project=<name>` — move task (body: `{ column_id }`)
- `GET /api/v1/tasks/next?project=<name>` — get highest-priority task

## Code Location
- Page: `services/ingenium-dashboard/src/app/tasks/page.tsx`
- API client: `services/ingenium-dashboard/src/lib/api.ts` → `api.tasks`
- Route: `services/ingenium-api/lib/routes/tasks.ts`
- Core: `packages/ingenium-core/lib/tools/tasks.ts`

## Related Docs
- STYLING-GUIDE.md — kanban column styling
