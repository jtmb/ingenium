---
name: update-skill-index
description: "Regenerate SKILL-INDEX.md from all skill SKILL.md files — keeps the root-level skill index in sync with the skill directory. AUTO-INVOKE after any skill addition, removal, or rename. Use when the SKILL-INDEX.md is stale or missing entries."
---

# Update Skill Index

## When to Use

- After creating a new skill — regenerate SKILL-INDEX.md to include it
- After deleting or retiring a skill — regenerate to remove stale entries
- After renaming a skill — regenerate to update the index
- When SKILL-INDEX.md is missing or stale
- When invoked directly via `/update-skill-index`

## Core Principle — Auto-Regenerate

**This skill auto-invokes after any change to the skill system** (`.agents/skills/`, `deploy/.agents/skills/`). When a skill is added, removed, or renamed, regenerate SKILL-INDEX.md immediately. Do not wait for the user to ask.

## Procedure

### Step 1 — Scan Skills Directory

```bash
ls -d .agents/skills/*/ | sed 's|.*/||;s|/||' | sort
```

This is the source of truth for which skills exist.

### Step 2 — Read Each SKILL.md Frontmatter

For each skill directory, read the `name:` and `description:` fields from `SKILL.md`:

```bash
head -5 .agents/skills/{name}/SKILL.md | grep -E '^name:|^description:'
```

Also check for any slash command invocation pattern. Skills with `name:` fields matching specific patterns are categorized:

| Category | Pattern | Where in SKILL-INDEX.md |
|----------|---------|------------------------|
| **Invocable Task Skills** | Skills listed in `help/SKILL.md` under "Invocable Task Skills" table | Top table with `/command` links |
| **Framework Conventions** | `*-conventions` for `go`, `nextjs`, `python`, `rust` | Framework Conventions table |
| **Core** | `generic-conventions` | Core section |
| **Always-Included Domain** | Everything else | Always-Included Domain table |
| **update-skill-index** | Itself | Invocable Task Skills table |

### Step 3 — Regenerate SKILL-INDEX.md

Write the full `SKILL-INDEX.md` to the repo root. The format is:

1. **Header** with title, description, auto-maintained note, and total count
2. **Invocable Task Skills table** — skills with `/command` patterns
3. **Framework Conventions table** — language-specific convention skills
4. **Always-Included Domain Skills table** — cross-cutting skills with descriptions
5. **Core section** — generic-conventions
6. **Quick Command Reference** — per-language build/test/lint commands
7. **Infrastructure commands**
8. **Skill System Maintenance table**
9. **Skill Links table** — numbered directory listing with links to each SKILL.md
10. **Deploy Mirror note**

### Step 4 — Update the Total Count

The header says `**Total skills: {N}**`. Count equals the number of skill directories. Update this number.

### Step 5 — Sync Deploy

If `SKILL-INDEX.md` references new skills in `.agents/skills/`, ensure the deploy mirror at `deploy/.agents/skills/` also has the corresponding `SKILL.md` if applicable.

## Commands

| Command | Description |
|---------|-------------|
| `/update-skill-index` | Regenerate SKILL-INDEX.md from all skill files |

## Verification

- `SKILL-INDEX.md` exists at repo root
- Count matches `ls -d .agents/skills/*/ | wc -l`
- Every skill directory appears exactly once in the index
- Links use relative paths from repo root (e.g., `.agents/skills/{name}/SKILL.md`)
- No stale entries for deleted skills
- No duplicate entries
