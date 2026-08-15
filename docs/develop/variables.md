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
| `INGENIUM_GLOBAL_CONFIG_PATH` | `/home/appuser/.config/opencode/` | `tools/paths.ts` | Global config path for skills/plugins/commands |
| `INGENIUM_PROJECT` | _(none; required for external MCP)_ | extension plugins | Display locator for a credential-authorized immutable project UUID. It is not authority and must match a credential project grant. |
| `INGENIUM_PROJECT_ID` | _(runtime-injected)_ | isolated runtime launchers | Immutable project UUID for the current isolated runtime. |
| `INGENIUM_ORGANIZATION_ID` | _(runtime-injected)_ | isolated runtime launchers | Immutable organization UUID for the current isolated runtime. |
| `INGENIUM_WORKTREE` | current working directory | extension launcher and `ingenium-init-project` | Exact launcher worktree binding checked by the API on scoped requests. |
| `INGENIUM_WORKSPACE_ID` | _(none; required for external MCP)_ | extension launcher, MCP server | Stable workspace binding checked by the API. |
| `INGENIUM_MCP_CREDENTIAL` | _(none)_ | extension and MCP server | One-time-issued scoped credential; never persist plaintext in tracked config. |
| `INGENIUM_MCP_CREDENTIAL_FILE` | `.opencode/.ingenium-mcp-credential` (`.opencode/.ingenium-repository-sync-credential` for the container repository-sync launcher) | extension and MCP server | Owner-only scoped-credential file selected for the declared audience. External runtimes do not read the installation bearer. |
| `INGENIUM_MCP_AUDIENCE` | `mcp` | extension and MCP server | Credential audience: `mcp`, `runtime`, or `repository-sync`. |
| `INGENIUM_RUNTIME_CREDENTIAL_FILE` | `.opencode/.ingenium-runtime-credential` | MCP server child-runtime handoff | Optional owner-only dedicated `runtime` audience credential. It is used only for the private child environment handoff and must match the parent project/workspace/worktree binding. |
| `INGENIUM_RUNTIME_CREDENTIAL` | _(none)_ | MCP server | Optional in-memory runtime credential used by tests/internal launchers; production isolated runtimes use the protected capability file instead. |
| `INGENIUM_RUNTIME_ID` | _(runtime-injected)_ | isolated runtime launchers | Immutable runtime UUID. |
| `INGENIUM_RUNTIME_OWNER_ID` | _(runtime-injected)_ | isolated runtime launchers | Immutable user UUID that owns the runtime. |
| `INGENIUM_RUNTIME_BIND_HOST` | `127.0.0.1`; `0.0.0.0` inside an isolated runtime | ttyd and code-server launchers | Private listener bind selected by the trusted runtime entrypoint. Runtime ports remain un-published. |
| `INGENIUM_INTERNAL_SERVICE` | _(none)_ | internal MCP/server launchers | Explicit internal-service compatibility marker permitting the installation bearer. Never set for external user runtimes. |

## Extension (`packages/ingenium-extension`)

| Variable | Default | Used By | Description |
|----------|---------|---------|-------------|
| `OBSERVER_CHECK_INTERVAL` | `0` | `observer.ts` | Session idle check interval; `0` disables observer checks. |

## API (`services/ingenium-api`)

