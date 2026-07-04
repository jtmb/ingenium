# Skill Index — Complete Reference

This file is the **canonical index** of all skills in this project. It is automatically maintained by the `update-skill-index` skill. Every skill, instruction, and tool in `.agents/skills/`, `.agents/instructions/`, and `.agents/tools/` is listed here with its description, function, commands, and a link to its full documentation.

**Total: 44 items** (26 skills + 13 instructions + 5 tools)

---

## Invocable Task Skills (via `/` command)

| Command | Skill | Description | Location |
|---------|-------|-------------|----------|
| `/skill-load` | [skill-load](.agents/instructions/skill-load/SKILL.md) | 🔴 Mandatory first command — inject skill-system bootstrap payload, force AGENTS.md + skill loading | `.agents/instructions/` |
| `/audit-skills` | [audit-skills](.agents/instructions/audit-skills/SKILL.md) | Audit skill→docs consistency, auto-fix discrepancies | `.agents/instructions/` |
| `/create-readme` | [create-readme](.agents/skills/create-readme/SKILL.md) | Generate a README.md for the project | `.agents/skills/` |
| `/generate-docs` | [generate-docs](.agents/instructions/generate-docs/SKILL.md) | Scan codebase, populate `docs/` templates | `.agents/instructions/` |
| `/help` | [help](.agents/instructions/help/SKILL.md) | Display all skills, commands, and invocation patterns | `.agents/instructions/` |
| `/repo-context` | [repo-context](.agents/instructions/repo-context/SKILL.md) | Load project identity, tech stack, conventions | `.agents/instructions/` |
| `/update-skill-index` | [update-skill-index](.agents/instructions/update-skill-index/SKILL.md) | Regenerate SKILL-INDEX.md from all skill files | `.agents/instructions/` |
| `/update-skills` | [update-skills](.agents/instructions/update-skills/SKILL.md) | Detect new patterns, create/retire skills | `.agents/instructions/` |
| `/write-docs` | [write-docs](.agents/instructions/write-docs/SKILL.md) | Write READMEs, API docs, ADRs | `.agents/instructions/` |
| `/vision-bridge` | [vision-bridge](.agents/instructions/vision-bridge/SKILL.md) | 🔴 Blind model → vision model bridge — auto-detects "Can't view screenshots" and routes images to google/gemma-4-12b-qat | `.agents/instructions/` |

---

## Framework Conventions — `.agents/skills/` (loaded when editing matching files)

| Skill | Triggers on | Key Commands |
|-------|-------------|--------------|
| [go-conventions](.agents/skills/go-conventions/SKILL.md) | `**/*.go` | `go build ./...`, `go test ./...`, `golangci-lint run`, `go vet ./...`, `gofmt -w .`, `govulncheck ./...` |
| [nextjs-conventions](.agents/skills/nextjs-conventions/SKILL.md) | `**/*.{tsx,ts,jsx,js,css}` in Next.js | `next dev`, `next build`, `next lint`, `tsc --noEmit`, `npm test` |
| [python-conventions](.agents/skills/python-conventions/SKILL.md) | `**/*.py` | `ruff check .`, `ruff format .`, `mypy src/`, `pytest`, `source .venv/bin/activate` |
| [rust-conventions](.agents/skills/rust-conventions/SKILL.md) | `**/*.rs` | `cargo build`, `cargo test`, `cargo clippy -- -D warnings`, `cargo fmt`, `cargo check`, `cargo audit` |

---

## Domain Skills — `.agents/skills/` (cross-cutting, copied to all projects)

