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

Compose receives only the absolute host file path and mounts it read-only at
`/run/ingenium-bootstrap/api-token`; token bytes never enter the rendered
environment. Inline `INGENIUM_API_TOKEN` remains a non-container development
fallback only.

The API expects `Authorization: Bearer <token>`. Missing, malformed, invalid,
expired, or revoked bearer credentials return `401`; authenticated credentials
with insufficient scope return `403`. If the API process
has no configured token, management requests fail closed with `503` rather than
falling back to unauthenticated development behavior.

## Local token-file lifecycle and permissions

Run `scripts/bootstrap-local-secrets.sh`. It creates a regular mode-`0600`
installation-token file under the mode-`0700` host configuration directory and
writes only its path to ignored `.env`. `--rotate` atomically replaces the file;
neither operation projects the broad bearer into `.opencode` or prints it.

The Compose bootstrap token must be a regular non-symlink file owned by the
mapped application UID/GID with exact mode `0600`. Entrypoint opens it with
no-follow semantics and validates, reads, and copies the same descriptor; any
metadata or read uncertainty fails startup without logging content. The MCP loaders also require the
file to be below the real worktree `.opencode` directory, reject symlinks,
control characters, whitespace, oversized values, and arbitrary file paths.

## Scoped OpenCode MCP credential

External OpenCode and extension processes use a scoped credential, not the
installation bearer:

```text
.opencode/.ingenium-mcp-credential
.opencode/.ingenium-repository-sync-credential
```

The file is ignored by Git and must be a regular, owner-readable-only file
(mode `0600`), owned by the current user, below the current worktree's real
`.opencode` directory. Symlinks, unsafe permissions, invalid characters, and
oversized values are ignored. Use `INGENIUM_MCP_CREDENTIAL_FILE`, with explicit
project/workspace/worktree and audience bindings. The broad installation bearer is
accepted only from explicit internal services and is never a user-runtime fallback.

Scoped values are random 256-bit secrets stored only as SHA-256 hashes. Metadata
includes audience, scopes, organization, immutable project grants, workspace,
launcher worktree, expiry, service-principal security epoch, last-used time, and
rotation/revocation state. Human issue, rotate, and revoke operations require recent
step-up; plaintext appears only in the create/rotate response. Restart OpenCode after
replacing either protected credential file. The project must already exist so
its immutable UUID can be included in the credential grant.

### Isolated runtime capability

The control plane issues a separate `runtime` audience credential for an authorized
runtime and transfers it as `/run/ingenium-runtime/capability` only through the private
runtime manager. The owner-only file is on a dedicated tmpfs and is never placed in a
container environment variable or image layer. Resolution additionally requires an
active capability binding, authorized workspace, matching owner/org/project/workspace
and security epochs, an unexpired credential, and a runtime in `PROVISIONING`,
`STARTING`, `READY`, or `IDLE`. Provisioning failure, stop/revoke cleanup, wrong
audience, expiry, or epoch mismatch fails on the next API call.

The runtime-manager bearer is a different owner-only file shared only by the control
plane and manager. It authorizes the manager's narrow health/provision/inspect/stop
API and is not a user-runtime capability.

Migration 102 completes browser launch with browser-generated exchange proofs and
random session values stored only as hashes. A launch record binds the exact dashboard auth session, owner, workspace,
runtime, organization, project, audience, HTTPS origin, Host, nonce, generation, and
expiry. It expires within 60 seconds and is consumed atomically once. The API returns
only the audience launch URL and opaque status; the proof travels only in request
bodies and no session token or private backend identity reaches dashboard code.

The gateway exchanges it for a host-only `__Host-ingenium_runtime_<audience>` cookie
with `Secure`, `HttpOnly`, and `SameSite=None`, which is required because the dashboard
and isolated runtime roots are intentionally cross-site. Every request and WebSocket handshake
revalidates the generation and originating auth session. Logout, session/runtime/
workspace revoke, expiry, and generation changes fail closed. The gateway's narrow
owner-only bearer is distinct from installation, manager, and runtime credentials.
Only the API boundary accepts its `runtime-gateway` audience and overwrites the
private-network marker after credential validation. Browser sessions, API user tokens,
installation compatibility principals, and the Dashboard proxy receive `404` on the
gateway-private exchange and validation routes.
Boundary-attested gateway exchange, validation, and activity calls use a separate
fixed 10,000-request/minute loopback bucket so runtime assets do not consume the
human-facing API limit. Non-loopback requests cannot select that bucket.

### Host and container seeding

