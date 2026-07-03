# Skill Index — Complete Reference

This file is the **canonical index** of all skills in this project. It is automatically maintained by the `update-skill-index` skill. Every skill in `.agents/skills/` is listed here with its description, function, commands, and a link to its full documentation.

**Total skills: 43**

---

## Invocable Task Skills (via `/` command)

| Command | Skill | Description |
|---------|-------|-------------|
| `/skill-load` | [skill-load](.agents/skills/skill-load/SKILL.md) | 🔴 Mandatory first command — inject skill-system bootstrap payload, force AGENTS.md + skill loading |
| `/audit-skills` | [audit-skills](.agents/skills/audit-skills/SKILL.md) | Audit skill→docs consistency, auto-fix discrepancies |
| `/create-readme` | [create-readme](.agents/skills/create-readme/SKILL.md) | Generate a README.md for the project |
| `/generate-docs` | [generate-docs](.agents/skills/generate-docs/SKILL.md) | Scan codebase, populate `docs/` templates |
| `/help` | [help](.agents/skills/help/SKILL.md) | Display all skills, commands, and invocation patterns |
| `/repo-context` | [repo-context](.agents/skills/repo-context/SKILL.md) | Load project identity, tech stack, conventions |
| `/update-skill-index` | [update-skill-index](.agents/skills/update-skill-index/SKILL.md) | Regenerate SKILL-INDEX.md from all skill files |
| `/update-skills` | [update-skills](.agents/skills/update-skills/SKILL.md) | Detect new patterns, create/retire skills |
| `/write-docs` | [write-docs](.agents/skills/write-docs/SKILL.md) | Write READMEs, API docs, ADRs |

---

## Framework Conventions (loaded when editing matching files)

| Skill | Triggers on | Key Commands |
|-------|-------------|--------------|
| [go-conventions](.agents/skills/go-conventions/SKILL.md) | `**/*.go` | `go build ./...`, `go test ./...`, `golangci-lint run`, `go vet ./...`, `gofmt -w .`, `govulncheck ./...` |
| [nextjs-conventions](.agents/skills/nextjs-conventions/SKILL.md) | `**/*.{tsx,ts,jsx,js,css}` in Next.js | `next dev`, `next build`, `next lint`, `tsc --noEmit`, `npm test` |
| [python-conventions](.agents/skills/python-conventions/SKILL.md) | `**/*.py` | `ruff check .`, `ruff format .`, `mypy src/`, `pytest`, `source .venv/bin/activate` |
| [rust-conventions](.agents/skills/rust-conventions/SKILL.md) | `**/*.rs` | `cargo build`, `cargo test`, `cargo clippy -- -D warnings`, `cargo fmt`, `cargo check`, `cargo audit` |

---

## Always-Included Domain Skills (cross-cutting, copied to all projects)

