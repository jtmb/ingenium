# Quota8 semantic proposal for Root review — no DDL

Owner: Work UI worker; same approved C-backed task root. Native source remains
untouched. No build, application/runtime/model/GPU/browser, new worker or schema
activation. This is an unintegrated semantic prototype and integration contract.
Allocation8 remains Root-owned. Frozen7 and every prior checkpoint remain exact.

## Three independent ledgers

1. **Resident allocations.** One actual Runtime/registry pool,64MiB unchanged.
   Reserve capacity BEFORE each allocation/load/decode; keep the private charge
   in the backing allocation. Request/effective/original/outcome/HTTP response/
   replay clones and spans share that allocation and its charge. Only the last
   actual owner dropping the backing storage releases capacity. A tiny surviving
   span retains the WHOLE allocation's capacity, not its logical span length.
2. **Physical custody.** Actual read handles, request workers, client/response
   closers, engine trees and failed-close owners retain their original sealed
   custody independently. A resident-byte drop never proves physical closure;
   terminal status/slot census/auth/current-owner success never drops a byte
   charge. Pending/unknown/failed physical resources remain protected.
3. **Durable history/no-replay.** Exact raw/effective/source/ACK bytes and minimal
   immutable identity remain on disk. They impose no lifetime4096 brick or
   resident charge merely by existing. They cannot be loaded wholesale or made
   executable by historical metadata. Existing explicit forget/tombstone rules
   remain separate from active disposition and logical deletion is not erasure.

resident_payload.rs demonstrates only ledger1: actual preallocation capacity
reservation, fixed-size initialized storage, immutable Arc allocation, shared
spans/cursors and last-owner release. It supplies5 meaningful ownership/refusal
fixtures, UNRUN. It creates no effect/read/transport/DB authority and has no
release-for-terminal/slot API. It measures requested payload capacity, NOT whole
process RSS. Bookkeeping, chunk-descriptor, path/AST/SQLite/HTTP overhead must be
bounded and charged/reserved in the actual integration before64MiB acceptance.

The production pool must come only from the actual bound Runtime/registry. No
alternate pool supplied through a DTO, fake current predicate, new store or
callback may mint a received/original/replay token. This prototype is deliberately
not mounted or exported as a generic allocator/intake endpoint.

## Concrete integration interfaces

- `begin_received_body(actual_authenticated_child, actual_lease, actual_registry)`
  mints an opaque mutable intake owner BEFORE reading body chunks. Complete
  received bytes, actual origin/scope and full framed hash create NativeWebOriginal.
  Replace the uncharged Vec intake path; reject capacity exhaustion before effects.
- `Payload`/bounded chunk sequence replaces raw/effective/request/outcome body
  Vec/Arc owners. Identity transform shares allocation; real transform allocates
  charged output before copying/encoding and releases old source only after its
  last actual consumer. Grow by charged fixed chunks; avoid hidden realloc peaks.
- Actual retained Windows source capture and WSL snapshot code reserve BEFORE
  reads/decodes. Source data, inline decode, path strings, provenance, metadata,
  hashing and parser scratch have bounded owners. Stream source/ACK BLOB writes;
  do not build full source-base64 JSON or bind full large SQLITE_TRANSIENT copies.
- Actual transport observation retains charged chunks BEFORE HTTP. Its request
  Reader and closer own the same charged bytes; transport timeout/panic/cancellation
  cannot detach a charge or erase the raw prefix. Read and transport proofs remain
  the existing private original witnesses, not pool counters.
- The first response should reuse charged immutable ACK chunks when possible.
  Historical replay first obtains a bounded response/page reservation, then reads
  only those pages. Each emitted HTTP/Bytes/stream owner holds the real charge.
  No uncharged `.to_vec`, full-history Vec, full-BLOB get or raw Arc escape.
- `NativeWebLastConsumerDisposition` is a private same-original custody fact:
  actual same-writer publication (or genuine original retirement), actual read
  close and checked transport end, plus explicit resident-owner transfer/release.
  ProjectStore consumes it into additive disposition metadata. Metadata must NOT
  decrement the runtime byte pool. Actual allocation Drop owns that operation.

Current service `_same_actual_outcome` survives across flush; slotstrongcount1
does not imply last body owner. Either drop that redundant caller ref before flush
or transfer its actual charged owner. The response/replay owner must still remain
charged after slot retirement and after SQL disposition. This is an explicit
counterexample to using registry census as a resident-byte release predicate.

## Historical reader requirements

Use exact indexed operation/stable-key lookups and bounded/paginated lists.
Reserve each response/window BEFORE fetching bytes. Use verified incremental
SQLite BLOB I/O (feature/ownership/close review required), not an assumed bounded
`substr` implementation: SQLite may materialize its input. Pin the exact actual
row/connection/read snapshot and preserve full body length/hash validation with a
bounded prepass or immutable verified representation before releasing payload.
Owner revocation/forget checks remain current and explicit; interruption yields
an incomplete read, never a fresh POST or fabricated complete ACK.

Forget/tombstone cannot resurrect data through a live replay snapshot. Its actual
reader lease must revoke/abort; outstanding response bytes retain their charges
until their last actual consumer ends. Read handles and returned-data allocations
are separate resources. A cold restart must not load all history, infer old
physical closure from an empty new registry or rebuild execution authority from
rows. Legacy/unknown original custody requires real original reconciliation.

