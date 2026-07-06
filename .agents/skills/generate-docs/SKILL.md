---
name: generate-docs
description: "Scan the codebase and populate docs/ templates (ARCHITECTURE.md, TECH-STACK.md, CONVENTIONS.md). Use after project scaffolding or when docs are stale."
---

# Generate Project Documentation

## When to Use

Invoke this skill to generate project documentation from templates. Useful after project scaffolding or when existing docs are stale. By default, uses the **Explore** subagent for codebase scanning.

## Before You Start

1. Read `docs/README.md` to understand the docs structure
2. Read `.agents/skills/generic-conventions/SKILL.md` for core conventions
3. Scan the project's source code, config files, and package manifests

## What to Generate

### ARCHITECTURE.md
- Scan the directory tree for the project structure
- Identify key modules, services, and their responsibilities
- Trace data flow through the codebase
- Document external dependencies and deployment patterns

### TECH-STACK.md
- Read `package.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`, etc.
- List all major dependencies with versions
- For each key dependency, explain what it does and why it's used
- Document development tools (linters, formatters, test frameworks)

### CONVENTIONS.md
- Observe naming patterns across the codebase
- Identify file organization conventions
- Note error handling patterns
- Document git and PR conventions if contributing docs exist

## Output Format

For each doc generated:
1. Replace `<!-- TODO -->` comments with real content
2. Keep the existing section structure
3. Add code examples where they clarify conventions
4. Mark anything you're uncertain about with `<!-- UNCERTAIN: reason -->`

## After Generation

Update `docs/README.md` if you added or modified any doc entries.
