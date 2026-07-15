# Ingenium Dashboard — Styling Guide

This guide was auto-generated from a live screenshot of the running dashboard.
Any visual changes to the dashboard MUST be reflected in this document.

---

## Color Palette

| Role | Value | Tailwind |
|------|-------|----------|
| Primary Background | `#FFFFFF` | `bg-white` |
| Card Background | `#FFFFFF` | `bg-white` |
| Page Background | `#F9FAFB` | `bg-gray-50` |
| Primary Text (Headings) | `#111827` | `text-gray-900` |
| Secondary Text (Body) | `#4B5563` | `text-gray-600` |
| Tertiary Text (Subtle) | `#6B7280` | `text-gray-500` |
| Border | `#E5E7EB` | `border-gray-200` |
| Nav Background | `#FFFFFF` | `bg-white` |
| Nav Border | `#E5E7EB` | `border-b border-gray-200` |

## Dark Mode Token System

> 🔴 **Hard rule**: Never use hardcoded Tailwind color classes for backgrounds, text, or borders. Always use CSS custom property tokens. Exception: `bg-blue-600` and similar solid accent colors for primary action buttons.

The dashboard uses CSS custom properties (defined in `globals.css` via `@theme`) to handle light/dark mode automatically. There is no need for `dark:` classes on every component — tokens switch value automatically when the `.dark` class is applied to `<html>`.

### How It Works

1. **Token definition**: Tokens are declared as `@theme` custom properties in `globals.css` with light-mode defaults
2. **Dark overrides**: A `.dark` selector block overrides each token with dark-mode values
3. **Runtime toggle**: The `ThemeToggle` component adds/removes `.dark` on `<html>`; all tokens react instantly
4. **No `dark:` prefixes**: Components use `var(--color-surface)` and get the correct color in both modes via the cascade

### Token Mapping

| Token | Light Value | Dark Value | Replaces |
|-------|-------------|------------|----------|
| `--color-surface` | `#ffffff` | `#111827` | `bg-white` |
| `--color-surface-muted` | `#f9fafb` | `#1f2937` | `bg-gray-50`, `bg-gray-100` |
| `--color-surface-hover` | `#f3f4f6` | `#374151` | `hover:bg-gray-50` / `hover:bg-gray-100` |
| `--color-surface-selected` | `#eff6ff` | `#1e3a5f` | `bg-blue-50` |
| `--color-border` | `#e5e7eb` | `#374151` | `border-gray-200` |
| `--color-border-muted` | `#f3f4f6` | `#1f2937` | `border-gray-100` |
| `--color-text-primary` | `#111827` | `#f3f4f6` | `text-gray-900` / `text-gray-800` / `text-gray-700` |
| `--color-text-secondary` | `#6b7280` | `#9ca3af` | `text-gray-600` |
| `--color-text-muted` | `#9ca3af` | `#6b7280` | `text-gray-500` / `text-gray-400` |
| `--color-text-link` | `#2563eb` | `#60a5fa` | `text-blue-600` |
| `--color-error-bg` | `#fef2f2` | `#7f1d1d33` | `bg-red-50` |
| `--color-warning-bg` | `#fffbeb` | `#78350f33` | `bg-amber-50` |
| `--color-success-bg` | `#f0fdf4` | `#14532d33` | `bg-green-50` / `bg-green-100` |

### Usage: Old → New Class Migration

**Backgrounds:**
```html
<!-- Old -->
<div class="bg-white">...</div>
<div class="bg-gray-50">...</div>
<div class="hover:bg-gray-100">...</div>

<!-- New -->
<div class="bg-[var(--color-surface)]">...</div>
<div class="bg-[var(--color-surface-muted)]">...</div>
<div class="hover:bg-[var(--color-surface-hover)]">...</div>
```

**Text:**
```html
<!-- Old -->
<h1 class="text-gray-900">Title</h1>
<p class="text-gray-600">Body</p>
<span class="text-gray-400">Caption</span>

<!-- New -->
<h1 class="text-[var(--color-text-primary)]">Title</h1>
<p class="text-[var(--color-text-secondary)]">Body</p>
<span class="text-[var(--color-text-muted)]">Caption</span>
```

**Borders:**
```html
<!-- Old -->
<div class="border border-gray-200">...</div>
<div class="border-b border-gray-100">...</div>

<!-- New -->
<div class="border border-[var(--color-border)]">...</div>
<div class="border-b border-[var(--color-border-muted)]">...</div>
```

