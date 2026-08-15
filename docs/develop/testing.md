---
title: Testing Guide
description: Test-suite selection, isolated E2E runs, and external-suite safeguards.
---

# Testing Guide

## Affected-feature verification (ordinary work)

Start with the smallest checks that prove the changed behavior. Run the affected
workspace typecheck or lint when relevant, then the directly affected test file;
use `-t` to narrow a test name when useful. For browser behavior, target the
affected Playwright file and optional `--grep` expression:

```bash
npm run typecheck --workspace=packages/ingenium-core
npm run lint --workspace=services/ingenium-api -- lib/routes/feature.ts
npm run test --workspace=packages/ingenium-core -- tests/feature.test.ts
npm run test --workspace=packages/ingenium-core -- tests/feature.test.ts -t "handles the changed case"
npx playwright test tests/dashboard/feature.spec.ts --grep "changed behavior"
```

When a focused Playwright run uses the fixture, follow it with
`npx tsx tests/suite-containment-audit.ts --strict`; the audit is required to
prove that the run-owned processes and ports were contained. Ordinary feature
work must not expand into root tests or broad suites.

## Git and GitHub workflow

Manual and user-created commits are valid and never block continued work. Before
committing, inspect `git status`, `git diff`, and recent `git log`, then stage only
the intended paths. Use ordinary non-interactive Git for local commits and `gh`
for GitHub pushes, pull requests, and checks. Never commit unrelated changes,
rewrite published history, or force-push without explicit authorization.

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
divergent snapshot rejection without partial writes. The tests also verify
fail-closed normalization of `hidden`, `synthetic`, `ignored`, and `ignore`
markers and rejection of same-inode, same-size mutation during the
descriptor-bound read. The transport-parity check
also verifies `ingenium_context_upload_file` and the **282-tool** inventory
(280 `ingenium_` catalog entries plus 2 extension tools).

## Explicit full/release/cross-cutting acceptance gates

Declare the acceptance checks before running them. `FULL_ACCEPTANCE` means that
declared set, not automatically every repository test. Root `npm test`, an
entire Playwright config, and Docker/provider/mail/route-parity/manual suites
are reserved for explicitly declared full, release, or cross-cutting gates.

## Fixture acceptance gate (declared explicitly)

The fixture Playwright configuration is the deterministic Phase 5 fixture E2E
run. It starts the production-mode API and dashboard processes plus the chat
fixture, uses a per-run temporary database/project, allocates a distinct
high-port block, and builds the dashboard from a run-isolated source copy so a
concurrent fixture cannot replace another run's live Next.js artifacts. Teardown
cleans up the exact manifest-owned run directory. This is the verified Phase 5E
behavior: the run manifest is the source of truth for process identity, ports,
paths, and cleanup ownership.

```bash
npx playwright test --config=tests/playwright.config.ts
```

The default allow-list intentionally excludes Docker-backed, real-provider,
live-mail, and manual visual suites. Do not interpret an excluded suite as
passing: it was not run.

`INGENIUM_E2E_SKIP_BUILD=1` is allowed only when the production artifacts have
already been built. The fixture copies those artifacts into its run-isolated
workspace; it skips the build step, not production mode, and the dashboard still
runs with `next start`.

### Strict containment ownership

The strict audit is the post-teardown gate for the run-owned default fixture,
not cleanup for an already-deployed external Docker suite. The Docker suite
starts no fixture processes or manifest; Playwright owns its browser/output
cleanup and Compose owns the deployed services. Do not run the fixture audit as
the Docker suite's teardown step.

The strict audit does not treat a configured or expected port number as proof
of ownership. A listening fixture port is accepted only when its manifest and
process identity prove it belongs to the current run. Compose ports `3000`,
`4097`, and `1455` are accepted only after read-only Docker inspection proves
one running, healthy container has the exact repository Compose labels, exact
host mappings, and (when requested) the expected OCI revision; a stable second
inspection must agree. A rogue listener, an unverified Compose container, an
unexpected mapping, or an unavailable inspection is classified as
unverified/unowned and fails strict mode.

Playwright output is resolved below the canonical repository root at
`tests/artifacts/playwright/<suite>`. The helper rejects unsafe scopes,
symlinks, path escapes, and the legacy `tests/tests` nesting. Manifestless
temporary evidence is retained and reported, not deleted.

### Phase 5E isolation and recovery

