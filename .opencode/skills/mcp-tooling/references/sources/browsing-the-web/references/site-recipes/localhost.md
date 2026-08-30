---
title: "localhost Site Recipe — Selectors, Patterns, Anti-Patterns"
impact: MEDIUM
impactDescription: "Proven browser automation patterns for the Ingenium dashboard on localhost"
tags: [site-recipe, localhost, ingenium, browser]
---

## localhost Site Recipe

**Base URL:** `http://localhost:3000`
**Last verified:** 2026-08-11

---

### Known Selectors

#### Search

| Purpose | Selector | Type | Verified |
|---------|----------|------|----------|
| Skills search | `input[placeholder="Search skills..."]` | Input | 2026-08-09 |
| Project search | `input[placeholder="Search projects..."]` | Input | 2026-08-09 |

#### Content/Results

| Purpose | Selector | Type | Verified |
|---------|----------|------|----------|
| Active project button | `button[aria-label^="Active project:"]` | Button | 2026-08-09 |
| Context project button | `button[aria-label^="Context project:"]` | Button | 2026-08-09 |
| Skill card opener | `button[aria-label^="Open skill"]` | Button | 2026-08-09 |
| Settings dialog | `[role="dialog"]` | Dialog | 2026-08-09 |

#### Interaction

| Purpose | Selector | Type | Verified |
|---------|----------|------|----------|
| Settings button | `button[aria-label="Settings"]` | Button | 2026-08-09 |
| Desktop settings view | `button[role="tab"]` | Tab | 2026-08-09 |
| Mobile settings view | `select[aria-label="Settings category"]` | Select | 2026-08-09 |
| Close proposal overlay | `button[aria-label="Close proposal overlay"]` | Button | 2026-08-09 |
| Project detail expansion | Button with exact text `Detail ▸` | Button | 2026-08-09 |
| Proposal tab opener | `[data-testid="tab-proposals"]` | Button | 2026-08-11 |
| Open proposal filter | `[data-testid="proposal-filter-open"]` | Tab | 2026-08-11 |
| History proposal filter | `[data-testid="proposal-filter-history"]` | Tab | 2026-08-11 |
| Proposal card | `[data-testid^="proposal-card-"]` | Button | 2026-08-11 |
| History pagination | `[data-testid="proposals-history-load-more"]` | Button | 2026-08-11 |
| Login email | `#login-email` | Input | 2026-08-16 |
| Login password | `#login-password` | Password input | 2026-08-16 |
| Login submit | Visible login form button (no `type` attribute) | Button | 2026-08-16 |
| Chat new conversation | `button[aria-label="New conversation"]` | Button | 2026-08-16 |
| Chat provider selector | `[data-testid="chat-header-provider"]` | Select | 2026-08-16 |
| Chat model selector | `[data-testid="chat-header-model"]` | Select | 2026-08-16 |
| Chat composer | `[data-testid="chat-composer"]` | Textarea | 2026-08-16 |
| Chat send | `[data-testid="chat-send-btn"]` | Button | 2026-08-16 |
| New project dialog | `input[placeholder="Project name"]` | Input | 2026-08-16 |
| MCP report summary | `[data-testid="mcp-report-summary"]` | Definition list | 2026-08-16 |
| MCP Tools tab | Visible `button[aria-pressed]` whose text starts with `Tools` | Button | 2026-08-16 |
| Vault passphrase field | Visible `input[type="password"]` on `/secrets` | Password input | 2026-08-16 |
| OpenCode retry | Visible button with exact text `Retry connection` | Button | 2026-08-16 |
| Runtime workspace radio | `input[name="runtime-workspace"]:not(:disabled)` | Radio | 2026-08-17 |
| Open workspace | Visible button with exact text `Open workspace` | Button | 2026-08-17 |
| MCP live report refresh | Visible button with exact text `Retry report` on the Tools tab | Button | 2026-08-17 |
| MCP report expected counts | `[data-testid="mcp-report-authorized-expected"]` | Text | 2026-08-17 |
| MCP report counts | `[data-testid="mcp-report-counts"]` | Text | 2026-08-17 |
| Vault eligibility guidance | Visible `[role="note"]` in the sealed `/secrets` modal | Note | 2026-08-17 |
| Empty-vault initialization dialog | `[role="dialog"][aria-labelledby="create-vault-title"]` | Dialog | 2026-08-17 |
| New vault passphrase field | `#create-vault-passphrase` | Password input | 2026-08-17 |
| New vault confirmation field | `#create-vault-confirmation` | Password input | 2026-08-17 |
| Create-vault action | Button with exact text `Create & Unseal Vault` inside the initialization dialog | Button | 2026-08-17 |
| Projects archived view | Visible button with exact text `Archived` | Button | 2026-08-17 |
| Mobile navigation opener | `button[aria-label="Open navigation menu"]` | Button | 2026-08-17 |
| Mobile navigation closer | `button[aria-label="Close navigation menu"]` | Button | 2026-08-17 |
| Account menu | `button[aria-label^="Account menu"]` | Button | 2026-08-17 |
| Settings Mail panel | `section[aria-label="Mail settings panel"]` | Panel | 2026-08-17 |
| Settings Mail OAuth inputs | `#mail-gmail-client-id`, `#mail-gmail-client-secret`, `#mail-outlook-client-id`, `#mail-outlook-client-secret` | Inputs | 2026-08-17 |
| Settings Mail safe actions | Visible buttons named `Show` and `Save OAuth Credentials` | Buttons | 2026-08-17 |
| Status service detail cards | `button[aria-label^="View "][aria-label$=" service details"]` | Button | 2026-08-17 |
| Status application detail cards | `button[aria-label^="View "][aria-label$=" application details"]` | Button | 2026-08-17 |
| Status main landmark | `main` | Landmark | 2026-08-17 |
| Status page heading | `h1` | Heading | 2026-08-17 |
| Status application heading | `h2` | Heading | 2026-08-17 |
| Secrets main landmark | `main` on `/secrets` | Landmark | 2026-08-18 |
| Empty-vault workspace markers | Exact text `Folders`, `Items`, `No folders yet.`, `No items in this folder.`, `Select an item to view details.`, `+ New Folder`, `+ New Item`, `Lock Vault` | Content | 2026-08-18 |

---

### Anti-Patterns

