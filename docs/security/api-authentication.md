---
title: API Authentication and Local Boundaries
description: Phase 2G API bearer authentication, dashboard proxying, OAuth callback scope, and gateway controls.
---

# API Authentication and Local Boundaries

Phase 2G requires bearer authentication for Ingenium API management traffic. Do
not place a real token in tracked source, `opencode.json`, documentation, or
logs.

## Required API token

`INGENIUM_API_TOKEN` or `INGENIUM_API_TOKEN_FILE` is mandatory for normal
operation. Docker startup rejects a missing, malformed, symlinked, or
non-regular bootstrap file before supervised services start. The canonical
credential is an opaque base64url token of **32–128 ASCII characters** matching
`[A-Za-z0-9_-]`; this validation is repeated by the API, boundary proxy, and
dashboard loader before they serve requests.

```dotenv
INGENIUM_API_TOKEN=<generated-base64url-token>
```

The placeholder above is not a usable credential. Never replace it in a
tracked file with a real value.

The API expects `Authorization: Bearer <token>`. Missing or malformed headers
return `401`; a supplied but incorrect token returns `403`. If the API process
has no configured token, management requests fail closed with `503` rather than
falling back to unauthenticated development behavior.

## Local token-file lifecycle and permissions

For host development, run `scripts/bootstrap-local-secrets.sh`. It creates or
updates the ignored `.env` and creates `.opencode/.ingenium-api-token` when it
is missing. It uses `umask 077`, writes both files as mode `0600`, rejects
symlinks and non-regular files, and refuses to overwrite a token file that does
not match `.env`. It never prints the secret. Treat a mismatch or unsafe path as
a deployment error; do not work around it by weakening permissions.

The token file must be a regular file, owner-readable, inaccessible to group and
other users, and owned by the running user. The MCP loaders also require the
file to be below the real worktree `.opencode` directory, reject symlinks,
control characters, whitespace, oversized values, and arbitrary file paths.

## OpenCode MCP token file

The OpenCode extension may use a protected, worktree-local fallback file when
`INGENIUM_API_TOKEN` is absent from the MCP process environment:

```text
.opencode/.ingenium-api-token
```

The file is ignored by Git and must be a regular, owner-readable-only file
(mode `0600`), owned by the current user, below the current worktree's real
`.opencode` directory. Symlinks, unsafe permissions, invalid characters, and
oversized values are ignored. A valid `INGENIUM_API_TOKEN` environment value is
authoritative; otherwise the extension uses the protected fallback (or the
explicit protected `INGENIUM_API_TOKEN_FILE` reference). The extension never
exposes the token to callers or logs.

### Host and container seeding

- **Host:** `scripts/bootstrap-local-secrets.sh` seeds the local ignored file
  from `INGENIUM_API_TOKEN` in `.env`, preserving an existing matching file.
- **Container:** the entrypoint accepts either bootstrap source, validates it,
  copies it atomically to `/run/ingenium-secrets/api-token`, sets the runtime
  directory to `0700` and the token file to `0600` owned by `appuser`, then
  unsets the inline token before supervisord starts. It also atomically seeds
  `/workspace/.opencode/.ingenium-api-token` with the same value and verifies
  mode, ownership, and byte equivalence. A symlink or non-file at either
  protected path stops startup.

The container's first-start OpenCode config contains only the relative token
file reference; it does not contain the token bytes. The runtime API, boundary,
and dashboard processes read the protected runtime file instead of inheriting
the bootstrap secret.

On every container start, the entrypoint projects the container-owned Ingenium
MCP and plugin entries into the persistent global OpenCode config. This replaces
the legacy `skill-sync` bootstrap entry with `resource-sync` and configures the
`auto-observer`, `observer`, and `resource-sync` sources to resolve the same
protected worktree token file. The projection removes an accidental inline
`INGENIUM_API_TOKEN` value from the Ingenium MCP environment, preserves unrelated
operator settings, and never logs credential contents.

