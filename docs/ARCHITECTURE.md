# Architecture

## Overview

**Ingenium** is a self-improving AI conventions system packaged as a bootstrap toolkit. It provides a skill-based framework that tells AI coding agents (GitHub Copilot, Cline, etc.) how to follow project conventions, enforce rules, and grow new skills as the codebase evolves. The project is self-hosting: its own skill system governs its own development.

Key properties:
- **Zero runtime dependencies** — pure Markdown + YAML + shell scripts
- **Self-improving** — an `update-skills` detection pipeline identifies gaps and auto-creates skills
- **Deployable** — a `deploy/` mirror strips source-only files for clean project bootstrapping

## Directory Map

```
ingenium/
├── .agents/                    ← AI conventions system (the "product")
│   ├── skills/                 ← 40 skills — each is a SKILL.md with YAML frontmatter
│   │   ├── generic-conventions/  ← Core rules: docs, security, error handling, DRY
│   │   ├── {framework}-conventions/ ← nextjs, python, go, rust, typescript-standalone
│   │   ├── {domain}-skills/       ← containers, kubernetes, api-design, sql-database, shell-scripts
│   │   ├── {task}-skills/         ← write-docs, generate-docs, update-skills, audit-skills, help
│   │   └── learnings.md           ← Changelog of all skill additions/retirements
│   ├── scripts/                ← Bootstrap engine
│   │   ├── bootstrap.sh        ← Main entry point — scaffolds projects with selected skills
│   │   └── hook-bootstrap.sh   ← Auto-detection + interactive mode
│   └── tests/ → moved to tests/
├── tests/                      ← Test suite (at project root, alongside docs/)
│   └── test-self-improving.sh  ← Validates update-skills detection pipeline (21 tests)
├── deploy/                     ← Clean mirror for bootstrapping other projects
│   ├── AGENTS.md               ← Minimal redirect (same as root)
│   └── .agents/skills/         ← Skills only — no scripts, hooks, docs, or tests
├── docs/                       ← Project documentation (this directory)
│   ├── README.md               ← Docs index / map
│   ├── ARCHITECTURE.md         ← This file — project structure and data flow
│   ├── TECH-STACK.md           ← Languages, tools, and dependencies
│   └── CONVENTIONS.md          ← Naming, file organization, and patterns
├── assets/                     ← Mermaid diagrams for docs
├── AGENTS.md                   ← Minimal 6-line redirect — tells AI to scan .agents/skills/
├── README.md                   ← Project overview, architecture diagram, skill catalog
├── USAGE.md                    ← How to use and maintain the skill system
└── package.json                ← Minimal — only for dependency gap detection testing
```

## Key Components

### Skill System (`.agents/skills/`)

The core of the project. Each skill is a directory containing a single `SKILL.md` file with YAML frontmatter (`name`, `description`) and Markdown body. Skills are categorized into three tiers:

| Tier | Pattern | Examples | What they do |
|------|---------|----------|-------------|
| **Core** | `generic-conventions` | 1 skill | Universal rules — docs, security, error handling, DRY |
| **Framework** | `*-conventions` | nextjs, python, go, rust, typescript-standalone | Language/framework-specific conventions, build commands, testing |
| **Domain** | named by topic | containers, kubernetes, api-design, sql-database, shell-scripts, project-structure, useful-tests | Cross-cutting technical domains |
| **Task** | `/name` invoked | write-docs, generate-docs, update-skills, audit-skills, help, repo-context, create-readme, gh-cli, thread-auto-context, playwright-mcp | Slash-command workflows, multi-step operations |
| **Pipeline** | single special | agent-pipelines | Autonomous agent loop patterns |

Skills with `description:` containing file-based triggers (e.g., `Use when editing **/*.py files`) are auto-invoked when the AI edits matching files. Task skills are invoked via slash commands or natural language queries.

### Bootstrap Engine (`.agents/scripts/`)

Two bash scripts that scaffold new projects with the skill system:

- **`bootstrap.sh`** — Main entry point. Copies deployable skills from `deploy/` to the target project. Supports `--framework` selection, `--dry-run`, and `--auto` detection. Uses `BOOTSTRAP_DIR` to point to `deploy/`.
- **`hook-bootstrap.sh`** — Interactive mode with framework auto-detection. Handles `session-start`, `pre-tool-use`, and `post-tool-use` hook generation.

### Deploy Separation (`deploy/`)

A clean mirror containing only what gets deployed to target projects:
- `deploy/.agents/skills/` — All 36 deployable skills (excludes 4 source-only: create-readme, gh-cli, playwright-mcp, thread-auto-context)
- `deploy/AGENTS.md` — Minimal redirect
- No scripts, hooks, docs, tests, or README — those are source-only

The `test-self-improving.sh` suite validates that deploy stays in sync with source (`TEST 5`) and that no source-only files leak in (`TEST 4`).

### Self-Improving Pipeline (`update-skills` + tests)

The project detects its own gaps using four signals:
1. **Dependency gaps** — `package.json` has a dep with no matching skill
2. **Missing coverage** — file types (`.vue`, `.svelte`) not covered by any skill
3. **Repeated conventions** — patterns used 3+ times without a skill
4. **Stale content** — skill references wrong versions or deleted paths

The `test-self-improving.sh` suite (21 tests) validates all four signals, deploy integrity, frontmatter validity, and file drift.

## Data Flow

```mermaid
graph TD
    A[AI receives task] --> B[AI scans .agents/skills/]
    B --> C{What files are involved?}
    C -->|.tsx/.ts in Next.js| D[nextjs-conventions]
    C -->|.py files| E[python-conventions]
    C -->|.go files| F[go-conventions]
    C -->|.rs files| G[rust-conventions]
    C -->|Dockerfile/compose| H[containers]
    C -->|K8s manifests| I[kubernetes]
    C -->|API routes| J[api-design]
    C -->|Shell scripts| K[shell-scripts]
    C -->|SQL files| L[sql-database]
    C -->|Test files| M[useful-tests]
    C -->|No match| N[generic-conventions]
    D --> O[AI follows conventions]
    E --> O
    F --> O
    G --> O
    H --> O
    I --> O
    J --> O
    K --> O
    L --> O
    M --> O
    N --> O
    O --> P{After edit — check docs?}
    P -->|Yes| Q[write-docs auto-invoked]
    P -->|No| R[Task complete]
    Q --> R
```

## Communication Patterns

The project has no runtime communication — it operates entirely at edit time:
- **AI reads skills** — VS Code Copilot/Cline scans `.agents/skills/` on startup and when file types change
- **AI writes skills** — `update-skills` creates new skill files; `audit-skills` fixes consistency
- **Bootstrap copies** — `bootstrap.sh` copies `deploy/` contents to target projects
- **Tests validate** — `test-self-improving.sh` runs as a bash script, not part of the AI loop

## External Dependencies

None at runtime. The project is pure files — Markdown, YAML, Bash, JSON.

For development/testing:
- **bash** (5.x+) — Test suite and bootstrap scripts
- **git** — Version control and commit-based learning log
- **package.json** — Exists only to provide a dependency list for gap detection testing (actual packages are never installed)

## Deployment

The project is deployed by **bootstrapping** — running `bootstrap.sh` against a target project:

```bash
# Bootstrap a new Next.js project with skill conventions
./ingenium/.agents/scripts/bootstrap.sh --framework nextjs /path/to/new-project
```

This copies `deploy/.agents/` + `deploy/AGENTS.md` into the target, giving it the full skill system. The bootstrap supports:
- **Framework selection** — `--framework nextjs|python|go|rust` selects the right skills
- **Auto-detection** — `--auto` scans existing code to detect frameworks
- **Dry runs** — `--dry-run` previews what would be copied
- **Interactive mode** — `hook-bootstrap.sh` guides the user through setup
