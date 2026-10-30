# Reproducible Linux input proposal

Status: implemented source proposal, independently checked without an image build. The coordinator applies the Dockerfile patch after reviewing and integrating its tool/lock prerequisites. Platform/runtime acceptance and a repeat-build comparison remain open.

## Reviewable changes

`linux-reproducibility.patch` changes only the coordinator-owned root Dockerfile. Its exact preimage SHA-256 is `0dfbd44093e98f776ca9f214ae6447a85c605edf82941d11f1c2e0cae96b73d8`, observed at coordinator HEAD `c1e9712c526db1e36637b5a821b3e2e3813ba464` plus request-integration source. The generator refuses other bytes; rebase through coordinator review instead of forcing a stale patch.

The accompanying authoritative manifest is `tools/veyra-release/linux-build.lock.json`. Integrate that manifest and the owned tools before applying the Dockerfile patch. The patch preserves all nine stages, original apt package lists, native Node bindings, editor/VSIX/theme, OpenCode, ttyd, Cloudflared, Playwright Chromium/headless/ffmpeg path and all final service profiles. It does not copy the separate Windows repository, inference engine, model manager, models, credentials or runtime data into Linux.

The immutable Linux amd64 base is `node:22-bookworm-slim@sha256:9f0dde62d10e7ff7a310ecaebd66225f6b46c17e6cb778449a77b05d3541bea2`. Metadata-only official registry reads resolved it from `22-slim`; the config identifies Node 22.23.4 and Debian bookworm. The manifest also retains the index/config digests and upstream source revision. No image layer was pulled. An explicit amd64 lock preserves the current x64 download ABI; another architecture needs its own reviewed recipe rather than fallback.

## Deterministic OS and npm acquisition

The recipe configures apt to use only the Debian, updates and security snapshots at `20261029T000000Z`. The manifest records exact sizes and SHA-256 hashes of all three official InRelease files. The tool rejects missing, altered or extra live indexes. Apt's default source files remain untouched but are excluded from resolution through explicit `Dir::Etc::sourcelist` and empty `sourceparts` settings.

