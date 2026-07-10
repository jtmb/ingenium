---
name: skill-maintenance
description: "Create, update, retire, index, and audit skills as projects evolve. Detects patterns (new frameworks, repeated conventions, missing coverage) and creates new skills autonomously. Regenerates SKILL-INDEX.md and cross-references against all docs. Use when the codebase has grown new patterns, added dependencies, or when conventions have drifted. Replaces former update-skills, update-skill-index, audit-skills, and create-skills skills."
---

# Skill Maintenance — Lifecycle Management (Detection, Creation, Indexing & Audit)

> This skill covers the full skill lifecycle: detect gaps → create new skill → update existing → retire stale → regenerate index → audit system. It uses a split-skill architecture with references below.

## When to Use

- A pattern or convention has been repeated across files without a skill
- A new framework, library, or tool has been added to the project
- An existing skill's instructions are outdated or reference wrong paths/versions
- After creating or deleting a skill — regenerate SKILL-INDEX.md and audit docs
- When SKILL-INDEX.md is stale, missing entries, or counts don't match directories
- When README.md skill counts don't match the number of skill directories
- When invoked directly via `/skill-maintenance`

## 🔴 HARD RULEs

### 🔴 Name Must Match Directory Name

The frontmatter `name` field MUST exactly match the directory name containing SKILL.md. If they differ, OpenCode will not find the skill.

### 🔴 No Nested Category Folders

OpenCode searches `skills/*/SKILL.md` — a single-level glob. Every skill directory must be a direct child of `skills/`. Forbidden: `skills/domain/database/SKILL.md`.

### 🔴 SKILL.md Must Be ALL CAPS

The filename must be `SKILL.md` — all uppercase, no lowercase. OpenCode's file discovery is case-sensitive.

### 🔴 Frontmatter: Required Fields

Every SKILL.md must have `name` (lowercase + hyphens) and `description` (1-1024 chars, includes trigger keywords). No custom frontmatter fields beyond the 5 allowed.

### 🔴 Keep Under 500 Lines (Index) — Use Split-Skill for Larger Content

SKILL.md MUST stay under 500 lines. For larger content, use split-skill: move details to `references/*.md` files. The 500-line limit applies to the index SKILL.md, not the total across all reference files.

### 🔴 Sync Agents When Skills Change

When you restructure a skill, search all agent files for references: `grep -r "<skill-name>" .opencode/agents/`. Update any broken file paths, section names, or structural assumptions.

### 🔴 Commit BEFORE Making Changes

Before making any skill system changes, commit the current state:
```bash
git add -A
git commit -m "skill-maintenance: snapshot before fixes"
BEFORE=$(git rev-parse --short HEAD)
# make changes...
git add -A
git commit -m "skill-maintenance: {summary of what changed}"
AFTER=$(git rev-parse --short HEAD)
```

### 🔴 Log Every Change to learnings.md

Every change MUST be logged with Before and After hashes. Also log via MCP tools when available (`ingenium_observe`).

## Reference Files

| File | Content |
|------|---------|
| [`references/detection.md`](references/detection.md) | 6 signals: new frameworks, repeated conventions, missing coverage, deprecated content, unlogged changes, docs drift |
| [`references/creation.md`](references/creation.md) | Skill creation: scope, naming, directory structure (monolithic vs split), frontmatter, content structure, templates |
| [`references/lifecycle.md`](references/lifecycle.md) | Updating existing skills, retiring stale skills, registration in catalog/index |
| [`references/index-regeneration.md`](references/index-regeneration.md) | When to regenerate SKILL-INDEX.md, procedure, verification |
| [`references/audit.md`](references/audit.md) | Full system audit: 9 checks across all integration points, auto-fix table, quick audit command |
| [`references/validation-checklist.md`](references/validation-checklist.md) | Frontmatter, file structure, naming, content, registration, agent sync, permission, testing |

## Cross-References

- **`development-conventions`** — Python/Next.js/API/README conventions for skills targeting those domains
- **`devops-conventions`** — Docker/K8s/CLI conventions for skills targeting those domains
- **`local-models`** — Command safety rules for running skill validation tests
