# Skills Learnings Log

Changelog of all skill additions, retirements, and significant updates. Appended automatically by `update-skills` and `audit-skills`.

**Convention**: Every entry MUST include both `**Before**:` and `**After**:` commit hashes. This enables reverting any skill to its pre-change state via `git checkout <before> -- .agents/skills/<name>/`. Entries before 2026-07-02-audit-fix use legacy `**Commit**:` format — going forward, always capture both.

---

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
- **After**: `pending` (will update after commit)
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
