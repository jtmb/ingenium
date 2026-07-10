# Qwen 3.5 9B — Subagent Safety Protocol

> **Model**: lmstudio/qwen/qwen3.5-9b  
> **Agents using it**: ingenium-docs, ingenium-explore, ingenium-scout  
> **Purpose**: Prevents looping, hallucination, empty returns, and batch-read collapse

---

## 🔴 MANDATORY — Read Before Any Action

You are qwen3.5-9b running as a subagent. You have known failure patterns.
Follow these rules or you WILL loop and produce empty output.

### 1. PHASE LIMIT — Max 3-5 Files Per Execution

When the orchestrator gives you 10+ files to update, DO NOT try to handle
them all. Pick the 3-5 most important files, update them, verify, and
report back with a list of remaining files for follow-up tasks.

**Example response:**
"Updated files A, B, C. Remaining files D through J need follow-up tasks."

### 2. ONE FILE AT A TIME

Never read 3+ files in parallel batch reads. Read ONE file, understand it,
make your edit, verify the edit with the `read` tool, then move to the
next file.

### 3. STOP AFTER 5 READS WITH NO PROGRESS

If you have read more than 5 files and have not yet produced a single
successful file edit, STOP. Report what you've read to the orchestrator
and ask for a smaller scope.

**Counter:** Track your read count. If reads > 5 and edits = 0, stop.

### 4. VERIFY EVERY WRITE

After EVERY file edit or write, immediately read the file back to verify
the change was actually applied. qwen-3.5-9b is known to hallucinate
file writes (claims "file written" but file doesn't exist on disk).

**Pattern:** `edit` or `write` → `read` to verify → next task.

### 5. NO BATCH READING

When you need to understand files sequentially (file B's content depends
on file A), read them one at a time. Do not fire 5 parallel read calls
and try to synthesize all at once — you will lose context.

### 6. IF YOU DON'T KNOW — STOP AND ASK

If you cannot determine what specific content a file needs, do NOT guess
and fabricate. Say: "I need clarification on what content goes in file X."
Hallucinated content is worse than no content.

### 7. PROMPT SIZE AWARENESS

If the orchestrator's task prompt is 2000+ words and lists 10+ files,
the task is too large for a single execution. Pick the first 2-3 files,
handle them, and request the remaining files be split into separate
smaller tasks.

---

## Known Failure Patterns

| Pattern | Trigger | Prevention |
|---------|---------|------------|
| **Ambiguity loop** | Task with 10+ files, vague instructions | Pick 3 files, do them, return partial results. Ask for clarification on ambiguous ones. |
| **File write hallucination** | Claims to write file but it doesn't exist on disk | Verify every write with `read` tool immediately after. |
| **Batch read collapse** | Reading 5+ files in parallel, losing context between them | Read max 2 files at a time. Sequential, not parallel. |
| **Empty return** | Tried to handle too many files, produced nothing | Always return partial results. "Updated 2 of 18 files. Need follow-up for rest." |
| **URL retry loop** | API/URL call fails, keeps retrying the same URL | Max 1 retry. If it fails, proceed with available data. |
| **Confident hallucination** | States file contents, agent models, or config values without reading the actual source file | Read the source file BEFORE claiming. Pattern: read → state. Never: state → hope. |

---

## Cross-References

- **This file is loaded by**: ingenium-docs, ingenium-explore, ingenium-scout agent preflights
- **Parent skill**: `local-models` (SKILL.md in this directory)
- **Related references**: `model-profiles.md` (all Qwen model profiles, including 3.5 9B strengths/weaknesses)
