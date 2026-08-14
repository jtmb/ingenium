---
title: Iframe Sandbox Baseline
description: Iframe sandbox configuration, risk assessment, and deferred security tokens for the Ingenium dashboard.
---

# Iframe Sandbox Baseline

> **Status**: Baseline was implemented in W2 — all four OpenCode iframes previously had
> `sandbox="allow-scripts allow-same-origin"`. The `sandbox` attribute has been **removed**
> from all OpenCode iframes in Phase 2: OpenCode is trusted first-party content embedded
> via local compatibility roots or authenticated runtime-specific HTTPS origins. The same-origin proxy rewrites
> (`/opencode-web/`, `/opencode-cli/`) were also removed. The Email HTML iframe retains
> its separate sandbox policy (no `allow-scripts`). CSP/frame-ancestor policy remains
> are enforced by the AUTH-109 runtime gateway.
> **Last updated**: 2026-08-14

---

## 1. Current Setup (Post-Phase 2)

The dashboard embeds two iframes on the `/opencode` page, rendered by
`services/ingenium-dashboard/src/app/components/OpenCodeFrame.tsx`, plus two
additional standalone iframes in `services/ingenium-dashboard/src/app/standalone/page.tsx`.
**All four OpenCode iframes have had the `sandbox` attribute removed** — OpenCode is
trusted first-party content embedded via local gateway roots or configured HTTPS origins.

The compatibility `/vscode` route adds one trusted separate-origin code-server iframe. Its exact
local origin is `http://vscode.localhost:3000/` on the established port-`3000`
virtual-host gateway; code-server remains private at `127.0.0.1:4100`. It is also
unsandboxed and requests only `allow="clipboard-write"`. The local Windows/WSL
profile assumes localhost-only use and is unsupported for LAN, remote, shared, or
untrusted users; no host `3002` or public `4100` exposure is supported.

Production instead uses exact runtime-specific HTTPS roots. Each root is selected by
audience and runtime UUID, requires a redeemed host-only audience session, strips
browser credentials/identity/proxy headers, and emits a gateway-owned
`frame-ancestors` policy restricted to configured dashboard origins. WebSocket Origin
must equal the exact runtime origin; private 4098/4099/4100 listeners stay unpublished.

This VS Code surface is administrator-grade local access. code-server is
preinstalled, but Restricted Mode disables the pinned extension until the user
explicitly trusts the workspace; Ingenium never auto-trusts. The extension is
image-baked and installed offline as `appuser` into persistent `vscode-data`;
there is no runtime registry or marketplace installation. Security acceptance
also verifies the exact Open VSX artifact identity and SHA-256, engine
compatibility, ownership, and that no content or secrets enter evidence.

| Iframe | Source | Sandbox | Purpose |
|--------|--------|---------|---------|
| OpenCode Web (dashboard) | `Dynamic` (see below) | _(removed)_ | OpenCode Web UI |
| ttyd Terminal (dashboard) | `Dynamic` (see below) | _(removed)_ | OpenCode CLI via ttyd + xterm.js |
| OpenCode Web (standalone) | `Dynamic` (see below) | _(removed)_ | Standalone OpenCode Web UI |
| ttyd Terminal (standalone) | `Dynamic` (see below) | _(removed)_ | Standalone OpenCode CLI terminal |
| VS Code (`/vscode`, standalone) | `http://vscode.localhost:3000/` | _(removed)_ | Local code-server workspace and terminal |

### Dynamic Origin Resolution (Updated)

The iframe `src` is derived at runtime by `services/ingenium-dashboard/src/lib/runtime-urls.ts`
based on the dashboard's own protocol and hostname. The **same-origin proxy rewrites
(`/opencode-web/`, `/opencode-cli/`) have been removed** — OpenCode v1.18.3+ serves
root-relative assets and cannot be proxied under a sub-path.

Resolution is deferred from SSR to post-hydration via `useState(null)` + `useEffect`
(see `OpenCodeFrame.tsx`), so the iframe renders without a `src` during SSR.

| Dashboard Environment | Web iframe src | CLI iframe src |
|-----------------------|----------------|----------------|
| **Default loopback deployment** | `http://opencode.localhost:3000/` | `http://cli.localhost:3000/` |
| **Authenticated remote HTTPS profile (with both NEXT_PUBLIC_* values set at build time)** | Configured root HTTPS origin | Configured root HTTPS origin |
| **LAN HTTP or HTTPS without override** | `null` — shows guidance overlay | `null` — shows guidance overlay |

Overrides are available via `NEXT_PUBLIC_OPENCODE_WEB_URL` and `NEXT_PUBLIC_OPENCODE_CLI_URL`.
They must be supplied before the Next.js image build; changing them only at runtime
does not change the browser bundle. The Windows helper verifies existing loopback
transport only and does not create secure transport.
Only root HTTPS origins are accepted (e.g., `https://opencode.example.com/`). Relative
same-origin paths are no longer supported.

### Current iframe attributes (both dashboard iframes)