**Accent / Semantic backgrounds:**
```html
<!-- Old -->
<div class="bg-blue-50">...</div>
<div class="bg-red-50">...</div>
<div class="bg-amber-50">...</div>
<div class="bg-green-50">...</div>

<!-- New -->
<div class="bg-[var(--color-surface-selected)]">...</div>
<div class="bg-[var(--color-error-bg)]">...</div>
<div class="bg-[var(--color-warning-bg)]">...</div>
<div class="bg-[var(--color-success-bg)]">...</div>
```

### Exceptions

Solid accent colors for interactive elements still use Tailwind utility classes directly:

| Element | Class | Reason |
|---------|-------|--------|
| Primary action button | `bg-blue-600 text-white` | Intentional accent, not a surface |
| Destructive button | `bg-red-600 text-white` | Intentional alert accent, not a surface |
| Active tab pill | `bg-blue-600 text-white` | Intentional accent, not a surface |

These accent colors are the same in light and dark mode — they intentionally stand out against both backgrounds. Do not apply token variables to these.

### Dark Mode FileTree / Sidebar Adaptation

The FileTree and FolderSidebar components need special attention because they use `bg-gray-50` as their surface — which becomes `--color-surface-muted`:

```html
<!-- Before -->
<div class="bg-gray-50 border-r border-gray-200 min-w-[200px]">

<!-- After -->
<div class="bg-[var(--color-surface-muted)] border-r border-[var(--color-border)] min-w-[200px]">
```

Selected items in FileTree also use the token:
```html
<!-- Before -->
<div class="bg-blue-100 text-blue-800">

<!-- After -->
<div class="bg-[var(--color-surface-selected)] text-[var(--color-text-link)]">
```

## Typography

| Element | Size | Weight | Tailwind |
|---------|------|--------|----------|
| Page Title (h1) | 28-32px | Bold (700) | `text-3xl font-bold` |
| Card Title (h2) | 16-18px | Semi-Bold (600) | `text-lg font-semibold` |
| Body Text | 14px | Regular (400) | `text-sm` |
| Nav Links | 13-14px | Medium (500) | `text-sm` |
| Logo | 18px | Bold (700) | `text-lg font-bold` |

## Layout

| Element | Value | Tailwind |
|---------|-------|----------|
| Page Max Width | 1200px | `max-w-6xl` |
| Page Padding | 24px | `p-6` |
| Nav Height | 56px | `py-3` |
| Nav Padding (H) | 24px | `px-6` |
| Nav Gap (links) | 24px | `gap-6` |
| Content Spacing | 32px | `space-y-8` |

## Grid

| Element | Value | Tailwind |
|---------|-------|----------|
| Card Grid (Desktop) | 3 columns | `grid grid-cols-1 md:grid-cols-3` |
| Card Gap | 16px | `gap-4` |

## 🔴 Universal Card Component — Every Card Uses `hover:shadow-md transition-shadow`

Every card on every page of the dashboard MUST use `hover:shadow-md transition-shadow`. This is a universal rule — not optional, not per-page. The only variation is size (`p-4` for list items, `p-6` for feature cards) and border radius (`rounded` for compact, `rounded-lg` for feature).

> 🔴 **Verified standard**: The correct pattern is `hover:shadow-md transition-shadow` (NOT `hover:shadow-lg` or `hover:shadow-xl`). This has been verified and standardized across all dashboard pages as of the dark-mode consistency pass. All 29 card instances across 15 pages use this exact pair — no shadow-lg or shadow-xl variations remain.

| Property | Value | Tailwind |
|----------|-------|----------|
| Background | White | `bg-white` |
| Border | 1px light gray | `border` |
| Border Radius | 4-6px (compact) or 8px (feature) | `rounded` or `rounded-lg` |
| Padding | 16px (compact) or 24px (feature) | `p-4` or `p-6` |
| Hover Effect | Light shadow (ALWAYS) | `hover:shadow-md` |
| Transition | 150ms (ALWAYS) | `transition-shadow` |

## Nav Bar

| Property | Value | Tailwind |
|----------|-------|----------|
| Background | White | `bg-white` |
| Bottom Border | 1px gray | `border-b border-gray-200` |
| Link Color (default) | Medium gray | `text-gray-600` |
| Link Color (hover) | Dark gray | `hover:text-gray-900` |
| Active Color | Dark | `text-gray-900` |
| Layout | Logo left, nav links center, gear right | `flex items-center justify-between` |
| Settings Gear | Sole far-right element | `ml-auto` |

