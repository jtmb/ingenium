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

## 🔴 Revert Safety — Always Commit Before Changing

**Every skill system change MUST be reversible.** Before making any audit or update-skills changes, commit the current state first. This guarantees you can always `git checkout` back to the pre-change state.

### Mandatory Workflow

```bash
# 1. Commit the BEFORE state (snapshot)
git add -A
git commit -m "audit: snapshot before fixes"
git rev-parse --short HEAD  # capture BEFORE hash

# 2. Make your changes (audit fixes, skill updates, etc.)

# 3. Verify tests pass
bash tests/test-self-improving.sh

# 4. Commit and capture AFTER hash
git add -A
git rev-parse --short HEAD  # capture AFTER hash
git commit -m "audit: fix {N} discrepancies — {brief summary}"
```

### Reverting a Skill

To revert a specific skill to its state before the last change:

```bash
# Revert a single skill to its previous commit
git checkout <before-hash> -- .agents/skills/<skill-name>/

# If the skill also has a deploy mirror:
git checkout <before-hash> -- deploy/.agents/skills/<skill-name>/

# Verify and commit the revert
git add -A
git commit -m "revert: restore <skill-name> to <before-hash>"
```

To find the before-hash for any skill change, search learnings.md:

```bash
grep -B5 "<skill-name>" .agents/skills/learnings.md
```

### learnings.md Format

Every entry MUST include both Before and After commit hashes. Never commit without both. The learnings log covers both skills and agents.

```markdown
## YYYY-MM-DD — {brief description}

- **Before**: `{short-hash}` (state before changes)
- **After**: `{short-hash}`
- **Fixed**: {list of what was fixed}
- **Audit result**: {N} discrepancies found, {N} fixed
```

To find the before-hash, search learnings.md:

```bash
# For skill changes:
grep -B5 "<skill-name>" .agents/skills/learnings.md

# For agent changes:
grep -B5 "<agent-name> (agent)" .agents/skills/learnings.md
```

---

## What Gets Audited

The audit checks 10 integration points. Every skill should appear in ALL of them (or have a valid reason not to).

| Check | File(s) | What "correct" looks like |
|-------|---------|--------------------------|
| **1. Directory exists** | `.agents/skills/{name}/SKILL.md` | Frontmatter present, `name` matches folder |
| **2. README table** | `README.md` → Always-Included Skills or Task Skills tables | Skill listed with correct emoji, description matches SKILL.md |
| **3. README mermaid** | `README.md` → mermaid graph TD | Node exists with skill name, connected to `D` (decision node) |
| **4. bootstrap.sh** | `.agents/scripts/bootstrap.sh` → FILES array | Entry exists with correct condition (`always`, `optional`, `framework:*`) |
| **5. AGENTS.md index** | `AGENTS.md` | Points to `/help` — no stale references to deleted skills or docs |
| **6. USAGE.md** | `USAGE.md` → skill listings, directory trees | Skill appears in tree diagrams and reference tables |
| **7. SKILL-INDEX.md** | `SKILL-INDEX.md` (repo root) | Skill is listed in the correct table, total count matches `ls -d .agents/skills/*/ \| wc -l` |
| **8. Deploy mirror** | `deploy/.agents/skills/` vs `.agents/skills/` | Every non-source-only skill in source has a matching directory in deploy, and deploy has no orphans |
| **9. Hooks validity** | `.agents/hooks/` (source + deploy) + doc references | Every lifecycle hook has a matching JSON file in both source and deploy. JSON is valid. Hooks documented in README.md architecture table and ARCHITECTURE.md. |
| **10. Self-learning artifacts** | `learnings.md`, AGENTS.md self-improvement section, deploy mirror | learnings.md exists in source. Self-improvement section in AGENTS.md references hooks. Deploy has fresh learnings.md template. PostToolUse hook references self-improvement. |

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
| `generic-conventions` | Core (listed in bootstrap table, not skills tables) |

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

