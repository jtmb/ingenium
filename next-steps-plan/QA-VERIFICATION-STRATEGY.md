# QA Verification Strategy — 6-Feature Implementation

**Generated:** 2026-07-15  
**Type:** ARCHITECTURE ANALYSIS — Read-Only  
**Scope:** Nav dropdowns, OpenCode switch/gutter, Dashboard utility, Popout/fullscreen (3 pages), Docs CRUD/tree/search/editor/history/attachments/MCP/agent/voice, Documentation migration  
**Plus:** Responsive/accessibility, multi-window behavior, console/network cleanliness, performance, visual regression

---

## 1. Existing Test Infrastructure Assessment

### 1.1 Playwright E2E Configuration (`tests/playwright.config.ts`)

| Dimension | Current State | Gap |
|-----------|--------------|-----|
| **Test runner** | `@playwright/test` 1.61.1 | ✅ Adequate |
| **Web servers** | API (4097) + Next.js (3000) via `webServer` config | ✅ Covers both tiers |
| **Parallelism** | `fullyParallel: false` (serial only) | 🔴 Blocks scaling — must enable parallel by file |
| **Viewports** | Single: `1280 × 720` | 🔴 No mobile/tablet/ultrawide coverage |
| **Retries** | 1 retry | ⚠️ OK for CI, insufficient for flaky real-IMAP tests |
| **Timeout** | 15s global | ⚠️ Tight for first-load API calls (extraction, synthesis, mail sync) |
| **Screenshots** | `only-on-failure` | 🔴 No **on-pass** screenshots — cannot do visual regression |
| **Traces** | `retain-on-failure` | ✅ Adequate for debugging |
| **Browser** | Default Chromium only | 🔴 Must add Firefox + WebKit for cross-browser |
| **Projects** | Single unnamed project | 🔴 Need named projects for viewport matrix |

### 1.2 Unit Test Infrastructure (`packages/ingenium-core/vitest.config.ts`)

| Dimension | Current State | Gap |
|-----------|--------------|-----|
| **Runner** | Vitest (minimal config) | ✅ Adequate |
| **Coverage** | Not configured | 🔴 Must add `@vitest/coverage-v8` |
| **Test files** | 17 files in `packages/ingenium-core/tests/` | ✅ Good coverage of API/DB layer |
| **No dashboard unit tests** | 0 tests in `services/ingenium-dashboard/` | 🔴 Must add component tests for new docs feature |

### 1.3 Existing Test Coverage by Page (Playwright)

| Page | Spec File | Tests | Mock/Real | Status |
|------|-----------|-------|-----------|--------|
| Home `/` | `homepage.spec.ts` | 7 | Mixed (route intercept for skeleton/error) | ✅ Good |
| Projects `/projects` | `all-pages.spec.ts`, `dashboard.spec.ts` | 3 | Real API | ✅ Good |
| Skills `/skills` | `all-pages.spec.ts`, `integration.spec.ts`, `dashboard.spec.ts` | 5 | Real API | ✅ Good |
| Tasks `/tasks` | `all-pages.spec.ts`, `dashboard.spec.ts` | 5 | Real API | ⚠️ Drag-drop untested |
| Jobs `/jobs` | `jobs.spec.ts` | 2 | Real API | ⚠️ Live log streaming, cron untested |
| Plugins `/plugins` | `all-pages.spec.ts`, `integration.spec.ts`, `dashboard.spec.ts` | 6 | Real API | ✅ Good |
| Mail `/mail` | `mail.spec.ts` (20 tests), `mail-cache-warm.spec.ts`, `mail-html-safety.spec.ts`, `mail-no-resync.spec.ts`, `mail-reclick-loading.spec.ts`, `mail-reply-forward.spec.ts`, `qa-mail-darkmode-screenshots.spec.ts` | ~40+ | **Mocked API** | ⚠️ All mocked — no real IMAP coverage |
| Agents `/agents` | `all-pages.spec.ts` | 2 | Real API | ✅ Basic |
| MCP Servers `/mcp-servers` | `all-pages.spec.ts`, `dashboard.spec.ts` | 3 | Real API | ✅ Basic |
| Config `/config` | `all-pages.spec.ts` | 3 | Real API | ✅ Good |
| Observations `/observations` | `all-pages.spec.ts`, `integration.spec.ts`, `pipeline.spec.ts` | 5 | Real API | ✅ Good |
| Personality `/personality` | `all-pages.spec.ts`, `integration.spec.ts`, `pipeline.spec.ts` | 6 | Real API | ✅ Good |
| Pipeline `/pipeline` | `all-pages.spec.ts`, `pipeline.spec.ts` | 7 | Real API | ✅ Good |
| Logs `/logs` | `integration.spec.ts` | 1 | Real API | ⚠️ Minimal |
| Status `/status` | `opencode.spec.ts` (supervisord check) | 1 | Real API | ⚠️ Only process check |
| Settings overlay | `all-pages.spec.ts` | 6 | Real API | ✅ Good |
| OpenCode `/opencode` | `opencode.spec.ts`, `opencode-switch.spec.ts` | 12 | Real services | ✅ Good |
| MCP Tools API | `mcp-tools.spec.ts` | ~15 | Real API (direct request) | ✅ Good |

### 1.4 Missing Pages (Zero Coverage)

| Page | Why Missing | Priority |
|------|------------|----------|
| **/docs** (new) | Not yet implemented | 🔴 P0 |
| **/archive** | Only smoke-tested in `dashboard.spec.ts` | ⚠️ P2 |
| **/learnings** | Deprecated page — only deprecation notice test | 🔴 P1 |
| **/mail/oauth/callback** | OAuth flow — no test | ⚠️ P2 |
| **/observations/[id]** | Detail route — no test | 🔴 P1 |

---

## 2. Test Environment & Fixture Architecture

### 2.1 Deterministic Fixture Strategy

```
┌──────────────────────────────────────────────────────────────────┐
│                    FIXTURE HIERARCHY                              │
├──────────────────────────────────────────────────────────────────┤
│ Level 0: DB Seed (once per CI run)                               │
│   ├── global-default project (is_global=1)                       │
│   │   ├── 22 observations (all 10 types)                         │
│   │   ├── 14 personality traits (across 6 types)                 │
│   │   ├── 10 agents (enabled)                                    │
│   │   ├── 5 plugins (observer, auto-observer, skill-sync, etc.)  │
│   │   ├── 45 skills (catalog)                                    │
│   │   ├── 20 pipeline events (all event types)                   │
│   │   ├── 8 tasks (2 per kanban column)                          │
│   │   └── 3 jobs (1 enabled, 1 disabled, 1 with recent failure)  │
│   ├── gh-llm-bootstrap project                                   │
│   │   ├── 27 skills                                              │
│   │   ├── 5 agents                                               │
│   │   └── opencode.json config                                   │
│   └── empty-project (for create/delete tests)                    │
│                                                                  │
│ Level 1: API Route Mocks (per-test, per-feature)                 │
│   ├── Mail: mock imapflow responses (no real IMAP)               │
│   ├── Synthesis: mock LLM responses                              │
│   ├── Extraction: mock OpenCode DB reads                         │
│   └── OAuth: mock token exchange                                 │
│                                                                  │
│ Level 2: Browser State (per-test via test.use / fixtures)        │
│   ├── localStorage: theme, opencode-mode, project                │
│   ├── Cookies: theme cookie for SSR                              │
│   └── IndexedDB: none currently used                             │
└──────────────────────────────────────────────────────────────────┘
```

