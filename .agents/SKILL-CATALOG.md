# Skill Catalog — Quick Reference

> Load this file on a need-to-know basis when you need to find a specific skill or command.
> Do NOT preemptively load — use lazy loading based on actual need.

## ⚡ Always Loaded (`.agents/skills/`)

| Skill | Why |
|-------|-----|
| `generic-conventions` | Fallback — docs sync, comments, DRY, security, error handling, git. Applies to EVERYTHING. |

## 🔧 Framework Skills — `.agents/skills/` (triggered by file extension)

| Skill | Use when editing |
|-------|-----------------|
| `nextjs-conventions` | `**/*.{tsx,ts,jsx,js,css}` in a Next.js project |
| `python-conventions` | `**/*.py` |
| `go-conventions` | `**/*.go` |
| `rust-conventions` | `**/*.rs` |

## 🧩 Domain Skills — `.agents/skills/` (triggered by file path or task type)

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

## 💡 Instructions — `.agents/instructions/` (session init, task execution, diagnosis)

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
| `onboard-existing-repo` | 🔴 **Existing repo → skill system** — parallel subagents explore, map findings, apply deploy payload |
| `vision-bridge` | 🔴 **Blind model → vision model** — auto-detects "Can't view screenshots" and routes images to google/gemma-4-12b-qat |

## 🔧 Tools — `.agents/tools/` (browser automation, GitHub operations, UI review)

| Skill | Use when |
|-------|---------|
| `chrome-devtools` | Browser screenshots, performance, network |
| `playwright-mcp` | Browser automation via Playwright |
| `gh-cli` | GitHub CLI — PRs, issues, releases, search |
| `github-issues` | Creating/updating GitHub issues |
| `web-design-reviewer` | UI/UX inspection, responsive/accessibility |

## 📋 Task Skills (invoke via `/command`)

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
| `/onboard-existing-repo` | Onboard an existing repo to the skill system — parallel subagents explore, map to catalog, apply deploy | `.agents/instructions/` |
| `/vision-bridge` | 🔴 Blind model needs vision — routes screenshots to google/gemma-4-12b-qat | `.agents/instructions/` |
