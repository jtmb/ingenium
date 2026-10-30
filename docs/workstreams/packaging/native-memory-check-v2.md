# Canonical Memory v2 check branch proposal

This is an exact follow-on delta for Native `tools/reviewed-cargo-check.mjs`, preimage SHA `c2404104d92c3e1f803bb5d7f3272674ec2dc6f8a9d1cd0c59f52822227aacbd`. It adds an explicit, tightly pinned Memory v2 capture/review branch. V1/default behavior, its literal pin table, the original 4 GiB fallback paths, common original storage/descriptor/cache/compiler/config/environment checks and the fixed Cargo command remain. No Native/shared write, resolver/capture/compiler/build invocation or active-stage progress query was performed by this worker.

`native-memory-check-v2.patch` is the minimal canonical delta. `native-memory-check-v2.json` records exact before/after/fragment/patch hashes and the actual resolution witness. The generator reconstructs c240 from the unchanged owned e5 baseline plus its accepted Source batching delta, admits only that raw c240 hash, and changes exact single-use anchors. No duplicate full canonical module or Native checkout is retained. The fragment is **inline-only source for the generator**, not a standalone entry or Native runtime dependency.

## Actual resolver contract

Root actually ran offline Cargo metadata (with dependency resolution, without `--no-deps` or compilation). Its r2 receipt is 1,043 bytes, raw SHA:

```text
6665747af0de1fce18bffe6ba72b2e4e982553536a5f7c8c49196dece2aa90cb
```

It is the existing immutable file `PHASE/coordination/integration/native-memory-lock-resolution-r2.json`. The actual lock is SHA `a5b1f51eb57f93d553abe9d5d428db773fc4e4d43d55dd1269443a3af058fd07`, matching the narrow c9 Memory projection. The receipt records before a7, exact `metadata --offline --format-version 1 --filter-platform x86_64-pc-windows-msvc` argv, Root owner, code 0, compiled false, actual/expected a5, registry unchanged and completed resolution. The worker read this immutable receipt and hashed its real bytes; it did not run the resolver. Root's r1 unchanged-lock failure remains original evidence and is never selected or reinterpreted.

The proposal binds this **existing actual r2 receipt**, not the earlier proposed new qualification witness. No duplicate witness file is requested. Its location is derived from the canonical Source root's PHASE parent, then checked inside `VEYRA_EXISTING_WSL_TASK_ROOT`. There is no caller receipt-path setting. Existing bounded descriptor reading validates the canonical paired-root ancestors, single-link plain file, size, open/path identity, race/EOF and close behavior. The exact raw hash prevents a caller's boolean-only or projected-lock record from substituting for Root's actual evidence.

Semantic checks additionally require the actual recorded owner, successful offline resolution argv, before/after digest and unchanged registry result. Current Source `Cargo.lock` is independently raw-hashed and must still equal a5. The old resolver allocation/reserve is **not** compiler capacity evidence; the original fresh paired-root guard still runs with 2 GiB + 256 MiB before compilation.

## Selection and pinning

- `CHECK.profile` stays v1. Two-argument `captureCargoCheckInputs(root, environment)` defaults to v1 and still rejects the Memory declarations. Unknown profile names, objects or caller-supplied pin/command data are not accepted.
- V2 is selected only by the exact known third capture argument `MEMORY_CHECK_V2.profile` (`native-cargo-check-memory-existing-inputs-v2`), or by that exact profile in the fixed independently approved main receipt when the normal gate runs. No environment selector is added. Root may use `cargoCheckReviewFacts(await captureCargoCheckInputs(root, environment, MEMORY_CHECK_V2.profile))` for safe candidate facts; both approval booleans remain false.
- V2 overlays only the four c9 declaration posts (root/adapters/service/Memory), the a5 lock and the one new Memory manifest path. All other old pins, generators and unknown-manifest refusals remain. The original v1 literal map is not altered globally; its local per-call selected overlay exists only for v2.
- Memory library source explicitly joins the original selected-workspace 32 MiB accounting, with its own 128 KiB envelope and required `src/lib.rs`. Its new workspace metadata is expected; no preexisting Memory `.rmeta` is demanded. The eight-lane Source hashing and original per-file checks remain unchanged.
- V2 checks the four c9 actual compiled serde/serde_json/sha2/serde_derive witnesses. Raw fingerprint SHA binds feature/compiler/profile/ordered flags without rounding u64 fields through JavaScript numbers. The fingerprint JSON uses the existing bounded plain-file reader; compiled artifact descriptor hashing and byte count remain required. Missing/drifted feature, profile, flags, fingerprint or artifact refuses. Existing full cache traversal stays unchanged, and its digest is additionally combined with these v2 facts. V1 retains its exact original cache digest semantics.