### 2.2 🔴 Tests That MUST Be Real Integration (No Mocks)

These tests validate infrastructure that mocks would hide:

| Test Area | Why Real | Mock Would Hide |
|-----------|----------|-----------------|
| **OpenCode iframe rendering** | Validates cross-origin iframe loads, Docker networking | Mock iframe would not test CSP, port bindings, CORS |
| **Supervisord process health** | Validates Docker container health, process restart, uptime | Mock would hide zombie processes, restart loops |
| **API → DB round-trip** | Validates SQLite WAL, FK constraints, migration integrity | Mock would hide schema drift, constraint violations |
| **Pipeline scheduler cycle** | Validates extraction→synthesis→skill-sync real sequence | Mock would hide timing, deadlocks, checkpoint failures |
| **Settings persistence** | Validates DB writes survive page reload | Mock would hide write failures, serialization bugs |
| **ProjectDropdown cross-page state** | Validates project context propagates correctly | Mock would hide context leaks |
| **Theme flash prevention** | Validates SSR class + client hydration | Mock would hide FOUC |

### 2.3 Tests That Can Be Mocked (UI Behavior Only)

| Test Area | Mock Strategy |
|-----------|---------------|
| **Mail email list/reader** | `page.route()` intercept email API, return deterministic payloads |
| **Smart reply generation** | Mock `/suggest` endpoint with canned responses |
| **LLM synthesis** | Mock `callSynthesisLLM` at API boundary |
| **OAuth flow** | Mock Google/Microsoft token endpoints |
| **IMAP sync** | Mock `imapflow` connect/search/fetch |
| **OpenCode message extraction** | Mock `GET /api/v1/opencode/messages` |

---

## 3. Viewport Matrix & Browser Matrix

### 3.1 Viewport Matrix

```typescript
// New Playwright projects to add to playwright.config.ts:
const VIEWPORTS = {
  mobile:     { width: 375,  height: 667,  name: "iPhone SE" },
  mobileLg:   { width: 430,  height: 932,  name: "iPhone 14 Pro Max" },
  tablet:     { width: 768,  height: 1024, name: "iPad Mini" },
  tabletLg:   { width: 1024, height: 1366, name: "iPad Pro" },
  desktop:    { width: 1280, height: 720,  name: "HD" },
  desktopLg:  { width: 1920, height: 1080, name: "Full HD" },
  ultrawide:  { width: 2560, height: 1440, name: "2K" },
};
```

### 3.2 Browser Matrix

| Browser | Channel | Required For |
|---------|---------|-------------|
| **Chromium** | Default | Primary — all tests run here first |
| **Firefox** | Default | Cross-browser CSS Grid, Flexbox, viewport units |
| **WebKit** | Default | Safari-specific bugs (backdrop-filter, sticky, overscroll) |

### 3.3 Per-Feature Viewport Coverage

| Feature | mobile | mobileLg | tablet | tabletLg | desktop | desktopLg | ultrawide |
|---------|--------|----------|--------|----------|---------|-----------|-----------|
| Nav dropdowns | ✅ | ✅ | ✅ | ✅ | ✅ | — | — |
| OpenCode switch/gutter | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Dashboard utility | ✅ | ✅ | ✅ | ✅ | ✅ | — | — |
| Popout/fullscreen | — | — | ✅ | ✅ | ✅ | ✅ | ✅ |
| Docs feature | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| Docs migration | — | — | — | — | ✅ | — | — |

---

## 4. Phase-by-Phase Verification Strategy

---

### PHASE A — Nav Dropdowns

**Feature description:** Replace the current 16-item flat nav bar with grouped dropdown menus. The nav bar must be usable on mobile (hamburger), tablet, and desktop. Active page must highlight in the dropdown.

**Implementation files to test:**
- `services/ingenium-dashboard/src/app/layout.tsx` — nav restructured
- New: `NavDropdown.tsx`, `MobileNav.tsx` (or similar)

**Test file:** `tests/ingenium-dashboard/nav-dropdowns.spec.ts`

#### Test Matrix

```
T1  — NAV-001: Desktop — All dropdown groups render
      Viewport: desktop (1280×720)
      Steps: Navigate to / → verify top-level nav labels (not 16 flat links)
             Hover each group → dropdown opens with correct child links
      Assertions: Each dropdown contains links with correct hrefs
                  Separator after OpenCode | before Status (existing pattern)
                  Active page has distinct styling (font-bold or highlight)
      Screenshot: nav-dropdowns/desktop-all-groups-open.png (each group open one at a time)

T2  — NAV-002: Mobile — Hamburger menu
      Viewport: mobile (375×667)
      Steps: Navigate to / → hamburger icon visible, flat links hidden
             Click hamburger → menu slides open
             Verify all groups rendered (collapsed initially)
             Expand a group → child links visible
      Assertions: Menu covers full viewport or slide-in panel
                  Backdrop click closes menu
                  Active page highlighted
      Screenshot: nav-dropdowns/mobile-hamburger-open.png

T3  — NAV-003: Tablet — Responsive transition
      Viewport: tablet (768×1024)
      Steps: Navigate to / → check if hamburger or compact nav renders
             Resize from 1024→767→769 to test breakpoint
      Assertions: No layout jump at breakpoint transition
                  All links reachable
      Screenshot: nav-dropdowns/tablet-nav.png

T4  — NAV-004: ProjectDropdown integration
      Viewport: desktop (1280×720)
      Steps: Navigate to / → ProjectDropdown visible, not disabled
             Navigate to /mail → ProjectDropdown disabled (opacity-50)
             Navigate to /opencode → ProjectDropdown disabled
      Assertions: Dropdown disabled on /mail and /opencode
                  Dropdown enabled on all other pages
      Screenshot: nav-dropdowns/project-dropdown-states.png

T5  — NAV-005: Settings gear integration
      Viewport: desktop (1280×720)
      Steps: Click gear icon → SettingsOverlay opens
             Verify gear is positioned far-right
             Verify gear is present on every page
      Assertions: SettingsOverlay opens from any page
                  ?settings= tab persists in URL
      Screenshot: nav-dropdowns/settings-overlay-open.png

T6  — NAV-006: Keyboard navigation (accessibility)
      Viewport: desktop (1280×720)
      Steps: Tab through nav items → focus ring visible on each
             Enter/Space on dropdown trigger → opens dropdown
             Escape → closes dropdown
             Arrow keys → navigate within dropdown
      Assertions: All focusable elements reachable via Tab
                  Focus order logical (left→right, top→bottom)
                  No focus traps
      Tool: Use page.keyboard.press("Tab") sequence, verify :focus-visible

T7  — NAV-007: Console/network cleanliness
      Viewport: desktop (1280×720)
      Steps: Navigate to / → open all dropdowns → close all
             Navigate to 5 different pages via dropdown links
      Assertions: Zero console errors (filter: not CORS, not favicon.ico)
                  No 404/500 network responses during nav
                  No React hydration warnings
      Collect: consoleErrors[] + failedRequests[]
```

