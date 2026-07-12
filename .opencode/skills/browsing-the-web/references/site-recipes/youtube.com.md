---
title: "YouTube.com Site Recipe — Selectors, Patterns, Anti-Patterns"
impact: HIGH
impactDescription: "Proven browser automation patterns for youtube.com — search, video pages, comments, shadow DOM handling, SPA navigation"
tags: [site-recipe, youtube, youtube.com, video, browser]
---

## YouTube.com Site Recipe

**Base URL:** `https://www.youtube.com`
**Last verified:** 2026-07-12
**Architecture:** Custom Elements v1 (Web Components) — all elements use `ytd-*`, `yt-*`, `ytm-*` naming

---

### Known Selectors

#### Search

| Purpose | Selector | Type | Verified |
|---------|----------|------|----------|
| Search input | `input[name="search_query"]` inside `ytd-searchbox` | Input | 2026-07-12 |
| Search button | `button#search-icon-legacy` | Button | 2026-07-12 |
| Search wrapper | `ytd-searchbox` | Custom Element | 2026-07-12 |

⚠️ **Search button warm-up:** The search button may require one manual click before programmatic clicks work. After warm-up, scripted clicks succeed. Set the input value and dispatch an `InputEvent` before clicking search.

#### Video Cards (Search Results)

| Purpose | Selector | Type | Verified |
|---------|----------|------|----------|
| Search result row | `ytd-video-renderer` | Custom Element | 2026-07-12 |
| Video title link | `a#video-title-link` | Link | 2026-07-12 |
| Channel name | `ytd-channel-name` | Custom Element | 2026-07-12 |
| Metadata line (views/date) | `#metadata-line` | Container | 2026-07-12 |
| New metadata format (2025+) | `.yt-content-metadata-view-model-wiz__metadata-row` | Container | 2026-07-12 |
| Thumbnail | `#thumbnail.ytd-thumbnail` | Image | 2026-07-12 |

#### Video Cards (Home Page Grid)

| Purpose | Selector | Type | Verified |
|---------|----------|------|----------|
| Grid video card | `ytd-rich-item-renderer` | Custom Element | 2026-07-12 |
| Video content | `ytd-rich-grid-media` | Custom Element | 2026-07-12 |

#### Video Cards (Channel Page)

| Purpose | Selector | Type | Verified |
|---------|----------|------|----------|
| Grid video | `ytd-grid-video-renderer` | Custom Element | 2026-07-12 |

#### Sidebar / Up Next

| Purpose | Selector | Type | Verified |
|---------|----------|------|----------|
| Compact sidebar item | `ytd-compact-video-renderer` | Custom Element | 2026-07-12 |

#### Watch Page (Video)

| Purpose | Selector | Type | Verified |
|---------|----------|------|----------|
| Video title | `#title h1` | Text | 2026-07-12 |
| Description | `#description` inside `ytd-expander` | Text (collapsed) | 2026-07-12 |
| Channel owner | `#owner` | Container | 2026-07-12 |
| Like button | `#like-button` | Button | 2026-07-12 |
| Like group | `ytd-segmented-like-dislike-button-renderer` | Custom Element | 2026-07-12 |
| Player element | `#movie_player` or `video.html5-video-player` | Video | 2026-07-12 |
| Player container | `#player-container-id` | Container | 2026-07-12 |

⚠️ **Dislike counts are no longer publicly visible** — only the toggle state is available.

#### Comments (Lazy-Loaded)

| Purpose | Selector | Type | Verified |
|---------|----------|------|----------|
| Comment section root | `ytd-comments` | Custom Element | 2026-07-12 |
| Comment thread | `ytd-comment-thread-renderer` | Custom Element | 2026-07-12 |
| Individual comment | `ytd-comment-renderer` | Custom Element | 2026-07-12 |
| Comment input | `#contenteditable-root` | Input | 2026-07-12 |

⚠️ **Comments load lazily** — must `scrollIntoView()` on `ytd-comments` or dispatch scroll events before they appear.

#### Page Type Detection (on `<html>` element)

| Attribute | Meaning |
|-----------|---------|
| `html[data-page-type="video"]` | Watch page |
| `html[data-page-type="search"]` | Search results |
| `html[data-page-type="home"]` | Home page |
| `html[data-page-type="channel"]` | Channel page |

---

### Anti-Patterns

| Anti-Pattern | Detection Selector | Mitigation |
|-------------|-------------------|------------|
| Cookie consent banner | Varies — use browser-layer handling | Accept or dismiss via browser preferences |
| Sign-in modal / nag | `ytd-modal-with-title-and-button-renderer`, `tp-yt-paper-dialog` | Click close button or press Escape |
| Age gate | `ytd-age-gate-renderer` | Cannot bypass — user must handle manually |
| "Are you still watching?" | `ytd-popup-container` > `tp-yt-paper-dialog` | Find `#confirm-button` and click. Appears after ~4h playback or ~30min YouTube Music |
| Autoplay end screen | `.ytp-autonav-endscreen-upnext` | Video continues — cancel if needed |
| Shadow DOM barrier | IDs inside shadow roots are NOT globally unique | Use Light DOM class/attribute selectors; use CSS `:has()` (fully supported, Chrome 105+) |
| SPA page transitions | `DOMContentLoaded` fires only once | Use `MutationObserver` + `yt-navigate-finish` custom event, NOT `DOMContentLoaded` |
| Stale elements | Page re-renders on SPA navigation | Re-query after `yt-navigate-finish` event fires |
| Search button unresponsive | Button ignores first programmatic click | Warm-up: one manual click first, then scripted clicks work. Dispatch `InputEvent` before clicking |
| Ad overlays / ad slots | `*.ytd-ad-slot-renderer`, `#masthead-ad`, `#player-ads` | Cannot interact — detect and skip |
| Shorts / Live / Upcoming mixed in results | `ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts])` | Filter out via `:has()` or data attribute check |
| View products button | `div.ytp-suggested-action` | Overlays player — detect and dismiss |