| Anti-Pattern | Detection Selector | Mitigation |
|-------------|-------------------|------------|
| Sweep-induced API rate limit | Response `429` from `/api/v1/projects` | Keep one page, close stale tabs, use batches of four or fewer, and cool down at least 60 seconds before recheck |
| No attached existing Chrome session for persistent-profile acceptance | `http://127.0.0.1:9222/json/version` returns `NOT_RUNNING` | Stop for persistent-session acceptance; for an explicitly authorized disposable run, launch the helper's isolated temporary profile and never reuse the normal profile |
| Absolute dev-browser storage-state destination | `writeFile` rejects an absolute or UNC path with `Absolute paths are not allowed` | Write the same minimal state to a relative dev-browser temp file, move it through WSL, then enforce mode `0600` and remove the temp copy |
| Benign Next RSC cancellation | Failed GET containing `?_rsc=` with `net::ERR_ABORTED` during navigation | Do not classify as a route failure unless an isolated settled navigation also fails |
| Benign document navigation cancellation | A root/document `GET` reports `net::ERR_ABORTED` while the isolated route settles at `200` with no console/page error | Record the safe path/status, do not retry the route, and classify it as a navigation cancellation rather than a product error |
| Progress-bar false positive | `[role="progressbar"]` on personality traits | Treat confidence meters as content, not loading; exclude `Upload Skill` from broad `class*="load"` matches |
| Hidden mobile settings tabs | Non-visible `button[role="tab"]` | Use the visible `select[aria-label="Settings category"]` on 390px viewports |
| Sensitive content exposure | `/secrets`, `/mail`, `/config`, Settings Mail/Config/Providers | Collect metadata/geometry only; do not save or print values, message bodies, or config text |
| Expired authenticated browser session | Repeated `401` responses from `/api/v1/auth/session` after deployment/reconnect | Stop before any gate interaction and request an authorized reauthentication; never submit or expose credentials from the browser agent |
| Atomic keyboard login with no captured POST | Valid login fields and enabled `form button:not([disabled])`, followed by native typing, Tab blur, and one real-button click, but no captured `POST /api/v1/auth/login` | Record `NO_LOGIN_POST_CAPTURED`, retain only validation/button metadata, and stop without a credential retry |
| Stale named page after reauthentication | A named page remains on the pre-login `429` document while a separate CDP tab is authenticated | Use the exact authenticated tab ID from `browser.listPages()` for all gates and close the stale tab; do not trust the page name alone |
| Persistent auth/rate-limit loop | After deployment expiry, both the existing tab and a fresh about:blank tab return repeated `401 /api/v1/auth/session` responses or nginx `429` with no login form, even after bounded cooldowns | Stop after three login attempts and escalate the deployment/proxy auth loop; do not repeatedly reload or submit credentials into a 429 document |
| Runtime workspace is session-scoped | Chat, MCP, or OpenCode shows `input[name="runtime-workspace"]` after a full navigation | Select the authorized workspace through the visible picker before read-only runtime checks; do not inspect other workspace content |
| Runtime-dependent Settings after full navigation | Providers shows `Native provider catalog unavailable` even after a workspace was started on another route | Start the authorized workspace from `/chat`, then open Settings → Providers without a full route navigation; verify runtime-backed provider/integration reads are `200` |
| Async Chat session creation | `button[aria-label="New conversation"]` returns before its async session creation/list refresh has selected the blank session | Wait for session-create/list requests and verify the active message area is empty before the one permitted synthetic send; never send while an older message is rendered |
| Connected input fill can retain stale controlled state | Repeated connected-browser form fills produce an unexpected value length | Reload the form, fill once, verify length only, and clear password fields after submission |
| Active project cards hide purge | Synthetic active card has Archive but no Delete button | Archive the run-owned project, switch to Archived, and use Delete only on that card |
| MCP report is loaded lazily | `[data-testid="mcp-report-summary"]` is absent on the Servers tab | Activate the visible Tools tab and wait for the report before reading counts |
| Normal OpenCode certificate trust | Failed request `/__ingenium/exchange` reports `net::ERR_CERT_AUTHORITY_INVALID` | Treat normal acceptance as failed; use an ignore-certificate-errors browser only as separately labeled diagnosis and never install/trust a certificate |
| Normal OpenCode runtime launch failure | `/api/v1/runtimes/browser/launch` returns `503` after workspace start and no iframe renders | Retry the visible connection control at most three times, log/escalate the bounded runtime blocker, and do not switch to a certificate-bypass browser for acceptance |
| Normal Chat workspace start failure | `/api/v1/runtimes/browser/workspaces/<id>/start` returns `503` after the visible `Open workspace` action and Chat has no composer/provider/model controls | Retry the visible workspace-list/start flow at most three times; retain the 503 as a blocker and stop before creating sessions or sending prompts |
| Chat reload loses isolated runtime binding | A normal `/chat` reload returns `input[name="runtime-workspace"]` even though the prior workspace start returned `200` and the runtime status was ready | Record the first post-reload picker/status evidence and do not generic-retry workspace start; stop functional mutations and continue only safe evidence/cleanup |
| Session cleanup requires recent step-up | Run-owned OpenCode session DELETE returns `403` with code `STEP_UP_REQUIRED` after a valid session CSRF grant | If an authorized credential is supplied through the supported flow, use step-up once, then retry only identified run-owned DELETEs; the browser agent must not enter credentials or broaden deletion scope |
| Step-up rotates dashboard CSRF | Visible Sign out immediately after step-up returns `403` while the session remains `200` | Reload the authenticated page to refresh the dashboard CSRF client state, then use the visible Sign out control once |
| OpenCode screenshot after layout inspection or DOM overlay | Connected Chrome can hang `page.screenshot()` when an iframe has just been resized and the page has undergone a geometry inspection or fixed overlay | Capture the masked iframe state immediately after the viewport resize; use opacity/background masking without injecting a stylesheet, then collect accessibility/layout metadata after the screenshot |
| OpenCode gateway health failure after exchange | Normal browser receives launch `201` and exchange `204`, then `ERR_FAILED` for runtime health and no iframe | Treat the normal-browser runtime gate as blocked after three bounded retries; do not bypass certificate validation or retry indefinitely |
| Runtime workspace project mismatch | The authorized workspace belongs to a different project scope, so the namespaced preference key is not persisted after start | Resolve the workspace project from the read-only workspace list, navigate with its project query, then select/start the workspace; record only opaque workspace digests and never output names or IDs |
| Runtime workspace ID is not its displayed label | The requested workspace ID may render a different project label in the picker, so text-only matching misses the target | Match the authorized `input[name="runtime-workspace"]` by its exact value from the user-provided target or a read-only list response; retain only an opaque digest |
| Runtime readiness required without a start mutation | Read-only `/api/v1/runtimes/browser/workspaces` returns the target with `status: "stopped"` and no runtime ID while the acceptance contract forbids `/start` | Do not click `Open workspace`; record the first stopped/no-runtime blocker and stop before Chat/session/Context/RAG mutations |
| Browser-level hard reload shortcut | `Control+Shift+R` sent through the connected page did not create a reload navigation entry | Use `page.reload({ waitUntil: "domcontentloaded" })`, then validate with a same-origin `fetch(..., { cache: "reload" })` and `Cache-Control: no-cache` |
| Unawaited async browser flow | Wrapper emits no script result when an async IIFE is started without top-level `await` | Use a top-level `await` for the single Playwright flow; do not retry a mutating request to diagnose wrapper output |
| Chat reload rate-limit loop | Rapid `/chat` reloads can settle without the composer and produce a 401/429 alert loop; this run retained the loop after the bounded cooldown | Keep one page, stop after three bounded attempts, cool down at least 60 seconds, retain console/network evidence, and do not send another prompt |
| Authenticated login screenshot redirect | An authenticated navigation to `/login` redirects to `/`, which can expose existing dashboard content in a screenshot | Do not retain the capture; delete it and apply a DOM content mask before saving desktop/mobile evidence |
| QuickJS TypeScript syntax | `as HTMLInputElement` in a page-context script fails before execution | Use plain JavaScript property access in dev-browser snippets |
| QuickJS URL constructor in wrapper redactor | `new URL(...)` can be unavailable in the Windows dev-browser wrapper context, collapsing safe paths to `[redacted-url]` | Redact paths with a string parser; keep path/method/status/resource type and redact every query value |
| Accessibility identity leakage | Shell account/project/agent names can appear in computed accessible names even when private main content is masked | Replace dynamic identity/resource names with `[redacted]` before retaining JSON; never include them in screenshots |
| Context project mismatch | Direct `/context?conversation=...` detail requests return `404` when the Chat persistence project is not the dashboard's current project | Read only project-aware conversation/checkpoint metadata using the project from the Chat link request; do not load message bodies for discovery |
| Strict vault eligibility | `/api/v1/vault/empty-reset` returns `403` while the sealed page exposes only `Unseal Vault` | Do not enter a vault passphrase or invoke reset; record the missing recovery action and protected eligibility response |
| Connected-wrapper screenshot path | `page.screenshot({path: "C:/..."})` did not create the expected Windows temp file | Capture the buffer with `page.screenshot()` and call `saveScreenshot(buffer, "<run-id>-<viewport>.png")`, then copy the returned temp file into the run artifact directory |
| Mobile status viewport overflow | `/status` at `390x844` reported `document/body.scrollWidth=393` and a 3px overflow from the visible navigation | Retain the content-free layout evidence and report the responsive defect; do not inject a CSS fix during acceptance |
| Vault eligibility without recovery action | `/api/v1/vault/empty-reset` returns `200` but the sealed modal still omits `Forgot passphrase / Reset empty vault` | Verify both the successful eligibility read and the visible recovery control; never infer eligibility from the status code alone |
| Protected handoff CORS/transport | Page-context `fetch` to a run-owned loopback broker returns status `0` under the dashboard CSP | Use an auxiliary run-owned broker tab with `waitUntil: "commit"` and response `.text()`; never put protected values in DOM inputs, screenshots, logs, or artifacts |
| Disposable helper process race | CDP `9222` and the exact `chrome-debug` profile remain after a child-PID cleanup pass | Identify the verified root Chrome process carrying `--remote-debugging-port=9222` and the exact `--user-data-dir`, kill its process tree, then verify both port and profile are absent |
| Destructive sequence exceeds connected-wrapper timeout | A 30-second wrapper timeout can occur after the reset request has already committed | Read only the final vault status to establish whether the reset completed; never retry a destructive endpoint, then finish logout and disposable-profile cleanup |
| Sign-out click waits on navigation | A connected `page.click` can remain pending while the dashboard assigns `/login` | Trigger the visible `Sign out` menu item, wait for navigation to settle, then make one session-status read |
| MCP catalog status must be literal | Live/Fresh MCP report renders `Catalog Unknown` while tool counts and disabled-tool evidence otherwise load | Record the literal catalog label as a blocker; do not coerce `Unknown` to `Conformant` from counts |
| Chat session reselects stale content after a blank send | Blank state is verified after `New conversation`, but the settled message rail contains the older user message plus the new prompt | Do not send again; record the exact post-send counts and stop because the one-turn/old-session invariance contract is broken |
| Stale Chat reselect survives process isolation | After all Chrome tabs/workers are killed, a quiet rate-limit window, a fresh profile, a 5-second blank-state hold, and a 6.5-second post-SSE hold, the old user message still reappears beside the new prompt | Preserve the metadata-only before/after context comparison, verify the new checkpoint separately, and treat the UI transcript contamination as a blocking product defect |
| Pointer-only detail cards | Visible `div`/`article` with `cursor: pointer`, `tabIndex=-1`, and no semantic role | Record as an accessibility finding; use nested named controls only for safe inspection |
| Stale proposal totals | Hard-coded proposal totals from an earlier snapshot | Read `/api/v1/skills/proposals/counts?project=ingenium` first; use its current `open`/`history` values for all pagination assertions |
| Page-context authentication transport | Connected form/input emulation can report valid fields while the response listener misses or obscures the login request | From the exact `/login` page, use one same-origin page-context CSRF GET followed by one page-context login POST; return only status/stable-code metadata and never retain secret arguments, body, token, or cookies |
| Page-context login without the dashboard marker | Same-origin CSRF GET succeeds but login POST returns `403` before pre-auth validation | Include the supported `X-Ingenium-UI: dashboard` marker on the same-origin login POST; retain only status metadata |
| QuickJS page-evaluator outer scope | A page-context callback cannot see wrapper variables such as `runTitles`, `opaque`, or a callback passed as a second evaluator argument | Pass serializable arguments explicitly into direct page evaluations; hash/redact identifiers outside page context and avoid callback-variable evaluator helpers |
| Runtime restart with an empty OpenCode session list | A normal retained-workspace start returns `202`, but the restarted runtime has no prior sessions and Chat's empty-list hook auto-creates one blank `New conversation` | Do not navigate to Chat when no new session is authorized; if the current run caused the blank session, identify it by its run-scoped creation metadata and remove only that run-owned blank record through the supported step-up flow |
| Runtime project omitted from context metadata | Read-only context queries without the runtime workspace `project` query returned empty/404 results even though Chat had persisted the turn | Resolve the authorized workspace project from the normal workspace list, then query project-scoped conversation summaries; inspect counts/checkpoints only |
| Chat controlled fill with no accepted turn | DOM fill plus one click left no user/assistant message even though the visible composer had been filled | After a verified blank New conversation, use native composer typing, verify value length and enabled send, click once, and wait for one assistant or stream error |
| OpenCode reload loses explicit workspace binding | A route reload returned the authorized workspace picker and no iframe before re-selection | Select the visible authorized workspace again, click `Open workspace`, then wait for the iframe and runtime health indicator |
| Chat reload idempotent context relink | Reloading an already linked Chat session can log one `409` from the `POST` context chat-session link while the UI remains stable | Classify it as a write-side relink conflict, not a normal-read failure; verify auth/context GETs are `200`, no `401/429` loop appears, and no alert is rendered |
| Accessibility snapshot object serialization | `page.snapshotForAI()` returns an object with the tree in `.full` | Serialize and sanitize `.full`; serializing only enumerable object fields can retain `{}` instead of the tree |
| Run-owned tab close race | `browser.closePage()` reports `page not found` after a tab disappears between list and close | Treat close as idempotent, then stop only the isolated run-owned Chrome/profile and verify the CDP port is closed |
| Default connected viewport | `window.innerWidth`/`innerHeight` differs from the requested desktop checkpoint | Call `page.setViewportSize({ width: 1440, height: 900 })` before the first desktop navigation/capture; set `390x844` explicitly for mobile |
| Offscreen translated mobile navigation controls | CSS-visible control rectangle lies wholly outside the viewport while the mobile drawer is closed | Keep CSS-visible page-state assertions, but count clipping/overlap only for controls intersecting the viewport and retain an offscreen-candidate count |
| Expected logout session rejection | Console reports the expected `401` from `/api/v1/auth/session` after visible Sign out | Mark only the post-logout session `401` as expected; keep all other HTTP/console/page errors unexplained until resolved |

