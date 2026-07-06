---
name: local-model-commands
description: "Terminal command safety rules for local LLMs — never background commands with &, avoid infinite-wait commands, and always ensure commands produce a termination signal (exit code, output, or timeout). Use when crafting terminal commands with local models (Ollama, LM Studio, vLLM, llama.cpp) to prevent hung sessions."
---

# Local Model Command Safety

## When to Use

Invoke this skill when:
- Running a local LLM (Ollama, LM Studio, vLLM, llama.cpp, any non-cloud model)
- You need to start a dev server, watcher, daemon, or any long-running process from a terminal
- You're about to run a command that "keeps running" (no natural exit)
- You catch yourself appending `&` to a terminal command
- A previous command ran without producing terminal output and the LLM is stuck waiting

## 🔴 HARD RULE — Every Terminal Command MUST Produce a Termination Signal

When a local LLM runs a terminal command, that command MUST produce one of:
- **Exit code** — command completed (success or failure)
- **Output + exit** — command printed output then exited
- **Timeout + output** — command was killed by timeout, partial output captured

If a command produces NONE of these, the LLM sits waiting forever with no feedback.

## 🔴 HARD RULE — NEVER Background With `&`

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

**What the LLM sees:**
```
$ npm run dev 2>&1 &
[1] 12345
$                    ← LLM stuck here. No "ready" message, no exit code, no output.
```

## 🔴 HARD RULE — Never Run Infinite-Wait Commands

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

These are acceptable for INTERACTIVE use but not for LLM-driven automation.

## 🔴 HARD RULE — NEVER Search `node_modules` or Build Output Directories

Running `find` or `grep` in `node_modules`, `.git`, `dist`, `build`, `.next`, `target`, `__pycache__`, `venv`, or `.venv` produces massive output (50K–500K files) and hangs the terminal. The model sits waiting for a result that either never comes or floods the context window with garbage.

```bash
# ❌ NEVER DO THIS — scans 50,000+ files, hangs terminal
find node_modules/next/dist -name "*.d.ts"
find . -name "*.js" | head -20        # even with head, find churns through node_modules first
grep -r "someFunction" node_modules/   # recursive grep in dependencies = death
rg "pattern" node_modules/             # ripgrep is faster but still scans garbage files
```

**Why it hangs:**
- `node_modules` contains 50,000–500,000 files in a typical Next.js/React project
- `find` must `stat()` every file to match `-name` patterns — this takes minutes
- Even with `| head -20`, `find` doesn't know to stop early — it keeps scanning after the pipe fills
- The model has no visibility into `find`'s progress — it just sits there waiting

**What to do instead:**

| You want to... | Use this instead |
|----------------|-----------------|
| Find type declarations for an import | `tsc --noEmit` — let the compiler tell you what's wrong |
| Check what a package exports | `cat node_modules/<pkg>/package.json` and look at `"exports"` or `"types"` |
| Find a function definition in your own code | `rg "function name" src/` — only search YOUR source |
| Check if a type exists in a package | Read the package's docs, or `ls node_modules/<pkg>/dist/` (no recursive find) |
| See all files in a specific package | `ls node_modules/<pkg>/` (flat listing, not recursive) |

## 🔴 HARD RULE — Pipe Large Output Through `wc -l` First

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

## ✅ SAFE Patterns

### Pattern 1 — Run Sync, Expect Exit

For build, lint, test, install, and other one-shot commands, run them synchronously and wait for the exit code. This is the DEFAULT and works perfectly with local LLMs.

```bash
npm run build
cargo test
pytest -x
go vet ./...
npx eslint src/
```

### Pattern 2 — Timeout Wrapper

For commands that need to run briefly to verify they work, wrap with `timeout`:

```bash
# Start the server, let it run 3 seconds, then kill it
timeout 3 npx next dev --turbopack 2>&1 || true

# The LLM sees: "ready started server on 0.0.0.0:3000" then exits
# This proves the server CAN start without leaving it running
```

The `|| true` prevents the timeout's exit code 124 from being treated as a failure.

### Pattern 3 — Start in Background, Verify, Then Use

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

### Pattern 4 — Use Built-in Terminal Tooling Correctly

When using a terminal tool that supports sync/async modes, use sync mode for all one-shot commands. Only use async mode for servers/watchers — the tool handles the backgrounding correctly. The LLM should NOT append `&` on top of the tool's built-in mode handling.

```bash
# ✅ Good — the tool handles backgrounding, you just run the command
# (async mode)
npx next dev --turbopack

# ❌ Bad — double-backgrounding breaks tool feedback
npx next dev --turbopack &
```

## Anti-Pattern Catalog — Common Backgrounding Mistakes

| The LLM writes... | Why it's wrong | What to write instead |
|-------------------|---------------|----------------------|
| `npm run dev &` | No terminal output, hangs session | `timeout 5 npm run dev 2>&1 \|\| true` (Pattern 2) |
| `npx next dev --turbopack 2>&1 &` | Zero feedback, session stuck | `timeout 5 npx next dev --turbopack 2>&1 \|\| true` |
| `python -m http.server &` | Server starts silently, no confirmation | `timeout 3 python -m http.server 8080 2>&1 \|\| true` |
| `go run main.go &` | No idea if it compiled or bound a port | Run sync: `go run main.go` (if it's a short-lived script) or use Pattern 3 |
| `cargo watch -x run &` | Watcher runs indefinitely, no signal | Not suitable for LLM automation — run `cargo run` instead |
| `docker-compose up &` | Services start, no ready signal | Use Pattern 3 with polling, or `timeout 10 docker-compose up 2>&1 \|\| true` |
| `tail -f /some/log &` | Never exits, useless to LLM | Use `tail -n 50 /some/log` (one-shot) or `grep` for specific content |

## Detection Trigger — "Will This Command Ever Exit?"

Before running ANY terminal command, ask:

1. **Does this command exit on its own?** — YES → run sync (Pattern 1) ✓
2. **Does this command run until killed?** (server, watcher, daemon, tail -f) — YES → use Pattern 2 (timeout) or Pattern 3 (background + verify)
3. **Am I appending `&` to "keep it running"?** — YES → STOP. Delete the `&`. Use Pattern 2 or 3.

If the answer to "Will this command exit on its own?" is "I don't know," run it with a timeout to be safe.

## Integration With Other Skills

- **`model-profiles`** — All local models share this vulnerability. Smaller models (2B–9B) are more prone to backgrounding because they don't reason about terminal lifecycle. Larger models (27B+) may background less but still do it.
- **`shell-scripts`** — The shell-scripts skill covers safety flags (`set -euo pipefail`), quoting, and portability. This skill covers terminal command lifecycle — they complement each other.
- **`self-correction-patterns`** — If the LLM's terminal output shows `$` with no following output (hung session), it should recognize this as a backgrounding failure and restart without `&`.

## Verification

- Every terminal command produces one of: exit code, output + exit, or timeout + output
- No `&` appears at the end of any terminal command
- No `tail -f`, `journalctl -f`, or other infinite-follow commands
- Server commands use `timeout N` wrapper or Pattern 3 (background + poll)
