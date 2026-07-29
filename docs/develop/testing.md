---
title: Testing Guide
description: Test-suite selection, isolated E2E runs, and external-suite safeguards.
---

# Testing Guide

## Context-native upload verification

The final Context-native upload implementation is covered by focused tests for
the protected one-descriptor file read and path/TOCTOU guards
(`services/ingenium-server/tests/context-upload.test.ts` and
`context-upload-toctou.test.ts`), the authenticated single-snapshot API
transport (`services/ingenium-api/tests/context-snapshot-ingest-api.test.ts`),
and the transactional importer
(`packages/ingenium-core/tests/context-snapshot-import.test.ts`). These checks
cover OpenCode export/simple JSON, JSONL, Markdown/text, visible user and
completed assistant filtering, new conversation creation, existing-conversation
adoption, prefix verification, suffix refresh, idempotent replay, and shorter or
divergent snapshot rejection without partial writes. The transport-parity check
also verifies `ingenium_context_upload_file` and the **268-tool** inventory
(266 server registrations plus 2 extension tools).

## Default test run

The default Playwright configuration is the deterministic Phase 5 fixture E2E
run. It starts the production-mode API and dashboard processes plus the chat
fixture, uses a per-run temporary database/project, allocates a distinct
high-port block, and cleans up the exact manifest-owned run directory during
teardown. This is the verified Phase 5E behavior: the run manifest is the
source of truth for process identity, ports, paths, and cleanup ownership.

```bash
npx playwright test --config=tests/playwright.config.ts
```

The default allow-list intentionally excludes Docker-backed, real-provider,
live-mail, and manual visual suites. Do not interpret an excluded suite as
passing: it was not run.

`INGENIUM_E2E_SKIP_BUILD=1` is allowed only when the production artifacts have
already been built. It skips the build step, not production mode: the
dashboard still runs with `next start`.

### Phase 5E isolation and recovery

The fixture runner validates and records its process IDs, process-group
identity, run nonce, ports, database, project, and temporary directory in a
manifest. Child environments are built from an explicit allowlist of safe
runtime variables plus service-specific values; parent credentials and
unrelated secrets are not inherited. The API child alone receives the test
bearer and `INGENIUM_API_TEST_MODE=1` (with background schedulers and mail
maintenance disabled). Dashboard and fixture readiness/preflight requests
receive no API bearer header; the dashboard's server-side credential is kept
separate in its protected token-file path.

Readiness follows the same boundary: only the API readiness request sends a
bearer header. Dashboard and fixture readiness requests are unauthenticated.
The dashboard proxy's API credential is server-only: when
`INGENIUM_API_TOKEN_FILE` is configured it takes precedence over inline input,
must be an owner-readable (`0600`) regular non-symlink file, and is never
returned to browser responses. Invalid or unsafe token-file configuration fails
closed.

### Mutation-origin contract

Fixture mutations run against a direct dashboard listener with a dynamically
allocated origin. The fixture may use its exact browser `Origin` only when the
request has no reverse-proxy forwarding metadata; Next.js's recognized
listener-local forwarding defaults are treated equivalently. The fixture origin
must still be explicitly present in `DASHBOARD_ALLOWED_ORIGINS` and the
dashboard marker is required.

Production gateway mutations are stricter: Nginx must overwrite the scalar
`X-Forwarded-Proto`, `X-Forwarded-Host`, and `X-Forwarded-Port` fields, and the
dashboard proxy must reconstruct an allowlisted origin that exactly matches
the browser `Origin`. Partial, malformed, multi-valued, forged, or untrusted
forwarding metadata must fail closed; it must never downgrade a request to the
direct-fixture fallback. See [API Authentication](../security/api-authentication.md)
for the canonical boundary contract.

The runner defaults to an isolated API/dashboard/fixture port block; override
individual ports only when necessary:

```bash
INGENIUM_E2E_API_PORT=41001 \
INGENIUM_E2E_DASH_PORT=41002 \
INGENIUM_E2E_FIXTURE_PORT=41003 \
npx playwright test --config=tests/playwright.config.ts
```

Ports must be distinct and in the user-port range. Teardown validates the
manifest nonce, PID start time, process group, executable, and group identity
before signaling; it then verifies the ports are closed before removing the
manifest-owned directory. Stopping is resumable: failed teardown retains the
`stopping` manifest and runner telemetry, including process/port evidence, and
the strict audit treats that evidence as requiring recovery. If a run is
interrupted and the manifest remains, inspect the manifest named by
`INGENIUM_TEST_RUN_MANIFEST`, stop only its recorded processes, verify its
dynamic ports are closed, and remove only its recorded run directory after all
records are cleared. Never use a broad `/tmp` glob or kill unrelated
processes.

