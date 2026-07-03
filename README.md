<div align="center">

<img src="assets/logo.svg" alt="Ingenium" width="120" />

# Ingenium
### Genius doesn't repeat itself. Neither should you.

<p>
  <img src="https://img.shields.io/badge/skills-41%20total-green?style=flat-square" alt="Skill files" />
  <img src="https://img.shields.io/badge/frameworks-4%20%2B%2023%20domain-purple?style=flat-square" alt="Frameworks" />
  <img src="https://img.shields.io/badge/skills%20that%20grow%20with%20you-%F0%9F%8C%B1-a371f7?style=flat-square" alt="Skills that grow with you" />
  <img src="https://img.shields.io/badge/total-~3%2C500%20lines-informational?style=flat-square" alt="Total lines" />
</p>

---

</div>

**The problem:** Every time you start a new project with an AI coding assistant, the AI doesn't know your conventions. It doesn't know to keep docs in sync, write comments, run tests before claiming done, or use your framework's idioms. You repeat the same instructions in every chat — and the AI drifts from your standards.

**What this solves:** A **skill-based AI conventions system** — **skills that grow with you** 🌱 — that bootstraps into every project automatically. 41 skills covering frameworks, domains, and tasks — each invoked on-demand by any AI assistant that supports the `.agents/` convention. The AI arrives already knowing the rules. You focus on the work; the skill system handles the rest.

Configure it once as a hook in your editor. Every project you open gets auto-bootstrapped with the right skills — framework detection, layered conventions, docs templates, and enforcement guardrails. No cloning, no manual copying, no per-project setup.

```mermaid
graph LR
    A[You open any project] --> B[SessionStart hook fires]
    B --> C{AGENTS.md exists?}
    C -->|No| D[Pull bootstrap from git]
    D --> E[Auto-detect framework]
    E --> F[Copy rules + docs]
    F --> G[AI follows all rules]
    C -->|Yes| G
```

## Self-Improving AI — Skills That Grow With Your Project

The system doesn't just enforce rules — it **evolves them**. The `update-skills` skill gives the AI four detection signals to identify when your project needs new or updated conventions:

| Signal | What the AI detects | Example |
|--------|-------------------|---------|
| **New dependency** | A framework or library added to `package.json` / `pyproject.toml` / `go.mod` / `Cargo.toml` with no matching skill | Adding `prisma` → AI proposes an ORM skill |
| **Repeated patterns** | 3+ files following the same unwritten convention | Every feature folder has `index.ts` + `hooks.ts` + `types.ts` → AI proposes codifying it |
| **Missing coverage** | File types or directories with no applicable skill | `**/*.graphql` files exist but no GraphQL skill → AI flags the gap |
| **Stale content** | A skill references outdated versions, dead paths, or wrong commands | Skill says "React 18" but `package.json` has React 19 → AI proposes update |

When the AI detects a pattern, it **creates** a new skill or updates an existing one — automatically. No approval needed. The skill system grows with your codebase. No more stale conventions docs.

## Quick Start — Set Up the Hook (do this once)

AI coding assistants that support the `.agents/` convention (e.g., VS Code Copilot, Cline) read hooks from their hook directory. For VS Code Copilot, hooks live at `~/.copilot/hooks/` (global, applies to every project). Create this file:

**`~/.copilot/hooks/trigger-bootstrap.json`**

```json
{
    "hooks": {
        "SessionStart": [
            {
                "type": "command",
                "command": "if [ ! -f AGENTS.md ]; then curl -fsSL https://raw.githubusercontent.com/jtmb/ingenium/main/.agents/scripts/hook-bootstrap.sh | bash; fi"
            }
        ]
    }
}
```

That's it. Now:

1. Open any project in VS Code (or your AI-supporting editor)
2. Start an AI chat
3. The hook auto-detects the framework (Next.js, Python, Go, Rust, or generic) and bootstraps the project
4. The AI follows all rules automatically — doc sync, code comments, testing, DRY

**You never run the bootstrap scripts directly again.** The hook handles it.

> **Where hooks live (VS Code Copilot):** `~/.copilot/hooks/*.json` — NOT in `settings.json`. This is VS Code Copilot's global hooks directory. Other AI assistants may use different hook locations. Each `.json` file registers one or more lifecycle hooks (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`).