## Byte residency is not the lifetime of a physical guard

| State | Physical custody | Resident charge | Durable bytes |
|---|---|---|---|
| Captured source before original commit | actual held chain | actual source/chunks charged | not yet a replacement for source owner |
| Exact source committed and privately parked | chain still held | release ONLY actual last source-byte owner | full source/provenance remains exact |
| HTTP sender active | actual request/worker retained | every actual reader chunk/owner charged | original remains no-replay |
| Lost/partial response | read/request/closer retained | actual prefix/chunks charged until persisted and actually dropped | incomplete observation is NEVER complete ACK |
| Published response still consumed | actual closed resources may retire | response/replay allocation still charged | exact ACK/history remains |
| All original physical owners retired | genuine checked witnesses | any surviving byte owner still charged | history/key/tombstone remains |

Parking source bytes requires a sealed same-writer exact-source commit witness,
bound source guard/operation/input/length/hash. It neither closes a handle nor
grants a new read. Later original ACK verification can use bounded private pages
from that same source, authorized only for this pre-send completion. Revocation
does not grant another owner the bytes; missing/tombstoned source refuses content
access and preserves the unresolved original. No successful-row boolean permits
parking or releasing memory: actual source references must be surrendered.

Prefer bounded charged windows and exact on-disk chunk sequences where whole
wire/ACK bodies cannot coexist within64MiB. Pre-reserve the bounded sender/observer
scratch windows BEFORE HTTP. The actual request Reader owns the original immutable
chunk/page lease, not a deserializable path. The actual response observer spools
raw bytes and computes full hash incrementally, preserving status/headers/prefix
on failure. Only complete EOF plus validated materialized User and committed
original publication produces the existing positive witnesses. Spool/storage
failure keeps unknown/no-replay and its exact failure prefix; never fabricate ACK.
This does not waive authoritative image/skill expansion/storage bounds or full
20MiB acceptance. A fixed streaming memory window is not proof of disk capacity.

Every temporary transform, decode, parser, SQLite and metadata allocation needs
its own charged destination or a proven bounded reservation. Full serde Value
inspection is not bounded by raw bytes: many tiny metadata values can expand
dramatically. Selectively inspect required fields and skip/preserve all other raw
spans without an uncharged AST. Use shared original path/range descriptors rather
than thousands of full ancestor-prefix copies; actual handle custody stays exact.

## Schema review boundary

Root may add allocation8 disposition/representation/index metadata and replace
active accounting guards additively. Do not edit7, prune user bytes, delete keys,
independently raise caps or disable ordinary supported file/image/skill behavior.
Resident enforcement is the actual pool, not a historical row sum. Active custody
and effect-unknown fences continue until genuine retirement; they are not silently
cleared by last-byte-owner drop. Remove the lifetime4096 insertion guard; bound
actual active owners and page queries instead. Disk history can grow as user data
under real storage policy, with exact no-replay identity and explicit privacy.

Current physical8MiB/16MiB checks require an explicit lossless larger-payload
representation design. Chunk/subrange/codec reuse must validate actual bytes,
logical length/hash and bounded reconstruction. Unknown raw partial bytes need
permitted private persistence before their last retained allocation can disappear.
No schema or body-format declaration here authorizes execution/replay.

## Required semantic and finite counterexamples

- Existing real allocation7 fixtures:12 terminal1MiB file inputs charge50,339,016
  bytes and reject13;4096 explicit forgets leave0 payloads/4096 keys and reject4097.
  The new design must preserve all user bytes/keys while fixing those availability
  failures, with resident/custody bounds measured separately.
- Original and slot drop while response/replay/span/cursor still owns bytes:
  charge survives; last actual owner frees it. Tiny subrange still pays whole
  backing capacity. Refused allocation cannot release another live allocation.
- Row marked terminal/released, copied close JSON, wrong writer/registry/slot,
  active Body Arc or pending closer cannot release memory or mint physical close.
- Failed join then stop retry, extra client owner, failed checked close, lost ACK
  and partial body preserve original physical custody and exact observation.
- Forget/revocation races cannot append/read/resurrect through stale scopes.
  Cold restart and >4096 closed operations use indexed/page-bounded reads.
- Ordinary20MiB Windows URI, inline and WSL snapshot paths preserve exact wire/
  source/ACK under real transforms and full64MiB peak; no assumed compression.
- Large future metadata arrays must not allocate a full serde Value outside the
  pool. Use bounded selective inspection while preserving all original bytes.
-32 deep file paths can retain thousands of cloned ancestor PathBuf prefixes;
  metadata must be charged or represented by shared paths/ranges. Handle count
  alone is not a byte bound. No physical Windows conformance is claimed here.

Root semantic/migration review, exact production integration, compiler and real
memory/SQLite/TCP/platform/20MiB qualification remain required. No activation.

Cleanup: retained only this contract and the small unintegrated source prototype
for Root review. No bulk/temp/cache/dependency/build or disk DB output. Removed
paths:none, measured bytes0; no disk recovery claim. Protected source/lockfiles,
research and immutable checkpoints survive.
