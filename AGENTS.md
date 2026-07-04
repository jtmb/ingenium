# AGENTS.md — Skill System Protocol

## 🔴 MANDATORY — Load Skills Before Acting

**Before writing code, running a command, or responding to any request, you MUST check which skills apply.** This is not optional. Skills contain 🔴 HARD RULEs that override everything else. Ignoring them produces broken code, hung terminals, and security issues.

## 🔴 Session Startup Checklist

Before responding to the user's first request, complete these 4 steps:

1. **Match skills to request** — Read the quick-reference table below. For each skill, check the "Use when" column against the user's request and the files you might edit.
2. **Load every matching skill** — Read the full SKILL.md from `.agents/skills/<name>/SKILL.md`, `.agents/instructions/<name>/SKILL.md`, or `.agents/tools/<name>/SKILL.md` depending on the category.
3. **Note the 🔴 HARD RULEs** — Skills use 🔴 to mark mandatory rules. These take priority over everything else.
4. **Invoke `/repo-context`** for project identity and `/help` for the full catalog.

## 🔴 Before Every Action — Pre-Flight Check

| You're about to... | Check this skill |
|-------------------|-----------------|
| Edit a source file | Framework skill for that file type (`.py` → `python-conventions`, `.go` → `go-conventions`, `.rs` → `rust-conventions`, `.tsx` → `nextjs-conventions`, `.ts` outside Next → `typescript-standalone`) |
| Run a terminal command | `local-model-commands` — **never use `&`, never infinite-wait** |
| Create a new file/service | `project-structure` — layering, naming, boundaries |
| Write/run tests | `useful-tests` — lifecycle, assertions, CI readiness |
| Edit Docker/K8s | `containers` / `kubernetes` |
| Edit shell scripts | `shell-scripts` — `set -euo pipefail`, quoting |
| Edit SQL/migrations | `sql-database` — parameterized queries, indexing |

## 🔴 Mandatory Skills

**These are NOT suggestions. You MUST load them before ANY action.**

| Skill | Why mandatory |
|-------|--------------|
| `generic-conventions` | Comments, docs sync, DRY, security, error handling, git. Applies to EVERYTHING. |
| `model-profiles` | Know your model's capabilities, context limits, and prompt preferences — adapt accordingly. |
| `local-model-commands` | **ALL terminal commands** — never `&`, never infinite-wait. |
| `debugging-patterns` | Systematic debugging — isolation, bisection, log-driven. Do not guess, methodically isolate. |
| `useful-tests` | Test lifecycle, assertions, CI readiness. Tests must catch real bugs, not pass trivially. |
| `project-structure` | Layering, naming, boundaries. No `utils/` dirs, no flat `src/`. |
| `error-interpretation` | Map error signatures to their root cause. Do not chase the wrong fix. |
| `self-correction-patterns` | Backtracking triggers, verification loops, assumption checking. Do not double down on wrong answers. |
| `skill-load` | **Session init** — `/skill-load` injects the bootstrap payload. First message, every session. |
| `api-design` | REST status codes, error shapes, versioning, auth, pagination, rate limiting, idempotency. |
| `shell-scripts` | `set -euo pipefail`, double-quote all vars, `trap cleanup EXIT`, `mktemp`. |
| `sql-database` | Parameterized queries only, reversible migrations, indexing, connection pooling. |
| `typescript-standalone` | Strict tsconfig, type safety, error handling, async patterns, Node.js conventions. |
| `agent-pipelines` | AI agent orchestration, state checkpoints, crash recovery, multi-phase pipelines. |
| `gitignore` | Ignore file patterns, structure, rules for `.gitignore`. |
| `postgresql-optimization` | JSONB, array types, full-text search, window functions, extensions. |
| `code-review-checklist` | Security, correctness, performance, readability, testing. |
| `refactoring-recipes` | Extract method, invert conditional, replace magic number — before/after patterns. |
| `cli-toolkit` | jq, curl, sed, awk, find, xargs, grep — shell pipeline reference. |
| `regex-reference` | Common patterns, language-specific escaping, catastrophic backtracking prevention. |
| `git-workflows` | Rebase vs merge, bisect, reflog recovery, conventional commits, clean history. |
| `web-design-reviewer` | UI/UX inspection, responsive design, accessibility, layout breakage. |
| `chrome-devtools` | Browser screenshots, performance profiling, network analysis. |
| `github-issues` | Create, update, manage issues — labels, assignees, milestones, dependencies. |
| `playwright-mcp` | Browser automation — navigate, click, type, snapshot pages. |

## Skill Quick-Reference

### ⚡ Always Loaded (`.agents/skills/`)

| Skill | Why |
|-------|-----|
| `generic-conventions` | Fallback — docs sync, comments, DRY, security, error handling, git. Applies to EVERYTHING. |

### 🔧 Framework Skills — `.agents/skills/` (triggered by file extension)

| Skill | Use when editing |
|-------|-----------------|
| `nextjs-conventions` | `**/*.{tsx,ts,jsx,js,css}` in a Next.js project |
| `python-conventions` | `**/*.py` |
| `go-conventions` | `**/*.go` |
| `rust-conventions` | `**/*.rs` |

