---
title: "Agent Frontmatter Template — Correct Permission Blocks and Structure"
impact: HIGH
impactDescription: "Ensures all agents are configured with proper permissions and skill references"
tags: [agent, template, frontmatter, permissions]
---

## Agent Frontmatter Template

Use this template when creating or auditing agent definitions:

```yaml
---
name: agent-name
description: "Short description of what this agent does"
mode: subagent|primary
# Runtime model/variant is assigned centrally in opencode.json; do not add model frontmatter.
permission:
  # --- Tool permissions ---
  read: allow
  edit: allow|deny
  bash: allow|deny
  glob: allow|deny
  grep: allow|deny
  webfetch: allow|deny
  websearch: allow|deny
  task: allow|deny  (or specific subagent: allow)
  playwright_*: allow|deny
  # --- Skill permissions ---
  # Use literal skill directory names, not @mention syntax.
  skill:
    "*": allow
---
```

`@skill-name` is reserved for Required Skills lists and inline prose. A
`permission.skill` key is the actual canonical directory name, without `@`.
The supported canonical names, in repository order, are
`development-conventions`, `devops-conventions`, `database-conventions`,
`engineering-workflow`, `mcp-tooling`, `security-audit`,
`documentation`, `self-learning`, and `skill-maintenance`.

The current user-facing policy is the universal block above. For a deliberate
narrow policy, put the wildcard first and literal exceptions after it:

```yaml
permission:
  skill:
    "*": deny
    "development-conventions": allow
    "engineering-workflow": allow
```

The hidden `ingenium-llm-broker` is the exception and remains:

```yaml
permission:
  skill:
    "*": deny
```

### Role-Specific Templates

Agents with `edit: allow` or `write: allow` are writers for orchestration accounting, including documentation and browser agents. They count toward the maximum of three concurrent writers even when their task is not source-code work. In this topology, Fast, Premium, Docs, and Browser are writers; Browser is dispatchable.

### 🔴 Playwright Permission Warning

`playwright_*` includes arbitrary JavaScript evaluation and interactive browser controls, not just screenshots. Grant it only to trusted agents. Read-only visual review must follow the passive `@ingenium-qa-vision` protocol: screenshots, snapshots, console/network evidence, resize, tab inspection, and browser cleanup only; no evaluation or interaction.

**Orchestrator** (coordinates subagents, never writes code):
```yaml
permission:
  read: allow
  bash: allow
  glob: deny
  grep: deny
  task:
    "*": deny
    "ingenium-software-engineer-fast": allow
    "ingenium-software-engineer-premium": allow
    "ingenium-qa": allow
    "ingenium-docs": allow
    "browser-agent": allow
    "ingenium-explore": allow
    "ingenium-scout": allow
    "ingenium-security-auditor": allow
  playwright_*: deny
  skill:
    "*": allow
```

**Software Engineer** (writes code, runs builds):
```yaml
permission:
  read: allow
  edit: allow
  bash: allow
  glob: allow
  grep: allow
  webfetch: allow
  skill:
    "*": allow
```

**Read-Only Agent** (reviewer, explore, security):
```yaml
permission:
  read: allow
  glob: allow|deny
  grep: allow|deny
  bash: deny
  edit: deny
  skill:
    "*": allow
```