| Skill | Triggers on | Description |
|-------|-------------|-------------|
| [agent-pipelines](.agents/skills/agent-pipelines/SKILL.md) | Building AI agent services | Autonomous AI agent pipeline patterns — orchestration, turn-based coordination, state checkpoints, crash recovery, multi-phase build pipelines, containerized agents |
| [api-design](.agents/skills/api-design/SKILL.md) | `**/{routes,handlers,api,controllers,endpoints}/**/*` | REST/HTTP API design conventions — status codes, error shapes, versioning, auth, pagination, rate limiting, idempotency |
| [cli-toolkit](.agents/skills/cli-toolkit/SKILL.md) | Shell pipelines, text processing | Concise reference for common CLI tools — jq, curl, sed, awk, find, xargs, grep |
| [code-review-checklist](.agents/skills/code-review-checklist/SKILL.md) | PR reviews, code audits | Structured code review checklist — security, correctness, performance, readability, testing |
| [containers](.agents/skills/containers/SKILL.md) | `**/{Dockerfile,Containerfile,docker-compose*,.dockerignore}` | Container conventions — multi-stage builds, non-root users, layer caching, secrets hygiene, HEALTHCHECK, signal handling, docker-compose patterns |
| [error-interpretation](.agents/skills/error-interpretation/SKILL.md) | Build/runtime/CI failures | Map common error signatures to their actual root causes — null reference, type mismatch, import failure, permission denied, network timeout |
| [generic-conventions](.agents/skills/generic-conventions/SKILL.md) | No framework-specific skill applies | Fallback coding conventions — definitive core rules (comments, docs, DRY, security, observability, error handling, configuration) |
| [git-workflows](.agents/skills/git-workflows/SKILL.md) | Git history management | Git workflow patterns beyond the basics — rebase vs merge, bisect, reflog recovery, conventional commits, clean history |
| [github-actions-efficiency](.agents/skills/github-actions-efficiency/SKILL.md) | CI workflow review | Audit GitHub Actions workflow efficiency and recommend fixes to reduce CI minutes and costs |
| [github-actions-hardening](.agents/skills/github-actions-hardening/SKILL.md) | CI security review | Security hardening reviewer for GitHub Actions workflow files — script injection, privilege escalation, SHA-pinning, least-privilege permissions |
| [gitignore](.agents/skills/gitignore/SKILL.md) | `.gitignore` files | Git ignore file conventions — patterns, structure, and rules for .gitignore files |
| [kubernetes](.agents/skills/kubernetes/SKILL.md) | `**/{k8s,kubernetes,helm,charts,templates}/**/*.{yaml,yml}` | Kubernetes conventions — security contexts, resource limits, probes, network policies, deployment strategies |
| [model-profiles](.agents/skills/model-profiles/SKILL.md) | Prompt adaptation, model selection | Model-aware instruction tuning for local LLMs — Qwen, Gemma, and DeepSeek families across 2B–1.6T parameter ranges |
| [postgresql-optimization](.agents/skills/postgresql-optimization/SKILL.md) | PostgreSQL development | PostgreSQL-specific development — JSONB, array types, custom types, full-text search, window functions, extensions |
| [project-structure](.agents/skills/project-structure/SKILL.md) | Creating projects, reorganizing code | Monorepo microservices project structure — service layering (pages, features, domain, infrastructure), naming, boundaries |
| [refactoring-recipes](.agents/skills/refactoring-recipes/SKILL.md) | Code improvement | Catalog of refactoring patterns with explicit before/after examples — extract method, invert conditional, replace magic number |
| [regex-reference](.agents/skills/regex-reference/SKILL.md) | Regex writing, review | Regex pattern reference — common patterns, language-specific escaping, catastrophic backtracking prevention |
| [shell-scripts](.agents/skills/shell-scripts/SKILL.md) | `**/*.{sh,bash}` | Shell script conventions — safety flags, quoting, error handling, temporary files, portability |
| [sql-database](.agents/skills/sql-database/SKILL.md) | `**/*.sql`, migrations | SQL & database conventions — parameterized queries, migration safety, indexing, connection pooling |
| [typescript-standalone](.agents/skills/typescript-standalone/SKILL.md) | `**/*.{ts,tsx}` outside Next.js | Standalone TypeScript conventions — strict mode, type safety, error handling, async patterns, Node.js conventions |
| [useful-tests](.agents/skills/useful-tests/SKILL.md) | `*.test.*`, `*_test.*`, `*.spec.*` | Write tests that catch real bugs — unit, integration, E2E with Playwright, app lifecycle, CI readiness |

---

## Instructions — `.agents/instructions/` (session init, task execution, diagnosis)

