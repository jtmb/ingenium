# HOW-TO: Skills

## What It Does
Browses, searches, and edits AI agent skills stored in the SQLite database. Skills are markdown documents that define conventions and rules for AI agents.

## How to Use
1. Navigate to `/skills` from the dashboard nav bar
2. Use the search input to filter skills by name or description
3. Each skill card shows the skill name and description
4. Click a skill to view or edit its full content

## API Endpoints
- `GET /api/v1/skills?project=<name>` — list all skills
- `GET /api/v1/skills/:name?project=<name>` — get single skill
- `POST /api/v1/skills?project=<name>` — create skill
- `PATCH /api/v1/skills/:name?project=<name>` — update skill content
- `GET /api/v1/skills/search?project=<name>&q=<query>` — FTS5 search

## Code Location
- Page: `services/ingenium-dashboard/src/app/skills/page.tsx`
- API client: `services/ingenium-dashboard/src/lib/api.ts` → `api.skills`
- Route: `services/ingenium-api/lib/routes/skills.ts`
- Core: `packages/ingenium-core/lib/tools/skills.ts`

## Related Docs
- STYLING-GUIDE.md — card grid and search input styling