---

### Navigation Patterns

#### Pattern: Dashboard route diagnosis

**Goal:** Navigate to a route and inspect its settled visual, DOM, accessibility, console, and network state without mutating data.

**Steps:**
1. Navigate directly to the route with `domcontentloaded`.
2. Wait for loading indicators to settle and allow lazy content to render.
3. Capture metadata-only DOM/accessibility/network evidence and a checkpoint screenshot.

**Wait strategy:** Wait for loading indicators to disappear, then allow a bounded quiet period for late requests.

**Example script:**
```js
const p = await browser.getPage("dashboard-diagnosis");
await p.goto("http://localhost:3000/", { waitUntil: "domcontentloaded" });
await new Promise((resolve) => setTimeout(resolve, 2000));
console.log(JSON.stringify({ title: await p.title(), url: p.url() }));
```

#### Pattern: Settings view diagnosis

**Goal:** Open the Settings overlay and select a view without invoking any save, connect, or other mutation control.

**Steps:**
1. Navigate to `/` and click `button[aria-label="Settings"]`.
2. At desktop, click the exact `button[role="tab"]`; at mobile, change `select[aria-label="Settings category"]`.
3. Wait for the view to settle and record the selected view, geometry, controls, and network evidence.

**Wait strategy:** Use the button flow on mobile; direct `/?settings=...` navigation can hang in the connected browser.

