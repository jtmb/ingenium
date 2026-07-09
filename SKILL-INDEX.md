# SKILL-INDEX.md — Ingenium Skill System

Auto-maintained index of all skills. Updated via `/update-skill-index`.

**Total: 17 skills** (canonical sources at `seed/skills/`, written to `.opencode/skills/`)

Skills use a `file_tree` column (TEXT JSON) that stores auxiliary files (reference docs, examples, configs) as a map of relative paths → content. This enables complete data round-trips between DB and disk. See [docs/ARCHITECTURE.md#file_tree-column](docs/ARCHITECTURE.md) for details.

---

## Skill Table

All 17 skills are stored in the Ingenium SQLite database and written to disk in split-skill format (SKILL.md + metadata.json + references/). The canonical editing location is `seed/skills/<name>/`.

| # | Skill | Type | Source |
|---|-------|------|--------|
| 1 | [agent-checkpoints](seed/skills/agent-checkpoints/SKILL.md) | Domain | Agent state checkpoints and crash recovery for multi-phase pipelines |
| 2 | [build-pipelines](seed/skills/build-pipelines/SKILL.md) | Domain | Multi-stage build and CI/CD pipeline conventions |
| 3 | [configuring-opencode](seed/skills/configuring-opencode/SKILL.md) | Domain | OpenCode configuration — MCP servers, plugins, env vars, skill loading |
| 4 | [containerized-agents](seed/skills/containerized-agents/SKILL.md) | Domain | Containerized AI agent deployment patterns |
| 5 | [cost-analyzer](seed/skills/cost-analyzer/SKILL.md) | Domain | DeepSeek/OpenAI API cost analysis from usage CSVs |
| 6 | [database-conventions](seed/skills/database-conventions/SKILL.md) | Domain | SQLite WAL + FTS5, migration patterns, connection pooling |
| 7 | [debugging-patterns](seed/skills/debugging-patterns/SKILL.md) | Domain | Systematic debugging — isolation, bisection, log-driven, stack-trace |
| 8 | [development-conventions](seed/skills/development-conventions/SKILL.md) | Domain | Consolidated conventions: README, API design, Next.js 16, Python, testing, mermaid, gitignore |
| 9 | [devops-conventions](seed/skills/devops-conventions/SKILL.md) | Domain | Shell scripting, Docker, Kubernetes, GitHub CLI conventions |
| 10 | [github-cli](seed/skills/github-cli/SKILL.md) | Domain | GitHub CLI (`gh`) operations — PRs, issues, releases, API queries |
| 11 | [ingenium-ops](seed/skills/ingenium-ops/SKILL.md) | Domain | Ingenium operations — seeding, DB management, migration, dashboard deployment |
| 12 | [language-conventions](seed/skills/language-conventions/SKILL.md) | Domain | Multi-language conventions — Go, Rust, TypeScript, Python |
| 13 | [local-models](seed/skills/local-models/SKILL.md) | Domain | Local LLM management — model profiles, command safety, LM Studio API |
| 14 | [mcp-tooling](seed/skills/mcp-tooling/SKILL.md) | Domain | MCP server tooling — Playwright, Thread, Chrome DevTools |
| 15 | [onboard-existing-repo](seed/skills/onboard-existing-repo/SKILL.md) | Domain | Onboard repos to the Ingenium skill system |
| 16 | [orchestrator-primer](seed/skills/orchestrator-primer/SKILL.md) | Domain | 🔴 MANDATORY — delegation rules, pre-action gate, subagent coordination |
| 17 | [skill-maintenance](seed/skills/skill-maintenance/SKILL.md) | Domain | Skill CRUD, file_tree format, cross-references, index regeneration |

---

## Skill System Maintenance

| Task | Command / Location |
|------|-------------------|
| **Audit consistency** | `/audit-skills` |
| **Update/retire skill** | `/update-skills` |
| **Regenerate skill index** | `/update-skill-index` |
| **Create new skill (DB)** | `ingenium_skill_create` MCP tool (supports `files` param for file_tree) |
| **Sync skill from disk** | `ingenium_skill_sync` MCP tool |
| **List all skills** | `ingenium_skill_list` MCP tool |
| **View changelog** | `ingenium_learning_search` via MCP tool |
| **Run seed** | `./run.sh seed` (idempotent, re-initializes all 17 skills) |
