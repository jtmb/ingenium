---
title: "Dev Browser Integration — wsl-chrome-connect.sh Workflow"
impact: HIGH
impactDescription: "Ensures all browser automation tasks use the correct helper script and connection patterns"
tags: [dev-browser, integration, wsl-chrome-connect, workflow]
---

## Dev Browser Integration

**Pattern intent:** Map the browsing-the-web skill onto the dev-browser toolchain — the wsl-chrome-connect.sh helper script is the single entry point for all browser automation.

### The Single Command

All browser interaction flows through one script:

```bash
.opencode/skills/mcp-tooling/references/dev-browser/wsl-chrome-connect.sh
```

This script handles:
1. **Chrome detection** — Checks if Windows Chrome is already listening on port 9222
2. **Chrome launch** — Launches Chrome with `--remote-debugging-port=9222` and `--remote-allow-origins=*` if not running
3. **dev-browser install** — Installs `dev-browser` + Playwright Chromium on Windows if missing
4. **Script execution** — Pipes JS to `dev-browser.cmd --connect http://localhost:9222` on Windows
5. **Output filtering** — Removes cmd.exe UNC path warnings, returns clean JSON

### Three Invocation Styles

**Heredoc** (recommended — multi-line scripts, no quoting issues):
```bash
./wsl-chrome-connect.sh <<'EOF'
const p = await browser.getPage("task");
await p.goto("https://example.com", { waitUntil: "domcontentloaded" });
console.log(JSON.stringify({ title: await p.title(), url: p.url() }));
EOF
```

**Inline** (single-line tasks):
```bash
./wsl-chrome-connect.sh 'console.log(JSON.stringify(await browser.listPages()));'
```

**File pipe** (pre-written scripts):
```bash
cat /path/to/script.js | ./wsl-chrome-connect.sh
```

### Dev Browser API Quick Reference

The script runs in a sandboxed QuickJS runtime with these globals:

| Global | Purpose |
|--------|---------|
| `browser.getPage(name)` | Get/create a named page (persists between runs) |
| `browser.listPages()` | List all tabs |
| `page.goto(url, opts)` | Navigate to URL |
| `page.title()` | Get page title |
| `page.url()` | Get current URL |
| `page.click(selector)` | Click an element |
| `page.fill(selector, value)` | Fill an input |
| `page.screenshot()` | Capture screenshot buffer |
| `await saveScreenshot(buf, name)` | Save screenshot to `~/.dev-browser/tmp/` |
| `page.snapshotForAI()` | AI-optimized page snapshot |

For the complete API, see `@mcp-tooling` → `references/dev-browser/tools.md`.

### Chrome 150+ Binding Note

Chrome 150+ ignores `--remote-debugging-address=0.0.0.0` and binds only to `127.0.0.1`. WSL2 cannot reach Windows `127.0.0.1` directly. The `wsl-chrome-connect.sh` script works around this by running `dev-browser` directly on Windows via `cmd.exe`, where `localhost:9222` IS accessible.

### Two Modes

| Mode | Command | Use Case |
|------|---------|----------|
| **Headless** (WSL) | `dev-browser --headless <<'EOF'...` | Sandboxed Chromium, no Windows Chrome needed |
| **Connect** (Windows) | `./wsl-chrome-connect.sh <<'EOF'...` | Drive real Windows Chrome with cookies, sessions, extensions |

For detailed mode documentation, see `@mcp-tooling` → `references/dev-browser/setup.md`.

## Cross-References

- **`@mcp-tooling`** — Dev Browser setup (`references/dev-browser/setup.md`), tools catalog (`tools.md`), patterns (`patterns.md`)
- **`references/site-recipes/`** — Per-site selectors, anti-patterns, and navigation guides
