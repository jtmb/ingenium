---
title: Cloudflare Tunnel
description: Configure an existing named Cloudflare tunnel and its operator-managed authenticated HTTPS audience routes.
---

# Configure: Cloudflare Tunnel

> **Source status:** The configuration and lifecycle boundary exists in the
> current source, but this guide does not claim that a live tunnel, route
> inventory, connector, or HTTPS gateway is configured or healthy.

## Scope and prerequisites

Ingenium connects one **existing named** Cloudflare tunnel. Before using the
Cloudflare Settings tab, an operator must provide:

1. An existing named tunnel and a token that can run that tunnel.
2. DNS and Cloudflare ingress routes for the five supported audiences.
3. A trusted ingress inventory file mounted at
   `/etc/ingenium/cloudflare-routes.json`.
4. An initialized, unsealed Ingenium vault and a browser installation
   administrator for the write operations.
5. The fixed `cloudflare-tunnel` Supervisor program in the deployed image.

The tunnel token is **not** a DNS-management grant in this integration. The
connector runs `cloudflared tunnel ... run --token-file`; it does not create a
tunnel or call Cloudflare DNS APIs. Configure and change DNS/routes outside
Ingenium, then update the inventory file.

## Trusted ingress inventory

Compose selects the host file with `INGENIUM_CLOUDFLARE_ROUTES_FILE` and mounts
it read-only at the fixed container path. The loader requires a regular,
non-followed file no larger than 64 KiB that is not group- or
other-writable. Missing, unreadable, or invalid inventory blocks configuration
and connection.

The JSON object must contain only `tunnelName` and `routes`. `routes` must
contain exactly `dashboard`, `opencode`, `cli`, `vscode`, and `api`; each value
is an array of at most 16 entries. Each entry contains only `publicUrl` and
`target`. The following uses documentation-only hostnames:

```json
{
  "tunnelName": "existing-tunnel-name",
  "routes": {
    "dashboard": [{ "publicUrl": "https://dashboard.example.com/", "target": "authenticated-production-dashboard-gateway" }],
    "opencode": [{ "publicUrl": "https://opencode.example.com/", "target": "authenticated-production-opencode-audience-gateway" }],
    "cli": [{ "publicUrl": "https://cli.example.com/", "target": "authenticated-production-cli-audience-gateway" }],
    "vscode": [{ "publicUrl": "https://vscode.example.com/", "target": "authenticated-production-vscode-audience-gateway" }],
    "api": [{ "publicUrl": "https://api.example.com/", "target": "authenticated-https-api-boundary" }]
  }
}
```

The example is schema-shaped only; those reserved documentation hostnames are
not valid deployable public origins. A deployable `publicUrl` must be an exact
public HTTPS origin with no credentials, port, path, query, fragment, IP
address, or reserved/private hostname. An origin may belong to only one
audience, and a Settings selection must come from that audience's inventory
list. Local compatibility aliases and unauthenticated upstreams are rejected.

## Settings lifecycle

Open `/?settings=cloudflare` and use the **Cloudflare** tab. The panel exposes
the existing tunnel name, independent enable/URL selections for Dashboard,
OpenCode, CLI, VS Code, and API, connector status, inventory status, and
write-only token state. The tunnel name is displayed from the trusted
inventory and is not an arbitrary tunnel-creation field.

- **Save** preserves the stored token unless a replacement or clear operation
  is explicitly submitted.
- **Validate** re-reads the inventory and saved configuration.
- **Connect** requires valid enabled configuration, ready inventory, an unsealed
  vault token, and the fixed connector runtime.
- **Disconnect** stops the fixed Supervisor connector and removes any pending
  handoff.

The token is stored only through protected vault storage. On connect, the API
briefly writes an API-owned mode-`0600` handoff at
`/run/ingenium-secrets/api/cloudflare-tunnel.handoff`; the connector copies it
to its own mode-`0600` file, removes the handoff, and runs `cloudflared` as
`ingenium-cloudflare`. The handoff and connector credential are removed during
cleanup. Token values are not returned to the browser or status response.

The API lifecycle is:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/services/cloudflare` | Read redacted status and route health |
| `PUT` | `/api/v1/services/cloudflare` | Save mappings and preserve/replace/clear the token |
| `POST` | `/api/v1/services/cloudflare/validate` | Validate current state |
| `POST` | `/api/v1/services/cloudflare/connect` | Start the fixed connector |
| `POST` | `/api/v1/services/cloudflare/disconnect` | Stop the fixed connector |

Mutations require a browser installation administrator and recent step-up
authentication. A sealed vault, missing inventory, invalid/disabled
configuration, or missing connector fails closed; connection is not inferred
from a saved hostname or token alone.

## Audience targets

The five service mappings are independent, but each route must use its exact
authenticated production target:

| Service | Required target |
|---|---|
| Dashboard | `authenticated-production-dashboard-gateway` |
| OpenCode | `authenticated-production-opencode-audience-gateway` |
| CLI | `authenticated-production-cli-audience-gateway` |
| VS Code | `authenticated-production-vscode-audience-gateway` |
| API | `authenticated-https-api-boundary` |

Do not expose compatibility HTTP or `auth-none` routes through the tunnel, and
do not publish the private OpenCode, ttyd, or runtime upstream ports as a
workaround.

## External MCP boundary

External OpenCode sessions still run the Ingenium MCP transport as **local
stdio**. The extension sends authenticated requests to the trusted Ingenium
API; it does not add an HTTP MCP listener. For a remote deployment, the
launcher may provide `INGENIUM_TRUSTED_API_URL` only as an HTTPS API origin.
Repository `opencode.json` must retain the local stdio definition and must not
be used to smuggle a remote trust override or plaintext credential.

See [MCP server configuration](mcp-servers.md), [Dashboard Settings](settings.md),
[Environment Variables](../develop/variables.md), and the
[CLOUDFLARE-100 roadmap gate](../reference/ROADMAP.md#cloudflare-100--existing-named-tunnel-and-authenticated-https-audience-gateways).

## Source locations and current gate

- Core validation and vault token lifecycle:
  `packages/ingenium-core/lib/tools/cloudflare-tunnel.ts`
- Trusted inventory loader and connector lifecycle:
  `services/ingenium-api/lib/cloudflare-trusted-ingress.ts` and
  `services/ingenium-api/lib/cloudflare-tunnel-service.ts`
- API routes: `services/ingenium-api/lib/routes/cloudflare.ts`
- Settings panel:
  `services/ingenium-dashboard/src/app/components/settings/panels/CloudflarePanel.tsx`

The current implementation is `IMPLEMENTED_UNVERIFIED` (`SOURCE/STATIC`). Live
Cloudflare credentials, DNS/routes, connector state, HTTPS audience health,
and deployment acceptance remain external prerequisites and are not asserted
here.
