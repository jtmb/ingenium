---
title: "Amazon.ca Site Recipe — Selectors, Patterns, Anti-Patterns"
impact: HIGH
impactDescription: "Proven browser automation patterns for amazon.ca — search, product extraction, pricing, CAPTCHA avoidance"
tags: [site-recipe, amazon, amazon.ca, ecommerce, browser]
---

## Amazon.ca Site Recipe

**Base URL:** `https://www.amazon.ca`
**Last verified:** 2026-07-12

---

### Known Selectors

#### Search

| Purpose | Selector | Type | Verified |
|---------|----------|------|----------|
| Search input | `#twotabsearchtextbox` | Input | 2026-07-12 |
| Search submit (modern) | `#nav-search-submit-button` | Button | 2026-07-12 |
| Search submit (fallback) | `input.nav-input[type="submit"]` | Button | 2026-07-12 |
| Search form | `form#nav-search-bar-form` | Form | 2026-07-12 |

#### Search Results (Product Listing)

| Purpose | Selector | Type | Verified |
|---------|----------|------|----------|
| Product card container | `div[data-component-type="s-search-result"]` | Container | 2026-07-12 |
| Product card (fallback) | `div[data-asin]:not([data-asin=""])` | Container | 2026-07-12 |
| Product title | `h2 a.a-link-normal.a-text-normal` | Text/Link | 2026-07-12 |
| Product URL | `h2 a[href*="/dp/"]` | Link (href) | 2026-07-12 |
| Price (screen-reader) | `span.a-price span.a-offscreen` | Text | 2026-07-12 |
| Price whole part | `span.a-price-whole` | Text | 2026-07-12 |
| Price fraction | `span.a-price-fraction` | Text | 2026-07-12 |
| Product image | `img.s-image` | Image (src) | 2026-07-12 |
| Rating | `div.a-row.a-size-small span:nth-of-type(1)` | Attribute (aria-label) | 2026-07-12 |
| Review count | `div.a-row.a-size-small span:nth-of-type(2)` | Text | 2026-07-12 |
| Prime badge | `i.a-icon-prime` | Presence check | 2026-07-12 |
| Sponsored label | `span.a-color-base` (filter with `.textContent.includes("Sponsored")` in JS) | Text | 2026-07-12 |
| Pagination next | `a.s-pagination-next` | Link | 2026-07-12 |
| ASIN from URL | N/A — parse with `\/dp\/([A-Z0-9]{10})` | Regex | 2026-07-12 |

#### Product Detail Page (PDP)

| Purpose | Selector | Type | Verified |
|---------|----------|------|----------|
| Product title | `#productTitle` | Text | 2026-07-12 |
| Price | `span.a-price span.a-offscreen` | Text | 2026-07-12 |
| ~~Price (old)~~ | ~~`#price_inside_buybox`~~ | **DEPRECATED** — missing since 2023 | ❌ 2026-07-12 |
| Deal price | `span.a-price.a-text-price span.a-offscreen` | Text | 2026-07-12 |
| Bullet points | `#featurebullets_feature_div` | Text | 2026-07-12 |
| Main image | `.imgTagWrapper img` → `data-a-dynamic-image` attribute | JSON map | 2026-07-12 |
| Add to Cart | `#add-to-cart-button` | Button | 2026-07-12 |
| Buy Now | `#buy-now-button` | Button | 2026-07-12 |
| Product description | `#productDescription` | Text (often hidden) | 2026-07-12 |

---

### Anti-Patterns

| Anti-Pattern | Detection Selector | Mitigation |
|-------------|-------------------|------------|
| 🇨🇦 Location popup | `#nav-global-location-popup-link` | Click dismiss or add `?ref_=nav_youraccount_btn` to URL |
| Cookie consent banner | `#sp-cc` wrapper or `#sp-cc-accept` | Click `input[type="submit"]#sp-cc-accept` |
| CAPTCHA challenge | Text `"type the characters"` in body, HTTP 503 | **Cannot automate** — escalate. Triggers: rapid requests (&lt;1s), VPN/datacenter IP, headless w/o stealth |
| Amazon block page | `"To discuss automated access to Amazon data"` in body | Session flagged — wait and retry with delay |
| Sign-in popup | `#nav-signin-tooltip`, `.a-popover` | Press Escape key or click close button |
| Language redirect (en→fr) | URL redirect to `?language=fr_CA` | Set `lc-main=en_CA` cookie |
| Country redirect (.com→.ca) | URL redirect from .com to .ca | Use `?tag=` or `?_encoding=UTF8&linkCode=` to stay on target |
| StaleElementException | Page re-renders after AJAX/infinite scroll | Re-query element after each scroll; use `page.waitForSelector()` |
| Price not loaded | Price selector returns null | Lazy-loaded — wait 3s + check for loading spinner gone |

