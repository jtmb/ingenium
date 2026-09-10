---
title: "Dev Browser Patterns — Common Agent Workflows"
impact: MEDIUM
impactDescription: "Standardizes common browser automation scenarios for consistency across agents"
tags: [dev-browser, patterns, workflows, wsl, screenshots]
---

## Dev Browser Patterns — Common Workflows

**Pattern intent:** Provide ready-to-copy bash patterns for the most common browser automation tasks agents perform.

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

### Pattern 4: Launch Windows Chrome from WSL with remote debugging

Launches Chrome on the Windows host from WSL:

```bash
"/mnt/c/Program Files/Google/Chrome/Application/chrome.exe" \
  --remote-debugging-port=9222 \
  --remote-allow-origins=* \
  --user-data-dir="C:\Users\james\AppData\Local\Temp\chrome-debug" \
  --no-first-run \
  --new-window about:blank &
```

> ⚠️ Chrome 150+ binds only to `127.0.0.1` — `--remote-debugging-address=0.0.0.0` is ignored. WSL can't reach Windows `127.0.0.1:9222` directly. Use **Pattern 5** to drive Chrome via dev-browser running on Windows.

### Pattern 5: Run dev-browser on Windows to drive Windows Chrome (✅ working)

The only reliable way to drive Windows Chrome from WSL: run `dev-browser` directly on Windows via `cmd.exe`, piping scripts over stdin.

**Prerequisites:** dev-browser must be installed on Windows:
```powershell
npm install -g dev-browser
dev-browser install    # Downloads Chromium for Playwright
```

**Launch Chrome on Windows (from WSL):**
```bash
"/mnt/c/Program Files/Google/Chrome/Application/chrome.exe" \
  --remote-debugging-port=9222 \
  --remote-allow-origins=* \
  --user-data-dir="C:\Users\james\AppData\Local\Temp\chrome-debug" \
  --no-first-run \
  --new-window about:blank &
```

**Drive Chrome from WSL via cmd.exe pipe:**
```bash
echo 'const page = await browser.getPage("demo");
await page.goto("https://example.com", { waitUntil: "domcontentloaded" });
console.log(JSON.stringify({ title: await page.title(), url: page.url() }));' \
  | cmd.exe /c "C:\Users\james\AppData\Roaming\npm\dev-browser.cmd --connect http://localhost:9222 --timeout 15"
```

**For longer scripts, write a file and pipe it:**
```bash
# Write script to Windows temp
cat <<'SCRIPT' > /mnt/c/Users/james/AppData/Local/Temp/my-script.js
const page = await browser.getPage("demo");
await page.goto("https://example.com");
const buf = await page.screenshot();
await saveScreenshot(buf, "result.png");
SCRIPT

# Pipe to dev-browser on Windows
cmd.exe /c "type C:\Users\james\AppData\Local\Temp\my-script.js \
  | C:\Users\james\AppData\Roaming\npm\dev-browser.cmd \
  --connect http://localhost:9222 --timeout 15"
```

> **How it works:** `cmd.exe /c` starts a Windows command prompt. It pipes the script via stdin to `dev-browser.cmd`, which connects to Chrome at `localhost:9222` (accessible from within Windows). Output (JSON) is printed to stdout and captured in WSL.

> 💡 **Automated helper:** Use [`wsl-chrome-connect.sh`](wsl-chrome-connect.sh) instead — it handles Chrome launch, dev-browser install, and script piping in one step.

## Cross-References

- See [`references/dev-browser/setup.md`](setup.md) for installation and mode configuration
- See [`references/dev-browser/tools.md`](tools.md) for the complete browser API catalog
