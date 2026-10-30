# Allocation7 capacity counterexamples and current copy audit

Owner: Work UI worker, same approved C-backed task root. No Native/shared writes,
application runtime, compiler, model/GPU/browser, download, migration8 or activation.
Frozenb4b5c353c702a4439fbdaef15a093819594eb22d inputs are byte-verified; no ancestor
artifact is regenerated or changed. audit.py executes only predecessor source
transformations in memory and the actual frozen allocation7 in-memory SQL fixture.

Actual SQL counterexamples:

- Twelve simulated terminal1MiB plain-file inputs retain50,339,016 charged bytes.
  With zero active effects in this fixture, allocation7 rejects the thirteenth
  original because historical payloads plus its worst-ACK reservation exceed64MiB.
  All12 historical payload/ACK rows remain unchanged. This tests the real triggers,
  not native authorization, actual effect dispatch or model behavior.
- After4,096 simulated terminal rows are explicitly forgotten, payload count is0
  but immutable key count remains4,096. The next insertion is rejected by the real
  key guard. This is synthetic SQL data; no real user privacy action occurs.

Current actual attachments.rs blob69b2ee33fe4aea454849945092312ba4f0608c3e has8MiB
MAX_BATCH_BYTES and1MiB MAX_TEXT_BYTES. The20MiB case is currently outside those
bounds. The audit does not independently raise them or claim admission/acceptance.

Source-level owned-buffer/capacity example for8MiB inline data: base64 is11,184,812
bytes. The current Windows identity path has separate original raw Vec, effective
Vec, submit Value string, dispatch Value string and request Vec copy, plus an
ACK Vec reserved to16MiB+1. Their overlap requires72,701,277 bytes before JSON
framing/allocator overhead, absent an explicit ownership/drop/sharing change.
This is conservative source accounting, not measured RSS or a claim that a
particular optimizer/allocator commits every page at that point. A64MiB bound
cannot rely on unproved compiler lifetime/allocator savings.

The separate full-provenance hash path holds source bytes, base64 Value and its
serde_json::to_vec encoding together. A hypothetical20MiB source produces at least
76,895,576 overlapping bytes there alone. Existing8MiB capture limits prevent that
20MiB source today. Releasing historical ACTIVE charge does not solve these copy
peaks; coherent representation/shared ownership/bounded inspection/streamed BLOB
writes remain necessary. No runtime memory acceptance is asserted.

Both SQLite databases are in-memory and closed in finally. No disk DB, temporary
file, input-data dump, dependency/cache or build output is generated. Retained
paths are this README, audit.py and audit.json for Root's resource/migration review;
regenerate with python3 -B audit.py and process TEMP/TMP/TMPDIR in existing
coordination/work-ui. Removed paths:none; measured removed bytes:0; no disk recovery
claim. Keep all user data, original source/lockfiles and frozen checkpoints.
