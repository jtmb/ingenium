# Agent Architecture

## Overview

Eight agents total: 2 primary, 6 subagents. The **planner** analyzes and produces plans (read-only). The **orchestrator** executes plans with full tool access. Subagents handle specialized tasks.

## Agent Table

| Agent | Type | Model | Provider | Access | Purpose |
|-------|------|-------|----------|--------|---------|
| **ingenium-planner** | Primary | `deepseek/deepseek-v4-pro` | DeepSeek API | Read-only | Mastermind — analyzes, delegates research, produces execution plan |
| **ingenium-orchestrator** | Primary | `deepseek/deepseek-v4-flash` | DeepSeek API | Full R/W | Executor — launches subs, writes code, runs commands |
| **ingenium-explore** | Subagent | `deepseek/deepseek-v4-flash` | DeepSeek API | Read-only | Codebase search (paid Flash, max reasoning) |
| **ingenium-explore-zen** | Subagent | `lmstudio/qwopus3.5-9b-coder` | LM Studio | Read-only | Codebase search (local model) |
| **ingenium-scout** | Subagent | `lmstudio/qwopus3.5-9b-coder` | LM Studio | Read-only | Thread/RAG persistent memory |
| **ingenium-review** | Subagent | `opencode/deepseek-v4-flash-free` | OpenCode Zen | Write tests | Code review + test authoring |
| **ingenium-docs** | Subagent | `opencode/deepseek-v4-flash-free` | OpenCode Zen | Write docs | Documentation + skill updates |
| **security-auditor** | Subagent | *(default)* | *(default)* | Read-only | Security audit |

## Workflow

```
User Request
    │
    ▼
┌──────────────────────────────────────────────────────┐
│  @ingenium-planner  (DeepSeek V4 Pro)                 │
│  • Reads codebase via @ingenium-explore                 │
│  • Checks Thread via @ingenium-scout                     │
│  • Requests reviews via @ingenium-review                 │
│  • Produces detailed plan                              │
└──────────────────────┬───────────────────────────────┘
    │
    │  User switches to orchestrator
    ▼
┌──────────────────────────────────────────────────────┐
│  @ingenium-orchestrator  (DeepSeek V4 Flash, max reas)│
│  • Executes plan step by step                         │
│  • Delegates specialized work to subagents            │
│  • Writes code, runs commands, commits                │
│  • Verifies tests pass                                │
│  • Saves decisions to Thread                          │
└──────────────────────────────────────────────────────┘
```

## Compute Split

| Resource | Agents | Count |
|----------|--------|-------|
| DeepSeek V4 Pro (API) | `ingenium-planner` | 1 |
| DeepSeek V4 Flash (API) | `ingenium-orchestrator`, `ingenium-explore` | 2 |
| DeepSeek V4 Flash (OpenCode Zen free) | `ingenium-review`, `ingenium-docs` | 2 |
| qwopus 3.5 9B Coder (LM Studio) | `ingenium-explore-zen`, `ingenium-scout` | 2 |

## Subagent Invocation

Primary agents invoke subagents via the Task tool. All subagents can also be invoked directly via `@` mention.

| Subagent | `@` mention | Typical use |
|----------|-------------|-------------|
| ingenium-explore | `@ingenium-explore` | Search codebase for files, patterns, definitions |
| ingenium-explore-zen | `@ingenium-explore-zen` | Same as above, local qwopus model |
| ingenium-scout | `@ingenium-scout` | Thread/RAG context lookups and saves |
| ingenium-review | `@ingenium-review` | Code review + write tests |
| ingenium-docs | `@ingenium-docs` | Write docs, update skills |
| security-auditor | `@security-auditor` | Security vulnerability audit |
