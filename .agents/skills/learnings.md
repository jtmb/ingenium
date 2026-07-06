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
  - `ingenium-planner.md` — Primary, V4 Pro, read-only. Mastermind that plans and delegates research.
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