#### Pattern: Self-contained passive visual acceptance

**Goal:** Authenticate one isolated page-context session, sweep every current navigation route and Settings view at desktop/mobile sizes, and retain content-free evidence without starting a runtime or mutating resources.

**Steps:**
1. Navigate the exact `/login` URL, perform same-origin CSRF GET followed by one page-context login POST with `X-Ingenium-UI: dashboard`, and require CSRF/login/session `200`.
2. Visit routes in batches of four or fewer; mask main/private regions before screenshots and collect only safe geometry, counts, status, console, and network metadata.
3. For Chat/OpenCode/VS Code, leave the workspace picker untouched; for Mail/Secrets/Config/Providers, avoid content and mask the evidence region.
4. Open Settings from `/`; use visible desktop tabs and the mobile category select for every available view without save/connect/edit actions.
5. Logout through the visible account menu, require session `401`, close run-owned tabs/processes, and remove only explicitly run-owned handoff directories.

**Wait strategy:** `domcontentloaded` plus a bounded 1.1-second settle; keep route batches at four or fewer and treat settled `200` document cancellations as benign.

#### Pattern: Authoritative proposal pagination gate

**Goal:** Verify `/skills?project=ingenium` against current proposal totals without mutating data.

**Steps:**
1. Create one isolated page and navigate to `/skills?project=ingenium`.
2. Read the current counts endpoint; do not reuse a historical total.
3. Open Proposals, inspect unique open-card IDs, and open/close one detail card.
4. Move from Open to History with the keyboard, then activate `Load more history` with Enter until the control disappears.
5. Assert each keyset chunk is at most 25 rows, final unique IDs equal the current history count, and only counts/page/detail proposal endpoints returned.

**Wait strategy:** Poll settled card counts and loading state after each cursor page; record the cursor URLs and final disabled/absent Load more state.

#### Pattern: Authenticated acceptance shell

**Goal:** Attach to the disposable authenticated browser, verify the shell, then exercise only synthetic/read-only flows.

**Steps:**
1. Navigate to `/`; if redirected, wait for `form button:not([disabled])` before filling the login form.
2. After login, clear visible password inputs and keep the incognito CDP profile open only when passive QA is explicitly requested.
3. Visit primary routes in batches of four or fewer; collect status codes, visible alert counts, and principal geometry without reading sensitive bodies.

#### Pattern: Persistent-profile page-context authentication

**Goal:** Authenticate one run-owned persistent CDP profile and retain exactly one authenticated home tab without exposing credentials or tokens.

**Steps:**
1. Start the isolated persistent profile before invoking the CDP wrapper; never let the wrapper's fallback launch an incognito profile for this flow.
2. Navigate the existing tab to the exact `http://localhost:3000/login` URL.
3. In page context, perform one same-origin `GET /api/v1/auth/csrf`, then one `POST /api/v1/auth/login` with the returned CSRF token and `X-Ingenium-UI: dashboard`; return status codes only.
4. Navigate to `/`, require `GET /api/v1/auth/session` `200`, reconnect through a separate CDP invocation, and require the same session endpoint to remain `200`.
5. Close any extra tabs and leave one authenticated `http://localhost:3000/` tab.

**Wait strategy:** Require `200` for CSRF, login, and session before proceeding; use a fresh CDP connection for the persistence check and do not capture screenshots or response bodies.

#### Pattern: Minimal storage state and isolated Playwright verification

**Goal:** Export only the active localhost session cookie and prove it works in a separate Playwright context without mutating the application.

**Steps:**
1. From the authenticated home tab, read same-origin cookie metadata through the connected browser context and retain only the unexpired session cookie.
2. Write `{ cookies: [sessionCookie], origins: [] }`; do not include pre-auth, theme, runtime, provider, localStorage, IndexedDB, or other-origin data.
3. Create a fresh Playwright browser/context with exactly that storage-state path, navigate to `/`, wait for hydration, and require `/api/v1/auth/session` `200` plus the home heading.
4. Close the fresh verification context and leave the state file for QA.