### Step 7 — Cross-Reference SKILL-INDEX.md

Compare the directory list against `SKILL-INDEX.md` at the repo root:

- Every skill directory must appear in SKILL-INDEX.md
- The total count in the header must match `ls -d .agents/skills/*/ | wc -l`
- Each skill must be in the correct table (Invocable Task Skills, Framework Conventions, Always-Included Domain, or Core)
- Links must point to the correct path: `.agents/skills/{name}/SKILL.md`
- No stale entries for deleted skills
- No duplicate entries

**Fix**: If SKILL-INDEX.md is stale, run `/update-skill-index` to regenerate it, or manually update the specific entries.

### Step 8 — Cross-Reference Hooks

Check the hooks directory in both source and deploy:

```bash
# List hooks in source
ls .agents/hooks/*.json 2>/dev/null | sort
# List hooks in deploy
ls deploy/.agents/hooks/*.json 2>/dev/null | sort
```

- Every lifecycle hook in source must have a matching file in deploy
- Each hook JSON must be valid (use `python3 -m json.tool` to validate)
- Every hook must be documented in the README.md architecture table (Enforcement row) and ARCHITECTURE.md (Hooks System section)
- The `post-tool-use` hook must reference self-improvement (logging patterns, `/update-skills`)
- No orphan hooks in deploy that don't exist in source

**Fix**: If a hook is missing from deploy, copy from source. If JSON is invalid, fix the syntax. If documentation is missing, add to README.md and ARCHITECTURE.md.

### Step 9 — Cross-Reference Self-Learning Artifacts

Verify the self-improvement pipeline is properly wired:

```bash
# Check learnings.md exists in source
cat .agents/skills/learnings.md | head -3
# Check deploy has a learnings.md template
cat deploy/.agents/skills/learnings.md | head -3
```

- `.agents/skills/learnings.md` must exist and have at least one entry with Before/After hashes
- `deploy/.agents/skills/learnings.md` must exist (can be a fresh template for target repos)
- AGENTS.md must have a "Self-Improvement — Grow the System" section that references hooks
- The `post-tool-use` hook file must contain references to logging patterns or `/update-skills`
- Source-only skills (create-readme, thread-auto-context) must NOT appear in deploy/

**Fix**: If learnings.md is missing, create it with the template format. If AGENTS.md lacks self-improvement section, add it. If deploy is missing learnings.md, copy from source or create placeholder.

### Step 10 — Auto-Fix, Commit, and Log

When the audit finds issues, **fix them immediately**. Then commit and log.

**⚠️ Commit the BEFORE state first** (see Revert Safety above). Then make fixes, then commit again with both hashes in learnings.

