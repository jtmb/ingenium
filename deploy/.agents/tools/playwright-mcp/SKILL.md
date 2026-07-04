---
name: playwright-mcp
description: "Browser automation via Playwright MCP — navigate, click, type, snapshot pages. Use when you need to interact with web pages."
---

# Playwright MCP Browser Automation

## When to Use

Invoke this skill when you need to open a browser, navigate to URLs, click elements, fill forms, take snapshots, or automate any web interaction from within Cline.

## Setup — One-Time Configuration

The Playwright MCP server must be configured in `cline_mcp_settings.json` (Cline's global settings). It uses stdio transport via `npx`:

```json
{
  "mcpServers": {
    "playwright": {
      "type": "stdio",
      "command": "npx",
      "timeout": 30,
      "args": [
        "-y",
        "@playwright/mcp@latest"
      ],
      "disabled": false
    }
  }
}
```

**Chrome requirement:** The Playwright MCP needs Chrome installed. If you get an error about `Chromium distribution 'chrome' not found`, install it:

```bash
npx playwright-mcp --install-chrome
# or
npx @playwright/mcp@latest --install-chrome
```

This downloads Google Chrome to `/opt/google/chrome/chrome`.

## Available Tools

Once the MCP server is connected, you can use these tools via `use_mcp_tool`:

| Tool | Description |
|------|-------------|
| `navigate` | Go to a URL |
| `browser_click` | Click an element on the page |
| `browser_type` | Type text into an input field |
| `browser_snapshot` | Capture accessibility snapshot of the page |
| `browser_take_screenshot` | Take a screenshot |
| `browser_evaluate` | Run JavaScript on the page or element |
| `browser_fill_form` | Fill multiple form fields at once |
| `browser_press_key` | Press keyboard keys (e.g. Enter, Tab) |
| `browser_hover` | Hover over an element |
| `browser_select_option` | Select dropdown options |
| `browser_drag` | Drag and drop between elements |
| `browser_file_upload` | Upload files via file chooser |
| `browser_drop` | Drop MIME-typed data onto an element |
| `browser_run_code_unsafe` | Execute arbitrary Playwright code (RCE-equivalent) |
| `browser_wait_for` | Wait for text or time |
| `browser_network_requests` | List network requests from the page |
| `browser_network_request` | Get full details of a specific request |

## Usage Example

Navigate to Google:

```bash
use_mcp_tool playwright navigate { "url": "https://google.ca" }
```

Click an element on a snapshot:

```bash
use_mcp_tool playwright browser_click {
  "target": "#search input",
  "element": "Google search box"
}
```

Take a page snapshot for analysis:

```bash
use_mcp_tool playwright browser_snapshot {}
```

## Troubleshooting

- **"No connection found for server: playwright"** — The MCP config may not be loaded. Reload the Cline extension after updating `cline_mcp_settings.json`.
- **Chrome not found** — Run `npx @playwright/mcp@latest --install-chrome` to install Google Chrome.