Do not add the token to a tracked `opencode.json` or `opencode.jsonc`. Those
files should contain the MCP command, API URL, and non-secret settings only.

### Extension project initialization preflight

`ingenium-init-project` and extension project provisioning perform an
authenticated `GET /api/v1/auth/preflight` before a project is created or a
repository projection begins. Extension startup permits at most three probes,
each capped at one second and separated by a 250 ms delay; only an unavailable
API is retried. `401` and `403` are safely classified as authentication
failures and fail closed immediately. Diagnostics contain only a stable safe
category (`authentication`, `unavailable`, `invalid_target`, or `rejected`) and
never print a token source, API URL, status, response body, or bearer value. If a later
session lifecycle event succeeds after a transient startup failure, the
resource-sync plugin emits the `extension_project_init_recovered` event.

In the container, OpenCode also performs a fixed ten-attempt authenticated API
readiness check before it starts loading extension plugins. Each attempt is
bounded by the API probe timeout; a failed bounded startup is left to
Supervisor's normal restart policy rather than an unbounded background loop.
The stable container command sets the explicit `/workspace` and
`global-default` values only for the container-owned session. External sessions
retain the normal precedence of explicit `--project`, `INGENIUM_PROJECT`, then
a validated worktree basename.

## Dashboard proxy and CSRF behavior

Browser requests use the same-origin `/api/v1` dashboard proxy. The browser
does not receive or supply the API bearer token. The Next.js server reads the
token at request time, removes caller-supplied `Authorization`,
`Proxy-Authorization`, and dashboard-marker headers, then injects the
server-side `Bearer` header and its marker while forwarding to the internal
API. If the dashboard server is missing the token, the proxy returns `503` and
does not forward the request.

For `POST`, `PUT`, `PATCH`, and `DELETE`, the proxy requires an `Origin` exactly
matching an entry in `DASHBOARD_ALLOWED_ORIGINS` (no credentials, path, query,
or fragment) plus `X-Ingenium-UI: dashboard`; failures return `403` before the
rewrite. Since standalone Next sees its private `:3001` listener, deployed
gateway traffic derives the external origin only from Nginx-overwritten scalar
`X-Forwarded-Proto`, `X-Forwarded-Host`, and `X-Forwarded-Port` fields. Direct
loopback development and isolated fixtures may instead use the exact browser
Origin only when all three forwarding fields are absent. Any partial,
multi-valued, malformed, credential-bearing, or untrusted forwarding metadata
is rejected rather than falling back. Next.js listener-local forwarding defaults
that exactly mirror the direct Host and port are treated as absent metadata;
they are not a proxy chain. The API uses the same exact allowlist for
CORS and its browser CSRF check. Bearer-authenticated MCP/server-to-server
requests without browser headers are not subject to this browser-only CSRF
check. The bearer is never returned in a browser response.

### Trusted loopback origin contract

The default browser mutation origins are explicitly limited to
`http://localhost:3000` and `http://127.0.0.1:3000`. They are exact origins, not
prefixes: a trailing slash, alternate port, IPv6 literal, path, query, fragment,
credentials, wildcard, or comma-separated forwarded value is not accepted.
Direct IPv6 loopback dashboard navigation is canonicalized by Nginx to
`http://localhost:3000` before the request reaches the dashboard.

Nginx overwrites the three forwarding fields at the gateway boundary. The
dashboard proxy reconstructs one external origin from those fields and compares
it byte-for-byte with the browser `Origin` and the server-only allowlist. It does
not use Next's private listener origin (`:3001`), caller-supplied forwarding
headers, or the dashboard marker alone as proof of same origin. The proxy then
removes browser authorization and marker headers and installs the server token
and canonical marker for the internal rewrite.

## Direct loopback API behavior

