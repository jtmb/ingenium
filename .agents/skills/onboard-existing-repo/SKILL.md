---
name: onboard-existing-repo
description: "Onboard an existing repository to the ingenium skill system. Launches parallel subagents to explore structure/languages/CI/docs, maps findings to applicable skills, copies deploy payload, generates docs from templates. Use when user says 'onboard this repo', 'add skill system to this project', or 'bootstrap this existing codebase'."
---

# Onboard Existing Repository

## 🔴 HARD RULES

- **DO NOT overwrite existing files** unless they're templates containing `<!-- TODO -->` markers
- **Parallelize discovery** — launch 3 subagents simultaneously, not sequentially
- **Only copy skills that match the project's tech stack** — do not copy everything
- **Always run `/audit-skills` after applying** to verify consistency
- **Always update AGENTS.md skill catalog** to only list actually-copied skills
- **Never modify existing source code** — this skill adds `.agents/` and `docs/` only
- **Ask the user for `$BOOTSTRAP_REPO` path** if it's not provided — default: path to local clone of `jtmb/ingenium`

## When to Use

Invoke this skill when the user says any of:
- "Onboard this repo to the skill system"
- "Add agent instructions to this project"
- "Bootstrap this existing codebase"
- "Set up `.agents/` for this project"
- "Migrate this project to use ingenium"

This skill is for **existing repos with existing code**. For fresh project scaffolds, use `bootstrap.sh` instead.

## How It Works — Four Phases

```
┌─────────────────────────────────────────────────────────────┐
│ Phase 1: Parallel Discovery (3 subagents)                   │
│  ┌─────────────────┐  ┌──────────────────┐  ┌───────────┐  │
│  │ A: Structure &  │  │ B: CI/CD &       │  │ C: Docs   │  │
│  │ Stack           │  │ Practices        │  │ & Gaps    │  │
│  └────────┬────────┘  └────────┬─────────┘  └─────┬─────┘  │
└───────────┼────────────────────┼───────────────────┼────────┘
            ▼                    ▼                   ▼
┌─────────────────────────────────────────────────────────────┐
│ Phase 2: Skill Mapping — cross-reference findings vs        │
│ bootstrap catalog, produce list of applicable skills        │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ Phase 3: Apply — copy payload, fill templates,              │
│ generate .gitignore, update AGENTS.md                       │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ Phase 4: Verify — audit-skills, check TODOs, validate      │
│ hooks JSON, report gaps to user                            │
└─────────────────────────────────────────────────────────────┘
```

---

## Phase 1 — Parallel Discovery

Launch **3 subagents simultaneously**. Do NOT run them sequentially — they are independent.

### Subagent A — Structure & Stack

**Goal**: Identify the project's languages, frameworks, build system, and file layout.

Instructions for the subagent:
1. Run a file tree scan ignoring noise dirs (`node_modules/`, `.git/`, `dist/`, `build/`, `target/`, `__pycache__/`, `venv/`, `.venv/`, `.next/`, `*.min.*`)
2. Identify all programming languages by file extension counts (count `.py`, `.go`, `.rs`, `.ts`, `.tsx`, `.js`, `.jsx`, `.java`, `.rb`, `.php`, `.c`, `.cpp`, `.h`, `.swift`, `.kt`, etc.)
3. Read all package manifests:
   - `package.json` — dependencies, scripts, framework (React, Vue, Angular, Next.js, Express)
   - `Cargo.toml` — Rust deps, edition
   - `go.mod` — Go module path, deps
   - `pyproject.toml`, `setup.py`, `requirements.txt` — Python deps, framework
   - `Gemfile` — Ruby deps
   - `pom.xml`, `build.gradle` — Java deps
   - `Cargo.toml`, `composer.json`, `mix.exs`, etc.
