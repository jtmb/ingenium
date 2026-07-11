---
name: development-conventions
description: "Unified development conventions — README creation, API design, Next.js 16 App Router, and Python conventions. Use when writing or reviewing any code in these domains."
alwaysApply: true
tags: ["development", "conventions", "readme", "api", "nextjs", "python"]
---

# Development Conventions

> Unified conventions across four domains: README creation, API design, Next.js 16, and Python. Each domain has its own section in `references/`.

## When to Use

- Writing or reviewing a README file
- Designing or implementing REST/HTTP API routes, handlers, or controllers
- Building or editing Next.js 16 projects with the App Router
- Writing or editing Python files (`**/*.py`)

## Reference Files

### README Creation

| File | Content |
|------|---------|
| [`references/create-readme/guidelines.md`](references/create-readme/guidelines.md) | README writing guidelines: emoji use, sections, formatting, logo usage |

### API Design

| File | Content |
|------|---------|
| [`references/api-design/status-codes.md`](references/api-design/status-codes.md) | HTTP status codes — 2xx, 3xx, 4xx, 5xx usage rules |
| [`references/api-design/error-responses.md`](references/api-design/error-responses.md) | Standardized error shape, field-level details, versioning |
| [`references/api-design/api-patterns.md`](references/api-design/api-patterns.md) | Auth, pagination, rate limiting, idempotency, request/response conventions |

### Next.js 16 App Router

| File | Content |
|------|---------|
| [`references/nextjs-conventions/build-barrel-files.md`](references/nextjs-conventions/build-barrel-files.md) | Import from source module, not barrel index |
| [`references/nextjs-conventions/build-dynamic-imports.md`](references/nextjs-conventions/build-dynamic-imports.md) | Split heavy components into loaded chunks |
| [`references/nextjs-conventions/build-external-packages.md`](references/nextjs-conventions/build-external-packages.md) | Mark Node packages with native bindings as external |
| [`references/nextjs-conventions/build-optimize-package-imports.md`](references/nextjs-conventions/build-optimize-package-imports.md) | Declare flat-export libraries in optimizePackageImports |
| [`references/nextjs-conventions/build-turbopack-config.md`](references/nextjs-conventions/build-turbopack-config.md) | Don't disable Turbopack's persistent caching |
| [`references/nextjs-conventions/cache-fetch-options.md`](references/nextjs-conventions/cache-fetch-options.md) | Declare caching intent on every server fetch |
| [`references/nextjs-conventions/cache-react-cache.md`](references/nextjs-conventions/cache-react-cache.md) | Wrap per-request fetchers with React cache() |
| [`references/nextjs-conventions/cache-revalidate-path.md`](references/nextjs-conventions/cache-revalidate-path.md) | Invalidate routes/tags after mutations |
| [`references/nextjs-conventions/cache-revalidate-tag.md`](references/nextjs-conventions/cache-revalidate-tag.md) | Use revalidateTag with cacheLife profile |
| [`references/nextjs-conventions/cache-segment-config.md`](references/nextjs-conventions/cache-segment-config.md) | Declare route-level caching via segment-config |
| [`references/nextjs-conventions/cache-use-cache-directive.md`](references/nextjs-conventions/cache-use-cache-directive.md) | Mark cacheable components with 'use cache' |
| [`references/nextjs-conventions/client-children-pattern.md`](references/nextjs-conventions/client-children-pattern.md) | Server content reaches client via children |
| [`references/nextjs-conventions/client-hydration-mismatch.md`](references/nextjs-conventions/client-hydration-mismatch.md) | SSR and client render must match |
| [`references/nextjs-conventions/client-third-party-scripts.md`](references/nextjs-conventions/client-third-party-scripts.md) | Use next/script with correct strategy |
| [`references/nextjs-conventions/client-use-client-boundary.md`](references/nextjs-conventions/client-use-client-boundary.md) | Push 'use client' to the interactive leaf |
| [`references/nextjs-conventions/cross-boundary-coherence.md`](references/nextjs-conventions/cross-boundary-coherence.md) | Audit 'use client' placement across route tree |
| [`references/nextjs-conventions/cross-component-consolidation.md`](references/nextjs-conventions/cross-component-consolidation.md) | Consolidate near-duplicate routes/components |
| [`references/nextjs-conventions/cross-dead-code.md`](references/nextjs-conventions/cross-dead-code.md) | Delete unreachable routes and orphan utilities |
| [`references/nextjs-conventions/cross-extract-shared-logic.md`](references/nextjs-conventions/cross-extract-shared-logic.md) | Extract duplicated server-side logic |
| [`references/nextjs-conventions/cross-prop-shape-drift.md`](references/nextjs-conventions/cross-prop-shape-drift.md) | Converge on canonical names across routes |
| [`references/nextjs-conventions/meta-generate-metadata.md`](references/nextjs-conventions/meta-generate-metadata.md) | Export generateMetadata for per-resource SEO |
| [`references/nextjs-conventions/meta-opengraph-images.md`](references/nextjs-conventions/meta-opengraph-images.md) | Generate OG images per page |
| [`references/nextjs-conventions/meta-robots.md`](references/nextjs-conventions/meta-robots.md) | Make crawl rules explicit |
| [`references/nextjs-conventions/meta-sitemap.md`](references/nextjs-conventions/meta-sitemap.md) | Generate sitemaps from actual data |
| [`references/nextjs-conventions/route-intercepting-routes.md`](references/nextjs-conventions/route-intercepting-routes.md) | Modal/lightbox views use intercepting routes |
| [`references/nextjs-conventions/route-not-found.md`](references/nextjs-conventions/route-not-found.md) | Use notFound() for real HTTP 404 |
| [`references/nextjs-conventions/route-parallel-routes.md`](references/nextjs-conventions/route-parallel-routes.md) | Multi-region layouts use parallel-route slots |
| [`references/nextjs-conventions/route-prefetching.md`](references/nextjs-conventions/route-prefetching.md) | Tune Link prefetch to traffic likelihood |
| [`references/nextjs-conventions/route-proxy-ts.md`](references/nextjs-conventions/route-proxy-ts.md) | Network-boundary logic in proxy.ts |
| [`references/nextjs-conventions/server-avoid-client-fetching.md`](references/nextjs-conventions/server-avoid-client-fetching.md) | Initial page data via Server Component |
| [`references/nextjs-conventions/server-component-streaming.md`](references/nextjs-conventions/server-component-streaming.md) | Wrap async leaves in Suspense |
| [`references/nextjs-conventions/server-data-colocation.md`](references/nextjs-conventions/server-data-colocation.md) | Each component fetches its own data |
| [`references/nextjs-conventions/server-error-handling.md`](references/nextjs-conventions/server-error-handling.md) | Contain async failures via error.tsx |
| [`references/nextjs-conventions/server-parallel-fetching.md`](references/nextjs-conventions/server-parallel-fetching.md) | Run independent fetches concurrently |
| [`references/nextjs-conventions/server-preload-pattern.md`](references/nextjs-conventions/server-preload-pattern.md) | Trigger critical fetches with preload |
| [`references/nextjs-conventions/stream-error-tsx.md`](references/nextjs-conventions/stream-error-tsx.md) | Every route has error.tsx |
| [`references/nextjs-conventions/stream-loading-tsx.md`](references/nextjs-conventions/stream-loading-tsx.md) | Every route has loading.tsx |
| [`references/nextjs-conventions/stream-nested-suspense.md`](references/nextjs-conventions/stream-nested-suspense.md) | Nest Suspense for natural reveal order |
| [`references/nextjs-conventions/stream-skeleton-matching.md`](references/nextjs-conventions/stream-skeleton-matching.md) | Skeletons match content dimensions |
| [`references/nextjs-conventions/stream-suspense-boundaries.md`](references/nextjs-conventions/stream-suspense-boundaries.md) | Place Suspense around independent subtrees |
| [`references/nextjs-conventions/action-error-handling.md`](references/nextjs-conventions/action-error-handling.md) | Server Actions return typed results |
| [`references/nextjs-conventions/action-optimistic-updates.md`](references/nextjs-conventions/action-optimistic-updates.md) | Apply optimistic updates for predictable UI |
| [`references/nextjs-conventions/action-pending-states.md`](references/nextjs-conventions/action-pending-states.md) | Use useFormStatus for submit button state |
| [`references/nextjs-conventions/action-revalidation.md`](references/nextjs-conventions/action-revalidation.md) | Revalidate after Server Action mutations |
| [`references/nextjs-conventions/action-server-action-forms.md`](references/nextjs-conventions/action-server-action-forms.md) | Form mutations through Server Actions |

