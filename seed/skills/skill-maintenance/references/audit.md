---
title: "Full System Audit — 9-Check Cross-Reference Verification"
impact: HIGH
impactDescription: "Catches stale references, missing entries, and broken cross-links across all docs"
tags: [audit, cross-reference, verification, docs]
---

## Full System Audit

The audit checks 8 integration points. Every skill should appear in all of them (or have a valid reason not to).

| Check | File(s) | What "correct" looks like |
|-------|---------|---------------------------|
| **1. Directory exists** | `.opencode/skills/{name}/SKILL.md` | Frontmatter present, `name` matches folder |
| **2. SKILL-INDEX.md** | `SKILL-INDEX.md` | Entry exists, description matches, total count correct |
| **3. AGENTS.md** | `AGENTS.md` | Skill listed in directory index and/or skill index table |
| **4. README.md** | `README.md` | Skill listed in appropriate table or referenced |
| **5. Cross-references** | Other SKILL.md files | Any skill that references this skill uses correct path |
| **6. Agent files** | `.opencode/agents/*.md` | If skill is listed in Required Skills, description matches |
| **7. Frontmatter validity** | Each SKILL.md | `name` matches folder, `description` present |
| **8. learnings.md** | `.agents/skills/learnings.md` | Recent changes logged with Before/After hashes |

### Quick Audit Command

```bash
diff <(ls -d .opencode/skills/*/ | sed 's|.opencode/skills/||;s|/||' | sort) \
     <(grep -oP '(?<=.opencode/skills/)\w+' SKILL-INDEX.md | sort)
```

No output means skills directory and SKILL-INDEX.md are in sync.

### Audit Procedure

#### Step 1 — Source of Truth
```bash
ls -d .opencode/skills/*/ | sed 's|.*/||;s|/||' | sort
```

#### Step 2 — Check Frontmatter
For each SKILL.md: opening `---` on line 1, `name:` matches folder, `description:` present, closing `---`.

#### Step 3 — Cross-Reference SKILL-INDEX.md
- Every skill in `.opencode/skills/` has an entry in SKILL-INDEX.md
- Every entry corresponds to an actual skill
- Total count matches directory count

#### Step 4 — Check AGENTS.md
- Directory index lists the skill directory
- Skill index table (if applicable) has correct path

#### Step 5 — Check for Stale References
- Any reference to a skill that no longer exists?
- Any stale paths in docs?
- Any SKILL-INDEX.md entries pointing to deleted skills?
- Any AGENTS.md cross-references to removed skills?

#### Step 6 — Auto-Fix, Commit, and Log

When the audit finds issues, fix them immediately. Follow the HARD RULEs: commit-before, make fixes, commit-after, log both hashes.

| Issue | Fix |
|-------|------|
| Skill missing from SKILL-INDEX.md | Add entry with description |
| SKILL-INDEX.md count wrong | Update total count |
| SKILL-INDEX.md has stale entry | Remove the row |
| Name mismatch | Fix `name:` field in SKILL.md frontmatter |
| Stale reference in docs | Remove or update the reference |
| Missing learnings entry | Log with Before/After hashes |
| Agent file stale description | Update description to match current structure |

### Verification

- Run quick audit command — zero discrepancies
- Every skill directory has frontmatter-valid SKILL.md
- SKILL-INDEX.md count matches directory count
- learnings.md exists with recent entries
