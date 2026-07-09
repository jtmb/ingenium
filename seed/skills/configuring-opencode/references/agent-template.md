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
model: provider/model-id
permission:
  # --- Tool permissions ---
  read: allow
  edit: allow|deny
  bash: allow|deny
  glob: allow|deny
  grep: allow|deny
  skill: allow
  webfetch: allow|deny
  websearch: allow|deny
  task: allow|deny  (or specific subagent: allow)
  playwright_*: allow|deny
  # --- Skill permissions ---
  skill:
    "development-conventions": allow
    "devops-conventions": allow
    "mcp-tooling": allow
    "*": deny
---
```

### Role-Specific Templates

**Orchestrator** (coordinates subagents, never writes code):
```yaml
permission:
  read: allow
  bash: allow
  glob: deny
  grep: deny
  skill: allow
  task:
    "*": deny
    "ingenium-software-engineer-fast": allow
    "ingenium-software-engineer-premium": allow
    "ingenium-qa": allow
    "ingenium-docs": allow
    "ingenium-explore": allow
    "ingenium-scout": allow
    "ingenium-security-auditor": allow
  playwright_*: allow
  skill:
    "development-conventions": allow
    "devops-conventions": allow
    "debugging-patterns": allow
    "local-models": allow
    "configuring-opencode": allow
    "skill-maintenance": allow
    "mcp-tooling": allow
    "github-cli": allow
    "*": deny
```

**Software Engineer** (writes code, runs builds):
```yaml
permission:
  read: allow
  edit: allow
  bash: allow
  glob: allow
  grep: allow
  skill: allow
  webfetch: allow
  skill:
    "development-conventions": allow
    "devops-conventions": allow
    "debugging-patterns": allow
    "configuring-opencode": allow
    "mcp-tooling": allow
    "*": deny
```

**Read-Only Agent** (reviewer, explore, security):
```yaml
permission:
  read: allow
  glob: allow|deny
  grep: allow|deny
  skill: allow
  bash: deny
  edit: deny
  skill:
    "development-conventions": allow
    "mcp-tooling": deny
    "*": deny
```
