# HOW-TO: Jobs

## What It Does
Job queue and background task monitoring page. Displays a list of scheduled and running jobs with their status, progress, and execution history.

## How to Use
1. Navigate to `/jobs` from the dashboard nav bar
2. The table shows each job's name, status (pending/running/completed/failed), and last run time
3. Click a job row to see its run history, duration, and any error messages
4. Failed jobs show error details that can be expanded inline

### Creating a Job with the Magic-Wand Button
When creating or editing a job, the form uses a **two-column layout** — metadata fields on the left, prompt template on the right (collapses to single column on mobile).

Next to the **Description** field, a magic-wand button (✨ icon labeled "Auto-generate") can derive job configuration from a free-text description:

1. Write a description of what the job should do (e.g., *"Run a security scan every night at 2am"*)
2. Click the magic-wand button
3. The three derived fields are auto-populated:
   - **Prompt Template** — a concrete instruction for the agent
   - **Schedule (cron)** — extracted schedule from the description
   - **Trigger Event** — extracted event trigger (if any)

**Prerequisites**: A Synthesis LLM must be configured in **Settings → Pipeline**. If no LLM is configured, the magic wand is hidden. If the LLM returns empty results, an error message is shown instead.

The button is disabled when the description field is empty, and shows a loading spinner during generation.

## API Endpoints
- `GET /api/v1/jobs?project=<name>` — list all jobs with status
- `GET /api/v1/jobs/:id?project=<name>` — get job details and run history
- `POST /api/v1/jobs/suggest?project=<name>` — derive job config from a free-text description using the Synthesis LLM

  **Request body**: `{ "description": "string" }`
  **Response shape**:
  ```json
  {
    "data": {
      "prompt_template": "string | null",
      "schedule_cron": "string | null",
      "trigger_event": "string | null",
      "configured": true
    }
  }
  ```
  If no Synthesis LLM is configured, returns `{ "data": { ..., "configured": false } }` with all fields `null`.
  If the LLM call fails, returns a `500` error with code `LLM_ERROR`.

> **Note**: `trigger_event` is stored in the DB for future use, but the scheduler currently only dispatches based on `schedule_cron`. No event dispatching exists yet — `trigger_event` is metadata-only until a dispatcher is built.

## Code Location
- Page: `services/ingenium-dashboard/src/app/jobs/page.tsx`
- API client: `services/ingenium-dashboard/src/lib/api.ts` → `api.jobs` (suggest endpoint is called via raw `fetch()` from the page, not through the API client)
- Suggest route: `services/ingenium-api/lib/routes/jobs.ts` → `POST /suggest`
- Core LLM logic: `packages/ingenium-core/lib/tools/job-suggest-llm.ts` → `generateJobConfig()`

## Related Docs
- [logs.md](./logs.md) — Structured logging and event viewer
- [status.md](./status.md) — Service status page
- [synthesis.md](./synthesis.md) — Synthesis Pipeline (the suggest endpoint reuses the Synthesis LLM config)
