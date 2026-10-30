# Exact-source compatibility and performance qualification

This is an operator harness for the accepted GET-only Rust edge. It imports without starting a service, opening a microphone, loading a model, creating credentials or writing a receipt. The coordinator owns the configuration, exclusive test ports, source/build provenance, resource lease, credential fixtures and actual Windows/Linux runs. Worker tests use synthetic loopback HTTP and newly owned Node child processes only.

## What is measured

- Twelve mandatory compatibility cases: anonymous denial; original session projects/archive; original bearer; valid cookie with invalid bearer; invalid cookie with valid bearer; expired session; revoked session; privileged internal marker; POST; implicit HEAD; and an unexposed auth route.
- Each allowed case compares the edge's raw status, bytes and supported headers with the **same authoritative request's** response through an ephemeral fixed-GET recorder. It does not replay the request to obtain a second response with different request IDs. Changed original credentials fail before the recorder calls the API.
- Hidden cases must produce 404 with zero recorder requests. The compatibility matrix has a 30-second default/60-second maximum budget and honors the owned launcher's abort signal. The recorder itself refuses every upstream mutation even if an edge incorrectly forwards one. No write route, fallback credential, token issue/revocation operation, local RBAC cache or additional database writer exists in this harness.
- API latency is paired and interleaved, alternating the first target each pair, with one independent keep-alive agent per target and concurrency one. Default: 2 warmups and 20 measured requests per target; maximum: 10 warmups/100 samples, 4 MiB per response, 5 seconds per request and 60 seconds total. The first failure stops the sequence, retaining only its safe code/status; no blind retry or removal of failed samples.
- Nearest-rank p50/p95, min/max and count use monotonic wall time. Auth errors or rate limits are failures, not fast successful samples.
- Startup is measured from process spawn to an explicit readiness status, separately from artifact hashing. First-process and warm-relaunch samples always say **OS-cache-uncontrolled**. No cache flushing, unrelated service stop, CPU-affinity/tuning change or cold-cache claim.
- Idle RSS and CPU query only the owned PID. Linux reads that PID's procfs plus CLK_TCK; Windows uses Get-Process by ID. A changed process-start identity or nonmonotonic CPU counter refuses the sample. CPU percent is one-core equivalent, not divided by core count; actual elapsed sampling time and sampler overhead are visible. Direct-process scope excludes descendants.

Fixture timings only test collection and calculations. They are not measurements of Rust versus Node, Linux acceptance or evidence that Rust is faster. Harness Node/OS/architecture metadata is recorded so different environments are visible.

## Source and runtime binding

`verifyExactSourceArtifact` requires a clean scoped Git checkout at the exact expected commit and a binary hash from the coordinator's real build receipt. Node-based subjects also require an entrypoint path/hash; hashing the Node executable alone cannot bind API code. `withOwnedProcess` refuses a different executable, entrypoint hash or argument list whose first argument is not the declared script (eval/loader wrappers are not accepted). Root must supply the intended process environment, including the actual Node/runtime options; do not import unrelated profile defaults.

The aggregate `qualifyExactSource` checks source/artifact identity before and after the run, verifies returned process/artifact/closure proof, and binds all receipts to those hashes. It requires authority source/artifact/evidence hashes from the coordinator. Those authority hashes are explicitly labelled coordinator runtime/build evidence; they are not inferred from a localhost HTTP response. A Node/API build-to-source binding still needs the coordinator's actual build/deployment provenance.

For native Windows sources, the default structured Git invocation works. For this existing WSL checkout measured by Windows Node, supply a structured bridge rather than copying source or creating another mapping:

```js
const gitCommand = {
  file: process.env.SystemRoot + "/System32/wsl.exe",
  prefix: ["-d", "Ubuntu", "-u", "brajam", "--", "git"],
};
// artifact.sourceRoot is the existing absolute Linux checkout path.
// All execFile arguments remain separate. No shell, global config or drive alias is created.
```

Root must use an exclusively leased loopback port and prove the spawned process owns it. A callback loading a different existing service is not a valid launcher. All launches are direct, with `shell:false`; arguments/environment remain private. Stdout/stderr are drained and counted without retaining content. Only the newly spawned direct child is terminated in finally, including callback timeout/error and signal termination where exitCode is null. Cleanup failure cannot produce a passing process result. The coordinator retains the independent OS/port confirmation gate for actual platform runs.

## Credential inputs and authority preservation

Pass credentials in memory from protected operator inputs, never command-line flags, URLs, tracked JSON, stdout or persisted bodies:

```js
const credentials = {
  session: { cookie: originalSessionCookie },
  bearer: { authorization: originalBearerHeader },
  validCookieInvalidBearer: { cookie: originalSessionCookie, authorization: existingInvalidBearer },
  invalidCookieValidBearer: { cookie: existingInvalidCookie, authorization: originalBearerHeader },
  expiredSession: { cookie: existingExpiredCookie },
  revokedSession: { cookie: existingRevokedCookie },
};
```

Every slot is required before traffic starts. Root prepares verified expired/revoked fixtures on a separately authorized controlled setup; the harness does not manufacture their state, change clock/security policy, log in, mint tokens or revoke a session. A synthetically invalid string is not proof of actual expiry/revocation. Preserve the existing normal session-touch/audit bookkeeping and sole Node identity/database authority. Do not benchmark secrets by guessing values or broaden project/org access.

