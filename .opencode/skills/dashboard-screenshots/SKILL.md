---
name: dashboard-screenshots
description: ""
---

# Dashboard Screenshots Skill

## Overview

This skill provides a reusable Playwright-based workflow to capture full-page screenshots of all Ingenium Dashboard pages. It's designed for visual documentation, bug reporting, and UI regression testing.

## 🔴 HARD RULEs

- **Always use `fullPage: true` and `scale: "css"` options** for consistent screenshots across all pages
- **Navigate to each page sequentially** — Playwright uses a single browser instance to avoid context switching overhead
- **Save screenshots to the project's `next-steps-plan/screenshots/` directory** — This is the canonical location for UI test artifacts
- **Always verify all screenshots exist after completing the batch** — Use `ls -lhS` to confirm file sizes look right (empty or tiny files indicate failures)

## All 16 Pages (in nav order)

The Ingenium Dashboard has 16 route-based pages. Capture them in this exact order:

| # | URL Path | Screenshot Filename |
|---|----------|---------------------|
| 1 | `http://localhost:3000/` | `home.png` |
| 2 | `http://localhost:3000/opencode` | `opencode.png` |
| 3 | `http://localhost:3000/projects` | `projects.png` |
| 4 | `http://localhost:3000/skills` | `skills.png` |
| 5 | `http://localhost:3000/tasks` | `tasks.png` |
| 6 | `http://localhost:3000/jobs` | `jobs.png` |
| 7 | `http://localhost:3000/plugins` | `plugins.png` |
| 8 | `http://localhost:3000/mail` | `mail.png` |
| 9 | `http://localhost:3000/agents` | `agents.png` |
| 10 | `http://localhost:3000/mcp-servers` | `mcp-servers.png` |
| 11 | `http://localhost:3000/config` | `config.png` |
| 12 | `http://localhost:3000/observations` | `observations.png` |
| 13 | `http://localhost:3000/personality` | `personality.png` |
| 14 | `http://localhost:3000/pipeline` | `pipeline.png` |
| 15 | `http://localhost:3000/logs` | `logs.png` |
| 16 | `http://localhost:3000/settings` | `settings.png` |

## Workflow

### Step 1: Navigate to Page

Use the `playwright_browser_navigate` MCP tool to load each page:

```typescript
// Example: Navigate to the skills page
await playwright_browser_navigate({
  url: "http://localhost:3000/skills",
  waitUntil: "networkidle"
});
```

**Important:** Wait for the page to fully load before taking a screenshot. Use `waitUntil: "networkidle"` or `"domcontentloaded"` depending on your needs.

### Step 2: Take Full-Page Screenshot

Use the `playwright_browser_take_screenshot` MCP tool with these exact options:

```typescript
// Example: Capture the skills page
await playwright_browser_take_screenshot({
  path: "next-steps-plan/screenshots/skills.png",
  type: "png",
  scale: "css",
  fullPage: true
});
```

**Screenshot Options:**
- `path`: Absolute or relative path to save the screenshot (use `next-steps-plan/screenshots/`)
- `type`: Always `"png"` for best quality and compatibility
- `scale`: Always `"css"` for consistent sizing across different DPI settings
- `fullPage`: Always `true` to capture the entire page including overflow content

### Step 3: Proceed to Next Page

Move to the next URL in the list. Playwright reuses the same browser instance, so navigation is fast and efficient.

### Step 4: Verify All Screenshots

After completing all 16 pages, verify the screenshots were captured successfully:

```bash
ls -lhS next-steps-plan/screenshots/
```

**What to look for:**
- All 16 `.png` files should be present
- File sizes should be reasonable (typically 50KB - 2MB depending on page complexity)
- Empty or <1KB files indicate capture failures

## MCP Tools Reference

### `playwright_browser_navigate`

Navigate to a URL in the Playwright browser.

**Parameters:**
- `url`: The URL to navigate to (required)
- `waitUntil`: When to consider navigation complete (`"domcontentloaded"`, `"load"`, `"networkidle"`)

**Example:**
```typescript
await playwright_browser_navigate({
  url: "http://localhost:3000/projects",
  waitUntil: "networkidle"
});
```

### `playwright_browser_take_screenshot`

Capture a full-page screenshot.

**Parameters:**
- `path`: Output file path (required)
- `type`: Image format (`"png"` or `"jpeg"`) — always use `"png"`
- `scale`: Scaling option (`"css"` or `"device"`) — always use `"css"`
- `fullPage`: Capture full page including overflow (`true` or `false`) — always use `true`

**Example:**
```typescript
await playwright_browser_take_screenshot({
  path: "next-steps-plan/screenshots/projects.png",
  type: "png",
  scale: "css",
  fullPage: true
});
```

## Usage Examples

### Capture All Pages (Sequential)

```typescript
const pages = [
  { url: "http://localhost:3000/", name: "home" },
  { url: "http://localhost:3000/opencode", name: "opencode" },
  { url: "http://localhost:3000/projects", name: "projects" },
  // ... add all 16 pages
];

for (const page of pages) {
  // Navigate to page
  await playwright_browser_navigate({
    url: page.url,
    waitUntil: "networkidle"
  });

  // Take screenshot
  await playwright_browser_take_screenshot({
    path: `next-steps-plan/screenshots/${page.name}.png`,
    type: "png",
    scale: "css",
    fullPage: true
  });

  console.log(`Captured ${page.name}.png`);
}

// Verify all screenshots
console.log("Verification:");
await runCommand("ls -lhS next-steps-plan/screenshots/");
```

### Capture Single Page for Bug Report

```typescript
// Navigate to problematic page
await playwright_browser_navigate({
  url: "http://localhost:3000/skills",
  waitUntil: "networkidle"
});

// Take screenshot for bug report
await playwright_browser_take_screenshot({
  path: "bug-reports/skills-bug.png",
  type: "png",
  scale: "css",
  fullPage: true
});
```

## Troubleshooting

### Screenshot is blank or empty

**Possible causes:**
- Page didn't finish loading before capture
- JavaScript error prevented rendering
- Network request failed

**Solution:** Use `waitUntil: "networkidle"` and check browser console for errors.

### Screenshot filename doesn't match URL

**Problem:** Using the wrong naming convention.

**Solution:** Always derive the filename from the URL path (e.g., `/skills` → `skills.png`).

### Screenshots are too large or too small

**Possible causes:**
- Wrong scale setting (`"device"` instead of `"css"`)
- Page has overflow content not captured

**Solution:** Ensure `scale: "css"` and `fullPage: true` are set.

## Related Skills

- `@mcp-tooling` — MCP tools for Playwright browser automation
- `@useful-tests` — Testing utilities and patterns
- `@development-conventions` — Codebase conventions including UI testing standards

## Notes

- This skill is designed to work with the Ingenium Dashboard running locally on port 3000
- Screenshots are saved as PNG files for maximum quality and compatibility
- The workflow assumes a single browser instance is reused across all page captures for efficiency