| Skill | Triggers on | Description |
|-------|-------------|-------------|
| [agent-pipelines](.agents/skills/agent-pipelines/SKILL.md) | Building AI agent services | Autonomous AI agent pipeline patterns — orchestration, turn-based coordination, state checkpoints, crash recovery, multi-phase build pipelines, containerized agents |
| [api-design](.agents/skills/api-design/SKILL.md) | `**/{routes,handlers,api,controllers,endpoints}/**/*` | REST/HTTP API design conventions — status codes, error shapes, versioning, auth, pagination, rate limiting, idempotency |
| [chrome-devtools](.agents/skills/chrome-devtools/SKILL.md) | Browser debugging | Expert-level browser automation, debugging, and performance analysis using Chrome DevTools MCP |
| [cli-toolkit](.agents/skills/cli-toolkit/SKILL.md) | Shell pipelines, text processing | Concise reference for common CLI tools — jq, curl, sed, awk, find, xargs, grep |
| [code-review-checklist](.agents/skills/code-review-checklist/SKILL.md) | PR reviews, code audits | Structured code review checklist — security, correctness, performance, readability, testing |
| [containers](.agents/skills/containers/SKILL.md) | `**/{Dockerfile,Containerfile,docker-compose*,.dockerignore}` | Container conventions — multi-stage builds, non-root users, layer caching, secrets hygiene, HEALTHCHECK, signal handling, docker-compose patterns |
| [debugging-patterns](.agents/skills/debugging-patterns/SKILL.md) | Bug diagnosis | Systematic debugging methodology — isolation, bisection, log-driven, and stack-trace analysis |
| [error-interpretation](.agents/skills/error-interpretation/SKILL.md) | Build/runtime/CI failures | Map common error signatures to their actual root causes — null reference, type mismatch, import failure, permission denied, network timeout |
| [generic-conventions](.agents/skills/generic-conventions/SKILL.md) | No framework-specific skill applies | Fallback coding conventions — definitive core rules (comments, docs, DRY, security, observability, error handling, configuration) |
| [gh-cli](.agents/skills/gh-cli/SKILL.md) | GitHub operations | GitHub CLI (`gh`) integration — update repo metadata, manage PRs/issues/releases, create gists, search code, query the API |
| [git-workflows](.agents/skills/git-workflows/SKILL.md) | Git history management | Git workflow patterns beyond the basics — rebase vs merge, bisect, reflog recovery, conventional commits, clean history |
| [github-actions-efficiency](.agents/skills/github-actions-efficiency/SKILL.md) | CI workflow review | Audit GitHub Actions workflow efficiency and recommend fixes to reduce CI minutes and costs |
| [github-actions-hardening](.agents/skills/github-actions-hardening/SKILL.md) | CI security review | Security hardening reviewer for GitHub Actions workflow files — script injection, privilege escalation, SHA-pinning, least-privilege permissions |
| [github-issues](.agents/skills/github-issues/SKILL.md) | Issue management | Create, update, and manage GitHub issues using MCP tools — labels, assignees, milestones, dependencies |
| [gitignore](.agents/skills/gitignore/SKILL.md) | `.gitignore` files | Git ignore file conventions — patterns, structure, and rules for .gitignore files |
| [help](.agents/skills/help/SKILL.md) | `/help` or "help" query | **This skill.** Display quick-reference of all skills, commands, and invocation patterns |
| [kubernetes](.agents/skills/kubernetes/SKILL.md) | `**/{k8s,kubernetes,helm,charts,templates}/**/*.{yaml,yml}` | Kubernetes conventions — security contexts, resource limits, probes, network policies, deployment strategies |
| [local-model-commands](.agents/skills/local-model-commands/SKILL.md) | Terminal commands with local LLMs | Terminal command safety for local LLMs — never background with `&`, never run infinite-wait commands, use timeout wrappers |
| [model-profiles](.agents/skills/model-profiles/SKILL.md) | Prompt adaptation, model selection | Model-aware instruction tuning for local LLMs — Qwen, Gemma, and DeepSeek families across 2B–1.6T parameter ranges |
| [playwright-mcp](.agents/skills/playwright-mcp/SKILL.md) | Browser automation | Browser automation via Playwright MCP — navigate, click, type, snapshot pages |
| [postgresql-optimization](.agents/skills/postgresql-optimization/SKILL.md) | PostgreSQL development | PostgreSQL-specific development — JSONB, array types, custom types, full-text search, window functions, extensions |
| [project-structure](.agents/skills/project-structure/SKILL.md) | Creating projects, reorganizing code | Monorepo microservices project structure — service layering (pages, features, domain, infrastructure), naming, boundaries |
| [refactoring-recipes](.agents/skills/refactoring-recipes/SKILL.md) | Code improvement | Catalog of refactoring patterns with explicit before/after examples — extract method, invert conditional, replace magic number |
| [regex-reference](.agents/skills/regex-reference/SKILL.md) | Regex writing, review | Regex pattern reference — common patterns, language-specific escaping, catastrophic backtracking prevention |
| [self-correction-patterns](.agents/skills/self-correction-patterns/SKILL.md) | AI mistake recovery | Patterns for recognizing and recovering from AI mistakes — backtracking triggers, verification loops, assumption checking |
| [skill-load](.agents/skills/skill-load/SKILL.md) | `/skill-load` first message | 🔴 Mandatory first command — inject skill-system bootstrap payload into prompt, forcing AGENTS.md read and skill matching |
| [shell-scripts](.agents/skills/shell-scripts/SKILL.md) | `**/*.{sh,bash}` | Shell script conventions — safety flags, quoting, error handling, temporary files, portability |
| [sql-database](.agents/skills/sql-database/SKILL.md) | `**/*.sql`, migrations | SQL & database conventions — parameterized queries, migration safety, indexing, connection pooling |
| [thread-auto-context](.agents/skills/thread-auto-context/SKILL.md) | Always-applied, session start/end | Automatic persistent memory via Thread MCP — search context at session start, save decisions/preferences/constraints |
| [typescript-standalone](.agents/skills/typescript-standalone/SKILL.md) | `**/*.{ts,tsx}` outside Next.js | Standalone TypeScript conventions — strict mode, type safety, error handling, async patterns, Node.js conventions |
| [useful-tests](.agents/skills/useful-tests/SKILL.md) | `*.test.*`, `*_test.*`, `*.spec.*` | Write tests that catch real bugs — unit, integration, E2E with Playwright, app lifecycle, CI readiness |
| [web-design-reviewer](.agents/skills/web-design-reviewer/SKILL.md) | UI/UX review | Visual inspection of websites to identify and fix design issues — responsive design, accessibility, layout breakage |

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
| **List all skills** | `ls -d .agents/skills/*/ \| sed 's\|.*/\|\|;s\|/\|\|' \| sort` |
| **Check frontmatter** | `head -5 .agents/skills/{name}/SKILL.md` |
| **Regenerate docs** | `/generate-docs` |
| **Write new docs** | `/write-docs` |

