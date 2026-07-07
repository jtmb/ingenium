---
name: nextjs-conventions
description: "Next.js & TypeScript/React conventions — build commands, App Router, component patterns, global stylesheet rules, secure coding, testing, naming. Use when editing **/*.{tsx,ts,jsx,js,css} in a Next.js project."
---

# Next.js & TypeScript Conventions

## When to Use

Invoke this skill when working with Next.js or TypeScript/React files (`**/*.{tsx,ts,jsx,js,css}`). It provides framework-specific build commands, component architecture rules, and naming conventions.

## Version Warning

This is NOT the Next.js you know. This version may have breaking changes — APIs, conventions, and file structure may differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

## Build & Test Commands

- **Build**: `next build`
- **Dev server**: `next dev`
- **Lint**: `next lint`
- **Type check**: `tsc --noEmit`
- **Test**: `npm test` (or project-configured test runner)

## Component Architecture

- **UI components belong in `components/ui/`.** Buttons, inputs, cards, dialogs — shared primitives. Don't inline them in page-level code.
- **Shared utilities go in `lib/`.** Date formatting, string helpers, API wrappers — used across multiple files.
- **Custom hooks over repeated patterns.** If two components share stateful logic, extract a hook.
- **Prefer Server Components by default.** Only add `"use client"` when you need interactivity, event handlers, or browser APIs.

## 🔴 HARD RULE — Styling Guide Required

Every Next.js dashboard project MUST have a `STYLING-GUIDE.md` in its service directory. This guide documents:
- All design tokens (colors, spacing, fonts, shadows)
- Layout grid and breakpoints
- Component-level styles (nav, cards, buttons, forms)
- Rules that must not be changed without updating the guide

The guide is auto-generated from a screenshot of the running dashboard when visual changes are made. If a component's styles change, `STYLING-GUIDE.md` must be updated in the same commit.

## Global Stylesheet Rules

- **All global CSS lives in `src/app/globals.css`.** Colors, typography, spacing variables, resets, utility classes — one file.
- **Use Tailwind utility classes or CSS Modules.** No inline `<style>` tags or `style={{}}` objects.
- **CSS Modules co-located with components.** If a component needs unique styles, use `component.module.css` next to the component file.
- **Flat cascade.** Avoid deep nesting and overly-specific selectors. Prefer composition over inheritance.
- **Design tokens first.** Define CSS custom properties (`--color-primary`, `--spacing-md`, etc.) in `globals.css` and reference them everywhere. Never hardcode hex values or pixel sizes in components.

## File Organization

- Pages: `src/app/` (App Router)
- Components: `src/components/` (shared), `src/components/ui/` (primitives)
- Utilities: `src/lib/`
- Types: `src/types/` or co-located `types.ts`
- Tests: co-located `__tests__/` or `*.test.ts` next to source

## App Router Conventions

- `layout.tsx` — shared layout for a route segment
- `page.tsx` — the UI for a route
- `loading.tsx` — loading UI (Suspense boundary)
- `error.tsx` — error boundary
- `not-found.tsx` — 404 UI
- Route groups: `(groupName)/` — organizational, don't affect URL
- Dynamic routes: `[param]/` — accessed via `params` prop

## Monorepo Workspace Setup

When a Next.js dashboard lives inside a monorepo (npm workspaces), Next.js may emit:

> `Next.js inferred your workspace root... We detected multiple lockfiles`

This happens when orphaned lockfiles (`pnpm-workspace.yaml`, `yarn.lock`) from other tools are present. **Do NOT set `turbopack.root`** — Next.js needs access to the monorepo root to resolve shared packages. Instead:

1. **Remove orphaned lockfiles** — `rm -f pnpm-workspace.yaml pnpm-lock.yaml yarn.lock` from the dashboard directory
2. **Verify** — restart `next dev` and check no `Warning:` or `⚠` lines appear in the first 10 lines of startup output

## 🔴 HARD RULE — API-First Frontend

**The dashboard NEVER imports from core, server, or any database library.**
All data access goes through the API gateway via HTTP:

```
✅ Dashboard → fetch(API_URL) → API → Core → SQLite
❌ Dashboard → import { db } from "core"  // NEVER
❌ Dashboard → direct MCP tool call        // NEVER
```

- `lib/api.ts` is the single HTTP client — all data flows through it
- `NEXT_PUBLIC_API_URL` env var points to the API
- Server Components fetch on the server, Client Components fetch on mount
- **CI enforces**: grep for `better-sqlite3|\.db|sqlite` in the dashboard directory must return zero results


## Secure Coding

- **No secrets in client components.** `NEXT_PUBLIC_` env vars are bundled into the browser — only use them for non-sensitive config. All secrets stay in Server Components, Route Handlers, or server-only utilities.
- **Sanitize user input.** Use `DOMPurify` for rich text, React's built-in XSS protection for JSX (never `dangerouslySetInnerHTML` without sanitizing first).
- **API Route Handlers must authenticate.** Every `/api/` route checks auth/session before processing. Use middleware for shared auth logic.
- **CSP headers for production.** Set Content-Security-Policy headers via `next.config.js` or middleware to prevent XSS and data injection.
- **Validate all search params and dynamic route params.** `searchParams` and `params` are user-controlled — treat them as untrusted input. Use Zod or similar for validation.
- **No secrets in `next.config.js` values exposed to the client.** Anything in `env` or `publicRuntimeConfig` goes to the browser.

## Testing & QA

- **Component tests:** Use React Testing Library. Test behavior, not implementation — assert what the user sees, not internal state.
- **Accessibility (a11y):** Install `@axe-core/react` and run a11y audits in CI. Every new component must be keyboard-navigable and screen-reader friendly. Use semantic HTML (`<button>`, `<nav>`, `<main>`) over `<div>` with click handlers.
- **E2E tests:** Use Playwright or Cypress for critical user flows (login, checkout, onboarding). Don't test every page — target high-value paths.
- **Visual regression:** Consider Percy or Chromatic for component-level visual diffs on PRs.
- **Lighthouse in CI:** Run Lighthouse audits on key pages. Performance < 90, a11y < 95, or SEO < 90 should fail the check.

## Naming Conventions

- **Files:** kebab-case (`user-profile.tsx`, `use-auth.ts`). Exception: `layout.tsx`, `page.tsx`, `loading.tsx`, `error.tsx` are fixed by Next.js convention.
- **Components:** PascalCase (`UserProfile`, `SignUpForm`). The component name must match the file name.
- **Functions/variables:** camelCase (`getUserById`, `isAuthenticated`)
- **Constants:** UPPER_CASE (`MAX_RETRIES`, `API_BASE_URL`)
- **Types/interfaces:** PascalCase (`User`, `ApiResponse<T>`). No `I` prefix on interfaces.
- **Hooks:** `use` prefix (`useAuth`, `useDebounce`)
- **Event handlers:** `handle` prefix (`handleClick`, `handleSubmit`)
- **Props types:** `{ComponentName}Props` (`UserProfileProps`)