**Mock/Real decision:** ALL REAL — nav structure MUST be tested against the real DOM. No API mocks (nav doesn't call APIs except ProjectDropdown's project list).

---

### PHASE B — OpenCode Switch/Gutter

**Feature description:** A reactive right-edge glass tab button (OpenCodeSwitch) toggles between Web and CLI modes on `/opencode` page. Button is translucent at rest (~35% opacity), expands on hover. Mobile gets a bottom-right pill. Both iframes coexist in DOM to prevent xterm dimension zeroing.

**Implementation files to test:**
- `services/ingenium-dashboard/src/app/components/OpenCodeSwitch.tsx` — existing, needs vetting
- `services/ingenium-dashboard/src/app/components/OpenCodeFrame.tsx`
- `services/ingenium-dashboard/src/app/opencode/page.tsx`

**Existing tests:** `tests/ingenium-dashboard/opencode-switch.spec.ts` — 9 tests covering initial state, CLI/Web switching, display:none guard, persistence, keyboard shortcut, mobile viewport, hidden iframe dimensions — **all passing.** These must continue to pass.

**Test file:** `tests/ingenium-dashboard/opencode-switch-v2.spec.ts` (extends existing, does not replace)

#### Additional Test Matrix (beyond existing 9 tests)

```
T8  — OSW-001: Glass tab hover states (visual regression)
      Viewport: desktopLg (1920×1080)
      Steps: Navigate to /opencode → capture resting state
             Hover glass tab → wait 300ms for transition → capture hover state
             Move mouse away → capture post-hover state
      Assertions: Resting: bg-opacity ~35%, visible but subtle
                  Hover: bg-opacity ~85%, expands left (-translate-x-6), shadow visible
                  Transition: 300ms ease-out, no jump
      Screenshot: opencode-switch/glass-resting.png
                  opencode-switch/glass-hover.png
                  opencode-switch/glass-post-hover.png

T9  — OSW-002: Gutter doesn't overlap content
      Viewport: desktopLg (1920×1080)
      Steps: Navigate to /opencode in Web mode → verify iframe content not obstructed
             Measure distance from right edge to iframe content boundary
      Assertions: Glass tab is at z-40, iframe content not clipped
                  No horizontal scrollbar from tab overflow
      Screenshot: opencode-switch/gutter-content-gap.png (measure with boundingBox)

T10 — OSW-003: CLI iframe loads xterm properly (real integration)
      Viewport: desktopLg (1920×1080)
      Steps: Navigate to /opencode (Web first) → switch to CLI
             Wait for CLI iframe to mount → wait for terminal prompt
             Type "ls" in the terminal via keyboard → verify output
      Assertions: CLI iframe src contains port 4099
                  Terminal cursor visible
                  Text renders without distortion (no scaleX/scaleY transforms on iframe)
                  No "display:none" on CLI iframe at any point
      🔴 REAL INTEGRATION: Requires ttyd service running on :4099
      Screenshot: opencode-switch/cli-terminal-active.png

T11 — OSW-004: Multi-window mode persistence
      Viewport: desktop (1280×720)
      Steps: Open /opencode in Tab A → switch to CLI
             Open /opencode in Tab B (new tab, same origin)
             Verify Tab B reads same localStorage "opencode-mode" → starts in CLI
             Switch Tab B to Web → verify Tab A unaffected
      Assertions: localStorage key "opencode-mode" is per-origin, NOT per-tab
                  Each tab initializes independently on load
      🔴 REAL INTEGRATION: Multi-tab scenario

T12 — OSW-005: Keyboard shortcut from non-/opencode pages
      Viewport: desktop (1280×720)
      Steps: Navigate to /skills → press Ctrl+Shift+`
             Verify shortcut is scoped to /opencode page only (does NOT toggle on other pages)
      Assertions: No toggle event fires on non-/opencode pages
                  No errors in console

T13 — OSW-006: Mobile pill button interaction
      Viewport: mobile (375×667)
      Steps: Navigate to /opencode → verify pill button at bottom-right
             Tap pill → mode toggles
      Assertions: Pill has rounded-full class (not rounded-l-lg)
                  Pill visible at bottom-right corner
                  Tap target ≥ 44×44 CSS pixels (WCAG 2.5.5)
                  Mode toggles correctly on mobile
      Screenshot: opencode-switch/mobile-pill-web.png
                  opencode-switch/mobile-pill-cli.png
```

**Mock/Real decision:** T10 (CLI xterm) and T11 (multi-window) MUST be real integration. Others can rely on DOM assertions without real service connectivity.

---

### PHASE C — Dashboard Utility (Homepage Redesign)

**Feature description:** The homepage (`/`) currently shows 4 operational cards (Self-Learning, Tasks, Jobs, Mail). The redesign must: show live operational metrics, provide quick-actions, surface recent activity/synthesis, show notification summaries, and generally serve as a "command center" rather than a nav-duplicate.

**Existing tests:** `tests/ingenium-dashboard/homepage.spec.ts` — 7 tests with route interception for skeleton/error/partial-degradation. These must continue to pass.

**Test file:** `tests/ingenium-dashboard/homepage-v2.spec.ts`

#### Test Matrix

```
T14 — HOM-001: Live metrics render from real API
      Viewport: desktop (1280×720)
      Steps: Navigate to / → wait for dashboard summary API
             Verify all metric cards populated (not "..." or "—")
      Assertions: Each widget shows actual DB-derived numbers
                  /api/v1/dashboard/summary returns 200 with correct shape
      🔴 REAL INTEGRATION: Must hit real DB, no mocks
      Screenshot: homepage/metrics-desktop.png

T15 — HOM-002: Quick-action buttons work
      Viewport: desktop (1280×720)
      Steps: Identify all CTA/action buttons on homepage
             Click each → verify navigation or modal opens
             Example: "View Pipeline" → navigates to /pipeline
                      "Create Task" → opens task creation modal
                      "Check Mail" → navigates to /mail
      Assertions: Each CTA resolves to a valid action (no broken links)
      Screenshot: homepage/quick-actions.png

