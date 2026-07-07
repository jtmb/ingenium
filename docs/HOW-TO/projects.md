# HOW-TO: Projects

## What It Does
Manages project configurations. Each project has its own SQLite database containing skills, learnings, tasks, and servers.

## How to Use
1. Navigate to `/projects` from the dashboard nav bar
2. Type a project name in the input field
3. Click **Create** to initialize a new project
4. The project appears in the list below with its name and filesystem path

## API Endpoints
- `GET /api/v1/projects` — list all projects
- `POST /api/v1/projects` — create a new project (body: `{ name }`)

## Code Location
- Page: `services/ingenium-dashboard/src/app/projects/page.tsx`
- API client: `services/ingenium-dashboard/src/lib/api.ts` → `api.projects`
- Route: `services/ingenium-api/lib/routes/projects.ts`
- Core: `packages/ingenium-core/lib/tools/projects.ts`

## Related Docs
- STYLING-GUIDE.md — card grid and form styling rules