| Skill | Triggers on | Description |
|-------|-------------|-------------|
| [debugging-patterns](.agents/instructions/debugging-patterns/SKILL.md) | Bug diagnosis | Systematic debugging methodology — isolation, bisection, log-driven, and stack-trace analysis |
| [help](.agents/instructions/help/SKILL.md) | `/help` or "help" query | Display quick-reference of all skills, commands, and invocation patterns |
| [local-model-commands](.agents/instructions/local-model-commands/SKILL.md) | Terminal commands with local LLMs | Terminal command safety for local LLMs — never background with `&`, never run infinite-wait commands, use timeout wrappers |
| [repo-context](.agents/instructions/repo-context/SKILL.md) | Session start | Load project identity, tech stack, conventions |
| [self-correction-patterns](.agents/instructions/self-correction-patterns/SKILL.md) | AI mistake recovery | Patterns for recognizing and recovering from AI mistakes — backtracking triggers, verification loops, assumption checking |
| [skill-load](.agents/instructions/skill-load/SKILL.md) | `/skill-load` first message | 🔴 Mandatory first command — inject skill-system bootstrap payload into prompt, forcing AGENTS.md read and skill matching |
| [thread-auto-context](.agents/instructions/thread-auto-context/SKILL.md) | Always-applied, session start/end | Automatic persistent memory via Thread MCP — search context at session start, save decisions/preferences/constraints |
| [update-skills](.agents/instructions/update-skills/SKILL.md) | New patterns, deps, codebase growth | Detect new patterns, create/retire skills — four detection signals (dependency gaps, repeated conventions, missing coverage, stale content) |
| [update-skill-index](.agents/instructions/update-skill-index/SKILL.md) | After skill changes | Regenerate SKILL-INDEX.md from all skill files |
| [audit-skills](.agents/instructions/audit-skills/SKILL.md) | After skill changes | Audit skill→docs consistency, auto-fix discrepancies |
| [generate-docs](.agents/instructions/generate-docs/SKILL.md) | Stale docs | Scan codebase, populate `docs/` templates |
| [write-docs](.agents/instructions/write-docs/SKILL.md) | Need documentation | Write READMEs, API docs, ADRs |

---

## Tools — `.agents/tools/` (browser automation, GitHub operations, UI review)

| Skill | Triggers on | Description |
|-------|-------------|-------------|
| [chrome-devtools](.agents/tools/chrome-devtools/SKILL.md) | Browser debugging | Expert-level browser automation, debugging, and performance analysis using Chrome DevTools MCP |
| [playwright-mcp](.agents/tools/playwright-mcp/SKILL.md) | Browser automation | Browser automation via Playwright MCP — navigate, click, type, snapshot pages |
| [gh-cli](.agents/tools/gh-cli/SKILL.md) | GitHub operations | GitHub CLI (`gh`) integration — update repo metadata, manage PRs/issues/releases, create gists, search code, query the API |
| [github-issues](.agents/tools/github-issues/SKILL.md) | Issue management | Create, update, and manage GitHub issues using MCP tools — labels, assignees, milestones, dependencies |
| [web-design-reviewer](.agents/tools/web-design-reviewer/SKILL.md) | UI/UX review | Visual inspection of websites to identify and fix design issues — responsive design, accessibility, layout breakage |

---

## Core Skill

| Skill | Description |
|-------|-------------|
| [generic-conventions](.agents/skills/generic-conventions/SKILL.md) | Mandatory core rules: comments, docs sync, DRY, security, error handling, git, naming, config, testing checklist |

---

## Quick Command Reference

### Per-Language Build/Test/Lint

| Language | Build | Test | Lint | Format | Type Check | Full Check |
|----------|-------|------|------|--------|------------|------------|
| **Go** | `go build ./...` | `go test ./...` | `golangci-lint run` | `gofmt -w .` | `go vet ./...` | `gofmt -w . && go vet ./... && golangci-lint run && go test ./...` |
| **Python** | — | `pytest` | `ruff check .` | `ruff format .` | `mypy src/` | `ruff check . && ruff format --check . && mypy src/ && pytest` |
| **Rust** | `cargo build` | `cargo test` | `cargo clippy -- -D warnings` | `cargo fmt` | `cargo check` | `cargo fmt -- --check && cargo clippy -- -D warnings && cargo test && cargo audit` |
| **TypeScript** | `tsc --noEmit` | `npm test` | `eslint .` | `prettier --check .` | `tsc --noEmit` | `tsc --noEmit && eslint . && prettier --check . && npm test` |
| **Next.js** | `next build` | `npm test` | `next lint` | — | `tsc --noEmit` | `next lint && tsc --noEmit && npm test && next build` |

### Infrastructure

