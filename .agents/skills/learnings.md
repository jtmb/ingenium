# Skills Learnings Log

Changelog of all skill additions, retirements, and significant updates. Appended automatically by `update-skills` and `audit-skills`.

**Convention**: Every entry MUST include both `**Before**:` and `**After**:` commit hashes. This enables reverting any skill to its pre-change state via `git checkout <before> -- .agents/skills/<name>/`. Entries before 2026-07-02-audit-fix use legacy `**Commit**:` format — going forward, always capture both.

---

## 2026-07-02 — SKILL-INDEX.md + update-skill-index

- **Before**: `6b99ba1` (state before deploy sync)
- **After**: `e5c91b9`
- **Added**: `SKILL-INDEX.md` at repo root — canonical index of all 41 skills with descriptions, commands, and links
- **Added**: `update-skill-index` skill — regenerates SKILL-INDEX.md from skill frontmatter, auto-invokes on skill changes
- **Updated**: `audit-skills` — added SKILL-INDEX.md as 7th integration check point, plus deploy sync auto-fix rows
- **Updated**: `help` skill — added `/update-skill-index` to command tables
- **Updated**: `AGENTS.md` — references SKILL-INDEX.md
- **Key decision**: `SKILL-INDEX.md` is also synced to `deploy/SKILL-INDEX.md` so target projects get the index

## 2026-07-02 — agent-pipelines

- **Commit**: `90e7a03`
- **Added**: `agent-pipelines` skill — autonomous agent loop patterns, turn-based orchestration, checkpoint state files, multi-phase build pipelines, containerized agents
- **Source**: Slop Generator reference implementation (4-container Docker Compose sharing one LM Studio instance via turn-based coordination)
- **Category**: Always-Included domain skill

## 2026-07-02 — audit-skills

- **Commit**: `90e7a03`
- **Added**: `audit-skills` skill — cross-reference audit for skill→docs consistency (README, mermaid, bootstrap.sh, USAGE.md, AGENTS.md)
- **Source**: Discovered 19 skill dirs but only 17 referenced in README — needed automated consistency checking
- **Category**: Task skill (invocable via `/audit-skills`)
- **Key change**: Replaced "Propose fixes" pattern with "Auto-Apply" — agent fixes discrepancies without asking permission

## 2026-07-02 — learnings.md created

- **Commit**: `90e7a03`
- **Added**: `learnings.md` tracker at `.agents/skills/learnings.md`
- **Purpose**: Changelog for all skill system changes — additions, retirements, major updates
- **Updated**: `update-skills` and `audit-skills` both append to this file automatically

## 2026-07-02 — useful-tests

- **Commit**: `90e7a03`
- **Added**: `useful-tests` skill — comprehensive testing guide: test pyramid, Playwright E2E, app lifecycle (launch → wait → test → teardown), test quality checklist, AI-generated test anti-patterns, CI integration
- **Source**: User requested skill to prevent AI agents from writing broken untested code — includes Playwright and launching the app as part of tests
- **Category**: Always-Included cross-cutting skill

## 2026-07-02 — help

- **Commit**: `805d2ec`
- **Added**: `help` skill — centralized quick-reference displaying all 24 skills, their commands, triggers, and invocation patterns
- **Source**: User requested a skill to display all commands for every skill
- **Category**: Task skill (invocable via `/help` or "help" query)

## 2026-07-02 — deploy/ separation + self-improving AI test

- **Commit**: `438c302`
- **Added**: `deploy/` directory — mirrors only deployable files (21 skills, hooks, docs, scripts). Source-only items excluded: create-readme, gh-cli, playwright-mcp, thread-auto-context, learnings.md
- **Added**: `test-self-improving.sh` in `tests/` — validates all 4 detection signals, deploy separation integrity, frontmatter validity, and deploy file drift
- **Changed**: `bootstrap.sh` BOOTSTRAP_DIR now points to `deploy/` instead of repo root

## 2026-07-02 — always-read-agents removed

- **Commit**: `f2557f0`
- **Retired**: `always-read-agents` skill — removed from source and deploy
- **Reason**: Circular loop — `AGENTS.md` already tells the AI to scan `.agents/skills/`, so a skill that also says "load the skill system" creates a redundant boot sequence
- **AGENTS.md**: Simplified to 6-line redirect (no per-skill tables, no categories)
- **Affected files**: `AGENTS.md`, `bootstrap.sh` FILES array, `README.md` (mermaid + table), `USAGE.md` (4 tree diagrams), `audit-skills`, `generic-conventions`, `help`, `update-skills`, `write-docs`
- **Fixed**: bash 5.2 `inherit_errexit` grep subshell crashes — `{ grep ... || true; } | wc -l` pattern
- **Source**: User requested deploy/ separation for cleaner consumer installs + test for self-improving AI pipeline

## 2026-07-02 — revert safety (commit-before pattern)

- **Before**: `5cb8c9d` (state before revert safety feature)
- **After**: `3b1d186`
- **Added**: Revert Safety section to `audit-skills` SKILL.md — commit-before → make changes → commit-after workflow
- **Added**: Revert procedure: `git checkout <before-hash> -- .agents/skills/<name>/` to restore any skill
- **Changed**: `learnings.md` convention — entries now require both `**Before**:` and `**After**:` hashes (legacy `**Commit**:` deprecated)
- **Source**: User requested that skill changes be reversible — always capture the pre-change commit hash

