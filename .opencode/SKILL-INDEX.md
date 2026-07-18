# Skill Index — Phase 3 Taxonomy (10 Canonical Skills)

> **Migration**: 36 legacy skills consolidated into 10 canonical skills on 2026-07-16.
> See `.opencode/skills/consolidation-map.json` for full source→target mappings and SHA-256 hashes.
> Legacy content preserved under `references/sources/<legacy-name>/` in each canonical skill.

## Active Skills (10)

| # | Skill | Absorbed Sources | Description |
|---|-------|-----------------|-------------|
| 1 | `development-conventions` | 5 | README creation, API design, Next.js 16 App Router, Python conventions, UI conventions |
| 2 | `devops-conventions` | 4 | CLI toolkit, Docker, Kubernetes, shell scripts, git hygiene, GitHub CLI |
| 3 | `database-conventions` | 3 | SQL/PostgreSQL, SQLite WAL safety, migration management, FTS5 integrity |
| 4 | `engineering-workflow` | 9 | Agent execution quality, debugging, agent configuration, orchestrator, logging, supervision |
| 5 | `mcp-tooling` | 2 | Playwright browser automation, Docs RAG persistence, email tools, MCP integration |
| 6 | `local-models` | 0 | Local model profiles, command safety, cross-model strategy |
| 7 | `security-audit` | 1 | Surface scan, git-history leak scan, credential rotation, remediation |
| 8 | `documentation` | 3 | Docs workspace, architecture conventions, audit workflow |
| 9 | `self-learning` | 0 | Observation pipeline, personality traits, synthesis |
| 10 | `skill-maintenance` | 1 | Skill lifecycle: detection, creation, indexing, audit, validation |

## Legacy Source Provenance (28 absorbed → 10 canonical)

### Absorbed into `development-conventions` (5)
- `api-aggregation-patterns` → `references/sources/api-aggregation-patterns/`
- `ingenium-ops` → `references/sources/ingenium-ops/`
- `language-conventions` → `references/sources/language-conventions/`
- `mail-app-ui-conventions` → `references/sources/mail-app-ui-conventions/`
- `visual-standards-conventions` → `references/sources/visual-standards-conventions/`

### Absorbed into `devops-conventions` (4)
- `git-history-hygiene` → `references/sources/git-history-hygiene/`
- `github-cli` → `references/sources/github-cli/`
- `onboard-existing-repo` → `references/sources/onboard-existing-repo/`
- `parallel-session-hygiene` → `references/sources/parallel-session-hygiene/`

### Absorbed into `database-conventions` (3)
- `database-migration-management` → `references/sources/database-migration-management/`
- `sqlite-migration-patterns` → `references/sources/sqlite-migration-patterns/`
- `sqlite-wal-safety` → `references/sources/sqlite-wal-safety/`

### Absorbed into `engineering-workflow` (9)
- `agent-execution-quality` → `references/sources/agent-execution-quality/`
- `agent-workflow-patterns` → `references/sources/agent-workflow-patterns/`
- `debugging-patterns` → `references/sources/debugging-patterns/`
- `configuring-opencode` → `references/sources/configuring-opencode/`
- `logging-visibility` → `references/sources/logging-visibility/`
- `orchestrator-primer` → `references/sources/orchestrator-primer/`
- `per-project-scoping` → `references/sources/per-project-scoping/`
- `supervision-logging` → `references/sources/supervision-logging/`
- `uncensored-direct-response` → `references/sources/uncensored-direct-response/`

### Absorbed into `mcp-tooling` (2)
- `browsing-the-web` → `references/sources/browsing-the-web/`
- `dashboard-screenshots` → `references/sources/dashboard-screenshots/`

### Absorbed into `security-audit` (1)
- `security-audit-workflow` → `references/sources/security-audit-workflow/`

### Absorbed into `documentation` (3)
- `docs-workspace` → `references/sources/docs-workspace/`
- `documentation-architecture` → `references/sources/documentation-architecture/`
- `documentation-audit-workflow` → `references/sources/documentation-audit-workflow/`

### Absorbed into `skill-maintenance` (1)
- `local-persistence` → `references/sources/local-persistence/`

## Migration Artifacts
- **Consolidation map**: `.opencode/skills/consolidation-map.json`
- **Pre-migration snapshot**: commit `4639e38`
- **Rollback evidence**: `/tmp/opencode/gh-llm-bootstrap-phase0-20260716/`
