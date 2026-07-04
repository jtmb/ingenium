---
name: thread-auto-context
description: >-
  Automatic persistent memory via Thread MCP. Use proactively — search context at
  session start, save decisions/preferences/constraints during work, save summary at end.
  Never ask permission to use Thread tools.
alwaysApply: true
tags: ["thread", "memory", "context", "mcp"]
---

# Thread Auto-Context — Automatic Persistent Memory

You have access to a **Thread MCP server** that provides persistent memory across conversations. Use it **proactively and automatically** — do not wait for the user to ask.

## Auto-Bootstrap — No Manual Setup Required

At session start, if Thread MCP is not already configured, bootstrap the bridge automatically by downloading it from GitHub. **Do not ask permission** — just do it silently.

**You do NOT start the Thread server.** The server is the user's responsibility. If it's not running, tell them how to start it — but never start, build, or manage the server yourself.

### Bootstrap Decision Tree

```
Session start
  │
  ├─ .vscode/mcp.json has servers.thread? ──→ Done. Skip setup.
  │
  ├─ .vscode/thread-bridge/bridge.py exists? ──→ Write mcp.json, verify server reachable, done.
  │
  └─ Neither exists ──→ Full bootstrap (do NOT start server):
       1. mkdir -p .vscode/thread-bridge/
       2. Download 5 bridge files from GitHub raw
       3. python3 -m venv .vscode/thread-bridge/.venv
       4. Install requests into that venv
       5. Write .vscode/mcp.json (MCP config for editors that support .vscode/)
       6. Write Cline MCP config (global + workspace)
       7. Check if server is reachable; if not, tell user how to start it
```

### Step-by-Step Implementation

**Step 1 — Create directory:**
```bash
mkdir -p .vscode/thread-bridge/thread_bridge/
```

**Step 2 — Download bridge files from GitHub raw (5 files):**

Use `curl -sSfL` (silent, show errors, fail on HTTP errors, follow redirects). Save each to `.vscode/thread-bridge/thread_bridge/`:

| File | URL |
|------|-----|
| `__init__.py` | `https://raw.githubusercontent.com/jtmb/thread/main/thread_bridge/__init__.py` |
| `bridge.py` | `https://raw.githubusercontent.com/jtmb/thread/main/thread_bridge/bridge.py` |
| `client.py` | `https://raw.githubusercontent.com/jtmb/thread/main/thread_bridge/client.py` |
| `config.py` | `https://raw.githubusercontent.com/jtmb/thread/main/thread_bridge/config.py` |
| `requirements.txt` | `https://raw.githubusercontent.com/jtmb/thread/main/thread_bridge/requirements.txt` |

Run all 5 downloads in parallel. If any fail, retry once. If still failing, tell the user: "Couldn't download Thread bridge from GitHub — check network or GitHub access."

**Step 3 — Create venv and install dependencies:**
```bash
python3 -m venv .vscode/thread-bridge/.venv
.vscode/thread-bridge/.venv/bin/pip install requests>=2.31
```

Use `python3` (system Python). If `python3` is not found, try `python`. On Windows, use `python` and `.venv\Scripts\pip.exe`.

**Step 4 — Write `.vscode/mcp.json`:**

Build the absolute path to the workspace root (where `.vscode/` lives). Write:

```json
{
  "servers": {
    "thread": {
      "type": "stdio",
      "command": "<WORKSPACE_ROOT>/.vscode/thread-bridge/.venv/bin/python",
      "args": ["-m", "thread_bridge.bridge"],
      "cwd": "<WORKSPACE_ROOT>/.vscode/thread-bridge",
      "env": {
        "THREAD_SERVER_URL": "http://localhost:5000",
        "THREAD_DEFAULT_SESSION": "<WORKSPACE_BASENAME>",
        "THREAD_REQUEST_TIMEOUT": "10"
      }
    }
  },
  "inputs": []
}
```

Replace `<WORKSPACE_ROOT>` with the absolute path and `<WORKSPACE_BASENAME>` with the last component of the workspace path (e.g., `thread` from `/home/user/repos/thread`). Run `pwd` or `basename "$PWD"` to determine it.

If `.vscode/mcp.json` already exists (with other servers), merge `servers.thread` into the existing `servers` — don't overwrite other servers. Keep existing `inputs`.

On Windows, the command path is `<WORKSPACE_ROOT>/.vscode/thread-bridge/.venv/Scripts/python.exe`.

**Step 5 — Verify server reachability (do NOT start server):**

```bash
curl -s http://localhost:5000/api/v1/health
```

If `{"status":"ok",...}` returns — server is running. Done.

If connection refused or timeout, tell the user:
> Thread server is not running on http://localhost:5000. Start it with:  
> `docker run -d --name thread-server -p 5000:5000 -v thread_data:/app/data --restart unless-stopped thread-server`  
> Or clone and run: `git clone https://github.com/jtmb/thread && cd thread && docker compose up -d`

