---
title: Getting Started
description: Step-by-step setup guide for Ingenium — prerequisites, installation, configuration, and first run.
---

# Getting Started with Ingenium

This guide walks you through setting up Ingenium — a self-learning AI agent skill system and MCP server — on OpenCode.

---

## Prerequisites

Before you begin, make sure you have these installed:

| Tool | Minimum Version | Check Command |
|------|----------------|---------------|
| **Docker** | 24+ | `docker --version` |
| **Docker Compose** | v2 | `docker compose version` |
| **git** | any modern version | `git --version` |

---

## Step 1 — Clone

```bash
git clone https://github.com/jtmb/ingenium.git
cd ingenium
```

---


## Step 2 — Start the Services

Set the required secrets before starting. Keep them in your shell or an ignored `.env` file; never commit them:

```bash
export OPENCODE_SERVER_PASSWORD='choose-a-server-password'
export INGENIUM_API_TOKEN='<generate-a-32-to-128-character-base64url-token>'
export INGENIUM_EMAIL_ENCRYPTION_KEY='64-hex-or-base64url-characters'
docker compose up --build
```

The deployed database is `/app/.ingenium/data` on the `ingenium-data` named
volume. Rebuilding the image does not remove this volume. Keep the same Compose
project name across invocations (for example, always use
`docker compose -p ingenium ...`) and never use `docker compose down -v` for a
normal restart; otherwise Docker can select or create an empty volume.

For a local host MCP client, seed the ignored fallback file from `.env` before
starting OpenCode:

```bash
./scripts/bootstrap-local-secrets.sh
```

This creates `.opencode/.ingenium-api-token` only when absent, uses mode `0600`,
rejects symlinks/non-files, and refuses a file whose value does not match
`INGENIUM_API_TOKEN`. In the container, the entrypoint validates the bootstrap
secret, atomically creates `/run/ingenium-secrets/api-token` and
`/workspace/.opencode/.ingenium-api-token` as `appuser`-owned mode-`0600` files,
then removes the inline token from the supervised process environment.

`OPENCODE_SERVER_PASSWORD` and `INGENIUM_API_TOKEN` are required. The
`NEXT_PUBLIC_OPENCODE_WEB_URL` and `NEXT_PUBLIC_OPENCODE_CLI_URL` settings are
build-time browser configuration; if you use remote/LAN access, set both to
operator-managed authenticated root HTTPS origins before building. Do not set
them only after the container starts.

This starts all services in a single container:
- **Dashboard root** on http://localhost:3000 (WSL-forwardable local gateway, no Basic Auth)
- **OpenCode Web root** on http://opencode.localhost:3000 (no Basic Auth)
- **OpenCode CLI root** on http://cli.localhost:3000 (no Basic Auth)
- Port `3000` is the browser gateway and is the port Windows reaches through WSL localhost forwarding. The API boundary on `127.0.0.1:4097` is for authenticated MCP clients, while OpenCode/ttyd remain private upstreams on `4098`/`4099`; do not publish, forward, or browse to those ports.

The local dashboard, Web, and CLI roots do not prompt for HTTP Basic Auth and do not receive browser bearer tokens. This plain-HTTP profile is for the local Windows↔WSL path only; use an operator-managed authenticated TLS profile for LAN or remote access.

The API server idempotently creates the `global-default` project at startup if none exists — no manual setup needed.

### Troubleshooting Startup Issues

