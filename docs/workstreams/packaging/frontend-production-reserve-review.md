# Separate frontend production peak estimate

A **fixed 2 GiB conservative growth estimate** is reasonable for the separately enumerated frontend production stage below, subject to coordinator review of exact inputs and fresh capacity measurements. This is a planning estimate, like the existing generic 4 GiB estimate; it is not a filesystem quota or proof of a mathematical maximum. The existing mixed service/desktop Cargo gate remains at 4 GiB. No build is authorized or run by this proposal.

The stage reuses the coordinator's already-qualified exact-source no-emit typecheck. It runs only the existing programmatic production Vite operation and browser-scope evidence work from `tools/build-web-with-scope.mjs`. Excluding typechecking requires a matching qualified receipt bound to the same source and installed inputs. The currently inspected human-readable types receipt records success but does not itself contain a complete input digest; the coordinator must bind it from its retained source evidence or qualify the exact frozen inputs before using this profile. An unbound or stale receipt refuses the profile.

## Enumerated estimate

| Simultaneous growth component | MiB | Evidence and assumption |
| --- | ---: | --- |
| Complete distribution including public assets and workers | 512 | Prior actual distribution was 23,669,726 logical bytes / 144 files. Current source is 6,000,294 bytes / 585 files, contracts source 52,515 bytes, public 1,986,352 bytes. Same lock and production transforms; both entries and workers retained. 512 MiB leaves substantial room for current feature chunks and allocation. |
| Frontend cache | 512 | Prior consumed cache was 99,280,116 logical bytes. It has been removed; this is a fresh-output estimate, not a warm-cache assumption. Vite's inspected production path has no build dependency prebundling, but this budget conservatively retains several times the observed cache allowance. |
| Simultaneous temporary/replacement data | 512 | Reserve another complete proposed distribution allowance while generation/emission/transforms overlap. Fresh empty outputs prevent a second retained previous distribution. No external package installation or archive extraction is part of this stage. |
| Browser module/input/distribution scope JSON | 64 | Existing evidence stores paths, hashes, package/version and module records, not copies of bundles. 585 local source files, the prior 144 emitted files and dependency/module records are small compared with this allowance. Preserve existing exclusions and unresolved embedded-license limitations. |
| Scoped logs and TEMP | 64 | One production invocation, no watch/server/test/compiler/install process; runner config loader avoids the bundled-config temporary module. No verbose dependency trace or repeated retries in this profile. |
| Filesystem allocation and uncertainty | 384 | Separate contingency for allocation rounding, source growth within admitted envelope, compression reporting and transform variation. No claim that polling prevents every overshoot. |
| **Stage growth estimate** | **2,048** | All components are added simultaneously; no overlap discount. |
| Concurrent source allowance, additional to stage | **256** | Charged separately in paired-root capacity arithmetic. |

The previous final distribution/cache sizes support these component estimates but are not claimed as peak measurements. No stage peak trace was recovered. This is an explicitly conservative model with assumptions, not a constant chosen solely from available space. A materially larger source/assets/config/plugin/dependency graph needs a new review. The proposed admission envelope is at most 16 MiB local web source and 8 MiB public assets; those are review triggers, not runtime output truncation limits. No asset or feature is skipped to fit.

## Inspected producer closure and preserved semantics

Raw source identities are recorded in `native-stage-observations.json`, `frontendProducerReview.pins`. Inspection was read only against `veyra-phase-1/windows-source`:

- `apps/web/vite.config.ts`: only React 6.1.2, both `index.html` and `mini.html`, no user sourcemap/watch/custom build hooks. Source styles are CSS; no Sass/Less/Stylus sources were found in the web source inventory.
- Vite 8.3.4 defaults: production source maps false, write true, copyPublicDir true, watch null, no license/manifest/SSR output enabled. The proposal keeps ordinary writes and public copying. It does not need an in-memory serializer or change normal artifact semantics.
- Main emitter uses Rolldown write in this mode; worker processing generates assets and includes them in the build. React defaults use production Oxc transforms and disable Fast Refresh. React's inspected entry contains no direct filesystem write calls. The Windows Rolldown native binding is pinned by hash; no new native compiler, addon installation or target tree is generated.
- The existing wrapper uses configLoader `runner`, fixed contracts alias, separate frontend/cache output directories, before/after input hashes and main/worker module capture. All remain. Its ordinary typecheck is omitted only for the matching already-qualified receipt in the dedicated stage, never from the normal gate.
- Vite can discover PostCSS config through the workspace root. No additional `.postcssrc`/`postcss.config*`/`.env*` file was observed at web/apps/root during inspection. Admission must also verify package-embedded PostCSS configuration and environment inputs. New config/plugin/preprocessor/env behavior refuses this profile for review; it must not be silently disabled.
- `browser-notice-scope.mjs` inventories up to 512 MiB / 10,000 distribution files after emission and writes a new scope JSON file. Those existing checks remain but are not treated as a peak bound. All notice semantics/limitations survive.