| Variable | Default | Used By | Description |
|----------|---------|---------|-------------|
| `INGENIUM_API_PORT` | `4096` in Docker (`4097` standalone) | `config/index.ts` | Private Express API listen port in the container; public host bearer boundary remains `127.0.0.1:4097`. |
| `INGENIUM_API_RATE_LIMIT` | `100` | `lib/middleware/rate-limit.ts` | Max requests per minute per IP |
| `INGENIUM_API_TOKEN` | _(required; no default)_ | entrypoint, API boundary, API, dashboard server proxy | Internal installation bearer only. It must not appear in user runtimes or external extension config. |
| `INGENIUM_API_TOKEN_FILE` | _(optional bootstrap; runtime default `/run/ingenium-secrets/api-token` in container)_ | entrypoint, API boundary, API, dashboard, health probe, internal services | Protected installation-token file. External MCP uses `INGENIUM_MCP_CREDENTIAL_FILE`. |
| `DASHBOARD_ALLOWED_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000` | dashboard `proxy.ts`, API `config/index.ts`, supervised launchers | Comma-separated **exact** HTTP(S) dashboard origins accepted by both dashboard-proxy CSRF and API CORS/CSRF. Entries cannot include paths, credentials, query/fragment, whitespace, or wildcards. |
| `CORS_ORIGIN` | _(legacy single-origin fallback only)_ | `config/index.ts` | Backward-compatible non-container fallback when `DASHBOARD_ALLOWED_ORIGINS` is unset. New deployments must configure the explicit allowlist. |
| `INGENIUM_AUTH_ENCRYPTION_KEY_FILE` | `/app/.ingenium/auth-encryption-key` in Docker | `scripts/docker-entrypoint.sh`, `scripts/run-api.sh`, `packages/ingenium-core/lib/tools/authentication.ts` | Persistent appuser-owned mode-`0600` regular file containing exactly one base64url-encoded 256-bit key. The entrypoint atomically provisions and validates it, and the clean API environment receives only its path. Used for authentication factors and transient OIDC PKCE encryption; independent of vault seal state. |
| `SYNTHESIS_INTERVAL_MS` | `900000` | `scheduler.ts` | Scheduled synthesis + extraction interval (15 min), 0 = disabled |
| `USAGE_SYNC_INTERVAL_MS` | `300000` | `scheduler.ts` | Scheduled metadata-only OpenCode usage sync interval (5 min), 0 = disabled. Explicit source-project mappings control project ownership; this never falls back to `global-default`. |
| `SYNTHESIS_MODEL` | _(none)_ | `synthesis-llm.ts` | Fallback synthesis model name (used when no provider config is saved in DB) |
| `SYNTHESIS_API_KEY` | _(none)_ | `synthesis-llm.ts` | Fallback synthesis API key (used when no provider config is saved in DB) |
| `SYNTHESIS_ENDPOINT` | _(none)_ | `synthesis-llm.ts` | Fallback synthesis endpoint URL (used when no provider config is saved in DB) |
| `SYNTHESIS_ALLOW_PRIVATE_NETWORK` | `false` | `synthesis-llm.ts` | When `true`, bypasses SSRF protection for the synthesis endpoint. Required for local inference servers (Ollama, LM Studio, vLLM). |
| `INGENIUM_OPENCODE_DB_PATH` | `/var/opencode/opencode.db` | extraction engine | OpenCode SQLite DB path for server-side extraction |
| `INGENIUM_DEPLOYMENT_MODE` | `compatibility` | API runtime mode, entrypoint, restore executor | `compatibility`, `control-plane`, or internal `user-runtime`. Control-plane restore refuses to run while any runtime is non-terminal. |
| `INGENIUM_RUNTIME_MANAGER_URL` | _(required in control-plane mode)_ | `runtime-manager-client.ts` | Private HTTP origin for the runtime manager; credentials and paths in the URL are rejected. |
| `INGENIUM_RUNTIME_MANAGER_TOKEN_FILE` | _(required in control-plane mode)_ | control plane, runtime manager, manager health check | Canonical owner-only regular file containing the private manager bearer. The same protected file is mounted read-only into both services. |
| `INGENIUM_RUNTIME_RECONCILE_INTERVAL_MS` | `15000` | `runtime-reconciler.ts` | Runtime health, lease, idle, and orphan reconciliation interval; minimum 1000 ms. |
| `INGENIUM_RUNTIME_MAX_ACTIVE_PER_USER` | `2` | runtime routes | Maximum active runtime instances per owner. |
| `INGENIUM_RUNTIME_CPU_MILLIS` | `1000` | runtime routes | Default per-runtime CPU quota in millicores. |
| `INGENIUM_RUNTIME_MEMORY_BYTES` | `1073741824` | runtime routes | Default per-runtime memory limit. |
| `INGENIUM_RUNTIME_PIDS_LIMIT` | `256` | runtime routes | Default per-runtime PID limit. |
| `INGENIUM_RUNTIME_DISK_BYTES` | `2147483648` | runtime routes | Default size of the private HOME tmpfs. |
| `INGENIUM_RUNTIME_PROCESS_LIMIT` | `128` | runtime routes | Default per-runtime aggregate process/PID ceiling. The manager applies the lower of this value and `INGENIUM_RUNTIME_PIDS_LIMIT` as Docker's cgroup PID limit. |
| `INGENIUM_RUNTIME_IDLE_LEASE_MS` | `1800000` | runtime routes | Idle runtime lease duration. |
| `INGENIUM_RUNTIME_ABSOLUTE_LEASE_MS` | `28800000` | runtime routes | Absolute runtime lifetime and capability expiry. |
| `INGENIUM_RUNTIME_ROOT_DOMAIN` | _(required in production)_ | control plane, runtime gateway, dashboard build | DNS suffix covered by the operator wildcard certificate. Runtime roots are exactly `web--<runtime-id>`, `cli--<runtime-id>`, and `vscode--<runtime-id>` below this suffix. |
| `NEXT_PUBLIC_RUNTIME_ROOT_DOMAIN` | _(set from `INGENIUM_RUNTIME_ROOT_DOMAIN` at build)_ | dashboard CSP | Public DNS suffix used only for the runtime wildcard frame/connect CSP sources; it contains no credential. |
| `INGENIUM_RUNTIME_GATEWAY_TOKEN_FILE` | _(required in production)_ | control plane, runtime gateway | Owner-only file containing the gateway's narrow API exchange/validation bearer, distinct from manager and installation credentials. |
| `INGENIUM_RUNTIME_GATEWAY_PORT` | `8443` | runtime gateway | Unprivileged HTTPS listener mapped to host port 443 by the production profile. |
| `INGENIUM_RUNTIME_TLS_CERT_FILE` | _(required in production)_ | runtime gateway | Read-only wildcard certificate chain for `*.<INGENIUM_RUNTIME_ROOT_DOMAIN>`. |
| `INGENIUM_RUNTIME_TLS_KEY_FILE` | _(required in production)_ | runtime gateway | Read-only wildcard private key; never mounted into the manager, control plane, dashboard, or user runtime. |

