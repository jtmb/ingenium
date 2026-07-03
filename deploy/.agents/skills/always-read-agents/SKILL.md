---
name: always-read-agents
description: "Load the project's skill system before any code work. Invoke this at the start of every coding session to discover conventions, framework rules, and project structure."
---

# Always Read Agent Rules

## When to Use

Invoke this skill at the **start of every coding session** or whenever you begin work in a new project. It ensures you've discovered all applicable conventions before making changes.

## Procedure

1. **Scan `.agents/skills/`** for all available skills. This is the source of truth for:
   - Core conventions (in `generic-conventions/SKILL.md`)
   - Framework-specific rules (in `{framework}-conventions/SKILL.md`)
   - Cross-cutting rules (containers, SQL, API design, Kubernetes, shell scripts)
   - Task workflows (generate docs, write docs, update skills)
   - Project context (in `repo-context/SKILL.md`)

2. **Read `generic-conventions/SKILL.md`** — it contains mandatory rules for:
   - Code comments (every function/class/exported symbol)
   - Documentation (always keep docs in sync)
   - Project structure (feature grouping, one concern per file, no circular deps)
   - Testing (lint, type check, build, smoke test, run tests)
   - Reusable code (DRY, shared utilities, composition over inheritance)
   - Secure coding (no secrets, validate input, least privilege, never eval)
   - Git & version control (atomic commits, meaningful messages)
   - Observability (structured logging, metrics, health checks)
   - Performance (measure before optimizing, N+1 is a bug, timeouts, pagination)
   - Error handling (never ignore errors, wrap with context, typed errors)
   - Configuration (one config module, validate at startup, sensible defaults)
   - Naming conventions (descriptive, no abbreviations, consistent casing)

3. **Read `repo-context/SKILL.md`** for project-specific identity, tech stack, and build commands.

4. **Read any referenced docs.** Typicially:
   - `docs/ARCHITECTURE.md` — project structure and data flow
   - `docs/TECH-STACK.md` — dependencies and versions
   - `docs/CONVENTIONS.md` — naming, file organization, error handling

## After Reading

5. **Check for framework-specific skills** relevant to the files you're editing.

6. **After making changes**, re-read relevant skills and update docs in the same turn.

7. **If you discover a new pattern** not covered by an existing skill, propose creating one using the `update-skills` skill.