**Wait strategy:** Validate Secure, HttpOnly, host-only `localhost`, Strict, `/`, and future expiry before writing; allow a bounded hydration wait after `domcontentloaded`.

#### Pattern: Chat synthetic turn

**Steps:**
1. Navigate to `/chat`; if `input[name="runtime-workspace"]` is visible, select it and submit `Open workspace`.
2. Click `button[aria-label="New conversation"]` before inspecting message nodes.
3. Assert provider/model option counts, fill `[data-testid="chat-composer"]`, click `[data-testid="chat-send-btn"]` once, and wait for `[data-testid="chat-assistant-message"]` or `[data-testid="chat-stream-error"]`.

#### Pattern: Scoped runtime workspace persistence

**Goal:** Start the authorized workspace under its own project scope and prove reload restoration without exposing workspace identifiers.

**Steps:**
1. Read the authorized workspace list and derive only an opaque project/workspace digest.
2. Navigate to `/opencode?project=<workspace-project>` and select `input[name="runtime-workspace"]:not(:disabled)`.
3. Click `Open workspace`, assert the namespaced preference key exists without reading its value, and wait for a non-zero `iframe[title="OpenCode Web"]`.
4. Use `page.reload` plus a cache-reload validation; require a 200 workspace revalidation, the same opaque workspace digest, no picker, and the restored iframe.

**Wait strategy:** Keep one page; allow the bounded runtime start poll to settle before the reload.

#### Pattern: Live MCP report evidence

**Goal:** Verify the current live report through the visible Tools and report-refresh controls without mutating tool state.

**Steps:**
1. Navigate to `/mcp-servers` with a unique UI cache-busting query.
2. Click the visible Tools tab and wait for `[data-testid="mcp-report-summary"]`.
3. Click the visible `Retry report` button exactly once; capture the request path/status and safe response metadata by wrapping page-context `fetch` before the click.
4. Assert Live/Fresh/Conformant, 230/27 authorized-visible counts, 227/0 reachability, one disabled, two extension-only, and the three not-applicable visibility rows.

#### Pattern: Read-only sealed Vault check

**Goal:** Verify vault eligibility and actionable guidance without entering a passphrase or invoking reset/unseal.

**Steps:**
1. Navigate to `/secrets` with a unique read-only query and wait for the sealed modal.
2. Read GET `/api/v1/vault/status` and GET `/api/v1/vault/empty-reset?project=...` metadata only.
3. Assert the password value length is zero, the eligibility response is 200, and either the visible note or reset action provides guidance.

**Wait strategy:** Wait for the modal's eligibility request to settle; never click a mutating control.

#### Pattern: Targeted status health acceptance

**Goal:** Authenticate through same-origin page-context CSRF/login, verify the control-plane status contract at desktop and mobile sizes, and retain content-free evidence.

**Steps:**
1. Navigate to the exact `/login` URL and perform one same-origin CSRF GET followed by one dashboard-marked login POST; require CSRF/login/session `200`.
2. Navigate to `/status` at `1440x900` and `390x844`; read only the `/api/v1/services/status` status shape and safe process/application names/states.
3. Require the five control-plane processes (`ingenium-api`, `ingenium-api-boundary`, `ingenium-dashboard`, `ingenium-gateway`, `restore-handoff`) to be running, `restore-maintenance` to be optional/stopped, and synthesis/email to remain application entries rather than Supervisor processes.
4. Capture screenshots immediately after each resize with `page.screenshot()` plus `saveScreenshot()` before geometry inspection; retain separate network, console, accessibility, and layout evidence.
5. Use the visible account menu's `Sign out`, require session `401`, close the run-owned browser/profile, and remove only run-owned Windows temp captures.

**Wait strategy:** Use `domcontentloaded` plus a bounded 2.2-second settle for the status poll; allow only expected navigation cancellations and the post-logout session `401`.

#### Pattern: Sanitized status accessibility evidence

**Goal:** Retain a content-safe accessibility tree plus landmark, heading, and focusability evidence for `/status` at desktop and mobile sizes without screenshots or application-resource mutation.

**Steps:**
1. Navigate to the exact `/login` URL and use same-origin page-context CSRF/login/session requests; retain status codes only.
2. Navigate to `/status`, set `1440x900` and `390x844`, and wait 2.2 seconds after each settled document.
3. Read `page.snapshotForAI().full`, sanitize dynamic identity/resource labels, and write the relative evidence file before copying it out of the dev-browser temp directory.
4. In page context, inventory visible landmarks, headings, named controls, and full focusable-control issues; record counts and booleans without reading control values.
5. Use the visible account menu's `Sign out`, require session `401`, close run-owned pages/processes, and remove only the run-owned profile/temp evidence.

**Wait strategy:** Keep one page per run, use the bounded 2.2-second status settle, and treat a disappeared tab during cleanup as idempotent after process/CDP verification.

#### Pattern: Authorized empty-vault reset and initialization shell

**Goal:** Run one explicitly authorized, one-page-context empty-vault reset and verify the first-run shell without creating a passphrase.

**Steps:**
1. Start a fresh disposable Chrome profile and navigate exactly to `/login`.
2. Authenticate only with same-origin page-context fetches; retain no credential, cookie, CSRF grant, or response secret.
3. Issue the session CSRF grant, perform one step-up, use only the rotated CSRF grant, seal the global vault, and read reset eligibility.
4. If eligibility is not exactly `{ eligible: true, reason: null }`, stop before reset and retain only the stable reason. Otherwise POST the exact reset confirmation once.
5. Read vault status and require sealed/uninitialized/initialize with no item or secret values.
6. Navigate to `/secrets`, verify the visible `create-vault-title` dialog and empty passphrase fields, and save only a modal-clipped initialization-shell screenshot.
7. Use the visible account menu's `Sign out`, require the session read to return `401`, close the page/process, and delete the disposable profile.

**Wait strategy:** Keep all API fetches in one page context. If the connected wrapper times out after a destructive request, perform only read-only status verification and never reissue the destructive request.

#### Pattern: Protected one-shot page-context handoff

**Goal:** Supply a protected bootstrap value to one same-origin page-context request without exposing it through form controls or retained browser evidence.

**Steps:**
1. Read the protected regular file through an `O_NOFOLLOW` descriptor and validate ownership/mode before retaining the value in process memory.
2. Use a one-shot run-owned Windows-local broker only as an in-memory transport; read its response body from an auxiliary tab at `waitUntil: "commit"`, then close that tab.
3. Pass the transient text directly as the argument to the target page's `evaluate` callback; clear the argument and close the run-owned browser/profile afterward.

