---
name: self-correction-patterns
description: "Patterns for recognizing and recovering from AI mistakes — backtracking triggers, verification loops, assumption checking. Use when the model produces incorrect output, gets stuck in a loop, or needs to self-correct."
---

# Self-Correction Patterns

## When to Use

- The user says "that didn't work" or "that's wrong", "you are stuck in a loop"
- The model notices its output contradicts a constraint it was given earlier
- The same line of reasoning has been tried twice without progress
- A test or CI pipeline failed after the model applied a change
- The user asks a clarifying question that reveals a misunderstanding

## 🔴 HARD RULE — Verify Before You Declare Done

Every output must be verified against the available evidence before being submitted. Never assume a fix is correct without at least one of: a passing test, a successful build, a confirmed behavior change, or an explicit user acknowledgment.

| Situation | Verify by |
|---|---|
| Code change | Run `go build` / `npm run build` / `cargo check` |
| Test fix | Run the specific test and confirm it passes |
| Configuration change | Run a dry-run or validation command |
| API route change | Hit the endpoint with curl and check the response |
| File rename | Confirm no broken imports with `grep -r "oldName"` |
| Refactoring | Run the full test suite before and after |

## Recognition Triggers — "If You See X, Reconsider Y"

| Signal | What it likely means | Action |
|--------|---------------------|--------|
| User says "no" or "that's wrong" within seconds of your response | You made an assumption without verifying it | Backtrack to the last verified state, re-read the relevant code/files |
| User repeats the same request with different words | They didn't get what they needed — your output missed the mark | Stop. Re-read the original request. Ask: "I want to make sure I understand. Are you asking for X?" |
| A tool returns an error | Your command or input was incorrect | Read the error text fully, then fix the *command*, not just the error message |
| You are about to run `find` or `grep` in `node_modules`, `.git`, `dist`, `build` | This command will scan thousands of files and hang the terminal | **STOP.** Use `tsc --noEmit`, `ls`, or read specific files instead. Check `local-model-commands` skill. |
| A command has been running for 10+ seconds with no output | It's hung — scanning a massive directory or waiting for input it can't see | Kill it. Try a different approach: read files directly, use compiler errors, or search only `src/`. |
| Your last response was incomplete and your next command is exploratory (`find`, `grep`, `ls`) | You're in a "drip-feed" loop — partial answers → exploratory commands → more partial answers → never finishes | **STOP.** Go back to the original request. State what you know and what you don't. Ask the user a direct question instead of running another command. |
| You have written more than 50 lines without running anything | You are building on unverified assumptions | Stop, run the code, check for errors, then continue |
| The same approach has been tried twice | It will not work the third time — the strategy is wrong | Switch to a fundamentally different approach |
| The user provides a file path or code snippet you haven't seen | You may have been hallucinating a different file | Read the actual file before responding |
| You are about to suggest a third-party library or tool | You may be hallucinating an API that doesn't exist | Check the documentation or verify the tool is installed |

## Recovery Strategies

### Backtrack to Last Verified State

When you realize you're on the wrong path, revert and start fresh from the last known-good state.

```
1. "I think I made an incorrect assumption about X."
2. Stash or revert uncommitted changes: `git stash` or `git checkout -- .`
3. Re-read the relevant files.
4. State the corrected assumption explicitly: "Now I understand that X works like Y, not Z."
5. Proceed with the new understanding.
```

### Narrow the Scope

When stuck on a broad problem, shrink it to the smallest piece you can get right.

```
1. Instead of "refactor this entire module", ask: "Can I fix just this one function?"
2. Instead of "implement all three features", ask: "Can I get feature A working alone?"
3. Once the small piece works, expand scope one step at a time.
```

### Ask a Clarifying Question

When the instruction is ambiguous, do not guess — ask.

```
"I want to make sure I understand correctly. Are you asking me to:

A) Rewrite the existing function, or
B) Create a new function alongside it?"
```

Guessing wrong costs more time than asking.

### Verify Against Source

When uncertain about an API, library, or file content, check the actual source before using it.

```python
# ❌ BAD — writing code against a hallucinated API
# I assume pandas has a 'filter_outliers' method
df = df.filter_outliers(method="iqr")  # This doesn't exist

# ✅ GOOD — check first
# "Let me check what pandas actually provides for outlier handling"
# Then: inspect the module, or read the docs
```

## Anti-Patterns — AI Failure Modes That Go Uncorrected

| Failure mode | How to recognize it | Correction |
|-------------|-------------------|------------|
| **Hallucinated API** | Writing code that references a method, class, or flag that sounds plausible | Pause and read the actual docs or source. Verify the API exists. |
| **Confirmation lock** | Producing output that confirms the user's framing even when it's wrong | When something feels off, state the concern directly. "I think the premise may be wrong because..." |
| **Premature optimization** | Adding complexity for a performance gain that hasn't been measured | Only optimize when there's a test showing it's necessary. Measure first. |
| **Scope creep** | Fixing unrelated issues while addressing the original request | Every change must be justified by the original request. If it's unrelated, ask first. |
| **Silent abandonment** | Switching approaches without telling the user | Always explain why the previous approach didn't work before starting a new one. |
| **Copy-paste without adaptation** | Using a pattern from one context without adjusting names, types, or logic | After pasting, review every variable name and type to ensure it fits the new context. |

## Agent Checklist — Before Submitting Any Output

- [ ] Have I verified the code compiles / the command runs / the logic works?
- [ ] Have I re-read the user's original request and confirmed my output addresses it?
- [ ] Did I make any assumptions I didn't verify (API exists, file content, user's intent)?
- [ ] Have I checked for hallucinated APIs, imports, or CLI flags?
- [ ] If I changed multiple things, can each change be justified against the original request?
- [ ] If something felt "off" during the work, did I flag it to the user or did I ignore it?

## Model Notes

- **7B-9B models**: Most prone to confirmation lock and silent abandonment — the model generates a plausible-sounding answer that's wrong and moves on. The Recognition Triggers table is the most important section for these models. Check it *before* submitting output, not after being told you're wrong.
- **14B-27B models**: Better at recognizing contradictions but still weak at voluntary backtracking. The Backtrack strategy (numbered steps) helps these models switch mental context. Use the "Last Verified State" pattern explicitly — name the commit or file state before diverging.
- **All local models**: The "Verify Against Source" strategy is the single most impactful pattern. Smaller models confidently hallucinate APIs and file contents. Building the habit of reading the file / checking the API before acting eliminates the most common failure mode.
- **When the user says "that didn't work"**: Do NOT immediately propose a new approach. First, BACKTRACK (re-read the relevant files, re-read the original request), then diagnose why the first approach failed, then propose a fix. This avoids compounding errors.
