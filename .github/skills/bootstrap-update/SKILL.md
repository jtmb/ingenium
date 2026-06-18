---
name: bootstrap-update
description: "Update the AI bootstrap system itself. Use when adding framework overlays, modifying core rules, fixing instruction files, or restructuring the bootstrap repo. Covers the layered architecture decision flow and file dependencies."
---

# Bootstrap Update Skill

## What This Skill Covers

This is the meta-skill for maintaining the AI bootstrap repo. It guides you through adding frameworks, updating core rules, fixing instruction files, and restructuring the layered architecture.

## When to Use

- Adding a new framework overlay (e.g., Ruby, Elixir, Zig)
- Modifying core rules in `AGENTS.md`
- Adding or updating prompts, hooks, or skills
- Fixing YAML frontmatter or `applyTo` patterns
- Restructuring the directory layout

## The Layered Architecture

Before making any change, understand which layer you're touching:

1. **Core** (`AGENTS.md`) — affects ALL projects. Change with caution.
2. **Framework overlays** (`.github/instructions/{fw}.instructions.md`) — affects projects using that framework. Check `applyTo` scope.
3. **Project overlays** (`.github/instructions/{project}.instructions.md`) — affects specific projects. Scope tightly.
4. **System context** (`.github/prompts/`) — on-demand. Doesn't fire automatically.
5. **Enforcement** (`.github/hooks/`) — deterministic. Test with `--dry-run`.
6. **Skills** (`.github/skills/`) — on-demand. Ensure `name` matches folder.

## Procedure: Add a New Framework Overlay

1. Read `USAGE.md` → "Add a New Framework Overlay" for the checklist
2. Create `.github/instructions/{framework}.instructions.md`:
   - `description`: keyword-rich, "Use when..." pattern
   - `applyTo`: specific file globs for the framework's file types
   - Body: build/test commands, directory conventions, language idioms
3. Add the framework to the table in `USAGE.md` (Framework Support Table)
4. Add the framework to `.github/scripts/bootstrap.sh`:
   - Add `*.instructions.md` entry to the `case "$FRAMEWORK"` block
   - Add the framework to `VALID_FRAMEWORKS` array (if new)
5. Update `docs/TECH-STACK.md` if relevant
6. Test: `./.github/scripts/bootstrap.sh --dry-run --framework {name} /tmp/test`
7. Update this skill if the procedure changes

## Procedure: Modify Core Rules

1. Read `AGENTS.md` fully — understand all current rules
2. Read all framework overlays — check for conflicts with your change
3. Make the change to `AGENTS.md`
4. Update any framework overlays that reference the changed rule
5. Update `docs/CONVENTIONS.md` if conventions changed
6. Run `./.github/scripts/bootstrap.sh --dry-run` for each framework — ensure nothing breaks

## Procedure: Fix an Instruction File

1. Check frontmatter:
   - `---` fences at top — no extra spaces or missing lines
   - `description`: present, keyword-rich, no unescaped colons
   - `applyTo`: valid glob, scoped tightly, no trailing commas in arrays
2. Check body: no obvious instructions, no duplicated docs content, one concern per file
3. Test: trigger the instruction by editing a matching file type

## File Dependencies Map

```
AGENTS.md
  ├── docs/ (always updated alongside code)
  ├── USAGE.md (references AGENTS.md rules)
  └── .github/instructions/always-read-agents.instructions.md (forces AGENTS.md read)

.github/instructions/{fw}.instructions.md
  └── References AGENTS.md conventions, extends with framework-specific rules

.github/prompts/
  └── References docs/ for detailed conventions

.github/hooks/
  ├── session-start.json → .github/scripts/hook-bootstrap.sh → .github/scripts/bootstrap.sh (auto-bootstrap chain)
  ├── pre-tool-use.json (safety net — warns if AGENTS.md missing)
  └── post-tool-use.json (placeholder for auto-lint)

.github/workflows/ci.yml
  └── Detects framework files, runs appropriate lint/test/build

.github/scripts/bootstrap.sh
  └── Copies AGENTS.md + selected overlays + docs/ + USAGE.md + hooks

.github/scripts/hook-bootstrap.sh
  ├── Called by SessionStart hook (one-time user config)
  ├── Caches repo in ~/.cache/gh-llm-bootstrap/
  ├── Auto-detects framework (package.json → nextjs, pyproject.toml → python, go.mod → go, Cargo.toml → rust)
  └── Calls .github/scripts/bootstrap.sh --auto --framework <detected>
```

## Anti-Patterns to Watch For

- **`applyTo: "**"` on narrow rules** — burns context, may conflict. Use specific globs.
- **YAML frontmatter silent failures** — unescaped colons, tabs instead of spaces, missing `---` fences
- **Mixing concerns** — one instruction file for both testing AND styling AND API design
- **Contradictory rules** — core says "run tests", overlay says "skip tests" without explanation
- **Forgetting `description`** — even with `applyTo`, description enables on-demand discovery
- **`name` mismatch in SKILL.md** — must match folder name exactly
