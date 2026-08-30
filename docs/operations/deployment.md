---
title: Deployment Guide
description: Docker deployment guide — services, ports, volumes, health checks for the Ingenium system.
---

# Deployment Guide

> **Note:** This document is the canonical operations reference for deployment. The AGENTS.md file contains a summary only.

---

## Overview

Docker Compose provides three explicit deployment profiles:

- `compatibility` keeps the established single container and nine active
  supervisord processes (seven primary services plus the restore handoff and
  OpenCode internal auth proxy).
- `production` separates the control plane from a private Docker-socket-owning
  runtime manager and builds one isolated `user-runtime` container per authorized
  owner/workspace. A separate unprivileged runtime gateway terminates wildcard TLS
  and routes authenticated Web, CLI, and VS Code audiences without a Docker socket.
- `runtime-build` builds the immutable `user-runtime` image as
  `ingenium-user-runtime:${IMAGE_REVISION}` and exits; it does not start an
  application service.

The compatibility container runs:

1. **API boundary** (host-loopback :4097 → private Express :4096)
2. **Dashboard** (Next.js on private :3001, exposed through the :3000 gateway)
3. **API** (private Express on :4096)
4. **Nginx gateway** (host :3000 and OAuth callback :1455)
5. **Restore handoff** (fixed Unix-socket maintenance handoff)
6. **OpenCode internal auth proxy** (private :4101 → OpenCode Web :4098)
7. **opencode-web** (on :4098)
8. **ttyd-opencode** (on :4099)
9. **code-server** (private on :4100; exposed only through `vscode.localhost:3000`)

---

## Quick Start

```bash
# Generate compatibility deployment credentials as separate owner-only host files.
# Compose receives only paths and mounts each file read-only.
./scripts/bootstrap-local-secrets.sh

# Record the exact checkout used for this image. Compose cannot evaluate Git
# commands, so IMAGE_REVISION is required for every Compose invocation.
export IMAGE_REVISION="$(git rev-parse HEAD)"

# Start the established local compatibility profile (with build)
docker compose --profile compatibility up --build

# Start without rebuild
docker compose --profile compatibility up

# Stop all compatibility services
docker compose --profile compatibility down

# View compatibility logs
docker compose --profile compatibility logs -f

# Execute commands inside container
docker compose --profile compatibility exec ingenium npm run test
docker compose --profile compatibility exec ingenium npm run typecheck
```

After a detached compatibility deployment, verify the running image metadata
without dumping its labels or reading deployment secrets. The validator uses
Docker service/project/repository labels directly and never renders Compose.
Compatibility is the validator's default and targets only the `ingenium` service:

```bash
./scripts/validate-image-provenance.mjs "$IMAGE_REVISION"
```

Seed the internal installation credential before starting the deployment:

```bash
./scripts/bootstrap-local-secrets.sh
docker compose --profile compatibility up --build -d
```

The script creates or validates the mode-`0600` installation-token file below
the mode-`0700` host configuration directory and writes only its path to the
ignored `.env`. Use `--rotate` for operator recovery. It never copies the
installation bearer into OpenCode. Issue scoped MCP and repository-sync
credentials after browser bootstrap and store them in owner-only ignored files.
Do not print generated values.

### Protected token-file runtime

Compose passes the installation API bearer only as a protected regular file.
Docker startup requires `INGENIUM_API_TOKEN_FILE`, mounts its absolute host path
read-only at `/run/ingenium-bootstrap/api-token`, and the root entrypoint
atomically copies it to `/run/ingenium-secrets/api/installation-api-token`, an
owner-only mode-`0600` file for `ingenium-api`. Symlinks, non-regular files, and
unsafe ownership or permissions are rejected. Any inline `INGENIUM_API_TOKEN` is
removed before supervisord starts its children; inline input is only a
standalone non-container development fallback.

