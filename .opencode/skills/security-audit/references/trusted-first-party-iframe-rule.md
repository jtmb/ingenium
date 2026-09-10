---
title: "Trusted-First-Party Iframe Rule — Origin-Based Sandbox Decision"
impact: HIGH
impactDescription: "Prevents XSS, UI redressing, and capability escalation via incorrect iframe sandbox configuration"
tags: [iframe, sandbox, permissions-policy, xss, clickjacking]
---

## Trusted-First-Party Iframe Rule

**Pattern intent:** Determine iframe sandbox requirements based on origin relationship — separate-origin embeds are isolated by the browser's same-origin policy, while same-origin embeds require explicit sandbox restrictions.

### Trusted Separate-Origin Embed (No Sandbox Needed)

When embedding content from a **different origin** (different host, port, or scheme), the browser's same-origin policy already prevents the embedded document from accessing the parent's DOM, cookies, storage, or resources. Adding `sandbox` provides defense-in-depth but can interfere with legitimate functionality. The separate origin itself is the security boundary.

**Characteristics:**
- The iframe `src` is on a different origin than the parent page
- The iframe content is trusted first-party (same organization, separate subdomain/service)
- The separate origin acts as a natural security boundary — no sandbox needed

**Correct (no sandbox — origin provides isolation; Permissions Policy for capabilities):**
```html
<iframe src="https://dashboard.internal.example.com"
        allow="clipboard-write"
        title="Trusted cross-origin embed"></iframe>
```

### Untrusted / Same-Origin Content (Sandbox Required)

When embedding content from the **same origin** as the parent, the browser's same-origin policy provides **zero isolation** — the embedded document has full access to the parent's DOM, cookies, and storage. A sandbox is mandatory.

**Sandbox is also required when:**
- The embedded content is user-generated, third-party, or untrusted
- The embedded content is loaded via a proxied URL on the same origin
- The origin relationship is uncertain or may change

**Correct (sandbox with minimum permissions):**
```html
<iframe src="/user-content/preview.html"
        sandbox="allow-scripts"
        title="Untrusted same-origin preview"></iframe>
```

### 🔴 Danger: `allow-scripts` + `allow-same-origin` Together

Adding **both** `allow-scripts` and `allow-same-origin` to a sandbox attribute **defeats the sandbox entirely**. The embedded document can:
- Execute arbitrary scripts
- Access the parent page's DOM and cookies via same-origin access
- Read, modify, or exfiltrate parent page content and state
- Remove the sandbox attribute from its own frame element

**Incorrect (sandbox is neutered — `allow-same-origin` + `allow-scripts` together are equivalent to no sandbox):**
```html
<iframe src="/user-content/preview.html"
        sandbox="allow-scripts allow-same-origin"
        title="Preview"></iframe>
```

Never combine these two tokens unless you fully trust the embedded content as much as the parent page itself.

### Use Permissions Policy for Scoped Capabilities

Instead of a permissive sandbox, use the `allow` attribute (Permissions Policy) to grant specific capabilities to cross-origin embeds:

| Capability | Permissions Policy Token |
|------------|--------------------------|
| Clipboard write | `clipboard-write` |
| Fullscreen | `fullscreen` |
| Camera | `camera` |
| Microphone | `microphone` |
| Geolocation | `geolocation` |

**Correct (scoped capabilities via Permissions Policy, no sandbox needed for cross-origin):**
```html
<iframe src="https://editor.example.com"
        allow="clipboard-write; fullscreen"
        title="Editor"></iframe>
```

### Decision Flow

1. **Is the iframe `src` on a different origin than the parent?** → No sandbox needed (origin provides isolation). Use Permissions Policy (`allow` attribute) for specific capabilities.
2. **Is the iframe `src` on the same origin as the parent?** → Sandbox required. Grant only the minimum tokens needed.
3. **Does the embedded content need scripting but is same-origin?** → Use `sandbox="allow-scripts"` **without** `allow-same-origin`. If same-origin DOM access is truly needed, restructure the content to a separate origin.
4. **Never** combine `allow-scripts` + `allow-same-origin` — this removes all sandbox protection.