### Nav Layout

The nav bar uses a three-zone layout:
1. **Left**: Logo / branding
2. **Center**: Page navigation links
3. **Right**: Settings gear icon (⚙️) positioned with `ml-auto` as the sole far-right element

### Removed from Nav

- **Theme toggle** — Removed from the nav bar. Dark/light mode switching is now in Settings → General tab only.
- **ProjectSelector** — Removed from the nav bar entirely. Project switching is done on the `/projects` page — each project card has an ACTIVE badge and Set Active button. No project selector appears in the nav or on other pages.

## Settings Overlay

The Settings panel is a full-screen overlay (not a separate page). It uses the Overlay component pattern with a two-column layout.

### Trigger
- **Launcher**: Gear icon button in the top navigation bar (`SettingsLauncher.tsx`)
- **State**: URL-driven via `?settings=<tab>` query parameter; absent = closed
- **Auto-select**: The `tabForPathname(pathname)` function maps the current route to its settings tab

### Layout
| Element | Value |
|---------|-------|
| Container | `fixed inset-0 z-50` with 16px margin, `rounded-lg shadow-2xl` |
| Backdrop | `bg-black/50` |
| Two-column | Sidebar `w-64 shrink-0` + Content `flex-1 overflow-y-auto` |
| Animation | `animate-fadeIn` 200ms fade + scale 0.95→1 (via `<style jsx>`) |

### Sidebar Tabs
| Property | Value |
|----------|-------|
| Active state | `bg-[var(--color-surface-hover)] border-r-2 border-[var(--color-border)]` |
| Inactive state | Transparent, hover: `bg-[var(--color-surface-hover)]` |
| Icon | Inline SVG, 16×16, `text-[var(--color-text-secondary)]` |
| Label | 14px medium `text-[var(--color-text-primary)]` |

### Setting Rows
Each setting row uses the `SettingRow` component:
- Left 65%: label (14px medium) + optional description (12px regular muted)
- Right 35%: control (dropdown, input, or toggle)
- Divider: `border-t border-[var(--color-border)]` between rows

### Controls
| Type | Styling |
|------|---------|
| Select | Same mandated pattern as all dashboard selects (border + px-3 py-1.5 + rounded + hover:bg) |
| Number input | `border border-[var(--color-border)] rounded px-3 py-1.5 text-sm bg-[var(--color-surface)]` |
| Text input | Same as number input |
| Password input | Same as text input + show/hide toggle button |

### Tab Panels
- **GeneralPanel**: Theme + Archive retention
- **MailPanel**: OAuth credentials + sync intervals + window sizes
- **PipelinePanel**: Synthesis LLM configuration (provider/model/key/custom/backup/test)
- **ConfigPanel**: Link to /config editor
- All other tabs: `PlaceholderPanel` — centered icon + "No settings for {label} yet"

### Adding a New Settings Tab
1. Add an entry to `ALL_TABS` in `tabs.ts`
2. Add a pathname mapping in `tabForPathname()` if routing-based auto-select is desired
3. Create a panel component following the `SettingRow` pattern
4. Wire it into `TAB_PANELS` in `SettingsOverlay.tsx`

## Dark Mode Badge / Pill Pattern

All badge and pill elements MUST use the shared `badgeTones` helper (`src/lib/badgeTones.ts`) for consistent dark-mode styling.

### Usage
```ts
import { badgeTones, BADGE_BASE } from '@/lib/badgeTones';

// For a purple badge:
<span className={`${BADGE_BASE} ${badgeTones('purple')}`}>Label</span>
// For a green success badge:
<span className={`${BADGE_BASE} ${badgeTones('success')}`}>Done</span>
```

### Available Hues
| Hue | Use For |
|-----|---------|
| `purple` | Preferences, orchestrator agents, plugins |
| `blue` | Insight, execution agents, info states |
| `green` / `success` | Done/completed, running, QA agents |
| `amber` / `warning` | Review, in-progress, pending |
| `red` / `error` | Critical, failed, errors |
| `teal` | Workflow, configs, explore agents |
| `indigo` | Terminology, email |
| `pink` | Goals, auto-observer |
| `orange` | Synthesis, behavior |
| `cyan` | Observer |
| `emerald` | Pipeline completion, complete states |
| `slate` | Skills, neutral |
| `gray` / `muted` | Disabled, idle, queued |

### Light + Dark Class Pattern
Each hue generates: `bg-{hue}-100 text-{hue}-700 dark:bg-{hue}-500/20 dark:text-{hue}-300`

