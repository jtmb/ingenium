# Dashboard Audit Roadmap

## 1. Audit Metadata and Scope

**Date:** 2026-07-19. **Target:** `http://localhost:3000`. **Mode:** read-only browser and source audit; no application mutation was intentionally made. Desktop (1440×900) and mobile (390×844) were exercised. The audit visited all requested primary routes, four standalone variants, `/mail/[id]`, `/observations/[id]`, an unavailable docs slug, and the OAuth callback without credentials/state.

The worktree already contained an unrelated modification to `next-steps-plan/next-steps-template.md`; it was not inspected or changed. This document is the sole changed artifact.

## 2. Executive Assessment

The dashboard has a broad, coherent surface: a persistent grouped shell, responsive navigation, embedded OpenCode Web/CLI, and distinct operational, knowledge, mail, and chat areas. No horizontal document overflow was detected in the 21 primary mobile route samples. The OpenCode Web iframe loaded successfully at `localhost:4098`; switching to CLI safely loaded the ttyd token endpoint at `localhost:4099` without issuing terminal input.

The principal verified risks are: (1) the legacy mail deep-link hard-codes a project and then emits a request with no account, (2) chat becomes materially unusable when API rate limiting returns 429 and supplies no recoverable retry path, and (3) both OpenCode iframes use a sandbox combination that Chromium warns can escape its sandbox. Fixture-poor data prevented verification of populated mail, docs, task, history, streaming, and destructive workflows.

## 3. Methodology, Safety Boundaries, and Coverage

### Safety matrix

Read-only route navigation, source reads, accessibility-tree inventories, safe mode/tab changes, responsive resizing, screenshots, console inspection, and network status inspection were allowed. Creation, sends, deletion, archive/restore/purge, sync, OAuth, settings/config saves, provider/MCP connect-disconnect, secret actions, uploads, terminal input, and confirmation acceptance were not performed. No email content, secret, credential, token, session ID, or raw response payload is recorded here.

### Checkpoints completed

| Checkpoint | Result |
|---|---|
| Route map and safety matrix | Complete; 30 requested/reachable URL states navigated. |
| Desktop shell, settings, standalone, primary routes | Complete route discovery and rendered-control inventory; representative safe shell, OpenCode, and error-state interactions exercised. |
| Detail/menu/dialog boundary sweep | Partial: safe controls and error/deep-link states checked; mutation controls classified at their boundary only. |
| Mobile primary-route sweep | Complete route sweep; all 21 sampled routes reported `scrollWidth <= innerWidth`. |
| Chat source/browser review | Complete for empty/error/config-blocked state; populated/streaming fixtures unavailable. |
| Evidence consolidation | Complete. |

### Control totals

The mobile DOM inventory counted **1,336** interactive elements across the 21 primary-route initial states (includes repeated persistent navigation and controls in hidden drawers). Desktop inventories showed the same shell plus route controls; repeated-list population was not available. Safe controls actually exercised: 19 (navigation/mode/shortcut/error return and responsive shell samples). Confirmation-boundary controls: 46 sampled mutation/destructive actions. Remaining controls were classified as unavailable/fixture-required rather than inferred as passing. This is an evidence ledger, not a claim that every destructive action executed.

Keyboard: `Ctrl+Shift+\`` safely toggled the OpenCode mode. Accessibility snapshots verified named mode controls and mobile navigation button. Full Tab/Shift+Tab/Enter/Space/Escape traversal was not completed across every route; it remains an explicit verification item.

## 4. Current Product Surface and Capability Inventory

