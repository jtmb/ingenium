---
title: "Command Safety — Safe Patterns, Anti-Patterns, and MCP Verification"
impact: HIGH
impactDescription: Prevents hung terminal sessions, silent failures, and lost agent feedback loops
tags: [command-safety, terminal, timeout, background, mcp-verification]
---

## Command Safety — Safe Patterns, Anti-Patterns, and MCP Verification

**Pattern intent:** every terminal command an LLM runs MUST produce a termination signal (exit code, output, or timeout). Commands that don't — backgrounded processes, infinite-wait commands — hang the session with no feedback.

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

When using a terminal tool that supports sync/async modes, use sync mode for all one-shot commands. Only use async mode for servers/watchers — the tool handles the backgrounding correctly.

```bash
# ✅ Good — the tool handles backgrounding
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
| `docker compose up` | Services start in foreground, blocks terminal | Use `timeout 10 docker compose up -d 2>&1 \|\| true` to start detached, then poll with `docker compose ps` |
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

**Before claiming success on ANY MCP tool call, you MUST verify the actual response.** This is the #1 failure pattern across all skills. When a command fails silently or returns an error:

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
# ✅ Good — always verify server is reachable first
curl -s http://localhost:5000/api/v1/health || echo "Server not running, cannot proceed"

# ❌ Bad — no health check before calling MCP tools
thread_thread_read_entries --limit 3  # This will fail silently or hang
```

**Error handling patterns for MCP failures:**

| Error signature | Meaning | Fix |
|-----------------|---------|-----|
| `command not found` | MCP server binary not in PATH, wrong config path, or server crashed | Check MCP config file; restart the MCP server with health check |
| `connection refused` | Server process died (OOM killed, crash loop) or firewall | Run `curl http://localhost:5000/api/v1/health`; restart server |
| HTTP 401 unauthorized | Missing API token in MCP config | Source the MCP config environment file |
| HTTP 503 Service Unavailable | Server running but model not loaded, GPU OOM | Check LM Studio UI, unload unused models |

**Never claim success without verifying:**

```bash
# ❌ BAD - MCP server failed, but I claimed it worked anyway
thread_thread_read_entries --limit 3
/bin/bash: line 1: thread_thread_read_entries: command not found
✅ Done! Documentation uploaded to Thread: ... [LIES HERE]

# ✅ GOOD - show actual error
thread_thread_read_entries --limit 3
/bin/bash: line 1: thread_thread_read_entries: command not found
```

**The pattern:** Always check for errors BEFORE saying "success". If a bash command returns non-zero exit code, parse stderr/stdout and display the actual message to the user. Never assume "no output = success".
