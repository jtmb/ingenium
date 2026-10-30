# Core133 startup and qualification-input follow-on

Source-only audit/proposal, 2026-10-30. Product-facing bot name: **veyra-bot**. Actual Root snapshot: `f870c74f91525fe3a09a9fa6bda18d1062994689`. Root owns actual Core/API builds, SQL133/startup verification, final source/image metadata and the full release acceptance. This worker executed no compiler, application/Core/helper/SQL startup, model, network, Docker or CU operation.

## Concrete findings and minimal integration

Current canonical policy has **112 SOURCE_INPUTS / 88 IMAGE_INPUTS** after Root enrolled the raw assistant reader. It omits21 real runtime sources and22 artifacts in the Core133/customize path and invocable API/control-plane/restore roots. `core133-qualification.patch` changes only `packages/veyra-operations/core126-image-contract.mjs`, appending those exact rows to reach **133 source / 110 image** inputs. All previous entries/order, protocol cases, authority rules, scope checks, timing and limits are preserved. Exact current preimage/postimage hashes, row lists and patch hash are in `core133-qualification-receipt.json`; no shared edit was applied here.

The conservative dense metadata-size fixture is **47,977 bytes**, below the unchanged **65,536-byte** protected candidate source-file cap. It is only a size fixture with conservative lengths, not valid source-definition material, an observation or approval. No cap, lifetime or five-second observation deadline was relaxed. Actual final metadata and observation performance remain Root validation.

The additions are runtime implementations or original migration/entrypoint consumers; no optional declaration rows are added in this patch:

| Actual source group | Original artifact owner/path |
| --- | --- |
| Core `customize-catalog-owner.ts`, `customize-scoped-v1-contracts.ts` | Normal Core tsc → `packages/ingenium-core/dist/lib/tools/<name>.js`. |
| Core `plugins.ts`, `plugin-lifecycle.ts`, `plugin-config-text.ts`, `plugin-projection-reconciliation.ts` | Same original Core compiler; local plugin/lifecycle/projection implementations imported by the new catalog path. |
| Core `skills.ts`, `skill-governance.ts`, `hosted-governance.ts`, `hosted-governance-owner.ts`, `hosted-projection-plan.ts` | Same Core compiler; actual catalog/governance/projection chain. |
| Core `node-native-lifecycle.ts`, `paths.ts`, `maintenance-locks.ts` | Same Core compiler; actual indexed lifecycle and implementation dependencies. |
| API `scripts/api-server.ts`, `scripts/runtime-gateway.ts`, `scripts/restore-maintenance.ts` | Normal API tsc → `services/ingenium-api/dist/scripts/<name>.js`. |
| API `scripts/runtime-manager.ts` | Source was already selected; missing emitted `dist/scripts/runtime-manager.js` artifact row is added. |
| API `lib/routes/customize-scoped.ts`, `lib/routes/customize-scoped-v1.ts`, `lib/customize-scoped-v1-proof.ts` | Normal API tsc → corresponding `dist/lib/…js`; actual mounted scoped routes/proof implementation. |
| `packages/ingenium-core/data/migrations/133_customize_scoped_catalog.sql` | Original Core data copy → **`/app/packages/ingenium-core/dist/data/migrations/133_customize_scoped_catalog.sql`**. |

Core table paths are relative to `packages/ingenium-core/lib/tools/`; API paths to `services/ingenium-api/`. Every full exact source/image path and actual source SHA-256 is enumerated in the JSON audit/receipt. These TS files already fall within the original Core/API `include`, `rootDir` and `outDir` policies and existing Docker Core/API dist COPYs. No new compiler include, runtime copier root, wildcard export, helper tree, dependency installation or Docker source-tree copy is required. Core still has only the two existing runtime MJS restore helpers, already covered by its explicit four-file helper/declaration copier.

## Actual startup versus optional type declarations

`packages/ingenium-core/lib/index.ts` now value-exports `customizeCatalog` from `customize-catalog-owner.js`. ESM resolves value exports and their static module dependencies even before a user opens Customize. The namespace is not an inert `.d.ts` declaration. The value-exported `node-native-lifecycle.js` likewise needs a real emitted JS file even though its functions execute only when invoked.

`services/ingenium-api/scripts/api-server.ts` imports the scoped route implementations at top level and mounts `/api/v1/customize-scoped-v1` and `/api/v1/customize`. The scoped-v1 route and proof module value-import `ingenium-core/lib/tools/customize-scoped-v1-contracts`; that existing package subpath must resolve to the original compiled Core JS. The pure-zod runtime schema is not optional type metadata. Manager/gateway roots are invoked by the original runtime-control entrypoint; restore-maintenance is an original invocable supervised restore program, not an assertion that restore runs on every API start.

The original Core migration loader resolves `../data/migrations` from compiled `dist/lib/db.js`. The correct SQL133 artifact is therefore under **dist/data/migrations**. Docker's separate raw migration-source COPY cannot substitute for that actual runtime consumer. Preserve the original migrator, exact SQL133 schema/drift checks and data-copy order; do not create a partial schema or accept missing/drifted migration metadata.

