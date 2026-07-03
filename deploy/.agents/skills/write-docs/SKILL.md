---
name: write-docs
description: "Write high-quality documentation — READMEs, API docs, ADRs, architecture decision records. Use after building features or when docs are stale. Invokes the Explore subagent by default."
---

# Write Project Documentation

## When to Use

Invoke this skill to write project documentation. Good docs are the difference between a project that's used and one that's abandoned. They answer "what is this?", "how do I use it?", and "why was it built this way?"

## Before You Write

1. Read the project's existing docs to understand tone and structure
2. Read `docs/ARCHITECTURE.md` for structural context
3. Run the project (if applicable) — don't document what you haven't seen work
4. Check `.agents/skills/` for framework-specific conventions

## README.md

A good README answers these questions in order:

```markdown
# Project Name
One-line description of what this does and who it's for.

## Quick Start
The fastest path to a working setup. Goal: under 5 minutes.

## Usage
Common workflows with copy-pasteable examples.

## Configuration
Environment variables, config files, feature flags.

## Development
How to set up a dev environment, run tests, contribute.

## Architecture
High-level overview — link to docs/ARCHITECTURE.md for details.

## License
```

- **Write for someone who just found your repo**: they have 30 seconds
- **Copy-pasteable examples**: every code block should be runnable as-is
- **No badges in the first screenful**: they push content below the fold
- **Keep it current**: outdated Quick Start is worse than no Quick Start

## API Documentation

For every endpoint:

```markdown
### GET /api/v1/users/:id

Returns a single user by ID.

**Path Parameters**
| Name | Type | Description |
|------|------|-------------|
| id   | UUID | User ID |

**Query Parameters**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| include | string | — | Comma-separated relations to include |

**Response (200)**
```json
{
  "id": "uuid",
  "email": "string",
  "name": "string",
  "createdAt": "ISO 8601 datetime"
}
```

**Errors**
| Code | Description |
|------|-------------|
| 404  | User not found |
```

- Every endpoint, every status code, every field documented
- Request and response examples for each status code
- Authentication requirements clearly stated

## Architecture Decision Records (ADRs)

For significant architectural decisions, create `docs/adr/NNNN-title.md`:

```markdown
# ADR-0001: Title

**Status:** proposed | accepted | deprecated | superseded
**Date:** YYYY-MM-DD
**Deciders:** @contributor1, @contributor2

## Context
What is the problem we're trying to solve?

## Decision
What did we decide? Be specific.

## Consequences
What becomes easier? Harder? What are the tradeoffs?
```

- ADRs document decisions, not just outcomes
- Always include "what we didn't choose and why"
- Link to superseded ADRs when reversing decisions

## After Writing

1. Re-read `generic-conventions/SKILL.md` and verify your docs comply
2. Update `docs/README.md` if you added new docs
3. Check all links and code examples
