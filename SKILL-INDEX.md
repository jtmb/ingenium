# SKILL-INDEX.md — Ingenium Skill System

Auto-maintained index of all skills. Updated via `/update-skill-index`.

**Total: 45 skills** (all in `.agents/skills/`)

---

## Invocable Task Skills (via `/` command)

These skills are directly invocable via `/command` patterns. See `help/SKILL.md` for details.

| Command | Skill | Description |
|---------|-------|-------------|
| `/audit-skills` | [audit-skills](.agents/skills/audit-skills/SKILL.md) | Audit skill→docs consistency, cross-reference .agents/skills/ against README, AGENTS.md, mermaid diagrams. Auto-fix discrepancies. |
| `/create-readme` | [create-readme](.agents/skills/create-readme/SKILL.md) | Generate a README.md for the project |
| `/generate-docs` | [generate-docs](.agents/skills/generate-docs/SKILL.md) | Scan codebase, populate `docs/` templates |
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
| [typescript-standalone](.agents/skills/typescript-standalone/SKILL.md) | `**/*.{ts,tsx}` outside Next.js | `tsc --noEmit`, `npm test` / `vitest`, `eslint .`, `prettier --check .` |

---

## Always-Included Domain Skills (cross-cutting, available to all projects)

| Skill | Triggers on | Description |
|-------|-------------|-------------|
| [agent-pipelines](.agents/skills/agent-pipelines/SKILL.md) | Building AI agent services | Autonomous AI agent pipeline patterns — orchestration, turn-based coordination, state checkpoints, crash recovery, multi-phase build pipelines, containerized agents. |
| [api-design](.agents/skills/api-design/SKILL.md) | `**/{routes,handlers,api,controllers,endpoints}/**/*` | REST/HTTP API design conventions — status codes, error shapes, versioning, auth, pagination, rate limiting, idempotency. |
| [chrome-devtools](.agents/skills/chrome-devtools/SKILL.md) | Browser debugging, web page analysis | Expert-level browser automation, debugging, and performance analysis using Chrome DevTools MCP. |
| [cli-toolkit](.agents/skills/cli-toolkit/SKILL.md) | Shell pipelines, text processing | Concise reference for common CLI tools — jq, curl, sed, awk, find, xargs, grep. |
| [code-review-checklist](.agents/skills/code-review-checklist/SKILL.md) | PR reviews, code audits | Structured code review checklist — security, correctness, performance, readability, testing. |
| [containers](.agents/skills/containers/SKILL.md) | `**/{Dockerfile,Containerfile,docker-compose*,.dockerignore}` | Container conventions — multi-stage builds, non-root users, layer caching, secrets hygiene, HEALTHCHECK, docker-compose patterns. |
| [cost-analyzer](.agents/skills/cost-analyzer/SKILL.md) | DeepSeek API cost analysis | Analyze DeepSeek API usage CSVs and compare costs across OpenAI, Anthropic, and OpenCode Go/Zen. |
| [debugging-patterns](.agents/skills/debugging-patterns/SKILL.md) | Debugging sessions | Systematic debugging methodology — isolation, bisection, log-driven, and stack-trace analysis. |
| [docker](.agents/skills/docker/SKILL.md) | Docker ecosystem management | Docker ecosystem management — build cache optimization, garbage collection, volume lifecycle, log management. |
| [error-interpretation](.agents/skills/error-interpretation/SKILL.md) | Build/runtime/CI failures | Map common error signatures to their actual root causes — null reference, type mismatch, import failure, permission denied, network timeout. |
| [gh-cli](.agents/skills/gh-cli/SKILL.md) | GitHub operations | GitHub CLI (`gh`) integration — update repo metadata, manage PRs/issues/releases, create gists, search code, and query the API. |
| [gitignore](.agents/skills/gitignore/SKILL.md) | `.gitignore` files | Git ignore file conventions — patterns, structure, and rules for .gitignore files. |
| [help](.agents/skills/help/SKILL.md) | User asks "help" or "what skills" | Display all available skills, their commands, and invocation patterns. Quick-reference for the entire skill system. |
| [kubernetes](.agents/skills/kubernetes/SKILL.md) | `**/{k8s,kubernetes,helm,charts,templates}/**/*.{yaml,yml}` | Kubernetes conventions — security contexts, resource limits, probes, network policies, deployment strategies. |
| [local-models](.agents/skills/local-models/SKILL.md) | Model selection, terminal safety, LM Studio API | Local LLM management — model profiles (Qwen, Gemma, DeepSeek), command safety rules (no `&`, timeout wrappers), local provider API reference, and cross-model strategy guide. |
| [mermaid](.agents/skills/mermaid/SKILL.md) | Documentation, architecture diagrams | Mermaid diagram conventions — mandatory diagrams in all documentation. |
| [onboard-existing-repo](.agents/skills/onboard-existing-repo/SKILL.md) | Onboarding projects to the Ingenium skill system | Onboard an existing repository to the Ingenium skill system. Launches parallel subagents to explore structure/languages/CI/docs. |
| [orchestrator-primer](.agents/skills/orchestrator-primer/SKILL.md) | Session start, delegation rules | 🔴 MANDATORY DELEGATION DIRECTIVE — Never write code or edit files directly. Always delegate to subagents. |
| [playwright-mcp](.agents/skills/playwright-mcp/SKILL.md) | Browser automation | Browser automation via Playwright MCP — navigate, click, type, snapshot pages. |
| [postgresql-optimization](.agents/skills/postgresql-optimization/SKILL.md) | PostgreSQL development | PostgreSQL-specific development — JSONB operations, array types, full-text search, window functions, extensions ecosystem. |
| [project-structure](.agents/skills/project-structure/SKILL.md) | Creating projects, reorganizing code | Monorepo microservices project structure conventions — root-level services (config/, lib/, scripts/, data/), naming, boundaries, anti-patterns. |
| [refactoring-recipes](.agents/skills/refactoring-recipes/SKILL.md) | Code improvement | Catalog of refactoring patterns with explicit before/after examples — extract method, invert conditional, replace magic number, and more. |
| [regex-reference](.agents/skills/regex-reference/SKILL.md) | Regex writing, review | Regex pattern reference — common patterns, language-specific escaping differences, catastrophic backtracking prevention. |
| [self-correction-patterns](.agents/skills/self-correction-patterns/SKILL.md) | AI mistake recovery | Patterns for recognizing and recovering from AI mistakes — backtracking triggers, verification loops, assumption checking. |
| [shell-scripts](.agents/skills/shell-scripts/SKILL.md) | `**/*.{sh,bash}` | Shell script conventions — safety flags, quoting, error handling, temporary files, portability. |
| [skill-load](.agents/skills/skill-load/SKILL.md) | Session start | 🔴 MANDATORY FIRST COMMAND — Inject the skill-system payload. Use as the first message in every session: `/skill-load`. |
| [sql-database](.agents/skills/sql-database/SKILL.md) | `**/*.sql`, migrations | SQL & database conventions — parameterized queries, migration safety, indexing, connection pooling, query performance. |
| [thread-auto-context](.agents/skills/thread-auto-context/SKILL.md) | Session start/end, always-applied | Automatic persistent memory via Thread MCP — search context at session start, save decisions/preferences during work, save summary at end. |
| [useful-tests](.agents/skills/useful-tests/SKILL.md) | `*.test.*`, `*_test.*`, `*.spec.*` | Write tests that catch real bugs — unit, integration, and E2E with Playwright. Covers app lifecycle, test quality signals, CI readiness. |
| [web-design-reviewer](.agents/skills/web-design-reviewer/SKILL.md) | UI/UX review | Visual inspection of websites to identify and fix design issues — responsive design, accessibility, visual consistency, layout breakage. |
| [wsl-cleanup](.agents/skills/wsl-cleanup/SKILL.md) | WSL disk cleanup, system maintenance | WSL2 Ubuntu system maintenance and disk cleanup — Docker prune, apt/pip/npm caches, journalctl vacuum, temp file cleanup. 🔴 Never touches $HOME/repos. |

