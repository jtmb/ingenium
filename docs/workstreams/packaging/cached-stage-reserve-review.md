# Cached native stage reserve review

Decision, 2026-10-30: the available metadata supports cache reuse as a possibility, but does **not** justify a qualified reservation below the normal 4 GiB. No reserve, guard, approved ceiling, root or workload was changed. This is a demonstrated evidence limitation, not approval of the unapproved 24 GiB proposal.

## Actual capacity and retained evidence

The read-only native allocation helper measured 11,374,851,584 budget bytes at `2026-10-30T04:19:26.186Z`; `du -x -s -B1` measured 7,143,276,544 paired Linux bytes. The combined recorded use is 18,518,128,128 bytes. Under the unchanged 21,474,836,480-byte ceiling, recorded headroom is 2,956,708,352 bytes, leaving a 1,338,258,944-byte shortfall for the standard 4,294,967,296-byte reservation. Windows C: and destination free-space observations exceed the independent 15 GiB floors. These observations are not a lease; the normal guard must remeasure before execution.

`native-stage-observations.json` is the minimal metadata input for `tools/veyra-release/review-stage-reserve.mjs`. The read-only tool computes cap/floor arithmetic, explains absent proof and rejects caller-supplied reserves or ceiling increases. It implements **no** reduced profile, never authorizes a build, and never invokes Cargo, a compiler, npm or Vite. It exits 2 while no smaller profile is qualified, even when its diagnostic arithmetic says the normal reserve would fit. That avoids making the review command a success gate for compiler execution. Unknown measurements refuse.

## Cargo: what matches and what is missing

The current Cargo lock hash is `a7bb23ff65c5359cddd1f9e5f98a762070124424417808e3117fef746a368aee`, matching the retained source-pin receipt. Windows Git's read-only diff against cached-source base `268962e20bef8c246fce332241c08c00c1fc2317` found no Cargo.lock/root or member Cargo.toml/rust-toolchain/.cargo tracked changes. The declared Rust channel is 1.99.0, and cached `.rustc_info.json` records Rust 1.99.0. These are favorable declaration/cache facts, not an executable compiler identity attestation.

Three retained service/adapters/desktop unit fingerprints share the same compiler/profile/config and remap-flag identities. The observed rustflags serialization SHA-256 is `38f2a7cedf28808b2c241a34162360c88c417b27e4d10f7a53cd3682bf1f2e27`. This does not certify every dependency unit, generated input, build script, source alias or wrapper.

The latest speech compile receipt records successful `cargo check --locked --offline -p veyra-service` in 2m38s. Its actual operator recipe explicitly sets `CARGO_BUILD_JOBS=1` and `CARGO_NET_OFFLINE=true`; it does not explicitly record `CARGO_INCREMENTAL=0`. Inherited incremental state is unknown. The normal gate checks **both** `veyra-service` and `veyra-desktop`, while that latest receipt covers service only; the desktop fingerprint predates composed source changes. Neither the log nor before-stage reservation establishes the maximum disk growth during that exact two-package, incremental-disabled stage.

[Cargo check still compiles package/dependency metadata](https://doc.rust-lang.org/cargo/commands/cargo-check.html); [incremental mode depends on its explicit environment/config](https://doc.rust-lang.org/cargo/reference/environment-variables.html). [Build scripts can rerun and retain generated OUT_DIR data](https://doc.rust-lang.org/cargo/reference/build-scripts.html). Offline mode and one job constrain network/concurrency, not a proven disk maximum. Changing incremental mode, wrappers, flags or aliases can invalidate assumptions even with an unchanged Cargo.lock.

## Frontend: final bytes are not peak bytes

The accepted prior frontend build produced 144 distribution files. Later cleanup removed 23,669,726 logical frontend bytes and 99,280,116 logical cache bytes (122,949,842 combined). Those are consumed final directories from a previous source state, not a peak trace including intermediate bundler output, worker/plugin transforms, typechecking, sourcemaps or transient caches. The old cache has been removed, and current Work/voice source/config changes are not the identical graph. Multiplying those final bytes by an arbitrary factor would manufacture a bound.

The existing frontend wrapper performs typechecking and Vite/worker/plugin processing after the shared guard. Its frontend-only nature does not authorize bypassing the normal gate or assuming a cached build. No frontend build was run by this reviewer.

## Preconditions considered for a cached mixed stage

A coordinator-reviewed, fixed profile would need all of the following before it could be considered:

- Exact normal-gate package/target/features, lock/manifests, compiler binaries, source/target identity, flags/wrappers/config and explicit offline/one-job/incremental-disabled environment bound to the candidate.
- A complete freshness account for dependency units and build-script/generated-input closures, not merely three matching fingerprint files or a successful service-only check.
- A defensible stage-aligned peak model/trace including live replacement/temporary outputs and concurrent task allocation, with a justified contingency. Final output size or reserved bytes alone is insufficient.
- Equivalent frontend source/dependency/config/plugin identity and measured transient behavior for a separate frontend profile; source-only Cargo evidence cannot qualify it.
- A fixed policy integrated and reviewed by the coordinator through the normal guard/gate. Callers cannot provide a smaller reserve. Any unknown, changed or cold precondition uses the unchanged standard guard or refuses.
- Fresh complete paired-root accounting plus the unchanged 20 GiB ceiling and both 15 GiB reserve checks, with serialized resource ownership. No invented approval or output relocation.

This evidence is currently absent for the cached mixed/Cargo review. The reviewer therefore proposes **no** numerical reduction for that operation. A separately enumerated frontend-only conservative planning estimate is now documented in [frontend-production-reserve-review.md](frontend-production-reserve-review.md); it excludes the already-qualified matching no-emit stage and does not rely on a mathematical hard bound, filesystem quota or a recovered peak trace. The generic review tool here implements no such new profile; the separate frontend profile has its own review function. The immediate supported outcome is the existing standard refusal. Other authorized integration work may continue; remeasure if an independently eligible last consumer later finishes, without assuming any particular cleanup is safe. Existing failed cleanup targets, their children/aliases, running packages, runtime data, models and original rollback sources remain protected. No cleanup retry or workload stop is part of this proposal.

## Verification and reconciliation

```sh
node --test tests/veyra-release-stage-reserve.test.mjs
node tools/veyra-release/review-stage-reserve.mjs docs/workstreams/packaging/native-stage-observations.json
```

The tests cover the actual arithmetic, cap/floor boundaries, missing/overflowing measurements, single-package/partial-cache mismatch, misuse of final frontend sizes and rejection of caller-selected reserves. Even a caller's asserted perfect evidence cannot enable an unreviewed reduced policy.

Only small owned source/test/documentation/metadata files were created. No compiler/build/Cargo metadata process, downloads, output copies, deletion, shared/native guard edits, service operation, model/GPU work or Computer Use occurred. The read-only allocation helper/du/df process completed normally. No Windows recovery claim is made.
