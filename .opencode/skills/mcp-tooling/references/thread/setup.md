---
title: "Thread MCP Setup — Configuration, Initialization, Authentication [RETIRED]"
impact: HIGH
impactDescription: "[RETIRED — Replaced by Docs RAG] Ensures Thread MCP is properly configured and accessible for persistent memory"
tags: [thread, mcp, setup, configuration, initialization, retired]
---

## Thread MCP Setup

> 🔴 **RETIRED**: Thread has been replaced by the Ingenium Docs RAG system. This content is retained for reference only until full removal is verified. See `ingenium_docs_*` tools instead.

### Auto-Initialization Decision Tree

At session start, if Thread MCP is not already configured, initialize the bridge automatically from the Thread repository. Do not ask permission — just do it silently.

You do NOT start the Thread server. The server is the user's responsibility. If it's not running, tell them how to start it — but never start, build, or manage the server yourself.

```
Session start
  │
  ├─ opencode.jsonc has "thread" provider? ──→ Done. Skip setup.
  │
  ├─ ~/.config/opencode/bridge/thread_bridge/ exists? ──→ Add to opencode config, verify server reachable, done.
  │
   └─ Neither exists ──→ Full initialization (do NOT start server):
        1. mkdir -p ~/.config/opencode/bridge/thread_bridge/
        2. Copy 5 bridge files from the Thread repository source
        3. python3 -m venv ~/.config/opencode/bridge/thread_bridge/.venv
        4. Install requests into that venv
        5. Add "thread" provider to opencode.jsonc (or .json)
        6. Verify server is reachable; if not, tell user how to start it
```

### Step-by-Step Implementation

**Step 1 — Create OpenCode bridge directory:**
```bash
mkdir -p ~/.config/opencode/bridge/thread_bridge/
```

**Step 2 — Create bridge files from the Thread repository source:**

Copy the 5 bridge files from the Thread repository checkout into `~/.config/opencode/bridge/thread_bridge/`:

| File | Source |
|------|--------|
| `__init__.py` | `thread_bridge/__init__.py` |
| `bridge.py` | `thread_bridge/bridge.py` |
| `client.py` | `thread_bridge/client.py` |
| `config.py` | `thread_bridge/config.py` |
| `requirements.txt` | `thread_bridge/requirements.txt` |

The files live in the Thread project source at the paths listed above. Copy them from the local clone, or download from the Thread repository. If any file is missing, tell the user the Thread repository source is unavailable.

**Step 3 — Create venv and install dependencies:**
```bash
python3 -m venv ~/.config/opencode/bridge/thread_bridge/.venv
~/.config/opencode/bridge/thread_bridge/.venv/bin/pip install requests>=2.31
```

**Step 4 — Add Thread to OpenCode configuration:**

Add the Thread MCP server as a new provider in `opencode.jsonc` or `opencode.json`:

```json
{
  "provider": {
    "lmstudio": { ... },
    "thread": {
      "npm": "@opencode-ai/thread-mcp",
      "name": "Thread Context Server (local)",
      "options": {
        "baseURL": "http://localhost:5000"
      },
      "models": {}
    }
  }
}
```

**Step 5 — Verify server is reachable:**
```bash
curl -s http://localhost:5000/api/v1/health
```
If `{"status":"ok",...}` returns — server is running. Done.

If connection refused or timeout, tell the user:
> Thread server is not running on http://localhost:5000. Start it with:  
> `docker run -d --name thread-server -p 5000:5000 -v thread_data:/app/data --restart unless-stopped thread-server`  
> Or clone and run: `git clone https://github.com/jtmb/thread && cd thread && docker compose up -d`

### OpenCode Integration

Once `opencode.jsonc` is updated with the "thread" provider, OpenCode automatically detects the configuration change and spawns the bridge process when needed (first Thread tool call). If Thread tools don't appear within ~15 seconds, check that:
- The opencode server is running (`curl http://localhost:5000/api/v1/health`)
- The `.config/opencode/bridge/thread_bridge` directory exists with the 5 bridge files
- Reload the OpenCode connection

### 🔴 API Authentication — Never Hardcode Tokens

The Thread API requires an auth token stored in environment variables. Never hardcode this value — use environment variable substitution or a secure secret store. Reference the token source location but never expose its contents.

### 🔴 Verify Before Destructive Operations

When performing destructive operations (deletion, modification), ALWAYS verify first:
- **Check server health** before any batch operation
- **Verify session exists** BEFORE deleting — check for 404 (doesn't exist) vs 401 (auth failure)
- **Parse HTTP status codes correctly:** HTTP 204 = Deleted successfully; HTTP 404 on DELETE = Already deleted; HTTP 401 = Authentication failure — NOT a deletion indicator!
- **Verify deletion worked** by trying to read the session again after DELETE
