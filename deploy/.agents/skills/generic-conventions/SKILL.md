---
name: generic-conventions
description: "Fallback coding conventions for any project — definitive core rules (comments, docs, DRY, security, observability, error handling, configuration). Use when no framework-specific skill applies."
---

# Generic Coding Conventions

## When to Use

Invoke this skill when working on files that don't match any framework-specific skill. It contains the **definitive core rules** that apply universally across all programming languages and frameworks.

## Before Writing Any Code

1. **Read relevant docs** in `docs/` for context
2. **Check for framework-specific skills** in `.agents/skills/`
3. **Understand the existing patterns** in the codebase before making changes

## Code Comments — Mandatory

Every function, class, non-obvious block, and exported symbol MUST have a comment:
- Write as if explaining to a new teammate — plain English
- Focus on intent and edge cases, not restating the code
- Keep comments up to date when logic changes
- JSDoc/TSDoc for public APIs; inline `//` for internal logic

## Documentation — Always Keep In Sync

Every source change must update the corresponding docs:
1. Check which docs in `docs/` cover the behavior you changed
2. Re-read those docs
3. Update anything that's now wrong. If no doc covers it, create one.
4. Apply doc updates in the same turn as the code change.

## Reusable Code — DRY

- **Extract, don't duplicate.** If the same logic appears in two places, pull it into a shared utility.
- **Shared components belong in a designated shared directory.**
- **Prefer composition over inheritance.**
- **Before creating a new utility, check if one already exists.**

## Secure Coding — Mandatory

- **No secrets in code.** Use environment variables, secrets manager, or platform secret store.
- **Validate all input at trust boundaries.** Use framework-provided validation.
- **Principle of least privilege.** Avoid root/admin roles unless strictly necessary.
- **Never eval or exec untrusted input.**
- **Keep dependencies audited.** Run the project's dependency scanner.
- **Escape output at render time.** Parameterized queries, template engines with auto-escaping.
- **Rate-limit and timeout external calls.**

## Error Handling — Mandatory

- **Never ignore an error.** Handle or explicitly propagate every error.
- **Wrap with context** when propagating.
- **Handle errors at a single level.** Either log or return — never both.
- **Use typed/categorized errors, not string matching.**
- **Distinguish recoverable from non-recoverable.** Retry recoverable, fail fast on non-recoverable.
- **Never expose internals in error messages to users.**

## Git & Version Control — Mandatory

- **Atomic commits.** One logical change per commit.
- **Meaningful messages.** Conventional Commits: `type(scope): description`.
- **Never commit generated files or secrets.**
- **Pull request size:** Under 400 lines changed.

## Observability

- **Structured logging.** JSON-formatted with timestamp, level, message, trace ID.
- **Log levels:** DEBUG (developer details), INFO (key events), WARN (recoverable), ERROR (needs attention).
- **Metrics over logs for patterns.**
- **Health check endpoint** for every service.
- **Graceful degradation** when dependencies are down.

## Performance

- **Measure before optimizing.** Profile first.
- **Don't prematurely optimize.**
- **N+1 queries are a bug.**
- **Cache with intent** (TTL, invalidation strategy, fallback).
- **Paginate all list endpoints.**
- **Timeouts on every external call.**
- **Resource cleanup.** Close files, release connections, cancel timers.

## Project Structure

> **For full monorepo and microservices conventions, use the `project-structure` skill.** This section covers universal rules that apply regardless of project size.

- **Group by feature, not by type** (for mid-to-large projects). `feature/auth/`, `feature/payments/` — not `controllers/auth.js` + `models/payment.js` spread across folders. Small projects can use flat structures.
- **Co-locate tests with source code.** Tests live next to the code they test or in a parallel `tests/` directory at the project root — never in a distant location.
- **One concern per file.** If a file exceeds ~300 lines, consider splitting it.
- **Avoid circular dependencies.** If module A imports B and B imports A, restructure into a shared module C.
- **Index files are for re-exporting, not logic.** `index.ts` / `__init__.py` / `mod.rs` should export the public API — not contain business logic.
- **Configuration lives in one place.** No scattered `process.env` / `os.environ` calls across the codebase.
- **For multi-service repos, use the `project-structure` skill** — it defines the `services/{name}/` layout with `pages/`, `features/`, `domain/`, `infrastructure/` layers.

## Configuration

- **One config module.** All config lives in one place.
- **Validate at startup.** Fail fast on missing/invalid config.
- **Environment-specific config** via environment variables.
- **Secrets are not config.** Use a secrets manager.
- **Sensible defaults.** Zero-config means zero-friction.
- **Document every config value.**

## Testing

Before declaring any change complete:
1. **Lint & type-check** — fix every error
2. **Build check** — ensure it succeeds with no warnings
3. **Manual smoke test** — hit the affected path at least once
4. **Existing tests** — fix any that break
5. **Add tests** — at least one test for new logic

## Naming Conventions

- **Be descriptive.** `getUserById` not `get`.
- **No abbreviations.** `config` not `cfg`, `response` not `resp`.
- **Consistent casing per language.** See framework-specific skills for details.
- **Boolean variables read as a question.** `isLoading`, `hasError`, `canSubmit`.
