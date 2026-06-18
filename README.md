# Copilot AI Bootstrap — Set Once, Auto-Bootstrap Every Project

**The problem:** Every time you start a new project (or open an existing one with VS Code Copilot), the AI doesn't know your conventions. It doesn't know to keep docs in sync, write comments, run tests before claiming done, or use your framework's idioms. You end up repeating the same instructions in every chat, or worse — the AI drifts from your standards and you spend time fixing its output.

**What this solves:** One hook. Every project. The AI arrives already knowing the rules — framework-specific build commands, language idioms, directory conventions, and universal quality standards. You focus on the work; the rules take care of themselves.

This repo is **consumed as a hook**. Configure it once in your VS Code Copilot settings, and every project you open gets auto-bootstrapped with the right AI rules — framework detection, layered instructions, docs templates, and enforcement guardrails. No cloning, no manual copying, no per-project setup.

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

## Quick Start — Set Up the Hook (do this once)

Add this to your VS Code Copilot user settings:

```json
"github.copilot.chat.agent.hooks": {
  "SessionStart": [
    {
      "command": "if [ ! -f AGENTS.md ]; then bash <(curl -fsSL https://raw.githubusercontent.com/brajam/gh-llm-bootstrap/main/.github/scripts/hook-bootstrap.sh); fi",
      "timeout": 30
    }
  ]
}
```

That's it. Now:

1. Open any project in VS Code
2. Start a Copilot chat
3. The hook auto-detects the framework (Next.js, Python, Go, Rust, or generic) and bootstraps the project
4. The AI follows all rules automatically — doc sync, code comments, testing, DRY

**You never run the bootstrap scripts directly again.** The hook handles it.

> **What happens?** `.github/scripts/hook-bootstrap.sh` caches this repo in `~/.cache/gh-llm-bootstrap/`, auto-detects the framework from `package.json` / `pyproject.toml` / `go.mod` / `Cargo.toml`, and calls `.github/scripts/bootstrap.sh --auto --framework <detected> /path/to/your/project`.

## What Gets Bootstrapped

| Layer | File | Purpose |
|-------|------|---------|
| **Core** | `AGENTS.md` | Universal rules (docs sync, comments, testing, DRY) |
| **Framework** | `.github/instructions/{fw}.instructions.md` | Build commands, language idioms, directory conventions |
| **Docs** | `docs/` (4 files) | Templates the AI fills in as it works |
| **Prompts** | `.github/prompts/` (2 files) | `/generate-docs` and `/repo-context` slash commands |
| **Hooks** | `.github/hooks/` (3 files) | PreToolUse guard, SessionStart bootstrap, PostToolUse lint |
| **CI** | `.github/workflows/ci.yml` | Matrix CI for lint/build/test |
| **Usage** | `USAGE.md` | Handbook for adding your own rules |

## Supported Frameworks

| Framework | Detected by | `applyTo` |
|-----------|------------|-----------|
| Next.js / TypeScript | `"next"` in `package.json` | `**/*.{tsx,ts,jsx,js,css}` |
| Python | `pyproject.toml`, `setup.py`, `setup.cfg` | `**/*.py` |
| Go | `go.mod` | `**/*.go` |
| Rust | `Cargo.toml` | `**/*.rs` |
| Generic (fallback) | none of the above | `**` |

## Architecture — Layered Rules

```mermaid
graph TD
    A[AI receives task] --> B[always-read-agents.instructions.md fires]
    B --> C[AI reads AGENTS.md — core rules]
    C --> D{What files are involved?}
    D -->|.tsx/.ts files| E[nextjs.instructions.md]
    D -->|.py files| F[python.instructions.md]
    D -->|.go files| G[go.instructions.md]
    D -->|.rs files| H[rust.instructions.md]
    D -->|anything else| I[generic.instructions.md]
    E --> J[AI follows framework rules]
    F --> J
    G --> J
    H --> J
    I --> J
    J --> K[Hooks enforce deterministically]
    K --> L[CI catches what AI misses]
```

| Layer | Location | Trigger | Contains |
|-------|----------|---------|----------|
| **Core** | `AGENTS.md` | Every interaction | Docs sync, code comments, testing, DRY — framework-agnostic |
| **Framework** | `.github/instructions/{fw}.instructions.md` | `applyTo` file glob | Build commands, directory conventions, language idioms |
| **Project** | `.github/instructions/{project}.instructions.md` | `applyTo` file glob | Tool registration, domain knowledge, anti-patterns |
| **Tasks** | `.github/prompts/{name}.prompt.md` | On-demand via `/` | Code generation, doc generation, refactoring workflows |
| **Workflows** | `.github/skills/{name}/SKILL.md` | On-demand via `/` | Multi-step tasks with bundled scripts/templates |
| **Personas** | `.github/agents/{name}.agent.md` | Agent picker or subagent | Specialized agent with restricted tools |
| **Enforcement** | `.github/hooks/*.json` | Agent lifecycle events | Deterministic guardrails (block commands, auto-lint) |
| **Safety net** | `.github/workflows/ci.yml` | Push / PR | Lint, type-check, test, build |

## Key Rules (from AGENTS.md)

- **Docs in sync**: Every code change updates `docs/`
- **Code comments mandatory**: Every function and export explains why
- **Test before done**: Lint, build, test, manual smoke — all must pass
- **Don't repeat yourself**: Extract shared logic, no duplicated code
- **Pre-read AGENTS.md**: The `.github/instructions/always-read-agents.instructions.md` forces a re-read before every code change

## Manual Bootstrap (optional)

If you can't use hooks, or want to bootstrap once:

```bash
git clone --depth 1 https://github.com/brajam/gh-llm-bootstrap.git
./gh-llm-bootstrap/.github/scripts/bootstrap.sh --framework python /path/to/your-project
```

Or for non-interactive CI use:

```bash
./.github/scripts/bootstrap.sh --auto --framework nextjs /path/to/your-project
```

## Further Reading

- **[USAGE.md](./USAGE.md)** — How to add your own rules, create custom prompts, and maintain the system (decision tree, step-by-step guides)
- **[docs/](./docs/)** — Project documentation database built by the AI as it works
- **[AGENTS.md](./AGENTS.md)** — Core conventions (read first)