Exactly one public asset was observed: `apps/web/public/veyra-blue.png`, 1,986,352 bytes, SHA-256 `32ceafc18f6e9a1174c5340eb396c686c296e1998a816b0d1acce010e9a98d92`. Preserve it unchanged. Both entries, styles, workers, office packages and browser license inventory remain part of qualification. [Vite's documented write/default options](https://vite.dev/config/build-options.html) support keeping this as its ordinary production stage; no stronger isolation property is assumed.

## Concrete profile and coordinator integration

`tools/veyra-release/frontend-stage-profile.mjs` exports the immutable component estimate and exact frontend operation, plus a dependency-free review function. Ten tests check arithmetic, both floors, source/runtime/config/command drift, no-emit receipt mismatch, planning assumptions and caller policy injection. It never starts a process, changes a guard, deletes output or grants build authorization.

The proposed dedicated operation is `programmatic-vite-build-with-browser-scope`, production mode, configLoader runner, write true, watch false, sourcemap false, both entries, same contracts alias, main/worker module capture and complete unchanged public copy. No Cargo/npm/install/typecheck invocation is included. The original wrapper must receive a coordinator-reviewed dedicated entry/option implementing exactly this operation with the stage review and qualified receipt; changing only the global guard to 2 GiB is not proposed. Shared files are coordinator-owned and remain untouched by this worker.

Before executing, the coordinator freezes and compares:

1. Source graph: the existing `hashBrowserScopeInputs` result plus all public files, exact config-resolution/environment inputs, and tool/wrapper identities. Use a canonical sorted path/hash serialization; record its SHA-256 with the accepted no-emit receipt. A later source/config/public change refuses until the receipt/estimate is reconciled.
2. Installed inputs: reuse existing immutable lockfile-compatible dependencies; preserve existing browser input qualification and read-only projection/alias checks. Bind source/installed locks, selected tool/plugin/native binding entries and actual Node binary/version. No copied dependency tree or fallback PATH tool.
3. Typecheck receipt: success, noEmit true, matching source and installed-input digests, plus actual receipt-file SHA-256. A boolean claiming success alone is insufficient.
4. Execution/assumptions: exact operation, empty plain frontend/cache outputs, scoped TEMP/cache/log environment, no additional plugins/config, CSS-only source assumption, exclusive coordinator build lease, unchanged normal mixed gate.
5. Capacity: fresh native budget bytes plus paired Linux allocated bytes plus **2 GiB stage + 256 MiB source** at or below 20 GiB. Both Windows and destination free space must retain 15 GiB after that growth estimate. No larger cap, another root, cleanup retry or workload stop follows from failure.

The coordinator's reported inventory 11,391,497,728 native + 7,143,284,736 Linux bytes is 18,534,782,464 bytes. Adding the profile and source allowance gives **20,950,701,568**, leaving **524,134,912 bytes** under the 21,474,836,480-byte ceiling. That is a reported example, not a fresh worker measurement or lease. Actual free-space/paired-root measurements and concurrent-work exclusion must be performed immediately before execution. The review function's success remains `eligibleForCoordinatorReview`, with `buildAuthorized:false`.

An active allocation monitor is a useful backstop for estimate deviation, not an additional hard-quota prerequisite. Preserve first failure evidence, never silently retry, and reconcile task-owned outputs under existing deletion checks after their last required consumer. Actual exact-source artifact, browser-scope, native visual/runtime and release acceptance remain open.

## Reconciliation

Only small owned tool/test/review/metadata source files were created. No fixture, scratch, cache, dependency tree, compiled artifact, package import, download or native/shared edit was produced. Removed paths: none; removed bytes: 0. Existing protected cleanup targets and source patch remain untouched. The tests are CPU-only and fixture-free. No Windows recovery is claimed.