T16 — HOM-003: Recent activity timeline widget
      Viewport: desktopLg (1920×1080)
      Steps: Navigate to / → locate activity/recent events section
             Verify events are from DB (not hardcoded)
      Assertions: Shows last N pipeline events with timestamps
                  "View all" links to /pipeline with appropriate filter
      🔴 REAL INTEGRATION: Must read pipeline_events table
      Screenshot: homepage/activity-widget.png

T17 — HOM-004: Synthesis status widget
      Viewport: desktop (1280×720)
      Steps: Navigate to / → locate synthesis/learning section
             Verify shows pending observations count
             Verify shows last synthesis timestamp
      Assertions: Pending count matches /api/v1/observations?status=pending
                  "Run Synthesis" button calls /api/v1/synthesis/run
      🔴 REAL INTEGRATION

T18 — HOM-005: Error/degradation states (existing test pattern extended)
      Viewport: desktop (1280×720)
      Steps: Intercept /api/v1/dashboard/summary to return 500
             Verify error widget appears
             Intercept to return partial (some modules null)
             Verify degraded modules show "Unavailable" badge
      Assertions: Error state includes retry button
                  Partial degradation doesn't crash page
      Mock: OK to mock API for error simulation

T19 — HOM-006: Mobile layout — stack widgets vertically
      Viewport: mobile (375×667)
      Steps: Navigate to / → verify all widgets stack in single column
             Verify no horizontal overflow
      Assertions: No widget is cut off
                  All text readable without zoom
      Screenshot: homepage/mobile-stacked.png

T20 — HOM-007: Tablet layout — 2-column grid
      Viewport: tablet (768×1024)
      Steps: Navigate to / → verify grid adapts to 2 columns
      Assertions: No widget overlap
                  Proper gap between columns
      Screenshot: homepage/tablet-grid.png

T21 — HOM-008: Performance — page load < 2s
      Viewport: desktop (1280×720)
      Steps: Cold load / (no cache) → measure DOMContentLoaded
             Warm load / (cached API) → measure DOMContentLoaded
      Assertions: Cold load: DOMContentLoaded < 3s
                  Warm load: DOMContentLoaded < 1.5s
                  No single API call > 2s (check performance API)
      Collect: performance.getEntriesByType("resource") for API calls

T22 — HOM-009: Console cleanliness
      Viewport: desktop (1280×720)
      Steps: Navigate to / → wait 3s → check console
      Assertions: Zero console.errors (excluding CORS from iframe)
                  No "Warning:" messages from React
                  No "Failed to load resource" for app assets
```

**Mock/Real decision:** T14–T17 MUST be real. T18–T20 can use mocks for error/empty states. T21–T22 real.

---

### PHASE D — Popout/Fullscreen for 3 Pages

**Feature description:** Three pages (identified during implementation — likely `/skills` detail overlay, `/mail` compose, `/tasks` detail) get a "popout" button that opens the content in a new browser window (or a full-viewport overlay, or both). The fullscreen Overlay pattern already exists in `Overlay.tsx` with `fullScreen` prop.

**Implementation files to test:**
- `services/ingenium-dashboard/src/app/components/Overlay.tsx` — existing `fullScreen` prop
- Affected page components

**Test file:** `tests/ingenium-dashboard/popout-fullscreen.spec.ts`

#### Test Matrix

```
T23 — POP-001: Overlay fullScreen mode — correct dimensions
      Viewport: desktopLg (1920×1080)
      Steps: Open any page that uses Overlay with fullScreen=true
             Verify panel dimensions
      Assertions: w-[calc(100%-32px)] h-[calc(100%-32px)] — 16px margin all sides
                  Not max-w-7xl (overrides the non-fullScreen default)
                  Backdrop covers entire viewport
      Screenshot: popout/fullscreen-overlay.png

T24 — POP-002: Popout button opens new window
      Viewport: desktop (1280×720)
      Steps: Click popout button on target page
             Verify new window opens with correct URL
      Assertions: window.open() called with correct target URL
                  New window has dimensions ≥ 800×600
                  Content renders in new window (no blank page)
      🔴 REAL INTEGRATION: Multi-window scenario
      Screenshot: popout/new-window-content.png (in new window context)

T25 — POP-003: Popout window syncs state with parent
      Viewport: desktop (1280×720), plus new window
      Steps: Open popout window → make a change in parent → verify popout reflects
             Or: verify localStorage/BroadcastChannel sync
      Assertions: State changes propagate (if designed for sync)
                  Or: independent windows (if designed as snapshots)
      Note: Behavior depends on implementation choice

T26 — POP-004: Popout — mobile fallback
      Viewport: mobile (375×667)
      Steps: Click popout button on mobile
      Assertions: Opens in new tab (mobile browsers block window.open with specific dimensions)
                  Or: falls back to fullscreen overlay on mobile
      Screenshot: popout/mobile-fallback.png

T27 — POP-005: Fullscreen overlay — Escape key closes
      Viewport: desktop (1280×720)
      Steps: Open fullscreen overlay → press Escape
      Assertions: Overlay closes, body overflow restored
                  Focus returns to trigger element

T28 — POP-006: Fullscreen overlay — scroll lock
      Viewport: desktop (1280×720)
      Steps: Open fullscreen overlay → attempt to scroll background
      Assertions: Background (body) does not scroll
                  document.body.style.overflow === "hidden"
                  Overlay content scrolls independently
```

**Mock/Real decision:** T24 (popout new window) MUST be real. T23, T25–T28 can use existing Overlay component.

---

### PHASE E — Docs CRUD / Tree / Search / Editor / History / Attachments / MCP / Agent / Voice

**Feature description:** This is the largest net-new feature. A full documentation/knowledge-base system with:
- **Tree**: Hierarchical file/folder browser (side panel)
- **CRUD**: Create, Read, Update, Delete documents
- **Search**: Full-text search across documents (FTS5-backed)
- **Editor**: Rich text or Markdown editor with live preview
- **History**: Version history / revision tracking
- **Attachments**: File attachments to documents
- **MCP Integration**: MCP tools for docs CRUD
- **Agent Integration**: Agents can read/write docs
- **Voice**: Voice-to-text input for document creation

**This is a full-stack feature requiring:**
1. DB migrations (new `documents`, `document_versions`, `document_attachments` tables)
2. API routes (RESTful CRUD at `/api/v1/docs/...`)
3. MCP tools (ingenium_doc_* tools)
4. Dashboard page at `/docs`
5. Components: DocTree, DocEditor, DocSearch, DocHistory, DocAttachments, VoiceInput

**Test files:**
- `packages/ingenium-core/tests/documents.test.ts` — unit: DB operations, FTS5 search, version storage
- `tests/mcp-tools-docs.spec.ts` — API: MCP tool parity
- `tests/ingenium-dashboard/docs.spec.ts` — E2E: full page

#### E.1 — Unit Tests (Vitest — `packages/ingenium-core/tests/documents.test.ts`)

```
U1  — DOCS-DB-001: Create document
      Seed: Empty DB
      Action: insertDocument(projectId, { title, content, parentId? })
      Assert: Returns document with id, created_at, updated_at
              Parent-child relationship correct if parentId set

