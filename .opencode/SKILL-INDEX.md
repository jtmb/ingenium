# Skill Index — Phase 3 Taxonomy (8 Active Canonical Skills)

> **Migration**: 36 legacy skills were consolidated into the Phase 3 taxonomy on 2026-07-16; 8 canonical skills remain active and two historical targets were later retired.
> See `.opencode/skills/consolidation-map.json` for full source→target mappings and SHA-256 hashes.
> Surviving source content lives under `references/sources/<legacy-name>/`. Retired targets remain historical map entries, not active loading instructions.
> This index describes checked-in repository paths; it does not prove a running session loaded a profile or that a retired target is absent at runtime.
> The extension-provided `ponytail` skill is separately vendored under `packages/ingenium-extension/ponytail/` and is outside this eight-skill repository taxonomy.

## Active Skills (8)

| # | Skill | Absorbed Sources | Description |
|---|-------|-----------------|-------------|
| 1 | `development-conventions` | 5 | README creation, API design, Next.js 16 App Router, Python conventions, UI conventions |
| 2 | `devops-conventions` | 4 | CLI toolkit, Docker, Kubernetes, shell scripts, git hygiene, GitHub CLI |
| 3 | `database-conventions` | 3 | SQL/PostgreSQL, SQLite WAL safety, migration management, FTS5 integrity |
| 4 | `mcp-tooling` | 2 | Playwright browser automation, Docs RAG persistence, email tools, MCP integration |
| 5 | `security-audit` | 1 | Surface scan, git-history leak scan, credential rotation, remediation |
| 6 | `documentation` | 3 | Docs workspace, architecture conventions, audit workflow |
| 7 | `self-learning` | 0 | Observation pipeline, personality traits, synthesis |
| 8 | `skill-maintenance` | 1 | Skill lifecycle: detection, creation, indexing, audit, validation |

## Legacy Source Provenance (28 historical source mappings; 8 active canonical skills)

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

### Retired historical target

The two former workflow/model targets and their historical provenance are
retired from the checked-in active canonical set. Their immutable records
remain in the consolidation map. Agent behavior now lives in each respective
`.opencode/agents/**` profile,
not another skill.

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

## Tombstone Cleanup Contract

- Full repository sync runs lineage-proven cleanup before the skill scan and MCP
  projection; docs-only sync does not.
- A removable legacy directory must be a contained, non-symlink, marker-only
  directory whose exact marker, canonical target, and source-index path agree
  with the valid consolidation map. Apply revalidates before unlinking the marker
  and removing the empty directory; every unproven candidate fails closed.
- The worktree currently has zero `MIGRATED-TO.md` markers and zero root-level
  legacy skill directories named by the mappings. The consolidation map retains
  28 historical mappings; 19 source indexes survive under active skills. Cleanup
  requires an active target and never treats a retired target as a loading grant.
