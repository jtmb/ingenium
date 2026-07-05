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
- **All source/docs in sync**: 45 skills, frontmatter valid, hooks valid JSON, deploy mirrors match.

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
- **Changed**: `opencode.json` `instructions` — reduced from `.agents/skills/*/SKILL.md` (all 45 skills) to 3 core skills only: `generic-conventions`, `repo-context`, `model-profiles`. All other skills available on-demand via `skill` tool.
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
