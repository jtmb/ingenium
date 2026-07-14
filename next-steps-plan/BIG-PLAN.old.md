# ONE-SHOT MASTER PLAN — Bugs + Kanban + Jobs

**Orchestrator: DeepSeek V4 Pro · Architect: Fable 5**
**All root causes verified — do not re-diagnose, execute as written.**
**Use `@ingenium-software-engineer-premium` for all implementation.**
**Use `@ingenium-docs` for all documentation updates.**

---

## 🔴 HARD RULES (violate at your own risk)

1. **WAL safety**: `checkpointAfterWrite()` ALWAYS outside `execTransaction()`, never inside.
2. **DB isolation**: Only `core` + `api` touch SQLite. Dashboard/server via HTTP.
3. **Route ordering**: Literal routes (`/stats`, `/next`) BEFORE param routes (`/:id`).
4. **Migration pattern**: Next = `020`. Add to `db.ts:39` + guarded block. CHECK constraints need RENAME→CREATE→COPY→DROP.
5. **After every phase**: `npx tsc --noEmit` + `npm run test --workspace=packages/ingenium-core` + commit.
6. **Rebuild Docker** at 🐳 gates only. Spawn `@ingenium-qa` after implementation phases.
7. **Documentation**: Spawn `@ingenium-docs` at checkpoints marked 📖.

---

## PHASE 1 — Dashboard Quick Fixes (5 bugs)

**Files**: `projects/page.tsx`, `mcp-servers/page.tsx`, `hljs-dark.css`, `skills/page.tsx`, `personality/page.tsx`

| Bug | File:Line | Change |
|-----|-----------|--------|
| Projects archived search | `projects/page.tsx:71,83-88` | Add `searchQuery` state; render search input for BOTH tabs; filter `displayed` by `searchQuery` |
| MCP Tools count = 0 | `mcp-servers/page.tsx:35-39` | Remove `if (tab === "tools")` guard; useEffect depends on `[project]` |
| Code blocks grey-on-grey | `hljs-dark.css:1-5` | Remove `color:inherit` from light-mode `.hljs`; add light-mode token colors |
| Skill overlay cropped | `skills/page.tsx:145-147` | Replace `mt-8 mb-8 w-11/12 max-w-7xl max-h-[90vh]` → near-fullscreen `w-[calc(100%-32px)] h-[calc(100%-32px)] m-4` |
| Personality "blank" | `personality/page.tsx:106-109` | Add amber empty-state card with "show all" button when all traits hidden below 0.30 gate; make "N hidden" prominent |

**Gate**: dashboard tsc → 🐳 → Playwright → commit.

---

## PHASE 2 — API/Core Fixes (3 bugs)

| Bug | File:Line | Change |
|-----|-----------|--------|
| Observation stats INVALID_ID | `routes/observations.ts:50,88` | Move `GET /stats` route ABOVE `GET /:id` |
| "Skill file not found" spam | `skills.ts:199-207` + `routes/skills.ts:106-123` | Skip dirs without SKILL.md in sync-all Phase 1; downgrade missing-skill to debug; include name in payload |
| Skill creation dates | `skills.ts:70-74` + `skills/page.tsx:150-152` | Add `created: ${skill.created_at}` to frontmatter; display date in overlay header |

**Gate**: core tests → curl `/observations/stats` returns real counts → 🐳 → commit.

---

## PHASE 3 — Synthesis Overhaul (3 bugs)

| Bug | Change |
|-----|--------|
| Remove `llm-synthesized-` prefix | `synthesis-llm.ts:106` delete prompt mandate; `:152-154` delete force-prepend; rename 20 existing prefixed skills via API |
| Real metadata.json tags | Add `tags?: string` to response schema + prompt example; `synthesis.ts:310` use LLM tags or fallback |
| 20-skill cap + merge-first | Update Phase 2 prompt: target ≤20, prefer merging into existing skills; add `merge_into` support |

**Gate**: core tests (update prefix-assertion tests) → live synthesis → 🐳 → commit. 📖 docs checkpoint.

---

## PHASE 4 — Mail OAuth + Email Audit (2 bugs)

| Bug | Change |
|-----|--------|
| "require is not defined" | `oauth.ts:130,148` replace `require()` → `await import()`; make callers async |
| Email audit | All 13 MCP tools wired (verified); add OAuth env vars to docker-compose with placeholders; document setup |

**Gate**: 🐳 → Playwright /mail → commit. **🔴 OAuth credentials**: user must supply real client IDs/secrets in `.env`.

---

## PHASE 5 — Client Plugin + Tool Toggle (2 bugs)

| Bug | Change |
|-----|--------|
| Plugin `ENOTDIR` error | `opencode.json:53-55` prefix all paths with `./`; sync to DB configs |
| Tool toggle proof | PATCH `ingenium_skill_list` state `enabled:false` → call tool → expect `TOOL_DISABLED` → re-enable |

**Gate**: user restarts OpenCode once → commit.

---

## PHASE 6 — Kanban Board Overhaul (13 features)

