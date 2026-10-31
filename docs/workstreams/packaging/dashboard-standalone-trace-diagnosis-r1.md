# Genuine standalone trace discrepancy — read-only diagnosis r1

The initial closure-r1 FAILURE remains valid evidence of the r1 helper's
all-manifest-union predicate. That helper incorrectly assumed standalone copies
next-minimal-server.js.nft.json as well as next-server.js.nft.json. No helper,
framework, generated file or receipt was changed to make it pass. Runtime/full
closure remains OPEN. Root's successful tree MOVE and asset assembly are inputs,
not standalone runtime acceptance.

## Complete bounded comparison

Known BUILD and moved DEPLOY paths are recorded once in the adjacent compact JSON.
The scan read all top-level .next/*.nft.json and all .next/server/**/*.nft.json:
54 manifests, 11,613 references, 1,547 unique mapped source paths. Every source
exists. There are zero additionalRoots and zero trace symlink entries; therefore
mapping each relative entry against its own manifest directory and then relative
to APP matches installed mapNftFileEntries' ordinary base-root branch. No entries
escape APP. No framework code was imported or evaluated.

Exactly one destination is absent:
node_modules/next/dist/compiled/next-server/server.runtime.prod.js.
It exists at the original source, 224,679 bytes, SHA256
0f86584a8bac2303e5cd1d024ed61311fc35ff3b198fa1c2af414ab28080b0ff.
Its sole referencing manifest is next-minimal-server.js.nft.json. All other 1,546
unique source/destination files match SHA256 byte-for-byte. All 18 required-file
entries match byte-for-byte, representing 17 unique paths because
.next/server/server-reference-manifest.json occurs twice. There are no source
absences, no observed file-byte transforms, and no other destination omissions
in this scan. Source/compared destination and primary framework source hashes
were re-read unchanged at the end. No duplicate full inventory is retained:
the compact receipt records aggregate SHA256 digests and this sole exception.
NFT fileHashes were not assumed to be SHA256; actual filesystem bytes were hashed.

## Primary installed Next.js 16.4.2 evidence

All references below are to APP/node_modules/next, not an assumed upstream version.
The adjacent receipt pins each full source SHA256 and the installed package version.

- dist/build/collect-build-traces.js, collectBuildTraces callback, lines 139–144:
  creates separate nextServerTraceOutput and nextMinimalTraceOutput; standalone
  mode is config.output === 'standalone'. Lines 171–183 set serverEntries to
  start-server, next, require-hook and next-server (plus shared entries), while
  minimalServerEntries explicitly adds compiled/next-server/server.runtime.prod.
  Lines 422–434 write the two distinct sorted sets to their respective manifests.
- dist/build/utils.js, copyTracedFiles, lines 1088–1119: handleTraceFiles reads a
  selected manifest, maps source/destination entries through mapNftFileEntries,
  and copies original bytes or creates described symlinks. It is not a broad
  dependency copier. Lines 1140–1186 select edge middleware/functions, non-edge
  page traces (skipping static pages), optional Node middleware, app traces,
  optional instrumentation, then next-server.js.nft.json. There is NO call for
  next-minimal-server.js.nft.json in this function. Lines 1187 onward generate the
  separate server.js entry using the application's path relative to tracingRoot.
- dist/build/index.js, writeStandaloneDirectory, lines 314–337: invokes
  copyTracedFiles and separately copies requiredServerFiles.files, the server
  manifest and selected loaded environment files. Lines 339–364 copy optional
  Node middleware, server/pages, response cache and server/app trees. These
  branches do not add the minimal-server trace or the missing compiled runtime.
- dist/build/nft.js, mapBasePath lines 39–44 and mapNftFileEntries lines 64–108:
  source is resolved against the trace directory and destination relative to
  baseRoot; separate additional roots and indexed symlinks have explicit branches.
  resolveNftOutputPath lines 111 onward rejects deployment-root escapes.

This is a demonstrated distinction between two generated entrypoint trace
contracts. It is NOT evidence that the missing file is an optional dependency,
not a missing original source, not a deliberate byte transform, and not proof
that the actual standalone runtime can never request that path. The file is
omitted from this generated tree in accordance with the observed copy selection;
no consumed-trace dependency omission was found by the broader comparison.
Do not fabricate the file, copy host modules, alias resolution or claim a runtime
pass from that classification.

## Exact review proposal and remaining consumers

Root should review the selected-trace contract independently before changing any
acceptance helper. Keep closure-r1 and its helper hash unchanged. Any future helper
revision must be explicit and receipt-pinned: keep containment, all required-file,
asset and byte checks; distinguish the standalone-selected trace obligations from
this separate minimal-entry trace, and assert the observed exception is EXACTLY
this one path, present in original source with the pinned bytes and referenced
ONLY by the separately emitted minimal manifest. Unknown missing paths, changed
source semantics, changed manifests, extra roots/symlinks or byte changes remain
failures requiring review. Do not blanket-ignore minimal or optional dependencies.
This packet itself changes no check and grants no runtime acceptance.

Actual generated server execution with ordinary Node, no APP fallback or injected
resolver, loaded dependency containment and the existing HTTP/static/public and
required image behavior controls remain Root's next consumer. If actual runtime
requests this absent path, retain the unique failure and investigate the genuine
build/copy contract; this diagnosis does not authorize copying around the failure.
All browser/workflow/desktop/image/cluster and full-release gates remain open.

## Output and cleanup accounting

Owner/root remain the existing packaging worker and authorized C-backed WSL task
root; no new root, cache, compiler output, download or dependency copy was created.
Only this document and adjacent compact JSON are retained as Root review inputs.
Regeneration is this owned source commit plus the read-only mapping/hash algorithm
and installed-source symbols described above. Original evidence and every prior
refused deletion target are untouched. Removed paths: none; bytes removed: 0.
Root retains sole control over lifetime/consumer checks and artifact retirement.