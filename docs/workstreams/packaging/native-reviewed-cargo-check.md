# Canonical reviewed Cargo check entry proposal

This proposal adds Native `tools/reviewed-cargo-check.mjs` and minimally patches the original Native staged gate. It binds the reviewed 2 GiB check-only estimate plus 256 MiB source allowance to the real original PowerShell guard and original compiler remapper. It does not change any shared/native source in this worker checkout and does not invoke Cargo, rustc, PowerShell storage execution, a build, models or desktop control.

The canonical entry source is `tools/veyra-release/native-reviewed-cargo-check.mjs` in this APP worker. Its intended Native destination is exactly `tools/reviewed-cargo-check.mjs`; it is standalone and imports only Node builtins until it resolves the original, hash-pinned Native helpers. Copy these raw bytes once during coordinator integration. No APP-only runtime dependency or new native namespace is needed. `native-reviewed-cargo-check-gate.patch` contains only the minimal `tools/feature-gate.mjs` delta, not a duplicate copy of the new module.

## Exact preimages and default behavior

The proposal was generated from Git blobs in Native tree `a04ab38bd0e0c7b96f40689733cad3f2332b9a0b`, not from a dirty text approximation. The gate preimage SHA-256 is `80fca15c1d42a88a98197e1405133ba56537c92f36f359dbe1a226ca096d38bc`. `native-reviewed-cargo-check-preimages.json` records the original helper closure hashes, canonical entry hash, gate-after hash and patch hash/length. The generator refuses a different preimage.

The patch adds a branch only for `--staged`, non-CI, native Windows, with the fixed review receipt present. The entire original Rust branch remains verbatim inside `else`: default/no receipt, head, CI, Linux and other ordinary paths retain the original guard, compiler remapper and Cargo command. Build/test/link/package tools are untouched and retain their generic 4 GiB estimate. The new branch still runs `tools/check-boundaries.mjs`; the outer exact checkpoint/source checks, web checks and original final feature-gate receipt remain unchanged. No hook bypass is proposed.

Missing fixed receipt selects the old path. Present but invalid/stale/unsafe receipt fails; it does not silently retry or fall back. There is no environment-selected estimate/profile, caller argv, arbitrary executable name, CLI receipt-path argument or policy number supplied by a receipt.

## Review receipt and input binding

The only receipt path is:

```text
<registered native output root>/qualification/reviewed-cargo-check.json
```

It must be a new/current coordinator-owned plain file inside the existing root, at most 64 KiB, one hard link, with plain canonical directory ancestors. Reads bind lstat, descriptor identity/size/timestamps, exact bounded bytes, EOF and final descriptor/path identity; handles close in `finally`, including parse/read/race failure. The receipt is re-read after the original guard and before compilation. No output root is created or relocated by this module.

The receipt has exactly these keys:

```json
{
  "schemaVersion": 1,
  "profile": "native-cargo-check-existing-inputs-v1",
  "reviewedBy": "01a188fc-d3ed-7dc2-ab95-e0eed8a793ec",
  "reviewed": false,
  "hostInputsReviewed": false,
  "sourceTree": "CURRENT_STAGED_GIT_TREE",
  "gatePolicySha256": "CURRENT_RAW_GATE_SHA256",
  "sourceStateSha256": "CURRENT_TRACKED_RAW_SOURCE_DIGEST",
  "inputs": {
    "sourceFilesSha256": "REVIEWED_DECLARATION_AND_HELPER_INPUT_DIGEST",
    "cacheSha256": "REVIEWED_EXISTING_COMPILED_CACHE_DIGEST",
    "toolchainSha256": "REVIEWED_CARGO_RUSTC_DRIVER_DIGEST",
    "rootsSha256": "REVIEWED_PHYSICAL_ROOT_AND_ALIAS_DIGEST",
    "flagsSha256": "REVIEWED_ORDERED_ENCODED_FLAGS_DIGEST",
    "nativeEnvironmentSha256": "REVIEWED_NATIVE_BUILD_ENVIRONMENT_DIGEST"
  }
}
```

This is a schema illustration, not executable approval. Every digest must be a real lowercase SHA-256 and Source must be the actual current tree. Unknown keys, command/estimate injections, an unapproved review or an unreviewed host-cache assertion refuse.

`captureCargoCheckInputs(root, environment)` performs read-only input capture; it does not approve/write a receipt or invoke any compiler/guard. `cargoCheckReviewFacts(capture)` returns only the small safe candidate above, with **both approval fields false**. It excludes the internal child-process environment. The coordinator must independently review and attest the compatible host inputs and estimate before writing the approved fixed receipt. Do not serialize the full internal capture object; its execution environment is process-private. No automatic receipt-approving helper is supplied.

The capture binds:

- Current Git staged tree, absence of unstaged/untracked source and SHA-256 of every tracked file's actual raw bytes. Workspace implementation can change from the old cached version; each new exact integrated Source is frozen separately and checked before guard, before launch and after completion. The actual passed tree and policy must match independently captured current source.
- Fixed a04 lock/root/member manifests, Rust toolchain declaration, original storage closure, desktop build script and Tauri config; no new manifest or build-script generator. Selected workspace source must remain within the reviewed 32 MiB envelope. Capabilities/icons and remaining critical files join the independent declaration/helper digest. Declaration or generator drift cannot be accepted merely by refreshing the same v1 receipt.
- Existing `debug/deps`, `debug/build`, and `debug/.fingerprint` file contents, through bounded streaming descriptor hashes and canonical path checks. This reads existing artifacts; it creates/copies/deletes none. Old incremental and linked workspace tests remain counted in the original capacity inventory; the incremental tree is not traversed or deleted. Prior linked workspace test EXE/PDB is not treated as a required check input.
- Existing metadata/rlib/DLL population and concrete service/adapters/desktop and serde/tokio/ts-rs/Tauri macro witnesses. Producer envelopes match the reviewed estimate. These are basic presence/admission checks, not a complete freshness certificate. Independent host-cache review remains necessary; content digest comparison detects subsequent removal/change. The prior two-package successful check, unchanged declaration graph, existing qualified registry inputs and matching cached compiler/flags provide that review's source evidence.
- Exact Cargo/rustc/driver file contents from the explicit existing compiler bin. All three are pinned to the observed Rust 1.99.0 toolchain. No PATH-selected Cargo executable or rustup install is allowed.
- Canonical physical source/output/Cargo-home/target/compiler-bin identities; source alias and target alias must identify the same original physical directories. The original remapper verifies registered output alias identity, Cargo-config absence and wrapper/flag restrictions. Its raw bytes are pinned before importing it.
- Exact ordered encoded remap flag hash `38f2a7cedf28808b2c241a34162360c88c417b27e4d10f7a53cd3682bf1f2e27`, plus relevant Cargo/Rust/Tauri/native tool/linker/build environment. Preexisting Rust flag/wrapper overrides, case-conflicting keys, Cargo profile and target/linker/runner overrides refuse. Unrelated credentials are not serialized or hashed by the build-environment projection.

Input hashing includes existing compiled artifacts and can take noticeable time. It creates no duplicate cache and needs no additional disk reserve beyond the small coordinator receipt. Re-capture after deliberate source/input changes and re-review the new facts; never relabel stale facts as current. A changed/missing dependency/codegen graph needs new estimate review or the normal 4 GiB path.

## Real execution path

Only `runReviewedCargoCheck(root, environment, tree, policy)` is called by the canonical gate. The adapter factory is a CPU-test seam; the gate never accepts adapters from environment or receipts.

1. Read the fixed receipt, capture current inputs and compare every independent digest/current Source/policy.
2. Verify raw Source stability again. Resolve the original storage guard with its existing projection/closure checks and call its PowerShell entry with explicit `EstimatedGrowthBytes=2415919104` (2 GiB + 256 MiB). The module pins the original guard closure; it introduces no alternative capacity implementation.
3. Require the original approved native/WSL pair result, 20 GiB ceiling, exact combined growth, complete starting allocation and both physical/paired filesystems retaining 15 GiB after growth. No cleanup retry, workload stop or larger ceiling follows from refusal.
4. Re-read the same receipt and verify Source again. Spawn only the pinned absolute Cargo executable with `check --locked --offline -j1 -p veyra-service -p veyra-desktop`, using cloned environment with incremental 0/jobs 1/offline true and the original remapper's verified target alias. Preserve original cwd and ordinary compiler diagnostics. No linked/test/package command is selectable.
5. Verify Source after completion. Preserve a compiler's first failure if source stability also fails; there is no blind retry or new kill mechanism. Return profile/review digest/tree/growth to the caller. The outer original gate writes its normal success receipt only after all checks pass.

The receipt identity says who performed the independent local review; it is not a cryptographic signature or protection against an actor who can rewrite all trusted local source. The bounded reader and content/source bindings address accidental/stale/redirected inputs within this authorized coordinator workflow.

## Verification and integration boundary

Worker validation: fixture-free CPU tests of receipt/flags/toolchain/alias/config propagation/guard/source-race/failure-order/refusal logic on Windows and WSL; descriptor I/O uses in-memory filesystem adapters. Actual a04 blobs were read; generated patched gate passed Node syntax checking without evaluation and `git apply --check --whitespace=error` without mutation. These are proposal checks, **not** real Native storage/compiled-entry or package/platform acceptance. The real input capture and PowerShell/compiler path have not been run by the worker.

Coordinator sequence: independently inspect the code/model; verify recorded a04 preimages; install the canonical entry bytes and apply the minimal gate patch; include all intended source changes in the actual staged tree; capture safe candidate facts; independently bind/review the existing host/cache/environment and source facts; write the approved fixed receipt inside existing qualification root; acquire the singleton original resource lease and run the actual normal staged gate. Retain compiler/guard/source/first-failure evidence and perform last-consumer cleanup through existing safety rules. A successful check remains source qualification; runtime, voice, visual, persistence, packaging and production release gates remain open.

## Reconciliation

This follow-on retains only seven small owned durable files: canonical module proposal, gate patch generator, CPU tests, minimal gate patch, preimage/hash JSON, this guide, and the current status receipt (status is in the existing coordination directory). Regeneration uses the recorded a04 blobs plus `proposeNativeCheckGate`; no dependency installation is needed. No fixture, scratch, cache, compiler output or dependency copy was generated. Removed paths: none; removed bytes: 0. All protected cleanup targets, including the exact empty Native/frontend-cache parent, remain untouched. No Windows/Linux recovery claim is made.
