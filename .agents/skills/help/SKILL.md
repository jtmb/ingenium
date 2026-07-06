---
name: help
description: "Display all available skills, their commands, and invocation patterns. Quick-reference for the entire skill system. Use when the user asks 'help', 'what commands', 'what skills', 'show me everything', or needs to find the right skill for a task."
---

# Help — Skill System Quick Reference

## When to Use

- User asks "help", "what can you do?", "show me all skills", "what commands are available?"
- User needs to find the right skill for a task
- New developer onboarding — "what skills does this project have?"
- User asks "how do I run tests?" or "what's the build command?"

When invoked, display this entire file as the response. It is the canonical index of all skills and their commands.

---

## Invocable Task Skills (via `/` command)

| Command | Skill | Description |
|---------|-------|-------------|
| `/audit-skills` | `audit-skills` | Audit skill→docs consistency, auto-fix discrepancies |
| `/create-readme` | `create-readme` | Generate a README.md for the project |
| `/generate-docs` | `generate-docs` | Scan codebase, populate `docs/` templates |
| `/repo-context` | `repo-context` | Load project identity, tech stack, conventions |
| `/update-skill-index` | `update-skill-index` | Regenerate SKILL-INDEX.md from all skill files |
| `/update-skills` | `update-skills` | Detect new patterns, create/retire skills |
| `/write-docs` | `write-docs` | Write READMEs, API docs, ADRs |

---

## Skill Categories

### Core (Always Loaded)

| Skill | What it covers |
|-------|---------------|
| `generic-conventions` | Mandatory core rules: comments, docs sync, DRY, security, error handling, git, naming, config, testing checklist |

### Framework Conventions (loaded when editing matching files)

| Skill | Triggers on | Key Commands |
|-------|-------------|--------------|
| `go-conventions` | `**/*.go` | `go build ./...`, `go test ./...`, `golangci-lint run`, `go vet ./...`, `gofmt -w .`, `govulncheck ./...` |
| `nextjs-conventions` | `**/*.{tsx,ts,jsx,js,css}` in Next.js | `next dev`, `next build`, `next lint`, `tsc --noEmit`, `npm test` |
| `python-conventions` | `**/*.py` | `ruff check .`, `ruff format .`, `mypy src/`, `pytest`, `source .venv/bin/activate` |
| `rust-conventions` | `**/*.rs` | `cargo build`, `cargo test`, `cargo clippy -- -D warnings`, `cargo fmt`, `cargo check`, `cargo audit` |

### Always-Included Domain Skills (cross-cutting, copied to all projects)

| Skill | Triggers on | Key Commands & Patterns |
|-------|-------------|------------------------|
| `agent-pipelines` | Building AI agent services | Turn-based orchestrator API (`POST /check-in`, `/progress`, `GET /health`), checkpoint JSON state files, multi-phase pipeline (fetch→plan→build→test→upload), Docker Compose with bridge network, `scripts/agent-runner.js` |
| `api-design` | `**/{routes,handlers,api,controllers,endpoints}/**/*` | REST conventions: status codes, error shape (`{ error: { code, message, details[], requestId } }`), versioning (`/api/v1/`), pagination (cursor/offset), idempotency keys, rate limiting headers, OpenAPI spec |
| `containers` | `**/{Dockerfile,Containerfile,docker-compose*,compose*,.dockerignore}` | Multi-stage builds, non-root user, HEALTHCHECK (`--interval=30s --timeout=5s --retries=3`), `.dockerignore`, pin base image digests, exec form CMD, `docker build --no-cache`, `docker scan` |
| `kubernetes` | `**/{k8s,kubernetes,helm,charts,templates}/**/*.{yaml,yml}` | Security context (`runAsNonRoot`, `readOnlyRootFilesystem`), resource limits (requests+limits), probes (liveness/readiness), NetworkPolicy default-deny, RollingUpdate, TLS Ingress, cert-manager |
| `project-structure` | Creating projects, adding services, reorganizing code | Four-layer service: `pages/` → `features/` → `domain/` ← `infrastructure/`. One file per use case. kebab-case. Co-located tests. Anti-patterns: sibling imports, `utils/` dirs, `src/` with 50 flat files |
| `shell-scripts` | `**/*.{sh,bash}` | `#!/usr/bin/env bash` + `set -euo pipefail`, `trap cleanup EXIT`, `mktemp` for temp files, double-quote all `"$var"`, `[[ ]]` for tests, `$()` over backticks, no secrets in args |
| `sql-database` | `**/*.sql`, migrations | Parameterized queries (`?` / `$1` / `:name`), reversible migrations, `EXPLAIN ANALYZE`, connection pooling `(2 * cores) + 1`, UUID/ULID PKs, `TIMESTAMPTZ`, never `SELECT *`, N+1 is a bug |
| `typescript-standalone` | `**/*.{ts,tsx}` outside Next.js | `"strict": true`, `"noUncheckedIndexedAccess": true`, never `any` (use `unknown`), branded types, `AppError` class, `Promise.all`/`allSettled`, `node:` prefix imports, `vitest` or `jest` |
| `useful-tests` | `*.test.*`, `*_test.*`, `*.spec.*`, Playwright setup | `scripts/run-e2e.sh` (launch→poll→test→teardown via `trap`), Playwright config (`data-testid` selectors, trace on failure), Arrange via API, Act, Assert. Anti-patterns: `expect(true).toBe(true)`, `waitForTimeout`, no assertions |

