---
title: "Isolation and Debugging Methods — Bisect, Log-Driven, Rubber Duck, Delta Debugging, Replay"
impact: HIGH
impactDescription: "Prevents wasted effort on symptom-fixing and guessing without evidence"
tags: [debugging, bisect, isolation, log-driven, delta-debugging, replay]
---

## Isolation and Debugging Methods

### Bisect — Binary Search Through History or Code

Use when a test passes on one commit and fails on another. Let `git bisect` find the offender.

```bash
# Start bisect
git bisect start
git bisect bad HEAD
git bisect good <last-known-good>

# git will checkout the midpoint — run your test, then mark:
git bisect good   # if test passes at this commit
git bisect bad    # if test fails at this commit

# When finished:
git bisect reset
```

When debugging *in code* rather than history, manually bisect: comment out half the code path, see if the bug reproduces, repeat.

### Log-Driven — Instrument Every Assumption

When the bug location is uncertain, add targeted logging to verify or falsify each hypothesis.

```python
# ❌ BAD — logging without hypothesis
print(f"x={x}, y={y}, result={result}")

# ✅ GOOD — log to test a specific hypothesis
print(f"[DEBUG cap-vs-discount] subtotal={subtotal}, cap={cap}, discount={discount}")
print(f"[DEBUG cap-vs-discount] after_cap={after_cap}, after_discount={after_discount}")
```

Use a distinct tag per hypothesis so you can grep the output.

### Rubber Duck — State the Problem Aloud

Force yourself to explain the code's expected behavior step by step. The contradiction between what the code *should* do and what it *does* often becomes obvious mid-explanation.

Do this in the AI chat: "Here is the relevant code. The expected output is X but actual output is Y. Here is my understanding of the code flow: ..."

### Delta Debugging — Minimize the Input

When a large input triggers a bug, systematically reduce it to the smallest input that still reproduces:

1. Remove half the input — does the bug still reproduce?
2. If yes, the removed part is irrelevant. Repeat.
3. If no, the removed part contains the trigger. Restore and remove a different half.
4. Continue until further reduction makes the bug disappear.

### Replay — Reproduce in a Controlled Environment

For intermittent bugs, capture the exact conditions:

```bash
# For flaky tests — run in a loop until failure, then inspect
for i in $(seq 1 100); do
  echo "Run $i"
  go test ./... -count=1 -run TestFlakyThing && continue
  echo "FAILED on run $i"
  break
done
```

### Anti-Patterns — Common AI Debugging Mistakes

| Mistake | Why it fails | Correct approach |
|---------|-------------|------------------|
| Fixing the symptom, not the cause | Error message changes but bug remains | Trace to root cause using the error's source, not its text |
| Changing multiple things at once | Cannot tell which change fixed or broke it | Apply one change, re-test, repeat |
| Guessing without evidence | Exhausts changes with 0% diagnostic value | Form a hypothesis, log to confirm it, then fix |
| Assuming the error message is accurate | Error messages can be misleading or wrong | Read the stack trace line numbers, not just the message |
| Skipping the minimal reproduction | Fix may not generalize or may miss edge cases | Always reduce to minimal repro first |
| Not checking the git history | The bug may already be fixed or documented | `git log --oneline -20` before debugging |

### Agent Checklist — Before Declaring a Fix Complete

- [ ] Can I reproduce the bug reliably from scratch?
- [ ] Have I traced the error to its root cause (not just the symptom)?
- [ ] Does my fix address the root cause, not mask it?
- [ ] Have I verified the fix produces the expected output?
- [ ] Have I verified no existing tests break?
- [ ] Did I add a regression test that fails without my fix?
- [ ] Did I check `git log` for prior attempts at this fix?
