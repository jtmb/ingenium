# Iframe Sandbox Evaluation

> **Status**: Investigation (Phase 4). Implementation deferred to Phase 5.
> **Last updated**: 2026-07-16

---

## 1. Current Setup (Unsandboxed)

The dashboard embeds two iframes on the `/opencode` page, rendered by
`services/ingenium-dashboard/src/app/components/OpenCodeFrame.tsx`:

| Iframe | Source | Purpose |
|--------|--------|---------|
| OpenCode Web | `http://localhost:4098/` | OpenCode Web UI |
| ttyd Terminal | `http://localhost:4099/` | OpenCode CLI via ttyd + xterm.js |

### Current iframe attributes (both iframes)

```html
<iframe
  src="http://localhost:4098/"     <!-- or :4099 -->
  class="absolute inset-0 w-full h-full border-0"
  style="{{ opacity, visibility, pointerEvents }}"
  aria-hidden="{{ condition }}"
  tabIndex="{{ 0 or -1 }}"
  title="OpenCode Web"            <!-- or "OpenCode Terminal" -->
  allow="clipboard-write"
/>
```

**Key observation**: There is **no `sandbox` attribute** on either iframe.
This means both iframes run with **full origin permissions** — the same
privileges as the embedding page. If either embedded service were
compromised, an attacker could:

- Execute arbitrary JavaScript in the dashboard origin
- Read/write localStorage, sessionStorage, cookies
- Make fetch/XHR requests as the dashboard origin
- Access the DOM of the embedding page (`window.top`, `window.parent`)
- Trigger navigation away from the dashboard

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

## 4. Recommended Minimal Sandbox Configuration

### OpenCode Web iframe

```html
<iframe
  src="http://localhost:4098/"
  sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
  allow="clipboard-write"
  ...
/>
```

**Tokens excluded** (and why):
- `allow-top-navigation` — Prevents the iframe from navigating the dashboard
  page away to another URL. Not needed by OpenCode Web (it navigates within
  itself or opens new windows via `allow-popups`).
- `allow-top-navigation-by-user-activation` — Not needed; OpenCode Web
  doesn't require top-level navigation.
- `allow-pointer-lock` — Not needed for a web UI.
- `allow-orientation-lock` — Not needed.
- `allow-presentation` — Not needed.
- `allow-popups-to-escape-sandbox` — **Deliberately excluded**. Popups
  should remain sandboxed.
- `allow-top-navigation-to-custom-protocols` — Not needed.

### ttyd Terminal iframe

```html
<iframe
  src="http://localhost:4099/"
  sandbox="allow-scripts allow-same-origin allow-forms"
  allow="clipboard-write"
  ...
/>
```

**Tokens excluded** (and why):
- `allow-popups` — ttyd doesn't open popups.
- `allow-modals` — No modals needed in a terminal.
- `allow-downloads` — Terminal output isn't downloaded.
- `allow-top-navigation` — Prevents terminal escape sequences from
  navigating the dashboard away.

---

## 5. How to Test Sandbox Changes

### Step 1: Apply the sandbox attribute

Add the recommended `sandbox` attribute to one iframe at a time in
`OpenCodeFrame.tsx`. Start with ttyd (lower risk if it breaks).

### Step 2: Check the browser console

Open DevTools on the dashboard page. Look for:

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

Verify the `/opencode` page still works after sandbox changes:

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
| `allow-same-origin` + `allow-scripts` together can bypass sandbox restrictions within the iframe's own origin | Medium | Mitigated by: (a) both services are on localhost only, (b) neither service stores sensitive tokens in localStorage (OpenCode uses an auth cookie scoped to its own port). The sandbox still prevents access to the dashboard's origin. |
| Dashboard is a management UI — compromise of dashboard origin is critical | High | The sandbox attribute prevents even fully-compromised embedded content from accessing the dashboard's cookies, localStorage, DOM, or making authenticated API calls as the dashboard. This is the primary value of sandboxing. |

---

## 7. Implementation Notes (for Phase 5)

1. Sandbox attributes should be added to `OpenCodeFrame.tsx` only — the
   `page.tsx` component delegates all rendering to `OpenCodeFrame`.
2. Each iframe needs a different sandbox value (OpenCode Web needs more
   permissions than ttyd).
3. The `allow` attribute (`clipboard-write`) should be preserved alongside
   the new `sandbox` attribute.
4. Test in both Firefox and Chrome — sandbox behavior is consistent but
   error messages differ.
5. Consider adding a `Content-Security-Policy` header to the iframe
   responses from the API (nginx/Express) as an additional layer.