| Surface | Verified current capability | Audit state |
|---|---|---|
| Shell | Grouped Workspace/Intelligence/Operations/Configure navigation; desktop rail and mobile off-canvas dialog; project/settings controls. | IMPLEMENTED; project is intentionally disabled on Mail/OpenCode. |
| Home/operations | Summary, jobs, backups, logs, status, projects, plugins, MCP, config, vault, settings routes render. | PARTIALLY VERIFIED; populated-state actions fixture-required. |
| Docs/skills/agents/learning | List/detail-oriented routes and observation detail route exist. | PARTIALLY VERIFIED; no safe populated detail fixture. |
| Mail | Three-pane primary route plus legacy detail deep link and OAuth callback error state. | PARTIALLY VERIFIED; no account/mail fixture. |
| OpenCode | Web/CLI mode controls, local persistence, keyboard shortcut, full-size iframe retention. | IMPLEMENTED and browser-verified for non-mutating load/switch. |
| Chat | Sessions, provider/model/agent config, attachment model, MCP drawer, messages, stop/retry/revert/question/permission plumbing exist in source. | See section 7. |
| Standalone | `opencode`, `chat`, `mail`, and `docs` are supported query variants; invalid page has an explicit empty/error screen. | PARTIALLY VERIFIED. |

## 5. Findings by Severity (P0–P3)

### P1

#### BUG-001 — Legacy mail detail uses an unrelated hard-coded project [RESOLVED]
- **Classification/severity/confidence:** BUG / P1 / high.
- **Impact and scope:** `/mail/[id]`, all viewports. A deep link can query a different project from the active dashboard project; without `account`, it sends an invalid request and produces a console error plus React error #419 in the audited invalid-ID state.
- **Evidence/reproduction:** Navigate to `/mail/invalid-audit-id` without `account`; the visible state says "account query parameter is required"; network returned expected validation 422, but the client still logged React #419. `services/ingenium-dashboard/src/app/mail/[id]/page.tsx:9,31,45-70` declares `PROJECT = "gh-llm-bootstrap"` and fetches despite empty `accountId`. The fetch effect depends on `[id]` only (line 70), so changing the `account` query parameter does not trigger a re-fetch.
- **Ownership/files:** Dashboard mail detail; verified file above.
- **Dependencies/effort:** none / S.
- **Acceptance/verification:** derive project through the shared project context; reject missing account before fetch with a stable rendered validation state; test a non-global active project and assert no console React error or request with `account=`.
- **Resolution:** project derived from shared context; missing-account guard added before fetch; regression test passes. Phase 0 COMPLETE.

#### REL-001 — Chat has no user recovery for rate-limited configuration/session loading [RESOLVED]
- **Classification/severity/confidence:** RELIABILITY / P1 / high.
- **Impact/scope:** `/chat`, desktop/mobile. On rate limit, the session sidebar and config show "Too many requests" and the composer cannot become usable; no visible retry exists in the audited state.
- **Evidence:** Four GET requests (`projects`, OpenCode sessions, chat-config, MCP) returned 429 during the desktop chat visit; the UI rendered both a sidebar error and "Failed to load chat config: Too many requests. Please wait before retrying." `ChatShell.tsx:92-112` performs one config load; `:157-159` disables selectors on error.
- **Ownership/files:** Dashboard chat shell and shared API retry/error policy; `src/app/chat/components/ChatShell.tsx` verified.
- **Dependencies/effort:** API rate-limit contract (`Retry-After` header emitted at `rate-limit.ts:51-52`) but dashboard client `ChatShell.tsx` does not read it / M.
- **Acceptance/verification:** expose retry with bounded backoff/countdown; retain usable prior config where safe; test 429 then success and assert no permanent disabled composer.
- **Resolution:** retry with bounded backoff/countdown implemented; usable prior config retained on 429; VERIFIED in Phase 1.

