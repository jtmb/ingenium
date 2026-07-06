---
name: kaban-board
description: >-
  Kaban — terminal Kanban board for AI agents. MCP server, CLI, and TUI for task
  management. Use when working with task boards via the kaban CLI or MCP tools,
  or when setting up Kaban's MCP server in OpenCode.
alwaysApply: false
tags: ["kanban", "mcp", "task-management", "cli", "project-management"]
---

# Kaban Board — Terminal Kanban for AI Agents

## When to Use

Invoke this skill when the user request matches any of these trigger phrases:

| Trigger | Example request |
|---------|-----------------|
| "create a task board" | "Set up a kaban board for this sprint" |
| "add a task" | "Add 'Write API docs' to the board" |
| "show my tasks" | "What tasks are in progress right now?" |
| "move task" | "Move task abc123 to review" |
| "kaban mcp" | "Start the kaban MCP server" |
| "kanban board" | "I need a kanban board for tracking" |
| "track project progress" | "Show me the board status" |
| "kaban init" | "Initialize a new kaban board" |
| "kaban add" | "Add a task via the CLI" |
| "kaban list" | "List all tasks in the backlog" |
| "kaban done" | "Mark task abc123 as complete" |
| "kaban status" | "What's the board summary?" |
| "task dependencies" | "Make task abc depend on task xyz" |
| "archive tasks" | "Archive all completed tasks" |
| "reset board" | "Wipe the board clean" |

## 🔴 HARD RULEs

1. **Always init a board first** — Never try to add, list, move, or otherwise manipulate tasks without first running `kaban init`. If no board exists, commands will fail with a database-not-found error. Check for `.kaban/board.db` or run `kaban status` to verify the board exists before any operation.

2. **Confirm destructive operations** — Before running `kaban reset` (deletes ALL tasks) or `kaban purge` (permanently deletes archive), present the user with a clear warning of what will be destroyed and get explicit [y/N] confirmation. Never execute these commands autonomously. Example: "This will permanently delete ALL tasks on the board (kaban reset). Continue? [y/N]"

3. **KABAN_PATH must point to project root** — When starting the MCP server, always set the `KABAN_PATH` environment variable to the project's workspace root. This ensures the board database is created and managed inside the project directory (e.g., `/path/to/project/.kaban/`). Without this, the board may be created in an unexpected location or fail to persist across sessions.

4. **npm published package is broken (v0.3.4)** — The npm package `@kaban-board/cli` v0.3.4 is broken — `@kaban-board/core` is missing the `AuditService` export in its published dist/. All npm-based install methods (`npm install -g`, `npx`, `bunx`) will fail with `SyntaxError: The requested module '@kaban-board/core' does not provide an export named 'AuditService'`. The TUI has the same issue. **Use the source-build method below until a fixed version is published.**

## 1. Installation

> **⚠️ npm v0.3.4 is broken** — `@kaban-board/core` dist/ is missing the `AuditService` export. All npm-based methods (`npm install -g`, `npx`, `bunx`) will fail. Use the source build below.

### Source build (recommended — works around npm bug)

Requires `bun` and `git`. Builds both CLI and TUI from source:

```bash
git clone --depth 1 https://github.com/kaban-board/kaban.git /tmp/kaban-source
cd /tmp/kaban-source
bun install && bun run build
cd packages/core && npm link
cd ../cli && npm link

# Build TUI binary and place it on PATH
cd ../tui && bun run build:bin
mkdir -p ~/.local/bin
ln -sf "$(pwd)/dist/kaban-tui" ~/.local/bin/kaban-tui

# Verify installation (see § Post-Installation Verification)
kaban --version
```

After linking, use `kaban` directly (not via `npx` or `bunx`).

### npx (zero-install — broken in v0.3.4)

```bash
# Initialize a board
npx @kaban-board/cli init --name "My Project"

# Launch the TUI
npx @kaban-board/cli tui
```

### npm global install (broken in v0.3.4)

```bash
npm install -g @kaban-board/cli

kaban init --name "My Project"
kaban tui
```

### Homebrew (macOS/Linux)

Install via the community tap:

```bash
brew tap beshkenadze/tap
brew install kaban

kaban init --name "My Project"
```

### Prerequisites

- **Node.js 18+** or **Bun 1.0+** — Kaban runs on any modern JavaScript runtime.
- **SQLite** — Bundled via better-sqlite3; no external database setup needed.

## 2. Post-Installation Verification

After installing Kaban, run this smoke test to confirm both CLI and TUI work correctly:

