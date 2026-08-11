---
title: "localhost Site Recipe — Selectors, Patterns, Anti-Patterns"
impact: MEDIUM
impactDescription: "Proven browser automation patterns for the Ingenium dashboard on localhost"
tags: [site-recipe, localhost, ingenium, browser]
---

## localhost Site Recipe

**Base URL:** `http://localhost:3000`
**Last verified:** 2026-08-11

---

### Known Selectors

#### Search

| Purpose | Selector | Type | Verified |
|---------|----------|------|----------|
| Skills search | `input[placeholder="Search skills..."]` | Input | 2026-08-09 |
| Project search | `input[placeholder="Search projects..."]` | Input | 2026-08-09 |

#### Content/Results

| Purpose | Selector | Type | Verified |
|---------|----------|------|----------|
| Active project button | `button[aria-label^="Active project:"]` | Button | 2026-08-09 |
| Context project button | `button[aria-label^="Context project:"]` | Button | 2026-08-09 |
| Skill card opener | `button[aria-label^="Open skill"]` | Button | 2026-08-09 |
| Settings dialog | `[role="dialog"]` | Dialog | 2026-08-09 |

#### Interaction

| Purpose | Selector | Type | Verified |
|---------|----------|------|----------|
| Settings button | `button[aria-label="Settings"]` | Button | 2026-08-09 |
| Desktop settings view | `button[role="tab"]` | Tab | 2026-08-09 |
| Mobile settings view | `select[aria-label="Settings category"]` | Select | 2026-08-09 |
| Close proposal overlay | `button[aria-label="Close proposal overlay"]` | Button | 2026-08-09 |
| Project detail expansion | Button with exact text `Detail ▸` | Button | 2026-08-09 |
| Proposal tab opener | `[data-testid="tab-proposals"]` | Button | 2026-08-11 |
| Open proposal filter | `[data-testid="proposal-filter-open"]` | Tab | 2026-08-11 |
| History proposal filter | `[data-testid="proposal-filter-history"]` | Tab | 2026-08-11 |
| Proposal card | `[data-testid^="proposal-card-"]` | Button | 2026-08-11 |
| History pagination | `[data-testid="proposals-history-load-more"]` | Button | 2026-08-11 |

---

### Anti-Patterns

| Anti-Pattern | Detection Selector | Mitigation |
|-------------|-------------------|------------|
| Sweep-induced API rate limit | Response `429` from `/api/v1/projects` | Keep one page, close stale tabs, use batches of four or fewer, and cool down at least 60 seconds before recheck |
| Benign Next RSC cancellation | Failed GET containing `?_rsc=` with `net::ERR_ABORTED` during navigation | Do not classify as a route failure unless an isolated settled navigation also fails |
| Progress-bar false positive | `[role="progressbar"]` on personality traits | Treat confidence meters as content, not loading; exclude `Upload Skill` from broad `class*="load"` matches |
| Hidden mobile settings tabs | Non-visible `button[role="tab"]` | Use the visible `select[aria-label="Settings category"]` on 390px viewports |
| Sensitive content exposure | `/secrets`, `/mail`, `/config`, Settings Mail/Config/Providers | Collect metadata/geometry only; do not save or print values, message bodies, or config text |
| Pointer-only detail cards | Visible `div`/`article` with `cursor: pointer`, `tabIndex=-1`, and no semantic role | Record as an accessibility finding; use nested named controls only for safe inspection |
| Stale proposal totals | Hard-coded proposal totals from an earlier snapshot | Read `/api/v1/skills/proposals/counts?project=ingenium` first; use its current `open`/`history` values for all pagination assertions |

---

### Navigation Patterns

#### Pattern: Dashboard route diagnosis

**Goal:** Navigate to a route and inspect its settled visual, DOM, accessibility, console, and network state without mutating data.

**Steps:**
1. Navigate directly to the route with `domcontentloaded`.
2. Wait for loading indicators to settle and allow lazy content to render.
3. Capture metadata-only DOM/accessibility/network evidence and a checkpoint screenshot.

**Wait strategy:** Wait for loading indicators to disappear, then allow a bounded quiet period for late requests.

**Example script:**
```js
const p = await browser.getPage("dashboard-diagnosis");
await p.goto("http://localhost:3000/", { waitUntil: "domcontentloaded" });
await new Promise((resolve) => setTimeout(resolve, 2000));
console.log(JSON.stringify({ title: await p.title(), url: p.url() }));
```

#### Pattern: Settings view diagnosis

**Goal:** Open the Settings overlay and select a view without invoking any save, connect, or other mutation control.

**Steps:**
1. Navigate to `/` and click `button[aria-label="Settings"]`.
2. At desktop, click the exact `button[role="tab"]`; at mobile, change `select[aria-label="Settings category"]`.
3. Wait for the view to settle and record the selected view, geometry, controls, and network evidence.

**Wait strategy:** Use the button flow on mobile; direct `/?settings=...` navigation can hang in the connected browser.

#### Pattern: Authoritative proposal pagination gate

**Goal:** Verify `/skills?project=ingenium` against current proposal totals without mutating data.

**Steps:**
1. Create one isolated page and navigate to `/skills?project=ingenium`.
2. Read the current counts endpoint; do not reuse a historical total.
3. Open Proposals, inspect unique open-card IDs, and open/close one detail card.
4. Move from Open to History with the keyboard, then activate `Load more history` with Enter until the control disappears.
5. Assert each keyset chunk is at most 25 rows, final unique IDs equal the current history count, and only counts/page/detail proposal endpoints returned.

**Wait strategy:** Poll settled card counts and loading state after each cursor page; record the cursor URLs and final disabled/absent Load more state.

---

### What Works / What Broke

| Date | Task | What Broke | What Worked | Updated By |
|------|------|------------|-------------|------------|
| 2026-08-09 | Comprehensive passive dashboard diagnosis | Fast multi-route sweeps hit `/api/v1/projects` 429; status detail returned 502; Settings Mail clipped below its fixed mobile dialog | Isolated route batches plus 60-second cooldowns; request URLs captured from `request().url()`; proposal history/detail and project detail opened without 404; project switch restored cleanly | browser-agent |
| 2026-08-09 | Mobile Settings navigation | Direct query/hidden-tab automation timed out or bypassed the visible mobile selector | Open Settings from `/`, then use the visible `Settings category` select | browser-agent |
| 2026-08-11 | Authoritative `/skills` proposal pagination gate | Historical History total 54 became stale while the current counts endpoint reported 57 | Both viewports passed with Open 9, History 57, keyset chunks 25/25/7, unique IDs equal to the authoritative count, no legacy/mutation/error/429 responses, and browser cleanup confirmed | browser-agent |