U2  — DOCS-DB-002: Read document with tree
      Seed: 3-level nested tree (root → child → grandchild)
      Action: getDocumentTree(projectId) / getDocument(id)
      Assert: Tree structure matches insert order
              Each node has children[], path, depth

U3  — DOCS-DB-003: Update document — creates version
      Seed: Existing document
      Action: updateDocument(id, { title, content })
      Assert: Document updated, new version row created in document_versions
              Version stores previous content, editor, timestamp

U4  — DOCS-DB-004: Delete document — cascades
      Seed: Document with children + attachments
      Action: deleteDocument(id)
      Assert: Document, children, versions, attachments all removed
              No FK constraint errors (ON DELETE CASCADE on all child tables)

U5  — DOCS-DB-005: Full-text search (FTS5)
      Seed: 10 documents with distinct content
      Action: searchDocuments(projectId, "keyword")
      Assert: Returns ranked results with snippets
              Empty query returns all documents
              BM25 ranking — exact matches rank higher

U6  — DOCS-DB-006: Attachments — associate and retrieve
      Seed: Document exists
      Action: addAttachment(documentId, { filename, mimeType, size, data })
      Assert: Attachment stored, retrievable by document ID
              Attachment removed when document deleted (CASCADE)

U7  — DOCS-DB-007: Version history — list and diff
      Seed: Document with 3 versions
      Action: getDocumentVersions(id) → getDocumentVersion(versionId)
      Assert: Versions ordered by created_at DESC
              Each version stores full content snapshot

U8  — DOCS-DB-008: Unique constraint — no duplicate titles in same folder
      Seed: Document exists at root with title "README"
      Action: insertDocument(projectId, { title: "README", parentId: null })
      Assert: Throws SQLITE_CONSTRAINT_UNIQUE
              Error message is human-readable

U9  — DOCS-DB-009: WAL safety — checkpointAfterWrite outside transaction
      Seed: Write 60 documents in loop
      Action: Verify checkpointAfterWrite() is NOT called inside execTransaction()
      Assert: No SQLITE_LOCKED errors
              WAL file stays under 1MB
```

#### E.2 — MCP Tool API Tests (`tests/mcp-tools-docs.spec.ts`)

```
M1  — DOCS-MCP-001: Tool catalog parity
      Action: GET /api/v1/mcp-tools → verify docs tools exist
      Assert: Tools listed: ingenium_doc_create, ingenium_doc_get, ingenium_doc_update,
              ingenium_doc_delete, ingenium_doc_list, ingenium_doc_search,
              ingenium_doc_tree, ingenium_doc_add_attachment, ingenium_doc_get_versions
              Each tool has correct JSON Schema input parameters

M2  — DOCS-MCP-002: Create via MCP tool
      Action: Call ingenium_doc_create(project, title, content, parentId?)
      Assert: Returns created document with ID, HTTP 201

M3  — DOCS-MCP-003: Search via MCP tool
      Action: Call ingenium_doc_search(project, query)
      Assert: Returns FTS5-ranked results, includes snippets

M4  — DOCS-MCP-004: Version history via MCP tool
      Action: Call ingenium_doc_get_versions(project, docId)
      Assert: Returns array of versions with timestamps

M5  — DOCS-MCP-005: Disabled tool returns TOOL_DISABLED
      Action: Disable a doc tool via /mcp-servers page → call tool
      Assert: Returns error with message "TOOL_DISABLED"
```

#### E.3 — Dashboard E2E Tests (`tests/ingenium-dashboard/docs.spec.ts`)

```
D1  — DOCS-UI-001: Page loads — empty state
      Viewport: desktop (1280×720)
      Precondition: No documents in project
      Steps: Navigate to /docs
      Assert: Page heading "Documentation" visible
              Tree panel visible (empty: "No documents yet" or "Create your first doc")
              Empty state has CTA button "Create Document"
      Screenshot: docs/empty-state-desktop.png

D2  — DOCS-UI-002: Create document — opens editor
      Viewport: desktop (1280×720)
      Steps: Click "Create Document" → title input appears
             Type "Getting Started" → Markdown editor appears
             Type "# Hello World" → preview renders
      Assert: Editor has toolbar (bold, italic, headings, code, link, image)
              Preview updates in real-time (debounced)
              "Save" button creates document
      Screenshot: docs/editor-create.png

D3  — DOCS-UI-003: Tree navigation — select document
      Viewport: desktop (1280×720)
      Precondition: At least 3 documents in tree
      Steps: Click a document in the tree → editor opens with content
             Click a different document → editor switches content
      Assert: Selected document highlighted in tree
              Editor content matches selected document
              No layout shift when switching documents
      Screenshot: docs/tree-selection.png

D4  — DOCS-UI-004: Tree — create child document
      Viewport: desktop (1280×720)
      Steps: Right-click folder in tree → "New Document" context menu
             Or: "+" button next to folder name
             Type title → document created as child
      Assert: New document appears under parent in tree
              Tree auto-expands to show new document
      Screenshot: docs/tree-context-menu.png

D5  — DOCS-UI-005: Tree — drag-and-drop reorder
      Viewport: desktop (1280×720)
      Steps: Drag a document to a different folder in tree
      Assert: Document moves to new parent
              Tree updates without full reload
      Note: This tests HTML5 drag-and-drop API or pointer events

D6  — DOCS-UI-006: Search — full-text search
      Viewport: desktop (1280×720)
      Steps: Type "hello" in search bar
      Assert: Results appear with highlighted snippets
              Clicking result navigates to that document in tree + editor
              "X" clears search, restores full tree
      Screenshot: docs/search-results.png

D7  — DOCS-UI-007: Editor — Markdown preview
      Viewport: desktopLg (1920×1080)
      Steps: Open a document → switch to "Edit" mode if needed
             Type markdown with headers, lists, code blocks, links, images
      Assert: Preview renders correctly (headings, bold, italic, code blocks syntax-highlighted)
              Split view: editor left, preview right (on desktopLg)
              Single view: toggle between edit/preview (on desktop)
      Screenshot: docs/editor-markdown-preview.png

D8  — DOCS-UI-008: Editor — toolbar buttons
      Viewport: desktop (1280×720)
      Steps: Select text → click Bold in toolbar
             Select text → click Italic
             Click Heading → select H2
             Click Code → code block inserted
             Click Link → link dialog → enter URL
      Assert: Markdown syntax inserted correctly
              Preview reflects toolbar actions
      Note: Use aria-label selectors for toolbar buttons

D9  — DOCS-UI-009: History — version list
      Viewport: desktop (1280×720)
      Steps: Open document → make 2 edits (save each time)
             Click "History" tab/button
      Assert: 3 versions listed (initial + 2 edits)
              Each version shows timestamp and editor (if available)
              Click version → shows diff or content snapshot
      Screenshot: docs/history-list.png