---

## Skill Links (by directory)

| # | Directory | File |
|---|-----------|------|
| 1 | `agent-pipelines` | [`.agents/skills/agent-pipelines/SKILL.md`](.agents/skills/agent-pipelines/SKILL.md) |
| 2 | `api-design` | [`.agents/skills/api-design/SKILL.md`](.agents/skills/api-design/SKILL.md) |
| 3 | `audit-skills` | [`.agents/skills/audit-skills/SKILL.md`](.agents/skills/audit-skills/SKILL.md) |
| 4 | `chrome-devtools` | [`.agents/skills/chrome-devtools/SKILL.md`](.agents/skills/chrome-devtools/SKILL.md) |
| 5 | `cli-toolkit` | [`.agents/skills/cli-toolkit/SKILL.md`](.agents/skills/cli-toolkit/SKILL.md) |
| 6 | `code-review-checklist` | [`.agents/skills/code-review-checklist/SKILL.md`](.agents/skills/code-review-checklist/SKILL.md) |
| 7 | `containers` | [`.agents/skills/containers/SKILL.md`](.agents/skills/containers/SKILL.md) |
| 8 | `create-readme` | [`.agents/skills/create-readme/SKILL.md`](.agents/skills/create-readme/SKILL.md) |
| 9 | `debugging-patterns` | [`.agents/skills/debugging-patterns/SKILL.md`](.agents/skills/debugging-patterns/SKILL.md) |
| 10 | `error-interpretation` | [`.agents/skills/error-interpretation/SKILL.md`](.agents/skills/error-interpretation/SKILL.md) |
| 11 | `generate-docs` | [`.agents/skills/generate-docs/SKILL.md`](.agents/skills/generate-docs/SKILL.md) |
| 12 | `generic-conventions` | [`.agents/skills/generic-conventions/SKILL.md`](.agents/skills/generic-conventions/SKILL.md) |
| 13 | `gh-cli` | [`.agents/skills/gh-cli/SKILL.md`](.agents/skills/gh-cli/SKILL.md) |
| 14 | `git-workflows` | [`.agents/skills/git-workflows/SKILL.md`](.agents/skills/git-workflows/SKILL.md) |
| 15 | `github-actions-efficiency` | [`.agents/skills/github-actions-efficiency/SKILL.md`](.agents/skills/github-actions-efficiency/SKILL.md) |
| 16 | `github-actions-hardening` | [`.agents/skills/github-actions-hardening/SKILL.md`](.agents/skills/github-actions-hardening/SKILL.md) |
| 17 | `github-issues` | [`.agents/skills/github-issues/SKILL.md`](.agents/skills/github-issues/SKILL.md) |
| 18 | `gitignore` | [`.agents/skills/gitignore/SKILL.md`](.agents/skills/gitignore/SKILL.md) |
| 19 | `go-conventions` | [`.agents/skills/go-conventions/SKILL.md`](.agents/skills/go-conventions/SKILL.md) |
| 20 | `help` | [`.agents/skills/help/SKILL.md`](.agents/skills/help/SKILL.md) |
| 21 | `kubernetes` | [`.agents/skills/kubernetes/SKILL.md`](.agents/skills/kubernetes/SKILL.md) |
| 22 | `local-model-commands` | [`.agents/skills/local-model-commands/SKILL.md`](.agents/skills/local-model-commands/SKILL.md) |
| 23 | `model-profiles` | [`.agents/skills/model-profiles/SKILL.md`](.agents/skills/model-profiles/SKILL.md) |
| 24 | `nextjs-conventions` | [`.agents/skills/nextjs-conventions/SKILL.md`](.agents/skills/nextjs-conventions/SKILL.md) |
| 25 | `playwright-mcp` | [`.agents/skills/playwright-mcp/SKILL.md`](.agents/skills/playwright-mcp/SKILL.md) |
| 26 | `postgresql-optimization` | [`.agents/skills/postgresql-optimization/SKILL.md`](.agents/skills/postgresql-optimization/SKILL.md) |
| 27 | `project-structure` | [`.agents/skills/project-structure/SKILL.md`](.agents/skills/project-structure/SKILL.md) |
| 28 | `python-conventions` | [`.agents/skills/python-conventions/SKILL.md`](.agents/skills/python-conventions/SKILL.md) |
| 29 | `refactoring-recipes` | [`.agents/skills/refactoring-recipes/SKILL.md`](.agents/skills/refactoring-recipes/SKILL.md) |
| 30 | `regex-reference` | [`.agents/skills/regex-reference/SKILL.md`](.agents/skills/regex-reference/SKILL.md) |
| 31 | `repo-context` | [`.agents/skills/repo-context/SKILL.md`](.agents/skills/repo-context/SKILL.md) |
| 32 | `rust-conventions` | [`.agents/skills/rust-conventions/SKILL.md`](.agents/skills/rust-conventions/SKILL.md) |
| 33 | `self-correction-patterns` | [`.agents/skills/self-correction-patterns/SKILL.md`](.agents/skills/self-correction-patterns/SKILL.md) |
| 34 | `skill-load` | [`.agents/skills/skill-load/SKILL.md`](.agents/skills/skill-load/SKILL.md) |
| 35 | `shell-scripts` | [`.agents/skills/shell-scripts/SKILL.md`](.agents/skills/shell-scripts/SKILL.md) |
| 36 | `sql-database` | [`.agents/skills/sql-database/SKILL.md`](.agents/skills/sql-database/SKILL.md) |
| 37 | `thread-auto-context` | [`.agents/skills/thread-auto-context/SKILL.md`](.agents/skills/thread-auto-context/SKILL.md) |
| 38 | `typescript-standalone` | [`.agents/skills/typescript-standalone/SKILL.md`](.agents/skills/typescript-standalone/SKILL.md) |
| 39 | `update-skill-index` | [`.agents/skills/update-skill-index/SKILL.md`](.agents/skills/update-skill-index/SKILL.md) |
| 40 | `update-skills` | [`.agents/skills/update-skills/SKILL.md`](.agents/skills/update-skills/SKILL.md) |
| 41 | `useful-tests` | [`.agents/skills/useful-tests/SKILL.md`](.agents/skills/useful-tests/SKILL.md) |
| 42 | `web-design-reviewer` | [`.agents/skills/web-design-reviewer/SKILL.md`](.agents/skills/web-design-reviewer/SKILL.md) |
| 43 | `write-docs` | [`.agents/skills/write-docs/SKILL.md`](.agents/skills/write-docs/SKILL.md) |

---

## Deploy Mirror

The `deploy/` directory mirrors the bootstrap repo for distribution. It contains:
- `deploy/.agents/skills/` — all deployable skill files
- `deploy/AGENTS.md` — skill system overview
- `deploy/SKILL-INDEX.md` — this index (for target projects)

Skills excluded from deploy: `create-readme`, `gh-cli`, `playwright-mcp`, `thread-auto-context`, and `learnings.md`.
