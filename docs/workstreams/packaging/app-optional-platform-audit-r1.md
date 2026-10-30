# APP optional platform audit

Three exact source-supported cleanup candidates total **29,360,128 Linux allocated bytes (28 MiB)**. Root must complete final ownership, protection/refusal, tracked-source, regeneration and process/container/mount/Windows-handle checks. No deletion or Windows recovery is claimed.

All paths below are under the original APP checkout node_modules; Native refusal targets and the retained pre133 Core build were untouched.

| Exact package subtree | Inode | Linux allocated bytes |
| --- | ---: | ---: |
| lightningcss-linux-x64-musl | 2057047 | 10,067,968 |
| @img/sharp-linuxmusl-x64 | 2420258 | 335,872 |
| @img/sharp-libvips-linuxmusl-x64 | 2420250 | 18,956,288 |

The actual host is Node22.23.1/linux/x64/glibc2.43. LightningCSS chooses its gnu package on this libc; Sharp runtimePlatformArch chooses linux-x64 and its glibc package, with a separate preserved wasm fallback. The three candidates declare libc musl and are optional in the unchanged lock. No direct tracked code import or forced musl platform flag was found in the bounded source search. Docker builder/runtime-base use node:22-slim, install from lock, and exclude host node_modules via .dockerignore. Thus these packages have no identified current consumer in the reviewed graph. Their parent package relationships, package versions, exact lock URLs/integrities, inode/device, per-file hashes and allocated bytes are in the JSON report.

Lock SHA256: 07e954e2af4bad758da89ffe94d08cc1309568a9d990c321aba7cdf2dd87e179. The existing retirement receipt records a cold Dockerfile npm ci/build with this same lock and pinned Node22. The existing scoped wrapper confines npm/TEMP/build AppData to the approved task root. No fresh restoration was performed. Root must validate the recorded regeneration recipe before deleting; any selective restoration must verify lock integrity rather than change resolution.

Retain Next musl SWC (98,463,744B): the installed loader explicitly iterates both Linux x64 triples, so a glibc host alone does not prove no fallback consumer. Retain Sharp wasm (9,351,168B): it is a native-load failure fallback. Retain Next source maps (2,743 files;105,725,952 allocated bytes): source-map diagnostics remain, and no per-file last-consumer closure was established. No blanket dependency or map prune is proposed.

Regenerate this read-only audit with Node22 on app-optional-platform-audit.mjs, with TEMP/TMP/TMPDIR in existing coordination/packaging and NODE_COMPILE_CACHE empty. It reads only the three candidate trees, public source/manifests and named regeneration receipts; it rewrites only the adjacent JSON report. This audit created only the durable script/report/note and updated the existing worker status. No disposable dependencies, builds, caches or scratch were created.
