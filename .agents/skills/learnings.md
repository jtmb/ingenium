# Skill Learnings Log

Changelog of all skill additions, retirements, and significant updates. Appended automatically by `update-skills` and `audit-skills`.

**Convention**: Every entry MUST include both `**Before**:` and `**After**:` commit hashes. This enables reverting any skill to its pre-change state:
- Skills: `git checkout <before> -- .agents/skills/<name>/`

Entries before 2026-07-02-audit-fix use legacy `**Commit**:` format — going forward, always capture both.

---

## 2026-07-04 — Self-improvement loop activation: hooks as enforcement layer

- **Before**: `ba2e9bb`
- **After**: `78e132a`
- **Problem**: The self-improvement loop (learnings.md logging, update-skills, audit-skills) was completely dead in target repos. Six specific failures: (1) PostToolUse hook was an empty stub `echo '{"continue": true}'`, (2) SessionStart hook was a silent no-op when AGENTS.md existed, (3) deploy/.agents/hooks/ didn't exist at all — hooks never reached target repos, (4) update-skills/audit-skills/update-skill-index were optional-tier and never invoked, (5) deploy/learnings.md was copied as static bootstrap history with meaningless commit hashes, (6) AGENTS.md self-improvement section was passive aspirational text.
- **Root cause**: Hooks were designed as the enforcement layer but never utilized. Skills define rules, hooks enforce them — but every hook was either an empty stub, a no-op, or missing from deploy entirely.
- **Fixed**:
  1. **`post-tool-use.json`**: Rewrote from empty stub to periodic reminder. Uses a session counter file at `.agents/.session-state`. Every ~10 tool calls, injects a systemMessage reminding the model to log new patterns to learnings.md and run /update-skills.
  2. **`session-start.json`**: Now injects an abbreviated skill-loading checklist (4-step protocol) even when AGENTS.md exists. Resets session counter. No longer a silent no-op.
  3. **`pre-tool-use.json`**: Added safety check — warns before terminal commands targeting node_modules, .git, dist, build, .next, target, __pycache__, venv directories.
  4. **`deploy/.agents/hooks/`**: Created directory and copied all 3 hook JSON files. This was the critical gap — hooks never reached target repos because the deploy mirror had no hooks directory.
  5. **`bootstrap.sh`**: Changed hook deploy tier from `optional` to `always`. Promoted update-skills, audit-skills, update-skill-index from `optional` to `always`.
  6. **`deploy/.agents/skills/learnings.md`**: Replaced static bootstrap history with a fresh template containing bootstrap info and explicit model instructions (when to log, what format, key skills reference).
  7. **`AGENTS.md` + `deploy/AGENTS.md`**: Enhanced self-improvement section to reference hook-driven reminders (SessionStart checklist, PostToolUse periodic prompts).
  8. **`tests/test-self-improving.sh`**: Fixed test 4e to allow `hooks/` directory alongside `skills/` in deploy/.agents/.
- **Updated**: All 11 changed files committed. 19/19 tests pass.
- **Classification analysis**: Full audit of all 43 .agents/ items classified into skills (25), instructions/meta (12), tool interfaces (5), data files (1), hooks (3). No directory restructure — skill mechanism works for all types. Hooks are the enforcement layer.

## 2026-07-04 — vision-bridge rewritten: single canonical script, no Playwright in API call

- **Before**: `45f9913`
- **After**: `f0e85a6`
- **Problem**: Agents were looping trying to use Playwright to make the vision API call — the old skill had too many methods (Shell, inline Python, Playwright combo) and ambiguous integration sections
- **Fix**: 
  - Created `vision_call.py` — standalone script that takes a PNG path arg, base64 encodes, POSTs to LM Studio, prints description
  - SKILL.md rewritten as concise reference: Step-by-step workflow, ONE command to run
  - CRYSTAL CLEAR: Playwright is ONLY for CAPTURING screenshots (Step 1b), NEVER for API call (Step 2)
  - Removed ALL alternative methods, integration sections, and example sessions
  - Script already on disk — the SKILL.md just tells the model to run it
