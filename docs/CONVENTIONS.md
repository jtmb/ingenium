# Conventions

## Naming

| What | Convention | Example |
|------|-----------|---------|
| **Skill directories** | `{name}-conventions` for frameworks, `{verb}-{noun}` for tasks | `nextjs-conventions`, `update-skills`, `write-docs` |
| **Skill frontmatter `name`** | MUST match directory name exactly | `name: nextjs-conventions` in `.agents/skills/nextjs-conventions/SKILL.md` |
| **Skill frontmatter `description`** | Keyword-rich, one sentence, includes triggers | `"Use when editing **/*.py files. Covers type hints, pytest, ..."` |
| **Bootstrap scripts** | `{purpose}.sh` or `{purpose}-{sub}.sh` | `bootstrap.sh`, `hook-bootstrap.sh` |
| **Test scripts** | `test-{what}.sh` | `test-self-improving.sh` |
| **Hook files** | `{lifecycle-event}.json` | `session-start.json`, `pre-tool-use.json` |
| **Agent files** | `{name}.agent.md` | `code-reviewer.agent.md` |
| **Doc files** | `UPPERCASE-WITH-DASHES.md` | `ARCHITECTURE.md`, `TECH-STACK.md`, `CONVENTIONS.md` |
| **Learnings entries** | ISO date + topic | `## 2026-07-02 — always-read-agents removed` |

## File Organization

- **One concern per skill.** Each `.agents/skills/{name}/` contains exactly one `SKILL.md`. No bundling — testing rules and styling rules go in separate skills.
- **Each SKILL.md is self-contained.** It should reference other skills by name (e.g., "See `generic-conventions`") rather than duplicating their content.
- **Link to docs, don't duplicate.** Skills reference `docs/ARCHITECTURE.md` etc. instead of copying doc content.
- **`deploy/` is a clean mirror.** It contains only skills + `AGENTS.md`. No scripts, hooks, tests, docs, or README. The source repo is the source of truth; deploy is an output.
- **`tests/` lives at project root** alongside `docs/`, not inside `.agents/`. Tests validate the skill system but are not part of it.
- **`learnings.md` lives in `.agents/skills/`** — it's source-only (excluded from deploy) because it's a development artifact, not a deployable convention.
- **YAML frontmatter is always between `---` fences** on lines 1 and the line before Markdown content. No tabs (spaces only). Colons in descriptions must be inside quotes.

### Deploy Exclusion Rules

Four skill directories are source-only (not deployed to target projects):
1. `create-readme` — Only used when scaffolding THIS repo
2. `gh-cli` — GitHub-specific, not relevant to arbitrary projects
3. `playwright-mcp` — Browser automation, rarely needed in conventions
4. `thread-auto-context` — Conversation memory, not a code convention

## Error Handling

- **Bash scripts** use `set -euo pipefail` at the top of every script.
- **`inherit_errexit` is ON by default in bash 5.x** — subshells inherit `set -e`, so `$(grep ... | wc -l)` kills the script when grep finds nothing. Fix: `$( { grep ... || true; } | wc -l)`.
- **Test failures are explicit** — `test-self-improving.sh` prints `✓ PASS` or `✗ FAIL` with clear descriptions. No silent failures.
- **Frontmatter errors are silent** — bad YAML doesn't throw errors, it just means the skill won't load. The test suite catches these.

## Git Practices

- **Conventional Commits**: `type(scope): description` format.
  - `feat:` — new skill or feature
  - `refactor:` — restructuring without behavior change
  - `fix:` — bug fix
  - `docs:` — documentation only
  - `chore:` — maintenance (test updates, config changes)
- **Atomic commits**: One logical change per commit. Moving tests/ to root is one commit; updating 5 docs is another.
- **Every commit gets a learnings entry** if it adds, removes, or significantly changes a skill.
- **Learnings entries include the commit hash**: `**Commit**: \`f2557f0\`` — verified by `git rev-parse --short HEAD`.
- **Branch naming**: `feature/description`, `fix/description`, `refactor/description`.

## Code Style

### Bash Scripts

- `#!/usr/bin/env bash` shebang
- `set -euo pipefail` at line 2
- Functions use lowercase with underscores: `check_skill_count()`
- Variables: `UPPERCASE` for constants/globals, `lowercase` for locals
- `[[ ]]` for conditionals, never `[ ]`
- `$()` for command substitution, never backticks
- Quote all variable expansions: `"$var"` not `$var`
- `printf` for formatted output, not `echo -e`

### Markdown

- ATX-style headers (`#`, `##`) with space after `#`
- Fenced code blocks with language tag: ` ```bash `
- Tables aligned with pipes, not forced to column-align
- Links use reference style only for repeated URLs
- Mermaid diagrams in ` ```mermaid ` fenced blocks

### YAML Frontmatter

```yaml
---
name: skill-name
description: "One sentence. Keyword-rich. Includes when to invoke."
---
```
- `name` must match the parent directory name
- `description` must be one sentence, quoted if it contains colons
- Opening `---` on line 1, closing `---` immediately before body text
- Spaces only (no tabs), UTF-8 encoding
