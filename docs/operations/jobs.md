---
title: Jobs
description: Job queue and background task monitoring — scheduled and running jobs with status, progress, and execution history.
---

# HOW-TO: Jobs

## What It Does
Job queue and background task monitoring page. Displays a list of scheduled and running jobs with their status, progress, and execution history.

## How to Use
1. Navigate to `/jobs` from the dashboard nav bar
2. Jobs are displayed as a **grid of cards**, each showing the job name, agent badge, description, cron schedule, enable/disable toggle, timeout, and a status dot
3. Each card has a **▶ Run Now** button and an **enable/disable toggle**
4. **Click a job card** to open its full **Detail View**

### Editing a Job
- From the **Detail View**, click the **Edit** button to open the form overlay
- Change any field and click **Update Job** to save

### Creating a Job with the Magic-Wand Button
When creating or editing a job, a magic-wand button (✨ icon labeled "Auto-generate") can derive job configuration from a free-text description:

1. Write a description of what the job should do
2. Click the magic-wand button
3. The three derived fields are auto-populated:
   - **Prompt Template** — a concrete instruction for the agent
   - **Schedule (cron)** — extracted schedule from the description
   - **Trigger Event** — extracted event trigger (if any)

## API Endpoints
- `GET /api/v1/jobs?project=<name>` — list all jobs with status
- `GET /api/v1/jobs/:id?project=<name>` — get job details and run history
- `POST /api/v1/jobs/suggest?project=<name>` — derive job config from description

## Code Location
- Page: `services/ingenium-dashboard/src/app/jobs/page.tsx`
- Suggest route: `services/ingenium-api/lib/routes/jobs.ts` → `POST /suggest`
- Core LLM logic: `packages/ingenium-core/lib/tools/job-suggest-llm.ts`

## Related Docs
- [Logs](logs.md) — Structured logging and event viewer
- [Status](status.md) — Service status page
- [Synthesis Configuration](../configure/synthesis.md)
