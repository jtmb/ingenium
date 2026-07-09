---
title: "Thread MCP Documentation Upload — Site Crawling, Content Fetch, Bulk Import"
impact: MEDIUM
impactDescription: "Standardizes how documentation websites are ingested into Thread"
tags: [thread, mcp, documentation, upload, crawling, import]
---

## Uploading Documentation Websites to Thread

### When to Trigger

- User says "index these docs", "upload documentation to Thread", "crawl this site", "ingest these docs"
- User provides a URL containing `/docs/`, `/documentation/`, `/learn/`, `/reference/`, `/api/`, or similar doc paths
- User provides a specific doc site root URL and wants all pages in Thread

### Site-Agnostic Design

This workflow contains NO site-specific selectors, API paths, or parsing rules. It discovers and fetches using universal standards: `robots.txt`, XML sitemaps, `llms.txt`, HTML `<link>` tags, content negotiation, `.md` suffix probing, and generic `<article>`/`<main>` extraction. It works with any documentation framework.

#### 🔴 Safety Constraints

1. **Never scrape auth-gated content** — If a page returns 401/403 or a login redirect, skip it.
2. **Respect `robots.txt`** — Read `/robots.txt`. Respect `Crawl-delay` and `Disallow` rules.
3. **Rate-limit aggressively** — Add 1-2s jitter between every page fetch. On 429 responses, back off exponentially (2s, 4s, 8s, max 30s). Never exceed 200 pages without confirmation.
4. **No site-specific code** — Everything must be discovered dynamically from the target site.
5. **Prioritize native markdown over HTML** — Try API-based markdown endpoints, `.md` suffixes, and `llms.txt` before falling back to HTML extraction.

### Phase 1 — Discovery: Build the URL List

Try these discovery methods in order. Stop when one succeeds (returns 10+ valid doc URLs).

**Method A — `/llms.txt` (preferred):**
```bash
curl -sSfL "https://example.com/llms.txt" 2>/dev/null || curl -sSfL "https://example.com/.well-known/llms.txt"
```
Parse URLs from the markdown list format.

**Method B — XML sitemaps:**
Check `/robots.txt` for `Sitemap:` directives, then check common sitemap paths (`/sitemap.xml`, `/sitemap_index.xml`). Parse XML `<loc>` entries, recursing into child sitemaps.

**Method C — Sitemap markdown index:**
```bash
curl -sSfL "https://example.com/docs/sitemap.md" 2>/dev/null || curl -sSfL "https://example.com/sitemap.md" 2>/dev/null
```

**Method D — API-based discovery:**
Check for API endpoints that list pages by probing known patterns or checking `<head>` for alternate link patterns.

**Method E — Recursive navigation crawl (last resort):**
`webfetch` the entry page, extract all internal links to the same domain, recursively follow up to depth 2. Stop when no new pages found or 200 page limit reached.

### Phase 2 — Fetch Content (per URL, markdown-first)

For each URL, try these strategies in order:

1. **API markdown endpoint** — Check for `<link rel="alternate" type="text/markdown">` in page `<head>`
2. **`.md` suffix** — `webfetch "${url}.md"`
3. **`Accept: text/markdown` content negotiation** — `curl -H "Accept: text/markdown" "${url}"`
4. **`webfetch` default markdown conversion** — `webfetch "${url}" format:"markdown"`
5. **HTML → plain text extraction** — Parse HTML with python3, extract `<article>` or `<main>`, strip tags

After each page fetch, append to a combined markdown file:
```bash
{
  echo ""
  echo "## ${page_title:-Untitled}"
  echo ""
  echo "_Source: ${url}_"
  echo ""
  echo "${content}"
} >> /tmp/opencode/site-docs-${site_name}.md
```

### Phase 3 — Upload to Thread

**Option A — Combined markdown file (recommended for 50+ pages):**
```bash
thread_upload_file file_path:"/tmp/opencode/site-docs-${site_name}.md" tags:"docs-import,${site_name_tag}" priority:5
```
Each `##` heading becomes one Thread entry.

**Option B — Bulk entries (recommended for <50 pages with per-entry control):**
Use `thread_bulk_create_entries` in batches of 100.

**Option C — Per-page entries (recommended for <20 pages):**
Use `thread_create_entry` per page.

### Phase 4 — Verify and Report

After upload, verify results and report:
- Site, pages found, pages fetched, entries created, upload method, tags

### When to NOT Use This Workflow

- Auth-gated or private documentation (login required)
- Sites that explicitly block crawlers in `robots.txt` via `Disallow: /`
- Multimedia-only sites (no text content to extract)
- PDF-only documentation (no HTML/markdown version)
- Sites exceeding 500 pages — warn user and ask for sub-path filter
- The same site was already imported — check `thread_search` with `"docs-import" AND "{site-tag}"` first

### After Creating or Updating Documentation Files

When you create or modify documentation files, keep Thread entries in sync:
- **Creating new docs:** Run `thread_upload_file` on the file. Tags: `["reference", "docs"]`. Priority: 4.
- **Updating existing docs:** Find old entries via `thread_search`, remove stale entries with `thread_delete_entry`, then upload the updated file.

### Tag Convention for Doc Imports

| Tag | Value | Example |
|-----|-------|---------|
| `docs-import` | Fixed — identifies this as a doc website import | `docs-import` |
| `{site-name}` | Site-specific — lowercase, hyphenated | `github-docs`, `nextjs-docs` |
| `{version-or-locale}` | Optional — version or language | `en`, `v16` |

### Priority Guidelines for Doc Imports

| Priority | Use Case |
|----------|----------|
| 7-8 | Foundational docs (API reference, architecture guides) |
| 5-6 | Tutorials, how-to guides, general documentation |
| 3-4 | Release notes, changelogs, peripheral pages |
| 0-2 | Auto-generated low-signal pages |
