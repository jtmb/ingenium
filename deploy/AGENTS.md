# AGENTS.md — Skill System Protocol

## 🔴 MANDATORY — Load Skills Before Acting

**Before writing code, running a command, or responding to any request, you MUST check which skills apply.** This is not optional. Skills contain 🔴 HARD RULEs that override everything else. Ignoring them produces broken code, hung terminals, and security issues.

## 🔴 Session Startup Checklist

Before responding to the user's first request, complete these 4 steps:

1. **Match skills to request** — Read the quick-reference table below. For each skill, check the "Use when" column against the user's request and the files you might edit.
2. **Load every matching skill** — Read the full SKILL.md (`.agents/skills/<name>/SKILL.md`) of every skill that applies.
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

## Skill Quick-Reference

### ⚡ Always Loaded
| Skill | Why |
|-------|-----|
| `generic-conventions` | Fallback — docs sync, comments, DRY, security, error handling, git. Applies to EVERYTHING. |

### 🔧 Framework Skills (triggered by file extension)

| Skill | Use when editing |
|-------|-----------------|
| `nextjs-conventions` | `**/*.{tsx,ts,jsx,js,css}` in a Next.js project |
| `python-conventions` | `**/*.py` |
| `go-conventions` | `**/*.go` |
| `rust-conventions` | `**/*.rs` |

### 🧩 Domain Skills (triggered by file path or task type)

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
| `debugging-patterns` | Diagnosing bugs, bisection |
| `code-review-checklist` | PR review, code quality audit |
| `refactoring-recipes` | Improving code structure |
| `self-correction-patterns` | Recovering from AI mistakes |
| `skill` | 🔴 **Session init** — `/skill` injects bootstrap payload |
| `cli-toolkit` | jq, curl, sed, awk, find, xargs, grep |
| `regex-reference` | Writing or reviewing regular expressions |
| `git-workflows` | Rebase, bisect, reflog, conventional commits |
| `error-interpretation` | Understanding compiler/runtime errors |
| `model-profiles` | Adapting prompts for Qwen/Gemma/DeepSeek |
| `local-model-commands` | **ALL terminal commands** — no `&`, no infinite-wait |
| `web-design-reviewer` | UI/UX inspection, responsive/accessibility |
| `chrome-devtools` | Browser screenshots, performance, network |
| `github-issues` | Creating/updating GitHub issues |
| `playwright-mcp` | Browser automation via Playwright |

### 📋 Task Skills (invoke via `/command`)

| Command | Use when |
|---------|---------|
| `/skill` | 🔴 **FIRST MESSAGE in every session** — injects the skill-system bootstrap payload |
| `/help` | Need a skill overview |
| `/repo-context` | Starting a new session |
| `/update-skills` | New patterns, deps, or codebase growth — creates/retires skills |
| `/audit-skills` | After any skill change — cross-references all docs |
| `/update-skill-index` | After adding/removing skills |
| `/generate-docs` | Docs are stale or templates are empty |
| `/write-docs` | Need README, API docs, or ADRs |
| `/create-readme` | Need a README.md for the project |

---

## Self-Improvement — Grow the System

This skill system evolves. **You are responsible for growing it.**

- **New patterns?** → `/update-skills` detects gaps and creates skills
- **Changed skills?** → `/audit-skills` keeps docs consistent
- **Added/removed skills?** → `/update-skill-index` regenerates the index
- **All changes** → Log to `.agents/skills/learnings.md` with before/after commit hashes

If you don't invoke these, nothing improves. **Check `.agents/skills/` after every session. Look for ways to improve skills.**


