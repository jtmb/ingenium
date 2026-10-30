# Narrow Native Memory check profile v2

The immutable Memory proposal `eddbd5f218b40080b71928b79a6a1bc79850daed` supports a separately pinned **v2** check-only planning profile under the existing **2 GiB stage + 256 MiB concurrent source** estimate. No component or storage ceiling is increased. V1 stays unchanged and correctly rejects these new declarations. Generic build/test/link/package/default paths remain 4 GiB. This worker did not resolve Cargo.lock, invoke Cargo/network/compiler/build/capture, modify Native/current r2, or query its progress.

## Exact proposed addition

`crates/veyra-memory/Cargo.toml` is 204 bytes, SHA-256 `b5e7a3824ed4a17b81d49b07c1bc916e4920116da6c52094ed200f0c2d955b01`. It declares version 0.1.0, edition 2024, Rust 1.99, and only:

```toml
serde = { version = "1", features = ["derive"] }
serde_json = "1"
sha2 = "=0.10.9"
```

There is **no UUID dependency**, feature table, build-dependency, proc-macro target, build script or dev-dependency. Four library source files total 16,940 bytes. The 3,527-byte domain test is outside this check-only operation. Native consumer code can continue using its existing UUID dependency/features; this proposal adds no UUID edge.

Immutable manifest operations add exactly this crate to root workspace members/dependencies and add `veyra-memory.workspace = true` to adapters and service. Other member declarations stay byte-identical. `tools/veyra-release/memory-check-profile.lock.json` pins all ten final manifest paths/hashes, not an arbitrary caller allowlist:

| Changed declaration | Exact post SHA-256 |
| --- | --- |
| Root Cargo.toml | `eaea8832bacb74027fee855571261af75a8ac22b30a54c4e6fbdcc160d156ef8` |
| Adapters Cargo.toml | `5c373ba8208a61f90dc685109f901f14fec2ce5c0acbc11dd32c067bdbd41e31` |
| Service Cargo.toml | `c6190b4dcb1c06c0233c737a8312a14423841324fb0f43241900ae9de06a8823` |
| New Memory Cargo.toml | `b5e7a3824ed4a17b81d49b07c1bc916e4920116da6c52094ed200f0c2d955b01` |

The root/member before blobs were read from immutable Native a04 and verified against each Memory operation's exact preimage. No shared manifest or lock was written.

## Actual cached feature evidence

Read-only installed source manifests and compiled fingerprints show:

| Dependency | Existing locked version | Memory request | Observed compatible target/host features |
| --- | --- | --- | --- |
| serde | 1.0.229 | default std + derive | Target check: alloc/default/derive/rc/serde_derive/std |
| serde_json | 1.0.151 | default std | Target check: default/raw_value/std |
| sha2 | 0.10.9 | default std | Target check: default/std; no ASM requested |
| serde_derive | 1.0.229 | Existing derive macro transitively | Host proc-macro: default; compiled DLL present |

Target check witnesses use cached profile `8979240926782815398`; serde_derive uses host profile `11528375766455597691`. All sampled records match compiler `17664546606611198464` and the original ordered remap flags SHA `38f2a7cedf28808b2c241a34162360c88c417b27e4d10f7a53cd3682bf1f2e27`. The JSON pins actual fingerprint names/raw hashes, feature sets, artifact names/bytes, and installed registry manifest hashes. These are observed compatible inputs, not a new compiler result or proof that every dependency unit is fresh.