> **What happens?** `.agents/scripts/hook-bootstrap.sh` caches this repo in `~/.cache/ingenium/`, auto-detects the framework from `package.json` / `pyproject.toml` / `go.mod` / `Cargo.toml`, and calls `.agents/scripts/bootstrap.sh --auto --framework <detected> /path/to/your/project`.

## What Gets Bootstrapped

| Layer | File | Purpose |
|-------|------|---------|
| **Core rules** | `.agents/skills/generic-conventions/SKILL.md` | The definitive 13-section reference: comments, docs, testing, DRY, security, error handling, config, naming |
| **Project structure** | `.agents/skills/project-structure/SKILL.md` | Monorepo layout, service layering (pages/features/domain/infrastructure), naming, boundaries |
| **Frameworks** | `.agents/skills/{fw}-conventions/SKILL.md` (4 files) | Next.js, Python, Go, Rust — build commands, idioms, project layout |
| **Cross-cutting** | `.agents/skills/{domain}/SKILL.md` (22 files) | Containers, Shell, SQL, API Design, Kubernetes, TypeScript, Agent Pipelines, Useful Tests, Gitignore, GitHub Actions (hardening + efficiency), PostgreSQL, Debugging, Code Review, Refactoring, Self-Correction, CLI Toolkit, Regex, Git Workflows, Error Interpretation, Model Profiles — everything in between |
| **Docs** | `docs/` (4 files) | Templates the AI fills in as it works — architecture, tech stack, conventions |
| **Tasks** | `.agents/skills/{name}/SKILL.md` (10 files deployed + 4 source-only) | `generate-docs`, `repo-context`, `write-docs`, `update-skills`, `update-skill-index`, `audit-skills`, `help`, `web-design-reviewer`, `chrome-devtools`, `github-issues` — invocable via `/` slash commands |
| **Hooks** | `.agents/hooks/` (3 files) | PreToolUse guard, SessionStart bootstrap, PostToolUse pass-through |
| **CI** | `.agents/workflows/ci.yml` (optional) | Matrix CI for lint/build/test — copied if present |
| **Usage** | `USAGE.md` | Handbook for adding your own skills |

## Coverage — Every File Type Has Rules

### Framework Detection (auto-bootstrapped by hook)

| Framework | Detected by | Skill |
|-----------|------------|-------|
| Next.js / TypeScript | `"next"` in `package.json` | `nextjs-conventions` |
| Python | `pyproject.toml`, `setup.py`, `setup.cfg` | `python-conventions` |
| Go | `go.mod` | `go-conventions` |
| Rust | `Cargo.toml` | `rust-conventions` |
| Generic (fallback) | none of the above | `generic-conventions` |

### Always-Included Skills

| Domain | Skill | What It Covers |
|--------|-------|-----------------|
| 🏗️ Structure | `project-structure` | Monorepo layout, 4-layer services, naming, service boundaries |
| 🐳 Containers | `containers` | Multi-stage builds, non-root user, HEALTHCHECK, secrets |
| 🤖 Agent Pipelines | `agent-pipelines` | Agent loops, turn-based orchestration, state checkpoints, crash recovery |
| 🧪 Useful Tests | `useful-tests` | Write tests that catch real bugs — unit, integration, E2E with Playwright, app lifecycle |
| 🐚 Shell | `shell-scripts` | `set -euo pipefail`, quoting, error handling, portability |
| 🗄️ SQL | `sql-database` | Parameterized queries, migrations, indexing, N+1 prevention |
| 🔌 API Design | `api-design` | Status codes, error shapes, pagination, idempotency |
| ☸️ Kubernetes | `kubernetes` | Security context, probes, resources, network policies |
| 📘 TypeScript | `typescript-standalone` | Strict config, type safety, async patterns, Node.js |
| 🗂️ Gitignore | `gitignore` | .gitignore conventions — patterns, structure, and rules per language |
| 🛡️ GitHub Actions Hardening | `github-actions-hardening` | Security review — script injection, token scoping, supply chain, triggers |
| ⚡ GitHub Actions Efficiency | `github-actions-efficiency` | Audit CI minutes, reduce costs, optimize workflow performance |
| 🐘 PostgreSQL | `postgresql-optimization` | JSONB, arrays, custom types, full-text search, window functions, extensions |
| 🐛 Debugging | `debugging-patterns` | Systematic debugging — bisect, log-driven, stack-trace analysis, anti-patterns |
| ✅ Code Review | `code-review-checklist` | 5-lens review across security, correctness, perf, readability, testing |
| 🔧 Refactoring | `refactoring-recipes` | 10 named patterns with explicit before/after code examples |
| 🔄 Self-Correction | `self-correction-patterns` | AI mistake recognition, backtracking triggers, verification loops |
| 🛠️ CLI Toolkit | `cli-toolkit` | jq, curl, sed, awk, find, xargs, grep — flags, recipes, gotchas |
| 🔤 Regex | `regex-reference` | Common patterns, per-language escaping, catastrophic backtracking |
| 🌿 Git Workflows | `git-workflows` | Rebase, bisect, reflog recovery, conventional commits, squashing |
| ❌ Error Interpretation | `error-interpretation` | Error signature → root cause per language — cross-language patterns |
| 🧠 Model Profiles | `model-profiles` | Model-aware hints for Qwen and Gemma — context windows, strengths, prompt adaptation per model size |