D10 — DOCS-UI-010: History — restore version
      Viewport: desktop (1280×720)
      Steps: Open history → select previous version → click "Restore"
      Assert: Document content reverts to selected version
              New version created (restore is itself a version)
              Current version indicator updates

D11 — DOCS-UI-011: Attachments — upload and display
      Viewport: desktop (1280×720)
      Steps: Open document → click "Attachments" tab
             Upload a .png file (use test fixture)
             Upload a .pdf file
      Assert: Attachments listed with filename, type icon, size
              Image attachments show thumbnail
              Click attachment → downloads or opens
      Screenshot: docs/attachments-list.png

D12 — DOCS-UI-012: Delete document — confirmation
      Viewport: desktop (1280×720)
      Steps: Select document → click Delete
             Confirmation dialog appears: "Delete [title] and all children?"
             Confirm delete
      Assert: Document removed from tree
              Children also removed
              Toast/notification shows success

D13 — DOCS-UI-013: Responsive — mobile
      Viewport: mobile (375×667)
      Steps: Navigate to /docs → tree collapses to hamburger/drawer
             Tap drawer → tree slides in over editor
             Select document → drawer closes, editor shows content
      Assert: Editor usable on mobile (full-width)
              Tree accessible via hamburger
              No horizontal scroll
      Screenshot: docs/mobile-tree-drawer.png
                  docs/mobile-editor.png

D14 — DOCS-UI-014: Responsive — tablet
      Viewport: tablet (768×1024)
      Steps: Navigate to /docs → tree + editor side by side
             Tree takes ~30% width, editor ~70%
      Assert: Resize handle between tree and editor works
              Both panels independently scrollable
      Screenshot: docs/tablet-layout.png

D15 — DOCS-UI-015: Console/network cleanliness
      Viewport: desktop (1280×720)
      Steps: Navigate to /docs → create doc → edit → search → delete
      Assert: Zero console errors
              No failed network requests (except expected favicon.ico)
              No memory leaks (check for detached DOM nodes in performance monitor)

D16 — DOCS-UI-016: Performance — large document tree
      Precondition: 100+ documents in tree
      Steps: Navigate to /docs → measure render time
      Assert: Tree renders in < 500ms
              Virtual scrolling if > 50 visible nodes
              No jank when expanding/collapsing large folders

D17 — DOCS-UI-017: Voice input (if implemented)
      Viewport: desktop (1280×720)
      Steps: Click microphone button → browser requests mic permission
             Grant permission → speak → text appears in editor
      Assert: SpeechRecognition API used (or mock)
              Text inserts at cursor position
              Mic button toggles recording state
      Note: May require Chromium with --use-fake-device-for-media-stream flag
```

**Mock/Real decision:**
- Unit tests (U1–U9): REAL DB (vitest with better-sqlite3)
- MCP API tests (M1–M5): REAL API server
- Dashboard E2E (D1–D17): REAL API + real DB, mock IMAP/LLM only if those features are called
- Voice test (D17): REAL or mock depending on browser support

---

### PHASE F — Documentation Migration

**Feature description:** Migrate existing documentation from `docs/` directory (15 How-To files, architecture docs, pipeline docs) into the new Docs system. This is a one-time migration with verification.

**Test file:** `tests/migration/docs-migration.spec.ts` (run once, preserved for regression)

#### Test Matrix

```
F1 — MIG-001: Migration script runs without errors
      Steps: Run migration command/script
      Assert: Exit code 0
              Log shows each migrated file: "OK: docs/HOW-TO/skills.md → document ID: xxx"

F2 — MIG-002: All documents imported
      Steps: Count original .md files in docs/ (recursively)
             Count documents in DB after migration
      Assert: Document count >= original file count
              Each original file has a corresponding document by title/path

F3 — MIG-003: Directory structure preserved as tree
      Steps: Query document tree after migration
      Assert: docs/ → root folder
              docs/HOW-TO/ → HOW-TO folder with 15 children
              docs/assets/ → assets folder preserved (if applicable)

F4 — MIG-004: Content integrity — spot check
      Steps: Select 5 random documents → compare content with original files
      Assert: Content matches character-for-character (no truncation)
              Markdown formatting preserved (headers, code blocks, links)

F5 — MIG-005: Images/assets preserved
      Steps: Check documents with image references
      Assert: Image paths either migrated as attachments or paths preserved

F6 — MIG-006: Original files NOT deleted
      Steps: After migration, check docs/ directory
      Assert: Original .md files still exist (migration is copy, not move)
              Or: files moved to docs/.archive/ (if design requires move)

F7 — MIG-007: Migration is idempotent
      Steps: Run migration twice → second run should detect existing documents
      Assert: No duplicate documents created
              Second run logs "already migrated" for each file
              Or: second run skips if document with matching title exists

F8 — MIG-008: Search works post-migration
      Steps: Search for "email" → expect results from email.md
             Search for "synthesis" → expect results from synthesis.md
      Assert: FTS5 index populated correctly
              Results ranked by relevance
```

**Mock/Real decision:** ALL REAL — migration must run against real filesystem + real DB.

---

## 5. Accessibility Testing Strategy

### 5.1 Automated Checks — axe-core Integration

```typescript
// Add to playwright.config.ts:
import { test as axeTest } from "@playwright/test";
// OR use @axe-core/playwright package
```

**Required checks for every new page/component:**

| Check | Tool | Standard |
|-------|------|----------|
| Color contrast (text, icons, focus rings) | `axe-core` | WCAG 2.1 AA (4.5:1 normal, 3:1 large) |
| Focus order (Tab sequence logical) | Playwright keyboard + `:focus-visible` | WCAG 2.4.3 |
| ARIA roles (buttons, links, landmarks) | `axe-core` + manual | WCAG 4.1.2 |
| Alt text on images | `axe-core` | WCAG 1.1.1 |
| Form labels (all inputs have associated labels) | `axe-core` | WCAG 3.3.2 |
| Keyboard operability (all interactions via keyboard) | Playwright keyboard API | WCAG 2.1.1 |
| Screen reader announcements (live regions) | Manual with VoiceOver/NVDA | WCAG 4.1.3 |

### 5.2 Accessibility Test Suite

```
A11Y-001: Nav dropdowns — keyboard navigation
  Tab through nav → all dropdown triggers focusable
  Enter/Space opens dropdown, Escape closes
  Arrow keys navigate within dropdown
  Focus doesn't escape closed dropdown

A11Y-002: OpenCode switch — accessible toggle
  Verify: role="button", aria-label="Switch to CLI mode", aria-pressed="false"
  Tab to switch → Enter toggles
  Screen reader announces: "Switch to CLI mode, toggle button, not pressed"

A11Y-003: Docs editor — accessible toolbar
  Verify: role="toolbar" with aria-label="Formatting"
  Each button has aria-label (e.g., "Bold", "Italic")
  Tab moves between toolbar groups, Arrow keys within groups