4. Identify the primary framework (Next.js, Django, Flask, FastAPI, Spring, Rails, Actix, Gin, etc.)
5. Identify build system and commands (`Makefile`, `justfile`, npm scripts, webpack, vite, turbopack)
6. Check for Docker/K8s presence:
   - `Dockerfile` or `Containerfile` at root
   - `docker-compose.yml` or `compose.yaml`
   - `kubernetes/`, `k8s/`, `helm/`, `charts/`, `templates/` directories
7. Determine project structure: monorepo with services? single app? library?

**Return**: A structured report listing: language extensions with counts, package manager, framework, build commands, Docker/K8s flag, project type.

### Subagent B — CI/CD & Practices

**Goal**: Identify CI pipelines, testing setup, linting, commit conventions, and deployment.

Instructions for the subagent:
1. Explore `.github/workflows/` for CI configs — list all workflow files with their triggers
2. Check for `.gitlab-ci.yml`, `Jenkinsfile`, `circleci/config.yml`, `.drone.yml`
3. Identify testing frameworks:
   - `jest.config.*`, `vitest.config.*`, `mocha`, `ava`, `tap`
   - `pytest.ini`, `setup.cfg` (pytest section), `tox.ini`
   - `*_test.go` files or `test/` dir
   - `**/*.test.ts`, `**/*.spec.ts`
   - `cargo test` in `Cargo.toml` scripts
4. Check for linting/formatter configs:
   - `.eslintrc*`, `.prettierrc*`, `.stylelintrc*`
   - `ruff.toml`, `.pylintrc`, `.flake8`
   - `golangci-lint` config
   - `clippy.toml`, `rustfmt.toml`
5. Examine git log for commit conventions:
   - `git log --oneline -20` to check for conventional commits
   - `git log --format="%s" -30` for commit style
6. Check for `.editorconfig`, `.env.example`, `.envrc`
7. Check for `Makefile` or `Taskfile.yml` targets

**Return**: A structured report listing: CI platform and workflow files, test framework, linter/formatter configs found, commit convention style, Makefile/justfile presence.

### Subagent C — Existing Docs & Gaps

**Goal**: Inventory existing documentation and identify what's missing.