---

## Core Skill

| Skill | Description |
|-------|-------------|
| [generic-conventions](.agents/skills/generic-conventions/SKILL.md) | Fallback coding conventions — ALWAYS check `.agents/skills/` for framework/domain skills FIRST. Covers comments, docs sync, DRY, security, error handling, git, naming, config, testing checklist. |

---

## Quick Command Reference

### Per-Language Build/Test/Lint

| Language | Build | Test | Lint | Format | Type Check |
|----------|-------|------|------|--------|------------|
| **Go** | `go build ./...` | `go test ./...` | `golangci-lint run` | `gofmt -w .` | `go vet ./...` |
| **Python** | — | `pytest` | `ruff check .` | `ruff format .` | `mypy src/` |
| **Rust** | `cargo build` | `cargo test` | `cargo clippy -- -D warnings` | `cargo fmt` | `cargo check` |
| **TypeScript** | `tsc --noEmit` | `npm test` / `vitest` | `eslint .` | `prettier --check .` | `tsc --noEmit` |
| **Next.js** | `next build` | `npm test` | `next lint` | — | `tsc --noEmit` |

### Infrastructure

| Domain | Key Commands |
|--------|-------------|
| **Docker** | `docker build --no-cache .`, `docker compose -f docker-compose.test.yml up --build --detach` |
| **E2E Tests** | `npx playwright test`, `npx playwright install chrome` |
| **GitHub CLI** | `gh pr list`, `gh pr create`, `gh issue create`, `gh release create`, `gh api`, `gh search repos` |
| **Shell Scripts** | `#!/usr/bin/env bash` + `set -euo pipefail`, `trap cleanup EXIT` |

