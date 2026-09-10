---
title: "developers.openai.com Site Recipe — Selectors, Patterns, Anti-Patterns"
impact: MEDIUM
impactDescription: "Proven browser automation patterns for developers.openai.com"
tags: [site-recipe, developers.openai.com, browser]
---

## developers.openai.com Site Recipe

**Base URL:** `https://developers.openai.com`
**Last verified:** 2026-09-07

---

### Known Selectors

#### Search

| Purpose | Selector | Type | Verified |
|---------|----------|------|----------|
| Not yet verified | — | — | — |

#### Content/Results

| Purpose | Selector | Type | Verified |
|---------|----------|------|----------|
| Article content | Not yet verified | Container | — |

#### Interaction

| Purpose | Selector | Type | Verified |
|---------|----------|------|----------|
| Not yet verified | — | — | — |

---

### Anti-Patterns

| Anti-Pattern | Detection Selector | Mitigation |
|-------------|-------------------|------------|
| CAPTCHA | Text containing `captcha` in body | Cannot automate — escalate |
| Popup/Modal | Not yet verified | Dismiss with Escape or close control |

---

### Navigation Patterns

#### Pattern: Retrieve an official guide

**Goal:** Retrieve the requested public guide content without authentication.

**Steps:**
1. Navigate to the requested official URL.
2. Confirm the final canonical URL and page title.
3. Extract the complete rendered article and visible code/expandable content.

**Wait strategy:** Wait for `domcontentloaded`, then allow lazy content to settle and verify the article body is non-empty.

**Example script:**
```js
const p = await browser.getPage("developers-openai-guide");
await p.goto("https://developers.openai.com/api/docs/guides/latest-model", { waitUntil: "domcontentloaded" });
console.log(JSON.stringify({ title: await p.title(), url: p.url() }));
```

---

### What Works / What Broke

| Date | Task | What Broke | What Worked | Updated By |
|------|------|------------|-------------|------------|
