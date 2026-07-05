---
name: repo-context
description: "Provide project context to the AI — identity, tech stack, docs map, conventions overview, build/test commands. Use when starting a new coding session or needing to refresh context."
---

# Project Context

## When to Use

Invoke this skill when starting a new coding session or when you need to refresh your understanding of the project.

## How to Use This Context

1. Read `docs/README.md` for the full docs map
2. Read the docs relevant to your current task
3. Follow conventions in `docs/CONVENTIONS.md`
4. After making changes, update the relevant docs

## Project Identity

<!-- TODO: Fill in with your project's details -->
- **Name**: {project-name}
- **Primary language**: {language}
- **Primary framework**: {framework}
- **Description**: {one-line description of what this project does}

## Key Docs

| Doc | Content |
|-----|---------|
| `docs/ARCHITECTURE.md` | Project structure, key components, data flow |
| `docs/TECH-STACK.md` | Dependencies, versions, why each was chosen |
| `docs/CONVENTIONS.md` | Naming, file organization, error handling, git practices |

## Build & Test

Run the commands documented in `docs/TECH-STACK.md` and framework-specific instruction files.

## Working in This Repo

When making changes:
1. Read `.agents/skills/generic-conventions/SKILL.md` for core rules
2. Check `.agents/skills/` for framework-specific conventions
3. Update docs in the same turn as code changes
4. Run the project's full test/type-check/lint suite before declaring done