Instructions for the subagent:
1. List all existing documentation files:
   - `README.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, `LICENSE`
   - `docs/` directory contents
   - `docs/ARCHITECTURE.md`, `docs/TECH-STACK.md`, `docs/CONVENTIONS.md`
   - `wiki/`, `adr/`, `rfcs/` directories
2. Check if `.agents/` directory already exists:
   - List contents of `.agents/` if present
   - Check for `.agents/skills/`, `.agents/instructions/`, `.agents/tools/`, `.agents/hooks/`
   - Check if `AGENTS.md` exists at project root
3. Identify missing docs templates:
   - `docs/ARCHITECTURE.md` missing?
   - `docs/TECH-STACK.md` missing?
   - `docs/CONVENTIONS.md` missing?
4. Check for existing `.gitignore` — list its contents
5. Check for existing `.dockerignore` if Docker is present
6. Check for `SECURITY.md`, `CODE_OF_CONDUCT.md`, `SUPPORT.md`

**Return**: A structured report listing: existing docs, `.agents/` status (exists/partial/missing), missing docs list, `.gitignore` status, any existing code of conduct.

---

## Phase 2 — Map Findings to Skills

Collect reports from all 3 subagents, then cross-reference against the bootstrap catalog.

### Data-Driven Skill Selection

| Discovery Signal | Applicable Skills |
|-----------------|-------------------|
| `*.py` files or `pyproject.toml`/`setup.py` | `python-conventions` |
| `*.go` files or `go.mod` | `go-conventions` |
| `*.rs` files or `Cargo.toml` | `rust-conventions` |
| `*.tsx` + `next.config.*` or `next` in package.json | `nextjs-conventions` |
| `Dockerfile` or `compose.yaml` | `containers` |
| `*.sh` or `*.bash` files | `shell-scripts` |
| `*.sql` files or `migrations/` dir | `sql-database` |
| K8s manifests or Helm charts | `kubernetes` |
| `package.json` with REST routes or `routes/` dir | `api-design` |
| `package.json` (no Next.js, any TS/JS) | `typescript-standalone` |
| PostgreSQL used (requirements, config, or ORM) | `postgresql-optimization` |
| `*.test.*`, `*_test.go`, `jest`, `pytest` | `useful-tests` |

### Always-Applied Skills (universal — copy unconditionally)

**Skills:**
- `generic-conventions` — core rules
- `project-structure` — layering, naming, boundaries
- `agent-pipelines` — AI agent orchestration
- `gitignore` — .gitignore patterns
- `code-review-checklist` — PR review rules
- `refactoring-recipes` — refactoring patterns
- `cli-toolkit` — CLI tool reference
- `regex-reference` — regex patterns
- `error-interpretation` — error diagnosis

**Instructions:**
- `skill-load` — 🔴 mandatory bootstrap payload
- `help` — skill catalog reference
- `repo-context` — project identity
- `debugging-patterns` — systematic debugging
- `self-correction-patterns` — AI recovery
- `local-models` — terminal safety, model profiles, LM Studio API
- `update-skills` — self-improvement
- `audit-skills` — consistency checks
- `update-skill-index` — index regeneration
- `generate-docs` — doc generation
- `write-docs` — doc writing
- `local-models` — 🔴 Local LLM management, LM Studio API, vision bridge
- `thread-auto-context` — session memory

**Tools (if project has browser/UI/API surface):**
- `chrome-devtools` — browser debugging
- `playwright-mcp` — browser automation
- `web-design-reviewer` — UI review
- `github-issues` — issue management

### Framework-Specific

If Phase 1 identified a framework, apply the matching framework skill from the "Data-Driven" table above (python-conventions, go-conventions, rust-conventions, or nextjs-conventions).

### Build the Final Copy List

Using the reports from Phase 1 and the mapping above, produce two lists:

1. **Skills to copy**: Items from the tables where the discovery signal matched
2. **Skills available but not applicable**: Items that don't match — these are NOT copied but logged for the user

---

## Phase 3 — Apply Bootstrap Payload

### 3.1 Create Directory Structure

```bash
mkdir -p .agents/{skills,instructions,tools,hooks} docs/
```

### 3.2 Copy Applicable Skills

For each skill in the "Skills to copy" list from Phase 2:

```bash
cp -r "$BOOTSTRAP_REPO/.agents/skills/<skill-name>/" ".agents/skills/<skill-name>/"
```

Where `$BOOTSTRAP_REPO` is the path to the cloned bootstrap repo.

### 3.3 Copy Applicable Instructions

Always copy all these instructions (they're the session management layer):

```bash
for instr in skill-load help repo-context debugging-patterns self-correction-patterns \
             local-models update-skills audit-skills update-skill-index \
             generate-docs write-docs thread-auto-context; do
  cp -r "$BOOTSTRAP_REPO/.agents/instructions/$instr/" ".agents/instructions/$instr/"
done
```

### 3.4 Copy Applicable Tools

Copy tools based on project needs (from Phase 2 mapping):

```bash
# Always copy github-issues (low cost, high value)
for tool in chrome-devtools playwright-mcp web-design-reviewer github-issues; do
  if [[ -d "$BOOTSTRAP_REPO/.agents/tools/$tool/" ]]; then
    cp -r "$BOOTSTRAP_REPO/.agents/tools/$tool/" ".agents/tools/$tool/"
  fi
done
```

### 3.5 Copy Hooks (Always — All 3)

```bash
cp "$BOOTSTRAP_REPO/.agents/hooks/"*.json ".agents/hooks/"
```

### 3.6 Copy and Customize AGENTS.md

```bash
cp "$BOOTSTRAP_REPO/AGENTS.md" "AGENTS.md"
```

Then **edit AGENTS.md** to update the quick-reference tables:
1. Remove framework skills that don't apply (e.g., if no Python, remove `python-conventions`)
2. Remove domain skills that weren't copied
3. Remove tool entries that weren't copied
4. Keep instructions table as-is (always all applied)
5. Keep the Self-Improvement section as-is
6. Update paths in the Session Startup Checklist to reflect only copied frameworks

### 3.7 Copy and Fill Docs Templates

```bash
for doc in README.md ARCHITECTURE.md TECH-STACK.md CONVENTIONS.md; do
  if [[ ! -f "docs/$doc" ]] || grep -q "<!-- TODO -->" "docs/$doc"; then
    cp "$BOOTSTRAP_REPO/docs/$doc" "docs/$doc"
  fi