### Task Skills (invocable via `/` or triggered by task)

| Skill | Trigger / Command | What it does |
|-------|-------------------|--------------|
| `audit-skills` | `/audit-skills` | Cross-reference audit: skills dir ↔ README ↔ mermaid ↔ bootstrap.sh ↔ AGENTS.md ↔ USAGE.md. Auto-fixes + commits + logs to learnings. Quick audit: `comm -23 <(ls -d .agents/skills/*/ ...) <(grep -oP '\.agents/skills/...' bootstrap.sh)` |
| `create-readme` | `/create-readme` | Review project, generate Markdown README with Quick Start, Usage, Configuration, Architecture link |
| `generate-docs` | `/generate-docs` | Scan codebase → populate `docs/ARCHITECTURE.md`, `TECH-STACK.md`, `CONVENTIONS.md` |
| `gh-cli` | GitHub operations | `gh auth status`, `gh pr list/create/view/merge`, `gh issue list/create/close`, `gh release create`, `gh gist create`, `gh search repos/issues`, `gh api` |
| `repo-context` | `/repo-context` | Read `docs/README.md` → `ARCHITECTURE.md` → `TECH-STACK.md` → `CONVENTIONS.md` → framework skills → generic-conventions |
| `thread-auto-context` | Always-applied, session start/end | Auto-bootstrap Thread MCP bridge, session start: `thread_read_entries` + `thread_search`, during: save decisions/bugs/preferences, end: summary + transcript upload |
| `update-skills` | `/update-skills` | Detect new deps/patterns → create/update/retire skills → commit → log to learnings |
| `write-docs` | `/write-docs` | READMEs, API docs (endpoints + request/response examples), ADRs (`docs/adr/NNNN-title.md`: Context, Decision, Consequences, rejected alternatives) |
| `playwright-mcp` | Browser automation via Cline | MCP tools: `navigate`, `browser_click`, `browser_type`, `browser_snapshot`, `browser_screenshot`, `browser_evaluate`, `browser_fill_form`, etc. Setup: `npx @playwright/mcp@latest --install-chrome` |
| `help` | `/help` or "help" query | **This skill.** Display this quick-reference. |

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
| **Audit consistency** | `/audit-skills` or `comm -23 <(ls -d .agents/skills/*/ \| sed 's\|.*/\|\|;s\|/\|\|' \| sort) <(grep -oP '\.agents/skills/\K[^/]+(?=/SKILL\.md)' .agents/scripts/bootstrap.sh \| sort)` |
| **Create/update skill** | `/update-skills` |
| **Regenerate skill index** | `/update-skill-index` |
| **View changelog** | `cat .agents/skills/learnings.md` |
| **List all skills** | `ls -d .agents/skills/*/ \| sed 's\|.*/\|\|;s\|/\|\|' \| sort` |
| **Check frontmatter** | `head -5 .agents/skills/{name}/SKILL.md` |
| **Regenerate docs** | `/generate-docs` |
| **Write new docs** | `/write-docs` |

---

## How to Use This Skill

When a user asks "help" or "what commands are available":

1. **Display this file** — it is the canonical skill index
2. **If they ask about a specific skill**, direct them to invoke it (e.g., `/python-conventions` for Python rules, `/audit-skills` to check consistency)
3. **If they ask about build/test/lint commands**, point them to the Quick Command Reference table above
4. **If they need a skill that doesn't exist**, use `/update-skills` to create it

### Anti-patterns

- Don't list skills from memory — always reference this file
- Don't suggest commands that aren't in the respective skill's SKILL.md
- Don't create help content inline — invoke this skill and display the full reference
