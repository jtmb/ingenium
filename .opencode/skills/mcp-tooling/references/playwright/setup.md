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
      "command": ["npx", "-y", "@playwright/mcp@0.0.78", "--caps=vision"],
      "enabled": true
    }
  }
}
```

The `--caps=vision` flag enables screenshot capture and image analysis capabilities. Without this flag, the server only provides DOM and navigation tools.

### WSL Compatibility Flags

In WSL environments, the Playwright MCP server may fail to detect a display or find the Chromium binary. Add these flags to the command:

```json
"command": [
  "npx", "-y", "@playwright/mcp@0.0.78",
  "--caps=vision",
  "--headless",
  "--executable-path",
  "$HOME/.cache/ms-playwright/chromium-<version>/chrome-linux64/chrome"
]
```

| Flag | Purpose |
|------|---------|
| `--headless` | Forces headless mode — required when no display server is available (WSL, SSH, headless servers) |
| `--executable-path` | Points to the Playwright-bundled Chromium binary. Find your installed path with `find ~/.cache/ms-playwright -name "chrome" -type f 2>/dev/null \| head -1` |

The `--executable-path` version suffix (`chromium-<version>`) may differ based on your `@playwright/mcp` version. Run `npx playwright install chromium` to ensure Chromium is installed, then check the path with the find command above.

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
| `Error: Cannot find Chromium` or `executable_path` error | WSL — Chromium path missing or incorrect | Add `--executable-path` with full path to Playwright's Chromium; run `npx playwright install chromium` first |
| `Error: No display available` | WSL/headless — no display server | Add `--headless` flag to force headless mode |
| Screenshot is blank/white | Browser may have loaded before page rendered | Wait for page load: `browser_navigate` with full URL, then retry |
| Timeout on tool call | Page too large or slow | Increase MCP server timeout in config |
