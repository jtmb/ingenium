# Native Cargo check-only peak estimate

Propose a **fixed 2 GiB conservative growth estimate** for one separate, native Windows check-only stage using the existing compatible dependency inputs. Add the existing **256 MiB concurrent source allowance** separately. This is a simultaneous planning estimate, not a measured stage peak or a mathematical disk bound. The coordinator owns independent review, actual source freeze, original storage checks, compiler execution and hook integration. This worker invoked no Cargo/rustc/build, changed no shared/native file, and attempted no cleanup.

The exact proposed command is:

```text
cargo check --locked --offline -j1 -p veyra-service -p veyra-desktop
CARGO_INCREMENTAL=0
CARGO_BUILD_JOBS=1
CARGO_NET_OFFLINE=true
```

Use the existing explicit Rust/Cargo 1.99.0 binaries, native default `dev` profile, host `x86_64-pc-windows-msvc`, same physical source/target/Cargo home and exact established encoded remap flags. There is **no** `--target`, test/all-targets flag, feature selection, profile/debug override, rustc emit override or new wrapper. It checks the same two packages selected by the original normal gate, whose exact current argv is `cargo check --locked -p veyra-service -p veyra-desktop`. Offline, one job and disabled incremental make the dedicated stage assumptions explicit. They do not lower estimates for full builds, tests, linking, packaging or other Cargo operations; those retain 4 GiB.

## Actual retained cache and source evidence

Read-only inventory on 2026-10-30 found:

| Retained category | Logical bytes | Relevance |
| --- | ---: | --- |
| Registry dependency `.rmeta`, all cached variants | 695,954,498 | Broad aggregate metadata anchor, including multiple feature/profile variants; not merely latest workspace output. |
| Workspace `.rmeta`, all cached variants | 129,915,884 | Current workspace library metadata plus older/test variants; latest ordinary check libraries total about 58 MB. |
| Macro/host DLLs | 82,361,344 | 33 existing DLLs. |
| Macro/host PDBs, excluding workspace linked test | 112,357,376 | Combined DLL/PDB anchor is 194,718,720 bytes. |
| Entire `debug/build` tree | 293,691,902 | 677 files, including host build scripts and native/generated outputs, some duplicate filenames/copies. |
| Entire `debug/.fingerprint` tree | 3,918,266 | 2,733 files. |
| Retained `.rlib` artifacts | 826,100,522 | Existing host/codegen-compatible inputs; this profile assumes their dependency graph remains reusable. |
| Retained incremental tree | 2,895,297,798 | Existing bytes remain in starting capacity accounting. No deletion and no new incremental sessions in this stage. |
| Retained linked workspace test EXE/PDB | 51,037,184 / 324,816,896 | Existing prior test output remains counted; this check does not request rebuilding/linking that test. |

The largest cached metadata file is 71,195,600 bytes (`windows`). Within build output, desktop totals 42,871,147 bytes, SQLite 24,390,362, ring 11,425,969, and WebView2 sys 35,049,618. These are disk observations, not a claim that all will rerun. The desktop build script is the only build script in the selected workspace dependency closure; the separate legacy app also has one but is not selected. The selected desktop script copies bounded small original manifests/config/capabilities/icon into OUT_DIR, writes a metadata sentinel and calls the already-pinned tauri-build. It does not install Node packages or build the frontend.

All 705 inspected Cargo fingerprint JSON records with compiler identity matched compiler number `17664546606611198464` and exact ordered rustflags-array SHA-256 `38f2a7cedf28808b2c241a34162360c88c417b27e4d10f7a53cd3682bf1f2e27`; no different compiler/flag record was observed. Ordinary workspace check fingerprints share profile `6921424168006762524` and config `9396254390672932401`. Build scripts/macros legitimately have separate host profile identities. This is substantial compatible-cache evidence, not an assertion that every unit is fresh.

Read-only Git diff against cached-source base `268962e20bef8c246fce332241c08c00c1fc2317` found no tracked lock/root/member manifest/toolchain/.cargo differences. Cargo.lock is `a7bb23ff65c5359cddd1f9e5f98a762070124424417808e3117fef746a368aee`. Current root declares no custom dev profile. Rust toolchain declaration remains 1.99.0. Original normal two-package source gate succeeded in retained `evidence/windows-mvp-source-commit-gate-r2.json`/log; the later service-only receipt also succeeded. Those establish prior cache consumers, not acceptance of new schema/project/Voice code.

Current selected workspace source directories total 20,848,378 bytes; the estimate admits up to 32 MiB before review. New schema/projectless/Voice implementation source can be newly frozen and checked under this profile if declarations/features/generators remain unchanged. A changed workspace implementation is expected to regenerate its metadata; it is not falsely required to match old implementation bytes. Actual current source must nevertheless remain frozen during its check.

`cargo-check-stage-observations.json` records minimal source/compiler/cache facts and hashes. The compiler launcher alone is not the closure: the observed driver DLL hash is included alongside Cargo/rustc executable hashes. No executable was invoked to obtain them. `.rustc_info.json` reports cached Rust 1.99.0, commit b940084d7, LLVM 23.1.1; binary and source identity still need binding by the coordinator's actual lease.

## Simultaneous growth model

