---
name: debugging-patterns
description: "Systematic debugging methodology — isolation, bisection, log-driven, and stack-trace analysis. Use when diagnosing bugs, interpreting errors, or investigating test failures."
---

# Debugging Patterns

## When to Use

- A test is failing and the root cause isn't obvious
- A bug report describes unexpected behavior in production
- A CI pipeline is failing intermittently
- An error message doesn't point to the actual source of the problem
- Investigating a regression introduced by recent changes

## 🔴 HARD RULE — Isolate Before You Fix

Never attempt a fix until you have isolated the minimal reproduction of the bug. Guessing at fixes without isolation leads to cascading changes that obscure the real root cause and risk introducing new bugs.

| When you see | Do this before fixing |
|---|---|
| Test failure with unclear cause | Reduce the test to the minimal input that triggers failure |
| Crash / panic with a stack trace | Find the exact line + call path, not the error message alone |
| Intermittent / flaky failure | Identify the race condition or ordering dependency first |
| Wrong output (no crash) | Pinpoint *where* the output diverges from expectation (log at every step) |
| Regression | `git bisect` to find the exact commit that introduced the bug |

## Debugging Methods

### Bisect — Binary Search Through History or Code

Use when a test passes on one commit and fails on another. Let `git bisect` find the offender.

```bash
# Start bisect
git bisect start
git bisect bad HEAD          # current commit is broken
git bisect good <last-known-good>  # known good commit

# git will checkout the midpoint — run your test, then mark:
git bisect good   # if test passes at this commit
git bisect bad    # if test fails at this commit

# When finished:
git bisect reset
```

When debugging *in code* rather than history, manually bisect: comment out half the code path, see if the bug reproduces, repeat.

### Log-Driven — Instrument Every Assumption

When the bug location is uncertain, add targeted logging (not `console.log` everywhere) to verify or falsify each hypothesis.

```python
# ❌ BAD — logging without hypothesis
print(f"x={x}, y={y}, result={result}")

# ✅ GOOD — log to test a specific hypothesis
# Hypothesis: the discount is applied after the cap check
print(f"[DEBUG cap-vs-discount] subtotal={subtotal}, cap={cap}, discount={discount}")
print(f"[DEBUG cap-vs-discount] after_cap={after_cap}, after_discount={after_discount}")
```

Use a distinct tag per hypothesis so you can grep the output.

### Rubber Duck — State the Problem Aloud

Force yourself to explain the code's expected behavior step by step. The contradiction between what the code *should* do and what it *does* often becomes obvious mid-explanation.

- Do this in the AI chat: "Here is the relevant code. The expected output is X but actual output is Y. Here is my understanding of the code flow: ..."
- The act of writing out the explanation often reveals the bug before the AI responds.

### Delta Debugging — Minimize the Input

When a large input triggers a bug, systematically reduce it to the smallest input that still reproduces:

1. Remove half the input — does the bug still reproduce?
2. If yes, the removed part is irrelevant. Repeat.
3. If no, the removed part contains the trigger. Restore and remove a different half.
4. Continue until further reduction makes the bug disappear.

### Replay — Reproduce in a Controlled Environment

For intermittent bugs, capture the exact conditions:

```bash
# Record and replay shell interactions
script -q /tmp/debug-session.log
./your-command --with-args
exit

# For flaky tests — run in a loop until failure, then inspect
for i in $(seq 1 100); do
  echo "Run $i"
  go test ./... -count=1 -run TestFlakyThing && continue
  echo "FAILED on run $i"
  break
done
```

## Anti-Patterns — Common AI Debugging Mistakes

| Mistake | Why it fails | Correct approach |
|---------|-------------|------------------|
| Fixing the symptom, not the cause | Error message changes but bug remains | Trace to root cause using the error's source, not its text |
| Changing multiple things at once | Cannot tell which change fixed or broke it | Apply one change, re-test, repeat |
| Guessing without evidence | Exhausts changes with 0% diagnostic value | Form a hypothesis, log to confirm it, then fix |
| Assuming the error message is accurate | Error messages can be misleading or wrong | Read the stack trace line numbers, not just the message |
| Skipping the minimal reproduction | Fix may not generalize or may miss edge cases | Always reduce to minimal repro first |
| Not checking the git history | The bug may already be fixed or documented | `git log --oneline -20` before debugging |

## Agent Checklist — Before Declaring a Fix Complete

- [ ] Can I reproduce the bug reliably from scratch?
- [ ] Have I traced the error to its root cause (not just the symptom)?
- [ ] Does my fix address the root cause, not mask it?
- [ ] Have I verified the fix produces the expected output?
- [ ] Have I verified no existing tests break?
- [ ] Did I add a regression test that fails without my fix?
- [ ] Did I check `git log` for prior attempts at this fix?

## Model Notes

- **7B-9B models (e.g., Llama 3.1 8B, Qwen 2.5 7B)**: Prefer the bisect method over hypothesis-driven debugging. Bisect is mechanical — follow a fixed procedure. Hypothesis-driven requires reasoning the model may not sustain. Always provide a checklist to execute step by step.
- **14B-27B models (e.g., Qwen 2.5 14B/32B, DeepSeek-Coder V2 Lite, Llama 3 70B-cutoff)**: Can handle hypothesis-driven debugging but still benefit from the log-driven method — explicit hypothesis logging helps counter confirmation bias.
- **All local models**: The "Rubber Duck" method works especially well in chat. Explaining the code to the model helps the model as much as the user. Use it proactively.
- **Anti-patterns table**: Review this *before* debugging. It prevents wasted effort on common failure modes that smaller models are especially prone to (fixing symptoms, guessing without evidence).
