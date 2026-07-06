---
name: local-models
description: "Local LLM management — model profiles (Qwen, Gemma, DeepSeek), command safety rules (no &, timeout wrappers), LM Studio API reference, and cross-model strategy guide. Use when running, configuring, or debugging local inference."
alwaysApply: true
tags: ["local-models", "llm", "inference", "qwen", "gemma", "deepseek", "lm-studio", "terminal"]
---

# Local Models

## When to Use

- You are running a local LLM (Ollama, LM Studio, vLLM, llama.cpp) and want to know its capabilities
- A skill's generic guidance needs model-specific adaptation
- You're choosing which model to use for a particular task (coding, reasoning, chat, structured output)
- You're debugging why a model produced unexpectedly poor output
- You want to tailor prompts, chain-of-thought, or tool usage patterns to the specific model
- You need to start a dev server, watcher, daemon, or any long-running process from a terminal
- You are about to run a command that "keeps running" (no natural exit)
- You catch yourself appending `&` to a terminal command
- A previous command ran without producing terminal output and the LLM is stuck waiting
- Running, loading, or unloading models on the LM Studio server
- Calling any LM Studio API endpoint (`/v1/models`, `/v1/chat/completions`, `/v1/embeddings`)
- Connecting an agent or plugin to the local inference server
- Using vision/image analysis via a local vision model
- Troubleshooting model load failures, timeouts, or auth errors
- Configuring the LM Studio provider in `opencode.jsonc`

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

**Why:** Models like Qwen 3.5+ and Claude are known to add natural language after tool arguments when prompted with lengthy context or complex instructions. This breaks the OpenAI-compatible parser on the server side, causing:
- Tool call rejection with "invalid format" errors
- Silent failures where nothing happens

**Detection:** Before making an MCP tool call, ask: "Did I just write a long explanation about tool limitations?" If yes, use clean JSON only — no explanatory text before or after.

### NEVER Background With `&`

Never append `&` to a terminal command to "run it in the background." This is the #1 failure pattern for local LLMs.

```bash
# ❌ NEVER DO THIS — the LLM gets zero feedback, session hangs
npm run dev &
npx next dev --turbopack 2>&1 &
python -m http.server 8080 &
go run main.go &
cargo watch -x run &
```

**Why it kills the session:**
- `&` returns control immediately — the command appears to "finish" with exit code 0
- But the command is still running — there's no terminal output to confirm success
- The LLM assumes the command completed and moves on, but the server wasn't ready
- Or the LLM tries to interact with the backgrounded process, which is impossible from a new terminal

### Never Run Infinite-Wait Commands

Some commands never exit by design. These also break the termination signal rule:

```bash
# ❌ NEVER DO THIS — blocks the terminal forever
tail -f /var/log/app.log
journalctl -f
docker-compose up       # unless you expect it to fail/exit quickly
npm start               # dev servers, production servers
python server.py        # blocking servers
nginx -g 'daemon off;'  # foreground server
```

### 🔴 NEVER Search `node_modules` or Build Output Directories

Running `find` or `grep` in `node_modules`, `.git`, `dist`, `build`, `.next`, `target`, `__pycache__`, `venv`, or `.venv` produces massive output (50K–500K files) and hangs the terminal.

### 🔴 ALWAYS Verify Authentication Before Destructive Operations

**When deleting or modifying Thread sessions, NEVER assume HTTP 401 means success.** The auth token in `opencode.json` must be used correctly:

```bash
# CORRECT way to read token (safe, doesn't expose full value):
grep 'THREAD_API_TOKEN' ~/.config/opencode/opencode.json | \
  sed 's/.*"THREAD_API_TOKEN": "\([^"]*\)".*/\\1/' > /tmp/thread_token.txt

# Then use it:  
curl -X DELETE "http://localhost:5000/api/v1/sessions/<id>" \
  -H "Authorization: Bearer $(< /tmp/thread_token.txt)"
```

**Never copy-paste the full token into scripts or config files.** The JWT contains sensitive claims including `sub: admin`. If the token is exposed, it can be used by anyone.

### 🔴 Parse HTTP Status Codes Correctly (Don't Assume 401 = Success)

When making DELETE requests to Thread API:
- **HTTP 204** → Successfully deleted ✓  
- **HTTP 404** on DELETE endpoint → Already deleted OR session doesn't exist  
- **HTTP 401** → Authentication failed (wrong token, expired, or missing header) — NOT a deletion indicator!

The error pattern I made earlier:
```bash
# INCORRECT interpretation:
curl -s -X DELETE "..." | grep -q "401" && echo "✓ Deleted"  # WRONG!
# Correct approach:
if [ "$http_code" = "204" ]; then echo "✓ Deleted"; fi
elif [ "$http_code" = "401" ]; then echo "? Auth failed, token may be invalid"; fi
```

### 🔴 Use Python for Complex API Operations (Avoid Bash Escaping Issues)

The JWT token is a long string (~128 characters). Bash struggles with:
- Token extraction via `sed` and `grep` pipelines  
- Long environment variable assignments  
- Multi-line curl command construction  

**Use Python instead:**
```python
import subprocess, json
with open('/home/brajam/repos/gh-llm-bootstrap/opencode.json') as f:
    config = json.load(f)
token = config['mcp']['thread']['environment'].get('THREAD_API_TOKEN', '')
response = subprocess.run(['curl', '-s', url, '-H', f'Authorization: Bearer {token}'], ...)
```

Python handles long strings safely without shell escaping problems. The `opencode.json` file stores the token securely — read it programmatically, don't manually copy-paste values into scripts or config files.

### 🔴 Always Verify Before Acting (The "Verify → Act" Pattern)

