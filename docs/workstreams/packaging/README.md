# Packaging and platform qualification stream

Status: source tooling ready for coordinator review; platform release gates remain open.

## Scope and authority

This stream owns `tools/veyra-release`, `packages/veyra-operations`, the prefixed release tests and this documentation. The native sidecar owns its release preflight tooling. It does not change the shared Dockerfile, charts, manifests, locks, authentication, migrations, service wiring, upstream OpenCode Web, computer-use or Stratus. No database, scheduler, transcript or authentication authority is introduced.

The coordinator owns integrated builds, deployment, external account workflows, native execution, attended browser/desktop/audio qualification and acceptance. F01, F52, F54, F68 and H01-H06 remain open until their actual platform evidence passes. The complete 74 feature dispositions, 47 views, 20 Settings categories and 11 Windows rows remain authoritative. This stream does not approve deferrals or writable Rust cutover.

## Release tooling

Run from the integrated application repository with Node 22 or later. These commands read inputs and print JSON; they never build, download, copy a runtime, deploy, sign, update or delete an artifact.

```sh
node tools/veyra-release/source-manifest.mjs "$APP_SOURCE" "$APP_REVISION"
node tools/veyra-release/inspect-payload.mjs "$STAGED_PAYLOAD" "$REVIEWED_PAYLOAD_POLICY"
node tools/veyra-release/qualify.mjs "$CANDIDATE_EVIDENCE"
```

`APP_SOURCE` is the exact clean repository root and `APP_REVISION` is its full lowercase Git SHA. The inventory rejects dirt, untracked files, submodules, symlinks, a revision change and working bytes that differ from the Git blob. It hashes raw bytes, retaining CRLF/LF differences. The JSON contains revision, tree, per-file byte counts and SHA-256 hashes, and a deterministic source inventory hash. It never prints source contents. Preserve the native revision independently in the candidate identity. The manifest is a point-in-time check; the coordinator must isolate the build input and verify it again after building.

`STAGED_PAYLOAD` must be an isolated staging directory, never an installed preview, user profile, model directory or live image filesystem. `REVIEWED_PAYLOAD_POLICY` is JSON containing `platform` (`windows` or `linux`), nonempty exact `approvedPaths` and nonempty `requiredPaths`. Paths are slash-separated relative paths. Supply an independently reviewed allowlist; do not generate it automatically from the candidate and treat that as review. Example shape:

```json
{
  "platform": "windows",
  "approvedPaths": ["Veyra.exe", "LICENSE"],
  "requiredPaths": ["Veyra.exe", "LICENSE"]
}
```

That example describes the policy format, not the full distributable inventory. The collector rejects unreviewed/missing paths, links, special files, case collisions, private state and disposable output trees. It hashes real payload bytes and reports unpacked size separately from compressed archive/image transfer size. Linux additionally rejects known engine/model path names. Path checks cannot identify a renamed or statically linked engine: review the exact Linux build closure and dependency provenance before satisfying `linux-engine-exclusion`. Existing Windows engine executables may remain in the reviewed Windows package; settings, models and credentials remain in place and are never collected or copied by this tooling.

`CANDIDATE_EVIDENCE` contains `candidate`, `acceptance` and `evidence`. Candidate identity is `platform`, `appRevision`, `nativeRevision`, `sourceSha256` and `artifactSha256`. For Linux, use the immutable image digest hex as `artifactSha256`; for a Windows archive, use the archive SHA-256. Do not mix unpacked inventory hashes with artifact hashes. Every gate receipt binds all five subject fields, a `gate`, `status` (`pass`, `fail`, `incomplete`), the required `kind` and an immutable `receiptSha256`. `fixture: true` never qualifies a gate. The reducer is a verifier-consumption tool, not a source of attestation: the coordinator must inspect the actual receipts and independently approve their provenance.