If stale processes remain but the manifest is missing or malformed, automatic
cleanup cannot prove ownership and deliberately does nothing. Treat this as a
manual recovery: identify the listener PID for each stale run port, verify its
command, start time, process group, and run context from service logs before
terminating it, then verify every port is closed. Do not delete the unowned
temporary directory or artifacts; retain them for investigation. Re-run the
strict audit only after the manual recovery evidence is complete.

Startup also performs stale-artifact cleanup, but only for old,
schema-valid, empty, fixture-owned runs whose manifest proves they are safe to
remove. Missing, malformed, active, or process-bearing runs are retained and
reported rather than deleted.

## Usage and MCP control checks

Usage telemetry is covered by provider-neutral focused tests; no provider
credential is required. Run the core normalization/aggregation tests, API
route tests, and OpenCode step-finish collector tests together:

```bash
npm run test --workspace=packages/ingenium-core -- usage.test.ts
npm run test --workspace=services/ingenium-api -- usage-api.test.ts usage-sync.test.ts
npm run test --workspace=services/ingenium-server -- tool-visibility.test.ts
```

The usage checks cover UTC inclusive/exclusive ranges, project mapping and
quarantine, replay-safe upserts, partial/unknown cost and cache values,
freshness, bounded pagination, and deterministic export. MCP visibility checks
cover a built-in tool being removed from `tools/list`, direct execution failing
closed, and visibility/execution returning after re-enable. The dashboard MCP
control spec covers the real `/mcp-servers` toggle path.

## Explicit opt-in suites

Each external suite fails during preflight unless its opt-in variable is set
to `1`. These suites use dedicated configs and are never selected by the
default command.

| Suite | Command | Required opt-in |
|---|---|---|
| Docker/live system | `npx playwright test --config=tests/playwright.docker.config.ts` | `RUN_DASHBOARD_DOCKER=1` |
| Real provider | `npx playwright test --config=tests/playwright.real-provider.config.ts` | `RUN_DASHBOARD_PROVIDER=1` |
| Mail | `npx playwright test --config=tests/playwright.mail.config.ts` | `RUN_DASHBOARD_MAIL=1` |
| Manual visual evidence | `npx playwright test --config=tests/playwright.manual.config.ts` | `RUN_DASHBOARD_MANUAL=1` |
| Live OpenCode API (broker + proxy, API workspace) | `npm run test:live-opencode --workspace=services/ingenium-api` | `RUN_OPENCODE_LIVE=1` and `OPENCODE_SERVER_PASSWORD` |

Examples:

```bash
RUN_DASHBOARD_DOCKER=1 npx playwright test --config=tests/playwright.docker.config.ts
RUN_DASHBOARD_PROVIDER=1 npx playwright test --config=tests/playwright.real-provider.config.ts
RUN_DASHBOARD_MAIL=1 npx playwright test --config=tests/playwright.mail.config.ts
RUN_DASHBOARD_MANUAL=1 npx playwright test --config=tests/playwright.manual.config.ts
```

The Docker, provider, mail, and manual suites require their target services
to be running before invocation. The provider and mail suites require the
configured real provider/account; they do not manufacture credentials or
replace service failures with skips. Use these optional endpoint overrides
when the target is not on the local defaults:

```bash
INGENIUM_E2E_DASHBOARD_URL=https://dashboard.example.test \
INGENIUM_E2E_API_URL=https://api.example.test \
INGENIUM_E2E_OPENCODE_WEB_URL=https://opencode.example.test \
INGENIUM_E2E_CLI_URL=https://cli.example.test \
OPENCODE_SERVER_URL=https://opencode.example.test \
INGENIUM_API_TOKEN='...' \
RUN_DASHBOARD_DOCKER=1 npx playwright test --config=tests/playwright.docker.config.ts
```

Set only the values required by the deployment. Keep tokens in the shell
environment or secret manager; never add them to docs, source, or config.

## Evidence, cleanup, and audits

- Playwright output is separated by suite under `artifacts/playwright/`.
- The runner's retained telemetry is canonical under
  `tests/artifacts/test-runs/<run-id>/runner-telemetry.json`; it is recovery
  evidence, not disposable scratch data. Do not relocate it to `/tmp` or
  delete it during broad cleanup.
- Screenshots belong under `tests/artifacts/visual-qa/<run-id>/` or
  `tests/artifacts/manual/<date>/`; never save them at the repository root.
  Visual artifacts must be run-scoped; use a descriptive scope beneath the
  run directory so concurrent runs cannot overwrite one another.