```html
<iframe
  src="<dynamically-resolved>"    <!-- local gateway root or configured HTTPS origin -->
  class="absolute inset-0 w-full h-full border-0"
  style="{{ opacity, visibility, pointerEvents }}"
  aria-hidden="{{ condition }}"
  tabIndex="{{ 0 or -1 }}"
  title="OpenCode Web"            <!-- or "OpenCode Terminal" -->
  allow="clipboard-write"
/>
```

> 🔴 The `sandbox` attribute has been **removed** from all OpenCode iframes. These iframes embed
> trusted first-party content from our own services (opencode-web, ttyd), not third-party content.
> The same-origin proxy path is no longer used, so the sandbox is not needed for origin isolation.
> The Email HTML iframe retains a separate `sandbox` policy (no `allow-scripts`) — see §Service-Specific Note.

### Gateway security boundary

The iframe origins are separate from the dashboard, but the upstream services
are also protected by the local gateway boundary. Dashboard and OpenCode
traffic use separate Nginx rate-limit buckets (`30r/s`, burst `60`); assets and
upgrade handshakes are excluded from the dynamic OpenCode bucket so dashboard
prefetch bursts cannot starve iframe startup. The gateway limits connections
to 16 per client address.

Only the dashboard's exact `^~ /_next/static/` immutable-asset path bypasses
the dashboard request bucket. Its trailing slash and Nginx URI normalization
keep `/_next/data`, RSC queries, server actions, API routes, traversal attempts,
and near-match paths in the rate-limited dashboard location. The asset location
uses the same dashboard proxy policy, so browser-controlled credentials and
identity headers remain stripped while upstream CSP and cache headers remain
authoritative.

The OpenCode Web and ttyd listeners remain private container upstreams on
`4098` and `4099`; they are not host endpoints. Before proxying, the gateway
clears browser authorization, identity, and forwarding headers. The CLI route
adds only its fixed gateway identity, and the gateway owns the CSP framing
policy. Direct IPv6 loopback dashboard requests are canonicalized to
`http://localhost:3000/` because the supported CSP sources are
`localhost:3000` and `127.0.0.1:3000`, not an IPv6 literal.

The VS Code gateway follows the same dedicated virtual-host boundary on port
`3000`: only the exact `vscode.localhost` Host selects the private code-server
listener. The browser origin and CSP/Origin checks are exact; the local profile
does not provide LAN or remote access controls.

### What's present — `allow="clipboard-write"`

The `allow` attribute enables the [Permissions Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Permissions_Policy)
`clipboard-write` feature. This lets OpenCode Web and ttyd write to the
clipboard (e.g., copy code blocks, terminal output). This is a legitimate
permission and is preserved.

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

### Current State (Post-Phase 2)

The `sandbox` attribute has been **removed** from all OpenCode iframes.
Only `allow="clipboard-write"` (Permissions Policy) remains:

```html
<iframe
  src="<dynamically-resolved>"    <!-- local gateway root or configured HTTPS origin -->
  allow="clipboard-write"
  ...
/>
```

### Sandbox Removal Rationale

| Reason | Detail |
|--------|--------|
| Trust boundary | OpenCode Web and ttyd are first-party services running in our own container, not third-party content. The sandbox was originally added with the same-origin proxy path to prevent the iframe from accessing the dashboard origin during the proxy era. |
| Proxy path removed | The `/opencode-web/` and `/opencode-cli/` same-origin proxy rewrites have been removed. OpenCode iframes now load from local gateway roots or configured HTTPS origins — they are on separate origins from the dashboard, making the sandbox redundant. |
| Origin isolation | Gateway origins (`opencode.localhost:3000`/`cli.localhost:3000`) differ from the dashboard (`localhost:3000`). Same-origin access to dashboard cookies, localStorage, and DOM is prevented without a sandbox attribute. |
| Chromium warning | The previous `allow-scripts allow-same-origin` combination triggered a Chromium warning about potential sandbox escape. Removing the sandbox attribute resolves this warning for trusted first-party content. |

### Clipboard Permission Preserved

The `allow="clipboard-write"` Permissions Policy attribute is retained,
enabling OpenCode Web and ttyd to write to the clipboard (copy code blocks,
terminal output).

### Runtime framing policy

The runtime gateway removes conflicting upstream `X-Frame-Options`, preserves an
upstream CSP where present, and adds a second `frame-ancestors` policy containing only
the configured dashboard origins. Dashboard CSP permits only the validated runtime
wildcard for `frame-src` and ticket-exchange `connect-src`.

### Tokens Permanently Excluded (Sandbox Not Needed)

Since the sandbox attribute has been removed, sandbox tokens no longer apply
to the OpenCode iframes. The Email HTML iframe retains its separate sandbox
configuration (see below).

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

## 5. Testing the No-Sandbox Configuration

The sandbox attribute has been removed from all OpenCode iframes. This
configuration is already deployed and verified. No future expansion of
sandbox tokens is planned for OpenCode iframes.

### Step 1: Verify sandbox removal

Open DevTools on the `/opencode` page and inspect the iframe element.
Confirm no `sandbox` attribute is present on either the Web or CLI iframe.
Expected:

```html
<iframe
  src="http://opencode.localhost:3000/"
  allow="clipboard-write"
  ...
/>
```

### Step 2: Verify separate-origin isolation

Even without the sandbox attribute, the iframe is on a separate origin
from the dashboard:

| Dashboard origin | Iframe origin | Isolation mechanism |
|-----------------|---------------|---------------------|
| `localhost:3000` | `opencode.localhost:3000` / `cli.localhost:3000` | Browser same-origin policy plus private upstream ports |
| `https://dashboard.example.com` | `https://opencode.example.com` | Browser same-origin policy — different hostname, access blocked |

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

After any OpenCode iframe configuration change, verify the `/opencode`
page still works:

1. Navigate to `/opencode` from the nav bar
2. Switch modes several times
3. Open DevTools and confirm no console errors from either iframe
4. Verify the ProjectDropdown is disabled on this page (per nav bar spec)

---

## 6. Risk Assessment (Post-Phase 2)

| Risk | Severity | Mitigation |
|------|----------|------------|
| ttyd is reached through `cli.localhost:3000` | Low | Direct 4099 publication is not supported; the normal local gateway injects only a fixed internal ttyd identity. |
| OpenCode Web is reached through `opencode.localhost:3000` | Low | Direct 4098 publication is not supported. Remote deployments require explicit HTTPS root configuration. |
| OpenCode iframes are on separate origins from dashboard | Low | Browser same-origin policy prevents iframe from accessing dashboard's cookies, localStorage, or DOM without a sandbox attribute. No sandbox required because the origin difference provides the isolation. |
| HTTPS origin configured for remote access | Medium | The configured HTTPS origin must be a trusted deployment. The `NEXT_PUBLIC_OPENCODE_WEB_URL` env var accepts only root HTTPS origins (validated by regex). No relative paths or non-HTTPS origins are accepted. |
| Dashboard is a management UI — compromise of dashboard origin is critical | High | The default gateway is local-only; remote profiles must add operator-managed TLS authentication. The iframe's separate origin (different hostname) also prevents sharing cookies, localStorage, or DOM state. |
| Compromise of the embedded OpenCode service | Medium | An attacker who compromises the opencode-web or ttyd service could operate within that service's own origin. Mitigated by: (a) loopback-only deployment in Docker, (b) HTTPS origin must be explicitly configured for remote access, (c) the compromised service would still be on a separate origin from the dashboard. |

---

## 7. Completed Work & Remaining Deferred Items

### ✅ Completed in W2 (Initial Sandbox Baseline)

1. **Sandbox attribute added** to all four OpenCode iframes — both iframes in
   `OpenCodeFrame.tsx` AND both standalone iframes in
   `standalone/page.tsx`.
2. **Baseline tokens deployed**: `allow-scripts allow-same-origin` on all
   four OpenCode iframes.
3. **`allow="clipboard-write"` preserved** alongside sandbox attribute (via
   Permissions Policy, not sandbox).
4. **Identical baseline for both services** — same token set for OpenCode Web
   and ttyd, ensuring both function without breakage.

### ✅ Phase 2 Changes

1. **Sandbox attribute removed** from all OpenCode iframes — OpenCode is trusted
   first-party content embedded via local gateway roots or configured HTTPS origins.
   The browser same-origin policy (different port/hostname) provides isolation
   without needing a sandbox attribute.
2. **Same-origin subpath proxy is unsupported** — `/opencode-web/` and `/opencode-cli/`
   reverse-proxy paths are eliminated. OpenCode v1.18.3+ serves root-relative assets
   and cannot be proxied under a sub-path.
3. **Authenticated host-gateway model** — local browser access uses the protected
   `.localhost:3000` roots; remote HTTPS
   requires explicit `NEXT_PUBLIC_OPENCODE_WEB_URL` / `NEXT_PUBLIC_OPENCODE_CLI_URL`;
   unsupported LAN shows guidance overlay.
4. **Chromium sandbox-escape warning resolved** — removing the `allow-scripts
   allow-same-origin` combination eliminates the browser warning.

### ⏳ Deferred (Requires Runtime Testing)

1. **Content-Security-Policy headers** — `frame-ancestors` directive on the
   Express API responses, or on the opencode-web/ttyd backend responses, as
   an additional defense layer.
2. **CSP for the iframe responses** — nginx/Express CSP headers for
   opencode-web and ttyd responses, restricting what those services can load.
3. **Email HTML iframe sandbox audit** — the email reader's iframe currently
   uses a different, more restrictive sandbox (`allow-same-origin allow-popups
   allow-popups-to-escape-sandbox`, no `allow-scripts`). This should be
   reviewed for completeness.

### Testing Notes

- Adding sandbox tokens is **additive-only**: granting extra tokens never
  breaks existing functionality. Only removing tokens risks breakage. However,
  since the sandbox has been removed from OpenCode iframes, this consideration
  applies only to the Email HTML iframe.
- The email HTML iframe intentionally omits `allow-scripts` for security
  (email HTML should not execute JavaScript).