| Issue | Fix |
|-------|-----|
| Skill missing from README | Add row to appropriate table with emoji and description from SKILL.md |
| Skill missing from mermaid | Add `D -->\|trigger\| XN[skill-name]` and `XN --> J` |
| Skill not in bootstrap.sh | Add FILES entry: `".agents/skills/{name}/SKILL.md\|.agents/skills/{name}/SKILL.md\|{condition}"` |
| Name mismatch | Fix `name:` field in SKILL.md frontmatter |
| Stale reference | Remove the reference from README, USAGE.md, or bootstrap.sh |
| Orphan skill (no SKILL.md) | Create SKILL.md from template or delete empty directory |
| Skill missing from AGENTS.md | Not applicable — AGENTS.md is a redirect to `/help`. No per-skill rows needed. |
| Badge count wrong | Update `skills-17%20files` to match actual count |
| Skill missing from SKILL-INDEX.md | Add entry to appropriate table with description from SKILL.md |
| SKILL-INDEX.md count wrong | Update `**Total skills: {N}**` to match `ls -d .agents/skills/*/ \| wc -l` |
| SKILL-INDEX.md has stale entry | Remove the row for the deleted skill |
| SKILL-INDEX.md has duplicate entry | Remove the duplicate row |
| SKILL-INDEX.md updated but deploy/ is stale | `cp SKILL-INDEX.md deploy/SKILL-INDEX.md` |
| update-skill-index added but deploy/ missing | `cp -r .agents/skills/update-skill-index deploy/.agents/skills/update-skill-index` |
| Skill in source but missing from deploy/ | `cp -r .agents/skills/{name} deploy/.agents/skills/{name}` and add to bootstrap.sh |
| Skill in deploy but not in source (orphan) | Remove from deploy/ and remove from bootstrap.sh |
| Hook missing from source or deploy | Verify `.agents/hooks/{name}.json` exists in both. `cp` from source to deploy if needed. |
| Hook JSON invalid | Validate JSON: `python3 -m json.tool .agents/hooks/{name}.json` |
| Hook not documented in README/ARCHITECTURE | Add to README architecture table Enforcement row and ARCHITECTURE.md Hooks System section |
| Self-learning artifacts missing | Ensure learnings.md exists in `.agents/skills/`, AGENTS.md has self-improvement section, deploy has fresh learnings.md template |
| Deploy learnings.md stale | `cp .agents/skills/learnings.md deploy/.agents/skills/learnings.md` (or deploy template placeholder) |

**After applying fixes, always commit-before + commit-after and log both hashes:**

```bash
# BEFORE snapshot
git add -A && git commit -m "audit: snapshot before fixes"
BEFORE=$(git rev-parse --short HEAD)

# ... make fixes ...

# Run tests
bash tests/test-self-improving.sh

# AFTER commit
git add -A
git commit -m "audit: fix {N} discrepancies — {brief summary}"
AFTER=$(git rev-parse --short HEAD)

# Log both hashes to learnings.md:
# - **Before**: `$BEFORE`
# - **After**: `$AFTER`
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

```bash
# One-liner to check deploy mirror completeness
# Skills in source that are NOT in deploy (expected: source-only skills only)
echo "=== Skills in source but missing from deploy/ ==="
comm -23 \
  <(for d in .agents/skills/*/; do basename "$d"; done | sort) \
  <(for d in deploy/.agents/skills/*/; do basename "$d"; done | sort)
echo "=== Skills in deploy but not in source (orphans) ==="
comm -13 \
  <(for d in .agents/skills/*/; do basename "$d"; done | sort) \
  <(for d in deploy/.agents/skills/*/; do basename "$d"; done | sort)

echo "=== Hooks parity check ==="
diff <(ls .agents/hooks/*.json 2>/dev/null | xargs -I{} basename {} | sort) \
     <(ls deploy/.agents/hooks/*.json 2>/dev/null | xargs -I{} basename {} | sort) \
  && echo "✓ Hooks in sync" || echo "✗ Hooks out of sync"
```

---

## Integration with Other Skills

- **`update-skills`** — The update-skills detection signals feed into this audit. When update-skills detects a new skill, run an audit immediately to wire it into all docs. No permission needed.
- **`generate-docs`** — When docs are regenerated, run an audit to ensure nothing fell out of sync.

---

## Verification

- Run the quick audit command — zero discrepancies in `comm -23` output
- Every skill directory has a frontmatter-valid SKILL.md
- README.md badge count matches `ls -d .agents/skills/*/ | wc -l`
- `grep -c '|\.agents/skills/.*|\.agents/skills/' .agents/scripts/bootstrap.sh` matches expected count
- Mermaid diagram has one node per domain skill
- Hooks parity: `diff <(ls .agents/hooks/*.json) <(ls deploy/.agents/hooks/*.json)` — zero differences
- Self-learning: learnings.md exists in both source and deploy, AGENTS.md has "Self-Improvement — Grow the System" section
- Source-only exclusion: only `create-readme` and `thread-auto-context` are missing from deploy/
- `README.md` `"(12 files deployed + 2 source-only)"` matches actual task skill distribution
