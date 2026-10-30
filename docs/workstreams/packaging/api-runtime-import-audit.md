# Read-only audit of all API TypeScript runtime imports

2026-10-30; product-facing bot name: **veyra-bot**. Actual Root HEAD at the stable audit was `70a670cefbc509ce1652ff9acbf8e2bee2196d19`; the observed candidate list remains **110 source / 86 image** inputs. Canonical Core133/Voice drafts were not imported from docs or assumed installed.

**No omitted or misrelocated static runtime MJS dependency was found in this bounded audit.** The concrete gaps concern packaged declarations: raw declaration files are not copied by the MJS copier, and cross-root paths inside several declarations are not relocated. This does not prove that API source compilation fails: tsc can resolve declarations in the source tree while producing an incomplete declaration distribution.

`api-runtime-import-audit.json` is the exact machine-readable enumeration, with 337 source/observed-target fingerprints, source lines, original specifiers, type/runtime classification, original copier targets and package export resolution. `api-runtime-import-audit.mjs` reproduces it without a compiler/build/emit/materialization. No canonical patch is proposed or applied by this audit.

## Complete source enumeration and runtime mapping

The auditor read all **199 `.ts`/`.mts`/`.cts` files, including declaration files**, recursively beneath actual API `lib` and `scripts`. This is audit-only enumeration; it changes no compiler/copier root, glob, package export or output. It parses imports, reexports, import types, literal require/import-equals and dynamic imports with TypeScript5.9.3's parser. It calls the **same actual original copier** as a read-only planner: 82 MJS entries and six reviewed TypeScript relocation inputs. It never calls a materializer.

Results: 123 MJS reference sites, 50 runtime sites and 73 type/declaration sites; all50 runtime sites map to the exact original copier targets. Across roots there are16 MJS sites: seven runtime, two type-only references in regular TS files, and seven references in six raw `.d.mts` files. These are all16, not just the six relocation input filenames:

| API-relative source:line | Cross-root dependency | Class / result |
| --- | --- | --- |
| `lib/dot-v2/core126-actual-factory.ts:5` | `packages/veyra-operations/core126-image-owner.mjs` | Type only; reviewed relocation maps its declaration reference. |
| `lib/dot-v2/core126-installed-image-owner.ts:1` | `packages/veyra-operations/core126-candidate-observation.mjs` | Runtime; correctly relocated. |
| `lib/dot-v2/core126-installed-image-owner.ts:6` | `packages/veyra-operations/core126-image-owner.mjs` | Runtime; correctly relocated. |
| `lib/dot-v2/core126-runtime.ts:3` | `packages/veyra-operations/core126-image-owner.mjs` | Type only; reviewed relocation maps its declaration reference. |
| `lib/dot-v2/dot-original-context.ts:2` | `packages/veyra-operations/core126-candidate-observation.mjs` | Runtime; correctly relocated. |
| `lib/dot-v2/managed-job-contracts.d.mts:1` | `packages/veyra-operations/core126-image-owner.mjs` | Raw declaration not copied/relocated. |
| `lib/dot-v2/managed-job-contracts.d.mts:2` | `packages/veyra-operations/core126-agent-material.mjs` | Raw declaration not copied/relocated. |
| `lib/projects-v2/execution.d.mts:2` | `packages/veyra-projects/domain.mjs` | Raw declaration not copied/relocated. |
| `lib/voice-v2/core-operations.d.mts:2` | `packages/veyra-voice/session.mjs` | Raw declaration not copied/relocated. |
| `lib/voice-v2/current-agent.d.mts:1` | `packages/veyra-voice/session.mjs` | Raw declaration not copied/relocated. |
| `lib/voice-v2/managed-cpu-speech.d.mts:2` | `packages/veyra-voice/session.mjs` | Raw declaration not copied/relocated. |
| `lib/voice-v2/managed-supervisor.d.mts:2` | `packages/veyra-voice/session.mjs` | Raw declaration not copied/relocated. |
| `lib/voice-v2/request-context.ts:12` | `packages/veyra-voice/session.mjs` | Runtime; correctly relocated by Root's sixth reviewed input. |
| `scripts/runtime-manager.ts:1` | `packages/veyra-operations/core126-candidate-observation.mjs` | Runtime; correctly relocated. |
| `scripts/runtime-manager.ts:2` | `packages/veyra-operations/core126-manager-proof.mjs` | Runtime; correctly relocated. |
| `scripts/runtime-manager.ts:3` | `packages/veyra-operations/core126-image-contract.mjs` | Runtime; correctly relocated. |