- **Test**: `python3 vision_call.py /tmp/test-vision-bridge.png` → correctly described example.com (layout, colors, text, link, no graphics)

## 2026-07-04 — vision-bridge tested and automated — LM Studio API end-to-end

- **Before**: `f7ebefc`
- **After**: `1895ac4`
- **Test**: Successfully called LM Studio vision API at `http://192.168.0.13:1234/v1/chat/completions` with model `google/gemma-4-12b-qat`
- **Scenario**: Captured screenshot of `https://example.com` via Playwright -> extracted base64 -> sent via Python urllib with Bearer token -> received detailed description back (layout, colors, text, interactive elements)
- **Description returned**: Correctly identified Example Domain page, white background, black heading/text, blue "Learn more" link, left-aligned content in upper-left quadrant
- **Automation upgrade**: Replaced entire manual model-switching approach with direct API calls. Key changes:
  1. Blind model calls vision API directly — no user involvement needed
  2. Token stored in `.agents/.lm-studio-env` (gitignored, chmod 600)
  3. Python script block added to SKILL.md for proper JSON/base64 handling
  4. All "INSTRUCTIONS FOR USER" manual switch steps removed
  5. HARD RULE #3 changed from "STOP after emitting template" to "Never stop and wait — call API directly"
  6. States simplified: Monitoring → Triggered → Calling API → Processing → Complete
- **API details**: `POST http://192.168.0.13:1234/v1/chat/completions`, Bearer auth, model=`google/gemma-4-12b-qat`, max_tokens=1000, timeout=180s
- **Token**: Stored as `LM_STUDIO_API_KEY` in `.agents/.lm-studio-env`
- **Note**: Base64 from Playwright's `page.screenshot()` returns `Result: "..."` wrapper — must strip before sending

## 2026-07-04 — Model reference fix — vision-bridge GPT-4o/Claude → google/gemma-4-12b-qat

- **Before**: `aee9135`
- **After**: `d1a6a2d` (audit fix), `c68cb87` (hash finalize)
- **Fixed**: Updated all `GPT-4o/Claude` references in vision-bridge/SKILL.md (8 locations across source + deploy mirror) to `google/gemma-4-12b-qat` — the user's local LM Studio vision model
- **Also fixed**: Stale `GPT-4o/Claude` descriptions in AGENTS.md, deploy/AGENTS.md, SKILL-INDEX.md, deploy/SKILL-INDEX.md
- **Cleaned up**: Removed duplicate skills from `.agents/skills/` (audit-skills, local-model-commands, self-correction-patterns) — these already existed in `.agents/instructions/` and were left untracked after Phase 6 restructure
- **Audit result**: 0 discrepancies found across all 3 directories, all deploy mirrors match, counts verified (26 skills + 13 instructions + 5 tools = 44)

## 2026-07-03 — hang/drip-feed detection: `find` in node_modules + hung commands

- **Before**: `894b5ee`
- **After**: `f02d466`
- **Problem**: Models run `find node_modules/ -name "*.d.ts"` which scans 50K–500K files, hangs the terminal with zero output, and the model sits there waiting. Also: "drip-feed" loops where the model dribbles partial answers, runs exploratory commands, gets no useful output, and never converges on a solution.
- **Root cause**: `local-model-commands` only covered `&` and infinite-wait commands (servers, tail -f). `self-correction-patterns` had no trigger for hung commands or drip-feed loops.
- **Fixed**:
  1. **`local-model-commands`**: Added 2 new 🔴 HARD RULEs:
     - **NEVER Search `node_modules` or Build Output Directories** — `find`/`grep` in `node_modules`, `.git`, `dist`, `build`, `.next`, `target`, `__pycache__`, `venv` hangs the terminal. 5 specific alternatives listed (tsc --noEmit, cat package.json, rg src/, ls, read docs).
     - **Pipe Large Output Through `wc -l` First** — measure output size before running, use `head` after confirming it's manageable. > 100 results = too much, narrow search.
  2. **`self-correction-patterns`**: Added 3 new Recognition Triggers:
     - `find`/`grep` in `node_modules` → STOP, use tsc or read files instead
     - Command running 10+ seconds with no output → Kill it, try different approach
     - Last response incomplete + next command is exploratory → Drip-feed loop detected, STOP and ask user directly
