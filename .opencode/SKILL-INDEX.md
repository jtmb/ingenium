# SKILL-INDEX.md — Skill Catalog

This file lists all skills in the Ingenium system. It is auto-generated from `.opencode/skills/*/SKILL.md` files but can be manually updated when adding new skills.

**Total Skills:** 30

| Skill | Category | Description | Always Apply | Tags |
|-------|----------|-------------|-------------|------|
| agent-execution-quality | Agent | Agent execution standards requiring actual testing, one-shot solutions, and no dead code | Yes | agent, execution, quality, testing |
| api-aggregation-patterns | API | Patterns for designing aggregated API endpoints that combine multiple data sources into a single response for dashboard views | Yes | llm-synthesized, auto-generated |
| browsing-the-web | Browser | Drive the user's real Chrome browser via dev-browser to interact with websites — navigate, fill forms, extract data, take screenshots, and handle site-specific patterns | No | browser, dev-browser, automation, web, site-recipes, amazon, youtube |
| configuring-opencode | OpenCode | OpenCode agent configuration conventions — frontmatter structure, tool/skill permission lockdown patterns, @skill-name reference rules | No | opencode, agents, configuration, permissions, conventions |
| dashboard-screenshots | Testing | Playwright-based screenshot workflow for all Ingenium Dashboard UI pages | No | playwright, screenshots, dashboard, testing, ui, visual |
| database-conventions | Database | Database design patterns, SQL conventions, and optimization strategies | No | database, sql, postgresql, conventions |
| database-migration-management | Database | Database migration patterns and safeguards — conditional application, table rebuild, FK handling, WAL safety, anti-corruption guards, and PRAGMA foreign_keys management for SQLite | No | database, migration, wal, sqlite, fk, fts5 |
| debugging-patterns | Debugging | Systematic debugging methodology — isolation, bisection, log-driven analysis, error interpretation, and AI self-correction patterns | No | debugging, error-interpretation, self-correction, bisect, isolation |
| development-conventions | Conventions | Unified development conventions — README creation, API design, Next.js 16 App Router, Python conventions, and useful comments | Yes | development, conventions, readme, api, nextjs, python, comments |
| devops-conventions | DevOps | Unified DevOps conventions — CLI toolkit (jq, curl, sed, awk, find, grep), Docker container authoring and ecosystem management, and Kubernetes manifests | Yes | devops, docker, kubernetes, cli, shell, containers |
| documentation-architecture | Documentation | Patterns for creating and maintaining definitive reference documentation with cross-references | Yes | llm-synthesized, auto-generated |
| documentation-audit-workflow | Documentation | Systematic documentation audit methodology — agent exploration, issue categorization, and systematic fixes for AGENTS.md and related docs | Yes | llm-synthesized, auto-generated |
| git-history-hygiene | Git | Prevent build artifacts and large files from polluting Git history via strict ignore rules and cleanup protocols | Yes | llm-synthesized, auto-generated |
| github-cli | GitHub | GitHub CLI (`gh`) integration — update repo metadata, manage PRs/issues/releases, create gists, search code, and query the API | Yes | github, cli, gh, pr, issues, releases |
| ingenium-ops | Operations | Ingenium system operations and maintenance procedures | No | ingenium, operations, dashboard, seed, maintenance |
| language-conventions | Conventions | Programming language conventions and best practices | No | go, rust, conventions, languages |
| local-models | LLM | Local LLM management — Qwen model profiles, command safety rules (no &, timeout wrappers), local provider API reference (LM Studio, Ollama, vLLM), and cross-model strategy guide | Yes | local-models, llm, inference, qwen, qwen-3.5-9b, deep-seek, lm-studio, terminal |
| local-persistence | Persistence | Ensure skills and observations are persisted to local .opencode/skills/ after every mutation | Yes | local, sync, persistence, hard-rule |
| logging-visibility | Logging | Comprehensive logging standards with dashboard filtering for execution tracking | Yes | logging, dashboard, visibility, tracking |
| mcp-tooling | MCP | MCP tool integration and automation — Playwright browser automation (navigate, screenshot, inspect, interact, console), Thread MCP persistent memory (context save/retrieve, session lifecycle, doc upload), and future MCP tool integrations | No | mcp, playwright, thread, browser, automation, memory, context, dev-browser |
| onboard-existing-repo | Onboarding | Guide for onboarding an existing codebase into the Ingenium skill/plugin/agent ecosystem | No | onboarding, initialization, project-setup |
| orchestrator-primer | Orchestrator | Orchestrator agent patterns and workflow management | No | orchestrator, coordination, agents, priming |
| parallel-session-hygiene | Git | Git workflow for handling overlapping commits from parallel sessions — always verify git log before assuming files need deletion | Yes | llm-synthesized, auto-generated |
| per-project-scoping | Project | Enforce project-specific context for skills and agents rather than applying global defaults | Yes | llm-synthesized, auto-generated |
| security-audit | Security | Security audit methodology — surface scanning for secrets, injection vulnerabilities, supply chain risks, and missing controls; automated git-history leak detection; severity-calibrated reporting with remediation guidance | No | security, audit, vulnerability, secrets, leaks, git-history |
| self-learning | Learning | Self-learning pipeline with observation, synthesis, and personality systems. Replaces old learnings system with automated observation collection and trait-based learning | Yes | self-learning, observations, synthesis, personality, pipeline |
| skill-maintenance | Skill | Create, update, retire, index, and audit skills as projects evolve. Detects patterns and creates new skills autonomously | No | skill, maintenance, creation, audit, index |
| sqlite-migration-patterns | Database | Patterns for safe SQLite database migrations, including handling foreign key constraints after table rename | Yes | llm-synthesized, auto-generated |
| sqlite-wal-safety | Database | SQLite WAL mode transaction safety rules — checkpointAfterWrite must never run inside execTransaction to avoid SQLITE_LOCKED errors | Yes | llm-synthesized, auto-generated |
| uncensored-direct-response | Agent | Deliver raw, unfiltered technical answers without safety filters or excessive politeness | No | (none) |

## Maintenance

This file should be regenerated using `/update-skill-index` command or by running:

```bash
# List all skills in directory
ls -d .opencode/skills/*/ | sed 's|.*/||;s|/||' | sort

# Verify each has a SKILL.md
for skill in $(ls -d .opencode/skills/*/ | sed 's|.*/||;s|/||'); do
  if [ ! -f ".opencode/skills/$skill/SKILL.md" ]; then
    echo "Missing: $skill"
  fi
done
```

## Adding New Skills

When adding a new skill:

1. Create directory `.opencode/skills/<name>/`
2. Write `SKILL.md` with YAML frontmatter (name, description)
3. Add entry to this file in the table above
4. Run `/update-skill-index` to regenerate

## Reference Files

Skills may include reference files under `references/`. Notable references:

| Skill | Reference | Description |
|-------|-----------|-------------|
| `local-models` | `references/deep-seek.md` | DeepSeek V4 reasoning failure patterns — orchestrator safety protocol |

## Related Documentation

- [docs/HOW-TO/skills.md](./HOW-TO/skills.md) — Skill system usage guide
- [AGENTS.md](./AGENTS.md) — Agent protocol and mandatory skills
- [docs/CONVENTIONS.md](./CONVENTIONS.md) — Development conventions
