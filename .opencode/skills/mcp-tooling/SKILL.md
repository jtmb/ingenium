---
name: mcp-tooling
description: "MCP tool integration and automation — Playwright browser automation (navigate, screenshot, inspect, interact, console), Thread MCP persistent memory (context save/retrieve, session lifecycle, doc upload), email client tools (list, search, read, send, draft, triage, suggest response, auto-draft, IMAP watcher), and future MCP tool integrations. Use when the user asks for browser automation, persistent memory operations, or any MCP-based tool workflow."
alwaysApply: true
---

# MCP Tooling — MCP Tool Integration & Automation

> This skill uses a split-skill architecture. The index below lists all 🔴 HARD RULEs, followed by a Table of Contents linking to reference files.

## When to Use

- "review the website UI at localhost:3000"
- "take a screenshot of the homepage"
- "check responsive design at mobile width"
- "debug layout issues on this page"
- "inspect the DOM for element problems"
- "check console errors on the page"
- "verify the page renders correctly"
- "save this decision to Thread"
- "save context before we wrap up"
- "what did we decide last session?"
- "index these docs into Thread"
- Any task involving MCP tool interaction, browser automation, or persistent memory

## 🔴 HARD RULEs

### 🔴 Always Clean Up Browser Sessions

After taking screenshots or inspecting a page, close the browser session. Leaving sessions open wastes resources and can interfere with subsequent tool calls.

### 🔴 Never Automate Real Credentials

Do not use Playwright to log into services with real user credentials or submit forms with sensitive data. Use test accounts or mock data.

### 🔴 Save Screenshots to Describable Paths

When saving screenshots, use paths that describe what they contain: `screenshot-homepage-mobile.png`, `screenshot-error-state.png`. Avoid generic names like `screenshot1.png`.

### 🔴 Verify MCP Server is Running Before Tool Calls

Before calling any MCP tool, verify that the MCP server is configured in `opencode.json` and the server process is running. Check `.opencode/agents/*.md` for tool permissions.

### 🔴 Ingenium MCP Tool Naming — Use Correct Prefix

All Ingenium MCP tools use a **double `ingenium_ingenium_` prefix**:

| ✅ Correct | ❌ Wrong |
|-----------|---------|
| `ingenium_ingenium_observation_stats` | `ingenuum_ingenium_observation_stats` (typo) |
| `ingenium_ingenium_skill_load` | `ingenium_skill_load` (missing prefix) |
| `ingenium_ingenium_observe` | `ingenium_observe` (missing prefix) |

The pattern is: `ingenium_ingenium_<noun>_<verb>`. Double-check the prefix before calling — a typo wastes tool calls.

### 🔴 Save Context to Thread After Every Code Change

After every code change (write/edit/delete/refactor), IMMEDIATELY save context to Thread before doing anything else:
- Design decisions → `thread_create_entry` with priority 8, tags `["decision"]`
- Bug fixes → `thread_create_entry` with priority 9, tags `["bug"]`, include root cause
- User preferences → `thread_create_entry` with priority 7, tags `["preference"]`
- Do NOT pass `session` param — the default session is always correct
- Do NOT ask permission — just save silently

### 🔴 Verify Before Destructive Thread Operations

When performing destructive operations (deletion, modification), ALWAYS verify first:
- **Check server health** before any batch operation
- **Verify session exists** BEFORE deleting — check for 404 (doesn't exist) vs 401 (auth failure)
- **Parse HTTP status codes correctly:** HTTP 204 = Deleted; HTTP 404 on DELETE = Already deleted; HTTP 401 = Authentication failure — NOT deletion
- **Never assume HTTP 401 means success** — authenticate properly before retrying

### 🔴 Never Ask Permission to Use MCP Tools

Use MCP tools (Playwright, Thread, etc.) proactively and silently. Never ask "can I take a screenshot?" or "should I save this to Thread?" — just do it.

### 🔴 Full Export at Session End

When the session ends (user says "thanks", "done", "that's all"), you MUST:
1. Write full conversation transcript to `/tmp/opencode/session-{date}-transcript.md`
2. Upload it to Thread via `thread_upload_file` with tags `["export", "transcript", "full-session"]`
3. Save session summary, decisions, and git state as separate Thread entries
4. Check for prior exports first — update existing entries rather than creating duplicates

## Reference Files

| File | Content |
|------|---------|
| [`references/playwright/setup.md`](references/playwright/setup.md) | Playwright MCP server configuration, prerequisites, troubleshooting |
| [`references/playwright/tools.md`](references/playwright/tools.md) | Complete catalog of Playwright MCP browser automation tools |
| [`references/playwright/patterns.md`](references/playwright/patterns.md) | Common workflows: page review, responsive check, error capture, click debugging |
| [`references/thread/setup.md`](references/thread/setup.md) | Thread MCP setup — auto-init, bridge config, provider config, verification |
| [`references/thread/lifecycle.md`](references/thread/lifecycle.md) | Thread session lifecycle — start/during/end protocols, mandatory export |
| [`references/thread/doc-upload.md`](references/thread/doc-upload.md) | Documentation website upload — site discovery, content fetch, bulk import |
| [`references/thread/conventions.md`](references/thread/conventions.md) | Thread conventions — priority guidelines, tag naming, never rules |
| [`references/dev-browser/setup.md`](references/dev-browser/setup.md) | Dev Browser setup — installation, modes (headless/connect), WSL→Windows Chrome launch, HARD RULEs, troubleshooting |
| [`references/dev-browser/tools.md`](references/dev-browser/tools.md) | Complete catalog of dev-browser API methods — browser control, page actions, CUA tools, DOM CUA tools, screenshots |
| [`references/dev-browser/patterns.md`](references/dev-browser/patterns.md) | Common workflows: navigate+screenshot, form fill+submit, snapshot for AI analysis, WSL Chrome launch |

## Email Tools (13 tools)

The Ingenium email client provides MCP tools for IMAP/SMTP email operations:

- \`ingenium_email_list\` — List emails with filters
- \`ingenium_email_search\` — Search emails across folders
- \`ingenium_email_read\` — Read individual email content and headers
- \`ingenium_email_send\` — Send new email via SMTP
- \`ingenium_email_draft\` — Create draft email for later sending
- \`ingenium_email_folders\` — Manage IMAP folder structure (create, delete, rename)
- \`ingenium_email_accounts\` — List and configure email accounts
- \`ingenium_email_triage\` — Auto-classify emails by priority/category
- \`ingenium_email_suggest_response\` — Suggested responses for incoming messages
- \`ingenium_email_draft_response\` — Create draft reply to selected email
- \`ingenium_email_patterns\` — Email interaction patterns and templates
- \`ingenium_email_watch_start\` — Start IMAP polling watcher (background)
- \`ingenium_email_watch_status\` — Check/watcher status for active watchers

## Migrated Sources (Phase 3 Taxonomy)

| Source | Content Preserved At |
|--------|---------------------|
| `browsing-the-web` | [`references/sources/browsing-the-web/`](references/sources/browsing-the-web/source-index.md) |
| `dashboard-screenshots` | [`references/sources/dashboard-screenshots/`](references/sources/dashboard-screenshots/source-index.md) |

## Cross-References

- **`@development-conventions`** — Web design review workflow that uses Playwright for visual inspection
- **`@devops-conventions`** — Shell scripts for launching dev servers before testing
- **`@engineering-workflow`** — Agent configuration and permission lockdown patterns for MCP tools

(End of file - total 89 lines)