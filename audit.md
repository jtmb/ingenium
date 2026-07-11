# Security Audit — 2026-07-11

Type: Full-scope security audit (secrets, injection, auth, dependencies, filesystem, container)

---

## Findings by Severity

### 🔴 Critical

#### C-1: JWT Token Hardcoded in `opencode.json` (Current File)

| Field | Value |
|-------|-------|
| **File** | `opencode.json` (line 30) |
| **Type** | Static credential leakage |
| **Impact** | Anyone with access to this file — including the VCS, CI/CD, or container — can impersonate the Thread bridge user. The JWT is a live token for `http://localhost:5000`. |

```json
"THREAD_API_TOKEN": "eyJhbGciOiJIUzI1NiIsInR5cCI6IlRIUkVBRCJ9.eyJzdWIiOiJhZG1pbiIsImlhdCI6MTc4MzIyMjQzMX0.ULrWu0TAj8A-6q3Uf5PnOw70RIPIwRDETitq-Mopf0k"
```

**Fix**:
1. **Immediately rotate the Thread server's API token.**
2. Replace the value with `<YOUR_THREAD_API_TOKEN>` placeholder as documented in `AGENTS.md`:
   ```
   "THREAD_API_TOKEN": "<YOUR_THREAD_API_TOKEN>"
   ```
3. Load the real token from an environment variable or a `.env` file (already in `.gitignore`).

#### C-2: JWT Token Leaked in Git History (6 Commits)

The same JWT was introduced and remains in 6 commits across all branches:

| Commit | Date | Author |
|--------|------|--------|
| `ccc269d` | 2026-07-05 | `feat: add TypeScript type annotations...` |
| `acca354` | 2026-07-05 | `feat: add TypeScript type annotations...` |
| `66e7ae5` | 2026-07-04 | `audit: fix 14 discrepancies...` |
| `15d4541` | 2026-07-04 | `audit: fix 14 discrepancies...` |
| `20d3ee2` | 2026-07-04 | `audit: snapshot before fixes` |
| `b0c9318` | 2026-07-04 | `audit: snapshot before fixes` |

The older commits (`15d4541`, `66e7ae5`, `b0c9318`, `20d3ee2`) used a `<YOUR_THREAD_API_TOKEN>` placeholder. Commits `ccc269d` and `acca354` replaced it with the actual JWT.

**Fix**:
1. **Rotate the Thread server token** (it is now compromised in git history).
2. Purge the secret from git history:
   ```bash
   # Using BFG Repo-Cleaner (recommended for simplicity):
   java -jar bfg.jar --replace-text passwords.txt opencode.json
   git reflog expire --expire=now --all && git gc --prune=now --aggressive

   # Or using git filter-branch:
   git filter-branch --force --index-filter \
     "git diff --cached --name-only | grep -q 'opencode.json' && \
      git update-index --cacheinfo 100644,$(git hash-object -w --stdin < <(sed 's/eyJhbGciOiJIUzI1NiIsInR5cCI6IlRIUkVBRCJ9\.[^"]*/<YOUR_THREAD_API_TOKEN>/g' opencode.json)),opencode.json || true" \
     -- --all
   ```
3. Force-push to rewrite history (coordinate with all collaborators first).

#### C-3: Default Password Hardcoded in `docker-compose.yml`

| Field | Value |
|-------|-------|
| **File** | `docker-compose.yml` (line 10) |
| **Type** | Static credential |

```yaml
- OPENCODE_SERVER_PASSWORD=test
```

Previously this was `${OPENCODE_SERVER_PASSWORD:?OpenCode server password required}` which forced users to set a password. Commit `1625f34` replaced this with the literal `test`.

The unauthenticated `opencode-iframe` service on port 4098 compounds this: iframe has `OPENCODE_SERVER_PASSWORD=""` (empty), providing no-auth access.

**Fix**:
```yaml
- OPENCODE_SERVER_PASSWORD=${OPENCODE_SERVER_PASSWORD:?OpenCode server password required}
```
Also remove or authenticate the opencode-iframe if not needed.

#### C-4: Critical npm Dependency Vulnerability

`nodemailer` (v6.9.x) is affected by **8 vulnerabilities**, including 1 critical:

