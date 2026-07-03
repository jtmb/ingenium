# Skill Learnings Log

Changelog of all skill additions, retirements, and significant updates. Appended automatically by `update-skills` and `audit-skills`.

**Convention**: Every entry MUST include both `**Before**:` and `**After**:` commit hashes. This enables reverting any skill to its pre-change state:
- Skills: `git checkout <before> -- .agents/skills/<name>/`

Entries before 2026-07-02-audit-fix use legacy `**Commit**:` format — going forward, always capture both.

---

## 2026-07-03 — 🔴 Mandatory Skills: unconditional, 25 non-infra skills

- **Before**: `621bdd3`
- **After**: (pending)
- **Changes**:
  1. **Removed all "local model" qualifiers** — header, column, every row. No conditional language.
  2. **Expanded 7 → 25 mandatory skills**: Every domain skill added except infrastructure frameworks (containers, kubernetes, github-actions-hardening, github-actions-efficiency).
  3. **Synced deploy/AGENTS.md** (was stale with old "Local Model Mandatory Skills" header).
  4. **Updated `/skill-load` payload** — Step 2 dropped "If you are a local model" conditional.
- **Rationale**: Models don't know if they're local. Conditional language = excuse to skip. Fixed: no conditions, just "MUST load."

---

## 2026-07-03 — `/skill-load` rename + 🔴 Local Model Mandatory Skills section

- **Before**: `30ef808` (state after /skill addition, before rename)
- **After**: `9db70bd`
- **Changes**:
  1. **Renamed `/skill` → `/skill-load`**: directory `.agents/skills/skill/` → `.agents/skills/skill-load/`, frontmatter `name: skill` → `name: skill-load`, all references updated in AGENTS.md, SKILL-INDEX.md, bootstrap.sh, deploy mirror, and learnings.md
  2. **Added 🔴 Local Model Mandatory Skills section** to AGENTS.md: 7-row table listing skills that local/offline models MUST load — `model-profiles`, `local-model-commands`, `debugging-patterns`, `useful-tests`, `project-structure`, `error-interpretation`, `self-correction-patterns`. Each row explains WHY the skill is mandatory (not a suggestion) for local models.
  3. **Updated `/skill-load` SKILL.md** to reference the new 🔴 Local Model Mandatory Skills section and include it in Step 2
- **Rationale**: `/skill` was too easy to miss in a crowded AGENTS.md. `/skill-load` is explicit about its purpose. The mandatory skills section closes the gap where local models would skip these 7 skills because they looked like "suggestions" rather than requirements.
- **Updated**: source + deploy for AGENTS.md, SKILL-INDEX.md, skill-load/SKILL.md, bootstrap.sh, learnings.md

---

## 2026-07-03 — `/skill` command: session-init bootstrap payload

- **Before**: `00b8acc` (state before skill creation)
- **After**: `b896dc4` (originally created as `/skill`, later renamed to `/skill-load`)
- **Problem**: Even with AGENTS.md rewrite, there was no guarantee the model reads it. AGENTS.md lives on disk, but local models don't auto-load files. They need a `/command` that injects the loading instructions directly into the prompt.
- **Root cause**: VS Code Copilot Chat injects SKILL.md content when a `/command` is invoked. By creating a `/skill-load` command, the payload is guaranteed to be in the first prompt — the model CANNOT skip it because it's in the context window.
- **Fixed**: Created `.agents/skills/skill-load/SKILL.md` — a 5-step numbered protocol that the model MUST execute before any action:
  1. Read AGENTS.md
  2. Match skills to user request using the Quick-Reference table
  3. Load every matching skill (read full SKILL.md)
  4. Note the 🔴 HARD RULEs
  5. Confirm which skills apply, then proceed
- **Anti-Skip Rule**: Explicit instruction that the model cannot claim it "already knows" — must re-read AGENTS.md even if cached
- **Added to**: AGENTS.md task skills table (`/skill-load` as first entry), SKILL-INDEX.md (Invocable Task Skills + Always-Included Domain + Skill Links), bootstrap.sh FILES array (`always` tier)
- **Deployed**: `deploy/.agents/skills/skill-load/SKILL.md` synced, deploy/AGENTS.md and deploy/SKILL-INDEX.md synced
- **Skill count**: 42 → 43
- **Design rationale**: This is a "payload skill" — its SKILL.md IS the payload. When user types `/skill-load`, VS Code injects this content into the prompt. The model has no choice but to follow the numbered protocol. Unlike AGENTS.md (which sits on disk and can be ignored), the payload is in-context and unavoidable.