Historical `Valid-Until` expiry is disabled only on these frozen sources. GPG signatures, the archive hash chain, explicit Debian keyring and insecure/unauthenticated repository denials remain enabled. HTTP bootstraps CA installation using apt's authenticated archive chain; it is not an unsigned or `trusted=yes` repository. Worker metadata reads verified byte identities, not actual apt signature/package-install execution. Those checks run in the coordinator's real image build. [Debian documents historical snapshot expiry](https://snapshot.debian.org/); [Docker documents digest pinning](https://docs.docker.com/build/building/best-practices/).

The runtime npm 12.2.1 tarball is checked against the official registry's SHA-512 integrity before an offline, ignore-scripts global install. Existing runtime npm version/security-overlay intent is preserved. Process-scoped build cache/log/AppData paths apply to both installation and version checks; no user runtime profile is modified. Whether the bundled npm tarball satisfies offline installation must be qualified by the actual build, not inferred from these unit tests.

Playwright's existing `install --with-deps chromium` remains. Its own apt calls inherit the frozen source configuration; the recipe rechecks snapshot indexes and captures the actual OS package closure after dependency installation. No required browser packages are removed to force a green build.

## Exact-source provenance and verification

Three small image receipts are produced under `/usr/local/share/veyra`:

- `builder-os-inputs.json`: pinned base/manifest hash, actual Node/npm and sorted dpkg package/version/architecture inventory plus snapshot indexes.
- `runtime-os-inputs.json`: corresponding final OS/tooling inventory after browser dependencies.
- `source-inputs.json`: exact application revision, source-manifest hash, commit epoch and actual Dockerfile/npm/brain/vendor/guard/manifest input hashes.

`source-manifest.mjs` now records the actual Git commit's `sourceDateEpoch`. Build arguments `IMAGE_REVISION`, `IMAGE_SOURCE_SHA256` and `SOURCE_DATE_EPOCH` are mandatory provenance inputs. Use a clean frozen integrated source manifest; do not pass the worker's earlier source hash for a different candidate. The source recipe's original Dockerfile hash is a patch-admission guard, while the source receipt records the final patched Dockerfile hash.

```sh
node tools/veyra-release/linux-recipe-patch.mjs "$COORDINATOR_SOURCE/Dockerfile" tools/veyra-release/linux-build.lock.json --check
node tools/veyra-release/linux-recipe-patch.mjs "$COORDINATOR_SOURCE/Dockerfile" tools/veyra-release/linux-build.lock.json
node tools/veyra-release/verify-linux-build.mjs tools/veyra-release/linux-build.lock.json "$EXACT_SOURCE_MANIFEST" "$IMAGE_RECEIPT_DIRECTORY"
```

The first command checks the stage graph and invokes `sh -n` on all resulting RUN scripts without executing them. The second prints the unified patch. `git apply --check` succeeded against the observed coordinator Dockerfile; the worker did not apply it there. The final command reads only bounded regular, unlinked candidate receipt files and compares their source, base, Node/npm, lock and index identities to the exact source manifest. It rejects stale or contradictory evidence. Exit 0 means only those input checks are satisfied, exit 2 is incomplete, and exit 1 is invalid evidence; none establishes runtime or byte-for-byte rebuild acceptance.

## Browser content gate

The MCP-resolved dependency is the nested Playwright `1.62.0-alpha-1783623505000`, Chromium/headless revision `1232`, ffmpeg revision `1011`. The root Playwright `1.61.1`/Chromium `1228` is a different installed edge and must not be substituted. The package lock pins their npm distributions, but the current browser download step has no independently retained content hashes.

All three browser payload hashes remain explicit null entries in the proposed manifest. `verify-linux-build.mjs` returns incomplete unless every expected artifact has a real full SHA-256 plus matching name/revision/hash-kind acquisition evidence in `browser-inputs.json`; a single Chrome hash cannot silently qualify headless/ffmpeg. Each kind explicitly identifies a full archive (`sha256-archive`) or a reviewed full artifact-tree content manifest (`sha256-tree-manifest-v1`); an executable-only hash is insufficient. A coordinator can qualify complete installed-tree manifests during the already required build to avoid downloading duplicate archives. The worker requested an existing qualified receipt or the coordinator's measured acquisition/hash lease. No large browser download, image pull or checksum fabrication occurred. Versioned URLs and a successful browser install are insufficient proof of this gate.

## Requested coordinator lease

After reviewing/integrating the tool/manifest source and root patch, freeze a clean integrated source and supply its actual three provenance build arguments to the existing singleton image builder. Preserve its current target/publisher/rollback rules and Actions-off policy. Do not create a second publisher or change Windows inputs.

The coordinator measures C:/destination reserves and the complete peak within the existing paired roots/20 GiB ceiling, schedules the actual image stage and any required browser acquisition, and records BuildKit resolved materials plus final immutable image digest. This worker has not pulled layers or run an apt/npm/image stage and supplies no invented build-growth estimate. Reuse the already required integrated image build rather than adding duplicate dependency copies or parallel full builds.

Retain the three tiny image input receipts and qualified browser evidence with that exact candidate, run the verifier, then perform actual image imports, ABI, auth/stream/editor/browser, persistence/migration/restore/rollback and platform checks. A repeat build is still required before claiming bit-for-bit reproducibility; mutable build timestamps, generated frontend IDs or unqualified external bytes cannot be waived by a green input report.

## Evidence and output reconciliation

Fourteen focused reproducibility cases plus the existing 31 app cases pass in WSL (45 total). They cover immutable lock/schema rejection, signature-preserving snapshot configuration, altered/missing/extra indexes, npm byte integrity, exact source/epoch binding, stale provenance, all three browser gaps, preserved feature/stage boundaries, bounded descriptor reads, literal shell replacement and shell-continuation parsing. Nine stages and 36 RUN scripts passed the read-only syntax audit. Windows results are recorded separately in the worker status receipt.

The worker created only owned tool/manifest/test/documentation/patch source. Metadata requests fetched small registry/config/InRelease documents, not layers or packages. Tests create no scratch fixtures or caches. The previously protected native patch and all failed cleanup targets remain untouched. No build, native preflight change, model/GPU work, service/container operation, desktop control or publication was performed. The coordinator's actual build lease and browser evidence remain required.