- **Updated**: `deploy/` synced. 19/19 tests pass.

---

## 2026-07-03 — 🔴 Mandatory Skills: unconditional, 25 non-infra skills

- **Before**: `621bdd3`
- **After**: `e7be1ba`
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

## 2026-07-17 — audit: extend coverage to hooks, self-learning, and fix doc discrepancies

- **Before**: `7d8e408` (state before audit extension)
- **After**: `be07dbd`
- **Fixed**: `docs/CONVENTIONS.md` — Deploy Exclusion Rules: "Three" → "Two", removed playwright-mcp entry
- **Fixed**: `docs/CONVENTIONS.md` — deploy/ description: "only skills + AGENTS.md" → "skills, hooks, AGENTS.md, and SKILL-INDEX.md"
- **Fixed**: `USAGE.md` — "(41 skills)" → "(43 skills — 41 after source-only exclusion)"
- **Fixed**: `docs/ARCHITECTURE.md` — deploy/ directory map: "Skills only — no scripts, hooks, docs, or tests" → split into skills/ and hooks/ entries
- **Fixed**: `README.md` — task skill count: "(10 files deployed + 4 source-only)" → "(12 files deployed + 2 source-only)"
- **Fixed**: `README.md` — bootstrap mermaid: added `PreToolUse/PostToolUse hooks enforce rules` feedback loop
- **Fixed**: `README.md` — architecture mermaid: added `Hooks enforce deterministic guardrails` node before `AI follows conventions`
- **Fixed**: `docs/ARCHITECTURE.md` — data flow mermaid: replaced linear flow with full self-improvement cycle (hooks → patterns → learnings.md → update-skills → audit → SessionStart reload)
- **Added**: `docs/ARCHITECTURE.md` — Hooks System section (`.agents/hooks/`) documenting all 3 lifecycle hooks with table
- **Updated**: `.agents/skills/audit-skills/SKILL.md` — expanded from 8 to 10 checkpoints: added Check 9 (Hooks validity) and Check 10 (Self-learning artifacts)
- **Updated**: `audit-skills` — added Steps 8-9 to audit procedure (hooks cross-ref, self-learning artifacts); existing Step 8 renumbered to Step 10
- **Updated**: `audit-skills` — Quick Audit Command: added hooks parity check one-liner
- **Updated**: `audit-skills` — Auto-Fix table: added 5 new rows for hooks/self-learning issues
- **Updated**: `audit-skills` — Verification section: added 4 new checks
- **Synced**: deploy mirror (audit-skills SKILL.md)
- **Verification**: 18/18 tests pass

## 2026-07-04 — Phase 6: Split .agents/skills/ into skills/, instructions/, tools/

**Type**: refactor
**Commit**: `3198737`
**Before**: `e9fed9b`

Split the flat `.agents/skills/` directory into three specialized directories:
- `.agents/skills/` (26 items) — framework & domain conventions (file-triggered)
- `.agents/instructions/` (12 items) — task skills, session init, recovery (slash-command)
- `.agents/tools/` (5 items) — browser automation & GitHub operations