The acceptance object requires `featureDispositions: 74`, `views: 47`, `settings: 20`, `windowsRows: 11`, and equal full SHA-256 `originalContractSha256`/`retainedContractSha256`. Hash the retained original acceptance manifest independently; do not substitute hashes of rewritten baselines. New approved Work/Customize/voice references remain additional gates, not replacement counts.

`qualification.mjs` exports the required gates and evidence kinds. Source, payload, runtime, visual, preservation and cleanup evidence stay distinct. Fixture captures, a successful build or a health response cannot substitute for runtime/visual acceptance. The report keeps the first submitted failure visible and rejects duplicate or unknown gates instead of silently selecting a later pass. Preserve multiple attempts as separate immutable reports. CLI exit codes: 0 qualified by supplied evidence, 2 incomplete/failed, 1 invalid input. Even a qualified report leaves complete product acceptance with the coordinator.

## Platform/browser consumer adapter

`packages/veyra-operations/platform-browser.mjs` provides an isolated planner and one-dispatch adapter. Explicit bindings distinguish Windows native, selected WSL distro/user/workdir and Linux cluster/namespace. `projectId: null` means projectless work; omitted project identity is rejected. Browser targets distinguish native, paired and remote tabs with exact tab/session IDs. Linux requires a remote target; WSL cannot silently use the native Windows adapter.

The caller must obtain grants from the existing authenticated capability boundary, verify their authenticity and revalidate them at dispatch. These plain local DTO checks do not authorize a request, persist permissions or replace server authentication. Grants bind the complete environment, installation, account, project, runtime, action, tab and session and must be unexpired against a trusted clock. Navigation requires an exact `allowedOrigins` grant and an HTTP(S) URL without embedded credentials. DOM input forwards only a bounded selector, dropping unrecognized execution fields. The injected transport must perform the actual action, enforce URL/DOM payload policy, cancellation and current target ownership, and produce a redacted durable receipt. The planner contains no desktop/browser driver or permission acquisition. Unavailable transports fail; interrupted dispatch returns `unknown` with `retryAllowed: false`. Cancellation after dispatch cannot assert that an external effect was rolled back.

## Operations compatibility

`packages/veyra-operations/compatibility.mjs` consumes verifier observations for 18 retained integration boundaries: one API database writer/migration owner, account/org/project isolation, installation Chat defaults, a single jobs/event queue owner, scheduler recovery, backup integrity/isolated restore, secret-format compatibility, Vault step-up/denial, mail OAuth/sync/send outcomes, provider catalog/auth, MCP visibility, broker denial and the public-only Cloudflare route.

The reducer performs no writes or account calls. Observations must name the same `candidateId`, a known unique `check`, `status` (`pass`, `fail`, `unknown`, `incomplete`) and immutable `receiptSha256`. Missing, stale and fixture evidence remains incomplete. A mail send with unknown outcome remains unknown and cannot authorize resend. Existing Node mail/provider/Vault adapters remain in place until parity is independently qualified; this stream does not move them to Rust.

## Validation and storage

```sh
node --test tests/veyra-release-tooling.test.mjs
```

Run the native sidecar's `tools/veyra-release/tauri-inputs.test.mjs` separately. On this machine Windows Node's `--test` file-discovery rejected UNC inputs; invoking each test module directly with `node <absolute-module-path>` executes the same `node:test` cases successfully. This is CPU/tooling evidence only. WSL Node 22.23.1 passed 27/27 combined cases; Windows Node 24.18.0 passed 22/22 application and 5/5 native cases. Checks include raw byte drift, payload exclusions, stale/fixture evidence, failed/unknown outcomes, scope denials, cancellation and actual checked-in file hashing.

No dependencies, build products, caches, scratch fixtures, runtime copies or large downloads were created. Tests read the small source tooling directory and real native input closure. Only the assigned ownership/status receipts are retained for coordinator consumption. Source files and Git commits are durable deliverables. Every later build still requires the coordinator's lease, paired-root/20 GiB accounting, 15 GiB reserves and cleanup checks. No Windows disk recovery is claimed.
