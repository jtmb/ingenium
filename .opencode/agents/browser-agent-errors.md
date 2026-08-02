## job-102 — 2026-08-02T09:40:00Z (deployed /jobs acceptance, PASS)

| # | Step | Error | Attempt | Resolution |
|---|------|-------|---------|------------|
| 0 | All steps (tablist a11y, queue/events loading→empty, filters say loaded, create-job dialog trigger select, mobile 390 overflow, network DTO, console) | None — all first-attempt | 1/1 | ✅ |

### Working recipe knowledge (verified 2026-08-02, deployed /jobs)
- Tablist: `[role="tablist"][aria-label="Jobs workspace views"]`, 3 `[role="tab"]` (ids `jobs-tab-jobs|queue|events`), roving tabindex 0/-1, aria-selected + aria-controls. Automatic activation: ArrowLeft/Right wrap (modulo), Home→jobs, End→events; Enter/Space native activate. Panels render conditionally — only the active `[role="tabpanel"]` exists in DOM.
- Jobs tab empty state: "No jobs yet"; Create Job header button (only when tab==jobs && no selection). global-default has 0 jobs, 0 deliveries, 0 trusted events (empty data states).
- Event queue panel: heading "Event queue — loaded results (N)"; filters State/Event type/Job with "All loaded states/event types/jobs"; testids `event-queue-loading|empty|error|table|mobile-cards`. NO mutation controls — API has no replay/delivery-mutation route (jobs.ts:112). Prose-only mentions of retry/dead-letter.
- Trusted events panel: heading "Trusted events — loaded results (N)"; filters Event type ("All loaded event types") + Event ID contains; testids `trusted-events-loading|empty|error|table|mobile-cards`.
- Create Job dialog: Overlay role=dialog aria-modal (portalled to body — NOTE: `document.querySelector('[role="dialog"]')` can hit the persistent hidden Navigation drawer dialog first; scope by `find(d => d.querySelector('#job-trigger-event'))`). Trigger select `#job-trigger-event` = exactly 4 options: "No event" (value "") + 3 catalog values (context.conversation.archived/unarchived, context.checkpoint.restored_as_new). Focus opens on Close btn, trap cycles, Escape/Cancel close + restore focus to trigger. No POST on open/select/cancel.
- Agents endpoint returned only 1 agent (ingenium-llm-broker) for global-default — agent select shows placeholder + 1.
- Network DTOs: `/api/v1/jobs` → {data,total}; `/api/v1/jobs/event-deliveries` & `/api/v1/jobs/events` → {data,nextCursor}; metadata-only, no payload/prompt/lease-owner/process fields, no duplicate ids.
- Mobile 390x844: zero document horizontal overflow across all tabs + dialog (tablist fits at 340px).
- Evidence: tests/artifacts/visual-qa/run-20260802-job102/interaction.json

## chat-101 — 2026-08-01T20:40:00Z (deployed acceptance, PASS)

| # | Step | Error | Attempt | Resolution |
|---|------|-------|---------|------------|
| 1 | Desktop keyboard menu (Enter/Space open, arrows, Escape) | None — all first-attempt | 1/1 | ✅ |
| 2 | Activate already-current project only → URL/reload | None | 1/1 | ✅ |
| 3 | Isolated `?project=definitely-missing-project` + recovery | None | 1/1 | ✅ |
| 4 | Mobile 390x844 | `waitForSelector('[data-testid="chat-composer"]', {state:'visible'})` timed out 20s on cold navigation; debug showed composer present+visible (display block, opacity 1). Bridge flake, not product | 2/3 | Use poll-based readiness (evaluate loop checking getBoundingClientRect > 0) after goto at mobile; retry succeeded |
| 5 | Mobile menu item count | Opened menu showed 1 menuitem at 600ms — lazy project-list fetch still in flight (only "Manage projects →" rendered) | 1/1 | Wait for `[role="menu"] [role="menuitem"]` count ≥2 (settles to 5); not a defect |