| Domain | Key Commands |
|--------|-------------|
| **Docker** | `docker build --no-cache .`, `docker scan`, `docker run --rm --user nobody <image>`, `docker compose -f docker-compose.test.yml up --build --detach` |
| **E2E Tests** | `scripts/run-e2e.sh` (start→poll health→Playwright→teardown), `npx playwright test`, `npx playwright install chrome` |
| **GitHub CLI** | `gh pr list`, `gh pr create`, `gh issue create`, `gh release create`, `gh api`, `gh gist create`, `gh search repos` |
| **Shell Scripts** | `#!/usr/bin/env bash` + `set -euo pipefail`, `trap cleanup EXIT`, `mktemp` |

### Skill System Maintenance

| Task | Command |
|------|---------|
| **Audit consistency** | `/audit-skills` |
| **Create/update skill** | `/update-skills` |
| **Regenerate skill index** | `/update-skill-index` |
| **View changelog** | `cat .agents/skills/learnings.md` |
| **List all skills** | `ls -d .agents/skills/*/ .agents/instructions/*/ .agents/tools/*/ \| sed 's\|.*/\|\|;s\|/\|\|' \| sort` |
| **Check frontmatter** | `head -5 .agents/skills/{name}/SKILL.md` |
| **Check instruction frontmatter** | `head -5 .agents/instructions/{name}/SKILL.md` |
| **Check tool frontmatter** | `head -5 .agents/tools/{name}/SKILL.md` |
| **Regenerate docs** | `/generate-docs` |
| **Write new docs** | `/write-docs` |

---

## Skills — `.agents/skills/` (26)

| # | Directory | File |
|---|-----------|------|
| 1 | `agent-pipelines` | [`.agents/skills/agent-pipelines/SKILL.md`](.agents/skills/agent-pipelines/SKILL.md) |
| 2 | `api-design` | [`.agents/skills/api-design/SKILL.md`](.agents/skills/api-design/SKILL.md) |
| 3 | `cli-toolkit` | [`.agents/skills/cli-toolkit/SKILL.md`](.agents/skills/cli-toolkit/SKILL.md) |
| 4 | `code-review-checklist` | [`.agents/skills/code-review-checklist/SKILL.md`](.agents/skills/code-review-checklist/SKILL.md) |
| 5 | `containers` | [`.agents/skills/containers/SKILL.md`](.agents/skills/containers/SKILL.md) |
| 6 | `create-readme` | [`.agents/skills/create-readme/SKILL.md`](.agents/skills/create-readme/SKILL.md) |
| 7 | `error-interpretation` | [`.agents/skills/error-interpretation/SKILL.md`](.agents/skills/error-interpretation/SKILL.md) |
| 8 | `generic-conventions` | [`.agents/skills/generic-conventions/SKILL.md`](.agents/skills/generic-conventions/SKILL.md) |
| 9 | `git-workflows` | [`.agents/skills/git-workflows/SKILL.md`](.agents/skills/git-workflows/SKILL.md) |
| 10 | `github-actions-efficiency` | [`.agents/skills/github-actions-efficiency/SKILL.md`](.agents/skills/github-actions-efficiency/SKILL.md) |
| 11 | `github-actions-hardening` | [`.agents/skills/github-actions-hardening/SKILL.md`](.agents/skills/github-actions-hardening/SKILL.md) |
| 12 | `gitignore` | [`.agents/skills/gitignore/SKILL.md`](.agents/skills/gitignore/SKILL.md) |
| 13 | `go-conventions` | [`.agents/skills/go-conventions/SKILL.md`](.agents/skills/go-conventions/SKILL.md) |
| 14 | `kubernetes` | [`.agents/skills/kubernetes/SKILL.md`](.agents/skills/kubernetes/SKILL.md) |
| 15 | `model-profiles` | [`.agents/skills/model-profiles/SKILL.md`](.agents/skills/model-profiles/SKILL.md) |
| 16 | `nextjs-conventions` | [`.agents/skills/nextjs-conventions/SKILL.md`](.agents/skills/nextjs-conventions/SKILL.md) |
| 17 | `postgresql-optimization` | [`.agents/skills/postgresql-optimization/SKILL.md`](.agents/skills/postgresql-optimization/SKILL.md) |
| 18 | `project-structure` | [`.agents/skills/project-structure/SKILL.md`](.agents/skills/project-structure/SKILL.md) |
| 19 | `python-conventions` | [`.agents/skills/python-conventions/SKILL.md`](.agents/skills/python-conventions/SKILL.md) |
| 20 | `refactoring-recipes` | [`.agents/skills/refactoring-recipes/SKILL.md`](.agents/skills/refactoring-recipes/SKILL.md) |
| 21 | `regex-reference` | [`.agents/skills/regex-reference/SKILL.md`](.agents/skills/regex-reference/SKILL.md) |
| 22 | `rust-conventions` | [`.agents/skills/rust-conventions/SKILL.md`](.agents/skills/rust-conventions/SKILL.md) |
| 23 | `shell-scripts` | [`.agents/skills/shell-scripts/SKILL.md`](.agents/skills/shell-scripts/SKILL.md) |
| 24 | `sql-database` | [`.agents/skills/sql-database/SKILL.md`](.agents/skills/sql-database/SKILL.md) |
| 25 | `typescript-standalone` | [`.agents/skills/typescript-standalone/SKILL.md`](.agents/skills/typescript-standalone/SKILL.md) |
| 26 | `useful-tests` | [`.agents/skills/useful-tests/SKILL.md`](.agents/skills/useful-tests/SKILL.md) |

