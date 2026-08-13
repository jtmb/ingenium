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
3. **Runtime theme selection**: `GeneralPanel` updates the theme through `ThemeProvider`, which adds/removes `.dark` on `<html>`; all tokens react instantly
4. **No `dark:` prefixes**: Components use `var(--color-surface)` and get the correct color in both modes via the cascade

### Token Mapping

| Token | Light Value | Dark Value | Replaces |
|-------|-------------|------------|----------|
| `--color-surface` | `#ffffff` | `#171717` | `bg-white` (was `#111827`) |
| `--color-surface-muted` | `#f9fafb` | `#0f0f0f` | `bg-gray-50`, `bg-gray-100` (was `#1f2937`) |
| `--color-surface-hover` | `#f3f4f6` | `#262626` | `hover:bg-gray-50` / `hover:bg-gray-100` (was `#374151`) |
| `--color-surface-selected` | `#eff6ff` | `#333333` | `bg-blue-50` (light), neutral gray (dark) (was `#374151`) |
| `--color-surface-raised` | `#ffffff` | `#1f1f1f` | (was `#1f2937`) |
| `--color-selection-bg` | `#eff6ff` | `#333333` | `bg-blue-100` / active item background (was `#374151`) |
| `--color-selection-text` | `#1e3a5f` | `#e5e5e5` | `text-blue-800` / active item text (was `#e5e7eb`) |
| `--color-border` | `#e5e7eb` | `#2a2a2a` | `border-gray-200` (was `#374151` / `#2d3748`) |
| `--color-border-muted` | `#f3f4f6` | `#1f1f1f` | `border-gray-100` (was `#1f2937`) |
| `--color-border-hover` | `#d1d5db` | `#404040` | (was `#4b5563`) |
| `--color-text-primary` | `#111827` | `#e5e5e5` | `text-gray-900` / `text-gray-800` / `text-gray-700` (was `#f3f4f6`) |
| `--color-text-secondary` | `#6b7280` | `#a0a0a0` | `text-gray-600` (was `#9ca3af`) |
| `--color-text-muted` | `#9ca3af` | `#707070` | `text-gray-500` / `text-gray-400` (was `#6b7280`) |
| `--color-text-link` | `#2563eb` | `#60a5fa` | `text-blue-600` (unchanged) |
| `--color-nav-bg` | `#ffffff` | `#111111` | (was `#111827`) |
| `--color-nav-border` | `#e5e7eb` | `#2a2a2a` | (was `#374151`) |
| `--color-nav-text` | `#6b7280` | `#a0a0a0` | (was `#9ca3af`) |
| `--color-nav-text-hover` | `#111827` | `#e5e5e5` | (was `#f3f4f6`) |
| `--color-nav-text-active` | `#2563eb` | `#e5e5e5` | Active navigation link text (was `#e5e7eb`) |
| `--color-code-bg` | `#f3f4f6` | `#1f1f1f` | (was `#1f2937`) |
| `--color-code-text` | `#111827` | `#e5e5e5` | (was `#e5e7eb`) |
| `--color-code-border` | `#e5e7eb` | `#2a2a2a` | (was `#374151`) |
| `--color-error-bg` | `#fef2f2` | `#7f1d1d33` | `bg-red-50` (unchanged) |
| `--color-warning-bg` | `#fffbeb` | `#78350f33` | `bg-amber-50` (unchanged) |
| `--color-success-bg` | `#f0fdf4` | `#14532d33` | `bg-green-50` / `bg-green-100` (unchanged) |

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

## Authentication and Account UX

- Public authentication routes use one centered `max-w-md` token-surface card on
  `--color-surface-muted`, with visible labels, browser-appropriate autocomplete,
  an `aria` status/alert region, and no application navigation behind the form.
- Login, reset, verification, invitation, MFA, and bootstrap cards use
  `rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6
  hover:shadow-md transition-shadow`. Primary submit actions remain blue; provider
  actions are bordered secondary buttons.
- Account, security, session, API-token, and organization workflows remain full
  pages. Settings deep links use route-linked panels rather than duplicating
  sensitive state in the Settings portal.
- Recent-authentication prompts use a centered modal, restore trigger focus,
  close on Escape, clear credentials on close/failure, and never render token or
  recovery material after the one-time acknowledgement state is dismissed.
- The responsive top-bar control order is Project, Settings, Account. At 390px,
  controls shrink without hiding their accessible names or overflowing the page.

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

## Usage Analytics

The `/usage` workspace uses an analytical, provider-neutral presentation: compact
metric cards, a responsive SVG request trend, and horizontally scrollable data
tables. It must retain the dashboard token system and not borrow provider branding.

- **Metrics:** Use `rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 hover:shadow-md transition-shadow` cards. Availability is a subdued token-based pill; unavailable values are text, never synthetic zeroes. Reasoning-token cards use the same known/partial/unavailable treatment as other token counters.
- **Filters:** Keep UTC explicit in labels and supporting copy. The `From` boundary is inclusive and the `To` boundary is visibly labelled exclusive in both controls and the applied-range label. Native selects use `bg-[var(--color-surface)]`, `hover:bg-[var(--color-surface-hover)]`, and `cursor-pointer`. Agent selection is disabled with an explicit unavailable state until reported attribution is present; status selection uses the API's canonical status values.
- **Charts:** Use `--color-accent` for analytical lines and `--color-border` / `--color-border-muted` for axes and guides. SVG charts require a visible heading plus programmatic title and description, and must have a semantic data-table alternative.
- **Tables:** Keep semantic `<table>` markup inside `overflow-x-auto` wrappers so analytical columns remain readable on mobile. Raw provider, model, and reported agent identifiers use a compact monospace treatment without renaming. Daily, breakdown, and event cost cells include the API availability label (`Known`, `Partial`, or `Unavailable`) alongside the amount; a `Partial` event may validly have no amount.
- **Unknown telemetry:** Cost, cache counters, reasoning counters, and unsupported attribution must read `Unavailable` or `Partial` as supplied by the API. Do not calculate a cache-hit rate, currency conversion, or agent attribution when the API does not report it. Truncated CSV exports expose a continuation action only when the API supplies a continuation cursor.

### Usage advisory panel (`/usage`)

