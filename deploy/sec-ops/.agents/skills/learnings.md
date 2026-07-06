## 2026-07-04 — Thread bootstrap + OpenCode doc compliance

- **Thread bootstrap** — Updated `.vscode/mcp.json` `THREAD_DEFAULT_SESSION` from `"default"` to `"gh-llm-bootstrap"`. Created root `opencode.json` with `mcp.thread` entry. Verified server reachable.
- **OpenCode compliance** — Refactored `AGENTS.md` to follow OpenCode docs recommendation ([rules → Manual Instructions in AGENTS.md](https://opencode.ai/docs/rules/#manual-instructions-in-agentsmd)):
  - Moved detailed skill catalog to `.agents/SKILL-CATALOG.md`
  - AGENTS.md is now concise with core protocol + lazy-load `@` references
  - Mirror updated in `deploy/`
- **Token regeneration** — Old pre-generated `THREAD_API_TOKEN` was invalidated by a Thread server restart (changed `THREAD_AUTH_SECRET_KEY`). Generated a fresh no-expiry API token from within the container via `create_token('admin', expiry_seconds=0)`. Updated in both `.vscode/mcp.json` and `opencode.json`.

## 2026-07-04 — Full documentation audit after skills/ merge

- **Before**: `b0c9318` (snapshot before fixes)
- **After**: `bfee2c9`
- **Fixed**: 16 discrepancies found and fixed
  - **SKILL-INDEX.md**: All 20+ stale `.agents/instructions/` and `.agents/tools/` paths updated to `.agents/skills/`. Removed separate instructions/tools sections. Updated total count and table structure.
  - **README.md**: Badge count 43→45. Removed all references to `.agents/instructions/` and `.agents/tools/` directories. Merged task/tool skill tables into single list. Updated mermaid diagram labels.
  - **AGENTS.md**: Removed `.agents/instructions/` and `.agents/tools/` references from common foundation, session checklist, skill system instructions, and directory tree. Updated to reflect single `.agents/skills/` structure.
  - **USAGE.md**: Updated decision tree locations, directory tree, task/tool creation guides, and count references. Removed instructions/tools path distinctions.
  - **opencode.json**: Updated `instructions` glob from `[".agents/instructions/*/SKILL.md", ".agents/tools/*/SKILL.md"]` to `[".agents/skills/*/SKILL.md"]`.
  - **Deploy mirror**: All deploy files synced to match source changes.
- **All source/docs in sync**: 46 skills, frontmatter valid, hooks valid JSON, deploy mirrors match.

## 2026-07-04 — Create ingenium agent pipeline (build + explore + scout)

- **Commit**: `6daca03`
- **Added**:
  - `.opencode/agents/ingenium-build.md` — Primary agent replaces broken `agent.build` in `opencode.json`. Has `permission.task` to delegate to both subagents. Moved to markdown so all agents are in `.opencode/agents/`.
  - `.opencode/agents/ingenium-explore.md` — Read-only subagent for fast codebase searches (grep, glob, find). No edit/write. Delegated by `ingenium-build` via Task tool or invoked via `@ingenium-explore`.
  - `.opencode/agents/ingenium-scout.md` — Thread/RAG subagent with `thread_*` MCP tool permissions. Reads past context, saves decisions, searches via Thread API. Invoked via `@ingenium-scout`.
- **Removed**: `agent.build` block from `opencode.json` (both source and deploy)
- **Updated**: `AGENTS.md` and `deploy/AGENTS.md` — added Custom Agents table documenting all 6 custom agents
- **Pipeline**: `ingenium-build` (primary) → delegates to `ingenium-explore` (code search) and `ingenium-scout` (Thread RAG). Users can also `@`-mention subagents directly.

## 2026-07-04 — Reduce startup instructions + global LM Studio provider

- **Before**: `7cd4429`
- **After**: `771bec7`

## 2026-07-04 — Agent pipeline overhaul: planner + orchestrator + model assignment

- **Before**: `23293cb`
- **After**: `c7aebc4`
- **Added**:
  - `ingenium-scrum.md` — Primary, V4 Pro, read-only. Scrum master that plans sprints and populates kaban board.
  - `ingenium-orchestrator.md` — Primary, V4 Flash (paid), full R/W. Executor that launches all subagents.
- **Renamed**:
  - `code-reviewer.md` → `ingenium-review.md` (Zen Flash, edit: allow, +useful-tests skill)
  - `docs-writer.md` → `ingenium-docs.md` (Zen Flash, +update-skills +update-skill-index)
- **Deleted**: `ingenium-build.md`
- **Updated**: `ingenium-explore.md` (+model V4 Flash +reasoningEffort max)
- **Updated**: `ingenium-scout.md` (+model qwopus)
- **Created**: `docs/agents.md` — full agent architecture doc with table, workflow diagram, compute split
- **Updated**: `AGENTS.md` — new 7-agent custom agents table
- **Deleted**: `ingenium-explore-zen.md` — subagent removed, folded into `ingenium-explore`
- **Deploy mirror**: All files synced
- **Compute split**: V4 Pro (planner) | V4 Flash API (orchestrator, explore) | Zen Flash free (review, docs) | qwopus (scout)
- **Changed**: `opencode.json` `instructions` — reduced from `.agents/skills/*/SKILL.md` (all 46 skills) to 3 core skills only: `generic-conventions`, `repo-context`, `model-profiles`. All other skills available on-demand via `skill` tool.
- **Added**: Global provider config at `~/.config/opencode/opencode.jsonc` — LM Studio with base URL `http://192.168.0.13:1234/v1` and 7 models.
- **Bridged killed**: Old Thread bridge process (Jun 30) with stale token killed. OpenCode restart needed for MCP tools to reconnect with new token.

## 2026-07-04 — Agent usage docs + Thread session summary saved

- **After**: `a4e9eb4`
- Updated `docs/agents.md` with "How to Use the Pipeline" section covering Tab switching, auto-delegation, and @-mention usage
- Saved comprehensive session summary to Thread entry #24 (tags: summary, session, agents, config, mcp)
- Synced deploy/ mirror

## 2026-07-04 — AGENTS.md rewrite, security-auditor upgrade, stale path audit

- **Before**: `503c06e` (snapshot before fixes)
- **After**: `15d4541`
- **Fixed**: 14 discrepancies found and fixed
  - **AGENTS.md**: Rewritten with agent pipeline table, testing commands, source-repo identity. All stale `.agents/instructions/` and `.agents/tools/` references removed.
  - **security-auditor agent**: Upgraded from 2 skills to 9 (added code-review-checklist, gitignore, shell-scripts, api-design, containers, kubernetes, gh-cli). Added commit-history leak scanning behavior (git log -p -S for secrets, gh api for GitHub secret scanning, auto-creates GitHub issues for confirmed leaks).
  - **opencode.json**: Redacted hardcoded THREAD_API_TOKEN → placeholder. Fixed instructions glob to 3 core skills. Removed stale agent.build block. Fixed env → environment key.
  - **SKILL-CATALOG.md**: Merged stale Instructions/Tools sections into single `.agents/skills/` table. Removed all .agents/instructions/ and .agents/tools/ path references.
  - **bootstrap.sh**: Fixed 12 stale paths from .agents/instructions/ and .agents/tools/ to .agents/skills/. Removed stale .gitignore entries for non-existent directories.
  - **hook-bootstrap.sh**: Added missing `set -e` (was set -uo pipefail).
  - **docs/ARCHITECTURE.md**: Updated directory map, skill counts, removed instructions/tools sections. Updated mermaid diagram.
  - **tests/test-self-improving.sh**: Removed INSTRUCTIONS_DIR and TOOLS_DIR references. Updated frontmatter, deploy separation, and drift tests for single-skills-dir structure.
  - **.gitignore**: Expanded from 2 patterns to 12 with secrets patterns (*.pem, *.key, .env*), dependency dirs (node_modules/, __pycache__/), OS files.
  - **onboard-existing-repo/SKILL.md**: Replaced hardcoded /home/brajam paths with generic references.
  - **deploy/**: USAGE.md added (was missing — broke bootstrap.sh). hook-bootstrap.sh deployed. All mirrors synced with zero drift. Tests pass: 17/17.

## 2026-07-05 — Learning system overhaul: embed as 🔴 HARD RULE, expand scope, add hook enforcement

- **Commit**: `75ba68b`
- **Before**: (this is the snapshot after earlier bugfixes — first entry to use the new template format)
- **Category**: config | skill | agent | hook
- **Changes**: 5 systemic fixes to make the learning system enforceable by agents:
   1. **generic-conventions/SKILL.md** — Added new 🔴 HARD RULE "Learnings Must Be Logged After EVERY Change" with comprehensive trigger table (10 categories: skill, agent, hook, plugin, deploy, config, migration, architecture, bug, pattern). Mandates workflow: commit → capture hash → append entry → sync deploy.
   2. **ingenium-orchestrator.md** — Added `learnings.md` row to the documentation trigger table, making it a required spawn-@ingenium-docs action.
   3. **ingenium-docs.md** — Added `learnings.md` row to the trigger table, so docs agent knows it must write learnings entries.
   4. **update-skills/SKILL.md** — Expanded learnings template from 4 fields to 6 fields (Commit, Before, Category, Changes, Why). Added Signal 5 — Unlogged Changes detection. Added grep filtering examples.
   5. **`.agents/hooks/post-tool-use.json`** — Added learnings reminder every 5 tool calls. Changed from silent counter to proactive checkpoint prompt.
- **Why**: Audit revealed no agent references learnings.md — zero matches in agent files. The only logging path was via /update-skills Step 5 which was never triggered. Scope was too narrow (only skill add/remove). No enforcement mechanism existed.

## 2026-07-05 — Orchestrator pipeline adherence: always-visible delegation primer + anti-pattern enforcement

- **Commit**: `2138b85`
- **Category**: agent | config
- **Changes**: 3 structural fixes to prevent orchestrator from ignoring delegation rules:
   1. **Created `.agents/skills/orchestrator-primer/SKILL.md`** — 12-line always-visible delegation directive. Added to `opencode.json` `instructions` array (first position) so it's injected into EVERY system prompt, not just read once at session start. The primer is short enough to stay in context always.
   2. **Restructured `ingenium-orchestrator.md`** — moved 🔴 delegation rule from line 42 to absolute top (line 40). Added ⚡ PRE-ACTION GATE that forces the agent to check "should I delegate?" before EVERY tool use. Added 🔴 Anti-Patterns table with 7 common violation patterns (grep directly, write directly, read directly, speed excuse, size excuse, etc.). Narrowed bash exception to ONLY: git add/commit/push/rev-parse and test verification. Added 🔴 Periodic Self-Audit every 5 tool calls.
   3. **All 3 deploy targets synced** — primer + orchestrator + opencode.json updated for software-dev, dev-ops, sec-ops.
- **Why**: Analysis showed 3 systemic failures: (a) agent instructions read once at session start, forgotten after 10+ turns, (b) bash exception loophole let the agent rationalize any work as "just a command", (c) no reinforcement mechanism existed. Putting the primer in `opencode.json` instructions ensures the delegation rule is visible on EVERY turn, not just session start.

## 2026-07-05 — Code writing delegated to @ingenium-software-engineer, QA reserved for review+testing

- **Commit**: `e85c2ae`
- **Category**: agent | config
- **Changes**: 
   1. **ingenium-software-engineer.md** — Upgraded from read-only (`edit: deny, write: deny`) to full implementation agent (`edit: allow, write: allow`). Removed "Do NOT edit files — provide recommendations only" constraint. Updated description to "Principal-level software engineering implementation." Added write-appropriate skills (typescript-standalone, python-conventions, go-conventions, rust-conventions, nextjs-conventions, git-workflows, mermaid). Added delegation capability for `@ingenium-scout` and `@ingenium-explore` for research needs. Added implementation process (plan → implement → self-verify → return). Clarified: writes production code, tests go to QA.
   2. **orchestrator-primer/SKILL.md** — Changed code writing row from `@ingenium-qa` → `@ingenium-software-engineer`. Added explicit QA row for review + testing.
   3. **ingenium-orchestrator.md** — Updated delegation table: added "Write code, implement features" → `@ingenium-software-engineer`. Changed anti-patterns (write/edit tool) from QA → software-engineer. Changed forbidden bash patterns (sed/awk/cp/mv) from QA → software-engineer. QA keeps: code review, test authoring.
   4. **All deploy targets synced** — software-dev, dev-ops, sec-ops.
- **Why**: User explicitly directed that orchestrator should never write code directly — all code writing goes to @ingenium-software-engineer. The previous permission model prevented this (software-engineer was read-only, code writing was incorrectly routed to QA).

## 2026-07-05 — docs-stale-content-fixes

- **Commit**: `pending`
- **Category**: docs | config | architecture
- **Changes**: Applied 12 targeted fixes to `docs/ARCHITECTURE.md` (7 items) and `docs/CONVENTIONS.md` (5 items):
   1. Skill count 46→47, added `orchestrator-primer/` to directory tree
   2. Added `.opencode/agents/` role-nested sub-structure (primary/, execution/, research/, security/)
   3. Updated deploy section to 3 domain variants (software-dev, dev-ops, sec-ops)
   4. Updated agent pipeline paragraph with role-nested directories and orchestrator delegation rules
   5. Changed hooks frequency from every 10→5 calls with delegation pattern reminders
   6. Broadened learnings.md description to cover all change categories
   7. Added Orchestration Rules section to CONVENTIONS.md
   8. Updated agent file naming convention from `{name}.agent.md` to `ingenium-{role}.md`
   9. Removed obsolete `.agents/instructions/` and `.agents/tools/` references
   10. Broadened learnings entry trigger to include agents, hooks, plugins, deploy, config, architecture, bugs, patterns
   11. Updated deploy description with 3 domain variants
- **Synced**: All 3 deploy targets (software-dev, dev-ops, sec-ops); created new `deploy/software-dev/docs/CONVENTIONS.md`

## 2026-07-05 — Documentation audit: 15 staleness fixes, write-docs expansion, Signal 6 added

- **Commit**: `b253ed0`
- **Category**: docs | skill | config
- **Changes**: 
   1. **docs/ARCHITECTURE.md** — 7 fixes: skill count 46→47, added orchestrator-primer to tree, agent subdirectories (primary/execution/research/security), agent pipeline mentions delegation+software-engineer write perms, hooks every 5 calls with delegation checks, deploy section shows 3 domain variants, learnings.md description broadened to 10 categories
   2. **docs/CONVENTIONS.md** — 5 fixes: agent naming `ingenium-{role}.md` with role-nested dirs, removed stale .agents/instructions/ refs, deploy description to 3 variants, learnings trigger broadened, added Orchestration Rules section
   3. **docs/TECH-STACK.md** — 3 additions: Agent Pipeline Models table (8 agents w/ model+perms), Key Integrations table (Thread MCP, LM Studio, OpenCode Zen, DeepSeek API), Deploy Variants table (3 targets with skill counts)
   4. **write-docs/SKILL.md** — Expanded trigger table from 6 rows to 11 rows covering agents, hooks, plugins, config, deploy, permissions/delegation, learnings scope
   5. **update-skills/SKILL.md** — Added Signal 6 (Documentation Drift) with 9 detection conditions, automated detection commands, and fix workflow
   6. **All deploy targets synced** — software-dev/docs/ (4 files), dev-ops docs+skills, sec-ops docs+skills
- **Why**: Audit revealed the detection pipeline only looked at skills, not agents/hooks/plugins/config/docs. write-docs trigger table was too narrow to catch agent/config/plugin changes. No mechanism existed to detect stale documentation.

## 2026-07-05 — Plan persistence system + scout web search

- **Commit**: `bfb2bd0`
- **Category**: agent | config | docs
- **Changes**:
   1. **New agent**: `ingenium-plan-file` — single-purpose subagent restricted to `plan.md` only. Permissions: read/write/edit only. No task/bash/skill/grep/websearch. Three operations: save, update, delete.
   2. **Planner updated**: Added `ingenium-plan-file` to task perms. Added Plan Style Guide section (TL;DR, Orchestrator Instructions table, Detailed Change Specs, Relevant Files, Verification, Decisions). Added step 0 (resume check for plan.md). Step 5 now persists plan to plan.md before handoff.
   3. **Orchestrator updated**: Plan Detection now checks plan.md at project root. Process step 1 loads plan.md. Added step 7 (clear plan after completion). Self-audit checks for plan.md tracking.
   4. **Scout updated**: Added web search instructions to description, process step 3, during-work entries, and new Web Search Usage section. Permissions (websearch/webfetch) already existed.
   5. **docs/agents.md**: Updated for 9 agents (2 primary + 7 subagents). Added plan-file to agent table, planner/orchestrator profiles, subagent invocation table, compute split.
   6. **All 4 files synced** to 6 destinations: 3 deploy variants + 3 local mirrors.
- **Before**: `b253ed0`
- **Why**: Plans were lost on session close with no persistence. Thread MCP would create hard dependency. File-based plan.md with single-purpose subagent is zero-dependency. Scout had websearch permissions but never used them — needed instructions.

## 2026-07-05 — Test responsibility flip: SE writes tests, QA reviews only

- **Commit**: `c2799f9`
- **Category**: agent | config | docs
- **Changes**:
   1. **ingenium-software-engineer**: "Write production code, not tests" → "Write production code AND tests. QA provides review only." Step 2 now includes test plan guidance.
   2. **ingenium-qa**: Removed all test authoring references. Description: "Code review and quality assurance. Verifies tests written by @ingenium-software-engineer." Section 2 renamed from "Test Authoring" to "Test Verification". Added "No test authoring" to What You Don't Do.
   3. **docs/agents.md**: SE + QA profiles updated — SE now shows "Write tests alongside production code", QA shows "Test verification". Stale references fixed in agent table and invocation table.
   4. **Synced** to 6 destinations + deploy variant docs.
- **Why**: Subagents can't spawn subagents efficiently. QA doesn't write tests in practice. SE already has useful-tests skill loaded and self-verifies — natural for it to own both code and tests.
- **Before**: `bfb2bd0`

## 2026-07-05 — thread-auto-context mandatory export workflow

- **Commit**: `6c13ef0` (after)
- **Category**: skill
- **Changes**: Updated `.agents/skills/thread-auto-context/SKILL.md` with 3 changes:
  - Changed "At Session End" to "At Session End — MANDATORY EXPORT" with 5-step mandatory workflow (save summary, decisions, git state, output copyable import prompt, check for prior exports)
  - Added "Session ending soon?" tip in During the Session — MANDATORY CHECKLIST
  - Added cross-reference from "/export" section to the new mandatory export section
- **Why**: Ensure agents always export full session context (summary, decisions, git state) with copyable import prompts at session end

## 2026-07-05 — Mandatory session-end export in thread-auto-context

- **Commit**: `efa1bff`
- **Category**: skill | config
- **Changes**:
   1. **At Session End** → **MANDATORY EXPORT**: Now requires full 5-step export (session summary, decisions, git state, copyable import prompt, prior-export check). Previously was a single optional summary entry.
   2. **MANDATORY CHECKLIST**: Added "Session ending soon?" cross-reference pointing to the export workflow.
   3. **/export section**: Added cross-reference to session-end export — both workflows produce the same output format.
   4. **Synced** to 3 deploy destinations.
- **Before**: `6c13ef0`
- **Why**: Users need a way to carry context across OpenCode sessions. The export workflow now always runs at session end and outputs a copyable prompt that can be used to import context in the next chat.

## 2026-07-05 — SE tool preference: write/edit over bash for file ops

- **Commit**: `0f89840`
- **Category**: agent | config
- **Changes**:
   1. **Added 🔴 HARD RULE — Use Write/Edit Tools, Never Bash For Files** with tool-usage mapping table (write for create, edit for modify, bash for verification only)
   2. **Process step 3**: Updated to explicitly reference `write` and `edit` tools, bans bash for file creation/editing
   3. **Process step 4**: Updated to restrict bash to verification only, directs fixes via write/edit
   4. **Synced** to 6 destinations (all copies show 3 matches for "NEVER use bash")
- **Before**: `efa1bff`
- **Why**: Models default to bash (`echo >`, `cat >`, `sed`) for file operations even though write/edit tools are available. This causes escaping issues and is error-prone. The write/edit tools are purpose-built for code authoring.

## 2026-07-05 — wsl-cleanup: safe WSL2 Ubuntu cleanup utility script

- **Commit**: `54ebf1a`
- **Category**: skill
- **Changes**:
   1. Created `.agents/skills/wsl-cleanup/scripts/wsl-cleanup.sh` — 1125-line production-grade cleanup script
   2. 13 operations: Docker prune (3 types), apt clean + autoremove, pip/npm/yarn cache, journal vacuum, temp files, trash, snap revisions, AI model caches
   3. Every destructive step requires `[y/N]` confirmation
   4. HARD RULE: never touches `$HOME/repos` via `check_repos_exclusion()` guard
   5. Root blocked by default (`--allow-root` override)
   6. Dry-run mode (`--dry-run`) previews without execution
   7. `--force` flags never used without explicit user consent
   8. Input sanitization (`sanitize_digits`) prevents multi-line injection from `|| echo` in `$()` with `pipefail`
   9. Box-drawing summary table using `printf` (not `tr` which breaks multi-byte UTF-8)
   10. `|| true` pattern (not `|| echo` inside `$()`) to avoid doubled output with `set -o pipefail`
- **Before**: (new file)
-  **Why**: Needed a safe, interactive cleanup utility for WSL2 Ubuntu that provides guardrails against accidental deletion while still being useful for reclaiming disk space. Common bash pitfalls (pipefail + || echo doubling, du exit codes, multi-byte tr) were discovered and fixed during implementation.

## 2026-07-05 — wsl-cleanup: skill definition, registration, deploy sync, docs

- **Commit**: `e9997a9`
- **Category**: skill | config | docs
- **Changes**:
   1. Created `.agents/skills/wsl-cleanup/SKILL.md` — 383-line skill definition with 10 sections covering pre-flight assessment, Docker cleanup, package manager caches, journal vacuum, temp files, snap, model caches, comprehensive workflow, disk reference, and cross-references
   2. Added 5 🔴 HARD RULEs: no `$HOME/repos` touch, assess-before-acting, confirm-before-destruction, shell safety patterns, no `--force` without confirmation
   3. Registered in `.agents/SKILL-CATALOG.md` (domain skills table)
   4. Registered in `.agents/scripts/bootstrap.sh` (always for SKILL.md, optional for script)
   5. Synced to all 3 deploy variants: software-dev, dev-ops, sec-ops
   6. Regenerated SKILL-INDEX.md (count 46→48, fixed stale entries)
   7. Updated docs/ counts across AGENTS.md, USAGE.md, README.md, ARCHITECTURE.md, TECH-STACK.md in source and deploy variants
   8. All deploy variants updated: software-dev (48), dev-ops (47 = 43 universal + 4 cluster), sec-ops (53 = 44 universal + 10 pentest + 1 primer)
- **Before**: (new skill directory + metadata)
- **Why**: New WSL2 domain skill needed full registration in the skill system catalog, bootstrap.sh for deployment, and cross-variant deploy sync with accurate count documentation.

## 2026-07-05 — wsl-cleanup: add /mnt exclusion

- **Commit**: `45bfbf4`
- **Category**: skill
- **Changes**:
   1. Added /mnt (WSL Windows drive mounts) to the exclusion list alongside $HOME/repos
   2. Updated SKILL.md: description, HARD RULE heading, and exclusion body text
   3. Updated script: header comment, usage text, MNT_DIR constant, check_exclusions() function (renamed from check_repos_exclusion), error messages, and pre-flight summary
   4. Synced to all 3 deploy variants
- **Before**: `9e63885`
- **Why**: /mnt/c, /mnt/d etc. are Windows drive mounts — cleanup should never operate on them.

## 2026-07-05 — thread-auto-context: full transcript export HARD RULE

- **Commit**: `4964b68` (after)
- **Category**: skill
- **Changes**:
   1. Added 🔴 HARD RULE to "At Session End — MANDATORY EXPORT" requiring full conversation transcript to be written to `/tmp/opencode/` and uploaded to Thread via `thread_upload_file`
   2. This is step 0 — must run before the summary/decisions/git-state steps
   3. Added `transcript` and `full-session` tags to the Tag Convention section
   4. Updated the copyable import prompt to include the transcript entry
   5. Synced to all 3 deploy variants
- **Why**: User asked us to export and upload the full chat transcript; this should happen automatically every session, not just when manually requested.

## 2026-07-05 — docs update for thread-auto-context transcript export

- **Commit**: `114075f` (after)
- **Category**: docs
- **Changes**:
   1. Added "Thread / Export Conventions" section to `docs/CONVENTIONS.md` covering the 🔴 HARD RULE, export order, tag conventions, dedup rules, and OpenCode detection
   2. Added "Thread Persistent Memory" section to `docs/ARCHITECTURE.md` describing the 4-step export pipeline (transcript → summary → decisions → git state)
   3. Synced to all 3 deploy variants
- **Before**: `4964b68`
- **Why**: The thread-auto-context skill's new export HARD RULE needed documentation in both conventions and architecture docs to be discoverable.

## 2026-07-05 — thread-auto-context: site-agnostic doc website ingestion

- **Commit**: `aa6db52` (after)
- **Category**: skill
- **Changes**:
   1. Added "Uploading Documentation Websites to Thread" section to thread-auto-context SKILL.md — a site-agnostic workflow for discovering, fetching, chunking, and uploading docs from any documentation website
   2. 5 discovery methods in priority order: `/llms.txt` → XML sitemaps → markdown sitemaps → API endpoints → recursive nav crawl
   3. 5 content fetch strategies per page: API markdown endpoint → `.md` suffix → `Accept: text/markdown` → webfetch markdown → HTML extraction fallback
   4. 3 upload options: Combined markdown file (50+ pages, chunks by `##`), bulk entries (<50 pages), per-page entries (<20 pages)
   5. 🔴 HARD RULEs: no auth-gated content, respect robots.txt, rate-limit aggressively, no site-specific code, prefer native markdown
   6. Added `docs-import` tag to Tag Convention section
   7. Synced to all 3 deploy variants
- **Before**: `4964b68`
- **Why**: User wanted the ability to point the skill at any documentation website (not site-specific logic) and have it crawl/ingest all pages into Thread for reference. Test sites: docs.github.com, nextjs.org/docs.

## 2026-07-05 — doc-import-workflow-test-nextjs

- **Commit**: `1b14e1a` (after)
- **Before**: `1b14e1a` (no code changes, this is a test run)
- **Category**: pattern
- **Changes**: Tested the new "Uploading Documentation Websites to Thread" workflow from thread-auto-context/SKILL.md against https://nextjs.org/docs
- **Findings**:
  - Discovery: `/docs/llms.txt` found 260 doc URLs (Method A preferred). `/docs/sitemap.md` found 418 URLs (Method C). Sitemap.xml had 469 doc URLs (Method B, more granular)
  - Best fetch strategy: `Accept: text/markdown` header returns clean LLM-optimized markdown for every page. `.md` suffix works identically. Both produce ~22KB per average page with full frontmatter (version, lastUpdated, docs_index)
  - `thread_upload_file` with `##` heading-split correctly chunked the 5-page (2287-line) combined file into 59 entries
  - All 4 fetch strategies work for Next.js docs: HTML alternate link, .md suffix, Accept header, webfetch markdown
  - Rate limiting: 1-2s jitter was sufficient, no 429s encountered
- **Files**: `/tmp/opencode/nextjs-doc-urls.txt`, `/tmp/opencode/site-docs-nextjs.md`
- **thread_search bug**: FTS5 `AND` operator and negation `-` queries return HTTP 500. Workaround: use quoted space-separated terms instead. Filed as `jtmb/thread#1`.

## 2026-07-05 — gh-cli: best-practices issue reporting template + jtmb/thread#1

- **Commit**: `0d2d05d` (after)
- **Before**: `aa6db52`
- **Category**: skill
- **Changes**:
   1. Created `.agents/skills/gh-cli/templates/issue-report.md` — 10-section template (Summary, Type checkboxes, Environment table, Steps, Expected vs Actual, Debugging Data table, Impact, Workaround, Context)
   2. Updated `.agents/skills/gh-cli/SKILL.md` Issues section: 🔴 HARD RULE requiring template for all issues, filing sections for bug/feature using `gh api` (supports `type` param), quick commands for trivial items, cross-reference to `github-issues` skill
   3. Registered template in `.agents/scripts/bootstrap.sh` as `optional` deploy
   4. Synced template + SKILL.md to all 3 deploy variants
   5. Filed `https://github.com/jtmb/thread/issues/1` with full reproduction data using the new template (3 failing query variants with request IDs, 2 working variants, environment, impact analysis, workaround)
- **Skill audit**: `gh-cli` stays independent. Covers 5 domains beyond issues (PRs, releases, gists, search, raw API). `alwaysApply: true` foundation. `github-issues` adds deep issue management when triggered. Cross-reference added from `gh-cli` → `github-issues`.

## 2026-07-05 — kaban-board: terminal Kanban board skill + README upload to Thread

- **Commit**: `13a3021` (after)
- **Category**: skill
- **Changes**:
   1. Created `.agents/skills/kaban-board/SKILL.md` — 340 lines, 7 sections: When to Use, 3 🔴 HARD RULEs, Installation (npx/npm/brew), MCP Server Setup for OpenCode (opencode.json config), CLI Quick Reference (15 commands), 20 MCP Tools Reference, TUI Keyboard Shortcuts, 4 Workflows (Setup, Task Lifecycle, Agent Coordination, TodoWrite Hook), Data Model
   2. Registered in `.agents/SKILL-CATALOG.md` (domain skills table)
   3. Registered in `.agents/scripts/bootstrap.sh` as `optional`
   4. Regenerated `SKILL-INDEX.md` (48→49) with kaban-board at #21
   5. Updated all docs counts: AGENTS.md, README.md, USAGE.md, ARCHITECTURE.md (+ deploy mirrors)
   6. Synced skill + docs to all 3 deploy variants
   7. Uploaded Kaban README from GitHub to Thread (entries 181-192, 12 chunks, tags: docs-import, kaban-board, readme)
- **Skill count**: Source: 49, software-dev: 49, dev-ops: 49, sec-ops: 54

## 2026-07-05 — removed 4 redundant skills (audit cleanup)

- **Commit**: `8e0334c` (after)
- **Category**: skill
- **Changes**: Removed 4 redundant skills and cleaned up all references:
   1. `git-workflows` — redundant with `gh-cli` (which covers all GitHub/Git operations)
   2. `github-actions-efficiency` — too narrow (CI cost optimization only), removed with 4 reference files
   3. `github-actions-hardening` — too narrow (CI security only), removed with 5 reference files
   4. `github-issues` — redundant with `gh-cli` (issue creation via template + gh api), removed with 7 reference files
   5. Cleaned up: bootstrap.sh (4 entries), SKILL-CATALOG.md (4 entries), SKILL-INDEX.md (renumbered 49→45), AGENTS.md, README.md, USAGE.md, docs/ARCHITECTURE.md, gh-cli cross-reference
   6. Removed from all 3 deploy variants (12 skill dirs + 16 reference files + 16 docs copies)
   7. Deploy SKILL-INDEX.md, CATALOG, and variant AGENTS/USAGE/ARCHITECTURE synced
- **Skill count**: Source: 45, software-dev: 45, dev-ops: 44, sec-ops: 50

## 2026-07-05 — kaban board setup + SKILL.md CLI fix

- **Commit**: `b7bc703` (after)
- **Category**: skill | config
- **Changes**:
   1. Installed kaban from source (npm published v0.3.4/broken — `AuditService` missing from `@kaban-board/core` dist/, built from GitHub with `bun`)
   2. Initialized `.kaban/` board with 6 tasks: fix test failures, report npm bug, register MCP, update help SKILL.md, fix kaban SKILL.md flags, add FTS5 workaround
   3. Registered kaban MCP server in `opencode.json` (uses global `kaban` binary, not `npx` — avoids broken npm package)
   4. Fixed CLI reference tables in kaban-board/SKILL.md: removed non-existent `-p/--priority`, added 9 missing CLI commands (next, schema, audit, stats, edit, export, import, sync, hook), 11 missing MCP tools (assign_task, get_next_task, get_task_history, add/remove/get links, export/import markdown, get_audit_history, score_tasks, wins)
   5. Added `.kaban/` to `.gitignore` (local state, not for version control)
   6. Synced updated SKILL.md to all 3 deploy variants

## 2026-07-05 — kaban post-install verification suite

- **Commit**: `4a4f916` (after)
- **Category**: skill
- **Changes**:
   1. Added 🔴 HARD RULE #4: npm v0.3.4 `AuditService` bug documented
   2. Added source-build installation method (default/recommended) with `bun install && bun run build && npm link` workflow, including TUI binary compilation + PATH setup
   3. Demoted npx/npm methods to second-tier with broken-note caveat
   4. Added full **§2 Post-Installation Verification** section with 10-test smoke suite covering: init, add (flags: -c, -a, -D), list (--column filter, --json), move+assign, done+status, archive+search, empty column edge case, re-init idempotency, TUI launch
   5. Switched MCP config from `["npx", "-y", ...]` to `["kaban", "mcp"]` with caveat note
   6. Synced to all 3 deploy variants

## 2026-07-06 — kaban-integrated agent pipeline

- **Commit**: (will be added after commit)
- **Category**: agent | skill | architecture
- **Changes**:
   1. Renamed `ingenium-planner` → `ingenium-scrum` — scrum master agent with kaban board population
   2. Added kaban-board skill and 5 MCP tools to scrum agent (add_task, add_task_checked, add_dependency, status, init)
   3. Added 🔴 HARD RULE to scrum: plan tasks go on kaban board with subagent assignments
   4. Added FEATURE REQUEST → KABAN TASK FLOW section to scrum agent
   5. Added kaban-board skill to orchestrator, added 10-step kaban workflow section
   6. Deprecated todowrite as primary work tracker — kaban is authoritative
   7. Added kaban tracking column to orchestrator-primer delegation table + HARD RULE #4
   8. Added kaban-board cross-reference to agent-pipelines SKILL.md (pipeline → column mapping)
   9. Updated docs/agents.md and docs/ARCHITECTURE.md with kaban flow
   10. Synced all changes to deploy variants (software-dev, dev-ops, sec-ops)
- **Files changed**: 28+ files across source and deploy variants
- **Skill count**: Unchanged (45 source, 45/44/50 deploy)

## 2026-07-06 — todowrite mirror alongside kaban board workflow

- **Commit**: `867c7bd` (after)
- **Category**: agent | config
- **Changes**: Updated `ingenium-orchestrator.md` with todowrite mirror integration:
   1. **Permission block**: Added `todo: allow` to YAML frontmatter (line 8) so the tool is permitted for use.
   2. **Kaban Workflow steps updated** (4 steps modified):
      - Step 1: Added "call todowrite to add it as in_progress" after kaban_get_next_task
      - Step 3: Added "Update todowrite to mark in_progress" after kaban_move_task
      - Step 6: Added "Mark the task as pending (for QA review) in todowrite" after kaban_move_task review
      - Step 7: Added "Mark completed in todowrite" after kaban_complete_task
   3. **Anti-Patterns table**: Added "I forgot to update todowrite" row — wrong behavior: only updating kaban, not todowrite. Correct: update BOTH at each transition.
   4. **Deploy sync**: Copied to all 3 deploy variants (software-dev, dev-ops, sec-ops).
- **Why**: The orchestrator was only updating kaban but never touching todowrite, making work invisible in OpenCode's native todo UI. Adding todowrite calls as mirrors at each transition point ensures dual-visibility without adding steps.

## 2026-07-06 — agent pipeline improvements: probing, todowrite, multi-model

- **Commit**: (to be added after commit — docs update for Phases 0-2)
- **Category**: agent | skill | architecture
- **Changes**:
  1. Added §1.5 "Probe" step to scrum agent (9 required questions, validation checks, question tool)
  2. Added 🔴 HARD RULE "Ask Before You Plan" to scrum agent
  3. Added "Risks" as required plan section with template (likelihood/impact/mitigation)
  4. Added `todo: allow` permission to orchestrator + todowrite mirror in all 4 workflow transitions
  5. Added anti-patterns row: "forgot to update todowrite"
  6. Created `.opencode/agents/execution/ingenium-software-engineer-fast.md` (deepseek-v4-flash, medium)
  7. Created `.opencode/agents/execution/ingenium-software-engineer-premium.md` (deepseek-v4-pro, xhigh)
  8. Updated orchestrator delegation table with model tier guidance
  9. Created `.agents/models.yaml` centralized model config convention
  10. Fixed 4 QA bugs: in_progress column name across 3 files, orphaned numbering, mcp permissions, self-contradiction
- **Skill count**: Unchanged (45 source, 45/44/50 deploy)
