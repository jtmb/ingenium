# AGENTS.md — Skill System Protocol for Security Penetration Testing Agent

This is the **deploy target** for the Ingenium skill system in a Security Penetration Testing AI agent project. The `.agents/skills/` directory contains 43 universal skills (copied from software-dev) plus 10 domain-specific penetration testing skills. All 53 skills are deployed.

## Agent Pipeline

Two primary agents, six subagents. Full architecture: `docs/agents.md`.

| Agent | Type | Model | Access | Purpose |
|-------|------|-------|--------|---------|
| `ingenium-planner` | Primary | DeepSeek V4 Pro | Read-only | Mastermind — researches targets, plans engagements, delegates reconnaissance |
| `ingenium-orchestrator` | Primary | DeepSeek V4 Flash | Full R/W | Executor — runs security tools, writes PoC scripts, documents findings |
| `ingenium-explore` | Subagent | V4 Flash | Read-only | Codebase search, target discovery, pattern analysis (paid, max reasoning) |
| `ingenium-scout` | Subagent | qwopus (LM Studio) | Read-only | Thread/RAG context — search past engagements, findings, techniques |
| `ingenium-security-engineer` | Subagent | V4 Flash (Zen free) | Read-only | Pentest design review, tool chain suggestions, ethical boundary checks |
| `ingenium-qa` | Subagent | V4 Flash (Zen free) | Write tests | Code review + test authoring for PoC scripts |
| `ingenium-docs` | Subagent | V4 Flash (Zen free) | Write docs | Documentation + skill updates + evidence management |
| `ingenium-security-auditor` | Subagent | V4 Flash | Bash + read-only | Security audit & git-history leak scanning for the project itself |

**Workflow**: Tab to planner for reconnaissance & planning → Tab to orchestrator for execution. `@`-mention any subagent directly for ad-hoc tasks.

## Platform Support

| Platform | Config | Custom Agents |
|----------|--------|---------------|
| **OpenCode** | `opencode.json` | `.opencode/agents/*.md` — 8 agents defined |
| **GitHub Copilot** | `.github/` | SDK-based (programmatic) — deprecated, pre-Ingenium format |

> **Note:** `.github/skills/` and `.venv/` are deprecated artifacts from a previous Copilot-based setup. The active skill system is `.agents/skills/`. Do not create or modify files under `.github/skills/`.

**MCP Servers**: Thread (persistent memory, managed by `thread-auto-context` skill)

> 🔴 **Security**: Never commit `THREAD_API_TOKEN` to source. Use `<YOUR_THREAD_API_TOKEN>` placeholder in `opencode.json`.

---

## 🔴 MANDATORY — Load Skills Before Acting

**Before running a command, writing a PoC, or responding to any request, you MUST load matching skills.** Skills contain 🔴 HARD RULEs that override everything else.

### Session Startup
1. **Match skills** — Check the catalog against the request and files you might edit
2. **Load matching skills** — Read `.agents/skills/<name>/SKILL.md` for each match
3. **Note 🔴 HARD RULEs** — These take priority over everything else
4. **Run `/repo-context`** for project identity

### Pre-Flight Check

| You're about to... | Check this skill |
|-------------------|-----------------|
| Run `nmap`, `masscan`, `dnsrecon` | `network-pentest` — scope validation first |
| Run `sqlmap`, `ffuf`, `gobuster`, `whatweb` | `web-app-scan` — target confirmation, rate limiting |
| Run `hashcat`, `john`, `hydra` | `password-audit` — hash format, wordlist paths, ethical bounds |
| Run `aircrack-ng`, `airodump-ng` | `wireless-audit` — interface mode, regulatory compliance |
| Run `openssl`, `testssl.sh`, `sslscan` | `crypto-audit` — cipher validation |
| Run WordPress scans | `wordpress-pentest` — plugin detection, safe checks |
| Explore or exploit a payload | `exploit-validation` — PoC safety, target confinement |
| Gather OSINT or DNS data | `recon` — passive before active |
| Write findings or generate reports | `report-gen` — evidence format, severity taxonomy |
| Check pentest phase/stage | `pentest-methodology` — phase gating, don't skip |
| Run a terminal command | `local-model-commands` — **no `&`, no infinite-wait** |
| Write/run tests | `useful-tests` |
| Edit shell scripts | `shell-scripts` — `set -euo pipefail` |