### Do NOT Hardcode Badge Colors
❌ `bg-purple-100 text-purple-700` — invisible in dark mode
✅ `badgeTones('purple')` — adapts to both themes

---

## 🔴 Rules That Must Not Be Broken

1. **Card grid is always `md:grid-cols-3`** on desktop. Never change to 2 or 4 without updating this guide.
2. **Hover effects always use `transition-shadow`**. Never use `transition-all`, `transition-transform`, or omit `transition-shadow` on cards. Every card must have the full `hover:shadow-md transition-shadow` pair.
3. **Nav uses `border-b` not `shadow`**. Flat design, not elevated.
4. **All text must use gray-900/600/500 scale**. No custom hex colors in components.
5. **Cards never have shadows** by default — only on hover via `hover:shadow-md transition-shadow`. Both classes must always appear together. No exceptions.
6. **Page max-width is `max-w-6xl`**. No full-width layouts beyond navigation.
7. **Every card on every page must have `hover:shadow-md transition-shadow`**. This includes settings cards, MCP server rows, MCP category cards, observations, pipeline events, and any other card-based element. If a new page adds cards, they MUST follow this rule.
8. **Always use explicit border colors for critical borders**. Never use bare `border`/`border-t`/`divide-y` without an explicit border-color utility for visually important separators. The global default covers minor borders.

### Tailwind v4 Border Color Default
Tailwind v4 uses `currentColor` as the default border color (not gray-200 as in v3). 
The `globals.css` @layer base rule sets `*, ::before, ::after { border-color: var(--color-border); }` 
so bare `border`/`border-t`/`divide-y` resolve to dark gray in dark mode.
Always use explicit border colors (`border-[var(--color-border)]`) for critical borders rather than 
relying on the global default. Never use hardcoded `border-gray-200` — it won't adapt.

---

## Card Variants — All Use `hover:shadow-md transition-shadow`

