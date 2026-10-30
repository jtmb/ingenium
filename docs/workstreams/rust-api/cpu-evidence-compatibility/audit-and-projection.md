# Root CPU capture/converter compatibility

Public source audit only. No private Root case, grant, profile, closure, token or model file was read. No approval converter, model, runtime, build, process-control, native, Windows, DB or CU action was executed. The raw capture is preserved as authoritative evidence; the proposal changes a future decoder/review schema, not those captured bytes.

## Grounded compatibility defects

Inputs: Root phase/qualify-cpu-models-r1.mjs SHA256 `e662fa81cd3709e9581c9b5c020731d204cbbb5c6bd02fdfed1cc3d6a8e981ac`; actual converter docs/workstreams/voice/cpu-qualification/evidence-to-approval.mjs SHA256 `148251806cf9333209822b17ddd93941b5f17d84d4c65622fa1fb9d62550a86f`.

| Actual producer | Current converter requirement | Consequence |
| --- | --- | --- |
| Driver15/24 places sampled actualHostAvailableBytes and descriptive purpose in bindings. run-envelope85-86 copies grant.bindings unchanged. | run() compares canonical(value.bindings) with the entire shared review bindings for all five cases; coreWire bindings use the same equality. | Genuine per-case host observations/purpose can differ while configuration is identical. A shared whole-object binding cannot represent those differences without rejecting genuine captures or copying facts across cases. Other actual case receipts were not inspected. |
| Driver24 uses installedClosureSha256=SHA256(raw installed-closure.json). | Converter generateApproval requires bindings.dependencyClosureSha256 to match the loaded raw closure digest. | Exact raw binding equality and the required differently named key cannot both hold for the emitted model binding. Adding/renaming the field in a raw receipt would change original evidence. |
| Driver24 has no binding.kernelBootId. kernel-owner.c216 emits actual bootId in kernelOwner. | Converter compares review bindings.kernelBootId to cold.owner.bootId after requiring identical full raw bindings. | Keeping the actual binding shape leaves the required value undefined; adding it only to review breaks equality. The boot source must be the original kernel-owner field, not a fabricated binding entry. |

The public verify-environment output really is version1 with allRecordHashesVerified, environmentSealed, files and bundledVad. Its installed closure filename/hash is the same semantic artifact intended by the converter's dependency closure check. The driver's kernelSourceSha256 matches the actual public kernel-owner.c hash `1275dd230f10756d1f651e650f5b9f7195712ae836492bfe92c0cdf766f147d3`; no kernel source mismatch was found in that comparison.

## Strict stable identity projection

Use a versioned decoder/review contract rather than silently changing the meaning of full bindings equality. For the known model receipt version1, require the exact eleven raw binding keys emitted by the public driver:

```text
owner, kernelSourceSha256, profileDigest, helperSha256, witnessSha256,
codeBundleDigest, modelManifestSha256, modelSetDigest,
installedClosureSha256, actualHostAvailableBytes, purpose
```

Validate closed plain data, digest formats and field types before canonicalization. Reject unknown/missing/duplicate keys and ambiguous JSON. A future producer with another key set needs its own explicit source-pinned schema adapter; do not silently drop new fields. This audit does not establish the key sets of unread helper/witness/probe/wire receipts.

### Supported public probe source variant

Subsequent public source inspection adds an explicit second variant: phase/qualify-cpu-resource-probe-r1.mjs SHA256 `e1103ac06a98f675a93c41c8da163513928b713f7f342e81446a2ed5de7280b8`, bindings line15. Its exact ten keys are:

```text
owner, kernelSourceSha256, kernelBootId, profileDigest, helperSha256,
witnessSha256, codeBundleDigest, modelManifestSha256, modelSetDigest,
installedClosureSha256
```

The model producer remains unchanged with its eleven-key schema. Even on the same boot/configuration, these two genuine shapes cannot satisfy the current whole-binding equality. Both envelope receipts use version1, so dispatch adapters by the Root-reviewed case AND source/producer schema identity, not version alone or a permissive test for whichever fields happen to exist. Name the decoders explicitly, e.g. model-r1-bindings and resource-probe-r1-bindings; neither decoder grants approval. Require the probe's additional binding.kernelBootId to agree with its actual kernelOwner.bootId and the reviewed common kernel environment. The legacy model has no such binding key and must use its actual kernel owner instead. Stable configuration projection remains identical; environment comparison remains mandatory.

Probe source borrows kernelSourceSha256 and modelSetDigest from the original model capture. Root's review must hash-link that original evidence and compare the independently pinned kernel/model identities; this does not make the probe a model remeasurement. Its installed closure remains a raw-file hash requiring the same explicit proven alias mapping.

The driver checks a freshly sampled available value before invoking the envelope but does not explicitly serialize that number into its bindings, grant/storage/result. The public probe child records memoryHeadroom and capacityOriginal, not hostAvailable. If a separate original operator preflight records the number, link its exact raw hash; otherwise mark that numeric fact unavailable. Do not copy the old model sample, resample later and backdate it, or equate headroom with raw host availability. Root review must distinguish original guard/finite-limit proof from an actually retained numeric sample. This does not invalidate the finite leaf/control/hash/positive-join observations; it bounds the measurement claim.

Root reports probe case314f98d3-be87-416b-a7c3-a9680e9d2e0c passed in446ms with memoryPeak44130304, leaderMaxRss89849856 and pidsPeak7 plus positive joins. Those numbers are coordinator-reported, not independently read here. Aggregate kernel charge peak, leader RSS and the actual enforced hard limit remain different quantities. This case supplies no model import, production wire or approval evidence. Other helper/witness/wire raw schemas remain unverified by this audit.