---

### Navigation Patterns

#### Pattern: Search for Videos and Return Top Results

**Goal:** Search YouTube and return the top N video titles, channel names, and URLs.

**Steps:**
1. Navigate to `https://www.youtube.com` with `{ waitUntil: "domcontentloaded" }`
2. Wait for `input[name="search_query"]` to appear
3. Fill search input with query
4. Click `button#search-icon-legacy` (may need warm-up — see anti-patterns)
5. Wait for `yt-navigate-finish` event or `ytd-video-renderer` elements to appear
6. Dismiss any popups (cookie, sign-in)
7. Query video cards, extract title + channel + URL
8. Return JSON array

**Wait strategy:** After submit, listen for `yt-navigate-finish` custom event, then wait for at least one `ytd-video-renderer` to be present (max 15s).

**Example script:**
```js
const p = await browser.getPage("youtube");
await p.goto("https://www.youtube.com", { waitUntil: "domcontentloaded" });
await p.waitForSelector('input[name="search_query"]', { timeout: 10000 });
await p.fill('input[name="search_query"]', "cat videos");
await p.click("button#search-icon-legacy");

// Wait for results to load (SPA transition)
await p.waitForFunction(() => document.querySelectorAll("ytd-video-renderer").length > 0, { timeout: 15000 });
await new Promise(r => setTimeout(r, 1000)); // Let layout settle

const results = await p.evaluate(() => {
  return [...document.querySelectorAll("ytd-video-renderer")]
    .slice(0, 5)
    .map(card => {
      const titleEl = card.querySelector("#video-title");
      const channelEl = card.querySelector("ytd-channel-name a");
      return {
        title: titleEl?.textContent?.trim() || null,
        url: titleEl?.href || null,
        channel: channelEl?.textContent?.trim() || null
      };
    });
});
console.log(JSON.stringify(results));
```

#### Pattern: Get Video Details (Title, Description, Views)

**Goal:** Navigate to a video page and extract title, description text, view count, and channel name.

**Steps:**
1. Navigate to `https://www.youtube.com/watch?v=<VIDEO_ID>` with `{ waitUntil: "domcontentloaded" }`
2. Wait for `#title h1` to appear (page loaded indicator, max 10s)
3. Dismiss any popups
4. Expand description (click `ytd-expander` or `#description` toggle)
5. Extract title, description, channel, view count
6. Return JSON

**Wait strategy:** Wait for `html[data-page-type="video"]` attribute + `#title h1` present.

**Example script:**
```js
const videoId = "dQw4w9WgXcQ";
const p = await browser.getPage("youtube-watch");
await p.goto(`https://www.youtube.com/watch?v=${videoId}`, { waitUntil: "domcontentloaded" });
await p.waitForSelector("#title h1", { timeout: 10000 });

// Dismiss any popups
await p.keyboard.press("Escape");
await new Promise(r => setTimeout(r, 500));

// Expand description if collapsed
const expander = await p.$("#description ytd-expander");
if (expander) {
  await expander.click();
  await new Promise(r => setTimeout(r, 500));
}

const details = await p.evaluate(() => {
  const title = document.querySelector("#title h1")?.textContent?.trim();
  const description = document.querySelector("#description yt-formatted-string")?.textContent?.trim();
  const channel = document.querySelector("#owner ytd-channel-name a")?.textContent?.trim();
  const views = document.querySelector("ytd-video-view-count-renderer .view-count")?.textContent?.trim();
  return { title, description, channel, views };
});
console.log(JSON.stringify(details));
```

#### Pattern: Dismiss YouTube Popups/Modals

**Goal:** Clear cookie consent, sign-in nag, and age gate before interacting.

**Steps:**
1. After page load, press Escape (dismisses most modals)
2. Check for cookie consent and accept
3. Check for sign-in dialog and close
4. Wait 1s for animations

**Example script:**
```js
// Generic dismissal — Escape key clears most YouTube modals
await page.keyboard.press("Escape");
await new Promise(r => setTimeout(r, 500));

// Check for remaining modal (sign-in, age gate)
const modal = await page.$("ytd-modal-with-title-and-button-renderer");
if (modal) {
  const closeBtn = await modal.$("#button[aria-label='Close']");
  if (closeBtn) await closeBtn.click();
}

// "Still watching?" button
const confirmBtn = await page.$("#confirm-button");
if (confirmBtn) await confirmBtn.click();
```

---

### What Works / What Broke

| Date | Task | What Broke | What Worked | Updated By |
|------|------|------------|-------------|------------|
| — | — | — | — | Initial recipe |

---

## Cross-References

- **`@mcp-tooling`** — Dev Browser tools and patterns for the underlying automation
- **`@browsing-the-web`** — Parent skill with HARD RULEs and dev-browser integration guide