- **Host:** `scripts/bootstrap-local-secrets.sh` seeds only the protected
  installation-token file and its non-secret `.env` path. A recently stepped-up installation administrator issues
  scoped MCP and repository-sync credentials through `/api/v1/auth/mcp-credentials`.
- **Container:** Compose mounts the required `INGENIUM_API_TOKEN_FILE` source
  read-only at `/run/ingenium-bootstrap/api-token`. The entrypoint validates it,
  copies it atomically to `/run/ingenium-secrets/api/installation-api-token`, sets
  the consumer directory to `0700` and the token file to `0600` owned by
  `ingenium-api`, then unsets any inline token before supervisord starts. It
  removes only a recognized historical `/workspace/.opencode/.ingenium-api-token`;
  an unsafe or mismatched legacy path stops startup rather than being consumed.

The container's first-start OpenCode config contains only a relative scoped MCP
credential-file path; OpenCode performs no config-time file interpolation and the
config contains no token bytes. Only the private API receives the installation
bearer. The boundary forwards opaque authorization and strips caller-supplied
trusted headers; Dashboard receives a distinct bootstrap-only credential.

Supervisor runs as root only to assign identities. API, boundary, Dashboard,
Nginx, OpenCode, ttyd, VS Code, and restore maintenance run as distinct non-login
users. Each launcher clears Supervisor's inherited environment. Supervisor uses
`/run/ingenium-supervisor/supervisor.sock`; the API status routes use fixed status,
detail, and bounded-log XML-RPC methods. Restore execution remains limited to the
fixed program exposed through `/run/ingenium-restore-handoff/request.sock`.

### Background synthesis runtime boundary

Per-project background extraction and synthesis may execute only through one
ready or idle runtime whose capability, service principal, security epoch, and
project-level execute grant are all active. The API returns an unavailable result
when that authorized runtime cannot be resolved; it does not probe providers or
fall back to a global OpenCode target or another user's runtime.

On every container start, the entrypoint projects the container-owned Ingenium
MCP and plugin entries into the persistent global OpenCode config. This replaces
the legacy `skill-sync` bootstrap entry with the canonical `resource-sync`
projection and configures the `auto-observer`, `observer`, `resource-sync`,
`session-coordinator`, and Ponytail adapter entries without projecting the
installation bearer. The projection removes accidental `INGENIUM_API_TOKEN` and
`INGENIUM_API_TOKEN_FILE` entries from the Ingenium MCP environment, preserves unrelated
operator settings, and never logs credential contents.

Do not add the token to a tracked `opencode.json` or `opencode.jsonc`. Those
files should contain the MCP command, API URL, and non-secret settings only.

## OIDC outbound provider boundary

OIDC discovery, token exchange, and JWKS retrieval use the pinned endpoint
transport in `endpoint-policy.ts`; they never use the platform's unbounded
`fetch` path. Production URLs require HTTPS, DNS hostnames, and port 443.
Credentials, fragments,
trailing-dot hosts, localhost, IP literals, and any DNS answer in a non-global
range are rejected. Each request resolves all A/AAAA answers once, rejects a
mixed public/private answer set, pins one accepted address, and preserves the
logical Host header and TLS SNI. Proxy environment variables are not consulted,
and redirects and encoded responses are rejected.

Discovery and token JSON responses are limited to 64 KiB, JWKS to 256 KiB, and
the form-encoded token request to 16 KiB. Requests have a five-second total
timeout; the complete callback has a 15-second budget. Responses must have a
JSON-compatible media type and contain a JSON object. JOSE uses only this custom
transport, with a 100-entry provider/issuer/JWKS/algorithm cache, ten-minute
freshness, 30-second cooldown, and five-second timeout. A changed exact issuer,
JWKS URI, or algorithm evicts that provider's prior module.

Tests may pass an internal exact `http://127.0.0.1:<ephemeral-port>` policy
argument directly to the OIDC core functions. It is not selected by `NODE_ENV`,
persisted provider data, an environment variable, or API input. Public OIDC
failures are fixed `401`, `502`, or `504` envelopes without URLs, addresses,
claims, or upstream bodies. Start and callback attempts are independently
limited by IP/provider, and valid callback transactions append a content-free
immutable success or failure audit event.

The authentication encryption key is separate from API, email, vault, and
restore keys. Container startup atomically provisions
`/app/.ingenium/auth-encryption-key` as a persistent root-owned mode-`0600`
base64url 256-bit key. The entrypoint creates an `ingenium-api`-owned ephemeral
copy; `run-api.sh` clears the inherited environment and passes only that path.
API startup validates the file before binding.

