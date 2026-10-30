# Same Core build-owned restore runtime closure

Source-only packaging follow-on, 2026-10-30. Product-facing bot name: **veyra-bot**. Root owns canonical edits, original Core build/materialization, genuine Core132/signed restore/maintenance regression and final release acceptance. No worker helper, Core, database or model runtime was executed.

## Concrete missing-output defect

Original `packages/ingenium-core/package.json` builds with `rm -rf dist && tsc && cp -r data dist/data`. Its TypeScript configuration includes `lib/**/*.ts` and `data/**/*`, has `outDir: ./dist`, and does not enable MJS emission. Actual `lib/tools/backups.ts` imports the existing learned-memory restore helper and the newly integrated voice attachment restore helper; the original compiler does not copy their `.mjs` or `.d.mts` source files. The API domain copier does not own Core's `lib/tools` distribution.

The read-only existing `packages/ingenium-core/dist/lib/tools/backups.js` is 136285 bytes, SHA-256 `28712a2b301576911ac17707911b6bcd10f383643e725280762b4d480894c753`. It predates both helper imports and is **not current build evidence**. The receipt records its actual observed import list separately from current source-required specifiers. Node's resolver, anchored at that original output location and without executing any module, reports `MODULE_NOT_FOUND` for both current required `./learned-memory-restore.mjs` and `./voice-attachment-restore.mjs`. This grounds the output layout and missing targets; it does not claim the stale compiled file already contains those imports.

## Four exact proposed source edits

`core-runtime.patch` proposes:

1. Add **`packages/ingenium-core/scripts/copy-core-runtime.mjs`**, the closed original Core build helper.
2. Change only Core's existing build-script string to `rm -rf dist && tsc && node scripts/copy-core-runtime.mjs && cp -r data dist/data`. Keep the original compiler, cleanup, data copy, dependencies, exports and package files policy. No additional compiler include, allowJs option, dependency or lockfile update is needed.
3. Append seven actual source and seven artifact rows to `packages/veyra-operations/core126-image-contract.mjs`, moving current **103→110 source** and **79→86 image** inputs. Do not reuse the old103 source hashes as an approval.
4. Add a fixed seven-artifact filesystem check to the current VS Code-free Dockerfile, after its existing Core distribution COPY. Reuse that original single COPY; do not add another source/dependency tree or a parallel API-owned copy of Core helpers.

Exact preimage/postimage hashes, actual Root HEAD, current helper/restore input hashes, patch checksum and old-output witness are in `core-runtime-receipt.json`. This worker did not apply any canonical change.

## Fixed byte closure and import paths

| Original Core-relative source | Core distribution path | Exact source/artifact SHA-256 |
| --- | --- | --- |
| `lib/tools/learned-memory-restore.mjs` | `dist/lib/tools/learned-memory-restore.mjs` | `c18df8abfd95cd9a01ff452a1ae7a0c004caec0387fa1095d6432f004bde908c` |
| `lib/tools/learned-memory-restore.d.mts` | `dist/lib/tools/learned-memory-restore.d.mts` | `a50a848cb6176a034bb0d6186ab201beac94d2f05fb90acd1813ffa567b66909` |
| `lib/tools/voice-attachment-restore.mjs` | `dist/lib/tools/voice-attachment-restore.mjs` | `7a4452808bde5b20e3261a9d47e59b2c3d520eae1f6d11e0efd49df48c8352d3` |
| `lib/tools/voice-attachment-restore.d.mts` | `dist/lib/tools/voice-attachment-restore.d.mts` | `71ca2427e21c75384cc31fb500a83cc7987184baec3a50e9e0e3da9ffc26d6e9` |

The actual runtime MJS closure is `node:crypto` only. Both declaration files import type `Database` from the existing `better-sqlite3` dependency. The copier validates static import/export references against the fixed four-file list, Node builtins and that explicit declaration-only dependency; undeclared packages, relative helpers outside the list, runtime import/require calls, missing files and non-UTF8/symlink/hardlink/changed source refuse. It parses with the already installed TypeScript development dependency; it invokes no compiler, emitter or transpiler and imports neither helper.

Raw source bytes are copied unchanged, including line endings and EOF. No rewrite or extension rename occurs. Thus original compiled `backups.js` references `./…-restore.mjs` beside itself, and its generated declaration references resolve to the preserved adjacent `.d.mts` files. Tests compare the actual imported/reexported runtime names in `backups.ts` with the helper source's real exported names; no fabricated helper contract is used.

