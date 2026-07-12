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

## 🔴 Universal Card Component — Every Card Uses `hover:shadow-md transition-shadow`

Every card on every page of the dashboard MUST use `hover:shadow-md transition-shadow`. This is a universal rule — not optional, not per-page. The only variation is size (`p-4` for list items, `p-6` for feature cards) and border radius (`rounded` for compact, `rounded-lg` for feature).

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

## 🔴 Rules That Must Not Be Broken

1. **Card grid is always `md:grid-cols-3`** on desktop. Never change to 2 or 4 without updating this guide.
2. **Hover effects always use `transition-shadow`**. Never use `transition-all`, `transition-transform`, or omit `transition-shadow` on cards. Every card must have the full `hover:shadow-md transition-shadow` pair.
3. **Nav uses `border-b` not `shadow`**. Flat design, not elevated.
4. **All text must use gray-900/600/500 scale**. No custom hex colors in components.
5. **Cards never have shadows** by default — only on hover via `hover:shadow-md transition-shadow`. Both classes must always appear together. No exceptions.
6. **Page max-width is `max-w-6xl`**. No full-width layouts beyond navigation.
7. **Every card on every page must have `hover:shadow-md transition-shadow`**. This includes settings cards, MCP server rows, MCP category cards, observations, pipeline events, and any other card-based element. If a new page adds cards, they MUST follow this rule.

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