The fixture runner validates and records its process IDs, process-group
identity, run nonce, ports, database, project, and temporary directory in a
manifest. Child environments are built from an explicit allowlist of safe
runtime variables plus service-specific values; parent credentials and
unrelated secrets are not inherited. The API child alone receives the test
bearer. The API and dashboard receive `INGENIUM_API_TEST_MODE=1`; background
schedulers and mail maintenance remain disabled. Dashboard and fixture
readiness/preflight requests receive no API bearer header; the dashboard's
server-side credential is kept separate in its protected token-file path.

Readiness follows the same boundary: only the API readiness request sends a
bearer plus the internal-service marker. Dashboard and fixture readiness
requests are unauthenticated.
The dashboard proxy's API credential is server-only: when
`INGENIUM_API_TOKEN_FILE` is configured it takes precedence over inline input,
must be an owner-readable (`0600`) regular non-symlink file, and is never
returned to browser responses. Invalid or unsafe token-file configuration fails
closed.

After fixture setup reports its manifest and ports, passive QA Vision can open
`http://localhost:<dashboard-port>/test-fixture/session`. The `localhost`
origin allows Chromium to accept the Secure fixture cookie over loopback HTTP.
The dashboard performs
the manifest-nonce-bound exchange server-side, installs only the isolated
browser session cookie, and redirects without a `project` query. The dashboard
resolves the fixture's sole run-owned global/home project; explicit project
tests may still select that same isolated project. The route is
`404` outside test mode; neither the API bearer nor fixture credentials enter
the browser.

Start a bounded visual fixture without printing or passing a credential to the
visual agent:

```bash
npx tsx tests/visual-fixture.ts start --timeout-seconds 1800
```

The command returns JSON containing the exact `runId`, fixture-only `url`, lease
timeout, and credential-free cleanup command. Open the returned URL in a fresh
browser. Run the returned cleanup command immediately after visual QA; the
detached guardian performs the same manifest-owned cleanup when the lease
expires. The production `http://localhost:3000/test-fixture/session` remains
unavailable because the deployed dashboard has no fixture mode, nonce, project,
or run-owned credential file.

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

Compatibility Docker preflight expects healthy fixed OpenCode/CLI/VS Code aliases.
Production preflight instead expects those three aliases to return identical static
no-store `404` guidance with restrictive CSP and no forwarded WebSocket upgrade. The
private listeners on `4098`, `4099`, and `4100` are never Docker-suite defaults.

Focused runtime UX verification uses the core runtime-isolation test, API runtime
route/gateway/manager tests, dashboard runtime-launch/frame/standalone tests, and
gateway static validation. The API cases cover authorization-filtered visibility,
explicit start, cross-user denial, concurrency, quotas, activity counters, and
compatibility descriptors. Its focused live QA command is:

```bash
RUN_DASHBOARD_DOCKER=1 npx playwright test --config=tests/playwright.docker.config.ts
```

External Docker browser work is serialized (`workers: 1`,
`fullyParallel: false`). Before every same-origin dashboard document request,
the Docker and route-parity suites share a worker-local serialized governor.
Retained Docker traces measured 9 dynamic requests in 384ms for the observations
reload, 4 in 360ms for OpenCode, and 11 in 382ms for chat; the retained
route-parity network log recorded 7 RSC requests in 26ms. Static `/_next/static/`
assets and OpenCode/code-server origins are excluded. Nginx permits 30 requests
per second with a 60-request burst, so the governor reserves 12 requests per
route and dispatches documents at most every 400ms. It waits the full
`60 / 30 = 2s` decay interval after global preflight.

The latest retained Docker `opencode-chat` failure trace covers a 758ms
read burst: 12 logical `GET` dispatches — projects (3), sessions (4: two lists
and two message reads), chat config (1), permissions (2), and questions (2).
The sessions and chat-config calls are page-mocked in that scenario. The
context-route `route.fetch()` therefore records 19 trace resource reads, but
only seven direct API reads reach the fixed-window limiter: projects (3),
permissions (2), and questions (2). The question and permission source polls
are respectively 3 seconds while idle and 5 seconds while streaming, so neither
periodic interval elapses during that burst; the duplicate calls are initial
and session-transition refreshes.

The API source default and its limiter test establish 100 requests per
60-second window. Docker supplies a 6-second transition interval through its
Playwright project metadata, rather than changing test order or adding a
test-specific exception. That admits 10 transitions: `10 × 7 + 2` Docker
preflight reads = 72, retaining 28 requests of fixed-window headroom. Route
parity uses the same 6-second project-metadata interval because its Mail
settings deep link adds ten per-key reads to page and project resolution. This
covers repeated `goto` and `reload` calls plus fresh pages created by a test;
it does not pace OpenCode/code-server origins or asset subrequests.

