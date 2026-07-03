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

The audit checks 8 integration points. Every skill should appear in ALL of them (or have a valid reason not to).

| Check | File(s) | What "correct" looks like |
|-------|---------|--------------------------|
| **1. Directory exists** | `.agents/skills/{name}/SKILL.md` | Frontmatter present, `name` matches folder |
| **2. README table** | `README.md` → Always-Included Skills or Task Skills tables | Skill listed with correct emoji, description matches SKILL.md |
| **3. README mermaid** | `README.md` → mermaid graph TD | Node exists with skill name, connected to `D` (decision node) |
| **4. bootstrap.sh** | `.agents/scripts/bootstrap.sh` → FILES array | Entry exists with correct condition (`always`, `optional`, `framework:*`) |
| **5. AGENTS.md index** | `AGENTS.md` | Points to `/help` — no stale references to deleted skills or docs |
| **6. USAGE.md** | `USAGE.md` → skill listings, directory trees | Skill appears in tree diagrams and reference tables |
| **7. SKILL-INDEX.md** | `SKILL-INDEX.md` (repo root) | Skill is listed in the correct table, total count matches `ls -d .agents/skills/*/ \| wc -l` |
| **8. Agent definitions** | `.github/agents/*.agent.md` | Frontmatter valid, `name` matches filename, `model` matches model-profiles, handoff chains resolve, deploy mirror matches source |

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

### Step 8 — Cross-Reference Agent Definitions

Compare agent files against each other and against `model-profiles`:

- Every agent in `.github/agents/` must have valid frontmatter (`name`, `description`, `model`, `tools`)
- `name` must match filename stem (e.g., `plan.agent.md` → `name: Plan`)
- `model` must be consistent with `model-profiles` model-to-role assignments
- Handoff chains must resolve — every agent referenced in `handoffs:` or `agents:` must exist
- Agent count in deploy mirror must match source
- No stale agent files in deploy (agent removed from source but still in deploy)
- No deploy drift — deploy mirror content must match source

```bash
# Count agents in source vs deploy
ls .github/agents/*.agent.md | wc -l
ls deploy/.github/agents/*.agent.md | wc -l

# Check name matches filename
for f in .github/agents/*.agent.md; do
  name=$(grep "^name:" "$f" | head -1 | sed 's/name: *//')
  expected=$(basename "$f" .agent.md | sed 's/\(.*\)/\u\1/')
  if [ "$name" != "$expected" ]; then
    echo "MISMATCH: $f name=$name expected=$expected"
  fi
done

# Check handoff chains resolve
for f in .github/agents/*.agent.md; do
  grep "^name:" "$f" | sed 's/name: *//'
done | sort > /tmp/agent-names.txt

for f in .github/agents/*.agent.md; do
  awk '/^handoffs:/,/^[a-z]/' "$f" | grep "agent:" | sed 's/.*agent: *//'
done | sort -u > /tmp/handoff-targets.txt

comm -13 /tmp/agent-names.txt /tmp/handoff-targets.txt
```

### Step 9 — Auto-Fix, Commit, and Log

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
| Agent missing from bootstrap.sh | Add FILES entry: `".github/agents/{name}.agent.md\|.github/agents/{name}.agent.md\|optional"` |
| Agent missing from deploy mirror | `cp .github/agents/{name}.agent.md deploy/.github/agents/{name}.agent.md` |
| Agent deploy drift (content mismatch) | `cp .github/agents/{name}.agent.md deploy/.github/agents/{name}.agent.md` |
| Agent handoff target not found | Either create the missing agent or remove the broken handoff entry |
| Agent model stale (not in model-profiles) | Update `model:` to current model-profiles recommendation |
| Agent frontmatter invalid (name mismatch, missing fields) | Fix frontmatter per `manage-agents` validation rules |
| manage-agents skill missing from bootstrap.sh | Add FILES entry: `".agents/skills/manage-agents/SKILL.md\|.agents/skills/manage-agents/SKILL.md\|optional"` |
| manage-agents skill missing from deploy | `cp -r .agents/skills/manage-agents deploy/.agents/skills/manage-agents` |

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