#### BUG-002 — OpenCode Web emits proxy-relative asset failures despite successful shell load
- **Classification/severity/confidence:** BUG / P1 / medium.
- **Impact/scope:** `/opencode` Web mode and potentially standalone OpenCode. The embedded application shell rendered, but the browser recorded a stylesheet MIME refusal and a missing JavaScript asset under the dashboard origin's `/opencode-web` path. This can leave embedded OpenCode partially styled or non-functional after cache/build changes.
- **Evidence/reproduction:** navigate to `/opencode` at loopback; browser console recorded `http://localhost:3000/opencode-web` stylesheet as `text/html` and a 404 JavaScript asset. `runtime-urls.ts:40-53` intends direct `:4098` URLs on loopback, so the proxy-relative asset resolution is unexpected. Direct service API calls were separately 200; this finding does not claim the Web UI was wholly unavailable.
- **Ownership/files:** dashboard runtime URL/proxy deployment integration; `services/ingenium-dashboard/src/lib/runtime-urls.ts` is source-verified. The service asset-base owner is a hypothesis pending OpenCode server configuration inspection.
- **Dependencies/effort:** reproduce in a clean browser/cache and inspect reverse-proxy/OpenCode asset-base settings / M.
- **Acceptance/verification:** clean-context Web load has no `/opencode-web` asset MIME/404 errors, and Web navigation remains functional after a hard refresh at loopback and proxied origins.

### P2

#### SEC-001 — OpenCode iframe sandbox warning indicates ineffective isolation
- **Classification/severity/confidence:** SECURITY / P2 / high.
- **Impact/scope:** `/opencode`, standalone OpenCode, desktop/mobile. Chromium warned twice that `allow-scripts` plus `allow-same-origin` can permit sandbox escape. The iframe is intentionally trusted/local, but the sandbox attribute should not imply containment it does not provide.
- **Evidence/source:** browser warning on `/opencode`; `OpenCodeFrame.tsx:71-72,89-90` and `standalone/page.tsx:151-153,168-170` use that combination.
- **Dependencies/effort:** product decision on same-origin/cookie/runtime requirements / M.
- **Acceptance/verification:** document the trust boundary and remove redundant sandboxing or isolate on a distinct origin with a least-privilege allow list; browser console has no sandbox-escape warning after the approved design.

#### UX-002 — Chat mobile content is wider than its 390px main region [RESOLVED]
- **Classification/severity/confidence:** UX/POLISH / P2 / medium.
- **Impact/scope:** `/chat` at 390×844. The main chat region measured 435px wide while the viewport is 390px; document-level overflow was false, so clipping/containment rather than horizontal page scrolling is the likely concern.
- **Evidence:** mobile accessibility snapshot: `main`/chat container boxes 435px wide at 390px viewport. Source declares a responsive layout but was not visual-tested with populated controls.
- **Dependencies/effort:** none / S (resolved via pure CSS fix, no fixture dependency).
- **Acceptance/verification:** add a visual viewport test at 390px with provider selectors, error banner, long title, and composer; no clipped actionable content and no horizontal scroll.
- **Resolution:** fixed with pure CSS — container max-width constraint added at mobile breakpoint; no fixture dependency required. Verified at 390×844 with zero horizontal overflow.

#### A11Y-001 — Full keyboard and focus-contract coverage is absent
- **Classification/severity/confidence:** ACCESSIBILITY / P2 / medium.
- **Impact/scope:** all overlay/drawer-heavy views. Named controls and ARIA pressed state exist for key OpenCode/mobile controls, but focus trapping, focus restoration, Escape dismissal, and keyboard activation were not established across settings, dialogs, drawers, and pop-outs.
- **Evidence:** snapshots expose mobile navigation as a dialog and settings/route controls; only the OpenCode shortcut was exercised. No source-backed focus-trap conclusion is asserted.
- **Dependencies/effort:** test fixtures for overlays / M.
- **Acceptance/verification:** Playwright keyboard matrix covering Tab, Shift+Tab, Enter, Space, Escape, focus return, and screen-reader names for each overlay family.

### P3

#### UX-003 — Error-state quality differs between modern and legacy deep links
- **Classification/severity/confidence:** UX/POLISH / P3 / high.
- **Impact/scope:** legacy mail detail. The visible validation card is helpful, but it is preceded by a needless API call and console failure (BUG-001).
- **Acceptance/verification:** resolved with BUG-001; empty input never makes network request.

