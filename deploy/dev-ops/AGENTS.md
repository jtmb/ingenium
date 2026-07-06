# AGENTS.md — Skill System Protocol for Kubernetes Cluster Operations Agent

This is the **deploy target** for the Ingenium skill system in a Kubernetes Cluster Operations AI agent project. The `.agents/skills/` directory contains 43 universal skills (copied from software-dev) plus 4 domain-specific cluster operations skills. All 47 skills are deployed.

## Agent Pipeline

Two primary agents, six subagents. Full architecture: `docs/agents.md`.

| Agent | Type | Model | Access | Purpose |
|-------|------|-------|--------|---------|
| `ingenium-planner` | Primary | DeepSeek V4 Pro | Read-only | Mastermind — analyzes cluster health reports, researches issues, produces remediation plans |
| `ingenium-orchestrator` | Primary | DeepSeek V4 Flash | Full R/W | Executor — runs kubectl/flux/helm, drives remediation, enforces 3-tier safety model |
| `ingenium-explore` | Subagent | V4 Flash | Read-only | Codebase search, manifest discovery, pattern analysis (paid, max reasoning) |
| `ingenium-scout` | Subagent | qwopus (LM Studio) | Read-only | Thread/RAG context — search past remediations, cluster decisions, topology knowledge |
| `ingenium-infrastructure-engineer` | Subagent | V4 Flash (Zen free) | Read-only | Infrastructure design review, remediation plan safety checks, topology constraint analysis |
| `ingenium-qa` | Subagent | V4 Flash (Zen free) | Write tests | Code review + test authoring for operator scripts |
| `ingenium-docs` | Subagent | V4 Flash (Zen free) | Write docs | Documentation + skill updates + remediation reports |
| `ingenium-security-auditor` | Subagent | V4 Flash | Bash + read-only | Security audit & git-history leak scanning for the project itself |

**Workflow**: Tab to planner for cluster health diagnosis & planning → Tab to orchestrator for remediation execution. `@`-mention any subagent directly for ad-hoc tasks.

## Platform Support

| Platform | Config | Custom Agents |
|----------|--------|---------------|
| **OpenCode** | `opencode.json` | `.opencode/agents/*.md` — 8 agents defined |
| **GitHub Copilot** | `.github/` | SDK-based (programmatic) — deprecated, pre-Ingenium format |

> **Note:** `.github/skills/` and `.github/instructions/` are deprecated artifacts from a previous Copilot-based setup. The active skill system is `.agents/skills/`. Do not create or modify files under `.github/skills/`.

**MCP Servers**: Thread (persistent memory, managed by `thread-auto-context` skill)

> 🔴 **Security**: Never commit `THREAD_API_TOKEN` to source. Use `<YOUR_THREAD_API_TOKEN>` placeholder in `opencode.json`.

---

## 🔴 MANDATORY — Load Skills Before Acting

**Before running kubectl, writing a remediation plan, or responding to any request, you MUST load matching skills.** Skills contain 🔴 HARD RULEs that override everything else.

### Session Startup
1. **Match skills** — Check the catalog against the request and files you might edit
2. **Load matching skills** — Read `.agents/skills/<name>/SKILL.md` for each match
3. **Note 🔴 HARD RULEs** — These take priority over everything else
4. **Run `/repo-context`** for project identity

### Pre-Flight Check

