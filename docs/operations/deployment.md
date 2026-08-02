---
title: Deployment Guide
description: Docker deployment guide — services, ports, volumes, health checks for the Ingenium system.
---

# Deployment Guide

> **Note:** This document is the canonical operations reference for deployment. The AGENTS.md file contains a summary only.

---

## Overview

Ingenium uses **single-container deployment** via Docker Compose. A single container runs **supervisord** managing seven processes:

1. **API boundary** (host-loopback :4097 → private Express :4096)
2. **Dashboard** (Next.js on :3000)
3. **API** (private Express on :4096)
4. **Nginx gateway** (host :3000 and OAuth callback :1455)
5. **opencode-web** (on :4098)
6. **ttyd-opencode** (on :4099)
7. **code-server** (private on :4100; exposed only through `vscode.localhost:3000`)

---

## Quick Start

```bash
# Set required secrets first (or use an ignored .env file). The API token must
# be 32–128 base64url characters.
export OPENCODE_SERVER_PASSWORD='...'
export INGENIUM_API_TOKEN='...'
export INGENIUM_EMAIL_ENCRYPTION_KEY='...'

# Optional remote/LAN mode: set both before the image build, and use only
# operator-managed authenticated root HTTPS origins.
# export NEXT_PUBLIC_OPENCODE_WEB_URL='https://opencode.example.com/'
# export NEXT_PUBLIC_OPENCODE_CLI_URL='https://cli.example.com/'

# Record the exact checkout used for this image. Compose cannot evaluate Git
# commands, so IMAGE_REVISION is required for every Compose invocation.
export IMAGE_REVISION="$(git rev-parse HEAD)"

# Start all services (with build)
docker compose up --build

# Start without rebuild
docker compose up

# Stop all services
docker compose down

# View logs
docker compose logs -f

# Execute commands inside container
docker compose exec ingenium npm run test
docker compose exec ingenium npm run check
```

After a detached deployment, verify the running image metadata without dumping
its labels or reading deployment secrets:

```bash
./scripts/validate-image-provenance.mjs "$IMAGE_REVISION"
```

For the in-container OpenCode MCP configuration, seed the ignored token file before starting OpenCode:

```bash
./scripts/bootstrap-local-secrets.sh
docker compose up --build -d
```

The script creates `.env` and `.opencode/.ingenium-api-token` only when needed,
keeps both mode `0600`, rejects unsafe paths, and refuses a mismatched existing
token. Do not print the generated value.

### Protected token-file runtime

The container accepts the API credential as a bootstrap environment value or a
protected regular file. During entrypoint setup it creates an owner-only runtime
file, then removes the inline credential from the environment before
supervisord starts its children. The API, dashboard proxy, boundary, health
probe, and email watcher read the protected file as needed; services do not
need the credential in their inherited environment. Symlinks, non-regular files,
and unsafe permissions are rejected. Credential contents are never part of
logs, observations, or diagnostics.

---

## Services

### 1. API boundary and Express API

The loopback-only `127.0.0.1:4097` listener is an authenticated bearer boundary.
It validates the dashboard/OpenCode server credential and host MCP credentials,
then forwards to the private Express listener on container port `4096`; the
latter is the sole DB authority. Missing or malformed bearer headers return
`401`, wrong tokens return `403`, and network locality never bypasses validation.

### 2. Dashboard (Next.js on :3000)

21 primary route-based pages plus the Settings overlay. Compose publishes the
local gateway as `3000:3000` so default Windows-to-WSL localhost forwarding
reaches it. The dashboard fallback accepts forwarded Host headers and does not
challenge browser traffic with HTTP Basic Auth. It talks to the API layer only
— zero direct DB access.

The Chat session-events path is an exception to the generic API rewrite:
`/api/v1/opencode/sessions/:id/events` is handled by a dedicated unbuffered
Node route that forwards the persistent upstream readable stream directly.
Next's generic compressed rewrite must remain a `fallback`, so the dashboard
route wins. Routing this persistent SSE connection through the generic rewrite
can buffer or transform the response, hiding incremental frames until the
connection ends. The route therefore sends `Cache-Control: no-cache,
no-transform` and `X-Accel-Buffering: no`; preserve those headers through any
gateway in front of the dashboard.

### 3. opencode-web (internal :4098)

OpenCode web server. It is a private internal upstream reached through the local root `http://opencode.localhost:3000`. Do not publish or access host port 4098 directly.