`dist/veyra-core-runtime-closure.json` contains exactly the four source/target paths, byte counts and equal source/artifact hashes. Core's existing package `files: [dist/, README.md]` and Docker's original Core `dist` COPY carry the helpers, declarations and manifest. The copier source is build-only and does not need a new runtime COPY or public Core export.

The same materializer reconstructs the fixed plan from actual source before writing; caller-supplied raw bytes, file lists or destination values cannot widen writes. It validates every existing target and ancestor, including dangling symlinks, before any output. Four byte-identical files and one manifest use exclusive creation/read-only mode0444, and identical repeated materialization is idempotent. Unsafe or different existing targets refuse and remain intact; there is no deletion, chmod-to-overwrite, fallback path or cleanup of original failure evidence. After a refused build, the original Core build owner retains responsibility for its existing bounded output reconciliation/regeneration.

## Core132 and final candidate refresh

The actual helper and `backups.ts` integration landed before this proposal was frozen. Current `db.ts` and `132_voice_attachment_deliveries.sql` are fingerprinted as actual source evidence; maintenance source is also recorded without copying or executing it. The helper's metadata validation and SQL132 semantics are Root/voice-owned; this packaging change does not alter them, synthesize another schema, writer, migration, ledger or restore grant.

The new qualification source rows are the Core copier, actual `backups.ts`, the four helper/declaration sources and actual SQL132 migration. The seven image rows are compiled `backups.js`, the four exact copies, the Core closure manifest and **`/app/packages/ingenium-core/dist/data/migrations/132_voice_attachment_deliveries.sql`**. That last path is the original Core runtime consumer: compiled `dist/lib/db.js` resolves `../data/migrations`. Docker also has an older raw migrations COPY outside dist; its presence is not evidence that Core's actual consumed migration path is complete. Preserve the original data copy and protected historical migrations.

Before any actual candidate observation or independent approval, Root must regenerate the final integrated revision/full-source SHA, every selected source byte count/hash, immutable image/config identity and every actual emitted artifact hash/ownership/mode. Changes to Core `db.ts`, `backups.ts`, package build, helpers, SQL132 and the closure manifest invalidate the previous snapshot. These docs contain preintegration source/plan hashes, not an approval, source-definition JSON, observed file DTO or actual runtime result. SQL131 and further coordinator/owner changes must be enrolled explicitly once their real source exists. No old manifest/approval may be replayed by changing list counts alone.

## Narrow verification and remaining acceptance

Eleven checks pass on Windows Node24.18.0 and WSL Node22.23.1. They read the actual original build/config/helper/backups source, record the Node resolution witness, verify exports and fixed runtime imports, compare byte hashes and paths, parse JS/recipe syntax, and run the proposed **same materializer against an in-memory distribution only**. The latter checks exactly four immutable copies plus one manifest, idempotency, changed source, missing helper, unsafe/dangling/different targets, preserved failure evidence and refusal to honor caller-selected output lists. No real output directory or distribution file was created or changed. Existing original Core output SHA is rechecked unchanged.

The exact patch passes actual Root `git apply --check` without being applied. These checks do not establish a successful Core build or packaged runtime import. Root still needs the original Core build, exact four-file/manifest comparison, actual compiled `backups.js` and declaration resolution/import check, final Docker/Core package file validation, complete actual API/Core/static checks and genuine SQL132/signed restore/maintenance regression under its existing lease/storage boundaries. This worker did not duplicate those database tests or touch active outputs.

The complete original release goal remains open: real SQL131/coordinator waiting-child/readiness/private-egress/retirement, all18 actual cases and independent protected approval; VS Code removal payload/denial/preservation and Work/Web/CLI/terminal/Git/restore acceptance remain required. Earlier focused source or type checks cannot close those gates.

## Storage reconciliation

Reuse the original C-backed WSL task root `/home/brajam/.local/state/ingenium-release/skill-zen-fix-1792810845`. Exactly seven new small durable artifacts under this worker's existing `docs/workstreams/packaging/` plus its single existing coordination status comprise this slice: copier source, proposer, test, freezer, patch, receipt and guide. No new checkout, physical root, drive, dependency/source copy, cache, compiler output, download or temporary file exists. Root remains their concrete consumer for integration/review and actual build acceptance. Regeneration and protected paths are in the receipt; process TEMP/TMP/TMPDIR remain in existing coordination/packaging with NODE_COMPILE_CACHE empty.

Cleanup: **removed paths none; measured removed bytes0; new disposable outputs none**. Original Core outputs, all user/runtime/editor/workspace/backup data, Native targets, Cargo homes/caches, unique failures and prior frozen source proposals remain untouched. No Linux filesystem or Windows disk recovery is claimed.
