# Dashboard Pages Reference

This file documents all 16 Ingenium Dashboard pages and their corresponding screenshot filenames for the `dashboard-screenshots` workflow.

## Complete Page List

The dashboard uses a route-based architecture with 16 pages accessible at:

| # | Route Path | Full URL | Screenshot Filename | Description |
|---|------------|----------|---------------------|-------------|
| 1 | `/` | `http://localhost:3000/` | `home.png` | Home page — operational home dashboard with live metrics |
| 2 | `/opencode` | `http://localhost:3000/opencode` | `opencode.png` | Embedded OpenCode web UI iframe |
| 3 | `/projects` | `http://localhost:3000/projects` | `projects.png` | Project management (create, rename, archive, restore) |
| 4 | `/skills` | `http://localhost:3000/skills` | `skills.png` | Skills grid with detail overlay, syntax highlighting |
| 5 | `/tasks` | `http://localhost:3000/tasks` | `tasks.png` | Kanban board (todo → in_progress → review → done) |
| 6 | `/jobs` | `http://localhost:3000/jobs` | `jobs.png` | Job management page |
| 7 | `/plugins` | `http://localhost:3000/plugins` | `plugins.png` | Plugin lifecycle (enable, disable, configure) |
| 8 | `/mail` | `http://localhost:3000/mail` | `mail.png` | 3-pane email client (FolderSidebar, EmailList, EmailReader), AccountSetup when no accounts configured |
| 9 | `/agents` | `http://localhost:3000/agents` | `agents.png` | Agent profiles (model, mode, enable/disable) |
| 10 | `/mcp-servers` | `http://localhost:3000/mcp-servers` | `mcp-servers.png` | MCP servers + Tool Manager (Servers/Tools tabs, 150 tools in 23 categories, per-tool enable/disable toggle, search, category filter) |
| 11 | `/config` | `http://localhost:3000/config` | `config.png` | OpenCode config editor (Project/Global tabs, sync from disk, save) |
| 12 | `/observations` | `http://localhost:3000/observations` | `observations.png` | Self-learning observations with FTS5 search + type/status filters |
| 13 | `/personality` | `http://localhost:3000/personality` | `personality.png` | Personality traits with confidence bars, enable/disable |
| 14 | `/pipeline` | `http://localhost:3000/pipeline` | `pipeline.png` | Git-workflow-style timeline of pipeline events (3s poll, filters, +N collapse) |
| 15 | `/logs` | `http://localhost:3000/logs` | `logs.png` | System logs and event logging |
| 16 | `/settings` | `http://localhost:3000/settings` | `settings.png` | Settings + Synthesis LLM provider configuration |

## Navigation Order

When capturing screenshots, always navigate in this exact order (as listed above). This ensures:

1. **Consistent browser state** — Reusing the same browser instance across all pages
2. **Logical flow** — Following the natural navigation path users would take
3. **Efficient capture** — Minimizing unnecessary page reloads

## URL Patterns

All dashboard pages follow a consistent URL pattern:

```
http://localhost:3000/<route-path>
```

Where `<route-path>` is one of the 16 routes listed above.

## Screenshot Naming Convention

Each screenshot filename is derived from the route path by:

1. Removing leading and trailing slashes
2. Converting to lowercase (already lowercase in this case)
3. Appending `.png` extension

**Examples:**
- `/projects` → `projects.png`
- `/mcp-servers` → `mcp-servers.png`
- `/opencode` → `opencode.png`

## Verification Checklist

After capturing all 16 screenshots, verify:

- [ ] All 16 `.png` files exist in `next-steps-plan/screenshots/`
- [ ] File sizes are reasonable (typically 50KB - 2MB)
- [ ] No empty or <1KB files (indicates capture failure)
- [ ] Each screenshot shows the expected page content
- [ ] All screenshots use consistent scale and fullPage settings

**Verification command:**
```bash
ls -lhS next-steps-plan/screenshots/
```

## Related Documentation

- Main skill: `.opencode/skills/dashboard-screenshots/SKILL.md`
- MCP tools: `playwright_browser_navigate`, `playwright_browser_take_screenshot`
- Testing conventions: `@useful-tests` skill