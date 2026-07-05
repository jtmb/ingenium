# AGENTS.md — Skill System Protocol

This project supports **both OpenCode and GitHub Copilot**. Configuration is platform-specific.

| Platform | Config File | Hooks/Plugins | MCP Servers | Custom Agents |
|----------|------------|---------------|-------------|---------------|
| **OpenCode** | `opencode.json` | `.opencode/plugins/*.ts` | `opencode.json` → `mcp` section | `.opencode/agents/*.md` |
| **GitHub Copilot** | `.github/` | `.github/hooks/*.json` | `.vscode/mcp.json` | SDK-based (programmatic) |

**Common foundation** (auto-discovered by both platforms):
- `.agents/skills/<name>/SKILL.md` — ALL skills: conventions, procedural guides, and tool references
- `AGENTS.md` — this file, read by both as project rules

**MCP Servers available:**
- **Thread** — persistent memory across sessions. Managed by the `thread-auto-context` instruction skill.
- **GitHub** — GitHub API access (remote, OAuth). Managed via GitHub skills (`gh-cli`, `github-issues`).

> 🔴 **Security**: Never commit `THREAD_API_TOKEN` to source.

---

## 🔴 MANDATORY — Load Skills Before Acting

**Before writing code, running a command, or responding to any request, you MUST check which skills apply.** Skills contain 🔴 HARD RULEs that override everything else.

## 🔴 Session Startup Checklist

Before responding to the user's first request:
1. **Match skills to request** — Check the skill catalog against the user's request and files you might edit
2. **Load every matching skill** — Read the full `SKILL.md` from `.agents/skills/<name>/`
3. **Note the 🔴 HARD RULEs** — These take priority over everything else
4. **Invoke `/repo-context`** for project identity and `/help` for the full catalog

## 🔴 Before Every Action — Pre-Flight Check

| You're about to... | Check this skill |
|-------------------|-----------------|
| Edit a source file | Framework skill for that file type (`.py` → `python-conventions`, `.go` → `go-conventions`, `.rs` → `rust-conventions`, `.tsx` → `nextjs-conventions`, `.ts` outside Next → `typescript-standalone`) |
| Run a terminal command | `local-model-commands` — **never use `&`, never infinite-wait** |
| Create a new file/service | `project-structure` — layering, naming, boundaries |
| Write/run tests | `useful-tests` — lifecycle, assertions, CI readiness |
| Edit Docker/K8s | `containers` / `kubernetes` |
| Edit shell scripts | `shell-scripts` — `set -euo pipefail`, quoting |
| Edit SQL/migrations | `sql-database` — parameterized queries, indexing |

## 🔴 Mandatory Skills — Load Before ANY Action

| Skill | Why mandatory |
|-------|--------------|
| `generic-conventions` | Comments, docs sync, DRY, security, error handling, git |
| `model-profiles` | Know your model's capabilities, context limits — adapt accordingly |
| `local-model-commands` | **ALL terminal commands** — never `&`, never infinite-wait |
| `debugging-patterns` | Systematic debugging — isolation, bisection, log-driven |
| `useful-tests` | Test lifecycle, assertions, CI readiness |
| `project-structure` | Layering, naming, boundaries |
| `error-interpretation` | Map error signatures to root cause |
| `self-correction-patterns` | Backtracking triggers, verification loops |
| `skill-load` | **Session init** — `/skill-load` injects bootstrap payload |
| `api-design` | REST status codes, error shapes, versioning, auth |
| `shell-scripts` | `set -euo pipefail`, double-quote all vars, `trap cleanup EXIT` |
| `sql-database` | Parameterized queries, reversible migrations, indexing |
| `typescript-standalone` | Strict tsconfig, type safety, error handling |
| `agent-pipelines` | AI agent orchestration, state checkpoints, crash recovery |
| `gitignore` | Ignore file patterns, structure, rules |
| `postgresql-optimization` | JSONB, array types, full-text search |
| `code-review-checklist` | Security, correctness, performance, readability |
| `refactoring-recipes` | Extract method, invert conditional, before/after patterns |
| `cli-toolkit` | jq, curl, sed, awk, find, xargs, grep |
| `regex-reference` | Common patterns, catastrophic backtracking prevention |
| `git-workflows` | Rebase vs merge, bisect, reflog recovery, conventional commits |
| `web-design-reviewer` | UI/UX inspection, responsive design, accessibility |
| `chrome-devtools` | Browser screenshots, performance profiling |
| `github-issues` | Create, update, manage issues |
| `playwright-mcp` | Browser automation |

