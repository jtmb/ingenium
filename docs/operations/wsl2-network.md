# WSL2 and Windows Transport

The compatibility deployment supports Windows access to the Docker gateway through
WSL's normal localhost forwarding. **Port `3000` is the only gateway-reachable
host port** for the dashboard and the local OpenCode/VS Code roots:

- Dashboard: `http://localhost:3000/`, published by Compose as `3000:3000` with no HTTP Basic Auth.
- OpenCode Web: local root `http://opencode.localhost:3000/` with no HTTP Basic Auth.
- OpenCode CLI: local root `http://cli.localhost:3000/` with no HTTP Basic Auth.
- VS Code: local root `http://vscode.localhost:3000/` with no HTTP Basic Auth.
- API boundary: `127.0.0.1:4097`, a bearer-authenticated host-loopback endpoint
  for MCP clients only. It is not the browser gateway; browser traffic must use
  port `3000` and the same-origin dashboard proxy.
- OpenCode, ttyd, and code-server listeners on `4098`, `4099`, and `4100`: private container upstreams;
  never publish, forward, or open them in Windows Firewall.

All four compatibility browser-facing roots are intentionally credential-free for the normal
local Windows↔WSL path. The dashboard same-origin proxy uses a protected
bootstrap credential only for public bootstrap routes; authenticated requests use
the browser session and never expose or send the installation bearer. This plain-HTTP
gateway is not a LAN or remote security profile.

## Gateway rate limits and loopback canonicalization

The Nginx gateway separates dashboard, OpenCode, and VS Code rate-limit buckets. Each
dynamic surface allows `30r/s` with a burst of `60`; assets and WebSocket
upgrade handshakes do not consume the dynamic OpenCode bucket. A shared
connection limit of 16 still applies to each gateway client address.

Use `http://localhost:3000/` or `http://127.0.0.1:3000/` for the dashboard.
If a browser reaches the gateway directly as IPv6 loopback (`::1` or
`[::1]`), Nginx canonicalizes it with a `308` redirect to the `localhost`
origin. This is intentional: the iframe CSP allowlist uses the valid
`localhost`/`127.0.0.1` forms, while the OpenCode and VS Code iframes use the separate
`http://opencode.localhost:3000/`, `http://cli.localhost:3000/`, and
`http://vscode.localhost:3000/` roots.

The gateway is the only browser path to OpenCode and VS Code. Its upstream listeners are
container-private, and the proxy strips browser authorization, identity, and
forwarding headers before forwarding. The CLI identity is injected only by the
gateway. Never add a Windows port-proxy or firewall rule for 4098/4099/4100.

In production, only the dashboard remains useful on these local names.
`opencode.localhost`, `cli.localhost`, and `vscode.localhost` return the same static
no-store `404` guidance and reject upgrades without proxying. After sign-in, use the
dashboard workspace picker and the runtime gateway's exact TLS audience roots.

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
dashboard, OpenCode, and VS Code root origins. Do not replace this with a raw `netsh
interface portproxy` rule or a firewall exception for 4098/4099/4100.

The production runtime gateway requires an operator-managed wildcard TLS domain and
certificate. Runtime audience roots are issued only after authenticated workspace
selection; they are not fixed browser build settings. Plain LAN HTTP and direct
4098/4099/4100 exposure are unsupported.

## Build, restart, and rollback

`NEXT_PUBLIC_*` values are embedded into the Next.js bundle at image build time.
Changing them in `.env` or the running container without rebuilding does not
change iframe targets. After changing public origins, gateway configuration, or
the image, rebuild and restart, then verify the dashboard and both local root
origins from the real browser path:

```bash
export IMAGE_REVISION="$(git rev-parse HEAD)"
docker compose --profile compatibility up --build -d
```

If the new profile cannot be verified, roll back the image and build-time
configuration to the last known-good deployment. Do not work around a failed
transport by exposing the private upstream ports.

## No subpath proxy

OpenCode is served only from a root origin. `/opencode-web/` and
`/opencode-cli/` subpath proxies are not supported because root-relative assets
and WebSockets do not remain functional through that rewrite.