## MCP Server (`services/ingenium-server`)

| Variable | Default | Used By | Description |
|----------|---------|---------|-------------|
| `INGENIUM_API_URL` | `http://localhost:4097/api/v1` | `config/index.ts`, `lib/client.ts` | URL of the API server to call |
| `INGENIUM_API_TIMEOUT` | `10000` | `config/index.ts` | HTTP request timeout in milliseconds |

## Dashboard (`services/ingenium-dashboard`)

| Variable | Default | Used By | Description |
|----------|---------|---------|-------------|
| `NEXT_PUBLIC_API_URL` | `/api/v1` | `src/lib/api.ts` | Same-origin dashboard API prefix. The browser does not receive `INGENIUM_API_TOKEN`; the dashboard server injects it while proxying requests. |
| `DASHBOARD_ALLOWED_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000` | `src/proxy.ts`, `scripts/run-dashboard.sh` | Server-only copy of the exact dashboard origin allowlist. Production gateway mutations must reconstruct one of these origins from Nginx-overwritten `X-Forwarded-Proto`, `X-Forwarded-Host`, and `X-Forwarded-Port`; isolated direct fixtures may use their exact browser origin only when forwarding metadata is absent (or is the recognized Next direct-listener default) and that origin is explicitly allowlisted. |

## Email (`packages/ingenium-email`)

| Variable | Default | Used By | Description |
|----------|---------|---------|-------------|
| `GOOGLE_OAUTH_CLIENT_ID` | _(required for OAuth)_ | `oauth.ts` | Google OAuth2 app client ID |
| `GOOGLE_OAUTH_CLIENT_SECRET` | _(required for OAuth)_ | `oauth.ts` | Google OAuth2 app client secret |
| `MS_OAUTH_CLIENT_ID` | _(required for OAuth)_ | `oauth.ts` | Microsoft OAuth2 app client ID |
| `MS_OAUTH_CLIENT_SECRET` | _(required for OAuth)_ | `oauth.ts` | Microsoft OAuth2 app client secret |
| `INGENIUM_EMAIL_ENCRYPTION_KEY` | _(required)_ | `oauth.ts`, `accounts.ts` | **64 hex characters** (32 bytes) or a **64-character base64url secret** deterministically reduced to an AES-256 key for credential encryption |
| `OAUTH_REDIRECT_URI` | `http://localhost:3000/mail/oauth/callback` | `oauth.ts` | OAuth2 callback URL for Gmail/Outlook |