| Advisory | Severity | Issue |
|----------|----------|-------|
| `GHSA-p6gq-j5cr-w38f` | 🔴 Critical | `disableFileAccess`/`disableUrlAccess` bypass via raw option — enables arbitrary file read and full SSRF |
| `GHSA-r7g4-qg5f-qqm2` | 🔴 Critical | Improper TLS certificate validation in OAuth2 token fetch enables credential interception |
| `GHSA-c7w3-x93f-qmm8` | 🟡 High | SMTP command injection via unsanitized `envelope.size` parameter |
| Various | 🟡 High | Multiple SMTP command injection and CRLF injection vectors |

**Current**: `^6.9.0` — upgrade to `9.0.3` to fix all. (Breaking change, requires testing.)

---

### 🟡 High

#### H-1: Unsanitized HTML Email Rendering (XSS)

| Field | Value |
|-------|-------|
| **File** | `services/ingenium-dashboard/src/app/mail/components/EmailReader.tsx` (line 129) |
| **Type** | Stored XSS via email body |

```tsx
dangerouslySetInnerHTML={{ __html: email.body.html }}
```

Raw email HTML is injected directly into the DOM without sanitization. A malicious email containing `<script>` tags or event handlers can execute arbitrary JavaScript in the context of the dashboard.

**Fix**: Sanitize with DOMPurify before rendering:
```tsx
import DOMPurify from "dompurify";
// ...
dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(email.body.html) }}
```

#### H-2: Partial HTML Sanitization in MarkdownViewer (XSS)

| Field | Value |
|-------|-------|
| **File** | `services/ingenium-dashboard/src/app/components/MarkdownViewer.tsx` (line 133) |
| **Type** | XSS |

```tsx
dangerouslySetInnerHTML={{ __html: renderedHtml }}
```

The `renderSimpleMarkdown()` function escapes `&`, `<`, `>` — but then injects into HTML context after regex replacements. The `href` attribute in link rendering (`<a href="$2"...`) is particularly dangerous: a malicious input like `[x](javascript:alert(1))` would produce `<a href="javascript:alert(1)">`, which executes on click.

**Fix**: Sanitize rendered HTML with DOMPurify, or at minimum validate `href` values to disallow `javascript:` and `data:` protocols.

#### H-3: CORS Wildcard in Production

| Field | Value |
|-------|-------|
| **File** | `services/ingenium-api/config/index.ts` (line 4), `supervisord.conf` (line 15) |
| **Type** | Missing access control |

```typescript
corsOrigin: process.env.CORS_ORIGIN ?? "*",
```

And in supervisord.conf:
```
environment=...,CORS_ORIGIN="*"
```

Any website can make cross-origin requests to the API. Since there's no CSRF token, a malicious site could trick a logged-in user's browser into making API requests.

**Fix**: Set `CORS_ORIGIN` to the specific dashboard origin (e.g., `http://localhost:3000`) in both `docker-compose.yml` and in deployments.

#### H-4: Auth Middleware Bypass When No Token Configured

| Field | Value |
|-------|-------|
| **File** | `services/ingenium-api/lib/middleware/auth.ts` (lines 8-12) |
| **Type** | Authentication bypass |

```typescript
if (!token) {
  // No token configured — skip auth
  next();
  return;
}
```

When `INGENIUM_API_TOKEN` is not set, **all API endpoints are completely unauthenticated**. Combined with wildcard CORS (H-3), this creates a fully open API surface.

**Fix**: Require authentication by default, or at minimum add a warning log when auth is disabled. Consider requiring auth in production mode:
```typescript
if (!token) {
  if (process.env.NODE_ENV === "production") {
    throw new AppError("INGENIUM_API_TOKEN must be configured in production", "UNAUTHORIZED", 500);
  }
  console.warn("[auth] No INGENIUM_API_TOKEN configured — auth disabled");
  next();
  return;
}
```

#### H-5: API Keys Stored in Plaintext in Database

| Field | Value |
|-------|-------|
| **File** | `packages/ingenium-core/lib/tools/settings.ts` (line 20) |
| **Type** | Credential storage |

```typescript
db.prepare("INSERT OR REPLACE INTO settings (project_id, key, value) VALUES (?, ?, ?)")
  .run(projectId, key, value);
```

LLM API keys (`synthesis_api_key`, `synthesis_backup_api_key`) are stored as raw plaintext in the SQLite database. Any user with DB access can extract them. The email credentials are properly encrypted (AES-256-GCM), but the synthesis API keys are not.

**Fix**: Encrypt API keys using the same AES-256-GCM pattern from `ingenium-email/lib/oauth.ts`, or at minimum use an environment variable.

