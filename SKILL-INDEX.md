# Skill Index — Complete Reference

This file is the **canonical index** of all skills in this project. It is automatically maintained by the `update-skill-index` skill. Every skill in `.agents/skills/` is listed here with its description, function, commands, and a link to its full documentation.

**Total: 46 items** (all in `.agents/skills/`)

---

## Invocable Task Skills (via `/` command)

| Command | Skill | Description | Location |
|---------|-------|-------------|----------|
| `/skill-load` | [skill-load](.agents/skills/skill-load/SKILL.md) | 🔴 MANDATORY FIRST COMMAND — Inject the skill-system payload. Tells the model to read AGENTS.md and load all applicable skills from .agents/skills/ before ANY action. Use as the first message in every session: '/skill-load'. This IS the payload. | `.agents/skills/` |
| `/audit-skills` | [audit-skills](.agents/skills/audit-skills/SKILL.md) | Audit the skill system for consistency — cross-reference .agents/skills/ against README.md, AGENTS.md, USAGE.md, bootstrap.sh, and mermaid diagrams. Find orphans, missing entries, stale paths, and frontmatter issues. Auto-applies fixes without asking. Use after adding or removing skills, or when docs look out of date. | `.agents/skills/` |
| `/create-readme` | [create-readme](.agents/skills/create-readme/SKILL.md) | 'Create a README.md file for the project' | `.agents/skills/` |
| `/create-skills` | [create-skills](.agents/skills/create-skills/SKILL.md) | Teach an AI agent how to create new OpenCode skills — directory setup, frontmatter rules, content structure, registration in catalogs, and validation testing. | `.agents/skills/` |
| `/generate-docs` | [generate-docs](.agents/skills/generate-docs/SKILL.md) | Scan the codebase and populate docs/ templates (ARCHITECTURE.md, TECH-STACK.md, CONVENTIONS.md). Use after project scaffolding or when docs are stale. | `.agents/skills/` |
| `/help` | [help](.agents/skills/help/SKILL.md) | Display all available skills, their commands, and invocation patterns. Quick-reference for the entire skill system. Use when the user asks 'help', 'what commands', 'what skills', 'show me everything', or needs to find the right skill for a task. | `.agents/skills/` |
| `/repo-context` | [repo-context](.agents/skills/repo-context/SKILL.md) | Provide project context to the AI — identity, tech stack, docs map, conventions overview, build/test commands. Use when starting a new coding session or needing to refresh context. | `.agents/skills/` |
| `/update-skill-index` | [update-skill-index](.agents/skills/update-skill-index/SKILL.md) | Regenerate SKILL-INDEX.md from all skill SKILL.md files — keeps the root-level skill index in sync with the skill directory. AUTO-INVOKE after any skill addition, removal, or rename. Use when the SKILL-INDEX.md is stale or missing entries. | `.agents/skills/` |
| `/update-skills` | [update-skills](.agents/skills/update-skills/SKILL.md) | Create, update, and retire skills as projects evolve. Detects patterns (new frameworks, repeated conventions, missing coverage) and creates new skills autonomously. Covers both target-project skill management and bootstrap repo maintenance. Use when the codebase has grown new patterns, added dependencies, or when conventions have drifted. | `.agents/skills/` |
| `/write-docs` | [write-docs](.agents/skills/write-docs/SKILL.md) | Write high-quality documentation — READMEs, API docs, ADRs, architecture decision records, and AGENTS.md skill index. AUTO-INVOKE after any change to the skill system (.agents/skills/, tests/, bootstrap scripts) or when docs are stale. Do not wait for the user to ask — check docs freshness proactively after every code change. Invokes the Explore subagent by default. | `.agents/skills/` |
| `/onboard-existing-repo` | [onboard-existing-repo](.agents/skills/onboard-existing-repo/SKILL.md) | Onboard an existing repository to the ingenium skill system. Launches parallel subagents to explore structure/languages/CI/docs, maps findings to applicable skills, generates docs from templates. Use when user says 'onboard this repo', 'add skill system to this project', or 'bootstrap this existing codebase'. | `.agents/skills/` |
| `/local-models` | [local-models](.agents/skills/local-models/SKILL.md) | Local LLM management — model profiles (Qwen, Gemma, DeepSeek), command safety rules, LM Studio API reference, and cross-model strategy guide. | `.agents/skills/` |
| `/debugging-patterns` | [debugging-patterns](.agents/skills/debugging-patterns/SKILL.md) | Systematic debugging methodology — isolation, bisection, log-driven, and stack-trace analysis. Use when diagnosing bugs, interpreting errors, or investigating test failures. | `.agents/skills/` |
| `/self-correction-patterns` | [self-correction-patterns](.agents/skills/self-correction-patterns/SKILL.md) | Patterns for recognizing and recovering from AI mistakes — backtracking triggers, verification loops, assumption checking. Use when the model produces incorrect output, gets stuck in a loop, or needs to self-correct. | `.agents/skills/` |
| `/thread-auto-context` | [thread-auto-context](.agents/skills/thread-auto-context/SKILL.md) | >- | `.agents/skills/` |
| `/chrome-devtools` | [chrome-devtools](.agents/skills/chrome-devtools/SKILL.md) | 'Expert-level browser automation, debugging, and performance analysis using Chrome DevTools MCP. Use for interacting with web pages, capturing screenshots, analyzing network traffic, and profiling performance.' | `.agents/skills/` |
| `/playwright-mcp` | [playwright-mcp](.agents/skills/playwright-mcp/SKILL.md) | Browser automation via Playwright MCP — navigate, click, type, snapshot pages. Use when you need to interact with web pages. | `.agents/skills/` |
| `/gh-cli` | [gh-cli](.agents/skills/gh-cli/SKILL.md) | >- | `.agents/skills/` |
| `/web-design-reviewer` | [web-design-reviewer](.agents/skills/web-design-reviewer/SKILL.md) | 'This skill enables visual inspection of websites running locally or remotely to identify and fix design issues. Triggers on requests like review website design, check the UI, fix the layout, find design problems. Detects issues with responsive design, accessibility, visual consistency, and layout breakage, then performs fixes at the source code level.' | `.agents/skills/` |

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
| [agent-pipelines](.agents/skills/agent-pipelines/SKILL.md) | Building AI agent services | Autonomous AI agent pipeline patterns — orchestration, turn-based coordination, state checkpoints, crash recovery, multi-phase build pipelines, containerized agents. Use when building services that run AI agents (Cline CLI, autonomous coding agents) or coordinating multiple agents sharing a scarce resource. |
| [api-design](.agents/skills/api-design/SKILL.md) | `**/{routes,handlers,api,controllers,endpoints}/**/*` | REST/HTTP API design conventions — status codes, error shapes, versioning, auth, pagination, rate limiting, idempotency. Use when designing or implementing API routes, handlers, or controllers. |
| [cli-toolkit](.agents/skills/cli-toolkit/SKILL.md) | Shell pipelines, text processing | Concise reference for common CLI tools — jq, curl, sed, awk, find, xargs, grep. Use when constructing shell pipelines, parsing JSON on the command line, or performing text transformations. |
| [code-review-checklist](.agents/skills/code-review-checklist/SKILL.md) | PR reviews, code audits | Structured code review checklist — security, correctness, performance, readability, testing. Use when reviewing pull requests, evaluating AI-generated code, or auditing code quality. |
| [containers](.agents/skills/containers/SKILL.md) | `**/{Dockerfile,Containerfile,docker-compose*,.dockerignore}` | Container conventions — multi-stage builds, non-root users, layer caching, secrets hygiene, HEALTHCHECK, signal handling, docker-compose patterns. Use when editing Dockerfiles, Containerfiles, or compose files. |
| [cost-analyzer](.agents/skills/cost-analyzer/SKILL.md) | DeepSeek API cost analysis | Analyze DeepSeek API usage CSVs and compare costs across OpenAI, Anthropic, and OpenCode Go/Zen. Use when the user downloads DeepSeek usage exports or asks 'is Go worth it', 'compare costs', 'which provider is cheapest'. |
| [docker](.agents/skills/docker/SKILL.md) | Docker ecosystem management | Docker ecosystem management — build cache optimization, garbage collection, volume lifecycle, log management. Use when optimizing Docker builds or cleaning up Docker resources. |
| [error-interpretation](.agents/skills/error-interpretation/SKILL.md) | Build/runtime/CI failures | Map common error signatures to their actual root causes — null reference, type mismatch, import failure, permission denied, network timeout. Use when diagnosing build failures, runtime errors, or CI failures. |
| [generic-conventions](.agents/skills/generic-conventions/SKILL.md) | — | Fallback coding conventions — ALWAYS check .agents/skills/ for framework/domain skills FIRST. Load this only when no other skill applies. Covers comments, docs, DRY, security, error handling, git, config. |
| [gitignore](.agents/skills/gitignore/SKILL.md) | `.gitignore` files | Git ignore file conventions — patterns, structure, and rules for .gitignore files. Use when creating or editing .gitignore files. |
| [kubernetes](.agents/skills/kubernetes/SKILL.md) | `**/{k8s,kubernetes,helm,charts,templates}/**/*.{yaml,yml}` | Kubernetes conventions — security contexts, resource limits, probes, network policies, deployment strategies. Use when writing K8s manifests, Helm charts, or Kustomize overlays. |
| [mermaid](.agents/skills/mermaid/SKILL.md) | Documentation, architecture diagrams | Mermaid diagram conventions — mandatory diagrams in all documentation. Every architectural, data-flow, lifecycle, process, state, or relationship concept MUST have a Mermaid visual. Use when editing files in docs/, writing ADRs, generating READMEs, documenting architecture, or creating any markdown file that explains system behavior. |
| [local-models](.agents/skills/local-models/SKILL.md) | Model selection, terminal safety, LM Studio API | Local LLM management — model profiles (Qwen, Gemma, DeepSeek), command safety rules, LM Studio API reference, and cross-model strategy guide. |
| [orchestrator-primer](.agents/skills/orchestrator-primer/SKILL.md) | Session start, delegation rules | 🔴 MANDATORY DELEGATION DIRECTIVE — Always visible. Never write code or edit files directly. Always delegate to subagents. Loaded via opencode.json instructions for always-on enforcement. |
| [postgresql-optimization](.agents/skills/postgresql-optimization/SKILL.md) | PostgreSQL development | 'PostgreSQL-specific development assistant focusing on unique PostgreSQL features, advanced data types, and PostgreSQL-exclusive capabilities. Covers JSONB operations, array types, custom types, range/geometric types, full-text search, window functions, and PostgreSQL extensions ecosystem.' |
| [project-structure](.agents/skills/project-structure/SKILL.md) | Creating projects, reorganizing code | Monorepo microservices project structure conventions — root-level services (config/, lib/, scripts/, data/), naming, boundaries, shared packages, anti-patterns. Use when creating new projects, adding services, or reorganizing code. |
| [refactoring-recipes](.agents/skills/refactoring-recipes/SKILL.md) | Code improvement | Catalog of refactoring patterns with explicit before/after examples — extract method, invert conditional, replace magic number, and more. Use when improving code structure, reducing complexity, or cleaning up legacy code. |
| [regex-reference](.agents/skills/regex-reference/SKILL.md) | Regex writing, review | Regex pattern reference — common patterns, language-specific escaping differences, catastrophic backtracking prevention. Use when writing or reviewing regular expressions in any language. |
| [shell-scripts](.agents/skills/shell-scripts/SKILL.md) | `**/*.{sh,bash}` | Shell script conventions — safety flags, quoting, error handling, temporary files, portability. Use when writing or editing **/*.{sh,bash} files. |
| [sql-database](.agents/skills/sql-database/SKILL.md) | `**/*.sql`, migrations | SQL & database conventions — parameterized queries, migration safety, indexing, connection pooling, query performance. Use when writing **/*.sql files or database migrations. |
| [typescript-standalone](.agents/skills/typescript-standalone/SKILL.md) | `**/*.{ts,tsx}` outside Next.js | Standalone TypeScript conventions (non-Next.js) — strict tsconfig, type safety, error handling, async patterns, Node.js conventions, testing. Use when writing **/*.{ts,tsx} outside Next.js projects. |
| [useful-tests](.agents/skills/useful-tests/SKILL.md) | `*.test.*`, `*_test.*`, `*.spec.*` | Write tests that catch real bugs — unit, integration, and E2E with Playwright. Covers app lifecycle (launch → test → teardown), test quality signals, anti-patterns for broken AI-generated tests, and CI readiness. Use when writing any test file (*.test.*, *_test.*, *.spec.*), adding Playwright, or setting up test infrastructure. |
| [chrome-devtools](.agents/skills/chrome-devtools/SKILL.md) | Browser debugging | 'Expert-level browser automation, debugging, and performance analysis using Chrome DevTools MCP. Use for interacting with web pages, capturing screenshots, analyzing network traffic, and profiling performance.' |
| [playwright-mcp](.agents/skills/playwright-mcp/SKILL.md) | Browser automation | Browser automation via Playwright MCP — navigate, click, type, snapshot pages. Use when you need to interact with web pages. |
| [gh-cli](.agents/skills/gh-cli/SKILL.md) | GitHub operations | >- |
| [kaban-board](.agents/skills/kaban-board/SKILL.md) | Kaban terminal Kanban board | Terminal Kanban board for AI agents — install npm package, configure MCP server in OpenCode, manage tasks via CLI or TUI. Use when managing task boards, tracking work across agents, or setting up the Kaban MCP server. |
| [web-design-reviewer](.agents/skills/web-design-reviewer/SKILL.md) | UI/UX review | 'This skill enables visual inspection of websites running locally or remotely to identify and fix design issues. Triggers on requests like review website design, check the UI, fix the layout, find design problems. Detects issues with responsive design, accessibility, visual consistency, and layout breakage, then performs fixes at the source code level.' |
| [wsl-cleanup](.agents/skills/wsl-cleanup/SKILL.md) | WSL disk cleanup, system maintenance | WSL2 Ubuntu system maintenance and disk cleanup — Docker prune, apt/pip/npm caches, journalctl vacuum, temp file cleanup, snap revisions, model caches. 🔴 Never touches $HOME/repos. Use when disk space is low or routine maintenance is needed. |