The retained failures distinguish the two limiters without retaining response
bodies: the API fixed-window limiter returns JSON `RATE_LIMITED` plus a numeric
`Retry-After`; the Nginx gateway limiter returns no `Retry-After` (normally an
Nginx HTML body/server header). In the Docker and route-parity Playwright
workers only, a same-origin, bodyless `GET` or `HEAD` under `/api/v1/` may be
replayed once through `route.fetch` when the first `429` has a valid numeric or
HTTP-date `Retry-After` no greater than 10 seconds. The worker waits that exact
duration plus one clock tick and preserves the original request headers and
authentication. Event-stream reads are left live because `route.fetch` cannot
replay an open stream. A second `429`, missing/invalid/excessive header, mutation,
request body, non-API request, and every RSC request remains fatal. This does
not apply to the default fixture suite, deployed applications, or Node preflight
requests. In particular, a no-header RSC `429` is a governor failure, never a
retry signal; do not increase the 12-request/400ms drain without new retained
request-count evidence. The 10-second browser replay maximum is intentionally
unchanged.

Before any external test starts, Docker and route-parity global setup issue one
read-only API health preflight. If its first response has a valid numeric or
HTTP-date `Retry-After` no greater than the known 60-second API window, setup
waits that exact delay plus one clock tick and retries it once. A missing,
invalid, excessive, or second `429` is fatal; no other preflight request is
replayed. Docker preflight then resolves the selected project against the live
project list rather than assuming fixture data.

The custom external-suite fixture installs its context route handler before test
code runs and stops it after each test: it stops accepting new routes,
unregisters the retained handler, and awaits already-started route work before
Playwright releases page/context fixtures. One route is admitted once, so it
cannot fulfill twice. Only the exact `Route is already handled!` or `Test
ended.` race is suppressed after teardown has begun; active-test and all other
teardown errors remain fatal.

`INGENIUM_E2E_PROJECT` is optional, but when set it must name an existing,
active project returned by the deployment's same-origin `GET /api/v1/projects`
preflight. Without it, the Docker suite uses the sole active global project.
The suite neither creates nor deletes projects, and its general checks do not
require a configured mail account or provider. Real mail coverage remains the
separate `RUN_DASHBOARD_MAIL=1` suite; it is not reported as a Docker pass when
unselected.

For the run-owned fixture suite, run the strict containment gate only after
Playwright teardown completes:

```bash
npx playwright test --config=tests/playwright.config.ts && \
  npx tsx tests/suite-containment-audit.ts --strict
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

- Playwright output is separated by suite under the canonical
  `tests/artifacts/playwright/` root.
- The runner's retained telemetry is canonical under
  `tests/artifacts/test-runs/<run-id>/runner-telemetry.json`; it is recovery
  evidence, not disposable scratch data. Do not relocate it to `/tmp` or
  delete it during broad cleanup.

### Ownership-verified telemetry retention

Retention considers only exact UUID directories directly below
`tests/artifacts/test-runs/`. The default command is a read-only preview and
does not create a plan, lock, quarantine, or receipt:

```bash
npx tsx tests/test-artifact-retention.ts preview
```

The initial policy auto-selects only telemetry at least 30 days old whose
schema, repository/run/nonce/path identity, owner-only modes, device/inode,
single-link file, and exact one-file inventory are valid. The telemetry must be
complete and explicitly resolved, failure-free, have an absent manifest, no
active or recorded live identity, and three closed ports. The current/selected
run and named, legacy, manual, visual, Playwright, temporary, misplaced,
auxiliary, malformed, symlinked, hardlinked, special, wrong-owner,
cross-device, or otherwise unknown evidence remain manual regardless of age.

Persist a content-free 15-minute plan and matching report only after reviewing
the preview:

```bash
npx tsx tests/test-artifact-retention.ts report
```

The report prints the exact owner-only plan path and SHA-256 digest. Execution
has no force/all/delete-unowned mode and requires both values verbatim:

```bash
npx tsx tests/test-artifact-retention.ts execute \
  --plan '<exact-plan-path>' \
  --confirm-sha256 '<exact-plan-digest>'
npx tsx tests/test-artifact-retention.ts verify \
  --receipt '<exact-receipt-path>'