| Symptom | Cause | Resolution |
|---------|-------|------------|
| Email engine not running | No global project — mail sync skips gracefully when `global-default` is absent | The API creates it automatically on startup. If you see `Skipping mail sync — no global project configured` in the logs, create one via `ingenium_project_init` or the dashboard `/projects` page |
| Health endpoint works but routes return errors | DB not fully initialized (WAL recovery in progress) | Wait a few seconds and retry. The API runs a WAL checkpoint + integrity check at startup |
| Synthesis never runs | No enabled provider block has the Primary for Ingenium role | Configure a primary block in Settings → Providers. The scheduler logs `Synthesis LLM not configured` when idle |
| Synthesis LLM settings appear blank after restart | Docker volume (`ingenium-data`) is new or empty — no saved settings exist | Re-enter the provider, model, and API key in Settings → Providers. API keys are never stored in responses; the UI shows "Saved key" or "API key" placeholder to indicate whether a credential is stored |
| Mail account appears missing after rebuild | Compose project-name drift selected a different named volume, or the old volume was deleted | Stop and identify the original Compose project/volume. Re-run with the original `-p` value; do not create a new account until the original data volume is confirmed. |
| Mail status is degraded or Reconnect is shown | Auth circuit breaker, expired OAuth, or encryption-key mismatch | Keep the account and use Reconnect. Restore the original encryption key for a mismatch; do not delete cached mail or expose credential material. |
| OpenCode reports `-32000 Connection closed` when invoking MCP tools | **Two possible root causes**: (1) **stdout logger contamination** — the pino logger writes to stdout (fd 1), which conflicts with the MCP stdio transport that expects JSON-RPC messages exclusively on stdout. Any stray log output corrupts the message stream, causing the host to close the connection. (2) **Missing dist/config dependency** — the packaged server (`dist/scripts/mcp-server.js`) imports from `../config/index.js`; if `tsc` output is stale or `config/` was omitted from the build, the server fails at module load before any tool can respond. | (1) Ensure `lib/logger.ts` uses `pino.destination(2)` to route all logs to stderr. Verify the compiled `dist/lib/logger.js` has `pino.destination(2)` — if out of date, rebuild with `npm run build`. (2) Verify `tsconfig.json` includes `"config/**/*.ts"` in the `include` array and `dist/config/index.js` exists. Rebuild with `npm run build` and restart the server. The MCP server identity (`mcpName`, `mcpVersion` in `config/index.ts`) is passed to `McpServer()` for runtime handshake verification — if these are missing or empty, the host may reject the connection during the `initialize` handshake.

## Step 3 — Verify

Navigate to [http://localhost:3000](http://localhost:3000) to see the dashboard without an HTTP Basic Auth prompt. Check API health:

```bash
curl --config "${XDG_CONFIG_HOME:-$HOME/.config}/ingenium/api-curl.conf" \
  http://localhost:4097/api/v1/projects
```

The referenced curl config is provisioned from the secret store and must be a
regular mode-0600 owner-only file containing the bearer header; do not paste a
real token into shell history, process arguments, or documentation. OpenCode MCP
may instead read the ignored `.opencode/.ingenium-api-token` file when it is a
regular mode-0600 owner-only file; tracked `opencode.json` must remain
credential-free. The dashboard injects its token server-side and never sends
it to browser JavaScript. The exact OAuth callback exception is
`GET http://localhost:1455/auth/callback`. Host port `1455` reaches the Nginx
callback listener, which forwards only that exact path to private Express
`4096`; other paths are rejected.

A source/config or build-time-origin change requires `docker compose up --build -d`; a secret-only change normally requires `docker compose up -d`. Refresh the browser after either operation. If the new deployment cannot be verified, roll back to the last known-good image and build-time configuration; never expose 4098/4099 as a workaround.

If the API boundary returns `401`, the bearer header is missing or malformed;
`403` means the token is wrong. If the dashboard proxy returns `503`, its
server-side token file is unavailable. Health is also authenticated and fails
closed when token configuration is missing. Port `1455` is not a general API
tunnel: only `GET /auth/callback` is accepted. Never include token bytes in
commands, logs, screenshots, or support reports.

## Step 4 — Configure Synthesis LLM (Optional)

1. Navigate to **Settings → Providers** in the dashboard
2. Add a provider block and configure its provider ID, npm package, and models
3. Mark the block **Primary for Ingenium** and enter its API key
4. Click **Save providers**, then restart OpenCode

---

## Next Steps

Once everything is running:

- **Explore the dashboard** — click through all 20 primary routes plus the Settings overlay
- **Read feature guides** — see `usage/` for per-feature instructions
- **Initialize repository resources (optional)** — from the active worktree, run
  `ingenium-init-project --dry-run` to preview the repository-authoritative
  projection. Use `--apply` only when the preview is accepted; append
  `--docs-only` to limit the operation to `docs/**/*.md`, or
  `--project <name>` to target a validated explicit project. In the production
  image, the command is on `PATH` at
  `/usr/local/bin/ingenium-init-project`. This is a documented procedure, not
  evidence that onboarding has been run in the current session.
- The default projection includes `docs/**/*.md`, eligible skills and agents,
  and configured local plugin sources. It excludes commands, MCP server
  definitions, project/global config, incomplete agent notes, migrated skill
  directories, the reserved `ingenium-llm-broker`, symlinks, and secret-like
  plugin paths or option keys. The production image preserves configured plugin
  source files at their repository paths so runtime onboarding can submit the
  same source identities.
- **Provision an empty project** — use the `ingenium_project_init` MCP tool when
  you need project creation without the repository projection.
- **Learn the self-learning pipeline** — read `concepts/self-learning.md`
