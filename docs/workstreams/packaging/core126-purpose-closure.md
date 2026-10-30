# Exact purpose/helper runtime closure proposal

Root owns application of this source-only proposal. Packaging wrote only docs/workstreams/packaging. No shared source, canonical tools module, build, distribution, runtime, dependency, cache or download was changed/materialized. The exact patch adds one reviewed singleton and two critical input entries; it does not authorize candidate execution or image approval.

## Patch identity and intended result

Use core126-purpose-closure.patch together with core126-purpose-closure-receipt.json. The pure proposal generator refuses changed preimages and preserves their newline/EOF bytes:

| File | Before SHA256 | After SHA256 |
| --- | --- | --- |
| services/ingenium-api/scripts/copy-domain-runtime.mjs | 029887a063c945a08202e0075313f9f47b7251e5ae649bbe1bc16f90441a5798 | a8bf9fb6132ca61ba099024505b19e8154a07b04e1a133ac37c6763a95848b23 |
| packages/veyra-operations/core126-image-contract.mjs | a904467322ad5ddcc0e0d9084b84c303a0d95eccc5511aa0b7539beb10e0fcdb | 1647f7b5586d18c167029f075c325f4044c069469af1017084c3e4cf057bc253 |

Patch10702 bytes, SHA256006747b08fc8f3439c0177eb3082cc64f9dcc909e47fdf7d4696fdb236afdb03. Root read-only `git apply --check` passed; the worker did not apply it. Independent in-memory hunk application reproduces both exact postimages. Source bytes are not normalized, replaced through a fallback, or copied into a second implementation.

The singleton is exactly `tools/veyra-release/core126-candidate-intent.mjs` -> `dist/veyra-tools/veyra-release/core126-candidate-intent.mjs`. No release-tools directory discovery or recursive copy is added. Normal domain/shared roots, original TypeScript AST/static-string import checking, source/emitted hashing and materializer/manifest remain unchanged. Existing emit logic rewrites the genuine purpose import to `../../veyra-tools/veyra-release/core126-candidate-intent.mjs` and the canonical helper import to `../../veyra-packages/veyra-operations/core126-image-contract.mjs`. Purpose's existing strict parser import remains `./job-bootstrap-frame.mjs`.

New singleton guards require one regular single-link file owned by the same UID as the declared canonical source root, bounded to64KiB, with no canonical alias/symlink escape. Its nofollow/nonblock descriptor is closed in finally. Before/after fd and current leaf dev/inode/size/mtime/UID/GID/mode/link metadata plus canonical path must match. A changed/unsafe target refuses the plan before materialization. Windows UID/stat observations are not a Windows ACL qualification; final actual image root ownership/immutable modes and all existing materializer safety checks remain required. Missing singleton is allowed for unrelated legacy source fixtures, but an actual purpose import then fails the existing outside-reviewed-closure dependency check. Other tools and helper-relative release siblings remain outside the reviewed closure.

SOURCE_INPUTS gains only `services/ingenium-api/lib/dot-v2/core126-purpose.mjs` and `tools/veyra-release/core126-candidate-intent.mjs` (29 ->31). IMAGE_INPUTS gains only `/app/services/ingenium-api/dist/lib/dot-v2/core126-purpose.mjs` and `/app/services/ingenium-api/dist/veyra-tools/veyra-release/core126-candidate-intent.mjs` (25 ->27). The strict bootstrap parser is already present exactly once in each input array and in the original dot-v2 closure, so it is not duplicated. Original SQL129 registration/production purpose guards and the real candidate qualifier remain Root-owned and unchanged by this proposal.

## Verification and regeneration

Twelve focused tests run the original patched planner in memory using the existing read-only TypeScript5.9.3 parser. Synthetic filesystem tests reject broader release tools, missing singleton, computed imports, undeclared packages, symlink/alias/hardlink/owner/size changes, identity races and descriptor leaks; unrelated legacy closure still plans. Actual purpose/helper/parser/contract emitted modules link as a complete in-memory static import graph without evaluating those modules. A missing named parser export fails linkage.

A separate read-only plan against the ACTUAL Root source succeeds on Windows node24.18.0 and WSL node22.23.1:71 modules; no destination is created. Actual helper source SHA2568b170f2ac20d2c151695768d1db1bf10207a6465354393bc51a9a164fe67b1a1 rewrites to emitted SHA2564fe8a52ba855ca6efc3b48cd0628dc25794d6867d684783d60dee4632cf02f8c on both platforms. This is source-plan/link evidence, not a materialized build or runtime acceptance. The first test-driver runs caught an incorrectly appended final newline and a Windows-only VM module URL issue; those driver defects were fixed and are recorded in the receipt. No runtime failure was hidden.

Regenerate with explicit VEYRA_CLOSURE_AUDIT_ROOT pointing to Root's actual checkout, VEYRA_CLOSURE_PLAN_DESTINATION pointing to an uncreated path inside existing coordination/packaging, TEMP/TMP/TMPDIR at that same owned coordination root, and NODE_COMPILE_CACHE empty. Run Windows node `--experimental-vm-modules docs/workstreams/packaging/core126-purpose-closure.test.mjs` directly, or WSL node `--experimental-vm-modules --test` on the same file. Only the existing compatible TypeScript package is read; no npm/install/build is used. Tests accept only the exact recorded preimages or exact postimages; postimages reverse the frozen patch in memory and revalidate the original preimage plus proposed postimage. Arbitrary changed source still refuses. The generator can regenerate the patch from exact preimage bytes without writing shared source.

## Output reconciliation and remaining gates

Retain only the small generator, test, minimal patch, guide and exact receipt for Root's application/review and closure regression consumer. One existing coordination status is updated in place. No scratch/distribution/source snapshot/dependency/cache/temporary directory was created. The named domain-plan-not-materialized destination was verified absent before and after actual source planning on both platforms. Removed paths none; removed bytes0. Existing protected Native/dependency/failure targets are untouched; no disk recovery claimed.

Root must apply/review the exact shared changes, preserve sole ownership of the canonical helper and qualify actual emitted closure/image bytes. The original candidate lease, all18 real inert cases, positive same-manager retirement, independent protected approval and complete release acceptance remain open. This source closure fix cannot fabricate or replace any of those gates.