- After every run, verify the result, teardown, open ports, temporary run
  directories, active handles, and process RSS. The containment audit reports
  these signals and strict mode fails on unexpected listening ports, leftover
  Playwright temp directories, or RSS above the configured limit:

  ```bash
  npx tsx tests/suite-containment-audit.ts --strict
  ```

Strict mode discovers dynamic ports from the manifest and retained telemetry,
then fails on unexpected listening ports, retained managed processes,
`stopping` recovery state, malformed telemetry, leftover Playwright temporary
directories, or RSS above the configured limit. A repository-wide strict scan
retains (and reports as informational) only validated telemetry that is older
than the stale-run interval, has a missing—not malformed—manifest, and proves
that every recorded process and port is gone. Fresh, live, malformed, or
explicitly selected run evidence remains a strict failure. For an intentionally
non-default port set, provide it explicitly:

```bash
INGENIUM_AUDIT_PORTS=41001,41002,41003 \
INGENIUM_AUDIT_EXPECT_PORTS=41001,41002,41003 \
npx tsx tests/suite-containment-audit.ts --strict
```

Treat this audit as a required post-run gate, not as optional reporting.

- A skipped test, missing opt-in, or unavailable external dependency is not a
  successful verification. Record it as not run/blocked and run the required
  suite with its explicit preconditions.

## Production dashboard route parity

The route-parity suite is a separate, read-only production acceptance gate. It
does not start `next dev`, `next start`, Docker, or a fixture, and it never
creates API credentials or mutation requests. It requires an already-running
production dashboard gateway and an explicit opt-in:

```bash
RUN_DASHBOARD_ROUTE_PARITY=1 \
INGENIUM_ROUTE_PARITY_URL=http://localhost:3000 \
npx playwright test --config=tests/dashboard-route-parity/playwright.config.ts
```

`INGENIUM_PRODUCTION_DASHBOARD_URL` and `INGENIUM_E2E_DASHBOARD_URL` are
compatibility aliases for the target URL. The target must be an absolute HTTP(S)
root origin with no credentials, query, fragment, or shared sub-path. The suite
loads the production `.next` route manifests, derives the canonical 20 primary
routes from dashboard navigation, checks settings deep links and supported query
variants, rejects retired routes, and smoke-renders every route through the
gateway. Its inventory is deterministic: primary routes come from the navigation
source, settings tabs from the registered settings panel map, and artifact routes
from `BUILD_ID`, `routes-manifest.json`, and `app-path-routes-manifest.json`.

Coverage includes:

- every derived primary navigation route and the production artifact/gateway
  route for each;
- all 14 supported settings tabs (`general`, `projects`, `skills`, `tasks`,
  `jobs`, `plugins`, `mail`, `agents`, `mcp-servers`, `config`, `observations`,
  `personality`, `providers`, and `logs`), with and without the active project
  query, plus the chat providers deep link; and
- route-linked settings panels must expose their documented workspace target
  (`/projects`, `/skills`, `/tasks`, `/jobs`, `/plugins`, `/agents`,
  `/mcp-servers`, `/observations`, `/personality`, and `/logs`); `config` is a
  compact launcher for `/config`;
- the `/settings` compatibility redirect;
- safe page-specific and standalone variants, using discovered documentation IDs
  when available and harmless sentinels otherwise; and
- rendered navigation parity, retired-route rejection, and a no-mutation guard
  for read-only inspection and settings deep links.

The suite retries only observed gateway `429` responses within a bounded timeout;
it does not sleep for a fixed duration or fall back to a development server. A
missing artifact route, stale navigation target, failed gateway response, or
unexpected mutation is therefore a deterministic acceptance failure.

Run this suite after the production dashboard has been built and deployed. A
green unit or fixture run does not prove production route parity; a missing
route in the artifact or an unreachable gateway is a failure of this acceptance
gate, not a reason to fall back to a development server.

### Strict non-mutating audit contract

The production route-parity run is strictly non-mutating. It must not create
credentials, seed projects or documentation, write application state, or send
`POST`, `PUT`, `PATCH`, or `DELETE` requests. The browser guard observes the
whole context, including subframes and redirect chains; document-only checks
abort scripts, styles, frames, and XHR/fetch requests so route acceptance is
isolated to the production document/gateway path. The known docs-space request
is intercepted with an isolated GET-only fixture as defense in depth.

If the audit observes a mutation, a stale navigation target, a missing artifact
route, or a failed production gateway response, report the audit as failed. Do
not “repair” the target by running a write-capable setup flow or by falling
back to a development server.
