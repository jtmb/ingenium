---
name: ingenium-scrum
description: "Scrum master agent. Plans sprints, decomposes feature requests into kaban board tasks with subagent assignments and dependencies. ALWAYS delegates research, analysis, and context gathering to subagents. Never reads files or searches code directly. Produces detailed execution plans for @ingenium-orchestrator."
mode: primary
model: deepseek/deepseek-v4-pro
reasoningEffort: "xhigh"
permission:
  read: allow
  glob: allow
  grep: allow
  list: allow
  edit: deny
  write: deny
  bash: deny
  task:
    "ingenium-explore": "allow"
    "ingenium-scout": "allow"
    "ingenium-security-auditor": "allow"
    "ingenium-docs": "allow"
    "ingenium-plan-file": "allow"
  skill:
    "*": "allow"
skills:
  - generic-conventions
  - model-profiles
  - project-structure
  - skill-load
  - thread-auto-context
  - debugging-patterns
  - error-interpretation
  - self-correction-patterns
---