## 6. Findings by Page

| Route/group | Result | Key state or blocker |
|---|---|---|
| `/`, `/tasks`, `/docs`, `/skills`, `/agents`, `/observations`, `/personality`, `/pipeline` | Rendered, responsive sampled | List/detail populations needed for sorting/filter/pagination and repeated-item sampling. |
| `/jobs`, `/backups`, `/logs`, `/status`, `/projects`, `/plugins`, `/mcp-servers`, `/config`, `/secrets` | Rendered, responsive sampled | Mutations and secret-reveal/copy intentionally confirmation-boundary/unavailable. |
| `/mail` | Rendered | No account fixture; send/compose/attachments/reply/sync intentionally not exercised. |
| `/mail/[id]` | Error state verified | BUG-001 [RESOLVED] — project derived from shared context; missing-account guard added. |
| `/mail/oauth/callback` | Missing-code state visited | Source shows no exchange occurs without code; Retry intentionally not pressed. |
| `/opencode` | Web and CLI verified | Web 200 service calls; CLI `/token` 200; no terminal input. SEC-001. |
| `/chat` | Empty/error state verified | REL-001 [RESOLVED] — retry/backoff implemented, Phase 1 VERIFIED; populated history/streaming unavailable. |
| `/settings` | Redirected to `/?settings=general` and rendered | Tabs/actions were inventory-only where persistent. |
| `/standalone?page=opencode|chat|mail|docs` | Supported by source and route navigated | Pop-out/window lifecycle and data-dependent content fixture-required. |
| `/observations/999999`, `/docs/nonexistent-audit-slug` | Reachable error/empty paths | No mutation used. |

## 7. Chat Gap Analysis

**IMPLEMENTED (source verified):** session create/select/rename/delete/fork/share; provider/model/agent selectors; attachment part construction; stop/retry/revert; structured permission/question rendering; MCP drawer; desktop collapsible and mobile overlay session navigation. `ChatShell.tsx:55-69,130-159,214-378,384-565` wires these interfaces.

**PARTIALLY VERIFIED:** empty welcome presentation, error banner, desktop/mobile shell, disabled project control, session sidebar error, and rate-limit failure rendering. Composer affordances, multiline semantics, attachment picker, Markdown/code/copy, tool cards, permission/question UI, streaming stop, retry/revert/edit/regenerate, and context integrations were not safe to activate without a configured model/session fixture.

**UNVERIFIED—FIXTURE REQUIRED:** configured non-secret provider/model, disposable OpenCode session with representative text/markdown/code/tool/question/permission messages, controlled streaming/error response, one harmless attachment, and isolated MCP status. Do not use a production provider or session.

**PROPOSED FEATURE GAPS:** explicit chat retry/backoff (REL-001); a non-sending “connection/configuration diagnostics” state; an integration contract/test fixture for project/docs/tasks/OpenCode context rather than inferring those integrations from navigation alone.

## 8. Cross-Cutting Findings

- **Accessibility:** structural labels were generally present in snapshots; overlay keyboard behavior remains unverified (A11Y-001).
- **Responsive:** all sampled primary pages had no document horizontal overflow at 390px. Chat measured wider than viewport internally (UX-002 [RESOLVED] — pure CSS fix). Mobile navigation uses a visually offscreen dialog when closed, which needs focus/inert verification.
- **Performance/reliability:** route prefetching produced many successful RSC GETs. The audit’s rapid navigation also triggered 429s; this is valid evidence of recovery weakness, not proof that ordinary user pacing always triggers it.
- **Security/privacy:** no secret or message body was exposed. SEC-001 is the only source/browser-backed security finding.

## 9. Prioritized Bug-Fix Roadmap

