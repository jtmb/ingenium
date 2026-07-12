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

### Pattern 4: WSL — launch Windows Chrome and connect

Launches Chrome from WSL on the Windows host, then connects dev-browser:

```bash
"/mnt/c/Program Files/Google/Chrome/Application/chrome.exe" \
  --remote-debugging-port=9222 \
  --remote-debugging-address=0.0.0.0 \
  --user-data-dir=/tmp/chrome-debug-profile &

# Wait for Chrome to be ready
for i in $(seq 1 10); do
  curl -s http://localhost:9222/json/version > /dev/null 2>&1 && break
  sleep 1
done

dev-browser --connect <<'EOF'
const tabs = await browser.listPages();
console.log("Connected. Tabs:", JSON.stringify(tabs, null, 2));
EOF
```

## Cross-References

- See [`references/dev-browser/setup.md`](setup.md) for installation and mode configuration
- See [`references/dev-browser/tools.md`](tools.md) for the complete browser API catalog
