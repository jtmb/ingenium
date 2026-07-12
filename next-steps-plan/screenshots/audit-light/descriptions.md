# Light Mode Visual Audit

**Date:** 2026-07-12
**Audit Type:** Full dashboard visual regression — Light Mode
**Total Pages:** 16 (+ 4 interaction screenshots)
**Screenshots Captured:** 20

---

## Home — `/`
**State:** Light mode

### Screenshot: home.png
The dashboard home page displays on a light/white background with subtle gray section dividers. The nav bar shows "Ingenium" logo on the left, moon icon (🌙) confirming light mode is active, and project selector dropdown on the right. Below is a 2-row grid of feature cards organized into 4 sections: "Build" (OpenCode, Projects, Tasks, Jobs), "Learn" (Skills, Observations, Personality, Pipeline), "Connect" (Mail, Agents, MCP, Plugins), and "Operate" (Logs, Config, Settings). Each card has a monochromatic icon, bold title, and description. The header shows 6 metric cards: Projects (2), Skills (24), Tasks (0), Observations (0), Pipeline Events (1), Agents (5) in blue text with rounded white backgrounds and subtle shadows.

**Console:** Errors: 0 | Warnings: 0

---

## OpenCode — `/opencode`
**State:** Light mode

### Screenshot: opencode.png
The OpenCode embedded workspace displays as an iframe. The dashboard outer shell shows the navigation bar in light mode. The embedded OpenCode content shows a dark theme chat/IDE interface (its own independent theme). Left sidebar shows session list ("Casual greeting", "New session", "Greeting"). The main area displays conversation history with shell commands and responses. The bottom section has a "Getting started" panel with "Connect provider" button.

**Console:** Errors: 0 | Warnings: 0

---

## Projects — `/projects`
**State:** Light mode

### Screenshot: projects.png
The Projects page displays on a light/white background with the Ingenium nav bar showing moon icon (🌙) confirming light mode is active. Tabbed interface with "Active" and "Archived" tabs. Two project cards visible: "global-default" (created 14h ago, 0 skills, 0 observations, 5 pipeline events) and "gh-llm-bootstrap" (24 skills, 0 observations, 5 pipeline events). Each card shows metadata, action buttons (Rename, Archive, Detail), and a path indicator. Card-based design with subtle shadows and rounded corners.

**Console:** Errors: 0 | Warnings: 0

---

## Archive — `/archive`
**State:** Light mode (404 Not Found)

### Screenshot: archive.png
The Archive page shows a 404 error state on a light/white background with moon icon visible in the nav bar. Large "404" in gray text centered on screen with "Page not found" subtitle below. Below the error, 12 skill cards appear in a 3-column grid — these appear to be the skills from the gh-llm-bootstrap project displayed on this broken route. The layout is identical to the Skills page but overlaid with an error state.

**Status:** 🔴 HTTP 404 — The `/archive` route does not exist or is not properly configured.

**Console:** Errors: 1 (Failed to load resource: server responded with 404)

---

## Skills — `/skills`
**State:** Light mode

### Screenshot: skills.png
The Skills page displays 24 skills on a light/white background with moon icon visible in nav bar. Search bar and "Alphabetical" dropdown at top, followed by blue "Upload Skill" button. Three-column grid of skill cards showing all 24 skills including configuring-opencode, dashboard-screenshots, database-conventions, development-conventions, and others. Each card shows skill name in bold and tags/description in gray text.

### Screenshot: skills-overlay.png
Detail overlay modal for the "configuring-opencode" skill. Modal has a white background with file tree navigation on the left (SKILL.md, metadata.json, agent-template.md) and preview pane on the right. Content shows YAML frontmatter with name/description fields, followed by formatted markdown sections: "When to Use" bullet list, "HARD RULES" section with code examples. "Edit" button in top-right corner.

**Console:** Errors: 0 | Warnings: 16 (highlight.js unescaped HTML warnings — pre-existing, not a regression)

---

## Mail — `/mail`
**State:** Light mode

### Screenshot: mail.png
Three-pane email client layout on light/white background. Left pane shows "Compose" button (blue), account selector ("demo@example.com"), and folder list (INBOX highlighted in light blue, Sent, Drafts, Archive, Spam, Trash). Middle pane has search bar and displays red error banner: "connect ECONNREFUSED 127.0.0.1:993" on light pink background. Right pane shows empty state with envelope icon and "Select an email to read".