### 6A — Data Layer
**Migration 020**: Extend `tasks` with `parent_id`, `issue_type`, `priority`, `due_date`, `start_date`, time tracking columns, `custom_fields` JSON, `task_fts` FTS5. New tables: `task_comments`, `task_activity`, `task_links`, `task_notifications`, `board_config`.

**Core `tasks.ts`**: Add `updateTask`, `deleteTask`, `searchTasks` (FTS), `addComment/editComment/reactComment`, `logActivity`, `linkTasks`, `getTaskTree`, `notifications`, `getBoardConfig/setBoardConfig`.

**API `routes/tasks.ts`**: Full CRUD, search, comments, activity, links, bulk operations, board config, notifications.

### 6B — MCP Tools
Add: `ingenium_task_update`, `_delete`, `_search`, `_comment`, `_activity`, `_link`, `_board_config_get/set`, `_subtask_create`, `_notifications`.

### 6C — Board UI
- `npm install @dnd-kit/core @dnd-kit/sortable`
- DB-driven columns from board_config, drag-drop between columns
- WIP limits (visual warning at breach), swimlanes (Assignee/Epic/Priority)
- Density toggle (compact/rich), view switcher: List | Board | Timeline
- Timeline: CSS-grid Gantt

### 6D — Card Detail + Collaboration
- Rich-text editor (contentEditable + markdown shortcuts + highlight.js)
- Threaded comments with reactions, activity stream sidebar
- Time tracking inputs + pie badge, dependencies panel
- Custom fields from board_config (15 types, calculated fields)
- Ctrl+K spotlight search (FTS), bulk-edit mode
- Toast notifications (bell icon, polling)

**Gate**: 🐳 → Playwright full pass → @ingenium-qa → commit. 📖 docs checkpoint.

---

## PHASE 7 — /jobs Page (Jenkins-like agent job runner)

### 7A — Backend
- **Feasibility gate**: `docker compose exec ingenium opencode run --help` to verify non-interactive mode
- **Migration 021**: `jobs`, `job_runs`, `job_run_logs`
- **Core `jobs.ts`**: CRUD, run lifecycle, log append/tail
- **Runner `job-runner.ts`**: `child_process.spawn("opencode", ["run", prompt, "--agent", agent])`, stream stdout/stderr, timeout kill, concurrency cap
- **Cron**: 60s tick evaluating `schedule_cron` in scheduler.ts
- **API `routes/jobs.ts`**: CRUD, run/cancel, runs list, log tail

### 7B — MCP Tools
`ingenium_job_create/_list/_update/_delete/_run/_runs/_logs/_cancel`

### 7C — Frontend /jobs
- Job cards (name, agent badge, cron, enabled toggle, last-run status, Run Now button)
- Create/edit overlay (agent dropdown, prompt template, cron, timeout)
- Job detail with Jenkins-style run history + **live log console** (black bg, monospace, polling)
- Kanban↔Jobs hook: @mention agent → "Dispatch as job"

**Gate**: 🐳 → Playwright → commit. 📖 docs checkpoint.

---

## PHASE 8 — Final Integration Gate

1. Full suite: `npm test`, all tsc, `enforce-no-db-leaks.sh`
2. 🐳 final rebuild; Playwright sweep of all 17 pages
3. Verify pipeline autonomy (scheduler log: extraction→synthesis→skill-sync)
4. `@ingenium-qa` full review; `@ingenium-docs` consistency sweep
5. Badge/stat updates (tools ~95, pages 17, agents 9)
6. `/sync-skills` + final commit

---

## Documentation Checkpoints (📖)

| Phase | Spawn @ingenium-docs to update |
|-------|-------------------------------|
| 3 | `self-learning-pipeline.md`, `synthesis.md`, `skills.md`, `AGENTS.md` |
| 6 | `tasks.md`, `STYLING-GUIDE.md`, `mcp-tools.md`, README |
| 7 | NEW `jobs.md`, `ARCHITECTURE.md`, `VARIABLES.md`, `mcp-tools.md`, README, `AGENTS.md` |
| 8 | Final sweep: all page counts, tool counts, nav links |

---

## Appendix: Quick Reference

### Documentation References

| Resource | Path |
|----------|------|
| MCP Tools | [`docs/HOW-TO/mcp-tools.md`](../docs/HOW-TO/mcp-tools.md) |
| Architecture | [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) |
| Synthesis | [`docs/HOW-TO/synthesis.md`](../docs/HOW-TO/synthesis.md) |
| Personality | [`docs/HOW-TO/personality.md`](../docs/HOW-TO/personality.md) |
| Conventions | [`docs/CONVENTIONS.md`](../docs/CONVENTIONS.md) |
| README | [`README.md`](../README.md) |
| Email | [`docs/HOW-TO/email.md`](../docs/HOW-TO/email.md) |
| Self-Learning Pipeline | [`docs/self-learning-pipeline.md`](../docs/self-learning-pipeline.md) |

### Commit Format
`phase(N): brief description (#bug-refs)`

### Verification Per Phase
`npx tsc --noEmit -p packages/ingenium-core && cd services/ingenium-api && npx tsc --noEmit && npm run test --workspace=packages/ingenium-core`