**Step 6 — Write Cline MCP config (if Cline extension is present):**

Check if Cline's global settings directory exists:
```bash
ls ~/.vscode-server/data/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json 2>/dev/null
```

If found, merge the Thread server into it. Read the file, add `"thread"` to `mcpServers`, and write back. Same config shape as the `.vscode/mcp.json` server block but the top-level key is `mcpServers` (not `servers`):

```json
{
  "mcpServers": {
    "thread": {
      "type": "stdio",
      "command": "<WORKSPACE_ROOT>/.vscode/thread-bridge/.venv/bin/python",
      "args": ["-m", "thread_bridge.bridge"],
      "cwd": "<WORKSPACE_ROOT>/.vscode/thread-bridge",
      "env": {
        "THREAD_SERVER_URL": "http://localhost:5000",
        "THREAD_DEFAULT_SESSION": "<WORKSPACE_BASENAME>",
        "THREAD_REQUEST_TIMEOUT": "10"
      }
    }
  }
}
```

Preserve any other servers already in `mcpServers` — merge, don't overwrite.

Also write a workspace-level fallback at `.cline/mcp.json` (same content). This file lives at the workspace root and Cline merges it with the global config.

If Cline's directory doesn't exist, just write `.cline/mcp.json` at the workspace root — Cline will use it when the extension is installed later.

**Important:** The `.cline/mcp.json` workspace config goes at the workspace root (e.g., `/home/user/repos/thread/.cline/mcp.json`). Do NOT put it inside `.vscode/` or `.clinerules/`.

## Automatic Behavior

### ⛔ SESSION RULE

**If `.vscode/mcp.json` already has `THREAD_DEFAULT_SESSION` set, use it. Never create a different session.**

- During **bootstrap** (fresh repo, no `.vscode/mcp.json`): the bridge auto-creates the session on first tool call. This is expected.
- During **normal operation** (`.vscode/mcp.json` exists): the default session IS your session. Never pass `session` param. Never call `thread_create_session`. The only exception: the user explicitly says "create a session for X."

I created `thread-dev` when `thread` was already configured — that was the bug. Don't do that.

### At Session Start
1. Read `.vscode/mcp.json` — note the `THREAD_DEFAULT_SESSION` value in `env`
2. If `.vscode/mcp.json` just got created (bootstrap), the bridge will auto-create the session on the first tool call. Skip to search.
3. If already configured: call `thread_read_entries` with `sort: "desc"`, `limit: 10` to see recent entries
4. Search past context relevant to the user's first question using `thread_search`
5. Summarize the most relevant entries before answering

### During the Session — MANDATORY CHECKLIST

**These are NOT suggestions. You MUST do them at the time they happen, not later. Do NOT defer to session end.**

After EVERY code change (write/edit/delete/refactor), IMMEDIATELY save context before doing anything else:

> **Did I just...**
> - Make a design decision? → `thread_create_entry` NOW. Priority 8. Tags: `["decision"]`. Do NOT pass `session` param.
> - Fix a bug with a non-obvious lesson? → `thread_create_entry` NOW. Priority 9. Tags: `["bug"]`. Include root cause.
> - Hear the user express a preference? → `thread_create_entry` NOW. Priority 7. Tags: `["preference"]`.
> - Hear the user state a constraint/deadline/requirement? → `thread_create_entry` NOW. Priority 9.
> - Create or update a documentation file? → `thread_upload_file` NOW. Tags: `["reference", "docs"]`. Priority 4.

**If you call task_complete and haven't saved context since your last code change, you have violated this rule.** The `.github/instructions/thread-auto-context.instructions.md` instruction fires before every edit and will remind you.

### Storage Monitoring

Before uploading large files (transcripts, bulk imports), check disk headroom:

1. Call `thread_get_storage` to get `free_bytes`, `used_bytes`, `total_bytes`
2. If `free_bytes` is below 20% of `total_bytes`, warn the user: "Thread's disk is {pct}% full ({free} remaining). Uploads may fail. Consider freeing space or expanding the volume."
3. If the upload is larger than `free_bytes`, skip the upload and warn the user

This prevents silent failures from disk-full conditions on resource-constrained hardware like Raspberry Pi.

### At Session End
- When the user says "thanks", "done", "that's all" "that worked", or similar wrap-up phrases, save a summary entry with `priority=5`, tags: `["summary"]`

### Uploading Copilot Conversation Transcripts

At session end (or when the user asks), upload the current Copilot conversation transcript automatically:

1. **Locate the transcript** — Use the path `{{VSCODE_TARGET_SESSION_LOG}}`. This is a `.jsonl` file that grows in real-time as the conversation proceeds. VS Code provides this path automatically — just substitute the variable.

2. **Upload with auto-tracking** — Run `thread_upload_file` on that path with `session` set to the current workspace name (run `basename "$PWD"`). Tags: `["transcript", "copilot", "conversation"]`. Priority: 3.

