# MASTER PLAN — 7 Phases (Remaining Bugs + Features)

**Orchestrator: DeepSeek V4 Pro. Every phase has exact file:line targets — do NOT re-diagnose.**
**Use `@ingenium-software-engineer-premium` for implementation, `@ingenium-docs` for docs, `@ingenium-qa` for testing.**
**After every phase: `npx tsc --noEmit` on touched packages + `npm run test --workspace=packages/ingenium-core` + commit.**

---

## PHASE 0 — DB Recovery + Durability (🔴 BLOCKER)

**Root cause**: WAL grew to 4.1MB (bigger than 3.3MB DB) because `checkpointAfterWrite()` uses PASSIVE checkpoints that silently fail under reader locks. `INGENIUM_CORE_DB_PATH` not set in docker-compose → inconsistent default path. All data IS accessible — recovery is non-destructive.

### 0.1 — Force checkpoint (non-destructive)
```bash
docker compose exec ingenium node -e "
const Database = require('better-sqlite3');
const db = new Database('/app/.ingenium/data');
db.pragma('wal_checkpoint(TRUNCATE)');
console.log('WAL pages after checkpoint:', JSON.stringify(db.pragma('wal_checkpoint(PASSIVE)')));
const result = db.pragma('integrity_check');
console.log('Integrity:', JSON.stringify(result));
db.close();
"
```
If TRUNCATE fails busy → try RESTART → then PASSIVE.

### 0.2 — Fix path + durability
- `docker-compose.yml`: add `INGENIUM_CORE_DB_PATH=/app/.ingenium/data.db` to environment
- `services/ingenium-api/scripts/api-server.ts`: after startScheduler() call — run `wal_checkpoint(TRUNCATE)` + `integrity_check` on startup, log result
- `services/ingenium-api/lib/scheduler.ts`: after each synthesis cycle completion, call `checkpointAfterWrite()` (readers idle = checkpoint succeeds). At ~line 51 (after synthesis, before skill-sync).

### Verification
- Rebuild Docker → `/logs?level=error` must have ZERO "Unhandled error" entries
- WAL file must be < 1MB after startup
- All 22 obs / 14 traits / 45 skills still accessible via API

---

## PHASE 1 — Verbose Error Standard

**Root cause**: `services/ingenium-api/lib/middleware/errors.ts:54` logs `"Unhandled error"` with only `{ error: err?.message }`. ~40 other catch blocks across the codebase drop the stack trace and context.

### 1.1 — Primary error handler
`errors.ts:54` — change log message to: `` `${req.method} ${req.originalUrl} → ${err.name}: ${err.message}` ``. Add to meta: `name`, `stack` (full), `method`, `path`, `requestId`.

### 1.2 — Sweep all catch blocks
Fix every location where errors are logged without stack/context. Key files:
- `routes/emails.ts` (~20 catch blocks at lines 116, 142, 265, 284, 307, 344, 368, 390, 435, 470, 505, 544, 581, 618, 650)
- `routes/tasks.ts:296`, `routes/commands.ts:27,55`, `routes/plugins.ts:29,75`, `routes/settings.ts:61`, `routes/jobs.ts:161-163`
- `routes/observations.ts:136`, `routes/extraction.ts:26`, `routes/synthesis.ts:18,35`
- `scheduler.ts:33,44,69,82,180,184`
- `packages/ingenium-core/lib/tools/synthesis-llm.ts:299,685`
- `packages/ingenium-core/lib/tools/synthesis.ts:170,205,225,229,332,371,405,416`

Pattern: every `logger.error(src, "...", { error: err.message })` → add `name`, `stack` (first 5 lines), and route context where available.

### Verification
Trigger a deliberate error → confirm log message includes method + path + error name + stack in meta.

---

## PHASE 2 — Projects Duplicate Search Bar

**Root cause**: Phase 1 added a search input (`projects/page.tsx:93-101`) while the original creation input (lines 86-90, inside `view==="active"` guard) still exists. User wants the creation input gone, search moved to top-right, create functionality as a `+ New Project` button in the PageHeader.

### Fix
- Remove creation input + Create button (lines 86-90)
- Remove standalone search section (lines 93-101)
- Add `+ New Project` button to the page header bar (top-left of the toggle-bar flex at line 80)
- Move search input into the top-right of the same flex container at line 80
- The `+ New Project` button opens a small modal/create form

### Verification
Playwright: search filters both Active + Archived tabs; create New Project button works; no duplicate inputs visible.

---

## PHASE 3 — Skills Background Consolidation Job

**Root cause**: No `consolidateSkills()` function exists. Phase 3 prompt changes tell the LLM to prefer merges, but synthesis only runs when new observations arrive and only sees the new batch (1-7 obs), not all 45 skills. A standalone consolidation pass is needed.

### 3.1 — New `consolidateSkills(projectId)` in synthesis.ts
If ≤20 skills, return early. If >20: send ALL skill names + descriptions + key content sections to LLM with prompt to propose merges/deletes. Execute via `updateSkill` (merge file_trees) + `deleteSkill`.

### 3.2 — New consolidation LLM call
Reuse `callSynthesisLLM` pattern. Prompt receives full skill catalog, returns `{ merges: [{source, target, reason}], delete: [name] }`.

