---
title: "Learnings-to-Skills Pipeline — Plugin Architecture"
impact: HIGH
tags: [pipeline, learnings, skills, plugin, automation]
---

# Learnings-to-Skills Pipeline

The learnings-to-skills pipeline is an OpenCode plugin that automatically converts entries in the Ingenium learnings DB into skill file updates. It runs entirely inside the `learnings.ts` plugin — no subagents, no orchestrator involvement.

## Architecture

```
learnings.ts (plugin shell)
  ├── session.created event → processAll()
  ├── session.idle event → processAll() (configurable interval)
  └── process_learnings tool → processAll()
  
learnings-core.ts (pure logic)
  ├── GET /api/v1/learnings?status=pending → read unprocessed
  ├── classifyAction() → add-pattern / update-rule / new-skill / noop
  ├── executeAction() → edit .opencode/skills/*.md files
  └── PATCH /api/v1/learnings/:id { status: "processed" } → mark done
```

## How It Runs

| Trigger | When | Action |
|---------|------|--------|
| `session.created` event | Every session start | Runs `processAll()` automatically |
| `session.idle` event | After each response turn | Runs if `LEARNINGS_CHECK_INTERVAL > 0` (debounced 30s) |
| `/process-learnings` command | Manual | Calls `process_learnings` tool |

## Entry Classification

| Keyword match | Action | Effect |
|--------------|--------|--------|
| `pattern:` | `add-pattern` | Appends bullet to `## 🔴 Model-Aware Hints` section |
| `training paradigm` / `added rule` / `loop detection` | `update-rule` | Appends 🔴 HARD RULE to target file |
| `Created` + `skill` / `subsumed` / `Split into` | `noop` | Content already exists |
| Everything else | `noop` | Skipped |

## Configuration

| Env Var | Default | Description |
|---------|---------|-------------|
| `LEARNINGS_CHECK_INTERVAL` | `0` | Check every N turns. `0` = session start only |
| `INGENIUM_API_URL` | `http://localhost:4097/api/v1` | Ingenium REST API base |