### Task Skills (invoke via `/`)

| Skill | Trigger |
|-------|---------|
| `generate-docs` | `/generate-docs` — scan codebase, populate `docs/` templates |
| `write-docs` | `/write-docs` — write READMEs, API docs, ADRs |
| `repo-context` | `/repo-context` — get project identity, tech stack, conventions overview |
| `update-skills` | `/update-skills` — detect missing/outdated skills, create/update/retire (autonomous) |
| `audit-skills` | `/audit-skills` — cross-reference skills against README, mermaid, bootstrap.sh for consistency |
| `help` | `/help` or "help" — display all skills, their commands, and invocation patterns |
| `update-skill-index` | `/update-skill-index` — regenerate SKILL-INDEX.md from all skill files (auto-invoked after skill changes) |
| `web-design-reviewer` | `/web-design-reviewer` — inspect websites for responsive, accessibility, and layout issues |
| `chrome-devtools` | `/chrome-devtools` — browser automation, screenshots, network analysis, performance profiling |
| `github-issues` | `/github-issues` — create/update/manage issues, labels, milestones, dependencies, templates |
| `create-readme` | `/create-readme` — create a README.md file for the project **(source only)** |
| `gh-cli` | `/gh-cli` — GitHub CLI integration for repos, PRs, issues, releases **(source only)** |
| `playwright-mcp` | `/playwright-mcp` — browser automation via Playwright MCP **(source only)** |
| `thread-auto-context` | `/thread-auto-context` — automatic persistent memory via Thread MCP **(source only)** |

## Architecture — Skill System

```mermaid
graph TD
    A[AI receives task] --> B[AI reads AGENTS.md]
    B --> C[AI scans .agents/skills/]
    C --> D{What files are involved?}
    D -->|.tsx/.ts in Next.js| E[nextjs-conventions]
    D -->|.py files| F[python-conventions]
    D -->|.go files| G[go-conventions]
    D -->|.rs files| H[rust-conventions]
    D -->|creating project| P[project-structure]
    D -->|agent loops / orchestration| AP[agent-pipelines]
    D -->|writing tests / *.test.*| UT[useful-tests]
    D -->|help / what commands| HL[help]
    HL --> J
    D -->|Dockerfile / compose| X1[containers]
    D -->|.sh / .bash| X2[shell-scripts]
    D -->|.sql| X3[sql-database]
    D -->|API routes| X4[api-design]
    D -->|k8s / helm| X5[kubernetes]
    D -->|.ts / .tsx standalone| X6[typescript-standalone]
    D -->|.gitignore files| GI[gitignore]
    D -->|web design review| WD[web-design-reviewer]
    D -->|GitHub Actions security| GH[github-actions-hardening]
    D -->|GitHub Actions efficiency| GE[github-actions-efficiency]
    D -->|PostgreSQL| PG[postgresql-optimization]
    D -->|browser testing| CD[chrome-devtools]
    D -->|issue management| IS[github-issues]
    D -->|debugging| DP[debugging-patterns]
    D -->|code review| CR[code-review-checklist]
    D -->|refactoring| RR[refactoring-recipes]
    D -->|self-correction| SC[self-correction-patterns]
    D -->|CLI tools| CT[cli-toolkit]
    D -->|regex| RX[regex-reference]
    D -->|git workflows| GW[git-workflows]
    D -->|error interpretation| EI[error-interpretation]
    D -->|model selection / model-aware hints| MP[model-profiles]
    D -->|anything else| I[generic-conventions]
    E --> J[AI follows applicable skills]
    F --> J
    G --> J
    H --> J
    P --> J
    AP --> J
    UT --> J
    X1 --> J
    X2 --> J
    X3 --> J
    X4 --> J
    X5 --> J
    X6 --> J
    GI --> J
    WD --> J
    GH --> J
    GE --> J
    PG --> J
    CD --> J
    IS --> J
    DP --> J
    CR --> J
    RR --> J
    SC --> J
    CT --> J
    RX --> J
    GW --> J
    EI --> J
    MP --> J
    I --> J
    J --> K[update-skills detects new patterns]
    K --> L[Skill system grows with project]
```

