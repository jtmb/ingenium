---
title: "Skill Lifecycle — Creating, Registering, Updating, Retiring"
impact: HIGH
impactDescription: "Ensures every skill is properly wired into the catalog, index, and docs"
tags: [lifecycle, registration, update, retire]
---

## Skill Lifecycle

### Creating a New Skill

When you've identified a candidate from detection signals, create it immediately:

1. **Choose the name** using the naming rules from [creation.md](creation.md)
2. **Create the directory** and SKILL.md (monolithic or split)
3. **Write frontmatter and content** following the templates
4. **Register** in all locations (see below)
5. **Validate** — run the validation checklist
6. **Commit and log** — follow the 🔴 HARD RULEs

### Registration

After creating the SKILL.md file, register it in ALL of these places:

| Location | Action |
|----------|--------|
| `SKILL-INDEX.md` (repo root) | Add to numbered list AND category section |
| `AGENTS.md` | If mandatory or in Pre-Flight Check table |
| `docs/CONVENTIONS.md` | Add learning→skill detection references |

Update the skill count in SKILL-INDEX.md. AGENTS.md may also reference the count in text.

### Updating an Existing Skill

When a skill is outdated:

1. **Read the skill** fully — understand what it currently says
2. **Read the codebase** — check current patterns against skill guidance
3. **Diff the changes** — what's different between skill and reality?
4. **Update the skill** — fix outdated commands, versions, paths, conventions
5. **Check for cascading updates** — if this skill says "see also X", check X too
6. **Update docs** — if docs reference this skill, update them
7. **Test** — invoke the skill and verify it gives correct guidance

### Retiring a Stale Skill

When a skill is no longer relevant:

1. **Verify it's truly unused** — grep the codebase for the pattern it covers
2. **Check for references** — does any other skill or doc link to it?
3. **Delete the directory** — `rm -rf .opencode/skills/{name}/`
4. **Update docs** — remove references from docs and skill listings
5. **Regenerate SKILL-INDEX.md** — see [index-regeneration.md](index-regeneration.md)
6. **Run audit** — see [audit.md](audit.md)

### Anti-Patterns to Watch For

- **Missing frontmatter** — skill won't load or be discoverable
- **Name mismatch** — `name` in frontmatter must match folder name exactly
- **Mixing concerns** — one skill for testing AND styling AND API design
- **Contradictory rules** — core says one thing, skill says another
- **Duplicating docs in skills** — link to docs instead
- **Too many skills** — each skill costs context. If two overlap 80%, merge them
