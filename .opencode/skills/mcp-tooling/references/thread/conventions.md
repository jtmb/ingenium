---
title: "Thread MCP Conventions — Priority, Tags, Rules [RETIRED]"
impact: MEDIUM
impactDescription: "[RETIRED — Replaced by Docs RAG] Standardizes priority levels, tag naming, and behavioral rules for Thread usage"
tags: [thread, mcp, conventions, priority, tags, retired]
---

## Thread MCP Conventions

> 🔴 **RETIRED**: Thread has been replaced by the Ingenium Docs RAG system. This content is retained for reference only until full removal is verified. Use `ingenium_docs_*` tools for persistent memory.

### Priority Guidelines

| Priority | When to use |
|----------|-------------|
| 9-10 | Critical decisions, security rules, user constraints |
| 7-8 | Design decisions, architecture choices, preferences |
| 5-6 | Useful context, bug lessons, code patterns |
| 3-4 | General notes, observations |
| 0-2 | System markers, low-signal entries |

### Tag Convention

**Shared Infrastructure Tags (default global session):**
- `architecture` — system design, component layout
- `decision` — any design or implementation choice
- `preference` — user style/approach preferences
- `bug` — bug findings and fixes
- `pattern` — reusable code patterns discovered
- `reference` — documentation, spec links, API references
- `docs-import` — documentation website imports

**Workspace-Specific Tags:**
- `project-decision` — decisions about this specific codebase
- `bug-fix` — bug fixes in this project
- `workspace-preference` — user preferences for this repo
- `local-pattern` — patterns discovered only in this workspace

**General Tags:**
- `summary` — session summaries
- `export` — `/export` snapshots of git state, decisions, and counts
- `transcript` — full conversation transcript exports
- `full-session` — complete session context dumps

**Rule of thumb:** If it's useful to any project (including future ones), put it in the default global session. If it only matters for this specific repository, use a workspace session.

### 🔴 Never Rules

- Don't create a session unless the user explicitly says "create a session"
- Don't pass `session` param to `thread_*` tools unless user explicitly asks
- Don't create entries without meaningful content (no "OK" or "Got it" entries)
- Don't save the user's secrets, passwords, tokens, or API keys
- Don't spam — if you just saved the same decision 2 minutes ago, don't save it again
- Don't skip Thread save before calling task_complete — always save context first
- Don't ask permission to use Thread — just use it silently
- Don't skip the initialization — if Thread tools aren't available, fix it proactively
- Don't start, build, or manage the Thread server — that's the user's job. Only check if it's reachable.
