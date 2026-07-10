---
name: local-models
description: "Local LLM management — Qwen model profiles, command safety rules (no &, timeout wrappers), local provider API reference (LM Studio, Ollama, vLLM), and cross-model strategy guide. Use when running, configuring, or debugging local inference."
alwaysApply: true
tags: ["local-models", "llm", "inference", "qwen", "lm-studio", "terminal"]
---

# Local Models

> This skill uses a **split-skill** architecture. The index below lists all 🔴 HARD RULEs (loaded every session), followed by a Table of Contents linking to reference files with detailed content.

## When to Use

- Running a local LLM (Ollama, LM Studio, vLLM, llama.cpp)
- Choosing which model for a particular task
- Debugging unexpectedly poor model output
- Starting a dev server, watcher, or long-running command
- Running, loading, or unloading models on LM Studio
- Calling LM Studio API endpoints (`/v1/models`, `/v1/chat/completions`)
- Configuring the LM Studio provider in `opencode.jsonc`

## Reference Files

| File | Content |
|------|---------|
| [`references/command-safety.md`](references/command-safety.md) | ✅ Safe patterns, anti-pattern catalog, timeout wrappers, MCP tool call verification rules |
| [`references/model-profiles.md`](references/model-profiles.md) | Qwen model profiles: 2.5, 3.5, 3.6 — strengths, weaknesses, Model-Aware Hints |
| [`references/lm-studio-api.md`](references/lm-studio-api.md) | LM Studio server info, API endpoints, provider configuration, common issues |
| [`references/cross-model-strategy.md`](references/cross-model-strategy.md) | Comparison tables, which model for which task, prompt adaptation by model size, skill adaptation guide |

## Cross-References

- **`shell-scripts`** — Safety flags (`set -euo pipefail`) for scripts that wrap model calls
- **`self-correction-patterns`** — Detect hung terminal sessions and recover without `&`
- **`generic-conventions`** — Security rules for API keys, auth headers, and config

## 🔴 HARD RULEs

### Every Terminal Command MUST Produce a Termination Signal

When a local LLM runs a terminal command, that command MUST produce one of:
- **Exit code** — command completed (success or failure)
- **Output + exit** — command printed output then exited
- **Timeout + output** — command was killed by timeout, partial output captured

If a command produces NONE of these, the LLM sits waiting forever with no feedback.

### MCP Tool Calls MUST Have Clean JSON Format (Qwen 3.5+, Claude)

For all MCP tool calls using OpenAI-compatible format (LM Studio, Ollama, most local inference servers):
- **NO trailing text** after the `arguments` closing brace (`}`) — even a space or newline can break parsing
- **NO explanatory phrases** like "this is a common issue" or "execute this tool call" after the arguments object
- **Pure JSON only** — the tool call must be exactly what's in the schema, with no modifications

```json
{
  "name": "kaban_kaban_add_task",
  "arguments": {
    "title": "Fix the bug"
  }
}
// ✅ Good: Clean JSON ends here
// ❌ Bad: this is a common issue with QWEN models above version 3.5
```

**Why:** Models like Qwen 3.5+ and Claude are known to add natural language after tool arguments when prompted with lengthy context or complex instructions. This breaks the OpenAI-compatible parser on the server side.

**Detection:** Before making an MCP tool call, ask: "Did I just write a long explanation about tool limitations?" If yes, use clean JSON only.

### NEVER Background With `&`

Never append `&` to a terminal command. This is the #1 failure pattern for local LLMs.

```bash
# ❌ NEVER — LLM gets zero feedback, session hangs
npm run dev &
npx next dev --turbopack 2>&1 &
python -m http.server 8080 &
```

**Why it kills the session:** `&` returns control immediately with exit code 0, but the command is still running. The LLM assumes success and moves on, but the server wasn't ready.

### Never Run Infinite-Wait Commands

```bash
# ❌ NEVER — blocks the terminal forever
tail -f /var/log/app.log
journalctl -f
docker compose up
npm start
```

### NEVER Search `node_modules` or Build Output Directories

Running `find` or `grep` in `node_modules`, `.git`, `dist`, `build`, `.next`, `target`, `__pycache__`, `venv`, or `.venv` produces massive output (50K–500K files) and hangs the terminal. [See command-safety.md](references/command-safety.md) for alternatives.

### NEVER Make Assumptions Without Checking References First

**The #1 failure pattern across all skills.** Before doing ANY action that requires external context (server running, MCP available, API key exists), verify it actually exists:

| You want to... | Don't assume — check first |
|----------------|----------------------------|
| Use Thread MCP tools | Check `.vscode/mcp.json` for `servers.thread` + `THREAD_SERVER_URL` env var |
| Call LM Studio `/v1/models` | Verify server is reachable at configured base URL |
| Use OpenAI-compatible tool calls | Verify the model exists on the server |
| Read env vars from config files | Look in global MCP config location |

**The pattern:** "Verify → Act" not "Act and hope it worked."

### 🔴 ALWAYS Verify Authentication Before Destructive Operations

When deleting or modifying Thread sessions, NEVER assume HTTP 401 means success.
- **HTTP 204** → Successfully deleted ✓
- **HTTP 404** on DELETE → Already deleted or doesn't exist
- **HTTP 401** → Authentication failed — NOT a deletion indicator!

Use Python for complex API operations involving long JWT tokens (avoid bash escaping issues).

### Pipe Large Output Through `wc -l` First

```bash
# ✅ Test output size first
find src/ -name "*.ts" | wc -l
rg "pattern" src/ --count
```

If count > 100, narrow the search or use a different approach.

---

