---
title: Environment Variables — Canonical Reference
description: Canonical reference for all environment variables used across the Ingenium monorepo.
---

# Environment Variables — Canonical Reference

All environment variables used across the Ingenium monorepo. Any new variable added to the codebase MUST be documented in the same commit.

---

## Core (`packages/ingenium-core`)

| Variable | Default | Used By | Description |
|----------|---------|---------|-------------|
| `INGENIUM_CORE_DB_PATH` | `/app/.ingenium/data` in Docker; host fallback resolves to `.ingenium/data` | `db.ts`, all tool modules | Canonical SQLite database path; do not create a sibling `data.db` |
| `INGENIUM_HOME` | `~/.ingenium` | `tools/projects.ts` | Base directory for project data storage |
| `INGENIUM_DOCS_ROOT` | _(none — required for repo indexing)_ | `tools/rag.ts` | Repository root for canonical docs indexing. `indexConfiguredDocs()` walks `{root}/docs/**/*.md`, skips symlinks, and rejects paths escaping the root. Used by `POST /api/v1/rag/ingest`. |
| `LOG_LEVEL` | `info` | `logger.ts` | Pino log level (`debug`, `info`, `warn`, `error`) |
| `NODE_ENV` | — | `logger.ts` | If `production`, JSON logging; otherwise pretty-print |
| `INGENIUM_GLOBAL_CONFIG_PATH` | `/home/appuser/.config/opencode/` outside Docker; `/home/ingenium-opencode/.config/opencode/` in Docker | `tools/paths.ts`, supervised API | Global config path for skills/plugins/commands. |
| `INGENIUM_PROJECT` | validated worktree basename for external sessions | extension plugins | Optional explicit display locator for a credential-authorized immutable project UUID. Explicit values take precedence and fail closed when unsafe; `/workspace` requires an explicit safe locator. It is not authority and must match a credential project grant. |
| `INGENIUM_PROJECT_ID` | _(runtime-injected)_ | isolated runtime launchers | Immutable project UUID for the current isolated runtime. |
| `INGENIUM_ORGANIZATION_ID` | _(runtime-injected)_ | isolated runtime launchers | Immutable organization UUID for the current isolated runtime. |
| `INGENIUM_WORKTREE` | current working directory | extension launcher and `ingenium-init-project` | Exact launcher worktree binding checked by the API on scoped requests. |
| `INGENIUM_WORKSPACE_ID` | _(none; required for external MCP)_ | extension launcher, MCP server | Stable workspace binding checked by the API. |
| `INGENIUM_TRUSTED_API_URL` | _(none)_ | extension launcher | Operator-controlled API authority override. Remote values must use HTTPS; loopback HTTP is accepted for local operation. Repository `opencode.json` cannot configure this trust value. |
| `INGENIUM_API_URL_TRUSTED` | _(launcher-injected)_ | extension-owned MCP child, MCP server | Internal handoff proving `INGENIUM_API_URL` passed extension authority validation. It is not an operator or repository configuration surface. |
| `INGENIUM_MCP_CREDENTIAL` | _(none)_ | extension and MCP server | One-time-issued scoped credential; never persist plaintext in tracked config. |
| `INGENIUM_MCP_CREDENTIAL_FILE` | `.opencode/.ingenium-mcp-credential` (`.opencode/.ingenium-repository-sync-credential` for repository sync; API-owned ephemeral file for report probes) | extension and MCP server | Owner-only scoped-credential file selected for the declared audience. External runtimes and report probes do not read the installation bearer. |
| `INGENIUM_LEARNING_CREDENTIAL_FILE` | `.opencode/.ingenium-learning-credential` | extension learning plugins | Owner-only `mcp` credential used only for extension tool-state checks and extraction, synthesis, pipeline-event, and observation lifecycle operations. An absolute locator requires an owner-private parent directory. |
| `INGENIUM_REPOSITORY_SYNC_CREDENTIAL_FILE` | `.opencode/.ingenium-repository-sync-credential` | extension resource-sync plugin | Owner-only repository-sync credential locator. It remains separate from general MCP and learning credentials. |
| `INGENIUM_MCP_CREDENTIAL_PURPOSE` | inferred from the operation | extension-owned MCP child, MCP server | Closed-set credential selector: `general`, `learning`, `repository-sync`, or `runtime`. Learning requires audience `mcp`; repository sync and runtime require their matching audiences. |
| `INGENIUM_MCP_AUDIENCE` | `mcp` | extension and MCP server | Credential audience: `mcp`, `runtime`, `repository-sync`, or the internal-only `mcp-report` probe audience. |
| `INGENIUM_MCP_REPORT_MODE` | _(unset)_ | API-owned MCP report child | Internal marker that disables child MCP gateway startup and permits only the dedicated API-owned report credential path. It is never a user-configurable authority. |
| `INGENIUM_RUNTIME_CREDENTIAL_FILE` | `.opencode/.ingenium-runtime-credential` | MCP server child-runtime handoff | Optional owner-only dedicated `runtime` audience credential. It is used only for the private child environment handoff and must match the parent project/workspace/worktree binding. |
| `INGENIUM_RUNTIME_CREDENTIAL` | _(none)_ | MCP server | Optional in-memory runtime credential used by tests/internal launchers; production isolated runtimes use the protected capability file instead. |
| `INGENIUM_RUNTIME_ID` | _(runtime-injected)_ | isolated runtime launchers | Immutable runtime UUID. |
| `INGENIUM_RUNTIME_OWNER_ID` | _(runtime-injected)_ | isolated runtime launchers | Immutable user UUID that owns the runtime. |
| `INGENIUM_STORAGE_MAPPING_HASH` | _(runtime-injected)_ | runtime entrypoint, extension binding | Lowercase 64-character SHA-256 identity of the authorized workspace storage mapping; required for user-runtime credential binding and never caller-selected. |
| `INGENIUM_RUNTIME_BIND_HOST` | `127.0.0.1`; `0.0.0.0` inside an isolated runtime | ttyd and code-server launchers | Private listener bind selected by the trusted runtime entrypoint. Runtime ports remain un-published. |
| `INGENIUM_INTERNAL_SERVICE` | _(none)_ | internal MCP/server launchers | Explicit internal-service compatibility marker permitting the installation bearer. Never set for external user runtimes. |