**Wait strategy:** Never use page-context `fetch` to a cross-origin broker when dashboard CSP blocks it; never retry a destructive request after a wrapper timeout or ambiguous result.

#### Pattern: Run-owned project lifecycle

**Steps:**
1. Open `+ New Project`, create only `visual-qa-<timestamp>`.
2. Locate the synthetic card by exact text, click its card-local `Archive`, and confirm `Archive project`.
3. Switch to `Archived`, assert the synthetic name is present, click its card-local `Restore`, then assert it in `Active`.
4. Re-archive before purge: `Delete` is available only in the Archived view. Stop if the server returns `409` child protection; never delete child rows to force cleanup.

#### Pattern: Runtime-gated passive visual sweep

**Goal:** Start or resume the already authorized workspace once through the visible OpenCode picker, prove the runtime is ready, then collect route and Settings evidence without content or resource mutations.

**Steps:**
1. Use exact `/login` page-context CSRF/login/session requests and retain status metadata only.
2. Navigate to `/opencode`, choose the enabled `input[name="runtime-workspace"]`, click `Open workspace`, and wait for `OpenCode runtime connected` plus a non-zero `iframe[title="OpenCode Web"]`.
3. Capture OpenCode at both viewports immediately after each resize; mask the iframe without injecting a stylesheet, then collect metadata after the screenshot.
4. Wait at least 10 seconds between route/view transitions; open Settings from `/` and use desktop tabs or the visible mobile `select[aria-label="Settings category"]`.
5. Use normal account-menu `Sign out`, verify `/api/v1/auth/session` is `401`, and close the run-owned CDP/profile.

**Wait strategy:** Keep one page, mark the end of each captured state, and enforce a 10-second gap before the next transition. Do not refresh MCP reports or activate mutation controls.

#### Pattern: Read-only initialized empty-vault verification

**Goal:** Authenticate through the supported page-context CSRF/login flow and verify the unsealed, initialized, empty `/secrets` workspace without entering Vault credentials or invoking a Vault action.

**Steps:**
1. Navigate to the exact `/login` URL; perform one same-origin CSRF GET followed by one dashboard-marked login POST and retain status metadata only.
2. Read `GET /api/v1/vault/status?project=global-default`; retain only `initialized`, `sealed`, `nextAction`, and item/folder counts.
3. Navigate to `/secrets?project=global-default`, wait for the status/items/folders reads, and assert the empty workspace markers with no dialog, password field, sensitive value node, stale reset guidance, or alert.
4. Explicitly set `1440x900` and `390x844`; capture full-screen content-free screenshots before geometry inspection, then collect only viewport-safe layout and named-control counts.
5. Use the visible account menu's `Sign out`, require the normal session read to return `401`, classify that single post-logout `401` as expected, close the page, and remove only the run-owned CDP/profile/temp captures.

**Wait strategy:** Use `domcontentloaded` plus a bounded settle after each route/viewport change. DOM collectors run in page context; clipping counts include only controls intersecting the viewport, while CSS-visible below-fold workspace markers remain valid.

#### Pattern: Passive Settings → Config evidence

**Goal:** Verify the Settings-to-Config navigation and responsive shell without exposing or saving configuration content.

**Steps:**
1. From an authenticated non-Chat route, set `1440x900` or `390x844` and click `button[aria-label="Settings"]`.
2. Select the visible desktop `button[role="tab"]` named `Config`, or the mobile `select[aria-label="Settings category"]` with value `config`.
3. Click `Open Config Editor`, wait for `/config`, and require `#config-editor` with zero loading/skeleton markers.
4. Mask the editor and dynamic identity labels before `page.screenshot()`; inspect only overflow, unnamed-control counts, console/page errors, and network status metadata. Never click `Save` or `Sync from disk`.

**Wait strategy:** Use a bounded post-navigation settle; classify only document-level `net::ERR_ABORTED` prefetch/navigation cancellations as benign when the settled Config route has no failed responses or console/page errors.

---

### What Works / What Broke