The published `127.0.0.1:4097` endpoint is the loopback API boundary, not a
raw unauthenticated Express listener. The boundary validates the caller's
Bearer token (`401` for missing/malformed, `403` for wrong), strips and
replaces it, and forwards to Express on private container port `4096`.
Express also enforces the bearer credential. Loopback alone is never a bypass;
do not publish `4096` or use OpenCode ports `4098`/`4099` as an API workaround.

`/api/v1/health` is a management endpoint and therefore requires the bearer
token. Docker health checks read the protected runtime file in a clean
environment and probe the authenticated `4097` boundary; they do not put the
token in curl arguments, URLs, logs, or browser responses. If token
configuration is unavailable, the API returns `503 API_AUTH_NOT_CONFIGURED`
rather than becoming unauthenticated.

The extraction engine reaches `GET /api/v1/opencode/messages` through an
API-owned internal client. That client loads the same protected runtime token
only while creating the loopback request, sends it only as the bearer header,
and returns stable failure categories rather than headers, endpoint details, or
response bodies. The route remains protected; loopback callers do not receive
an authentication bypass.

## OAuth callback on port 1455

The host `127.0.0.1:1455` reaches the Nginx callback listener, which forwards
to private Express `4096`. The callback listener is deliberately narrower than
the API, and the auth middleware contains the sole exact unauthenticated
allowlist:

- only `GET /auth/callback` is forwarded;
- other paths return `404`, and non-GET requests return `405`;
- caller-supplied authorization, proxy identity, forwarding, upgrade, and body
  headers are stripped;
- OAuth `state` validation and callback rate limiting remain in the API.

This exact callback is the only unauthenticated API exception because the
provider redirect cannot attach the local bearer token. Port `1455` is
loopback-only in the default Compose deployment and is not a general API
tunnel.

## Local gateway access

The dashboard root and the dedicated OpenCode Web and CLI roots on port `3000`
are intentionally credential-free for the normal local Windows↔WSL profile:
they do not show an HTTP Basic Auth password prompt or accept a browser bearer
token. This does not make the API public: the loopback API boundary on
`127.0.0.1:4097` remains private and bearer-protected, while the dashboard's
same-origin proxy injects that bearer server-side. Do not publish `4098` or
`4099` directly, and do not treat this plain-HTTP local gateway as a LAN or
remote deployment profile; use operator-managed authenticated TLS origins for
remote access.

## Rotation and restart procedure

1. Generate a replacement API token without printing it or committing it.
2. Update the deployment secret or ignored `.env` value, then update the host
   fallback file through `scripts/bootstrap-local-secrets.sh` if it is used.
3. Recreate/restart the container so the boundary proxy, API, and dashboard
   server load the replacement token.
4. If OpenCode uses the fallback file, replace `.opencode/.ingenium-api-token`
   atomically, restore mode `0600`, and restart OpenCode so its MCP process
   reloads the credential.
5. Verify an authenticated API request and the dashboard/MCP path, then revoke
   the old token. Do not record either token in verification output.

Runtime secret changes do not require an image rebuild, but they do require a
service restart/recreation. Source, proxy, or build-time browser-origin
changes require `docker compose up --build -d`.

## No-secret-disclosure rule

Never paste token values into tracked config, shell history, issue reports,
screenshots, health output, or logs. Troubleshooting output should contain only
status codes and redacted paths/metadata such as `0600:appuser:appuser`; never
print file contents or an `Authorization` header. If a secret is exposed,
rotate it and restart every consumer before continuing.

## Public-JWT incident release hold

The historical public-JWT exposure remains a release blocker. Phase 2G is not
release-cleared until the exposed credential and related signing/session
credentials are revoked, replacements are installed, repository history is
purged and rescanned, and all affected deployments are restarted and verified.
Do not mark a release ready based only on a clean current-file scan; reachable
history and unfiltered clones must also be remediated. See
[Credential Incident Runbook](credential-rotation.md).