### 3.3 — Scheduler hook
In `scheduler.ts`, insert after synthesis step (line ~39) and before skill-sync (line ~51). Guard: skip if LLM not configured.

### 3.4 — MCP tool + API route
`ingenium_skill_consolidate` → `POST /api/v1/skills/consolidate?project=...`

### Verification
Trigger consolidation → 45 skills consolidated to ≤20; spot-check merged skills retain references/ file content.

---

## PHASE 4 — Mail OAuth Credential UI + Demo Mode

**Decision**: Credentials live in a new **"Email OAuth" card on `/settings`** page (alongside Synthesis LLM config).

### 4.1 — Settings-based credential store
`packages/ingenium-email/lib/oauth.ts`: read `oauth_gmail_client_id` / `oauth_gmail_client_secret` / `oauth_outlook_client_id` / `oauth_outlook_client_secret` from settings API first, fall back to env vars.

### 4.2 — Settings page OAuth card
Add "Email OAuth" card on `/settings` with 4 input fields (Google client ID/secret, Microsoft client ID/secret) + Save button. Reads/writes via settings API.

### 4.3 — AccountSetup gate
`AccountSetup.tsx`: check if credentials exist before firing OAuth redirect. If not set, show "OAuth not configured" message with link to `/settings`.

### 4.4 — Demo mode
Add "Load Demo Account" button on `/mail` that creates a fake account row → 3-pane UI renders (empty inbox, IMAP gracefully fails).

### Verification
Playwright: no-creds → setup prompt (not error); with creds → valid OAuth URL; demo → 3-pane UI renders.

---

## PHASE 5 — Visual Upgrade

**Current state**: Zero shared UI primitives. The same card string appears 40+ times. Flat pages (observations, agents, settings, mail, plugins, config) lack the header cards, stat badges, filter pills, and empty states that logs/pipeline have. Tailwind v4, no per-page CSS.

### 5A — Extract 8 shared primitives (from logs/pipeline markup)
Create in `src/app/components/`:
- **PageHeader** — hero card (title + subtitle + stat counters + status pill + action children). Extract from `logs/page.tsx:229-267`.
- **StatBadge** — label + colored value. Extract from Logs line 238, Pipeline line 289.
- **Badge** — colored outline/solid chip. Extract from everywhere.
- **FilterPill** / **FilterPills** — active/inactive toggle pills. Extract from Pipeline lines 313-322, Logs lines 277-303.
- **Toolbar** — bordered filter card wrapper. Extract from Logs lines 270-344.
- **SearchInput** — styled search with focus ring. Extract from Logs lines 334-342.
- **EmptyState** — centered message + icon + optional action button. Extract from Logs lines 348-364, generalize mail/EmptyState.
- **ConfidenceBar** — progress bar. Extract from personality lines 101-103.

### 5B — Retrofit 6 flat pages
- **observations**: PageHeader + StatBadges, selects→FilterPills+SearchInput in Toolbar, type-colored left border on rows
- **agents**: PageHeader (Total/Enabled) + EmptyState + fix selects to style-guide + edit-card hover
- **settings**: PageHeader + fix 5 selects + add Email OAuth card (from Phase 4 WIP) + section icons
- **mail**: PageHeader (Unread/Accounts) + shared EmptyState
- **plugins**: PageHeader (Total/Enabled) + EmptyState + toggle-button colors + edit-card hover
- **config**: PageHeader + editor-card hover fix

### Verification
Playwright visual pass all 6 pages; confirm consistent headers/badges/empty states. No new CSS files — all Tailwind classes from shared components.

---

## PHASE 6 — E2E Playwright Testing

**"Test until it works" loop**. `@ingenium-qa` drives, `@ingenium-software-engineer-premium` fixes failures in a loop:

- **/jobs**: create job → run → live log console streams → cron preview
- **/mail**: demo account → 3-pane renders → email MCP tools respond
- **kanban /tasks**: drag-drop, swimlanes, WIP breach, view switch, card detail (comments/activity/time/deps/search/bulk/notifications)
- Loop: fail → fix → re-test until green. Not a single smoke pass.

---

## PHASE 7 — Final Gate

1. Full test suite: `npm run test --workspace=packages/ingenium-core` (must be 181+ green)
2. All tsc: core + api + server + dashboard (3 pre-existing .next errors allowed)
3. `bash tests/enforce-no-db-leaks.sh` — all clean
4. 🐳 final Docker rebuild
5. Playwright sweep: all 17 pages render without crash
6. Pipeline autonomy: scheduler log shows extraction→synthesis→skill-sync
7. DB healthy: WAL < 1MB, zero "Unhandled error" in logs
8. `@ingenium-docs` final consistency sweep
9. Commit

---

## Quick Reference

| Phase | Lead Agent | Rebuild |
|-------|-----------|---------|
| 0 | premium | 🐳 required |
| 1 | premium + fast | 🐳 after |
| 2 | fast | not required (dashboard only) |
| 3 | premium | 🐳 after (core change) |
| 4 | premium + fast | 🐳 after |
| 5 | premium (5A) + fast (5B) | 🐳 after (new components) |
| 6 | qa + premium (fix loop) | 🐳 after each fix loop |
| 7 | qa + docs | 🐳 final |