All paths in the first column are beneath `services/ingenium-api/`. The JSON preserves every exact relative import string and the source SHA-256, and all123 local/cross-root MJS reference sites. The runtime targets above are the single existing `dist/veyra-packages/<package>/…` instances; no symlink, second source tree, wildcard export or duplicate release helper is needed for these runtime sites.

There is one computed import: `scripts/runtime-job-mcp.ts:5` imports `entry.href`. The actual source binds `entry` directly to the fixed `file:///app/packages/ingenium-extension/dist/scripts/job-run-mcp-transport.js`, and that exact image path is already in the current86-item image list. The audit records this source-bound URL rather than guessing a caller-selected import. It does not execute the transport or claim the actual container file is qualified.

## Concrete declaration omissions and misrelocations

Every one of the123 MJS references reaches an existing `.d.mts` source. There are **42 unique directly referenced declaration files**. None is an entry in the MJS-only copier. Fifteen type-only references specifically resolve to `lib/dot-v2/managed-job-contracts.d.mts`, which has no executable `.mjs` counterpart and therefore cannot appear through a runtime-MJS-only copy rule.

Tracing all existing API input declarations and declaration counterparts of the same82 planned runtime MJS modules gives a closed reviewed inventory of **69 declaration files: 67 `.d.mts` and two `.d.ts` (53 API,16 shared)**. These exact source/hash/expected-target rows and their relative dependency edges are in `declarationClosure`; no glob was added to any build. The current six-file relocation code only plans original compiler JS/generated `.d.ts` postimages for those six TS inputs. It neither copies raw `.d.mts` files nor closes their type-only dependencies.

The declaration graph has18 concrete cross-root edges requiring relocation. Local references from `.d.mts` to ordinary API `.ts` sources are correctly modeled as compiler-generated `.d.ts` outputs and **are not** reported as broken relocation. For example, `managed-job-contracts.d.mts → ./core-binding.js` can resolve to generated `dist/lib/dot-v2/core-binding.d.ts`; it needs no cross-root rewrite. This distinction prevents overstating declaration defects.

Examples that do need packaging work:

- `managed-job-contracts.d.mts:1–2` must reach `dist/veyra-packages/veyra-operations/core126-image-owner.d.mts` and `core126-agent-material.d.mts`; unchanged `../../../../packages/…` from `dist/lib/dot-v2` instead points into the wrong `services/packages` tree. Current source hash: `ec547e53a21836ba29933fc8545093852f5ca65f997a9fe6cf9d8592b320f29b`.
- `projects-v2/execution.d.mts` and four voice declaration files in the table have the same depth problem. A raw declaration copy alone would preserve the wrong specifiers.
- **22 additional type-only cross-root `.js` reference sites** in actual API TS/declarations target `packages/veyra-automation/contracts.d.ts` or `packages/veyra-projects/contracts.d.ts`. The current relocation routine only handles `.mjs`; those two `.d.ts` files are also outside the MJS-only copy set. Source hashes are respectively `864f1ccff6bc79086741ec6040706119db3168fca466ae94179f573d9239742b` and `80f1f4eaa6f90c3c8381ed74d7087ab9f49f388d7fc50ae75a3827701fd174f4`. Preserve `.js` type specifiers where appropriate while mapping them to the declared shared destination; no runtime JS stub or invented module is warranted.

The22 source sites and18 declaration-graph edges overlap; they are not additive counts of unique failures. Some type references can be elided by actual declaration emit. Root must inspect final emitted declarations to distinguish surviving obligations; no compiler emit occurred here. Existing API dist files were not treated as current build acceptance.

If packaged declarations are retained/consumed, the narrow integration target is the **same existing copier** with an explicitly reviewed declaration-file list/dependency closure, import rewriting to the same destinations, inclusion of the two real shared `.d.ts` contract inputs and source/emitted hashes in its one manifest. This audit supplies the inventory and exact hashes; it does not broaden roots/wildcards, copy source/dependency trees, add runtime stubs, create a second copier or choose Root's final implementation. Actual output-type resolution remains an acceptance gate distinct from runtime MJS mapping.

## Actual package wildcard subpath resolution