## Extension (`packages/ingenium-extension`)

| Variable | Default | Used By | Description |
|----------|---------|---------|-------------|
| `INGENIUM_COORDINATION_OWNER_SECRET_FILE` | _(none)_ | `ingenium-coordination-reset` | Absolute path to an owner-private mode-`0600` JSON file containing the bootstrap owner's login and step-up credentials. Exactly one protected file or descriptor source is required; the value is never accepted through argv or printed. |
| `INGENIUM_COORDINATION_OWNER_SECRET_FD` | _(none)_ | `ingenium-coordination-reset` | Already-open owner-private regular-file descriptor containing the same JSON payload. Mutually exclusive with `INGENIUM_COORDINATION_OWNER_SECRET_FILE`; descriptor numbers below 3 are rejected. |
| `OBSERVER_CHECK_INTERVAL` | `0` | `observer.ts` | Session idle check interval; `0` disables observer checks. |
| `INGENIUM_COORDINATION_TRACE_FILE` | _(unset)_ | `session-coordinator.ts` | Optional coordination lifecycle trace file. The resolved path must remain below `/tmp/opencode/` in an owner-only `0700` directory and `0600` regular file; diagnostic write failures never affect coordination. |
| `INGENIUM_COORDINATION_TRANSFORM_CAPTURE` | _(unset)_ | `session-coordinator.ts` | Set to `1` to enable the optional private capture of non-empty coordination transform values. Leave unset in normal operation. |
| `INGENIUM_COORDINATION_TRANSFORM_CAPTURE_FILE` | _(unset)_ | `session-coordinator.ts` | Owner-only `0600` capture file below `/tmp/opencode/`, used only when `INGENIUM_COORDINATION_TRANSFORM_CAPTURE=1`. |

When both coordination owner overrides are absent, the reset command reads the
fixed ignored `.opencode/.ingenium-coordination-owner-provider.json` path. This
is not an environment setting: it contains only absolute references to a
protected key and an authenticated ciphertext bundle outside the worktree.

## API (`services/ingenium-api`)