The actual lock delta was already confirmed by Root to be one path package and two consumer edges. No new registry or host-codegen graph is permitted. Any further Projects/Memory declaration/feature/generator/lock change needs another exact review; refreshing a boolean cannot widen v2.

## Main receipt and verification

The main file remains `<registered Native>/qualification/reviewed-cargo-check.json` with the original v1 schema. A v2 main receipt has exactly the original fields plus:

```json
{
  "profile": "native-cargo-check-memory-existing-inputs-v2",
  "memoryLockResolutionSha256": "6665747af0de1fce18bffe6ba72b2e4e982553536a5f7c8c49196dece2aa90cb"
}
```

This is an illustration of the extra fields, not a complete or approved receipt. Capture must explicitly report v2, actual current lock a5 and the same actual r2 witness hash; stale Source/tree/policy or any independent input digest mismatch still refuses. A v1 receipt cannot carry the extra field and a v2 receipt cannot omit it. Unknown command/policy/path fields remain rejected.

The runner reads the fixed main receipt, forwards only its validated enum to capture, validates current independent facts, checks Source, invokes the unchanged original guard, re-reads the unchanged main receipt and verifies Source again. For v2, it then re-reads/validates the fixed actual r2 witness immediately before the unchanged pinned Cargo launch. Missing verification or changed/unsafe/wrong witness refuses before the compiler. The original post-compiler Source check and first-failure preservation remain. No real resolver, alternate guard, arbitrary argv or automatic approval path is introduced.

All common source/physical roots and aliases, compiler/driver, original remapper/config/wrapper restrictions, encoded flags, native environment, cache and receipt checks remain. The shared guard's 20 GiB ceiling, both 15 GiB floors and explicit 2 GiB + 256 MiB estimate are unchanged. Head/CI/default/other operations retain the existing generic branch because no feature-gate or general storage script is patched here.

## Verification and Root use

Fifteen new fixture-free CPU cases exercise v1/v2 selection/schema, exact pin overlay, Source accounting, actual r2/current-lock requirements, failed `--no-deps`/changed witnesses, fixed path containment, compiled feature checks, independent Source/input drift, pre-launch verification, first compiler failure and safe unapproved facts. A boolean-only in-memory resolver file is rejected by its real raw hash after the descriptor closes. The patch is applied/reconstructed entirely in memory; definition-only import and syntax checking invoke no capture/guard/compiler. Existing v1 refusal tests remain alongside these cases.

Root must independently review then apply only to the exact c240 preimage, stage the intended actual Source (including the actual resolved lock), and capture explicitly as v2. Preserve the existing independent host/input review and approve the fixed main receipt only for that current tree/raw Source/current cache/environment/physical identities. The existing actual r2 receipt can remain immutable for implementation-only changes with this same pinned graph; the main source/input review must be fresh. Root owns real apply/check, source freeze, capture, original guard, compiler execution and final runtime/platform acceptance. No actual Native execution is claimed by this proposal.

## Reconciliation

Six small durable owned files are retained: inline fragment, exact patch generator, tests, canonical patch, hash/actual-witness metadata and this guide. Their consumer is Root independent review/integration and the next exact check. Regeneration uses existing owned e5 + accepted batching helper to reconstruct c240, then the exact v2 generator. No full module snapshot, cache, dependency copy, filesystem fixture, scratch or new root was generated. Removed paths: none; removed bytes: 0. Every protected cleanup exception remains untouched. No Windows/Linux recovery is claimed.