---

## 2026-07-03 — AGENTS.md rewrite: mandatory skill-loading protocol

- **Before**: `829e6e4` (state before AGENTS.md rewrite)
- **After**: `e04250c`
- **Problem**: Local models were ignoring the entire skill system — not creating skills, not logging to learnings, not following anything outside `generic-conventions`
- **Root cause**: AGENTS.md was 10 lines of passive text ("Start here: check .agents/skills/"). Local models read it as informational, skipped skill discovery, and fell through to `generic-conventions` (the mermaid default)
- **Fixed**: Rewrote AGENTS.md from 10-line signpost to authoritative protocol with:
  - 🔴 MANDATORY section at top — "Load Skills Before Acting"
  - 🔴 Session Startup Checklist — 4 numbered steps (match → load → note HARD RULEs → invoke context/help)
  - 🔴 Pre-Flight Check table — 8 action→skill mappings for the most common operations
  - Inline Skill Quick-Reference — full catalog of 42 skills organized by category (always, framework, domain, task)
  - Each skill row has a "Use when" column so models can match without filesystem access
  - Self-Improvement section — explicit instructions to use update-skills, audit-skills, log to learnings
- **Updated**: `deploy/AGENTS.md` — synced
- **Updated**: `generic-conventions` description — added "ALWAYS check .agents/skills/ for framework/domain skills FIRST" (source + deploy)

## 2026-07-03 — local-model-commands skill (terminal safety for local LLMs)

- **Before**: `c57b4ab` (state before skill creation)
- **After**: `4b709e4`
- **Added**: `local-model-commands` skill — prevents local LLMs from backgrounding terminal commands with `&`
- **Rationale**: Local models repeatedly append `&` to dev servers/watchers/daemons, producing zero terminal feedback and hanging the session
- **Content**: 🔴 HARD RULE (never `&`), 🔴 HARD RULE (no infinite-wait commands), 4 safe patterns (sync, timeout wrapper, background+verify, tool mode), anti-pattern catalog (7+ examples)
- **Deploy tier**: `always` — affects every project using local models
- **Updated**: `bootstrap.sh` — added `local-model-commands` to FILES array (always)
- **Updated**: `README.md` — added to Always-Included Skills table
- **Updated**: `model-profiles` — added "Universal Local Model Behavior" section with cross-reference, synced to deploy
- **Updated**: `SKILL-INDEX.md` (source + deploy) — new entry, count 41→42
- **Verification**: 19/19 tests pass (skill count test expects 42 now)

## 2026-07-03 — playwright-mcp deploy sync + audit deploy mirror check

- **Before**: `15e47ab` (state before fixes)
- **After**: `6c7caec`
- **Added**: `playwright-mcp` to `bootstrap.sh` FILES array as `optional` (was source-only, now deployable)
- **Fixed**: `README.md` — removed `(source only)` label from playwright-mcp row
- **Fixed**: `tests/test-self-improving.sh` — removed playwright-mcp from SOURCE_ONLY list (test 4b now expects it in deploy)
- **Added**: Deploy mirror completeness check to `audit-skills` (check #8 — source vs deploy cross-reference)
- **Synced**: audit-skills changes to deploy/ mirror
- **Root cause**: bootstrap.sh has hardcoded FILES array (no auto-discovery); audit-skills had no deploy mirror completeness check

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

## 2026-07-03 — Custom agents + manage-agents retired

- **Before**: `3b00e82` (state with 4 agents + manage-agents skill)
- **After**: TBD (state after removal)
- **Retired**: `plan.agent.md`, `explore.agent.md`, `coder.agent.md`, `doc-writer.agent.md` — 4 custom agent definitions, out of scope
- **Retired**: `manage-agents` skill — agent lifecycle management, no longer needed without custom agents
- **Reverted**: `audit-skills` — removed 8th integration point for agent definitions, went from 8→7 checks
- **Reverted**: `bootstrap.sh` — removed 5 optional entries (4 agents + manage-agents)
- **Reverted**: `USAGE.md` — removed agent persona decision node and reference table row
- **Reverted**: `SKILL-INDEX.md` — count 42→41, removed manage-agents row
- **Reverted**: `learnings.md` — removed agent revert command, agent entry template, manage-agents from consumer list
- **Reverted**: `tests/test-self-improving.sh` — removed agent drift check, reverted deploy integrity checks
- **Reverted**: `deploy/` — removed `.github/` mirror, removed manage-agents mirror
- **Source**: User determined custom agents are out of scope for this project