Nine reference sites use eight unique existing workspace subpaths. Node22.23.1 ESM `import.meta.resolve` ran with an explicit emitted API-parent URL and `--experimental-import-meta-resolve`; the target modules were **not imported or executed**. Every returned path matches its package's current `exports.import` mapping, exists, and has a current adjacent declared type target. The JSON records actual target hashes and the relevant package manifest hashes.

| Existing specifier | Actual package runtime target |
| --- | --- |
| `ingenium-core/lib/schema` | `packages/ingenium-core/dist/lib/schema.js` |
| `ingenium-core/lib/tools/context-snapshot-import` | `packages/ingenium-core/dist/lib/tools/context-snapshot-import.js` |
| `ingenium-core/lib/tools/context-conversations` | `packages/ingenium-core/dist/lib/tools/context-conversations.js` |
| `ingenium-core/lib/tools/projects` | `packages/ingenium-core/dist/lib/tools/projects.js` |
| `ingenium-core/lib/tools/settings` | `packages/ingenium-core/dist/lib/tools/settings.js` |
| `ingenium-core/lib/tools/runtime-original-provision` | `packages/ingenium-core/dist/lib/tools/runtime-original-provision.js` (two sites) |
| `ingenium-core/lib/tools/voice-operation-ledger` | `packages/ingenium-core/dist/lib/tools/voice-operation-ledger.js` (type-only declaration source site) |
| `ingenium-email/lib/credential-crypto` | `packages/ingenium-email/dist/lib/credential-crypto.js` |

The extensionless specifiers match existing `./lib/* → ./dist/lib/*.js` mappings; no double extension or missing wildcard target was found. Do not add a broader export wildcard to address the declaration-copy gap. Core manifest SHA-256 is `318ae35b9483b94b396287b493a8084fd9d2d3ed847e594b0ebf72c831199eec`; email manifest is `beac36adfa5516de0b1af9355be73fff10c4f53064c6eae064e0e8ff2a40ff50`. Actual copier source SHA-256 is `d7e7145bc530fdf71f81d00bae36dc74c5e2c79ce69ec8fd41bdce3c34f2d69b`.

These are read-only resolution/existence observations of current original package outputs, not named-export, side-effect, startup, API server or package qualification. Source syntax can also import a name used only as a type without explicit `type`; AST runtime classification is conservative until actual emit is inspected.

## Evidence, reproduction and preserved gates

The auditor checks every source/observed package-target hash again before finalizing. It uses TypeScript's parser and the actual original copier's read-only plan; it invokes no compiler/emitter/transpiler, npm, database, Docker, network, target module, model or CU. Explicit-parent Node ESM resolution is required so the tool cannot accidentally resolve from the worker chat's own package context. Source/declaration path-model checks distinguish `.ts → .d.ts` compiler outputs from `.d.mts` copies.

Regenerate with the existing WSL Node22.23.1, process-scoped `TEMP`, `TMP` and `TMPDIR` set to the existing `veyra-phase-1/coordination/packaging`, `NODE_COMPILE_CACHE` empty, and `VEYRA_API_IMPORT_ROOT` set to the actual Root source. Run `node --experimental-import-meta-resolve <owned-worker>/docs/workstreams/packaging/api-runtime-import-audit.mjs`. The script writes only its one owned JSON report beside itself; it never materializes the planned distribution.

Root still owns the actual API build, emitted JS/declaration and package-resolution validation, complete startup/runtime/restore workflows, final actual source/image metadata refresh, SQL131/coordinator/readiness/retirement, all18 actual cases and independent protected approval. Current110/86 metadata is a source-list baseline, not approval. No uninstalled Core133/Voice draft is used to fill a missing path or close a gate.

Cleanup inventory: three small durable owned artifacts (script, JSON and guide) under existing `docs/workstreams/packaging/`, plus the single existing coordination status updated in place. Root is the consumer for source review/integration and final artifact acceptance. Reuse the original C-backed WSL task root `/home/brajam/.local/state/ingenium-release/skill-zen-fix-1792810845`. No source/dependency copy, alternate drive/root, new checkout, build/distribution/cache/temp output or download was created. **Removed paths none; measured removed bytes0; disposable outputs none.** Protected original outputs, user/runtime/editor/workspace/backup data, Native/Cargo/cache/failure evidence and prior frozen proposals remain untouched. No Windows free-space or Linux filesystem recovery is claimed.