The root entrypoint performs the privileged bootstrap copy before Supervisor
starts and gives each consumer its own mode-`0600` file in a mode-`0700`
service directory. Service identities cannot read or replace another service's
file. The two files for the Dashboard bootstrap exchange contain the same
per-start credential, but they are separately owned copies rather than shared
filesystem access:

| Credential | Runtime file and owner | Exact consumer |
|---|---|---|
| Installation API bearer | `/run/ingenium-secrets/api/installation-api-token` — `ingenium-api`, mode `0600` | `ingenium-api` startup and authentication, including its API-owned scheduler and OpenCode-message requests that call `loadApiToken()` |
| Dashboard bootstrap bearer, distinct from the installation bearer | `/run/ingenium-secrets/dashboard/bootstrap-token` — `ingenium-dashboard`, mode `0600`; paired API copy at `/run/ingenium-secrets/api/dashboard-bootstrap-token` — `ingenium-api`, mode `0600` | Dashboard proxy and API authentication for the exact `/api/v1/bootstrap/status` and `/api/v1/bootstrap/claim` exchange only |

The Dashboard launcher receives only `INGENIUM_DASHBOARD_BOOTSTRAP_TOKEN_FILE`
pointing to its copy. The API launcher receives the paired API copy. Neither
the Dashboard nor the API receives the other's file, and no boundary, health
probe, OpenCode, or user-runtime process is given the installation bearer via
an environment variable or runtime file.
The email watcher is an in-process API feature: it calls `getCredentials()` for
the account and connects with that account's encrypted IMAP password/app
password or OAuth access token. Those credentials are decrypted with the
API-owned `INGENIUM_EMAIL_ENCRYPTION_KEY_FILE`; the watcher does not read either
API bearer file. Credential contents are never part of logs, observations, or
diagnostics.

### Persistent authentication encryption key

Before Supervisor starts, the entrypoint atomically provisions
`/app/.ingenium/auth-encryption-key` in the persistent Ingenium data volume. The
file contains one base64url-encoded 256-bit value, is owned by `root:root`, and
has mode `0600`. Existing valid content is retained on restart; symlinks,
non-regular files, wrong ownership/mode, and malformed values stop startup. The
entrypoint creates an owner-only ephemeral API copy, and the clean API launcher
receives only that file path through `INGENIUM_AUTH_ENCRYPTION_KEY_FILE`; the API
validates it before binding.
Do not add the key value to Compose, `.env`, logs, or tracked files.

### Isolated production runtime profile

Build the immutable runtime image before starting the control plane. The manager and
runtime-gateway credentials must be distinct regular owner-only files containing
43–128 base64url characters; the Compose `/dev/null` defaults are deliberately
nonfunctional. Configure an exact runtime root domain and a read-only wildcard
certificate/key covering that domain. The `*_FILE` values below are absolute
paths on the Docker host; Compose mounts them at protected container paths.
`INGENIUM_RUNTIME_WORKSPACE_VALIDATION_SOURCE` is also a host path, while
`INGENIUM_RUNTIME_WORKSPACE_VALIDATION_TARGET` is its container mount target.

Copy `config/runtime-workspaces.example.json` to an operator-controlled file and add
only approved mappings. Every mapping has `id`, the exact host `hostPath` later mounted
at `/workspace`, and a distinct `validationPath` mounted read-only into the manager.
Set the canonical Compose validation source and target variables for that mapping;
startup rejects missing dedicated mounts, symlinks, writable map files, duplicate IDs,
and source/root mismatches. An external Compose override is not required.

```json
{
  "version": 1,
  "workspaces": [
    {
      "id": "workspace-uuid-or-stable-id",
      "hostPath": "/srv/ingenium-workspaces/example",
      "validationPath": "/mnt/approved-workspaces/example"
    }
  ]
}
```

```yaml
services:
  runtime-manager:
    volumes:
      - /srv/ingenium-workspaces/example:/mnt/approved-workspaces/example:ro
```