| Variable | Default | Used By | Description |
|----------|---------|---------|-------------|
| `INGENIUM_API_PORT` | `4096` in Docker (`4097` standalone) | `config/index.ts` | Private Express API listen port in the container; public host bearer boundary remains `127.0.0.1:4097`. |
| `INGENIUM_API_RATE_LIMIT` | `100` | `lib/middleware/rate-limit.ts` | Max requests per minute per IP |
| `INGENIUM_API_PROXY_PORT` | `4097` | `scripts/api-boundary-proxy.mjs`, boundary launcher | Host-loopback bearer boundary listener. |
| `INGENIUM_API_UPSTREAM_PORT` | `4096` | `scripts/api-boundary-proxy.mjs`, boundary launcher | Private Express API upstream forwarded by the boundary. |
| `INGENIUM_API_PROBE_URL` | `http://127.0.0.1:4097/api/v1/health` | `scripts/probe-api.mjs` | Credential-free API health URL used by the deployment probe. |
| `INGENIUM_API_TOKEN` | _(non-container development fallback only)_ | entrypoint, API boundary, API | Internal installation bearer. Compose does not pass it inline, and it must not appear in user runtimes or external extension config. |
| `INGENIUM_API_TOKEN_FILE` | `${XDG_CONFIG_HOME:-$HOME/.config}/ingenium/live-production/installation-api.token` from bootstrap; runtime `/run/ingenium-secrets/api/installation-api-token` | Compose, entrypoint, private API | Absolute owner-only host installation-token file mounted read-only at `/run/ingenium-bootstrap/api-token`; entrypoint copies it to the `ingenium-api`-owned ephemeral path. Boundary, Dashboard, gateway, health checks, and user runtimes do not receive it. External MCP uses `INGENIUM_MCP_CREDENTIAL_FILE`. |
| `INGENIUM_DASHBOARD_BOOTSTRAP_TOKEN_FILE` | `/run/ingenium-secrets/dashboard/bootstrap-token` for Dashboard; paired API copy under `/run/ingenium-secrets/api/` | entrypoint, Dashboard proxy, API authentication | Ephemeral per-start credential restricted to bootstrap status/claim routes. It is not the installation bearer and cannot authorize management routes. |
| `DASHBOARD_ALLOWED_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000` | dashboard `proxy.ts`, API `config/index.ts`, supervised launchers | Comma-separated **exact** HTTP(S) dashboard origins accepted by both dashboard-proxy CSRF and API CORS/CSRF. Entries cannot include paths, credentials, query/fragment, whitespace, or wildcards. |
| `CORS_ORIGIN` | _(legacy single-origin fallback only)_ | `config/index.ts` | Backward-compatible non-container fallback when `DASHBOARD_ALLOWED_ORIGINS` is unset. New deployments must configure the explicit allowlist. |
| `TZ` | `UTC` in the supervised API launcher | `scripts/run-api.sh` | API process time-zone setting; the launcher supplies a bounded default while clearing unrelated inherited environment. |
| `INGENIUM_AUTH_ENCRYPTION_KEY_FILE` | `/app/.ingenium/auth-encryption-key` in Docker | `scripts/docker-entrypoint.sh`, `scripts/run-api.sh`, `packages/ingenium-core/lib/tools/authentication.ts` | Persistent root-owned mode-`0600` regular file containing exactly one base64url-encoded 256-bit key. The entrypoint atomically provisions it, then gives the private API an owner-only ephemeral copy. Used for authentication factors and transient OIDC PKCE encryption; independent of vault seal state. |
| `SYNTHESIS_INTERVAL_MS` | `900000` | `scheduler.ts` | Scheduled synthesis + extraction interval (15 min), 0 = disabled |
| `USAGE_SYNC_INTERVAL_MS` | `300000` | `scheduler.ts` | Scheduled metadata-only OpenCode usage sync interval (5 min), 0 = disabled. Explicit source-project mappings control project ownership; this never falls back to `global-default`. |
| `SYNTHESIS_MODEL` | _(none)_ | `synthesis-llm.ts` | Fallback synthesis model name (used when no provider config is saved in DB) |
| `SYNTHESIS_API_KEY` | _(none)_ | `synthesis-llm.ts` | Fallback synthesis API key (used when no provider config is saved in DB) |
| `SYNTHESIS_ENDPOINT` | _(none)_ | `synthesis-llm.ts` | Fallback synthesis endpoint URL (used when no provider config is saved in DB) |
| `SYNTHESIS_ALLOW_PRIVATE_NETWORK` | `false` | `synthesis-llm.ts` | When `true`, bypasses SSRF protection for the synthesis endpoint. Required for local inference servers (Ollama, LM Studio, vLLM). |
| `INGENIUM_API_DISABLE_BACKGROUND_SCHEDULERS` | _(unset)_ | `runtime-mode.ts` | Test/one-shot API override; `1` or `true` suppresses background schedulers. Normal deployments leave it unset; the fixed production API launcher does not propagate arbitrary inherited values. |
| `INGENIUM_API_DISABLE_SCHEDULERS` | _(unset)_ | `runtime-mode.ts` | Test/one-shot API override; `1` or `true` suppresses background schedulers. Normal deployments leave it unset; the fixed production API launcher does not propagate arbitrary inherited values. |
| `INGENIUM_API_DISABLE_MAIL_MAINTENANCE` | _(unset)_ | `runtime-mode.ts` | Test/one-shot API override; `1` or `true` suppresses mail maintenance. Normal deployments leave it unset; the fixed production API launcher does not propagate arbitrary inherited values. |
| `INGENIUM_API_DISABLE_MAIL` | _(unset)_ | `runtime-mode.ts` | Test/one-shot API override; `1` or `true` suppresses mail maintenance. Normal deployments leave it unset; the fixed production API launcher does not propagate arbitrary inherited values. |
| `INGENIUM_OPENCODE_DB_PATH` | `/var/opencode/opencode.db` | extraction engine | OpenCode SQLite DB path for server-side extraction |
| `INGENIUM_DEPLOYMENT_MODE` | `compatibility` | API runtime mode, entrypoint, restore executor | `compatibility`, `control-plane`, or internal `user-runtime`. Control-plane restore refuses to run while any runtime is non-terminal. |
| `INGENIUM_RUNTIME_MANAGER_URL` | _(required in control-plane mode)_ | `runtime-manager-client.ts` | Private HTTP origin for the runtime manager; credentials and paths in the URL are rejected. |
| `INGENIUM_RUNTIME_MANAGER_BOOTSTRAP_TOKEN_FILE` | `/run/ingenium-bootstrap/runtime-manager-token` in Compose | runtime-manager control entrypoint | Read-only host bootstrap token path for the manager; the root entrypoint copies it to the service-owned runtime token before dropping to `ingenium-runtime-manager`. |
| `INGENIUM_RUNTIME_MANAGER_TOKEN_FILE` | _(required in control-plane mode)_ | control plane, runtime manager, manager health check | Service-local owner-only regular file containing the 43–128-character private manager bearer. The control plane receives the read-only host mount at `/run/ingenium-runtime-manager/token`; the manager receives its entrypoint-copied file at `/run/ingenium-secrets/runtime-manager/token`. |
| `INGENIUM_RUNTIME_RECONCILE_INTERVAL_MS` | `15000` | `runtime-reconciler.ts` | Runtime health, lease, idle, and orphan reconciliation interval; minimum 1000 ms. |
| `INGENIUM_RUNTIME_MAX_ACTIVE_PER_USER` | `2` | runtime routes | Maximum active runtime instances per owner. |
| `INGENIUM_RUNTIME_CPU_MILLIS` | `1000` | runtime routes | Default per-runtime CPU quota in millicores. |
| `INGENIUM_RUNTIME_MEMORY_BYTES` | `1073741824` | runtime routes | Default per-runtime memory limit. |
| `INGENIUM_RUNTIME_PIDS_LIMIT` | `256` | runtime routes | Default per-runtime PID limit. |
| `INGENIUM_RUNTIME_DISK_BYTES` | `2147483648` | runtime routes | Default size of the private HOME tmpfs. |
| `INGENIUM_RUNTIME_PROCESS_LIMIT` | `128` | runtime routes | Default per-runtime aggregate process/PID ceiling. The manager applies the lower of this value and `INGENIUM_RUNTIME_PIDS_LIMIT` as Docker's cgroup PID limit. |
| `INGENIUM_RUNTIME_IDLE_LEASE_MS` | `1800000` | runtime routes | Idle runtime lease duration. |
| `INGENIUM_RUNTIME_ABSOLUTE_LEASE_MS` | `28800000` | runtime routes | Absolute runtime lifetime and capability expiry. |
| `INGENIUM_RUNTIME_SCHEME` | `http` | control plane, runtime gateway, dashboard build | Exact audience-root scheme. `http` is valid only with a `.localhost` root and the loopback/default-port tuple; remote/custom roots require explicit `https`. |
| `INGENIUM_RUNTIME_ROOT_DOMAIN` | `runtime.localhost` | control plane, runtime gateway, dashboard build | Runtime DNS suffix. Special-use `*.localhost` roots use browser-trusted HTTP; remote/custom roots require explicit HTTPS transport configuration and an operator-trusted wildcard certificate. |
| `NEXT_PUBLIC_RUNTIME_SCHEME` | _(set from `INGENIUM_RUNTIME_SCHEME` at build)_ | dashboard CSP | Public scheme used for the runtime wildcard frame/connect CSP source. Scheme/domain mismatches fail the dashboard configuration. |
| `NEXT_PUBLIC_RUNTIME_ROOT_DOMAIN` | _(set from `INGENIUM_RUNTIME_ROOT_DOMAIN` at build)_ | dashboard CSP | Public DNS suffix used only for the runtime wildcard frame/connect CSP sources; it contains no credential. |
| `INGENIUM_RUNTIME_GATEWAY_TOKEN_FILE` | _(required in production)_ | control plane, runtime gateway | Service-local owner-only file containing the 43–128-character gateway exchange/validation bearer, distinct from manager and installation credentials. The control plane receives `/run/ingenium-runtime-gateway/token`; the gateway receives its entrypoint-copied file at `/run/ingenium-secrets/runtime-gateway/token`. |
| `INGENIUM_RUNTIME_GATEWAY_BOOTSTRAP_TOKEN_FILE` | `/run/ingenium-bootstrap/runtime-gateway-token` in Compose | runtime-gateway control entrypoint | Read-only host bootstrap token path for the gateway; the root entrypoint copies it to the service-owned runtime token before dropping to `ingenium-runtime-gateway`. |
| `INGENIUM_RUNTIME_GATEWAY_BIND_ADDRESS` | `127.0.0.1` | Compose, runtime gateway validation | Docker host publication address. Local HTTP rejects every value except IPv4 loopback; remote HTTPS requires explicit `0.0.0.0`. |
| `INGENIUM_RUNTIME_GATEWAY_HOST_PORT` | `80` | Compose, runtime gateway validation | Published host port. Local HTTP requires default port 80 so generated URLs need no port; remote HTTPS requires explicit 443. |
| `INGENIUM_RUNTIME_GATEWAY_PORT` | `8080` | Compose, runtime gateway | Container listener/target port. Local HTTP requires 8080; remote HTTPS requires explicit 8443. |
| `INGENIUM_RUNTIME_TLS_CERT_FILE` | _(required in production)_ | runtime gateway | Read-only wildcard certificate chain for `*.<INGENIUM_RUNTIME_ROOT_DOMAIN>`. |
| `INGENIUM_RUNTIME_TLS_KEY_FILE` | _(required in production)_ | runtime gateway | Read-only wildcard private key; never mounted into the manager, control plane, dashboard, or user runtime. |

