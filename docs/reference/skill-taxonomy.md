---
title: Skill Taxonomy Migration
description: Current 8 active canonical skills with retired-target provenance and exact source mapping.
---

# Skill Taxonomy Migration — Phase 3 (2026-07-16)

## Migration Summary

The Phase 3 taxonomy map records 10 historical target names; the current
worktree exposes **8 active canonical skills**, and two former targets are
retired from the checked-in active canonical set. Legacy material was either
absorbed into an active canonical skill or retained as retired historical
provenance.

The active/retired labels below describe checked-in taxonomy and source-path
state only; they do not establish loaded-profile or runtime-retirement proof.
The extension-provided Ponytail skill is outside this repository canonical set
and is not part of the consolidation map.

### 8 Active Canonical Skills

| # | Canonical Skill | Absorbed Sources | Role |
|---|----------------|------------------|------|
| 1 | `development-conventions` | 5 (api-aggregation-patterns, ingenium-ops, language-conventions, mail-app-ui-conventions, visual-standards-conventions) | Code conventions, API design, testing, refactoring |
| 2 | `devops-conventions` | 4 (git-history-hygiene, github-cli, onboard-existing-repo, parallel-session-hygiene) | Docker, Kubernetes, git, CLI toolkit |
| 3 | `database-conventions` | 3 (database-migration-management, sqlite-migration-patterns, sqlite-wal-safety) | SQLite WAL, FTS5, migration management |
| 4 | `mcp-tooling` | 2 (browsing-the-web, dashboard-screenshots) | MCP integration, browser automation, Docs RAG |
| 5 | `security-audit` | 1 (security-audit-workflow) | Surface scan, git-history leak scan, remediation |
| 6 | `documentation` | 3 (docs-workspace, documentation-architecture, documentation-audit-workflow) | Docs workspace, architecture conventions, audit |
| 7 | `self-learning` | 0 | Observation pipeline, personality traits, synthesis |
| 8 | `skill-maintenance` | 1 (local-persistence) | Skill lifecycle: detection, creation, indexing, audit |

### Active Mapping (Legacy → Canonical)

Retired target mappings remain immutable history in
`.opencode/skills/consolidation-map.json`; they are not active canonical skills.

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
- Its authoritative mapping, full SHA-256 source hash, and canonical source path
  in `.opencode/skills/consolidation-map.json`
- A **pre-migration snapshot** at commit `4639e38` for rollback

## Legacy Tombstone Cleanup

The worktree no longer retains the 28 root-level legacy skill directories named
by the mappings or any `MIGRATED-TO.md` markers. Full repository sync (`scope: "all"`) runs
`cleanupLegacySkillTombstones()` before the skill scan and before the authenticated
MCP projection. Docs-only sync does not run this cleanup.

Cleanup is intentionally narrow and fail-closed. A directory is removable only
when all of these are true:

- its name has one unique entry in the valid consolidation map, whose canonical
  skill set exactly matches the 8 active names above and whose source hash is 64-digit
  lowercase hexadecimal;
- the candidate is a contained, regular directory rather than a symlink;
- its only child is a regular `MIGRATED-TO.md` whose canonical target and
  source-index link exactly match the mapping;
- the target canonical `SKILL.md` exists, and the mapped source path is the exact
  canonical `references/sources/<legacy-name>/source-index.md` regular file.

Dry-run reports removable and rejected candidates without mutation. Apply mode
revalidates immediately before deletion, unlinks only `MIGRATED-TO.md`, and then
removes the now-empty legacy directory. Malformed, unmapped, nonempty, symlinked,
traversal-mapped, or otherwise unproven candidates remain untouched with a
bounded rejection reason. The consolidation map, canonical skills, and preserved
source indexes are never cleanup targets.

## Agent Allowlist Mapping

The `@` prefix is required for a skill mention in Required Skills prose, but it
is not part of a `permission.skill` key. Current user-facing agents use the
universal policy below; the mapping is retained for narrow-policy migrations
from legacy names.

```yaml
permission:
  skill:
    "*": allow
```

If a deliberately narrow policy is needed, put the wildcard first and use the
actual canonical directory names for later exceptions. Never put `@`-prefixed
mentions in this block or put the wildcard last:

```yaml
permission:
  skill:
    "*": deny
    "development-conventions": allow
    "documentation": allow
```

The hidden `ingenium-llm-broker` is the exception and remains wildcard-denied
with no tool allowances:

```yaml
permission:
  skill:
    "*": deny
```

Use this exact legacy-to-canonical mapping when a narrow `permission.skill`
block is being migrated:

| Legacy mention | Replacement mention | `permission.skill` key |
|---------------|--------------------|----------------------|
| `@github-cli` | `@devops-conventions` | `devops-conventions` |
| `@git-history-hygiene` | `@devops-conventions` | `devops-conventions` |
| `@browsing-the-web` | `@mcp-tooling` | `mcp-tooling` |
| `@docs-workspace` | `@documentation` | `documentation` |
| `@local-persistence` | `@skill-maintenance` | `skill-maintenance` |
| `@sqlite-wal-safety` | `@database-conventions` | `database-conventions` |

---

*See also: `.opencode/SKILL-INDEX.md` and [Skill System](../concepts/skill-system.md).*