---

## External File Loading — Lazy-Load Pattern

When you encounter a `@` file reference below, use your **Read tool** to load it on a **need-to-know basis**. Do NOT preemptively load all references.

### Skill Catalog

For the full skill catalog with detailed descriptions, invocation patterns, commands, and framework/domain/task skill tables:
@.agents/SKILL-CATALOG.md

### Skill System Instructions

All skills are loaded via `opencode.json` → `instructions`:
- `.agents/skills/*/SKILL.md` — ALL skills: conventions, task skills, tools

These are loaded automatically by OpenCode. Copilot uses `.github/hooks/*.json`.

### Custom Agents

Custom agents are defined in `.opencode/agents/*.md` and auto-discovered by OpenCode:

| Agent | Type | Model | Purpose |
|-------|------|-------|---------|
| `ingenium-planner` | Primary | DeepSeek V4 Pro | Mastermind — analyzes codebase, delegates research to subagents, produces execution plans. Read-only. |
| `ingenium-orchestrator` | Primary | DeepSeek V4 Flash | Executor — takes plans and drives them to completion. Launches subagents, writes code, runs commands. Full R/W. |
| `ingenium-explore` | Subagent | DeepSeek V4 Flash | Fast read-only codebase exploration — grep, glob, find. Max reasoning effort. Invoke via `@ingenium-explore`. |
| `ingenium-explore-zen` | Subagent | qwopus 3.5 9B Coder | Fast read-only codebase exploration via local LM Studio. Invoke via `@ingenium-explore-zen`. |
| `ingenium-scout` | Subagent | qwopus 3.5 9B Coder | Thread/RAG persistent memory — searches past context, saves decisions. Invoke via `@ingenium-scout`. |
| `ingenium-review` | Subagent | DeepSeek V4 Flash (Zen) | Code review + test authoring. Writes tests with `useful-tests` skill. Invoke via `@ingenium-review`. |
| `ingenium-docs` | Subagent | DeepSeek V4 Flash (Zen) | Documentation + skill management — README, API docs, ADRs, skill updates. Invoke via `@ingenium-docs`. |
| `security-auditor` | Subagent | *(default)* | Security audit — vulnerabilities, insecure patterns, compliance. Invoke via `@security-auditor`. |

---

## Self-Improvement — Grow the System

- **New patterns?** → `/update-skills` detects gaps and creates skills
- **Changed skills?** → `/audit-skills` keeps docs consistent
- **Added/removed skills?** → `/update-skill-index` regenerates the index
- **All changes** → Log to `.agents/skills/learnings.md`

**Hook-driven reminders:**
- **OpenCode**: `.opencode/plugins/*.ts` fires `session.created`, `tool.execute.before`, `tool.execute.after`
- **Copilot**: `.github/hooks/*.json` fires `sessionStart`, `preToolUse`, `postToolUse`
- **SessionStart**: Loads the abbreviated checklist — match skills, load them, note HARD RULEs
- **PostToolUse**: Every ~10 tool calls, reminds you to log new patterns to learnings.md

---

## Repository Structure

```
.
├── AGENTS.md                    # Project rules (OpenCode + Copilot)
├── opencode.json                # OpenCode configuration
├── .opencode/
│   ├── agents/*.md              # OpenCode custom agent definitions
│   └── plugins/*.ts             # OpenCode hook plugins
├── .github/hooks/*.json         # GitHub Copilot hooks
├── .vscode/mcp.json             # VS Code MCP servers
├── .agents/
│   ├── SKILL-CATALOG.md         # Full skill catalog (lazy-loaded)
│   ├── skills/                  # All 45 skills (conventions, tasks, tools)
│   └── hooks/                   # Legacy ingenium hooks
└── deploy/                      # Bootstrap payload (mirrors above)
```
