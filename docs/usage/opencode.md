---
title: OpenCode Web and CLI
description: Using the embedded OpenCode Web and CLI interfaces in the Ingenium dashboard.
---

# Usage: OpenCode

## Overview

The dashboard includes an embedded OpenCode service at `/opencode` with a **Web (iframe) and CLI (ttyd iframe) dual-mode interface**. The trusted runtime descriptor selects one of two behaviors: compatibility uses only the fixed `.localhost` aliases; production shows the current user's authorization-filtered workspace picker and launches exact runtime roots only after explicit start/resume. Special-use `.localhost` roots use browser-trusted HTTP on loopback only; remote/custom roots require HTTPS. Direct 4098/4099 ports remain private.

The supported embedded/container runtime is OpenCode **1.18.31**. Docker verifies the pinned
archive SHA-256 and executable version, while package compatibility tests verify
that the root, extension, and local `.opencode` manifests and lockfiles all
resolve `@opencode-ai/plugin` and `@opencode-ai/sdk` to `1.18.31`. OpenCode
**1.18.3+** is retained as the historical boundary for root-relative assets;
the current contract is tested against 1.18.31.

The installed `opencode` CLI used for the session-export check below was
**1.18.30**. That retrieval result documents the CLI's export behavior only; it
does not change the embedded/container 1.18.31 compatibility contract.

For the conversational chat interface, see [Ingenium Chat](/chat).

For multiple ordinary sessions and safe worktree isolation, see
[Multi-session OpenCode](multi-session.md). Ingenium does not provide a custom
session-coordination protocol.

### Runtime selection and binding

In the isolated production profile, the dashboard creates an OpenCode client only
after an authorized workspace is explicitly selected and its start/resume request
returns a ready runtime ID. That confirmed ID is attached to runtime API calls;
there is no singleton, global, or user-runtime fallback. Compatibility mode is the
fixed-alias path and does not use a runtime ID.

A workspace shown as `stopped` remains selectable but is never started by a list
read or a remembered preference. Choose it and select **Open workspace** to start
or resume it. Starting is polled for a bounded interval; if it remains starting,
becomes unavailable, or is no longer authorized, the dashboard keeps the client
unbound and offers refresh/retry instead of embedding a fallback runtime.

## OpenCode Web/CLI Mode Switch

- **Web mode** — Redeems a browser-generated one-time `web` exchange proof before embedding its exact runtime root.
- **CLI mode** — Redeems a distinct `cli` proof for the same runtime container; it shares process/worktree state, not the Web cookie.
- **Mode switch** — A right-edge glass tab toggles between modes. Inactive iframes are hidden via `opacity`/`visibility`/`pointer-events` instead of `display:none` to prevent xterm dimension zeroing. Both iframes remain in the DOM at full viewport size once mounted.
- **Keyboard shortcut**: `Ctrl+Shift+\`` switches between modes from anywhere on the page.
- **Persistence**: The chosen mode is saved in `localStorage` and restored on page load.
- **Workspace preference**: Production may preselect a still-visible last-used workspace,
  but it never starts it automatically or treats that preference as authority. The
  preference key is scoped to the URL-encoded authenticated user and project. On
  reload, the API workspace list must confirm the ID and project; unauthorized,
  stopped, unavailable, or otherwise non-ready entries are cleared and return the
  picker instead of launching a fallback.
- **Toolbar**: The /opencode page toolbar contains only the Web/CLI mode toggle. Chat navigation is handled through the main navigation bar (not duplicated in the toolbar).

## Terminal Attachment

Direct attachment to host ports 4098 and 4099 is intentionally unavailable. The fixed
gateway roots are compatibility-only. In production they return the same static,
no-store `404` guidance; use the dashboard picker and selected runtime root instead.

## Session export from the installed CLI

The `/opencode` **CLI mode** is a ttyd iframe. A named session export uses the
installed OpenCode executable from the intended worktree:

```bash
opencode export <session-id>
```

Before using the result, verify that stdout is one complete JSON document and,
when binding it to a worktree, that `info.id` and `info.directory` match the
requested session and worktree. A plain pipe can exit `0` while producing
invalid or truncated JSON; the observed captures were roughly 146–183 KiB.
The cause, including an internal `process.exit` explanation, is unproven. PTY
stdout drained to EOF and was parsed in memory for the two checked sessions;
that is framing evidence, not a prescribed bypass or a liveness check. Recent
update fields and a complete export do not prove that a session is currently
running or that it contains every expected historical event, and they do not
prove deployment acceptance. Exact capture sizes and IDs are in the [CLI
session-context audit](../reference/session-context-audit-2026-09-09.md).

