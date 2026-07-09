---
title: "Self-Correction — Recognition Triggers, Recovery Strategies, AI Anti-Patterns"
impact: HIGH
impactDescription: "Prevents compounding errors, confirmation lock, and wasted cycles on wrong approaches"
tags: [self-correction, recovery, backtracking, verification, anti-patterns]
---

## Self-Correction — Recognition Triggers, Recovery Strategies

## 🔴 HARD RULE — Verify Before You Declare Done

Every output must be verified against the available evidence before being submitted. Never assume a fix is correct without at least one of: a passing test, a successful build, a confirmed behavior change, or an explicit user acknowledgment.

| Situation | Verify by |
|---|---|
| Code change | Run `go build` / `npm run build` / `cargo check` |
| Test fix | Run the specific test and confirm it passes |
| Configuration change | Run a dry-run or validation command |
| API route change | Hit the endpoint with curl |
| File rename | Confirm no broken imports with `grep -r "oldName"` |
| Refactoring | Run the full test suite before and after |

### Recognition Triggers — "If You See X, Reconsider Y"

| Signal | What it likely means | Action |
|--------|---------------------|--------|
| User says "no" or "that's wrong" within seconds | You made an assumption without verifying | Backtrack to last verified state, re-read files |
| User repeats the same request with different words | They didn't get what they needed | Stop. Re-read original request. Ask clarifying question. |
| A tool returns an error | Your command or input was incorrect | Read error text fully, fix the command |
| About to run `find`/`grep` in `node_modules/` | Command will hang terminal | **STOP.** Check `local-models` skill. |
| Command running 10+ seconds with no output | It's hung | Kill it. Try different approach. |
| Same approach tried twice | It won't work the third time | Switch to fundamentally different approach |
| User provides file path you haven't seen | You may be hallucinating a different file | Read the actual file |
| About to suggest a third-party library | You may be hallucinating an API | Check docs or verify tool is installed |

### Recovery Strategies

#### Backtrack to Last Verified State

```
1. "I think I made an incorrect assumption about X."
2. Stash or revert: `git stash` or `git checkout -- .`
3. Re-read the relevant files.
4. State the corrected assumption explicitly.
5. Proceed with the new understanding.
```

#### Narrow the Scope

When stuck on a broad problem, shrink it to the smallest piece you can get right.

```
1. Instead of "refactor this entire module", ask: "Can I fix just this one function?"
2. Once the small piece works, expand scope one step at a time.
```

#### Ask a Clarifying Question

When the instruction is ambiguous, do not guess — ask.

```
"I want to make sure I understand correctly. Are you asking me to:
A) Rewrite the existing function, or
B) Create a new function alongside it?"
```

#### Verify Against Source

When uncertain about an API, library, or file content, check the actual source before using it.

```python
# ❌ BAD — writing code against a hallucinated API
df = df.filter_outliers(method="iqr")  # This doesn't exist

# ✅ GOOD — check first
# "Let me check what pandas actually provides for outlier handling"
```

### Anti-Patterns — AI Failure Modes That Go Uncorrected

| Failure mode | How to recognize it | Correction |
|-------------|-------------------|------------|
| **Hallucinated API** | Writing code referencing a method that sounds plausible | Pause and read the actual docs or source |
| **Confirmation lock** | Producing output that confirms user's framing even when wrong | State concern directly. "I think the premise may be wrong..." |
| **Premature optimization** | Adding complexity for unmeasured performance gain | Only optimize when test shows it's necessary |
| **Scope creep** | Fixing unrelated issues while addressing the original request | Every change justified by original request |
| **Silent abandonment** | Switching approaches without telling the user | Always explain why previous approach didn't work |
| **Copy-paste without adaptation** | Using pattern without adjusting names/types/logic | Review every variable name and type after pasting |

### Agent Checklist — Before Submitting Any Output

- [ ] Have I verified the code compiles / the command runs / the logic works?
- [ ] Have I re-read the user's original request and confirmed my output addresses it?
- [ ] Did I make any assumptions I didn't verify?
- [ ] Have I checked for hallucinated APIs, imports, or CLI flags?
- [ ] If I changed multiple things, can each change be justified against the original request?
- [ ] If something felt "off", did I flag it to the user or ignore it?