Both existing adapters and service already request the same ordinary dependency defaults/derive/std features. The new Memory edges are normal target dependencies, not a new build/dev/host dependency kind. Their requested feature sets add nothing to the existing selected graph. Cargo uses additive feature unions while distinguishing host/dev/target contexts; the comparison was made within the normal target and existing derive-host contexts, rather than assuming a Cargo.lock package list alone proves feature compatibility. [Cargo feature resolution](https://doc.rust-lang.org/cargo/reference/features.html), [resolver contexts](https://doc.rust-lang.org/cargo/reference/resolver.html).

No new registry/host codegen producer was found in this immutable addition. Existing serde/derive and sha2/digest inputs remain required; a missing artifact, altered feature/compiler/profile/flags witness or changed actual resolved graph refuses v2. A new ASM feature, version, generator or dependency is a new review, not a warm-cache assumption.

## Lock boundary: specification, not actual resolution

The baseline actual/immutable lock is SHA `a7bb23ff65c5359cddd1f9e5f98a762070124424417808e3117fef746a368aee`. The only admitted lock delta is:

- Add path package `veyra-memory` 0.1.0 depending on the existing `serde`, `serde_json`, `sha2` records.
- Add `veyra-memory` to the existing adapters and service dependency arrays.
- Preserve every registry package/version/source/checksum and every other package/dependency record exactly.

`memory-lock-delta.mjs` constructs and verifies that exact textual specification in memory. Applied to the immutable a7 baseline, its **expected** final raw lock SHA is `a5b1f51eb57f93d553abe9d5d428db773fc4e4d43d55dd1269443a3af058fd07`. This is not a Cargo-generated lock and was not written to Native. Root must perform actual authorized resolution/update, compare the actual file to this specification, then freeze its real raw digest. Unexpected resolver changes or formatting drift intentionally refuse until independently reviewed; the tool never normalizes or silently accepts them. Do not write the projected buffer and call it resolver evidence.

## Why the estimate remains conservative

The original model already sums 768 MiB registry metadata, 256 MiB workspace metadata, 384 MiB build-script/native OUT_DIR, 192 MiB macro DLL/PDB, 256 MiB simultaneous temporary/replacement files, 32 MiB logs/fingerprints and 160 MiB allocation/uncertainty. All components remain unchanged.

The addition's new work is a small workspace library metadata unit, derive expansions in that unit, and replacement/recheck of consumer metadata. It does not create a new compiled proc-macro binary, native build script or linked/test artifact. A conservative 16 MiB allowance for the new Memory metadata/derive output fits inside the existing 256 MiB workspace component; consumer metadata and simultaneous replacement remain charged to their original components. The aggregate current producer/source envelopes must still qualify. This is an estimate, not a claim that source byte size mathematically bounds metadata. No execution or peak measurement has been performed for Memory.

V2 keeps the original 32 MiB total workspace source envelope and adds a narrow 128 KiB Memory library envelope (the immutable source is 16,940 bytes). Whole starting allocation, including retained old check variants, incremental data and linked tests, remains counted. Fresh paired-root allocation + 2 GiB + 256 MiB must fit 20 GiB, with both 15 GiB floors after growth. There is no cap increase, protected cleanup retry or alternate drive.

## Tooling and Root integration boundary

`memory-check-profile.mjs` is a pure additional planning review. Its new selector is `native-cargo-check-memory-existing-inputs-v2`. It deep-freezes the pinned graph; rejects manifest path/hash additions, projected-only/stale locks, changed feature/host witnesses, unknown operations, cold host inputs, generator/config/alias/source drift and capacity failures; and always returns `buildAuthorized:false`. It cannot change v1 or launch anything. The lock helper is not a resolver.

Root must independently review this graph/model, resolve and compare the actual lock, then implement a distinct canonical v2 receipt/pin branch while preserving the original v1 branch. Retain all existing real descriptor/source/cache/physical-root/compiler/remapper/config/environment/original guard bindings. Do not globally replace the old lock/manifests, remove their refusals or accept caller-selected manifests. Extend selected-workspace source accounting to include `crates/veyra-memory/src`; new Memory metadata is expected and must not be demanded as a preexisting host cache witness. Every registry/host compiled input still requires the original independent review/current content binding. Actual current Source is frozen separately, including implementation fixes.

Projects implementation changes with the same reviewed declarations can join the frozen Source. Any additional Projects crate/declaration/feature/lock change is outside this v2 graph and requires a further exact review. Ordinary tests and linked builds continue to need the normal 4 GiB qualification. Actual compile, behavioral memory/persistence/authorization, visual, voice and package/platform release gates remain open.

## Verification and reconciliation

Eleven new dependency-free CPU cases cover the pinned graph, cold/drifted features/host artifacts, exact lock transform and registry/edge/version/source deviations, actual-resolution requirement, source/size/cap/floor/lease restrictions, and unchanged v1/default behavior. Tests use in-memory lock strings and metadata; no filesystem fixture, resolver, compiler or current capture is run.

Five small durable owned files are retained: lock-delta helper, v2 pure review, pinned graph JSON, tests and this guide. Their consumer is Root independent integration/review and actual next check; hashes/immutable revisions regenerate them without dependency copies. Removed paths: none; removed bytes: 0. No scratch, build output, package download, cache, new root or filesystem fixture was created. Existing protected targets remain untouched; no Windows/Linux recovery claim is made.