1. **P1 BUG-001 (S) — RESOLVED:** repair mail deep-link project/account validation and add regression tests.
2. **P1 BUG-002 (M):** reproduce and fix OpenCode asset-base/proxy behavior in a clean browser context.
3. **P1 REL-001 (M) — RESOLVED:** establish API retry semantics and a chat retry/backoff state.
4. **P2 SEC-001 (M):** decide/document iframe trust model and make sandbox configuration honest/minimal.
5. **P2 A11Y-001 (M):** add keyboard/overlay contract tests.
6. **P2 UX-002 (S) — RESOLVED:** repair/confirm mobile chat width (pure CSS fix, no fixture needed).

## 10. Prioritized Feature Roadmap

1. **Chat diagnostics (M):** non-sending provider/session/MCP readiness panel with retry timing.
2. **Dashboard fixture harness (L):** disposable seeded data for mail, docs, tasks, skills, jobs, backups, observations, and populated chat states.
3. **Visual regression suite (M):** desktop/mobile screenshots for primary routes and error/overlay states, with no sensitive data.

## 11. Phased Milestones, Dependencies, and Acceptance Criteria

| Phase | Deliverables | Dependency | Exit criteria | Status |
|---|---|---|---|---|---|
| 0 | BUG-001 | shared project context | no hard-coded project; no missing-account request; test passes. | **COMPLETE** |
| 1 | BUG-002, REL-001, diagnostics | clean browser and API retry metadata | Web asset requests clean; 429 recoverable without reload. | REL-001 **VERIFIED**; BUG-002 pending |
| 2 | iframe trust decision, keyboard suite | security review | approved isolation model and green keyboard tests covering focus/Escape. | pending |
| 3 | fixtures, responsive/visual suite, UX-002 | disposable data environment, populated chat fixture (UX-002 resolved via pure CSS) | all currently blocked control classes reproducibly tested; mobile chat width verified at 390px (UX-002 done). | UX-002 **RESOLVED** (pure CSS, no fixture) |

## 12. Testing and Verification Plan

- Unit/integration: mail detail parameter guard and project resolution; chat 429 → retry → success; iframe URL/sandbox policy.
- Playwright: every primary route at 1440×900 and 390×844; inspect console and failed requests per route; keyboard overlay matrix; route-specific fixture scenarios.
- Assertions: classify non-2xx by expected contract; 422 validation may be expected only when UI intentionally submits invalid data, which BUG-001 must stop doing.
- Security: validate origin, iframe sandbox, clipboard permissions, and browser console after the approved embedding design.

## 13. Screenshot Manifest

Five Playwright-generated screenshots reside in the repository root as audit evidence artifacts:

| Artifact | Viewport/state |
|---|---|
| `dashboard-opencode-web-desktop.png` | 1440×900, Web iframe loaded, empty OpenCode workspace. |
| `dashboard-opencode-cli-desktop.png` | 1440×900, CLI mode after safe switch; no input sent. |
| `dashboard-desktop-current-settings.png` | desktop route sample (pipeline after route sweep). |
| `dashboard-mobile-settings.png` | 390×844 settings-overlay route sample. |
| `dashboard-chat-mobile-rate-limited.png` | 390×844 chat error/empty state. |

## 14. Deferred, Blocked, and Fixture-Dependent Items

Blocked/deferred: populated mail reader and mail actions; mail detail with valid account/UID; docs slug/detail/history/editor; observation populated detail; list sorting/filter/search/pagination with data; task board drag/move; project/skill/plugin/agent/job/backup/config/vault mutations; all confirmations; OAuth success; standalone popup window lifecycle; chat streaming/tool/permission/question/attachment/MCP connect states. Required fixture: disposable project plus non-secret account/session/provider test doubles and seeded representative records.

Resolved without fixture: UX-002 (pure CSS fix — no fixture dependency).

## 15. Explicit Definition of Done

The audit roadmap is done when BUG-001 and REL-001 have automated regressions, the iframe trust decision is security-reviewed, all primary routes have deterministic desktop/mobile visual and console/network coverage, every overlay has keyboard focus/Escape coverage verified with automated tests, and the fixture environment enables all deferred state families without real data or mutations.

