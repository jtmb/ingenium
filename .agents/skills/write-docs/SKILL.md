---
name: write-docs
description: "Write high-quality documentation — READMEs, API docs, ADRs, architecture decision records, and AGENTS.md skill index. AUTO-INVOKE after any change to the skill system (.agents/skills/, tests/, bootstrap scripts) or when docs are stale. Do not wait for the user to ask — check docs freshness proactively after every code change. Invokes the Explore subagent by default."
---

# Write Project Documentation

## 🔴 Auto-Invoke Trigger — Do NOT Wait For the User

**This skill should be proactively invoked after ANY change to:**

- `.agents/skills/*/SKILL.md` — skill added, removed, or modified
- `.agents/scripts/` — bootstrap or hook scripts changed
- `tests/` — test infrastructure changed
- Project root files — `README.md`, `USAGE.md`, `AGENTS.md`
- `.opencode/agents/*.md` — agents added, removed, or modified
- `.opencode/plugins/*` — plugins added or modified
- `.agents/hooks/*.json` — hooks added or modified
- `opencode.json` — config changed
- `docs/agents.md` — agent architecture doc changed (self-referential)

**Workflow:** Complete the code change → check which docs are affected → update them → commit. Same turn. No waiting.

If `docs/` files are all empty `<!-- TODO -->` templates, stop and populate them first. Empty docs give false confidence.

## When to Use

Invoke this skill to write project documentation. Good docs are the difference between a project that's used and one that's abandoned. They answer "what is this?", "how do I use it?", and "why was it built this way?"

## Incremental Updates — Don't Regenerate Everything

When a specific change was made, update only the affected docs:

| Change | Docs to update |
|--------|---------------|
| Added/removed/modified a skill | `docs/ARCHITECTURE.md` (skill count, directory map), `docs/CONVENTIONS.md` (naming patterns) |
| Added/removed/modified an agent (`.opencode/agents/`) | `docs/agents.md` (agent table, profiles), `docs/ARCHITECTURE.md` (agent pipeline section) |
| Added/removed/modified hooks (`.agents/hooks/`) | `docs/ARCHITECTURE.md` (hooks section) |
| Added/removed/modified plugins (`.opencode/plugins/`) | `docs/ARCHITECTURE.md` (plugin system section) |
| Changed opencode.json or mcp.json config | `docs/ARCHITECTURE.md` (config section), `docs/TECH-STACK.md` (integrations table) |
| Changed deploy structure or added new target | `docs/ARCHITECTURE.md` (deploy separation section), `docs/TECH-STACK.md` (deploy variants table) |
| Added new dependencies | `docs/TECH-STACK.md` (dependencies table) |
| Changed naming or file patterns | `docs/CONVENTIONS.md` |
| Changed agent permissions, pipeline flow, or delegation model | `docs/agents.md` (agent profiles, lifecycle table), `docs/ARCHITECTURE.md` (agent pipeline section) |
| Added/removed top-level dirs | `docs/ARCHITECTURE.md`, `docs/README.md` |
| Changed learnings.md scope or format | `.agents/skills/learnings.md` (self-documenting), `docs/CONVENTIONS.md` (git practices section) |

**Never regenerate all docs from scratch** unless the project was freshly scaffolded. Incremental updates keep docs credible.

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

## AGENTS.md

The AGENTS.md is a redirect — it points to `/help`. The actual skill catalog lives in the `help` skill and is self-maintaining (the AI scans `.agents/skills/` at runtime).

**Keep it minimal:** a one-liner explaining the skill system + pointers to get started. No tables, no per-skill listings, nothing that rots.

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

## 🔴 HARD RULE — VARIABLES.md Required

Every project MUST have a `docs/VARIABLES.md` documenting ALL environment variables. Each entry lists:
- Variable name
- Default value (or "none" if required)
- Which file(s) use it
- Brief description

**Trigger**: Any commit that adds a `process.env` call in any file MUST update VARIABLES.md in the same commit. Never add an env var without documenting it.

## 🔴 HARD RULE — Per-Feature HOW-TO Required

Every project with multiple features or tabs MUST have a `docs/HOW-TO/` directory with one `.md` file per feature. Each HOW-TO covers:

- **What It Does** — one-sentence purpose
- **How to Use** — step-by-step instructions
- **API Endpoints** — list of REST endpoints the feature calls
- **Code Location** — where the page, API client, route handler, and core module live
- **Related Docs** — links to STYLING-GUIDE, API docs, or other relevant documentation

**Trigger**: When a new feature, page, or tab is added to a dashboard or service, create its HOW-TO document in the same commit. Do NOT wait for the user to ask.

## After Writing

1. Re-read `generic-conventions/SKILL.md` and verify your docs comply
2. Update `docs/README.md` if you added new docs
3. Check all links and code examples
