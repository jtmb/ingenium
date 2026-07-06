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
| `postgresql-optimization` | PostgreSQL-specific features, JSONB, arrays |
| `code-review-checklist` | PR review, code quality audit |
| `refactoring-recipes` | Improving code structure |
| `cli-toolkit` | jq, curl, sed, awk, find, xargs, grep |
| `regex-reference` | Writing or reviewing regular expressions |
| `error-interpretation` | Understanding compiler/runtime errors |
| `local-models` | Model profiles, terminal safety, LM Studio API, and cross-model strategy guide |
| `debugging-patterns` | Systematic debugging — bisection, log-driven, isolation |
| `self-correction-patterns` | Recovering from AI mistakes |
| `skill-load` | 🔴 **Session init** — `/skill-load` injects bootstrap payload |
| `help` | Need a skill overview |
| `repo-context` | Starting a new session |
| `update-skills` | New patterns, deps, or codebase growth — creates/retires skills |
| `audit-skills` | After any skill change — cross-references all docs |
| `update-skill-index` | After adding/removing skills |
| `generate-docs` | Docs are stale or templates are empty |
| `mermaid` | Mermaid diagrams — mandatory visuals in ALL documentation (architecture, data-flow, lifecycle, process) |
| `write-docs` | Need README, API docs, or ADRs |
| `thread-auto-context` | Persistent memory via Thread MCP |
| `onboard-existing-repo` | 🔴 **Existing repo → skill system** — parallel subagents explore, map findings, apply all skills and config |
| `chrome-devtools` | Browser screenshots, performance, network |
| `playwright-mcp` | Browser automation via Playwright |
| `gh-cli` | GitHub CLI — PRs, issues, releases, search |
| `web-design-reviewer` | UI/UX inspection, responsive/accessibility |
| `wsl-cleanup` | WSL2 disk cleanup — Docker prune, apt/pip/npm caches, journal vacuum, temp/tmp, snap revisions, model caches. 🔴 Excludes $HOME/repos |
| `kaban-board` | Terminal Kanban board for AI agents — install, MCP server setup, CLI tasks, TUI navigation |
| `create-readme` | Need a README.md for the project |

## 📋 Task Skills (invoke via `/command`)

| Command | Use when |
|---------|---------|
| `/skill-load` | 🔴 **FIRST MESSAGE in every session** — injects the skill-system bootstrap payload |
| `/help` | Need a skill overview |
| `/repo-context` | Starting a new session |
| `/update-skills` | New patterns, deps, or codebase growth — creates/retires skills |
| `/audit-skills` | After any skill change — cross-references all docs |
| `/update-skill-index` | After adding/removing skills |
| `/generate-docs` | Docs are stale or templates are empty |
| `/write-docs` | Need README, API docs, or ADRs |
| `/create-readme` | Need a README.md for the project |
| `/onboard-existing-repo` | Onboard an existing repo to the skill system — parallel subagents explore, map to catalog, apply all skills and config |
| `/local-models` | 🔴 Local LLM management — model profiles, terminal safety, LM Studio API, vision bridge |