## MCP Server (`services/ingenium-server`)

| Variable | Default | Used By | Description |
|----------|---------|---------|-------------|
| `INGENIUM_API_URL` | `http://localhost:4097/api/v1` | extension launcher, `config/index.ts`, `lib/client.ts` | API URL selected by the trusted launcher. Repository config may retain only the canonical loopback deployment URL; remote deployments use operator-controlled `INGENIUM_TRUSTED_API_URL` with HTTPS. |
| `INGENIUM_API_TIMEOUT` | `10000` | `config/index.ts` | HTTP request timeout in milliseconds |

## Dashboard (`services/ingenium-dashboard`)

| Variable | Default | Used By | Description |
|----------|---------|---------|-------------|
| `NEXT_PUBLIC_API_URL` | `/api/v1` | `src/lib/api.ts` | Same-origin dashboard API prefix. The browser and Dashboard server never receive `INGENIUM_API_TOKEN`; the server uses only its bootstrap-scoped credential while proxying unauthenticated bootstrap routes. Authenticated requests use the browser session cookie. |
| `DASHBOARD_ALLOWED_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000` | `src/proxy.ts`, `scripts/run-dashboard.sh` | Server-only copy of the exact dashboard origin allowlist. Production gateway mutations must reconstruct one of these origins from Nginx-overwritten `X-Forwarded-Proto`, `X-Forwarded-Host`, and `X-Forwarded-Port`; isolated direct fixtures may use their exact browser origin only when forwarding metadata is absent (or is the recognized Next direct-listener default) and that origin is explicitly allowlisted. |

## Email (`packages/ingenium-email`)

| Variable | Default | Used By | Description |
|----------|---------|---------|-------------|
| `GOOGLE_OAUTH_CLIENT_ID` | _(required for OAuth)_ | `oauth.ts` | Google OAuth2 app client ID |
| `GOOGLE_OAUTH_CLIENT_SECRET` | _(required for OAuth)_ | `oauth.ts` | Google OAuth2 app client secret |
| `MS_OAUTH_CLIENT_ID` | _(required for OAuth)_ | `oauth.ts` | Microsoft OAuth2 app client ID |
| `MS_OAUTH_CLIENT_SECRET` | _(required for OAuth)_ | `oauth.ts` | Microsoft OAuth2 app client secret |
| `INGENIUM_EMAIL_ENCRYPTION_KEY` | _(development fallback only)_ | `credential-crypto.ts` | Inline 64-character key accepted only when the file source is absent; simultaneous inline/file sources fail closed. Compose does not project it. |
| `INGENIUM_EMAIL_ENCRYPTION_KEY_FILE` | _(required in Compose)_ | entrypoint, `run-api.sh`, `credential-crypto.ts` | Owner-only mode-`0600` regular non-symlink file below a mode-`0700` parent. Compose mounts it read-only; entrypoint descriptor-copies it to protected `/run` storage and API receives only the path. |
| `INGENIUM_EMAIL_ENCRYPTION_KEY_EMPTY_TRANSITION` | `0` | `run-api.sh`, API startup | One-shot operator gate. `1` permits only an audited transactional continuity update after every current, archived, credential, OAuth-attempt, cache, queue, watcher, and mail-account reference surface proves empty. Any uncertainty or concurrent row fails closed. |
| `SUPERVISOR_SERVER_URL` | `unix:///run/ingenium-supervisor/supervisor.sock` | API service status and dashboard summary | Supervisor XML-RPC transport. Production defaults to the private Unix socket; local development may explicitly configure loopback HTTP. Non-loopback TCP is rejected. |
| `OAUTH_REDIRECT_URI` | `http://localhost:3000/mail/oauth/callback` | `oauth.ts` | OAuth2 callback URL for Gmail/Outlook |