#### H-6: OAuth Callback Missing State Parameter

| Field | Value |
|-------|-------|
| **File** | `services/ingenium-dashboard/src/app/mail/oauth/callback/page.tsx` (lines 31, 39) |
| **Type** | CSRF in OAuth flow |

```tsx
const provider = state || "gmail";
// ...
body: JSON.stringify({
  provider,  // Uses state as provider name, NOT for CSRF validation
  code,
  redirectUri: window.location.origin + "/mail/oauth/callback",
}),
```

The `state` OAuth parameter is used as the `provider` name (`state || "gmail"`), rather than being sent to the backend for CSRF validation. The backend (`exchangeCode` in `oauth.ts`) validates state against a stored value, but the dashboard never sends the actual `state` parameter. This means the CSRF protection on the backend is effectively disabled for the browser flow.

**Fix**: 
```tsx
body: JSON.stringify({
  provider: detectedProvider, // determine provider separately
  code,
  state,  // ← send state for CSRF validation
  redirectUri: window.location.origin + "/mail/oauth/callback",
}),
```

#### H-7: Scheduler Self-Calls Bypass Auth

| Field | Value |
|-------|-------|
| **File** | `services/ingenium-api/scripts/api-server.ts` (lines 85, 91, 108, 129) |
| **Type** | Authorization bypass |

