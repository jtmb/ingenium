# AGENTS.md — Skill System Protocol for gh-llm-bootstrap

This is the **bootstrap source repo** for the Ingenium skill system. The `deploy/` directory is the payload that gets copied to target projects via `bootstrap.sh`. Skills live in `.agents/skills/` — all 45 are deployed. Edit source files here, then sync to `deploy/`.

## Agent Pipeline (this repo only)

Two primary agents, six subagents. Full architecture: `docs/agents.md`.

| Agent | Type | Model | Access | Purpose |
|-------|------|-------|--------|---------|
| `ingenium-planner` | Primary | DeepSeek V4 Pro | Read-only | Mastermind — researches, plans, delegates to subagents |
| `ingenium-orchestrator` | Primary | DeepSeek V4 Flash | Full R/W | Executor — writes code, runs commands, drives work |
| `ingenium-explore` | Subagent | V4 Flash | Read-only | Codebase search (paid, max reasoning) |
| `ingenium-scout` | Subagent | qwopus (LM Studio) | Read-only | Thread/RAG context — search past decisions |
| `ingenium-qa` | Subagent | V4 Flash (Zen free) | Write tests | Code review + test authoring |
| `ingenium-docs` | Subagent | V4 Flash (Zen free) | Write docs | Documentation + skill updates |
| `security-auditor` | Subagent | V4 Flash | Bash + read-only | Security audit + git-history leak scanning |
| `ingenium-software-engineer` | Subagent | V4 Flash (Zen free) | Read-only | Design review, implementation analysis, technical recommendations |

**Workflow**: Tab to planner for research/planning → Tab to orchestrator for execution. `@`-mention any subagent directly for ad-hoc tasks.

## Platform Support

| Platform | Config | Custom Agents |
|----------|--------|---------------|
| **OpenCode** | `opencode.json` | `.opencode/agents/*.md` — 8 agents defined |
| **GitHub Copilot** | `.github/` | SDK-based (programmatic) |

**MCP Servers**: Thread (persistent memory, managed by `thread-auto-context` skill) | GitHub (remote OAuth, via `gh-cli` / `github-issues`)

> 🔴 **Security**: Never commit `THREAD_API_TOKEN` to source. Use `<YOUR_THREAD_API_TOKEN>` placeholder in `opencode.json`.

---

## 🔴 MANDATORY — Load Skills Before Acting

**Before writing code, running a command, or responding to any request, you MUST load matching skills.** Skills contain 🔴 HARD RULEs that override everything else.

### Session Startup
1. **Match skills** — Check the catalog against the request and files you might edit
2. **Load matching skills** — Read `.agents/skills/<name>/SKILL.md` for each match
3. **Note 🔴 HARD RULEs** — These take priority over everything else
4. **Run `/repo-context`** for project identity

### Pre-Flight Check

| You're about to... | Check this skill |
|-------------------|-----------------|
| Edit a source file | Framework skill (`nextjs`, `python`, `go`, `rust`, `typescript-standalone`) |
| Run a terminal command | `local-model-commands` — **no `&`, no infinite-wait** |
| Create a new file/service | `project-structure` |
| Write/run tests | `useful-tests` |
| Edit Docker/K8s | `containers` / `kubernetes` |
| Edit shell scripts | `shell-scripts` — `set -euo pipefail` |

### Mandatory Skills (load before ANY action)

`generic-conventions` `model-profiles` `local-model-commands` `debugging-patterns` `useful-tests` `project-structure` `error-interpretation` `self-correction-patterns` `skill-load` `api-design` `shell-scripts` `sql-database` `typescript-standalone` `agent-pipelines` `gitignore` `postgresql-optimization` `code-review-checklist` `refactoring-recipes` `cli-toolkit` `regex-reference` `git-workflows` `web-design-reviewer` `chrome-devtools` `github-issues` `playwright-mcp`

---

## Lazy-Load Pattern

Use `@.agents/SKILL-CATALOG.md` for the full catalog with invocation patterns and framework/domain/task tables. Load on demand — do not preload.

`opencode.json` loads 3 core skills automatically: `generic-conventions`, `repo-context`, `model-profiles`. All others load via the `skill` tool when matched.

---

## Self-Improvement

| Command | Action |
|---------|--------|
| `/update-skills` | Detects gaps and creates/retires skills |
| `/audit-skills` | Cross-references skills against README, bootstrap.sh, mermaid |
| `/update-skill-index` | Regenerates `SKILL-INDEX.md` from all skill files |
| All changes | Log to `.agents/skills/learnings.md` with before/after commit hashes |

---

## Testing

```bash
bash tests/test-self-improving.sh        # all 7 tests
bash tests/test-self-improving.sh -v     # verbose output
```

Tests: dependency gap detection, missing coverage, skill count consistency, deploy integrity, frontmatter validity, deploy separation.

---

## Repository Structure

```
.
├── AGENTS.md                   # This file — project rules
├── opencode.json               # OpenCode configuration
├── USAGE.md                    # Skill system handbook
├── .opencode/agents/*.md       # OpenCode custom agent definitions (8 agents)
├── .agents/
│   ├── SKILL-CATALOG.md        # Full skill catalog (lazy-loaded)
│   ├── skills/                 # All 45 skills — domain conventions + instructions + tools
│   │   └── learnings.md        # Changelog with before/after commit hashes
│   └── scripts/                # Bootstrap engine (bootstrap.sh, hook-bootstrap.sh)
├── tests/
│   └── test-self-improving.sh  # Detection pipeline tests
├── docs/                       # Project documentation
│   ├── agents.md               # Agent architecture reference
│   ├── ARCHITECTURE.md         # Project structure and data flow
│   └── ...                     # TECH-STACK.md, CONVENTIONS.md
└── deploy/                     # Bootstrap payload (mirrors source)
    ├── AGENTS.md               # Same file — copied to target projects
    ├── opencode.json           # Deploy version with <PLACEHOLDER> tokens
    └── .agents/skills/         # Deployable skills (no scripts, no tests)
```