## Docker / opencode-web

| Variable | Default | Used By | Description |
|----------|---------|---------|-------------|
| `OPENCODE_SERVER_PASSWORD` | _(development fallback only)_ | `opencode-client.ts` | Inline local-development fallback; simultaneous inline/file sources fail closed. Compose does not project it. |
| `OPENCODE_SERVER_PASSWORD_FILE` | _(required in Compose)_ | entrypoint, `run-api.sh`, `opencode-client.ts` | Owner-only mode-`0600` regular non-symlink file below a mode-`0700` parent containing the server-side API proxy guard credential. It is mounted read-only and projected only as a protected runtime path. |
| `OPENCODE_READINESS_ATTEMPTS` | `60` | `scripts/wait-for-opencode.sh` | Positive finite number of one-second readiness attempts before ttyd startup fails. |
| `INGENIUM_OPENCODE_READINESS_CLEAN_ENV` | _(unset; internal re-exec sets `1`)_ | `scripts/wait-for-opencode.sh` | Internal clean-environment re-exec marker. It prevents inherited secrets from reaching readiness `curl` or the OpenCode child and is not an operator configuration surface. |
| `NEXT_PUBLIC_OPENCODE_WEB_URL` | `http://opencode.localhost:3000/` at build time | Docker Compose build args, Next.js dashboard | Legacy credential-free CSP allowlist input retained for build compatibility; it does not select the iframe target. Compatibility uses the fixed alias and production uses an API-issued runtime root. |
| `NEXT_PUBLIC_OPENCODE_CLI_URL` | `http://cli.localhost:3000/` at build time | Docker Compose build args, Next.js dashboard | Legacy credential-free CSP allowlist input retained for build compatibility; it does not select the iframe target. Compatibility uses the fixed alias and production uses an API-issued runtime root. |
| `IMAGE_REVISION` | _(required; `git rev-parse HEAD`)_ | Docker Compose build arg, Docker OCI label | Lowercase 40-character SHA for the checkout being built. Compose cannot derive it, so export it before every Compose command. It is public provenance metadata, never a credential. |
| `IMAGE_SOURCE` | `https://github.com/jtmb/ingenium` | Docker Compose build arg, Docker OCI label | Public credential-free HTTPS repository URL recorded as OCI source metadata. |
| `OPENCODE_SERVER_URL` | `http://localhost:4098` in the config fallback; `http://127.0.0.1:4101` from the Compose API launcher | `ingenium-api` (OpenCode client) | Base URL of the OpenCode web server. The compatibility launcher targets the private Basic-auth proxy on `4101`, which forwards to Web on `4098`; standalone/config fallback uses `4098`. |
| `OPENCODE_DB_PATH` | `/home/ingenium-opencode/.local/share/opencode/opencode.db` | backup routes, backup scheduler, restore maintenance | OpenCode SQLite database included in dual-database backup and restore operations. |
| `OPENCODE_OAUTH_CALLBACK_FORWARD_URL` | `http://localhost:1455/auth/callback` in the API; Compose launcher override `http://127.0.0.1:4098/auth/callback` | API OpenCode routes, `scripts/run-api.sh` | Loopback HTTP callback target for forwarding native OpenCode OAuth callbacks. Only the exact `/auth/callback` path is accepted. |
| `INGENIUM_RUNTIME_MANAGER_PORT` | `4110` | private runtime manager | Manager listen port on the internal control network; it is never published to the host. |
| `INGENIUM_RUNTIME_WORKSPACE_MAP_FILE` | `/etc/ingenium/runtime-workspaces.json` | private runtime manager | Root-controlled version-1 JSON map of workspace IDs to exact host and validation paths. |
| `INGENIUM_RUNTIME_WORKSPACE_VALIDATION_SOURCE` | `./config` | production Compose runtime manager | Host source for the manager's sole read-only workspace-validation mount. Set it to the exact approved host workspace when the map is non-empty. |
| `INGENIUM_RUNTIME_WORKSPACE_VALIDATION_TARGET` | `/workspace-validation` | production Compose runtime manager | Container target for the read-only validation mount. Each non-empty map entry's `validationPath` must resolve through this dedicated mount. |
| `INGENIUM_RUNTIME_API_URL` | manager: `http://ingenium-control-plane:4096/api/v1`; gateway: `http://ingenium-control-plane:4097/api/v1/` | private runtime manager and runtime gateway | User-runtime capability traffic uses private Express after strict hostname/path validation. Gateway-private exchange/validation uses the authenticated API boundary so it can overwrite the private-network marker. |
| `INGENIUM_USER_RUNTIME_IMAGE` | `ingenium-user-runtime:$IMAGE_REVISION` in Compose | private runtime manager | Exact image reference used for isolated runtime containers. |
| `INGENIUM_RUNTIME_NETWORK_PREFIX` | `ingenium-runtime-` | private runtime manager | Prefix for one identity-labeled Docker network per runtime. |
| `INGENIUM_RUNTIME_GATEWAY_CONTAINER` | `ingenium-runtime-gateway` in Compose | private runtime manager | Exact identity-labeled unprivileged gateway attached to each runtime network; it has no Docker socket. |
| `INGENIUM_CONTROL_PLANE_CONTAINER` | `ingenium-control-plane` | private runtime manager | Exact identity-labeled control-plane container attached to each dedicated runtime network. |
| `DOCKER_GID` | `999` | production Compose runtime manager | Host Docker-socket group ID added only to the unprivileged runtime-manager container; set it to the socket's actual group ID when different. |