---

## Instructions — `.agents/skills/` (session init, task execution, diagnosis)

| Skill | Triggers on | Description |
|-------|-------------|-------------|
| [debugging-patterns](.agents/skills/debugging-patterns/SKILL.md) | — | Systematic debugging methodology — isolation, bisection, log-driven, and stack-trace analysis. Use when diagnosing bugs, interpreting errors, or investigating test failures. |
| [help](.agents/skills/help/SKILL.md) | — | Display all available skills, their commands, and invocation patterns. Quick-reference for the entire skill system. Use when the user asks 'help', 'what commands', 'what skills', 'show me everything', or needs to find the right skill for a task. |
| [local-models](.agents/skills/local-models/SKILL.md) | — | Local LLM management — model profiles (Qwen, Gemma, DeepSeek), command safety rules, LM Studio API reference, and cross-model strategy guide. |
| [repo-context](.agents/skills/repo-context/SKILL.md) | — | Provide project context to the AI — identity, tech stack, docs map, conventions overview, build/test commands. Use when starting a new coding session or needing to refresh context. |
| [self-correction-patterns](.agents/skills/self-correction-patterns/SKILL.md) | — | Patterns for recognizing and recovering from AI mistakes — backtracking triggers, verification loops, assumption checking. Use when the model produces incorrect output, gets stuck in a loop, or needs to self-correct. |
| [skill-load](.agents/skills/skill-load/SKILL.md) | — | 🔴 MANDATORY FIRST COMMAND — Inject the skill-system payload. Tells the model to read AGENTS.md and load all applicable skills from .agents/skills/ before ANY action. Use as the first message in every session: '/skill-load'. This IS the payload. |
| [thread-auto-context](.agents/skills/thread-auto-context/SKILL.md) | — | >- |
| [update-skills](.agents/skills/update-skills/SKILL.md) | — | Create, update, and retire skills as projects evolve. Detects patterns (new frameworks, repeated conventions, missing coverage) and creates new skills autonomously. Covers both target-project skill management and bootstrap repo maintenance. Use when the codebase has grown new patterns, added dependencies, or when conventions have drifted. |
| [update-skill-index](.agents/skills/update-skill-index/SKILL.md) | — | Regenerate SKILL-INDEX.md from all skill SKILL.md files — keeps the root-level skill index in sync with the skill directory. AUTO-INVOKE after any skill addition, removal, or rename. Use when the SKILL-INDEX.md is stale or missing entries. |
| [audit-skills](.agents/skills/audit-skills/SKILL.md) | — | Audit the skill system for consistency — cross-reference .agents/skills/ against README.md, AGENTS.md, USAGE.md, bootstrap.sh, and mermaid diagrams. Find orphans, missing entries, stale paths, and frontmatter issues. Auto-applies fixes without asking. Use after adding or removing skills, or when docs look out of date. |
| [generate-docs](.agents/skills/generate-docs/SKILL.md) | — | Scan the codebase and populate docs/ templates (ARCHITECTURE.md, TECH-STACK.md, CONVENTIONS.md). Use after project scaffolding or when docs are stale. |
| [write-docs](.agents/skills/write-docs/SKILL.md) | — | Write high-quality documentation — READMEs, API docs, ADRs, architecture decision records, and AGENTS.md skill index. AUTO-INVOKE after any change to the skill system (.agents/skills/, tests/, bootstrap scripts) or when docs are stale. Do not wait for the user to ask — check docs freshness proactively after every code change. Invokes the Explore subagent by default. |
| [onboard-existing-repo](.agents/skills/onboard-existing-repo/SKILL.md) | — | Onboard an existing repository to the ingenium skill system. Launches parallel subagents to explore structure/languages/CI/docs, maps findings to applicable skills, generates docs from templates. Use when user says 'onboard this repo', 'add skill system to this project', or 'bootstrap this existing codebase'. |

