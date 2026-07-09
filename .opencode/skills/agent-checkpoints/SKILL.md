---
name: agent-checkpoints
description: "State checkpoint patterns for autonomous AI agents — JSON state persistence, crash recovery flow, atomic state updates, iteration tracking. Use when building agent loops that need to survive restarts or resume from failures."
---

# Agent Checkpoints — State Persistence & Crash Recovery

## When to Use

- Building a service that runs an autonomous AI agent in a loop
- Implementing crash recovery for long-running agent loops
- Designing multi-step agent pipelines with resumable state
- Tracking iteration progress across agent restarts

## Agent Loop — State Checkpoints

Every autonomous agent follows a loop. Each iteration MUST checkpoint state so the agent survives crashes and resumes where it left off.

### The Checkpoint Pattern

```
check-in → do work → checkpoint → report → repeat
```

**Rules:**
- **Checkpoint BEFORE each phase transition.** If the agent crashes mid-phase, it resumes at the last checkpoint.
- **Checkpoint state is JSON on disk.** Simple, human-readable, no database required.
- **State file lives in the agent's own data directory.** No shared volumes. Each agent owns its state.
- **Minimum fields:** `phase`, `iteration`, `lastCompletedAt`, `batchId`.
- **On restart, read state first.** Skip completed phases, resume at the next uncompleted one.

```json
{
  "phase": "building",
  "iteration": 42,
  "lastCompletedAt": "2026-07-02T10:30:00Z",
  "batchId": "batch-7",
  "currentTask": "build-frontend",
  "completedTasks": ["plan-architecture", "setup-project", "install-deps"]
}
```

### Crash Recovery Flow

```
1. Agent starts → reads state file
2. If state.phase === "idle" → start from beginning
3. If state.phase === "building" → resume at state.currentTask
4. Skip all tasks in state.completedTasks
5. If state.phase === "complete" → start next iteration
```

**Rules:**
- Never re-execute completed work. The state file is authoritative.
- If state is corrupt or missing, start fresh and log a warning.
- State updates are atomic — write to `.tmp` then `mv` to avoid partial writes.

### Turn-Based Orchestration

When multiple agents share a single LLM backend (local LM Studio, single API key), running them simultaneously degrades quality. Use an **orchestrator** to enforce alternating access.

### Orchestrator Pattern

```
sequenceDiagram
    participant A as Agent A (planner)
    participant O as Orchestrator
    participant B as Agent B (builder)
    
    A->>O: POST /check-in (role=planner)
    O->>A: { allowed: true, turn: "planner" }
    A->>A: Run batch (N iterations)
    A->>O: POST /progress { role: "planner", done: true }
    O->>O: Flip turn to "builder"
    
    B->>O: POST /check-in (role=builder)
    O->>B: { allowed: true, turn: "builder" }
    B->>B: Run batch (N iterations)
    B->>O: POST /progress { role: "builder", done: true }
    O->>O: Flip turn to "planner"
```

### Orchestrator API

| Endpoint | Method | Purpose | Response |
|----------|--------|---------|----------|
| `/check-in` | POST | Agent requests permission to run | `{ allowed: boolean, turn: string, message: string }` |
| `/progress` | POST | Agent reports batch completion | `{ acknowledged: true, nextTurn: string }` |
| `/health` | GET | Health check | `{ status: "ok", currentTurn: string }` |

**Rules:**
- **Poll, don't push.** Agents call `/check-in` before each iteration. No webhooks, no events.
- **Exponential backoff on denial.** When `allowed: false`, sleep 5s → 10s → 20s → 30s (max 10 retries).
- **State persists to disk.** Orchestrator writes to JSON file — survives restarts.
- **BATCH_SIZE controls turn length.** After N iterations, agent calls `/progress` to flip the turn.
- **One agent type per turn.** If planner holds the turn, builder is blocked (and vice versa).

### Orchestrator State File

```json
{
  "currentTurn": "planner",
  "plannerIterations": 3,
  "builderIterations": 0,
  "batchSize": 6,
  "lastFlipAt": "2026-07-02T10:00:00Z"
}
```

## Anti-Patterns

| Pattern | Why it's wrong | Fix |
|---------|---------------|-----|
| **Two agents hitting one LLM simultaneously** | Token contention, quality degradation, timeouts | Use an orchestrator with turn-based access |
| **No state checkpoints** | Crash loses all progress, agent restarts from zero | Checkpoint JSON after every phase transition |
| **Shared volumes between agents** | Race conditions, corrupted state | Each agent has its own named volume |
| **Agent logic in Docker entrypoint** | Hard to test, impossible to resume | Entrypoint runs agent-runner.js; loop logic is in the script |
| **Hardcoded batch sizes** | Can't tune for different LLMs or workloads | BATCH_SIZE in env vars, configurable per deployment |
| **Agents calling each other directly** | Tight coupling, cascading failures | All communication through central API |
| **Retrying failed tasks indefinitely** | Blocks pipeline, wastes tokens | Max 3 retries, then mark failed and move on |

## Testing & Verification

- **Agent loop logic is testable.** Extract the loop from the CLI calls — test state transitions, checkpoint writes, crash recovery in isolation.
- **Mock the LLM.** Tests call the agent-runner with a mock CLI that returns predictable outputs.
- **Orchestrator has deterministic state.** Test turn flipping, denial responses, and state persistence without real agents.

## Cross-References

- **`configuring-opencode`** — Agent frontmatter conventions, permission lockdown
- **`build-pipelines`** — Multi-phase build pipeline patterns
- **`containerized-agents`** — Docker containerization for agent services
- **`devops-conventions`** — Shell scripting safety for agent-runner scripts
