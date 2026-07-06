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

At session start, if Thread MCP is not already configured, bootstrap the bridge automatically from the Thread repository. **Do not ask permission** — just do it silently.

**You do NOT start the Thread server.** The server is the user's responsibility. If it's not running, tell them how to start it — but never start, build, or manage the server yourself.

## 🔴 HARD RULE — Verify Configuration Before Making Assumptions

When making actions that require external context (MCP servers available, API keys exist, config values present), always verify it actually exists first:
- **Thread MCP tools** → Confirm server reachable at configured URL before calling Thread APIs
- **LM Studio models** → Check server is responding at its base URL (don't assume port 1234)  
- **OpenAI-compatible calls** → Verify model exists on the endpoint, don't send requests hoping they work
- **Environment variables** → Look in the default global MCP configuration location — don't guess paths or key names

**The pattern:** "Verify → Act" not "Act and hope it worked."

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
        2. Copy 5 bridge files from the Thread repository source
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

**Step 2 — Create bridge files from the Thread repository source:**

Copy the 5 bridge files from the Thread repository checkout into `.vscode/thread-bridge/thread_bridge/`:

| File | Source |
|------|--------|
| `__init__.py` | `thread_bridge/__init__.py` |
| `bridge.py` | `thread_bridge/bridge.py` |
| `client.py` | `thread_bridge/client.py` |
| `config.py` | `thread_bridge/config.py` |
| `requirements.txt` | `thread_bridge/requirements.txt` |

The files live in the Thread project source at the paths listed above. Copy them from the local clone, or download from the Thread repository using your platform's standard file retrieval. If any file is missing, tell the user: "Couldn't find Thread bridge source files — check that the Thread repository is available."

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

> **Session ending soon?** → Run the full export workflow below in "At Session End — MANDATORY EXPORT". Do NOT just save a summary — save decisions, git state, and output the import prompt.
**If you call task_complete and haven't saved context since your last code change, you have violated this rule.**

### Storage Monitoring

Before uploading large files (transcripts, bulk imports), check disk headroom:

1. Call `thread_get_storage` to get `free_bytes`, `used_bytes`, `total_bytes`
2. If `free_bytes` is below 20% of `total_bytes`, warn the user: "Thread's disk is {pct}% full ({free} remaining). Uploads may fail. Consider freeing space or expanding the volume."
3. If the upload is larger than `free_bytes`, skip the upload and warn the user

This prevents silent failures from disk-full conditions on resource-constrained hardware like Raspberry Pi.

### At Session End — MANDATORY EXPORT

**When the user says "thanks", "done", "that's all", "that worked", or similar wrap-up phrases, you MUST do ALL of the following.**

#### 🔴 HARD RULE — Full Transcript Export Required

**At session end, you MUST write the full conversation transcript to a file and upload it to Thread. This is not optional. This applies to ALL sessions running in OpenCode.**

**Workflow:**
1. Compose a markdown transcript covering every turn of the conversation — user's intent, assistant's actions, key decisions, file manifest, commit hashes, and any important context
2. Write it to `/tmp/opencode/session-{YYYY-MM-DD}-transcript.md`
3. Call `thread_upload_file` on that path with Tags: `["export", "transcript", "full-session"]`. Priority: 9.
4. Then proceed with the remaining steps below

**This ensures every session is fully recoverable from Thread even if the platform's own chat history is lost.**

1. **Save session summary** — `thread_create_entry` with the session's key changes, decisions, and outcomes. Priority: 7. Tags: `["export", "session-state", "opencode"]`.

2. **Save decisions** — `thread_create_entry` consolidating all design decisions, architecture choices, and non-obvious lessons from this session. Priority: 8. Tags: `["export", "decisions", "opencode"]`.

3. **Save git state** — Run `git log --oneline -7` and `git diff --cached --stat`. Save the output via `thread_create_entry`. Priority: 6. Tags: `["export", "git-status", "opencode"]`.

4. **Output a copyable import prompt** — After saving, tell the user:
   ```
   === Thread Export Complete ===

   Session: {workspace-name}

   Entries created/updated:
   0. Full Transcript — tags: ["export", "transcript", "full-session"]
   1. Session Summary — tags: ["export", "session-state", "opencode"]
   2. Decisions — tags: ["export", "decisions", "opencode"]
   3. Git State — tags: ["export", "git-status", "opencode"]

   === Copyable Import Prompt ===

   @ingenium-scout search thread for tags: ["export"] AND ["opencode"] for the {workspace-name} workspace. Read the session-state, decisions, and git-status entries and summarize the context.
   ```

5. **Check for prior exports first** — Before creating, run `thread_search` with `"export" AND "opencode"`. If entries already exist, update them via `thread_update_entry` rather than creating duplicates.

**This is NOT optional. If you reach session end and have not saved context — especially the full transcript — you have violated the protocol.**

### Uploading Cline Conversation Transcripts

When the user mentions Cline or at session end, upload Cline conversations automatically:

1. **Find Cline sessions** — List `~/.cline/data/sessions/`. For each `{id}/` directory, read `{id}/{id}.json` (the session metadata).
2. **Filter by workspace** — Only upload sessions whose `workspace_root` matches the current VS Code workspace root. If no `workspace_root` match, skip.
3. **Upload metadata as entry** — Run `thread_create_entry` with the session's `prompt`, `model`, `started_at`, and `status`. Tags: `["cline", "metadata"]`. Priority: 4.
4. **Upload messages as chunks** — Run `thread_upload_file` on `~/.cline/data/sessions/{id}/{id}.messages.json`. Tags: `["transcript", "cline", "conversation"]`. Priority: 3. The chunker extracts text, tool_use, and tool_result content blocks (thinking blocks are skipped).

**Discovery command:** `ls ~/.cline/data/sessions/` then read `{id}/{id}.json` for each subdirectory to check `workspace_root`.

### Uploading OpenCode Session Context — `/export`

When the user runs `/export` or says "export context", or at session end while running in OpenCode, capture the full session state and save it to Thread.

**Cross-reference:** The "At Session End — MANDATORY EXPORT" section above triggers this workflow automatically. If the user explicitly says `/export`, run this section directly. The two workflows should produce the same output format — the user should get a copyable import prompt either way.

**OpenCode detection:** Check for these indicators (first match wins):
- `$OPENCODE` environment variable is set
- `$OPENCODE_CONFIG` is set
- `opencode.json` exists in the workspace root
- `.opencode/` directory exists in the workspace root

If none match, this is NOT an OpenCode session — do NOT export. If it IS an OpenCode session, proceed:

1. **Discover project structure** — Run discovery first to know what paths exist:
   ```bash
   # Core project paths — find what actually exists
   ls opencode.json 2>/dev/null
   ls -d .opencode/ 2>/dev/null
    find .opencode/agents -name '*.md' 2>/dev/null
   ls .opencode/plugins/*.ts .opencode/plugins/*.js 2>/dev/null
   ls .opencode/hooks/*.json .opencode/hooks/*.yaml 2>/dev/null
   ls .opencode/mcp.json .opencode/mcp.jsonc .opencode/*.json 2>/dev/null
   
   # Agent skill system (optional — not all projects have it)
   ls -d .agents/skills/*/ 2>/dev/null
   ls .agents/hooks/*.json 2>/dev/null
   ```

2. **Collect export data** — Run these based on what discovery found:
   ```bash
   # Always collected
   git status --short
   git diff --cached --stat
   git diff --stat
   
   # OpenCode structure (collected dynamically based on discovery)
   # Agents: <opencode-agent-count>
   # Plugins: <opencode-plugin-count>
   # Hooks: <opencode-hook-count>
   # Config files: <opencode-config-count>
   
   # Skill system (if present)
   # Skills: <skill-count>
   ```

3. **Save session summary** — Create a structured entry with:
   - Session date and topic (from recent conversation context)
   - OpenCode environment detected (yes/no)
   - Key decisions made (brief bullet points)
   - Files changed (from git status)
   - Project structure summary: agents, plugins, hooks, skills (with counts)
   - Tags: `["export", "session-state", "opencode"]`. Priority: 7.

4. **Save git state** — Create a separate entry with the raw export data:
   - Full `git status --short` output
   - Staged diff stats (file count, insertions, deletions)
   - Unstaged diff stats
   - Tags: `["export", "git-status", "opencode"]`. Priority: 6.

5. **Save decisions reference** — Read the last 10 Thread entries for this session via `thread_read_entries` with `sort: "desc", limit: 10`. If they contain decisions relevant to the current session, create a consolidated "decisions made this session" entry. Tags: `["export", "decisions", "opencode"]`. Priority: 8.

6. **Save OpenCode config snapshot** — Read `opencode.json` (or `opencode.jsonc`) and save relevant sections:
   - Agent list (just names, not full content)
   - Plugin list with lifecycle events
   - MCP server names
   - Tags: `["export", "opencode-config"]`. Priority: 5.

**When to trigger:**
- User explicitly runs `/export` or says "export"
- User says "export context", "save context", "upload to thread" at session end
- User says "wrap up", "that's all", "done" at session end (alongside the summary entry)
- **Only trigger if OpenCode environment was detected** — skip if not in OpenCode

**No duplicates:** Check `thread_search` with `"export" AND "opencode"` for the current session before saving. If an export already exists from this session, update the existing entries via `thread_update_entry` rather than creating new ones.

**Works with ongoing sessions:** The export captures the current state even if the session isn't complete. Multiple exports across the same session are fine — each one saves the cumulative state.

### Uploading Documentation Websites to Thread

**When to trigger:**
- User says "index these docs", "upload documentation to Thread", "crawl this site", "ingest these docs"
- User provides a URL containing `/docs/`, `/documentation/`, `/learn/`, `/reference/`, `/api/`, or similar doc paths and asks to save to Thread
- User provides a specific doc site root URL (e.g., `https://docs.example.com`) and wants all pages in Thread

**Site-agnostic design:** This workflow contains NO site-specific selectors, API paths, or parsing rules. It discovers and fetches using universal standards: `robots.txt`, XML sitemaps, `llms.txt`, HTML `<link>` tags, content negotiation, `.md` suffix probing, and generic `<article>`/`<main>` extraction. It works with any documentation framework — Docusaurus, Starlight, Fumadocs, Nextra, Mintlify, MkDocs, ReadTheDocs, GitBook, or custom.

#### 🔴 HARD RULE — Safety Constraints

1. **Never scrape auth-gated content** — If a page returns 401/403 or redirects to a login page, skip it. Do NOT attempt credential-based access.
2. **Respect `robots.txt`** — Read `/robots.txt` at the site root. If `Crawl-delay: N` is present, wait `N+1` seconds between requests. Respect `Disallow` rules.
3. **Rate-limit aggressively** — Add 1-2s jitter (`sleep $((1 + RANDOM % 2))`) between every page fetch. On 429 responses, back off exponentially (2s, 4s, 8s, max 30s). Never exceed 200 pages without user confirmation.
4. **No site-specific code** — DO NOT hardcode patterns like `github.com/en/free-pro-team@latest` or `nextjs.org/docs/app`. Everything must be discovered dynamically from the target site.
5. **Prioritize native markdown over HTML** — Always try API-based markdown endpoints, `.md` suffixes, and `llms.txt` before falling back to HTML extraction. Clean markdown is more reliable and produces better chunks.

#### Phase 1 — Discovery: Build the URL List

Try these discovery methods in strict order. Stop when one succeeds (returns 10+ valid doc URLs).

**Method A — `/llms.txt` (preferred)**

Check `https://{site}/llms.txt` and `https://{site}/.well-known/llms.txt`. Parse the markdown list format:

```bash
# Fetch llms.txt
curl -sSfL "https://example.com/llms.txt" 2>/dev/null || curl -sSfL "https://example.com/.well-known/llms.txt"

# Extract all links — lines starting with "- [" containing (url)
# Format: - [Title](url): Description
# Use grep to extract URLs
curl -sSfL "https://example.com/llms.txt" 2>/dev/null | grep -oP '(?<=\()https?://[^)]+' || true
```

If successful, parse the URLs. Filter to doc paths. Deduplicate.

**Method B — XML sitemaps**

Check `/robots.txt` for `Sitemap:` directives, then check common sitemap paths:

```bash
# Check robots.txt for Sitemap directives
curl -sSfL "https://example.com/robots.txt" 2>/dev/null | grep -i '^Sitemap:' | sed 's/^Sitemap:\s*//i' || true

# Check standard sitemap paths
for path in /sitemap.xml /sitemap_index.xml /sitemaps/sitemap.xml; do
  curl -sSfL "https://example.com${path}" -o "/tmp/opencode/sitemap-$(basename ${path})" 2>/dev/null && break
done

# Parse sitemap XML — extract all <loc> entries
# For sitemap indexes, recurse into child sitemaps
python3 -c "
import xml.etree.ElementTree as ET, sys
def extract(f):
    tree = ET.parse(f)
    root = tree.getroot()
    ns = {'s': 'http://www.sitemaps.org/schemas/sitemap/0.9'}
    locs = root.findall('.//s:loc', ns) or root.findall('.//loc')
    for l in locs:
        url = l.text.strip()
        if url.endswith('.xml'):  # child sitemap index
            import urllib.request
            resp = urllib.request.urlopen(url)
            extract(resp)
        else:
            print(url)
extract('/tmp/opencode/sitemap.xml')
" 2>/dev/null || true
```

Filter URLs to the doc section: keep paths containing `/docs/`, `/en/`, `/documentation/`, `/learn/`, `/reference/`, `/api/`, or matching the entry point's path prefix.

**Method C — Sitemap markdown index**

Some sites (Next.js, Mintlify) serve a human-readable sitemap in markdown:

```bash
curl -sSfL "https://example.com/docs/sitemap.md" 2>/dev/null || curl -sSfL "https://example.com/sitemap.md" 2>/dev/null
```

Parse links the same way as `llms.txt`.

**Method D — API-based discovery**

Check for API endpoints that list pages. Use by probing known patterns:

```bash
# GitHub Docs pattern
curl -sSfL "https://docs.github.com/api/pagelist/en/free-pro-team@latest" 2>/dev/null

# Generic — check <head> for alternate link patterns
webfetch "https://docs.example.com/en" | grep -oP 'rel="alternate"[^>]*href="[^"]*"' | grep -oP 'href="([^"]+)"' | head -20
```

**Method E — Recursive navigation crawl (last resort)**

If no sitemap or API exists, `webfetch` the entry page and extract all internal links:

1. `webfetch("https://example.com/docs")` with `format: "html"`
2. Extract all `<a href="...">` links pointing to the same domain
3. Filter to doc paths (same prefix as entry point)
4. Recursively follow discovered pages up to depth 2
5. Stop when no new pages found or 200 page limit reached

**Post-discovery:** Save the URL list for dedup and progress tracking.

```bash
# Save URL list to file
wc -l /tmp/opencode/doc-urls.txt
head -5 /tmp/opencode/doc-urls.txt
```

#### Phase 2 — Fetch Content (per URL, markdown-first)

For each URL in the list, try content fetch strategies in this order:

**Strategy 1 — API markdown endpoint (GitHub Docs pattern)**

```bash
# Check for <link rel="alternate" type="text/markdown"> in page <head>
# Fetch HTML head, extract the markdown API URL
page_html=$(webfetch "${url}" format:"html" 2>/dev/null)
md_url=$(echo "$page_html" | grep -oP 'type="text/markdown"[^>]*href="([^"]+)"' | grep -oP 'href="([^"]+)"' | sed 's/href="//;s/"//' | head -1)

if [ -n "$md_url" ]; then
  # Handle relative URLs
  full_md_url="${url}${md_url}"  # or use proper URL resolution
  content=$(webfetch "${full_md_url}" format:"text" 2>/dev/null)
fi
```

**Strategy 2 — `.md` suffix (Next.js Docs pattern)**

```bash
md_content=$(webfetch "${url}.md" format:"markdown" 2>/dev/null)
has_content=$(echo "$md_content" | wc -c)
# If content is non-trivial and not an error page, use it
```

**Strategy 3 — `Accept: text/markdown` content negotiation (Next.js pattern)**

This requires `curl` with a custom `Accept` header:

```bash
content=$(curl -sSfL -H "Accept: text/markdown" "${url}" 2>/dev/null)
# If content starts with # (markdown heading), it's valid markdown
```

**Strategy 4 — Fetch with `webfetch` default markdown conversion**

```bash
content=$(webfetch "${url}" format:"markdown" 2>/dev/null)
```

**Strategy 5 — HTML → plain text extraction fallback**

```bash
# Fetch as HTML and extract readable text with python3
html=$(webfetch "${url}" format:"html" 2>/dev/null)

content=$(echo "$html" | python3 -c "
import sys, re
html = sys.stdin.read()

# Extract <article> or <main> content first
for tag in ['article', 'main', '[role=main]']:
    m = re.search(rf'<{tag}[^>]*>(.*?)</{tag}>', html, re.DOTALL)
    if m: html = m.group(1); break

# Remove nav, header, footer, aside, script, style elements
for tag in ['nav', 'header', 'footer', 'aside', 'script', 'style', 'noscript']:
    html = re.sub(rf'<{tag}[^>]*>.*?</{tag}>', '', html, flags=re.DOTALL)

# Insert newlines before block elements for readability
for tag in ['h1','h2','h3','h4','h5','h6','p','li','div','br','tr','th','td']:
    html = re.sub(rf'(</?{tag}[^>]*>)', r'\n\1', html)

# Strip all remaining HTML tags
html = re.sub(r'<[^>]+>', '', html)

# Decode common HTML entities
html = (html.replace('&amp;', '&').replace('&lt;', '<')
            .replace('&gt;', '>').replace('&quot;', '\"')
            .replace('&#39;', \"'\").replace('&nbsp;', ' '))

# Collapse multiple blank lines
html = re.sub(r'\n{3,}', '\n\n', html)
sys.stdout.write(html.strip())
" 2>/dev/null)

# Only use if webfetch markdown returned too little content
if [ ${#content} -lt 50 ]; then
  content=$(webfetch "${url}" format:"text" 2>/dev/null)
fi
```

**After each page fetch,** append to the combined markdown file:

```bash
# Append page content with heading anchor
{
  echo ""
  echo "## ${page_title:-Untitled}"
  echo ""
  echo "_Source: ${url}_"
  echo ""
  echo "${content}"
} >> /tmp/opencode/site-docs-${site_name}.md

# Track progress
echo "Fetched ${current}/${total}: ${url}"
sleep $((1 + RANDOM % 2))  # Polite delay
```

#### Phase 3 — Upload to Thread

**Option A — Combined markdown file (recommended for 50+ pages)**

Write all pages to a single markdown file with `## Title` per page, then upload in one call:

```bash
# Upload the combined file — server chunks by ## headings
thread_upload_file \
  file_path:"/tmp/opencode/site-docs-${site_name}.md" \
  tags:"docs-import,${site_name_tag}" \
  priority:5
```

Each `##` heading becomes one Thread entry. The `_Source: URL_` line after each heading ensures every entry traces back to its source.

**Option B — Bulk entries (recommended for <50 pages with per-entry control)**

For smaller sites where you want per-entry tags or priorities:

```bash
# Collect entries in batches of 100
entries_batch=()
while IFS= read -r page; do
  # Fetch content (try markdown-first strategies)
  content=$(webfetch "${page}" format:"markdown" 2>/dev/null)
  title=$(echo "$content" | head -1 | sed 's/^# //')
  
  entries_batch+=("{\"content\": \"# ${title}\n\n_Source: ${page}_\n\n${content}\", \"priority\": 5, \"tags\": [\"docs-import\", \"${site_name_tag}\"]}")
  
  if [ ${#entries_batch[@]} -ge 100 ]; then
    # Flush batch
    thread_bulk_create_entries entries:"[${entries_batch[*]}]"
    entries_batch=()
  fi
done < /tmp/opencode/doc-urls.txt

# Flush remaining
if [ ${#entries_batch[@]} -gt 0 ]; then
  thread_bulk_create_entries entries:"[${entries_batch[*]}]"
fi
```

**Option C — Per-page entries (recommended for <20 pages or high-value pages)**

For carefully curated imports where each page deserves attention:

```bash
while IFS= read -r page; do
  content=$(webfetch "${page}" format:"markdown" 2>/dev/null)
  title=$(echo "$content" | head -1 | sed 's/^# //')
  
  thread_create_entry \
    content:"# ${title}\n\n_Source: ${page}_\n\n${content}" \
    tags:"[\"docs-import\", \"${site_name_tag}\"]" \
    priority:5
done < /tmp/opencode/doc-urls.txt
```

#### Phase 4 — Verify and Report

After upload, verify the results and report to the user:

```bash
# Report summary
echo "=== Documentation Import Complete ==="
echo "Site: ${site_url}"
echo "Pages found: ${total_discovered}"
echo "Pages fetched: ${total_fetched}"
echo "Entries created: ${entries_created}"
echo "Upload method: ${method_used}"
echo "Tags: docs-import, ${site_name_tag}"

# Check Thread for the new entries
thread_search query:"docs-import AND ${site_name_tag}" limit:3
```

#### Complete Workflow Example

The full pipeline chained together for a single invocation:

```bash
# ADAPT DISCOVERY METHOD based on what the site supports
# (try methods A→E in order as described above)

SITE="docs.github.com"
SITE_NAME="github-docs"
BASE="https://${SITE}/en"

# Step 1 — URL discovery (try llms.txt first)
DISCOVERY=$(curl -sSfL "https://${SITE}/llms.txt" 2>/dev/null && echo "llms" \
  || curl -sSfL "https://${SITE}/sitemap.xml" 2>/dev/null && echo "sitemap" \
  || echo "crawl")

# Step 2 — Fetch each page (webfetch markdown)
# Step 3 — Append to combined file
# Step 4 — thread_upload_file
# Step 5 — Report

echo "Discovery method: ${DISCOVERY}"
```

#### Tag Convention for Doc Imports

| Tag | Value | Example |
|-----|-------|---------|
| `docs-import` | Fixed — identifies this as a doc website import | `docs-import` |
| `{site-name}` | Site-specific — lowercase, hyphenated, domain-derived | `github-docs`, `nextjs-docs` |
| `{version-or-locale}` | Optional — version or language of the imported docs | `en`, `free-pro-team`, `v16` |

#### Priority Guidelines for Doc Imports

| Priority | Use Case |
|----------|----------|
| 7-8 | Foundational docs (API reference, architecture guides) |
| 5-6 | Tutorials, how-to guides, general documentation |
| 3-4 | Release notes, changelogs, peripheral pages |
| 0-2 | Auto-generated low-signal pages (redirect stubs, TOC-only pages) |

#### When to NOT Use This Workflow

- Auth-gated or private documentation (login required)
- Sites that explicitly block crawlers in `robots.txt` via `Disallow: /`
- Multimedia-only sites (no text content to extract)
- PDF-only documentation (no HTML/markdown version)
- Sites exceeding 500 pages — warn the user and ask for a sub-path filter
- The same site was already imported — check `thread_search` with `"docs-import" AND "{site-tag}"` first

### After Creating or Updating Documentation Files

When you create or modify documentation files (`.md`, `.txt`, `.json`, `.jsonl`), keep Thread entries in sync:

- **Creating new docs:** Run `thread_upload_file` on the file. Tags: `["reference", "docs"]`. Priority: 4. This auto-chunks the file by headings (`.md`), paragraphs (`.txt`), passes through (`.json`), or splits line-by-line with role+content extracted (`.jsonl`).

- **Updating existing docs:** First clean up stale entries from the previous version, then upload the new one:
  1. **Find old entries** — Use `thread_search` with a keyword from the file's path or title to locate entries from the previous upload. Scope by the current workspace session (run `basename "$PWD"`).
  2. **Remove stale entries** — Read candidate entries with `thread_read_entries_batch` to confirm they're stale, then delete them with `thread_delete_entry`. For bulk removal (many entries matching a tag), use the helper script at `.agents/skills/thread-auto-context/scripts/cleanup-entries.py`.
  3. **Upload the updated file** — Run `thread_upload_file` on the changed file with the same Tags: `["reference", "docs"]`. Priority: 4.

### Batch Cleanup of Entries

When you need to remove many entries at once (e.g., after a re-import with
better fetch settings), use the helper script:

```bash
.agents/skills/thread-auto-context/scripts/cleanup-entries.py
```

Edit the config block at the top of the script to set:
- `SESSION` — target session name
- `TARGET_TAG` — only entries with this tag are deleted
- `BASE_URL` — Thread server URL (default: `http://localhost:5000`)
- `LIMIT` — entries per page (default: 200)
- `SLEEP_MS` — delay between deletes to avoid hammering the server (default: 50)

The script scans the entire session via cursor pagination, finds all entries
matching `TARGET_TAG`, and deletes them one by one.

**Requirements:** `requests` library, `THREAD_API_TOKEN` env var.

### VS Code Integration
Once `.vscode/mcp.json` is written, the VS Code MCP extension automatically detects the config change and spawns the bridge process. No manual reload needed. If Thread tools don't appear within ~15 seconds, run the VS Code command `Developer: Reload Window`.

### Cline Integration
Once the Cline MCP config is written (global settings and/or `.cline/mcp.json`), the user must **reload the Cline extension** for it to pick up the new server. Tell the user: "Reload the Cline extension (or the window) to activate the Thread MCP server." The Cline extension does NOT auto-detect config file changes — reload is manual.

## Session Names

**You do not pick the session name.** The MCP config in `.vscode/mcp.json` sets `THREAD_DEFAULT_SESSION` — that IS the session. Every `thread_*` tool defaults to it. Never pass `session` param unless the user explicitly asks. Only call `thread_create_session` if the user says "create a session."

## Shared Infrastructure vs Workspace-Specific Content

**Default Global Session (`THREAD_DEFAULT_SESSION`):** Use for shared infrastructure, frameworks, tools, and consumables that are **not specific to any single repository or workspace**. This includes:
- Documentation (Kubernetes docs, Docker best practices, Python/Next.js conventions)  
- Framework guides (React patterns, Python type hints, Rust lifetimes)  
- Infrastructure reference material (IDE usage, OS commands, CI/CD patterns)  
- General tooling guides (docker-compose, kubectl, git workflows)  
- Cross-project reusable knowledge and anti-patterns

**Workspace-Specific Session:** Use for:
- Decisions about this specific codebase  
- Bug fixes and their lessons  
- Design choices in this project  
- User preferences or constraints for this repo  
- Project-specific patterns or conventions  

The default session is the **shared library** — think of it as the global knowledge base that all projects can benefit from. Workspace sessions are for local context only.

## Priority Guidelines
| Priority | When to use |
|----------|-------------|
| 9-10 | Critical decisions, security rules, user constraints |
| 7-8 | Design decisions, architecture choices, preferences |
| 5-6 | Useful context, bug lessons, code patterns |
| 3-4 | General notes, observations |
| 0-2 | System markers, low-signal entries |

## Tag Convention

**Shared Infrastructure Tags (default global session):**
- `architecture` — system design, component layout  
- `decision` — any design or implementation choice  
- `preference` — user style/approach preferences  
- `bug` — bug findings and fixes  
- `pattern` — reusable code patterns discovered  
- `reference` — documentation, spec links, API references  
- `docs-import` — documentation website imports (see "Uploading Documentation Websites to Thread")  

**Workspace-Specific Tags:**
- `project-decision` — decisions about this specific codebase (prefer over generic `decision`)  
- `bug-fix` — bug fixes in this project (prefer over generic `bug`)  
- `workspace-preference` — user preferences for this repo  
- `local-pattern` — patterns discovered only in this workspace  

**General Tags:**
- `summary` — session summaries  
- `export` — `/export` snapshots of git state, decisions, and counts  
- `transcript` — full conversation transcript exports  
- `full-session` — complete session context dumps  
- Project-specific tags as appropriate

**Rule of thumb:** If it's useful to **any project** (including future ones you'll work on), put it in the default global session. If it only matters for **this specific repository**, use a workspace session with `-project-name` suffix if needed.

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
