# HOW-TO: Jobs

## What It Does
Job queue and background task monitoring page. Displays a list of scheduled and running jobs with their status, progress, and execution history.

## How to Use
1. Navigate to `/jobs` from the dashboard nav bar
2. The table shows each job's name, status (pending/running/completed/failed), and last run time
3. Click a job row to see its run history, duration, and any error messages
4. Failed jobs show error details that can be expanded inline

## API Endpoints
- `GET /api/v1/jobs?project=<name>` — list all jobs with status
- `GET /api/v1/jobs/:id?project=<name>` — get job details and run history

## Code Location
- Page: `services/ingenium-dashboard/src/app/jobs/page.tsx`
- API client: `services/ingenium-dashboard/src/lib/api.ts` → `api.jobs`

## Related Docs
- [logs.md](./logs.md) — Structured logging and event viewer
- [status.md](./status.md) — Service status page