## Docker / opencode-web

| Variable | Default | Used By | Description |
|----------|---------|---------|-------------|
| `OPENCODE_SERVER_PASSWORD` | _(none, required)_ | `scripts/docker-entrypoint.sh`, `ingenium-api` (OpenCode proxy routes) | **Required.** Server-side API proxy guard credential. The browser-facing OpenCode Web child overrides it to empty and is restricted to host loopback. |
| `NEXT_PUBLIC_OPENCODE_WEB_URL` | `http://opencode.localhost:3000/` at build time | Docker Compose build args, Next.js dashboard | Legacy credential-free CSP allowlist input retained for build compatibility; it does not select the iframe target. Compatibility uses the fixed alias and production uses an API-issued runtime root. |
| `NEXT_PUBLIC_OPENCODE_CLI_URL` | `http://cli.localhost:3000/` at build time | Docker Compose build args, Next.js dashboard | Legacy credential-free CSP allowlist input retained for build compatibility; it does not select the iframe target. Compatibility uses the fixed alias and production uses an API-issued runtime root. |
| `IMAGE_REVISION` | _(required; `git rev-parse HEAD`)_ | Docker Compose build arg, Docker OCI label | Lowercase 40-character SHA for the checkout being built. Compose cannot derive it, so export it before every Compose command. It is public provenance metadata, never a credential. |
| `IMAGE_SOURCE` | `https://github.com/jtmb/ingenium` | Docker Compose build arg, Docker OCI label | Public credential-free HTTPS repository URL recorded as OCI source metadata. |
| `OPENCODE_SERVER_URL` | `http://localhost:4098` | `ingenium-api` (opencode client) | Base URL of the OpenCode web server |
| `INGENIUM_RUNTIME_MANAGER_PORT` | `4110` | private runtime manager | Manager listen port on the internal control network; it is never published to the host. |
| `INGENIUM_RUNTIME_WORKSPACE_MAP_FILE` | `/etc/ingenium/runtime-workspaces.json` | private runtime manager | Root-controlled version-1 JSON map of workspace IDs to exact host and validation paths. |
| `INGENIUM_RUNTIME_API_URL` | manager: `http://ingenium-control-plane:4096/api/v1`; gateway: `http://ingenium-control-plane:4097/api/v1/` | private runtime manager and runtime gateway | User-runtime capability traffic uses private Express after strict hostname/path validation. Gateway-private exchange/validation uses the authenticated API boundary so it can overwrite the private-network marker. |
| `INGENIUM_USER_RUNTIME_IMAGE` | `ingenium-user-runtime:$IMAGE_REVISION` in Compose | private runtime manager | Exact image reference used for isolated runtime containers. |
| `INGENIUM_RUNTIME_NETWORK_PREFIX` | `ingenium-runtime-` | private runtime manager | Prefix for one identity-labeled Docker network per runtime. |
| `INGENIUM_RUNTIME_GATEWAY_CONTAINER` | `ingenium-runtime-gateway` in Compose | private runtime manager | Exact identity-labeled unprivileged gateway attached to each runtime network; it has no Docker socket. |
| `INGENIUM_CONTROL_PLANE_CONTAINER` | `ingenium-control-plane` | private runtime manager | Exact identity-labeled control-plane container attached to each dedicated runtime network. |
| `DOCKER_GID` | `999` | production Compose runtime manager | Host Docker-socket group ID added only to the unprivileged runtime-manager container; set it to the socket's actual group ID when different. |

> Multer file uploads for `/api/v1/opencode/upload` are stored at `/tmp/ingenium-chat-uploads/`.

## Test suites

| Variable | Default | Used By | Description |
|----------|---------|---------|-------------|
| `INGENIUM_E2E_PROJECT` | _(none)_ | `tests/ingenium-dashboard/docker-active-project.ts` | Optional external Docker-suite project. It must be an existing active project returned by the deployment's same-origin project-list preflight. When unset, the Docker suite requires exactly one active global project. The suite never creates or deletes a project. |
| `INGENIUM_E2E_API_URL` | _(none)_ | explicit external Playwright suites | Optional external API root used by suites that do not own an integrated fixture. |
| `INGENIUM_API_TEST_MODE` | _(unset)_ | isolated API/dashboard fixture | Enables test-only server contracts in manifest-owned fixture processes. Never set in a deployed application. |
| `INGENIUM_TEST_RUN_NONCE` | _(generated per fixture run)_ | isolated API/dashboard fixture | UUID nonce binding the test-only browser-session exchange to its manifest-owned run. |