- Keep advisory configuration in the existing `/usage` analytical flow; do not add a navigation item, settings surface, or a second table abstraction. The panel is one token-surface card, with threshold fields in a compact `xl:grid-cols-5` grid and a one-column mobile stack.
- Threshold inputs retain explicit labels and use blank `Disabled` placeholders. The reported-cost field is always labelled **Reported cost amount** and never adds a currency, estimate, conversion, or enforcement control. Revision and update timestamps are terse UTC metadata.
- Selected-range results use compact token-surface cards; all-history attention uses semantic lifecycle cards in a `lg:grid-cols-2` grid. Severity is conveyed by token-based info/warning/error tones plus text, never color alone. Cards must retain `hover:shadow-md transition-shadow`.
- Attention actions are limited to the routine blue **Evaluate attention now** button and a bordered **Acknowledge** button. There are no resolve, reopen, delete, suppress, retry, notification, throttling, sync, or mapping controls. Loading, empty, error, and continuation states keep currently loaded cards visible.
- At 390px, fields, cards, metadata, and actions must wrap or stack without document overflow. Desktop keeps five threshold fields compact; existing telemetry tables remain semantic tables in their own horizontal wrappers.

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

## Application Shell Navigation

The top bar is a compact control strip: the responsive navigation control is
immediately before the Ingenium logo, and ProjectDropdown then Settings remain
at the far right. Page links live only in the left desktop rail or the mobile
drawer; they are not duplicated in the top bar.

| Property | Value | Tailwind |
|----------|-------|----------|
| Background | Surface token | `bg-[var(--color-surface)]` |
| Bottom Border | 1px token border | `border-b border-[var(--color-border)]` |
| Desktop rail | Full `w-56`, compact `w-14`; real flex layout item | `transition-[width] motion-reduce:transition-none` |
| Compact links | Icon-only, labelled native tooltip | `aria-label` + `title` |
| Mobile navigation | Modal `w-64 max-w-[85vw]` drawer with exit presence | `md:hidden fixed inset-0` |
| Settings Gear | Far-right control after ProjectDropdown | `ml-auto` |

### Left navigation scrollbar

The desktop sidebar and shared mobile drawer use the named `.nav-scroll-area`
class. Keep `overflow-y-auto` on both containers so wheel, touch, PageDown, and
keyboard scrolling continue to use native behavior. The class reserves a
stable, narrow scrollbar gutter (`scrollbar-gutter: stable`, `scrollbar-width:
thin`, and an 8px WebKit scrollbar) so showing the thumb never changes layout
width.

- Idle Firefox scrollbar colors are `transparent transparent`.
- Idle WebKit thumb and track are transparent; scrollbar buttons are hidden.
- On hover-capable devices, only the thumb changes to the theme token
  `--color-nav-scrollbar-thumb`; the track remains transparent.
- The `(hover: none)` override prevents touch browsers from keeping desktop
  scrollbar chrome visible after a tap.
- Do not apply this class to main-content scroll containers, add JavaScript,
  or replace the native overflow behavior with `overflow: hidden`.

### Nav Layout

The shell has three responsive zones:
1. **Left**: one breakpoint-specific navigation control immediately before the logo. On desktop it collapses or expands the rail; on mobile it opens or closes the drawer.
2. **Body**: the desktop rail is a shrink-proof `w-56`/`w-14` sibling of the `min-w-0` content column. Compact mode preserves link/group order and group state while visually hiding labels and badges.
3. **Right**: ProjectDropdown followed by the Settings gear.

The mobile drawer is a labelled modal. It traps and redirects focus, closes on Escape or backdrop, restores focus to its trigger for user-initiated closes, and locks body scroll while mounted. Route and desktop-breakpoint closes do not restore focus to the hidden mobile trigger. The top bar and main content use `data-nav-background` and become inert with `aria-hidden="true"` while the drawer is open; their exact prior states are restored on close.

Collapsed navigation groups retain their height/opacity transition but add `inert` and `aria-hidden` immediately, so hidden links never remain keyboard or screen-reader reachable. Rail, group, chevron, and drawer transitions use `motion-reduce:transition-none` and the reduced-motion CSS fallback.

### Edge-drawer motion contract

The dependency-free `EdgeDrawer` primitive is the canonical presence and motion
mechanism for these actual edge overlays: main mobile Navigation, DocsShell's
mobile/tablet page-tree and details drawers, ChatShell's mobile session drawer,
MCPDrawer, and ActivityDrawer. It does **not** cover desktop Docs/Chat/Mail
inline rails, centered modals, dropdowns, disclosures, or the Settings overlay.

- **Timing:** entry and exit use `240ms` with the decelerating
  `cubic-bezier(0.22, 1, 0.36, 1)` easing.
- **Motion:** only the panel's `transform` transitions, using
  `translate3d`; the backdrop transitions `opacity` with the same timing.
- **Presence:** close changes the panel to its off-screen state and retains it
  until its `transform` `transitionend`; reopening during exit reverses the
  same mounted instance. No fixed exit delay is used.
- **Reduced motion:** `prefers-reduced-motion: reduce` disables transitions and
  deterministically mounts open drawers or unmounts closed drawers immediately.
- **Accessibility:** open drawers retain their existing surface dimensions,
  z-index, scrolling, focus, Escape, backdrop, and route behavior. A drawer
  retained only for exit is `aria-hidden` and `inert`, so its controls cannot be
  reached while it is visually closing.
- **Desktop rail:** the main Navigation rail reserves layout width and
  transitions `224px` ↔ `56px` as a flex item. Labels, badges, gaps, and the
  content offset follow the width transition; the rail itself is never
  transformed. Prepaint persistence still sets the compact root attribute
  before hydration.

### Removed from Nav

- **Theme toggle** — Removed from the nav bar. Dark/light mode switching is now in Settings → General tab only.

## ProjectDropdown — Icon-Based Dropdown Pattern

The `ProjectDropdown` component (`components/ProjectDropdown.tsx`) is the canonical pattern for icon-based dropdowns in the nav bar. Its behavior is supplied by the shared `app/components/Dropdown.tsx` menu primitive.

### Anatomy

| Element | Implementation | Notes |
|---------|---------------|-------|
| Trigger button | Folder SVG icon + chevron SVG | 20x20 folder icon, 12x12 chevron |
| Active hover | `hover:bg-[var(--color-surface-hover)]` | Only when not disabled |
| `/chat` trigger | Folder SVG icon + bounded text + chevron | Desktop shows `Context project: {validatedName}`; mobile hides only the descriptive prefix, keeps the validated name visible when it fits, and preserves the full context label in `aria-label` |
| Disabled state | `opacity-50 cursor-not-allowed` | On `/mail` and `/opencode` pages |
| Title tooltip | Shows `Active project: {name}`, `Context project: {name}`, or disabled message | Dynamic per state |
| Dropdown panel | `absolute right-0 top-full mt-1 w-64` | `z-50`, `shadow-xl`, `rounded-md` |
| Dropdown item | `w-full text-left px-3 py-2 text-sm hover:bg-[var(--color-surface-hover)]` | Active item gets `font-semibold` + checkmark |

### Key Patterns

