---
title: Skill Taxonomy Migration
description: Phase 3 consolidation mapping — 36 legacy skills to 10 canonical skills with exact mapping and provenance.
---

# Skill Taxonomy Migration — Phase 3 (2026-07-16)

## Migration Summary

The Phase 3 taxonomy consolidation reduced **36 legacy skills → 10 canonical skills** on 2026-07-16. Every legacy skill was either:
- **Archived** (28 legacy skills): marked `archived_at` in DB, SKILL.md removed from discovery path, content preserved under `references/sources/<legacy-name>/` in the absorbing canonical skill.
- **Kept as canonical** (8 pre-existing canonical skills + 2 promoted): remained active with their original names.

### 10 Canonical Skills

| # | Canonical Skill | Absorbed Sources | Role |
|---|----------------|------------------|------|
| 1 | `development-conventions` | 5 (api-aggregation-patterns, ingenium-ops, language-conventions, mail-app-ui-conventions, visual-standards-conventions) | Code conventions, API design, testing, refactoring |
| 2 | `devops-conventions` | 4 (git-history-hygiene, github-cli, onboard-existing-repo, parallel-session-hygiene) | Docker, Kubernetes, git, CLI toolkit |
| 3 | `database-conventions` | 3 (database-migration-management, sqlite-migration-patterns, sqlite-wal-safety) | SQLite WAL, FTS5, migration management |
| 4 | `engineering-workflow` | 9 (agent-execution-quality, agent-workflow-patterns, debugging-patterns, configuring-opencode, logging-visibility, orchestrator-primer, per-project-scoping, supervision-logging, uncensored-direct-response) | Agent pipeline, debugging, orchestrator, logging |
| 5 | `mcp-tooling` | 2 (browsing-the-web, dashboard-screenshots) | MCP integration, browser automation, Thread |
| 6 | `local-models` | 0 | Local model profiles, command safety |
| 7 | `security-audit` | 1 (security-audit-workflow) | Surface scan, git-history leak scan, remediation |
| 8 | `documentation` | 3 (docs-workspace, documentation-architecture, documentation-audit-workflow) | Docs workspace, architecture conventions, audit |
| 9 | `self-learning` | 0 | Observation pipeline, personality traits, synthesis |
| 10 | `skill-maintenance` | 1 (local-persistence) | Skill lifecycle: detection, creation, indexing, audit |

### Exact Mapping (Legacy → Canonical)

| Legacy Name | Absorbed Into | Source Hash |
|-------------|---------------|-------------|
| `api-aggregation-patterns` | `development-conventions` | `073dbe32` |
| `ingenium-ops` | `development-conventions` | `d823cd8a` |
| `language-conventions` | `development-conventions` | `5f9b2f57` |
| `mail-app-ui-conventions` | `development-conventions` | `7ec2c37b` |
| `visual-standards-conventions` | `development-conventions` | `07f8fd6d` |
| `git-history-hygiene` | `devops-conventions` | `da76b6e9` |
| `github-cli` | `devops-conventions` | `a1088956` |
| `onboard-existing-repo` | `devops-conventions` | `605cb5b3` |
| `parallel-session-hygiene` | `devops-conventions` | `4378dfba` |
| `database-migration-management` | `database-conventions` | `5723aca4` |
| `sqlite-migration-patterns` | `database-conventions` | `f19da459` |
| `sqlite-wal-safety` | `database-conventions` | `a47860fc` |
| `agent-execution-quality` | `engineering-workflow` | `344c4ee7` |
| `agent-workflow-patterns` | `engineering-workflow` | `5596f91a` |
| `debugging-patterns` | `engineering-workflow` | `c4ad7dd0` |
| `configuring-opencode` | `engineering-workflow` | `abd783b9` |
| `logging-visibility` | `engineering-workflow` | `c9a0e89a` |
| `orchestrator-primer` | `engineering-workflow` | `b34580d7` |
| `per-project-scoping` | `engineering-workflow` | `ea103d5e` |
| `supervision-logging` | `engineering-workflow` | `b50abce3` |
| `uncensored-direct-response` | `engineering-workflow` | `0a7c6f34` |
| `browsing-the-web` | `mcp-tooling` | `eebd628a` |
| `dashboard-screenshots` | `mcp-tooling` | `1a477933` |
| `security-audit-workflow` | `security-audit` | `9904557b` |
| `docs-workspace` | `documentation` | `92453911` |
| `documentation-architecture` | `documentation` | `954f83a9` |
| `documentation-audit-workflow` | `documentation` | `eb6234c3` |
| `local-persistence` | `skill-maintenance` | `6ad981cd` |

## Provenance & Archives

Every absorbed legacy source retains:
- A **`source-index.md`** at `.opencode/skills/<canonical>/references/sources/<legacy-name>/source-index.md`
- A **lineage record** in `skill_lineage`
- The **consolidation map** at `.opencode/skills/consolidation-map.json`
- A **pre-migration snapshot** at commit `4639e38` for rollback

## Agent Allowlist Mapping

When updating agent `permission.skill` allowlists, use this exact mapping:

| Legacy @ref | Replace With |
|-------------|-------------|
| `@debugging-patterns` | `@engineering-workflow` |
| `@configuring-opencode` | `@engineering-workflow` |
| `@agent-workflow-patterns` | `@engineering-workflow` |
| `@agent-execution-quality` | `@engineering-workflow` |
| `@github-cli` | `@devops-conventions` |
| `@git-history-hygiene` | `@devops-conventions` |
| `@browsing-the-web` | `@mcp-tooling` |
| `@docs-workspace` | `@documentation` |
| `@local-persistence` | `@skill-maintenance` |
| `@sqlite-wal-safety` | `@database-conventions` |

---

*See also: `.opencode/SKILL-INDEX.md`, `concepts/skill-system.md`, `.opencode/skills/consolidation-map.json`*