### Screenshot: mail-compose.png
Full-screen compose modal overlay. "Compose" title with × close button. Form fields: From dropdown (Select account), To text field, CC/BCC links, Subject text field, and Message textarea with placeholder "Write your message...". Action buttons: Send (blue primary), Save Draft (text), Discard (text).

**Console:** Errors: 1 (API 500 — `GET /api/v1/emails?project=gh-llm-bootstrap&folder=INBOX` — email server not connected/ECONNREFUSED)

---

## Tasks — `/tasks`
**State:** Light mode

### Screenshot: tasks.png
Kanban board view on light/white background. Top nav bar with "Tasks" title, search bar, and blue "Add" button. Three tabs: Board (active), List, Timeline. Four kanban columns: TO DO (0), IN PROGRESS (0), REVIEW (0), DONE (0) — each showing "No tasks" placeholder. Clean card-based layout with column headers as white rectangular cards.

**Console:** Errors: 0 | Warnings: 0

---

## Plugins — `/plugins`
**State:** Light mode

### Screenshot: plugins.png
Plugin management page on light/white background. "Plugins" title with blue "Add Plugin" button. Search bar. Empty state message: "No plugins registered. Click 'Add Plugin' to upload one." (No toggle interactions available — no plugins exist to toggle.)

**Console:** Errors: 0 | Warnings: 0

---

## Agents — `/agents`
**State:** Light mode

### Screenshot: agents.png
Agent profiles page on light/white background. "Agents" title with blue "Add Agent" button. Four agent sections: Primary (Ingenium-orchestrator — coordination agent, deepseek/deepseek-v4-pro), Execution (3 subagents: ingenium-software-engineer, budget-tier, premium-tier — all enabled), Research (vision bridge — lmstudio/qwen/qwen3.5-9b). Each agent card shows name, type badge (primary/subagent), status (Enabled), description, model identifier, and action buttons (Disable, Edit, Delete).

**Console:** Errors: 0 | Warnings: 0

---

## MCP Servers — `/mcp-servers`
**State:** Light mode

### Screenshot: mcp-servers.png
MCP Servers page — Servers tab active. Light/white background. Search tools input field. Status indicators: 75 enabled / 0 disabled / 75 total. Tool categories listed: Settings, Skills, Tasks, Projects, Plugins, Servers, Agents, Observations, Personality, Synthesis, Commands, Config, Plans, Email, Observe, Logs. Each category shows enabled count and tool names with green toggle switches.

### Screenshot: mcp-servers-tools.png
MCP Servers page — Tools tab active. Same background and header. Tools tab showing categorized tool list. Each row displays tool name, green toggle switch, and "Enabled" status badge. Tools include ingenium_setting_get/set, all skill tools, task tools, project tools, email tools (13), observe tool, and logs tools.

**Console:** Errors: 0 | Warnings: 0

---

## Config — `/config`
**State:** Light mode

### Screenshot: config.png
Config page — Project Config tab active. Light/white background. Tabbed interface: Project Config (active), Global Config. Large code editor labeled "opencode.json" with empty/JSON content. Buttons: Sync from disk (gray/disabled), Save (blue).

### Screenshot: config-global.png
Config page — Global Config tab active. Same layout. Editor labeled "opencode.jsonc" with empty content. Sync from disk (disabled), Save (blue).

**Console:** Errors: 0 | Warnings: 0

---

## Observations — `/observations`
**State:** Light mode

### Screenshot: observations.png
Observations page on light/white background. "Observations" title. Statistics: "Total: 0 Pending: 0". Empty state message: "No observations yet. The agent will record observations automatically during interactions." Filter tabs visible.

**Console:** Errors: 0 | Warnings: 0

---

## Personality — `/personality`
**State:** Light mode

### Screenshot: personality.png
Personality Profile page on light/white background. Sort dropdown shows "Grouped by type" and "0 trait(s)" count. Empty state message: "No personality traits learned yet. Traits are generated automatically from observations via the synthesis pipeline." No trait cards displayed.

**Console:** Errors: 0 | Warnings: 0

---

## Pipeline — `/pipeline`
**State:** Light mode