Cookie and bearer are forwarded together with existing audience/workspace/worktree context, preserving Node's cookie precedence. The recorder never adds an installation service credential. It accepts only an explicit loopback HTTP origin with no userinfo/path/query/fragment, never follows redirects, bounds response memory, cancels outstanding requests and wipes transient body buffers after comparison. Receipts contain no credential values, headers, response bodies, argv or stderr text.

## Coordinator execution recipe

The APIs are in `services/veyra-api/compatibility/`. Root supplies an existing lease-owned plan; this example does not authorize execution:

```js
import { qualifyExactSource } from "./exact-source-harness.mjs";
import { withOwnedProcess, measureIdle } from "./process-qualification.mjs";
import { waitForReadiness } from "./performance-harness.mjs";

// plan is private coordinator input: exact clean source/artifacts, original credentials,
// controlled data, ports, TEMP/output root, API provenance and explicit launch ownership.
const withEdge = (upstream, exercise) => withOwnedProcess({
  ...plan.edgeProcess,
  expectedExecutableSha256: plan.artifact.expectedBinarySha256,
  env: { ...plan.edgeProcess.env,
    VEYRA_LEGACY_API_ORIGIN: upstream,
    VEYRA_API_LISTEN: new URL(plan.edgeOrigin).host },
}, async ({ child, isExited, signal }) => {
  await waitForReadiness({
    origin: plan.edgeOrigin, isExited, signal,
    expectedStatus: upstream === plan.authorityOrigin ? 401 : 404,
  });
  return exercise(plan.edgeOrigin, signal);
});

const receipt = await qualifyExactSource({
  evidenceClass: "platform",
  artifact: plan.artifact,
  authorityProvenance: plan.authorityProvenance,
  authorityOrigin: plan.authorityOrigin,
  credentials: plan.credentials,
  withEdge,
  latency: { iterations: 20, warmup: 2, maxDurationMs: 15000 },
  startupSubjects: plan.startupSubjects,
});
// Persist only receipt inside the existing leased task output root.
```

The recorder's unarmed readiness GET returns 404 without authoritative traffic. Once cases are armed, each authorized read is recorded exactly once. For direct-edge startup/latency against the authority, readiness expects the existing anonymous denial explicitly.

Each startup subject is `{ name: "authority" | "edge", artifact, options: { runs, launch, ready, sampleIdle } }`. The launch adapter calls `withOwnedProcess` with the expected executable/script hashes and invokes the supplied callback; readiness has a finite deadline; idle uses `measureIdle(pid, {durationMs:1000})`. Both subjects need equivalent datasets/configuration, readiness definition, privilege/environment and sample budgets. Never start another Node writer against the live database to measure startup: Root must plan isolated compatible controlled storage, with one writer per database, and keep existing live services untouched.

The aggregate report has separate coverage flags for compatibility, API latency, authority startup and edge startup. `allRequiredMeasurementsPassed` stays false if any group is absent or failed. Reports require an explicit `evidenceClass` of fixture or platform; a passing fixture receipt does not qualify a platform.

Run the same plan/iteration budgets on Windows and Linux, recording different binaries, OS/harness runtimes and actual deployment/source provenance. Retain raw sample counts and first failure; do not compare rate-limited, different-data or differently scoped API responses as equivalent throughput. No startup/RSS/API performance claim is made by these worker fixture tests.

## Reproducible local fixture tests

No npm/Cargo/container install or build is needed. Set TEMP/TMP/TMPDIR to the existing worker coordination directory before testing. The test fixtures produce no disk state, caches or dependencies; all HTTP sockets and direct children close in finally.

```sh
node --test --test-concurrency=1 \
  services/veyra-api/tests/qualification-http.test.mjs \
  services/veyra-api/tests/qualification-process.test.mjs
# The exact-source test requires the reviewed harness commit to be clean:
node --test services/veyra-api/tests/qualification-exact-source.test.mjs
```

For Windows against this WSL source, use the existing verified Y mapping, one file argument per invocation, and set process-scoped `VEYRA_QUALIFICATION_SOURCE_ROOT` to the matching Linux checkout and `VEYRA_QUALIFICATION_GIT_WSL=1` for the exact-source tests. The initial multi-UNC-argument test-runner failure is retained as a private failure witness; one-file invocation succeeded. No alias/config/execution-policy change is required.

Tests cover the full synthetic matrix, dynamic request-ID parity, corrupted credential rejection before upstream I/O, missing fixture refusal, launcher failure cleanup, raw encoded bytes, response/timeout/abort bounds, deterministic percentiles/interleaving, first-failure stopping, real owned PID sampling, reused-PID denial, callback timeout, executable/entrypoint hashes and direct-child cleanup after success/failure/early exit. Exact-source tests bind clean tracked fixture code to the actual Node executable and entrypoint, and use explicit fixture evidence classification.

## Preserved gates and output ownership

No production exposure, Node auth/crypto rewrite, migration, scheduler/transcript/database copy, model/GPU/inference, Computer Use or external send is part of this harness. Windows inference remains unchanged; Linux engine exclusion and the writable Rust architecture gate remain intact.

Source stays in the original rust-api checkout. Small TAP/summary receipts stay in its existing coordination directory, with source commit/hashes. No compiler target, cache, temporary output tree or new root is generated. Previously policy-rejected native target/temp remain protected and are not retried. Root executes real authenticated/platform cases only under its separately granted configuration/traffic/resource lease.