---

### Navigation Patterns

#### Pattern: Search for a Product

**Goal:** Search amazon.ca and return the top N product titles and prices.

**Steps:**
1. Navigate to `https://www.amazon.ca` with `{ waitUntil: "domcontentloaded" }`
2. Wait for `#twotabsearchtextbox` to appear
3. Fill search input with query
4. Click `#nav-search-submit-button`
5. Wait for `div[data-component-type="s-search-result"]` to appear (max 15s)
6. Query all product cards, extract title + price for each
7. Filter out sponsored results via JS text-content check
8. Return JSON array of results

**Wait strategy:** After search submit, wait for URL to contain `/s?k=` and at least one `div[data-component-type="s-search-result"]`

**Example script:**
```js
const p = await browser.getPage("amazon");
await p.goto("https://www.amazon.ca", { waitUntil: "domcontentloaded" });
await p.waitForSelector("#twotabsearchtextbox", { timeout: 10000 });
await p.fill("#twotabsearchtextbox", "wireless headphones");

// Dismiss cookie consent if present
const cookieBtn = await p.$("#sp-cc-accept");
if (cookieBtn) await cookieBtn.click();

await p.click("#nav-search-submit-button");
await p.waitForFunction(() => document.querySelectorAll('div[data-component-type="s-search-result"]').length > 0, { timeout: 15000 });

const results = await p.evaluate(() => {
  return [...document.querySelectorAll('div[data-component-type="s-search-result"]')]
    .filter(card => {
      const spans = [...card.querySelectorAll('span.a-color-base')];
      return !spans.some(s => s.textContent.includes('Sponsored'));
    })
    .slice(0, 5)
    .map(card => {
      const titleEl = card.querySelector('h2 a.a-link-normal.a-text-normal');
      const priceEl = card.querySelector('span.a-price span.a-offscreen');
      const link = card.querySelector('h2 a[href*="/dp/"]');
      const asin = (link?.href || '').match(/\/dp\/([A-Z0-9]{10})/)?.[1] || null;
      return {
        title: titleEl?.textContent?.trim() || null,
        price: priceEl?.textContent?.trim() || null,
        asin
      };
    });
});
console.log(JSON.stringify(results));
```

#### Pattern: Extract Product Details by ASIN

**Goal:** Navigate to a product page and extract title, price, bullet points, and main image.

**Steps:**
1. Navigate to `https://www.amazon.ca/dp/<ASIN>` with `{ waitUntil: "domcontentloaded" }`
2. Wait for `#productTitle` to appear (page loaded indicator)
3. Extract title, price, bullet points, image URL
4. Handle any popups that appear during load

**Wait strategy:** Wait for `#productTitle` (max 10s). If timeout, check for CAPTCHA or block page.

**Example script:**
```js
const asin = "B08JG5NFGT";
const p = await browser.getPage("amazon-pdp");
await p.goto(`https://www.amazon.ca/dp/${asin}`, { waitUntil: "domcontentloaded" });
await p.waitForSelector("#productTitle", { timeout: 10000 });

const details = await p.evaluate(() => {
  const title = document.querySelector("#productTitle")?.textContent?.trim();
  const price = document.querySelector("span.a-price span.a-offscreen")?.textContent?.trim();
  const bullets = [...document.querySelectorAll("#featurebullets_feature_div li")]
    .map(li => li.textContent.trim()).filter(Boolean);
  const imgEl = document.querySelector(".imgTagWrapper img");
  const images = imgEl ? JSON.parse(imgEl.getAttribute("data-a-dynamic-image") || "{}") : {};
  return { title, price, bullets, images: Object.keys(images) };
});
console.log(JSON.stringify(details));
```

#### Pattern: Dismiss Common Popups

**Goal:** Dismiss cookie consent, location popup, and sign-in nag before interacting with the page.

**Steps:**
1. After page load, check for `#sp-cc-accept` (cookie) → click if present
2. Check for `#nav-global-location-popup-link` (location) → dismiss
3. Check for `#nav-signin-tooltip` (sign-in) → press Escape
4. Wait 1s for any animations to finish

**Example script:**
```js
async function dismissPopups(page) {
  // Cookie consent
  const cookieBtn = await page.$("#sp-cc-accept");
  if (cookieBtn) { await cookieBtn.click(); await new Promise(r => setTimeout(r, 500)); }
  
  // Sign-in nag (Escape key is safest)
  const signIn = await page.$("#nav-signin-tooltip");
  if (signIn) { await page.keyboard.press("Escape"); await new Promise(r => setTimeout(r, 500)); }
  
  // Location popup — try clicking the page body to dismiss
  const locPopup = await page.$(".a-popover-wrapper");
  if (locPopup) { await page.click("body"); await new Promise(r => setTimeout(r, 500)); }
}
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