1. **Suspense wrapper in layout.tsx**: The component is wrapped in `<Suspense fallback={null}>` to avoid blocking nav bar render while `ProjectContext` resolves:
   ```tsx
   <Suspense fallback={null}><ProjectDropdown /></Suspense>
   ```
2. **Outside-click close**: The shared `Dropdown` layer closes on outside pointer down and Escape, and returns focus to the trigger.
3. **Page-aware state**: Reads `usePathname()` and disables the dropdown when `pathname` starts with `/mail` or `/opencode` — `/chat` remains switchable so its explicit Context project follows the validated active project.
4. **Lazy data fetch**: Projects list is fetched only from the open handler, avoiding an initial API call on every page load and retrying cleanly after a failed open.

### Usage Rules

- Any new icon-based dropdown added to the nav bar MUST follow this pattern (Suspense wrapper, shared `Dropdown`, outside-click close, disabled state where applicable).
- Never use a select element or persistent picker for project switching — the icon-dropdown is the standard.
- The dropdown panel MUST use `z-50` to overlay the nav bar and `shadow-xl` for visual separation.

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
| Container Height | `h-[85vh]` fixed (not `max-h`) — prevents modal from resizing; tabs scroll internally via `overflow-y-auto` on the content panel |
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
| Select | Shared `Select` component with mandated border + padding + rounded + hover treatment |
| Number input | `border border-[var(--color-border)] rounded px-3 py-1.5 text-sm bg-[var(--color-surface)]` |
| Text input | Same as number input |
| Password input | Same as text input + show/hide toggle button |

### Tab Panels
- **GeneralPanel**: Theme + Archive retention
- **MailPanel**: OAuth credentials + sync intervals + window sizes
- **PipelinePanel**: LLM provider catalog management (repeatable blocks, model lists, primary/backup roles)
- **ConfigPanel**: Link to /config editor
- **Route-linked panels**: Projects → `/projects`, Skills → `/skills`, Tasks → `/tasks`, Jobs → `/jobs`, Plugins → `/plugins`, Agents → `/agents`, MCP → `/mcp-servers`, Observations → `/observations`, Personality → `/personality`, and Logs → `/logs`
- Route-linked panels use `RouteLinkedPanel`: a concise category description plus an **Open {label} workspace** link. They intentionally reuse the dedicated route's data loading, authorization, mutation flows, and responsive UI rather than rendering placeholder content in the overlay.

### Personality Workspace
- The header uses separate **Established** and **Emerging** counts; established means confidence `≥ 0.30`.
- Active sub-threshold traits use the warning surface and border tokens in an **Emerging traits — awaiting confirmation** card.
- Each emerging trait shows an `Emerging · N% confidence` badge and confidence bar. The card remains present in both grouped and newest sort modes.
- Dismiss controls are available on every trait row and remove the row from the active view immediately.

### PipelinePanel — Draft Lifecycle & Native Provider Cards

The PipelinePanel manages both **custom (managed) providers** and **native OpenCode provider integrations** in a single scrollable panel.

#### Native Provider Cards

Two sub-sections appear above the custom provider list:

1. **Connected providers** — A list of already-connected native providers, each rendered as a horizontal card: name + model count (left), Disconnect button (right). Shows "No native providers connected." dashed-border empty state when none are connected.
2. **Native providers** — A `md:grid-cols-2` grid of cards for popular providers (OpenCode, OpenAI, Anthropic, GitHub Copilot, DeepSeek). Each card shows provider name, model count, and either a "Connected" green badge or a "Connect" button. Clicking Connect opens a modal dialog.

#### Connect Dialog (Modal)

A `fixed inset-0 z-[80]` modal with `bg-black/60` backdrop and `max-w-lg rounded-xl` card:

| Element | Styling |
|---------|---------|
| Header | Provider name + "Models will be loaded automatically from OpenCode." subtitle |
| Login method | Shared `Select` with standard select classes (only shown when multiple methods exist) |
| Prompt fields | Dynamic form fields per integration method prompts (text inputs or shared `Select` controls) |
| API key field | Key-based connections: password input with standard input classes |
| OAuth buttons | "Continue in browser" opens OAuth URL in new tab; auto-mode shows "Waiting for authorization..."; code-mode shows Authorization code input + "Complete connection" |
| Cancel | `×` button in header, calls `closeConnect()` which cancels pending attempts |

#### Synthesis Provider Selectors

Two separate dropdown selectors below the custom provider list, labeled **Primary** and **Secondary**, rendered in a `md:grid-cols-2` grid:

| Property | Styling |
|----------|---------|
| Container | `mt-3 grid gap-4 md:grid-cols-2` |
| Select elements | Standard select classes (`border border-[var(--color-border)] rounded bg-[var(--color-surface)] px-3 py-2 text-sm hover:bg-[var(--color-surface-hover)] cursor-pointer`) |
| Option filter | Primary options include all enabled providers; Secondary excludes the selected Primary (`provider.id !== primaryProviderId`) |
| Mutual exclusion | Selecting a provider as Primary removes it from Secondary options; selecting a provider as Secondary while already Primary sets Primary to empty |

#### Draft Lifecycle & State Management

The PipelinePanel manages a local `providers` state array of `DraftProvider` objects (a `ManagedProviderConfig` extended with a `_draftId` field for stable React keys). All edits (add, remove, reorder, collapse, field edits) are applied to this local state only.

| Aspect | Behavior |
|--------|----------|
| **Save** | Clicking "Save providers" strips `_draftId` from each provider via destructuring and calls `api.settings.saveProviderConfigs()`. On success, it re-fetches the saved config from the API to replace local state. |
| **Discard on close** | Closing the overlay unmounts all tab panels — local state is lost. Unsaved provider edits are discarded. |
| **Survive tab switch** | Tab panels are rendered in a loop with `hidden` + `inert` attributes on inactive tabs (not unmounted). React state persists across tab switches within the same overlay session. |
| **Collapse/expand** | Each provider block has a collapse toggle (▸/▾) tracked in a `collapsed` React state map keyed by `draftKey(provider)`. Collapsed blocks hide their fields. |
| **API key visibility** | A separate `visibleKeys` state map toggles show/hide for each provider's API key field. |
| **Empty state** | When no providers exist, a dashed-border placeholder card reads "No providers configured. Add your first provider." Clicking it adds one. |

**Stable React keys for editable ID fields**: The `draftKey()` function uses `_draftId` (generated via `crypto.randomUUID()`) instead of the provider's `id` field so that editing the user-facing ID does not trigger a React key change (which would destroy and recreate the DOM element and its focus state).

**Provider block borders**:
| Role | Border color |
|------|-------------|
| Primary | `border-blue-500/70` |
| Backup | `border-amber-500/70` |
| Available | `border-[var(--color-border)]` |

