# Explicit declaration closure in the original API copier

Source-only proposal, 2026-10-30. Product-facing bot name: **veyra-bot**. Root owns canonical application, actual API compiler/build/package verification and the full release acceptance. This worker did not emit, build, materialize a real distribution or execute application/Core/helper/model/runtime code.

This follow-on preserves the frozen `7d9d7468e73432c2b9e08d99fce4c0985c3f5c70` audit. **Count correction:** that audit's unchanged JSON correctly records **85** original MJS outputs; its guide/messages incorrectly carried the older82 count. The runtime50-reference mapping and package-subpath findings are unchanged. The proposal and tests use the actual original85-entry plan, not the stale prose count.

## One canonical owner and bounded selection

`api-declaration-closure.patch` changes only `services/ingenium-api/scripts/copy-domain-runtime.mjs`. Exact current preimage/postimage hashes and actual Root HEAD are in `api-declaration-closure-receipt.json`. `api-declaration-closure-proposal.mjs` constructs that one in-memory postimage from the actual Root source; no canonical change is applied by this worker.

The original copier retains its existing domains/shared roots, two reviewed release-tool singletons and all six existing compiled-runtime relocation sources. No new glob, root, dependency, compiler include, package export, runtime stub, second copier or source/dependency tree copy is introduced. All original85 runtime source/target/source-hash/emitted-hash rows and the complete original six relocation descriptors compare equal in the tests; this preserves the audit's50 runtime MJS reference mappings.

`api-declaration-closure-inventory.mjs` contains **68 explicit source/target records** with a concrete consumer:

- **65 existing `.d.mts` counterparts of actual original copier runtime outputs.** Their target must equal the SAME runtime target with the declaration extension. A different depth/destination refuses. This includes the existing candidate-intent singleton declaration under the same reviewed tools target; no release-tools directory discovery occurs.
- **`lib/dot-v2/managed-job-contracts.d.mts`**, a declaration-only module used by15 actual source type references. It has no runtime counterpart. It is copied as `.d.mts`; its virtual `.mjs` type-module name is used only to resolve type references. No `managed-job-contracts.mjs` executable is created.
- The two real transitive **`packages/veyra-automation/contracts.d.ts`** and **`packages/veyra-projects/contracts.d.ts`** sources, placed under the same `dist/veyra-packages/<package>/` map. Their `.js` type specifiers remain `.js`; no runtime `contracts.js` stub is fabricated.

The audit's unrelated `services/ingenium-api/lib/selected-state-admission.d.mts` has no concrete matching runtime output or reachable direct type consumer in this selection and is omitted. Its original source is neither changed nor deleted. Future actual consumers require explicit review; no declaration tree is silently discovered.

The ten additional compiler-declaration inputs are exact existing TS consumers of the shared contracts: Dot `commands.ts`, `core-binding.ts`, `existing-jobs.ts`, `installed-dot-scheduler.ts`, `proactive.ts`, `repository.ts`, `request-binding.ts`, `router.ts`, `schedule.ts`, `service.ts`. Only their actual generated `.d.ts` imports are rewritten; their compiled runtime JS is untouched. The original six compiled JS/declaration relocations remain separate and unchanged.

## One map for raw and emitted declarations

The declaration resolver uses the original runtime source→artifact map plus the closed declaration source→target map. It handles static imports/reexports and `import("…")` type references. Existing compiled API TS dependencies resolve to the compiler's normal `.d.ts` outputs, which must exist and are verified rather than copied or synthesized. Bare references retain the actual eight reviewed package/builtin specifiers; unknown forms refuse instead of widening package access or selecting a fallback.

For example, the raw managed-job contract's original `../../../../packages/veyra-operations/core126-image-owner.mjs` is rewritten to `../../veyra-packages/veyra-operations/core126-image-owner.mjs`. Its shared automation contract similarly points to `../../veyra-packages/veyra-automation/contracts.js`. The local `./core-binding.js` remains unchanged because the compiler emits `dist/lib/dot-v2/core-binding.d.ts`. The same rules apply to actual compiler declaration outputs. Already-correct output specifiers are recognized through the same artifact map, so the six existing relocations are not applied twice.

Repeated legitimate type imports, such as two commands imports from the same shared contract, are all rewritten consistently. This is different from duplicate/conflicting source/target inventory records, which refuse. Missing transitive declarations, missing original MJS counterparts, wrong original-runtime depth, unknown relative/package references, nonliteral references and runtime import calls inside declarations refuse; none produces a runtime proxy or empty type declaration.

## Complete planning and write refusal

