---
name: audit-skills
description: "Audit the skill system for consistency — cross-reference .agents/skills/ against README.md, AGENTS.md, USAGE.md, bootstrap.sh, and mermaid diagrams. Find orphans, missing entries, stale paths, and frontmatter issues. Auto-applies fixes without asking. Use after adding or removing skills, or when docs look out of date."
---

# Audit Skills

## When to Use

- After creating a new skill — verify it's wired into all docs and config files
- After deleting or retiring a skill — ensure no stale references remain
- When README.md skill counts don't match the number of directories in `.agents/skills/`
- When the mermaid architecture diagram is missing a skill
- Before a release — comprehensive consistency check
- When `update-skills` proposes a new skill — audit first to avoid duplicates

## Core Principle — Auto-Apply, Don't Ask

**The agent audits and fixes without asking permission.** When the audit finds a discrepancy, fix it immediately. Log all changes to `.agents/skills/learnings.md` so the user can review what happened. Never propose — just do it.

---

## What Gets Audited

The audit checks 6 integration points. Every skill should appear in ALL of them (or have a valid reason not to).

| Check | File(s) | What "correct" looks like |
|-------|---------|--------------------------|
| **1. Directory exists** | `.agents/skills/{name}/SKILL.md` | Frontmatter present, `name` matches folder |
| **2. README table** | `README.md` → Always-Included Skills or Task Skills tables | Skill listed with correct emoji, description matches SKILL.md |
| **3. README mermaid** | `README.md` → mermaid graph TD | Node exists with skill name, connected to `D` (decision node) |
| **4. bootstrap.sh** | `.agents/scripts/bootstrap.sh` → FILES array | Entry exists with correct condition (`always`, `optional`, `framework:*`) |
| **5. AGENTS.md index** | `AGENTS.md` → table | (Optional) Cross-reference if skill is a core entry point |
| **6. USAGE.md** | `USAGE.md` → skill listings, directory trees | Skill appears in tree diagrams and reference tables |

---

## Audit Procedure

### Step 1 — Scan Skills Directory

```bash
ls -d .agents/skills/*/ | sed 's|.*/||;s|/||' | sort
```

This is your **source of truth**. Every skill here must be in the docs. Every skill in the docs must exist here.

### Step 2 — Check Frontmatter

For each `SKILL.md`:

- Opening fence `---` on line 1
- `name:` field matches the folder name exactly
- `description:` is present, keyword-rich, and one sentence
- Closing fence `---` before the `#` title

```bash
head -5 .agents/skills/{name}/SKILL.md
grep "^name:" .agents/skills/{name}/SKILL.md
```

### Step 3 — Cross-Reference README.md

Compare the directory list against:

- **Always-Included Skills table** — domain skills that should be in this table
- **Task Skills table** — slash-command-invoked skills (`/name`)
- **Framework Detection table** — `nextjs-conventions`, `python-conventions`, `go-conventions`, `rust-conventions`
- **Mermaid diagram** — every skill should have a decision branch `D -->|trigger| X[name]`

**Categories for classification:**

| Skill name pattern | Expected table |
|--------------------|---------------|
| `*-conventions` (framework: nextjs, python, go, rust) | Framework Detection |
| `project-structure`, `containers`, `shell-scripts`, `sql-database`, `api-design`, `kubernetes`, `typescript-standalone`, `agent-pipelines` | Always-Included Skills |
| `generate-docs`, `write-docs`, `repo-context`, `update-skills`, `create-readme`, `audit-skills`, `gh-cli`, `thread-auto-context` | Task Skills |
| `always-read-agents`, `generic-conventions` | Core (listed in bootstrap table, not skills tables) |

### Step 4 — Cross-Reference bootstrap.sh

Check the FILES array in `.agents/scripts/bootstrap.sh`:

- Every `always`-tier skill must be in the FILES array
- Every framework skill must be in the `case "$FRAMEWORK"` block
- `optional` skills (task skills, hooks) should be in FILES but may be `optional`
- No orphan entries — if a FILES entry points to a nonexistent skill, flag it

### Step 5 — Cross-Reference Mermaid Diagram

The mermaid diagram in `README.md` shows the decision flow. Each domain skill needs:

1. A decision branch: `D -->|file type or trigger| XN[skill-name]`
2. A convergence edge: `XN --> J`

If a skill is missing from the diagram, the AI won't know when to invoke it based on file types.

### Step 6 — Check for Stale References

- Any README/USAGE reference to a skill that no longer exists?
- Any stale path (`old-skill/`) in the mermaid diagram?
- Any bootstrap.sh entry pointing to a deleted directory?
- Any AGENTS.md cross-reference to a removed skill?

### Step 7 — Auto-Fix, Commit, and Log

When the audit finds issues, **fix them immediately**. Then commit and log.

| Issue | Fix |
|-------|-----|
| Skill missing from README | Add row to appropriate table with emoji and description from SKILL.md |
| Skill missing from mermaid | Add `D -->\|trigger\| XN[skill-name]` and `XN --> J` |
| Skill not in bootstrap.sh | Add FILES entry: `".agents/skills/{name}/SKILL.md\|.agents/skills/{name}/SKILL.md\|{condition}"` |
| Name mismatch | Fix `name:` field in SKILL.md frontmatter |
| Stale reference | Remove the reference from README, USAGE.md, or bootstrap.sh |
| Orphan skill (no SKILL.md) | Create SKILL.md from template or delete empty directory |
| Badge count wrong | Update `skills-17%20files` to match actual count |

**After applying fixes, always commit and log:**

```bash
git add -A
git commit -m "audit: fix {N} discrepancies — {brief summary}"
git rev-parse --short HEAD  # capture this hash
```

Then append to `.agents/skills/learnings.md`:

```markdown
## YYYY-MM-DD — audit fix

- **Commit**: `{short-hash}`
- **Fixed**: {list of what was fixed}
- **Audit result**: {N} discrepancies found, {N} fixed
```

---

## Quick Audit Command

```bash
# One-liner to compare skills directory vs bootstrap.sh
comm -23 \
  <(ls -d .agents/skills/*/ | sed 's|.*/||;s|/||' | sort) \
  <(grep -oP '\.agents/skills/\K[^/]+(?=/SKILL\.md)' .agents/scripts/bootstrap.sh | sort)
```

This shows skills that exist as directories but are NOT in bootstrap.sh. Reverse `comm -13` to find bootstrap.sh entries pointing to nonexistent directories.

---

## Integration with Other Skills

- **`update-skills`** — The update-skills detection signals feed into this audit. When update-skills detects a new skill, run an audit immediately to wire it into all docs. No permission needed.
- **`always-read-agents`** — The skill loader should reference the audit skill so the AI knows to check consistency.
- **`generate-docs`** — When docs are regenerated, run an audit to ensure nothing fell out of sync.

---

## Verification

- Run the quick audit command — zero discrepancies in `comm -23` output
- Every skill directory has a frontmatter-valid SKILL.md
- README.md badge count matches `ls -d .agents/skills/*/ | wc -l`
- `grep -c '|\.agents/skills/.*|\.agents/skills/' .agents/scripts/bootstrap.sh` matches expected count
- Mermaid diagram has one node per domain skill
