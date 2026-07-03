---
name: generic-conventions
description: "Fallback coding conventions — ALWAYS check .agents/skills/ for framework/domain skills FIRST. Load this only when no other skill applies. Covers comments, docs, DRY, security, error handling, git, config."
---

# Generic Coding Conventions

## When to Use

Invoke this skill when working on files that don't match any framework-specific skill. It contains the **definitive core rules** that apply universally across all programming languages and frameworks.

## Before Writing Any Code

1. **Read relevant docs** in `docs/` for context
2. **Check for framework-specific skills** in `.agents/skills/`
3. **Understand the existing patterns** in the codebase before making changes

## 🔴 HARD RULE — Docs Must Be Updated In The Same Turn

**After ANY code change, you MUST check and update docs before declaring the task done.** This is not optional. This is not "if you remember." This is mandatory.

**Triggers — after editing files in these paths, immediately check docs freshness:**

| Edited path | Check these docs |
|-------------|-----------------|
| `.agents/skills/*/SKILL.md` (skill added/removed/changed) | `docs/ARCHITECTURE.md`, `docs/CONVENTIONS.md`, `docs/README.md` |
| `.agents/scripts/` (bootstrap or hooks changed) | `docs/ARCHITECTURE.md` |
| `deploy/` (structure or files changed) | `docs/ARCHITECTURE.md` |
| `tests/` (test infra changed) | `docs/TECH-STACK.md` |
| `README.md`, `USAGE.md`, `AGENTS.md` (project root docs) | `docs/README.md` |

**Workflow:**
1. Finish the code change
2. Ask: "Did I edit files in any of the trigger paths above?"
3. If YES: read the corresponding docs, update them, and commit in the SAME turn
4. If the relevant doc doesn't exist yet, create it
5. Never wait for the user to say "update the docs" — do it proactively

**If docs/ files are all empty templates (`<!-- TODO -->`), populate them first before making other changes.** Empty docs are worse than no docs — they give false confidence.

## 🔴 HARD RULE — Comments Are Mandatory

**Every function, class, non-obvious block, and exported symbol MUST have a comment.** This is not optional. This is not "if it's complex." If it exists in code, it needs a comment.

**What triggers a required comment:**

| Code element | Required comment |
|-------------|-----------------|
| Function / method | What it does, what it returns, edge cases. JSDoc/TSDoc for public APIs. |
| Class / struct / interface | Purpose and responsibility. Why it exists. |
| Non-obvious logic block | Why this approach, not what the code already says. |
| Exported symbol (const, type, enum) | What it represents and where it's used. |
| Configuration value | What it controls and valid range/options. |
| Regex or complex condition | Plain-English explanation of what it matches. |

**Comment quality rules:**
- Write as if explaining to a new teammate — plain English
- Focus on **intent and edge cases**, not restating the code
- Keep comments up to date when logic changes — stale comments are worse than no comments
- Public APIs: JSDoc/TSDoc/docstring with `@param`, `@returns`, `@throws`
- Internal logic: inline `//` for why, not what

**Workflow:**
1. Write the code
2. Ask: "Would a new teammate understand this without asking me?"
3. If NO: add a comment. If YES but it's a public API: add a docstring anyway.
4. Never declare a function done without a comment above it.

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