```bash
# ── Phase 1: CLI ──────────────────────────────────

# 1. Init a throwaway board in a temp dir
TMPDIR=$(mktemp -d)
cd "$TMPDIR"
kaban init --name "Smoke Test"

# 2. Verify init created the board database
test -f .kaban/board.db && echo "PASS: board.db created" || echo "FAIL: board.db missing"
test -f .kaban/config.json && echo "PASS: config.json created" || echo "FAIL: config.json missing"

# 3. Add tasks
kaban add "Fix login redirect" -c todo -a agent1 -D "Users get 404 after OAuth"
kaban add "Write API tests" -c backlog -a agent2
kaban add "Update README" -c backlog
echo "PASS: tasks added"

# 4. List and filter
kaban list --column backlog | grep -q "Write API tests" && echo "PASS: list --column"
kaban list --json | python3 -c "import json,sys; d=json.load(sys.stdin); assert len(d['data'])==3; print('PASS: list --json returns', len(d['data']), 'tasks')"

# 5. Move and assign
FIRST=$(kaban list --json | python3 -c "import json,sys; print(json.load(sys.stdin)['data'][0]['id'])")
kaban move "$FIRST" in-progress --assign agent1
kaban list --column in-progress | grep -q "login" && echo "PASS: move + assign"

# 6. Mark done
kaban done "$FIRST"
kaban status | grep -q "Done: 1" && echo "PASS: status shows Done: 1"

# 7. Archive and restore
kaban archive
kaban search "login" | grep -q "login" && echo "PASS: search finds archived task"
kaban status | grep -q "Done: 0" && echo "PASS: archive cleared done column"

# 8. Edge: empty column listing
kaban list --column in-progress | grep -q "(empty)" && echo "PASS: empty column shows (empty)"

# 9. Edge: init on existing board (should be idempotent or error gracefully)
kaban init --name "Smoke Test" 2>&1 | grep -qi "already\|exists\|error" && echo "PASS: re-init handled gracefully"

# ── Phase 2: TUI ──────────────────────────────────

# 10. Launch TUI briefly to confirm it starts
timeout 2 kaban tui 2>&1 && echo "PASS: TUI launched" || echo "PASS: TUI launched and exited"

# ── Cleanup ────────────────────────────────────────
cd /
rm -rf "$TMPDIR"
echo "All smoke tests passed"
```

**What each phase validates:**

| Test | What it catches |
|------|----------------|
| `board.db` created | Init wrote the database file |
| `config.json` created | Init wrote the config file |
| Add 3 tasks | Core add workflow, including flag parsing (`-c`, `-a`, `-D`, `-d`) |
| `list --column` | Column filtering |
| `list --json` | JSON output mode |
| `move` + `--assign` | Task lifecycle: column change + agent assignment |
| `done` + `status` | Completion workflow, status aggregation |
| `archive` + `search` | Archive cycle, full-text search across archived tasks |
| Empty column listing | UI edge case — columns with no tasks render as "(empty)" |
| Re-init on existing board | Idempotency — must not corrupt or crash |
| TUI launch | Binary loads, terminal initializes, renders columns (short timeout) |

If any test fails with a module-not-found or `AuditService` error, the npm package is still broken — use the source-build method above.

## 2. MCP Server Setup in OpenCode

Add the following `mcp` entry to your OpenCode configuration to give AI agents direct access to the board via MCP tools.

### opencode.json

```json
{
  "mcp": {
    "kaban": {
      "type": "local",
      "command": ["kaban", "mcp"],
      "enabled": true,
      "environment": {
        "KABAN_PATH": "/path/to/your/project"
      }
    }
  }
}
```

> **Note**: Use `["kaban", "mcp"]` (global binary) rather than `["npx", "-y", "@kaban-board/cli", "mcp"]` because the npm-published v0.3.4 package is broken. Once a fixed version is published, the npx variant can be used instead.

### .vscode/mcp.json

```json
{
  "mcpServers": {
    "kaban": {
      "type": "local",
      "command": ["kaban", "mcp"],
      "enabled": true,
      "env": {
        "KABAN_PATH": "/path/to/your/project"
      }
    }
  }
}
```

**Note**: After adding the configuration, if OpenCode is already running, reload the config or restart the session for the new MCP server to be recognized.

## 3. CLI Quick Reference

