---
title: "Playwright MCP Setup — Configuration, Prerequisites, Troubleshooting"
impact: HIGH
impactDescription: "Ensures the browser automation server is properly configured and available"
tags: [playwright, mcp, setup, configuration]
---

## Playwright MCP Setup

### Server Configuration

The Playwright MCP server is configured in `opencode.json`:

```json
{
  "mcp": {
    "playwright": {
      "type": "local",
      "command": ["npx", "-y", "@playwright/mcp@latest", "--caps=vision"],
      "enabled": true
    }
  }
}
```

The `--caps=vision` flag enables screenshot capture and image analysis capabilities. Without this flag, the server only provides DOM and navigation tools.

### Prerequisites

- **Node.js 18+** — `npx` is bundled with Node.js
- **Chromium** — Installed automatically on first use, or manually with:
  ```bash
  npx playwright install chromium
  ```

### How Tools Appear in OpenCode

Once configured, Playwright MCP tools appear in OpenCode as `<server>_<tool>` namespaced tools:
- `playwright_browser_navigate`
- `playwright_browser_take_screenshot`
- `playwright_browser_snapshot`
- `playwright_browser_click`
- `playwright_browser_resize`
- `playwright_browser_console_messages`

### Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `command not found: npx` | Node.js not installed | Install Node.js 18+ |
| `browser_take_screenshot` not available | `--caps=vision` flag missing | Add `--caps=vision` to the command |
| `connect ECONNREFUSED` | Target server not running | Start your dev server first |
| Screenshot is blank/white | Browser may have loaded before page rendered | Wait for page load: `browser_navigate` with full URL, then retry |
| Timeout on tool call | Page too large or slow | Increase MCP server timeout in config |