### Working recipe knowledge (verified 2026-08-01, deployed /chat)
- Nav ProjectDropdown trigger (chat route): `[aria-label^="Context project:"]` (button, aria-haspopup=menu). On other routes: `[aria-label^="Active project:"]`. Disabled on /backups /mail /opencode.
- Selected menuitem semantics: `aria-current="true"`, `data-selected="true"`, `✓` span `[aria-label="Selected"]`, font-semibold.
- Menu panel: `[role="menu"]`; items `[role="menuitem"]` (5 total on chat: 4 projects + "Manage projects →" link). Arrows/Home/End wrap bounded; Escape closes + restores focus to trigger (both panel and document handlers).
- Selecting the current project: URL → `?project=<name>` via URLSearchParams (encoded), full reload, context kept. Current global: `global-default`.
- Composer context toggle: `[data-testid="chat-use-project-context"]`, `aria-pressed` state, defaults false; `[data-testid="chat-context-project"]` shows selected project.
- Global authority banner: `[data-testid="chat-global-project"]` → "Chat tools run through global project: <code>".
- Invalid project: `?project=<missing>` (or stored invalid) → `[data-testid="project-resolution-error"]` alert "Project context unavailable / The requested project is unavailable." + button "Clear project selection and use server default". ProjectProvider replaces the ENTIRE shell (no nav/trigger/settings). Recovery removes both localStorage keys + deletes URL param → reload → sole global resolves.
- localStorage keys: `ingenium_active_project` (selection), `ingenium_global_project` (global cache).
- Mobile: trigger ~195–322, settings gear 334–366, composer 206–306, all in 390px viewport; no overflow.
- Evidence: tests/artifacts/visual-qa/run-20260801-chat101/interaction.json

## ux-002 — 2026-07-19T20:54:00Z

| # | Step | Error | Attempt | Resolution |
|---|------|-------|---------|------------|
| 1 | Navigate to /chat @ 390x844 | ✅ No JS errors — page loads cleanly | 1/1 | — |
| 2 | Measure main region width vs viewport | `<main>` computed width = 435px on 390px viewport (45px overflow). Grid parent is 390px. **Root cause**: `<main>` grid item lacks `min-width: 0` (grid default is `min-width: auto`). Content intrinsic width > 390px forces grid item expansion. | 1/3 | Add `min-w-0` Tailwind class to `<main>` element (currently `class="p-0"`) |
| 3 | Identify overflow children | 19 elements overflow past 390px. Header toolbar, mobile select row, input area all stretch parent. Body `overflow-x: hidden` clips visually but content is cut off. | 1/1 | `min-w-0` on `<main>` would constrain all children |
| 4 | Check actionable content clipped | **"Compact conversation" button** (x=391, right=419) — clipped. **"Select agent" dropdown** (right=419) — clipped. **Send message button** (right=406) — partially clipped. **Share button** (right=387) — barely fits. | 1/1 | Issue confirmed — these elements are not fully usable at 390px |

### Summary
UX-002 is **CONFIRMED REPRODUCIBLE**. Overflow source: `<main class="p-0">` is a grid child without `min-width: 0`. CSS Grid default `min-width: auto` allows the grid item to expand to 435px despite its 390px grid column. Actionable content (Compact button, Agent selector, Send button) is clipped. Body-level `overflow-x: hidden` masks but doesn't fix.

## chat-100 — 2026-07-31T18:40:00Z (browser prep for passive visual QA, PASS)

| # | Step | Error | Attempt | Resolution |
|---|------|-------|---------|------------|
| 1 | Run setup script via wsl-chrome-connect.sh | Wrapper hung 150s, no output. Root cause: dev-browser QuickJS runner does NOT await async IIFE / `.then()` chains — only top-level `await` is awaited. Script's IIFE promise never completed, leaving the CDP connection dangling | 1/3 | Rewrote script as flat top-level-await body (no IIFE, no .then). Confirmed with db-probe3: top-level `await browser.listPages()` prints, `.then()` callback never runs |
| 2 | Install persistent interception | `p.addInitScript` (string AND function forms) fails: `QuickJS function "__transport_receive" failed: expected object, got undefined`. The dev-browser bridge cannot serialize init scripts | 2/3 | Use CDP directly: `p.context().newCDPSession(p)` → `Page.enable` → `Page.addScriptToEvaluateOnNewDocument({ source })`. Durable per-target across navigations; verified via db-probe5 (`K4:addScript-ok`) |
| 3 | Keep Chrome alive between invocations | Wrapper launches Chrome as a bash child; bash-tool kill takes Chrome down with it (CDP_NOT_REACHABLE) | — | Launch detached via `powershell Start-Process chrome.exe --remote-debugging-port=9222 --user-data-dir=C:\Users\james\AppData\Local\Temp\chrome-debug --no-first-run`; wrapper then reuses it. Verified: `H1` handoff check across a fresh invocation — tab + patch persisted, PASS |