All cards below universally include `hover:shadow-md transition-shadow` (Rule #7). The only variation is padding and border radius.

### Homepage Feature Cards

Large promotional/feature cards used on the landing page.

| Property | Value | Tailwind |
|----------|-------|----------|
| Background | White | `bg-white` |
| Border | 1px light gray | `border` |
| Border Radius | 8px | `rounded-lg` |
| Padding | 24px | `p-6` |
| Hover Effect | Light shadow (REQUIRED) | `hover:shadow-md` |
| Transition | 150ms (REQUIRED) | `transition-shadow` |

### List Item Card

Used for list items and card grids such as the skills grid, server list, MCP server rows, plugin list, agents list, observation list, and pipeline events. These are denser than homepage feature cards.

| Property | Value | Tailwind |
|----------|-------|----------|
| Background | White | `bg-white` |
| Border | 1px light gray | `border` |
| Border Radius | 4-6px | `rounded` |
| Padding | 16px | `p-4` |
| Hover Effect | Light shadow (REQUIRED) | `hover:shadow-md` |
| Transition | 150ms (REQUIRED) | `transition-shadow` |

### MCP Category Card

Used for grouped category sections in the Tools tab — a larger container with a category header and a list of tools inside. May use `overflow-hidden` to clip the inner divide borders.

| Property | Value | Tailwind |
|----------|-------|----------|
| Background | White | `bg-white` |
| Border | 1px light gray | `border` |
| Overflow | Clip children | `overflow-hidden` |
| Hover Effect | Light shadow (REQUIRED) | `hover:shadow-md` |
| Transition | 150ms (REQUIRED) | `transition-shadow` |

### Stacked Form Card

Used for settings panels and add forms. These are single-section cards with vertically stacked fields.

| Property | Value | Tailwind |
|----------|-------|----------|
| Background | White | `bg-white` |
| Border | 1px light gray | `border` |
| Border Radius | 4-6px | `rounded` |
| Padding | 16-24px | `p-4` or `p-6` |
| Hover Effect | Light shadow (REQUIRED) | `hover:shadow-md` |
| Transition | 150ms (REQUIRED) | `transition-shadow` |

**When to use which:**

| Card Type | CSS | Used In |
|-----------|-----|---------|
| Feature (large) | `p-6 rounded-lg` | Homepage, welcome/onboarding |
| List item (compact) | `p-4 rounded border` | Skills grid, MCP server rows, Plugin list, Agents, Observations, Pipeline events |
| MCP Category | `rounded border overflow-hidden` | MCP Tools tab category groups |
| Stacked Form | `p-4/p-6 rounded border` | Settings panels, Add Server form |

---

## Stacked Form Card Pattern

Forms with multiple fields (Server Add, Learnings Log, Settings) use a stacked card layout inside the grid.

| Property | Value | Tailwind |
|----------|-------|----------|
| Container | White card with hover shadow | `bg-white p-4 rounded border hover:shadow-md transition-shadow` |
| Field Spacing | 12px vertical | `space-y-3` |
| Submit Button | Full width, primary blue | `w-full bg-blue-600 text-white py-2 px-4 rounded` |

> 🔴 **Rule**: Stacked form cards MUST include `hover:shadow-md transition-shadow` like every other card.

**Pattern:**
```html
<div class="bg-white p-4 rounded border space-y-3 hover:shadow-md transition-shadow">
  <input class="w-full border-gray-200 rounded" />
  <textarea class="w-full border-gray-200 rounded"></textarea>
  <button class="w-full bg-blue-600 text-white py-2 px-4 rounded">
    Submit
  </button>
</div>
```

**When to use which form pattern:**

| Pattern | Layout | Used In |
|---------|--------|---------|
| Stacked card | `bg-white p-4 rounded border space-y-3 hover:shadow-md transition-shadow` with full-width button at bottom | Servers Add, Settings panels |
| Inline row | `flex flex-row gap-2 items-end` with input + button on same line | Projects Create (name field), Tasks Add |

---

## Button Color Rules

| Color | Use Case | Examples |
|-------|----------|---------|
| `bg-blue-600 text-white` | **Primary action** — create, add, log, save | Projects Create, Tasks Add, Learnings Log, Servers Add |
| `bg-red-600 text-white` | **Destructive action** — delete, purge | Archive Purge, Delete buttons |
| `bg-green-600 text-white` | **Secondary action** — upload, import | Skills Upload Skill |

**Rules:**
- Blue is the default action button. Never use green or red for routine actions.
- Red buttons must be reserved for operations that cannot be undone.
- All buttons use consistent padding: `py-2 px-4` and border radius: `rounded`.
- Disabled buttons use `opacity-50 cursor-not-allowed`.

---

## Select / Dropdown Styling

All `<select>` elements must include a hover state consistent with the universal card styling.

| Property | Value | Tailwind |
|----------|-------|----------|
| Frame | 1px light gray border, white background, rounded | `border border-gray-200 rounded bg-white` |
| Padding | 8px horizontal, 6px vertical | `px-3 py-1.5` or `p-2` |
| Text | 14px | `text-sm` |
| Hover Background | Light gray | `hover:bg-gray-50` |
| Cursor | Pointer | `cursor-pointer` |

> 🔴 **Rule**: Every `<select>` element MUST have `hover:bg-gray-50 cursor-pointer`. No exceptions. This applies to sort dropdowns, filter selects, provider/model pickers, and any other select across all pages.

**Minimum required classes:**
```
border border-gray-200 rounded text-sm bg-white hover:bg-gray-50 cursor-pointer
```

**Pages with selects:** MCP (category filter), Observations (status + type filters), Personality (sort), Skills (sort), Agents (category + mode), Settings (provider + model + interval + backup), Mail (composer + sidebar).

---

## Grid Exceptions

The general grid rule (Rule #1) sets `md:grid-cols-3` for card grids. Three pages deviate:

| Page | Columns | Reason |
|------|---------|--------|
| Skills | `md:grid-cols-3` | Matches the general rule. Dense cards fit 3 across on desktop. |
| Tasks (Kanban) | `grid-cols-4` | Kanban board needs 4 columns (Todo, In Progress, Review, Done). |
| Mail (inbox) | `flex` 3-pane | Application layout — Folder sidebar + email list + reader panes. Documented as exception. |

**If any page needs a different column count, document it here and update Rule #1.**

---

## Skill Detail Overlay (Split-Pane)

The skill detail overlay uses a fixed position overlay with a split-pane layout.

| Property | Value | Tailwind |
|----------|-------|----------|
| Overlay Container | Fixed fullscreen, centered | `fixed inset-0 z-50 flex items-start justify-center` |
| Overlay Backdrop | 50% black | `bg-black/50` |
| Overlay Card | White, max width | `relative w-11/12 max-w-7xl` |
| Max Height | 90vh scrollable | `max-h-[90vh]` |
| Split Layout | Flex row, left + right | `flex flex-1 overflow-hidden` |

### File Tree (Left Sidebar) — FileTree Component

The FileTree component renders a collapsible tree from the skill's `file_tree` JSON.

| Property | Value | Tailwind |
|----------|-------|----------|
| Width | 220-300px | `min-w-[220px] max-w-[300px]` |
| Background | Light gray | `bg-gray-50` |
| Border | Right border | `border-r border-gray-200` |
| Item Height | Compact 32px | `px-2 py-1` |
| Selected Item | Blue highlight | `bg-blue-100 text-blue-800` |
| Hover | Light gray | `hover:bg-gray-100` |
| Indentation | 16px per depth level | `paddingLeft: depth * 16 + 8px` |
| Metadata Node | Shows tags + alwaysApply from skill fields | — |

### Syntax Highlighting

highlight.js is loaded globally in `layout.tsx`:
- **Import**: `highlight.js/styles/github.css` (light), `hljs-dark.css` (dark, loaded after)
- **Preview mode**: `hljs.highlightElement()` called on `<pre><code>` blocks after rendered markdown is mounted
- **Source mode**: `hljs.highlightElement()` called on the entire `<code>` element with dynamic `language-{ext}` class

| Mode | Trigger | Target |
|------|---------|--------|
| Preview | `useEffect` on `renderedHtml` change | All `pre code` blocks in the container |
| Source | `useEffect` on `content`/`language` change | Single `<code>` element with `language-{ext}` class |

### Projects Page — Active/Archived Tabs

| Property | Value | Tailwind |
|----------|-------|----------|
| Tab Bar | Flex row, no wrapping | `flex gap-2 items-center` |
| Active Tab | Blue filled pill | `bg-blue-600 text-white px-4 py-1 rounded` |
| Inactive Tab | Ghost gray pill | `text-gray-600 hover:bg-gray-100 px-4 py-1 rounded` |
| Archived Badge | Small, red | `text-xs text-red-500` |
| Action Buttons | Small border pills | `text-xs px-2 py-1 border rounded hover:bg-gray-100` |
| Rename Button | Default gray | — |
| Archive Button | Red tint on hover | `hover:bg-red-50 text-red-600` |
| Restore Button | Green tint on hover | `hover:bg-green-50 text-green-600` |

### Mail Page Components

| Component | Pattern Used | Key Tailwind Classes |
|-----------|-------------|---------------------|
| FolderSidebar | FileTree sidebar | `min-w-[200px] max-w-[250px] bg-gray-50 border-r border-gray-200`. Items: `px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded`. Selected: `bg-blue-100 text-blue-800`. |
| EmailList | List items with borders | Rows: `px-4 py-3 border-b border-gray-200 hover:bg-gray-50`. Unread: `font-semibold text-gray-900`. Read: `text-gray-600`. Selected: `bg-blue-50`. |
| EmailComposer | Bare form fields inside Overlay | `space-y-4 max-w-2xl mx-auto`. Send: `bg-blue-600 text-white py-2 px-4 rounded`. Draft: `text-gray-600 hover:text-gray-900`. |
| EmailReader | Headers panel + action bar | Headers: `bg-gray-50 border-b border-gray-200 px-4 py-3`. Actions: `px-3 py-1.5 text-sm border border-gray-200 rounded text-gray-600 hover:bg-gray-100`. Delete: `text-red-600 hover:bg-red-50`. |
| AccountSetup | Provider grid + form | Provider cards: list item pattern `p-4 rounded border hover:shadow-md`. Form: stacked card `p-6 rounded-lg border space-y-4`. |

### Overlay Container Pattern — Content Wrapper Delegation

The `Overlay` component (used for compose, detail views, and modals) provides the white panel container with `bg-white rounded-lg shadow-2xl` plus a header (title/close) and scrollable body area (`px-6 py-4`). **Content components rendered inside Overlay must not duplicate the container styling.**

| Component | Outer container provided by | Content component provides |
|-----------|---------------------------|---------------------------|
| EmailComposer inside Overlay | Overlay: `bg-white rounded-lg shadow-2xl` + body `px-6 py-4` | Bare form fields: `space-y-4 max-w-2xl mx-auto` |

> 🔴 **Rule**: Any component rendered as a child of `Overlay` MUST NOT include `bg-white`, `rounded`, `border`, or `shadow` on its outermost wrapper. The Overlay provides these. The child component should only provide layout and spacing classes for its internal content (e.g., `space-y-4`, `max-w-2xl mx-auto`). This keeps the overlay container consistent and avoids nested whites or double-rounded corners.