The same materializer reconstructs the original source plan and compares its source/target/hash/relocation/declaration dependencies before any write. It prepares:

- 85 original runtime MJS postimages;
- 68 reviewed raw declaration postimages;
- 12 original compiler JS/declaration postimages from the six preserved relocation inputs;
- 10 additional compiler-declaration postimages.

That is **175 file rows and one existing `veyra-runtime-closure.json` manifest**, with no duplicate target. The manifest records source and emitted hashes for the same complete set and hashes for verified compiler type dependencies. Planned raw-declaration hash rows in the receipt are real deterministic source transformations, not measurements of emitted build artifacts. Synthetic compiler-output fixture hashes are not offered as actual package evidence.

Every source and required compiler output is read through canonical/no-follow, regular-file, single-link, expected-owner, bounded-size, UTF8 and stable fd/named-stat checks. Changed plan/source hashes refuse. Compiler type-dependency sources and artifacts are rechecked. Before any mkdir/content write/truncation, all output targets and ancestors, existing inode identities and prior content hashes are checked, including unsafe/dangling symlinks and hardlinks. The writer opens the exact target with no-follow/exclusive-create semantics, verifies the descriptor before truncation, writes at explicit offsets, closes descriptors in `finally`, and checks the actual written hash. It never deletes a refused target or retries through another path. Runtime output ownership remains the original build owner's responsibility; protected user or historical state is outside this copier.

## Source-only evidence and actual acceptance

Nine checks cover explicit consumer selection, preservation of original85 runtime rows and six relocation descriptors, same-map raw/compiled type resolution, both shared contracts, missing transitive/wrong-depth/duplicate-map refusal, unknown references, complete preplanning/manifest hashes, legitimate repeated imports, missing compiler input, unsafe output, changed planned hash, source hardlink and changing-stat refusal. The same materializer is exercised **only against an in-memory distribution with explicitly synthetic compiler outputs**. The real original API copier source remains unchanged and the test filesystem cannot write the actual distribution.

The initial test expectation used the stale82 prose count and failed `175 != 172`; it was corrected to derive the expected original runtime count from the actual original plan and retain explicit68/6/10 category assertions. This was an expectation defect, not a reason to remove three runtime outputs. The frozen prior JSON remains intact. Final WSL Node22.23.1 and Windows Node24.18.0 verification is recorded in the receipt. The exact patch passes actual Root `git apply --check` without applying it.

Root must now apply/review the one original-copier postimage and run the actual API compiler and package validation. Check every surviving emitted declaration reference, symbols and external inferred type forms, real175-row manifest, no duplicate targets/stubs and original runtime imports. Actual TypeScript emit may elide references or introduce additional inferred module forms; unknown forms remain a precise refusal requiring owned review, never a permissive package wildcard or source-tree copy. These source/virtual-FS checks do not qualify actual compiler output, module startup, package/runtime behavior or the whole release.

Current110-source/86-image policy is a baseline only. The existing closure-manifest image artifact and copier source hashes must be refreshed from final actual integrated source and artifacts; this proposal generates no candidate-source JSON, observed artifact DTO or approval. Real SQL131/coordinator/waiting-child/private readiness/egress/retirement, all18 actual cases, independent protected approval and full Windows/Linux/Work/Web/CLI/terminal/Git/restore acceptance remain open. Core133/Voice drafts are not imported from docs or assumed installed by this declaration selection.

## Storage reconciliation

Eight small durable owned artifacts comprise this slice: explicit inventory, copier support fragment, proposer, tests, freezer, patch, receipt and guide, all under the existing worker's `docs/workstreams/packaging/`. Its one existing coordination status is updated in place. Root remains their concrete consumer for source review/integration and actual API package acceptance.

Reuse the original C-backed WSL root `/home/brajam/.local/state/ingenium-release/skill-zen-fix-1792810845`. No new checkout/root/drive, source/dependency copy, compiler/cache/temp output or download exists. Source tests use existing process TEMP/TMP/TMPDIR at `veyra-phase-1/coordination/packaging`, NODE_COMPILE_CACHE empty, and VEYRA_DECLARATION_ROOT pointing to actual Root source. Reproduce with `node --experimental-vm-modules --test ./api-declaration-closure.test.mjs`; in WSL, `node --experimental-vm-modules api-declaration-closure-freeze.mjs` writes only this owned patch/receipt.

Cleanup: **removed paths none; measured removed bytes0; new disposable outputs none.** All shared source and original outputs, user/runtime/editor/workspace/backup data, Native targets, Cargo homes/caches, unique failures and prior frozen proposals remain untouched. No Linux filesystem or Windows free-space recovery is claimed.