### 🧩 Domain Skills — `.agents/skills/` (triggered by file path or task type)

| Skill | Use when |
|-------|---------|
| `api-design` | Writing routes, handlers, API controllers |
| `containers` | Dockerfiles, docker-compose, Containerfiles |
| `kubernetes` | K8s manifests, Helm charts, kustomize |
| `shell-scripts` | Writing `.sh` or `.bash` files |
| `sql-database` | SQL queries, migrations, DB code |
| `typescript-standalone` | TypeScript outside Next.js projects |
| `project-structure` | Creating projects, adding services, reorganizing |
| `agent-pipelines` | Building AI agent services, multi-step pipelines |
| `useful-tests` | Any `*.test.*`, `*_test.*`, `*.spec.*` file |
| `gitignore` | Creating or editing `.gitignore` |
| `github-actions-hardening` | Reviewing CI/CD security |
| `github-actions-efficiency` | Auditing CI performance/cost |
| `postgresql-optimization` | PostgreSQL-specific features, JSONB, arrays |
| `code-review-checklist` | PR review, code quality audit |
| `refactoring-recipes` | Improving code structure |
| `cli-toolkit` | jq, curl, sed, awk, find, xargs, grep |
| `regex-reference` | Writing or reviewing regular expressions |
| `git-workflows` | Rebase, bisect, reflog, conventional commits |
| `error-interpretation` | Understanding compiler/runtime errors |
| `model-profiles` | Adapting prompts for Qwen/Gemma/DeepSeek |

### 💡 Instructions — `.agents/instructions/` (session init, task execution, diagnosis)

| Skill | Use when |
|-------|---------|
| `skill-load` | 🔴 **Session init** — `/skill-load` injects bootstrap payload |
| `help` | Need a skill overview |
| `repo-context` | Starting a new session |
| `debugging-patterns` | Diagnosing bugs, bisection |
| `self-correction-patterns` | Recovering from AI mistakes |
| `local-model-commands` | **ALL terminal commands** — no `&`, no infinite-wait |
| `update-skills` | New patterns, deps, or codebase growth — creates/retires skills |
| `audit-skills` | After any skill change — cross-references all docs |
| `update-skill-index` | After adding/removing skills |
| `generate-docs` | Docs are stale or templates are empty |
| `write-docs` | Need README, API docs, or ADRs |
| `thread-auto-context` | Persistent memory via Thread MCP |
| `vision-bridge` | 🔴 **Blind model → vision model** — auto-detects "Can't view screenshots" and routes images to google/gemma-4-12b-qat |

### 🔧 Tools — `.agents/tools/` (browser automation, GitHub operations, UI review)

| Skill | Use when |
|-------|---------|
| `chrome-devtools` | Browser screenshots, performance, network |
| `playwright-mcp` | Browser automation via Playwright |
| `gh-cli` | GitHub CLI — PRs, issues, releases, search |
| `github-issues` | Creating/updating GitHub issues |
| `web-design-reviewer` | UI/UX inspection, responsive/accessibility |

### 📋 Task Skills (invoke via `/command`)

| Command | Use when | Location |
|---------|---------|----------|
| `/skill-load` | 🔴 **FIRST MESSAGE in every session** — injects the skill-system bootstrap payload | `.agents/instructions/` |
| `/help` | Need a skill overview | `.agents/instructions/` |
| `/repo-context` | Starting a new session | `.agents/instructions/` |
| `/update-skills` | New patterns, deps, or codebase growth — creates/retires skills | `.agents/instructions/` |
| `/audit-skills` | After any skill change — cross-references all docs | `.agents/instructions/` |
| `/update-skill-index` | After adding/removing skills | `.agents/instructions/` |
| `/generate-docs` | Docs are stale or templates are empty | `.agents/instructions/` |
| `/write-docs` | Need README, API docs, or ADRs | `.agents/instructions/` |
| `/create-readme` | Need a README.md for the project | `.agents/skills/` |
| `/vision-bridge` | 🔴 Blind model needs vision — routes screenshots to google/gemma-4-12b-qat | `.agents/instructions/` |

---

## Self-Improvement — Grow the System

This skill system evolves. **You are responsible for growing it.** Hooks automatically remind you at session start and periodically during your session.

- **New patterns?** → `/update-skills` detects gaps and creates skills
- **Changed skills?** → `/audit-skills` keeps docs consistent
- **Added/removed skills?** → `/update-skill-index` regenerates the index
- **All changes** → Log to `.agents/skills/learnings.md`

**Hook-driven reminders:**
- **SessionStart**: Loads the abbreviated checklist — match skills, load them, note HARD RULEs
- **PostToolUse**: Every ~10 tool calls, reminds you to log new patterns to learnings.md and run `/update-skills` if you created new conventions

If you don't invoke these, nothing improves. **Check `.agents/skills/`, `.agents/instructions/`, and `.agents/tools/` after every session. Look for ways to improve skills.**


