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

## Card Components

| Property | Value | Tailwind |
|----------|-------|----------|
| Background | White | `bg-white` |
| Border | 1px light gray | `border` |
| Border Radius | 6-8px | `rounded-lg` |
| Padding | 24px | `p-6` |
| Hover Effect | Light shadow | `hover:shadow-md` |
| Transition | 150ms | `transition-shadow` |

## Nav Bar

| Property | Value | Tailwind |
|----------|-------|----------|
| Background | White | `bg-white` |
| Bottom Border | 1px gray | `border-b border-gray-200` |
| Link Color (default) | Medium gray | `text-gray-600` |
| Link Color (hover) | Dark gray | `hover:text-gray-900` |
| Active Color | Dark | `text-gray-900` |

## 🔴 Rules That Must Not Be Broken

1. **Card grid is always `md:grid-cols-3`** on desktop. Never change to 2 or 4 without updating this guide.
2. **Hover effects use `transition-shadow`**, not `transition-all` or `transition-transform`. Performance matters.
3. **Nav uses `border-b` not `shadow`**. Flat design, not elevated.
4. **All text must use gray-900/600/500 scale**. No custom hex colors in components.
5. **Cards never have shadows** by default. Only `hover:shadow-md`.
6. **Page max-width is `max-w-6xl`**. No full-width layouts beyond navigation.

---

## Card Variants

### Homepage Feature Cards

Large promotional/feature cards used on the landing page.

| Property | Value | Tailwind |
|----------|-------|----------|
| Background | White | `bg-white` |
| Border | 1px light gray | `border` |
| Border Radius | 8px | `rounded-lg` |
| Padding | 24px | `p-6` |
| Hover Effect | Light shadow | `hover:shadow-md` |
| Transition | 150ms | `transition-shadow` |

### List Item Card

Used for list items and card grids such as the skills grid, server list, and plugin list. These are denser than homepage feature cards because they appear in grids with many items.

| Property | Value | Tailwind |
|----------|-------|----------|
| Background | White | `bg-white` |
| Border | 1px light gray | `border` |
| Border Radius | 4-6px | `rounded` |
| Padding | 16px | `p-4` |
| Hover Effect | Light shadow | `hover:shadow-md` |
| Transition | 150ms | `transition-shadow` |

**When to use which:**

| Card Type | CSS | Used In |
|-----------|-----|---------|
| Feature (large) | `p-6 rounded-lg` | Homepage, welcome/onboarding |
| List item (compact) | `p-4 rounded border` | Skills grid, Server list, Plugin list |

---

## Stacked Form Card Pattern

Forms with multiple fields (Server Add, Learnings Log, Settings) use a stacked card layout inside the grid.

| Property | Value | Tailwind |
|----------|-------|----------|
| Container | White card | `bg-white p-4 rounded border` |
| Field Spacing | 12px vertical | `space-y-3` |
| Submit Button | Full width, primary blue | `w-full bg-blue-600 text-white py-2 px-4 rounded` |

**Pattern:**
```html
<div class="bg-white p-4 rounded border space-y-3">
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
| Stacked card | `bg-white p-4 rounded border space-y-3` with full-width button at bottom | Servers Add, Learnings Log, Settings |
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

## Grid Exceptions

The general grid rule (Rule #1) sets `md:grid-cols-3` for card grids. Two pages deviate:

| Page | Columns | Reason |
|------|---------|--------|
| Skills | `md:grid-cols-3` | Matches the general rule. Dense cards fit 3 across on desktop. |
| Tasks (Kanban) | `grid-cols-4` | Kanban board needs 4 columns (Todo, In Progress, Review, Done). This is the only exception. |

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