### 4. ttyd-opencode (internal :4099)

OpenCode CLI terminal via ttyd. It is a private internal upstream reached through the local root `http://cli.localhost:3000`. Do not publish or access host port 4099 directly.

```bash
ttyd --port 4099 opencode attach http://localhost:4098 --dir /workspace
```

### 5. code-server (internal :4100)

code-server is a private VS Code workspace upstream reached through the exact
local root `http://vscode.localhost:3000/`. Do not publish or access host port
4100 directly.

The image bakes the official Open VSX
`sst-dev.opencode@0.0.13` artifact from
`https://open-vsx.org/api/sst-dev/opencode/0.0.13/file/sst-dev.opencode-0.0.13.vsix`
with SHA-256
`e9a75751aa21fce3f9c9822d1f718043b1a9ba97e64c66b190a3fa85850c60d4`. Startup
verifies that identity, code-server engine compatibility, and the hash, then
installs it offline and idempotently as `appuser` into
`/home/appuser/vscode-data/extensions`. No runtime registry or marketplace
installation is permitted.

The image also supplies system-theme defaults through a code-free built-in
`configurationDefaults` contribution: auto detection follows the system and
uses **Dark Modern**/**Light Modern**. Explicit user or workspace values win;
startup never rewrites User or workspace settings. The `vscode-data` named
volume preserves settings and extensions across restart, rebuild, and an
existing volume; a fresh volume is initialized with the same defaults and
pinned extension. After upgrading the image, restart the service and revalidate
the appuser identity, engine compatibility, artifact hash, extension list, and
volume-preserved settings/extensions before accepting the deployment.

VS Code is preinstalled, but Restricted Mode disables extensions until the user
explicitly trusts the workspace. Ingenium does not auto-trust it. This is an
administrator-grade local surface, not a LAN, remote, shared, or untrusted-user
deployment profile.

> 🔴 **`synthesis-engine` and `email-client` are NOT supervisord processes.** They are in-process scheduled tasks running inside the `ingenium-api` Express process. Do NOT add supervisord `[program:synthesis-engine]` or `[program:email-client]` blocks.

---

## Port Mappings

| Host Port | Service | Description |
|-----------|---------|-------------|
| `3000` | Dashboard + host gateway | WSL-forwardable local `localhost:3000`, `opencode.localhost:3000`, `cli.localhost:3000`, and `vscode.localhost:3000` gateway without HTTP Basic Auth |
| `127.0.0.1:4097` | API boundary | Authenticated host-loopback bearer boundary |
| internal `4096` | Express API | Private upstream and sole DB authority |
| internal `4098` | OpenCode Web | Private upstream served through local `opencode.localhost:3000` |
| internal `4099` | ttyd-opencode | Private upstream served through local `cli.localhost:3000` |
| internal `4100` | code-server | Private upstream served through local `vscode.localhost:3000`; no public `4100` endpoint |

> 🔴 The browser-facing contract is the unauthenticated local port 3000 gateway. Port 4097 is a separate bearer-authenticated host-loopback MCP boundary; ports 4098 and 4099 are private container upstreams, not direct host endpoints. The gateway never forwards a browser bearer token. Plain HTTP is not an approved LAN/remote deployment profile.

The supported dashboard origins in the default profile are `http://localhost:3000/` and
`http://127.0.0.1:3000/`. The OpenCode roots remain
`http://opencode.localhost:3000/` and `http://cli.localhost:3000/`; these are
separate local gateway hosts, not dashboard aliases.

### Gateway rate-limit and origin policy

Nginx keeps dashboard and OpenCode request budgets separate. Each dynamic
surface is limited to `30r/s` with a burst of `60` and `nodelay`; dashboard
requests use `dashboard_request`, while OpenCode Web/CLI requests use
`opencode_request`. OpenCode build/runtime assets (`/assets/`, `/_next/`,
`/@vite/`, and Vite dependencies) and upgrade handshakes use an empty key and
therefore do not consume the dynamic OpenCode budget. The gateway still limits
connections to `16` per client address.

The default dashboard origin contract is `localhost:3000` or
`127.0.0.1:3000`. Nginx redirects direct IPv6 loopback hosts (`::1` and
`[::1]`) with `308` to `http://localhost:3000$request_uri`; this canonical
origin is required because the iframe CSP allowlist uses valid `localhost` and
`127.0.0.1` sources rather than an IPv6 literal. OpenCode remains on the
separate root hosts `opencode.localhost:3000` and `cli.localhost:3000`.

The OpenCode upstreams are private container listeners on `127.0.0.1:4098`
and `127.0.0.1:4099`, with no host publication. `proxy-opencode.conf` clears
browser-supplied authorization, identity, and proxy-chain headers before
forwarding. The CLI gateway then injects its fixed internal identity, and the
gateway replaces upstream framing headers with the explicit loopback-only
`frame-ancestors` policy. Do not expose 4098/4099 or forward browser bearer
tokens to make iframe access work.

For CLI terminal WebSockets, the `/ws` route uses an explicit trusted-origin
allowlist: `http://localhost:3000`, `http://127.0.0.1:3000`, and
`http://cli.localhost:3000`. Nginx forwards the original browser `Origin` and
sets the upstream `Host` to the corresponding trusted value so ttyd's
`--check-origin` protection remains enabled. Origins outside this allowlist are
rejected before proxying with `403`. The ttyd listener remains private on
`127.0.0.1:4099`; the browser must use the `cli.localhost:3000` gateway root.

---

## Volume Configurations

| Volume Name | Mount Path | Purpose |
|-------------|------------|---------|
| `ingenium-data` | `/app/.ingenium` | SQLite databases, learnings, tasks, projects, commands |
| `opencode-config` | `/home/appuser/.config` | OpenCode configuration (persists across rebuilds) |
| `opencode-data` | `/home/appuser/.local` | OpenCode user data, session state |

### Workspace bind-mount (Windows + WSL)

Compose requires `HOME` and mounts exactly `${HOME}/repos:/workspace`. Start
Compose from a WSL/Linux shell where `$HOME/repos` is the host repository root;
if `HOME` is absent, `docker compose config` fails with a bind-mount-specific
error instead of selecting a fallback path. Do not replace this source with a
checkout-specific directory.

For example, the WSL host path `$HOME/repos/ingenium` appears in the container
as `/workspace/ingenium`. On Windows, Docker's published `3000:3000` gateway is
available through `http://localhost:3000` via WSL localhost forwarding, while
the same WSL repository tree is available in Explorer at
`\\wsl.localhost\<distribution>\home\<user>\repos`. These are two views of the
same WSL-hosted repositories; do not substitute a Windows-drive path for the
Compose bind source.

### Mail durability and Compose project identity

The canonical Ingenium SQLite path in the container is `/app/.ingenium/data` (no
`.db` suffix). It lives on the `ingenium-data` named volume. Rebuilds replace the
image, not the named volume, so `docker compose up --build -d` preserves mail
accounts, cached mail, settings, and encrypted credential metadata.

Docker prefixes declared volume names with the Compose project name. Keep using
the same checkout and project name; changing `-p`, `COMPOSE_PROJECT_NAME`, or the
directory used to invoke Compose can select a new, empty volume. Do not use
`docker compose down -v` for a rebuild or restart: `-v` deletes the persisted
volume. Prefer:

```bash
docker compose -p ingenium up --build -d
docker compose -p ingenium restart
```

If an existing installation was started under another project name, continue
using that exact name or perform an operator-controlled volume migration with a
backup first. Do not create a second database by copying data to `data.db`,
`.ingenium/data.db`, or another project-prefixed volume.

---

## Health Check

The API health endpoint is authenticated. The container health script loads the
token from `/run/ingenium-secrets/api-token` in a clean environment and probes
the `4097` boundary. It also checks supervised process state and the local
gateway roots. A missing/invalid token therefore makes the container unhealthy;
health never falls back to an unauthenticated request.

The authenticated healthcheck re-executes as `appuser` before reading the token.
The runtime token is an `appuser`-owned mode-`0600` file, so its owner and mode
validation require the probe to run under that identity. Do not run the probe as
another user or relax the token-file permissions.

```yaml
healthcheck:
  test: ["CMD", "/app/scripts/healthcheck.sh"]
  interval: 15s
  timeout: 10s
  retries: 5
  start_period: 90s
```

---

## OpenCode Web/CLI Mode Switch

The dashboard `/opencode` page features a **dual-mode** interface:

- **Web mode** — Embeds the OpenCode Web UI in a full-viewport iframe. The iframe `src` is dynamically resolved by `runtime-urls.ts` using a **two-tier embedding model**:
  - **Host gateway HTTP**: local root `http://opencode.localhost:3000/` without browser credentials
  - **Remote/LAN**: requires a separate operator-managed TLS-authenticated profile protecting the dashboard and both explicit `NEXT_PUBLIC_OPENCODE_WEB_URL` and `NEXT_PUBLIC_OPENCODE_CLI_URL` root HTTPS origins (for example, `https://opencode.example.com/` and `https://cli.example.com/`). Plain LAN HTTP is not a supported remote profile.
  - > The old `/opencode-web/` same-origin proxy rewrites are unsupported — OpenCode serves root-relative assets and cannot be proxied under a sub-path.
- **CLI mode** — Embeds the local root `http://cli.localhost:3000/` gateway, or an explicit dedicated root HTTPS origin via `NEXT_PUBLIC_OPENCODE_CLI_URL`. The old `/opencode-cli/` subpath proxy is unsupported.
- **Glass tab**: Right-edge toggle (`backdrop-blur-sm`, `fixed right-0 top-1/2`). Expands on hover. Keyboard shortcut: `Ctrl+Shift+\``
- **Dual-iframe architecture**: Both iframes remain in the DOM. Inactive one hidden via `opacity: 0` / `visibility: hidden` / `pointer-events: none` (not `display:none`) to prevent xterm dimension zeroing
- **Mode persistence**: Saved in `localStorage` under `opencode-mode`

### Terminal Attachment (Direct)

```bash
Use the embedded CLI mode; direct host attachment to port 4098 is intentionally not supported.
```

Web and CLI sessions share the same backend process state.

### Build, restart, rollback, and image provenance

`NEXT_PUBLIC_*` values are inlined by Next.js during the image build. Changing them in a running container does nothing; set both values before `docker compose up --build -d`. `OPENCODE_SERVER_PASSWORD` and `INGENIUM_API_TOKEN` (or `INGENIUM_API_TOKEN_FILE`) are required to start the deployment. The API token is injected by the loopback boundary proxy and dashboard server; it is never a browser setting. After a secret-only change, recreate/restart the container so the entrypoint reseeds `/run/ingenium-secrets/api-token` and `/workspace/.opencode/.ingenium-api-token`, and every process reloads the token. A source, proxy, Dockerfile, or build-time-origin change requires `docker compose up --build -d`; an environment-only secret change does not. After a build or gateway change, restart and verify the dashboard plus both local OpenCode roots from the actual browser path. If verification fails, roll back the image and build-time configuration; never publish the private 4098/4099 listeners as a workaround.

Every Compose command requires `IMAGE_REVISION`, a lowercase 40-character SHA
from the checkout being deployed. Export it once per shell before running
Compose, or prefix an individual command:

```bash
export IMAGE_REVISION="$(git rev-parse HEAD)"
docker compose up --build -d
./scripts/validate-image-provenance.mjs "$IMAGE_REVISION"
```

The runtime image carries `org.opencontainers.image.revision` and
`org.opencontainers.image.source` OCI labels. The revision is passed only as a
build argument; the source defaults to the public repository URL. Neither is a
runtime environment variable or a credential. The verifier inspects only the
running Compose image, checks the expected SHA and a credential-free HTTPS
source URL, rejects secret-bearing label keys, and never prints raw labels.

The API uses a clean source build on startup/image creation. Docker excludes
generated `dist/` directories from the build context, compiles the current API
source into the builder output, and starts that output. A partial or stale
tracked `services/ingenium-api/dist` tree is not an input to the runtime.

The host-loopback API boundary is `127.0.0.1:4097`; it validates and replaces the bearer token before forwarding to Express on private port `4096`. Host port `1455` reaches the Nginx listener, which forwards only the exact `GET /auth/callback` path to private Express `4096`; the auth middleware allowlists that method/path without a bearer token. Every other path is rejected (`404` for other paths, `405` for non-GET). See [API Authentication](../security/api-authentication.md) for token lifecycle, CSRF, rotation, and the public-JWT incident release hold.

### Troubleshooting deployment and restart failures

| Symptom | Likely cause | Correct action |
|---|---|---|
| Container exits before supervisord starts | Missing/invalid API token, unsafe token file, or invalid email secret | Provide a valid secret/file with required permissions. Do not disable API auth or print the value. |
| `401` at `127.0.0.1:4097` | Missing or malformed `Authorization: Bearer` header | Use the secret store or protected MCP file; do not put the token in a URL or command-line argument. |
| `403` at `4097` | Token does not match the deployed runtime token | Reseed the host file with `scripts/bootstrap-local-secrets.sh`, then recreate the container. |
| Dashboard API returns `503` | Dashboard server cannot load the runtime token | Restart/recreate the container; a source or proxy change requires `--build`. |
| Dashboard mutation returns `403` | Missing/wrong `Origin` or `X-Ingenium-UI: dashboard` marker | Use the same-origin dashboard path. MCP/server callers should not add browser headers. |
| Health is unhealthy | Authenticated API probe or a supervised gateway process failed | Check `docker compose ps` and logs, then verify token-file metadata and restart. Health does not bypass bearer auth. |
| OAuth callback fails | Request is not exactly `GET /auth/callback` on loopback `1455`, or OAuth state is invalid/expired | Use the provider redirect to `http://localhost:1455/auth/callback`; do not use `1455` as an API tunnel. |
| Changed `NEXT_PUBLIC_*` URL has no effect | Values are build-time dashboard settings | Set both origins before `docker compose up --build -d`; restart alone is insufficient. |
| MCP still uses an old token | OpenCode child process retained old config/process state | Replace the protected file, restart OpenCode, and restart/recreate the container if its runtime token changed. |
| Mail accounts disappear after rebuild | A different Compose project name selected a new named volume, or `down -v` removed the old one | Stop; do not recreate accounts. Re-run with the original project name and verify `/app/.ingenium/data`. |
| Mail shows `degraded` or asks to reconnect after restart | Credentials cannot be decrypted or a folder hit the auth circuit breaker | Keep the account; use **Reconnect**. OAuth accounts require provider consent; app-password accounts use the credential update form. |
| Restart reports an encryption-key mismatch | `INGENIUM_EMAIL_ENCRYPTION_KEY` differs from the key that encrypted stored credentials | Restore the original secret from the operator secret store. Do not rotate blindly or overwrite credentials; the fingerprint is diagnostic only. |

Never expose ports `4096`, `4098`, or `4099` to make a failing deployment appear
healthy. Never include token bytes in logs, diagnostics, screenshots, or bug
reports.

---

## Dockerfile Notes

- **Native-module libc parity**: The builder and runtime stages both use the glibc-based `node:22-slim` image. Native addons such as `better-sqlite3` are built or selected in the builder and loaded once in the runtime image during the build; do not switch only one stage to Alpine/musl.
- **Nginx runtime paths and validation**: Nginx runs unprivileged as `appuser`. The image creates the owner-only `/run/ingenium-gateway` PID, lock, and temporary paths, verifies those directories are writable by `appuser`, and runs the gateway validation (including `nginx -t`) as `appuser`. At container startup, the entrypoint recreates the ephemeral directories and replaces the owner-only error-log file before Nginx or Supervisor opens it; it then repeats validation as `appuser`. Access logging is disabled, while Nginx writes warnings to `/run/ingenium-gateway/nginx-error.log`, the same file Supervisor exposes for gateway log reads.
- **Build output**: API and other package artifacts are produced in the builder stage and copied into the runtime image; do not treat local `dist/` output as deployment input.
- **Dashboard public assets**: The runtime image copies `services/ingenium-dashboard/public` beside the standalone dashboard server, and copies `.next/static` separately. Keep public files in the dashboard `public/` directory; a standalone build does not make those assets available unless the runtime image copies them explicitly.
- **git**: Dockerfile installs `git` for OpenCode repository creation inside the container
- **Migrations**: The runtime image includes the migration directory needed for incremental DB upgrades.

---

## Application Health (In-Process Services)

The Status page reports `synthesis-engine` and `email-client` via:

```
GET /api/v1/services/applications/:name
```

This queries `synthesis.getSynthesisStatus()` and `ingenium-email`'s `getEngineStatus()` directly — NOT via supervisord. See `services/ingenium-api/lib/routes/services.ts` lines 216–289 for implementation.

---

## Typical Commands

```bash
# Build and start
export IMAGE_REVISION="$(git rev-parse HEAD)"
docker compose up --build

# Start in background
docker compose up -d

# Tail logs
docker compose logs -f

# Restart a specific service
docker compose restart ingenium

# Rebuild after source/config/image changes
docker compose up --build -d

# Recreate after changing environment secrets
docker compose up -d

# Execute tests inside container
docker compose exec ingenium npm test
docker compose exec ingenium npm run check

# Shell access
docker compose exec ingenium /bin/bash
```
