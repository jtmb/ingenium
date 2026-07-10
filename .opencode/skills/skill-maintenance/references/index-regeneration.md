---
title: "SKILL-INDEX.md Regeneration — When and How to Rebuild the Index"
impact: HIGH
impactDescription: "Prevents stale skill index entries that break cross-references and discovery"
tags: [index, regeneration, sk-index, skills]
---

## SKILL-INDEX.md Regeneration

### When to Auto-Regenerate

Regenerate SKILL-INDEX.md after any change to the skill system. Do not wait for the user to ask.

- After creating a new skill — regenerate to include it
- After deleting or retiring a skill — regenerate to remove stale entries
- After renaming a skill — regenerate to update the index
- When SKILL-INDEX.md is missing or stale

### Procedure

#### Step 1 — Scan Skills Directory

```bash
ls -d .opencode/skills/*/ | sed 's|.*/||;s|/||' | sort
```

This is the source of truth for which skills exist.

#### Step 2 — Read Each SKILL.md Frontmatter

For each skill directory, read `name:` and `description:`:

```bash
head -5 .opencode/skills/{name}/SKILL.md | grep -E '^name:|^description:'
```

Categories for indexing:
| Category | Pattern |
|----------|---------|
| **Framework Conventions** | `*-conventions` for devops, development, nextjs, python |
| **Domain Skills** | Everything else: debugging, error-interpretation, cli-toolkit |
| **Meta Skills** | `skill-maintenance` itself |

#### Step 3 — Regenerate SKILL-INDEX.md

Write the full `SKILL-INDEX.md` to `.opencode/` with:
1. Header with title, description, auto-maintained note, and total count
2. Per-category tables with paths and descriptions
3. Numbered directory listing with links to each SKILL.md

#### Step 4 — Update the Total Count

Count equals number of skill directories. Update the header.

### Verification

- SKILL-INDEX.md exists at `.opencode/SKILL-INDEX.md`
- Count matches `ls -d .opencode/skills/*/ | wc -l`
- Every skill directory appears exactly once in the index
- Links use relative paths from repo root
- No stale entries for deleted skills
- No duplicate entries