```typescript
const projectsRes = await fetch(`http://localhost:${config.port}/api/v1/projects`);
const res = await fetch(`http://localhost:${config.port}/api/v1/synthesis/run?project=${p.name}`, {
```

The scheduled synthesis/health tasks make direct HTTP calls to `localhost:self_port` without any auth token. While these are internal loopback calls, they bypass any configured auth. If the port is exposed (it is — port 4097 is mapped in docker-compose), this path is externally reachable.

**Fix**: Include the `Authorization: Bearer` header in internal fetch calls when a token is configured; or use direct function calls instead of HTTP self-calls.

#### H-8: Unauthenticated opencode-iframe Service

| Field | Value |
|-------|-------|
| **File** | `supervisord.conf` (lines 39-48) |
| **Type** | Missing access control |

```
[program:opencode-iframe]
environment=OPENCODE_SERVER_PASSWORD="",HOME="/home/appuser"
```

The iframe service runs with an empty password, providing completely unauthenticated access to OpenCode on port 4098. This port is mapped in docker-compose.yml (though not EXPOSEd in Dockerfile).

**Fix**: Either remove the iframe service, require authentication, or don't expose port 4098.

#### H-9: In-Memory Rate Limiting (Per-Process)

| Field | Value |
|-------|-------|
| **File** | `services/ingenium-api/lib/middleware/rate-limit.ts` (lines 1-32) |
| **Type** | DoS protection gap |

```typescript
const requestCounts = new Map<string, { count: number; resetAt: number }>();
```

Rate limiting is purely per-process in-memory. If the API is scaled horizontally (multiple instances), each instance has its own counter. A determined attacker cycling through instances bypasses rate limits entirely. Also, restarting the server resets all counters.

**Fix**: Use a shared store (Redis or the SQLite DB itself) for rate limit counters.

#### H-10: No CSRF Protection

The dashboard has no CSRF tokens. All state-changing operations (POST/PUT/DELETE) are sent via simple JSON fetch calls with no anti-CSRF measures. Combined with wildcard CORS (H-3) and optional auth (H-4), this enables cross-site request forgery attacks.

**Fix**: Implement CSRF tokens for the dashboard, or use SameSite=Strict cookies, or at minimum restrict CORS to the dashboard origin.

---

### 💡 Low / Defense-in-Depth

#### L-1: Plugin Source Endpoint Path Traversal Window

| Field | Value |
|-------|-------|
| **File** | `services/ingenium-api/lib/routes/plugins.ts` (line 44) |
| **Type** | Potential path traversal |

```typescript
const filePath = resolve(process.cwd(), plugin.file_path);
```

This resolves from `process.cwd()` rather than the project's plugin base directory. The backend `validatePluginPath()` does validate against the base dir, but the API route doesn't use that validation — it uses a raw `resolve()` from cwd. If `plugin.file_path` contains `../` sequences, this could read files outside the plugin directory.

**Fix**: Use `getPluginsBase(projectId)` as the base for resolution:
```typescript
const baseDir = getPluginsBase(projectId);
const filePath = resolve(baseDir, plugin.file_path);
```

#### L-2: Missing `.env.example` in Project Root

The `.gitignore` has `!.env.example` but no `.env.example` file exists. This means there's no documented template for required environment variables. Developers must read `AGENTS.md` or source code to know what variables are needed.

**Fix**: Create `.env.example` with all required variables documented.

#### L-3: YAML Injection in Agent Frontmatter

| Field | Value |
|-------|-------|
| **File** | `packages/ingenium-core/lib/tools/agents.ts` (lines 22-50) |
| **Type** | Injection (low severity, controlled input) |

```typescript
`description: "${agent.description.replace(/"/g, '\\"')}"`,
```

Agent names and descriptions are written into YAML frontmatter with only basic escaping (double quotes). If a name contains YAML special characters or newlines, it could break the YAML structure or inject unexpected keys. Since values come from the DB (trusted input), this is low severity but should be hardened.

**Fix**: Use a proper YAML serialization library (e.g., `js-yaml`) instead of manual string construction.

#### L-4: Docker `seccomp=unconfined` Constraint

| Field | Value |
|-------|-------|
| **File** | `docker-compose.yml` (line 12) |
| **Type | Container hardening |

```yaml
security_opt: ["seccomp=unconfined"]
```

This disables seccomp (secure computing mode) for the container, allowing all system calls. This reduces container isolation and increases the blast radius of a compromised service.

**Fix**: Remove this line unless required for a specific reason (e.g., Chrome/Playwright sandboxing needs it). If Playwright tests need it, document why and scope the permission.

#### L-5: No Separate Health/Debug Endpoint Protection

The `GET /api/v1/health` endpoint is not rate-limited or authenticated. While it only returns basic uptime info, it's still a reconnaissance vector. More importantly, it gives attackers a quick way to verify the API is reachable.

**Fix**: Apply rate limiting to health endpoint as well (it's currently excluded from rate limiting).

#### L-6: `$HOME` Literal in `opencode.json` Command Path

| Field | Value |
|-------|-------|
| **File** | `opencode.json` (lines 19-23) |
| **Type** | Portability |

```json
"command": ["$HOME/.thread-bridge/.venv/bin/python", "-m", "thread_bridge.bridge"],
"cwd": "$HOME/.thread-bridge",
```

The `$HOME` variable is used literally — it's not resolved by the shell. OpenCode likely resolves it, but this is fragile. If the app runs in a context where `$HOME` is not set, this breaks.

**Fix**: Use the expanded path or rely on the OpenCode config mechanism to resolve variables.

#### L-7: 4098 Port Mapped but Not EXPOSEd in Dockerfile

| Field | Value |
|-------|-------|
| **File** | `Dockerfile` (line 76) |
| **Type** | Inconsistency |

```
EXPOSE 3000 4096 4097
```

But `docker-compose.yml` maps port 4098 as well. While this doesn't expose 4098 outside Docker by itself, it's an inconsistency and the port is externally mapped in compose.

**Fix**: Add `4098` to the EXPOSE list, or stop mapping it externally if the iframe is container-internal only.

---

## Git History Scan

### Found Leaks

| Severity | Secret | First Leaked |
|----------|--------|-------------|
| 🔴 Critical | `THREAD_API_TOKEN` JWT (Thread bridge auth token) | `ccc269d` (2026-07-05) |

The JWT `eyJhbGciOiJIUzI1NiIsInR5cCI6IlRIUkVBRCJ9.eyJzdWIiOiJhZG1pbiIsImlhdCI6MTc4MzIyMjQzMX0.ULrWu0TAj8A-6q3Uf5PnOw70RIPIwRDETitq-Mopf0k` was introduced in commit `ccc269d` and replicated in `acca354`. Earlier commits (`15d4541`, `66e7ae5`, `20d3ee2`, `b0c9318`) had a `<YOUR_THREAD_API_TOKEN>` placeholder.

**6 commits across all branches contain the leaked token.**

### No Other Secrets Found in Git History

Scanned for: `password`, `secret`, `api_key`, `PASSWORD`, and common credential patterns. No other secrets found beyond the above.

### Thread Entry

Leak history logged to Thread for tracking/fix instructions.

---

## Dependency Check

### npm Audit Summary

```
11 vulnerabilities found:
  1 critical  (nodemailer — all 8 CVE groups)
  2 high      (nodemailer SMTP injection, nodemailer TLS bypass)
  8 moderate  (esbuild, postcss, uuid)
```

| Package | Current | Fixed In | Severity | CVE(s) |
|---------|---------|----------|----------|--------|
| `nodemailer` | `^6.9.0` | `9.0.3` | 🔴 Critical | GHSA-p6gq-j5cr-w38f (SSRF/file read), GHSA-r7g4-qg5f-qqm2 (TLS bypass), GHSA-c7w3-x93f-qmm8 (SMTP injection), GHSA-vvjj-xcjg-gr5g, GHSA-268h-hp4c-crq3, GHSA-wqvq-jvpq-h66f, GHSA-mm7p-fcc7-pg87, GHSA-rcmh-qjqh-p98v |
| `esbuild` (via `vite`) | `<=0.24.2` | `>0.24.2` | 🟡 Moderate | GHSA-67mh-4wv8-2f99 |
| `postcss` (via `next`) | `<8.5.10` | `>=8.5.10` | 🟡 Moderate | GHSA-qx2v-qp2m-jg93 |
| `uuid` (via `gaxios`, `@azure/msal-node`) | `<11.1.1` | `>=11.1.1` | 🟡 Moderate | GHSA-w5hq-g745-h8pq |

### Recommended Actions

1. **Upgrade `nodemailer` from `^6.9.0` to `^9.0.3`** — fixes all 8 CVEs including critical SSRF and TLS bypass
2. **Run `npm audit fix`** for moderate issues (esbuild, postcss, uuid)
3. **Pin exact versions** for critical dependencies rather than using `^` ranges

---

## Recommendations (Prioritized)

### Immediate (Do First)

| # | Action | Related Finding |
|---|--------|-----------------|
| 1 | **Rotate the Thread API token** — the JWT is compromised and in git history | C-1, C-2 |
| 2 | **Replace hardcoded token** in `opencode.json` with `<YOUR_THREAD_API_TOKEN>` placeholder | C-1 |
| 3 | **Replace hardcoded password** in `docker-compose.yml` back to `${OPENCODE_SERVER_PASSWORD:?err}` | C-3 |
| 4 | **Upgrade `nodemailer` to v9.x** to fix critical SSRF/TLS vulnerabilities | C-4 |
| 5 | **Purge JWT from git history** using BFG or filter-branch | C-2 |

### Short-Term (This Sprint)

| # | Action | Related Finding |
|---|--------|-----------------|
| 6 | **Sanitize email HTML** with DOMPurify in `EmailReader.tsx` | H-1 |
| 7 | **Sanitize MarkdownViewer output** — validate `href` attributes against `javascript:` | H-2 |
| 8 | **Restrict CORS origin** to `http://localhost:3000` in docker-compose and config | H-3 |
| 9 | **Require auth in production** mode — fail closed when no token configured | H-4 |
| 10 | **Fix OAuth callback** to pass `state` parameter for CSRF validation | H-6 |
| 11 | **Fix plugin source endpoint** path resolution to use project base dir | L-1 |

### Medium-Term

| # | Action | Related Finding |
|---|--------|-----------------|
| 12 | **Encrypt synthesis API keys** in the database (use AES-256-GCM like email module) | H-5 |
| 13 | **Add CSRF tokens** to dashboard state-changing operations | H-10 |
| 14 | **Use shared rate limiting** (SQLite-backed or Redis) instead of in-memory Map | H-9 |
| 15 | **Add auth header** to scheduler internal fetch calls | H-7 |
| 16 | **Create `.env.example`** with documented required environment variables | L-2 |
| 17 | **Remove `seccomp=unconfined`** or document the requirement | L-4 |
| 18 | **Use `js-yaml` library** for YAML serialization instead of string building | L-3 |

---

## Summary

| Severity | Count | Key Issues |
|----------|-------|------------|
| 🔴 Critical | 4 | JWT in opencode.json + git history, hardcoded `test` password, nodemailer CVEs |
| 🟡 High | 10 | XSS (email HTML, markdown), wildcard CORS, optional auth, plaintext API keys, OAuth CSRF gap, scheduler auth bypass, unauthenticated iframe, in-memory rate limiting, no CSRF |
| 💡 Low | 7 | Path traversal window, missing .env.example, YAML injection, seccomp, port inconsistency |
| **Total** | **21** | |

The project has good foundations — parameterized SQL queries throughout, encrypted email credentials (AES-256-GCM), OAuth state validation on the backend, and non-root container user. The most critical issues are the hardcoded credentials in `opencode.json` and the git history leak.
