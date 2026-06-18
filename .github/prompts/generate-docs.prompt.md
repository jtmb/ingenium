---
description: "Scan the codebase and populate docs/ templates (ARCHITECTURE.md, TECH-STACK.md, CONVENTIONS.md). Use after project scaffolding or when docs are stale."
argument-hint: "Which docs to generate (all, architecture, tech-stack, conventions)"
agent: "Explore"
---

# Generate Project Documentation

You are generating documentation for this project. The `docs/` directory contains templates with `<!-- TODO -->` placeholders that need to be filled in with actual project details.

## Before You Start

1. Read `docs/README.md` to understand the docs structure
2. Read `AGENTS.md` for core conventions
3. Scan the project's source code, config files, and package manifests

## What to Generate

The user will specify which docs to generate. If they don't, generate all of them.

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
- Document git and PR conventions if `.github/` or contributing docs exist

## Output Format

For each doc generated:
1. Replace `<!-- TODO -->` comments with real content
2. Keep the existing section structure
3. Add code examples where they clarify conventions
4. Mark anything you're uncertain about with `<!-- UNCERTAIN: reason -->`

## After Generation

Update `docs/README.md` if you added or modified any doc entries.