### Extension project initialization preflight

This authenticated boundary protects the Git-authoritative repository path:
Git worktree → `@ingenium/extension` resource-sync → configured MCP stdio →
authenticated API → database. Plugins, CLIs, and agents never read/write the
database or call mutation REST endpoints directly. `ingenium-core` is internal
to the API. Administrative skill sync tools are repair/import only. Rebuild the
extension and restart OpenCode when plugin or config sources change.

If only the external coordination credential is invalid, run the package-owned
`ingenium-coordination-reset reset` command. The bootstrap-owner secret must be
provided through exactly one protected mode-`0600` file or already-open regular
file descriptor. If neither override exists, reset uses only the fixed ignored
`.opencode/.ingenium-coordination-owner-provider.json` reference. That file
contains paths and provider metadata, never plaintext or ciphertext. The
referenced AES-256-GCM bundle lives outside the worktree under a separate
owner-only directory and is authenticated to the exact bootstrap account,
project, and workspace. Its protected key follows the existing email-key file
format but cannot share the ciphertext directory. Wrong keys, altered metadata
or ciphertext, symlinks, unsafe ownership/modes, and mismatched bindings fail
closed.

`ingenium-coordination-reset store --key-file <absolute-path>
--bundle-directory <absolute-path>` creates or rotates this provider while the
protected plaintext override is present. It atomically validates the new bundle
before replacing the ignored reference and removes the superseded ciphertext;
interruption retains the prior usable reference. Neither operation accepts a
secret through argv or logs secret-derived values. Reset accepts no endpoint,
project, workspace, worktree, or scope argument. It reuses the normal login,
recent-step-up, project authorization, and scoped MCP issuance routes, validates
the exact configured coordination binding, and atomically replaces the
owner-only credential file.
When the session-coordinator plugin is already loaded, its exact reset-command
exception reconnects the MCP client and registers a fresh accepted epoch in the
same OpenCode process. Lookalike commands and unrelated mutations remain denied.
`ingenium-coordination-reset reset-learning` independently restores the exact
seven-scope learning credential through the same encrypted provider and fixed
binding. It does not replace the general MCP credential or receive the
same-process coordination exception.

`ingenium-init-project` and extension project provisioning perform an
authenticated `GET /api/v1/auth/preflight` before a project is created or a
repository projection begins. Extension startup permits at most three probes,
each capped at one second and separated by a 250 ms delay; only an unavailable
API is retried. Invalid/revoked/expired/wrong-audience credentials return `401`,
insufficient scope returns `403`, and inaccessible bindings return `404`.
Diagnostics contain only a stable safe category (`authentication`, `scope`,
`not_found`, `unavailable`, `invalid_target`, or `rejected`) and
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
raw unauthenticated Express listener. The boundary rejects missing or malformed
bearers with `401` and forwards scoped bearers to Express for validation; invalid,
expired, or revoked bearers also receive `401`, while insufficient scope receives
`403`. Only the matched installation bearer is replaced and marked as an internal
request before forwarding to private container port `4096`. For `ing_` scoped
credentials, the boundary forwards only a recognized audience (`mcp`, `runtime`,
`repository-sync`, or `mcp-report`) so Express can enforce its exact binding.
Express also enforces the bearer credential. Loopback alone is never a bypass;
do not publish `4096` or use OpenCode ports `4098`/`4099` as an API workaround.

`GET /api/v1/health` is the narrow credential-free liveness endpoint and returns
only service-health data. Docker health checks probe it through the `4097`
boundary from a clean environment without receiving the installation bearer.
Other management routes remain bearer-protected; a missing installation token
therefore still returns `503 API_AUTH_NOT_CONFIGURED` instead of enabling an
unauthenticated management path.

The extraction engine reaches `GET /api/v1/opencode/messages` through an
API-owned internal client. That client loads the same protected runtime token
only while creating the loopback request, sends it only as the bearer header,
Authenticated login returns a legacy session CSRF token whose SHA-256 hash
remains on the session for compatibility. A tab that does not have that
plaintext token calls `POST /api/v1/auth/session/csrf` with the session cookie,
exact allowed `Origin`, and dashboard marker. This bootstrap call does not
require a prior CSRF token and does not rotate or replace the session cookie.
It returns a fresh random grant whose hash is bound to the exact session, user,
and user security epoch. Grants expire after at most ten minutes and never past
the session idle or absolute deadline. Each session retains at most eight active
grants; issuance transactionally removes expired or invalid rows and keeps the
newest eight deterministically.

