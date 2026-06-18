---
description: "Use when working with Next.js or TypeScript/React files. Covers App Router conventions, component patterns, global stylesheet rules, and build commands."
applyTo: "**/*.{tsx,ts,jsx,js,css}"
---

# Next.js & TypeScript Conventions

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
