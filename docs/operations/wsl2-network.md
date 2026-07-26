# WSL2 and Windows Transport

The default deployment supports Windows access to the Docker gateway through
WSL's normal localhost forwarding. **Port `3000` is the only gateway-reachable
host port** for the dashboard and the local OpenCode roots:

- Dashboard: `http://localhost:3000/`, published by Compose as `3000:3000` with no HTTP Basic Auth.
- OpenCode Web: local root `http://opencode.localhost:3000/` with no HTTP Basic Auth.
- OpenCode CLI: local root `http://cli.localhost:3000/` with no HTTP Basic Auth.
- API boundary: `127.0.0.1:4097`, a bearer-authenticated host-loopback endpoint
  for MCP clients only. It is not the browser gateway; browser traffic must use
  port `3000` and the same-origin dashboard proxy.
- OpenCode and ttyd listeners on `4098` and `4099`: private container upstreams;
  never publish, forward, or open them in Windows Firewall.

All three browser-facing roots are intentionally credential-free for the normal
local Windows↔WSL path. The dashboard same-origin proxy injects the API token
server-side; it never exposes or sends a browser bearer token. This plain-HTTP
gateway is not a LAN or remote security profile.

## Gateway rate limits and loopback canonicalization

The Nginx gateway separates dashboard and OpenCode rate-limit buckets. Both
dynamic surfaces allow `30r/s` with a burst of `60`; assets and WebSocket
upgrade handshakes do not consume the dynamic OpenCode bucket. A shared
connection limit of 16 still applies to each gateway client address.

Use `http://localhost:3000/` or `http://127.0.0.1:3000/` for the dashboard.
If a browser reaches the gateway directly as IPv6 loopback (`::1` or
`[::1]`), Nginx canonicalizes it with a `308` redirect to the `localhost`
origin. This is intentional: the iframe CSP allowlist uses the valid
`localhost`/`127.0.0.1` forms, while the OpenCode iframes use the separate
`http://opencode.localhost:3000/` and `http://cli.localhost:3000/` roots.

The gateway is the only browser path to OpenCode. Its upstream listeners are
container-private, and the proxy strips browser authorization, identity, and
forwarding headers before forwarding. The CLI identity is injected only by the
gateway. Never add a Windows port-proxy or firewall rule for 4098/4099.

## Windows loopback verification

The repository helper is deliberately a verifier, not a transport installer:

```powershell
pwsh -File .\scripts\windows-loopback-transport.ps1
```

It verifies IPv4 and IPv6 loopback, a forwarded-host fallback, the exact
same-origin dashboard API path, and both OpenCode gateway roots. Every browser
gateway probe must receive `200` without a `WWW-Authenticate` challenge; the
verifier also confirms that the bearer-less API boundary returns `401`. If the
Windows↔WSL transport deliberately leaves Linux loopback port `4097`
check the same loopback boundary inside its owning network namespace. It does
not create a listener, Windows port-proxy rule, firewall exception, or any
other host-network mutation.

## Secure Windows, LAN, and remote access

The unqualified Docker publication is required for WSL localhost forwarding.
Plaintext HTTP is not an appropriate LAN or remote security boundary. If access
must leave the local machine, provide a separate operator-managed TLS-authenticated profile
(reverse proxy, VPN, or equivalent) that terminates TLS and protects the
dashboard and both OpenCode root origins. Do not replace this with a raw `netsh
interface portproxy` rule or a firewall exception for 4098/4099.

Before building that profile, set **both** public origin variables:

```powershell
$env:NEXT_PUBLIC_OPENCODE_WEB_URL = "https://opencode.example.com/"
$env:NEXT_PUBLIC_OPENCODE_CLI_URL = "https://cli.example.com/"
docker compose up --build -d
```

The origins must be dedicated root HTTPS origins: no path, query, fragment,
embedded credentials, or dashboard subpath. The TLS profile must authenticate
the request before forwarding to the private services. Plain LAN HTTP and direct
4098/4099 exposure are unsupported.

## Build, restart, and rollback

`NEXT_PUBLIC_*` values are embedded into the Next.js bundle at image build time.
Changing them in `.env` or the running container without rebuilding does not
change iframe targets. After changing public origins, gateway configuration, or
the image, rebuild and restart, then verify the dashboard and both local root
origins from the real browser path:

```bash
docker compose up --build -d
```

If the new profile cannot be verified, roll back the image and build-time
configuration to the last known-good deployment. Do not work around a failed
transport by exposing the private upstream ports.

## No subpath proxy

OpenCode is served only from a root origin. `/opencode-web/` and
`/opencode-cli/` subpath proxies are not supported because root-relative assets
and WebSockets do not remain functional through that rewrite.