| You're about to... | Check this skill |
|-------------------|-----------------|
| Run `kubectl describe`, `kubectl logs`, `kubectl get events` | `kubectl-diagnose` — diagnostic command reference, output parsing |
| Run `kubectl rollout restart`, `kubectl delete pod --force` | `cluster-remediation` — safety tier classification, Tier 1 rules |
| Run `kubectl delete pvc`, `kubectl drain`, `kubectl cordon` | `cluster-remediation` — Tier 2 approval requirements, risk assessment |
| Diagnose pod/node/PVC issues from health report | `cluster-operator` — monitoring workflows, probe patterns |
| Run `flux reconcile`, `flux trace`, `flux get kustomizations` | `cluster-operations` — GitOps safety, discovery-before-assume |
| Run `helm list`, `helm history`, `helm uninstall` | `cluster-operations` — Helm safety, release management |
| Run `jq` filtering on kubectl JSON output | `kubectl-diagnose` — JSON path patterns, field selection |
| Discover cluster state (nodes, namespaces, storageclasses) | `cluster-operations` — discover before assume, runtime context |
| Plan or review a remediation action | `cluster-remediation` — 3-tier safety model, never-allowed list |
| Run a terminal command | `local-model-commands` — **no `&`, no infinite-wait** |
| Write/run tests | `useful-tests` |
| Edit shell scripts | `shell-scripts` — `set -euo pipefail` |

### Mandatory Skills (load before ANY action)

`generic-conventions` `model-profiles` `local-model-commands` `debugging-patterns` `useful-tests` `project-structure` `error-interpretation` `self-correction-patterns` `skill-load` `api-design` `shell-scripts` `sql-database` `typescript-standalone` `agent-pipelines` `gitignore` `postgresql-optimization` `code-review-checklist` `refactoring-recipes` `cli-toolkit` `regex-reference` `git-workflows` `web-design-reviewer` `chrome-devtools` `github-issues` `playwright-mcp` `containers` `kubernetes` `mermaid` `write-docs` `generate-docs` `update-skills` `update-skill-index` `audit-skills`

### Domain Skills (cluster ops-specific, load on context match)

`cluster-operator` `cluster-remediation` `kubectl-diagnose` `cluster-operations`

---

## Lazy-Load Pattern

Use `@.agents/SKILL-CATALOG.md` for the full catalog with invocation patterns and framework/domain/task tables. Load on demand — do not preload.

`opencode.json` loads 3 core skills automatically: `generic-conventions`, `repo-context`, `model-profiles`. All others load via the `skill` tool when matched.

---

## Self-Improvement

| Command | Action |
|---------|--------|
| `/update-skills` | Detects gaps and creates/retires skills (e.g., new operator type not covered) |
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
dev-ops/
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
│   │   └── ingenium-infrastructure-engineer.md
│   └── security/
│       └── ingenium-security-auditor.md
├── .agents/
│   ├── SKILL-CATALOG.md        # Full skill catalog (lazy-loaded)
│   ├── skills/                 # 47 skills — 43 universal + 4 cluster ops domain skills
│   │   ├── generic-conventions/
│   │   ├── cluster-operator/
│   │   ├── cluster-remediation/
│   │   ├── kubectl-diagnose/
│   │   ├── cluster-operations/
│   │   └── learnings.md
│   ├── hooks/                  # 3 lifecycle hooks (session-start, pre-tool-use, post-tool-use)
│   └── scripts/
│       └── hook-bootstrap.sh
├── .opencode/plugins/          # 3 TypeScript plugins
├── .vscode/                    # Editor config (mcp.json, settings.json)
├── docs/                       # Project documentation
│   ├── agents.md               # Agent architecture reference
│   ├── ARCHITECTURE.md         # Project structure and data flow
│   ├── TECH-STACK.md           # Cluster ops tools, dependencies, rationale
│   ├── CONVENTIONS.md          # Naming, safety tiers, operational conventions
│   └── README.md               # Docs index
└── .github/                    # Deprecated — Copilot-era artifact directory
```

---

## 🔴 Deprecated Artifacts

The following directories are from a previous Copilot-based agent setup and are **not active**:

| Path | Status | Replacement |
|------|--------|-------------|
| `.github/skills/` | Deprecated — old Copilot format | `.agents/skills/` is the active skill system |
| `.github/instructions/` | Deprecated — old Copilot format | `.agents/skills/` is the active skill system |
| `.github/prompts/` | Deprecated — old Copilot format | `.agents/skills/` is the active skill system |

Do not create, modify, or rely on files in these directories.