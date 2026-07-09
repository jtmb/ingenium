# HOW-TO: Projects

## What It Does
Manages project configurations. Each project has its own SQLite database containing skills, learnings, tasks, and servers. The dashboard provides Active/Archived tab views with rename, archive, restore, and purge actions.

## How to Use
1. Navigate to `/projects` from the dashboard nav bar
2. Type a project name in the input field and click **Create** to initialize a new project
3. The project appears in the Active list with its name and creation date
4. Toggle to the **Archived** tab to view archived projects
5. Use action buttons on each card:
   - **Rename** — update the project name inline
   - **Archive** — soft-delete (moves to Archived tab)
   - **Restore** — move back to Active (from Archived tab)

## API Endpoints
- `GET /api/v1/projects` — list all active projects
- `POST /api/v1/projects` — create a new project (body: `{ name }`)
- `PATCH /api/v1/projects/:name` — rename a project (body: `{ name: newName }`)
- `DELETE /api/v1/projects/:name` — archive a project
- `POST /api/v1/projects/:name/restore` — restore an archived project
- `GET /api/v1/projects/archive` — list archived projects
- `POST /api/v1/projects/purge` — purge expired projects (body: `{ retention_days }`)

## MCP Tools

| Tool | Parameters | Description |
|------|-----------|-------------|
| `ingenium_project_init` | `name` | Create a new project |
| `ingenium_project_list` | — | List all active projects |
| `ingenium_project_delete` | `name` | Delete a project |
| `ingenium_project_list_archived` | — | List archived projects |
| `ingenium_project_restore` | `name` | Restore an archived project |
| `ingenium_project_purge` | `project, retentionDays?` | Permanently purge expired projects |

## Code Location
- Page: `services/ingenium-dashboard/src/app/projects/page.tsx`
- API client: `services/ingenium-dashboard/src/lib/api.ts` → `api.projects`
- Route: `services/ingenium-api/lib/routes/projects.ts`
- Core: `packages/ingenium-core/lib/tools/projects.ts`

## Related Docs
- STYLING-GUIDE.md — card grid and form styling rules