The audit parses83 syntactic Core-index export declarations and follows91 static Core runtime-module sources. Explicit type-only imports/exports are excluded from the runtime walk; ordinary TS imports are classified conservatively until actual emit. `core133-startup-audit.json` preserves all inspected source/observed-output hashes and edges. The selected qualification rows are not presented as every transitive file in Core's broad preexisting barrel. Full-source SHA, package lock, immutable original image/config identity and original readonly/isolation profile remain mandatory boundaries. This follow-on adds the concrete Core133/runtime controls without replanning the entire release graph.

## Current retained outputs are stale

At this read, these actual expected files were absent from the retained existing output tree:

- Core compiled `customize-catalog-owner.js`, `customize-scoped-v1-contracts.js`, `plugin-lifecycle.js`, `plugin-config-text.js`, `plugin-projection-reconciliation.js`;
- API compiled `routes/customize-scoped.js`, `routes/customize-scoped-v1.js`, `customize-scoped-v1-proof.js`;
- Core **dist/data/migrations/133_customize_scoped_catalog.sql**.

Other observed existing output hashes are recorded separately from source hashes; presence does not establish freshness, and TypeScript source/artifact hashes are not expected to be equal. No old retained output is claimed to represent current integrated source or successful startup. Normal original Core/API builds should regenerate these artifacts. This is a build/startup acceptance blocker for using that retained tree as current evidence, not proof that a new copier or source duplication is needed. Root owns safe reconciliation/rebuild of its generated outputs; this worker neither changed nor removed them, nor stopped any service or active build.

## Raw assistant reader already enrolled correctly

Root placed the reader at **`services/ingenium-api/lib/voice-v2/raw-assistant-wire.mjs`**, inside the existing domain root, and enrolled its declaration with the same runtime target. `opencode-client.ts` now imports it from `./voice-v2/raw-assistant-wire.mjs`. The actual original copier's read-only plan has **86 runtime MJS / 69 raw declarations**,155 rows before compiler postimages, and includes both exact reader targets:

- MJS source and planned emitted SHA-256 `b125c50a2130f4de37feca93e05b05f36404dfbf3571fd5ee1d476e2e5ec14aa`;
- declaration source and planned emitted SHA-256 `87a649b35e8f693e704a4a02c834af8d471016c0e8bb35f9e97419961e848891`.

Both target the original API `dist/lib/voice-v2/` directory. They are already in the current112/88 qualification baseline, so this patch does not duplicate or overwrite Root's reader enrollment. No new lib-wide discovery or singleton is warranted. Their planned bytes/hashes are source/planner evidence, not actual compiled distribution or live reader qualification. Already-passed canonical declaration/projection checks were not rerun or reopened by this audit.

## Evidence and remaining gates

The audit reads actual canonical source, parser ASTs, current output existence/hash and the same original copier's **read-only plan**. It checks read inputs again before finalizing. The proposal verifies exact source presence, append-only/unique/no-wildcard input lists and current baseline hashes; unchanged enrollment replay refuses. The exact patch passes `git apply --check` against actual Root source without being applied. There is no new unit suite that merely mirrors these array additions, and no prior actual Core/SQL/projection/API test was repeated.

Root must apply/review the one contract postimage and regenerate **every final actual source and artifact hash/byte count, original image/config identity and source revision/SHA** after all current integration. Then obtain fresh original Core/API package/startup and SQL133 evidence, actual reader behavior, and all remaining release acceptance. No source-definition JSON, observed artifact DTO, qualification result, grant, model execution or approval is generated by these docs. Actual SQL131/coordinator/waiting-child/private readiness/egress/retirement, all18 original cases and independent protected approval remain open. Optional declaration packaging and actual eager runtime artifacts remain separate evidence classes.

## Storage reconciliation

Seven small durable owned files comprise this slice: startup auditor and JSON, qualification proposer/freezer, patch, receipt and this guide, all under existing `docs/workstreams/packaging/`. The one existing coordination status is updated in place. Root is their concrete consumer for source review, input integration and actual build/qualification.

Reuse the original C-backed WSL root `/home/brajam/.local/state/ingenium-release/skill-zen-fix-1792810845`; no new checkout/root/drive, source/dependency tree, build/distribution/cache/temp output or download exists. Reproduction uses existing process TEMP/TMP/TMPDIR at `veyra-phase-1/coordination/packaging`, NODE_COMPILE_CACHE empty and VEYRA_CORE133_ROOT actual Root source; run Node `core133-startup-audit.mjs`, then `core133-qualification-freeze.mjs` in WSL.

Cleanup: **removed paths none; measured removed bytes0; new disposable outputs none**. All shared source, original/active outputs, user/runtime/editor/workspace/backup data, Native targets, Cargo homes/caches, unique failures and frozen prior proposals were preserved. No Linux filesystem or Windows free-space recovery is claimed.