```bash
export IMAGE_REVISION="$(git rev-parse HEAD)"
export INGENIUM_RUNTIME_MANAGER_TOKEN_FILE='/etc/ingenium/runtime-manager.token'
export INGENIUM_RUNTIME_GATEWAY_TOKEN_FILE='/etc/ingenium/runtime-gateway.token'
export INGENIUM_RUNTIME_WORKSPACE_MAP_FILE='/etc/ingenium/runtime-workspaces.json'
export INGENIUM_RUNTIME_WORKSPACE_VALIDATION_SOURCE='/srv/ingenium-workspaces/example'
export INGENIUM_RUNTIME_WORKSPACE_VALIDATION_TARGET='/mnt/approved-workspaces/example'
export INGENIUM_RUNTIME_SCHEME='https'
export INGENIUM_RUNTIME_ROOT_DOMAIN='runtime.example.com'
export INGENIUM_RUNTIME_GATEWAY_BIND_ADDRESS='0.0.0.0'
export INGENIUM_RUNTIME_GATEWAY_HOST_PORT='443'
export INGENIUM_RUNTIME_GATEWAY_PORT='8443'
export INGENIUM_RUNTIME_TLS_CERT_FILE='/etc/ingenium/runtime-wildcard.crt'
export INGENIUM_RUNTIME_TLS_KEY_FILE='/etc/ingenium/runtime-wildcard.key'
export DASHBOARD_ALLOWED_ORIGINS='https://dashboard.example.com'

docker compose --profile runtime-build build runtime-image
docker compose --profile production up --build -d control-plane runtime-gateway runtime-manager
./scripts/validate-image-provenance.mjs "$IMAGE_REVISION" --profile production
./scripts/validate-database-integrity.mjs
```

Only `runtime-manager` mounts `/var/run/docker.sock`; never add that mount to the
control plane, runtime gateway, or a user runtime. The manager port and runtime ports
4098/4099/4100 remain un-published. With the explicit remote values above, the gateway
alone publishes HTTPS 443 from its unprivileged 8443 listener. Each runtime receives a dedicated Docker network, exact worktree
mount, read-only root filesystem, private HOME/XDG tmpfs, and bounded resources.
The default production Compose rendering is local-only: `http`, `runtime.localhost`,
and the sole gateway publication `127.0.0.1:80:8080`. This special-use
origin is browser-trustworthy without installing a CA. Never use that HTTP path for
a remote, custom, LAN, or non-loopback runtime domain.
The runtime keeps `/tmp` and HOME `noexec`; only the owner-only 64 MiB
`/home/appuser/.tmp` nested tmpfs is executable so the pinned OpenCode CLI can
load its extracted OpenTUI native library.
The manager transfers the scoped runtime capability through attached container stdin;
the entrypoint atomically installs it as an owner-only file on the private runtime
tmpfs before any supervised service starts. It is never an environment value, image
layer, or writable-root archive.

The manager attaches only the identity-labeled control plane and runtime gateway to a
runtime network. The gateway accepts exact `<audience>--<runtime-id>.<domain>` Hosts,
redeems a browser-generated one-time proof over its narrow `runtime-gateway` audience
credential through the API boundary, and sets one
host-only `Secure`, `HttpOnly`, `SameSite=None` audience cookie so the cross-site
dashboard iframe can authenticate. Requests and
WebSocket handshakes require a live session; logout and runtime revoke advance the
generation and close streams or reconnects.

The dashboard first loads a browser-safe profile descriptor. Compatibility uses the
three fixed local aliases and never calls the runtime manager. Production lists only
the signed-in user's still-authorized organization/project workspaces and requires an
explicit selection plus start/resume; zero, one, and many candidates never trigger
automatic selection or authorization. Last-used is only a revalidated preference.
Authenticated HTTP requests, WebSocket lifecycles, and generation start/finish events
renew the bounded idle lease. Health/status polling does not, and renewal never extends
the absolute lease. Close, logout/revoke, stop, and crash reconcile counters.

The API boundary strips caller-supplied gateway/private-network assertions and writes
the private marker only after validating the distinct gateway credential and exact
exchange, validate, or activity route. The Dashboard proxy denies those routes before rewriting.