### Mandatory Skills (load before ANY action)

`generic-conventions` `model-profiles` `local-model-commands` `debugging-patterns` `useful-tests` `project-structure` `error-interpretation` `self-correction-patterns` `skill-load` `api-design` `shell-scripts` `sql-database` `typescript-standalone` `agent-pipelines` `gitignore` `postgresql-optimization` `code-review-checklist` `refactoring-recipes` `cli-toolkit` `regex-reference` `git-workflows` `web-design-reviewer` `chrome-devtools` `github-issues` `playwright-mcp`

### Domain Skills (pentest-specific, load on context match)

`pentest-methodology` `recon` `network-pentest` `web-app-scan` `exploit-validation` `password-audit` `crypto-audit` `wireless-audit` `wordpress-pentest` `report-gen`

---

## Lazy-Load Pattern

Use `@.agents/SKILL-CATALOG.md` for the full catalog with invocation patterns and framework/domain/task tables. Load on demand — do not preload.

`opencode.json` loads 3 core skills automatically: `generic-conventions`, `repo-context`, `model-profiles`. All others load via the `skill` tool when matched.

---

## Self-Improvement

| Command | Action |
|---------|--------|
| `/update-skills` | Detects gaps and creates/retires skills (e.g., new tool type not covered) |
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
sec-ops/
├── AGENTS.md                   # This file — project rules (Ingenium protocol)
├── opencode.json               # OpenCode configuration
├── USAGE.md                    # Skill system handbook
├── .opencode/agents/*.md       # OpenCode custom agent definitions (8 agents)
│   ├── primary/
│   │   ├── ingenium-planner.md
│   │   └── ingenium-orchestrator.md
│   ├── research/
│   │   ├── ingenium-explore.md
│   │   └── ingenium-scout.md
│   ├── execution/
│   │   ├── ingenium-qa.md
│   │   ├── ingenium-docs.md
│   │   └── ingenium-security-engineer.md
│   └── security/
│       └── ingenium-security-auditor.md
├── .agents/
│   ├── SKILL-CATALOG.md        # Full skill catalog (lazy-loaded)
│   ├── skills/                 # 53 skills — 43 universal + 10 pentest domain skills
│   │   ├── generic-conventions/
│   │   ├── pentest-methodology/
│   │   ├── recon/
│   │   ├── network-pentest/
│   │   ├── web-app-scan/
│   │   ├── exploit-validation/
│   │   ├── password-audit/
│   │   ├── crypto-audit/
│   │   ├── wireless-audit/
│   │   ├── wordpress-pentest/
│   │   ├── report-gen/
│   │   └── learnings.md
│   ├── hooks/                  # 3 lifecycle hooks (session-start, pre-tool-use, post-tool-use)
│   └── scripts/
│       └── hook-bootstrap.sh
├── .opencode/plugins/          # 4 TypeScript plugins
├── .vscode/                    # Editor config (mcp.json, settings.json)
├── docs/                       # Project documentation
│   ├── agents.md               # Agent architecture reference
│   ├── ARCHITECTURE.md         # Project structure and data flow
│   ├── TECH-STACK.md           # Pentesting tools, dependencies, rationale
│   ├── CONVENTIONS.md          # Naming, ethical guidelines, safety boundaries
│   └── README.md               # Docs index
└── .venv/                      # Deprecated — Copilot-era virtual environment
```

---

## 🔴 Deprecated Artifacts

The following directories are from a previous Copilot-based agent setup and are **not active**:

| Path | Status | Replacement |
|------|--------|-------------|
| `.venv/` | Deprecated — do not use | `.agents/skills/` manages all conventions |
| `.github/skills/` | Deprecated — old Copilot format | `.agents/skills/` is the active skill system |
| `.github/instructions/` | Deprecated — old Copilot format | `.agents/skills/` is the active skill system |

Do not create, modify, or rely on files in these directories.