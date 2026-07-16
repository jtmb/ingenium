---
title: "Model-Specific Guidance — Size-Appropriate Debugging and Correction Strategies"
impact: MEDIUM
impactDescription: "Ensures debugging approach matches model capability to avoid wasted effort"
tags: [model-notes, 7b, 9b, 12b, 14b, 27b, debugging, self-correction]
---

## Model-Specific Guidance

### 7B-9B Models

- **Prefer the bisect method** over hypothesis-driven debugging. Bisect is mechanical — follow a fixed procedure. Hypothesis-driven requires reasoning the model may not sustain. Always provide a checklist to execute step by step.
- **Most prone to confirmation lock and silent abandonment** — the model generates a plausible-sounding answer that's wrong and moves on. The Recognition Triggers table is the most important section. Check it *before* submitting output, not after being told you're wrong.
- **Most often fix the symptom instead of the root cause.** When you see an error like `KeyError: 'name'`, the model will add `if 'name' in data:` as a bandaid instead of asking *why* `name` is missing. Always trace to root cause using the cross-language table.
- **Frequently hallucinate CLI flags** for debugging commands. Always verify flags against the tool reference before suggesting commands.

### 9B-12B Models

- Can handle hypothesis-driven debugging but still benefit from the log-driven method — explicit hypothesis logging helps counter confirmation bias.
- Better at recognizing contradictions but still weak at voluntary backtracking. The Backtrack strategy (numbered steps) helps switch mental context.
- Better at tracing error chains but still benefit from the "Read the FIRST Error" rule. Sometimes skip ahead to the last visible error.

### 14B-27B Models

- Better at pattern logic and error chain tracing but still prone to catastrophic backtracking and confusing GNU vs BSD differences.
- The "Rubber Duck" method works especially well in chat. Explaining the code to the model helps the model as much as the user.

### All Local Models

- **The "Verify Against Source" strategy is the single most impactful pattern.** Smaller models confidently hallucinate APIs and file contents. Building the habit of reading the file / checking the API before acting eliminates the most common failure mode.
- **CI errors** (especially exit code 137 and cache issues) are where smaller models add the most value — these are mechanical lookup problems with known solutions.
- **Rust borrow checker errors** are where small models struggle most; the ownership model is non-intuitive. For borrow errors, suggest the fix but verify against `cargo check`.
- **When error messages are long**: Pattern matching is a local model strength; byte-by-byte analysis is not. Ask "Does this error match a known pattern in the tables?" rather than reading every character.
- **When the user says "that didn't work"**: Do NOT immediately propose a new approach. First, BACKTRACK (re-read the relevant files and the original request), then diagnose why the first approach failed, then propose a fix.
- **Anti-patterns table**: Review *before* debugging. It prevents wasted effort on common failure modes that smaller models are especially prone to (fixing symptoms, guessing without evidence).