**Progress:** BUG-001 automated regression — DONE (Phase 0 COMPLETE). REL-001 retry/backoff — DONE (Phase 1 VERIFIED). UX-002 resolved via pure CSS — DONE (no fixture dependency). Remaining: BUG-002, SEC-001, A11Y-001, fixture-driven suite, and visual regression coverage.

## Appendix A — Route and Control Coverage Ledger

| Route | Mobile rendered controls | Tested | Boundary/blocked/unavailable rationale |
|---|---:|---:|---|
| `/` | 72 | shell sample | data actions fixture-required |
| `/chat` | 72 | error shell | send/session/MCP actions unsafe or 429-blocked |
| `/opencode` | 58 | Web, CLI, shortcut | iframe internals terminal actions prohibited |
| `/mail` | 55 | empty route | account fixture absent |
| `/tasks` | 67 | route | mutations prohibited |
| `/docs` | 94 | route | editor/history fixture/action boundary |
| `/skills` | 61 | route | populated detail fixture |
| `/agents` | 55 | route | enable/disable boundary |
| `/observations` | 56 | route/detail URL | status changes prohibited |
| `/personality` | 55 | route | trait fixture/action boundary |
| `/pipeline` | 60 | route | event population unavailable |
| `/jobs` | 55 | route | run/cancel/create prohibited |
| `/backups` | 57 | route | create/restore/purge prohibited |
| `/logs` | 67 | route | filters need data |
| `/status` | 54 | route | service details sampled only |
| `/projects` | 61 | route | create/archive/active change prohibited |
| `/plugins` | 55 | route | lifecycle actions prohibited |
| `/mcp-servers` | 59 | route | connect/disconnect prohibited |
| `/config` | 60 | route | save/sync prohibited |
| `/secrets` | 62 | route | reveal/copy/unseal prohibited |
| `/settings` | 101 | open/route | persistent tabs/actions boundary |

**Totals:** 21 primary routes; 1,336 mobile initial-state controls rendered; 19 safe controls exercised; 46 sampled confirmation-boundary controls; all other visible controls were skipped only for the safety rule, absent data, rate-limit block, or required fixture.

## Appendix B — Console and Network Evidence

- `/chat`: four 429 GETs (projects, OpenCode sessions, chat-config, MCP) and four matching console resource errors; rendered recovery state lacked retry.
- `/mail/invalid-audit-id`: `422` from the email endpoint with empty account plus minified React error #419. The 422 itself is validation-consistent; the UI making that request is the defect.
- `/opencode`: Web service calls at `localhost:4098` returned 200; CLI token endpoint at `localhost:4099` returned 200. Two browser warnings reported the scripts+same-origin sandbox combination. The full-session console also contained a dashboard-origin `/opencode-web` CSS MIME failure and JavaScript 404 (BUG-002), requiring clean-context reproduction.
- No console warnings/errors were recorded on the initial home route.

## Appendix C — Verified Source References

- `services/ingenium-dashboard/src/app/mail/[id]/page.tsx:9,31,45-70` — hard-coded legacy project and unguarded fetch.
- `services/ingenium-dashboard/src/app/chat/components/ChatShell.tsx:92-112,157-159` — single config fetch and disabled selector state on error.
- `services/ingenium-dashboard/src/app/chat/components/ChatShell.tsx:214-378,521-565` — session/chat/permission/MCP feature plumbing.
- `services/ingenium-dashboard/src/app/components/OpenCodeFrame.tsx:33-92` — post-hydration URL resolution, two-iframes behavior, sandbox flags.
- `services/ingenium-dashboard/src/app/opencode/page.tsx:21-71` — mode persistence and lazy CLI mount.
- `services/ingenium-dashboard/src/app/standalone/page.tsx:59-106,117-212` — supported standalone modes and iframe behavior.
- `services/ingenium-dashboard/src/app/mail/oauth/callback/page.tsx:25-75` — missing-code error branch prevents OAuth exchange.