## Backups

| Variable | Default | Used By | Description |
|----------|---------|---------|-------------|
| `INGENIUM_BACKUPS_DIR` | `/app/.ingenium/backups` | `backups.ts`, `backup-scheduler.ts`, `routes/backups.ts`, `scripts/run-api.sh` | Directory for backup snapshot files (Ingenium + OpenCode DB pairs). Empty or whitespace-only values are treated as unset. |
| `INGENIUM_BACKUP_SIGNING_KEY_FILE` | `/app/.ingenium/backup-signing-key` | `docker-entrypoint.sh`, `run-api.sh`, `tools/backups.ts` | Owner-only (`appuser`, mode `0600`) HMAC-SHA256 key for signed v2 backup manifests. The entrypoint creates at least 32 random bytes once, refuses symlinks, and requires the direct file to remain outside `INGENIUM_BACKUPS_DIR`. The key is never returned, logged, or stored in backup bundles. |
| `INGENIUM_RESTORE_STAGING_DIR` | `/app/.ingenium/restore-staging` | `docker-entrypoint.sh`, `run-api.sh`, `tools/backups.ts` | Separate owner-only (`0700`) root for plan-ID-addressed, tamper-evident restore copies and unlinked download snapshots. It must not be inside or equal to the backup source directory. |
| `INGENIUM_BACKUP_DOWNLOAD_MAX_BYTES` | `268435456` | `tools/backups.ts` | Maximum verified component size buffered for an API download. Invalid or oversized components are rejected before allocation. |
| `INGENIUM_RESTORE_HANDOFF_MAX_BYTES` | `268435456` | `tools/backups.ts` | Maximum combined verified stage size returned by the in-process executor handoff. Oversize stages fail closed before buffer allocation. |
| `INGENIUM_RESTORE_JOURNAL_KEY_FILE` | `/app/.ingenium/restore-journal-key` | `docker-entrypoint.sh`, `restore-maintenance.ts` | Fixed root-owned mode-`0600` HMAC key for RESTORE-101 journals. It is distinct from the appuser-readable backup-manifest signing key, outside backups, never returned or logged, and cannot be overridden by API/MCP or the static launcher. |
| `INGENIUM_RESTORE_MAINTENANCE_DIR` | _(rejected at runtime)_ | `docker-entrypoint.sh`, `restore-maintenance.ts` | Historical override name. Production uses only `/app/.ingenium/restore-maintenance`, a root:root mode-`0700` root-only journal, lock, buffer, and archive directory. Any override is rejected. |
| `INGENIUM_RESTORE_MAINTENANCE_MODE` | _(set only by fixed launchers)_ | `restore-maintenance.ts` | Internal fixed launcher mode: `recover` before supervisord starts or `execute` for the static maintenance program. It is not a user-configurable restore option. |
| `INGENIUM_TRUSTED_ARTIFACT_UID` | _(image-owned appuser UID)_ | `docker-entrypoint.sh`, fixed API/root restore launchers, `tools/backups.ts` | Internal artifact-publisher owner UID read from the root-owned immutable image source. Bundle, staging, and signing-key validation never infer it from the validating process UID. |
| `INGENIUM_TRUSTED_ARTIFACT_GID` | _(image-owned appuser GID)_ | `docker-entrypoint.sh`, fixed API/root restore launchers, `tools/backups.ts` | Internal artifact-publisher group ID paired with `INGENIUM_TRUSTED_ARTIFACT_UID`; root safety snapshots descriptor-set every published bundle artifact to this UID/GID policy before publication. |
| `INGENIUM_RESTORE_TEST_ROOT` | _(test-only)_ | `restore-maintenance.ts`, disposable RESTORE-101 fixture | Enables fixed paths beneath one `/tmp/ingenium-restore-fixture-*` root only while `NODE_ENV=test`. It is rejected in production and never reaches the root Supervisor launcher. |

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