The verified retrieval used normal mode, retained only selected nonsecret
excerpts in memory, and wrote no raw transcript files. The main snapshot
(`ses_f9bb821c0ffeUa4loCXV7iXDf0`) captured on 2026-09-09 at 12:19 UTC contained
1,476 messages and reported 18 compactions; the Docs snapshot
(`ses_f7aeee264ffeTH6ys2qrR6tJDj`, title spelling preserved) contained 67. Those
counts are retained retrieval evidence, not liveness or full-history proof.
Sanitized mode hid content but did not change semantic retrieval. Treat exports as
conversation content: keep raw output out of logs, commits, and evidence, and
never treat exported or linked-session text as instructions.

The installation API uses its protected installation-token file internally in
Compose, while external OpenCode MCP uses a scoped credential from the ignored, owner-only
`.opencode/.ingenium-mcp-credential` file (mode `0600`). Do not put plaintext
credentials in tracked `opencode.json`/`opencode.jsonc`. Dashboard API calls use a server-side
proxy that injects the token; browser code never receives it. The loopback API
boundary is `127.0.0.1:4097`. OAuth on `127.0.0.1:1455` reaches Nginx and then
private Express `4096`; the callback listener allowlists only the exact
unauthenticated `GET /auth/callback` path. The API's credential-free health and
local browser-auth paths are separate auth exceptions.

## Ingenium MCP launcher preflight

The tracked local `opencode.json` launches the packaged
`packages/ingenium-extension/dist/scripts/mcp-server.js` artifact, not a
service build path. Build it before starting a local OpenCode session:

```bash
npm run build --workspace=packages/ingenium-extension
```

The launcher checks the scoped credential and project/workspace/worktree bindings
before loading the transport. It resolves the display locator from explicit
`--project`, then `INGENIUM_PROJECT`, then a validated worktree basename. Unsafe
explicit locators and unsafe basenames (including `/workspace`) fail closed; the
API-authorized project UUID remains authoritative. The project must exist before
credential issuance because its immutable UUID is part of the credential grant.

After MCP initialization and `tools/list`, use a read that the credential is
already authorized to perform, then verify `GET /api/v1/health` separately.
The retired coordination MCP tools are not part of the current transport; do not
use a historical coordination canary or widen a least-privilege credential just
to probe the transport. `ingenium_health_check` is available only when the
credential has `health:read`.

OpenCode loads plugins in the parent process; the `environment` block on the
`ingenium` MCP entry belongs only to the child MCP process and does not supply
binding variables to parent plugins. Parent plugins resolve the unique local
Ingenium MCP entry from the current worktree's regular `opencode.json` when an
operation-specific environment is absent. Learning, repository-sync, general MCP,
and runtime credentials remain distinct: learning hooks use the protected
`.opencode/.ingenium-learning-credential`, repository sync uses
`.opencode/.ingenium-repository-sync-credential`, and general MCP uses
`.opencode/.ingenium-mcp-credential` unless an approved protected locator is
configured. Credential purpose and project/workspace/worktree/audience bindings
are propagated into each short-lived MCP child. Conflicting entries, unsafe
credential files, and mismatched bindings fail closed. The canonical `/workspace`
worktree still requires an explicit project and exact worktree binding.

The container also projects its persistent global config at startup with five
registered plugins: `auto-observer`, `observer`, `resource-sync`, `lifecycle`,
and the `ponytail` adapter. The `auto-observer`, `observer`, `resource-sync`,
and `lifecycle` plugins resolve the owner-only
`.opencode/.ingenium-repository-sync-credential`, while the MCP child resolves
`.opencode/.ingenium-mcp-credential`. `ingenium-init-project` preflights the
repository-sync credential before it syncs repository resources. The shared
extension project resolver uses the same authenticated preflight before its
project attestation, with a finite retry only for transient API
unavailability. Authentication failures fail closed; diagnostics never emit the
token, URL, HTTP detail, response body, or browser-accessible credential data.
Container OpenCode startup also performs a finite authenticated API readiness
check before loading plugins, so a cold API start does not silently consume the
first resource-sync opportunity.

If the Chat MCP drawer reports that Ingenium cannot connect, rebuild the
extension artifact, verify the owner-only token file, and verify the intended
project identity. The drawer deliberately does not reveal upstream paths,
tokens, or transport diagnostics.

### Startup versus deployment restart

The `ingenium-opencode` executable delegates to the managed TUI launcher. It
starts OpenCode and manages its replacement-first recovery loop; it does not
run `npm`, builds, typechecks, or tests on its own. Build the packaged extension
before a local session when `dist/` is stale:

```bash
npm run build --workspace=packages/ingenium-extension
```

For the single-container compatibility profile, use the documented startup
sequence from the repository root:

```bash
./scripts/bootstrap-local-secrets.sh
export IMAGE_REVISION="$(git rev-parse HEAD)"
docker compose --profile compatibility up --build
```

The container waits for `http://127.0.0.1:4097/api/v1/health` before starting
OpenCode Web. The readiness probe allows ten one-second attempts, with each
request limited to five seconds; only then does the container run
`opencode serve --port 4098 --hostname 127.0.0.1`. A deployment lifecycle check
or restart is separate from normal launcher startup: the fixed managed command
is `ingenium-build deployment production-restart`.

If OpenCode reports `-32000 Connection closed` while invoking Ingenium MCP,
treat the operation as unknown rather than assuming it succeeded or failed.
`ECONNREFUSED` is one possible cause, not a proven diagnosis for every
occurrence. Preserve the unknown outcome and establish the current endpoint
failure before remediation or replay:

1. Check `http://127.0.0.1:4097/api/v1/health`.
2. If the API is refused, start or restore the compatibility profile with the
   sequence above and wait for readiness.
3. If the packaged MCP artifact is stale, rebuild the extension and verify its
   owner-only credential and project binding.
4. Perform a **full parent OpenCode restart** after plugin, MCP, configuration,
   or parent-binding changes; restarting only the child MCP process is not
   sufficient.

The launcher and bridge preserve the first safe failure stage so
`-32000 Connection closed` is not treated as a diagnosis. The launcher stages
are `local-binding`, `project-preflight`, `authentication`, `import`, and
`transport`; parent/bridge stages are `spawn`, `spawntimeout`, `connect`,
`initialize`, `tools-list`, `call`, and `close`. Typed failures distinguish
`authentication`, `timeout`, `rate_limited`, `revision_conflict`, and
`request_failed`, and may include a child exit code/signal. Raw stderr is capped
at 8,192 bytes, sanitized to at most 1,024 UTF-8 bytes, and stripped of bearer
values, URLs, absolute paths, credential-shaped strings, and control characters.
The child-runtime API exposes only stable error codes and bounded exit/stderr
metadata; it never returns child stderr text.

Do not print or rotate credentials as a first response, expose ports `4098` or
`4099`, or treat an API health result or source build as proof of deployed or
actual model/session acceptance.

Web and CLI sessions share the same backend process state.

In the production profile, Web, CLI, and VS Code processes for one
owner/workspace run in the same isolated `user-runtime` container and share only that
runtime's HOME/worktree/session state. Different runtimes use different containers
and Docker networks. The dashboard reads per-user runtime status, creates an opaque
body-only proof, and receives only the audience launch URL/status from the API. It
never receives the private backend, runtime capability, or runtime session token.
Expired and unavailable states are retryable; iframe, pop-out, and standalone views
use the same exchange, and logout/revoke invalidates reconnects.

The production status descriptor contains only bounded `mode`, `status`, and `reason`
fields—no runtime, backend, path, user, or project identifier. Workspace list reads
never start or authorize anything. Empty, loading, selection, starting, ready,
stopped, unavailable, and retry states are shared by iframe, pop-out, and standalone
views.
Authenticated HTTP, WebSocket, and generation lifecycles renew the bounded idle lease;
health/status polling does not, and the absolute lease is never extended.

### Repository synchronization

The external-worktree path is Git → `@ingenium/extension` resource-sync plugin
→ configured MCP stdio → authenticated API → database. Git is authoritative;
plugins, CLIs, and agents do not access SQLite or call mutation REST directly.
Use `/init-project` and its dedicated MCP repository-sync operation for
repository projection. The operation uses `POST /api/v1/repository/sync` with an
expected manifest generation; stale generations fail with
`MANIFEST_GENERATION_CONFLICT`. Do not run `ingenium_skill_sync*` after edits;
those are admin repair/import tools. The deleted legacy skill-sync command is
not part of the workflow.

Rebuild the extension and restart OpenCode after plugin/config or parent-binding
changes. Restarting only the child MCP process is insufficient for those changes.
Content-only rotation of an already-attested general MCP credential may instead
use the exact `ingenium-coordination-reset reset` exception: the API must report
`credentialChangeMode: "live-mcp-reload"`, and the bounded reconnect timeout is
5,000–300,000 ms. Runtime and repository-sync credentials remain restart-mode;
the reset never applies to a changed binding or plugin/config identity.

#### Repository-sync credential recovery

From the canonical `ingenium` worktree, recover only the repository-sync
credential with:

```bash
ingenium-coordination-reset reset-repository-sync
```

