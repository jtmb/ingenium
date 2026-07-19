---
title: Iframe Sandbox Baseline
description: Iframe sandbox configuration, risk assessment, and deferred security tokens for the Ingenium dashboard.
---

# Iframe Sandbox Baseline

> **Status**: Baseline implemented in W2 — all four OpenCode iframes have
> `sandbox="allow-scripts allow-same-origin"`. Expansion to service-specific
> tokens (forms, popups, modals, downloads) and CSP/frame-ancestor policy
> remain deferred pending runtime testing.
> **Last updated**: 2026-07-18

---

## 1. Current Sandboxed Setup

The dashboard embeds two iframes on the `/opencode` page, rendered by
`services/ingenium-dashboard/src/app/components/OpenCodeFrame.tsx`, plus two
additional standalone iframes in `services/ingenium-dashboard/src/app/standalone/page.tsx`.
**All four OpenCode iframes** have an identical sandbox configuration.

| Iframe | Source | Sandbox | Purpose |
|--------|--------|---------|---------|
| OpenCode Web (dashboard) | `Dynamic` (see below) | `allow-scripts allow-same-origin` | OpenCode Web UI |
| ttyd Terminal (dashboard) | `Dynamic` (see below) | `allow-scripts allow-same-origin` | OpenCode CLI via ttyd + xterm.js |
| OpenCode Web (standalone) | `Dynamic` (see below) | `allow-scripts allow-same-origin` | Standalone OpenCode Web UI |
| ttyd Terminal (standalone) | `Dynamic` (see below) | `allow-scripts allow-same-origin` | Standalone OpenCode CLI terminal |

### Dynamic Origin Resolution

The iframe `src` is **not hardcoded to localhost:4098/4099**. It is derived at runtime by `services/ingenium-dashboard/src/lib/runtime-urls.ts` based on the dashboard's own protocol and hostname. Resolution is deferred from SSR to post-hydration via `useState(null)` + `useEffect` (see the deferred URL resolution pattern in `OpenCodeFrame.tsx`), so the iframe renders without a `src` during SSR and never navigates to the SSR-proxy fallback before receiving the correct runtime URL:

| Dashboard Protocol | Web iframe src | CLI iframe src |
|-------------------|----------------|----------------|
| **HTTP** | `http://<dashboard-host>:4098/` | `http://<dashboard-host>:4099/` |
| **HTTPS** | `/opencode-web/` (same-origin proxy path) | `/opencode-cli/` (same-origin proxy path) |

Overrides are available via `NEXT_PUBLIC_OPENCODE_WEB_URL` and `NEXT_PUBLIC_OPENCODE_CLI_URL`. Under HTTPS, using `http://hostname:4098/` directly would be a mixed-content error, so a same-origin reverse-proxy path is used automatically.

### Current iframe attributes (both dashboard iframes)

```html
<iframe
  src="<dynamically-resolved>"    <!-- :4098/:4099 or /opencode-web//opencode-cli/ -->
  class="absolute inset-0 w-full h-full border-0"
  style="{{ opacity, visibility, pointerEvents }}"
  aria-hidden="{{ condition }}"
  tabIndex="{{ 0 or -1 }}"
  title="OpenCode Web"            <!-- or "OpenCode Terminal" -->
  sandbox="allow-scripts allow-same-origin"
  allow="clipboard-write"
/>
```

**Key observation**: The `sandbox` attribute with `allow-scripts` and
`allow-same-origin` tokens is the **baseline configuration** implemented
in W2. This prevents the iframe from accessing the dashboard's origin
while still allowing the embedded services to function:

- `allow-scripts` enables JavaScript execution (React, Monaco editor, xterm.js)
- `allow-same-origin` enables WebSocket connections, localStorage, and API
  calls within the iframe's own origin (dynamically resolved host:port or same-origin proxy)