Project the following stable object for equality across all cases, the approved review configuration and the separate genuine Core wire receipt:

```text
kind: root-cpu-configuration-v1
profileDigest, codeBundleDigest, helperSha256, witnessSha256,
modelManifestSha256, modelSetDigest, kernelSourceSha256,
dependencyClosureSha256
```

The final field is derived ONLY by the known version1 mapping from raw bindings.installedClosureSha256, after checking equality with SHA256 of the exact protected raw installed-closure file. The canonical review field and every case must identify that same raw artifact; preserve allRecordHashesVerified/environmentSealed/VAD checks and compare the VAD digest to the independently pinned expected artifact. Do not hash a renamed/reformatted closure object or supply an absent digest from a default. If another declared schema contains both closure names, require both to agree; never select whichever passes. The loaded protected profile continues to bind interpreter/settings/thread/address-space/source identity; retain existing exact profile/helper/witness/code/model asset validation.

The custodian owner is provenance, not a technical configuration field to ignore: validate it separately against Root's explicit expected owner/grant/registered task ownership for EACH case. The remaining two raw fields also remain mandatory separately validated evidence, not discarded fields.

## Per-case facts and kernel environment

A new Root review should identify each actual receipt and original grant by path AND raw SHA256, expected case/schema/purpose, expected original producer command/input closure, expected hard limits and host reserve. Reading remains protected-custody/hash validation. Validate each original run ID and its kernel owner independently, with unique case/run evidence and the existing positive exit/close/stdout/stderr/wait/empty/leaf-removed/no-deadline-kill requirements. A purpose string is descriptive provenance, not permission or proof of a passing case; it must match that case's reviewed original grant, not a common free-text value copied from another case.

- actualHostAvailableBytes is a safe positive sampled preflight number. Check it against that SAME case's original hard memory limit plus original host reserve and grant freshness. Do not require equality across time, use it as a future live capacity promise, or substitute it for the concrete live resource probe. The receipt currently retains grantSha256/hardLimits; the new review must link the actual original grant or equivalent hash-bound original preflight rather than inventing an omitted reserve value.
- Require each kernelOwner.bootId to be a valid actual boot UUID and each namespaceInode a positive safe integer of the declared producer schema. Compare all five cases against a separately explicit reviewed kernel environment. Do not put boot identity into stable code/model configuration or write it into old bindings. If a declared later producer also records a binding boot ID, require agreement with its original kernel record. Missing/malformed boot or namespace must fail; equality of two undefined values is not evidence.
- Match kernel readback memoryMaxBytes/pidsMax/cpuQuotaUsec/cpuPeriodUsec to that SAME case's original hardLimits.memoryBytes/pids/quotaUsec/periodUsec. Validate positive integer peak/counter/limit values and the existing no-OOM/no-limit-hit/full-workload constraints. Do not require equal hard limits across different cases unless the reviewed protocol calls for it, and do not infer an aggregate hard RAM guarantee from leader RSS/private commit. Actual aggregate kernel peak and enforceable bound remain distinct from sampled process metrics.
- Keep raw phase records/log hashes attached to their own original run and source-pinned command. Validate required unique cold-ready/before-hot/after-hot and actual wire phases, ordering/identity and bounded counters before deriving components. Any missing, failed, truncated, reused or unmeasured phase stays unavailable. Do not clamp missing/zero components into positive guesses or alter the existing conservative peak arithmetic to make approval pass.

The separate Core wire receipt must keep actualCoreWriter, allCpuV2ReceiptsVerified, originalHelperAndWitnessJoined, controlAndLeavesRetired and fixturesUsed:false, actual full-payload production-wire phases and the real private original scope/retention evidence. Compare its stable configuration through the same explicit decoder, and validate its own actual environment/case provenance separately. A stable projection is only configuration equality; it grants no authority and cannot turn model-only or fixture evidence into Core wire acceptance.

## Raw identity and review remain mandatory

Root approves a NEW versioned review manifest that references the preserved raw receipt, grant, closure, stdout/stderr and actual Core receipt hashes. The qualificationDigest must continue to include those original raw hashes, plus the explicit projection-schema version/canonical configuration and reviewed per-case mappings. Never overwrite/re-serialize old captures, rename their fields in place, copy an old sample into another run, or replace original hashes with only a normalized digest. Existing protected approval custody, actual nonroot API UID, exclusive output/no-overwrite semantics, genuine helper/witness/positive joins, Core/parent retirement and Root review stay in force. Five genuinely complete cases remain required; this audit supplies none of them.

To validate proposed adapters against actual remaining cases, Root may supply sanitized version/kind/case and bindings KEY SETS, kernel boot/namespace/readback field TYPES, closure artifact kind/version and the Core receipt schema; no private paths, secrets or model contents are necessary. Until then only the public model producer compatibility is established here. No claim is made that all remaining actual captures fit a proposed schema.

## Suggested source-only acceptance cases

The same immutable configuration with different valid per-case host observations/purposes must project equally while both observations are retained and checked. Changed profile/code/model/helper/witness/kernel-source/closure must reject. Closure alias disagreement, absent/changed actual boot/namespace, unknown binding keys, wrong case/purpose/grant/hard-limit readback, invalid peaks, any missing join, OOM/limit-hit or incomplete actual Core wire evidence must still reject before an approval is emitted. Fixture-only schema tests must never mint an approval. These are proposed tests, not executed runtime qualification.

Only this minimal durable map and one source-hash/ownership receipt plus in-place status are retained under the existing owned docs and same C-backed coordination/rust-api root. No private capture was read, no new dependency/cache/build/disk DB/test fixture or approval was generated, and no existing evidence was rewritten. Removed paths none; removed bytes0. Prior rejected cleanup targets remain untouched; no disk recovery is claimed.