| Component | MiB | Rationale |
| --- | ---: | --- |
| Registry metadata | 768 | More than a second complete observed aggregate registry `.rmeta` set (695,954,498 bytes), despite expected reuse. Includes ordinary metadata updates under the admitted same graph. |
| New/replacement workspace metadata | 256 | More than twice all retained workspace metadata variants, and over four times latest ordinary-check metadata. Covers expected new nonincremental workspace units and current feature changes. |
| Build scripts, generated/native OUT_DIR | 384 | More than a second complete observed build tree, including desktop host helper/executable/PDB and Tauri/SQLite/ring/WebView outputs; conservatively budget reruns even with reusable inputs. |
| Macro/host DLL/PDB artifacts | 192 | A second observed aggregate 194,718,720-byte DLL/PDB set fits within 201,326,592 bytes. Existing registry host rlibs remain compatible inputs; introducing a new host codegen graph is outside the profile. |
| Simultaneous temporary/replacement files | 256 | Added on top of all final-category allowances, for one-job rustc/linker-helper staging and larger metadata replacement. Largest observed metadata is about 68 MiB. Old destination bytes stay in starting inventory. |
| Logs and fingerprints | 32 | Over eight times observed fingerprint logical bytes, plus one ordinary check log; no very-verbose repeated trace. |
| Allocation and uncertainty | 160 | Filesystem rounding and conservative headroom for producer variation. |
| **Complete stage estimate** | **2,048** | Every row is summed; no sequential-overlap discount. |
| Concurrent source allowance, additional | **256** | Charged separately in both ceiling and free-space arithmetic. |

[Cargo check normally emits metadata](https://doc.rust-lang.org/cargo/commands/cargo-check.html), but build scripts/procedural macros still require runnable host artifacts. [Incremental compilation is used for workspace/path dependencies](https://doc.rust-lang.org/cargo/reference/profiles.html#incremental); registry dependencies are normally nonincremental. Disabling incremental therefore deliberately budgets new workspace metadata while retaining compatible registry/host inputs. It does not imply existing incremental bytes can be subtracted or deleted. [Build scripts can rerun and retain generated OUT_DIR files](https://doc.rust-lang.org/cargo/reference/build-scripts.html); the model budgets them separately, including compiled host helper output rather than treating check as zero-codegen.

The estimate does **not** admit rebuilding the complete retained registry `.rlib`/debug graph as well as all these categories. Reusable compiled host/dependency inputs, unchanged feature/target/profile/codegen/config identity and no new generators are essential assumptions. Missing/cold inputs or dependency/profile/codegen changes require a new review or the normal 4 GiB reservation. A larger full-build request cannot masquerade as this command. No mathematical quota, new kill mechanism or complete freshness certificate is required by this planning review.

## Concrete review function and integration conditions

`tools/veyra-release/cargo-check-stage-profile.mjs` exports the fixed estimate, exact immutable command/environment and pure `reviewCargoCheckStage`. Its eleven fixture-free CPU tests cover command/operation expansion, incremental mode, every dependency/flag/compiler/config/alias identity, changed workspace implementation versus declaration drift, producer envelopes, missing host-cache assumptions, exact ceiling/floors, stale measurements and caller policy injection. It never starts a compiler or authorizes a build.

Before coordinator execution:

1. Freeze the actual integrated workspace Source; bind current bytes to before/after checks. Match reviewed lock/root/member manifests, build script/config/capability/icon inputs, Rust/Cargo/driver closure, effective Cargo config absence, encoded flags, feature/profile graph and physical source/target/Cargo home aliases. Bind the native build environment too: linker/MSVC tool identity and relevant CC/CXX/AR/CFLAGS/CXXFLAGS/LIB/INCLUDE/PATH inputs must preserve the existing host/native build assumptions; changed build-script environment needs review. Existing remapper already rejects Cargo config/wrapper overrides and validates registered alias identity; preserve it.
2. Confirm existing compatible host/dependency inputs are present, no new generator/feature/dependency/profile is introduced, and source/observed cache categories remain within reviewed envelopes. Changed declarations or missing cache do not authorize regeneration under this profile. Do not inspect/alter unrelated Cargo credentials/configuration.
3. Acquire the exclusive coordinator lease and remeasure complete paired native budget + Linux allocated bytes. Add 2 GiB + 256 MiB; remain at or below 20 GiB, preserving both 15 GiB post-growth free-space floors. The profile does not supply current capacity facts. Old incremental, linked tests and all protected artifacts stay in starting inventory. No deletion or root migration is proposed.
4. Integrate a dedicated reviewed check-only entry/profile through the original guard, without globally lowering its mixed/full-build reservation. No shared/root hook edit is supplied by the worker. Retain ordinary architecture/source gates and first-failure/source stability evidence.
5. Record actual compiler result and observed growth, reconcile generated outputs after their concrete last consumer using existing preservation checks. Check success remains Source qualification; it does not complete native runtime, persistence, visual, audio, packaging or release acceptance.

For the earlier reported example inventory (11,391,497,728 native + 7,143,284,736 Linux), this stage plus source allowance would reach 20,950,701,568 bytes, leaving 524,134,912 under 20 GiB. This example is stale for execution and is used only to test arithmetic. The coordinator must measure current use after its actual frontend work; no worker build lease is implied.

## Output reconciliation

Four small durable owned files comprise this follow-on: tool, test, this review and minimal observation JSON. Regeneration: reread/hash the identified source and retained artifacts, then run `node --test tests/veyra-release-cargo-check-profile.test.mjs` with scoped TEMP/TMP/TMPDIR. No fixture/build/cache/dependency output was generated. Removed paths: none; removed bytes: 0. All prior cleanup refusals remain protected, including the exact now-empty frontend-cache parent. No Windows or Linux space recovery is claimed.