**What the baseline sandbox prevents:**
- Access to the dashboard's cookies, localStorage, and sessionStorage
- DOM access to the embedding page (`window.top`, `window.parent`)
- Fetch/XHR requests as the dashboard origin
- Navigation away from the dashboard page

**What the baseline sandbox does NOT fully prevent:**
- If the embedded service itself is compromised, the attacker can still
  operate within the iframe's own origin (localhost:4098 or :4099)
- See [Risk Assessment](#6-risk-assessment) for details

### What's present — `allow="clipboard-write"`

The `allow` attribute enables the [Permissions Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Permissions_Policy)
`clipboard-write` feature. This lets OpenCode Web and ttyd write to the
clipboard (e.g., copy code blocks, terminal output). This is a legitimate
permission and should be preserved.

---

## 2. Sandbox Permissions Each Service Needs

### OpenCode Web (`:4098`)

OpenCode Web is a Next.js app that renders a rich web UI. It requires:

| Permission | Why |
|------------|-----|
| `allow-scripts` | Core JS execution for the web UI (React, event handlers, Monaco editor, etc.) |
| `allow-same-origin` | WebSocket connections back to its own origin for real-time communication; localStorage for session persistence; fetch to its own API endpoints |
| `allow-forms` | Form submissions (e.g., settings changes, prompts, login) |
| `allow-popups` | May open popup windows for OAuth flows, external links |
| `allow-modals` | `alert()`, `confirm()`, `prompt()` dialogs (may be used for confirmations) |
| `allow-downloads` | Downloading generated files, logs, exports |
| `allow-clipboard-write` | Copying code blocks (already granted via `allow` attribute) |

**Critical**: `allow-same-origin` is needed because OpenCode Web uses
WebSockets and localStorage within its own origin. Without it, the iframe
runs in an opaque origin and these features break.

### ttyd Terminal (`:4099`)

ttyd serves an xterm.js-based terminal emulator. It requires:

| Permission | Why |
|------------|-----|
| `allow-scripts` | xterm.js rendering, WebSocket for terminal I/O, keyboard event handling |
| `allow-same-origin` | WebSocket connection to ttyd's own origin for terminal multiplexing |
| `allow-forms` | Terminal input forms (if any) |
| `allow-clipboard-write` | Copy from terminal (already granted via `allow` attribute) |

---

## 3. Why Fully Sandboxing Breaks Functionality

A "fully sandboxed" iframe would use the most restrictive combination:

```html
sandbox=""  <!-- no permissions at all -->
```

This breaks both services completely:

| Service | What breaks |
|---------|-------------|
| **OpenCode Web** | No JS execution → blank page. No same-origin → WebSocket fails, localStorage unavailable. All UI interaction stops. |
| **ttyd Terminal** | No JS execution → xterm.js never loads. No same-origin → WebSocket fails. No terminal I/O possible. |

Even a moderately relaxed sandbox like `sandbox="allow-scripts"` (omitting
`allow-same-origin`) is problematic. Without `allow-same-origin`, the iframe
runs in a unique opaque origin:

- **OpenCode Web**: WebSocket connections to `localhost:4098` are treated as
  cross-origin and blocked. localStorage throws SecurityError. Fetch to
  same-origin API endpoints fails CORS preflight.
- **ttyd Terminal**: WebSocket to `localhost:4099` is blocked as cross-origin.
  The terminal connects but never receives output — displayed as a black
  screen.

**This is a fundamental constraint of iframe sandboxing, not a bug.** The
`allow-same-origin` token is deliberately gated behind explicit opt-in
because with it, the sandboxed content can still access its own origin's
storage and network resources within the sandbox constraints.

---

## 4. Current Sandbox Configuration vs. Desired Tokens

### Deployed Baseline (all four OpenCode iframes)

```html
<iframe
  src="<dynamically-resolved>"    <!-- :4098/:4099 or same-origin proxy path -->
  sandbox="allow-scripts allow-same-origin"
  allow="clipboard-write"
  ...
/>
```

Both OpenCode Web and ttyd use the **identical** `sandbox` token set in
the current baseline. This is a conservative starting point that ensures
both services function without breakage. The iframe `src` is resolved
dynamically by `runtime-urls.ts` — see [Dynamic Origin Resolution](#dynamic-origin-resolution) above.

### Tokens Baseline Already Deploys

| Token | Why Included |
|-------|-------------|
| `allow-scripts` | JavaScript execution for React, Monaco editor, xterm.js, WebSocket I/O |
| `allow-same-origin` | WebSocket connections, localStorage, fetch to own origin (`:4098`/`:4099`) |
| `clipboard-write` (via `allow` attr) | Copy code blocks, terminal output (Permissions Policy, not sandbox) |

### Tokens Deferred (Require Runtime Testing)

The following tokens from the [per-service analysis](#2-sandbox-permissions-each-service-needs)
have NOT been added to the baseline. Each requires proving the service
actually needs it via runtime testing before inclusion — adding sandbox
tokens is additive-only (safe to grant extra, breaking to remove).

| Token | OpenCode Web | ttyd | Risk of Omitting |
|-------|-------------|------|------------------|
| `allow-forms` | Form submissions (prompts, settings) | Terminal input forms | May break form submission if service relies on sandbox-restricted form behavior |
| `allow-popups` | OAuth flows, external links | Not needed | OAuth popups may fail to open |
| `allow-modals` | `alert()`, `confirm()`, `prompt()` | Not needed | Modal dialogs silently fail |
| `allow-downloads` | File exports, logs | Not needed | Download links do nothing |
| `allow-popups-to-escape-sandbox` | Deliberately excluded for security | Not needed | Popups remain sandboxed (security-positive) |

### Tokens Permanently Excluded

| Token | Reason |
|-------|--------|
| `allow-top-navigation` | Prevents iframe from navigating dashboard away |
| `allow-top-navigation-by-user-activation` | Not needed by either service |
| `allow-pointer-lock` | Not needed for web UI or terminal |
| `allow-orientation-lock` | Not needed |
| `allow-presentation` | Not needed |
| `allow-top-navigation-to-custom-protocols` | Not needed |

### Service-Specific Note: Email HTML Iframe

The email reader (`EmailReader.tsx`) uses a **separate** iframe with a
different sandbox policy:

```html
<iframe
  sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
  ...
/>
```

This iframe intentionally omits `allow-scripts` — email HTML should not
execute JavaScript. `allow-popups-to-escape-sandbox` is included so that
links in email bodies can open in the parent browser context (the user
expects links to work when clicking them in an email).

---

## 5. Testing Expanded Sandbox Tokens

The baseline (`allow-scripts allow-same-origin`) is already deployed and
verified. Any future expansion (adding `allow-forms`, `allow-popups`, etc.)
must be tested incrementally.

### Step 1: Add one token at a time

Modify the `sandbox` attribute in `OpenCodeFrame.tsx` for one iframe.
Start with ttyd (lower risk if it breaks). Example:

```diff
- sandbox="allow-scripts allow-same-origin"
+ sandbox="allow-scripts allow-same-origin allow-forms"
```

Test the specific feature the token enables before moving to the next
token. Adding tokens is additive-only — it never breaks existing
functionality (but may be unnecessary).

### Step 2: Check the browser console

Open DevTools on the dashboard page. If a token is missing that the
service actually needs, look for warnings like:

```
Blocked script execution in 'http://localhost:4098/' because the document's
frame is sandboxed and the 'allow-scripts' permission is not set.
```

```
Uncaught SecurityError: Failed to read the 'localStorage' property from
'Window': The document is sandboxed and lacks the 'allow-same-origin' flag.
```

```
WebSocket connection to 'ws://localhost:4099/...' failed: The operation is
insecure.
```

If the baseline tokens ever change to a more restrictive set (not
recommended), these errors will appear.

### Step 3: Test functional behavior

| Service | Test |
|---------|------|
| **OpenCode Web** | Type a prompt and submit. Verify the editor renders, response streams back, and code blocks can be copied. |
| **ttyd Terminal** | Type `ls` and verify output appears. Copy text from the terminal. Resize the browser window and verify xterm re-renders correctly (dimension zeroing bug). |

### Step 4: Test mode switching

Toggle between Web and CLI modes (click the glass tab or press
`Ctrl+Shift+\``). Verify:

- Inactive iframe is truly hidden (no visual artifacts)
- Active iframe is interactive
- Mode persists across page reloads (localStorage)

### Step 5: Regression test

After any sandbox token change, verify the `/opencode` page still works:

1. Navigate to `/opencode` from the nav bar
2. Switch modes several times
3. Open DevTools and confirm no console errors from either iframe
4. Verify the ProjectDropdown is disabled on this page (per nav bar spec)

---

## 6. Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| ttyd is exposed on host loopback only (`127.0.0.1:4099`) | Low | Already isolated. Sandbox adds defense-in-depth. |
| OpenCode Web is exposed on host loopback only (`127.0.0.1:4098`) | Low | Same as above. |
| `allow-same-origin` + `allow-scripts` together allow the iframe to operate within its own origin | Medium | Mitigated by: (a) both services are on localhost only, (b) neither service stores sensitive tokens in localStorage (OpenCode uses an auth cookie scoped to its own port). The sandbox prevents access to the dashboard's origin but does NOT fully prevent compromise of the embedded service's own origin. |
| Dashboard is a management UI — compromise of dashboard origin is critical | High | The sandbox attribute prevents compromised embedded content from accessing the dashboard's cookies, localStorage, DOM, or making authenticated API calls as the dashboard. This is the primary value of the baseline sandbox. |
| Service-specific tokens (forms, popups, modals) not yet granted | Low | Features that need these tokens (OAuth popups, file downloads) may silently fail. No security impact — tokens are additive-only. |

---

## 7. Completed Work & Remaining Deferred Items

### ✅ Completed in W2

1. **Sandbox attribute added** to all four OpenCode iframes — both iframes in
   `OpenCodeFrame.tsx` AND both standalone iframes in
   `standalone/page.tsx`.
2. **Baseline tokens deployed**: `allow-scripts allow-same-origin` on all
   four OpenCode iframes.
3. **`allow="clipboard-write"` preserved** alongside sandbox attribute (via
   Permissions Policy, not sandbox).
4. **Identical baseline for both services** — same token set for OpenCode Web
   and ttyd, ensuring both function without breakage.

### ⏳ Deferred (Requires Runtime Testing)

1. **Service-specific sandbox tokens** — `allow-forms`, `allow-popups`,
   `allow-modals`, `allow-downloads` per the [per-service analysis](#2-sandbox-permissions-each-service-needs).
   Each token requires proving the service actually needs it before adding.
2. **Differentiated sandbox per service** — OpenCode Web (needs more tokens)
   vs. ttyd (needs fewer). Currently both use the same baseline.
3. **Content-Security-Policy headers** — `frame-ancestors` directive on the
   Express API responses, or on the opencode-web/ttyd backend responses, as
   an additional defense layer.
4. **CSP for the iframe responses** — nginx/Express CSP headers for
   opencode-web and ttyd responses, restricting what those services can load.
5. **Email HTML iframe sandbox audit** — the email reader's iframe currently
   uses a different, more restrictive sandbox (`allow-same-origin allow-popups
   allow-popups-to-escape-sandbox`, no `allow-scripts`). This should be
   reviewed for completeness.

### Testing Notes

- Test sandbox changes in both Firefox and Chrome — behavior is consistent
  but error messages differ.
- Adding sandbox tokens is **additive-only**: granting extra tokens never
  breaks existing functionality. Only removing tokens risks breakage.
- The email HTML iframe intentionally omits `allow-scripts` for security
  (email HTML should not execute JavaScript).