| Layer | Location | Trigger | Contains |
|-------|----------|---------|----------|
| **Core** | `.agents/skills/generic-conventions/SKILL.md` | On-demand via `/` | Docs sync, code comments, testing, DRY — framework-agnostic |
| **Structure** | `.agents/skills/project-structure/SKILL.md` | On-demand via `/` | Monorepo layout, service layering, boundaries, anti-patterns |
| **Framework** | `.agents/skills/{fw}-conventions/SKILL.md` | On-demand via `/` | Build commands, directory conventions, language idioms |
| **Domain** | `.agents/skills/{domain}/SKILL.md` | On-demand via `/` | Containers, SQL, API design, Kubernetes, shell, TypeScript |
| **Tasks** | `.agents/skills/{name}/SKILL.md` | `/` slash commands | Doc generation, repo context, write docs, **update skills** |
| **Enforcement** | `.agents/hooks/*.json` | Agent lifecycle events | Deterministic guardrails (block commands, auto-lint) |
| **Safety net** | `.agents/workflows/ci.yml` | Push / PR | Lint, type-check, test, build |

## Key Rules (from `generic-conventions` skill — 13 Sections)

| Section | Mandate |
|---------|---------|
| 📝 **Code Comments** | Every function & export explains **why** |
| 📚 **Docs Sync** | Every code change updates `docs/` same turn |
| 🧪 **Test Before Done** | Lint → build → test → smoke — all must pass |
| 🔁 **Don't Repeat Yourself** | Extract shared logic, one authoritative location |
| 🔒 **Secure Coding** | No secrets in code, validate input, least privilege, audit deps |
| 📁 **Project Structure** | Feature grouping, co-located tests, one concern per file — see `project-structure` skill for monorepo layout |
| 🔀 **Git & Version Control** | Atomic commits, Conventional Commits, no generated files |
| 👁️ **Observability** | Structured logging, health checks, distributed tracing |
| ⚡ **Performance** | Measure first, N+1 is a bug, paginate, timeout everything |
| ❌ **Error Handling** | Never swallow, wrap with context, typed errors, crash-only |
| ⚙️ **Configuration** | One config module, validate at startup, 12-factor, secrets ≠ config |
| 🏷️ **Naming Conventions** | Descriptive, no abbreviations, language-consistent casing |
| 🔄 **Skill System** | AGENTS.md directs AI to `.agents/skills/` for every code change. `update-skills` grows them as your project evolves. |

## Manual Bootstrap (optional)

If you can't use hooks, or want to bootstrap once:

```bash
git clone --depth 1 https://github.com/jtmb/ingenium.git
./ingenium/.agents/scripts/bootstrap.sh --framework python /path/to/your-project
```

Or for non-interactive CI use:

```bash
./.agents/scripts/bootstrap.sh --auto --framework nextjs /path/to/your-project
```

## Further Reading

- **[USAGE.md](./USAGE.md)** — How to add your own skills, create custom workflows, and maintain the system (decision tree, step-by-step guides)
- **[docs/](./docs/)** — Project documentation database built by the AI as it works
- **[AGENTS.md](./AGENTS.md)** — Skill system index (start here)