## Ponytail adapter

| Variable | Default | Used By | Description |
|----------|---------|---------|-------------|
| `PONYTAIL_DEFAULT_MODE` | `full` | `packages/ingenium-extension/ponytail/hooks/ponytail-config.js` | Ponytail mode override: `off`, `lite`, `full`, or `ultra`. |
| `PONYTAIL_QUIET_STARTUP` | _(unset)_ | Ponytail config hook | Truthy value suppresses the startup status message. |
| `PONYTAIL_HIDE_STATUS` | _(unset)_ | Ponytail config hook | Truthy value hides the status indicator. |
| `CLAUDE_CONFIG_DIR` | `~/.claude` | Ponytail config hook | Optional Claude configuration root used for Ponytail's Claude-compatible settings. |
| `XDG_CONFIG_HOME` | `~/.config` | Ponytail plugin/config hook, `job-runner.ts` | Optional XDG configuration root for Ponytail settings and job-child OpenCode state. |
| `APPDATA` | platform-defined Windows roaming-data root | Ponytail config hook | Windows fallback root for Ponytail configuration when `XDG_CONFIG_HOME` is unset. |

## Runtime and child-process defaults

| Variable | Default | Used By | Description |
|----------|---------|---------|-------------|
| `HOME` | `/home/appuser` for job children without a vault runtime; inherited locally otherwise | `job-runner.ts` | Home directory passed to job children. Vault-backed runs receive their run-owned home instead. |
| `PATH` | inherited; `/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin` for job children when unset | extension MCP client, job runner | Executable search path. Job children receive an allowlisted fallback rather than the API's unrestricted environment. |
| `USER` | `appuser` for job children when unset | `job-runner.ts` | Non-secret user identity passed to job children. |
| `SHELL` | `/bin/sh` for job children when unset | `job-runner.ts` | Shell identity passed to job children. |
| `TERM` | `dumb` for job children when unset | `job-runner.ts` | Terminal capability value passed to job children. |
| `LANG` | `C.UTF-8` for job children when unset | `job-runner.ts` | Locale value passed to job children. |
| `LC_ALL` | _(unset)_ | `job-runner.ts` | Forwarded to job children only when explicitly present. |
| `LC_CTYPE` | _(unset)_ | `job-runner.ts` | Forwarded to job children only when explicitly present. |
| `XDG_DATA_HOME` | `/home/appuser/.local/share` | `job-runner.ts` | XDG data root for job children; vault-backed runs use their run-owned root. |
| `XDG_CACHE_HOME` | `/home/appuser/.cache` | `job-runner.ts` | XDG cache root for job children; vault-backed runs use their run-owned root. |

## Test suites