### Adding a New Settings Tab
1. Add an entry to `ALL_TABS` in `tabs.ts`
2. Add a pathname mapping in `tabForPathname()` if routing-based auto-select is desired
3. Create a panel component following the `SettingRow` pattern
4. Wire it into `TAB_PANELS` in `SettingsOverlay.tsx`

## Canonical Markdown Renderer — MarkdownDocument

> 🔴 **Hard rule**: Document and skill previews must use `MarkdownDocument` from `components/MarkdownDocument.tsx`. Chat messages use that module's `renderMarkdown` helper directly so they can retain chat-specific classes. Never duplicate `marked`/`DOMPurify` calls.

The shared Markdown renderer is the source of truth for rendering Markdown in the dashboard. It uses:

- **`marked`** with `gfm: true` for GFM (tables, strikethrough, task lists)
- **`DOMPurify`** for sanitization (allowed tags and attributes explicitly configured)
- **`prose prose-sm max-w-none dark:prose-invert`** for typography — dark mode is handled automatically by the prose-invert variant
- Custom pre-processing for `[[page-slug]]` internal links and `> **Note:**` callout blocks

### Consumers

| Component | Mode | Notes |
|-----------|------|-------|
| `DocsEditor` | View & Split | Replaced inline renderMarkdown |
| `MarkdownViewer` | Preview | Replaced custom regex-based parser |
| `ChatMarkdown` | Inline chat messages | Uses `renderMarkdown` with `chat-markdown text-sm` classes |
| Proposal comparison | N/A | Intentional exception — raw `<pre>` blocks, no Markdown rendering |

### Dark Mode

Dark-mode typography is handled entirely by Tailwind's `dark:prose-invert` class. No custom CSS variables or theme tokens are needed for Markdown body text. The component uses `text-[var(--color-text-primary)]` as a fallback for any non-prose elements.

### Adding a New Document Consumer

1. Import `MarkdownDocument` from `@/app/components/MarkdownDocument`
2. Pass `content` (raw Markdown string) and optional `className`
3. Do NOT add wrapping `bg`, `border`, or `shadow` containers — the prose styling is self-contained
4. If the consumer needs custom wrapper classes, import `renderMarkdown` from the same module and keep the sanitizer centralized

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
6. **Page max-width is `max-w-6xl`**. No full-width layouts beyond navigation. Exception: `/chat` uses a full-bleed layout.
7. **Every card on every page must have `hover:shadow-md transition-shadow`**. This includes settings cards, MCP server rows, MCP category cards, observations, pipeline events, and any other card-based element. If a new page adds cards, they MUST follow this rule.
8. **Always use explicit border colors for critical borders**. Never use bare `border`/`border-t`/`divide-y` without an explicit border-color utility for visually important separators. The global default covers minor borders.
9. **Must pair every `ring-offset-{n}` with `ring-offset-[var(--color-surface)]`**. Tailwind's default `--tw-ring-offset-color` is `#fff`, which creates a white halo in dark mode. This was fixed on the logs and pipeline pages and must be followed for any new `ring-offset` usage.
10. **Icon-based dropdowns must follow the ProjectDropdown pattern**: folder icon button + chevron, `opacity-50 cursor-not-allowed` disabled state, `Suspense` wrapper in layout.tsx, shared `Dropdown` outside-click/Escape behavior, and an absolute panel with `z-50` and `shadow-xl`.

11. **Chat agent-output plain flow**: On `/chat`, assistant prose, provider reasoning, stream activity/errors, generated file/image/download renderers, Chat-only Markdown callouts, tool traces, and agent permission/question output must not use cards, borders, rounded containers, or background bubbles. A muted inline dot/text is allowed before provider reasoning arrives and is replaced immediately by live reasoning. User-message bubbles retain `rounded-2xl` plus `bg-[var(--color-surface-selected)]`; Docs Markdown callouts retain their documented styling.

### Chat Workspace (`/chat`)

- Message, error, prompt, and activity content is centered in one full-width `48rem` rail (`mx-auto w-full max-w-3xl space-y-6`) inside the existing padded scroll container. The message scroller and the full-width composer/fallback outer regions share native `[scrollbar-gutter:stable]` reservation so their centerlines stay aligned with classic scrollbars; the rail remains full-width within mobile padding.
- The composer keeps project context off by default. Its compact `Context project: {validatedName}` action sits beside Attach, uses token-based hover/selected states, exposes `aria-pressed`, hides only the descriptive prefix on mobile, and keeps the selected project visible with a bounded truncation label plus a full accessible name. It resets only after an accepted send or session remount and remains available after a failed request.
- Provider, model, variant, and agent controls remain native labeled selects rendered through the shared `Select` component. Pass compact `className`/`wrapperClassName` values to preserve the toolbar geometry; `Select` owns the 12px decorative chevron and native keyboard/mobile behavior.
- On mobile, the session sidebar becomes an overlay drawer and the provider/model/variant/agent selectors remain in a horizontally scrollable compact row; the message rail and composer stay full-width within mobile padding without document or composer overflow.

12. **Standard Overlay Size is `w-11/12 max-w-7xl max-h-[90vh]`** — the `Overlay` component default (when `fullScreen` is not set) is `mt-8 mb-8 w-11/12 max-w-7xl max-h-[90vh]`. This is the canonical size for all overlay panels (skill detail, service detail, pipeline events, logs detail). The `fullScreen` prop (`w-[calc(100%-32px)] h-[calc(100%-32px)]`) is no longer used by any page — the Settings overlay was the last consumer and now also uses the constrained default. Any new overlay MUST NOT set `fullScreen={true}`; use the constrained default. Size customization (e.g., `max-w-2xl` for narrow diagnostic overlays like `ServiceOverlay.tsx` line 240) is acceptable when the overlay is used standalone outside the shared `Overlay` component.

> 💡 **Worked example — INFO-badge color fix**: An info-level badge in the logs page used `border-blue-200` (light-mode only, invisible in dark mode). The fix was to define `--color-info-border` tokens in `globals.css` (light: `#bfdbfe`, dark: `#1e40af66`) and replace the hardcoded class with `border-[var(--color-info-border)]`. This is the same pattern as Rule #9's ring-offset fix — any hardcoded Tailwind color class (`border-blue-200`, `ring-offset-white`, `text-gray-100`, etc.) must be replaced with a CSS custom property token that has both light and dark values. See `services/ingenium-dashboard/src/app/logs/page.tsx` line 42 for the fix and `globals.css` lines 43/90 for the token definitions.