### Working recipe knowledge (dev-browser bridge, verified 2026-07-31)
- Scripts MUST use top-level `await`; never wrap in `(async () => {})()` or rely on `.then()` output.
- `addInitScript` is broken on this dev-browser build — use CDP `Page.addScriptToEvaluateOnNewDocument` for persistent per-tab page scripts.
- `p.evaluate` accepts both string and function forms (functions fine); `p.route` registers OK; `p.context().newCDPSession(p)` + `cdp.send(...)` works.
- `/chat` data flow: `GET /api/v1/opencode/sessions?directory=/workspace` → `{ data: OpenCodeSession[] }`; messages `GET /api/v1/opencode/sessions/<id>/messages` → `{ data: OpenCodeMessage[] }`. `use-opencode-sessions.ts` auto-creates a session (server mutation) when the list is empty — interception must return ≥1 session.
- Empty conversation renders `[data-testid="chat-empty-state"]` (no `chat-messages-container` when empty). Context toggle: `[data-testid="chat-use-project-context"]`. Sidebar titles: `[data-testid="session-sidebar"] li span.truncate`.

## ui-102 — 2026-08-01T00:00:00Z (ROADMAP UI-102 active browser acceptance — BLOCKING)

| # | Step | Error | Attempt | Resolution |
|---|------|-------|---------|------------|
| 1 | Docs PageTree action menu @ 390x844 | Clicking "⋯" page-action button inside the mobile tree drawer closes the drawer and renders the menu off-screen (box left=-156, right=-28). Menu unusable/invisible. | 1/1 | **Root cause**: DocsShell.tsx line 325 wraps the drawer tree in `<div onClick={() => setTreeDrawerOpen(false)}>{tree}</div>` — the DropdownTrigger click bubbles and closes the drawer; the absolute right-0 panel lands off-canvas. Fix target: stop propagation on the action-button click or move the close-drawer handler to a treeitem/select handler. |
| 2 | TaskDetail mention/dependency search | Not reachable — project global-default has 0 tasks; opening TaskDetail requires selecting a task (none exist) and creating one is mutating/OUT_OF_SCOPE | — | Recorded as data-state limitation; a11y contract verified from source (TaskDetail.tsx lines 765-903) |
| 3 | Mail account menu | Not available — 0 email accounts configured; page renders AccountSetup only | — | Recorded as not-available (configuring account = mutating/OUT_OF_SCOPE) |
| 4 | Docs Tags autocomplete options path | Suggestions always empty — only 2 tags exist and both are on every page; filter excludes existing tags | — | Data-state limitation; combobox contract verified; shared useListboxNavigation option path proven via SearchDialog |
| 5 | Rapid navigation rate limiting | 429 Too Many Requests on docs/tasks API during fast test cadence (Nginx 30r/s) | — | Test artifact; paced loads ≥12s apart resolved. Clients degrade gracefully |

### Summary
UI-102 interaction matrix: 7/9 controls PASS at desktop+mobile. 1 BLOCKING (PageTree action menu mobile). 2 not-reachable data states. No nested-interactive console errors, no viewport overflow anywhere. Evidence: tests/artifacts/visual-qa/run-20260801-ui102-dropdowns/active-interactions.{json,md}

### ui-102 recheck — 2026-08-01 (RESOLVED — deployed fix verified, PASS)

The BLOCKING row above was re-verified against the deployed `/docs` at 390x844 after the writer fix. **PASS**:
- Drawer stays open when page-action trigger opens (`aria-hidden=false`, `pointer-events=auto`)
- Menu fully in viewport (box left=132 right=260 top=293 bottom=431 within 390x844); ArrowDown/Home/End/typeahead('r') all work; Escape closes with focus return to trigger; drawer remains open
- Outside click inside drawer outside menu closes only the menu; URL unchanged (no mutation)
- Page selection marker (`[data-page-tree-select]`) closes the drawer (intended close-on-select)
- No nested-interactive/overflow console errors (only benign 404 draft probe)
- Evidence updated: tests/artifacts/visual-qa/run-20260801-ui102-dropdowns/active-interactions.{json,md}

## vscode-101/102 — 2026-08-01T23:40:00Z (deployed acceptance, STOP-with-defects)