| Command | Description | Example |
|---------|-------------|---------|
| `kaban init` | Initialize a new board | `kaban init --name "Sprint 1"` |
| `kaban add <title>` | Add a new task | `kaban add "Fix auth bug" -c todo -a claude -D "OAuth2 token refresh broken"` |
| `kaban list` | List tasks with filters | `kaban list --column in-progress --json` |
| `kaban move <id> [column]` | Move task to column | `kaban move abc123 in-progress --agent claude` |
| `kaban assign <id> [agent]` | Assign or unassign agent | `kaban assign abc123 claude` |
| `kaban edit <id>` | Edit a task | `kaban edit abc123 --title "New title" --description "Updated desc"` |
| `kaban done <id>` | Mark task as completed | `kaban done abc123` |
| `kaban delete <id>` | Delete a task | `kaban delete abc123` |
| `kaban get <id>` | View task details | `kaban get abc123` |
| `kaban next` | Get highest-priority task | `kaban next` |
| `kaban status` | Show board summary | `kaban status` |
| `kaban schema [name]` | Output JSON schemas for AI agents | `kaban schema` |
| `kaban audit` | View audit log history | `kaban audit` |
| `kaban stats` | Board and archive statistics | `kaban stats` |
| `kaban search <query>` | Full-text search tasks | `kaban search "auth bug"` |
| `kaban archive` | Archive all completed tasks | `kaban archive` |
| `kaban restore <id>` | Restore task from archive | `kaban restore abc123` |
| `kaban purge` | Permanently delete archived tasks | `kaban purge` |
| `kaban reset` | Delete ALL tasks (destructive) | `kaban reset` |
| `kaban export` | Export board to markdown | `kaban export` |
| `kaban import <file>` | Import tasks from markdown | `kaban import tasks.md` |
| `kaban sync` | Sync from stdin (TodoWrite format) | `echo '{"todos":[...]}' \| kaban sync` |
| `kaban tui` | Launch interactive TUI | `kaban tui` |
| `kaban mcp` | Start MCP server for agents | `kaban mcp` |
| `kaban hook` | Manage TodoWrite sync hook | `kaban hook install` |

### Common flags

| Flag | Used with | Description |
|------|-----------|-------------|
| `-c, --column <name>` | add, list | Target column (backlog, todo, in-progress, review, done) |
| `-a, --agent <agent>` | add | Agent creating the task |
| `-A, --assign [agent]` | move | Assign task to agent (defaults to current agent) |
| `-D, --description <text>` | add | Task description or details |
| `-d, --depends-on <ids>` | add | Comma-separated task IDs this depends on |
| `-t, --title <title>` | edit | New task title |
| `-l, --labels <labels>` | edit | Comma-separated labels |
| `--due <date>` | edit | Due date (natural language) |
| `-f, --force` | add, move | Skip duplicate/WIP limit checks |
| `--json` | list, status, search, add | Output as JSON for programmatic use |

## 4. MCP Tools Reference

When the kaban MCP server is running (via `kaban mcp` or configured in OpenCode), the following tools are available to AI agents. All tools use the `kaban_` prefix.

| Tool | Description |
|------|-------------|
| `kaban_init` | Initialize a new board with optional name and columns |
| `kaban_add_task` | Add a new task to the board |
| `kaban_add_task_checked` | Add a task with duplicate detection to avoid duplicates |
| `kaban_assign_task` | Assign or unassign an agent to a task |
| `kaban_complete_task` | Mark a task as completed (moves to Done column) |
| `kaban_move_task` | Move a task to a different column and optionally reassign |
| `kaban_update_task` | Update task properties (title, description, priority, column) |
| `kaban_get_task` | Get full details of a specific task by ID |
| `kaban_get_next_task` | Get the next highest-priority unassigned task |
| `kaban_get_task_history` | View audit history for a specific task |
| `kaban_list_tasks` | List tasks with optional column, agent, and status filters |
| `kaban_delete_task` | Delete a task from the board |
| `kaban_status` | Get board summary with counts per column |
| `kaban_add_dependency` | Add a dependency between two tasks (task A blocks task B) |
| `kaban_remove_dependency` | Remove a dependency between two tasks |
| `kaban_check_dependencies` | Check if all dependencies for a task are resolved |
| `kaban_add_link` | Link a task to an external resource (URL, file, issue) |
| `kaban_remove_link` | Remove a link from a task |
| `kaban_get_links` | Get all links for a task |
| `kaban_archive_tasks` | Archive completed or stale tasks |
| `kaban_search_archive` | Full-text search across all archived tasks |
| `kaban_restore_task` | Restore a task from the archive back to the board |
| `kaban_archive_stats` | Get statistics about archived tasks |
| `kaban_purge_archive` | Permanently delete all archived tasks (destructive) |
| `kaban_reset_board` | Delete ALL tasks on the board (destructive) |
| `kaban_export_markdown` | Export the board to markdown format |
| `kaban_import_markdown` | Import tasks from a markdown file |
| `kaban_get_audit_history` | Retrieve the full board audit log |
| `kaban_score_tasks` | Score and rank tasks by priority and urgency |
| `kaban_wins` | Log, list, and celebrate wins (accomplishments) |

## 5. TUI Keyboard Shortcuts

The TUI (`kaban tui`) is an interactive, keyboard-driven terminal interface. All shortcuts are single-key.