---

## Services

### 1. API boundary and Express API

The loopback-only `127.0.0.1:4097` listener is an authenticated bearer boundary.
Its clean launcher receives no token-file environment. The boundary validates
only the shape of an incoming bearer and forwards that bearer; private Express
performs credential validation against the installation, scoped, or service
credential it receives. Only the exact `GET /api/v1/health` request is forwarded
without a bearer; other requests without a valid bearer are rejected. Network
locality never bypasses validation.

### 2. Dashboard (Next.js on private :3001 behind the :3000 gateway)

24 primary navigation routes plus the 19-tab Settings overlay. Compose publishes the
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

In compatibility mode, OpenCode Web is reached through `http://opencode.localhost:3000`.
In production that fixed alias returns the common static no-store `404` picker guidance
and never reaches an absent upstream. Do not publish port 4098.

### 4. ttyd-opencode (internal :4099)

In compatibility mode, ttyd is reached through `http://cli.localhost:3000`. Production
returns the same static `404` as the other aliases. Do not publish port 4099.

```bash
ttyd --port 4099 opencode attach http://localhost:4098 --dir /workspace
```

### 5. code-server (internal :4100)

Compatibility reaches code-server through `http://vscode.localhost:3000/`. Production
returns the same static `404` and uses only the selected runtime's audience root. Do
not publish port 4100.

The image bakes the official Open VSX
`sst-dev.opencode@0.0.13` artifact from
`https://open-vsx.org/api/sst-dev/opencode/0.0.13/file/sst-dev.opencode-0.0.13.vsix`
with SHA-256
`e9a75751aa21fce3f9c9822d1f718043b1a9ba97e64c66b190a3fa85850c60d4`. Startup
verifies that identity, code-server engine compatibility, and the hash, then
installs it offline and idempotently as `ingenium-vscode` into
`/home/ingenium-vscode/vscode-data/extensions`. No runtime registry or marketplace
installation is permitted.