| Variable | Default | Used By | Description |
|----------|---------|---------|-------------|
| `INGENIUM_E2E_PROJECT` | _(none)_ | `tests/ingenium-dashboard/docker-active-project.ts` | Optional external Docker-suite project. It must be an existing active project returned by the deployment's same-origin project-list preflight. When unset, the Docker suite requires exactly one active global project. The suite never creates or deletes a project. |
| `INGENIUM_E2E_API_URL` | `http://localhost:4097` | `tests/ingenium-dashboard/suite-containment.ts`, explicit external Playwright suites | Optional external API root used by suites that do not own an integrated fixture. |
| `INGENIUM_API_TEST_MODE` | _(unset)_ | isolated API/dashboard fixture | Enables test-only server contracts in manifest-owned fixture processes. Never set in a deployed application. |
| `INGENIUM_TEST_RUN_NONCE` | _(generated per fixture run)_ | isolated API/dashboard fixture | UUID nonce binding the test-only browser-session exchange to its manifest-owned run. |
| `INGENIUM_TEST_RUN_MANIFEST` | _(unset; fixture runner sets the path)_ | `tests/test-run-context.ts`, Playwright configs/teardown, dashboard fixture specs, containment and retention tools | Test-only path to the run manifest. It selects the manifest-owned fixture, teardown, route-parity, containment, and retention scope. |
| `INGENIUM_TEST_RUN_TELEMETRY` | _(unset; fixture runner sets the path)_ | `tests/test-run-context.ts`, `tests/suite-containment-audit.ts`, `tests/suite-containment-audit.test.ts`, `tests/test-artifact-retention.ts` | Test-only path to runner telemetry used to scope containment audits and artifact-retention selection. |
| `INGENIUM_PLAYWRIGHT_REPO_ROOT` | `process.cwd()` | `tests/test-run-context.ts`, `tests/ingenium-dashboard/visual-qa-artifacts.ts`, `tests/test-artifact-retention.test.ts`, `services/ingenium-dashboard/tests/visual-artifact-contract.test.ts` | Test-only canonical repository-root override for fixture and visual-artifact validation. |
| `INGENIUM_E2E_API_PORT` | Per-run derived block: `41000 + 3 × (first six run-ID hex value mod 5000)` | `tests/test-run-context.ts`, fixture Playwright setup | Optional API listener override for the isolated fixture. The derived port is followed by the dashboard and fixture ports; all three must be distinct user ports and must not use development/Docker ports. |
| `INGENIUM_E2E_DASH_PORT` | Derived API port + 1 | `tests/test-run-context.ts`, fixture Playwright setup | Optional dashboard listener override for the isolated fixture. |
| `INGENIUM_E2E_FIXTURE_PORT` | Derived API port + 2 | `tests/test-run-context.ts`, fixture Playwright setup | Optional chat-fixture listener override for the isolated fixture. |
| `INGENIUM_E2E_DASHBOARD_URL` | `http://localhost:3000` | external Playwright configs and `tests/ingenium-dashboard/suite-containment.ts` | Dashboard origin for Docker, provider, mail, manual, and other external suites. |
| `INGENIUM_E2E_OPENCODE_WEB_URL` | `http://opencode.localhost:3000` | OpenCode Docker specs and external-suite containment | Optional public OpenCode gateway root used for external preflight; private container port `4098` is not a default. |
| `INGENIUM_E2E_OPENCODE_CLI_URL` | `http://cli.localhost:3000` | `tests/ingenium-dashboard/ttyd-websocket.spec.ts` | Test-only public CLI gateway root used by the ttyd WebSocket regression probe. |
| `INGENIUM_E2E_CLI_URL` | `http://cli.localhost:3000` | external-suite containment and CLI specs | Optional public CLI gateway root used for external preflight; private container port `4099` is not a default. |
| `INGENIUM_E2E_SKIP_BUILD` | Unset (build enabled) | `tests/playwright-global-setup.ts`, `tests/playwright.config.ts` | Set to `1` only when production artifacts already exist; it skips only the fixture build and does not switch the dashboard out of production mode. |
| `INGENIUM_DASHBOARD_ARTIFACT_DIR` | _(unset; run-owned fixture `.next` or `services/ingenium-dashboard/.next`)_ | `tests/dashboard-route-parity/route-inventory.ts`, `tests/dashboard-route-parity/runtime.ts` | Test-only production-dashboard artifact directory override for route-parity checks. |
| `INGENIUM_AUTH_RELOAD_EVIDENCE_DIR` | _(unset)_ | `tests/ingenium-dashboard/chat-e2e-smoke.spec.ts` | Test-only directory for the content-free auth-reload request/cookie timeline; unset disables evidence-file output. |
| `INGENIUM_MANUAL_SCREENSHOT_RUN_ID` | _(unset; generated manual-`<timestamp>`-`<UUID>` when absent)_ | `tests/ingenium-dashboard/visual-qa-artifacts.ts`, `services/ingenium-dashboard/tests/visual-artifact-contract.test.ts` | Test-only run identifier that scopes manual screenshot evidence under `tests/artifacts/manual/`. |
| `INGENIUM_VISUAL_QA_RUN_ID` | _(unset; falls back to `INGENIUM_TEST_RUN_NONCE`)_ | `tests/ingenium-dashboard/visual-qa-artifacts.ts`, `services/ingenium-dashboard/tests/visual-artifact-contract.test.ts` | Test-only run identifier that scopes automated visual-QA evidence under `tests/artifacts/visual-qa/`. |
| `INGENIUM_RUNTIME_BROWSER_GATEWAY_PORT` | `43880` | `services/ingenium-api/tests/runtime-gateway.browser.ts` | Test-only local browser-gateway listener port; override it when the default port is occupied. |
| `RUN_DASHBOARD_DOCKER` | _(unset)_ | `tests/ingenium-dashboard/suite-containment.ts`, Docker Playwright setup | Required value `1` to opt into the Docker-backed suite; unset is excluded from the default run. |
| `RUN_DASHBOARD_PROVIDER` | _(unset)_ | `tests/ingenium-dashboard/suite-containment.ts`, provider Playwright setup | Required value `1` to opt into the real-provider suite; unset is excluded from the default run. |
| `RUN_DASHBOARD_MAIL` | _(unset)_ | `tests/ingenium-dashboard/suite-containment.ts`, mail Playwright setup | Required value `1` to opt into the live-mail suite; unset is excluded from the default run. |
| `RUN_DASHBOARD_MANUAL` | _(unset)_ | `tests/ingenium-dashboard/suite-containment.ts`, manual Playwright setup | Required value `1` to opt into the manual visual-evidence suite; unset is excluded from the default run. |
| `RUN_DASHBOARD_ROUTE_PARITY` | _(unset; wrapper sets `1`)_ | `tests/run-dashboard-route-parity.ts`, route-parity Playwright config and navigation governor | Opts into the production-mode dashboard route-parity fixture; the convenience wrapper sets it and removes production bearer variables from the child environment. |
| `INGENIUM_AUDIT_PORTS` | `3000,4097,1455,4098,4099,4999` | `tests/suite-containment-audit.ts` | Comma-separated ports to inspect when auditing containment; unset uses the deployment/default port set. |
| `INGENIUM_AUDIT_EXPECT_PORTS` | Empty set | `tests/suite-containment-audit.ts` | Optional comma-separated ports expected to remain listening during an audit; unset expects none beyond discovered owned infrastructure. |
| `INGENIUM_AUDIT_TEMP_PREFIX` | `ingenium-playwright-` | `tests/suite-containment-audit.ts`, `tests/suite-containment-audit.test.ts` | Test-only prefix used to identify containment-audit temporary directories. |
| `INGENIUM_AUDIT_OCI_REVISION` | _(unset)_ | `tests/suite-containment-audit.ts` | Optional test-only expected OCI image revision used to verify Compose ownership during containment auditing. |
| `INGENIUM_AUDIT_RSS_LIMIT` | `536870912` | `tests/suite-containment-audit.ts` | Test-only maximum resident-set size in bytes accepted by strict containment auditing. |