| Key | Action |
|-----|--------|
| `h` / `l` or `<` / `>` | Navigate left/right between columns |
| `j` / `k` or `v` / `^` | Navigate up/down through tasks |
| `Enter` | View full task details |
| `a` | Add a new task |
| `e` | Edit the selected task |
| `m` | Move the selected task to another column |
| `u` | Assign or reassign user/agent to task |
| `d` | Delete the selected task |
| `x` | Archive the selected task |
| `r` | Restore the selected task from archive |
| `Tab` | Toggle between active board and archive view |
| `?` | Show help screen with all shortcuts |
| `q` | Quit the TUI |

## 6. Workflows

### Workflow A — Project Setup

Use this when starting a new sprint, milestone, or project.

1. **Initialize the board**:
   ```bash
   kaban init --name "Sprint 24 — API Rewrite"
   ```
   This creates `.kaban/board.db` and `.kaban/config.json` in the project root.

2. **Populate with tasks**:
   ```bash
   kaban add "Rewrite auth middleware" -c backlog -a alice -p high
   kaban add "Add input validation" -c backlog -a bob -p medium
   kaban add "Update API docs" -c backlog -a charlie -p low
   kaban add "Write integration tests" -c backlog -p medium
   ```

3. **Visual review with TUI**:
   ```bash
   kaban tui
   ```
   Use the TUI to reorder, adjust priorities, and get a bird's-eye view of the sprint.

### Workflow B — Task Lifecycle

Follow this workflow for day-to-day task management.

1. **Add a task to the backlog**:
   ```bash
   kaban add "Fix login redirect loop" -c todo -a claude -D "After OAuth login, users are redirected to /404 instead of /dashboard"
   ```

2. **Move to in-progress when work starts**:
   ```bash
   kaban move abc123 in-progress --assign claude
   ```

3. **Check progress with filtered list**:
   ```bash
   kaban list --column in-progress
   ```

4. **Mark complete when finished**:
   ```bash
   kaban done abc123
   ```

5. **Archive at end of session**:
   ```bash
   kaban archive
   ```

6. **Search for completed work later**:
   ```bash
   kaban search "login redirect"
   ```

### Workflow C — Agent Coordination

Designed for multi-agent AI coding sessions where tasks are delegated between agents.

1. **Initialize and assign**:
   ```bash
   kaban init --name "Refactor Session"
   kaban add "Extract PaymentService class" -c todo -a ingenium-orchestrator -p high
   kaban add "Add unit tests for PaymentService" -c backlog -a ingenium-qa -p medium
   ```

2. **Get an overview of who is doing what**:
   ```bash
   kaban status
   ```
   Output shows task counts per column and per agent.

3. **Hand off tasks between agents**:
   ```bash
   kaban move abc123 review --assign ingenium-explore
   ```

4. **Set up task dependencies** (via MCP tools):
   - Use `kaban_add_dependency` to block task B until task A is done
   - Use `kaban_check_dependencies` before starting a new task to verify its blockers are resolved

5. **End-of-sprint archive cycle**:
   ```bash
   kaban archive
   kaban archive-stats
   ```

### Workflow D — TodoWrite Sync Hook

Kaban can integrate with AI agent task templates via the TodoWrite hook. This syncs structured task lists into the board automatically.

```bash
kaban hook install
```

This installs a lifecycle hook that watches for `task` template operations and syncs them into the kaban board.

## 7. Data Storage

All board data lives in a `.kaban/` directory at the path specified by `KABAN_PATH`.

```bash
.kaban/
├── board.db      # SQLite database — all tasks, columns, dependencies, archive
└── config.json   # Board configuration — name, columns, WIP limits, metadata
```

### Default columns

| Column | WIP Limit | Description |
|--------|-----------|-------------|
| Backlog | None | Ideas and unrefined tasks |
| To Do | None | Ready to be worked on |
| In Progress | 3 | Actively being worked on |
| Review | 2 | Awaiting review or QA |
| Done | None | Completed tasks (can be archived) |

**WIP (Work In Progress) limits** help prevent overloading. When a column reaches its limit, the TUI and CLI are prevented from moving additional tasks into it until one is moved out.

### Storage characteristics

- **Self-contained**: No server, database daemon, or network required.
- **Portable**: Copy the `.kaban/` directory to share the board with others.
- **Version-controllable**: `.kaban/board.db` and `.kaban/config.json` can be committed to git for team visibility, though this is optional.
- **Safe destruction**: The board is always scoped to `KABAN_PATH` — no risk of affecting other projects.

## Cross-References

- `cli-toolkit` — General CLI patterns for parsing command output, piping, and JSON output processing.
- `agent-pipelines` — Multi-agent task coordination patterns, especially Workflow C above. Use the orchestrator agent to delegate tasks logged on the board.
- `thread-auto-context` — Save the current board state to Thread at session end for long-running project memory. Use `kaban status --json` to capture structured board state.
- `generic-conventions` — Core coding conventions for any scripts that interact with the kaban board programmatically.