A11Y-004: Docs tree — accessible tree view
  Verify: role="tree", role="treeitem" on nodes
  aria-expanded on folders, aria-level for depth
  Arrow keys: Up/Down navigate, Right expands, Left collapses

A11Y-005: Popout button — accessible
  Verify: aria-label="Open in new window" or "Pop out"
  Announces "opens in new window" if target="_blank"

A11Y-006: Full page color contrast audit
  Run axe-core on every page at every viewport
  Assert: Zero "serious" or "critical" violations
  Log violations to test output for manual triage
```

---

## 6. Performance Testing Strategy

### 6.1 Metrics to Collect

| Metric | Tool | Threshold | Pages to Test |
|--------|------|-----------|---------------|
| **FCP** (First Contentful Paint) | Lighthouse / Performance API | < 1.5s | All |
| **LCP** (Largest Contentful Paint) | Lighthouse / Performance API | < 2.5s | All |
| **TBT** (Total Blocking Time) | Lighthouse | < 300ms | All |
| **CLS** (Cumulative Layout Shift) | Layout Stability API | < 0.1 | All (especially mail, opencode) |
| **API response time** | `page.waitForResponse` + timing | < 500ms (cached), < 2s (uncached) | All API-calling pages |
| **DOM node count** | `document.querySelectorAll("*").length` | < 3000 | /docs (with large tree) |
| **JS bundle size** | Next.js build output | < 200KB per route (gzipped) | /docs editor |
| **Memory usage** | `performance.memory` (Chrome only) | No leaks across 10+ navigations | All |

### 6.2 Performance Test Suite

```
PERF-001: Docs page with 100-document tree
  Steps: Seed 100 documents in nested folders
         Measure: FCP, LCP, TBT, DOM node count
  Assert: Tree virtualized → < 500 DOM nodes visible
          Scroll performance: 60fps (no jank)

PERF-002: Docs search debounce
  Steps: Type rapidly in search box
  Assert: Maximum 1 API call per 300ms (debounced)
          No API call for queries < 2 characters

PERF-003: Nav hover → dropdown open latency
  Steps: Hover nav dropdown trigger → measure time to dropdown visible
  Assert: < 100ms (instant visual feedback)

PERF-004: Homepage dashboard summary API
  Steps: Measure /api/v1/dashboard/summary response time
  Assert: < 500ms with seeded data (22 obs, 14 traits, 8 tasks, 3 jobs)

PERF-005: Docs editor — large document
  Steps: Open document with 10KB+ Markdown content
  Assert: Editor renders in < 500ms
          Typing latency < 50ms per keystroke
```

---

## 7. Console & Network Cleanliness Standards

### 7.1 Console Error Classification

Every test must collect console errors and classify them:

```typescript
const ALLOWED_CONSOLE_ERRORS = [
  /favicon\.ico/,           // Missing favicon (expected in dev)
  /Failed to read.*iframe/,  // Cross-origin iframe access (expected)
  /blocked by CORS/,         // Cross-origin iframe CORS (expected)
];

const REAL_ERRORS = consoleErrors.filter(
  e => !ALLOWED_CONSOLE_ERRORS.some(pattern => pattern.test(e))
);
expect(REAL_ERRORS).toHaveLength(0);
```

### 7.2 Network Failure Classification

```typescript
const ALLOWED_NETWORK_FAILURES = [
  /\/global\/event/,    // SSE reconnect (expected)
  /\/_next\/webpack/,   // Webpack HMR retry (dev only)
  /sockjs-node/,        // Webpack dev server (dev only)
];
```

### 7.3 CI Gate

```bash
# In CI: fail if ANY test has real console errors
# In dev: warn but don't fail (webpack HMR is noisy)
```

---

## 8. Visual Regression Strategy

### 8.1 Screenshot Naming Convention

```
next-steps-plan/screenshots/<feature>/<test-id>-<viewport>-<state>.png

Examples:
  next-steps-plan/screenshots/nav-dropdowns/T1-desktop-all-groups-open.png
  next-steps-plan/screenshots/docs/T3-tree-selection-desktop.png
  next-steps-plan/screenshots/docs/T13-mobile-tree-drawer.png
  next-steps-plan/screenshots/opencode-switch/glass-resting-desktopLg.png
  next-steps-plan/screenshots/homepage/metrics-desktop.png
```

### 8.2 Screenshot Capture Pattern

```typescript
// In each test, capture screenshots ON PASS:
test("T1 - ...", async ({ page }) => {
  // ... test actions ...
  
  await page.screenshot({
    path: "next-steps-plan/screenshots/nav-dropdowns/T1-desktop.png",
    fullPage: true,
  });
  
  // For visual regression: capture specific elements
  await page.locator("nav").screenshot({
    path: "next-steps-plan/screenshots/nav-dropdowns/T1-nav-only.png",
  });
});
```

### 8.3 Visual Diff Baseline

1. **Capture on first passing run** → commit screenshots as baseline
2. **Future runs**: Compare against baseline using `pixelmatch` or Playwright's built-in `toMatchSnapshot()`
3. **Threshold**: 0.5% pixel difference allowed (account for font rendering differences)
4. **Review process**: Flagged diffs reviewed in PR by human

### 8.4 Screenshot Catalog (Minimum Required)

```
next-steps-plan/screenshots/
├── nav-dropdowns/
│   ├── desktop-all-groups.png
│   ├── mobile-hamburger-open.png
│   ├── mobile-hamburger-closed.png
│   ├── tablet-nav.png
│   ├── project-dropdown-states.png
│   └── settings-overlay-open.png
├── opencode-switch/
│   ├── glass-resting.png
│   ├── glass-hover.png
│   ├── glass-post-hover.png
│   ├── gutter-content-gap.png
│   ├── cli-terminal-active.png
│   ├── mobile-pill-web.png
│   └── mobile-pill-cli.png
├── homepage/
│   ├── metrics-desktop.png
│   ├── quick-actions.png
│   ├── activity-widget.png
│   ├── mobile-stacked.png
│   └── tablet-grid.png
├── popout/
│   ├── fullscreen-overlay.png
│   ├── new-window-content.png
│   └── mobile-fallback.png
├── docs/
│   ├── empty-state-desktop.png
│   ├── editor-create.png
│   ├── tree-selection.png
│   ├── tree-context-menu.png
│   ├── search-results.png
│   ├── editor-markdown-preview.png
│   ├── history-list.png
│   ├── attachments-list.png
│   ├── mobile-tree-drawer.png
│   ├── mobile-editor.png
│   └── tablet-layout.png
└── migration/
    └── post-migration-tree.png
```

---

## 9. Multi-Window Behavior Testing

### 9.1 Scenarios

```
MW-001: Settings overlay — persists ?settings= across tabs
  Steps: Open /tasks?settings=general in Tab A
         Open /skills in Tab B
  Assert: Tab B does NOT show settings overlay (query param is per-tab)

