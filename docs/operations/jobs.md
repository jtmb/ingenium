---
title: Jobs
description: Job queue and background task monitoring — scheduled and running jobs with status, progress, and execution history.
---

# HOW-TO: Jobs

## What It Does
Job queue and background task monitoring page. Displays a list of scheduled and running jobs with their status, progress, and execution history.

## How to Use
1. Navigate to `/jobs` from the dashboard nav bar
2. Use the **Jobs**, **Event queue**, and **Trusted events** views. The Jobs view displays a **grid of cards**, each showing the job name, agent badge, description, cron schedule, enable/disable toggle, timeout, and a status dot.
3. Each card has a **▶ Run Now** button and an **enable/disable toggle**
4. **Click a job card** to open its full **Detail View**

The Event queue and Trusted events views load bounded cursor pages. **Load more** requests the next cursor page; filters run in the browser over the results already loaded and are labeled accordingly. Jobs run history and the Event queue poll for refreshed state while open; Trusted events can be refreshed by returning to the view. Loading, empty, retryable refresh, and fatal error states are announced with accessible status or alert text, and desktop tables become responsive mobile cards.

### Trusted event trigger

Job editing uses an exact Select containing **No event** and the three cataloged trusted events: `context.conversation.archived`, `context.conversation.unarchived`, and `context.checkpoint.restored_as_new`. Existing legacy trigger values are preserved while editing and are not added to the trusted catalog for new selections. **Run Now** always creates a fresh manual run; it is not event replay.

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
- `GET /api/v1/jobs/events?project=<name>&limit=&cursor=` — bounded trusted-event metadata
- `GET /api/v1/jobs/event-deliveries?project=<name>&limit=&cursor=` — bounded delivery metadata
- `GET /api/v1/jobs/event-deliveries/:deliveryId?project=<name>` — get one delivery
- `POST /api/v1/jobs/runs/:runId/cancel?project=<name>` — cancel a project-owned run
- `GET /api/v1/jobs/runs/:runId/logs?project=<name>&after=` — read redacted project-owned logs

## Trusted Events and Delivery (JOB-100/JOB-101)

The dormant v1 catalog contains exactly `context.conversation.archived`,
`context.conversation.unarchived`, and `context.checkpoint.restored_as_new`.
Events are project-scoped, content-free, provenance-bound to immutable Context
maintenance audit rows, deduplicated by project plus source audit ID, and
retained indefinitely as append-only evidence. Unknown values are rejected by
both the API and SQL boundary; historical `trigger_event` values remain
unchanged, while new or changed values must be cataloged or `NULL`.

There is no user append endpoint. JOB-101 snapshots each existing event once,
including zero-match snapshots, then creates one delivery per exact event/job
match for enabled jobs in the same project. Enqueue is exactly-once; execution
is bounded at-least-once with five attempts and 30/60/120/300/600-second
backoffs. Leases use a caller-held token whose SHA-256 hash is persisted with
CAS revisions. Missing or ambiguous process identity is dead-lettered rather
than retried, and job deletion returns `409` while a delivery is active before
disabling the job and preserving delivery history.

There is no payload or prompt interpolation and no manual replay. Durable error
text is bounded and redacted. The API exposes bounded, project-scoped metadata
for trusted events and deliveries; run, log, and cancel access is likewise
project-scoped. Child processes receive an allowlisted environment only; API
credentials and provider secrets are not inherited.

The UI keeps event and delivery state read-only: it does not expose payloads,
prompts, process details, or lease owners, and it provides no retry, dead-letter,
or replay mutation. Delivery states explain the bounded retry policy: queued,
leased, and retry-wait deliveries may proceed; a delivery is attempted at most
five times with 30/60/120/300/600-second backoffs, and a dead-letter delivery is
terminal. Deleting a job with an active delivery returns `409`; disable the job
and retain its delivery history instead.

## Code Location
- Page: `services/ingenium-dashboard/src/app/jobs/page.tsx`
- Suggest route: `services/ingenium-api/lib/routes/jobs.ts` → `POST /suggest`
- Core LLM logic: `packages/ingenium-core/lib/tools/job-suggest-llm.ts`

## Related Docs
- [Logs](logs.md) — Structured logging and event viewer
- [Status](status.md) — Service status page
- [Synthesis Configuration](../configure/synthesis.md)