## 2026-07-02 — audit fix (5 new skills wired in)

- **Before**: `570e88d` (state after user added 5 new skills, before audit fixes)
- **After**: `ad426bc`
- **Added 5 skills to bootstrap.sh**: `gitignore` (always), `web-design-reviewer` (optional), `chrome-devtools` (optional), `github-actions-hardening` (always), `github-actions-efficiency` (always), `postgresql-optimization` (always), `github-issues` (optional)
- **Added 5 new skills to README**: `github-actions-hardening`, `github-actions-efficiency`, `postgresql-optimization` → Always-Included table; `chrome-devtools`, `github-issues` → Task Skills table
- **Added 5 nodes to README mermaid**: GH, GE, PG, CD, IS
- **Fixed counts**: badge 26→31, cross-cutting 10→15, tasks 6+4→8+4, intro 26→31, framework badge 8→15 cross-cutting
- **Removed orphan**: `contex-map` from deploy (in deploy but not in source skills)
- **Updated**: `docs/ARCHITECTURE.md` 26→31 skills, 22→27 deployable

## 2026-07-02 — audit fix (rename to Ingenium + README stale counts)

- **Before**: `6d1ff0d` (state after rename, before audit fixes)
- **After**: `e0f8028`
- **Renamed**: "Copilot AI Bootstrap" → "Ingenium" across 7 files — `README.md`, `USAGE.md`, `ARCHITECTURE.md`, `session-start.json`, `hook-bootstrap.sh`, `update-skills` SKILL.md (source + deploy)
- **Catchphrase**: "Genius doesn't repeat itself. Neither should you."
- **Visual**: Added 🌱 "skills that grow with you" badge (purple) to README header
- **Audit fixes**:
  - Added `gitignore` and `web-design-reviewer` to README Always-Included table
  - Added 4 source-only skills to Task Skills table (`create-readme`, `gh-cli`, `playwright-mcp`, `thread-auto-context`)
  - Fixed cross-cutting count: 9 → 10 files
  - Fixed tasks count: 9 → 6 deployable + 4 source-only
  - Added `gitignore` and `web-design-reviewer` nodes to README mermaid diagram
  - Removed stale `always-read-agents` references from README (mermaid + Key Rules table)
  - Updated `docs/ARCHITECTURE.md`: skill count 23 → 26, deployable count 19 → 22
  - Skill count badge: 24 → 26

## 2026-07-02 — model-profiles skill (Qwen + Gemma model-aware hints)

- **Before**: `9c413e8` (state before model-profiles skill)
- **After**: `349aa29`
- **Category**: Always-Included cross-cutting skill
- **Added**: `model-profiles` skill — comprehensive model-aware instruction tuning for Qwen (Qwen2.5 7B–72B, Coder variants) and Gemma (Gemma 3 9B–27B, Gemma 2) families
- **Key content**:
  - Context window reference table (128K for Qwen2.5/Gemma 3, 8K for Gemma 2)
  - Strengths/weaknesses per model family with comparison tables
  - Model-aware hints per size variant (which tasks each model handles well)
  - Cross-Model Strategy Guide — task × best model matrix
  - Prompt adaptation table by parameter range (2B–7B → 72B)
  - Skill adaptation table mapping `debugging-patterns`, `code-review-checklist`, `refactoring-recipes`, `self-correction-patterns`, `cli-toolkit`, `regex-reference`, `git-workflows`, `error-interpretation` to model-specific guidance
- **Updated files**: `README.md` (badge 39→40, cross-cutting 23→24, +1 table row, +1 mermaid node), `bootstrap.sh` (+1 always entry), `docs/ARCHITECTURE.md` (40 skills, 36 deployable), `deploy/` (new skill mirror)

## 2026-07-02 — 8 new skills for local LLMs (9B–27B)

- **Before**: `cad78e2` (state before 8 new skills)
- **After**: `9dc0ea8`
- **Category**: Always-Included cross-cutting skills
- **Added 4 reasoning scaffolding skills** (structure for weaker reasoners):
  - `debugging-patterns` — bisect, log-driven, stack-trace analysis, anti-patterns table, agent checklist
  - `code-review-checklist` — 5-lens review (security → correctness → perf → readability → testing)
  - `refactoring-recipes` — 10 named patterns with ❌BEFORE/✅AFTER code examples
  - `self-correction-patterns` — AI mistake recognition, backtracking triggers, verification loops
- **Added 4 reference knowledge skills** (fill the memorization gap):
  - `cli-toolkit` — jq, curl, sed, awk, find, xargs, grep — flags, recipes, gotchas
  - `regex-reference` — common patterns, per-language escaping, catastrophic backtracking prevention
  - `git-workflows` — rebase, bisect, reflog recovery, conventional commits, squashing
  - `error-interpretation` — error signature → root cause per language + cross-language patterns
- **All 8 include `## Model Notes` section** with model-aware hints for 7B–9B vs 14B–27B parameter range
- **Updated files**: `README.md` (+8 rows, badge 31→39, cross-cutting 15→23, mermaid +8 nodes), `bootstrap.sh` (+8 always entries), `docs/ARCHITECTURE.md` (31→39 skills, 27→35 deployable), `deploy/` (8 new skill mirrors)
