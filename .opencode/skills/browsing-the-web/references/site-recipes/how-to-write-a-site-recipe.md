---
title: "How to Write a Site Recipe — Template & Guidelines"
impact: MEDIUM
impactDescription: "Standardizes the format for per-site browser automation guides"
tags: [site-recipe, template, browser, automation]
---

## How to Write a Site Recipe

**Pattern intent:** Provide a consistent template for documenting site-specific selectors, anti-patterns, and proven navigation flows. Every site recipe is a living document — updated after every successful task.

### Recipe Template

Copy this template and replace placeholders:

```markdown
---
title: "&lt;Domain&gt; Site Recipe — Selectors, Patterns, Anti-Patterns"
impact: MEDIUM
impactDescription: "Proven browser automation patterns for &lt;domain&gt;"
tags: [site-recipe, &lt;domain&gt;, browser]
---

## &lt;Domain&gt; Site Recipe

**Base URL:** `https://&lt;domain&gt;`
**Last verified:** YYYY-MM-DD

---

### Known Selectors

#### Search

| Purpose | Selector | Type | Verified |
|---------|----------|------|----------|
| Search input | `&lt;selector&gt;` | Input | YYYY-MM-DD |

#### Content/Results

| Purpose | Selector | Type | Verified |
|---------|----------|------|----------|
| Result container | `&lt;selector&gt;` | Container | YYYY-MM-DD |
| Title | `&lt;selector&gt;` | Text | YYYY-MM-DD |

#### Interaction

| Purpose | Selector | Type | Verified |
|---------|----------|------|----------|
| Submit button | `&lt;selector&gt;` | Button | YYYY-MM-DD |

---

### Anti-Patterns

| Anti-Pattern | Detection Selector | Mitigation |
|-------------|-------------------|------------|
| Cookie consent | `&lt;selector&gt;` | Click dismiss button |
| CAPTCHA | Text `"&lt;phrase&gt;"` in body | Cannot automate — escalate |
| Popup/Modal | `&lt;selector&gt;` | Dismiss with Escape or click close |
| Sign-in nag | `&lt;selector&gt;` | Dismiss or close |
| Consent/redirect | `&lt;selector&gt;` | Accept or dismiss |

---

### Navigation Patterns

#### Pattern: &lt;Action Name&gt;

**Goal:** &lt;What this flow accomplishes&gt;

**Steps:**
1. &lt;Step 1&gt;
2. &lt;Step 2&gt;
3. &lt;Step 3&gt;

**Wait strategy:** &lt;What to wait for — specific selector, URL change, event&gt;

**Example script:**
```js
const p = await browser.getPage("&lt;name&gt;");
await p.goto("&lt;url&gt;", { waitUntil: "domcontentloaded" });
// ... steps ...
console.log(JSON.stringify(result));
```

---

### What Works / What Broke

| Date | Task | What Broke | What Worked | Updated By |
|------|------|------------|-------------|------------|
| YYYY-MM-DD | &lt;task description&gt; | &lt;error&gt; | &lt;resolution&gt; | browser-agent |
```

### Naming Convention

- Filename: `<domain>.md` (e.g., `amazon.ca.md`, `youtube.com.md`, `github.com.md`)
- Use the exact domain as the filename — this is how the agent matches task URLs to recipes
- One recipe per domain

### When to Create a New Recipe

- Agent is asked to interact with a site that has no existing recipe
- An existing recipe is so outdated that all selectors are broken (deprecate old, create new)

### When to Update an Existing Recipe

- After every successful task — add to "What Works / What Broke" table
- When a new selector is discovered — add to "Known Selectors"
- When a new anti-pattern is encountered — add to "Anti-Patterns"
- When a selector stops working — mark as deprecated with date

### Recipe Review Checklist

Before using a recipe, check:
- [ ] "Last verified" date is within the last 30 days
- [ ] No selectors are marked as deprecated
- [ ] Recent "What Works" entries confirm patterns are current
- [ ] Anti-patterns section covers known obstacles

## Cross-References

- **`amazon.ca.md`** — Example of a fleshed-out site recipe (in same directory)
- **`youtube.com.md`** — Example of a fleshed-out site recipe (in same directory)
- **`@mcp-tooling`** — Dev Browser tools and patterns for the underlying automation