Unsafe cookie-authenticated requests accept either the login token or an active
grant. A grant cannot validate for another session or user, and session revocation,
user disablement, security-epoch changes, grant expiry, and session expiry all fail
closed. Revocation and security changes delete grants through database triggers;
deleting the parent session cascades. CSRF grants prove browser request authenticity
only: organization and project authorization still run independently and remain the
final authority for every resource.

and returns stable failure categories rather than headers, endpoint details, or
response bodies. The route remains protected; loopback callers do not receive
an authentication bypass.

## OAuth callback on port 1455

The host `127.0.0.1:1455` reaches the Nginx callback listener, which forwards
to private Express `4096`. The callback listener is deliberately narrower than
the API, and the auth middleware contains a dedicated exact unauthenticated
allowlist for this callback path:

- only `GET /auth/callback` is forwarded;
- other paths return `404`, and non-GET requests return `405`;
- caller-supplied authorization, proxy identity, forwarding, upgrade, and body
  headers are stripped;
- OAuth `state` validation and callback rate limiting remain in the API.

This exact callback is the only unauthenticated exception on the OAuth callback
listener because the provider redirect cannot attach the local bearer token.
The API also has separate credential-free health and local browser-auth
allowlists. Port `1455` is
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

## Restore-time invalidation

An authorized database restore never revives restored local bearer state. After
read-only validation accepts a complete migration-093-or-later security lineage,
the fixed maintenance process applies only missing guarded migrations through
102 and verifies integrity; ordinary API startup migrations are not used. After
the paired swap and restore-ledger rehydrate, but before journal `rehydrated` or
service restart, one transaction revokes sessions and scoped API/MCP/runtime
credentials, consumes one-time authorization and launch state, releases task and
coordination ownership, advances user/service-principal/runtime/browser
generations, and writes content-free immutable audit evidence. Password hashes,
OIDC identity links, TOTP factors, and recovery codes are preserved. Partial
credential schemas and audit failure fail closed into restore rollback. The
file-backed installation bearer is outside the restored database and follows the
normal rotation procedure below.

Users and automated clients must authenticate again after a successful restore.
External identity/provider revocation is not implied by this local invalidation.

## Rotation and restart procedure

1. Generate a replacement API token without printing it or committing it.
2. Update the deployment secret or ignored `.env` value through
   `scripts/bootstrap-local-secrets.sh` if it is used.
3. Recreate/restart the container so the boundary proxy, API, and dashboard
   server load the replacement token.
4. The scoped credential rotation endpoint creates the replacement and revokes
   the prior credential atomically before returning the replacement plaintext;
   there is no overlap window. Stop the affected client, rotate, immediately
   replace the corresponding owner-only `.opencode` file, and restart it. If an
   overlap is required, create a separate credential, install and verify it, then
   revoke the old credential instead of using the rotation endpoint.
5. Verify an authenticated API request and the dashboard/MCP path. Do not record
   either credential in verification output.

Runtime secret changes do not require an image rebuild, but they do require a
service restart/recreation. Source, proxy, or build-time browser-origin
changes require `docker compose --profile compatibility up --build -d`.

OpenCode proxy and email encryption secrets use separate protected files created
by `scripts/bootstrap-local-secrets.sh`. Rotate them with
`--rotate-opencode-password` and `--rotate-email-encryption-key`; Compose mounts
each file read-only and never stores either value in container configuration.
Email-key rotation additionally requires the one-shot empty transition gate.
That gate updates continuity metadata and writes a metadata-only resource audit
only when every mail account, credential, token, OAuth attempt, legacy setting,
cache, queue, watcher, and mail-account grant surface is transactionally empty.
Any row, schema uncertainty, or concurrent insertion refuses startup without
changing continuity metadata.

## No-secret-disclosure rule

Never paste token values into tracked config, shell history, issue reports,
screenshots, health output, or logs. Troubleshooting output should contain only
status codes and redacted paths/metadata such as `0600:ingenium-api:ingenium-api`; never
print file contents or an `Authorization` header. If a secret is exposed,
rotate it and restart every consumer before continuing.

## Historical public-JWT incident status

The historical public-JWT exposure was remediated for the current release
boundary: repository history was rewritten and rescanned, the deployed bearer
credential was rotated, and the prior bearer was rejected with HTTP `401`.
There is no remaining release hold for this API-bearer acceptance. Do not infer
that separately tracked external-provider, cache, or collaborator/CI clone
actions are complete; see the [Credential Incident Runbook](credential-rotation.md)
for those follow-ups.
