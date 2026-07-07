# HOW-TO: Learnings

## What It Does
Logs and searches learning entries across AI agent sessions. Learnings are FTS5-indexed for full-text search. Each entry has a type (pattern, decision, bug, preference, research) and optional tags.

## How to Use
1. Navigate to `/learnings` from the dashboard nav bar
2. Select a learning type from the dropdown (Pattern, Decision, Bug, Preference, Research)
3. Type the learning content in the textarea
4. Click **Log Learning** to save it
5. Entries appear below with color-coded type badges and timestamps

## API Endpoints
- `GET /api/v1/learnings?project=<name>` — recent learnings
- `POST /api/v1/learnings?project=<name>` — log new entry
- `GET /api/v1/learnings/search?project=<name>&q=<query>` — FTS5 search

## Code Location
- Page: `services/ingenium-dashboard/src/app/learnings/page.tsx`
- API client: `services/ingenium-dashboard/src/lib/api.ts` → `api.learnings`
- Route: `services/ingenium-api/lib/routes/learnings.ts`
- Core: `packages/ingenium-core/lib/tools/learnings.ts`

## Related Docs
- STYLING-GUIDE.md — form and badge styling
