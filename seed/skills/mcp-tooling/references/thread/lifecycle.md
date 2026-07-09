---
title: "Thread MCP Session Lifecycle — Start, During, End Protocols"
impact: HIGH
impactDescription: "Standardizes when and how to save context to Thread throughout a session"
tags: [thread, mcp, session, lifecycle, export, memory]
---

## Thread MCP Session Lifecycle

### 🔴 Session Name Rules

You do not pick the session name. The MCP config in `.vscode/mcp.json` sets `THREAD_DEFAULT_SESSION` — that IS the session. Every `thread_*` tool defaults to it. Never pass `session` param unless the user explicitly asks. Only call `thread_create_session` if the user says "create a session."

- During **initialization** (fresh repo, no `.vscode/mcp.json`): the bridge auto-creates the session on first tool call.
- During **normal operation** (`.vscode/mcp.json` exists): the default session IS your session.
- If `.vscode/mcp.json` already has `THREAD_DEFAULT_SESSION` set, use it. Never create a different session.

### At Session Start

1. Check if OpenCode is running (`$OPENCODE` env var or `.opencode/` directory)
2. If already configured (opencode.jsonc has "thread" provider): call `thread_read_entries` with `sort: "desc"`, `limit: 10` to see recent entries
3. Search past context relevant to the user's first question using `thread_search`
4. Summarize the most relevant entries before answering

### During Session — MANDATORY CHECKLIST

These are NOT suggestions. You MUST do them at the time they happen, not later.

After EVERY code change (write/edit/delete/refactor), IMMEDIATELY save context before doing anything else:

- **Made a design decision?** → `thread_create_entry` NOW. Priority 8. Tags: `["decision"]`. Do NOT pass `session` param.
- **Fixed a bug with a non-obvious lesson?** → `thread_create_entry` NOW. Priority 9. Tags: `["bug"]`. Include root cause.
- **Heard a user preference?** → `thread_create_entry` NOW. Priority 7. Tags: `["preference"]`.
- **Heard a constraint/deadline/requirement?** → `thread_create_entry` NOW. Priority 9.
- **Created or updated a documentation file?** → `thread_upload_file` NOW. Tags: `["reference", "docs"]`. Priority 4.

If you call task_complete and haven't saved context since your last code change, you have violated this rule.

### Storage Monitoring

Before uploading large files (transcripts, bulk imports), check disk headroom:

1. Call `thread_get_storage` to get `free_bytes`, `used_bytes`, `total_bytes`
2. If `free_bytes` is below 20% of `total_bytes`, warn the user
3. If the upload is larger than `free_bytes`, skip the upload and warn the user

### At Session End — MANDATORY EXPORT

When the user says "thanks", "done", "that's all", "that worked", or similar wrap-up phrases, you MUST do ALL of the following.

#### 🔴 Full Transcript Export Required

At session end, write the full conversation transcript to a file and upload it to Thread:

1. Compose a markdown transcript covering every turn — user's intent, assistant's actions, key decisions, file manifest, commit hashes
2. Write it to `/tmp/opencode/session-{YYYY-MM-DD}-transcript.md`
3. Call `thread_upload_file` on that path with Tags: `["export", "transcript", "full-session"]`. Priority: 9.

This ensures every session is fully recoverable from Thread even if the platform's own chat history is lost.

After transcript upload, continue with remaining steps:

1. **Save session summary** — `thread_create_entry` with session's key changes, decisions, outcomes. Priority: 7. Tags: `["export", "session-state", "opencode"]`.
2. **Save decisions** — `thread_create_entry` consolidating all design decisions, architecture choices, and non-obvious lessons. Priority: 8. Tags: `["export", "decisions", "opencode"]`.
3. **Save git state** — Run `git log --oneline -7` and `git diff --cached --stat`. Save via `thread_create_entry`. Priority: 6. Tags: `["export", "git-status", "opencode"]`.
4. **Output a copyable import prompt** — After saving, provide the user with a summary of what was saved.
5. **Check for prior exports first** — Before creating, run `thread_search` with `"export" AND "opencode"`. If entries already exist, update them via `thread_update_entry` rather than creating duplicates.

### Shared Infrastructure vs Workspace-Specific Content

**Default Global Session:** Use for shared infrastructure, frameworks, tools, and consumables not specific to any single repository (documentation, framework guides, infrastructure reference, general tooling, cross-project reusable knowledge).

**Workspace-Specific Session:** Use for decisions about this specific codebase, bug fixes and their lessons, design choices, user preferences or constraints for this repo, project-specific patterns or conventions.

### Session Names

The default value for `THREAD_DEFAULT_SESSION` is `"default"`. This is Thread's global knowledge base — use this session for all shared infrastructure, frameworks, tools, and consumables that are not specific to any single repository or workspace.