## Instructions — `.agents/instructions/` (12)

| # | Directory | File |
|---|-----------|------|
| 1 | `audit-skills` | [`.agents/instructions/audit-skills/SKILL.md`](.agents/instructions/audit-skills/SKILL.md) |
| 2 | `debugging-patterns` | [`.agents/instructions/debugging-patterns/SKILL.md`](.agents/instructions/debugging-patterns/SKILL.md) |
| 3 | `generate-docs` | [`.agents/instructions/generate-docs/SKILL.md`](.agents/instructions/generate-docs/SKILL.md) |
| 4 | `help` | [`.agents/instructions/help/SKILL.md`](.agents/instructions/help/SKILL.md) |
| 5 | `local-model-commands` | [`.agents/instructions/local-model-commands/SKILL.md`](.agents/instructions/local-model-commands/SKILL.md) |
| 6 | `repo-context` | [`.agents/instructions/repo-context/SKILL.md`](.agents/instructions/repo-context/SKILL.md) |
| 7 | `self-correction-patterns` | [`.agents/instructions/self-correction-patterns/SKILL.md`](.agents/instructions/self-correction-patterns/SKILL.md) |
| 8 | `skill-load` | [`.agents/instructions/skill-load/SKILL.md`](.agents/instructions/skill-load/SKILL.md) |
| 9 | `thread-auto-context` | [`.agents/instructions/thread-auto-context/SKILL.md`](.agents/instructions/thread-auto-context/SKILL.md) |
| 10 | `update-skill-index` | [`.agents/instructions/update-skill-index/SKILL.md`](.agents/instructions/update-skill-index/SKILL.md) |
| 11 | `update-skills` | [`.agents/instructions/update-skills/SKILL.md`](.agents/instructions/update-skills/SKILL.md) |
| 12 | `write-docs` | [`.agents/instructions/write-docs/SKILL.md`](.agents/instructions/write-docs/SKILL.md) |

## Tools — `.agents/tools/` (5)

| # | Directory | File |
|---|-----------|------|
| 1 | `chrome-devtools` | [`.agents/tools/chrome-devtools/SKILL.md`](.agents/tools/chrome-devtools/SKILL.md) |
| 2 | `gh-cli` | [`.agents/tools/gh-cli/SKILL.md`](.agents/tools/gh-cli/SKILL.md) |
| 3 | `github-issues` | [`.agents/tools/github-issues/SKILL.md`](.agents/tools/github-issues/SKILL.md) |
| 4 | `playwright-mcp` | [`.agents/tools/playwright-mcp/SKILL.md`](.agents/tools/playwright-mcp/SKILL.md) |
| 5 | `web-design-reviewer` | [`.agents/tools/web-design-reviewer/SKILL.md`](.agents/tools/web-design-reviewer/SKILL.md) |

---

## Deploy Mirror

The `deploy/` directory mirrors the bootstrap repo for distribution. It contains:
- `deploy/.agents/skills/` — all deployable skill files (25)
- `deploy/.agents/instructions/` — deployable instruction files (12)
- `deploy/.agents/tools/` — all deployable tool files (5)
- `deploy/.agents/hooks/` — 3 lifecycle hooks
- `deploy/AGENTS.md` — skill system overview
- `deploy/SKILL-INDEX.md` — this index (for target projects)

Learnings included: `deploy/.agents/skills/learnings.md` — fresh template for target project self-improvement logging.