### Screenshot: pipeline.png
Pipeline timeline page on light/white background. Vertical timeline with Synthesis events displayed as white cards connected by teal vertical line. Each card shows green "Synthesis" badge and message "No pending observations to process." Timestamps range from 14m to 14h ago. Stats: Total: 17, Observations: 0, Syntheses: 17, Traits: 0, Skills: 0. Yellow "Pause" button top right.

**Console:** Errors: 0 | Warnings: 0

---

## Logs — `/logs`
**State:** Light mode

### Screenshot: logs.png
System Logs page on light/white background. Live log stream table with columns: TIME, SOURCE, LEVEL, MESSAGE. 12+ entries visible from sources: API (INFO), Scheduler (INFO), db (INFO), Email (ERROR), extraction (INFO). Multiple ERROR entries from Email source showing "List emails failed for account..." at various timestamps. Green "Paused — LIVE" badge. Level filters with color indicators.

**Console:** Errors: 0 | Warnings: 0 (table content shows Email ERRORs from server-side, not client-side console errors)

---

## Settings — `/settings`
**State:** Light mode

### Screenshot: settings.png
Settings page on light/white background. Configuration sections: Appearance (Theme dropdown set to Light), Archive Retention (7 days), Synthesis LLM (Custom Provider, Base URL: http://192.168.0.13:1234/v1, Model: qwen/qwen3.5-9b, API Key masked, Run every: 5 minutes, Save/Test Connection buttons), Email OAuth (Google Client ID populated, Microsoft fields placeholder). Blue "Save" button per section.

**Console:** Errors: 0 | Warnings: 0 (VERBOSE-level "password field not in form" messages — informational only)

---

# Audit Summary

## Pages With Issues

| Page | Issue | Severity |
|------|-------|----------|
| `/archive` | 🔴 HTTP 404 — Route does not exist | 🔴 High |
| `/mail` | 🟡 API 500 — Email server not connected (ECONNREFUSED 127.0.0.1:993) | 🟡 Medium |
| `/skills` | 💡 16 highlight.js unescaped HTML warnings | 💡 Low |

## Page Status Summary

| # | Route | Page Name | Status | Console Errors |
|---|-------|-----------|--------|----------------|
| 1 | `/` | Home | ✅ OK | 0 |
| 2 | `/opencode` | OpenCode | ✅ OK | 0 |
| 3 | `/projects` | Projects | ✅ OK | 0 |
| 4 | `/archive` | Archive | 🔴 404 | 1 |
| 5 | `/skills` | Skills | ✅ OK (detail overlay works) | 0E / 16W |
| 6 | `/mail` | Mail | ✅ OK (Compose modal works, server not connected) | 1 |
| 7 | `/tasks` | Tasks | ✅ OK | 0 |
| 8 | `/plugins` | Plugins | ✅ OK (no plugins registered) | 0 |
| 9 | `/agents` | Agents | ✅ OK | 0 |
| 10 | `/mcp-servers` | MCP Servers | ✅ OK (both tabs work) | 0 |
| 11 | `/config` | Config | ✅ OK (both tabs work) | 0 |
| 12 | `/observations` | Observations | ✅ OK | 0 |
| 13 | `/personality` | Personality | ✅ OK | 0 |
| 14 | `/pipeline` | Pipeline | ✅ OK | 0 |
| 15 | `/logs` | Logs | ✅ OK | 0 |
| 16 | `/settings` | Settings | ✅ OK | 0 |

## Theme
- Dashboard was rendering in **dark mode** by default
- Clicked 🌙 button (appears as ☀️ in dark mode) to **switch to light mode**
- All screenshots above show **light mode** with 🌙 (moon icon) visible in navigation bar

## Recommendations
1. **Fix `/archive` route** — The AGENTS.md lists Archive as a page but it returns 404. A route handler needs to be implemented.
2. **Configure email server** — The Mail page shows ECONNREFUSED because no IMAP email server is running on localhost:993.
3. **Address highlight.js warnings** — 16 warnings about unescaped HTML in code blocks from highlight.js. Not a regression but should be addressed for security (XSS prevention in rendered code).
4. **Switch default theme** — If light mode is the intended "default theme", the dashboard may need to default to light mode instead of dark mode.