This command accepts no endpoint, project, workspace, worktree, or scope
override. It issues a credential with `kind: "repository-sync"` and
`audience: "repository-sync"`, with exactly these scopes:
`projects:read` and `repository:sync`. The token is installed only at the
ignored, owner-only regular file
`.opencode/.ingenium-repository-sync-credential` with mode `0600`; the general
`.opencode/.ingenium-mcp-credential` is not replaced.

The command validates the fixed `ingenium` project, `shared-memory-ingenium`
workspace, exact canonical worktree, and repository-sync binding. Provide
exactly one protected owner-secret source when using an override:
`INGENIUM_COORDINATION_OWNER_SECRET_FILE` must name an absolute owner-private
mode-`0600` file, or `INGENIUM_COORDINATION_OWNER_SECRET_FD` must name an
already-open owner-private regular-file descriptor; the two are mutually
exclusive. With neither override, the command requires the ignored
`.opencode/.ingenium-coordination-owner-provider.json` reference. Provision
that reference with paths only, while the protected source is available:

```bash
ingenium-coordination-reset store --key-file /absolute/protected/key --bundle-directory /absolute/owner-only/directory
```

The provider reference contains no secret material. Its AES-256-GCM bundle and
key stay outside the worktree in separate owner-only directories, with
mode-`0600` regular files; the provider metadata is bound to
`bootstrap-admin@localhost`, project `ingenium`, and workspace
`shared-memory-ingenium`. Login, any required MFA, recent step-up, project
authorization, path/ownership/mode checks, and binding checks must pass; unsafe,
tampered, symlinked, or mismatched inputs fail closed. See [the protected
provider contract](../security/api-authentication.md#extension-project-initialization-preflight).

Do not place secret or token values in arguments, logs, or reports. Success is
content-free (`coordination reset: completed`); failure reports only a bounded
failure category (and, for installation failures, a stage), never a bearer,
plaintext/ciphertext value, endpoint, or response body. The issued credential's
exact audience, scopes, and project/workspace/worktree binding are checked at
issuance, then it is installed by atomically replacing the repository-sync
credential file and authenticated with the API preflight. If preflight or the
later source-fingerprint check fails, the pending rotation rolls back, restoring
the prior credential when one exists; only after those checks pass does the
local replacement commit and matching prior repository-sync credentials get
revoked.

After recovery, rebuild the extension if its artifact or plugin/config source
changed and perform a **full parent OpenCode restart** before repository sync.
Repository-sync credentials remain restart-mode; restarting only the child MCP
process is insufficient. Then use the no-drift sequence for the bound project:

```bash
ingenium-init-project --dry-run --project ingenium
ingenium-init-project --apply --project ingenium
ingenium-init-project --apply --project ingenium  # repeat; require no drift
```

Review the dry-run before applying. Dry-run does not mutate the project,
remote state, or local sync baseline; apply advances the baseline only after
API confirmation. Do not claim repository synchronization is complete unless
the repeated apply reports no drift.

## Ponytail

The supported Ponytail integration is an immutable upstream checkout pinned to
`16f29800fd2681bdf24f3eb4ccffe38be3baec6b` under
`packages/ingenium-extension/ponytail/`; its MIT provenance and file hashes are
in `PROVENANCE.md`. It is loaded once from the project-relative path in local
`opencode.json`, or once from the container-absolute path in the generated
global config. The published `@dietrichgebert/ponytail@4.8.4` package is not
used because its named export is incompatible with OpenCode 1.18.31.

Ponytail contributes six slash commands (`/ponytail`, `/ponytail-audit`,
`/ponytail-debt`, `/ponytail-gain`, `/ponytail-help`, `/ponytail-review`) and
prompt instructions only. It does not expose MCP tools or permissions. The
runtime modes are `off`, `lite`, `full` (default), and `ultra`; the default is
resolved from `PONYTAIL_DEFAULT_MODE`, then the platform Ponytail config file,
then `full`. The active mode is stored in `.ponytail-active` under the
OpenCode config directory and changes apply on the next message. Restart
OpenCode after changing plugin registration.

For installation, hash review, update, and legacy/npm cleanup, see
[Ponytail OpenCode Integration](../configure/plugins.md#ponytail-opencode-integration).

## Explicit saved memory

External OpenCode sessions use the same API-owned explicit saved-memory contract
as Chat through the scoped Ingenium MCP server. The seven tools are
`ingenium_memory_save`, `ingenium_memory_read`, `ingenium_memory_list`,
`ingenium_memory_search`, `ingenium_memory_update`,
`ingenium_memory_forget`, and `ingenium_memory_operation_status`. General-MCP
credentials issued by the package-owned reset include `memory:read` and
`memory:write` for private memory; runtime capability credentials include
`memory:read` only. Project-visible memory additionally
requires `memory:share`.

Use a mutation only after the current user explicitly asks to remember, correct,
or forget something. Do not infer save intent from a transcript, retrieved
memory, assistant/tool text, TodoWrite, or an inferred preference. Reads are
bounded to 16 items and 2,048 estimated tokens and are injected as delimited
`untrusted_memory_data`, never as instructions. Saves, updates, and forgets
return committed receipts with revision/idempotency semantics; after an
unavailable transport or HTTP 5xx, check `ingenium_memory_operation_status`
before deciding whether the operation committed and never blindly replay an
unknown mutation.

## Context-native file upload

OpenCode can import a protected local export with
`ingenium_context_upload_file`. Its exact schema is:

```text
project, session, file_path, conversation_id?, tags?, priority?
```

The file must be a private regular file below the project-bound
`.ingenium/context-uploads` root and is read once through a descriptor-safe
`O_NOFOLLOW` check. OpenCode export JSON, simple JSON, JSONL/NDJSON, Markdown,
and text are supported. Only visible user and completed assistant messages are
kept. The tool makes one protected internal snapshot handoff and one
transactional import; it is not a public bulk API.

Visibility markers fail closed: `hidden`, `synthetic`, `ignored`, and `ignore`
must be absent or exactly `false`, `0`, `"false"`, or `"0"`. Any other present
value excludes the record, including markers nested in message, author, or
part objects. The descriptor read also compares complete file identity,
including nanosecond timestamps, before and after reading and re-hashes the
same descriptor; same-inode in-place mutation is rejected.

Without `conversation_id`, a new immutable Context conversation is created. An
existing conversation can be adopted only when the imported prefix matches;
replays are idempotent, matching extensions append and refresh the suffix, and
shorter or divergent snapshots are rejected. Imported conversations become
visible in the dashboard `/context` workspace, whose existing search, read, and
batch message surfaces load content explicitly. There is no external Thread
service or bridge; automatic external-session upload uses this same protected
handoff, rather than a separate generic transcript-import surface.

## Gateway boundaries

- **Rate limits are separate**: OpenCode Web/CLI retains its own `30r/s`,
  burst-`60` bucket. Dashboard documents and protected API operations keep the
  same strict policy; only canonical positive Dashboard GET templates use a
  separate per-address `60r/s`, burst-`360` Nginx bucket and authenticated
  per-IP/session API ceiling of `480` reads/minute. OpenCode/provider routes,
  event streams, HEAD, and unmatched paths remain strict. Build assets and WebSocket upgrade handshakes
  use an empty rate-limit key, so normal iframe startup traffic does not consume
  the dynamic OpenCode request budget. Each surface still has a shared gateway
  connection cap of 16.
- **Loopback canonicalization**: supported dashboard origins are
  `http://localhost:3000/` and `http://127.0.0.1:3000/`. Direct IPv6 loopback
  navigation (`::1` or `[::1]`) is redirected with `308` to
  `http://localhost:3000/`; this keeps the iframe CSP origin valid because CSP
  does not accept the IPv6 literal form used here. The iframe roots remain
  `opencode.localhost:3000` and `cli.localhost:3000`.
- **Private upstreams**: ports `4098` and `4099` are container-internal only.
  The gateway clears browser authorization, identity, and proxy-chain headers
  before proxying; ttyd receives only the gateway-injected fixed identity.
  The gateway owns the iframe CSP and permits framing only from the supported
  dashboard loopback origins. Never publish the upstream ports as a workaround.
- **Production aliases**: `opencode.localhost`, `cli.localhost`, and
  `vscode.localhost` share one static `404` body and header policy. No WebSocket
  upgrade is proxied when singleton upstreams are absent.
- **CLI WebSocket origin check**: the `/ws` gateway route allows only the
  explicit trusted local origins `http://localhost:3000`,
  `http://127.0.0.1:3000`, and `http://cli.localhost:3000`. Nginx preserves the
  browser `Origin` and derives a matching upstream `Host` before proxying, so
  ttyd's `--check-origin` validation remains enabled. Arbitrary origins are
  rejected with `403`; do not disable origin checking or bypass the gateway.

## Related Features

- The workspace (`~/repos`) is mounted to `/workspace` in the container via Docker volume.
- Use the OpenCode interface to interact with the 286-active-tool Ingenium MCP surface across 32 baseline categories (284 active `ingenium_` server registrations plus 2 extension tools). Retired coordination tools are not in the active catalog; project-scoped child discovery can add tools and categories dynamically.