MW-002: ProjectDropdown — project switch affects new tab
  Steps: Tab A on /observations (project=gh-llm-bootstrap)
         Switch project to global-default in Tab A
         Tab B loads /observations (reads localStorage/context)
  Assert: Tab B loads with correct project context

MW-003: Docs editor — concurrent edits (last-write-wins)
  Steps: Tab A and Tab B both open same document
         Edit in Tab A → save
         Edit in Tab B → save
  Assert: Tab B save succeeds (no lock error)
          Tab B may see stale-version warning (if versioning implemented)
          Or: last write wins with no warning (acceptable)

MW-004: OpenCode switch — per-tab mode independence
  Steps: Tab A in CLI mode, Tab B in Web mode
  Assert: Each tab maintains its own mode
          localStorage key is same → last-set mode wins on next page load
```

---

## 10. Failure & Rerun Protocol

### 10.1 Test Categorization

| Category | Examples | Rerun Strategy |
|----------|----------|----------------|
| **Deterministic** | Unit tests, mocked E2E | Never rerun — fix the code |
| **Integration-likely-flaky** | Real IMAP mail tests, Docker health checks | Max 2 retries, then fail |
| **Visual-regression** | Screenshot diffs | Record new baseline if intentional change |
| **Performance** | Timing assertions | 3-run median, fail if all 3 exceed threshold |

### 10.2 Failure Triage Steps

```
1. Check trace.zip (retained on failure)
2. Check screenshot (captured on failure)
3. Check console errors log
4. Check network failures log
5. Re-run single test in headed mode:
   npx playwright test --headed --project=desktop tests/ingenium-dashboard/docs.spec.ts:42
6. If test is flaky (passes on rerun without code change) → mark as flaky, file bug
7. If test is deterministic (same failure every time) → fix the code, not the test
```

### 10.3 CI Pipeline

```yaml
# GitHub Actions or similar
test-e2e:
  steps:
    - run: docker compose up -d
    - run: npx playwright test --project=desktop --project=mobile-smoke
    - run: npx playwright test --project=firefox-desktop  # subset
    - run: npx playwright test --project=webkit-desktop  # subset
    - if: failure()
      run: npx playwright show-report
```

---

## 11. Playwright Configuration Upgrade

### 11.1 Recommended `playwright.config.ts` Changes

```typescript
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/ingenium-dashboard",
  timeout: 30000,  // ↑ from 15s — some pages cold-load slowly
  retries: process.env.CI ? 2 : 0,  // Conditional retries
  fullyParallel: true,  // 🔴 ENABLE parallel by file
  workers: process.env.CI ? 4 : undefined,
  
  // 🔴 NEW: Screenshot on pass for visual regression
  use: {
    baseURL: "http://localhost:3000",
    headless: true,
    trace: "retain-on-failure",
    screenshot: "on",  // 🔴 was "only-on-failure"
  },

  // 🔴 NEW: Named projects per viewport
  projects: [
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 720 } },
    },
    {
      name: "chromium-desktopLg",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1920, height: 1080 } },
    },
    {
      name: "chromium-mobile",
      use: { ...devices["iPhone SE"] },
    },
    {
      name: "chromium-tablet",
      use: { ...devices["iPad Mini"] },
    },
    {
      name: "firefox-desktop",
      use: { ...devices["Desktop Firefox"], viewport: { width: 1280, height: 720 } },
      testMatch: "**/cross-browser/**/*.spec.ts",
    },
    {
      name: "webkit-desktop",
      use: { ...devices["Desktop Safari"], viewport: { width: 1280, height: 720 } },
      testMatch: "**/cross-browser/**/*.spec.ts",
    },
  ],

  webServer: [
    {
      command: "INGENIUM_CORE_DB_PATH=/home/brajam/repos/gh-llm-bootstrap/.ingenium/data NODE_ENV=production npx tsx services/ingenium-api/scripts/api-server.ts",
      port: 4097,
      timeout: 15000,
      reuseExistingServer: true,
    },
    {
      command: "cd services/ingenium-dashboard && NODE_ENV=development npx next dev --port 3000",
      port: 3000,
      timeout: 30000,
      reuseExistingServer: true,
    },
  ],
});
```

---

## 12. Summary — Test Count by Feature

| Phase | Feature | New Unit Tests | New API Tests | New E2E Tests | Real Integration | Total |
|-------|---------|---------------|---------------|---------------|------------------|-------|
| A | Nav dropdowns | 0 | 0 | 7 (T1–T7) | 7 | 7 |
| B | OpenCode switch/gutter | 0 | 0 | 6 (T8–T13) | 2 (T10, T11) | 6 |
| C | Dashboard utility | 0 | 0 | 9 (T14–T22) | 4 (T14–T17) | 9 |
| D | Popout/fullscreen | 0 | 0 | 6 (T23–T28) | 1 (T24) | 6 |
| E | Docs CRUD/tree/search/editor/history/attachments/MCP/agent/voice | 9 (U1–U9) | 5 (M1–M5) | 17 (D1–D17) | 17 (UI), 5 (API) | 31 |
| F | Documentation migration | 0 | 0 | 8 (F1–F8) | 8 | 8 |
| — | Accessibility | 0 | 0 | 6 (A11Y-001–006) | 6 | 6 |
| — | Performance | 0 | 0 | 5 (PERF-001–005) | 5 | 5 |
| — | Multi-window | 0 | 0 | 4 (MW-001–004) | 4 | 4 |
| — | **TOTAL** | **9** | **5** | **68** | **54** | **82** |

---

## 13. Orchestrator Handoff

This verification strategy is complete. Key implementation notes:

1. **Before any Phase A-F implementation starts**, upgrade `playwright.config.ts` per Section 11 (parallelism, projects, screenshot-on-pass).
2. **Phase E (Docs)** requires DB migrations FIRST — tests cannot run without the schema. Write migrations, verify with unit tests, then proceed to API and UI layers.
3. **All mail tests** remain mocked — the IMAP dependency is too brittle for CI. Real mail testing is a separate manual QA task.
4. **Screenshots go to** `next-steps-plan/screenshots/<feature>/` — the directory already exists.
5. **Performance tests** require the `--use-fake-device-for-media-stream` flag for any voice-related tests.
6. **Cross-browser tests** (Firefox, WebKit) are smoke-only — run the first 3 tests per feature, not the full suite.

**Agent allocation**: Orchestrator, spawn up to 12 agents across these phases. Phase E (Docs) is the largest — allocate 4–5 engineers there. Phases A–D and F are smaller and can run in parallel. QA (@ingenium-qa) should run after each phase, not after everything. Remember: verify your own work before calling it done.<｜end▁of▁thinking｜>Now let me verify this document was written correctly:

<｜｜DSML｜｜tool_calls>
<｜｜DSML｜｜invoke name="bash">
<｜｜DSML｜｜parameter name="command" string="true">wc -l /home/brajam/repos/gh-llm-bootstrap/next-steps-plan/QA-VERIFICATION-STRATEGY.md