Moves executed via `git mv` for history preservation (source) and `cp` + `rm` (deploy mirror):
- **Moved to instructions/**: audit-skills, debugging-patterns, generate-docs, help, local-model-commands, repo-context, self-correction-patterns, skill-load, thread-auto-context, update-skill-index, update-skills, write-docs
- **Moved to tools/**: chrome-devtools, playwright-mcp, gh-cli, github-issues, web-design-reviewer
- **Deploy mirror**: 11 instructions (excludes source-only thread-auto-context), 5 tools

Documentation updated:
- AGENTS.md (source + deploy) — 3-directory awareness, 5-quick-reference tables with dir annotations, Task Skills with Location column, Self-Improvement section mentions all 3 dirs
- SKILL-INDEX.md (source + deploy) — restructured with 3 separate tables (Skills 26, Instructions 12, Tools 5), updated deploy mirror section, maintenance commands per directory
- bootstrap.sh — 16 path updates to FILES array + instructions/ and tools/ .gitignore
- Cross-references: update-skills/SKILL.md (4 paths), audit-skills/SKILL.md (count cmd, deploy cp paths)
- tests/test-self-improving.sh — TEST 3 counts all 3 dirs, TEST 4 allows instructions+tools in deploy check, TEST 5 checks all 3 dirs for drift, TEST 6 checks frontmatter in all 3 dirs, AGENTS.md diff tolerates source-only diffs
- ARCHITECTURE.md — directory map, skill categories, deploy section, data flow mermaid
- CONVENTIONS.md — file organization, deploy exclusion rules
- USAGE.md — decision tree mermaid, directory structure, Quick Reference, Add New Skill guide
- README.md — badge, intro, What Gets Bootstrapped, Task Skills tables, architecture mermaid + table
- deploy/.agents/skills/learnings.md — mentions 3-directory structure

**Verification**: 25/25 tests pass

## 2026-07-04 — Removed source-only, added vision-bridge (df3f493)

### Source-only removal

Previously, two skills were "source-only" (not deployed): `create-readme` (`.agents/skills/`) and `thread-auto-context` (`.agents/instructions/`). Both are now deployed to all target projects.

- **Deployed**: create-readme → `deploy/.agents/skills/create-readme/SKILL.md`, thread-auto-context → `deploy/.agents/instructions/thread-auto-context/SKILL.md`
- **All 43 items now deploy**. Removed the concept of "source-only" from the entire system.

### Documentation changes for source-only removal

- AGENTS.md — removed `(source-only)` from create-readme row; added thread-auto-context to deploy instructions table
- SKILL-INDEX.md — removed `(source-only)` from create-readme row; bumped instructions count 11→12; removed "Skills excluded from deploy" line
- README.md — `(11 deployed + 1 source-only)` → `(12 deployed)`; added `thread-auto-context` to listed instructions
- USAGE.md — `(41 after source-only exclusion)` → `(43 items total)`; removed `(source-only)` from directory tree
- ARCHITECTURE.md — removed `(source-only)` annotations; updated deploy counts: 26 skills + 12 instructions
- CONVENTIONS.md — removed entire "Deploy Exclusion Rules" section
- audit-skills (source + deploy) — `Every non-source-only skill` → `Every skill`
- test-self-improving.sh — TEST 4 now expects files PRESENT (not absent); TEST 5 no longer tolerates source-only diffs

### Vision Bridge — blind model → vision model handoff

Created `vision-bridge` instruction skill. Blind models (DeepSeek, local LLMs) that say "Can't view screenshots" now emit a structured vision request template instead of guessing or silently failing.

- **Auto-detection triggers**: model says "Can't view screenshots" (P0), `view_image` fails (P0), user says "look at this screenshot" (P1), screenshots from playwright-mcp/chrome-devtools (P2), web-design-reviewer invoked (P2)
- **Workflow**: detect trigger → emit structured template with image path, questions, context → STOP and wait → user switches to GPT-4o/Claude → pastes → vision model describes → switches back → pastes → blind model continues
- **Integration**: playwright-mcp screenshots, chrome-devtools screenshots, web-design-reviewer Steps 2 + 4, `view_image` failures
- **HARD RULES**: Never guess image contents, never silently skip visual steps, always fill specific questions, always include absolute path

### Registration

- AGENTS.md — always-loaded instructions table + task skills table
- SKILL-INDEX.md — invocable task skills table, total count: 43 → 44
- deploy/ — full mirror sync
- **Verification**: 25/25 tests pass, 44 skills detected, 0 source-only, 0 drifted files