done
```

Then use the `generate-docs` skill patterns to fill each template:
- **ARCHITECTURE.md**: Document the project structure from Phase 1A findings
- **TECH-STACK.md**: List all dependencies from Phase 1A package manifest reading
- **CONVENTIONS.md**: Document observed naming/file patterns from Phase 1A, CI/testing patterns from Phase 1B
- **README.md**: Generate a concise README if none exists

### 3.8 Generate/Update .gitignore

Read `.agents/skills/gitignore/SKILL.md` and generate a `.gitignore` that covers:
- The detected languages and frameworks from Phase 1A
- Common tooling dirs (`node_modules/`, `.venv/`, `target/`, etc.)
- Existing patterns if `.gitignore` already exists (merge, don't overwrite)
- OS and editor files (`*.swp`, `.DS_Store`, etc.)

---

## Phase 4 — Verify

### 4.1 Run audit-skills

```bash
/audit-skills
```

This cross-references all skills against AGENTS.md, SKILL-INDEX.md, and other docs. Fix any discrepancies it finds.

### 4.2 Verify No Unfilled TODOs

Search for unfilled template markers:

```bash
grep -r "<!-- TODO -->" .agents/ docs/ AGENTS.md || echo "No unfilled TODOs found"
```

If any exist, fill them with real project data.

### 4.3 Validate Hooks JSON

```bash
for hook in .agents/hooks/*.json; do
  python3 -c "import json; json.load(open('$hook'))" || echo "INVALID: $hook"
done
```

### 4.4 Check .gitignore Completeness

Verify that `.gitignore` covers:
- All dependency dirs found in Phase 1A (e.g., `node_modules/`, `vendor/`, `.venv/`)
- All build output dirs found (e.g., `dist/`, `build/`, `target/`, `.next/`)
- Standard OS/editor files

### 4.5 Run Project's Test Suite

If the project has tests detected in Phase 1B, run them to verify nothing was broken:

```bash
npm test        # if JS/TS
pytest          # if Python
go test ./...   # if Go
cargo test      # if Rust
```

### 4.6 Report to User

Provide a summary:
- **Added**: List of skills/instructions/tools/hooks that were copied
- **Already existed**: Files that were found and NOT overwritten
- **Docs populated**: Which docs were created or filled
- **Gaps**: Any skills that might apply but weren't detected (e.g., "No Dockerfile found — `containers` skill not copied")
- **Next steps**: Suggest running `/repo-context` and `/help` to explore the new skill system

---

## Reference: Bootstrap Repo Paths

| Artifact | Source Path |
|----------|-------------|
| AGENTS.md | `$BOOTSTRAP_REPO/AGENTS.md` |
| Skills | `$BOOTSTRAP_REPO/.agents/skills/<name>/` |
| Instructions | `$BOOTSTRAP_REPO/.agents/instructions/<name>/` |
| Tools | `$BOOTSTRAP_REPO/.agents/tools/<name>/` |
| Hooks | `$BOOTSTRAP_REPO/.agents/hooks/` |
| Docs templates | `$BOOTSTRAP_REPO/docs/` |
| Hook bootstrap script | `$BOOTSTRAP_REPO/.agents/scripts/hook-bootstrap.sh` |
| CI workflow | `$BOOTSTRAP_REPO/.agents/workflows/ci.yml` |

Default `$BOOTSTRAP_REPO`: path to local clone of `jtmb/ingenium`
