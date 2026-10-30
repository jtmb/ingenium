# Exact allocation8 representation requests, no DDL

Root alone owns names, allocation, dependency activation, schema validation and
migration. This document requests concrete additive shapes; it is not executable
DDL. Frozen0007.sql and existing history/source/ACK/key bytes remain untouched.
Neither a table row nor a disposition can release the actual resident pool.

1. `local_web_payload_manifests`: integer rowid primary key; operation_id FK to
   immutable original keys; role enum raw_request/effective_request/source/ack/
   unknown_prefix; source identity hash when role source; generation/representation
   version; exact logical length; exact full byte hash; chunk count; committed
   completeness enum incomplete/sealed; original input hash; original writer-bound
   provenance hash. Unique (operation_id,role,source identity,generation). Explicit
   unique integer key supports incremental BLOB IO; no WITHOUT ROWID body table.
2. `local_web_payload_chunks`: integer rowid primary key; manifest rowid FK;
   ordinal; exact offset; byte length; chunk byte hash; bounded chunk BLOB
   (proposed64KiB); UNIQUE(manifest rowid,ordinal), UNIQUE(manifest rowid,offset).
   Ordered covering metadata index (manifest rowid,ordinal,offset,length,hash),
   and manifest index (operation_id,role,generation). No global content-addressed
   pool that can merge provenance or silently share ownership across operations.
3. `local_web_payload_seals`: immutable one-per-manifest exact committed full
   hash/length/count plus original publication/input/provenance identity. Writer
   computes full hash while inserting actual ordered source/wire/observed bytes;
   seal validates zero start, no gaps/overlap, exact contiguous offsets and totals.
   Trigger/SQL declarations alone cannot prove the byte hash. Private original
   writer transaction and actual bounded verifier must establish it. Late chunks,
   replacement, mutation and duplicate seals are rejected even with REPLACE and
   recursive_triggers OFF. Existing unsealed/failed writes are never ACK success.
4. `local_web_observation_metadata`: operation ID, actual observed status if any,
   allowed bounded content-header representation, response completeness/phase,
   static failure code and unknown-prefix manifest reference. Explicitly separate
   exact partial-byte persistence from admitted/rejected publication. Preserve
   unknown originals after read/transport end; a prefix is never a complete ACK.
5. `local_web_physical_dispositions`: append-only bounded records per operation
   and original generation for custody/read/transport/engine observation. Preserve
   exact failure/unknown/attempt-started states, actual publication reference and
   retained byte-manifest references. These are durable inventory, never a token
   recreating a live Arc, job, read handle, closure or replay/execution permission.
   Keep pending physical custody in actual in-process registries. Cold restart
   does not infer success from an empty new registry or terminal disposition.

Compatibility and accounting changes required in allocation8:

- Replace `local_web_keys_insert_guard` with the same identity/original intent/
  REPLACE protections minus lifetime count>=4096. Keys survive all explicit forgets.
  Do not weaken original operation/hash/stable-key uniqueness checks.
- Replace payload/ACK historical SUM-as-resident guards with actual manifest and
  transition validation. Runtime backing allocations enforce64MiB payload capacity.
  Do not label active slot count or durable disk byte sum as resident ownership.
- Old payloads/ACKs/sources remain readable losslessly from legacy BLOBs. New large
  bodies can use additive manifests/chunks without rewriting old rows or changing
  keys. Existing16MiB/8MiB CHECK constraints and insertion protocol mean simply
  adding chunk tables is insufficient. Root must approve an explicit new-format
  key/manifest transaction path, including exact original request hash framing,
  accounting metadata and coexistence guards before ordinary20MiB can work.
- Explicit exact terminal forgetting must revoke actual active read handoffs
  first, then delete all operation-private chunk/seal/observation payloads under
  the same original writer transaction while preserving minimal no-replay keys,
  explicit forget receipt and required custody failure inventory. Unknown remains
  protected. Do not call logical deletion secure erasure or backup deletion.
- Historical list reads use indexed seek pagination and bounded scalar columns,
  never collect all lifetime keys or full bodies. No lifetime availability brake.

The first proposed legacy reader does a bounded full hash prepass for each page
inside the SAME actual row/Blob/transaction snapshot. It closes before releasing
the original store mutex. It is deliberately O(N*page_count). Reviewed immutable
sealed chunks can later enable per-chunk validation plus exact ordered manifest
without reopening a different BLOB after a hash witness. No assumed compression,
disk capacity, full20MiB qualification or whole-process RSS bound is claimed.