---

## Core Skill

| Skill | Description |
|-------|-------------|
| [generic-conventions](.agents/skills/generic-conventions/SKILL.md) | Fallback coding conventions — ALWAYS check .agents/skills/ for framework/domain skills FIRST. Load this only when no other skill applies. Covers comments, docs, DRY, security, error handling, git, config. |

---

## Quick Command Reference

| Language / Tool | Init | Build & Run | Lint & Format | Test |
|----------------|------|-------------|---------------|------|
| **Go** | `go mod init` | `go build ./...` | `golangci-lint run && go vet ./... && gofmt -w .` | `go test ./... -v` |
| **Next.js** | `npx create-next-app@latest` | `npm run dev` / `npm run build` | `next lint` + `tsc --noEmit` | `npm test` or `npx playwright test` |
| **Python** | `python -m venv .venv` | `python -m src` | `ruff check . && ruff format . && mypy src/` | `pytest -v` |
| **Rust** | `cargo init` | `cargo build` / `cargo run` | `cargo clippy -- -D warnings && cargo fmt` | `cargo test` |
| **TypeScript** | `npm init` / `tsc --init` | `tsc` / `node dist/index.js` | `tsc --noEmit` (type-check only) | `node --test` or `vitest` |

### Infrastructure Commands

| Operation | Command |
|-----------|---------|
| Docker build | `docker build -t <tag> .` |
| Docker compose | `docker compose up -d` |
| K8s deploy | `kubectl apply -f k8s/` |
| K8s status | `kubectl get pods,svc,deploy` |