```

Execution takes an atomic per-run lock shared with telemetry and manifest
writers. A retention marker can be created only by the execute path after plan
and candidate validation; it binds the plan ID/digest, run nonce, candidate
path/hash/inodes, owner token, and prepared/quarantined path identity. Execution
repeats every path/schema/hash/inode/inventory/process/port/manifest check, then
atomically renames only the exact candidate into the plan's quarantine. The
final unlink synchronously revalidates the marker, parent/directory identity,
descriptor/path inode, mode, link count, size, and content hash before removing
the sole canonical telemetry file and now-empty directory. Any changed
predicate is retained with a recovery receipt. A crash after quarantine leaves
the validated marker and exact quarantine path for explicit recovery; there is
no quarantine sweep. The containment audit retries missing canonical telemetry
once and omits it only while the same unchanged, validated quarantined marker
remains active. Recreated telemetry and malformed, forged, expired, dead, or
changed markers remain strict failures.

Plans, reports, locks, quarantines, and receipts live only under the ignored
owner-only `tests/artifacts/test-runs/.retention-control/` root. Preview and
receipts contain policy metadata, UUIDs, reason codes/counts, filesystem
identity/inventory metadata, byte counts, and hashes—not telemetry failures,
commands, environments, or payload names. Failure-bearing and auxiliary
evidence is never automatically eligible in this release.

- Screenshots belong under `tests/artifacts/visual-qa/<run-id>/` or
  `tests/artifacts/manual/<date>/`; never save them at the repository root.
  Visual artifacts must be run-scoped; use a descriptive scope beneath the
  run directory so concurrent runs cannot overwrite one another.
- After every run-owned fixture run, verify the result, teardown, open ports,
  temporary run directories, active handles, and process RSS. The containment
  audit reports these signals and strict mode fails on unexpected listening
  ports, leftover Playwright temp directories, or RSS above the configured
  limit:

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

### VS Code theme and pinned-extension acceptance

The VSCODE-103 acceptance evidence is retained in the raw canonical run at
`tests/artifacts/test-runs/run-20260802-vscode103/` and the visual evidence at
`tests/artifacts/visual-qa/run-20260802-vscode103/`. Acceptance covers fresh
and existing `vscode-data` volumes, restart/offline operation, exact
`sst-dev.opencode@0.0.13` identity and SHA-256, code-server engine
compatibility, appuser ownership, idempotence, user/workspace theme override
preservation, and dark/light system behavior at 1440x900 and 390x844. QA and
security review are bounded to the declared acceptance and provenance/offline
boundary respectively; Docker acceptance verifies all 7 supervisord services
remain healthy. Evidence contains no workspace content or secrets.

## Production-mode dashboard route parity

The route-parity suite is a separate, bounded acceptance gate that owns the same
production-mode API/dashboard/chat fixture lifecycle as the integrated suite. It
never targets a developer server or deployed installation and never imports a
production credential:

```bash
RUN_DASHBOARD_ROUTE_PARITY=1 \
  npx playwright test --config=tests/dashboard-route-parity/playwright.config.ts

# Equivalent convenience wrapper:
npx tsx tests/run-dashboard-route-parity.ts
```

The config and global setup allocate a run-owned `playwright-test-*` global/home
project and organization, start `next start`, provision an organization-scoped
synthetic browser user, and write one mode-`0600` run-owned Playwright storage
state before workers start. The session cookie and selected-project storage are
bound to that run's loopback dashboard origin and project. The wrapper is only a
convenience opt-in; it is not an authentication side effect. Browser requests
never contain the internal fixture bearer or binding headers, and no production
credential is installed in browser state. The route inventory uses the run
project rather than `global-default`.

The suite loads the production `.next` route manifests, derives the canonical 24
primary routes from dashboard navigation, checks all 14 settings deep links and
supported query variants, rejects retired routes, and smoke-renders every route.
The serialized navigation governor remains active.

After the fixture-only session bootstrap, route inspection is strictly
non-mutating. The browser guard observes the whole context, including subframes
and redirect chains; document-only checks abort scripts, styles, frames, and
XHR/fetch requests. The known docs-space request is intercepted with isolated
GET-only data as defense in depth.

A missing artifact route, stale navigation target, failed fixture response, or
unexpected post-bootstrap mutation is a deterministic acceptance failure. Follow
every focused or complete run with:

```bash
npx tsx tests/suite-containment-audit.ts --strict
```