The image also supplies system-theme defaults through a code-free built-in
`configurationDefaults` contribution: auto detection follows the system and
uses **Dark Modern**/**Light Modern**. Explicit user or workspace values win;
startup never rewrites User or workspace settings. The `vscode-data` named
volume preserves settings and extensions across restart, rebuild, and an
existing volume; a fresh volume is initialized with the same defaults and
pinned extension. After upgrading the image, restart the service and revalidate
the `ingenium-vscode` identity, engine compatibility, artifact hash, extension list, and
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
| `3000` | Nginx gateway | Local dashboard and root gateways; fixed runtime aliases proxy only in compatibility and return identical static no-store `404` guidance in production |
| internal `3001` | Dashboard | Private Next.js frontend behind the gateway |
| `127.0.0.1:4097` | API boundary | Authenticated host-loopback bearer boundary |
| internal `4096` | Express API | Private upstream and sole DB authority |
| internal `4101` | OpenCode internal auth proxy | Private API-only Basic-auth proxy to OpenCode Web on `4098` |
| internal `4098` | OpenCode Web | Private upstream served through local `opencode.localhost:3000` |
| internal `4099` | ttyd-opencode | Private upstream served through local `cli.localhost:3000` |
| internal `4100` | code-server | Private upstream served through local `vscode.localhost:3000`; no public `4100` endpoint |

> 🔴 The browser-facing contract is the unauthenticated local port 3000 gateway. Port 4097 is a separate bearer-authenticated host-loopback MCP boundary; ports 4098, 4099, and 4100 are private container upstreams, not direct host endpoints. The gateway never forwards a browser bearer token. Plain HTTP is not an approved LAN/remote deployment profile.

The supported dashboard origins in the default profile are `http://localhost:3000/` and
`http://127.0.0.1:3000/`. The OpenCode roots remain
`http://opencode.localhost:3000/` and `http://cli.localhost:3000/`, while VS Code uses
`http://vscode.localhost:3000/`; these are separate local gateway hosts, not dashboard
aliases.

### Gateway rate-limit and origin policy

Nginx keeps dashboard, OpenCode, and VS Code request budgets separate. Dashboard
documents/RSC traffic and unsafe or expensive API requests retain the `30r/s`,
burst-`60`, `nodelay` policy. Only the positive `GET` templates in
`services/ingenium-api/config/dashboard-safe-reads.json` use the per-address
`dashboard_api_read` zone at `60r/s`, burst `360`; HEAD, unmatched, encoded or
ambiguously normalized paths remain strict. The same canonical file generates
`nginx/dashboard-safe-reads-map.conf`, and startup validation rejects drift.
Express caps aggregate candidate admission at `480` reads/minute per socket IP
and grants only a resolved browser session the matching per-IP/session allowance.
Failed candidate authentication is charged to the shared strict `100`/minute
IP bucket before a 101st token/session lookup. Service actors, writes,
login/step-up/token issuance, runtime exchange, reports, synthesis, streams,
providers, searches, exports, downloads, backups, and other protected reads stay
strict or retain their dedicated limiter. Gateway-generated `429` responses
include `Retry-After: 1`.

The retained 86-state evidence classifies 26 of 329 observed GETs as safe and
303 as strict. Project/organization/runtime workspace, Docs space, MCP server
and tool catalogs, personality collections, and usage breakdowns remain strict
because their handlers are not numerically bounded. The largest observed page issued 12 API GETs, below the
strict burst of 60. Human-paced acceptance is sequential navigation with at
least ten seconds between route transitions. Across the retained profile, 303
strict GETs plus 51 strict non-GETs then average about 25 requests/minute, below
the API's strict 100 requests/minute. The largest state contained 12 GETs and one
non-GET: its 13 total requests remain below Nginx's burst of 60 and, at the
ten-second cadence, below both Nginx's 30 requests/second sustained rate and
the API's 100 requests/minute ceiling. Faster automated sweeps must apply equivalent
pacing rather than broadening production limits.

OpenCode build/runtime assets (`/assets/`, `/_next/`, `/@vite/`, and Vite
dependencies) and upgrade handshakes use an empty key and therefore do not
consume the dynamic OpenCode budget. The gateway still limits connections to
`16` per client address.

The default dashboard origin contract is `localhost:3000` or
`127.0.0.1:3000`. Nginx redirects direct IPv6 loopback hosts (`::1` and
`[::1]`) with `308` to `http://localhost:3000$request_uri`; this canonical
origin is required because the iframe CSP allowlist uses valid `localhost` and
`127.0.0.1` sources rather than an IPv6 literal. OpenCode remains on the
separate root hosts `opencode.localhost:3000` and `cli.localhost:3000`.

The OpenCode upstreams are private container listeners on `127.0.0.1:4098`
and `127.0.0.1:4099`, and code-server is private on `127.0.0.1:4100`, with no host
publication. `proxy-opencode.conf` clears
browser-supplied authorization, identity, and proxy-chain headers before
forwarding. The CLI gateway then injects its fixed internal identity, and the
gateway replaces upstream framing headers with the explicit loopback-only
`frame-ancestors` policy. Do not expose 4098/4099/4100 or forward browser bearer
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

The Compose deployment keeps three primary Ingenium/OpenCode persistence stores
mounted across image rebuilds:

| Volume Name | Mount Path | Purpose |
|-------------|------------|---------|
| `ingenium-data` | `/app/.ingenium` | SQLite databases, learnings, tasks, projects, commands |
| `opencode-config` | `/home/ingenium-opencode/.config` | OpenCode configuration (persists across rebuilds) |
| `opencode-data` | `/home/ingenium-opencode/.local` | OpenCode auth-data and user data, including native provider auth at `/home/ingenium-opencode/.local/share/opencode/auth.json` |

The separate `vscode-data` volume preserves code-server settings and extensions;
it does not replace any of the three stores above.

### Workspace bind-mount (Windows + WSL)

Compose requires `HOME` and mounts exactly `${HOME}/repos:/workspace`. Start
Compose from a WSL/Linux shell where `$HOME/repos` is the host repository root;
if `HOME` is absent, `docker compose --profile compatibility config` fails with a bind-mount-specific
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
image, not the named volume, so `docker compose --profile compatibility up --build -d` preserves mail
accounts, cached mail, settings, and encrypted credential metadata.

`docker-compose.yml` declares the top-level Compose project name as `ingenium`.
Therefore ordinary `docker compose ...` invocations using this file keep the
default volume names stable across supported invocation directories. Docker
prefixes each declared volume with that project name, so the default stores are
named `ingenium_ingenium-data`, `ingenium_opencode-config`, and
`ingenium_opencode-data`.

Explicit project selection remains an intentional override. Either
`docker compose --profile compatibility -p another-store ...` or
`COMPOSE_PROJECT_NAME=another-store docker compose --profile compatibility ...` selects a distinct
`another-store_*` volume set and therefore a distinct store. Use the canonical
name explicitly when scripting or when you want the project identity visible:

```bash
docker compose --profile compatibility -p ingenium up --build -d
docker compose --profile compatibility -p ingenium restart
```

If an existing installation was started under another project name, continue
using that exact name or perform an operator-controlled volume migration with a
backup first. Do not create a second database by copying data to `data.db`,
`.ingenium/data.db`, or another project-prefixed volume.

Do not use `docker compose down -v` for a rebuild or restart: `-v` deletes the
selected persisted volumes.

---

## Health Check

The limited API health endpoint is credential-free. The boundary's exact
`GET /api/v1/health` exception and the API auth middleware both allow that
request, so the container health script uses a clean environment and probes it
through `4097` without receiving the installation bearer. It also checks
supervised process state, restore inactivity, private data-root safety, and
local gateway roots.

Credential-free health does not make the installation bearer optional. The root
entrypoint refuses to start Supervisor when the host installation file is
missing or unsafe. In Compose, the clean API launcher then refuses to bind if
the API runtime token file is missing or invalid; standalone non-container API
development may use the documented inline fallback. In either failure case the
composite container health check cannot become healthy; the health probe itself
still never reads a credential.

Health validation is profile-aware. Compatibility requires healthy Web, CLI, and VS
Code aliases. Production requires all three aliases to return byte-identical `404`
guidance with `Cache-Control: no-store`, `nosniff`, and restrictive CSP; an upgrade
request must stop at the static response.

Entrypoint isolation validation checks the owner-only consumer files and proves
that every unrelated service identity, including `appuser`, cannot read or
replace them.

For a production data-integrity proof, run
`./scripts/validate-database-integrity.mjs`. It resolves the exact repository-owned
`control-plane` from Docker labels and executes the built API integrity CLI inside
that container. The CLI opens the canonical database read-only, runs SQLite
integrity and foreign-key checks, and returns only status and violation counts;
the host never reads the database or receives a credential.

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

- **Compatibility** — Web, CLI, and VS Code use the exact fixed `.localhost:3000`
  aliases. The trusted profile descriptor prevents dynamic-manager calls.
- **Production** — The page renders an authorization-filtered picker and explicit
  start/resume. Once ready, Web and CLI redeem separate one-time proofs for exact
  runtime HTTPS roots. There is no fixed-alias or singleton fallback.
- The old `/opencode-web/` and `/opencode-cli/` subpath rewrites remain unsupported.
- **Glass tab**: Right-edge toggle (`backdrop-blur-sm`, `fixed right-0 top-1/2`). Expands on hover. Keyboard shortcut: `Ctrl+Shift+\``
- **Dual-iframe architecture**: Both iframes remain in the DOM. Inactive one hidden via `opacity: 0` / `visibility: hidden` / `pointer-events: none` (not `display:none`) to prevent xterm dimension zeroing
- **Mode persistence**: Saved in `localStorage` under `opencode-mode`

### Terminal Attachment (Direct)

```bash
Use the embedded CLI mode; direct host attachment to port 4098 is intentionally not supported.
```

Web and CLI sessions share the same backend process state.

### Build, restart, rollback, and image provenance

`NEXT_PUBLIC_*` values are inlined by Next.js during the image build. Changing them in a running container does nothing; set both values before `docker compose --profile compatibility up --build -d`. `OPENCODE_SERVER_PASSWORD_FILE`, `INGENIUM_EMAIL_ENCRYPTION_KEY_FILE`, and `INGENIUM_API_TOKEN_FILE` are required protected host inputs for Compose. Their values are never projected into Docker configuration: root mounts each read-only and copies it only to the service-owned runtime file that consumes it. The Dashboard bootstrap bearer is generated separately inside the root entrypoint and written to its API-owned and Dashboard-owned copies; it is not the installation bearer. After a deployment-secret change, recreate/restart the affected container. Manual scoped-credential replacement still requires an OpenCode restart; the exact `ingenium-coordination-reset reset` flow is the exception and reconnects an already-loaded session coordinator in-process. Reset uses a protected plaintext file/descriptor when supplied, otherwise the ignored nonsecret `.opencode/.ingenium-coordination-owner-provider.json` reference created by `ingenium-coordination-reset store --key-file <absolute-path> --bundle-directory <absolute-path>`. The authenticated ciphertext directory and protected key directory must be separate owner-only host paths outside the worktree. A source, proxy, Dockerfile, or build-time-origin change requires `docker compose --profile compatibility up --build -d`; a protected-file-only secret change does not. After a build or gateway change, restart and verify the dashboard plus the local OpenCode and VS Code roots from the actual browser path. If verification fails, roll back the image and build-time configuration; never publish the private 4098/4099/4100/4101 listeners as a workaround.

Every Compose command requires `IMAGE_REVISION`, a lowercase 40-character SHA
from the checkout being deployed. Export it once per shell before running
Compose, or prefix an individual command:

```bash
export IMAGE_REVISION="$(git rev-parse HEAD)"
docker compose --profile compatibility up --build -d
./scripts/validate-image-provenance.mjs "$IMAGE_REVISION"
# Production must select the control-plane service explicitly.
./scripts/validate-image-provenance.mjs "$IMAGE_REVISION" --profile production
```

The runtime image carries `org.opencontainers.image.revision` and
`org.opencontainers.image.source` OCI labels. The revision is passed only as a
build argument; the source defaults to the public repository URL. Neither is a
runtime environment variable or a credential. The verifier inspects only the
running Compose image, checks the expected SHA and a credential-free HTTPS
source URL, rejects secret-bearing label keys, and never prints raw labels. It
selects the exact service through Docker labels and does not invoke Compose, so
unrelated interpolation secrets are not required for verification.

The API uses a clean source build on startup/image creation. Docker excludes
generated `dist/` directories from the build context, compiles the current API
source into the builder output, and starts that output. A partial or stale
tracked `services/ingenium-api/dist` tree is not an input to the runtime.

The host-loopback API boundary is `127.0.0.1:4097`; it validates and replaces the bearer token before forwarding to Express on private port `4096`. Host port `1455` reaches the Nginx listener, which forwards only the exact `GET /auth/callback` path to private Express `4096`; the auth middleware allowlists that method/path without a bearer token. Every other path is rejected (`404` for other paths, `405` for non-GET). See [API Authentication](../security/api-authentication.md) for token lifecycle, CSRF, rotation, and the historical public-JWT incident status.

### Troubleshooting deployment and restart failures

| Symptom | Likely cause | Correct action |
|---|---|---|
| Container exits before supervisord starts | Missing/invalid API token, unsafe token file, or invalid email secret | Provide a valid secret/file with required permissions. Do not disable API auth or print the value. |
| `401` at `127.0.0.1:4097` | Missing or malformed `Authorization: Bearer` header | Use the secret store or protected MCP file; do not put the token in a URL or command-line argument. |
| `401` at `4097` | Token does not match the deployed runtime token | Rotate with `scripts/bootstrap-local-secrets.sh --rotate`, then recreate the container. |
| Dashboard API returns `503` | Dashboard server cannot load its protected bootstrap credential | Restart/recreate the container; a source or proxy change requires `--build`. |
| Dashboard mutation returns `403` | Missing/wrong `Origin` or `X-Ingenium-UI: dashboard` marker | Use the same-origin dashboard path. MCP/server callers should not add browser headers. |
| Health is unhealthy | Credential-free API readiness probe or a supervised gateway/process check failed | Check `docker compose ps` and logs, then verify service and protected-file metadata before restarting. The liveness probe intentionally does not receive a bearer credential. |
| OAuth callback fails | Request is not exactly `GET /auth/callback` on loopback `1455`, or OAuth state is invalid/expired | Use the provider redirect to `http://localhost:1455/auth/callback`; do not use `1455` as an API tunnel. |
| Changed `NEXT_PUBLIC_*` URL has no effect | Values are build-time dashboard settings | Set both origins before `docker compose --profile compatibility up --build -d`; restart alone is insufficient. |
| External coordination MCP still uses an old token | The protected credential is invalid or was replaced outside the coordinator reset flow | Run exact `ingenium-coordination-reset reset` with one protected owner-secret file/descriptor or the pre-provisioned encrypted owner provider. Manual replacement still requires restarting OpenCode; recreate the container only if its separate runtime token changed. |
| Extraction or synthesis reports learning authentication failure | The isolated learning credential was revoked or expired | Run `ingenium-coordination-reset reset-learning` through the pre-provisioned encrypted owner provider, then retry the short-lived learning operation. This does not replace or reconnect the general coordination credential. |
| Mail accounts disappear after rebuild | An explicit `-p`/`COMPOSE_PROJECT_NAME` override selected a different named volume, or `down -v` removed the old one | Stop; do not recreate accounts. Re-run with the original project name and verify `/app/.ingenium/data`. |
| Mail shows `degraded` or asks to reconnect after restart | Credentials cannot be decrypted or a folder hit the auth circuit breaker | Keep the account; use **Reconnect**. OAuth accounts require provider consent; app-password accounts use the credential update form. |
| Restart reports an encryption-key mismatch | `INGENIUM_EMAIL_ENCRYPTION_KEY_FILE` differs from the key that encrypted stored credentials | Restore the original protected file from the operator secret store. Do not rotate blindly or overwrite credentials; the fingerprint is diagnostic only. |

Never expose ports `4096`, `4098`, `4099`, or `4100` to make a failing deployment appear
healthy. Never include token bytes in logs, diagnostics, screenshots, or bug
reports.

---

## Dockerfile Notes

- **Native-module libc parity**: The builder and runtime stages both use the glibc-based `node:22-slim` image. Native addons such as `better-sqlite3` are built or selected in the builder and loaded once in the runtime image during the build; do not switch only one stage to Alpine/musl.
- **Nginx runtime paths and validation**: Nginx runs unprivileged as `ingenium-gateway`. The image creates the owner-only `/run/ingenium-gateway` PID, lock, and temporary paths, verifies those directories as that identity, and runs `nginx -t` as `ingenium-gateway`. Access logging is disabled; warning-level errors use the owner-only Supervisor-readable runtime log.
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
# Build and start the compatibility profile
export IMAGE_REVISION="$(git rev-parse HEAD)"
docker compose --profile compatibility up --build

# Start in background
docker compose --profile compatibility up -d

# Tail logs
docker compose --profile compatibility logs -f

# Restart a specific service
docker compose --profile compatibility restart ingenium

# Rebuild after source/config/image changes
docker compose --profile compatibility up --build -d

# Recreate after changing environment secrets
docker compose --profile compatibility up -d

# Execute tests inside container
docker compose --profile compatibility exec ingenium npm test
docker compose --profile compatibility exec ingenium npm run typecheck

# Shell access
docker compose --profile compatibility exec ingenium /bin/bash
```