| Date | Task | What Broke | What Worked | Updated By |
|------|------|------------|-------------|------------|
| 2026-08-09 | Comprehensive passive dashboard diagnosis | Fast multi-route sweeps hit `/api/v1/projects` 429; status detail returned 502; Settings Mail clipped below its fixed mobile dialog | Isolated route batches plus 60-second cooldowns; request URLs captured from `request().url()`; proposal history/detail and project detail opened without 404; project switch restored cleanly | browser-agent |
| 2026-08-09 | Mobile Settings navigation | Direct query/hidden-tab automation timed out or bypassed the visible mobile selector | Open Settings from `/`, then use the visible `Settings category` select | browser-agent |
| 2026-08-11 | Authoritative `/skills` proposal pagination gate | Historical History total 54 became stale while the current counts endpoint reported 57 | Both viewports passed with Open 9, History 57, keyset chunks 25/25/7, unique IDs equal to the authoritative count, no legacy/mutation/error/429 responses, and browser cleanup confirmed | browser-agent |
| 2026-08-16 | Authenticated full-dashboard acceptance preflight | Existing Chrome DevTools endpoint was not running, so the real session could not be attached | Checked `http://127.0.0.1:9222/json/version` before the wrapper and stopped without launching a new profile | browser-agent |
| 2026-08-16 | Authenticated acceptance: shell, settings, Chat, MCP, vault, and synthetic project | Login needed a CSRF-ready button and a fresh controlled form; Chat stream returned 401, context-link returned 404; MCP showed 230 rows/27 categories with a nonconformant report; OpenCode settled without an iframe; purge returned 409 child protection | Disposable incognito CDP profile, enabled-button login wait, new-conversation-first flow, Settings desktop/mobile selector flows, metadata-only vault check, step-up for the run-owned project, and archived-view purge guard | browser-agent |
| 2026-08-16 | Targeted authenticated recheck | Normal OpenCode failed certificate validation (`net::ERR_CERT_AUTHORITY_INVALID`); vault remained sealed without strict reset action; MCP was truthful but nonconformant at 230 tools/27 categories with `ingenium_project_set_global` unreachable; initial context detail probes used the wrong project | Chat SSE 200/200 with one 201 turn and one 200 checkpoint list (2 messages/1 checkpoint, unchanged after reload); Settings Providers had zero alerts and eight selects; ignore-cert diagnostic loaded one iframe but was not acceptance; no `visual-qa-*` project remained | browser-agent |
| 2026-08-16 | Final gates against newly deployed source | OpenCode launch returned `503` three times; final Chat send rendered the expected token in a session that still contained an older user message; MCP report stayed Live/Fresh but Catalog Unknown; vault eligibility returned `200` without a recovery action | Starting the runtime from Chat enabled a clean Providers overlay (0 alerts, 8 desktop selects); MCP showed 230 rows/27 categories, 0 unreachable, and disabled state as not-applicable; Projects showed no `visual-qa-*` entries in Active or Archived; no passphrase/reset/source mutation performed | browser-agent |
| 2026-08-16 | Latest-deployment acceptance recheck | Existing disposable Chrome session was no longer authenticated: repeated `/api/v1/auth/session` responses returned `401`, so no workspace, Chat, provider, MCP, vault, or project gate was run | Did not enter credentials or expose/store account data; captured content-free desktop/mobile auth-blocked checkpoints and stopped before mutating any resource | browser-agent |
| 2026-08-16 | Decisive final gates after authorized reauthentication | Normal OpenCode launched and exchanged tickets but runtime health failed twice with no iframe; Chat blank state reverted to an older user message after the single prompt and its SSE evidence probe initially had a DOM-selector error | Reauthenticated in the exact CDP tab with fields cleared; Providers passed desktop/mobile; MCP passed Live/Fresh/Conformant with 230 tools/27 categories and disabled not-applicable semantics; Vault returned eligibility `200` with actionable passphrase/lock explanation; Projects had no `visual-qa-*` entries; stale tab was closed and authenticated Projects was left open | browser-agent |
| 2026-08-16 | Proven final-gate recheck after another deployment expiry | Existing and fresh disposable tabs remained in a `401 /api/v1/auth/session` plus nginx `429` loop after bounded cooldowns; no login form appeared, so no acceptance gate could run | No credentials were submitted into the blocked documents; content-free desktop/mobile auth-blocked checkpoints were captured and the error record was retained | browser-agent |
| 2026-08-16 | Proven final gate after full disposable-process cleanup | Clean process/profile and quiet cooldown restored login, but normal OpenCode health still failed after exchange and Chat still reselected an older UI message after delayed refresh/events | Verified all Chrome descendants were gone before the quiet window; one fresh tab authenticated once; Chat SSE `200`, context turn `201`, unchanged pre-existing context rows, and one new two-message checkpoint were proven; Providers, MCP, Vault, and Projects passed without resource mutation | browser-agent |
| 2026-08-16 | Controlled Chat A→B isolation sequence | Fresh runtime exposed no prior UI message for session A, so the required A control turn could not be established; sending B still reproduced two settled user messages after delayed events | Used context summaries only to identify four older message-bearing conversations, preserved all pre-existing rows unchanged, and verified B's single two-message checkpoint without sending extra turns | browser-agent |
| 2026-08-16 | Keyboard-semantic exact-URL authentication proof | Fields validated and native typing/Tab/button semantics completed, but no captured `POST /api/v1/auth/login` was available | Recorded `NO_LOGIN_POST_CAPTURED` with content-free form state and stopped without retrying credentials | browser-agent |
| 2026-08-16 | Page-context authenticated gate run | Controlled login/form transport probes returned 401 or missed the response, and an unscoped Vault eligibility probe returned 404/400 | Exact same-origin page-context CSRF/login returned 200; explicit runtime workspace start enabled OpenCode iframe/health; native Chat typing produced isolated A/B turns and one newest two-message checkpoint; MCP 230/27 Live/Fresh/Conformant; project-scoped Vault read returned 200 without mutation; normal UI logout returned session 401 | browser-agent |
| 2026-08-16 | Final STOPPED-workspace acceptance run | Normal `/opencode` launch/health passed, but a full page refresh returned the workspace picker instead of preserving the iframe; MCP report remained Live/Fresh/Conformant with 230/27 rows/categories but runtime reachability was 0/227 | Transient page-context password reconstruction authenticated with CSRF/login/root/session 200; Chat A/B exact prompts produced isolated one-user/one-assistant turns, one new B checkpoint, delayed stability, and reload no-duplicate; Providers desktop/mobile, protected Vault guidance, Projects, screenshots, and normal-read network/console checks passed; sign-out returned session 401 | browser-agent |
| 2026-08-17 | Final exact-prompt acceptance recheck | STOPPED workspace launch/CHIPS health and all read-only pages loaded, but direct OpenCode refresh returned the picker and MCP runtime counts remained 0 reachable/227 unreachable after a read-only refresh | Same-origin transient page-memory auth passed; exact Chat A/B prompts produced separate one-user/one-assistant turns, one new B checkpoint, delayed stability, and reload no-duplicate; Providers desktop/mobile, Vault protected guidance, Projects, content-free screenshots, clean normal-read network/console, and normal UI logout passed | browser-agent |
| 2026-08-17 | Independent current-deployment gate run | Initial workspace list was scoped to a different project and had to be aligned; browser-level hard reload shortcut was ineffective; Chat B reload settled into a persistent empty/401/429 UI after three bounded attempts and a 60-second cooldown; authenticated `/login` redirected the first screenshot capture | Page-context CSRF/login/session 200 after a fresh settled `/login`; aligned workspace project produced a namespaced key, iframe, server-revalidated same workspace, and `page.reload` restore; Chat A/B native typing produced separate one-user/one-assistant turns and one two-message checkpoint before the reload blocker; Providers desktop/mobile zero alerts; MCP live refresh captured 200 Live/Fresh/Conformant 230/27 with 227/0 and disabled/extension-only not-applicable evidence; Vault eligibility/guidance and Projects active/archived no-visual-qa reads passed; only DOM-masked screenshots were retained | browser-agent |
| 2026-08-17 | Independent M106 authenticated acceptance run | First page-context login POST omitted the dashboard marker; an unnamed initial blank tab required native page close; the bounded A wait exceeded the wrapper timeout; Chat reload emitted one expected context relink `409` POST; response-event probing initially used the wrong member shape | Fresh incognito disposable profile after `9222` was confirmed unused; same-origin CSRF/login/session 200 with the dashboard marker; OpenCode authorized workspace start, localhost-root iframe, namespaced preference, cache-reload 200 revalidation, and automatic iframe restore; native Chat A/B exact turns, isolated B reload, 2-message/1-checkpoint context metadata, Providers desktop/mobile zero alerts, MCP 230/27 Live/Fresh/Conformant with 227/0 and 1 disabled/2 extension-only, Vault 200 eligibility/passphrase guidance without actions, Projects no `visual-qa-*` reads, final normal-read network clean, one authenticated tab, and masked screenshots | browser-agent |
| 2026-08-17 | Persistent-profile login/session retention | Initial CDP cleanup and readiness probes needed bounded PowerShell corrections; no site interaction failed | One new non-incognito profile at CDP `9222`, page-context CSRF/login/session `200`, post-reconnect session `200`, and exactly one authenticated home tab; no credentials, tokens, cookies, or screenshots retained | browser-agent |
| 2026-08-17 | Minimal storage state and isolated Playwright verification | Absolute dev-browser write paths were rejected; the first fresh-context home assertion ran before hydration | Relative temp write plus WSL move produced a `0600` minimal cookie-only state; fresh Playwright context used the exact state path, returned navigation/session `200`, rendered home after a 2-second wait, and closed while the original CDP browser remained available | browser-agent |
| 2026-08-17 | Gitignored QA storage-state handoff | None; the existing `tests/artifacts/` ignore rule was verified before creation | A unique ignored artifact directory was created with `0700`/`0600` metadata, only the required localhost session cookie and empty origins were copied, and a separate exact-path Playwright context verified session/home `200` before closing; source `/tmp` state and original CDP remained unchanged | browser-agent |
| 2026-08-17 | New self-contained supplemental visual acceptance | The inherited tab was not at the required login URL; bounded route/settings sweeps emitted benign `net::ERR_ABORTED` document cancellations | Exact `/login` page-context CSRF/login/session `200`; all 24 navigation routes and 19 Settings views passed at `1440x900` and `390x844`; mobile nav opened/closed with 24 named links; content-free screenshots retained; UI logout returned session `401`; run-owned Chrome/profile and handoff directories cleaned | browser-agent |
| 2026-08-17 | New self-contained passive evidence collection | Initial inspection needed helper serialization; wrapper URL parsing over-redacted paths; deployment intermittently returned settled `429` reads; unnamed inputs remained in accessibility snapshots | Fresh page-context CSRF/login/session `200`; four-or-fewer route batches plus cooldowns; string path/query redaction; masked route/settings screenshots; 24 routes × 2 and 19 settings views × 2 with 430 linked evidence files; normal logout `401`; CDP/profile/temp cleanup proved | browser-agent |
| 2026-08-17 | New final visual acceptance against current deployment | One-argument QuickJS evaluation was required; iframe screenshots could hang after geometry inspection; first logout returned CSRF `403`; OpenCode needed one explicit UI resume before the late mobile capture | Page-context CSRF/login/session `200`; runtime iframe READY/IDLE; 24 routes × 2 and 19 Settings views × 2 with 430 sanitized evidence files; 0 `429`, 0 settled HTTP errors, 0 console/page errors; Organizations mobile width and Settings Mail geometry recorded; final visible logout/session `401`; browser/CDP/profile cleanup proved | browser-agent |
| 2026-08-17 | Authorized empty-vault reset and initialization-shell verification | The first page-context attempt had an incorrect transient reconstruction; the corrected connected run exceeded the 30-second wrapper timeout after the destructive sequence, and tab-id page close did not report success | No destructive call was retried; read-only status proved the vault was sealed/uninitialized with `nextAction: "initialize"`; the initialization dialog and blank passphrase fields were verified; modal-only evidence was saved at `tests/artifacts/manual/2026-08-17/localhost-secrets-initialize-shell.png`; normal sign-out returned session `401`; Chrome/CDP and the disposable profile were removed | browser-agent |
| 2026-08-17 | Targeted `/status` control-plane acceptance | Initial result assembly had a variable typo; absolute screenshot paths were unsupported; the first evidence filters compared already-redacted paths incorrectly; mobile `390px` layout measured `393px` document/body width | Page-context auth returned CSRF/login/session `200`; desktop/mobile status API returned `200` with healthy overall state; exactly five required control-plane processes were running, optional restore maintenance was stopped, and synthesis/email were application-only; `saveScreenshot()` retained both PNGs; status-phase console/page errors and normal logout/session `401` passed; the 3px mobile overflow remains blocking | browser-agent |
| 2026-08-17 | Self-contained current-deployment `/status` acceptance | The legacy recipe glob alias was absent; PowerShell cleanup verification needed protected quoting; no page/layout defect occurred | Canonical localhost recipe selectors; page-context CSRF/login/session `200`; exact desktop `1440/1440` and mobile `390/390` document/body widths; no overflow, internal scrollbar, overlap, clipping, or hidden process labels; healthy status with five required processes running, stopped optional maintenance, application-only synthesis/email; status API `200`, no status-phase console/page errors, UI logout/session `401`, and disposable Chrome/CDP/profile cleanup proof | browser-agent |
| 2026-08-17 | Targeted `/status` accessibility and landmark evidence | The first landmark collector referenced an undefined placeholder; the first tree sanitizer omitted `.full`; one final tab-close race occurred; the full focusability audit reported hidden/offscreen DOM candidates | Page-context auth returned `200` for CSRF/login/session; sanitized `.full` trees retained 258 desktop and 115 mobile lines; both viewports had one main, named navigation, coherent h1→h2 order, and zero unnamed controls; landmark counts were 2 navigation, 1 main, 1 complementary, and 4 regions; logout/session `401`, isolated Chrome/profile/CDP/temp cleanup verified | browser-agent |
| 2026-08-18 | Vault initialization proving operation (bounded failure) | The generated async flow emitted no proving result after bounded wrapper attempts | Protected-file descriptor validation, exact disposable cleanup, and the safe stage-only result artifact were retained; no retry was made after the bound | browser-agent |
| 2026-08-18 | Authorized Vault initialization preflight | Initial transient owner reconstruction was mistyped; WSL loopback broker fetch was blocked; helper cleanup races left the disposable profile open; the bounded initialization flow returned an unsafe wrapper failure and read-only status remained sealed/uninitialized, so no screenshot was retained | Exact same-origin login/session/step-up returned `200`; the global vault precondition returned `200` with `initialize`; protected file checks passed; no folders/items/providers were created; logout/session `401` and exact-profile/CDP cleanup were verified | browser-agent |
| 2026-08-18 | Read-only authenticated initialized Vault visual verification | Initial DOM collectors ran in wrapper context; the helper defaulted to a non-requested desktop viewport; a translated offscreen mobile-nav control was initially counted as clipped; expected logout `401` was initially counted as a console error; one PowerShell temp-cleanup command expanded `$_` in WSL | Fresh isolated incognito profile; page-context CSRF/login/session `200`; Vault status `200` with initialized=true, sealed=false, nextAction=null, item/folder counts 0; `/secrets` empty workspace at both viewports with no sensitive fields/guidance/errors; exact 1440x900 and 390x844 content-free screenshots; zero unexpected HTTP/request/console/page errors; UI logout/session `401`; CDP/profile/temp cleanup verified | browser-agent |
