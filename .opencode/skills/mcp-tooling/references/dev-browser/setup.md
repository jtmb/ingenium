# Dev Browser — Real Browser Automation for Agents

`dev-browser` ([SawyerHood/dev-browser](https://github.com/SawyerHood/dev-browser), 6.4k stars) lets OpenCode agents drive a real Chrome/Chromium browser via bash — no MCP server, no Playwright headless quirks, no `--remote-debugging-port` required.

It solves the WSL Chrome problem: Playwright MCP runs headless and can't leverage your logged-in Chrome state. Dev-browser can either launch its own sandboxed Chromium or attach to your running Windows Chrome.

## 🔴 HARD RULEs

- **Always use `--headless` mode on WSL** unless you specifically need your logged-in Chrome session
- **Never use `--connect` without verifying Chrome remote debugging is enabled** — it will fail silently
- **Save screenshots via `saveScreenshot()`** — they land in `~/.dev-browser/tmp/` and the path is returned

## Installation

```bash
npm install -g dev-browser
dev-browser install    # installs Playwright + Chromium (one-time)
```

Verify:
```bash
dev-browser --version
```

## Two Modes

### Mode 1: Headless (Recommended for WSL)

Launches its own sandboxed Chromium. No Chrome installation required, no port forwarding, no extension.

```bash
dev-browser --headless <<'EOF'
const page = await browser.getPage("main");
await page.goto("https://example.com", { waitUntil: "domcontentloaded" });
console.log(await page.title());
EOF
```

### Mode 2: Connect (Attach to Real Chrome)

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

## Script API

Scripts run in a sandboxed QuickJS runtime. Available globals:

### Browser Control
```js
browser.getPage(nameOrId)     // Get/create named page
browser.newPage()              // Create anonymous page (auto-cleaned)
browser.listPages()            // List tabs: [{id, url, title, name}]
browser.closePage(name)        // Close a named page
```

### Page Actions (full Playwright Page API)
```js
const page = await browser.getPage("main");
await page.goto("https://example.com", { waitUntil: "domcontentloaded" });
await page.click("button[type='submit']");
await page.fill("input[name='email']", "user@example.com");
const title = await page.title();
const html = await page.content();
```

### AI-Friendly Snapshots
```js
// Returns { full, incremental? } with stable ref markers
const snapshot = await page.snapshotForAI();
console.log(JSON.stringify(snapshot));
```

### Computer Use (CUA) Tools
```js
// Pixel/vision tier — coordinates match 1:1 with screenshot pixels
await page.cua.screenshot();  // → { path, width, height }
await page.cua.click(x, y);
await page.cua.type("hello");
await page.cua.keypress("Enter");

// DOM-id tier — uses node_id from getVisibleDom()
const { elements } = await page.domCua.getVisibleDom();
await page.domCua.click(elements[0].node_id);
```

### Screenshots & File I/O
```js
const buf = await page.screenshot();
const path = await saveScreenshot(buf, "dashboard-home.png");
// → /home/user/.dev-browser/tmp/dashboard-home.png
```

## Common Patterns

### Pattern 1: Navigate, screenshot, verify
```bash
dev-browser --headless <<'EOF'
const page = await browser.getPage("dashboard");
await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
const buf = await page.screenshot({ fullPage: true });
const path = await saveScreenshot(buf, "dashboard-home.png");
console.log("Saved:", path);
EOF
```

### Pattern 2: Fill form, submit, capture result
```bash
dev-browser --headless <<'EOF'
const page = await browser.getPage("form");
await page.goto("http://localhost:3000/mail", { waitUntil: "domcontentloaded" });
await page.click("button:has-text('Compose')");
await page.fill("input[placeholder='To']", "test@example.com");
await page.fill("input[placeholder='Subject']", "Test Subject");
await page.screenshot({ path: "/tmp/compose-form.png" });
EOF
```

### Pattern 3: Snapshot for AI analysis
```bash
dev-browser --headless <<'EOF'
const page = await browser.getPage("snapshot");
await page.goto("http://localhost:3000/skills", { waitUntil: "networkidle" });
const snap = await page.snapshotForAI();
await writeFile("snapshot-skills.json", JSON.stringify(snap, null, 2));
console.log("Snapshot written");
EOF
```