### Skill System Maintenance

| Command | When |
|---------|------|
| `bash tests/test-self-improving.sh` | Run all 7 detection pipeline tests |
| `bash tests/test-self-improving.sh -v` | Verbose test output |
| `bash tests/test-agent-validation.sh` | Validate all 11 agent `.md` files (7 checks) |
| `bash tests/test-agent-validation.sh -v` | Verbose agent validation output |

---

## Skills — `.agents/skills/` (46)

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
| 20 | `kaban-board` | [`.agents/skills/kaban-board/SKILL.md`](.agents/skills/kaban-board/SKILL.md) |
| 21 | `kubernetes` | [`.agents/skills/kubernetes/SKILL.md`](.agents/skills/kubernetes/SKILL.md) |
| 22 | `local-models` | [`.agents/skills/local-models/SKILL.md`](.agents/skills/local-models/SKILL.md) |
| 23 | `mermaid` | [`.agents/skills/mermaid/SKILL.md`](.agents/skills/mermaid/SKILL.md) |
| 24 | `nextjs-conventions` | [`.agents/skills/nextjs-conventions/SKILL.md`](.agents/skills/nextjs-conventions/SKILL.md) |
| 25 | `onboard-existing-repo` | [`.agents/skills/onboard-existing-repo/SKILL.md`](.agents/skills/onboard-existing-repo/SKILL.md) |
| 26 | `orchestrator-primer` | [`.agents/skills/orchestrator-primer/SKILL.md`](.agents/skills/orchestrator-primer/SKILL.md) |
| 27 | `playwright-mcp` | [`.agents/skills/playwright-mcp/SKILL.md`](.agents/skills/playwright-mcp/SKILL.md) |
| 28 | `postgresql-optimization` | [`.agents/skills/postgresql-optimization/SKILL.md`](.agents/skills/postgresql-optimization/SKILL.md) |
| 29 | `project-structure` | [`.agents/skills/project-structure/SKILL.md`](.agents/skills/project-structure/SKILL.md) |
| 30 | `python-conventions` | [`.agents/skills/python-conventions/SKILL.md`](.agents/skills/python-conventions/SKILL.md) |
| 31 | `refactoring-recipes` | [`.agents/skills/refactoring-recipes/SKILL.md`](.agents/skills/refactoring-recipes/SKILL.md) |
| 32 | `regex-reference` | [`.agents/skills/regex-reference/SKILL.md`](.agents/skills/regex-reference/SKILL.md) |
| 33 | `repo-context` | [`.agents/skills/repo-context/SKILL.md`](.agents/skills/repo-context/SKILL.md) |
| 34 | `rust-conventions` | [`.agents/skills/rust-conventions/SKILL.md`](.agents/skills/rust-conventions/SKILL.md) |
| 35 | `self-correction-patterns` | [`.agents/skills/self-correction-patterns/SKILL.md`](.agents/skills/self-correction-patterns/SKILL.md) |
| 36 | `shell-scripts` | [`.agents/skills/shell-scripts/SKILL.md`](.agents/skills/shell-scripts/SKILL.md) |
| 37 | `skill-load` | [`.agents/skills/skill-load/SKILL.md`](.agents/skills/skill-load/SKILL.md) |
| 38 | `sql-database` | [`.agents/skills/sql-database/SKILL.md`](.agents/skills/sql-database/SKILL.md) |
| 39 | `thread-auto-context` | [`.agents/skills/thread-auto-context/SKILL.md`](.agents/skills/thread-auto-context/SKILL.md) |
| 40 | `typescript-standalone` | [`.agents/skills/typescript-standalone/SKILL.md`](.agents/skills/typescript-standalone/SKILL.md) |
| 41 | `update-skill-index` | [`.agents/skills/update-skill-index/SKILL.md`](.agents/skills/update-skill-index/SKILL.md) |
| 42 | `update-skills` | [`.agents/skills/update-skills/SKILL.md`](.agents/skills/update-skills/SKILL.md) |
| 43 | `useful-tests` | [`.agents/skills/useful-tests/SKILL.md`](.agents/skills/useful-tests/SKILL.md) |
| 44 | `web-design-reviewer` | [`.agents/skills/web-design-reviewer/SKILL.md`](.agents/skills/web-design-reviewer/SKILL.md) |
| 45 | `write-docs` | [`.agents/skills/write-docs/SKILL.md`](.agents/skills/write-docs/SKILL.md) |
| 46 | `wsl-cleanup` | [`.agents/skills/wsl-cleanup/SKILL.md`](.agents/skills/wsl-cleanup/SKILL.md) |

---