## Backups

| Variable | Default | Used By | Description |
|----------|---------|---------|-------------|
| `INGENIUM_BACKUPS_DIR` | `/app/.ingenium/backups` | `backups.ts`, `backup-scheduler.ts`, `routes/backups.ts`, `scripts/run-api.sh` | Directory for backup snapshot files (Ingenium + OpenCode DB pairs). Empty or whitespace-only values are treated as unset. |
| `INGENIUM_BACKUP_SIGNING_KEY_FILE` | `/app/.ingenium/backup-signing-key` | `docker-entrypoint.sh`, `run-api.sh`, `tools/backups.ts` | Owner-only (`appuser`, mode `0600`) HMAC-SHA256 key for signed v2 backup manifests. The entrypoint creates at least 32 random bytes once, refuses symlinks, and requires the direct file to remain outside `INGENIUM_BACKUPS_DIR`. The key is never returned, logged, or stored in backup bundles. |
| `INGENIUM_RESTORE_STAGING_DIR` | `/app/.ingenium/restore-staging` | `docker-entrypoint.sh`, `run-api.sh`, `tools/backups.ts` | Separate owner-only (`0700`) root for plan-ID-addressed, tamper-evident restore copies and unlinked download snapshots. It must not be inside or equal to the backup source directory. |
| `INGENIUM_BACKUP_DOWNLOAD_MAX_BYTES` | `268435456` | `tools/backups.ts` | Maximum verified component size buffered for an API download. Invalid or oversized components are rejected before allocation. |
| `INGENIUM_RESTORE_HANDOFF_MAX_BYTES` | `268435456` | `tools/backups.ts` | Maximum combined verified stage size returned through the fixed executor handoff. Oversize stages fail closed before buffer allocation. |
| `INGENIUM_RESTORE_JOURNAL_KEY_FILE` | `/app/.ingenium/restore-journal-key` | `docker-entrypoint.sh`, `restore-maintenance.ts` | Fixed root-owned mode-`0600` HMAC key for RESTORE-101 journals. It is distinct from the appuser-readable backup-manifest signing key, outside backups, never returned or logged, and cannot be overridden by API/MCP or the static launcher. |
| `INGENIUM_RESTORE_MAINTENANCE_DIR` | _(rejected at runtime)_ | `docker-entrypoint.sh`, `restore-maintenance.ts` | Historical override name. Production uses only `/app/.ingenium/restore-maintenance`, a root:root mode-`0700` root-only journal, lock, buffer, and archive directory. Any override is rejected. |
| `INGENIUM_RESTORE_MAINTENANCE_MODE` | _(set only by fixed launchers)_ | `restore-maintenance.ts` | Internal fixed launcher mode: `recover` before supervisord starts or `execute` for the static maintenance program. It is not a user-configurable restore option. |
| `INGENIUM_TRUSTED_ARTIFACT_UID` | _(image-owned appuser UID)_ | `docker-entrypoint.sh`, fixed API/root restore launchers, `tools/backups.ts` | Internal artifact-publisher owner UID read from the root-owned immutable image source. Bundle, staging, and signing-key validation never infer it from the validating process UID. |
| `INGENIUM_TRUSTED_ARTIFACT_GID` | _(image-owned appuser GID)_ | `docker-entrypoint.sh`, fixed API/root restore launchers, `tools/backups.ts` | Internal artifact-publisher group ID paired with `INGENIUM_TRUSTED_ARTIFACT_UID`; root safety snapshots descriptor-set every published bundle artifact to this UID/GID policy before publication. |
| `INGENIUM_RESTORE_TEST_ROOT` | _(test-only)_ | `restore-maintenance.ts`, disposable RESTORE-101 fixture | Enables fixed paths beneath one `/tmp/ingenium-restore-fixture-*` root only while `NODE_ENV=test`. It is rejected in production and never reaches the root Supervisor launcher. |
| `INGENIUM_RESTORE_TEST_PROC_ROOT` | _(test-only)_ | `restore-maintenance.ts`, disposable RESTORE-101 fixture | Optional procfs fixture root beneath `INGENIUM_RESTORE_TEST_ROOT`; rejected outside an authorized fixture. |
| `INGENIUM_RESTORE_TEST_PROC_FAULT` | _(test-only)_ | `restore-maintenance.ts`, disposable RESTORE-101 fixture | Fixture-only procfs fault selector: `fd-dir` or `fd`; invalid values fail closed. |
| `INGENIUM_RESTORE_TEST_TARGET_LOCK_PROBE` | _(test-only)_ | `restore-maintenance.ts`, disposable RESTORE-101 fixture | Set to `1` only in an authorized fixture to prove target-lock handling; rejected outside fixture mode. |

RESTORE-100 signs only v2 fixed-name bundles with the persistent
`INGENIUM_BACKUP_SIGNING_KEY_FILE`; the key file is owner-only, is outside the
backup directory, and is never copied into a bundle. `INGENIUM_RESTORE_STAGING_DIR`
is a separate owner-only root for staged copies. RESTORE-101 adds the separate
root-only maintenance directory, separate journal key, and fixed Supervisor
program: an execution authorization is one-time and expires after 15 minutes;
the API queues only a valid stage and records a deterministic terminal start
failure rather than acknowledging an unstartable executor.

---

## 🔴 Rules

1. **Every new `process.env` reference** MUST be added to this document in the same commit.
2. **Every variable** must list its default value (or note if none).
3. **Every variable** must list which file(s) use it.
4. **Never delete a row** without checking all references first.
5. **CI enforces** this document exists and has an entry for every `process.env` call.

---