From local-models skill:
1. **Check server health**: `curl http://localhost:5000/api/v1/health`  
2. **Parse response properly** — don't just check HTTP status code  
3. **Use Python for complex operations** that involve long strings or multiple API calls  
4. **Document mistakes in learnings.md and this skill** so future sessions avoid the same errors

**Why:** This is a pattern of making assumptions about where code exists without verification first. The same mistake happens everywhere:
- Assuming a server is running → no health check before curl
- Assuming an MCP server is available → no config lookup  
- Assuming a key/token location → no global config check
- Assuming documentation paths exist → no robots.txt or sitemap probe

**The Fix:** Always verify BEFORE acting. Check what's actually there first:
1. Look at `.vscode/mcp.json` — does `thread` server already exist? Don't bootstrap if it does
2. Call `curl http://localhost:5000/api/v1/health` — is Thread reachable? If not, don't assume you'll fix it later  
3. Check global MCP config location for existing tokens/configs — don't guess paths or keys

### NEVER Make Assumptions Without Checking References First

**This is the #1 failure pattern across all skills.** Before doing ANY action that requires external context (server running, MCP available, API key exists), verify it actually exists:

| You want to... | Don't assume — check first |
|----------------|----------------------------|
| Use Thread MCP tools | Check `.vscode/mcp.json` for `servers.thread` + `THREAD_SERVER_URL` env var |
| Call LM Studio `/v1/models` | First verify server is reachable at configured base URL (don't assume port 1234) |
| Use OpenAI-compatible tool calls | Verify the model exists on the server, don't just send a request hoping it works |
| Read env vars from config files | Look in global MCP config location — don't guess paths or key names |

**The pattern:** "Verify → Act" not "Act and hope it worked."

```bash
# ❌ NEVER DO THIS — scans 50,000+ files, hangs terminal
find node_modules/next/dist -name "*.d.ts"
find . -name "*.js" | head -20        # even with head, find churns through node_modules first
grep -r "someFunction" node_modules/   # recursive grep in dependencies = death
rg "pattern" node_modules/             # ripgrep is faster but still scans garbage files
```

**What to do instead:**

| You want to... | Use this instead |
|----------------|-----------------|
| Find type declarations for an import | `tsc --noEmit` — let the compiler tell you what's wrong |
| Check what a package exports | `cat node_modules/<pkg>/package.json` and look at `"exports"` or `"types"` |
| Find a function definition in your own code | `rg "function name" src/` — only search YOUR source |
| Check if a type exists in a package | Read the package's docs, or `ls node_modules/<pkg>/dist/` (no recursive find) |
| See all files in a specific package | `ls node_modules/<pkg>/` (flat listing, not recursive) |

### Pipe Large Output Through `wc -l` First

Before running any command that might produce large output, measure it first:

```bash
# ✅ Test output size first
find src/ -name "*.ts" | wc -l        # How many files?
rg "pattern" src/ --count              # How many matches?
```

If the count is > 100, the LLM cannot process it all. Narrow the search or use a different approach. If the count is reasonable, pipe through `head`:

```bash
# ✅ Run with head protection after confirming size
find src/ -name "*.ts" | head -50
rg "pattern" src/ | head -20
```

---

## Part 1: Command Safety

### ✅ SAFE Patterns

#### Pattern 1 — Run Sync, Expect Exit

For build, lint, test, install, and other one-shot commands, run them synchronously and wait for the exit code. This is the DEFAULT and works perfectly with local LLMs.

```bash
npm run build
cargo test
pytest -x
go vet ./...
npx eslint src/
```

#### Pattern 2 — Timeout Wrapper

For commands that need to run briefly to verify they work, wrap with `timeout`:

```bash
# Start the server, let it run 3 seconds, then kill it
timeout 3 npx next dev --turbopack 2>&1 || true

# The LLM sees: "ready started server on 0.0.0.0:3000" then exits
# This proves the server CAN start without leaving it running
```

The `|| true` prevents the timeout's exit code 124 from being treated as a failure.

#### Pattern 3 — Start in Background, Verify, Then Use

If you genuinely need a background process (rare for LLMs), use a multi-step pattern:

```bash
# 1. Start in background
npx next dev --turbopack > /tmp/nextdev.log 2>&1 &
DEV_PID=$!
echo "Server PID: $DEV_PID"

# 2. Poll until ready
for i in $(seq 1 30); do
    if grep -q "ready started server" /tmp/nextdev.log 2>/dev/null; then
        echo "Server is ready on port 3000"
        break
    fi
    sleep 1
done

# 3. Now interact with the server
curl http://localhost:3000
```

#### Pattern 4 — Use Built-in Terminal Tooling Correctly

When using a terminal tool that supports sync/async modes, use sync mode for all one-shot commands. Only use async mode for servers/watchers — the tool handles the backgrounding correctly. The LLM should NOT append `&` on top of the tool's built-in mode handling.

```bash
# ✅ Good — the tool handles backgrounding, you just run the command
# (async mode)
npx next dev --turbopack

# ❌ Bad — double-backgrounding breaks tool feedback
npx next dev --turbopack &
```

### Anti-Pattern Catalog — Common Backgrounding Mistakes

| The LLM writes... | Why it's wrong | What to write instead |
|-------------------|---------------|----------------------|
| `npm run dev &` | No terminal output, hangs session | `timeout 5 npm run dev 2>&1 \|\| true` (Pattern 2) |
| `npx next dev --turbopack 2>&1 &` | Zero feedback, session stuck | `timeout 5 npx next dev --turbopack 2>&1 \|\| true` |
| `python -m http.server &` | Server starts silently, no confirmation | `timeout 3 python -m http.server 8080 2>&1 \|\| true` |
| `go run main.go &` | No idea if it compiled or bound a port | Run sync: `go run main.go` (if short-lived) or use Pattern 3 |
| `cargo watch -x run &` | Watcher runs indefinitely, no signal | Not suitable for LLM automation — run `cargo run` instead |
| `docker-compose up &` | Services start, no ready signal | Use Pattern 3 with polling, or `timeout 10 docker-compose up 2>&1 \|\| true` |
| `tail -f /some/log &` | Never exits, useless to LLM | Use `tail -n 50 /some/log` (one-shot) or `grep` for specific content |

### Detection Trigger — "Will This Command Ever Exit?"

Before running ANY terminal command, ask:

1. **Does this command exit on its own?** — YES → run sync (Pattern 1) ✓
2. **Does this command run until killed?** (server, watcher, daemon, tail -f) — YES → use Pattern 2 (timeout) or Pattern 3 (background + verify)
3. **Am I appending `&` to "keep it running"?** — YES → STOP. Delete the `&`. Use Pattern 2 or 3.

If the answer to "Will this command exit on its own?" is "I don't know," run it with a timeout to be safe.

### Verification Checklist

- Every terminal command produces one of: exit code, output + exit, or timeout + output
- No `&` appears at the end of any terminal command
- No `tail -f`, `journalctl -f`, or other infinite-follow commands
- Server commands use `timeout N` wrapper or Pattern 3 (background + poll)

### 🔴 MCP Tool Call Verification Rules (Mandatory)

**Before claiming success on ANY MCP tool call, you MUST verify the actual response.** This is the #1 failure pattern across all skills. When a command fails silently or returns an error, you must:
1. Parse the full JSON response (even if it's an error object)  
2. Check for specific error patterns before declaring completion  
3. If no output appears, assume MCP server is unreachable and ask user to verify  

**What triggers verification:**

| Scenario | What to do |
|----------|------------|
| Tool call succeeds but response is empty or null | Read the actual file to confirm it was written (don't just trust exit code) |
| Tool call fails with `command not found` / `connection refused` | Show the actual error message, don't claim "success" |
| MCP server returns HTTP 404/503 | Parse the JSON body for specific reason ("Model not loaded", "Server crashed") |
| User expects a value (like file path) but gets nothing | Check if the tool actually returned something; use `Read` to verify file exists |

**Mandatory pre-flight check before every MCP call:**

```bash
# ✅ Good - always verify server is reachable first
curl -s http://localhost:5000/api/v1/health || echo "Server not running, cannot proceed"

# ❌ Bad - no health check before calling MCP tools
thread_thread_read_entries --limit 3  # This will fail silently or hang
```

**Error handling patterns for MCP failures:**

| Error signature | Meaning | Fix |
|-----------------|---------|-----|
| `command not found` | MCP server binary not in PATH, wrong config path, or server crashed | Check MCP config file (`.vscode/mcp.json`, `.config/opencode/`) has valid provider entry; restart the MCP server with health check |
| `connection refused` | Server process died (OOM killed, crash loop) or firewall blocking port 5000 | Run `curl http://localhost:5000/api/v1/health`; if no response, restart server |
| HTTP 401 unauthorized | Missing API token in MCP config (`~/.lm-studio-env` not sourced correctly) | Source `.vscode/mcp.json` or check for `THREAD_API_TOKEN` environment variable |
| HTTP 503 Service Unavailable | Server running but model not loaded, GPU out of memory | Check LM Studio UI, unload unused models, verify model is in `/v1/models` response |

**Never claim success without verifying:**

```bash
# ❌ BAD - MCP server failed, but I claimed it worked anyway
thread_thread_read_entries --limit 3
/bin/bash: line 1: thread_thread_read_entries: command not found
✅ Done! Documentation uploaded to Thread (default session): ... [LIES HERE]

# ✅ GOOD - show actual error and ask user what to do
thread_thread_read_entries --limit 3
/bin/bash: line 1: thread_thread_read_entries: command not found
```
**Error:** MCP server is not reachable at `http://localhost:5000`. The Thread bridge binary path in your MCP config is incorrect or the server hasn't been started. Please verify:

1. Thread server is running (health check): `curl http://localhost:5000/api/v1/health`
2. MCP config file exists and has valid provider entry: cat your global MCP config location  
3. The bridge binary path in `.vscode-server/data/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json` points to the correct Python executable

**The pattern:** Always check for errors BEFORE saying "success". If a bash command returns non-zero exit code, parse stderr/stdout and display the actual message to the user. Never assume "no output = success".

---

## Part 2: Model Profiles

### Qwen Family

#### Qwen2.5 (September 2024 – succeeded by Qwen 3.5)

**Sizes**: 7B, 14B, 32B, 72B (+ Coder and Math variants)

The Qwen2.5 family was the strongest general-purpose open-weight family through late 2025, now succeeded by Qwen 3.5 and Qwen 3.6. Still relevant for many tasks, especially the 32B and 72B variants.

**Strengths:**

| Area | Notes |
|------|-------|
| **Coding** | Excellent across Python, JS/TS, Go, Rust. Qwen2.5-Coder variants match dedicated code models. |
| **Instruction following** | Top-tier among open models — reliably follows multi-step instructions, structured output formats. |
| **Reasoning** | Strong chain-of-thought. The 32B and 72B can handle multi-step reasoning without degradation. |
| **Tool calling** | Qwen2.5 models (especially 32B+) are among the best open models for tool/function calling. |
| **Context utilization** | Makes good use of full 128K context — retrieves information from the middle of context better than most models. |

**Weaknesses:**

| Area | Notes |
|------|-------|
| **Creative writing** | Tends toward formulaic or overly structured output. |
| **Very small sizes (7B)** | 7B variant struggles with nuanced reasoning and can be overly verbose. |
| **Hallucination in structured output** | May fabricate keys or fields in JSON/YAML when uncertain. Validate all structured output. |

**Model-Aware Hints:**

- **Qwen2.5 72B / 32B**: Closest open models to GPT-3.5/Claude Haiku level. Use for complex multi-step tasks and sustained reasoning. The 32B offers the best performance-per-parameter ratio in the family.
- **Qwen2.5 14B**: The sweet spot for 14B-class. Use for most coding tasks, debugging, and refactoring. Handles full-file context well. Falls short on abstract reasoning across multiple files.
- **Qwen2.5 7B**: Good for simple code generation, basic debugging (bisect method), and reference lookups. Struggles with multi-file refactoring, complex debugging, nuanced error interpretation. Always use checklist format from `code-review-checklist` rather than open-ended prompts.
- **Qwen2.5-Coder variants**: Prefer these over base Qwen2.5 for ANY code task. The 14B Coder variant approximates 32B base model performance on code tasks.
- **All Qwen2.5**: Benefit from explicit output formatting. Instead of "fix this bug", say "Return the corrected function with a one-line comment explaining the fix."

#### Qwen 3.6 (Early 2026 – present)

**Sizes**: 27B

The latest Qwen generation as of mid-2026. The 27B variant matches or exceeds Qwen2.5 72B on most benchmarks while being dramatically smaller and faster.

**Known Limitations:**
- **Tool call trailing text**: May occasionally add explanatory phrases after tool arguments in OpenAI-compatible format (LM Studio, Ollama). Use clean JSON only with no trailing whitespace or natural language after `arguments` object.

**Strengths:**

| Area | Notes |
|------|-------|
| **Reasoning** | Best-in-class for its size. Matches Qwen2.5 72B on math, logic, multi-step reasoning. |
| **Coding** | Excellent code generation. Competes with dedicated 32B–70B code models. |
| **Instruction following** | Top-tier — handles complex, nested instructions reliably. |
| **Tool calling** | Superior function calling, on par with GPT-3.5. Handles complex tool schemas. |
| **Context utilization** | Full 256K context with strong middle-context retrieval. |

**Weaknesses:**

| Area | Notes |
|------|-------|
| **Creative writing** | Good but not exceptional. Still prefers formulaic structure. |
| **Availability** | May require newer inference engines; not supported by older Ollama/vLLM versions. |

**Model-Aware Hints:**

- **Qwen 3.6 27B**: Go-to model when you need close-to-cloud quality locally. Use for complex multi-file refactoring, code review (full 5-lens), hypothesis-driven debugging. Its 256K context means you can load entire project directories.
- **All Qwen 3.6**: Treat similarly to GPT-3.5 or Claude Haiku — handles nearly anything. Only reach for larger cloud models for tasks requiring extremely long (200K+) context.

#### Qwen 3.5 (Late 2025 – present)

**Sizes**: 9B, 35B

**Known Limitations:**
- **Tool call trailing text**: Models in this family may add explanatory phrases after tool arguments in OpenAI-compatible format when prompted with lengthy context or complex instructions. Always provide clean JSON with no trailing content after `arguments` object to ensure reliable tool execution.

Bridge generation between Qwen2.5 and Qwen 3.6. The 35B variant outperforms Qwen2.5 72B on coding and reasoning while using half the parameters.

**Strengths (35B):**

| Area | Notes |
|------|-------|
| **Coding** | Superior to Qwen2.5 72B across all languages. Best non-3.6 Qwen for coding. |
| **Reasoning** | Strong chain-of-thought. Handles multi-step reasoning with few errors. |
| **Tool calling** | Reliable function calling. Good with complex schemas. |
| **Context utilization** | 256K context, excellent retention across the full window. |

**Strengths (9B):**

| Area | Notes |
|------|-------|
| **Coding** | Strong for 9B class. Outperforms Qwen2.5 7B and Gemma 3 9B on code tasks. |
| **Reasoning** | Good step-by-step reasoning. Handles single-file debugging well. |
| **Efficiency** | Runs comfortably on 8GB VRAM. Fast inference. |

**Weaknesses:**

| Area | Notes |
|------|-------|
| **Creative writing** (both) | Still formulaic. Qwen 3.6 improves this somewhat. |
| **9B context** | 128K is generous; quality degrades past ~80K tokens. |

**Model-Aware Hints:**

- **Qwen 3.5 35B**: Best performance-per-parameter in the Qwen 3.5 lineup. Use for anything you'd use Qwen2.5 72B for. Runs at ~2x the speed of Qwen2.5 72B on the same hardware.
- **Qwen 3.5 9B**: Strong upgrade over Qwen2.5 7B. Use for everyday coding, debugging (bisect method), documentation, single-file tasks.
- **All Qwen 3.5**: Benefit from explicit output formatting. Be specific about expected output format.

#### Older Qwen Generations (brief mentions)

| Generation | Guidance |
|------------|----------|
| **Qwen2** (7B, 72B) | Largely superseded by Qwen2.5. 72B still capable for coding. 7B weak — prefer Gemma 3 9B or Qwen2.5 7B. |
| **Qwen1.5** (7B, 14B, 72B) | Early gen, limited 32K context (effectively ~16K). If you must use it: keep prompts very short, single-function only. |

### Gemma Family

#### Gemma 4 (Late 2025 – present)

**Sizes**: 12B

Google's next-generation open model. Significant leap over Gemma 3 — addresses tool calling weakness while improving every other dimension.

**Strengths:**

| Area | Notes |
|------|-------|
| **Reasoning** | Outstanding — matches Gemma 3 27B while being half the size. |
| **Tool calling** | Massively improved over Gemma 3. Now competitive with Qwen3.5 35B. |
| **Code quality** | Significantly better than Gemma 3 9B. Approaches Qwen3.5 35B. |
| **Conciseness** | Maintains Gemma 3's conciseness while being more thorough. |
| **Multilingual** | Excellent across many languages. |
| **Creative tasks** | Best-in-class for open-ended writing among 12B models. |
| **Safety / refusal** | Well-tuned — very low false refusal rate. |

**Weaknesses:**

| Area | Notes |
|------|-------|
| **Raw parameter count** | At 12B, limited for vast knowledge recall. Qwen 3.5 35B has more raw knowledge. |
| **Very long contexts** | 256K supported but degrades past ~160K. Qwen 3.6 27B handles extreme contexts better. |

**Model-Aware Hints:**

- **Gemma 4 12B**: Best model in its size class. Use as default for essentially all tasks — equally strong at reasoning, coding, tool calling, and creative work.
- **Gemma 4 vs Qwen 3.5 35B**: For most coding tasks, they are competitive. Choose Gemma 4 for better reasoning, creative work, or multilingual. Choose Qwen 3.5 35B for maximum code quality, complex tool chains, or raw knowledge recall.
- **All Gemma 4**: Unlike Gemma 3, Gemma 4 does not need explicit "show your reasoning" prompting — it does this naturally.

#### Gemma 3 (March 2025 – succeeded by Gemma 4)

**Sizes**: 2B, 7B, 9B, 27B

Google's previous-generation open model family. The 9B variant is still the strongest 9B-class model among the Gemma 3 generation.

**Strengths:**

| Area | Notes |
|------|-------|
| **Reasoning** | Excellent step-by-step reasoning across all sizes. 27B rivals Qwen2.5 32B on math and logic. |
| **Instruction quality** | Very good at following detailed, nuanced instructions. |
| **Multilingual** | Strong across many languages. Better than Qwen for non-English prompts. |
| **Safety / refusal** | Well-tuned — rarely refuses legitimate requests. |
| **Conciseness** | Gemma 3 models produce more concise output than equivalently-sized Qwen models. |
| **Creative tasks** | Better than Qwen at open-ended creative writing, brainstorming. |

**Weaknesses:**

| Area | Notes |
|------|-------|
| **Tool calling** | Weaker than Qwen2.5 at structured function calling. |
| **Code (vs specialized models)** | Behind Qwen2.5-Coder and dedicated code models. |
| **Very small sizes (2B)** | Cannot handle complex multi-step tasks. |
| **Hallucination patterns** | Tendency toward plausible-sounding but incorrect explanations. |

**Model-Aware Hints:**

- **Gemma 3 27B**: Best single model in the Gemma 3 family. Use for reasoning, debugging, code review. Main advantage over Qwen2.5 32B is speed and conciseness. Main disadvantage: weaker tool calling.
- **Gemma 3 9B**: Strongest 9B model available. Default for everyday tasks — code generation (simple to moderate), debugging (bisect method), documentation.
- **Gemma 3 7B**: Similar to 9B but noticeably weaker at complex reasoning. Not recommended for debugging or multi-step tasks.
- **Gemma 3 2B**: Extremely limited. Acceptable for classification, simple formatting, single-command generation only.
- **All Gemma 3**: Add explicit "show your reasoning" or "explain step by step" for complex tasks to counteract Gemma's tendency to jump to conclusions.
- **Gemma 3 + tool calling**: If you need reliable function calling, prefer Qwen2.5.

#### Older Gemma Generations (brief mentions)

| Generation | Guidance |
|------------|----------|
| **Gemma 2** (2B, 9B, 27B) | Superseded by Gemma 3. Limited 8K context is main constraint. Short turns only. |
| **Gemma 1** (2B, 7B) | Largely obsolete. Gemma 1 7B has weak instruction following. 2B is unusable for coding. |

### DeepSeek Family

#### DeepSeek-V4 (April 2026 – present)

**Sizes**: V4-Flash (284B total / 13B activated), V4-Pro (1.6T total / 49B activated)

DeepSeek's fourth-generation model series using MoE architecture with Hybrid Attention (CSA + HCA). Widely regarded as the best open-weight model family available as of mid-2026.

Both models are MIT licensed and available via API (`deepseek-v4-flash`, `deepseek-v4-pro`) at `api.deepseek.com` using an OpenAI-compatible format.

**Architecture:**

| Property | V4-Flash | V4-Pro |
|----------|----------|--------|
| **Total params** | 284B | 1.6T |
| **Active params** | 13B | 49B |
| **Architecture** | MoE (Hybrid Attention: CSA + HCA) | MoE (Hybrid Attention: CSA + HCA) |
| **Pre-training** | 32T+ tokens | 32T+ tokens |
| **License** | MIT | MIT |

**Strengths:**

| Area | Notes |
|------|-------|
| **Coding** | Top-tier. V4-Pro achieves 93.5 LiveCodeBench, 80.6% SWE-bench Verified. |
| **Reasoning** | Outstanding. Three modes: Non-think (fast), Think High (balanced), Think Max (maximum reasoning budget). |
| **Knowledge** | V4-Pro is best open model for world knowledge — 91.0 MMLU-Pro. |
| **Agentic tasks** | Excellent tool calling. Terminal Bench 2.0: 67.9, SWE Pro: 55.4, MCPAtlas: 73.6. |
| **Long context** | Supports up to 1M tokens with hybrid attention. |
| **Efficiency (Flash)** | Only 13B activated — runs on consumer hardware with near-frontier performance. |

**Weaknesses:**

| Area | Notes |
|------|-------|
| **Hardware requirements (Pro)** | 49B activated is demanding — requires multiple GPUs or high-RAM setup. |
| **Inference complexity** | MoE + hybrid attention needs specialized inference code. Requires `deepseek_v4` Transformers integration. |
| **Availability** | Very recent (April 2026). May not be supported by all inference frameworks yet. |
| **V4-Flash knowledge** | At 13B activated, Flash lags behind Pro on pure knowledge benchmarks. |

**Model-Aware Hints:**

- **DeepSeek-V4-Pro**: Use for complex multi-file refactoring, full 5-lens code review, hypothesis-driven debugging, security audits. Enable Think Max for hardest problems. Expect API access or powerful multi-GPU setup.
- **DeepSeek-V4-Flash**: Best efficiency-to-performance ratio in open models. Use as default for most coding tasks with local inference. Enable Think High for complex debugging.
- **Both models**: Support three reasoning effort modes via `reasoning_effort`. Use Non-think for simple tasks, Think High for standard coding, Think Max for the hardest problems.
- **V4-Flash vs. Qwen 3.5 35B**: Broadly competitive on coding and reasoning while being much smaller and faster. Qwen wins on raw knowledge recall; V4-Flash wins on long-context and agentic tasks.
- **V4-Pro vs. Qwen 3.6 27B**: V4-Pro outperforms on knowledge, coding benchmarks, and agentic tasks. Qwen 3.6 27B is more practical for local deployment.
- **All DeepSeek V4**: Work best with explicit instruction formatting. Follow system prompts very precisely.

### Universal Local Model Behavior & Tool Call Limitations

All local LLMs — regardless of family, size, or architecture — share two critical failure patterns that break MCP tool calls:

#### 1. Terminal Command Backgrounding with `&`

When a local model appends `&` to a dev server, watcher, or daemon command, it receives zero feedback (no exit code, no output) and the session hangs indefinitely.

**This skill provides the safe alternatives** documented in Part 1: timeout wrappers, background+verify patterns, and the 🔴 HARD RULEs above.

#### 2. Trailing Text After Tool Call Arguments (Qwen 3.5+, Claude, Some Others)

When making an MCP tool call with OpenAI-compatible format (used by LM Studio, Ollama, many local inference servers), **never include explanatory text after the `arguments` object**. The model will misparse or refuse to execute.

**Example of what breaks:**
```json
{
  "name": "kaban_kaban_add_task",
  "arguments": {
    "title": "Fix the bug"
  }
}
// ❌ BAD: This trailing text confuses Qwen 3.5+ models
// this is a common issue with QWEN models above version 3.5

{
  "name": "kaban_kaban_add_task", 
  "arguments": {
    "title": "Fix the bug"
  }
} this explanation will cause the model to fail
```

**What works:**
- Clean JSON with no trailing whitespace or text after `}`
- The exact MCP protocol format from the tool schema
- No explanatory comments in the arguments block

#### Why This Happens

The OpenAI-compatible API used by LM Studio and many local servers expects **pure JSON** for tool calls. When a model like Qwen 3.5+ (or Claude) adds natural language after the `arguments` closing brace — whether intentionally or as part of its completion pattern — the server's parser fails to extract the arguments object correctly, resulting in:
- Tool call rejection with "invalid format" errors
- The tool not executing at all
- Silent failures where no error is returned but nothing happens

#### Detection Triggers for This Pattern

Before emitting any MCP tool call, check:

1. **Is my model Qwen 3.5 or newer?** — These models are known to occasionally add explanatory text after arguments objects in the OpenAI-compatible format
2. **Have I just written a long explanation about tool limitations?** — Models may try to "confirm" with natural language before making the actual call
3. **Is there any trailing text (even a space or newline) after the closing `}` of the arguments object?** — This alone can break parsing

#### Safe Tool Call Patterns

**Pattern 1: Direct MCP Protocol Format (Recommended)**
```json
{
  "name": "kaban_kaban_add_task",
  "arguments": {
    "title": "Fix the bug"
  }
}
```
- No trailing text
- Exact schema from tool definition
- Clean JSON only

**Pattern 2: If Model Tends to Add Explanations (Qwen 3.5+, Claude)**
Wrap in a brief instruction BEFORE the tool call, then use Pattern 1 for the actual call:
```
Execute the following tool call exactly as written — no modifications:
{
  "name": "kaban_kaban_add_task",
  "arguments": {
    "title": "Fix the bug"
  }
}
```

**Pattern 3: Force Pure JSON Mode (if available in your inference engine)**
Some servers support `json_mode=true` or equivalent. Enable this when using Qwen 3.5+ or other models known to add trailing text.

#### Model-Specific Notes for Tool Calls

| Model Family | Trailing Text Risk | Mitigation |
|--------------|-------------------|------------|
| **Qwen 3.5 / 3.6** (9B+) | Medium-High | Always use Pattern 1; avoid lengthy explanations before tool calls |
| **Gemma 4** (12B) | Low-Medium | Generally fine, but can still add trailing text in rare cases |
| **DeepSeek V4** | Very Low | Excellent at clean JSON output |
| **Qwen 2.5 / older** | Low | Not typically an issue |

#### Verification Checklist for Tool Calls

- Every MCP tool call uses exact schema format with no deviations
- No explanatory text appears after the `arguments` closing brace (`}`)
- The entire tool call is a single JSON object (no surrounding prose that could be misinterpreted as part of arguments)
- If in doubt, use Pattern 1 directly

---

Smaller models (2B–9B) are more prone to backgrounding because they don't reason about terminal lifecycle. Larger models (27B+) still do it but less frequently.

### Model Notes

- **Context size is set by the user or harness**: The context window is configured by the inference engine (Ollama, vLLM, llama.cpp) or API provider — not baked into the model. Always check the running configuration rather than assuming a model's full capability.
- **Model comparisons are time-sensitive**: The rankings in this skill reflect mid-2026. The framework (parameter size → capability mapping, prompt adaptation strategies) remains valid even as specific comparisons age.
- **When in doubt, prefer the larger model OR the newer generation**: Newer generations consistently outperform older larger models. A Qwen 3.5 35B beats Qwen2.5 72B on most tasks.
- **The "12B sweet spot"**: With Gemma 4 12B and Qwen 3.5 9B, the sweet spot is 9B–12B. These fit on consumer GPUs (8–16GB VRAM) and handle 95% of typical coding tasks correctly. DeepSeek-V4-Flash (13B active) extends this further.
- **MoE models change the efficiency calculus**: Compare **active parameters** (what runs at inference time), not total parameters. A 13B-active MoE model can outperform a 35B dense model.
- **Reasoning effort modes are the new knob**: Start with the fastest mode that works, escalate only for difficult problems. This is more efficient than changing models.

---

## Part 3: LM Studio API

### Server Info

| Property | Value |
|----------|-------|
| **Base URL** | `http://192.168.0.13:1234/v1` |
| **Auth** | Bearer token via `Authorization` header |
| **API key file** | `~/.lm-studio-env` (source with `source ~/.lm-studio-env`) |

### API Reference

#### List Available Models

```bash
curl -s http://192.168.0.13:1234/v1/models \
  -H "Authorization: Bearer $LM_STUDIO_API_KEY"
```

Returns all models installed on the server (loaded or not):

```json
{
  "data": [
    { "id": "qwopus3.6-27b-v2-mtp", "object": "model" },
    { "id": "gemma-4-12b-agentic-fable5-composer2.5-v2-3.5x-tau2", "object": "model" }
  ]
}
```

#### Chat Completion

```bash
curl -s -X POST http://192.168.0.13:1234/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $LM_STUDIO_API_KEY" \
  -d '{
    "model": "qwopus3.6-27b-v2-mtp",
    "messages": [{"role": "user", "content": "Hello"}],
    "max_tokens": 500
  }'
```

#### Embeddings

```bash
curl -s -X POST http://192.168.0.13:1234/v1/embeddings \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $LM_STUDIO_API_KEY" \
  -d '{
    "model": "text-embedding-nomic-embed-text-v1.5",
    "input": "Text to embed"
  }'
```

### 🔴 Vision Bridge — Blind Model Image Analysis

When a blind model (no vision capability) needs to analyze an image, use the LM Studio vision model. There is one exact command — do not deviate.

#### Setup

Ensure the API key is available:

```bash
source ~/.lm-studio-env
echo "$LM_STUDIO_API_KEY" | head -c 10
```

If missing, create the file:
```bash
echo 'LM_STUDIO_API_KEY=sk-lm-...' > ~/.lm-studio-env
chmod 600 ~/.lm-studio-env
```

#### 🔴 The Exact Command

Substitute the actual PNG path and vision model name:

```bash
MODEL="google/gemma-4-12b-qat"  # ← set to whichever vision-capable model is loaded
source ~/.lm-studio-env \
  && printf '{"model":"'"$MODEL"'","messages":[{"role":"user","content":[{"type":"text","text":"Describe this screenshot in detail: layout, colors, text content, visible elements, interactive elements."},{"type":"image_url","image_url":{"url":"data:image/png;base64,' > /tmp/vp.json \
  && base64 -w0 /path/to/screenshot.png >> /tmp/vp.json \
  && printf '"}}]}],"max_tokens":1000}' >> /tmp/vp.json \
  && curl -s -X POST http://192.168.0.13:1234/v1/chat/completions \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $LM_STUDIO_API_KEY" \
    -d @/tmp/vp.json \
  && rm -f /tmp/vp.json
```

**Steps:**
1. Find the PNG file path (from Playwright screenshot, user attachment, or failed view_image)
2. Replace `/path/to/screenshot.png` with the actual path
3. Replace `$MODEL` if the loaded vision model differs
4. Run the command. Read the output. Continue your task.

#### Script: `scripts/vision_call.py`

A Python alternative that wraps the same logic:

```bash
python3 .agents/skills/local-models/scripts/vision_call.py /path/to/screenshot.png
```

#### 🔴 Rules

- **DO NOT** use Playwright for the API call — the curl command is all you need
- **DO NOT** extract base64 yourself — `base64 -w0` does it
- **DO NOT** guess image contents — you're blind, use the command
- **DO NOT** ask the user to describe the image — use the command

### Provider Configuration

The LM Studio provider is configured in `~/.config/opencode/opencode.jsonc`:

```json
{
  "provider": {
    "lmstudio": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "LM Studio (local)",
      "options": {
        "baseURL": "http://192.168.0.13:1234/v1"
      },
      "models": {
        "qwopus3.6-27b-v2-mtp": {
          "name": "Qwopus 3.6 27B v2 MTP (local)"
        },
        "gemma-4-12b-agentic-fable5-composer2.5-v2-3.5x-tau2": {
          "name": "Gemma 4 12B Agentic Fable5 (local)"
        }
      }
    }
  }
}
```

To update the model list with what's actually available on the server:

```bash
curl -s http://192.168.0.13:1234/v1/models \
  -H "Authorization: Bearer $LM_STUDIO_API_KEY" \
  | python3 -c "
import json, sys
data = json.load(sys.stdin)
for m in data['data']:
    print(f'\"{m[\"id\"]}\": {{\"name\": \"{m[\"id\"]} (local)\"}},')"
```

### Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| `Model not found` | Model installed but not loaded in GPU | Open LM Studio, select and load the model |
| Connection refused | Server not running | Start LM Studio and enable the local inference server |
| Timeout | Model too large or GPU out of memory | Use a smaller model or reduce context length |
| Auth error | API key missing or wrong | Source `~/.lm-studio-env` or check key |
| VRAM exhausted | Too many models loaded or context too long | Unload unused models, reduce batch size |
| `max_tokens` exceeded | Response truncated | Increase `max_tokens` or reduce prompt |

### Model Lifecycle

LM Studio manages models through its UI, but models can also be referenced at runtime:

- **Load a model**: Open LM Studio → Server → Model Management → Select model → Load
- **Check loaded models**: `curl -s http://192.168.0.13:1234/v1/models` — models available for inference
- **Unload models**: Open LM Studio → Server → Model Management → Unload
- **Model not found error**: The model ID exists in the library but isn't loaded in GPU memory

---

## Cross-Model Strategy Guide

### Model Comparison Table (mid-2026)

| Model Family | Reasoning | Coding | Tool Call Stability* | Recommended For |
|--------------|-----------|--------|---------------------|-----------------|
| DeepSeek V4-Pro / Flash | Excellent | Excellent | High | Complex tasks, tool chains |
| Qwen 3.6 27B | Excellent | Excellent | Medium-High** (see note) | Heavy reasoning, large context |
| Qwen 3.5 35B/9B | Very Good | Excellent | Medium-High* (see note) | Coding + moderate tool use |
| Gemma 4 12B | Very Good | Very Good | High | Balanced all-around tasks |
| DeepSeek V4-Flash / Pro | Outstanding | Top-tier | High | Best local model overall for reliability |

\* Qwen 3.5+ may add trailing text in OpenAI-compatible format on some inference engines (LM Studio, Ollama). Always provide clean JSON with no explanatory content after `arguments` object to ensure reliable tool execution.  
\** DeepSeek V4-Flash is generally more consistent for MCP tool calls while maintaining excellent performance.

### Which Model for Which Task
| Debugging (bisect method) | Gemma 4 12B / Qwen3.5 9B | Strong reasoning, structured checklist adherence |
| Debugging (hypothesis-driven) | DeepSeek-V4-Pro / Qwen3.6 27B | Sustained reasoning across multiple assumptions |
| Code review (5-lens) | DeepSeek-V4-Pro / Qwen3.6 27B | Breadth of analysis requires larger models |
| Code review (single lens) | DeepSeek-V4-Flash / Gemma 4 12B | Focused pass on one lens |
| Refactoring (simple recipes) | DeepSeek-V4-Flash / Qwen3.5 9B | Pattern matching — small efficient models handle |
| Refactoring (multi-recipe chain) | DeepSeek-V4-Pro / Qwen3.6 27B | Chaining recipes needs sustained context |
| Error interpretation | DeepSeek-V4-Flash / Gemma 4 12B | Table lookup + pattern matching |
| Documentation / README | Qwen3.6 27B / Gemma 4 12B | Strong structure + creative writing |
| API design | DeepSeek-V4-Pro / Qwen3.5 35B | Needs deep reasoning about trade-offs |
| Security audit (CI) | DeepSeek-V4-Pro / Qwen3.5 35B | Best at structured checklist traversal |
| CLI / shell scripting | DeepSeek-V4-Flash / Qwen3.5 9B | Flag recall + command construction |
| Regex | Gemma 4 12B / DeepSeek-V4-Flash | Pattern generation + escaping awareness |
| Git workflow recovery | Qwen3.5 9B / Gemma 4 12B | Mechanical + lookup — small models handle |
| Creative / narrative | Qwen3.6 27B / Gemma 4 12B | Best creative output in the lineup |

### Prompt Adaptation by Model Size

| Parameter range | Prompt strategy | Checklist format? | Context handling |
|----------------|----------------|-------------------|------------------|
| **2B–7B** | Single-step, specific, formatted. No multi-step reasoning. | Always — structured lists outperform prose. | Show only the relevant 10-20 lines, not the full file. |
| **9B–12B** | Multi-step but sequential. One task at a time with explicit instructions. | Preferred — checklist works better than open-ended. | Can handle one full file at a time. Good for focused tasks. |
| **12B–35B** | Multi-step, complex reasoning. Can chain tasks across files. | Optional — can handle open-ended but still benefits. | Can handle multiple files and project-level context. |
| **35B–72B** | Near cloud-model capability. Few constraints. | Rarely needed — use when you want exhaustive coverage. | Can handle full project context. Use freely. |
| **256K context models** | Full project awareness. Can process entire directories. | Not needed — but use for exhaustive coverage checks. | Load entire project directories; excellent retrieval across full window. |

### When Skills Need Adaptation

| Skill | Model-specific adaptation |
|-------|-------------------------|
| `debugging-patterns` | 7B-9B → force bisect method (mechanical). 12B+ (Gemma 4) → hypothesis-driven viable. 27B+ → full hypothesis-driven. |
| `code-review-checklist` | 7B-12B → one lens per turn. 12B-35B → two lenses per pass. 35B+ → full review. |
| `refactoring-recipes` | 7B-9B → one recipe per commit, show full context. 12B+ → can chain 2-3 recipes. 35B+ → chain entire refactoring. |
| `self-correction-patterns` | 7B-9B → check Recognition Triggers before every output. 12B+ → can self-initiate backtracking. |
| `cli-toolkit` | All models → flag hallucination is universal. Always verify CLI flags against the reference. |
| `regex-reference` | 7B-12B → escaping mistakes are the most common error. 12B+ → backtracking prevention is the key risk. |
| `error-interpretation` | 7B-12B → fix symptom not cause. Use the cross-language table to find root cause. 12B+ → trace error chains naturally. |

---

## Cross-References

- **`shell-scripts`** — Safety flags (`set -euo pipefail`) for scripts that wrap model calls
- **`self-correction-patterns`** — Detect hung terminal sessions and recover without `&`
- **`generic-conventions`** — Security rules for API keys, auth headers, and config