### Python Conventions

| File | Content |
|------|---------|
| [`references/python-conventions/build-and-test.md`](references/python-conventions/build-and-test.md) | Build commands, lint/format/type-check/test defaults |
| [`references/python-conventions/typing-and-docs.md`](references/python-conventions/typing-and-docs.md) | Type hints, Google-style docstrings |
| [`references/python-conventions/testing-and-tools.md`](references/python-conventions/testing-and-tools.md) | pytest, ruff, mypy conventions |
| [`references/python-conventions/style-and-security.md`](references/python-conventions/style-and-security.md) | File organization, naming, error handling, secure coding |

### Regex Reference

| File | Content |
|------|---------|
| [`references/regex-reference/patterns.md`](references/regex-reference/patterns.md) | Common patterns, language-specific escaping, catastrophic backtracking prevention |

### Mermaid Diagrams

| File | Content |
|------|---------|
| [`references/mermaid/diagrams.md`](references/mermaid/diagrams.md) | Mandatory diagram types, quality standards, examples |

### Git Ignore

| File | Content |
|------|---------|
| [`references/gitignore/patterns.md`](references/gitignore/patterns.md) | .gitignore structure, language-specific patterns, what must/should be ignored |

### Testing

| File | Content |
|------|---------|
| [`references/testing/patterns.md`](references/testing/patterns.md) | Unit/integration/E2E patterns, Playwright selectors, anti-patterns, CI integration |

### Web Design Review

| File | Content |
|------|---------|
| [`references/web-design/reviewer.md`](references/web-design/reviewer.md) | Visual inspection workflow, layout/responsive/accessibility checks, fixing principles |

### Documentation Writing

| File | Content |
|------|---------|
| [`references/write-docs/guide.md`](references/write-docs/guide.md) | README structure, API docs, ADRs, GETTING-STARTED.md, VARIABLES.md, HOW-TO conventions |

### Useful Comments

| File | Content |
|------|---------|
| [`references/useful-comments/guidelines.md`](references/useful-comments/guidelines.md) | When and how to write comments: explain WHY not WHAT, avoid redundant/obsolete comments, annotation conventions, quality checklist |

## Cross-References

- **`local-models`** — Command safety rules and model profiles for running dev servers
- **`devops-conventions`** — Shell scripting safety flags and Docker/K8s for running docs examples
