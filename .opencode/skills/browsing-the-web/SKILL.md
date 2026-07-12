---
name: browsing-the-web
description: "Drive the user's real Chrome browser via dev-browser to interact with websites — navigate, fill forms, extract data, take screenshots, and handle site-specific patterns. Use when the user asks to browse the web, visit a website, search for something, check prices, fill out a form, view a page, or any browser-based task."
---

# Browsing the Web — Real Chrome Browser Automation

> This skill uses a split-skill architecture. The index below lists all 🔴 HARD RULEs, followed by a Table of Contents linking to reference files.

## When to Use

- "go to amazon.ca and..."
- "search for X on YouTube..."
- "browse to &lt;URL&gt; and..."
- "check prices on &lt;website&gt;"
- "fill out the form at &lt;URL&gt;"
- "take a screenshot of &lt;website&gt;"
- "what does &lt;URL&gt; look like?"
- "navigate to &lt;site&gt; and &lt;action&gt;"

## 🔴 HARD RULEs

### 🔴 Always Use wsl-chrome-connect.sh — Never Call dev-browser Directly

The helper script handles Chrome launch, dev-browser installation, and stdin piping. Calling dev-browser directly without the script causes port binding errors, missing flags, and silent failures.

### 🔴 Check Site Recipes Before Any Site-Specific Task

Before interacting with a site, glob `.opencode/skills/browsing-the-web/references/site-recipes/` for a recipe matching the target domain. Site recipes contain proven selectors, anti-patterns, and navigation flows that eliminate trial-and-error retries.

### 🔴 Log Every Error to browser-agent-errors.md as It Happens

Write each error to `.opencode/agents/execution/browser-agent-errors.md` immediately — do NOT batch errors at the end. Include timestamp, site domain, step description, error message, and attempt number.

### 🔴 On Task Success: Update Site Recipe, Then Delete Errors File

After a fully successful task where all errors were resolved, update the domain's site recipe with what worked, then DELETE `browser-agent-errors.md`. The errors file is a working scratchpad — not a log archive.

### 🔴 On Task Failure: Keep Errors File — Do NOT Delete

If you gave up or the task partially failed, keep `browser-agent-errors.md`. It is your failure record for the next attempt. Recipe updates only happen on success.

### 🔴 Screenshots Must Include Site Name + Date

Use the format: `&lt;site&gt;-&lt;page-type&gt;-&lt;ISO-date&gt;.png`. Examples: `amazon-ca-search-20260712.png`, `youtube-watch-page-20260712.png`. Never use generic names like `screenshot1.png`.

### 🔴 Max 3 Retry Attempts Per Step

If a selector or action fails, adjust and retry up to 3 times. After the 3rd failure, escalate to the orchestrator with what blocked you.

## Reference Files

| File | Content |
|------|---------|
| [`references/dev-browser-integration.md`](references/dev-browser-integration.md) | How to use dev-browser with this skill — wsl-chrome-connect.sh workflow, two modes, tool catalog reference |
| [`references/site-recipes/how-to-write-a-site-recipe.md`](references/site-recipes/how-to-write-a-site-recipe.md) | Template and guidelines for writing new site recipes (selectors, anti-patterns, navigation, what-worked log) |
| [`references/site-recipes/amazon.ca.md`](references/site-recipes/amazon.ca.md) | Amazon.ca — search selectors, product listing structure, pricing extraction, CAPTCHA avoidance, location popup handling |
| [`references/site-recipes/youtube.com.md`](references/site-recipes/youtube.com.md) | YouTube.com — search, video pages, comments, shadow DOM handling, SPA navigation, cookie consent, ad detection |

## Cross-References

- **`@mcp-tooling`** — Dev Browser setup, tools catalog, patterns, and wsl-chrome-connect.sh helper script (`.opencode/skills/mcp-tooling/references/dev-browser/`)
- **`@skill-maintenance`** — How to create additional site recipes following the same split-skill format
- **`@debugging-patterns`** — Systematic error investigation when site selectors or patterns fail
