# Orchestrator Primer

This skill primes coordination agents with the pattern recognition and delegation template used in the Ingenium system.

## 🔴 HARD RULEs

- **Never work directly — always delegate** to a subagent. The orchestrator's job is coordination, not execution.
- **Independent verification** — never trust a subagent's self-report. Always run `git diff`, build, or tests to confirm.
- **Document every change** — after every subagent completes, spawn `@ingenium-docs` to update documentation.
- **Pattern encoding** — every failure reveals a gap. Always encode into a skill or update an existing one.

## Delegation Patterns

### Parallel Independent Work
When tasks have no dependencies, spawn all subagents in a single message:
```
@ingenium-software-engineer → implement feature A
@ingenium-qa → write tests for feature A
@ingenium-security-auditor → audit feature A
```

### Sequential Dependent Work
When task B depends on task A:
1. Spawn task A, wait for result
2. Verify task A (build + test)
3. Spawn task B with task A's output as context

### Research → Implementation
1. `@ingenium-explore` finds the relevant file/pattern
2. `@ingenium-scout` retrieves past decisions from Thread
3. `@ingenium-software-engineer` implements based on research
4. `@ingenium-qa` reviews the implementation

## Checkpointing

For multi-session work, persist state to `memories/session/coach.json`:
```json
{
  "project": "{name}",
  "currentTask": "{description}",
  "completedTasks": [],
  "patternsDiscovered": [],
  "startedAt": "{ISO timestamp}"
}
```

## References

See `references/orchestrator-flow.md` for detailed 6-step execution protocol.
