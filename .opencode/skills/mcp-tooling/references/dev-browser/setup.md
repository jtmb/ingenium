---
title: "Dev Browser Setup — Installation, Configuration, WSL-to-Windows Chrome Launch"
impact: HIGH
impactDescription: "Ensures dev-browser is installed, modes are understood, and agents can launch visible Chrome from WSL"
tags: [dev-browser, setup, configuration, wsl, chrome]
---

## Dev Browser Setup

**Pattern intent:** Provide a real Chrome/Chromium browser that agents can drive via bash — no MCP server required, no Playwright headless quirks, no `--remote-debugging-port` required.

`dev-browser` ([SawyerHood/dev-browser](https://github.com/SawyerHood/dev-browser), 6.4k stars) lets OpenCode agents drive a real Chrome/Chromium browser via bash — no MCP server, no Playwright headless quirks, no `--remote-debugging-port` required.

It solves the WSL Chrome problem: Playwright MCP runs headless and can't leverage your logged-in Chrome state. Dev-browser can either launch its own sandboxed Chromium or attach to your running Windows Chrome.

### 🔴 HARD RULEs

- **Always use `--headless` mode on WSL** unless you specifically need your logged-in Chrome session
- **Never use `--connect` without verifying Chrome remote debugging is enabled** — it will fail silently
- **Save screenshots via `saveScreenshot()`** — they land in `~/.dev-browser/tmp/` and the path is returned

### Installation

```bash
npm install -g dev-browser
dev-browser install    # installs Playwright + Chromium (one-time)
```

Verify:
```bash
dev-browser --version
```

### Two Modes

#### Mode 1: Headless (Recommended for WSL)

Launches its own sandboxed Chromium. No Chrome installation required, no port forwarding, no extension.

```bash
dev-browser --headless <<'EOF'
const page = await browser.getPage("main");
await page.goto("https://example.com", { waitUntil: "domcontentloaded" });
console.log(await page.title());
EOF
```

#### Mode 2: Connect (Attach to Real Chrome)

Drives your actual Chrome window — useful for debugging with your logged-in sessions, cookies, and extensions.

**On Windows host, run Chrome with remote debugging:**
```powershell
chrome.exe --remote-debugging-port=9222
```

**Then from WSL/Linux:**
```bash
dev-browser --connect <<'EOF'
const tabs = await browser.listPages();
console.log(JSON.stringify(tabs, null, 2));
EOF
```

> **WSL note:** Chrome runs on the Windows host. If you're inside Docker, use `host.docker.internal` as the Chrome host. If you're in WSL directly, `localhost` should work since WSL2 forwards `localhost`.

### Troubleshooting

#### Port 9222 already in use
Kill the existing Chrome instance:
```bash
kill $(lsof -ti:9222) 2>/dev/null; "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe" --remote-debugging-port=9222
```

#### Chrome remote debugging not reachable from WSL
Verify Chrome is listening on `0.0.0.0` (not just `127.0.0.1`):
```bash
curl -s http://localhost:9222/json/version | head -5
```
If empty, restart Chrome with `--remote-debugging-address=0.0.0.0 --remote-debugging-port=9222`.

#### "Cannot find browser" error
Run `dev-browser install` to download Chromium.

## Cross-References

- See [`references/dev-browser/tools.md`](tools.md) for the complete browser API catalog
- See [`references/dev-browser/patterns.md`](patterns.md) for common agent workflows