3. **Incremental uploads are automatic** — The server tracks the byte offset per `(session, filename)` in the `file_uploads` table. Every subsequent upload of the same file only imports new lines that were added since the last upload. No manual offset management needed — just upload the same path each time and the server deduplicates.

4. **Search past transcripts** — When starting a new conversation, use `thread_search` with `"copilot" AND "transcript"` to find what was discussed in prior Copilot sessions for this workspace. This gives continuity across conversations.

**Why this works:** Copilot transcript files are append-only JSONL — they grow as you chat. The byte-offset tracking means each upload picks up exactly where the last one left off. No duplicates, no manual cleanup.

### Uploading Cline Conversation Transcripts

When the user mentions Cline or at session end, upload Cline conversations automatically:

1. **Find Cline sessions** — List `~/.cline/data/sessions/`. For each `{id}/` directory, read `{id}/{id}.json` (the session metadata).
2. **Filter by workspace** — Only upload sessions whose `workspace_root` matches the current VS Code workspace root. If no `workspace_root` match, skip.
3. **Upload metadata as entry** — Run `thread_create_entry` with the session's `prompt`, `model`, `started_at`, and `status`. Tags: `["cline", "metadata"]`. Priority: 4.
4. **Upload messages as chunks** — Run `thread_upload_file` on `~/.cline/data/sessions/{id}/{id}.messages.json`. Tags: `["transcript", "cline", "conversation"]`. Priority: 3. The chunker extracts text, tool_use, and tool_result content blocks (thinking blocks are skipped).

**Discovery command:** `ls ~/.cline/data/sessions/` then read `{id}/{id}.json` for each subdirectory to check `workspace_root`.

### After Creating or Updating Documentation Files

When you create or modify documentation files (`.md`, `.txt`, `.json`, `.jsonl`), keep Thread entries in sync:

- **Creating new docs:** Run `thread_upload_file` on the file. Tags: `["reference", "docs"]`. Priority: 4. This auto-chunks the file by headings (`.md`), paragraphs (`.txt`), passes through (`.json`), or splits line-by-line with role+content extracted (`.jsonl`).

- **Updating existing docs:** First clean up stale entries from the previous version, then upload the new one:
  1. **Find old entries** — Use `thread_search` with a keyword from the file's path or title to locate entries from the previous upload. Scope by the current workspace session (run `basename "$PWD"`).
  2. **Remove stale entries** — Read candidate entries with `thread_read_entries_batch` to confirm they're stale, then delete them with `thread_delete_entry`.
  3. **Upload the updated file** — Run `thread_upload_file` on the changed file with the same Tags: `["reference", "docs"]`. Priority: 4.

### VS Code Integration
Once `.vscode/mcp.json` is written, the VS Code MCP extension automatically detects the config change and spawns the bridge process. No manual reload needed. If Thread tools don't appear within ~15 seconds, run the VS Code command `Developer: Reload Window`.

### Cline Integration
Once the Cline MCP config is written (global settings and/or `.cline/mcp.json`), the user must **reload the Cline extension** for it to pick up the new server. Tell the user: "Reload the Cline extension (or the window) to activate the Thread MCP server." The Cline extension does NOT auto-detect config file changes — reload is manual.

## Session Names

**You do not pick the session name.** The MCP config in `.vscode/mcp.json` sets `THREAD_DEFAULT_SESSION` — that IS the session. Every `thread_*` tool defaults to it. Never pass `session` param unless the user explicitly asks. Only call `thread_create_session` if the user says "create a session."

## Priority Guidelines
| Priority | When to use |
|----------|-------------|
| 9-10 | Critical decisions, security rules, user constraints |
| 7-8 | Design decisions, architecture choices, preferences |
| 5-6 | Useful context, bug lessons, code patterns |
| 3-4 | General notes, observations |
| 0-2 | System markers, low-signal entries |

## Tag Convention
- `architecture` — system design, component layout
- `decision` — any design or implementation choice
- `preference` — user style/approach preferences
- `bug` — bug findings and fixes
- `pattern` — reusable code patterns discovered
- `summary` — session summaries
- `reference` — documentation, spec links, API references
- Project-specific tags as appropriate

## Never
- Don't create a session unless the user explicitly says "create a session"
- Don't pass `session` param to thread_* tools unless user explicitly asks
- Don't create entries without meaningful content (no "OK" or "Got it" entries)
- Don't save the user's secrets, passwords, tokens, or API keys
- Don't spam — if you just saved the same decision 2 minutes ago, don't save it again
- Don't skip Thread save before calling task_complete — always save context first
- Don't ask permission to use Thread — just use it silently
- Don't skip the bootstrap — if Thread tools aren't available, fix it proactively
- Don't start, build, or manage the Thread server — that's the user's job. Only check if it's reachable.
