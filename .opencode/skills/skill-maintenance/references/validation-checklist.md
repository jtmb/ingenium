---
title: "Validation Checklist — Pre-Commit Verification for New and Updated Skills"
impact: MEDIUM
impactDescription: "Prevents common skill creation errors that break loading or discovery"
tags: [validation, checklist, testing]
---

## Validation Checklist

### Frontmatter
- [ ] `name` matches directory name exactly
- [ ] `description` is 1-1024 chars, includes trigger keywords
- [ ] No custom frontmatter fields beyond the 5 allowed

### File Structure
- [ ] File is named `SKILL.md` (ALL CAPS)
- [ ] Directory is a direct child of `skills/`
- [ ] If monolithic: SKILL.md is under 500 lines total
- [ ] If split-skill: SKILL.md is under 500 lines (index only); reference files have no line limit
- [ ] If split-skill: all reference files exist in `references/` directory
- [ ] If split-skill: SKILL.md has a Table of Contents linking to every reference file
- [ ] If split-skill: metadata.json exists with `name`, `description`, and `tags`

### Naming
- [ ] Gerund form preferred (exceptions for awkward cases)
- [ ] Lowercase + hyphens only
- [ ] Descriptive and specific
- [ ] Unique — no conflict with existing skills

### Content
- [ ] Starts directly with useful content
- [ ] Has a "When to Use" section with trigger phrases
- [ ] Has a "🔴 HARD RULEs" section if there are non-negotiable rules
- [ ] Uses progressive disclosure — most important info first
- [ ] Uses consistent terminology throughout
- [ ] Cross-references related skills at the end

### Registration
- [ ] Added to `.agents/SKILL-CATALOG.md` in the correct section
- [ ] Added to `SKILL-INDEX.md` (numbered list + category sections)
- [ ] Skill count header incremented in SKILL-INDEX.md
- [ ] AGENTS.md updated if needed
- [ ] Learnings entry appended with commit hash

### Agent Sync
- [ ] If restructuring an existing skill: searched all agent files for references
- [ ] For each match: verified file path and structural assumptions
- [ ] If split: updated SHORT descriptions that reference the old structure

### Testing
- [ ] `bash tests/test-self-improving.sh` passes
- [ ] `bash tests/test-agent-validation.sh` passes
