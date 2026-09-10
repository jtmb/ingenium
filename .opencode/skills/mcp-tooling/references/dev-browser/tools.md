---
title: "Dev Browser Tools — Browser API, CUA, DOM CUA, Snapshots"
impact: HIGH
impactDescription: "Provides a catalog of every available dev-browser API method for agents"
tags: [dev-browser, tools, api, cua, dom-cua, snapshots]
---

## Dev Browser Tools — Complete API Catalog

**Pattern intent:** Document every available method in the dev-browser sandboxed QuickJS runtime so agents can select the right tool for each automation task.

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

Pixel/vision tier — coordinates match 1:1 with screenshot pixels:

```js
await page.cua.screenshot();  // → { path, width, height }
await page.cua.click(x, y);
await page.cua.type("hello");
await page.cua.keypress("Enter");
```

### DOM CUA Tools

DOM-id tier — uses `node_id` from `getVisibleDom()`:

```js
const { elements } = await page.domCua.getVisibleDom();
await page.domCua.click(elements[0].node_id);
```

### Screenshots & File I/O

```js
const buf = await page.screenshot();
const path = await saveScreenshot(buf, "dashboard-home.png");
// → /home/user/.dev-browser/tmp/dashboard-home.png
```

## Cross-References

- See [`references/dev-browser/setup.md`](setup.md) for installation and mode configuration
- See [`references/dev-browser/patterns.md`](patterns.md) for common agent workflows
