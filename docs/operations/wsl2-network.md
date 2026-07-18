# WSL2 Network Access

When running `opencode web --hostname 0.0.0.0` inside WSL2, the server binds to the
WSL2 VM's interfaces (`127.0.0.1` + internal `172.x.x.x`) — **not** the Windows
host's LAN IP. WSL2 uses NAT, so other devices on your local network cannot reach it
directly.

## Solution: Windows Port Proxy

### 1. Find WSL2's Internal IP

```powershell
wsl -- ip addr show eth0 | findstr inet
# → inet 172.25.205.181/20 brd ...
```

### 2. Add Port Forward (Windows PowerShell as Admin)

```powershell
netsh interface portproxy add v4tov4 `
    listenaddress=0.0.0.0 listenport=4096 `
    connectaddress=172.25.205.181 connectport=4096
```

### 3. Open Windows Firewall

```powershell
New-NetFirewallRule -DisplayName "OpenCode Web" `
    -Direction Inbound -Protocol TCP -LocalPort 4096 -Action Allow
```

### Verify

```powershell
netsh interface portproxy show all
```

Access from LAN at `http://<windows-host-ip>:4096`.

### Teardown

```powershell
netsh interface portproxy delete v4tov4 listenaddress=0.0.0.0 listenport=4096
```

### Batch Forwarding Port Ranges

To forward multiple ports (e.g., Dashboard 3000-3009 and API/services 4090-4099):

```powershell
for ($i=3000; $i -le 3009; $i++) { netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=$i connectaddress=172.25.205.181 connectport=$i }
for ($i=4090; $i -le 4099; $i++) { netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=$i connectaddress=172.25.205.181 connectport=$i }
```

Firewall rule for the same ranges:

```powershell
New-NetFirewallRule -DisplayName "Ingenium Dev Ports" -Direction Inbound -Protocol TCP -LocalPort 3000-3009,4090-4099 -Action Allow
```

### Batch Teardown

```powershell
for ($i=3000; $i -le 3009; $i++) { netsh interface portproxy delete v4tov4 listenaddress=0.0.0.0 listenport=$i }
for ($i=4090; $i -le 4099; $i++) { netsh interface portproxy delete v4tov4 listenaddress=0.0.0.0 listenport=$i }
```

> **Caveat:** WSL2's IP changes on reboot. Re-run the `add` commands with the new IP if it changes.

## Alternative: Mirrored Networking Mode

Edit `%USERPROFILE%\.wslconfig`:

```
[wsl2]
networkingMode=mirrored
```

Then `wsl --shutdown` and restart WSL. WSL2 shares the Windows host IP directly,
so `opencode web --hostname 0.0.0.0` shows the "Network access" line automatically.

## Dashboard LAN / Proxy — OpenCode Web/CLI URL Derivation

The embedded OpenCode Web and CLI iframes derive their backend URL from the
dashboard's own URL at render time (`services/ingenium-dashboard/src/lib/runtime-urls.ts`).
The logic uses `window.location` to decide between a direct port or a same-origin
proxy path:

| Dashboard URL | OpenCode Web iframe src | Mechanism |
|---|---|---|
| `http://localhost:3000/` (loopback) | `http://localhost:4098/` | Direct port — port 4098 substituted in-place |
| `http://127.0.0.1:3000/` (loopback) | `http://127.0.0.1:4098/` | Direct port |
| `http://192.168.1.50:3000/` (LAN HTTP) | `http://192.168.1.50:3000/opencode-web/` | Same-origin proxy via Next.js rewrite |
| `http://ingenium.internal:3000/` (LAN HTTP) | `http://ingenium.internal:3000/opencode-web/` | Same-origin proxy |
| `https://dashboard.example.com/` (HTTPS) | `https://dashboard.example.com/opencode-web/` | Same-origin proxy (avoids mixed content) |

The CLI (ttyd) iframe follows the identical pattern with port 4099 / `/opencode-cli/`.

### How it works

1. **`runtime-urls.ts`** (`services/ingenium-dashboard/src/lib/runtime-urls.ts`):
   - Calls `openCodeUrl(port, proxyPath, configuredOverride)` using the browser's `window.location`
   - If protocol is `https:` or hostname is NOT loopback (`localhost`, `127.0.0.1`, `[::1]`), returns a same-origin proxy URL built by appending the proxy path to `window.location.origin`
   - Otherwise (loopback HTTP), substitutes the port in-place — e.g. `http://localhost:3000/` → `http://localhost:4098/`

2. **Next.js rewrites** (`next.config.js`):
   - `/opencode-web/:path*` → `http://127.0.0.1:4098/:path*`
   - `/opencode-cli/:path*` → `http://127.0.0.1:4099/:path*`
   - Same-proxy pattern as `/api/v1/:path*` → `http://127.0.0.1:4097/:path*`

3. **CSP headers** (same `next.config.js`):
   - `frame-src 'self' http://localhost:4098 http://localhost:4099` — allows same-origin proxy URLs and direct loopback ports for local development
   - `connect-src 'self' http://localhost:4097` — allows same-origin and direct loopback API access

4. **Docker Compose port binding** (only port 3000 is LAN-accessible):
   - Port `3000` is published without a host prefix → accessible from LAN
   - Ports `4097`, `4098`, `4099`, `1455` are all `127.0.0.1:`-bound → host loopback only
   - The dashboard is the single public entry point; OpenCode/ttyd/API/OAuth are reached through it via the same-origin proxy

5. **Environment overrides** (optional):
   - `NEXT_PUBLIC_OPENCODE_WEB_URL` and `NEXT_PUBLIC_OPENCODE_CLI_URL`
   - Only **relative same-origin paths** are accepted (must start with `/`). Direct service origins like `http://opencode.example.com/` are rejected and fall back to the default proxy path. This is enforced by `configuredPath()` in `runtime-urls.ts`.

### WSL2 + LAN access

When the dashboard is accessed from a LAN device via WSL2's Windows IP:

1. WSL2 port proxy forwards the LAN-port 3000 to WSL2's internal IP
2. The browser at `http://<windows-ip>:3000/` triggers the LAN HTTP branch in `runtime-urls.ts`
3. Both OpenCode Web and CLI iframes load via `/opencode-web/` and `/opencode-cli/` same-origin proxy paths
4. The Next.js rewrites forward these requests to the loopback-bound OpenCode/ttyd processes inside the container
5. No additional CORS/CSP widening or port-range exposure is needed — the proxy handles it all through a single published port (3000)