| # | Step | Error | Attempt | Resolution |
|---|------|-------|---------|------------|
| 1 | Poll workbench frame readiness | First attempt looked up frame once before iframe existed → ready:false | 1/2 | Poll `p.frames()` INSIDE the wait loop, then evaluate `.monaco-workbench` presence; settled ~5.8s |
| 2 | Multi-step scripts (goto+poll+clicks+waits) | Script exceeded 30s dev-browser budget and was terminated | 1/2 | Split into single-purpose scripts; keep waits short; click workbench elements in separate calls |
| 3 | Template literal `${...}` inside `frame.evaluate` body | QuickJS SyntaxError 'expecting }' | 1/1 | Never nest `${...}` template literals inside evaluate strings; use plain concatenation |
| 4 | Drive popup/new-tab from "Open directly" | `browser.getPage(name)` threw "name must be non-empty" — popup tab had name:null; waitForEvent('popup') bridged unreliably | 2/3 | Poll `browser.listPages()` for the new tab and use `browser.getPage(id)`; close via page handle `.close()` |
| 5 | Close terminal panel via Toggle Panel titlebar button | Playwright click actionability timeout ×2 (element at known coords, not actionable — overlay/pointer-events quirk) | 2/3 | `frame.evaluate(() => document.querySelector(sel).click())` on the real button — toggle succeeds |
| 6 | Keyboard events into iframe | `page.keyboard.press` after `frame.focus()` did not change activity-bar selection (events not routed into frame by bridge) | 1/2 | Bridge limitation, not product. Verified roving tabindex + role semantics instead; recorded a11y defect from DOM |
| 7 | Click activity tab by aria-label | Tabs have empty aria-label → `[aria-label*="Extensions"]` selector failed/timed out | 1/2 | Click by codicon class: `.activitybar [role="tab"] .codicon-extensions-view-icon` |
| 8 | Measure iframe from inside frame | `document.querySelector("iframe")` inside frame context returned nothing (iframe is in parent doc) | 1/1 | Measure parent-page iframe rect from parent context; frame measures its own viewport |

### Working recipe knowledge (verified 2026-08-01, deployed /vscode + vscode.localhost)
- Wrapper route `/vscode` (Dashboard WORKSPACE group): page title "Ingenium Dashboard"; iframe `src="http://vscode.localhost:3000/"`, `title="VS Code"`, `allow="clipboard-write"`, no sandbox; iframe fills content area below dashboard sidebar (224px). "Open directly" link: `href="http://vscode.localhost:3000/" target="_blank" rel="noopener noreferrer"`.
- Direct origin redirects `http://vscode.localhost:3000/` → `?folder=/workspace`; workbench title "Welcome - workspace - code-server"; runs code-server.
- Durable readiness: `.monaco-workbench[role="application"]` (visible) + `[role="tablist"][aria-label="Active View Switcher"]` + `[role="status"]`; ~6s to ready; aria-label on workbench is null.
- Activity bar: `.activitybar [role="tab"]`, identifiers via codicon classes (`codicon-explorer-view-icon`, `codicon-search-view-icon`, `codicon-source-control-view-icon`, `codicon-run-view-icon`, `codicon-extensions-view-icon`); roving tabindex 0/-1; aria-selected on active.
- Menubar: compact overflow-only — `.menubar .menubar-menu-button` (role=menuitem, aria-haspopup=true) opens dropdown with File/Edit/Selection/View/Go/Run/Terminal/Help; menu items `.monaco-menu-container .action-label` matched by exact text. Terminal: "Terminal" → "New Terminal" opens panel (tabs PROBLEMS/OUTPUT/DEBUG CONSOLE/TERMINAL/PORTS, `.terminal-groups-container`). Close: `.titlebar .action-label[aria-label*="Panel"]` via programmatic click.
- Title bar UI buttons: `[aria-label="Toggle Panel (Ctrl+J)"]`, `[aria-label="More Actions"]`, `[aria-label="Customize Layout..."]`.
- Extensions view: `.extensions-viewlet`, search input `input[type='search']`, rows `.monaco-list-row`, sections INSTALLED/POPULAR from Open VSX (16139 popular). Statusbar: "Restricted Mode" (workspace trust unset), "Layout: US".
- Mobile 390px: wrapper nav via `[aria-label="Open navigation menu"]` / `[aria-label="Close navigation"]`; workbench keeps activity bar LEFT (48px), sidebar 170px; no horizontal overflow.
- Known console noise (product defects, see interaction.json): vsda.js/wasm 404; CSP frame-ancestors blocks webWorkerExtensionHostIframe (chrome-error frame persists); open-vsx copilot-chat 404.
- Test caveats: use `browser.getPage(id)` for unnamed popups; never `${}` template literals inside evaluate; split scripts < 30s; clicks on workbench elements sometimes need programmatic el.click().
