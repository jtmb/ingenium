# AGENTS.md — Mandatory Pre-Read

Before implementing, writing, editing, or deleting any code in this repository, you MUST:

1. Read this file for project conventions, architecture, common patterns, and documentation rules
2. Follow all rules and conventions documented here
3. After making changes, re-read relevant sections and update anything that is now wrong

**Do not skip this step.** AGENTS.md is the source of truth for how this codebase works. Treat it as a mandatory pre-read before any code work.

## Customizing for Your Project

This file contains **generic core rules** that apply to all projects regardless of language or framework. Framework-specific conventions (build commands, directory layouts, language idioms) live in `.github/instructions/{framework}.instructions.md` and are loaded automatically when editing matching files.

To customize:
- **Add a framework rule**: Create `.github/instructions/{name}.instructions.md` with an `applyTo` frontmatter field
- **Add a project-specific rule**: Use `.github/instructions/{name}.instructions.md` scoped to your source directories
- **Add a task template**: Create `.github/prompts/{name}.prompt.md` (invocable via `/` in VS Code chat)
- **Enforce deterministically**: Add `.github/hooks/{name}.json` for lifecycle-based guardrails

See `USAGE.md` for the full decision tree and step-by-step guides.


# Code Comments — Mandatory

Every function, class, non-obvious block, and exported symbol MUST have a human-readable comment explaining **why** it exists and **what** it does. Follow these rules:

- Write comments as if explaining to a new teammate — plain English, no jargon shortcuts.
- Focus on intent and edge cases, not restating the code.
- Keep comments up to date when logic changes. Stale comments are worse than no comments.
- JSDoc / TSDoc for public APIs; inline `//` for internal logic that isn't self-evident.
- Python: Google-style docstrings. Go: doc comments on exported symbols. Rust: `///` doc comments with examples where helpful.


# Docs — Always Keep Them In Sync

Every source change must update the corresponding docs in `docs/` at the repo root. Docs must be human-readable and structured so other LLMs can consume them.

1. Check which docs in `docs/` at the repo root cover the behavior you changed
2. Re-read those docs
3. Update anything that's now wrong. If no doc covers it, create one.

**Do not defer.** Apply doc updates in the same turn as the code change. Treat docs as part of the feature.


# Test Before You're Done

Never claim a change is complete until you have verified it. Before wrapping up:

1. **Lint & type-check** — run the project's linter and type checker. Fix every error.
2. **Build check** — run the project's build command. Ensure it succeeds with no warnings you introduced.
3. **Manual smoke test** — if the change touches UI or API behavior, run the dev server and hit the affected path at least once.
4. **Existing tests** — run the project's test suite. If existing tests break, fix them before declaring done.
5. **Add tests** — if you added new logic, add at least one test that would fail without your change.

If any step fails, fix it and re-run. Only say "done" when everything is green.


# Reusable Code — Mandatory

Don't repeat yourself. Every piece of logic must live in exactly one place.

- **Extract, don't duplicate.** If the same logic appears in two places, pull it into a shared utility, hook, or helper.
- **Shared components belong in a designated shared directory.** Don't inline reusable UI or logic in page-level or module-level code.
- **Shared utilities go in a designated utilities directory.** Date formatting, string helpers, API wrappers — anything used across multiple files lives here.
- **Prefer composition over inheritance.** Keep abstractions flat and composable.
- **Reference existing patterns.** Before creating a new utility, check if an equivalent already exists in the codebase.