### Tailwind v4 Border Color Default
Tailwind v4 uses `currentColor` as the default border color (not gray-200 as in v3). 
The `globals.css` @layer base rule sets `*, ::before, ::after { border-color: var(--color-border); }` 
so bare `border`/`border-t`/`divide-y` resolve to dark gray in dark mode.
Always use explicit border colors (`border-[var(--color-border)]`) for critical borders rather than 
relying on the global default. Never use hardcoded `border-gray-200` — it won't adapt.

---

## Card Variants — All Use `hover:shadow-md transition-shadow`

All cards below universally include `hover:shadow-md transition-shadow` (Rule #7). The only variation is padding and border radius.

### Homepage Dashboard Cards (Operational)

Data-driven operational cards used on the homepage (`page.tsx`). These display live metrics from the `/api/v1/dashboard/summary` endpoint in a 2×2 grid.

#### Grid Layout

```html
<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
  <!-- AttentionQueue + ResumeWork -->
</div>
```

Desktop: 2-column grid. Mobile: single-column stack with full-width cards.

The homepage composes `QuickActions`, `AttentionQueue`, `ResumeWork`,
`ActivityTimeline`, and `HealthStrip` directly; there is no shared
card wrapper. Each section owns its loading, empty, unavailable, and
error presentation.

#### Section Structure

| Property | Value | Tailwind |
|----------|-------|----------|
| Background | Surface token | `bg-[var(--color-surface)]` |
| Border | 1px border token | `border border-[var(--color-border)]` |
| Border Radius | 12px | `rounded-xl` |
| Padding | 24px | `p-6` |
| Hover Effect | Light shadow (REQUIRED) | `hover:shadow-md` |
| Transition | 150ms (REQUIRED) | `transition-shadow` |
| Header | Title (left) + optional badge (right) | `flex items-center justify-between mb-4` |
| CTA Link | Bottom separator + text link | `mt-4 pt-3 border-t border-[var(--color-border-muted)]` with `text-sm text-[var(--color-text-link)] hover:underline font-medium` |

The homepage sections share the surface, border, radius, padding, and hover
tokens above, but each component owns its own loading and unavailable states.

#### Design Rules

1. **No emoji** — Use text labels only. No emoji in card titles, badges, or CTAs.
2. **CSS tokens only** — All backgrounds, text, and borders use `var(--color-*)` tokens. The only exceptions are badge/pill colors (which use `badgeTones` from `lib/badgeTones.ts`) and the page-level error panel.
3. **Asymmetric grid** — Attention and Resume are paired on desktop; timeline and health span the page below. Visual hierarchy comes from content density, badge treatments, and metric prominence.
4. **Auto-refresh** — Optional 60-second polling with a pause/resume button in the page header (`text-xs px-3 py-1.5 rounded border`). Paused state shows "Auto-refresh paused" with hover background; active state shows "Auto-refresh on".
5. **Single fetch** — The homepage calls `api.home.summary(project)` once. All sections derive their data from the single response.

#### Loading Skeleton: `DashboardSkeleton` (`components/DashboardSkeleton.tsx`)

Renders the homepage loading placeholders in the same responsive layout. Each placeholder uses `animate-pulse` with `bg-[var(--color-surface-muted)] rounded` bars and `data-testid="dashboard-skeleton-card"` for Playwright targeting.

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

### Canonical native select

`app/components/Select.tsx` is the canonical wrapper for every static native
select in the dashboard. The 52 static consumers must import and render
`Select`; consumer files must not contain raw `<select>` elements. `Select`
provides the theme-aware surface, border, focus state, disabled state, and
decorative chevron while forwarding native form props, option values, refs,
keyboard events, and change handlers unchanged.

| Property | Value | Tailwind |
|----------|-------|----------|
| Frame | 1px border, surface background, rounded | `border border-[var(--color-border)] bg-[var(--color-surface)] rounded` |
| Padding | 8px horizontal, 6px vertical | `px-3 py-1.5` or `p-2` |
| Text | 14px | `text-sm` |
| Hover Background | Surface hover tone | `hover:bg-[var(--color-surface-hover)]` |
| Cursor | Pointer | `cursor-pointer` |

Use `className` for the native control's size and visual overrides and
`wrapperClassName` for width, shrink, overflow, or compact-toolbar geometry.
Visible labels use `htmlFor`/`id`; compact toolbar controls use a precise
`aria-label`. Keep the exact option values, ordering, `name`, `required`,
`disabled`, and `onChange` casts from the owning form.

> 🔴 **Rule**: Do not add a local chevron or a second raw native select. The
> only raw `<select>` is the implementation inside `Select.tsx`.

### Menus and comboboxes are different controls

`Select` is for a finite native option list. It is not the shared pattern for
custom action menus or searchable comboboxes:

- **Action menus** use a button trigger and a positioned menu of actions. They
  may contain destructive actions, icons, separators, and menu-specific
  keyboard/focus behavior; do not replace them with `Select`.
- **Comboboxes** use an editable/search input plus a filtered listbox and
  explicit option selection. Use the combobox pattern when users need search,
  free text, async results, or rich option rows; do not force those behaviors
  into a native `Select`.
- Project switching and other icon-triggered navigation remain menus, not
  selects or persistent pickers.

### Shared menu and combobox primitives

The dashboard uses two small reusable families rather than one generic picker:

- `app/components/Dropdown.tsx` provides `Dropdown`, `DropdownTrigger`,
  `DropdownPanel`, and `DropdownItem` for action/navigation menus. Triggers
  expose a stable `aria-label`, `aria-haspopup="menu"`, `aria-expanded`, and
  `aria-controls`; panels use `role="menu"` and actions use `role="menuitem"`.
  Arrow Up/Down, Home/End, printable-key typeahead, Escape, outside-pointer
  dismissal, and trigger focus restoration are shared behavior. Menu panels use
  the compact token surface, 1px border, `rounded-md`, `shadow-xl`, an 8px
  minimum item height, and visible focus rings. Disabled actions remain in the
  menu with `aria-disabled`, reduced opacity, and a not-allowed cursor.
- `app/components/Combobox.tsx` provides `useListboxNavigation`, `Listbox`,
  and `ListboxOption` for editable and async searches. Editable inputs expose
  `role="combobox"`, `aria-autocomplete="list"`, stable `aria-controls`, and
  `aria-activedescendant`; textareas that retain normal editing semantics use
  `role="textbox"` with the same listbox relationship. Results use
  `role="listbox"` and `role="option"`, with active/selected token states.
  Arrow Up/Down, Home/End, Enter, Escape, async loading, empty, and error
  states are rendered by the owning control. Search panels are bounded by the
  viewport (`max-w-[calc(100vw-1rem)]`, scrollable result rows) and truncate
  long labels instead of overflowing on mobile.

Native **Select**, custom action **Menu**, and searchable **Combobox** are
deliberately distinct: keep finite non-search form fields on `Select`, use a
`Dropdown` menu for commands or navigation, and use the combobox/listbox
family for filtering, async search, autocomplete, and rich result rows.

**Pages with native selects:** Tasks, MCP, Observations, Personality, Skills,
Agents, Settings, Mail, Chat, Docs, Jobs, and Usage.

### Jobs workspace queue views

`/jobs` keeps Jobs, Event queue, and Trusted events in one accessible tablist.
Queue and audit filters use the shared `Select`, desktop results remain semantic
tables inside focusable `overflow-x-auto` regions, and the corresponding mobile
views use `md:hidden` token-based cards. Keep action rows `flex-wrap` so Run,
Edit, and Delete do not clip at 390px. Trusted-event cards and tables render
metadata only; they never render event payloads, lease ownership, or process data.

Job vault references use native labelled checkboxes in the edit overlay (never
a password/reveal control). The metadata picker is capped at 16 entries and is
disabled while the vault is sealed or unavailable, while existing reference
checkboxes remain available for explicit removal. Reference changes open a
token-surface confirmation view with stacked `sm:grid-cols-3` authorize,
refresh, and revoke summaries; names are shown only while unsealed. Detail and
audit cards use wrapping IDs, text-labelled status badges, bounded “Load more”,
and `hover:shadow-md transition-shadow`; at 390px they remain one-column with
no document overflow.

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
| EmailList | List items with borders; resizable via drag handle | Rows: `px-4 py-3 border-b border-gray-200 hover:bg-gray-50`. Unread: `font-semibold text-gray-900`. Read: `text-gray-600`. Selected: `bg-blue-50`. **Resizable**: default 350px, min 240px, max 720px; drag handle (2px, `cursor-col-resize`, `hover:bg-blue-200`/`active:bg-blue-400`); keyboard ArrowLeft/ArrowRight; **touch support** via pointer events (`touch-action: none` on handle); width persisted in `localStorage` key `mail-list-width`. |
| EmailComposer | Bare form fields inside Overlay; contains SmartSuggest reply cards when replying | `space-y-4 max-w-2xl mx-auto`. Send: `bg-blue-600 text-white py-2 px-4 rounded`. Draft: `text-gray-600 hover:text-gray-900`. **Smart reply props**: `emailUid`, `accountId`, `folder` passed from EmailReader — when present, renders collapsible cards between body textarea and Review with AI button. |
| EmailReader | Headers panel + action bar; side-by-side reply layout at xl+ | Headers: `bg-gray-50 border-b border-gray-200 px-4 py-3`. Actions: `px-3 py-1.5 text-sm border border-gray-200 rounded text-gray-600 hover:bg-gray-100`. Delete: `text-red-600 hover:bg-red-50`. On widescreen (xl+), clicking Reply opens the composer alongside the email body in a side-by-side layout. On smaller screens the reply panel stacks below the email body. |
| AccountSetup | Provider grid + form | Provider cards: list item pattern `p-4 rounded border hover:shadow-md`. Form: stacked card `p-6 rounded-lg border space-y-4`. |

### Overlay Container Pattern — Content Wrapper Delegation

The `Overlay` component (used for compose, detail views, and modals) provides the white panel container with `bg-white rounded-lg shadow-2xl` plus a header (title/close) and scrollable body area (`px-6 py-4`). **Content components rendered inside Overlay must not duplicate the container styling.**

| Component | Outer container provided by | Content component provides |
|-----------|---------------------------|---------------------------|
| EmailComposer inside Overlay | Overlay: `bg-white rounded-lg shadow-2xl` + body `px-6 py-4` | Bare form fields: `space-y-4 max-w-2xl mx-auto` |

> 🔴 **Rule**: Any component rendered as a child of `Overlay` MUST NOT include `bg-white`, `rounded`, `border`, or `shadow` on its outermost wrapper. The Overlay provides these. The child component should only provide layout and spacing classes for its internal content (e.g., `space-y-4`, `max-w-2xl mx-auto`). This keeps the overlay container consistent and avoids nested whites or double-rounded corners.

### Inline-Embedded-Compose Pattern

The email page (`/mail`) supports two composing contexts, each with a different layout strategy:

| Context | Where | Pattern | Component Prop |
|---------|-------|---------|---------------|
| Reply / Draft (context-anchored) | Inside `EmailReader.tsx` pane, below the email body | **Inline-in-pane**: Compact `EmailComposer` with `inline={true}`. Renders in a `border-t` container at the bottom of the reader, no overlay, no backdrop. Uses compact layout (single-line labels like "From"/"To"/"Subj", smaller textarea at `min-h-[150px]`, tighter button spacing). Includes SmartSuggest cards between textarea and Review button. | `inline` |
| Compose New / Forward (context-free) | Full-screen `Overlay` from `page.tsx` | **Modal-overlay**: Standard `EmailComposer` (no `inline` prop, or `inline={false}`) inside the shared `Overlay` component. Renders as a modal with `bg-white rounded-lg shadow-2xl`, full label-column layout, `min-h-[300px]` textarea. The Overlay provides the container shell — the composer provides `space-y-4 max-w-2xl mx-auto` only. | _omitted_ or `inline={false}` |

**When to use inline vs modal:**
- **Use inline** when the compose action is anchored to a specific email context (Reply, Draft, Forward-as-reply) and should remain visually attached to that email. The composer appears at the bottom of the reader pane with `border-t` separating it from the email body.
- **Use modal** when the compose action creates a new message independent of the current context (Compose New, standalone Forward). The composer opens in a centered overlay with backdrop.

**Smart Suggestions integration:** When EmailComposer receives `emailUid`, `accountId`, and `folder` props (passed from EmailReader for reply/draft contexts), it renders SmartSuggest cards between the body textarea and the Review with AI button. The SmartSuggest component auto-fetches suggestions on mount (when `mode="auto"`, the default for inline replies). Suggestions render as collapsible cards — clicking a card fills the composer body and subject immediately:

```html
<!-- Collapsible reply cards inside EmailComposer -->
<div class="space-y-2 px-3 pb-3">
  <div class="border border-[var(--color-border)] rounded p-3">
    <span class="text-xs font-medium">concise</span>
    <p class="text-xs">Thanks for the update, I'll review…</p>
  </div>
  <!-- ... copy and apply controls per card -->
</div>
```

### Smart Replies Collapse/Expand

The Smart Replies heading acts as a collapse toggle. The chevron icon rotates on expand/collapse. Cards are hidden via conditional rendering when collapsed.

### Dual Resize Handles

Resize handles use `w-2 cursor-col-resize hover:bg-blue-200 active:bg-blue-400 transition-colors shrink-0`. Active state adds `bg-blue-400`. Both handles have `role='separator'` with appropriate `aria-*` attributes. Widths persist to `localStorage` under `mail-list-width` and `mail-reply-width` keys.

**Reference implementation:**
- `services/ingenium-dashboard/src/app/mail/components/SmartSuggest.tsx` (module-level `CardsVariant`)
- `services/ingenium-dashboard/src/app/mail/components/EmailComposer.tsx` lines 192–205 (renders `<SmartSuggest>` when `emailUid` and `accountId` are present)
- `services/ingenium-dashboard/src/app/mail/components/EmailReader.tsx` lines 393–417 (passes `emailUid`/`accountId`/`folder` to inline composer)
- `services/ingenium-dashboard/src/app/mail/page.tsx` lines 579–597 (modal usage)

```html
<!-- Inline — compact, in-pane with smart suggestions -->
<div class="border-t border-[var(--color-border)] px-4 py-3">
  <EmailComposer inline emailUid={email.uid} accountId={accountId} folder={email.folder} ... />
</div>

<!-- Modal — full overlay -->
<Overlay isOpen={showCompose} onClose={...} title="Compose">
  <EmailComposer ... />
</Overlay>
```

> 🔴 **Rule**: When using the inline variant, never wrap `EmailComposer` in an `Overlay`. The inline variant is self-contained and renders inside its parent pane using `border-t` for visual separation. Wrapping it in an Overlay defeats the purpose — it would add a backdrop and modal positioning that conflict with the context-anchored intent.

> 🔴 **SmartSuggest auto-fetch**: When the composer mounts with `emailUid`/`accountId`, SmartSuggest auto-fetches suggestions (unless mode=`manual`). The fetch URL uses `encodeURIComponent(folder)` — the folder value is passed exactly as received from `email.folder` without defaulting to `"INBOX"`. This ensures per-folder cache keys work correctly for Sent, Starred, Archive, etc.

### Module-Level Component Pattern (CardsVariant)

The `SmartSuggest.tsx` component extracts a `CardsVariant` component at **module scope** (outside the main component) so its React state (collapse/expand) persists across parent re-renders of the same email (e.g., during fetch completion, retry timers, and draft changes).

```tsx
// 🔴 key={emailUid} ensures the module-level CardsVariant remounts when switching emails
return <CardsVariant key={emailUid} ... />
```

This is the canonical pattern for any child component that must maintain internal state (like collapse/expand) across parent re-renders without unmounting. The `key={emailUid}` ensures the component unmounts when switching to a different logical unit (e.g., a different email), but survives within-email re-renders.

### Email List Row — Two-Line Layout Pattern

The email list renders each row as a **three-line layout** by default:
1. **First line** — Sender name (left, `truncate flex-1`) + Timestamp (right, `shrink-0`)
2. **Second line** — Subject (`block truncate`)
3. **Third line** — Body snippet (`truncate mt-0.5`, 120 char max)

At narrow pane widths (below ~300px), the body snippet line is visually clipped and effectively becomes a **two-line layout** (sender+timestamp and subject only). The EmailList pane has a min-width of 240px.

| Element | Tailwind |
|---------|----------|
| Row container | `px-4 py-3 border-b border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] cursor-pointer` |
| Selected row | `bg-[var(--color-surface-selected)]` |
| Sender (unread) | `font-semibold text-[var(--color-text-primary)] truncate` |
| Sender (read) | `text-[var(--color-text-secondary)] truncate` |
| Timestamp | `shrink-0 text-xs text-[var(--color-text-muted)]` |
| Subject (unread) | `font-medium text-[var(--color-text-primary)] truncate` |
| Subject (read) | `text-[var(--color-text-secondary)] truncate` |
| Body snippet | `text-sm text-[var(--color-text-muted)] truncate mt-0.5` |

## Secrets Page (`/secrets`)

The Secrets page implements a vault-based password manager with five distinct states.

### Page-Level States

| State | When | Display |
|-------|------|---------|
| **Loading** | Checking vault status via `GET /api/v1/vault/status` | Title + "Checking vault status..." text |
| **First-run (sealed + not initialized)** | `sealed === true && initialized === false` | "Create Your Vault" CTA card + `CreateVaultModal` |
| **Sealed (initialized)** | `sealed === true && initialized === true` | "Unseal Vault" CTA card + `UnsealModal` |
| **Error (non-sealed)** | `error && !sealed` | Error panel + "Retry" button |
| **Unsealed** | `sealed === false` | 3-pane layout: FolderTree \| ItemList \| ItemDetail |

### CreateVaultModal — Validation States

The CreateVaultModal (`components/CreateVaultModal.tsx`) is a passphrase creation dialog shown on first run. It has four validation dimensions and a checkbox gate:

| State | Visual Indicator | Derivation |
|-------|-----------------|------------|
| **Empty** | Both fields empty, placeholder text shown ("At least 12 characters") | `passphrase.length === 0 && confirmation.length === 0` |
| **Too short** | Passphrase field shows red `(n/12)` counter below input. `aria-invalid` set on input. | Unicode passphrase length is below 12 |
| **Mismatch** | Confirmation shows red "Passphrases do not match" text. `aria-invalid` set on confirmation input. | `passphrase.length > 0 && confirmation.length > 0 && passphrase !== confirmation` |
| **Match** | Green checkmark SVG + "Passphrases match" text | `passphrase.length > 0 && confirmation.length > 0 && passphrase === confirmation && passphrase.length >= 12` |
| **Length OK** | Hint text turns green | At least 12 Unicode characters and not whitespace-only |
| **Rate limited** | Error alert shows the server `Retry-After` countdown and submit action is disabled. No automatic retry occurs. | Initialization or unseal receives HTTP 429 |

**Form gating logic**:
```typescript
const passwordsMatch = passphrase === confirmation && hasNonWhitespaceContent && passphraseLength >= 12;
const canSubmit = acknowledged && passwordsMatch && !loading && !isCoolingDown;
```

The submit button is disabled until all three conditions are met: acknowledgement checkbox checked, passwords match and valid length, and not currently saving.

### CreateVaultModal Layout

| Element | Styling |
|---------|---------|
| Backdrop | `fixed inset-0 bg-black/50 z-50 flex items-center justify-center` |
| Dialog card | `bg-[var(--color-surface)] p-6 rounded-lg shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto` |
| Lock icon | `w-10 h-10 text-blue-500` centered above title |
| Warning banner | `bg-amber-50 border border-amber-200 p-3 rounded text-sm text-amber-800` with "No recovery key exists" message |
| Passphrase input | `w-full border border-[var(--color-border)] rounded px-3 py-2 pr-10 text-sm` with show/hide toggle button |
| Confirmation input | Same as passphrase input, with match/mismatch hint |
| Checkbox | Standard `<input type="checkbox">` with label "I understand there is no passphrase recovery" |
| Actions | Cancel (ghost) + "Create & Unseal Vault" (blue primary, `disabled:opacity-50`) |

### UnsealModal Layout

Simpler than CreateVaultModal — single passphrase field, no confirmation, no checkbox.

| Element | Styling |
|---------|---------|
| Dialog card | `bg-[var(--color-surface)] p-6 rounded-lg shadow-xl w-96` |
| Passphrase input | Same styling as CreateVaultModal |
| Actions | Cancel (ghost) + "Unseal Vault" (blue primary, `disabled:opacity-50` until non-empty or a `Retry-After` cooldown expires) |

### 3-Pane Unsealed Layout

| Pane | Width | Background | Content |
|------|-------|------------|---------|
| FolderTree | `w-56` | `bg-[var(--color-surface-muted)]` with `border-r` | Collapsible folder tree |
| ItemList | `w-72` | surface with `border-r` | Filtered item list, "New item" button |
| ItemDetail | `flex-1` | surface | Selected item details (CRUD) |

The container uses `h-[calc(100dvh-160px)]` for full-viewport height with a `rounded` border and `overflow-hidden`. The Lock Vault button sits in the page header alongside the page title.

### `startX`/`startWidth` Ref-Based Resize Pattern

Resizable panels (EmailList pane, reply composer) use a `useRef<{ startX: number; startWidth: number }>` pattern for pointer-driven resize:

```typescript
const listStartRef = useRef<{ startX: number; startWidth: number }>({ startX: 0, startWidth: 0 });

const onPointerDown = useCallback((e: React.PointerEvent) => {
  e.preventDefault();
  handleRef.current?.setPointerCapture(e.pointerId);
  listStartRef.current = { startX: e.clientX, startWidth: listWidth };
  setIsResizing(true);
}, [listWidth]);

const onPointerMove = useCallback((e: React.PointerEvent) => {
  if (!isResizing) return;
  const deltaX = e.clientX - listStartRef.current.startX;
  const newWidth = Math.max(240, Math.min(720, listStartRef.current.startWidth + deltaX));
  setListWidth(newWidth);
}, [isResizing]);
```

**Key rules:**
- Always capture pointer via `setPointerCapture()` on pointer down for reliable drag tracking
- Always clamp width between min and max bounds (`Math.max(min, Math.min(max, ...))`)
- Persist width to `localStorage` on pointer up (not on every move)
- Use `w-2 cursor-col-resize hover:bg-blue-200 active:bg-blue-400 transition-colors shrink-0` on the drag handle
- `role="separator"` with `aria-orientation="vertical"` and `aria-valuenow` for accessibility

## Chat Page (`/chat`)

The Chat page at `/chat` uses a full-bleed layout (`max-w-full`, no `max-w-6xl` constraint). All chat UI components live under `app/chat/components/`.

### Header Selectors — Disabled States

The ChatHeader renders three selectors (Provider, Model, Agent) plus an optional Variant selector. All three main selectors accept a `disabled` prop controlled by `ChatShell.selectorsDisabled`:

```
selectorsDisabled = chatConfigLoading || !!chatConfigError || !hasSelectableModel
```

| State | Visual | Condition |
|-------|--------|-----------|
| **Loading** | `disabled:opacity-40 disabled:cursor-not-allowed` on each shared `Select` | `chatConfigLoading === true` |
| **Error** | Same disabled styling + red error banner | `chatConfigError` is truthy |
| **No providers** | Same disabled styling + blue banner linking to Settings | `hasSelectableModel === false` (availableProviders.length === 0) |
| **Normal** | Standard select styling | Provider and model available |

Disabled selectors all use the base select styling plus:
```html
<Select disabled className="... disabled:opacity-40 disabled:cursor-not-allowed">
```

When `providers.length === 0`, the shared select shows a placeholder option:
```html
<option value="">No providers available</option>
```

The same empty option pattern applies to models and agents when their respective arrays are empty.

### Free Model Badge

Providers with `source === "builtin"` display a `(Free)` badge appended to their label in both desktop and mobile selectors:

```
{p.label}{p.source === "builtin" ? " (Free)" : ""}
```

The `source` field is set by the API's `ChatConfigResponse.providers[].source`. Built-in providers are auto-discovered from the OpenCode Zen free tier and require no API key.

### ChatInput — No-Model Guard

The `ChatInput` component has a `hasSelectableModel` prop. When `false`:
- The send button is disabled (even if text is entered): `disabled={!hasText || !hasSelectableModel}`
- Enter key does not send: `if (!hasSelectableModel) return;`
- The handler `handleSend` returns early: `if (!hasSelectableModel) return;`

The `ChatShell` passes `hasSelectableModel={availableProviders.length > 0}`.

### Assistant Messages — Unboxed (No Card Wrapper)

Assistant messages render **without** a card container — no `bg-white`, no `rounded`, no `border`, no `shadow`. The message text spans the full-width content area with left-aligned text and generous line height:

| Property | Value | Tailwind |
|----------|-------|----------|
| Container | None (unboxed) | No `bg-*`, `rounded`, `border`, or `shadow` |
| Text | 14px, relaxed leading | `text-sm leading-relaxed` |
| Padding | 8px horizontal | `px-2` |
| Color | Primary text token | `text-[var(--color-text-primary)]` |
| Code blocks | Surface-muted background | `bg-[var(--color-surface-muted)]` |

User messages are right-aligned with a blue accent background, distinguishing them from the unboxed assistant messages.

### Chat Action Row

Each assistant message has an action row beneath the text with three controls:

| Element | Style | Notes |
|---------|-------|-------|
| **Copy icon** | `w-4 h-4 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] cursor-pointer` | Copies message content |
| **Retry button** | Icon-only (SVG), same sizing as Copy | No text label — compact |
| **Model attribution** | `text-xs text-[var(--color-text-muted)]` | Right-aligned in the action row, shows model name |

### Dark Mode

Chat uses the same `--color-*` token system as the rest of the dashboard. No special dark-mode classes needed — tokens adapt automatically when `.dark` is applied to `<html>`.

| Variant | When Used | Layout | Key Classes |
|---------|-----------|--------|-------------|
| **Reply cards** | Inside inline EmailComposer (reply/draft) | Collapsible `space-y-2` section with stacked cards | Header chevron, `border rounded p-3` cards, tone badge, subject line, `line-clamp-3` body preview, copy icon, card apply action. States: loading skeletons, error + retry, unconfigured + settings link, noreply info, and suggestion cards. |