---

## Skill System Maintenance

| Task | Command / Skill |
|------|----------------|
| **Audit consistency** | `/audit-skills` or `comm -23 <(ls -d .agents/skills/*/ \| sed 's\|.*/\|\|;s\|/\|\|' \| sort) <(grep -oP '(?<=\[)[^]]+(?=\]\(\.agents/skills/)' SKILL-INDEX.md \| sort)` |
| **Create new skill** | [create-skills](.agents/skills/create-skills/SKILL.md) |
| **Update/retire skill** | `/update-skills` |
| **Regenerate skill index** | `/update-skill-index` |
| **Generate docs templates** | `/generate-docs` |
| **Write new documentation** | `/write-docs` |
| **View changelog** | `cat .agents/skills/learnings.md` |
| **List all skills** | `ls -d .agents/skills/*/ \| sed 's\|.*/\|\|;s\|/\|\|' \| sort` |
| **Check skill frontmatter** | `head -5 .agents/skills/{name}/SKILL.md` |

---

## Skills — `.agents/skills/` (45)

| # | Directory | File |
|---|-----------|------|
| 1 | `agent-pipelines` | [`.agents/skills/agent-pipelines/SKILL.md`](.agents/skills/agent-pipelines/SKILL.md) |
| 2 | `api-design` | [`.agents/skills/api-design/SKILL.md`](.agents/skills/api-design/SKILL.md) |
| 3 | `audit-skills` | [`.agents/skills/audit-skills/SKILL.md`](.agents/skills/audit-skills/SKILL.md) |
| 4 | `chrome-devtools` | [`.agents/skills/chrome-devtools/SKILL.md`](.agents/skills/chrome-devtools/SKILL.md) |
| 5 | `cli-toolkit` | [`.agents/skills/cli-toolkit/SKILL.md`](.agents/skills/cli-toolkit/SKILL.md) |
| 6 | `code-review-checklist` | [`.agents/skills/code-review-checklist/SKILL.md`](.agents/skills/code-review-checklist/SKILL.md) |
| 7 | `containers` | [`.agents/skills/containers/SKILL.md`](.agents/skills/containers/SKILL.md) |
| 8 | `cost-analyzer` | [`.agents/skills/cost-analyzer/SKILL.md`](.agents/skills/cost-analyzer/SKILL.md) |
| 9 | `create-readme` | [`.agents/skills/create-readme/SKILL.md`](.agents/skills/create-readme/SKILL.md) |
| 10 | `create-skills` | [`.agents/skills/create-skills/SKILL.md`](.agents/skills/create-skills/SKILL.md) |
| 11 | `debugging-patterns` | [`.agents/skills/debugging-patterns/SKILL.md`](.agents/skills/debugging-patterns/SKILL.md) |
| 12 | `docker` | [`.agents/skills/docker/SKILL.md`](.agents/skills/docker/SKILL.md) |
| 13 | `error-interpretation` | [`.agents/skills/error-interpretation/SKILL.md`](.agents/skills/error-interpretation/SKILL.md) |
| 14 | `generate-docs` | [`.agents/skills/generate-docs/SKILL.md`](.agents/skills/generate-docs/SKILL.md) |
| 15 | `generic-conventions` | [`.agents/skills/generic-conventions/SKILL.md`](.agents/skills/generic-conventions/SKILL.md) |
| 16 | `gh-cli` | [`.agents/skills/gh-cli/SKILL.md`](.agents/skills/gh-cli/SKILL.md) |
| 17 | `gitignore` | [`.agents/skills/gitignore/SKILL.md`](.agents/skills/gitignore/SKILL.md) |
| 18 | `go-conventions` | [`.agents/skills/go-conventions/SKILL.md`](.agents/skills/go-conventions/SKILL.md) |
| 19 | `help` | [`.agents/skills/help/SKILL.md`](.agents/skills/help/SKILL.md) |
| 20 | `kubernetes` | [`.agents/skills/kubernetes/SKILL.md`](.agents/skills/kubernetes/SKILL.md) |
| 21 | `local-models` | [`.agents/skills/local-models/SKILL.md`](.agents/skills/local-models/SKILL.md) |
| 22 | `mermaid` | [`.agents/skills/mermaid/SKILL.md`](.agents/skills/mermaid/SKILL.md) |
| 23 | `nextjs-conventions` | [`.agents/skills/nextjs-conventions/SKILL.md`](.agents/skills/nextjs-conventions/SKILL.md) |
| 24 | `onboard-existing-repo` | [`.agents/skills/onboard-existing-repo/SKILL.md`](.agents/skills/onboard-existing-repo/SKILL.md) |
| 25 | `orchestrator-primer` | [`.agents/skills/orchestrator-primer/SKILL.md`](.agents/skills/orchestrator-primer/SKILL.md) |
| 26 | `playwright-mcp` | [`.agents/skills/playwright-mcp/SKILL.md`](.agents/skills/playwright-mcp/SKILL.md) |
| 27 | `postgresql-optimization` | [`.agents/skills/postgresql-optimization/SKILL.md`](.agents/skills/postgresql-optimization/SKILL.md) |
| 28 | `project-structure` | [`.agents/skills/project-structure/SKILL.md`](.agents/skills/project-structure/SKILL.md) |
| 29 | `python-conventions` | [`.agents/skills/python-conventions/SKILL.md`](.agents/skills/python-conventions/SKILL.md) |
| 30 | `refactoring-recipes` | [`.agents/skills/refactoring-recipes/SKILL.md`](.agents/skills/refactoring-recipes/SKILL.md) |
| 31 | `regex-reference` | [`.agents/skills/regex-reference/SKILL.md`](.agents/skills/regex-reference/SKILL.md) |
| 32 | `repo-context` | [`.agents/skills/repo-context/SKILL.md`](.agents/skills/repo-context/SKILL.md) |
| 33 | `rust-conventions` | [`.agents/skills/rust-conventions/SKILL.md`](.agents/skills/rust-conventions/SKILL.md) |
| 34 | `self-correction-patterns` | [`.agents/skills/self-correction-patterns/SKILL.md`](.agents/skills/self-correction-patterns/SKILL.md) |
| 35 | `shell-scripts` | [`.agents/skills/shell-scripts/SKILL.md`](.agents/skills/shell-scripts/SKILL.md) |
| 36 | `skill-load` | [`.agents/skills/skill-load/SKILL.md`](.agents/skills/skill-load/SKILL.md) |
| 37 | `sql-database` | [`.agents/skills/sql-database/SKILL.md`](.agents/skills/sql-database/SKILL.md) |
| 38 | `thread-auto-context` | [`.agents/skills/thread-auto-context/SKILL.md`](.agents/skills/thread-auto-context/SKILL.md) |
| 39 | `typescript-standalone` | [`.agents/skills/typescript-standalone/SKILL.md`](.agents/skills/typescript-standalone/SKILL.md) |
| 40 | `update-skill-index` | [`.agents/skills/update-skill-index/SKILL.md`](.agents/skills/update-skill-index/SKILL.md) |
| 41 | `update-skills` | [`.agents/skills/update-skills/SKILL.md`](.agents/skills/update-skills/SKILL.md) |
| 42 | `useful-tests` | [`.agents/skills/useful-tests/SKILL.md`](.agents/skills/useful-tests/SKILL.md) |
| 43 | `web-design-reviewer` | [`.agents/skills/web-design-reviewer/SKILL.md`](.agents/skills/web-design-reviewer/SKILL.md) |
| 44 | `write-docs` | [`.agents/skills/write-docs/SKILL.md`](.agents/skills/write-docs/SKILL.md) |
| 45 | `wsl-cleanup` | [`.agents/skills/wsl-cleanup/SKILL.md`](.agents/skills/wsl-cleanup/SKILL.md) |
